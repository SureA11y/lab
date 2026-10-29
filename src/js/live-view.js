'use strict';

import {enhanceAsLiveCarousel} from './carousel-ui.js';
import {createStreamCardAdder} from './stream-ui.js';
import {createLiveTotals} from './live-totals.js';
import {createProgressProcessor} from './progress-processor.js';
import {createAdvancedDialog} from './advanced-dialog.js';

/**
 * The live view of one workflow run: its log, step progress and scan totals,
 * and the live preview cards with their screenshot lightbox, all fed from the
 * run's progress log entries.
 *
 * The run workflow tab builds these pieces itself, around its own form run.
 * createLiveView builds a separate set inside any element (the watch dialog's
 * body), so a queued run can be watched without touching the run tab: its log,
 * cards, totals and result dialogs stay as they were.
 *
 * The label helpers below are shared with the run tab, each taking the
 * variable state it resolves against.
 */

/* ==================== Label helpers ==================== */

/** A fresh variable state for resolving {var:…} in live labels. */
export function createLiveVarState() {
    return {
        index: undefined, // zero-based
        oneBased: undefined, // one-based
        total: undefined,
        vars: Object.create(null)
    };
}

/** Deep collect any nested `.vars`-like objects */
export function collectVarsDeep(root) {
    const bag = Object.create(null);
    const seen = new WeakSet();
    (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (seen.has(node)) return;
        seen.add(node);

        if (node.vars && typeof node.vars === 'object') Object.assign(bag, node.vars);
        if (node.resolvedVars && typeof node.resolvedVars === 'object') Object.assign(bag, node.resolvedVars);
        if (node.varsFlat && typeof node.varsFlat === 'object') Object.assign(bag, node.varsFlat);
        if (node.varsGlobal && typeof node.varsGlobal === 'object') Object.assign(bag, node.varsGlobal);

        for (const k in node) {
            if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
            const v = node[k];
            if (v && typeof v === 'object') walk(v);
        }
    })(root);
    return bag;
}

