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

    // ----------------------------------------------- what the run merged (§8)

    // A context of a run's merged scan as a scan of its own: the scan the run
    // kept for it (contexts[i].scan), with what the merged scan holds for all
    // of them, its rule catalogue and the pictures taken in this context.
    function contextAsScan(raw, context, index, included) {
        const own = context.scan;
        const canonical = { ...own.canonical };
        if (raw.canonical && raw.canonical.rules && !canonical.rules) canonical.rules = raw.canonical.rules;
        if (raw.canonical && raw.canonical.rulesCatalog != null && canonical.rulesCatalog == null) canonical.rulesCatalog = raw.canonical.rulesCatalog;
        const metricDefs = raw.metrics && raw.metrics.metricDefs;
        const shots = (Array.isArray(raw.screenshots) ? raw.screenshots : [])
            .filter((shot) => shot && (shot.name === context.name || shot.label === context.name));
        return {
            ...own,
            id: `${raw.id}~${index}`,
            label: `${raw.label || raw.id} · ${context.name}`,
            url: context.url || own.url || raw.url || null,
            canonical,
            metrics: { ...(own.metrics || {}), ...(metricDefs ? { metricDefs } : {}) },
            screenshots: shots,
            includedInReport: included,
            runContext: { scanId: raw.id, index, name: context.name, of: raw.label || raw.id },
        };
    }

    // A run's merged scan folded again from the contexts kept in it, as the
    // runner folds it (scan-fold.js, contexts), scored as a merged group is.
    function refoldRunMerge(raw, kept, out, deps) {
        const canonical = deps.fold.mergeCanonicals(
            kept.map((s) => ({ canonical: s.canonical, context: s.runContext.name })),
            kept.length,
        );
        if (raw.canonical && raw.canonical.rules) canonical.rules = raw.canonical.rules;
        if (raw.canonical && raw.canonical.rulesCatalog != null) canonical.rulesCatalog = raw.canonical.rulesCatalog;
        const domMetrics = kept
            .map((s) => s.metrics && s.metrics.domMetrics)
            .filter((d) => d && typeof d.totalElements === 'number')
            .sort((a, b) => b.totalElements - a.totalElements)[0] || (raw.metrics && raw.metrics.domMetrics) || null;
        const coverageSummary = coverageOf(canonical, kept, deps);
        let a11ySummary = raw.metrics && raw.metrics.a11ySummary || null;
        if (domMetrics && typeof deps.buildA11ySummary === 'function') {
            try {
                a11ySummary = deps.buildA11ySummary({
                    canonical: deps.fold.scoringView(canonical),
                    domMetrics,
                    coverageSummary,
                    profiles: deps.fold.sharedScanProfiles(kept),
                });
            } catch {
                // Keep the run's.
            }
        }
        const keptNames = new Set(kept.map((s) => s.runContext.name));
        return {
            ...raw,
            canonical,
            summary: { ...(raw.summary || {}), ...summaryOf(canonical) },
            metrics: {
                ...(raw.metrics || {}),
                ...(domMetrics ? { domMetrics } : {}),
                ...(coverageSummary ? { coverageSummary } : {}),
                ...(a11ySummary ? { a11ySummary } : {}),
            },
            screenshots: (Array.isArray(raw.screenshots) ? raw.screenshots : [])
                .filter((shot) => !shot || !(shot.name || shot.label) || keptNames.has(shot.name) || keptNames.has(shot.label)),
            contexts: raw.contexts.map((c, i) => (out.has(String(i)) ? { ...c, takenOut: true } : c)),
        };
    }

    /**
     * The report's scans with each run's merged scan as the person left it
     * (docs/design/scan-grouping-design.md §8): unmerged into its contexts,
     * each a scan of its own; or folded again without the contexts taken
     * out, which follow it, each on its own; or as the run made it. Only a
     * merged scan whose contexts' scans the run kept can be changed.
     * Returns { scans, contexts }: contexts by shown id, { scanId, index }.
     */
    function expandRunMerges(scans, choice, deps) {
        const list = Array.isArray(scans) ? scans : [];
        const contexts = new Map();
        const byScan = new Map((Array.isArray(choice) ? choice : [])
            .filter((p) => p && typeof p.key === 'string' && p.key.startsWith('run:'))
            .map((p) => [p.key.slice(4), p]));
        if (!byScan.size) return { scans: list, contexts };

        const out = [];
        for (const raw of list) {
            const entry = raw && byScan.get(String(raw.id));
            const kept = raw && raw.mergedScan === true && Array.isArray(raw.contexts)
                ? raw.contexts.map((c, i) => ({ c, i })).filter(({ c }) => c && c.scan && c.scan.canonical)
                : [];
            if (!entry || kept.length < 1) { out.push(raw); continue; }
            const included = isIncluded(raw);
            const asScans = kept.map(({ c, i }) => contextAsScan(raw, c, i, included));
            asScans.forEach((s) => contexts.set(s.id, { scanId: raw.id, index: s.runContext.index }));

            if (entry.merge === false) {
                const excluded = new Set(entry.exclude || []);
                for (const s of asScans) out.push({ ...s, includedInReport: included && !excluded.has(String(s.runContext.index)) });
                continue;
            }
            const removed = new Set(entry.remove || []);
            const stay = asScans.filter((s) => !removed.has(String(s.runContext.index)));
            const left = asScans.filter((s) => removed.has(String(s.runContext.index)));
            if (stay.length && deps && deps.fold) out.push(refoldRunMerge(raw, stay, removed, deps));
            out.push(...left);
        }
        return { scans: out, contexts };
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
        // What the run merged, as the person left it, first: a group merged
        // here then holds a run's merged scan as it is shown.
        const run = expandRunMerges(scans, choice, deps);
        const list = run.scans;
        const wanted = (Array.isArray(choice) ? choice : []).filter((p) => p && p.merge === true);
        const merges = new Map();
        if (!wanted.length || !result || !deps || !deps.fold) return { scans: list, merges, contexts: run.contexts };

        const byKey = new Map(flatten(result.groups).map((g) => [g.key, g]));
        const position = new Map(list.map((s, i) => [s && s.id, i]));
        const order = wanted
            .map((entry, i) => ({ entry, group: byKey.get(entry.key), i }))
            .filter((x) => x.group)
            .sort((a, b) => b.group.size - a.group.size || a.i - b.i);

        // A group's scans as the person left them (§9.2): its own for a group
        // by hand, else the pattern's without those taken out, with those
        // added. A scan put in a group by hand is that group's before any
        // pattern's: the last place it was put is where it is (§9.4).
        const membersOf = (entry, group) => {
            if (Array.isArray(entry.members)) return entry.members;
            const removed = new Set(entry.remove || []);
            const out = group.members.filter((id) => !removed.has(id));
            for (const id of entry.add || []) if (!out.includes(id)) out.push(id);
            return out;
        };
        const reserved = new Map();
        for (const { entry } of order) {
            for (const id of [...(entry.members || []), ...(entry.add || [])]) {
                if (!reserved.has(id)) reserved.set(id, entry.key);
            }
        }

        const taken = new Map();
        const built = new Map();
        for (const { entry, group } of order) {
            const members = membersOf(entry, group)
                .filter((id) => position.has(id) && !taken.has(id))
                .filter((id) => !reserved.has(id) || reserved.get(id) === entry.key)
                .sort((a, b) => position.get(a) - position.get(b))
                .map((id) => list[position.get(id)]);
            if (members.length < 2) continue;
            const merged = buildMergedScan(group, entry, members, deps);
            for (const s of members) taken.set(s.id, merged.id);
            built.set(merged.id, merged);
            merges.set(merged.id, { id: merged.id, key: group.key, members: members.map((s) => s.id) });
        }
        if (!built.size) return { scans: list, merges, contexts: run.contexts };

        const out = [];
        const placed = new Set();
        for (const s of list) {
            const mergedId = s && taken.get(s.id);
            if (!mergedId) { out.push(s); continue; }
            if (placed.has(mergedId)) continue;
            placed.add(mergedId);
            out.push(built.get(mergedId));
        }
        return { scans: out, merges, contexts: run.contexts };
    }

    // A failure is the template's when this share of a group's scans have it,
    // not every one: one page built otherwise (a gift card among products,
    // without their price badge) must not turn the template's failures into
    // content, and every page into one that differs (docs/design/
    // scan-grouping-design.md §11.2).
    const TEMPLATE_SHARE = 0.6;
    // A page this much bigger or smaller than the group's median is built
    // unlike the others.
    const SIZE_SPREAD = 0.3;

    /**
     * What a group's scans fail together and apart (§10 step 6, §11.2): its
     * scans folded by page, without merging them, and each failing element
     * sorted by how many of them fail it.
     * - template: on most of the group's scans (TEMPLATE_SHARE), the
     *   template's to fix once;
     * - content: on fewer, each page's own content.
     * Each entry is a rule: { ruleId, title, severity, elements, scans }
     * (`scans`: the ids of the scans it fails on, report order).
     * - byScan: how each scan differs from the others, by id: `own`, the
     *   rules it fails that few others do; `missing`, the template's rules it
     *   does not fail (it is built otherwise); `size`, whether its page is far
     *   bigger or smaller than the others'; `unlike`, either of the last two.
     * Failures only, as issue dispersion counts them; every scan of the
     * group, excluded ones too, so the person sees what excluding hides.
     * Null for fewer than two scans with findings.
     */
    function groupIssues(members, deps) {
        const parts = (Array.isArray(members) ? members : []).filter((s) => s && s.canonical);
        if (parts.length < 2 || !deps || !deps.fold) return null;
        const order = new Map(parts.map((s, i) => [s.id, i]));
        const canonical = deps.fold.mergeCanonicals(
            parts.map((s) => ({ canonical: s.canonical, context: s.id, name: s.label || s.id })),
            parts.length,
            { dimension: 'scans' },
        );
        const common = (count) => count / parts.length >= TEMPLATE_SHARE;
        const template = new Map();
        const content = new Map();
        const byScan = new Map(parts.map((s) => [s.id, { own: new Map(), missing: new Map(), size: false, unlike: false }]));
        const ruleOf = (f) => ({ ruleId: f.ruleId || f.id, title: f.title || f.help || f.ruleId || f.id, severity: f.severity || 'unknown' });
        for (const f of canonical.findings) {
            if (!f || f.outcome !== 'fail') continue;
            for (const occ of Array.isArray(f.occurrences) ? f.occurrences : []) {
                if (!occ || (occ.occurrenceOutcome || occ.outcome || 'fail') !== 'fail') continue;
                const on = Array.isArray(occ.scans) ? occ.scans : [];
                const isTemplate = common(on.length);
                const into = isTemplate ? template : content;
                const rule = ruleOf(f);
                let entry = into.get(rule.ruleId);
                if (!entry) {
                    entry = { ...rule, elements: 0, scans: new Set() };
                    into.set(rule.ruleId, entry);
                }
                entry.elements += 1;
                for (const scanId of on) entry.scans.add(scanId);
                // Each scan: what it fails that few do, what it lacks of the template.
                const onSet = new Set(on);
                for (const [scanId, d] of byScan) {
                    if (isTemplate && !onSet.has(scanId)) d.missing.set(rule.ruleId, rule);
                    if (!isTemplate && onSet.has(scanId)) d.own.set(rule.ruleId, rule);
                }
            }
        }
        const sizes = parts.map((s) => s.metrics && s.metrics.domMetrics && s.metrics.domMetrics.totalElements)
            .filter((n) => typeof n === 'number' && n > 0).sort((a, b) => a - b);
        const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;
        const out = new Map();
        for (const s of parts) {
            const d = byScan.get(s.id);
            const total = s.metrics && s.metrics.domMetrics && s.metrics.domMetrics.totalElements;
            const size = !!median && typeof total === 'number' && Math.abs(total - median) / median > SIZE_SPREAD;
            const missing = [...d.missing.values()];
            out.set(s.id, { own: [...d.own.values()], missing, size, unlike: size || missing.length > 0 });
        }
        const SEVERITY = { critical: 0, serious: 1, moderate: 2, minor: 3 };
        const listOf = (map) => [...map.values()]
            .map((e) => ({ ...e, scans: [...e.scans].sort((a, b) => order.get(a) - order.get(b)) }))
            .sort((a, b) => (SEVERITY[a.severity] ?? 4) - (SEVERITY[b.severity] ?? 4)
                || b.scans.length - a.scans.length
                || String(a.title).localeCompare(String(b.title)));
        return { scansTotal: parts.length, template: listOf(template), content: listOf(content), byScan: out };
    }

    return {
        TEMPLATE_SHARE,
        expandRunMerges,
        groupIssues,
        mergedScanId,
        scansAsShown,
    };
}));
