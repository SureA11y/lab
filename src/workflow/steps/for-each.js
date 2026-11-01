'use strict';

// The For each element step: the elements it finds, and its steps run on each
// of them, one after another or on several pages at once.

const {
    _isVisible,
    clearScopeAttr,
    rewriteCtxTokenShallow,
    setScopeAttr,
    waitForOneDeep
} = require('../engine/deep-query');
const {clampConcurrency, formatActionPrefix} = require('../engine/step-helpers');
const {createChildContext} = require('../engine/context');
const {createCrawlWorkerTarget} = require('../engine/worker-pages');
const {
    isContextDestroyedError,
    normalizeWaitUntil,
    safePageUrl,
    startPossibleNavigationWatch,
    waitForPossibleNavigation,
    waitForRenderSettle,
    waitForSel,
    withNavResilience
} = require('../engine/nav');
const {isDisabled, isNonEmptyString, sleep, toNumber} = require('../engine/utils');
const {postStepDelay} = require('../engine/post-step-delay');
const {pushLog} = require('../engine/log');
const {recordIterationFailure} = require('../engine/iteration-failures');
const {rewriteSelectorsWithCtx} = require('../engine/vars');

// The engine's own functions these steps call, to run the steps inside them;
// set by the engine when it loads (it requires this module first).
let applyActions, runActionAction;

function bindEngine(engine) {
    ({applyActions, runActionAction} = engine);
}

