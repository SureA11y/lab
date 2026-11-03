'use strict';

/**
 * report-format.js (shared)
 *
 * The report format's version, and the id every occurrence is known by.
 *
 * reportVersion
 *   4  the rule catalogue a scan ran with (its canonical `rules`) is kept
 *      once, in the report's `ruleCatalogs`, and each scan names its own by
 *      index (`canonical.rulesCatalog`): a 120-scan report was half the same
 *      catalogue, 171 KB a scan. The engine's raw rollups
 *      (`canonical.diagnostics.engine.rulesResults`, which the findings
 *      already hold) are kept only by a debug run. Readers bring a report
 *      to the in-memory form with every scan's `rules` again
 *      (expandReport, which upgradeReport makes), and writers keep it
 *      compact (compactReport).
 *   3  each finding is written once, in its scan: the findings by outcome
 *      (`findings`, `a11yGlobalFindings`) are not saved, as they repeat
 *      every scan's and whoever reads them builds them from the scans; and
 *      an occurrence does not repeat itself (compactOccurrence).
 *   2  scans record `profile` and `wcag` (see report-scan.js), and every
 *      occurrence carries an `occurrenceId`.
 *   1  reports saved before, which carry no version.
 *
 * occurrenceId
 *   The same issue on the same element of the same page has the same id in
 *   every report, so two runs can be compared, and a finding in one can be
 *   pointed at from elsewhere (a ticket, a baseline), by id. It is a short
 *   hash of the rule, the page's path and query, and the element's target,
 *   which is what comparisons already matched occurrences on. The page's
 *   origin is left out, so a run on a staging copy compares with one on the
 *   live site.
 *
 *   An element in an iframe is named by the iframes that lead to it as well.
 *
 *   An element inside shadow roots is named by its hosts' selectors and its
 *   own, which holds only inside the last host's shadow root (elementTarget):
 *   by its own selector alone, a thousand buttons, each in a shadow root of
 *   its own, were one occurrence. An element outside shadow DOM keeps the id
 *   it had.
 *
 *   Known limit: the target is a selector, so an element whose selector
 *   changes (a renamed class, a reordered list) gets a new id, and reads as
 *   one issue fixed and another new.
 *
 * Reports saved before have no ids: readers give them theirs with
 * occurrenceIdOf, which returns the saved id when there is one, and computes
 * the same id otherwise.
 *
 * Browser: available as globalThis.A11Y_REPORT_FORMAT (load report-scan.js first).
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./report-scan.js'));
    } else {
        if (!root.A11Y_REPORT_SCAN) {
            throw new Error('report-format.js: load report-scan.js first');
        }
        root.A11Y_REPORT_FORMAT = factory(root.A11Y_REPORT_SCAN);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (reportScan) {

    const REPORT_VERSION = 4;

    /** The format version a report was saved in: its reportVersion, else 1. */
    function reportVersionOf(report) {
        const v = report && report.reportVersion;
        return Number.isInteger(v) && v > 0 ? v : 1;
    }

    // Each page's path, by its address: every occurrence names its page, and
    // parsing the same address again for each one was most of the time 24
    // reports took to compare. Emptied past PATH_CACHE_MAX addresses.
    const PATH_CACHE_MAX = 5000;
    const pathCache = new Map();

    // A hash that routes a single-page app (#/cart, #!/cart) names a page of
    // its own; any other hash is a place in the page (#main) and doesn't.
    const routeOf = (hash) => (/^#!?\//.test(hash) ? hash : '');

    /**
     * A page's path and query, which is what tells two pages of a site apart,
     * and its hash where that routes a single-page app.
     */
    function pagePath(url) {
        const key = String(url || '');
        let path = pathCache.get(key);
        if (path === undefined) {
            try { const u = new URL(url); path = u.pathname + u.search + routeOf(u.hash); }
            catch { path = key; }
            if (pathCache.size >= PATH_CACHE_MAX) pathCache.clear();
            pathCache.set(key, path);
        }
        return path;
    }

    /**
     * What an occurrence is matched on: its rule, page and target. `scanUrl`
     * stands in for the page when the occurrence does not name one.
     */
    function occurrenceKey(ruleId, occurrence, scanUrl) {
        const o = occurrence && typeof occurrence === 'object' ? occurrence : {};
        const url = o.pageUrl ? o.pageUrl : (scanUrl || '');
        return `${ruleId || ''}##${pagePath(url)}##${elementTarget(o)}`;
    }

    /**
     * Which element an occurrence is on, as text: its target, after the
     * selectors of the shadow hosts it is inside, if any (`>>>` between
     * them). Its target alone holds only inside the last host's shadow root,
     * so it repeats in every root of the same component.
     */
    function elementTarget(occurrence) {
        const o = occurrence && typeof occurrence === 'object' ? occurrence : {};
        const target = Array.isArray(o.target) ? o.target.join('||') : (typeof o.target === 'string' ? o.target : '');
        const hosts = Array.isArray(o.shadowHostSelectors) ? o.shadowHostSelectors.filter((h) => typeof h === 'string' && h) : [];
        const own = hosts.length ? `${hosts.join(' >>> ')} >>> ${target}` : target;
        // In an iframe: the iframes that lead to it come first (|>| between).
        const frames = Array.isArray(o.frameSelectors) ? o.frameSelectors.filter((f) => typeof f === 'string' && f) : [];
        return frames.length ? `${frames.join(' |>| ')} |>| ${own}` : own;
    }

    // cyrb53: a fast 53-bit string hash, the same in Node and the browser.
    function hash53(text) {
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h2 >>> 0).toString(16).padStart(8, '0').slice(-6) + (h1 >>> 0).toString(16).padStart(8, '0');
    }

    /**
     * How many elements a finding is on: those it lists, and those its rule
     * counted and did not list (`unlisted`: core's contrast rules list 50).
     */
    function occurrenceTotal(finding) {
        const listed = finding && Array.isArray(finding.occurrences) ? finding.occurrences.length : 0;
        const unlisted = finding && Number(finding.unlisted) > 0 ? Math.floor(Number(finding.unlisted)) : 0;
        return listed + unlisted;
    }

    /** The id of an occurrence of `ruleId`: "occ_" and 14 hex digits. */
    function occurrenceId(ruleId, occurrence, scanUrl) {
        return `occ_${hash53(occurrenceKey(ruleId, occurrence, scanUrl))}`;
    }

    /** An occurrence's saved id, or the one it would have been saved with. */
    function occurrenceIdOf(ruleId, occurrence, scanUrl) {
        const saved = occurrence && occurrence.occurrenceId;
        return typeof saved === 'string' && saved ? saved : occurrenceId(ruleId, occurrence, scanUrl);
    }

    // What an engine's own record of an element (evidence.engineNode) says
    // that the occurrence already does, and so is not kept in it.
    const ENGINE_NODE_REPEATS = ['pageUrl', 'target', 'html', 'failureSummary'];

    const sameValue = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b));

    /**
     * An occurrence without what it repeats, in place: `summary` when it is
     * its `failureSummary`, and in `evidence.engineNode` the fields the
     * occurrence holds with the same value (its `url` when that is
     * [pageUrl]), the record and `evidence` themselves when nothing else is
     * left. A third of a report was these. What an engine records beyond them
     * stays.
     */
    function compactOccurrence(o) {
        if (!o || typeof o !== 'object') return o;
        if (typeof o.failureSummary === 'string' && o.summary === o.failureSummary) delete o.summary;
        const evidence = o.evidence;
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return o;
        const node = evidence.engineNode;
        if (node && typeof node === 'object' && !Array.isArray(node)) {
            for (const key of ENGINE_NODE_REPEATS) {
                if (key in node && sameValue(node[key], o[key])) delete node[key];
            }
            if (Array.isArray(node.url) && sameValue(node.url, o.pageUrl ? [o.pageUrl] : [])) delete node.url;
        }
        if (node === null || (node && typeof node === 'object' && !Object.keys(node).length)) delete evidence.engineNode;
        if (!Object.keys(evidence).length) delete o.evidence;
        return o;
    }

    /**
     * Brings a report's scans to the current format, in place: scan fields
     * from older reports become `profile` and `wcag`, each occurrence gets
     * its id (ids already there are kept) and loses what it repeats.
     */
    function upgradeScans(scans) {
        for (const scan of (Array.isArray(scans) ? scans : [])) {
            if (!scan || typeof scan !== 'object') continue;
            reportScan.upgradeScanFields(scan);
            const scanUrl = typeof scan.url === 'string' ? scan.url : '';
            const findings = scan.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [];
            for (const f of findings) {
                if (!f || typeof f !== 'object' || !Array.isArray(f.occurrences)) continue;
                const ruleId = f.ruleId || f.id;
                for (const o of f.occurrences) {
                    if (!o || typeof o !== 'object') continue;
                    if (!o.occurrenceId) o.occurrenceId = occurrenceId(ruleId, o, scanUrl);
                    compactOccurrence(o);
                }
            }
        }
        return scans;
    }

    /**
     * Brings a whole report to the current format, in place: its scans, as
     * upgradeScans does, and its version. The findings by outcome an older
     * report saved (`findings`, `a11yGlobalFindings`) go: they are every
     * scan's findings again, and whoever reads them builds them from the
     * scans (findingsByOutcome, getA11yGlobalFindings).
     */
    function upgradeReport(report) {
        if (!report || typeof report !== 'object') return report;
        expandReport(report);
        upgradeScans(report.scans);
        delete report.findings;
        delete report.a11yGlobalFindings;
        report.reportVersion = REPORT_VERSION;
        return report;
    }

    /**
     * A report as version 4 keeps it, in place: each scan's rule catalogue
     * moved to the report's `ruleCatalogs`, once however many scans share it,
     * and the scan naming it by index; the engine's raw rollups left out
     * unless `keepEngineDetail` (a debug run). A report already compact is
     * left as it is.
     */
    function compactReport(report, { keepEngineDetail = false } = {}) {
        if (!report || typeof report !== 'object' || !Array.isArray(report.scans)) return report;
        const catalogs = Array.isArray(report.ruleCatalogs) ? report.ruleCatalogs : [];
        const index = new Map();
        catalogs.forEach((c, i) => index.set(c, i));
        const byText = new Map();
        for (const scan of report.scans) {
            const canonical = scan && scan.canonical;
            if (!canonical || typeof canonical !== 'object') continue;
            if (Array.isArray(canonical.rules)) {
                const rules = canonical.rules;
                let i = index.get(rules);
                if (i === undefined) {
                    const text = JSON.stringify(rules);
                    i = byText.get(text);
                    if (i === undefined) {
                        i = catalogs.length;
                        catalogs.push(rules);
                        byText.set(text, i);
                    }
                    index.set(rules, i);
                }
                canonical.rulesCatalog = i;
                delete canonical.rules;
            }
            const engine = canonical.diagnostics && canonical.diagnostics.engine;
            if (!keepEngineDetail && engine && typeof engine === 'object') delete engine.rulesResults;
        }
        if (catalogs.length) report.ruleCatalogs = catalogs;
        report.reportVersion = REPORT_VERSION;
        return report;
    }

    /**
     * A version 4 report with every scan's `rules` again, in place, each the
     * report's catalogue it names (the same object for scans that share one):
     * the form readers take. A report without catalogues is left as it is.
     */
    function expandReport(report) {
        if (!report || typeof report !== 'object' || !Array.isArray(report.ruleCatalogs)) return report;
        const catalogs = report.ruleCatalogs;
        for (const scan of (Array.isArray(report.scans) ? report.scans : [])) {
            const canonical = scan && scan.canonical;
            if (!canonical || !Number.isInteger(canonical.rulesCatalog)) continue;
            const rules = catalogs[canonical.rulesCatalog];
            if (Array.isArray(rules)) canonical.rules = rules;
            delete canonical.rulesCatalog;
        }
        delete report.ruleCatalogs;
        return report;
    }

    return {
        REPORT_VERSION,
        compactReport,
        expandReport,
        upgradeReport,
        reportVersionOf,
        pagePath,
        routeOf,
        occurrenceKey,
        elementTarget,
        occurrenceTotal,
        occurrenceId,
        occurrenceIdOf,
        compactOccurrence,
        upgradeScans,
    };
}));
