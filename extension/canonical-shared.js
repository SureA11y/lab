'use strict';

/**
 * Helpers for the lab's canonical result format, whichever engine a scan
 * ran with, that must work in:
 * - Node (CommonJS require)
 * - Browser extension (plain <script> include)
 *
 * Exposes:
 *   - CANON_VERSION
 *   - isoNow, makeLocalId
 *   - normalizeSelectorList, normalizeOutcome, normalizeSeverity
 *   - makeFindingUid, makeOccurrenceUid
 *   - splitWcagTagToRef, deriveWcagLevelFromTags, tagsToStandards
 *
 * surea11y's own results are turned into this format by its adapter
 * (src/server-side/engines/a11y-labs-engine.js).
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_CANONICAL = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CANON_VERSION = '1.0';

    function isoNow() {
        try { return new Date().toISOString(); } catch { return null; }
    }

    function normalizeSelectorList(input) {
        if (!input) return [];
        if (Array.isArray(input)) return input.map(s => String(s).trim()).filter(Boolean);
        if (typeof input === 'string') return input.split(',').map(s => s.trim()).filter(Boolean);
        return [];
    }

    function normalizeOutcome(outcome) {
        const o = String(outcome || '').toLowerCase();
        if (o === 'fail' || o === 'failed' || o === 'violation' || o === 'violations') return 'fail';
        if (o === 'canttell' || o === 'cant_tell' || o === 'incomplete') return 'cantTell';
        if (o === 'pass' || o === 'passes') return 'pass';
        if (o === 'notapplicable' || o === 'not_applicable' || o === 'inapplicable') return 'notApplicable';
        return 'unknown';
    }

    function normalizeSeverity(sev) {
        const s = String(sev || '').toLowerCase();
        if (s === 'critical') return 'critical';
        if (s === 'serious') return 'serious';
        if (s === 'moderate') return 'moderate';
        if (s === 'minor') return 'minor';
        if (s === 'info' || s === 'informational') return 'info';
        if (!s) return 'unknown';
        return 'unknown';
    }

    function makeFindingUid(engineId, outcome, ruleId) {
        const eng = String(engineId || '').trim() || 'unknown-engine';
        const o = String(outcome || '').trim();
        const r = String(ruleId || '').trim();
        return `${eng}:${o}:${r}`;
    }

    function hashlib(str) {
        // lightweight deterministic hash (not cryptographic)
        let h1 = 0x811c9dc5;
        for (let i = 0; i < str.length; i += 1) {
            h1 ^= str.charCodeAt(i);
            h1 = (h1 * 0x01000193) >>> 0; // FNV-1a prime
        }
        return `h${h1.toString(16)}`;
    }

    function makeOccurrenceUid({ ruleId, outcome, pageUrl, target, html }) {
        const t = Array.isArray(target) ? target.join(' ') : String(target || '');
        const base = `${String(ruleId || '')}|${String(outcome || '')}|${String(pageUrl || '')}|${t}|${String(html || '')}`;
        try {
            return hashlib(base);
        } catch {
            return base;
        }
    }

    function splitWcagTagToRef(tag) {
        // WCAG criterion tags like "wcag143" -> "1.4.3", "wcag1410" -> "1.4.10".
        // Principle and guideline are always one digit; the criterion takes the rest.
        const m = /^wcag(\d{3,4})$/.exec(String(tag || '').toLowerCase());
        if (!m) return null;
        const digits = m[1];
        return `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
    }

    function deriveWcagLevelFromTags(tags) {
        const list = Array.isArray(tags) ? tags : normalizeSelectorList(tags);
        let hasA = false, hasAA = false, hasAAA = false;

        for (const tag of list) {
            const t = String(tag).toLowerCase();
            const m = /^wcag2(1|2)?a{1,3}$/.exec(t);
            if (!m) continue;
            if (t.endsWith('aaa')) hasAAA = true;
            else if (t.endsWith('aa')) hasAA = true;
            else if (t.endsWith('a')) hasA = true;
        }
        if (hasAAA) return 'AAA';
        if (hasAA) return 'AA';
        if (hasA) return 'A';
        return null;
    }

    function tagsToStandards(tags) {
        const list = Array.isArray(tags) ? tags : [];
        const wcag = [];
        const normTags = [];
        let wcagLevel = null;

        for (const tRaw of list) {
            const t = String(tRaw || '').trim();
            if (!t) continue;
            const ref = splitWcagTagToRef(t);
            if (ref) {
                wcag.push({ ref, level: null });
                continue;
            }
            normTags.push(t);
        }

        wcagLevel = deriveWcagLevelFromTags(list);

        return { wcag, tags: normTags, wcagLevel };
    }

    function makeLocalId(prefix) {
        const p = String(prefix || 'id');
        try {
            if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
                return `${p}-${globalThis.crypto.randomUUID()}`;
            }
        } catch {}
        return `${p}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    return {
        CANON_VERSION,
        isoNow,
        makeLocalId,
        normalizeSelectorList,
        normalizeOutcome,
        normalizeSeverity,
        makeFindingUid,
        makeOccurrenceUid,
        splitWcagTagToRef,
        deriveWcagLevelFromTags,
        tagsToStandards
    };
});