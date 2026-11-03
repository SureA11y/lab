'use strict';

/**
 * Runs surea11y's scan on a Puppeteer page through @surea11y/puppeteer, the
 * binding core publishes for Puppeteer, instead of handing core's
 * runa11yCoreInPage to page.evaluate here.
 *
 * The binding owns what is Puppeteer's: sending the scan into the page, and
 * bringing back an error core threw for input it cannot use as an
 * EngineError that keeps its `code` (INVALID_RUN_ONLY and the rest), where
 * page.evaluate alone keeps only the message.
 *
 * The scan runs with exactly what the lab resolved: the step's scope, its
 * engine options and its rule selection, said through the builder's public
 * setters (withWcag, withBestPractices, withTags, withRules, disableTags,
 * disableRules, includeMode). It was checked against the facade it replaced,
 * on the same live pages and settings: the same findings.
 *
 * The page is scanned as before: the top document only (the binding's
 * frames() stays off), every outcome kept (no reportOnly()), no element
 * handles (no elementRef()). The binding's console lines about what a scan
 * left out are silenced: the lab reports each of them as a notice already.
 *
 * With `screenshots`, the binding also takes a picture of each element the
 * scan flags, right after the scan: each occurrence it considers gets a
 * `screenshot` field, the PNG as a buffer or the reason there is none. The
 * lab stores and shows them itself, so no `dir` is given.
 *
 * The pictures have their own time, apart from the scan's: `budgetMs` from
 * the moment they start, and `signal`, which the runner aborts when it gives
 * up on the scan. Past either, no further picture is started; the element
 * being pictured is still put back as it was, and every element left gets
 * TIME_LIMIT_ERROR as its reason (element-screenshots.js). Otherwise the
 * binding would go on scrolling and drawing over a page the workflow has
 * moved on with.
 *
 * `perRule`, the lab's too, pictures at most that many elements of each
 * check, so the checks core lists first don't take every picture the scan's
 * `max` allows. The binding is handed the result with each check's
 * occurrences cut to them; an element it considered for one check keeps
 * what it got there (its picture, or why there is none) in every other;
 * the rest get `{ skipped: 'rule-limit', max }`. The same for a finding's
 * picture in the state it was made in (`stateScreenshots`, the text
 * spacing): it keeps the one its element got in that state for another
 * check, or is cut with it.
 */

const { A11yCoreBuilder } = require('@surea11y/puppeteer');
const { TIME_LIMIT_ERROR } = require('../element-screenshots');

/**
 * The builder, with its pictures stopped at a deadline or an abort. Only the
 * in-page step that puts the page back (op 'release') still runs then.
 */
class TimedScreenshotsBuilder extends A11yCoreBuilder {
    constructor(opts, { budgetMs = null, signal = null, perRule = null } = {}) {
        super(opts);
        this._shotPerRule = Number.isInteger(perRule) && perRule >= 1 ? perRule : null;
        this._shotBudgetMs = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : null;
        this._shotSignal = signal || null;
        this._shotDeadline = null;
    }

    _shotsStopped() {
        if (this._shotSignal && this._shotSignal.aborted) return true;
        return this._shotDeadline !== null && Date.now() >= this._shotDeadline;
    }

