'use strict';

// The scans of a report as shown, with each merged group in place of its
// scans (docs/design/scan-grouping-design.md §9): one scan folded from the
// group's included scans, with the scans dimension of the shared fold
// (scan-fold.js), so a failure of the template is one failure on every page
// and a failure of one page's content stays on that page.
//
// A view (D10): the report keeps every scan, and the merged scan is built
// again from them whenever the report is shown. Every part of the report that
// counts or lists scans reads them through scansAsShown (§9.5); the grouping
// itself, the downloads and the edits read the scans as they are.
//
// Pure: what it folds with and scores with is passed in (deps), so it runs
// the same in the page and in tests.
//
// Browser: available as globalThis.A11Y_SCAN_GROUP_MERGE.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_GROUP_MERGE = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const LISTED = new Set(['fail', 'cantTell']);
    const isIncluded = (scan) => !!scan && scan.includedInReport !== false;

    // A merged scan's id: the same for a group in every redraw and download
    // (§9.4), and safe in an element id and a fragment, which a group key
    // ("url:shop.example.com/products/{*}") is not.
    function mergedScanId(key) {
        let h = 0x811c9dc5;
        const text = String(key);
        for (let i = 0; i < text.length; i += 1) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return `merged-${h.toString(16).padStart(8, '0')}`;
    }

    function flatten(groups) {
        const out = [];
        const walk = (level) => (level || []).forEach((g) => { out.push(g); walk(g.children); });
        walk(groups);
        return out;
    }

    // What the merged scan was checked against: the settings of its first
    // scan, as a Merged scan step takes its first context's.
    const SETTINGS = ['profile', 'wcag', 'profiles', 'profilesNotRun', 'profilesLeftOut', 'wcagLevel', 'wcagVersion',
        'conformanceProfile', 'optInRules', 'context', 'viewportRatio'];

    function settingsOf(scan) {
        const out = {};
        for (const field of SETTINGS) if (scan[field] !== undefined) out[field] = scan[field];
        return out;
    }

    // The coverage of the folded findings, each criterion's automation taken
    // from the member that saved the most criteria, as coverage-summary.js's
    // own repair takes it: the report keeps no other record of it.
    function coverageOf(canonical, parts, deps) {
        const saved = parts
            .map((s) => s.metrics && s.metrics.coverageSummary)
            .filter((c) => c && Array.isArray(c.criteria))
            .sort((a, b) => b.criteria.length - a.criteria.length)[0] || null;
        if (!saved || typeof deps.buildCoverageAwareSummary !== 'function') return saved;
        try {
            return deps.buildCoverageAwareSummary({
                canonical,
                layer: saved.layer || 'auto',
                automationCoverage: {
                    criteria: saved.criteria.filter((c) => c && c.sc).map((c) => ({ sc: c.sc, level: c.level, automation: c.automation })),
                    ...(saved.automationScope ? { engines: saved.automationScope } : {}),
                },
            });
        } catch {
            return saved;
        }
    }

    // The pages an occurrence is on, from the scans it lists: "On 3 of 5
    // pages". Two scans of one page are one page.
    function placeOnPages(canonical, urlOf, pagesTotal) {
        for (const list of [canonical.findings, canonical.bestPractices]) {
            for (const f of Array.isArray(list) ? list : []) {
                for (const occ of Array.isArray(f && f.occurrences) ? f.occurrences : []) {
                    if (!occ || !Array.isArray(occ.scans)) continue;
                    if (!LISTED.has(occ.occurrenceOutcome || occ.outcome || f.outcome)) continue;
                    occ.pageUrls = [...new Set(occ.scans.map(urlOf).filter(Boolean))];
                    occ.pagesTotal = pagesTotal;
                }
            }
        }
    }

    function summaryOf(canonical) {
        const count = (o) => canonical.findings.filter((f) => f && f.outcome === o).length;
        const occurrenceCount = canonical.findings
            .filter((f) => f && f.outcome === 'fail')
            .reduce((n, f) => n + (Array.isArray(f.occurrences) ? f.occurrences.length : 0), 0);
        return { failCount: count('fail'), reviewCount: count('cantTell'), passesCount: count('pass'), occurrenceCount };
    }

    /** One scan folded from a merged group's scans (`members`, in report order). */
    function buildMergedScan(group, entry, members, deps) {
        const included = members.filter(isIncluded);
        const parts = (included.length ? included : members).filter((s) => s.canonical);
        const lead = parts[0] || members[0];
        const label = (entry && entry.name) || group.label;
        const urlOf = new Map(members.map((s) => [s.id, s.url || null]));
        const pagesTotal = new Set(parts.map((s) => s.url).filter(Boolean)).size;

        let canonical = null;
        if (parts.length) {
            canonical = deps.fold.mergeCanonicals(
                parts.map((s) => ({ canonical: s.canonical, context: s.id, name: s.label || s.id })),
                parts.length,
                { dimension: 'scans' },
            );
            placeOnPages(canonical, (id) => urlOf.get(id), pagesTotal);
        }

        // The page-size figures the score divides by: the member with the
        // most elements, the template as fully as any page shows it (§11).
        const domMetrics = parts
            .map((s) => s.metrics && s.metrics.domMetrics)
            .filter((d) => d && typeof d.totalElements === 'number')
            .sort((a, b) => b.totalElements - a.totalElements)[0] || null;
        const coverageSummary = canonical ? coverageOf(canonical, parts, deps) : null;
        let a11ySummary = null;
        if (canonical && domMetrics && typeof deps.buildA11ySummary === 'function') {
            try {
                a11ySummary = deps.buildA11ySummary({
                    canonical: deps.fold.scoringView(canonical),
                    domMetrics,
                    coverageSummary,
                    profiles: deps.fold.sharedScanProfiles(parts),
                });
            } catch {
                a11ySummary = null;
            }
        }

        const tags = [...new Set(members.flatMap((s) => (Array.isArray(s.scanTags) ? s.scanTags : [])))];
        const metricDefs = lead && lead.metrics && lead.metrics.metricDefs;
        return {
            ...(lead ? settingsOf(lead) : {}),
            id: mergedScanId(group.key),
            label,
            url: lead ? lead.url || null : null,
            scanTags: tags.length ? tags : null,
            // The first scan's pictures: a template looks the same on every
            // page, and five hundred pictures of it would say no more.
            screenshots: lead && Array.isArray(lead.screenshots) ? lead.screenshots : [],
            skipped: false,
            skipInfo: null,
            canonical,
            summary: canonical ? summaryOf(canonical) : { failCount: 0, reviewCount: 0, passesCount: 0, occurrenceCount: 0 },
            includedInReport: included.length > 0,
            metrics: {
                ...(domMetrics ? { domMetrics } : {}),
                ...(coverageSummary ? { coverageSummary } : {}),
                ...(a11ySummary ? { a11ySummary } : {}),
                ...(metricDefs ? { metricDefs } : {}),
            },
            mergedGroup: {
                key: group.key,
                pattern: group.label,
                name: (entry && entry.name) || null,
                pagesTotal,
                members: members.map((s) => ({
                    id: s.id,
                    label: s.label || s.id,
                    url: s.url || null,
                    includedInReport: isIncluded(s),
                })),
            },
        };
    }

    /**
     * The report's scans as shown: each group the person merged (`choice`
     * entries with `merge`, readChoice) in place of its scans, at the place
     * of its first; the other scans as they are.
     * - result: findGroups over these same scans;
     * - deps: { fold (scan-fold.js), buildA11ySummary, buildCoverageAwareSummary }.
     * A scan is in one merged scan at most: the larger group is merged
     * first, so a merged group inside a merged group is merged into it
     * (§9.4). A group left with fewer than two scans is not merged.
     *
     * Returns { scans, merges }: merges by merged scan id, each
     * { id, key, members } (member ids, report order).
     */
    function scansAsShown(scans, result, choice, deps) {
        const list = Array.isArray(scans) ? scans : [];
        const wanted = (Array.isArray(choice) ? choice : []).filter((p) => p && p.merge === true);
        const merges = new Map();
        if (!wanted.length || !result || !deps || !deps.fold) return { scans: list, merges };

        const byKey = new Map(flatten(result.groups).map((g) => [g.key, g]));
        const position = new Map(list.map((s, i) => [s && s.id, i]));
        const order = wanted
            .map((entry, i) => ({ entry, group: byKey.get(entry.key), i }))
            .filter((x) => x.group)
            .sort((a, b) => b.group.size - a.group.size || a.i - b.i);

        const taken = new Map();
        const built = new Map();
        for (const { entry, group } of order) {
            const members = group.members
                .filter((id) => position.has(id) && !taken.has(id))
                .sort((a, b) => position.get(a) - position.get(b))
                .map((id) => list[position.get(id)]);
            if (members.length < 2) continue;
            const merged = buildMergedScan(group, entry, members, deps);
            for (const s of members) taken.set(s.id, merged.id);
            built.set(merged.id, merged);
            merges.set(merged.id, { id: merged.id, key: group.key, members: members.map((s) => s.id) });
        }
        if (!built.size) return { scans: list, merges };

        const out = [];
        const placed = new Set();
        for (const s of list) {
            const mergedId = s && taken.get(s.id);
            if (!mergedId) { out.push(s); continue; }
            if (placed.has(mergedId)) continue;
            placed.add(mergedId);
            out.push(built.get(mergedId));
        }
        return { scans: out, merges };
    }

    return {
        mergedScanId,
        scansAsShown,
    };
}));