async function stepForEachElement(page, action, ctx, _localVars, depth, actionPathPrefix, _selector, timeout) {
    // Prefer action.targetSelector, fallback to old action.context for backward compatibility.
    const sel = isNonEmptyString(action.targetSelector)
        ? action.targetSelector.trim()
        : (isNonEmptyString(action.context) ? action.context.trim() : '');
    if (!sel) return;

    const reverse = action.reverse === true;
    const limit = (typeof action.limit === 'number' && action.limit > 0) ? action.limit : 0;
    const nested = Array.isArray(action.actions) ? action.actions : [];
    const iterSetupActions = Array.isArray(action.iterSetupActions)
        ? action.iterSetupActions.filter(s => !isDisabled(s))
        : null;
    const continueOnIterationError = action.continueOnIterationError === true;
    const maxIterationErrors = Number.isFinite(action.maxIterationErrors) ? action.maxIterationErrors : Infinity;
    let iterationErrors = 0;

    const preparedIterSetup = iterSetupActions && iterSetupActions.length
        ? iterSetupActions
        : null;
    const dynamic = action.dynamic === true;
    const dedupeBy = (action.dedupeBy === 'text') ? 'text' : 'href';
    const onlyVisible = action.onlyVisible === true;

    let staticTotal = null;
    if (!dynamic) {
        try {
            const initial = await page.$$(sel);
            staticTotal = initial.length;
            for (const h of initial) await h.dispose().catch(() => {});
        } catch {}
    }

    // Optional concurrency (crawlQueue-style)
    // Within the field's 1 to 8, for a value only known now (a {var:…}).
    const concurrency = clampConcurrency(action.concurrency);
    const isolation = (action.isolation === 'context') ? 'context' : 'page';
    const closeWorkerPages = action.closeWorkerPages !== false; // default true
    const maxSeconds = Number.isFinite(action.maxSeconds) ? action.maxSeconds : null;
    const perPageDelayMs = Math.max(0, Math.floor(toNumber(action.perPageDelayMs, 0)));

    if (concurrency > 1) {
        // v1 safety: concurrent mode requires a stable target list
        if (dynamic) {
            throw new Error("forEachElement: concurrency > 1 does not support dynamic=true yet.");
        }

        const plan = await buildForEachElementPlan(page, sel, {
            reverse,
            limit,
            dedupeBy,
            timeout,
            onlyVisible
        });

        await runForEachElementConcurrent({
            action,
            parentCtx: ctx,
            mainPage: page,
            sel,
            plan,
            concurrency,
            isolation,
            closeWorkerPages,
            maxSeconds,
            perPageDelayMs,
            timeout,
            depth,
            actionPathPrefix
        });

        return;
    }

    // staticTotal counts every match; `limit` is what actually caps the
    // iterations, so the total we report - and that a step counter sizes
    // the loop from - is the smaller of the two.
    const effectiveTotal = (staticTotal == null)
        ? null
        : (limit ? Math.min(staticTotal, limit) : staticTotal);

    const visited = new Set();
    let processed = 0;
    let loopStarted = false;

    const getKey = async (handle) => {
        return _forEachGetKey(handle, dedupeBy);
    };

    while (true) {
        // 1) Iteration setup actions (not element-scoped)
        if (preparedIterSetup && preparedIterSetup.length) {
            try {
                await applyActions(page, preparedIterSetup, null, 0, ctx, Object.create(null), depth + 1, actionPathPrefix);
            } catch (err) {
                if (err && err._wfSkipIteration) {
                    // Important: do not advance processed here, iterSetupActions happens before selecting an element
                    pushLog(ctx, 'info', `Iteration skipped (iterSetupActions) (${processed}/${staticTotal ?? '?'})`);
                    await postStepDelay(ctx);
                    continue;
                }
                throw err;
            }
        }

        // Stop if nothing matches anymore. Before the first item the
        // targets may still be rendering, so that check gets the whole
        // timeout; once the loop has run, a selector that matches
        // nothing (say, "panels not yet open" after opening them all)
        // means the work is done, and waiting the timeout out again
        // would only add it to every loop's end.
        const hasHandle = await waitForOneDeep(page, sel, {
            timeout: loopStarted ? Math.min(timeout, LOOP_END_CHECK_MS) : timeout,
            visible: false
        }).catch(() => null);
        loopStarted = true;
        const has = !!hasHandle;
        try { if (hasHandle) await hasHandle.dispose(); } catch {}
        if (!has) break;

        let handles = await page.$$(sel);
        if (!handles.length) break;
        if (reverse) handles = handles.slice().reverse();

        let candidate = null;

        if (dynamic) {
            for (const h of handles) {
                if (onlyVisible) {
                    const visible = await _isVisible(h);
                    if (!visible) {
                        await h.dispose().catch(() => {});
                        continue;
                    }
                }

                const key = await getKey(h);
                if (key && !visited.has(key)) {
                    candidate = {h, key};
                    break;
                }

                await h.dispose().catch(() => {});
            }
            if (!candidate) break;
        } else {
            const h = handles[processed] || null;
            if (!h) break;

            if (onlyVisible) {
                const visible = await _isVisible(h);
                if (!visible) {
                    await h.dispose().catch(() => {});
                    processed += 1;
                    if (limit && processed >= limit) break;
                    continue;
                }
            }

            const key = await getKey(h);
            candidate = {h, key};

            // Static lists in SPAs can reorder after each interaction.
            // If the index now points to an already-visited item, pick
            // the next unvisited candidate from the current snapshot.
            if (candidate.key && visited.has(candidate.key)) {
                let replacement = null;
                for (let i = 0; i < handles.length; i++) {
                    const hh = handles[i];
                    if (hh === h) continue;
                    if (onlyVisible) {
                        const visible = await _isVisible(hh);
                        if (!visible) continue;
                    }
                    const kk = await getKey(hh);
                    if (!kk || visited.has(kk)) continue;
                    replacement = {h: hh, key: kk};
                    break;
                }
                if (replacement) {
                    await h.dispose().catch(() => {});
                    candidate = replacement;
                }
            }
        }

        const keepHandle = candidate?.h || null;

        // Dispose any remaining handles we didn't pick to avoid leaks
        try {
            for (const h of handles) {
                if (keepHandle && h === keepHandle) continue;
                await h.dispose().catch(() => {});
            }
        } catch {}

        if (candidate.key) visited.add(candidate.key);

        // 2) Scope the chosen element
        let {scopeId, scopeSel} = await setScopeAttr(page, candidate.h);

        // Ensure the scoped element still exists in DOM (SPA rerenders can detach it
        // right after scoping) - if it's gone, the reacquire-or-skip logic below handles
        // it gracefully, so there's no separate hard-fail check here.
        let scopePresent = await page.$(scopeSel).catch(() => null);
        if (scopePresent) {
            await scopePresent.dispose().catch(() => {});
        } else {
            // Try to reacquire the candidate and re-scope once
            // We use the already-computed candidate.key (href/text) to match the right element.
            pushLog(ctx, 'warning', `Scoped element disappeared, reacquiring once: ${scopeSel}`, { depth });

            // Refresh handles and pick the one matching candidate.key (or fallback to same index)
            let fresh = await page.$$(sel);
            if (reverse) fresh = fresh.slice().reverse();

            let replacement = null;

            if (candidate.key) {
                for (const h of fresh) {
                    if (onlyVisible) {
                        const visible = await _isVisible(h);
                        if (!visible) { await h.dispose().catch(() => {}); continue; }
                    }
                    const k = await getKey(h);
                    if (k && k === candidate.key) { replacement = h; break; }
                    await h.dispose().catch(() => {});
                }
            } else {
                // No key available, fallback to index
                replacement = fresh[processed] || null;
                // Dispose others to avoid leaks
                for (let i = 0; i < fresh.length; i++) {
                    if (fresh[i] !== replacement) await fresh[i].dispose().catch(() => {});
                }
            }

            if (!replacement) {
                // Nothing to scope anymore, treat as "skip iteration"
                await clearScopeAttr(page, scopeId).catch(() => {});
                processed += 1;
                if (limit && processed >= limit) break;
                await postStepDelay(ctx);
                continue;
            }

            // Replace candidate handle, re-scope
            try { if (candidate.h) await candidate.h.dispose().catch(() => {}); } catch {}
            candidate.h = replacement;

            const rescoped = await setScopeAttr(page, candidate.h);
            // IMPORTANT: use the new scopeId/scopeSel from now on
            await clearScopeAttr(page, scopeId).catch(() => {}); // clear the old (best effort)
            scopeId = rescoped.scopeId;
            scopeSel = rescoped.scopeSel;
        }

        const loopVars = Object.create(null);

        // 3) PreActions are element-scoped (run before main nested actions)
        const preActions = Array.isArray(action.preActions) ? action.preActions.filter(s => !isDisabled(s)) : null;
        const preparedPre = (preActions && preActions.length)
            ? preActions.map(s => rewriteCtxTokenShallow(s, scopeSel))
            : null;

        // 4) Main nested actions are element-scoped
        const nestedFiltered = nested.filter(s => !isDisabled(s));
        const prepared = nestedFiltered.map(s => rewriteCtxTokenShallow(s, scopeSel));

        const previousIter = ctx._iterVars;
        ctx._iterVars = {index: processed, total: staticTotal};

        // per-iteration lexical scope
        ctx.pushVarScope({
            index: processed,
            oneBased: processed + 1,
            total: staticTotal
        });

        const actionPrefix = formatActionPrefix(actionPathPrefix);
        pushLog(ctx, 'info', `${actionPrefix}forEachElement item ${processed + 1}/${effectiveTotal ?? '?'}`, {
            depth,
            actionPath: actionPrefix.trim().replace(/^Action\s+/, ''),
            stepEvent: 'loop-iteration',
            loopType: 'forEachElement',
            index: processed,
            total: effectiveTotal
        });

        try {
            if (preparedPre && preparedPre.length) {
                try {
                    await applyActions(page, preparedPre, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
                } catch (err) {
                    if (err && err._wfSkipIteration) {
                        await clearScopeAttr(page, scopeId);

                        processed += 1;
                        if (limit && processed >= limit) break;

                        pushLog(ctx, 'info', `Iteration skipped (preActions) (${processed}/${staticTotal ?? '?'})`);
                        await postStepDelay(ctx);
                        continue;
                    }
                    throw err;
                }
            }

            try {
                await applyActions(page, prepared, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
            } catch (err) {
                if (err && err._wfSkipIteration) {
                    await clearScopeAttr(page, scopeId);

                    processed += 1;
                    if (limit && processed >= limit) break;

                    pushLog(ctx, 'info', `Iteration skipped (${processed}/${staticTotal ?? '?'})`);
                    await postStepDelay(ctx);
                    continue;
                }

                // retry once if the SPA swapped context during nested actions
                if (isContextDestroyedError(err)) {
                    pushLog(ctx, 'warning', 'Context swapped during iteration, retrying nested actions once');
                    await withNavResilience(
                        page,
                        () => applyActions(page, prepared, null, 0, ctx, loopVars, depth + 1, actionPathPrefix),
                        {retries: 1, afterNavWait: 'domcontentloaded', timeout}
                    );
                } else {
                    throw err;
                }
            } finally {
                ctx._iterVars = previousIter;
            }

            await clearScopeAttr(page, scopeId);

            processed += 1;
            if (limit && processed >= limit) break;
            await postStepDelay(ctx);

        } catch (err) {
            if (err && err._wfCancelled) throw err;

            if (err && err._wfSkipIteration) {
                processed += 1;
                if (limit && processed >= limit) break;
                await postStepDelay(ctx);
                continue;
            }

            iterationErrors += 1;

            const msg = String(err && err.message ? err.message : err);

            recordIterationFailure(ctx, {
                iteratorType: 'forEachElement',
                iteratorLabel: action.label || null,
                iterationIndex: processed,
                iterationOneBased: processed + 1,
                iterationTotal: staticTotal ?? null,
                error: msg,
                url: safePageUrl(page) || null
            });

            pushLog(ctx, 'error', `forEachElement iteration ${processed + 1}/${staticTotal ?? '?'} failed, continuing: ${msg}`, {depth});

            // Best effort cleanup and recovery for next iteration
            try {
                await clearScopeAttr(page, scopeId);
            } catch {}

            if (!continueOnIterationError) {
                err.action = action;
                throw err;
            }

            if (iterationErrors >= maxIterationErrors) {
                throw new Error(`forEachElement stopped after ${iterationErrors} iteration errors`);
            }

            processed += 1;
            if (limit && processed >= limit) break;
            await postStepDelay(ctx);
            continue;

        } finally {
            // Ensure we don't leak the element handle for this iteration
            try {
                if (candidate && candidate.h) await candidate.h.dispose();
            } catch {}
            if (candidate) candidate.h = null;

            // Always restore per-iteration scope
            ctx.popVarScope();
        }
    }
}

/**
 * forEachElement concurrency helpers
 * - Build a stable ordered plan (main page only)
 * - Resolve the corresponding element on each worker page
 * - Run one iteration using the same semantics as sequential mode
 */

async function _forEachGetKey(handle, dedupeBy) {
    try {
        if (dedupeBy === 'text') {
            return await handle.evaluate(el => (el.textContent || '').replace(/\s+/g, ' ').trim());
        }
        return await handle.evaluate(el => {
            const href = (el.getAttribute && el.getAttribute('href')) || el.href || '';
            const hrefText = String(href || '').trim();
            if (hrefText) return hrefText;
            // Fallback for non-link targets (e.g. menu options in SPAs) so
            // dedupe remains stable even when href is absent.
            return (el.textContent || '').replace(/\s+/g, ' ').trim();
        });
    } catch {
        return '';
    }
}

async function buildForEachElementPlan(page, sel, {reverse, limit, dedupeBy, timeout, onlyVisible}) {
    const handles = await page.$$(sel);
    if (!handles.length) return [];

    const ordered = reverse ? handles.slice().reverse() : handles;
    const plan = [];
    const visited = new Set();

    try {
        for (let i = 0; i < ordered.length; i++) {
            if (limit && plan.length >= limit) break;

            const h = ordered[i];

            if (onlyVisible) {
                const visible = await _isVisible(h);
                if (!visible) continue;
            }

            const key = await _forEachGetKey(h, dedupeBy);

            if (key) {
                if (visited.has(key)) continue;
                visited.add(key);
            }

            // Store a fallback index for when key is empty or unstable.
            plan.push({index: i, key: key || ''});
        }
    } finally {
        for (const h of handles) {
            try {
                await h.dispose();
            } catch {
            }
        }
    }

    return plan;
}

async function _forEachFindHandleForPlanItem(page, sel, planItem, { reverse, dedupeBy, onlyVisible }) {
    let handles = await page.$$(sel);
    if (!handles.length) return null;

    // IMPORTANT:
    // The plan indices are already based on the order used in buildForEachElementPlan.
    // Do NOT reverse here, or you will reverse twice.
    // Keep "reverse" in the signature for API compatibility, but ignore it.

    let chosen = null;

    try {
        // 1) Prefer stable key match when available
        if (planItem && planItem.key) {
            for (const h of handles) {
                if (onlyVisible) {
                    const visible = await _isVisible(h);
                    if (!visible) continue;
                }

                const key = await _forEachGetKey(h, dedupeBy);
                if (key && key === planItem.key) {
                    chosen = h;
                    break;
                }
            }
        }

        // 2) Fallback: resolve by index, but if onlyVisible, index must be among visible elements
        if (!chosen) {
            if (onlyVisible) {
                let visibleIndex = -1;
                for (const h of handles) {
                    const visible = await _isVisible(h);
                    if (!visible) continue;
                    visibleIndex += 1;
                    if (visibleIndex === planItem.index) {
                        chosen = h;
                        break;
                    }
                }
            } else {
                chosen = handles[planItem.index] || null;
            }
        }

        // Dispose all non-chosen handles to avoid leaks
        for (const h of handles) {
            if (chosen && h === chosen) continue;
            try { await h.dispose(); } catch {}
        }

        return chosen;
    } catch {
        for (const h of handles) {
            try { await h.dispose(); } catch {}
        }
        return null;
    }
}

async function runForEachElementIterationOnPage({
                                                    page,
                                                    ctx,
                                                    action,
                                                    candidateHandle,
                                                    iterationIndex,
                                                    iterationTotal,
                                                    timeout,
                                                    depth,
                                                    actionPathPrefix
                                                }) {
    const nested = Array.isArray(action.actions) ? action.actions : [];

    const waitForSelectorSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    const waitVisible = action.waitVisible !== false; // default true
    const waitTimeout = toNumber(action.waitTimeout, timeout);

    const {scopeId, scopeSel} = await setScopeAttr(page, candidateHandle);

    // Deterministic ordering metadata for scans/screenshots within this iteration
    const _prevIterationIndex = ctx._iterationIndex;
    const _prevScanCounter = ctx._scanCounter;
    const _prevArtifactCounter = ctx._artifactCounter;
    const _prevScanStride = ctx._scanStride;

    ctx._iterationIndex = iterationIndex;
    ctx._scanCounter = 0;
    ctx._artifactCounter = 0;
    // scanStride is only meaningful in crawlQueue, reset it for forEachElement iterations
    ctx._scanStride = null;

    const loopVars = Object.create(null);
    const nestedFiltered = nested.filter(s => !isDisabled(s));
    const prepared = nestedFiltered.map(s => rewriteSelectorsWithCtx(s, scopeSel));

    const previousIter = ctx._iterVars;
    ctx._iterVars = {index: iterationIndex, total: iterationTotal};

    ctx.pushVarScope({
        index: iterationIndex,
        oneBased: iterationIndex + 1,
        total: iterationTotal
    });

    const actionPrefix = formatActionPrefix(actionPathPrefix);
    pushLog(ctx, 'info', `${actionPrefix}forEachElement item ${iterationIndex + 1}/${iterationTotal ?? '?'}`, {
        depth,
        actionPath: actionPrefix.trim().replace(/^Action\s+/, ''),
        stepEvent: 'loop-iteration',
        loopType: 'forEachElement',
        index: iterationIndex,
        total: (iterationTotal == null ? null : iterationTotal)
    });

    const preActions = Array.isArray(action.preActions) ? action.preActions.filter(s => !isDisabled(s)) : null;
    const preparedPre = preActions ? preActions.map(s => rewriteSelectorsWithCtx(s, scopeSel)) : null;

    let loopHomeUrl = null;

    // Candidate wrapper to preserve existing semantics (candidate.h usage)
    const candidate = {h: candidateHandle};

    try {
        if (preparedPre && preparedPre.length) {
            try {
                await applyActions(page, preparedPre, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
            } catch (err) {
                if (err && err._wfSkipIteration) {
                    await clearScopeAttr(page, scopeId);
                    pushLog(ctx, 'info', `Iteration skipped (preActions) (${iterationIndex + 1}/${iterationTotal ?? '?'})`);
                    await postStepDelay(ctx);
                    return {skipped: true};
                }
                throw err;
            }
        }

        const navMode = action.navigateBy === 'click' ? 'click' : 'none';
        const clickWithin = isNonEmptyString(action.clickWithin) ? action.clickWithin.trim() : null;
        const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');

        // IMPORTANT: keep navigation timeouts separate from action timeout.
        const navTimeout = toNumber(action.timeout, 60000);
        const restoreTimeout = toNumber(action.restoreTimeout, navTimeout); // optional config field
        const shouldGoBack = action.goBack !== false;

        try {
            loopHomeUrl = await page.url();
        } catch {
        }

        if (waitForSelectorSel) {
            try {
                await waitForSel(page, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout});
            } catch {
            }
        }

        let navigated = false;

        try {
            if (navMode === 'click') {
                const startUrl = safePageUrl(page);

                let fallbackHref = '';

                // An item that navigates is waited for to its load; one whose
                // click starts no navigation is known after a second, rather
                // than after the whole navigation timeout, and falls back below.
                const didNavigate = await waitForPossibleNavigation(page, startUrl, {
                    waitUntil,
                    timeout: navTimeout,
                    trigger: async () => {
                        try {
                            await candidate.h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'center'}));
                        } catch {
                        }

                        try {
                            fallbackHref = await candidate.h.evaluate(el => (el.getAttribute && el.getAttribute('href')) || el.href || '');
                        } catch {
                        }

                        if (clickWithin) {
                            const targetSel = clickWithin.split(':ctx').join(scopeSel);
                            await waitForSel(page, targetSel, {visible: true, timeout});
                            await page.$eval(targetSel, el => el.click()).catch(() => {
                            });
                        } else {
                            await candidate.h.evaluate(el => el.click()).catch(() => {
                            });
                        }
                    }
                });

                await waitForRenderSettle(page, 2000);

                try {
                    await candidate.h.dispose();
                } catch {
                }
                candidate.h = null;

                navigated = !!didNavigate;

                if (navigated) {
                    pushLog(ctx, 'info', 'Navigated into item');
                    try {
                        pushLog(ctx, 'info', `URL loaded: ${await page.url()}`);
                    } catch {
                    }
                } else {
                    const href = String(fallbackHref || '').trim();
                    const isNavHref = href
                        && !href.startsWith('#')
                        && !href.toLowerCase().startsWith('javascript:');

                    if (isNavHref) {
                        pushLog(ctx, 'info', `No navigation detected, falling back to goto(${href})`);
                        try {
                            await page.goto(href, {waitUntil, timeout: navTimeout});
                            navigated = true;
                        } catch (e) {
                            pushLog(ctx, 'warning', `Fallback goto failed: ${String(e && e.message || e)}`);
                        }
                    }
                    pushLog(ctx, 'warning', 'Click did not trigger navigation, continuing in-place');
                }
            }

            if (waitForSelectorSel) {
                try {
                    await waitForSel(page, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout});
                } catch {
                }
            }

            try {
                await applyActions(page, prepared, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
            } catch (err) {
                if (err && err._wfSkipIteration) {
                    if (navigated && navMode === 'click' && shouldGoBack) {
                        try {
                            const backQuickTimeout = Math.min(navTimeout, toNumber(action.backTimeout, 8000));
                            const beforeBackUrl = safePageUrl(page);

                            const backWatch = startPossibleNavigationWatch(page, beforeBackUrl, {
                                waitUntil,
                                timeout: backQuickTimeout
                            });

                            await page.goBack({waitUntil, timeout: backQuickTimeout}).catch(() => {});
                            await backWatch.catch(() => {});
                            await waitForRenderSettle(page, 1500);
                        } catch {
                        }

                        // restore if about:blank
                        try {
                            const urlNow = safePageUrl(page);
                            if (urlNow === 'about:blank' && loopHomeUrl) {
                                await page.goto(loopHomeUrl, {waitUntil, timeout: restoreTimeout}).catch(() => {});
                                await waitForRenderSettle(page, 1500);
                            }
                        } catch {
                        }
                    }
                    await clearScopeAttr(page, scopeId);
                    pushLog(ctx, 'info', `Iteration skipped (actions) (${iterationIndex + 1}/${iterationTotal ?? '?'})`);
                    await postStepDelay(ctx);
                    return {skipped: true};
                }
                throw err;
            }
        } finally {
        }

        if (navigated && navMode === 'click' && shouldGoBack) {
            try {
                const backQuickTimeout = Math.min(navTimeout, toNumber(action.backTimeout, 8000));
                const beforeBackUrl = safePageUrl(page);

                const backWatch = startPossibleNavigationWatch(page, beforeBackUrl, {
                    waitUntil,
                    timeout: backQuickTimeout
                });

                await page.goBack({waitUntil, timeout: backQuickTimeout}).catch(() => {});
                await backWatch.catch(() => {});
                await waitForRenderSettle(page, 1500);
            } catch {
            }

            // If goBack lands on about:blank, restore the home URL
            try {
                const urlNow = safePageUrl(page);
                if (urlNow === 'about:blank' && loopHomeUrl) {
                    await page.goto(loopHomeUrl, {waitUntil, timeout: restoreTimeout}).catch(() => {});
                    await waitForRenderSettle(page, 1500);
                }
            } catch {
            }
        }

        await clearScopeAttr(page, scopeId);
        await postStepDelay(ctx);

        return {skipped: false};
    } catch (err) {
        // Ensure scope is cleared even on failure
        try {
            await clearScopeAttr(page, scopeId);
        } catch {
        }
        throw err;
    } finally {
        try {
            if (candidate && candidate.h) await candidate.h.dispose();
        } catch {
        }
        if (candidate) candidate.h = null;

        // always restore per-iteration scope
        try {
            ctx._iterVars = previousIter;
        } catch {
        }

        // restore ordering metadata
        ctx._iterationIndex = _prevIterationIndex;
        ctx._scanCounter = _prevScanCounter;
        ctx._artifactCounter = _prevArtifactCounter;
        ctx._scanStride = _prevScanStride;

        try {
            ctx.popVarScope?.();
        } catch {
        }
    }
}