    async _captureScreenshots(result, frame, framePath) {
        // Given up on before the pictures start: none are taken.
        if (this._shotSignal && this._shotSignal.aborted) return result;
        this._shotDeadline = this._shotBudgetMs === null ? null : Date.now() + this._shotBudgetMs;
        if (this._shotPerRule === null || !result || !Array.isArray(result.checksResults)) {
            return super._captureScreenshots(result, frame, framePath);
        }
        const outcomes = this._screenshots.outcomes;
        const outcomeOf = (check, occ) => (typeof occ.occurrenceOutcome === 'string' ? occ.occurrenceOutcome : check.outcome);
        const elementOf = (occ) => JSON.stringify([occ.shadowHostSelectors || [], occ.selector]);
        const cut = [];
        const trimmed = {
            ...result,
            checksResults: result.checksResults.map((check) => {
                if (!check || !Array.isArray(check.occurrences)) return check;
                const kept = new Set();
                const occurrences = check.occurrences.filter((occ) => {
                    if (!occ || typeof occ !== 'object' || !outcomes.includes(outcomeOf(check, occ))) return true;
                    // Nothing to picture: the binding says so, and it costs nothing.
                    if (typeof occ.selector !== 'string' || !occ.selector) return true;
                    const element = elementOf(occ);
                    if (kept.has(element)) return true;
                    if (kept.size < this._shotPerRule) { kept.add(element); return true; }
                    cut.push(occ);
                    return false;
                });
                return { ...check, occurrences };
            }),
        };
        await super._captureScreenshots(trimmed, frame, framePath);
        // The same occurrence objects: the pictures are on `result` already.
        const stateOf = (occ) => {
            const state = occ && occ.data && occ.data.details && occ.data.details.evidenceState;
            return typeof state === 'string' && state ? state : null;
        };
        const pictured = new Map();
        const picturedInState = new Map();
        for (const check of trimmed.checksResults) {
            for (const occ of (check && check.occurrences) || []) {
                // What the element got for another check: its picture, or why there is none.
                if (occ && occ.screenshot && occ.selector) pictured.set(elementOf(occ), occ.screenshot);
                if (occ && occ.selector && Array.isArray(occ.stateScreenshots)) {
                    for (const entry of occ.stateScreenshots) {
                        if (entry && entry.state) picturedInState.set(JSON.stringify([elementOf(occ), entry.state]), entry);
                    }
                }
            }
        }
        // binding-base 1.7.0 and later picture a finding in its state, and
        // say so in the options it filled in; an older one takes no such
        // picture, so none is said to be cut.
        const statesOn = this._screenshots.states === true;
        for (const occ of cut) {
            occ.screenshot = pictured.get(elementOf(occ)) || { skipped: 'rule-limit', max: this._shotPerRule };
            const state = statesOn ? stateOf(occ) : null;
            if (state) {
                occ.stateScreenshots = [picturedInState.get(JSON.stringify([elementOf(occ), state]))
                    || { state, skipped: 'rule-limit', max: this._shotPerRule }];
            }
        }
        return result;
    }

    _evaluateInFrame(frame, fn, args) {
        const op = Array.isArray(args) && args[0] && typeof args[0] === 'object' ? args[0].op : null;
        if (op !== 'release' && this._shotsStopped()) return Promise.reject(new Error(TIME_LIMIT_ERROR));
        return super._evaluateInFrame(frame, fn, args);
    }

    _captureBox(box, view) {
        if (this._shotsStopped()) return Promise.reject(new Error(TIME_LIMIT_ERROR));
        return super._captureBox(box, view);
    }
}

/**
 * Core's native result for one scan of `page`.
 * @param {import('puppeteer').Page} page
 * @param {{ pageUrl?: string|null, contextSelector?: string|null,
 *   engineOptions?: object, runOnly?: object|null, packs?: object[],
 *   screenshots?: object|null }} args
 *   What runa11yCoreInPage takes: the URL the result reports, the scope,
 *   core's engine options and its runOnly; the packs (from
 *   @surea11y/core/pack) the binding registers in the page and names in
 *   engineOptions.packs; and the binding's screenshots
 *   options, or null for none, which may also carry the lab's `budgetMs`,
 *   `signal` and `perRule` for them. A selection or screenshots option the builder
 *   refuses (an invalid WCAG target) rejects, as core's own errors do.
 */
async function scanPage(page, { pageUrl = null, contextSelector = null, engineOptions = {}, runOnly = null, packs = [], screenshots = null } = {}) {
    // Without a URL the builder asks page.url() again, unguarded; the lab
    // could not read it, so core reports the document's own, as before.
    const scanned = pageUrl ? page : withoutUrl(page);
    const { budgetMs = null, signal = null, perRule = null, ...shotOptions } = screenshots || {};
    const builder = new TimedScreenshotsBuilder({ page: scanned, url: pageUrl || undefined }, { budgetMs, signal, perRule });
    if (contextSelector) builder.include(contextSelector);
    builder.options(engineOptions);
    if (Array.isArray(packs) && packs.length) builder.withPacks(packs);
    applySelection(builder, runOnly);
    builder.logger(() => {});
    if (screenshots) builder.screenshots(shotOptions);
    return builder.analyze();
}

/**
 * Pictures of the elements a finished scan flagged, taken now: what
 * scanPage() does with `screenshots`, for a result the caller has chosen,
 * so a scan that is replaced by another (a missing standard's fallback,
 * a11y-labs-engine.js) takes none. The binding's own step does it (its
 * _captureScreenshots(), which every binding calls after its scan), with the
 * same time limit. Changes `result` in place and resolves to it.
 * @param {import('puppeteer').Page} page the page the result came from, unchanged since
 * @param {object} result core's native result for the top document
 * @param {object|null} screenshots as scanPage() takes them; null takes none
 */
