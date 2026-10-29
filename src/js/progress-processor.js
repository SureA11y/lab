'use strict';

/**
 * Creates a handler for workflow progress log entries.
 * This keeps the "what to do for each log entry" out of a11y-ui.js.
 */
export function createProgressProcessor(deps) {
    if (!deps) throw new Error('createProgressProcessor: deps is required');

    const {
        // state
        liveVarState,
        liveStepState,

        // helpers
        appendLog,
        parseForEachIteration,
        parseRepeatIteration,
        tryUpdateLiveScanTitles,
        tryUpdateLiveScreenshotCaptions,
        collectVarsDeep,
        deriveScreenshotCaption,
        resolveStepRefForLogEntry,

        // UI stream
        addStreamCard,
        addScanTotals,
        mergeScanTotals,
        setStepTotals,
        getUseLiveStream
    } = deps;

    if (!liveVarState) throw new Error('createProgressProcessor: liveVarState is required');
    if (typeof appendLog !== 'function') throw new Error('createProgressProcessor: appendLog is required');
    if (typeof getUseLiveStream !== 'function') throw new Error('createProgressProcessor: getUseLiveStream is required');

    function mergeVars(obj) {
        if (obj && typeof obj === 'object') Object.assign(liveVarState.vars, obj);
    }

    function updateIterationVarsFromMatch(match) {
        const { oneBased, total } = match;
        liveVarState.oneBased = Number.isFinite(oneBased) ? oneBased : undefined;
        liveVarState.index = Number.isFinite(oneBased) ? oneBased - 1 : undefined;

        // total can be null for "?"
        if (total === null) liveVarState.total = undefined;
        else liveVarState.total = Number.isFinite(total) ? total : undefined;

        tryUpdateLiveScanTitles?.();
        tryUpdateLiveScreenshotCaptions?.();
    }

    function readCounts(summary) {
        const s = summary && typeof summary === 'object' ? summary : {};

        const violations =
            Number.isFinite(s.failCount) ? s.failCount :
                Number.isFinite(s.violations) ? s.violations : 0;

        const passes =
            Number.isFinite(s.passesCount) ? s.passesCount :
                Number.isFinite(s.passes) ? s.passes : 0;

        const incomplete =
            Number.isFinite(s.reviewCount) ? s.reviewCount :
                Number.isFinite(s.incomplete) ? s.incomplete : 0;

        return { violations, passes, incomplete };
    }

    // The engine marks the log entries that move a step counter (see
    // extra.stepEvent in workflow-engine.js). Everything else is left alone, so
    // the counter is touched once per action rather than once per log line.
    function updateStepTotals(entry) {
        const counter = liveStepState && liveStepState.counter;
        if (!counter || typeof setStepTotals !== 'function') return;
        if (!entry || !entry.extra || typeof entry.extra !== 'object' || !entry.extra.stepEvent) return;

        try {
            setStepTotals(counter.accept(entry));
        } catch {
            // A counting slip must never cost the user the log line itself.
        }
    }

    function processOne(entry) {
        const depth =
            entry?.extra?.depth ??
            entry?.depth ??
            entry?.extra?.action?.depth ??
            0;
        const marked = depth ? (entry.message || '') + ' #d' + depth : entry.message || '';

        // Merge vars from top-level entry and common containers
        mergeVars(entry?.vars);
        mergeVars(entry?.extra?.varsGlobal);

        const stepRef = typeof resolveStepRefForLogEntry === 'function'
            ? resolveStepRefForLogEntry(entry)
            : null;
        appendLog(marked, entry.type || '', {stepRef});

        updateStepTotals(entry);

        // Parse iteration info from the message string
        const txt = String(entry?.message || '');
        let m = parseForEachIteration?.(txt);
        if (m) {
            updateIterationVarsFromMatch(m);
        } else {
            m = parseRepeatIteration?.(txt);
            if (m) updateIterationVarsFromMatch(m);
        }

        // Live screenshot cards (array payloads)
        if (entry.type === 'screenshot' && entry.extra && Array.isArray(entry.extra.publicUrls) && entry.extra.publicUrls.length) {
            mergeVars(entry?.extra?.varsGlobal);

            if (getUseLiveStream()) {
                for (const u of entry.extra.publicUrls) {
                    if (!u) continue;
                    const info = deriveScreenshotCaption?.(entry.extra) || null;
                    if (info?.localVars && typeof info.localVars === 'object') mergeVars(info.localVars);

                    addStreamCard?.({
                        kind: 'screenshot',
                        previewUrl: u,
                        caption: info?.raw || entry.extra.caption || 'Screenshot',
                        localVars: info?.localVars || {},
                        url: entry.extra.url || null
                    });
                }
            }
            return;
        }

        // Live screenshot cards. The server keeps only the latest images in a
        // run's log, so a card replayed late may have none (screenshotDropped).
        if (entry.type === 'screenshot' && entry.extra && (entry.extra.dataUrl || entry.extra.publicUrl || entry.extra.screenshotDropped)) {
            // even if we are not streaming, we still want vars
            mergeVars(entry?.extra?.varsGlobal);

            if (getUseLiveStream()) {
                const info = deriveScreenshotCaption?.(entry.extra) || null;

                // pull any local vars into the global bag
                if (info?.localVars && typeof info.localVars === 'object') {
                    mergeVars(info.localVars);
                }

                addStreamCard?.({
                    kind: 'screenshot',
                    previewUrl: entry.extra.dataUrl || entry.extra.publicUrl || null,
                    screenshotDropped: !!entry.extra.screenshotDropped,
                    caption: info?.raw || entry.extra.caption || 'Screenshot',
                    localVars: info?.localVars || {},
                    url: entry.extra.url || null,
                    viewportRatio: entry.extra.viewportRatio
                });
            }
            return;
        }

        // A Merged scan step's scans became one when the run's scans were
        // collected: the totals swap the scans they counted for the one scan.
        if (entry.type === 'scan' && entry.message === 'a11yScan merged' && entry.extra) {
            if (getUseLiveStream()) {
                const contexts = Array.isArray(entry.extra.contexts) ? entry.extra.contexts : [];
                mergeScanTotals?.({
                    key: entry.extra.key || null,
                    removed: contexts.map((c) => ({counts: readCounts(c && c.summary), scanTags: c && c.scanTags})),
                    added: {counts: readCounts(entry.extra.summary), scanTags: entry.extra.scanTags}
                });
            }
            return;
        }

        // Live scan cards, including skipped
        if (entry.type === 'scan' && entry.message === 'a11yScan skipped' && entry.extra) {
            if (getUseLiveStream()) {
                const infoVars = {
                    reason: entry.extra.reason || 'skipped',
                    estimatedNodes: entry.extra.estimatedNodes,
                    threshold: entry.extra.threshold,
                    suggestions: Array.isArray(entry.extra.suggestions) ? entry.extra.suggestions : []
                };
                addStreamCard?.({
                    kind: 'skipped',
                    label: entry.extra.label || null,
                    context: entry.extra.context || null,
                    localVars: infoVars,
                    url: entry.extra.url || null
                });
            }
            return;
        }

        if (entry.type === 'scan' && entry.extra) {
            mergeVars(entry.extra.vars);
            mergeVars(collectVarsDeep?.(entry.extra));

            if (getUseLiveStream()) {
                const counts = readCounts(entry.extra && entry.extra.summary);
                addStreamCard?.({
                    kind: 'scan',
                    label: entry.extra.label || null,
                    context: entry.extra.context || null,
                    counts,
                    meta: entry.extra.meta || null,
                    preview: entry.extra.preview || null,
                    previewUrl: entry.extra.dataUrl || entry.extra.publicUrl || null,
                    screenshotDropped: !!entry.extra.screenshotDropped,
                    url: entry.extra.url || null,
                    viewportRatio: entry.extra.viewportRatio
                });
                addScanTotals?.({
                    counts,
                    domNodes: entry.extra.meta?.estimatedNodes,
                    scanTags: entry.extra.scanTags,
                    mergedScanKey: entry.extra.mergedScanKey || null
                });
            }
            return;
        }

        // Fallback info like "a11yScan saved (Label)"
        if (entry.type === 'info') {
            const t = String(entry.message || '');
            const m2 = /a11yScan (saved|completed)\s*\((.+)\)/i.exec(t);
            if (m2 && getUseLiveStream()) {
                mergeVars(entry?.extra?.vars);

                const counts = readCounts(entry.extra && entry.extra.summary);
                addStreamCard?.({
                    kind: 'scan',
                    label: m2[2],
                    context: entry.extra?.context || null,
                    counts,
                    previewUrl: entry.extra?.dataUrl || entry.extra?.publicUrl || null,
                    url: entry.extra?.url || null
                });
                addScanTotals?.({counts, domNodes: entry.extra?.meta?.estimatedNodes, scanTags: entry.extra?.scanTags});
            }
        }
    }

    function processMany(entries) {
        if (!Array.isArray(entries) || !entries.length) return;
        for (const entry of entries) processOne(entry);
    }

    return { processMany, processOne };
}
