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
 *   report's own score, made from everything it checked, is left out, to be
 *   scored again on what is compared where its report kept what to score
 *   it from (rescoreReport).
 *
 * Reports that all checked the same profiles are returned as they are, and so
 * are reports that share none: the comparison then says they were checked
 * against different things.
 *
 * A comparison can also be read on fewer profiles than the reports share,
 * the reader turning some off (prepareComparison), and a report read on
 * fewer profiles than it checked is scored again on what is left
 * (rescoreReport), from the page measurements it kept.
 *
 * Browser: available as globalThis.A11Y_SHARED_PROFILES (after report-scan.js
 *          and wcag-criteria.js; a11y-summary.js and global-summary.js to
 *          score again).
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            () => require('./report-scan.js'),
            () => require('./wcag-criteria.js'),
            () => require('./a11y-summary.js'),
            () => require('./global-summary.js'),
        );
    } else {
        // The scores are read when a comparison runs, and only if loaded: a
        // page without them compares as before, its scores left out.
        root.A11Y_SHARED_PROFILES = factory(
            () => root.A11Y_REPORT_SCAN,
            () => root.A11Y_WCAG_CRITERIA,
            () => root.A11Y_SUMMARY,
            () => root.A11Y_GLOBAL_SUMMARY,
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (reportScanOf, wcagCriteriaOf, summaryOf, globalSummaryOf) {

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
        const profiles = reportScan.scanProfiles(scan);
        // A scan that names no profile (an older report) can't be read.
        if (!profiles.length) known = false;
        for (const p of profiles) {
            const level = levelOfId(p.id);
            if (level) wcag = level;
            else if (p.id) standards.set(p.id, p.label || p.id);
            else known = false;
        }
        return { wcag, standards, known };
    }

    /**
     * The profiles some scans share, and what they checked beyond them:
     * { wcag, standards: [{ id, label }], leftOut: [{ id, label }], same }, or
     * null when a scan's profiles can't be read.
     */
    function sharedProfiles(scans) {
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

    // What matches a scan across reports: its page, by path and query, so a
    // run on another host (staging beside live) lines up with it, and a scan
    // added before others or relabelled shifts nothing. Scans of one page are
    // paired by what they checked, then in order (pairedScanKeys). A scan's
    // id is the run's own numbering (scan-3), or the extension's, so it says
    // nothing of the page.
    function scanKey(scan) {
        const url = String(scan.url || '');
        let page = url;
        // A hash that routes a single-page app (#/cart) is a page of its own,
        // as report-format's pagePath reads it.
        try { const u = new URL(url); page = u.pathname + u.search + (/^#!?\//.test(u.hash) ? u.hash : ''); } catch { /* not a URL: as it is */ }
        return `at:${page}`;
    }

    // The ids of the profiles a scan checked, or [] when it names none.
    function profileIdsOf(scan) {
        return reportScanOf().scanProfiles(scan).map((p) => String(p.id || p.label || '')).filter(Boolean);
    }

    /**
     * The key of each scan of each report, in order (null for a skipped
     * one). Scans of one page are paired across the reports, each with a scan
     * of the latest report: first one that checked the same profiles, then
     * one that shares some, then the next in order; a scan left over is a
     * scan of its own. So a run that drops one of a page's scans, or adds
     * one, still sets each scan beside the one that checked what it did,
     * and scans that all checked the same profiles pair in order, as before.
     * A skipped scan keeps its place, so the scans after it still match.
     */
    function pairedScanKeys(reports) {
        const list = asArray(reports);
        const slotsByPage = new Map(); // page -> [{ ids }]
        const keys = list.map((report) => asArray(report && report.scans).map(() => null));
        const order = list.map((_, r) => r).reverse();
        for (const r of order) {
            const byPage = new Map();
            asArray(list[r] && list[r].scans).forEach((s, i) => {
                if (!s) return;
                const page = scanKey(s);
                if (!byPage.has(page)) byPage.set(page, []);
                byPage.get(page).push({ i, ids: profileIdsOf(s), skipped: !!(s.skipped || s.skipInfo) });
            });
            for (const [page, scans] of byPage) {
                if (!slotsByPage.has(page)) slotsByPage.set(page, []);
                const slots = slotsByPage.get(page);
                const used = new Set();
                const slotOf = new Map();
                const same = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
                const shares = (a, b) => a.some((id) => b.includes(id));
                for (const test of [same, shares, () => true]) {
                    for (const scan of scans) {
                        if (slotOf.has(scan)) continue;
                        const n = slots.findIndex((slot, k) => !used.has(k) && test(scan.ids, slot.ids));
                        if (n < 0) continue;
                        used.add(n);
                        slotOf.set(scan, n);
                    }
                }
                for (const scan of scans) {
                    if (!slotOf.has(scan)) {
                        slots.push({ ids: scan.ids });
                        slotOf.set(scan, slots.length - 1);
                    }
                    const n = slotOf.get(scan) + 1;
                    if (!scan.skipped) keys[r][scan.i] = n === 1 ? page : `${page}#${n}`;
                }
            }
        }
        return keys;
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

    // A criterion's WCAG level: the entry's own, else WCAG's for its number
    // (core leaves some entries without one).
    function levelOfCriterion(entry) {
        if (entry && LEVELS.includes(entry.level)) return entry.level;
        const crit = wcagCriteriaOf();
        const c = entry && entry.sc && crit && crit.criterionBySc ? crit.criterionBySc(String(entry.sc)) : null;
        return c && LEVELS.includes(c.level) ? c.level : null;
    }

    // Whether WCAG 2.2, which every shared level is of, removed a criterion
    // (4.1.1 Parsing): one scan may list it and another not.
    function removedIn22(entry) {
        const crit = wcagCriteriaOf();
        const c = entry && entry.sc && crit && crit.criterionBySc ? crit.criterionBySc(String(entry.sc)) : null;
        return !!(c && c.removedIn && Number(c.removedIn) <= 2.2);
    }

    // A coverage summary's criteria up to the shared level, of WCAG 2.2.
    function narrowCoverage(summary, level) {
        if (!summary || typeof summary !== 'object' || !level) return summary;
        const criteria = asArray(summary.criteria).filter((c) => {
            if (removedIn22(c)) return false;
            const l = levelOfCriterion(c);
            return !l || LEVELS.indexOf(l) <= LEVELS.indexOf(level);
        });
        return { ...summary, criteria };
    }

    // A scan left out of the comparison: its findings aren't compared.
    function excludeScan(scan) {
        const out = { ...scan, notCompared: true };
        if (scan.canonical && typeof scan.canonical === 'object') out.canonical = { ...scan.canonical, findings: [], margins: [] };
        return out;
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
        // Its score was made from everything it checked, and its WCAG
        // coverage goes when WCAG is left out.
        if (scan.summary && typeof scan.summary === 'object' && 'score' in scan.summary) {
            const { score: _score, ...rest } = scan.summary;
            out.summary = rest;
        }
        if (scan.metrics && typeof scan.metrics === 'object') {
            const metrics = { ...scan.metrics };
            if (metrics.a11ySummary && typeof metrics.a11ySummary === 'object') {
                const { scores: _scores, coverageSummary, ...rest } = metrics.a11ySummary;
                metrics.a11ySummary = { ...rest, scoreLeftOut: true };
                if (coverageSummary && level) metrics.a11ySummary.coverageSummary = narrowCoverage(coverageSummary, level);
            }
            if (metrics.coverageSummary) {
                if (level) metrics.coverageSummary = narrowCoverage(metrics.coverageSummary, level);
                else delete metrics.coverageSummary;
            }
            out.metrics = metrics;
        }
        if (scan.coverageSummary) {
            if (level) out.coverageSummary = narrowCoverage(scan.coverageSummary, level);
            else delete out.coverageSummary;
        }
        return out;
    }

    /**
     * A scan read on some of its own profiles, as the report view's Profiles
     * selector shows it: `keys` the profiles still on (a profile's id, or its
     * label where it has none). Its findings are what those profiles make of
     * them (narrowFindings: a requirement's row goes with its profile, a
     * rule's finding takes the worst verdict of the profiles kept and goes
     * when none of them judged it), its profiles become those, and what was
     * made from everything it checked (its score, its counts, and its WCAG
     * coverage when WCAG is off) is left out or counted again. A scan with
     * all its profiles on, or none, comes back as it is.
     */
    // A WCAG profile of any version: its id (wcag22-aa), or, for an older
    // version with none, its label (WCAG 2.1 AA).
    function isWcagProfile(p) {
        return /^wcag\d/i.test(String((p && p.id) || '')) || /^WCAG \d/.test(String((p && p.label) || ''));
    }

    function narrowScanToProfiles(scan, keys) {
        if (!scan || typeof scan !== 'object' || scan.skipped || scan.skipInfo) return scan;
        const profiles = reportScanOf().scanProfiles(scan);
        const keyOf = (p) => String(p.id || p.label || '');
        const own = profiles.map(keyOf).filter(Boolean);
        const on = new Set(asArray(keys).map(String));
        const kept = own.filter((k) => on.has(k));
        if (!kept.length || kept.length === own.length) return scan;
        const keptProfiles = profiles.filter((p) => kept.includes(keyOf(p)));
        const canonical = scan.canonical && typeof scan.canonical === 'object'
            ? { ...scan.canonical, findings: narrowFindings(scan.canonical.findings, { own, kept, level: null }) }
            : scan.canonical;
        const out = {
            ...scan,
            canonical,
            profile: keptProfiles.find((p) => !isWcagProfile(p)) || keptProfiles[0],
            profilesLeftOut: profiles.filter((p) => !kept.includes(keyOf(p))),
        };
        if (keptProfiles.length > 1) out.profiles = keptProfiles;
        else delete out.profiles;
        // Counted again from the findings kept.
        if (scan.summary && typeof scan.summary === 'object') {
            const { failCount: _f, occurrenceCount: _o, reviewCount: _r, passesCount: _p, ...rest } = scan.summary;
            out.summary = rest;
        }
        const wcagKept = keptProfiles.some(isWcagProfile);
        if (scan.metrics && typeof scan.metrics === 'object') {
            const metrics = { ...scan.metrics };
            if (metrics.a11ySummary && typeof metrics.a11ySummary === 'object') {
                const { scores: _scores, ...rest } = metrics.a11ySummary;
                metrics.a11ySummary = { ...rest, scoreLeftOut: true };
                if (!wcagKept) delete metrics.a11ySummary.coverageSummary;
            }
            if (!wcagKept) delete metrics.coverageSummary;
            out.metrics = metrics;
        }
        if (!wcagKept) delete out.coverageSummary;
        return out;
    }

    function narrowReport(report, plans, keys) {
        if (!report || typeof report !== 'object') return report;
        let narrowed = false;
        const scans = asArray(report.scans).map((s, i) => {
            const shared = keys[i] ? plans.get(keys[i]) : null;
            if (!shared) return s;
            narrowed = true;
            return shared.exclude ? excludeScan(s) : narrowScan(s, shared);
        });
        if (!narrowed) return report;
        const levels = [...plans.values()].map((p) => p.wcag).filter(Boolean);
        const level = levels.length ? LEVELS[Math.min(...levels.map((l) => LEVELS.indexOf(l)))] : null;
        const shared = { wcag: level };
        const out = { ...report, scans };
        // Its score and summary were made from everything it checked.
        if (report.metrics && report.metrics.a11ySummary) {
            const { scores: _scores, coverageSummary, ...rest } = report.metrics.a11ySummary;
            out.metrics = {
                ...report.metrics,
                // Said so, so a reader tells it from a run that evaluated too little.
                a11ySummary: { ...rest, scoreLeftOut: true, ...(coverageSummary && shared.wcag ? { coverageSummary: narrowCoverage(coverageSummary, shared.wcag) } : {}) },
            };
        }
        // Its WCAG coverage, up to the shared level, or none when WCAG is left out.
        if (report.metrics && report.metrics.coverageSummary) {
            out.metrics = { ...(out.metrics || report.metrics) };
            if (shared.wcag) out.metrics.coverageSummary = narrowCoverage(report.metrics.coverageSummary, shared.wcag);
            else delete out.metrics.coverageSummary;
        }
        return out;
    }

    function pushOnce(list, entries) {
        for (const e of entries) if (!list.some((x) => x.id === e.id)) list.push(e);
    }

    /**
     * The reports read on the profiles they share, scan by scan: a scan is
     * read beside the scans of the same id in the other reports, on the
     * profiles they share. A report whose own scans check different profiles
     * compares in full with another like it.
     * -> { reports, basis }: `basis` null when every matched scan checked the
     *    same profiles in every report, or can't be read (the reports come
     *    back as they are); else { comparedOn: [{ id, label }], leftOut:
     *    [{ id, label }] }, the profiles kept and left out over the scans read
     *    so, with the reports narrowed. comparedOn is [] when the scans that
     *    differ share none (those are left as they are).
     */
    function compareOnShared(reports) {
        const list = asArray(reports);
        // Each scan by its key, in each report.
        const byKey = new Map();
        const keysByReport = pairedScanKeys(list);
        list.forEach((report, r) => {
            const keys = keysByReport[r];
            asArray(report && report.scans).forEach((scan, i) => {
                const key = keys[i];
                if (!key) return;
                if (!byKey.has(key)) byKey.set(key, new Map());
                byKey.get(key).set(r, scan);
            });
        });
        const plans = new Map();
        const comparedOn = [];
        const leftOut = [];
        const none = [];
        let matched = 0;
        let comparable = 0;
        let unknown = 0;
        for (const [key, inReport] of byKey) {
            // A scan only some reports have is compared as it is.
            if (inReport.size < list.length) continue;
            matched += 1;
            const scans = [...inReport.values()];
            const shared = sharedProfiles(scans);
            if (!shared) { unknown += 1; continue; }
            if (shared.same) { comparable += 1; continue; }
            const on = [
                ...(shared.wcag ? [{ id: wcagId(shared.wcag), label: wcagLabel(shared.wcag) }] : []),
                ...shared.standards,
            ];
            // Named as the latest report names it: the run being read.
            const latest = scans[scans.length - 1];
            if (!on.length) { none.push({ key, label: latest.label || latest.url || key }); continue; }
            comparable += 1;
            plans.set(key, shared);
            pushOnce(comparedOn, on);
            pushOnce(leftOut, shared.leftOut);
        }
        // A scan only some reports have is read on what the others were
        // compared on: the profiles left out are left out of it too, so a
        // new page's findings of them don't count as new. Where its own scans
        // checked different profiles (a series of three, a page missing from
        // one), it is read on what they share as well.
        {
            const keptWcag = comparedOn.map((p) => levelOfId(p.id)).filter(Boolean)
                .sort((x, y) => LEVELS.indexOf(x) - LEVELS.indexOf(y))[0] || null;
            const outIds = new Set(leftOut.map((p) => p.id));
            // The WCAG levels left out: a new page keeps a level unless it is
            // one of them. A standard left out elsewhere changes nothing of
            // its WCAG level.
            const outLevels = [...outIds].map((id) => levelOfId(id)).filter(Boolean);
            for (const [key, inReport] of byKey) {
                if (inReport.size >= list.length) continue;
                const own = sharedProfiles([...inReport.values()]);
                if (!own) continue;
                if (own.same && !leftOut.length) continue;
                let wcag = own.wcag;
                const above = wcag && keptWcag && LEVELS.indexOf(wcag) > LEVELS.indexOf(keptWcag);
                if (above && outLevels.some((l) => LEVELS.indexOf(l) > LEVELS.indexOf(keptWcag))) wcag = keptWcag;
                else if (wcag && !keptWcag && outLevels.length) wcag = null;
                const standards = own.standards.filter((p) => !outIds.has(p.id));
                if (own.same && wcag === own.wcag && standards.length === own.standards.length) continue;
                if (!wcag && !standards.length) continue;
                plans.set(key, { wcag, standards, leftOut: [], same: false });
                if (!own.same) {
                    pushOnce(comparedOn, [...(wcag ? [{ id: wcagId(wcag), label: wcagLabel(wcag) }] : []), ...standards]);
                    pushOnce(leftOut, own.leftOut);
                }
            }
        }
        // Whether the reports share nothing to compare on: every scan they
        // both have checked different things. null when that can't be told
        // (no scan in common, or one that names no profile), for the reports'
        // own identities to say.
        const mismatch = !matched || unknown ? null : (!comparable && none.length > 0);
        // Beside scans that compare, one that shares nothing is left out of
        // the comparison: its rows would be what was checked, not the page.
        const notCompared = comparable && none.length ? none.map((n) => ({ label: n.label })) : [];
        for (const n of (comparable ? none : [])) plans.set(n.key, { exclude: true });
        if (!plans.size) {
            return { reports: list, basis: none.length ? { comparedOn: [], leftOut: [] } : null, mismatch };
        }
        return {
            reports: list.map((r, i) => narrowReport(r, plans, keysByReport[i])),
            basis: { comparedOn, leftOut, ...(notCompared.length ? { notCompared } : {}) },
            mismatch,
        };
    }

    /** "Compared on WCAG 2.2 AA, which every report checked. Left out: WAI-ARIA 1.2." */
    function basisSentence(basis) {
        const on = basis ? asArray(basis.comparedOn).map((p) => p.label) : [];
        const not = basis ? asArray(basis.notCompared).map((s) => s.label) : [];
        if (!on.length && !not.length) return null;
        const out = asArray(basis.leftOut).map((p) => p.label);
        const parts = [];
        if (on.length) {
            parts.push(`Compared on ${on.join(' + ')}, which every report checked.`
                + (out.length ? ` Left out, as not every report checked it on the same pages: ${out.join(', ')}.` : ''));
        }
        if (not.length) parts.push(`Not compared, as its reports checked ${not.length === 1 ? 'it' : 'them'} against different things that share none: ${[...new Set(not)].join(', ')}.`);
        return parts.join(' ');
    }

    // ---- A comparison read on the profiles the reader chooses ----

    // The key a profile is chosen by in a comparison: WCAG's levels nest, so
    // WCAG is one choice whatever level each report checked (compareOnShared
    // then reads it at the lowest), and any other profile is its id.
    const WCAG_KEY = 'wcag';
    function choiceKeyOf(p) {
        if (!p) return '';
        return isWcagProfile(p) ? WCAG_KEY : String(p.id || p.label || '');
    }
    const ownKeyOf = (p) => String((p && (p.id || p.label)) || '');

    function readScans(report) {
        return asArray(report && report.scans).filter((s) => s && !s.skipped && !s.skipInfo);
    }

    /**
     * The profiles a comparison of these reports can be read on: those every
     * report checked on some scan, [{ key, label }], WCAG first. A profile
     * only some reports checked is not offered: the comparison leaves it out
     * already (compareOnShared). WCAG is named at the lowest level checked,
     * the one it is compared at.
     */
    function comparisonProfiles(reports) {
        const list = asArray(reports);
        if (!list.length) return [];
        const order = [];
        const labels = new Map(); // key -> Set of labels
        const levels = [];
        const each = list.map((report) => {
            const keys = new Set();
            for (const scan of readScans(report)) {
                for (const p of reportScanOf().scanProfiles(scan)) {
                    const key = choiceKeyOf(p);
                    if (!key) continue;
                    keys.add(key);
                    if (!labels.has(key)) { labels.set(key, new Set()); order.push(key); }
                    labels.get(key).add(String(p.label || p.id));
                    if (key === WCAG_KEY) { const l = levelOfId(p.id); if (l) levels.push(l); }
                }
            }
            return keys;
        });
        const keys = order.filter((k) => each.every((set) => set.has(k)))
            .sort((a, b) => (b === WCAG_KEY) - (a === WCAG_KEY));
        return keys.map((key) => {
            const names = [...labels.get(key)];
            let label = names[0];
            if (key === WCAG_KEY && names.length > 1) {
                label = levels.length ? wcagLabel(LEVELS[Math.min(...levels.map((l) => LEVELS.indexOf(l)))]) : 'WCAG';
            }
            return { key, label };
        });
    }

    /**
     * A report read without the profiles turned off (`off`: keys from
     * comparisonProfiles). Each scan keeps its other profiles' results, as the
     * report view's Profiles selector shows them (narrowScanToProfiles); a
     * scan whose profiles are all off is left out, and one that names none is
     * kept as it is. The report's own score, made from everything it checked,
     * is left out, to be counted again (rescoreReports); so is its WCAG
     * coverage when WCAG is off.
     */
    function narrowReportToProfiles(report, off) {
        const offKeys = new Set(asArray(off).map(String));
        if (!offKeys.size || !report || typeof report !== 'object') return report;
        let changed = false;
        const scans = [];
        for (const scan of asArray(report.scans)) {
            if (!scan || scan.skipped || scan.skipInfo) { scans.push(scan); continue; }
            const profiles = reportScanOf().scanProfiles(scan);
            const kept = profiles.filter((p) => !offKeys.has(choiceKeyOf(p)));
            if (!profiles.length || kept.length === profiles.length) { scans.push(scan); continue; }
            changed = true;
            if (!kept.length) continue;
            let narrowed = narrowScanToProfiles(scan, kept.map(ownKeyOf));
            // A scan's own score goes with what it was made from.
            if (narrowed.summary && typeof narrowed.summary === 'object' && 'score' in narrowed.summary) {
                const { score: _score, ...rest } = narrowed.summary;
                narrowed = { ...narrowed, summary: rest };
            }
            if (narrowed.metrics && narrowed.metrics.a11ySummary && !narrowed.metrics.a11ySummary.scoreLeftOut) {
                const { scores: _scores, ...rest } = narrowed.metrics.a11ySummary;
                narrowed = { ...narrowed, metrics: { ...narrowed.metrics, a11ySummary: { ...rest, scoreLeftOut: true } } };
            }
            scans.push(narrowed);
        }
        if (!changed) return report;
        const out = { ...report, scans };
        if (report.metrics && typeof report.metrics === 'object') {
            const metrics = { ...report.metrics };
            if (metrics.a11ySummary && typeof metrics.a11ySummary === 'object') {
                const { scores: _scores, ...rest } = metrics.a11ySummary;
                metrics.a11ySummary = { ...rest, scoreLeftOut: true };
                if (offKeys.has(WCAG_KEY)) delete metrics.a11ySummary.coverageSummary;
            }
            if (offKeys.has(WCAG_KEY)) delete metrics.coverageSummary;
            out.metrics = metrics;
        }
        return out;
    }

    // The findings of a merged scan as its score reads them: each rule's
    // elements once, as merged-scan.js scores them.
    function scoringView(canonical) {
        const keyOf = (o) => JSON.stringify([
            (o && o.pageUrl) || null,
            Array.isArray(o && o.target) ? o.target : [],
            Array.isArray(o && o.shadowHostSelectors) ? o.shadowHostSelectors : null,
        ]);
        return {
            ...canonical,
            findings: asArray(canonical.findings).map((f) => {
                if (!f || typeof f !== 'object') return f;
                const seen = new Set();
                const occurrences = asArray(f.occurrences).filter((o) => {
                    const key = keyOf(o);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                return { ...f, occurrences };
            }),
        };
    }

    /**
     * A scan whose score was left out, scored again on the findings it was
     * narrowed to, the way the run scored it (a11y-summary.js), from the page
     * measurements its report kept. Without them (an older report), or
     * without the scoring loaded, it stays without one.
     */
    function rescoreScan(scan) {
        const metrics = scan && scan.metrics;
        const summary = metrics && metrics.a11ySummary;
        if (!summary || !summary.scoreLeftOut) return scan;
        const api = summaryOf && summaryOf();
        const dom = metrics.domMetrics;
        if (!api || typeof api.buildA11ySummary !== 'function') return scan;
        if (!dom || typeof dom.totalElements !== 'number') return scan;
        if (!scan.canonical || !Array.isArray(scan.canonical.findings)) return scan;
        // The WCAG coverage kept with it, to tell an evaluated page from one
        // where nothing was; none when WCAG is left out, and the score then
        // stands without that check, as a run without coverage scores.
        const coverage = summary.coverageSummary || metrics.coverageSummary || scan.coverageSummary || null;
        let built;
        try {
            built = api.buildA11ySummary({
                canonical: scan.mergedScan ? scoringView(scan.canonical) : scan.canonical,
                domMetrics: dom,
                coverageSummary: coverage,
            });
        } catch {
            return scan;
        }
        if (!built || !built.scores) return scan;
        const { scoreLeftOut: _left, ...rest } = summary;
        return {
            ...scan,
            metrics: { ...metrics, a11ySummary: { ...rest, scores: built.scores, scoreRecounted: true } },
        };
    }

    const scoreOfScan = (scan) => {
        const s = scan && scan.metrics && scan.metrics.a11ySummary && scan.metrics.a11ySummary.scores;
        const v = s ? s.avgPageAccessibility : null;
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    /**
     * A report read on fewer profiles than it checked, scored again: each
     * scan whose score was left out (rescoreScan), and the report's own as
     * the run builds it from its scans (global-summary.js: the mean of its
     * pages' scores). A report none of whose pages can be scored again keeps
     * its score left out. Marked `scoreRecounted`, so a view can say the
     * score is the profiles compared's, not the one in the report.
     */
    function rescoreReport(report) {
        if (!report || typeof report !== 'object') return report;
        let changed = false;
        const scans = asArray(report.scans).map((scan) => {
            const next = rescoreScan(scan);
            if (next !== scan) changed = true;
            return next;
        });
        const summary = report.metrics && report.metrics.a11ySummary;
        if (!changed && !(summary && summary.scoreLeftOut)) return report;
        const out = changed ? { ...report, scans } : report;
        if (!summary || !summary.scoreLeftOut) return out;
        const api = globalSummaryOf && globalSummaryOf();
        if (!api || typeof api.buildGlobalSummary !== 'function') return out;
        const read = readScans(out);
        if (!read.some((scan) => scoreOfScan(scan) != null)) return out;
        let built;
        try {
            built = api.buildGlobalSummary({ scans: read, options: { domP90: 90, useMinConfidence: false } });
        } catch {
            return out;
        }
        const scores = built && built.a11ySummary && built.a11ySummary.scores;
        if (!scores) return out;
        const { scoreLeftOut: _left, ...rest } = summary;
        return {
            ...out,
            metrics: { ...out.metrics, a11ySummary: { ...rest, scores, scoreRecounted: true } },
        };
    }

    /**
     * The reports as a comparison reads them: without the profiles turned
     * off (`off`, keys from comparisonProfiles), then on the profiles they
     * share (compareOnShared), each score left out by either scored again on
     * what is compared (rescoreReport).
     * -> { reports, basis, mismatch, filter }: `filter` null when nothing is
     *    off, else { shown: [{ key, label }], off: [{ key, label }] }.
     */
    function prepareComparison(reports, { off = [] } = {}) {
        const list = asArray(reports);
        const offered = comparisonProfiles(list);
        const offKeys = asArray(off).map(String).filter((k) => offered.some((p) => p.key === k));
        // Something always stays on.
        const turnedOff = offKeys.length >= offered.length ? [] : offKeys;
        const narrowed = turnedOff.length ? list.map((r) => narrowReportToProfiles(r, turnedOff)) : list;
        const shared = compareOnShared(narrowed);
        const out = { ...shared, reports: shared.reports.map(rescoreReport), filter: null };
        if (turnedOff.length) {
            out.filter = {
                shown: offered.filter((p) => !turnedOff.includes(p.key)),
                off: offered.filter((p) => turnedOff.includes(p.key)),
            };
        }
        return out;
    }

    return {
        compareOnShared, sharedProfiles, basisSentence, narrowScanToProfiles,
        comparisonProfiles, narrowReportToProfiles, rescoreScan, rescoreReport, prepareComparison, WCAG_KEY,
    };
}));