async function captureScreenshots(page, result, screenshots) {
    if (!screenshots || !result || typeof result !== 'object') return result;
    const { budgetMs = null, signal = null, perRule = null, ...shotOptions } = screenshots;
    const builder = new TimedScreenshotsBuilder({ page }, { budgetMs, signal, perRule });
    builder.screenshots(shotOptions);
    return builder._captureScreenshots(result, page, []);
}

/**
 * The lab's runOnly through the builder's setters. An empty list is left
 * out: the setters refuse a blank value, and there is nothing to send.
 */
function applySelection(builder, runOnly) {
    if (!runOnly || typeof runOnly !== 'object') return builder;
    const list = (value) => (Array.isArray(value) ? value : value ? [value] : [])
        .filter((v) => typeof v === 'string' && v.trim());
    if (runOnly.wcag) builder.withWcag(runOnly.wcag.version, runOnly.wcag.level);
    if (runOnly.bestPractices === true) builder.withBestPractices();
    if (list(runOnly.tags).length) builder.withTags(list(runOnly.tags));
    if (list(runOnly.includeRuleIds).length) builder.withRules(list(runOnly.includeRuleIds));
    if (list(runOnly.excludeTags).length) builder.disableTags(list(runOnly.excludeTags));
    if (list(runOnly.excludeRuleIds).length) builder.disableRules(list(runOnly.excludeRuleIds));
    if (runOnly.includeMode === 'and' || runOnly.includeMode === 'or') builder.includeMode(runOnly.includeMode);
    return builder;
}

/**
 * The page, with url() answering null so the builder passes core no URL.
 * Every other method runs on the page itself (Puppeteer's use private
 * fields, so they need it as `this`).
 */
