'use strict';

/**
 * Clusters occurrences so a report can say which pattern carries the debt, and
 * whether a defect is systemic or local. Occurrences were previously only counted.
 */

function asArray(x) {
    return Array.isArray(x) ? x : [];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const GENERATED_RUN = /[0-9a-f]{8,}/gi;

/**
 * Drops positional indices and attribute values so repeated instances of the same
 * pattern collapse together, while the attribute names that identify it survive.
 * Generated id fragments are masked too, otherwise one component rendered with a
 * fresh uuid per page never clusters and reads as many local defects.
 */
function normalizeSelector(selector) {
    return String(selector || '')
        .replace(/:nth-(of-type|child|last-of-type|last-child)\([^)]*\)/g, '')
        .replace(/\[([^\]=]+)=(?:"[^"]*"|'[^']*'|[^\]]*)\]/g, '[$1]')
        .replace(UUID, '*')
        .replace(GENERATED_RUN, '*')
        .replace(/\s*>\s*/g, ' > ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The failing element itself, which says what kind of thing keeps going wrong. */
function lastSegment(normalized) {
    const parts = String(normalized || '').split('>').map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

function targetOf(occurrence) {
    const t = occurrence && occurrence.target;
    if (Array.isArray(t)) return t.join(' ');
    return String(t || '');
}

function bump(map, key, { pageUrl, ruleId, html }) {
    if (!map.has(key)) {
        map.set(key, { key, occurrences: 0, pages: new Set(), ruleIds: new Set(), sampleHtml: null });
    }
    const entry = map.get(key);
    entry.occurrences += 1;
    if (pageUrl) entry.pages.add(pageUrl);
    if (ruleId) entry.ruleIds.add(ruleId);
    if (!entry.sampleHtml && html) entry.sampleHtml = String(html).slice(0, 200);
    return entry;
}

function finalize(map, limit) {
    return [...map.values()]
        .map((e) => ({
            pattern: e.key,
            element: lastSegment(e.key),
            occurrences: e.occurrences,
            pages: e.pages.size,
            ruleIds: [...e.ruleIds].sort(),
            sampleHtml: e.sampleHtml
        }))
        .sort((a, b) => b.occurrences - a.occurrences || a.pattern.localeCompare(b.pattern))
        .slice(0, limit);
}

/**
 * Scope is decided by counting, not by a share threshold: present on every scanned
 * page is systemic, on exactly one is local, anything between is partial. One page
 * cannot distinguish the two, so it reports unknown rather than guessing.
 */
function scopeFor(pagesAffected, pagesScanned) {
    if (!Number.isFinite(pagesScanned) || pagesScanned < 2) return 'unknown';
    if (pagesAffected >= pagesScanned) return 'systemic';
    if (pagesAffected <= 1) return 'local';
    return 'partial';
}

/**
 * @param {object} input
 * @param {Array} input.findings - canonical findings carrying occurrences
 * @param {number} [input.pagesScanned] - distinct pages the run covered
 * @param {number} [input.limit=10]
 */
function mineOccurrences({ findings, pagesScanned = 0, limit = 10 } = {}) {
    const byPattern = new Map();
    const byElement = new Map();
    const byRule = new Map();
    const allPages = new Set();

    for (const f of asArray(findings)) {
        if (!f) continue;
        // Only confirmed and review-worthy outcomes carry debt worth clustering.
        if (f.outcome !== 'fail' && f.outcome !== 'cantTell') continue;

        const ruleId = String(f.ruleId || f.id || '').trim();
        const occurrences = asArray(f.occurrences);

        if (!byRule.has(ruleId)) {
            byRule.set(ruleId, { ruleId, outcome: f.outcome, severity: f.severity || 'unknown', occurrences: 0, pages: new Set() });
        }
        const ruleEntry = byRule.get(ruleId);

        for (const occ of occurrences) {
            const normalized = normalizeSelector(targetOf(occ));
            if (!normalized) continue;

            const pageUrl = occ && occ.pageUrl ? String(occ.pageUrl) : '';
            const html = occ && occ.html ? occ.html : null;

            if (pageUrl) allPages.add(pageUrl);

            bump(byPattern, normalized, { pageUrl, ruleId, html });
            const element = lastSegment(normalized);
            if (element) bump(byElement, element, { pageUrl, ruleId, html });

            ruleEntry.occurrences += 1;
            if (pageUrl) ruleEntry.pages.add(pageUrl);
        }
    }

    const pageTotal = Number.isFinite(pagesScanned) && pagesScanned > 0 ? pagesScanned : allPages.size;

    const reach = [...byRule.values()]
        .filter((r) => r.occurrences > 0)
        .map((r) => ({
            ruleId: r.ruleId,
            outcome: r.outcome,
            severity: r.severity,
            occurrences: r.occurrences,
            pagesAffected: r.pages.size,
            pagesScanned: pageTotal,
            scope: scopeFor(r.pages.size, pageTotal)
        }))
        .sort((a, b) => b.pagesAffected - a.pagesAffected || b.occurrences - a.occurrences || a.ruleId.localeCompare(b.ruleId));

    const countScope = (s) => reach.filter((r) => r.scope === s).length;

    return {
        pagesScanned: pageTotal,
        topPatterns: finalize(byPattern, limit),
        topElements: finalize(byElement, limit),
        reach,
        totals: {
            clusteredOccurrences: [...byPattern.values()].reduce((a, b) => a + b.occurrences, 0),
            distinctPatterns: byPattern.size,
            systemic: countScope('systemic'),
            partial: countScope('partial'),
            local: countScope('local')
        }
    };
}

module.exports = {
    mineOccurrences,
    normalizeSelector
};
