'use strict';

/**
 * Build "global / portfolio" metrics objects (domMetrics, textMetrics, a11ySummary)
 * from:
 *  - scans[]: each scan has { domMetrics, textMetrics } (outputs of collectDomMetrics/collectTextMetrics)
 *  - mergedA11y: optional legacy merged results: { violations:[], incomplete:[], passes:[] }
 *
 * Output shapes match per-scan shapes so you can reuse the same rendering.
 *
 * Notes / choices (professional defaults):
 * - Ratios and per-1k metrics are recomputed from summed numerators/denominators (not averages).
 * - Peak-like complexity metrics use P90 across pages (stable, avoids inflating just because you scanned many pages).
 * - Global confidence uses MIN across pages (weakest-link reliability); adjusted uses
 *   composeAdjusted(100 - evidence, confidence / 100), the same headroom-based composition a11y-summary.js uses.
 * - Portfolio depth uses per-URL grouping:
 *     sum(weight * Σ_urls sqrt(countOccurrencesOnUrl))
 *
 * Engine-agnostic runtime:
 * - Evidence is computed from canonical findings across scans.
 * - If a caller explicitly provides mergedA11y, we still support it for debug/compat.
 * - Output uses neutral keys (engine).
 */

// Shared by the server, which builds a run's summary, and the app, which
// builds it again over the scans a report includes, so the two agree.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./a11y-summary.js'), require('./coverage-summary.js'), require('./occurrence-mining.js'), () => require('./shared-profiles.js'));
    } else {
        // shared-profiles.js is read when a run with scans of several
        // profiles is summed up, so it may load after this file.
        root.A11Y_GLOBAL_SUMMARY = factory(root.A11Y_SUMMARY, root.A11Y_COVERAGE_SUMMARY, root.A11Y_OCCURRENCE_MINING, () => root.A11Y_SHARED_PROFILES);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (a11ySummary, coverageSummary, occurrenceMining, sharedProfilesOf) {
    const {
        buildA11ySummary,
        // Reused (not redefined) so per-page and portfolio scoring can never diverge
        // on how a finding's severity is normalized or weighted.
        weightForImpact,
        impactFromSeverity,
        clamp,
        safeNum,
        satScore,
        composeAdjusted,
        contentUnitsFrom,
        primaryContentUnit,
        CONTENT_UNIT_SCALE
    } = a11ySummary;

    const { buildCoverageAwareSummary } = coverageSummary;
    const { mineOccurrences } = occurrenceMining;

    function pickDomMetrics(scan) {
        return scan?.domMetrics || scan?.metrics?.domMetrics || null;
    }

    function pickTextMetrics(scan) {
        // support either: scan.textMetrics, scan.domMetrics.textMetrics, scan.metrics.domMetrics.textMetrics
        return scan?.textMetrics
            || scan?.domMetrics?.textMetrics
            || scan?.metrics?.domMetrics?.textMetrics
            || null;
    }

    function pickA11ySummary(scan) {
        return scan?.a11ySummary || scan?.metrics?.a11ySummary || null;
    }

    function pickCoverageSummary(scan) {
        return scan?.coverageSummary || scan?.metrics?.coverageSummary || null;
    }

    /**
     * Pth percentile of a numeric array (0..100), using the same "floor index" style as the text-metrics helper.
     * p=90 means the 90th percentile element (robust "high but not max").
     */
    function percentile(values, p) {
        const arr = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (!arr.length) return 0;
        const pp = clamp(Number(p) || 0, 0, 100);
        const idx = Math.floor((pp / 100) * (arr.length - 1));
        return arr[clamp(idx, 0, arr.length - 1)];
    }

    function median(values) {
        return percentile(values, 50);
    }

    function mean(values) {
        const arr = asArray(values).map(Number).filter(Number.isFinite);
        if (!arr.length) return 0;
        let sum = 0;
        for (const v of arr) sum += v;
        return sum / arr.length;
    }

    function stddev(values) {
        const arr = asArray(values).map(Number).filter(Number.isFinite);
        const n = arr.length;
        if (n <= 1) return 0;
        const m = mean(arr);
        let acc = 0;
        for (const v of arr) acc += (v - m) * (v - m);
        return Math.sqrt(acc / n); // population stddev
    }

    function scoreDistribution(values) {
        const arr = asArray(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        const n = arr.length;
        if (!n) {
            return {
                n: 0,
                min: 0,
                max: 0,
                mean: 0,
                median: 0,
                p10: 0,
                p25: 0,
                p75: 0,
                p90: 0,
                iqr: 0,
                stddev: 0
            };
        }

        const p10 = percentile(arr, 10);
        const p25 = percentile(arr, 25);
        const p75 = percentile(arr, 75);
        const p90 = percentile(arr, 90);

        return {
            n,
            min: arr[0],
            max: arr[n - 1],
            mean: mean(arr),
            median: median(arr),
            p10,
            p25,
            p75,
            p90,
            iqr: p75 - p25,
            stddev: stddev(arr)
        };
    }

    function asArray(x) {
        return Array.isArray(x) ? x : [];
    }

    /**
     * Pick a stable URL key from a legacy merged node.
     * In some merged shapes, node.url is an array. We'll use the first entry if present.
     */
    function nodeUrlKey(node) {
        if (!node) return '';

        // Common enrichment patterns
        const u =
            node.url ||
            node.pageUrl ||
            node.documentUrl ||
            node.sourceUrl ||
            (node.meta && (node.meta.url || node.meta.pageUrl));

        if (Array.isArray(u) && u.length) return String(u[0] || '').trim();
        if (typeof u === 'string') return u.trim();

        return '';
    }

    /**
     * Compute portfolio breadth and depth sums from legacy merged items.
     * Depth uses URL grouping:
     *   Σ_rules weight(impact) * Σ_urls sqrt(countNodesForRuleOnUrl)
     *
     * This is legacy support, the canonical-only path is preferred.
     */
    function computePortfolioMergedInputs(merged) {
        const violations = asArray(merged && merged.violations);
        const incomplete = asArray(merged && merged.incomplete);
        const passes = asArray(merged && merged.passes);

        function breadth(items) {
            let total = 0;
            for (const it of items) total += weightForImpact(it && it.impact);
            return total;
        }

        function depthSqrtByUrl(items) {
            let total = 0;
            for (const it of items) {
                const w = weightForImpact(it && it.impact);
                const nodes = asArray(it && it.nodes);

                // Group nodes by urlKey
                const byUrl = new Map();
                for (const n of nodes) {
                    const key = nodeUrlKey(n) || '__unknown__';
                    byUrl.set(key, (byUrl.get(key) || 0) + 1);
                }

                // Sublinear per URL bucket (closest to per-page sqrt behavior)
                let ruleDepth = 0;
                for (const [, count] of byUrl.entries()) {
                    ruleDepth += Math.sqrt(Math.max(0, count));
                }

                total += w * ruleDepth;
            }
            return total;
        }

        const violationBreadth = breadth(violations);
        const incompleteBreadth = breadth(incomplete);

        // Depth is stored as an absolute weighted sum (before per-1k normalization)
        const violationDepthWeightedAbs = depthSqrtByUrl(violations);
        const incompleteDepthWeightedAbs = depthSqrtByUrl(incomplete);

        return {
            counts: {
                violations: violations.length,
                incomplete: incomplete.length,
                passes: passes.length
            },
            breadth: {
                violationsWeighted: violationBreadth,
                incompleteWeighted: incompleteBreadth
            },
            depthAbs: {
                violationsWeighted: violationDepthWeightedAbs,
                incompleteWeighted: incompleteDepthWeightedAbs
            }
        };
    }

    /**
     * Build a "global domMetrics" object with the same shape as collectDomMetrics().
     *
     * Professional defaults:
     * - ratios recomputed from summed raw counts
     * - depthMax and statefulComponentsCount use P90 (robust peak metric)
     * - capped is OR across pages
     */
    function buildGlobalDomMetrics(scans, { p90 = 90 } = {}) {
        const doms = asArray(scans).map(pickDomMetrics).filter(Boolean);

        // Sums
        let totalElements = 0;
        let iframeCount = 0;
        let shadowHostCount = 0;
        let positiveTabindexCount = 0;
        let capped = false;

        const counts = {
            div: 0,
            span: 0,
            semantic: 0,
            evaluable: 0,
            interactiveNative: 0,
            customControls: 0,
            hidden: 0,
            focusable: 0,
            dialog: 0,
            details: 0,
            tablist: 0,
            ariaExpanded: 0
        };

        const depthMaxArr = [];
        const statefulArr = [];

        for (const d of doms) {
            totalElements += safeNum(d.totalElements, 0);
            iframeCount += safeNum(d.iframeCount, 0);
            shadowHostCount += safeNum(d.shadowHostCount, 0);
            positiveTabindexCount += safeNum(d.positiveTabindexCount, 0);
            if (d.capped === true) capped = true;

            depthMaxArr.push(safeNum(d.depthMax, 0));
            statefulArr.push(safeNum(d.statefulComponentsCount, 0));

            const c = d.counts || {};
            for (const k of Object.keys(counts)) counts[k] += safeNum(c[k], 0);
        }

        // Robust peaks
        const depthMax = percentile(depthMaxArr, p90);
        const statefulComponentsCount = percentile(statefulArr, p90);

        // Ratios (recompute from totals)
        const semanticRatio =
            (counts.semantic + 1) / (counts.semantic + counts.div + counts.span + 1);

        const coverageRatio =
            (counts.evaluable + 1) / (Math.max(0, totalElements) + 1);

        const hiddenRatio =
            (counts.hidden + 1) / (Math.max(0, totalElements) + 1);

        const customControlsRatio =
            (counts.customControls + 0.5) / (counts.interactiveNative + 0.5);

        const focusableDensityPer1k =
            (counts.focusable / Math.max(1, totalElements)) * 1000;

        const textMetrics = buildGlobalTextMetrics(scans);

        return {
            totalElements,
            capped,
            depthMax,
            coverageRatio,
            semanticRatio,
            customControlsRatio,
            hiddenRatio,
            focusableDensityPer1k,
            statefulComponentsCount,
            positiveTabindexCount,
            iframeCount,
            shadowHostCount,
            counts,
            textMetrics
        };
    }

    /**
     * Build a "global textMetrics" object with the same shape as collectTextMetrics().
     *
     * Notes:
     * - rates/shares are recomputed from totals (not averaged).
     * - paragraphs percentiles cannot be combined exactly without raw lens;
     *   we keep the shape with a robust fallback:
     *     p50Chars = median(page.p50Chars)
     *     p90Chars = median(page.p90Chars)
     *     maxChars = max(page.maxChars)
     */
    function buildGlobalTextMetrics(scans) {
        const texts = asArray(scans).map(pickTextMetrics).filter(Boolean);

        let capped = false;

        // Totals
        let visibleTextChars = 0;
        let elementsVisited = 0;
        let headingCount = 0;

        // Links
        let linksCount = 0;
        let visibleLinkTextChars = 0;
        let linksNoVisibleTextCount = 0;
        let linksNoTextNoNameSignalCount = 0;
        let linksNameSignalCount = 0;

        // Buttons
        let buttonsCount = 0;
        let visibleButtonTextChars = 0;
        let buttonsNoVisibleTextCount = 0;
        let buttonsNoTextNoNameSignalCount = 0;
        let buttonsNameSignalCount = 0;

        // Paragraph summaries (fallback aggregation)
        const paraCountArr = [];
        const paraP50Arr = [];
        const paraP90Arr = [];
        const paraMaxArr = [];
        let paraSelector = 'p, li, dd, td';

        for (const tm of texts) {
            if (tm.capped === true) capped = true;

            const t = tm.totals || {};
            visibleTextChars += safeNum(t.visibleTextChars, 0);
            elementsVisited += safeNum(t.elementsVisited, 0);
            headingCount += safeNum(t.headingCount, 0);

            const links = tm.links || {};
            linksCount += safeNum(links.linksCount, 0);
            visibleLinkTextChars += safeNum(links.visibleLinkTextChars, 0);
            linksNoVisibleTextCount += safeNum(links.linksNoVisibleTextCount, 0);
            linksNoTextNoNameSignalCount += safeNum(links.linksNoTextNoNameSignalCount, 0);
            linksNameSignalCount += safeNum(links.linksNameSignalCount, 0);

            const btns = tm.buttons || {};
            buttonsCount += safeNum(btns.buttonsCount, 0);
            visibleButtonTextChars += safeNum(btns.visibleButtonTextChars, 0);
            buttonsNoVisibleTextCount += safeNum(btns.buttonsNoVisibleTextCount, 0);
            buttonsNoTextNoNameSignalCount += safeNum(btns.buttonsNoTextNoNameSignalCount, 0);
            buttonsNameSignalCount += safeNum(btns.buttonsNameSignalCount, 0);

            const p = tm.paragraphs || {};
            if (p.selector) paraSelector = String(p.selector);
            paraCountArr.push(safeNum(p.count, 0));
            paraP50Arr.push(safeNum(p.p50Chars, 0));
            paraP90Arr.push(safeNum(p.p90Chars, 0));
            paraMaxArr.push(safeNum(p.maxChars, 0));
        }

        const visibleTextCharsPer1k = (visibleTextChars / Math.max(1, elementsVisited)) * 1000;
        const textCharsPerHeading = visibleTextChars / Math.max(1, headingCount);

        // Shares
        const linkTextShare = visibleTextChars > 0 ? (visibleLinkTextChars / visibleTextChars) : 0;
        const buttonTextShare = visibleTextChars > 0 ? (visibleButtonTextChars / visibleTextChars) : 0;

        // Rates (global from totals)
        const linksNoVisibleTextRate = linksCount ? (linksNoVisibleTextCount / linksCount) : 0;
        const linksNoTextNoNameSignalRate = linksCount ? (linksNoTextNoNameSignalCount / linksCount) : 0;
        const linksNameSignalRate = linksCount ? (linksNameSignalCount / linksCount) : 0;

        const buttonsNoVisibleTextRate = buttonsCount ? (buttonsNoVisibleTextCount / buttonsCount) : 0;
        const buttonsNoTextNoNameSignalRate = buttonsCount ? (buttonsNoTextNoNameSignalCount / buttonsCount) : 0;
        const buttonsNameSignalRate = buttonsCount ? (buttonsNameSignalCount / buttonsCount) : 0;

        // Densities (global from totals)
        const linksPer1k = (linksCount / Math.max(1, elementsVisited)) * 1000;
        const buttonsPer1k = (buttonsCount / Math.max(1, elementsVisited)) * 1000;

        // Paragraphs (fallback)
        const paraCount = paraCountArr.reduce((a, b) => a + b, 0);
        const p50Chars = median(paraP50Arr);
        const p90Chars = median(paraP90Arr);
        const maxChars = paraMaxArr.length ? Math.max(...paraMaxArr) : 0;

        return {
            capped,
            totals: {
                visibleTextChars,
                elementsVisited,
                headingCount
            },
            density: {
                visibleTextCharsPer1k,
                textCharsPerHeading
            },
            paragraphs: {
                selector: paraSelector,
                count: paraCount,
                p50Chars,
                p90Chars,
                maxChars
            },
            links: {
                selector: 'a[href]',
                linksCount,
                linksPer1k,
                visibleLinkTextChars,
                linkTextShare,

                linksNoVisibleTextCount,
                linksNoVisibleTextRate: clamp(linksNoVisibleTextRate, 0, 1),

                linksNameSignalCount,
                linksNameSignalRate: clamp(linksNameSignalRate, 0, 1),

                linksNoTextNoNameSignalCount,
                linksNoTextNoNameSignalRate: clamp(linksNoTextNoNameSignalRate, 0, 1)
            },
            buttons: {
                selector: 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
                buttonsCount,
                buttonsPer1k,
                visibleButtonTextChars,
                buttonTextShare,

                buttonsNoVisibleTextCount,
                buttonsNoVisibleTextRate: clamp(buttonsNoVisibleTextRate, 0, 1),

                buttonsNameSignalCount,
                buttonsNameSignalRate: clamp(buttonsNameSignalRate, 0, 1),

                buttonsNoTextNoNameSignalCount,
                buttonsNoTextNoNameSignalRate: clamp(buttonsNoTextNoNameSignalRate, 0, 1)
            }
        };
    }

    /**
     * Compute global evidence from legacy merged results and global domTotal, using the same model as a11y-summary.js.
     * Legacy support only, canonical-only is preferred.
     */
    function computeGlobalEvidenceFromMerged(merged, domTotal) {
        const m = computePortfolioMergedInputs(merged);

        const domT = Math.max(1, safeNum(domTotal, 1));

        // Convert abs depth into per-1k
        const violationDepthPer1k = (m.depthAbs.violationsWeighted / domT) * 1000;
        const incompleteDepthPer1k = (m.depthAbs.incompleteWeighted / domT) * 1000;

        const riskRaw =
            satScore(m.breadth.violationsWeighted, 8) +
            0.25 * satScore(m.breadth.incompleteWeighted, 10) +
            satScore(violationDepthPer1k, 35) +
            0.2 * satScore(incompleteDepthPer1k, 45);

        const riskWeightsSum = (1 + 0.25 + 1 + 0.2);
        const riskClamped = clamp(riskRaw / riskWeightsSum, 0, 100);

        const evidence = clamp(100 - riskClamped, 0, 100);

        const out = {
            evidence: Math.round(evidence),
            riskRaw: Math.round(riskRaw * 10) / 10,
            riskClamped: Math.round(riskClamped * 10) / 10,
            breadth: {
                violationsWeighted: Math.round(m.breadth.violationsWeighted * 10) / 10,
                incompleteWeighted: Math.round(m.breadth.incompleteWeighted * 10) / 10
            },
            depthPer1k: {
                violationsWeighted: Math.round(violationDepthPer1k * 10) / 10,
                incompleteWeighted: Math.round(incompleteDepthPer1k * 10) / 10
            },
            engineCounts: m.counts
        };

        return out;
    }

    /**
     * Compute portfolio evidence inputs directly from canonical findings across scans.
     * Runtime data canonical-only while preserving portfolio depth logic.
     */
    function computeGlobalEvidenceFromCanonicalScans(scans, domTotalRaw, contentUnit = 0) {
        const list = asArray(scans);

        const domTotal = Math.max(1, Math.round(safeNum(domTotalRaw, 1)));

        // counts are by finding, per scan
        let violationsCount = 0;
        let incompleteCount = 0;
        let passesCount = 0;

        let violationBreadth = 0;
        let incompleteBreadth = 0;

        let violationDepthAbs = 0;
        let incompleteDepthAbs = 0;

        for (const scan of list) {
            const canon = scan && scan.canonical ? scan.canonical : null;
            const scanUrl = scan && scan.url ? String(scan.url) : '';
            const findings = canon && Array.isArray(canon.findings) ? canon.findings : [];

            for (const f of findings) {
                if (!f) continue;

                const outcome = String(f.outcome || '');
                const isViolation = outcome === 'fail';
                const isIncomplete = outcome === 'cantTell';
                const isPass = outcome === 'pass';

                if (!isViolation && !isIncomplete && !isPass) continue;

                const w = weightForImpact(impactFromSeverity(f.severity));

                if (isViolation) {
                    violationsCount += 1;
                    violationBreadth += w;
                } else if (isIncomplete) {
                    incompleteCount += 1;
                    incompleteBreadth += w;
                } else if (isPass) {
                    passesCount += 1;
                }

                if (!isViolation && !isIncomplete) continue;

                const occs = Array.isArray(f.occurrences) ? f.occurrences : [];
                if (!occs.length) continue;

                const byUrl = new Map();
                for (const occ of occs) {
                    const key = (occ && occ.pageUrl) ? String(occ.pageUrl).trim() : (scanUrl || '__unknown__');
                    byUrl.set(key, (byUrl.get(key) || 0) + 1);
                }

                let ruleDepth = 0;
                for (const [, count] of byUrl.entries()) {
                    ruleDepth += Math.sqrt(Math.max(0, count));
                }

                if (isViolation) violationDepthAbs += w * ruleDepth;
                else incompleteDepthAbs += w * ruleDepth;
            }
        }

        const violationDepthPer1k = (violationDepthAbs / domTotal) * 1000;
        const incompleteDepthPer1k = (incompleteDepthAbs / domTotal) * 1000;

        // Same content denominator as the per-page model, so a portfolio headline is not
        // computed on a different scale from the pages it summarizes.
        const unitSize = Math.max(1, contentUnit);
        const violationDepthPerUnit = (violationDepthAbs / unitSize) * CONTENT_UNIT_SCALE;
        const incompleteDepthPerUnit = (incompleteDepthAbs / unitSize) * CONTENT_UNIT_SCALE;

        const riskRaw =
            satScore(violationBreadth, 8) +
            0.25 * satScore(incompleteBreadth, 10) +
            satScore(violationDepthPerUnit, 35) +
            0.2 * satScore(incompleteDepthPerUnit, 45);

        const riskWeightsSum = (1 + 0.25 + 1 + 0.2);
        const riskClamped = clamp(riskRaw / riskWeightsSum, 0, 100);

        const evidence = clamp(100 - riskClamped, 0, 100);

        const out = {
            engineCounts: {
                violations: violationsCount,
                incomplete: incompleteCount,
                passes: passesCount
            },
            breadth: {
                violationsWeighted: Math.round(violationBreadth * 10) / 10,
                incompleteWeighted: Math.round(incompleteBreadth * 10) / 10
            },
            depthPer1k: {
                violationsWeighted: Math.round(violationDepthPer1k * 10) / 10,
                incompleteWeighted: Math.round(incompleteDepthPer1k * 10) / 10
            },
            depthPerContentUnit: {
                violationsWeighted: Math.round(violationDepthPerUnit * 10) / 10,
                incompleteWeighted: Math.round(incompleteDepthPerUnit * 10) / 10
            },
            // Rounded to match computeGlobalEvidenceFromMerged() and buildA11ySummary() so
            // base.scores.evidence renders as a clean integer, not a float like 44.998321...
            riskRaw: Math.round(riskRaw * 10) / 10,
            riskClamped: Math.round(riskClamped * 10) / 10,
            evidence: Math.round(evidence)
        };

        return out;
    }

    /**
     * Rebuilds the in-scope criterion list from what the per-scan summaries already
     * carry, so the portfolio gets the same denominator without the caller having to
     * thread the rule catalog through - and so an imported report, which has the
     * summaries but no engine, still reports coverage.
     */
    function automationCoverageFromScans(scans) {
        const bySc = new Map();

        for (const scan of asArray(scans)) {
            const summary = pickCoverageSummary(scan);
            for (const c of asArray(summary && summary.criteria)) {
                if (!c || !c.sc || !c.automation) continue;
                if (!bySc.has(c.sc)) bySc.set(c.sc, { sc: c.sc, level: c.level || null, automation: c.automation });
            }
        }

        if (!bySc.size) return null;

        return {
            criteria: [...bySc.values()].sort((a, b) => a.sc.localeCompare(b.sc, undefined, { numeric: true }))
        };
    }

    /**
     * A skipped scan contributes no findings, so without this block a page that was
     * never analyzed is indistinguishable from one that came back clean.
     */
    function buildScanCoverage(scans) {
        const list = asArray(scans);
        const skipped = list.filter((s) => !!(s && (s.skipped || s.skipInfo)));

        const reasons = {};
        for (const s of skipped) {
            const reason = (s.skipInfo && s.skipInfo.reason) ? String(s.skipInfo.reason) : 'reason not provided';
            reasons[reason] = (reasons[reason] || 0) + 1;
        }

        const analyzed = list.length - skipped.length;

        return {
            scansTotal: list.length,
            scansAnalyzed: analyzed,
            scansSkipped: skipped.length,
            analyzedRatio: list.length ? analyzed / list.length : 0,
            skippedReasons: reasons,
            skippedScans: skipped.map((s) => ({
                id: s.id || s.scanId || null,
                label: s.label || null,
                url: s.url || null,
                reason: (s.skipInfo && s.skipInfo.reason) ? String(s.skipInfo.reason) : 'reason not provided',
                estimatedNodes: (s.skipInfo && Number.isFinite(s.skipInfo.estimatedNodes)) ? s.skipInfo.estimatedNodes : null,
                threshold: (s.skipInfo && Number.isFinite(s.skipInfo.threshold)) ? s.skipInfo.threshold : null
            }))
        };
    }

    /**
     * The portfolio scores of the profile a run does worst on, when some of
     * its scans checked several profiles: { id, scores, byProfile }, or null.
     * Each profile is scored over the scans that checked it, each read on it
     * alone (shared-profiles.js narrowScanToProfiles).
     */
    function worstProfilePortfolio(scans, options) {
        const api = sharedProfilesOf && sharedProfilesOf();
        if (!api || typeof api.scanProfileIds !== 'function' || typeof api.narrowScanToProfiles !== 'function') return null;
        const list = asArray(scans).filter((s) => s && !s.skipped && !s.skipInfo);
        let idsByScan;
        try {
            idsByScan = list.map((s) => api.scanProfileIds(s));
        } catch {
            return null;
        }
        if (!idsByScan.some((ids) => ids.length > 1)) return null;
        const ids = [...new Set(idsByScan.flat())];
        const views = ids.map((id) => {
            const own = list
                .map((s, i) => (idsByScan[i].includes(id) ? (idsByScan[i].length > 1 ? api.narrowScanToProfiles(s, [id]) : s) : null))
                .filter(Boolean);
            const built = buildGlobalSummary({ scans: own, options: { ...options, singleProfile: true, scoresOnly: true } });
            return { id, scores: built && built.a11ySummary ? built.a11ySummary.scores : null };
        });
        const scored = views.filter((v) => v.scores && v.scores.adjusted != null);
        if (!scored.length) return null;
        const worst = scored.reduce((a, b) => (b.scores.adjusted < a.scores.adjusted ? b : a));
        return {
            id: worst.id,
            scores: worst.scores,
            byProfile: Object.fromEntries(views.map((v) => [v.id, v.scores ? v.scores.adjusted : null])),
        };
    }

    function buildGlobalSummary(arg1, arg2, arg3) {
        // Support both:
        // 1) buildGlobalSummary({ scans, mergedA11y, options })
        // 2) buildGlobalSummary(scans, mergedA11y, options)
        const payload = Array.isArray(arg1)
            ? { scans: arg1, mergedA11y: arg2, options: arg3 || {} }
            : (arg1 || {});

        const scans = payload.scans || [];
        const mergedA11y = payload.mergedA11y || null;
        const options = payload.options || {};

        const domP90 = Number.isFinite(options.domP90) ? options.domP90 : 90;
        const useMinConfidence = options.useMinConfidence !== false;

        const domMetrics = buildGlobalDomMetrics(scans, { p90: domP90 });

        // Build a portfolio canonical model by merging findings across scans.
        const byKey = new Map();

        // The element, as report-format.js's elementTarget names it: its
        // target after the selectors of any shadow hosts it is inside, as its
        // target alone repeats in every shadow root of the same component.
        function occRest(occ) {
            const own = Array.isArray(occ && occ.target) ? occ.target.join('||') : '';
            const hosts = Array.isArray(occ && occ.shadowHostSelectors) ? occ.shadowHostSelectors.filter(Boolean) : [];
            const inRoots = hosts.length ? `${hosts.join(' >>> ')} >>> ${own}` : own;
            const frames = Array.isArray(occ && occ.frameSelectors) ? occ.frameSelectors.filter(Boolean) : [];
            const target = frames.length ? `${frames.join(' |>| ')} |>| ${inRoots}` : inRoots;
            const html = occ && occ.html ? String(occ.html) : '';
            const failure = occ && occ.failureSummary ? String(occ.failureSummary) : '';
            return target + '##' + html + '##' + failure;
        }

        function occKey(occ, fallbackUrl) {
            const url = occ && occ.pageUrl ? String(occ.pageUrl) : (fallbackUrl || '');
            return url + '##' + occRest(occ);
        }

        // The occurrence keys each merged finding holds, kept rather than rebuilt
        // on every merge, which made a long run's summary quadratic. An occurrence
        // with no pageUrl is keyed with the url of the scan being merged, so for
        // those only the rest of the key is kept, and matched against that url.
        const seenOf = new Map(); // merged finding -> { fixed: Set<key>, loose: Set<rest> }

        function remember(seen, occ) {
            if (occ && occ.pageUrl) seen.fixed.add(occKey(occ, ''));
            else seen.loose.add(occRest(occ));
        }

        function holds(seen, key, scanUrl) {
            if (seen.fixed.has(key)) return true;
            const prefix = (scanUrl || '') + '##';
            return key.startsWith(prefix) && seen.loose.has(key.slice(prefix.length));
        }

        for (const scan of asArray(scans)) {
            const canon = scan && scan.canonical ? scan.canonical : null;
            const scanUrl = scan && scan.url ? String(scan.url) : '';
            const findings = canon && Array.isArray(canon.findings) ? canon.findings : [];

            for (const f of findings) {
                if (!f) continue;

                const key = String(f.uid || f.id || '').trim();
                if (!key) continue;

                const existing = byKey.get(key);
                if (!existing) {
                    const clone = {
                        ...f,
                        wcag: {
                            ...(f.wcag || {}),
                            sc: Array.isArray(f?.wcag?.sc) ? [...new Set(f.wcag.sc.map(String).filter(Boolean))] : []
                        },
                        occurrences: Array.isArray(f?.occurrences) ? [...f.occurrences] : []
                    };

                    // Deduplicate occurrences inside the clone
                    const seen = { fixed: new Set(), loose: new Set() };
                    clone.occurrences = clone.occurrences.filter((o) => {
                        if (holds(seen, occKey(o, scanUrl), scanUrl)) return false;
                        remember(seen, o);
                        return true;
                    });

                    byKey.set(key, clone);
                    seenOf.set(clone, seen);
                    continue;
                }

                // Merge WCAG SC
                const scA = Array.isArray(existing?.wcag?.sc) ? existing.wcag.sc : [];
                const scB = Array.isArray(f?.wcag?.sc) ? f.wcag.sc : [];
                existing.wcag = existing.wcag || {};
                existing.wcag.sc = [...new Set([...scA, ...scB].map(String).filter(Boolean))];

                // Merge occurrences by union
                const seen = seenOf.get(existing);
                const incoming = Array.isArray(f?.occurrences) ? f.occurrences : [];
                existing.occurrences = Array.isArray(existing.occurrences) ? existing.occurrences : [];

                for (const occ of incoming) {
                    if (holds(seen, occKey(occ, scanUrl), scanUrl)) continue;
                    remember(seen, occ);
                    existing.occurrences.push(occ);
                }
            }
        }

        const portfolioCanonical = { findings: Array.from(byKey.values()) };

        // Portfolio criterion verdicts, from the same merged canonical the scores use.
        // Built first because the summary is gated on it.
        let portfolioCoverage = null;
        try {
            portfolioCoverage = buildCoverageAwareSummary({
                canonical: portfolioCanonical,
                automationCoverage: options.automationCoverage || automationCoverageFromScans(scans)
            });
        } catch {
            portfolioCoverage = null;
        }

        // Start from canonical summary builder (ensures identical output shape and flags logic)
        const base = buildA11ySummary({ canonical: portfolioCanonical, domMetrics, coverageSummary: portfolioCoverage });

        // Portfolio evidence uses a URL-aware depth model.
        // Prefer canonical-only computation, but keep legacy support when caller explicitly provides mergedA11y.
        const portfolioUnit = primaryContentUnit(contentUnitsFrom(domMetrics, null));

        const ev = mergedA11y
            ? computeGlobalEvidenceFromMerged(mergedA11y, domMetrics.totalElements)
            : computeGlobalEvidenceFromCanonicalScans(scans, domMetrics.totalElements, portfolioUnit.size);

        base.inputs.domTotal = Math.max(1, Math.round(domMetrics.totalElements || 1));

        base.inputs.engine = ev.engineCounts;
        base.inputs.breadth = ev.breadth;
        base.inputs.depthPer1k = ev.depthPer1k;
        if (ev.depthPerContentUnit) base.inputs.depthPerContentUnit = ev.depthPerContentUnit;
        base.inputs.risk = { engineRaw: ev.riskRaw, engineClamped: ev.riskClamped };

        // Only override the gated scores when the portfolio actually evaluated something;
        // otherwise a portfolio of unevaluated pages would get a number here after
        // buildA11ySummary had correctly withheld one.
        if (base.scores.evaluationState !== 'notEvaluated') {
            base.scores.evidence = ev.evidence;

            // Recompose the headline from the portfolio's own risk, using the same rule as
            // the per-page model - otherwise `adjusted` would still reflect the page-style
            // risk that buildA11ySummary computed before `evidence` was overridden above.
            base.scores.adjusted = Math.round(composeAdjusted(100 - ev.evidence, safeNum(base.scores.confidence, 100) / 100));
        }

        if (useMinConfidence) {
            // A withheld score is absent, not zero. safeNum(null) would return 0 here,
            // silently dragging the portfolio down with pages that reported nothing.
            const pageConf = asArray(scans)
                .map(pickA11ySummary)
                .map(s => (s && s.scores && s.scores.confidence != null) ? Number(s.scores.confidence) : NaN)
                .filter(Number.isFinite);

            if (pageConf.length) {
                const minConfidence = Math.round(Math.min(...pageConf));
                base.scores.confidence = clamp(minConfidence, 0, 100);
                base.scores.adjusted = Math.round(composeAdjusted(100 - base.scores.evidence, base.scores.confidence / 100));
            }
        }

        // A run with scans of several profiles: each profile scored over the
        // scans that checked it, as a run of it alone would be, and the run
        // takes the one it does worst on, as each of those scans does
        // (a11y-summary.js). Summed as one, a defect two profiles restate
        // (WCAG 2.5.8 and EN 301 549's 9.2.5.8) counted twice.
        if (!options.singleProfile) {
            const worst = worstProfilePortfolio(scans, options);
            if (worst) {
                base.scores.evidence = worst.scores.evidence;
                base.scores.adjusted = worst.scores.adjusted;
                base.scores.confidence = worst.scores.confidence;
                base.scores.scoredOn = worst.id;
                base.scores.byProfile = worst.byProfile;
            }
        }

        // Compute from per-scan adjusted scores (or avgPageAccessibility if present).
        const pageScores = asArray(scans)
            .map(pickA11ySummary)
            .map(s => {
                if (!s || !s.scores) return NaN;
                const v = s.scores.avgPageAccessibility ?? s.scores.adjusted;
                // Pages that withheld a score are excluded from the mean rather than
                // counted as zero, which is what safeNum(null) would do.
                return v == null ? NaN : Number(v);
            })
            .filter(Number.isFinite);

        const dist = scoreDistribution(pageScores);

        // Global average page accessibility is the mean of page scores.
        // Falls back to the portfolio-level adjusted score (already computed above from
        // canonical + domMetrics directly) when no scan carried a precomputed per-page
        // a11ySummary, so this doesn't silently read as 0 while `adjusted` reads correctly.
        base.scores.avgPageAccessibility = pageScores.length
            ? Math.round(clamp(dist.mean, 0, 100))
            : base.scores.adjusted;

        base.scanCoverage = buildScanCoverage(scans);
        // A criterion counts as evaluated if any page could conclude on it.
        base.coverageSummary = portfolioCoverage;

        // Merged occurrences carry their pageUrl, so scope can be counted across the run.
        if (options.scoresOnly) return { domMetrics, a11ySummary: base };
        try {
            base.occurrences = mineOccurrences({
                findings: portfolioCanonical.findings,
                pagesScanned: base.scanCoverage.scansAnalyzed
            });
        } catch {
            base.occurrences = null;
        }

        base.stats = base.stats || {};
        base.stats.pageAccessibility = {
            n: dist.n,
            min: Math.round(dist.min),
            max: Math.round(dist.max),
            mean: Math.round(dist.mean * 10) / 10,
            median: Math.round(dist.median),
            p10: Math.round(dist.p10),
            p25: Math.round(dist.p25),
            p75: Math.round(dist.p75),
            p90: Math.round(dist.p90),
            iqr: Math.round(dist.iqr * 10) / 10,
            stddev: Math.round(dist.stddev * 10) / 10
        };

        return { domMetrics, a11ySummary: base };
    }

    return {
        buildGlobalDomMetrics,
        buildGlobalTextMetrics,
        buildGlobalSummary,
        buildScanCoverage,
        automationCoverageFromScans,

        // Neutral names
        computePortfolioMergedInputs,
        computeGlobalEvidenceFromMerged
    };
});