function withoutUrl(page) {
    return new Proxy(page, {
        get(target, key) {
            if (key === 'url') return () => null;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

// Core's opt-in hooks (core 1.14), each installed by the binding with
// evaluateOnNewDocument, so it runs before the page's scripts in every frame
// and after each navigation:
//  - internals: what web components set through a private ElementInternals
//    (names, states, roles), which no page script can read back;
//  - listener: the click, key, focus and mouse listeners the page adds from
//    script, so the keyboard rules judge them;
//  - liveRegion: what the page's live regions are given, for the
//    live-region-announcements rule.
const CORE_HOOKS = Object.freeze({
    internals: 'installInternalsHook',
    listener: 'installListenerHook',
    liveRegion: 'installLiveRegionHook',
});

/**
 * Which hooks a setting asks for: unset or 'all' for every one, 'none' (or
 * off, false, 0) for none, else a comma-separated list of their names
 * (internals, listener, liveRegion; any case, live-region too). An unknown
 * name is left out.
 * @param {string|null|undefined} value
 * @returns {string[]}
 */
function coreHooksFrom(value) {
    if (value == null) return Object.keys(CORE_HOOKS);
    const s = String(value).trim().toLowerCase();
    if (!s || s === 'all' || s === 'on' || s === 'true' || s === '1') return Object.keys(CORE_HOOKS);
    if (['none', 'off', 'false', '0'].includes(s)) return [];
    const byName = new Map(Object.keys(CORE_HOOKS).map((k) => [k.toLowerCase(), k]));
    byName.set('live-region', 'liveRegion');
    const out = [];
    for (const part of s.split(',').map((p) => p.trim())) {
        const name = byName.get(part);
        if (name && !out.includes(name)) out.push(name);
    }
    return out;
}

/**
 * Installs core's hooks in `page`, before its first navigation. One that
 * can't be installed (a page without evaluateOnNewDocument) is left out;
 * the scan then says what it judged without it.
 * @param {import('puppeteer').Page} page
 * @param {string[]} hooks names from CORE_HOOKS
 * @returns {Promise<string[]>} the hooks installed
 */
async function installCoreHooks(page, hooks = Object.keys(CORE_HOOKS)) {
    const installed = [];
    for (const name of hooks) {
        const method = CORE_HOOKS[name];
        if (!method) continue;
        try {
            await A11yCoreBuilder[method](page);
            installed.push(name);
        } catch {
            // left out: the scan's notes say what it judged without it
        }
    }
    return installed;
}

// ---- frames ----

// How many sub-frames are scanned at once, as the binding's frames(true) does.
const FRAME_CONCURRENCY = 4;
// At most this many sub-frames are scanned; the rest are named as not scanned.
const MAX_FRAMES = 100;
// How long one frame may take: a frame whose page never answers has no
// document to scan, and waiting on it held the whole scan for minutes.
const FRAME_TIMEOUT_MS = 10000;

/** Maps `items` through async `fn`, at most `limit` at a time, keeping their order. */
async function mapInBatches(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next;
            next += 1;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

/**
 * The selectors of the iframe elements that lead from the top document to
 * `frame`, outermost first: one per level, each as it reads in its own
 * document. An occurrence in the frame carries them (frameSelectors), so the
 * same element in two frames of one page is two elements.
 */
async function frameSelectorsOf(frame) {
    const chain = [];
    for (let f = frame; f && f.parentFrame && f.parentFrame(); f = f.parentFrame()) {
        const handle = await f.frameElement();
        if (!handle) return null;
        const selector = await handle.evaluate((el) => {
            const parts = [];
            for (let node = el; node && node.nodeType === 1 && node !== node.ownerDocument.documentElement; node = node.parentElement) {
                if (node.id && node.ownerDocument.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
                    parts.unshift(`#${CSS.escape(node.id)}`);
                    break;
                }
                let i = 1;
                for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.localName === node.localName) i += 1;
                parts.unshift(`${node.localName}:nth-of-type(${i})`);
            }
            return parts.join(' > ');
        });
        await handle.dispose().catch(() => {});
        chain.unshift(selector);
    }
    return chain;
}

/**
 * Why a frame is left out of the scan, or null to scan it. Its <iframe> is
 * read in its parent document, as core's own scan across frames reads it
 * (src/core/frame-scan.js), with two cases more:
 * - 'hidden': the page does not show it (display:none, the hidden attribute,
 *   a closed <details>, content-visibility:hidden or visibility:hidden),
 *   unless engineOptions.includeHiddenElements;
 * - 'excluded': it, or an element around it, matches engineOptions'
 *   excludeSelectors (the scan's Exclude);
 * - 'aria-hidden': it, or an element around it, has aria-hidden="true", so
 *   its content is out of the accessibility tree;
 * - 'empty': its document has nothing in it.
 * A frame whose element or document can't be read is scanned.
 */
async function frameSkipReason(frame, engineOptions = {}) {
    let handle = null;
    try {
        handle = await frame.frameElement();
        if (handle) {
            const reason = await handle.evaluate((el, { excludeSelectors, includeHidden }) => {
                if (!includeHidden && typeof el.checkVisibility === 'function'
                    && !el.checkVisibility({ visibilityProperty: true })) return 'hidden';
                for (const selector of excludeSelectors) {
                    try { if (el.closest(selector)) return 'excluded'; } catch { /* a selector the page can't parse excludes nothing */ }
                }
                for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
                    const value = node.getAttribute('aria-hidden');
                    if (value != null && value.trim().toLowerCase() === 'true') return 'aria-hidden';
                }
                return null;
            }, {
                excludeSelectors: (Array.isArray(engineOptions.excludeSelectors) ? engineOptions.excludeSelectors : [])
                    .map(String).map((x) => x.trim()).filter(Boolean),
                includeHidden: engineOptions.includeHiddenElements === true,
            });
            if (reason) return reason;
        }
        const empty = await frame.evaluate(() => {
            const body = document.body;
            if (!body || body.localName !== 'body') return false;
            return !body.children.length && !body.textContent.trim();
        });
        return empty ? 'empty' : null;
    } catch {
        return null;
    } finally {
        if (handle) await handle.dispose().catch(() => {});
    }
}

/**
 * Core's native result for each sub-frame of `page`, scanned whole (the
 * scan's Include selectors are the top document's), a few at a time:
 * [{ url, frameSelectors, result }], [{ url, skipped }] for a frame left out
 * (frameSkipReason), or [{ url, error }] for a frame that could not be
 * scanned (detached, sandboxed, timed out). Element pictures
 * are the top page's only: the lab pictures the page it shows.
 */
async function scanFrames(page, { engineOptions = {}, runOnly = null, packs = [], signal = null } = {}) {
    const main = page.mainFrame();
    const frames = page.frames().filter((f) => f !== main && !(typeof f.detached === 'boolean' && f.detached));
    const scanned = frames.slice(0, MAX_FRAMES);
    // Why each frame is left out, if it is (frameSkipReason), a frame inside
    // one left out with it.
    const reasons = new Map();
    const skipReason = (frame) => {
        if (!reasons.has(frame)) {
            reasons.set(frame, (async () => {
                const parent = frame.parentFrame && frame.parentFrame();
                if (parent && parent !== main) {
                    const above = await skipReason(parent);
                    if (above) return above;
                }
                return frameSkipReason(frame, engineOptions);
            })());
        }
        return reasons.get(frame);
    };
    const results = await mapInBatches(scanned, FRAME_CONCURRENCY, async (frame) => {
        const url = typeof frame.url === 'function' ? frame.url() : null;
        if (signal && signal.aborted) return { url, error: 'the scan was given up on' };
        const skipped = await skipReason(frame);
        if (skipped) return { url, skipped };
        let timer = null;
        try {
            const scan = (async () => {
                const frameSelectors = await frameSelectorsOf(frame);
                const builder = new A11yCoreBuilder({ page: frame, url: url || undefined });
                builder.options(engineOptions);
                if (Array.isArray(packs) && packs.length) builder.withPacks(packs);
                applySelection(builder, runOnly);
                builder.logger(() => {});
                return { url, frameSelectors, result: await builder.analyze() };
            })();
            const late = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`it did not answer within ${FRAME_TIMEOUT_MS / 1000} s`)), FRAME_TIMEOUT_MS);
            });
            scan.catch(() => {});
            return await Promise.race([scan, late]);
        } catch (e) {
            return { url, error: String((e && e.message) || e) };
        } finally {
            clearTimeout(timer);
        }
    });
    for (const frame of frames.slice(MAX_FRAMES)) {
        results.push({ url: typeof frame.url === 'function' ? frame.url() : null, error: `more than ${MAX_FRAMES} frames on the page` });
    }
    return results;
}

