'use strict';

/**
 * scan-notes.js (shared)
 *
 * What a surea11y result says beside its findings, read the same way by the
 * lab's server adapter and the extension's:
 *
 *  - notes on how a scan ran (canonical.notices), which can explain a scan
 *    that looks clean: a scope that matched nothing, a page still loading;
 *  - margins (canonical.margins): how close each measuring rule's closest
 *    pass came to its threshold;
 *  - an occurrence's details (data.details), kept for display only.
 *
 * Browser: available as globalThis.A11Y_SCAN_NOTES.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_NOTES = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // ---- occurrence details ----

    // Core documents each rule's data.details fields but keeps them outside
    // its stable contract, so they are carried as plain values for display:
    // scalars and short lists of scalars, strings cut short, and reasonCode
    // left out, as it is kept on its own.
    const MAX_DETAIL_KEYS = 12;
    const MAX_DETAIL_STRING = 200;
    const MAX_DETAIL_LIST = 10;

    function displayDetailValue(v) {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') {
            const t = v.trim();
            return t ? (t.length > MAX_DETAIL_STRING ? t.slice(0, MAX_DETAIL_STRING - 1) + '…' : t) : null;
        }
        return null;
    }

    function normalizeOccurrenceDetails(details) {
        if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
        const out = {};
        let count = 0;
        for (const [key, raw] of Object.entries(details)) {
            if (count >= MAX_DETAIL_KEYS) break;
            if (key === 'reasonCode') continue;
            let value;
            if (Array.isArray(raw)) {
                const items = raw.slice(0, MAX_DETAIL_LIST).map(displayDetailValue);
                if (!items.length || items.some((x) => x === null)) continue;
                value = items;
            } else {
                value = displayDetailValue(raw);
                if (value === null) continue;
            }
            out[key] = value;
            count += 1;
        }
        return count ? out : null;
    }

    /** The shadow hosts leading to an occurrence in a shadow tree, or null. */
    function shadowHostsOf(occ) {
        return occ && Array.isArray(occ.shadowHostSelectors) && occ.shadowHostSelectors.length
            ? occ.shadowHostSelectors.map(String)
            : null;
    }

    // ---- notes on how a scan ran ----

    /**
     * Notes on how core resolved the scan's scope (result.contextMatch). A
     * scope that matches nothing is scanned as nothing, so every rule is not
     * applicable and the scan would look clean.
     */
    function contextMatchNotices(contextMatch, contextSelector, engineId) {
        if (!contextMatch || typeof contextMatch !== 'object') return [];
        const unmatched = Array.isArray(contextMatch.unmatchedSelectors) ? contextMatch.unmatchedSelectors.map(String) : [];
        if (contextMatch.elementCount === 0) {
            return [{
                engineId,
                code: 'context-unmatched',
                message: 'surea11y scanned nothing: the scan scope ' + JSON.stringify(contextSelector || unmatched.join(', '))
                    + ' matched no element on the page.'
            }];
        }
        if (unmatched.length) {
            return [{
                engineId,
                code: 'context-partly-unmatched',
                message: 'Part of the scan scope matched no element, so surea11y did not scan it: '
                    + unmatched.map((sel) => JSON.stringify(sel)).join(', ') + '.'
            }];
        }
        return [];
    }

    /**
     * A note saying what was still loading when the page was scanned
     * (core's waitForPageReady result), or null when it was ready.
     */
    function readinessNotice(readiness) {
        if (!readiness || readiness.ready) return null;
        const p = readiness.pending || {};
        const what = [];
        if (p.load) what.push('the page itself');
        if (p.fonts) what.push('web fonts');
        if (p.images) what.push(`${p.images} ${p.images === 1 ? 'image' : 'images'}`);
        if (p.domChanging) what.push('changes to the page');
        if (!what.length) return null;
        const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0];
        return {
            engineId: null,
            code: 'page-not-ready',
            message: `The page was still loading when it was scanned (${list}, after waiting ${Math.round(readiness.waitedMs || 0)} ms). `
                + 'Layout and contrast results may differ on a scan taken once it has loaded.'
        };
    }

    /**
     * A page with more elements than the scan step's threshold (Note pages
     * with more elements than, 25,000 unless it says), scanned in full: a
     * note that it is large and how long its scan took, or null.
     */
    function largePageNotice(elements, threshold, durationMs) {
        if (!(elements >= threshold)) return null;
        const n = (x) => Math.round(x).toLocaleString('en-US');
        const took = Number.isFinite(durationMs) ? `, which took ${durationMs >= 10000 ? `${Math.round(durationMs / 1000)} s` : `${(durationMs / 1000).toFixed(1)} s`}` : '';
        return {
            engineId: null,
            code: 'large-page',
            message: `This page has ${n(elements)} elements, more than ${n(threshold)}. It was scanned in full${took}. `
                + 'To make its scans faster, scan the part that matters (Include selectors), or leave out a long list or table (Exclude selectors).'
        };
    }

    /**
     * A scan of a page Set language asked for one language that declares
     * another (its html lang): the site may not have followed the step, so
     * the results may be for other content than the reader expects. Compared
     * by language alone (es-ES and es-MX are both Spanish); a page that
     * declares none is left to the rules that check for it.
     */
    function languageNotice(language) {
        const requested = language && String(language.requested || '').trim();
        const declared = language && String(language.declared || '').trim();
        if (!requested || !declared) return null;
        const base = (t) => t.split(/[-_]/)[0].toLowerCase();
        if (base(requested) === base(declared)) return null;
        // "English" for lang="en", or the tag as it is where it has no name.
        let name = declared;
        try {
            name = new Intl.DisplayNames(['en'], { type: 'language' }).of(declared) || declared;
        } catch { name = declared; }
        return {
            engineId: null,
            code: 'language-mismatch',
            message: `This scan was taken with the language set to ${requested} (Set language), but the page says it is in ${name} (lang="${declared}"): `
                + `the site may not have followed it, so these results may be for its ${name} version. `
                + 'A site can keep its language in a cookie, an account setting or its address (such as /en/), or pick it by location.'
        };
    }

    // ---- margins ----

    /**
     * Each measuring rule's margin in a core result, as [{ ruleId, title,
     * measure, unit, limit, threshold, value, headroom, measuredCount,
     * selector, structuralPath, shadowHostSelectors, context }], sorted by
     * rule id, as core's getMargins gives them. `titleOf(ruleId)` names the
     * rule; without one the id stands in.
     */
    function collectMargins(checksResults, titleOf) {
        const list = Array.isArray(checksResults) ? checksResults : [];
        const out = [];
        for (const r of list) {
            const m = r && r.margin;
            if (!m || typeof m !== 'object' || !r.ruleId) continue;
            if (!Number.isFinite(m.value) || !Number.isFinite(m.threshold) || !Number.isFinite(m.headroom)) continue;
            let title = null;
            try { title = typeof titleOf === 'function' ? titleOf(r.ruleId) : null; } catch { title = null; }
            out.push({ ruleId: r.ruleId, ...m, title: title || r.ruleId });
        }
        return out.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
    }

    return {
        normalizeOccurrenceDetails,
        shadowHostsOf,
        contextMatchNotices,
        readinessNotice,
        largePageNotice,
        languageNotice,
        collectMargins,
    };
}));