function getByPath(obj, path) {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = String(path || '').split('.');
    let cur = obj;

    for (const p of parts) {
        if (!cur || typeof cur !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
        cur = cur[p];
    }
    return cur;
}

/** Resolve placeholders using live and local var sets */
export function resolveLabelTemplate(raw, localVars, varState) {
    if (typeof raw !== 'string') return raw;
    let out = raw;
    const state = varState || createLiveVarState();

    if (out.includes('{var:index}') && typeof state.index === 'number') {
        out = out.replaceAll('{var:index}', String(state.index));
    }
    if (out.includes('{var:oneBased}') && typeof state.oneBased === 'number') {
        out = out.replaceAll('{var:oneBased}', String(state.oneBased));
    }
    if (out.includes('{var:total}') && typeof state.total === 'number') {
        out = out.replaceAll('{var:total}', String(state.total));
    }

    const locals = localVars && typeof localVars === 'object' ? localVars : null;
    out = out.replace(/\{var:([a-zA-Z0-9_.-]+)\}/g, (m, name) => {
        // 1) try dot-path from locals
        if (locals) {
            const v = getByPath(locals, name);
            if (v !== undefined) return v == null ? '' : String(v);
        }

        // 2) try dot-path from live vars
        const v2 = getByPath(state.vars, name);
        if (v2 !== undefined) return v2 == null ? '' : String(v2);

        // 3) fallback: missing var -> empty string
        return '';
    });

    return out;
}

export function findUnresolvedVars(str) {
    if (typeof str !== 'string') return [];
    const names = [];
    str.replace(/\{var:([a-zA-Z0-9_.-]+)\}/g, (_, n) => {
        names.push(n);
        return '';
    });
    return names;
}

/** Create caption data for screenshot stream cards */
export function deriveScreenshotCaption(extra, varState) {
    const localVars = collectVarsDeep(extra);
    const templateCandidates = [
        extra?.captionTemplate,
        extra?.labelTemplate,
        extra?.nameTemplate,
        extra?.titleTemplate,
        extra?.action?.labelTemplate,
        extra?.action?.nameTemplate,
        extra?.action?.captionTemplate,
        extra?.action?.titleTemplate
    ].filter((v) => typeof v === 'string' && v.trim());

    const plainCandidates = [
        extra?.caption,
        extra?.label,
        extra?.name,
        extra?.title,
        extra?.filename,
        extra?.action?.label,
        extra?.action?.name,
        extra?.action?.title,
        extra?.action?.id
    ].filter((v) => typeof v === 'string' && v.trim());

    const raw = (templateCandidates[0] || plainCandidates[0] || 'Screenshot').trim();
    return {resolved: resolveLabelTemplate(raw, localVars, varState), raw, localVars};
}

/**
 * Re-resolve the titles of scan cards and the captions of screenshot cards
 * under `root` that still hold {var:…}, once iteration vars change.
 */
export function refreshLiveLabels(root, varState) {
    if (!root) return;
    root.querySelectorAll('.stream-card[data-kind="scan"] h3').forEach((h3) => {
        const raw = h3.dataset.rawLabel || '';
        if (raw && raw.includes('{var:')) {
            const desired = 'Scan: ' + (resolveLabelTemplate(raw, null, varState) || 'a11y scan');
            if (desired !== h3.textContent) h3.textContent = desired;
        }
    });
    root.querySelectorAll('.stream-card[data-kind="screenshot"] .stream-caption').forEach((el) => {
        const raw = el.dataset.rawCaption || '';
        if (!raw || !raw.includes('{var:')) return;
        let localVars = {};
        try {
            localVars = JSON.parse(el.dataset.localVars || '{}');
        } catch {
        }
        const resolved = resolveLabelTemplate(raw, localVars, varState) || 'Screenshot';
        const desired = 'Screenshot' + (resolved !== 'Screenshot' ? ': ' + resolved : '');
        if (desired !== el.textContent) {
            el.textContent = desired;
            const img = el.nextElementSibling?.querySelector('img') || el.previousElementSibling?.querySelector('img');
            if (img) img.alt = resolved;
        }
    });
}

/* ==================== One live view ==================== */

/**
 * @param {object} opts
 * @param {Element} opts.totalsMount  Where the (inline) totals go.
 * @param {Element} opts.streamEl     The live preview section; shown on the first card.
 * @param {Element} opts.gridEl       The cards' host, made a carousel.
 * @param {Element} opts.logEl        The log's entries.
 * @param {(entry: Element) => void} [opts.onLog]  After each log line is added.
 * @param {string} opts.idPrefix      Keeps the ids of this view's pieces unique.
 * @param {object} opts.helpers       { escapeHtml, escapeAttr, linkifyUrlsToHtml,
 *        indentPrefix, parseForEachIteration, parseRepeatIteration }
 */
export function createLiveView({
    totalsMount,
    streamEl,
    gridEl,
    logEl,
    onLog = () => {},
    idPrefix = 'live-view',
    helpers = {},
} = {}) {
    if (!gridEl || !streamEl || !logEl || !totalsMount) throw new Error('createLiveView: totalsMount, streamEl, gridEl and logEl are required');
    const {escapeHtml, escapeAttr, linkifyUrlsToHtml, indentPrefix, parseForEachIteration, parseRepeatIteration} = helpers;

    const varState = createLiveVarState();
    const stepState = {counter: null};

    // Opened from a card's screenshot. Its own, so this run's images never
    // join the run tab's lightbox or its result dialogs.
    const lightbox = createAdvancedDialog({options: {paged: true}});
    const noDialog = {addItem() {}, openById() {}};

    const carousel = enhanceAsLiveCarousel(gridEl, {
        title: 'Live preview',
        visibleCount: 4,
        announceNewItems: false
    });

    const resolve = (raw, localVars) => resolveLabelTemplate(raw, localVars, varState);
    const addStreamCard = createStreamCardAdder({
        getUseLiveStream: () => true,
        getGrid: () => gridEl,
        getStream: () => streamEl,
        carousel,
        dialogs: {liveStreamDialog: lightbox, scansDialog: noDialog, screenshotsDialog: noDialog},
        escapeHtml,
        escapeAttr,
        resolveLabelTemplate: resolve,
        findUnresolvedVars,
        isDebug: () => false
    });

    const totals = createLiveTotals({getMount: () => totalsMount, inline: true, idPrefix: `${idPrefix}-totals`});

    function appendLog(message, type) {
        if (!message) return null;
        const entry = document.createElement('div');
        entry.className = 'log-panel-entry';
        if (type) entry.classList.add('log-panel-entry-' + String(type));

        let timeLabel;
        try {
            timeLabel = new Date().toLocaleTimeString([], {hour12: false});
        } catch {
            timeLabel = new Date().toTimeString().slice(0, 8);
        }

        const depthMatch = /#d(\d+)/.exec(message);
        const depthPrefix = depthMatch && indentPrefix ? indentPrefix(Number(depthMatch[1])) : '';
        const clean = message.replace(/\s*#d\d+/, '');
        entry.innerHTML = `[${timeLabel}] ${depthPrefix}${linkifyUrlsToHtml ? linkifyUrlsToHtml(clean) : escapeHtml(clean)}`;

        logEl.appendChild(entry);
        onLog(entry);
        return entry;
    }

    // The carousel took gridEl's place in the page; the cards are under its root.
    const refresh = () => refreshLiveLabels(carousel.root, varState);
    const processor = createProgressProcessor({
        liveVarState: varState,
        liveStepState: stepState,
        appendLog,
        parseForEachIteration,
        parseRepeatIteration,
        tryUpdateLiveScanTitles: refresh,
        tryUpdateLiveScreenshotCaptions: null,
        collectVarsDeep,
        deriveScreenshotCaption: (extra) => deriveScreenshotCaption(extra, varState),
        addStreamCard,
        addScanTotals: (payload) => totals.add(payload),
        mergeScanTotals: (payload) => totals.merge(payload),
        setStepTotals: (snapshot) => totals.setSteps(snapshot),
        getUseLiveStream: () => true
    });

    return {
        appendLog,
        processMany: (entries) => processor.processMany(entries),

        /**
         * Count steps against the run's own workflow. The cards stream either
         * way: without the workflow there is just no step plan.
         */
        start({actions = [], customSteps = []} = {}) {
            if (!Array.isArray(actions) || !actions.length) return;
            const api = globalThis.A11Y_WORKFLOW_STEP_COUNTER;
            if (!api || typeof api.createStepCounter !== 'function') return;
            try {
                stepState.counter = api.createStepCounter({actions, customSteps});
                totals.setSteps(stepState.counter.snapshot());
            } catch {
                // Watch without a step counter rather than not at all.
                stepState.counter = null;
            }
        },

        /** The run ended: the totals stop showing it as running. */
        finish() {
            totals.finish();
        },

        destroy() {
            carousel.destroy();
            totals.remove();
            lightbox.close?.();
            lightbox.destroy();
            lightbox.dialog.remove();
        },
    };
}