const OUTCOME_RANK = { fail: 4, failed: 4, cantTell: 3, pass: 2, passed: 2, notApplicable: 1, inapplicable: 1 };

/** The worse of two outcomes: a rule fails on the page if it fails in any of its frames. */
function worseOutcome(a, b) {
    return (OUTCOME_RANK[b] || 0) > (OUTCOME_RANK[a] || 0) ? b : a;
}

/**
 * The top document's result with each scanned frame's findings in it: per
 * rule (checksResults and rulesResults alike), the frame's occurrences added,
 * each naming its frame (frameUrl, frameSelectors), and the rule's outcome
 * the worse of the two. A rule's counts of a capped list (contrast's
 * elementCount and reportedCount) are added up. Changes `top` in place.
 */
function mergeFrameResults(top, frameResults) {
    if (!top || typeof top !== 'object') return top;
    for (const f of frameResults || []) {
        if (!f || !f.result) continue;
        for (const key of ['checksResults', 'rulesResults']) {
            const into = Array.isArray(top[key]) ? top[key] : (top[key] = []);
            const byId = new Map(into.map((r) => [r && r.ruleId, r]));
            for (const r of f.result[key] || []) {
                if (!r || !r.ruleId) continue;
                const occurrences = (Array.isArray(r.occurrences) ? r.occurrences : [])
                    .map((o) => ({ ...o, frameUrl: f.url, frameSelectors: f.frameSelectors || null }));
                const held = byId.get(r.ruleId);
                if (!held) {
                    const copy = { ...r, occurrences };
                    into.push(copy);
                    byId.set(r.ruleId, copy);
                    continue;
                }
                held.occurrences = [...(Array.isArray(held.occurrences) ? held.occurrences : []), ...occurrences];
                held.outcome = worseOutcome(held.outcome, r.outcome);
                if (held.outcomeNormalized || r.outcomeNormalized) held.outcomeNormalized = worseOutcome(held.outcomeNormalized, r.outcomeNormalized);
                const a = held.data && held.data.details;
                const b = r.data && r.data.details;
                // A rollup's checks, each with the worse of its outcomes: the
                // lab reads a WCAG criterion's outcome from them.
                if (a && b && Array.isArray(a.contributors) && Array.isArray(b.contributors)) {
                    const contributors = a.contributors.map((c) => ({ ...c }));
                    const byTest = new Map(contributors.map((c) => [c && c.testId, c]));
                    for (const c of b.contributors) {
                        const mine = c && byTest.get(c.testId);
                        if (mine) mine.outcome = worseOutcome(mine.outcome, c.outcome);
                        else if (c) contributors.push({ ...c });
                    }
                    held.data = { ...held.data, details: { ...a, contributors } };
                }
                if (a && b && Number.isFinite(a.elementCount) && Number.isFinite(b.elementCount)) {
                    held.data = { ...held.data, details: { ...a, elementCount: a.elementCount + b.elementCount, reportedCount: (a.reportedCount || 0) + (b.reportedCount || 0), truncated: !!(a.truncated || b.truncated) } };
                }
            }
        }
    }
    return top;
}

module.exports = { scanPage, scanFrames, frameSkipReason, mergeFrameResults, captureScreenshots, applySelection, CORE_HOOKS, coreHooksFrom, installCoreHooks };
