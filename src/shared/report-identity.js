'use strict';

// Pure helpers that read a run/report object's identity — the fields the A/B
// run comparison ("evolution") view uses to name, order, and de-duplicate the
// two sides. DOM-free so they're unit-tested directly; the comparison UI holds
// the two reports and calls these to build the column headers and to guard
// against comparing a run with itself.
//
// Everything is defensive: reports without a runId, hand-edited imports, or
// merged reports still yield a usable identity, falling back through
// timestamp -> scenarioName -> url.
//
// Browser: available as globalThis.A11Y_REPORT_IDENTITY.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./report-scan.js'));
    } else {
        if (!root.A11Y_REPORT_SCAN) throw new Error('report-identity.js: load report-scan.js first');
        root.A11Y_REPORT_IDENTITY = factory(root.A11Y_REPORT_SCAN);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (reportScan) {

    function str(v) {
        return (typeof v === 'string' && v.trim()) ? v.trim() : null;
    }

    // Normalize one report into the identity the comparison view needs.
    // - runId: explicit when stamped, else a synthetic key from timestamp+url so
    //   two distinct runs still compare unequal.
    // - label: what the column header shows (scenario, else scope URL, else time).
    // - timestamp: ISO string or null; drives ordering.
    function reportIdentity(report) {
        const r = report && typeof report === 'object' ? report : {};

        const timestamp = str(r.timestamp);
        const scenarioName = str(r.scenarioName);
        const scopeUrl = str(r.url);

        const explicitRunId = str(r.runId);
        const runId = explicitRunId || syntheticKey(timestamp, scopeUrl);

        const label = scenarioName || scopeUrl || (timestamp ? `Run ${timestamp}` : 'Untitled run');

        // Distinct scan tags across the report. When several reports are exported
        // from one run filtered by tag (desktop / tablet / mobile), their metadata is
        // identical, so this is what tells the two comparison columns apart.
        const scanTags = collectReportScanTags(r);

        // Standards whose own rules the report's scans added (["rgaa"]). Two
        // reports that differ here differ in what was checked, not only in
        // what was found.
        const optInRules = collectReportOptInRules(r);

        // The engine releases its scans ran ([{ name, version }]). A rule
        // that changed in a new release changes the findings of pages that
        // did not change.
        const engines = collectReportEngines(r);

        // Whether its scans targeted RGAA, which lists them by RGAA criterion
        // rather than by WCAG criterion.
        const rgaaTarget = reportTargetsRgaa(r);

        // The standards its scans were checked against, besides WCAG
        // (["EN 301 549 V4.1.1"]): a scan against a standard lists its
        // results by that standard's requirements (EN 301 549's clauses,
        // RGAA's criteria, another pack's), not by WCAG's criteria.
        const listedBy = reportListedBy(r);

        return { runId, timestamp, scenarioName, scopeUrl, label, scanTags, optInRules, engines, rgaaTarget, listedBy };
    }

    function reportListedBy(report) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        const out = [];
        for (const s of scans) {
            const canon = s && s.canonical && s.canonical.runOptions && s.canonical.runOptions.conformanceProfile;
            // Every standard a scan of several profiles checked against.
            const own = reportScan.scanStandardIds(s).map(str).filter(Boolean);
            const ids = own.length ? own : (canon && !/^wcag/i.test(str(canon.id) || '') ? [str(canon.id)] : []);
            const named = reportScan.scanProfiles(s);
            for (const id of ids) {
                const entry = named.find((p) => p.id === id);
                const label = str(entry ? entry.label : '') || str(canon && canon.id === id ? canon.label : '') || id;
                if (!out.includes(label)) out.push(label);
            }
        }
        return out.sort();
    }

    /**
     * The WCAG levels a report's scans were checked against, named ("WCAG
     * 2.2 AA"), once each and sorted: a scan's WCAG level among its
     * profiles, or a scan of WCAG alone. A scan of a standard alone has none:
     * the standard names its own rows. [] when the report does not say.
     */
    function reportWcagLevels(report) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        const out = [];
        for (const s of scans) {
            if (!s || s.skipped || s.skipInfo) continue;
            for (const p of reportScan.scanProfiles(s)) {
                const label = str(p && p.label);
                const wcag = p && (p.id ? reportScan.WCAG_PROFILE.test(p.id) : /^WCAG /.test(label || ''));
                if (wcag && label && !out.includes(label)) out.push(label);
            }
        }
        return out.sort();
    }

    function reportTargetsRgaa(report) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        return scans.some((s) => {
            const own = reportScan.scanStandardId(s);
            const canon = s && s.canonical && s.canonical.runOptions && s.canonical.runOptions.conformanceProfile
                && s.canonical.runOptions.conformanceProfile.id;
            return /^rgaa/i.test(str(own || canon) || '');
        });
    }

    function collectReportEngines(report) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        const seen = new Map();
        for (const s of scans) {
            const list = s && s.canonical && Array.isArray(s.canonical.engines) ? s.canonical.engines : [];
            for (const e of list) {
                const name = str(e && (e.name || e.id));
                if (!name) continue;
                const version = str(e && e.version);
                const key = `${name}@${version || ''}`;
                if (!seen.has(key)) seen.set(key, { name, version });
            }
        }
        return Array.from(seen.values()).sort((a, b) =>
            a.name.localeCompare(b.name) || String(a.version || '').localeCompare(String(b.version || ''), undefined, { numeric: true }));
    }

    // The engines whose release differs between the reports, with the
    // releases in column order: [{ name, versions: ['1.9.0', '1.10.0'] }].
    // A report without a version for an engine says nothing about it, and
    // an engine only one report ran is a difference in engines, not releases.
    function engineReleaseChanges(identities) {
        const byName = new Map();
        for (const identity of identities) {
            for (const e of identity.engines || []) {
                if (!e.version) continue;
                if (!byName.has(e.name)) byName.set(e.name, []);
                const versions = byName.get(e.name);
                if (!versions.includes(e.version)) versions.push(e.version);
            }
        }
        return Array.from(byName.entries())
            .filter(([, versions]) => versions.length > 1)
            .map(([name, versions]) => ({ name, versions }));
    }

    function collectReportOptInRules(report) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        const seen = new Set();
        for (const s of scans) {
            const own = s && Array.isArray(s.optInRules) ? s.optInRules : null;
            const canon = s && s.canonical && s.canonical.runOptions && Array.isArray(s.canonical.runOptions.optInRules)
                ? s.canonical.runOptions.optInRules : null;
            for (const t of (own || canon || [])) {
                const clean = str(t).toLowerCase();
                if (clean) seen.add(clean);
            }
        }
        return Array.from(seen).sort();
    }

    // Distinct tags across a report's scans, case-insensitive (first-seen casing),
    // sorted — the qualifier the comparison header uses to distinguish reports that
    // share all other metadata.
    function collectReportScanTags(report) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        const seen = new Map();
        for (const s of scans) {
            const raw = s && Array.isArray(s.scanTags) ? s.scanTags : [];
            for (const t of raw) {
                const clean = str(t);
                if (!clean) continue;
                const key = clean.toLowerCase();
                if (!seen.has(key)) seen.set(key, clean);
            }
        }
        return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    }

    // A stable key for equality/dedupe. Never empty: falls back to a fixed sentinel
    // so two identity-less reports are treated as the same unknown run rather than
    // as silently distinct.
    function syntheticKey(timestamp, scopeUrl) {
        const parts = [timestamp || '', scopeUrl || ''].filter(Boolean);
        return parts.length ? `syn:${parts.join('|')}` : 'syn:unknown';
    }

    // Accepts either a report or an already-computed identity object: reportIdentity
    // returns an explicit runId verbatim, so passing an identity back through is
    // stable and needs no special-casing.
    function identityKey(reportOrIdentity) {
        return reportIdentity(reportOrIdentity).runId;
    }

    // Order two reports oldest -> newest by timestamp, so the comparison can assign
    // baseline (A, older) vs current (B, newer) deterministically. Reports without
    // a timestamp sort last (unknown age), ties broken by label for stability.
    function compareByTime(a, b) {
        const ia = reportIdentity(a);
        const ib = reportIdentity(b);

        if (ia.timestamp && ib.timestamp) {
            if (ia.timestamp < ib.timestamp) return -1;
            if (ia.timestamp > ib.timestamp) return 1;
            return ia.label.localeCompare(ib.label);
        }
        if (ia.timestamp) return -1; // b unknown -> b last
        if (ib.timestamp) return 1;  // a unknown -> a last
        return ia.label.localeCompare(ib.label);
    }

    // Given two reports, decide which is the baseline (older) and which is current.
    // Preserves caller order on a tie so an explicit "compare B against this
    // baseline A" choice is never silently swapped when timestamps are equal/absent.
    function assignBaselineAndCurrent(first, second) {
        const order = compareByTime(first, second);
        if (order > 0) return { baseline: second, current: first };
        return { baseline: first, current: second };
    }

    // ---- what a comparison IS, as a document ------------------------------
    //
    // A comparison outlives the tab it was made in: it gets downloaded, mailed,
    // attached to a ticket and opened again months later. Everything below is
    // what that file needs in order to answer "what am I looking at?" without
    // the person who made it standing next to you.
    //
    // Only the title and the note are typed. Everything else is derived from the
    // reports themselves, and nothing is claimed unless every report agrees:
    // three reports of three different sites have no one subject, and saying
    // they do would be worse than saying nothing.

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** "11 Aug 2026". Short, unambiguous in any locale, and stable in a filename. */
    function shortDate(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    function toSecond(iso) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 19)}Z`;
    }

    /** The one value they all share, or null when they do not all share one. */
    function agreedOn(values) {
        const seen = values.map((v) => str(v)).filter(Boolean);
        if (seen.length !== values.length || !seen.length) return null;
        return seen.every((v) => v === seen[0]) ? seen[0] : null;
    }

    const FRAMING = {
        trend: 'Runs over time',
        versions: 'Versions',
        matrix: 'Across variants',
        evolution: 'Runs over time',
        ab: 'Across variants',
    };

    /**
     * Describe a set of reports as one document.
     *
     * @param {object[]} reports  the reports being compared, in column order
     * @param {{title?: string, note?: string, generatedAt?: string,
     *          framing?: string, unit?: {one: string, many: string},
     *          ordered?: boolean}} options
     */
    function describeComparison(reports, {
        title, note, generatedAt, framing, unit, ordered = true,
    } = {}) {
        const list = Array.isArray(reports) ? reports.filter(Boolean) : [];
        const identities = list.map(reportIdentity);
        const wcagLevels = list.map(reportWcagLevels);
        const counted = unit || { one: 'run', many: 'runs' };

        const stamps = identities.map((identity) => identity.timestamp).filter(Boolean);
        const sorted = stamps.slice().sort();
        // A span is only a span when the dates put the columns in order. An
        // arrangement someone typed says nothing about when anything ran.
        const span = (ordered && sorted.length >= 2 && sorted[0] !== sorted[sorted.length - 1])
            ? { from: sorted[0], to: sorted[sorted.length - 1] }
            : null;

        const count = identities.length;
        const noun = count === 1 ? counted.one : counted.many;
        const framingLabel = FRAMING[framing] || null;

        // The count, and the range when the dates ordered the columns. The
        // framing is deliberately left out: the noun already carries it, and
        // "2 versions, versions" says one thing twice.
        const summary = span
            ? `${count} ${noun}, ${shortDate(span.from)} to ${shortDate(span.to)}`
            : `${count} ${noun}`;

        return {
            kind: 'Accessibility comparison',
            title: str(title),
            note: str(note),
            // Passed in rather than read off the clock, so a rebuild of the same
            // comparison is byte-identical and the tests are not time-dependent.
            // Trimmed to the second: a compiled-on stamp has no use for
            // milliseconds, and they only make the value harder to read.
            generatedAt: toSecond(str(generatedAt) || new Date().toISOString()),
            count,
            unit: counted,
            framing: framingLabel,
            // Claimed only where every report says the same thing.
            subject: agreedOn(identities.map((identity) => identity.scenarioName)),
            scope: agreedOn(identities.map((identity) => identity.scopeUrl)),
            // How many distinct sites are in here, so a mixed set can say so
            // instead of quietly averaging over them.
            scopes: Array.from(new Set(identities.map((identity) => identity.scopeUrl).filter(Boolean))),
            // Whether the reports disagree on the opt-in rules they ran, so
            // findings from those rules can read as new or fixed when they
            // are only a difference in what was checked.
            optInMismatch: new Set(identities.map((identity) => identity.optInRules.join(','))).size > 1,
            // The engines that ran a different release in some of the reports,
            // so a rule changed by the engine can read as a change in the pages.
            engineChanges: engineReleaseChanges(identities),
            // Every engine and release the reports ran, once each: what the
            // comparison names as its engine, as a report names its own.
            engines: identitiesEngines(identities),
            // Whether the reports were checked against different standards or
            // WCAG levels: a scan against a standard (EN 301 549, RGAA,
            // another pack's) is listed by that standard's requirements, one
            // against WCAG by WCAG criterion, and Level AAA has criteria AA
            // does not, so their rule and criterion rows never line up. A
            // report that does not say its level differs from none.
            criteriaMismatch: new Set(identities.map((identity) => (identity.listedBy || []).join('|'))).size > 1
                || new Set(wcagLevels.filter((l) => l.length).map((l) => l.join('|'))).size > 1,
            // What each was checked against, once each, named as its scans
            // are: "WCAG 2.2 AA + WAI-ARIA 1.2", or "WCAG" for a report that
            // does not say its level.
            standardsCompared: [...new Set(identities.map((identity, i) => {
                const parts = [...wcagLevels[i], ...(identity.listedBy || [])];
                return parts.length ? parts.join(' + ') : 'WCAG';
            }))],
            span,
            summary,
        };
    }

    function identitiesEngines(identities) {
        const seen = new Map();
        for (const identity of identities) {
            for (const e of identity.engines || []) {
                const key = `${e.name}@${e.version || ''}`;
                if (!seen.has(key)) seen.set(key, e);
            }
        }
        return Array.from(seen.values()).sort((a, b) =>
            a.name.localeCompare(b.name) || String(a.version || '').localeCompare(String(b.version || ''), undefined, { numeric: true }));
    }

    /** Every engine and release a set of reports ran, once each: [{ name, version }]. */
    function comparisonEngines(reports) {
        return identitiesEngines((Array.isArray(reports) ? reports : []).map(reportIdentity));
    }

    return {
        reportIdentity, identityKey, compareByTime, assignBaselineAndCurrent,
        describeComparison, comparisonEngines, shortDate,
    };
}));
