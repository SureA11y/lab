// The fields the report view keeps on each scan and each finding before it
// renders; everything else is dropped. A field a renderer reads has to be
// listed here, or it silently disappears from the report view while still
// working wherever the renderer is called directly (the extension, tests).

export const SCAN_FIELDS = Object.freeze([
    'id',
    'label',
    'scanTags',
    // What the scan checked against (shared/report-scan.js): its profile and
    // the WCAG version and level that came to.
    'profile',
    'wcag',
    // The same, as reports saved before recorded it, which report-scan.js
    // still reads.
    'wcagLevel',
    'wcagVersion',
    'conformanceProfile',
    // Standards whose own rules the scan added (["rgaa"]): their failures
    // are not failures of the conformance target.
    'optInRules',
    'context',
    'url',
    'screenshots',
    'viewportRatio',
    'report',
    'skipped',
    'skipInfo',
    'canonical',
    'summary',
    'includedInReport',
    'metrics',
    // A Merged scan step's scans as one (docs/design/merged-scan-design.md): the flag
    // and the contexts it was made from, which its card lists.
    'mergedScan',
    'contexts'
]);

export const FINDING_FIELDS = Object.freeze([
    'outcome',
    'ruleId',
    'id',
    'severity',
    'title',
    'help',
    'description',
    'helpUrl',
    'wcag',
    'provenance',
    'occurrences',
    // The language the engine wrote the finding in, marked on its text, and
    // the title's own when it differs: an RGAA rollup's is RGAA's French.
    'lang',
    'titleLang',
    // EN 301 549 clauses and RGAA criteria, shown next to the WCAG criteria.
    'en301549',
    'rgaa',
    // A criterion only some of whose checks the scan ran: how many were not
    // selected, of how many.
    'partlyChecked'
]);

// The parts of a scan's canonical result the report view reads.
export const CANONICAL_FIELDS = Object.freeze([
    'page',
    'findings',
    'engines',
    'engine',
    // Carries per-scan durationMs + estimatedNodes (the "⏱ … · DOM …" line
    // the live cards and the all-scans cards show), and page readiness.
    'diagnostics',
    // Notes on how the scan ran, shown under its header.
    'notices',
    // How close each measuring rule's passes came to failing.
    'margins',
    // The best-practice findings, listed apart from the requirements.
    'bestPractices'
]);

/**
 * "RGAA-only rules": the standards whose own rules a scan added on top of its
 * conformance target, or '' when it added none. Findings from those rules
 * fail no WCAG criterion, so the scan says so wherever its target is shown.
 */
export function optInRulesLabel(scan) {
    const tags = Array.isArray(scan?.optInRules) ? scan.optInRules.map(String).filter(Boolean) : [];
    return tags.length ? tags.map((t) => t.toUpperCase()).join(', ') + '-only rules' : '';
}

/**
 * A finding with only what the report view reads. Beyond FINDING_FIELDS, the
 * renderers need two small parts of larger objects: `meta.atomic`, which marks
 * a rollup (a WCAG or an RGAA criterion), with `meta.standard`, which says which, and `evidence.rollup`, the checks behind it, which the
 * "review the contributing checks" dialog lists for an undecided rollup that
 * matched no element. The rest of `meta` is rule metadata (tens of kilobytes
 * per scan) the view never shows, so it is left behind.
 */
export function pickFindingFields(finding) {
    if (!finding || typeof finding !== 'object') return finding;
    const out = {};
    for (const key of FINDING_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(finding, key)) out[key] = finding[key];
    }
    if (finding.meta && typeof finding.meta === 'object' && typeof finding.meta.atomic === 'boolean') {
        out.meta = {atomic: finding.meta.atomic};
        // Which standard a rollup is a criterion of (an RGAA one), which
        // RGAA's compliance rate reads.
        if (typeof finding.meta.standard === 'string') out.meta.standard = finding.meta.standard;
    }
    if (finding.evidence && typeof finding.evidence === 'object' && finding.evidence.rollup) {
        out.evidence = {rollup: finding.evidence.rollup};
    }
    return out;
}
