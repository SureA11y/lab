'use strict';

// What a report says about WCAG itself, rather than about rules.
//
// A rule id is the scanner's vocabulary. A success criterion is the standard's,
// and it is the one an audit, a VPAT, a procurement questionnaire and a legal
// deadline are all written in. Every report already carries the mapping — each
// scan's `metrics.coverageSummary` holds one verdict per criterion — but the
// comparison never read it, so a series could not answer "which parts of WCAG
// moved?".
//
// Two sources, in order:
//  - `coverage` — the per-scan coverageSummary the runner computed, merged
//    across the report's scans by taking the worst verdict any page reached.
//    A criterion that one page fails is a criterion the site fails.
//  - `derived` — no coverageSummary in the payload (an older export, or a
//    hand-assembled one), so the criteria are read off the findings themselves:
//    a failing rule's criteria do not support, a cantTell rule's need review.
//    Narrower than the real thing — it can only speak about criteria some rule
//    touched — and it says so, so nothing downstream claims coverage it lacks.
//
// EN 301 549 clauses come from the payload too, never from a table of our own:
// findings carry them (`en301549`, added by the lab for every engine, or
// surea11y's own `normativeMappings`). Chapter 9 restates WCAG clause by
// clause, so 9.1.4.3 is 1.4.3; what the report adds is which versions of the
// standard have the clause, since V3.2.1 restates WCAG 2.1 and V4.1.1 WCAG 2.2.
// A report from before the lab recorded them shows none rather than a guess.
//
// Levels come from the payload (`standards.normativeMappings[].conformanceLevel`,
// else the coverage entry's own `level`) and are never guessed: a criterion whose
// level the report does not state is grouped as unstated rather than assumed AA.
//
// Browser: globalThis.A11Y_REPORT_CONFORMANCE. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./report-scan.js'));
    } else {
        if (!root.A11Y_REPORT_SCAN) throw new Error('report-conformance.js: load report-scan.js first');
        root.A11Y_REPORT_CONFORMANCE = factory(root.A11Y_REPORT_SCAN);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (reportScan) {

    // VPAT-style statuses, worst first. The order is the merge rule: across the
    // scans of one report, the worst verdict any page reached is the report's.
    const STATUS_ORDER = [
        'doesNotSupport',
        'partiallySupports',
        'needsReview',
        'supports',
        'notApplicable',
        'notEvaluated',
    ];
    const STATUS_RANK = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]));

    // The four WCAG principles, read off the criterion number — 1.4.3 is
    // Perceivable because it starts with 1. No table to drift out of date, and
    // the gloss is what the principle means for a person, not its formal name.
    const PRINCIPLES = {
        1: { id: '1', name: 'Perceivable', gloss: 'Can people take it in at all?' },
        2: { id: '2', name: 'Operable', gloss: 'Can people work the controls?' },
        3: { id: '3', name: 'Understandable', gloss: 'Can people follow what happens?' },
        4: { id: '4', name: 'Robust', gloss: 'Does it hold up in their own tools?' },
    };
    const PRINCIPLE_IDS = ['1', '2', '3', '4'];
    const LEVELS = ['A', 'AA', 'AAA'];

    function asArray(v) { return Array.isArray(v) ? v : []; }
    function str(v) { return (typeof v === 'string' && v.trim()) ? v.trim() : null; }

    function principleOf(sc) {
        const head = String(sc || '').split('.')[0];
        return PRINCIPLES[head] ? head : null;
    }
    function levelOf(v) {
        const up = String(v || '').toUpperCase();
        return LEVELS.includes(up) ? up : null;
    }

    /** A criterion fails when it does not support, or supports only in part. */
    function isFailing(status) {
        return status === 'doesNotSupport' || status === 'partiallySupports';
    }
    /** A verdict automation reached rather than declined. */
    function isConcluded(status) {
        return status === 'doesNotSupport' || status === 'partiallySupports'
            || status === 'supports' || status === 'notApplicable';
    }

    function worse(a, b) {
        if (!a) return b;
        if (!b) return a;
        return (STATUS_RANK[a] ?? 99) <= (STATUS_RANK[b] ?? 99) ? a : b;
    }

    // ---- source 1: the coverage summaries the runner already computed --------

    function coverageSummariesOf(report) {
        const out = [];
        for (const scan of asArray(report && report.scans)) {
            const summary = (scan && scan.metrics && scan.metrics.coverageSummary)
                || (scan && scan.coverageSummary)
                || null;
            if (summary && asArray(summary.criteria).length) out.push(summary);
        }
        // A merged portfolio summary, when the payload still carries one. Used
        // only as a fallback: per-scan entries carry the same criteria and are
        // what survives the app recomputing a loaded report's globals.
        if (!out.length) {
            const portfolio = (report && report.metrics && report.metrics.coverageSummary)
                || (report && report.metrics && report.metrics.a11ySummary
                    && report.metrics.a11ySummary.coverageSummary)
                || null;
            if (portfolio && asArray(portfolio.criteria).length) out.push(portfolio);
        }
        return out;
    }

    function fromCoverage(summaries) {
        const bySc = new Map();

        for (const summary of summaries) {
            for (const entry of asArray(summary.criteria)) {
                const sc = str(entry && entry.sc);
                if (!sc) continue;

                const existing = bySc.get(sc) || {
                    sc, level: null, status: null, failCount: 0, occurrenceCount: 0, ruleIds: [],
                };
                existing.level = existing.level || levelOf(entry.level);
                existing.status = worse(existing.status, str(entry.status) || 'notEvaluated');
                existing.failCount += Number(entry.failCount) || 0;
                existing.occurrenceCount += Number(entry.occurrenceCount) || 0;
                for (const id of asArray(entry.ruleIds)) {
                    const clean = str(id);
                    if (clean && !existing.ruleIds.includes(clean)) existing.ruleIds.push(clean);
                }
                bySc.set(sc, existing);
            }
        }
        return bySc;
    }

    // ---- source 2: the findings, when no coverage summary was written --------

    // `scNormative` is what a rule enforces; `sc` also carries informative
    // references, and counting those would attribute criteria to a verdict no
    // rule actually tested.
    function normativeScOf(finding) {
        const wcag = finding && finding.wcag ? finding.wcag : null;
        if (!wcag) return [];
        const list = Array.isArray(wcag.scNormative) ? wcag.scNormative : asArray(wcag.sc);
        return list
            .map((entry) => str((entry && typeof entry === 'object') ? entry.ref : entry))
            .filter(Boolean);
    }

    function mappedLevel(finding, sc) {
        for (const m of asArray(finding && finding.standards && finding.standards.normativeMappings)) {
            if (!m || typeof m !== 'object') continue;
            if (str(m.requirement) !== sc) continue;
            const level = levelOf(m.conformanceLevel);
            if (level) return level;
        }
        return null;
    }

    function fromFindings(report) {
        const bySc = new Map();

        for (const scan of asArray(report && report.scans)) {
            for (const finding of asArray(scan && scan.canonical && scan.canonical.findings)) {
                if (!finding) continue;

                const outcome = String(finding.outcome || '');
                let status = null;
                if (outcome === 'fail') status = 'doesNotSupport';
                else if (outcome === 'cantTell') status = 'needsReview';
                else if (outcome === 'pass') status = 'supports';
                else if (outcome === 'notApplicable') status = 'notApplicable';
                if (!status) continue;

                const ruleId = str(finding.ruleId) || str(finding.id);
                const occurrences = asArray(finding.occurrences).length;

                for (const sc of normativeScOf(finding)) {
                    const existing = bySc.get(sc) || {
                        sc, level: null, status: null, failCount: 0, occurrenceCount: 0, ruleIds: [],
                    };
                    existing.level = existing.level || mappedLevel(finding, sc);
                    existing.status = worse(existing.status, status);
                    if (status === 'doesNotSupport') {
                        existing.failCount += 1;
                        existing.occurrenceCount += occurrences;
                    }
                    if (ruleId && !existing.ruleIds.includes(ruleId)) existing.ruleIds.push(ruleId);
                    bySc.set(sc, existing);
                }
            }
        }
        return bySc;
    }

    // ---- EN 301 549 clauses, as the report's findings name them ---------------

    function addClause(bySc, clause, versions) {
        const c = str(clause);
        // Only chapter 9 (web content) maps one to one onto a WCAG criterion.
        const m = c ? /^9\.(\d+\.\d+\.\d+)$/.exec(c) : null;
        if (!m) return;
        const entry = bySc.get(m[1]) || { clause: c, versions: [] };
        for (const v of versions) {
            const clean = str(v);
            if (clean && !entry.versions.includes(clean)) entry.versions.push(clean);
        }
        bySc.set(m[1], entry);
    }

    function en301549BySc(report) {
        const bySc = new Map();
        for (const scan of asArray(report && report.scans)) {
            for (const finding of asArray(scan && scan.canonical && scan.canonical.findings)) {
                if (!finding) continue;
                for (const e of asArray(finding.en301549)) {
                    if (e && typeof e === 'object') addClause(bySc, e.clause, asArray(e.versions));
                }
                for (const m of asArray(finding.standards && finding.standards.normativeMappings)) {
                    if (m && m.standard === 'EN 301 549') addClause(bySc, m.requirement, [m.version]);
                }
            }
        }
        for (const entry of bySc.values()) entry.versions.sort();
        return bySc;
    }

    // ---- RGAA criteria, as the report's findings name them --------------------

    // RGAA relates to WCAG many to many, so a criterion row lists only the RGAA
    // criteria named by the findings that failed or could not be decided on
    // that WCAG criterion: the ones the row is about. Passing rules name RGAA
    // criteria too, and counting them would put RGAA 2.1 (frames) next to a
    // 4.1.2 failure that was an unnamed link. Findings carry RGAA criteria
    // only from scans that targeted RGAA.
    function byNumber(a, b) { return a.localeCompare(b, undefined, { numeric: true }); }

    function rgaaBySc(report) {
        const bySc = new Map();
        for (const scan of asArray(report && report.scans)) {
            for (const finding of asArray(scan && scan.canonical && scan.canonical.findings)) {
                const outcome = String((finding && finding.outcome) || '');
                if (outcome !== 'fail' && outcome !== 'cantTell') continue;
                const criteria = asArray(finding && finding.rgaa).map((e) => str(e && e.criterion)).filter(Boolean);
                if (!criteria.length) continue;
                for (const sc of normativeScOf(finding)) {
                    const set = bySc.get(sc) || new Set();
                    for (const c of criteria) set.add(c);
                    bySc.set(sc, set);
                }
            }
        }
        return new Map([...bySc].map(([sc, set]) => [sc, [...set].sort(byNumber)]));
    }

    // ---- Other standards' requirements, as the report's findings name them ---
    //
    // A standard from a pack (RGAA's, BITV's) names its requirements in a
    // finding's normativeMappings, each with the WCAG criteria it corresponds
    // to (wcagSc). As for RGAA above, a criterion row lists the ones named by
    // findings that failed or could not be decided on it.
    function standardsBySc(report) {
        const bySc = new Map(); // sc -> Map(standard -> Set(requirement))
        for (const scan of asArray(report && report.scans)) {
            for (const finding of asArray(scan && scan.canonical && scan.canonical.findings)) {
                const outcome = String((finding && finding.outcome) || '');
                if (outcome !== 'fail' && outcome !== 'cantTell') continue;
                const legacyRgaa = asArray(finding.rgaa).length > 0;
                const own = normativeScOf(finding);
                for (const m of asArray(finding.standards && finding.standards.normativeMappings)) {
                    const standard = str(m && m.standard);
                    if (!standard || !str(m.requirement) || standard === 'WCAG' || standard === 'EN 301 549') continue;
                    if (standard === 'RGAA' && legacyRgaa) continue;
                    for (const sc of own.length ? own : asArray(m.wcagSc).map(str).filter(Boolean)) {
                        const byStd = bySc.get(sc) || new Map();
                        const set = byStd.get(standard) || new Set();
                        set.add(str(m.requirement));
                        byStd.set(standard, set);
                        bySc.set(sc, byStd);
                    }
                }
            }
        }
        return new Map([...bySc].map(([sc, byStd]) => [sc, toStandards(byStd)]));
    }

    function toStandards(byStd) {
        return [...byStd].sort(([a], [b]) => a.localeCompare(b))
            .map(([standard, set]) => ({ standard, requirements: [...set].sort(byNumber) }));
    }

    function mergeStandards(a, b) {
        if (!a && !b) return null;
        const byStd = new Map();
        for (const e of [...(a || []), ...(b || [])]) {
            const set = byStd.get(e.standard) || new Set();
            for (const r of e.requirements) set.add(r);
            byStd.set(e.standard, set);
        }
        return toStandards(byStd);
    }

    function mergeRgaa(a, b) {
        if (!a || !a.length) return b && b.length ? b.slice() : null;
        if (!b || !b.length) return a;
        return [...new Set([...a, ...b])].sort(byNumber);
    }

    function mergeClause(a, b) {
        if (!a) return b ? { clause: b.clause, versions: b.versions.slice() } : null;
        if (!b) return a;
        const versions = a.versions.slice();
        for (const v of b.versions) if (!versions.includes(v)) versions.push(v);
        return { clause: a.clause, versions: versions.sort() };
    }

    // ---- the standard the scans checked against ------------------------------

    // The standard every scan of a report shares (report-scan.js), null when
    // none checked one, or 'mixed'. Skipped scans did not check anything.
    function reportTarget(report) {
        const ids = new Set();
        for (const scan of asArray(report && report.scans)) {
            if (!scan || scan.skipped || scan.skipInfo) continue;
            ids.add(str(reportScan.scanListingStandardId(scan)));
        }
        if (ids.size > 1) return 'mixed';
        return ids.size ? [...ids][0] : null;
    }

    /** The target a set of conformances shares, as reportTarget reads it. */
    function sharedTarget(list) {
        const ids = new Set(asArray(list).map((conf) => (conf ? conf.target : null)));
        if (ids.size !== 1) return 'mixed';
        return [...ids][0];
    }

    const EN301549_TARGET_VERSIONS = { 'en301549-v4.1.1': 'V4.1.1', 'en301549-v3.2.1': 'V3.2.1' };

    /**
     * The EN 301 549 clause to show for a criterion, given the standard the
     * scans shared: under one EN 301 549 version, that version's clause only,
     * with the version marked as implied; under another standard (Section
     * 508, WCAG 2.2 AA, RGAA), none, since their audits are not written in
     * EN 301 549's terms; with no standard or mixed ones, the clause as the
     * reports named it, as a cross-reference.
     */
    function en301549ForTarget(entry, target) {
        if (!entry || !target || target === 'mixed') return entry || null;
        const version = EN301549_TARGET_VERSIONS[target];
        if (!version || !asArray(entry.versions).includes(version)) return null;
        return { clause: entry.clause, versions: [version], versionImplied: true };
    }

    // ---- rollups ------------------------------------------------------------

    function emptyBucket() {
        return { failing: 0, concluded: 0, needsReview: 0, supports: 0, total: 0 };
    }

    function tally(bucket, status) {
        bucket.total += 1;
        if (isFailing(status)) bucket.failing += 1;
        if (isConcluded(status)) bucket.concluded += 1;
        if (status === 'needsReview') bucket.needsReview += 1;
        if (status === 'supports') bucket.supports += 1;
        return bucket;
    }

    function sortCriteria(list) {
        return list.slice().sort((a, b) => a.sc.localeCompare(b.sc, undefined, { numeric: true }));
    }

    /**
     * One report's WCAG picture.
     *
     * @param {object} report a parsed report payload
     * @returns {{source: 'coverage'|'derived'|'none', criteria: object[],
     *   byStatus: object, byLevel: object, byPrinciple: object, totals: object}}
     */
    function readConformance(report) {
        const summaries = coverageSummariesOf(report);
        const source = summaries.length ? 'coverage' : 'derived';
        const bySc = summaries.length ? fromCoverage(summaries) : fromFindings(report);
        const clauses = en301549BySc(report);
        const rgaa = rgaaBySc(report);
        const standards = standardsBySc(report);

        const criteria = sortCriteria(Array.from(bySc.values()).map((entry) => ({
            ...entry,
            status: entry.status || 'notEvaluated',
            principle: principleOf(entry.sc),
            en301549: clauses.get(entry.sc) || null,
            rgaa: rgaa.get(entry.sc) || null,
            // Only where a finding names another standard's requirement.
            ...(standards.has(entry.sc) ? { standards: standards.get(entry.sc) } : {}),
        })));

        const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
        const byLevel = Object.fromEntries([...LEVELS, 'unstated'].map((l) => [l, emptyBucket()]));
        const byPrinciple = Object.fromEntries(PRINCIPLE_IDS.map((p) => [p, emptyBucket()]));

        for (const entry of criteria) {
            if (byStatus[entry.status] == null) byStatus[entry.status] = 0;
            byStatus[entry.status] += 1;
            tally(byLevel[entry.level || 'unstated'], entry.status);
            if (entry.principle) tally(byPrinciple[entry.principle], entry.status);
        }

        const failing = criteria.filter((c) => isFailing(c.status)).length;
        const concluded = criteria.filter((c) => isConcluded(c.status)).length;

        return {
            source: criteria.length ? source : 'none',
            target: reportTarget(report),
            criteria,
            byStatus,
            byLevel,
            byPrinciple,
            totals: {
                failing,
                concluded,
                needsReview: byStatus.needsReview || 0,
                known: criteria.length,
                // Of the criteria automation could conclude on, the share it
                // found no problem with. The honest headline: a pass rate read
                // against all of WCAG would count criteria nothing ever tested.
                passShare: concluded ? (concluded - failing) / concluded : null,
            },
        };
    }

    /**
     * The criterion-by-column matrix, for a series of already-read conformances.
     * Only criteria some column has something to say about appear; a column that
     * never reached one carries 'notEvaluated' there, which is not the same as
     * passing it.
     */
    function conformanceMatrix(list) {
        const order = [];
        const seen = new Map();

        for (const conf of list) {
            for (const entry of (conf ? conf.criteria : [])) {
                if (!seen.has(entry.sc)) {
                    seen.set(entry.sc, {
                        sc: entry.sc, level: entry.level, principle: entry.principle,
                        en301549: mergeClause(null, entry.en301549),
                        rgaa: mergeRgaa(null, entry.rgaa),
                        ...(entry.standards ? { standards: mergeStandards(null, entry.standards) } : {}),
                    });
                    order.push(entry.sc);
                } else {
                    const meta = seen.get(entry.sc);
                    if (!meta.level && entry.level) meta.level = entry.level;
                    meta.en301549 = mergeClause(meta.en301549, entry.en301549);
                    meta.rgaa = mergeRgaa(meta.rgaa, entry.rgaa);
                    if (entry.standards) meta.standards = mergeStandards(meta.standards, entry.standards);
                }
            }
        }

        return sortCriteria(order.map((sc) => {
            const meta = seen.get(sc);
            const statuses = list.map((conf) => {
                const hit = conf && conf.criteria.find((c) => c.sc === sc);
                return hit ? hit.status : 'notEvaluated';
            });
            const failures = statuses.filter(isFailing).length;
            return {
                ...meta,
                statuses,
                failing: statuses.map(isFailing),
                columns: failures,
                // Fails everywhere it was looked at, and was looked at more than
                // once: the systemic ones, whatever the column set means.
                everywhere: failures > 0 && failures === statuses.filter(isConcluded).length,
            };
        })).filter((row) => row.columns > 0 || row.statuses.some((s) => s === 'needsReview'));
    }

    // ---- RGAA's compliance rate -----------------------------------------------

    // The RGAA criterion an RGAA rollup finding stands for. Under the RGAA
    // profile core returns a rollup per criterion, which the adapter splits
    // into one finding per outcome; a rule's own finding also names criteria,
    // but it is not a verdict on one.
    function rgaaRollupCriterionOf(finding) {
        const meta = finding && finding.meta;
        if (!meta || meta.atomic !== false || !/^rgaa$/i.test(str(meta.standard) || '')) return null;
        const first = asArray(finding.rgaa)[0];
        return str(first && first.criterion);
    }

    const RGAA_STATUS_RANK = { fail: 0, cantTell: 1, pass: 2, notApplicable: 3 };
    function worseRgaa(a, b) {
        if (!a) return b;
        return RGAA_STATUS_RANK[b] < RGAA_STATUS_RANK[a] ? b : a;
    }

    /**
     * RGAA's compliance rate for a set of scans that targeted it, read the way
     * an RGAA audit reads its sample: a criterion is not met if it fails on
     * any page, met if it passes on every page where it applies, and not
     * applicable if it applies nowhere. The rate is met / (met + not met).
     *
     * An audit judges every criterion; here only the automated checks did, so
     * a criterion they left undecided on some page (and failed on none) is
     * counted apart, as to verify, and stays out of the rate. A "met" here
     * means the automated checks found nothing wrong, not that a person has
     * confirmed it. Null when no scan carries RGAA rollups.
     *
     * -> { pages, criteria, met, notMet, toVerify, notApplicable, rate }
     */
    function rgaaComplianceRate(scans) {
        const byCriterion = new Map();
        let pages = 0;
        for (const scan of asArray(scans)) {
            if (!scan || scan.skipped || scan.skipInfo || !scan.canonical) continue;
            const page = new Map();
            for (const finding of asArray(scan.canonical.findings)) {
                const criterion = rgaaRollupCriterionOf(finding);
                const outcome = finding && finding.outcome;
                if (!criterion || !(outcome in RGAA_STATUS_RANK)) continue;
                page.set(criterion, worseRgaa(page.get(criterion), outcome));
            }
            if (!page.size) continue;
            pages += 1;
            for (const [criterion, status] of page) {
                byCriterion.set(criterion, worseRgaa(byCriterion.get(criterion), status));
            }
        }
        if (!pages) return null;

        let met = 0, notMet = 0, toVerify = 0, notApplicable = 0;
        for (const status of byCriterion.values()) {
            if (status === 'fail') notMet += 1;
            else if (status === 'cantTell') toVerify += 1;
            else if (status === 'pass') met += 1;
            else notApplicable += 1;
        }
        return {
            pages,
            criteria: byCriterion.size,
            met, notMet, toVerify, notApplicable,
            rate: met + notMet ? met / (met + notMet) : null,
        };
    }

    return {
        readConformance,
        conformanceMatrix,
        rgaaComplianceRate,
        sharedTarget,
        en301549ForTarget,
        isFailing,
        isConcluded,
        principleOf,
        PRINCIPLES,
        PRINCIPLE_IDS,
        LEVELS,
        STATUS_ORDER,
    };
}));
