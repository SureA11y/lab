'use strict';

/**
 * The EN 301 549 clauses that restate a finding's WCAG criteria, for an
 * engine that cannot apply EN 301 549 itself, from the table of EN 301 549's
 * pack (@surea11y/pack-en301549). Chapter 9 of EN 301 549 restates WCAG
 * Level A and AA, but each version restates a different WCAG: V3.2.1 is WCAG
 * 2.1 (and keeps 4.1.1 Parsing), V4.1.1 is WCAG 2.2. So 2.5.8 only has a
 * V4.1.1 clause, 4.1.1 only a V3.2.1 one, and AAA criteria have none.
 *
 * finding.en301549 = [{ clause: '9.1.1.1', title: 'Non-text content',
 *                       versions: ['V3.2.1', 'V4.1.1'], wcagSc: ['1.1.1'] }]
 *
 * `wcagSc` is the WCAG criterion the clause restates, which groups the
 * finding with WCAG's when the report is grouped by WCAG criteria.
 *
 * Only the criteria a finding claims as normative count, when the engine
 * says which those are, so a manual check that merely points at a criterion
 * does not gain a clause.
 *
 * A scan names EN 301 549 only when it checked against it, as surea11y's own
 * results do under its profile: annotateEn301549 adds the clauses of the
 * version the scan targeted, and nothing to a scan of another target.
 * surea11y needs none of this: core names the clauses itself.
 */

const { en301549ClausesForSc } = require('@surea11y/pack-en301549/public');

// The EN 301 549 version each EN 301 549 target checks.
const TARGET_VERSIONS = { 'en301549-v4.1.1': 'V4.1.1', 'en301549-v3.2.1': 'V3.2.1' };

const SC_RE = /\b(\d+\.\d+\.\d+)\b/;

function scTokens(finding) {
    const wcag = finding && finding.wcag && typeof finding.wcag === 'object' ? finding.wcag : {};
    const list = Array.isArray(wcag.scNormative) ? wcag.scNormative : (Array.isArray(wcag.sc) ? wcag.sc : []);
    const out = [];
    for (const item of list) {
        const raw = item && typeof item === 'object' ? item.ref : item;
        const m = SC_RE.exec(String(raw || ''));
        if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
}

function en301549ForFinding(finding) {
    const byClause = new Map();
    for (const sc of scTokens(finding)) {
        for (const c of en301549ClausesForSc(sc)) {
            const entry = byClause.get(c.clause) || { clause: c.clause, title: c.title, versions: [], wcagSc: [sc] };
            if (!entry.versions.includes(c.version)) entry.versions.push(c.version);
            byClause.set(c.clause, entry);
        }
    }
    return [...byClause.values()]
        .map((e) => ({ ...e, versions: e.versions.sort() }))
        .sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }));
}

/**
 * Sets each finding's clauses of the version `profile` (an EN 301 549
 * target's id) targets, and clears them from every finding of a scan with
 * another target or none.
 */
function annotateEn301549(canonical, { profile = null } = {}) {
    const version = TARGET_VERSIONS[profile] || null;
    const findings = canonical && Array.isArray(canonical.findings) ? canonical.findings : [];
    for (const f of findings) {
        if (!f || typeof f !== 'object') continue;
        const clauses = version
            ? en301549ForFinding(f).filter((c) => c.versions.includes(version)).map((c) => ({ ...c, versions: [version] }))
            : [];
        if (clauses.length) f.en301549 = clauses;
        else delete f.en301549;
    }
    return canonical;
}

/**
 * The EN 301 549 clauses surea11y's results name themselves, under an EN 301
 * 549 profile (core's normativeMappings), set as each finding's `en301549`,
 * which is what the reports read: the mappings are not kept in them.
 */
function en301549FromMappings(canonical) {
    const lists = canonical ? [canonical.findings, canonical.bestPractices] : [];
    for (const f of lists.flatMap((l) => (Array.isArray(l) ? l : []))) {
        if (!f || typeof f !== 'object') continue;
        const mappings = f.standards && Array.isArray(f.standards.normativeMappings) ? f.standards.normativeMappings : [];
        const byClause = new Map();
        for (const m of mappings) {
            if (!m || m.standard !== 'EN 301 549' || !m.requirement) continue;
            const clause = String(m.requirement);
            const entry = byClause.get(clause) || { clause, title: m.title ? String(m.title) : '', versions: [], wcagSc: [] };
            if (m.version && !entry.versions.includes(String(m.version))) entry.versions.push(String(m.version));
            for (const sc of Array.isArray(m.wcagSc) ? m.wcagSc : []) {
                if (!entry.wcagSc.includes(String(sc))) entry.wcagSc.push(String(sc));
            }
            byClause.set(clause, entry);
        }
        const clauses = [...byClause.values()]
            .map((e) => ({ ...e, versions: e.versions.sort() }))
            .sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }));
        if (clauses.length) f.en301549 = clauses;
        else delete f.en301549;
    }
    return canonical;
}

module.exports = { en301549ForFinding, annotateEn301549, en301549FromMappings };
