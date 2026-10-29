'use strict';

// How a report's automatic failures are spread across its scans
// (docs/design/issue-dispersion-design.md). Pure and DOM-free: numbers only. The
// wording and the charts live in issue-dispersion-view.js.
//
// The unit is the scan, not the page: a single-page app keeps one URL across
// many states, and a workflow visits the same URL in different steps. The
// issue is the failing rule; element counts only add weight. Can't-tell
// results are counted apart and never mixed into the failure metrics.
//
// Nothing here is stored in the report JSON. It is recomputed from the scans
// in view whenever a report is shown, because exclusions, the tag filter, the
// engine lens and scan moves all change the answer.
//
// Browser: available as globalThis.A11Y_ISSUE_DISPERSION.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_ISSUE_DISPERSION = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // Thresholds, not truths (design notes §4). Named so the tests and the
    // view read the same values.
    const THRESHOLDS = Object.freeze({
        widespread: 0.6,     // scan reach at or above: widespread
        partial: 0.25,       // scan reach at or above (and below widespread): partial
        heavy: 3,            // failing elements per failing scan at or above: heavy
        minScans: 10,        // fewer analyzed scans: no pattern, no percentages
        hotspotShare: 0.15,  // a stretch must hold this share of non-widespread elements
        fewAffected: 0.2,    // affected-scan rate at or below: concentrated
        topShare: 0.6,       // worst-10% share at or above: concentrated
        change: 0.2,         // reach change (in share points) that counts as moved
        hotspotGap: 2,       // flagged scans at most this far apart join one stretch
        maxHotspots: 2,
    });

    const SEV_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 };
    function normSev(s) { const k = String(s || 'unknown'); return SEV_RANK[k] == null ? 'unknown' : k; }
    function worse(a, b) { return SEV_RANK[a] <= SEV_RANK[b] ? a : b; }

    // The same reading of an occurrence's own outcome the tables use
    // (splitFindingByOccurrenceOutcome): an occurrence may carry its own tier,
    // and otherwise inherits the finding's.
    function occurrenceOutcome(occ, fallback) {
        const own = String((occ && (occ.occurrenceOutcome || occ.outcome)) || '').trim();
        if (own === 'fail' || own === 'cantTell') return own;
        if (fallback === 'fail' || fallback === 'cantTell') return fallback;
        return null;
    }

    function isAnalyzed(scan) {
        return !!scan && scan.includedInReport !== false && !scan.skipped && !scan.skipInfo;
    }

    // ruleId -> { severity, title, elements } for one outcome in one scan.
    function rulesInScan(scan, outcome) {
        const out = new Map();
        const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings)
            ? scan.canonical.findings : [];
        for (const f of findings) {
            if (!f) continue;
            const ruleId = f.ruleId || f.id;
            if (!ruleId) continue;
            const occs = Array.isArray(f.occurrences) ? f.occurrences : [];
            let elements = 0;
            if (occs.length) {
                for (const o of occs) if (occurrenceOutcome(o, f.outcome) === outcome) elements++;
            } else if (f.outcome === outcome) {
                // A finding with no occurrence list still says the rule failed.
                elements = 1;
            }
            if (!elements) continue;
            const prev = out.get(ruleId);
            if (prev) {
                prev.elements += elements;
                prev.severity = worse(prev.severity, normSev(f.severity));
            } else {
                out.set(ruleId, {
                    severity: normSev(f.severity),
                    title: f.title || f.description || String(ruleId),
                    elements,
                });
            }
        }
        return out;
    }

    function bandOf(reach) {
        if (reach >= THRESHOLDS.widespread) return 'widespread';
        if (reach >= THRESHOLDS.partial) return 'partial';
        return 'local';
    }

    // The rule map's quadrants (design notes §4).
    function kindOf(reach, intensity) {
        const wide = reach >= THRESHOLDS.widespread;
        const heavy = intensity >= THRESHOLDS.heavy;
        if (wide) return heavy ? 'template' : 'component';
        return heavy ? 'page' : 'oneOff';
    }

    function scanIdOf(scan, index) {
        const id = scan && (scan.id != null ? scan.id : scan.scanId);
        return id != null && id !== '' ? String(id) : String(index);
    }

    // Labels of a stretch of scans, short enough for a chart annotation:
    // "Payment", "Cart, Payment" or "Product 1 … Product 9" (ellipsis set).
    function labelsOf(perScan, from, to) {
        const seen = [];
        for (let i = from; i <= to; i++) {
            const l = perScan[i].label;
            if (l && !seen.includes(l)) seen.push(l);
        }
        if (seen.length <= 2) return { labels: seen, ellipsis: false };
        return { labels: [seen[0], seen[seen.length - 1]], ellipsis: true };
    }

    function hotspotsOf(perScan, affectedRate) {
        const otherTotal = perScan.reduce((s, p) => s + p.otherElements, 0);
        if (!otherTotal) return [];
        const few = affectedRate <= THRESHOLDS.fewAffected;
        const groups = [];
        perScan.forEach((p, i) => {
            const flagged = p.other >= 2 || (few && p.other >= 1);
            if (!flagged) return;
            const g = groups[groups.length - 1];
            if (g && i - g.to <= THRESHOLDS.hotspotGap) g.to = i;
            else groups.push({ from: i, to: i });
        });
        return groups
            .map((g) => {
                let elements = 0;
                const scanIds = [];
                for (let i = g.from; i <= g.to; i++) {
                    elements += perScan[i].otherElements;
                    scanIds.push(perScan[i].scanId);
                }
                const { labels, ellipsis } = labelsOf(perScan, g.from, g.to);
                return {
                    fromIndex: g.from,
                    toIndex: g.to,
                    scanCount: g.to - g.from + 1,
                    scanIds,
                    labels,
                    ellipsis,
                    elements,
                    share: elements / otherTotal,
                };
            })
            .filter((h) => h.share >= THRESHOLDS.hotspotShare)
            .sort((a, b) => b.elements - a.elements || a.fromIndex - b.fromIndex)
            .slice(0, THRESHOLDS.maxHotspots);
    }

    function patternOf(r) {
        if (r.scansAnalyzed < THRESHOLDS.minScans) return 'few';
        if (!r.rulesFailing) return 'clean';
        if (r.affectedRate <= THRESHOLDS.fewAffected) return 'concentrated';
        if (r.bands.widespread === r.rulesFailing) return 'widespread';
        if (r.bands.widespread > 0) return 'mixed';
        if (r.top10Share >= THRESHOLDS.topShare) return 'concentrated';
        return 'scattered';
    }

    /**
     * Analyse the scans of one report, in the order given (the report's scan
     * order, including the user's moves). Excluded and skipped scans are left
     * out here too, so any caller gets the same set.
     */
    function analyseDispersion(scans) {
        const list = (Array.isArray(scans) ? scans : []).filter(isAnalyzed);
        const N = list.length;

        const rules = new Map();
        const reviewRules = new Set();
        let reviewScans = 0;

        const perScan = list.map((scan, index) => {
            const fails = rulesInScan(scan, 'fail');
            const review = rulesInScan(scan, 'cantTell');
            if (review.size) reviewScans++;
            for (const id of review.keys()) reviewRules.add(id);

            let elements = 0;
            for (const [ruleId, hit] of fails) {
                elements += hit.elements;
                const entry = rules.get(ruleId);
                if (entry) {
                    entry.scans++;
                    entry.elements += hit.elements;
                    entry.severity = worse(entry.severity, hit.severity);
                } else {
                    rules.set(ruleId, {
                        ruleId, title: hit.title, severity: hit.severity, scans: 1, elements: hit.elements,
                    });
                }
            }
            return {
                index,
                scanId: scanIdOf(scan, index),
                label: typeof scan.label === 'string' ? scan.label.trim() : '',
                ruleIds: [...fails.keys()],
                elementsByRule: fails,
                elements,
            };
        });

        const ruleRows = [...rules.values()].map((r) => {
            const reach = N ? r.scans / N : 0;
            const intensity = r.scans ? r.elements / r.scans : 0;
            return { ...r, reach, intensity, band: bandOf(reach), kind: kindOf(reach, intensity) };
        }).sort((a, b) => b.reach - a.reach || b.intensity - a.intensity
            || String(a.ruleId).localeCompare(String(b.ruleId)));

        const bandById = new Map(ruleRows.map((r) => [r.ruleId, r.band]));
        const perScanOut = perScan.map((p) => {
            let widespread = 0, other = 0, otherElements = 0;
            for (const [ruleId, hit] of p.elementsByRule) {
                if (bandById.get(ruleId) === 'widespread') widespread++;
                else { other++; otherElements += hit.elements; }
            }
            // ruleElements[i] is the failing elements of ruleIds[i], so the
            // strip can count any subset of the rules, by rule or by element.
            return {
                index: p.index, scanId: p.scanId, label: p.label,
                ruleIds: p.ruleIds, ruleElements: p.ruleIds.map((id) => p.elementsByRule.get(id).elements),
                elements: p.elements,
                widespread, other, otherElements,
            };
        });

        const R = ruleRows.length;
        const affectedScans = perScanOut.filter((p) => p.ruleIds.length).length;
        const affectedRate = N ? affectedScans / N : 0;
        const presences = ruleRows.reduce((s, r) => s + r.scans, 0);
        const totalElements = perScanOut.reduce((s, p) => s + p.elements, 0);

        const sorted = perScanOut.map((p) => p.elements).sort((a, b) => b - a);
        const k = Math.max(1, Math.ceil(N * 0.1));
        const top10Share = totalElements ? sorted.slice(0, k).reduce((s, v) => s + v, 0) / totalElements : 0;
        let acc = 0, scansFor80 = 0;
        for (const v of sorted) {
            if (acc >= 0.8 * totalElements) break;
            acc += v;
            scansFor80++;
        }
        if (!totalElements) scansFor80 = 0;

        const bands = { widespread: 0, partial: 0, local: 0 };
        for (const r of ruleRows) bands[r.band]++;

        const affectedCounts = perScanOut.filter((p) => p.ruleIds.length).map((p) => p.ruleIds.length)
            .sort((a, b) => a - b);

        const result = {
            scansAnalyzed: N,
            rulesFailing: R,
            enoughData: N >= THRESHOLDS.minScans,
            affectedScans,
            affectedRate,
            footprint: R && N ? presences / (R * N) : 0,
            totalElements,
            top10Share,
            scansFor80,
            scansFor80Share: N ? scansFor80 / N : 0,
            cleanIfWidespreadFixed: perScanOut.filter((p) => p.other === 0).length,
            medianRulesPerAffectedScan: affectedCounts.length
                ? affectedCounts[Math.floor(affectedCounts.length / 2)] : 0,
            maxRulesInScan: perScanOut.reduce((m, p) => Math.max(m, p.ruleIds.length), 0),
            bands,
            rules: ruleRows,
            perScan: perScanOut,
            cantTell: { rules: reviewRules.size, scans: reviewScans },
        };
        result.hotspots = hotspotsOf(perScanOut, affectedRate);
        result.pattern = patternOf(result);
        return result;
    }

    function changeOf(a, b) {
        if (a && !b) return 'resolved';
        if (!a && b) return 'new';
        const d = b.reach - a.reach;
        if (d <= -THRESHOLDS.change) return 'contained';
        if (d >= THRESHOLDS.change) return 'spread';
        return 'steady';
    }

    /**
     * How each rule's reach moved from A to B. A second axis next to the rule
     * diff's resolved/new/persistent: a persistent rule can still be contained.
     */
    function compareDispersion(a, b) {
        const byA = new Map(a.rules.map((r) => [r.ruleId, r]));
        const byB = new Map(b.rules.map((r) => [r.ruleId, r]));
        const ids = [...new Set([...byA.keys(), ...byB.keys()])];
        const rows = ids.map((ruleId) => {
            const ra = byA.get(ruleId) || null;
            const rb = byB.get(ruleId) || null;
            return {
                ruleId,
                title: (rb || ra).title,
                severity: rb && ra ? worse(ra.severity, rb.severity) : (rb || ra).severity,
                a: ra, b: rb,
                delta: (rb ? rb.reach : 0) - (ra ? ra.reach : 0),
                change: changeOf(ra, rb),
            };
        }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)
            || String(x.ruleId).localeCompare(String(y.ruleId)));
        const counts = { contained: 0, spread: 0, steady: 0, new: 0, resolved: 0 };
        for (const r of rows) counts[r.change]++;
        return { a, b, rows, counts };
    }

    function trendOf(reach) {
        const last = reach[reach.length - 1];
        const peak = Math.max(...reach);
        const firstSeen = reach.find((v) => v > 0);
        if (!last) return 'resolved';
        if (peak - last >= THRESHOLDS.change) return 'contained';
        if (firstSeen != null && last - firstSeen >= THRESHOLDS.change) return 'spread';
        // New only when the latest column is the first to see it; a rule that
        // came and went before is not new, however it started.
        if (reach.slice(0, -1).every((v) => !v)) return 'new';
        return 'steady';
    }

    /** Reach per rule across an ordered list of analyses. */
    function seriesDispersion(results) {
        const list = Array.isArray(results) ? results : [];
        const meta = new Map();
        for (const res of list) {
            for (const r of res.rules) {
                const prev = meta.get(r.ruleId);
                meta.set(r.ruleId, {
                    title: prev ? prev.title : r.title,
                    severity: prev ? worse(prev.severity, r.severity) : r.severity,
                });
            }
        }
        const rows = [...meta.entries()].map(([ruleId, m]) => {
            const reach = list.map((res) => {
                const r = res.rules.find((x) => x.ruleId === ruleId);
                return r ? r.reach : 0;
            });
            return { ruleId, title: m.title, severity: m.severity, reach, trend: trendOf(reach) };
        }).sort((x, y) => Math.max(...y.reach) - Math.max(...x.reach)
            || String(x.ruleId).localeCompare(String(y.ruleId)));
        return { results: list, rows };
    }

    return {
        THRESHOLDS,
        analyseDispersion,
        compareDispersion,
        seriesDispersion,
        isAnalyzed,
    };
}));