async function runForEachElementConcurrent({
                                               action,
                                               parentCtx,
                                               mainPage,
                                               sel,
                                               plan,
                                               concurrency,
                                               isolation,
                                               closeWorkerPages,
                                               maxSeconds,
                                               perPageDelayMs,
                                               timeout,
                                               depth,
                                               actionPathPrefix
                                           }) {
    const startMs = Date.now();

    const homeUrl = safePageUrl(mainPage);
    if (!homeUrl) {
        throw new Error('forEachElement: mainPage has no URL (cannot seed workers).');
    }

    const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');
    const navTimeout = toNumber(action.timeout, 60000);

    const waitForSelectorSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    const waitVisible = action.waitVisible !== false; // default true
    const waitTimeout = toNumber(action.waitTimeout, timeout);

    const iterSetupActions = Array.isArray(action.iterSetupActions)
        ? action.iterSetupActions.filter(s => !isDisabled(s))
        : null;

    // No more workers than items: each one opens a page and loads the list
    // first, so a concurrency of 500 over 20 links opened 500 pages (330 s).
    const workerCount = Math.max(1, Math.min(concurrency, plan.length));
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        const {workerPage, workerContext} = await createCrawlWorkerTarget(mainPage, parentCtx, {
            isolation,
            inheritViewport: true
        });

        const workerCtx = createChildContext(parentCtx);
        workerCtx.bindAbortToPage?.(workerPage);

        // Ensure worker is on the same page as the main thread before doing anything else
        await runActionAction(workerPage, {
            type: 'navigate',
            url: homeUrl,
            waitUntil,
            timeout: navTimeout
        }, workerCtx, null, depth + 1, actionPathPrefix);

        // Optional readiness selector (if configured on the action)
        if (waitForSelectorSel) {
            await workerCtx.race(
                waitForSel(workerPage, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout}),
                `forEachElement worker waitForSel ${waitForSelectorSel}`
            ).catch(() => {});
        }

        // Always ensure the target list exists before building/resolving plan items
        await workerCtx.race(
            waitForSel(workerPage, sel, {visible: false, timeout: waitTimeout}),
            `forEachElement worker waitForSel target ${sel}`
        ).catch(() => {});

        workers.push({page: workerPage, ctx: workerCtx, browserContext: workerContext});
    }

    const total = plan.length;
    let nextJob = 0;

    const continueOnIterationError = action.continueOnIterationError === true;
    const maxIterationErrors = Number.isFinite(action.maxIterationErrors) ? action.maxIterationErrors : Infinity;
    let iterationErrors = 0;

    async function runWorkerLoop(w) {
        while (true) {
            const myIndex = nextJob++;
            if (myIndex >= total) return;

            if (maxSeconds != null) {
                const elapsedSec = (Date.now() - startMs) / 1000;
                if (elapsedSec > maxSeconds) {
                    throw new Error("forEachElement: maxSeconds exceeded.");
                }
            }

            const planItem = plan[myIndex];

            // Ensure we are back on the list page before resolving the next element
            const current = safePageUrl(w.page);
            if (!current || current !== homeUrl) {
                await runActionAction(w.page, {
                    type: 'navigate',
                    url: homeUrl,
                    waitUntil,
                    timeout: navTimeout
                }, w.ctx, null, depth + 1, actionPathPrefix);

                if (waitForSelectorSel) {
                    await w.ctx.race(
                        waitForSel(w.page, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout}),
                        `forEachElement worker waitForSel ${waitForSelectorSel}`
                    ).catch(() => {});
                }

                await w.ctx.race(
                    waitForSel(w.page, sel, {visible: false, timeout: waitTimeout}),
                    `forEachElement worker waitForSel target ${sel}`
                ).catch(() => {});
            }

            // Iteration setup actions (match sequential semantics, run before selecting the element)
            if (iterSetupActions && iterSetupActions.length) {
                try {
                    await applyActions(w.page, iterSetupActions, null, 0, w.ctx, Object.create(null), depth + 1, actionPathPrefix);
                } catch (err) {
                    if (err && err._wfSkipIteration) {
                        pushLog(parentCtx, 'info', `Iteration skipped (iterSetupActions) (${myIndex + 1}/${total})`, {depth});
                        await postStepDelay(parentCtx);
                        continue;
                    }
                    throw err;
                }
            }

            let h = null;
            try {
                h = await _forEachFindHandleForPlanItem(w.page, sel, planItem, {
                    reverse: action.reverse === true,
                    dedupeBy: (action.dedupeBy === 'text') ? 'text' : 'href',
                    onlyVisible: action.onlyVisible === true
                });

                if (!h) {
                    throw new Error("forEachElement: could not resolve element on worker page.");
                }

                await runForEachElementIterationOnPage({
                    page: w.page,
                    ctx: w.ctx,
                    action,
                    candidateHandle: h,
                    iterationIndex: myIndex,
                    iterationTotal: total,
                    timeout,
                    depth,
                    actionPathPrefix
                });

                if (perPageDelayMs) {
                    await sleep(perPageDelayMs);
                }
            } catch (err) {
                iterationErrors += 1;

                const msg = String(err && err.message ? err.message : err);

                recordIterationFailure(parentCtx, {
                    iteratorType: 'forEachElement',
                    iteratorLabel: action.label || null,
                    iterationIndex: myIndex,
                    iterationOneBased: myIndex + 1,
                    iterationTotal: total,
                    error: msg,
                    url: safePageUrl(w.page) || null
                });

                pushLog(parentCtx, 'error', `forEachElement iteration ${myIndex + 1}/${total} failed${continueOnIterationError ? ", continuing" : ""}: ${msg}`, {depth});

                try {
                    if (h) await h.dispose();
                } catch {
                }

                if (!continueOnIterationError) throw err;
                if (iterationErrors >= maxIterationErrors) {
                    throw new Error(`forEachElement stopped after ${iterationErrors} iteration errors`);
                }
            } finally {
                try {
                    if (h) await h.dispose();
                } catch {
                }
            }
        }
    }

    try {
        await Promise.all(workers.map(runWorkerLoop));
    } finally {
        if (closeWorkerPages) {
            for (const w of workers) {
                try {
                    await w.page.close();
                } catch {
                }
                if (w.browserContext) {
                    try {
                        await w.browserContext.close();
                    } catch {
                    }
                }
            }
        }
    }
}

// How long a forEachElement loop that has already run looks for more targets
// before taking it that none are left (see the loop's own check).
const LOOP_END_CHECK_MS = 1000;

const STEPS = {
    'forEachElement': stepForEachElement
};

module.exports = {STEPS, bindEngine, LOOP_END_CHECK_MS, _forEachGetKey, buildForEachElementPlan, _forEachFindHandleForPlanItem, runForEachElementIterationOnPage, runForEachElementConcurrent};
