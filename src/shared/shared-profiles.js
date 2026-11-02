'use strict';

/**
 * shared-profiles.js (shared)
 *
 * Reports compared on the profiles they share. Reports checked against
 * different profiles don't line up row for row: one checked WCAG 2.2 AA and
 * WAI-ARIA 1.2 lists WAI-ARIA's requirements, which one checked against WCAG
 * 2.2 AA alone has nothing to set beside. When every scan of every report
 * shares some profiles, the comparison reads each report as if it had been
 * checked against those alone:
 *
 * - a standard counts when every scan checked against it;
 * - WCAG levels nest, so WCAG counts at the lowest level every scan checked
 *   (a WCAG 2.2 AAA scan is read at AA beside an AA one, its AAA criteria
 *   left out);
 * - a requirement's row stays when it belongs to a profile kept (a scan of
 *   several profiles says whose each row is; a scan of one, that one's);
 * - a rule's own finding takes the worst of what the profiles kept make of
 *   it (its verdicts), and goes when none of them checked it;
 * - each scan's profiles, and its WCAG level, become the shared ones, and a
 *   report's own score, made from everything it checked, is left out.
 *
 * Reports that all checked the same profiles are returned as they are, and so
 * are reports that share none: the comparison then says they were checked
 * against different things.
 *
 * Browser: available as globalThis.A11Y_SHARED_PROFILES (after report-scan.js
 *          and wcag-criteria.js).
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(() => require('./report-scan.js'), () => require('./wcag-criteria.js'));
    } else {
        root.A11Y_SHARED_PROFILES = factory(() => root.A11Y_REPORT_SCAN, () => root.A11Y_WCAG_CRITERIA);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (reportScanOf, wcagCriteriaOf) {

    const LEVELS = ['A', 'AA', 'AAA'];
    const WCAG_ID = /^wcag22-(a{1,3})$/;
    const OUTCOME_RANK = { notApplicable: 0, pass: 1, cantTell: 2, fail: 3 };

    const asArray = (v) => (Array.isArray(v) ? v : []);
    const levelOfId = (id) => {
        const m = WCAG_ID.exec(String(id || ''));
        return m ? m[1].toUpperCase() : null;
    };
    const wcagLabel = (level) => `WCAG 2.2 ${level}`;
    const wcagId = (level) => `wcag22-${level.toLowerCase()}`;

    function analyzedScans(report) {
        return asArray(report && report.scans).filter((s) => s && !s.skipped && !s.skipInfo);
    }

    /**
     * What a scan checked against: { wcag: 'AA' | null, standards: Map(id ->
     * label), known }. `known` is false when it checked a WCAG level no
     * profile names (an older report of WCAG 2.1, say), which can't be
     * narrowed.
     */
    function profilesOfScan(scan) {
        const reportScan = reportScanOf();
        let wcag = null;
        let known = true;
        const standards = new Map();
        for (const p of reportScan.scanProfiles(scan)) {
            const level = levelOfId(p.id);
            if (level) wcag = level;
            else if (p.id) standards.set(p.id, p.label || p.id);
            else known = false;
        }
        return { wcag, standards, known };
    }

    /**
     * The profiles every scan of every report shares, and what each report
     * checked beyond them: { wcag, standards: [{ id, label }], leftOut:
     * [{ id, label }], same } or null when a scan's profiles can't be read.
     */
    function sharedProfiles(reports) {
        const scans = reports.flatMap(analyzedScans);
        if (!scans.length) return null;
        const each = scans.map(profilesOfScan);
        if (each.some((p) => !p.known)) return null;

        const levels = each.map((p) => p.wcag);
        const wcag = levels.every(Boolean)
            ? LEVELS[Math.min(...levels.map((l) => LEVELS.indexOf(l)))]
            : null;
        const labels = new Map();
        for (const p of each) for (const [id, label] of p.standards) labels.set(id, label);
        const standards = [...labels.keys()]
            .filter((id) => each.every((p) => p.standards.has(id)))
            .map((id) => ({ id, label: labels.get(id) }));

        const leftOut = [];
        // A WCAG level some scan checked beyond the shared one, or WCAG itself
        // when not every scan checked it.
        const higher = [...new Set(levels.filter(Boolean))]
            .filter((l) => !wcag || LEVELS.indexOf(l) > LEVELS.indexOf(wcag))
            .sort((x, y) => LEVELS.indexOf(x) - LEVELS.indexOf(y));
        for (const l of higher) leftOut.push({ id: wcagId(l), label: wcag ? `${wcagLabel(l)}'s criteria above ${wcag}` : wcagLabel(l) });
        for (const [id, label] of labels) {
            if (!standards.some((s) => s.id === id)) leftOut.push({ id, label });
        }
        const same = each.every((p) => p.wcag === each[0].wcag
            && p.standards.size === each[0].standards.size
            && [...p.standards.keys()].every((id) => each[0].standards.has(id)));
        return { wcag, standards, leftOut, same };
    }

    // The WCAG levels of a finding's criteria; [] when it names none.
    function criteriaLevels(finding) {
        const crit = wcagCriteriaOf();
        const scs = asArray(finding && finding.wcag && finding.wcag.sc).map(String);
        return scs.map((sc) => {
            const c = crit && crit.criterionBySc ? crit.criterionBySc(sc) : null;
            return c && LEVELS.includes(c.level) ? c.level : null;
        }).filter(Boolean);
    }

    // Whether a WCAG finding goes beyond the shared level: every criterion it
    // names is above it.
    function aboveLevel(finding, level) {
        if (!level) return false;
        const levels = criteriaLevels(finding);
        return levels.length > 0 && levels.every((l) => LEVELS.indexOf(l) > LEVELS.indexOf(level));
    }

    function worstOf(verdicts, ids) {
        let worst = null;
        for (const id of ids) {
            const v = verdicts && verdicts[id];
            if (OUTCOME_RANK[v] === undefined) continue;
            if (!worst || OUTCOME_RANK[v] > OUTCOME_RANK[worst]) worst = v;
        }
        return worst;
    }

    /**
     * A scan's findings read against the profiles kept: `kept` the ids of the
     * scan's own profiles that stay, `level` the shared WCAG level.
     */
    function narrowFindings(findings, { own, kept, level }) {
        const out = [];
        for (const f of asArray(findings)) {
            if (!f || typeof f !== 'object') continue;
            if (f.bestPractice === true) { out.push(f); continue; }
            const rollup = f.meta && f.meta.atomic === false;
            const rollupProfiles = rollup && f.evidence && f.evidence.rollup && Array.isArray(f.evidence.rollup.profiles)
                ? f.evidence.rollup.profiles : null;
            if (rollup) {
                // Whose row it is: the profiles that gave it, or the scan's one.
                const whose = rollupProfiles || own;
                if (!whose.some((id) => kept.includes(id))) continue;
                if (aboveLevel(f, level)) continue;
                out.push(f);
                continue;
            }
            // A rule's own finding: what the profiles kept make of it.
            if (f.verdicts && typeof f.verdicts === 'object') {
                const outcome = worstOf(f.verdicts, kept);
                if (!outcome) continue;
                if (aboveLevel(f, level)) continue;
                const occurrences = asArray(f.occurrences).map((o) => {
                    const v = o && o.verdicts ? worstOf(o.verdicts, kept) : null;
                    if (!v || v === o.occurrenceOutcome) return o;
                    const copy = { ...o, occurrenceOutcome: v === 'fail' || v === 'cantTell' ? v : undefined };
                    if (copy.occurrenceOutcome === undefined) delete copy.occurrenceOutcome;
                    return copy;
                });
                out.push({ ...f, outcome, occurrences });
                continue;
            }
            if (!own.some((id) => kept.includes(id))) continue;
            if (aboveLevel(f, level)) continue;
            out.push(f);
        }
        return out;
    }

    // A coverage summary's criteria up to the shared level.
    function narrowCoverage(summary, level) {
        if (!summary || typeof summary !== 'object' || !level) return summary;
        const criteria = asArray(summary.criteria).filter((c) => !c || !LEVELS.includes(c.level)
            || LEVELS.indexOf(c.level) <= LEVELS.indexOf(level));
        return { ...summary, criteria };
    }

    function narrowScan(scan, shared) {
        if (!scan || scan.skipped || scan.skipInfo) return scan;
        const mine = profilesOfScan(scan);
        const own = [...(mine.wcag ? [wcagId(mine.wcag)] : []), ...mine.standards.keys()];
        const kept = [...(shared.wcag && mine.wcag ? [wcagId(mine.wcag)] : []), ...shared.standards.map((s) => s.id)];
        const level = shared.wcag;
        const canonical = scan.canonical && typeof scan.canonical === 'object'
            ? {
                ...scan.canonical,
                findings: narrowFindings(scan.canonical.findings, { own, kept, level }),
            }
            : scan.canonical;
        const profiles = [
            ...(shared.wcag ? [{ id: wcagId(shared.wcag), label: wcagLabel(shared.wcag) }] : []),
            ...shared.standards,
        ];
        const out = {
            ...scan,
            canonical,
            profile: profiles.find((p) => !WCAG_ID.test(p.id)) || profiles[0] || null,
            wcag: { ...(scan.wcag || {}), version: (scan.wcag && scan.wcag.version) || '2.2', level: shared.wcag || (scan.wcag && scan.wcag.level) || null },
        };
        if (profiles.length > 1) out.profiles = profiles;
        else delete out.profiles;
        delete out.profilesNotRun;
        for (const old of ['wcagLevel', 'wcagVersion', 'conformanceProfile']) delete out[old];
        if (scan.metrics && scan.metrics.coverageSummary) out.metrics = { ...scan.metrics, coverageSummary: narrowCoverage(scan.metrics.coverageSummary, level) };
        if (scan.coverageSummary) out.coverageSummary = narrowCoverage(scan.coverageSummary, level);
        return out;
    }

    function narrowReport(report, shared) {
        if (!report || typeof report !== 'object') return report;
        const out = { ...report, scans: asArray(report.scans).map((s) => narrowScan(s, shared)) };
        // Its score and summary were made from everything it checked.
        if (report.metrics && report.metrics.a11ySummary) {
            const { scores: _scores, coverageSummary, ...rest } = report.metrics.a11ySummary;
            out.metrics = {
                ...report.metrics,
                a11ySummary: { ...rest, ...(coverageSummary ? { coverageSummary: narrowCoverage(coverageSummary, shared.wcag) } : {}) },
            };
            if (report.metrics.coverageSummary) out.metrics.coverageSummary = narrowCoverage(report.metrics.coverageSummary, shared.wcag);
        }
        return out;
    }

    /**
     * The reports read on the profiles they share.
     * -> { reports, basis }: `basis` null when they all checked the same
     *    profiles, or can't be read (the reports come back as they are);
     *    { comparedOn: [], leftOut } when they share none (also as they
     *    are); else { comparedOn: [{ id, label }], leftOut: [{ id, label }] }
     *    with the reports narrowed.
     */
    function compareOnShared(reports) {
        const list = asArray(reports);
        const shared = sharedProfiles(list.filter(Boolean));
        if (!shared || shared.same) return { reports: list, basis: null };
        const comparedOn = [
            ...(shared.wcag ? [{ id: wcagId(shared.wcag), label: wcagLabel(shared.wcag) }] : []),
            ...shared.standards,
        ];
        if (!comparedOn.length) return { reports: list, basis: { comparedOn, leftOut: shared.leftOut } };
        return {
            reports: list.map((r) => narrowReport(r, shared)),
            basis: { comparedOn, leftOut: shared.leftOut },
        };
    }

    /** "Compared on WCAG 2.2 AA, which every report checked. Left out: WAI-ARIA 1.2." */
    function basisSentence(basis) {
        if (!basis || !asArray(basis.comparedOn).length) return null;
        const on = basis.comparedOn.map((p) => p.label).join(' + ');
        const out = asArray(basis.leftOut).map((p) => p.label);
        return `Compared on ${on}, which every report checked.`
            + (out.length ? ` Left out, as not every report checked it: ${out.join(', ')}.` : '');
    }

    return { compareOnShared, sharedProfiles, basisSentence };
}));
