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
 * the rest get `{ skipped: 'rule-limit', max }`.
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
        const pictured = new Map();
        for (const check of trimmed.checksResults) {
            for (const occ of (check && check.occurrences) || []) {
                // What the element got for another check: its picture, or why there is none.
                if (occ && occ.screenshot && occ.selector) pictured.set(elementOf(occ), occ.screenshot);
            }
        }
        for (const occ of cut) {
            occ.screenshot = pictured.get(elementOf(occ)) || { skipped: 'rule-limit', max: this._shotPerRule };
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

module.exports = { scanPage, captureScreenshots, applySelection, CORE_HOOKS, coreHooksFrom, installCoreHooks };
