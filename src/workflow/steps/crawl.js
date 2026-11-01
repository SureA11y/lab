'use strict';

// The Crawl queue step: the pages it finds from a start page, filtered by its
// patterns, and its steps run on each of them, on several pages at once.

const {
    applyIncludeExclude,
    collectHrefsFromPage,
    normalizeAndFilterUrls,
    normalizeUrlCandidate,
    parsePatternLines,
    safeGetOrigin,
    testPattern
} = require('../engine/url-list');
const {clampConcurrency} = require('../engine/step-helpers');
const {createChildContext} = require('../engine/context');
const {createCrawlWorkerTarget} = require('../engine/worker-pages');
const {isNonEmptyString, sleep, toNumber} = require('../engine/utils');
const {normalizeWaitUntil, safePageUrl, waitForSel} = require('../engine/nav');
const {pushLog} = require('../engine/log');
const {recordIterationFailure} = require('../engine/iteration-failures');

// The engine's own functions these steps call, to run the steps inside them;
// set by the engine when it loads (it requires this module first).
let applyActions, runActionAction;

function bindEngine(engine) {
    ({applyActions, runActionAction} = engine);
}

async function stepCrawlQueue(page, action, ctx, _localVars, depth, actionPathPrefix) {
    const strategy = isNonEmptyString(action.strategy) ? action.strategy.trim() : 'bfs';
    const maxDepth = Math.max(0, toNumber(action.maxDepth, 2));
    const maxPages = Math.max(1, toNumber(action.maxPages, 30));
    const maxSeconds = Math.max(1, toNumber(action.maxSeconds, 120));
    const perPageDelayMs = Math.max(0, toNumber(action.perPageDelayMs, 200));

    const sameOriginOnly = (action.sameOriginOnly !== false);
    const maxLinksPerPage = Math.max(0, toNumber(action.maxLinksPerPage, 200));

    const queueVar = isNonEmptyString(action.queueVar) ? action.queueVar.trim() : 'crawl.queue';
    const visitedVar = isNonEmptyString(action.visitedVar) ? action.visitedVar.trim() : 'crawl.visited';
    const ns = isNonEmptyString(action.varNs) ? action.varNs.trim() : 'crawl';

    const includePatterns = parsePatternLines(action.include);
    const excludePatterns = parsePatternLines(action.exclude);

    let seeds = null;
    const k = isNonEmptyString(action.seedsVar) ? action.seedsVar.trim() : '';
    const v = k ? ctx.getVar(k) : null;
    if (Array.isArray(v)) seeds = v.map(x => String(x || '').trim()).filter(Boolean);

    const currentUrl = safePageUrl(page);
    if (!seeds || !seeds.length) seeds = currentUrl ? [currentUrl] : [];
    if (!seeds.length) return;

    const baseUrl = currentUrl || seeds[0];
    const baseOrigin = baseUrl ? safeGetOrigin(baseUrl) : null;

    // visited
    const visitedArr = Array.isArray(ctx.getVar(visitedVar)) ? ctx.getVar(visitedVar).slice() : [];
    const visitedSet = new Set(normalizeAndFilterUrls(visitedArr, {
        baseUrl,
        sameOriginOnly: false,
        baseOrigin: null,
        dedupe: true
    }));

    // initial queue
    const seedUrls = normalizeAndFilterUrls(seeds, {baseUrl, sameOriginOnly, baseOrigin, dedupe: true});
    let q = seedUrls.map((u, i) => ({url: u, depth: 0, orderIndex: i}));

    // existing queue merge (strings)
    const existingQ = Array.isArray(ctx.getVar(queueVar)) ? ctx.getVar(queueVar).slice() : [];
    for (const u0 of existingQ) {
        const u = normalizeUrlCandidate(String(u0 || ''), baseUrl);
        if (!u) continue;
        if (sameOriginOnly && baseOrigin && safeGetOrigin(u) !== baseOrigin) continue;
        if (visitedSet.has(u)) continue;
        if (q.some(x => x.url === u)) continue;
        q.push({url: u, depth: 0, orderIndex: q.length});
    }

    ctx.setVar(queueVar, q.map(x => x.url));
    ctx.setVar(visitedVar, Array.from(visitedSet));

    const pageActions = Array.isArray(action.actions) ? action.actions : [];
    const prevIter = ctx._iterVars || null;

    // Number of a11yScan actions per crawl iteration.
    // Used to derive a stable global scan id in the form scan-1..scan-N,
    // matching the order the scans would have with concurrency = 1.
    const scanStride = Array.isArray(pageActions)
        ? pageActions.filter((s) => s && s.type === 'a11yScan').length
        : 0;

    // Number of "ordered artifacts" per crawl iteration (a11yScan + screenshot).
    // Used to assign deterministic ordering metadata across scans and screenshots,
    // matching the order the actions would have with concurrency = 1.
    const artifactStride = Array.isArray(pageActions)
        ? pageActions.filter((s) => s && (s.type === 'a11yScan' || s.type === 'screenshot')).length
        : 0;

    const t0 = Date.now();
    let index = 0;

    const concurrency = clampConcurrency(action.concurrency);
    const isolation = (action.isolation === 'context') ? 'context' : 'page';
    const closeWorkerPages = (action.closeWorkerPages !== false); // default true

    // Track active workers
    const active = new Set();

    // Allow coordinator to force-stop active workers (used on cancel)
    const activeCleanup = new Map(); // entry -> async () => void
    const mergeDiscoveredIntoQueue = (res) => {
        if (!res) return;

        if (res.ok && Array.isArray(res.discovered) && res.discovered.length) {
            for (const u of res.discovered) {
                if (visitedSet.has(u)) continue;
                if (q.some(x => x.url === u)) continue;
                q.push({url: u, depth: res.item.depth + 1});
            }
            ctx.setVar(queueVar, q.map(x => x.url));
        }
    };

    const scheduleOne = async (item, workerIndex, entry) => {
        const worker = await createCrawlWorkerTarget(page, ctx, {
            isolation,
            inheritViewport: true
        });

        const workerPage = worker.workerPage;
        const workerCtx = createChildContext(ctx);
        workerCtx.bindAbortToPage?.(workerPage);

        // Register cleanup so coordinator can stop this worker on cancel/timeout
        if (entry) {
            activeCleanup.set(entry, async () => {
                try {
                    if (workerPage && !workerPage.isClosed()) await workerPage.close().catch(() => {});
                } catch {}
                try {
                    if (worker.workerContext) await worker.workerContext.close().catch(() => {});
                } catch {}
            });
        }

        // Ensure worker sees the same cancellation state as the parent
        workerCtx.checkCancel = ctx.checkCancel ? ctx.checkCancel.bind(ctx) : workerCtx.checkCancel;
        workerCtx.isCancelled = ctx.isCancelled ? ctx.isCancelled.bind(ctx) : workerCtx.isCancelled;
        workerCtx.abortSignal = ctx.abortSignal || workerCtx.abortSignal || null;

        // Deterministic scan ordering metadata for this queue item.
        // Use the deterministic scheduling index (workerIndex), not completion order.
        workerCtx._iterationIndex = (typeof workerIndex === 'number' ? workerIndex : null);
        workerCtx._scanCounter = 0;
        workerCtx._scanStride = (scanStride > 0 ? scanStride : null);
        workerCtx._artifactCounter = 0;
        workerCtx._artifactStride = (artifactStride > 0 ? artifactStride : null);

        // Each worker has its own var scope and iteration vars
        const prevIter = workerCtx._iterVars || null;
        workerCtx.pushVarScope();
        workerCtx._iterVars = {index: workerIndex, total: maxPages};

        try {
            workerCtx.checkCancel?.('crawlQueue worker start');
            workerCtx.setVar(ns + '_url', item.url);
            workerCtx.setVar(ns + '_depth', item.depth);
            workerCtx.setVar(ns + '_index', workerIndex);
            workerCtx.setVar(ns + '_total', maxPages);

            // --- Navigate to the crawl target URL ---
            const navTimeout = toNumber(action.timeout, 60000);
            const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');

            workerCtx.checkCancel?.('crawlQueue before navigate');
            await runActionAction(workerPage, {
                type: 'navigate',
                url: item.url,
                waitUntil,
                timeout: navTimeout
            }, workerCtx, null, depth + 1, actionPathPrefix);

            // Optional readiness selector
            if (isNonEmptyString(action.waitForSelector)) {
                const wSel = action.waitForSelector.trim();
                const wVisible = action.waitVisible !== false;
                const wTimeout = toNumber(action.waitTimeout, 15000);
                await workerCtx.race(
                    waitForSel(workerPage, wSel, {visible: wVisible, timeout: wTimeout}),
                    `crawlQueue waitForSel ${wSel}`
                ).catch(() => {
                });
            }

            // Enforce origin + include/exclude on the final URL after redirects
            let finalUrl = safePageUrl(workerPage) || item.url;

            // 1) Enforce sameOriginOnly against the baseOrigin (seed origin)
            if (sameOriginOnly && baseOrigin && safeGetOrigin(finalUrl) !== baseOrigin) {
                pushLog(ctx, 'info', `crawlQueue: skipping page outside origin: ${finalUrl}`, {depth});
                // Do not run actions, do not discover links
                return {ok: true, item, discovered: []};
            }

            // 2) Re-apply include/exclude patterns on the final URL
            if (includePatterns.length || excludePatterns.length) {
                let ok = true;
                if (includePatterns.length) ok = includePatterns.some(p => testPattern(p, finalUrl));
                if (ok && excludePatterns.length) ok = !excludePatterns.some(p => testPattern(p, finalUrl));

                if (!ok) {
                    pushLog(ctx, 'info', `crawlQueue: skipping page outside include/exclude scope: ${finalUrl}`, {depth});
                    return {ok: true, item, discovered: []};
                }
            }

            // Run per-page actions on the worker page
            const workerPageActions = Array.isArray(action.actions) ? action.actions : [];
            await applyActions(workerPage, workerPageActions, null, 0, workerCtx, null, depth + 1, actionPathPrefix);

            // Discover links (returned to main thread for queue merge)
            let discovered = [];
            if (item.depth < maxDepth && maxLinksPerPage > 0) {
                const hrefs = await collectHrefsFromPage(workerPage, {
                    containerSelector: null,
                    linkSelector: 'a[href]',
                    maxLinks: maxLinksPerPage
                });

                let found = hrefs.map(h => normalizeUrlCandidate(h, item.url)).filter(Boolean);
                found = applyIncludeExclude(found, includePatterns, excludePatterns);

                if (sameOriginOnly && baseOrigin) found = found.filter(u => safeGetOrigin(u) === baseOrigin);

                found = normalizeAndFilterUrls(found, {
                    baseUrl: item.url,
                    sameOriginOnly: false,
                    baseOrigin: null,
                    dedupe: true
                });

                discovered = found;
            }

            return {ok: true, item, discovered};
        } catch (e) {
            const msg = String(e && e.message ? e.message : e);

            // Treat cancellation / teardown as non-fatal
            const isCancelish =
                (e && e._wfCancelled) ||
                /Navigating frame was detached/i.test(msg) ||
                /Execution context was destroyed/i.test(msg) ||
                /Target closed/i.test(msg) ||
                /Session closed/i.test(msg) ||
                /LifecycleWatcher terminated/i.test(msg);

            if (isCancelish) {
                pushLog(ctx, 'info', `crawl page cancelled: ${msg}`, {depth});
                return {ok: false, item, discovered: [], error: msg, cancelled: true};
            }

            // A Skip iteration step matched: the page is done, not
            // failed, and its links are not followed.
            if (e && e._wfSkipIteration) {
                pushLog(ctx, 'info', 'crawl page skipped (Skip iteration)', {depth, url: item && item.url ? item.url : null});
                return {ok: true, item, discovered: [], skipped: true};
            }

            pushLog(ctx, 'error', `crawl page failed: ${msg}`, {depth});
            recordIterationFailure(ctx, {
                iteratorType: 'crawlQueue',
                iteratorLabel: action.label || null,
                iterationIndex: workerIndex,
                iterationOneBased: workerIndex + 1,
                iterationTotal: maxPages,
                error: msg,
                url: item && item.url ? item.url : null,
                crawlDepth: item && typeof item.depth === 'number' ? item.depth : null
            });

            return {ok: false, item, discovered: [], error: msg};
        } finally {
            if (entry) activeCleanup.delete(entry);

            workerCtx._iterVars = prevIter;
            workerCtx.popVarScope();

            // Cleanup worker targets. Both gated by closeWorkerPages (matching
            // runForEachElementConcurrent's equivalent cleanup): a context whose page is
            // kept open must itself stay open too, or the "kept open" page is useless.
            if (closeWorkerPages) {
                try {
                    if (workerPage) await workerPage.close().catch(() => {
                    });
                } catch {
                }

                try {
                    if (worker.workerContext) await worker.workerContext.close().catch(() => {
                    });
                } catch {
                }
            }
        }
    };

    while (q.length || active.size) {
        try {
            ctx.checkCancel?.('crawlQueue loop');
        } catch (e) {
            // Force-stop all active workers immediately
            const cleanups = Array.from(activeCleanup.values());
            for (const fn of cleanups) {
                try { await fn(); } catch {}
            }

            active.clear();
            activeCleanup.clear();

            throw e;
        }

        const elapsedSec = (Date.now() - t0) / 1000;
        if (elapsedSec > maxSeconds) {
            pushLog(ctx, 'warn', `crawl stopped, time budget exceeded (${maxSeconds}s)`, {depth});
            break;
        }

        // Fill worker slots
        while (q.length && active.size < concurrency && visitedSet.size < maxPages) {
            const item = (strategy === 'dfs') ? q.pop() : q.shift();
            if (!item) break;

            if (visitedSet.has(item.url)) continue;
            if (item.depth > maxDepth) continue;

            // include/exclude gate
            let ok = true;
            if (includePatterns.length) ok = includePatterns.some(p => testPattern(p, item.url));
            if (ok && excludePatterns.length) ok = !excludePatterns.some(p => testPattern(p, item.url));
            if (!ok) {
                pushLog(ctx, 'info', `crawlQueue: skipping by include/exclude: ${item.url}`, {depth});
                continue;
            }

            // Mark visited at scheduling time to avoid duplicates across workers
            visitedSet.add(item.url);
            ctx.setVar(visitedVar, Array.from(visitedSet));

            const thisIndex = index++;
            ctx.setVar(queueVar, q.map(x => x.url));

            // Start worker
            const entry = {};

            // Hard watchdog so one stuck worker cannot stall the crawl
            const perItemTimeoutMs = Math.max(
                1000,
                toNumber(action.perItemTimeoutMs, (toNumber(action.timeout, 60000) + 60000))
            );

            const workerPromise = scheduleOne(item, thisIndex, entry);

            // Both racers below must be stopped once the worker itself settles - otherwise
            // (the common case: the worker finishes normally, well before perItemTimeoutMs)
            // they leak: the poll loop spins forever (one per scheduled item, for the life
            // of the process) and the raw setTimeout behind timeoutPromise keeps a handle
            // alive for up to perItemTimeoutMs (2 minutes by default) for no reason.
            // workerSettled/clearTimeout are what let them notice and stop.
            let workerSettled = false;
            let timeoutHandle = null;
            const timeoutPromise = new Promise((resolve) => {
                timeoutHandle = setTimeout(resolve, perItemTimeoutMs);
            });
            workerPromise.then(
                () => { workerSettled = true; clearTimeout(timeoutHandle); },
                () => { workerSettled = true; clearTimeout(timeoutHandle); }
            );

            const watchdog = Promise.race([
                timeoutPromise,
                // if your ctx.race supports abort, this will resolve quickly on cancel:
                (async () => {
                    while (!workerSettled) {
                        try { ctx.checkCancel?.('crawlQueue watchdog'); } catch { return; }
                        await sleep(250);
                    }
                })()
            ]).then(async () => {
                // If worker is still active, force-stop it before failing
                const stop = activeCleanup.get(entry);
                if (stop) {
                    try { await stop(); } catch {}
                }
                throw new Error(`crawlQueue: per-item timeout exceeded (${perItemTimeoutMs}ms) for ${item.url}`);
            });

            entry.p = Promise.race([workerPromise, watchdog])
                .then((res) => ({res, thisIndex, entry}))
                .catch((err) => ({
                    res: {
                        ok: false,
                        item,
                        discovered: [],
                        error: String(err && err.message ? err.message : err),
                        cancelled: !!(err && err._wfCancelled)
                    },
                    thisIndex,
                    entry
                }));

            active.add(entry);

            // Small delay between scheduling bursts if configured
            if (perPageDelayMs) await sleep(perPageDelayMs);
        }

        if (!active.size) break;

        // Wait for the next worker to finish
        const finished = await Promise.race(Array.from(active).map(x => x.p));
        if (finished && finished.entry) active.delete(finished.entry);
        const {res} = finished || {};

        if (!res) continue;

        mergeDiscoveredIntoQueue(res);
    }

    // Drain remaining workers if we broke due to time budget or max pages
    if (active.size) {
        const remaining = Array.from(active);
        for (const entry of remaining) {
            try {
                const finished = await entry.p;
                if (finished && finished.res) mergeDiscoveredIntoQueue(finished.res);
            } catch {
            }
        }
        active.clear();
    }

    ctx._iterVars = prevIter;

    ctx.setVar(queueVar, q.map(x => x.url));
    ctx.setVar(visitedVar, Array.from(visitedSet));
    pushLog(ctx, 'info', `crawl finished: visited ${visitedSet.size}, remaining queue ${q.length}`, {depth});
}

const STEPS = {
    'crawlQueue': stepCrawlQueue
};

module.exports = {STEPS, bindEngine};
