'use strict';

// Shared by the server, which builds a run's summary, and the app, which
// builds it again over the scans a report includes, so the two agree.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./a11y-metric-defs.js'));
    } else {
        root.A11Y_SUMMARY = factory(root.A11Y_METRIC_DEFS);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (metricDefs) {
    const { METRIC_DEFS } = metricDefs;

    const IMPACT_WEIGHTS = {
        critical: 10,
        serious: 6,
        moderate: 3,
        minor: 1,
        info: 0.5
    };

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function weightForImpact(impact) {
        return IMPACT_WEIGHTS[String(impact || '').toLowerCase()] || 2;
    }

    /**
     * Normalizes engine-reported severity strings (including alias spellings some
     * engines may use, e.g. "severe"/"medium"/"low") into the canonical set that
     * IMPACT_WEIGHTS understands. Shared by per-page and portfolio scoring so a
     * given finding is never weighted differently depending on which code path
     * scores it.
     */
    function impactFromSeverity(severity) {
        const s = String(severity || 'unknown').toLowerCase();
        if (s === 'critical') return 'critical';
        if (s === 'serious' || s === 'severe') return 'serious';
        if (s === 'moderate' || s === 'medium') return 'moderate';
        if (s === 'minor' || s === 'low') return 'minor';
        if (s === 'info' || s === 'informational') return 'info';
        return 'unknown';
    }

    /**
     * Weighted "instance depth" using a sublinear transform so a single rule
     * that fires on many nodes does not dominate the whole score.
     */
    function sumWeightedInstanceDepth(items) {
        let total = 0;
        for (const it of items || []) {
            const n = (it && it.nodes && Array.isArray(it.nodes)) ? it.nodes.length : 0;
            total += weightForImpact(it && it.impact) * Math.sqrt(Math.max(0, n));
        }
        return total;
    }

    /**
     * Weighted "rule breadth" (each rule contributes once).
     */
    function sumWeightedRuleBreadth(items) {
        let total = 0;
        for (const it of items || []) {
            total += weightForImpact(it && it.impact);
        }
        return total;
    }

    // Saturating growth score: 0..100
    function satScore(x, s = 10) {
        return 100 * (1 - Math.exp(-Math.max(0, x) / s));
    }

    /** Rough word count; visible text is measured in characters, not words. */
    const CHARS_PER_WORD = 5;

    /**
     * Per 100 evaluable elements. Identical to the older per-1000-DOM-nodes scale when
     * evaluable elements are a tenth of the DOM, so the saturations keep their meaning.
     */
    const CONTENT_UNIT_SCALE = 100;

    /**
     * Low engine confidence amplifies measured risk rather than scaling the whole score,
     * so a page with little risk is not punished for uncertainty about the little it found.
     */
    const UNCERTAINTY_AMPLIFICATION = 1;

    /**
     * The headline composition, shared by per-page and portfolio scoring so the two can
     * never drift apart. Uncertainty inflates measured risk instead of scaling the whole
     * score, so a page with little risk is not punished for the engine being unsure about
     * the little it found.
     *
     * The inflation is spent out of the headroom left above the measured risk, rather than
     * multiplied straight onto it. Multiplying overshoots: risk 92 at confidence 0.82 came
     * to 108, was clipped at 100, and reported a score of exactly 0 - the same 0 a page
     * with double the findings would get, and the same 0 as risk 100. Everything past the
     * ceiling collapsed onto one number, so the floor of the scale stopped meaning
     * "measured as bad" and started meaning "ran out of scale".
     *
     * Spending the headroom keeps every property the multiplication had - no inflation at
     * zero risk, none at full confidence, strictly increasing in both risk and uncertainty -
     * and needs no clip, because it reaches 100 only where the risk itself does.
     *
     * @param {number} risk 0..100
     * @param {number} confidenceRatio 0..1
     */
    function composeAdjusted(risk, confidenceRatio) {
        const r = clamp(safeNum(risk, 0), 0, 100);
        const c = clamp(safeNum(confidenceRatio, 1), 0, 1);

        const uncertainty = UNCERTAINTY_AMPLIFICATION * (1 - c);
        const inflated = r + uncertainty * r * ((100 - r) / 100);

        return clamp(100 - inflated, 0, 100);
    }

    /**
     * Denominators for issue density that reflect how much there is to get wrong,
     * rather than how many elements the page happens to contain.
     *
     * Normalizing per raw DOM node rewards bloat: wrap a page in a thousand extra
     * <div>s and its density falls without a single defect being fixed. `evaluable`
     * counts the elements accessibility rules can actually apply to.
     */
    function contentUnitsFrom(domMetrics, textMetrics) {
        const counts = (domMetrics && domMetrics.counts) ? domMetrics.counts : {};

        const evaluable = Math.max(0, safeNum(counts.evaluable, 0));
        const focusable = Math.max(0, safeNum(counts.focusable, 0));
        const interactive = Math.max(0, safeNum(counts.interactiveNative, 0) + safeNum(counts.customControls, 0));

        const tm = (domMetrics && domMetrics.textMetrics) ? domMetrics.textMetrics : (textMetrics || null);
        const chars = Math.max(0, safeNum(tm && tm.totals && tm.totals.visibleTextChars, 0));
        const words = chars / CHARS_PER_WORD;

        return { evaluable, focusable, interactive, visibleWords: Math.round(words) };
    }

    /**
     * Falls back through progressively coarser units so a page with no evaluable
     * elements still yields a finite density instead of dividing by zero.
     */
    function primaryContentUnit(units) {
        if (units.evaluable > 0) return { unit: 'evaluable', size: units.evaluable };
        if (units.interactive > 0) return { unit: 'interactive', size: units.interactive };
        if (units.visibleWords > 0) return { unit: 'words100', size: units.visibleWords / 100 };
        return { unit: 'none', size: 1 };
    }

    /**
     * Mean confidence of the checks the engine actually ran, as reported by the
     * engine itself, with the share of the evidence that mean actually describes.
     * Only fail/cantTell findings are weighted, since those are the ones a verdict
     * rests on.
     *
     * surea11y maps its own high/medium/low to a confidence, but a finding may
     * carry none (one from a report saved before, with another engine's). Dropping
     * those makes the mean describe a subset while reading as though it covered
     * everything. `coverage` is what stops that: the mean still says what the
     * findings said, and the caller can see how much of the run it speaks for.
     *
     * @returns {{mean: number, coverage: number}|null} null when nothing carried one.
     */
    function measuredConfidenceFrom(findings) {
        if (!Array.isArray(findings)) return null;

        const values = [];
        let verdicts = 0;

        for (const f of findings) {
            if (!f) continue;
            if (f.outcome !== 'fail' && f.outcome !== 'cantTell') continue;
            verdicts += 1;
            const c = Number(f.confidence);
            if (Number.isFinite(c) && c >= 0 && c <= 1) values.push(c);
        }

        if (!values.length) return null;

        return {
            mean: values.reduce((a, b) => a + b, 0) / values.length,
            coverage: verdicts ? values.length / verdicts : 0
        };
    }

    function safeNum(v, fallback = 0) {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    function getDef(key) {
        return METRIC_DEFS && METRIC_DEFS[key] ? METRIC_DEFS[key] : null;
    }

    /**
     * Returns true when value falls into an interval with interval.key === intervalKey.
     * Works for:
     * - ratio intervals (0..1)
     * - score intervals (0..100)
     * - count intervals (may use to: Infinity)
     */
    function isAtOrAboveInterval(key, value, intervalKey) {
        const def = getDef(key);
        if (!def || !Array.isArray(def.intervals) || !def.intervals.length) return false;

        const v = Number(value);
        if (!Number.isFinite(v)) return false;

        for (const it of def.intervals) {
            if (!it || it.key !== intervalKey) continue;

            const from = Number(it.from);
            const toRaw = it.to;
            const to = (toRaw === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : Number(toRaw);

            if (!Number.isFinite(from) || (!Number.isFinite(to) && to !== Number.POSITIVE_INFINITY)) continue;

            // Inclusive bounds (so 0.15 is included in 0..0.15)
            if (to === Number.POSITIVE_INFINITY) {
                if (v >= from) return true;
            } else {
                if (v >= from && v <= to) return true;
            }
        }

        return false;
    }

    /**
     * `Number(null)` is 0, so a coverage figure that was never established would pass a
     * `Number.isFinite` check as a hard zero - which is how an engine whose rule catalog
     * was unavailable came to report "10 of 0 criteria" instead of "of an unknown scope".
     */
    function finiteOrNull(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Below this many content units the density model is extrapolating, not measuring.
     *
     * Depth is reported per 100 evaluable elements, so on a page with a handful of them a
     * single finding is multiplied into a density that saturates the curve: two failing
     * rules over 12 evaluable elements reads as 133 per 100 and scores the page at the
     * floor. The failing rules are real, but "how dense are they" has no answer at that
     * size - the denominator is too small for the saturation constants to mean anything.
     *
     * Set at a quarter of the reporting unit: below it, one finding moves the density by
     * more than four points per 100 on its own.
     */
    const MIN_CONTENT_UNITS_FOR_DENSITY = 25;

    /**
     * A score is only defined when something was evaluated, and when there was enough of
     * the page to measure it against; zero evaluated criteria is an absent measurement,
     * not a perfect page, and neither is a density read off a handful of elements.
     */
    function resolveEvaluationState(coverageSummary, conclusiveFindings, contentUnitSize) {
        const coverage = (coverageSummary && coverageSummary.coverage) ? coverageSummary.coverage : null;
        const evaluated = coverage ? finiteOrNull(coverage.criteriaEvaluated) : null;
        const inScope = coverage ? finiteOrNull(coverage.criteriaInScope) : null;

        // A page with too little to test cannot carry a density, whatever the criteria say -
        // so this is checked before the coverage gate rather than after it.
        const units = finiteOrNull(contentUnitSize);
        if (units !== null && units < MIN_CONTENT_UNITS_FOR_DENSITY) {
            return {
                state: 'notMeasurable',
                evaluated,
                inScope,
                reportable: false,
                contentUnits: units
            };
        }

        // Without a coverage summary there is nothing to gate on, so the score stands and
        // says so rather than being withheld on a guess.
        if (evaluated === null) {
            return { state: 'unknown', evaluated: null, inScope: null, reportable: true, contentUnits: units };
        }

        // A conclusive finding is evidence even when it carries no criterion mapping, so
        // the gate asks "did anything reach a conclusion", not "was anything attributable".
        // cantTell does not count: that outcome is the engine declining to conclude.
        const reportable = evaluated > 0 || conclusiveFindings > 0;

        return {
            state: reportable ? 'evaluated' : 'notEvaluated',
            evaluated,
            inScope,
            reportable,
            contentUnits: units
        };
    }

    function buildA11ySummary({ canonical, domMetrics, textMetrics, coverageSummary }) {
        const domTotal = Math.max(1, safeNum(domMetrics && domMetrics.totalElements, 1));

        let violations = [];
        let incomplete = [];
        let passes = [];

        const findings = Array.isArray(canonical && canonical.findings) ? canonical.findings : null;

        if (findings) {
            // Each canonical finding corresponds to a rule, occurrences correspond to instances
            const toMetricItem = (f) => ({
                impact: impactFromSeverity(f && f.severity),
                nodes: Array.isArray(f && f.occurrences) ? f.occurrences : []
            });

            violations = findings.filter((f) => f && f.outcome === 'fail').map(toMetricItem);
            incomplete = findings.filter((f) => f && f.outcome === 'cantTell').map(toMetricItem);
            passes = findings.filter((f) => f && f.outcome === 'pass').map(toMetricItem);
        } else {
            // Fallback for safety, canonical should exist in normal runs
            violations = [];
            incomplete = [];
            passes = [];
        }

        // ---- Findings risk (combine breadth + depth, depth normalized per 1k nodes) ----
        const violationBreadth = sumWeightedRuleBreadth(violations);
        const incompleteBreadth = sumWeightedRuleBreadth(incomplete);

        const violationDepthPer1k = (sumWeightedInstanceDepth(violations) / domTotal) * 1000;
        const incompleteDepthPer1k = (sumWeightedInstanceDepth(incomplete) / domTotal) * 1000;

        // Tune: slower saturation to avoid collapsing to 0 too easily
        const riskAxeRaw =
            satScore(violationBreadth, 8) +
            0.25 * satScore(incompleteBreadth, 10) +
            satScore(violationDepthPer1k, 35) +
            0.2 * satScore(incompleteDepthPer1k, 45);

        // Convert sum into a weighted average so risk stays 0..100
        const riskWeightsSum = (1 + 0.25 + 1 + 0.2);
        const riskAxe = clamp(riskAxeRaw / riskWeightsSum, 0, 100);

        // Superseded as the headline by the content-normalized model below, kept so a
        // run can still be compared against how it used to score.
        const evidenceByDom = clamp(100 - riskAxe, 0, 100);

        // ---- Content-normalized risk (drives the headline) ----
        const contentUnits = contentUnitsFrom(domMetrics, textMetrics);
        const primaryUnit = primaryContentUnit(contentUnits);
        const unitSize = Math.max(1, primaryUnit.size);

        const violationDepthPerUnit = (sumWeightedInstanceDepth(violations) / unitSize) * CONTENT_UNIT_SCALE;
        const incompleteDepthPerUnit = (sumWeightedInstanceDepth(incomplete) / unitSize) * CONTENT_UNIT_SCALE;

        const riskContentRaw =
            satScore(violationBreadth, 8) +
            0.25 * satScore(incompleteBreadth, 10) +
            satScore(violationDepthPerUnit, 35) +
            0.2 * satScore(incompleteDepthPerUnit, 45);

        const riskContent = clamp(riskContentRaw / riskWeightsSum, 0, 100);
        const evidence = clamp(100 - riskContent, 0, 100);

        // ---- Structural signals (feed the review reasons and the confidence proxy) ----
        const coverageRatio = safeNum(domMetrics && domMetrics.coverageRatio, 0);
        const customControlsRatio = safeNum(domMetrics && domMetrics.customControlsRatio, 0);
        const hiddenRatio = safeNum(domMetrics && domMetrics.hiddenRatio, 0);
        const statefulComponentsCount = safeNum(domMetrics && domMetrics.statefulComponentsCount, 0);
        const tm = (domMetrics && domMetrics.textMetrics)
            ? domMetrics.textMetrics
            : (textMetrics || null);

        const links = tm && tm.links ? tm.links : null;
        const buttons = tm && tm.buttons ? tm.buttons : null;

        const linksPer1k = safeNum(links && links.linksPer1k, 0);
        const linkTextShare = safeNum(links && links.linkTextShare, 1); // 0..1

        const buttonsPer1k = safeNum(buttons && buttons.buttonsPer1k, 0);
        const buttonTextShare = safeNum(buttons && buttons.buttonTextShare, 1); // 0..1

        const linksNoTextRate = clamp(safeNum(links && links.linksNoVisibleTextRate, 0), 0, 1);
        const linksNoTextNoNameRate = clamp(safeNum(links && links.linksNoTextNoNameSignalRate, 0), 0, 1);

        const buttonsNoTextRate = clamp(safeNum(buttons && buttons.buttonsNoVisibleTextRate, 0), 0, 1);
        const buttonsNoTextNoNameRate = clamp(safeNum(buttons && buttons.buttonsNoTextNoNameSignalRate, 0), 0, 1);

        // ---- Structural confidence proxy (used only when the engine reported none) ----
        // Individual penalties are scaled so their worst-case sum (every single condition
        // below firing at once) lands exactly at the 0.6 floor's 0.4 headroom, instead of
        // saturating the floor well before all signals are accounted for - otherwise a few
        // concurrent signals would floor confidence early, making further ones a no-op.
        let confidenceByDom = 1.0;

        // Def-driven thresholds (interval-based)
        // NOTE: ensure the METRIC_DEFS has:
        // - dom.coverageRatio interval {from:0,to:0.15,key:'warn'}
        // - dom.hiddenRatio interval {from:0.30,to:1,key:'warn'}
        // - dom.statefulComponentsCount interval {from:15,to:Infinity,key:'warn'}
        // - dom.customControlsRatio interval {from:0.40,to:Infinity,key:'warn'}
        // - controls.linksNoTextNoNameRate interval {from:0.10,to:1,key:'warn'}
        // - controls.buttonsNoTextNoNameRate interval {from:0.10,to:1,key:'warn'}

        if (isAtOrAboveInterval('dom.coverageRatio', coverageRatio, 'warn')) confidenceByDom -= 0.06;
        if (isAtOrAboveInterval('dom.hiddenRatio', hiddenRatio, 'warn')) confidenceByDom -= 0.05;
        if (isAtOrAboveInterval('dom.statefulComponentsCount', statefulComponentsCount, 'warn')) confidenceByDom -= 0.05;
        if (isAtOrAboveInterval('dom.customControlsRatio', customControlsRatio, 'warn')) confidenceByDom -= 0.05;
        if (safeNum(domMetrics && domMetrics.shadowHostCount, 0) > 0) confidenceByDom -= 0.02;
        if (domMetrics && domMetrics.capped === true) confidenceByDom -= 0.04;

        // Text controls signals, keep mild, these are proxies
        if (linksPer1k > 180) confidenceByDom -= 0.02;
        if (buttonsPer1k > 80) confidenceByDom -= 0.02;

        // Stronger signal: icon-only controls with no obvious name signal (def-driven threshold on the rate)
        if (linksPer1k > 60 && isAtOrAboveInterval('controls.linksNoTextNoNameRate', linksNoTextNoNameRate, 'warn')) {
            confidenceByDom -= 0.03;
        }
        if (buttonsPer1k > 20 && isAtOrAboveInterval('controls.buttonsNoTextNoNameRate', buttonsNoTextNoNameRate, 'warn')) {
            confidenceByDom -= 0.04;
        }

        // Optional mild uncertainty: many icon-only controls, even if they have some name signals
        if (buttonsPer1k > 20 && buttonsNoTextRate > 0.50) confidenceByDom -= 0.02;

        confidenceByDom = clamp(confidenceByDom, 0.6, 1.0);

        // ---- Reliability and the headline composition ----
        // Confidence describes how sure the engine was about the findings it reported.
        // With no findings there is nothing to be confident about, so it is not measured -
        // the structural proxy must not stand in, because it returns near-maximum
        // confidence for a scan that produced no information at all. How much was looked
        // at is the coverage indicator's job, not this one's.
        const measuredConfidence = measuredConfidenceFrom(findings);
        const confidence = measuredConfidence === null ? null : measuredConfidence.mean;
        const confidenceCoverage = measuredConfidence === null ? 0 : measuredConfidence.coverage;

        // 'partial' when only some of the verdicts carried a confidence, which is what
        // a run of two engines looks like when only one of them reports any.
        const confidenceSource = measuredConfidence === null
            ? 'notMeasured'
            : (confidenceCoverage >= 1 ? 'engine' : 'partial');

        // Uncertainty is applied only over the evidence it was actually measured on.
        // Amplifying the whole run by a mean drawn from a fraction of the findings
        // would let one engine's reported confidence speak for another engine's, in
        // either direction. The two endpoints are unchanged: measured everywhere, this
        // is the mean itself; measured nowhere, it is 1 and there is no amplification -
        // which is what every single-engine run resolves to, since an engine either
        // stamps a confidence on all of its findings or on none.
        const effectiveConfidence = confidence === null
            ? 1
            : 1 - (1 - confidence) * clamp(confidenceCoverage, 0, 1);

        const adjusted = composeAdjusted(riskContent, effectiveConfidence);
        const riskAdjusted = 100 - adjusted;

        const evaluation = resolveEvaluationState(
            coverageSummary,
            violations.length + passes.length,
            // `none` means the content size was never established - no counts, no text -
            // not that the page was small. There is nothing to gate on, so this leaves
            // that case exactly as it was rather than withholding on an unknown.
            primaryUnit.unit === 'none' ? null : unitSize
        );

        // The previous headline, preserved so a run can be compared against how it scored
        // before the model changed.
        const adjustedByDom = clamp(evidenceByDom * confidenceByDom, 0, 100);

        const hasIncomplete = incomplete.length > 0;

        return {
            inputs: {
                domTotal,
                axe: {
                    violations: violations.length,
                    incomplete: incomplete.length,
                    // Of the incomplete checks' questions, those whose evidence
                    // leans fail (core 1.14's lean): the ones to confirm first.
                    incompleteLikelyFail: incomplete.reduce((n, item) => n + item.nodes.filter((o) => o && o.lean && o.lean.toward === 'fail').length, 0),
                    passes: passes.length
                },
                breadth: {
                    violationsWeighted: Math.round(violationBreadth * 10) / 10,
                    incompleteWeighted: Math.round(incompleteBreadth * 10) / 10
                },
                depthPer1k: {
                    violationsWeighted: Math.round(violationDepthPer1k * 10) / 10,
                    incompleteWeighted: Math.round(incompleteDepthPer1k * 10) / 10
                },
                risk: {
                    axeRaw: Math.round(riskAxeRaw * 10) / 10,
                    axeClamped: Math.round(riskAxe * 10) / 10,
                    contentRaw: Math.round(riskContentRaw * 10) / 10,
                    contentClamped: Math.round(riskContent * 10) / 10,
                    // what the headline is actually 100 minus
                    uncertaintyAdjusted: Math.round(riskAdjusted * 10) / 10
                },
                contentUnits: {
                    ...contentUnits,
                    primary: primaryUnit.unit,
                    primarySize: Math.round(primaryUnit.size * 10) / 10
                },
                depthPerContentUnit: {
                    violationsWeighted: Math.round(violationDepthPerUnit * 10) / 10,
                    incompleteWeighted: Math.round(incompleteDepthPerUnit * 10) / 10
                },
                controls: {
                    linksPer1k: Math.round(linksPer1k * 10) / 10,
                    linkTextShare: Math.round(linkTextShare * 1000) / 1000,
                    linksNoTextRate: Math.round(linksNoTextRate * 1000) / 1000,
                    linksNoTextNoNameRate: Math.round(linksNoTextNoNameRate * 1000) / 1000,

                    buttonsPer1k: Math.round(buttonsPer1k * 10) / 10,
                    buttonTextShare: Math.round(buttonTextShare * 1000) / 1000,
                    buttonsNoTextRate: Math.round(buttonsNoTextRate * 1000) / 1000,
                    buttonsNoTextNoNameRate: Math.round(buttonsNoTextNoNameRate * 1000) / 1000
                }
            },
            scores: {
                // null when nothing was evaluated: a score off an empty denominator would
                // read as a clean page rather than an absent measurement.
                evidence: evaluation.reportable ? Math.round(evidence) : null,
                confidence: confidence === null ? null : Math.round(confidence * 100),
                adjusted: evaluation.reportable ? Math.round(adjusted) : null,
                // For a single page, this equals the page's adjusted score.
                avgPageAccessibility: evaluation.reportable ? Math.round(adjusted) : null,

                // 'evaluated' | 'notEvaluated' | 'notMeasurable' (too little of the page to
                // carry a density) | 'unknown' (no coverage summary supplied), with the
                // denominator the score should always be read against.
                evaluationState: evaluation.state,
                criteriaEvaluated: evaluation.evaluated,
                criteriaInScope: evaluation.inScope,

                // 'engine' when every verdict carried a confidence, 'partial' when only
                // some did (a multi-engine run where not every engine reports one),
                // 'notMeasured' when none did.
                confidenceSource,

                // Share of the fail/cantTell findings that `confidence` was measured
                // over. Below 100 the reported confidence describes only part of the
                // evidence, and the headline applies it only over that part.
                confidenceCoverage: measuredConfidence === null ? null : Math.round(confidenceCoverage * 100),

                // The superseded DOM-normalized model, kept so a run can be compared
                // against how it scored before.
                evidenceByDom: Math.round(evidenceByDom),
                confidenceByDom: Math.round(confidenceByDom * 100),
                adjustedByDom: Math.round(adjustedByDom)
            },
            flags: {
                // Narrowed to conditions that genuinely mean a human has to look. The DOM
                // complexity signals below are reported as reasons but no longer drive the
                // boolean: they fire on most real pages, so including them made the flag
                // permanently true and therefore useless for triage.
                manualReviewNeeded:
                    evaluation.state === 'notEvaluated' ||
                    hasIncomplete ||
                    (confidence !== null && isAtOrAboveInterval('scores.confidence', confidence * 100, 'bad')) ||
                    (domMetrics && domMetrics.capped === true),

                manualReviewReasons: [
                    evaluation.state === 'notEvaluated' ? 'no criteria were evaluated on this page' : null,
                    hasIncomplete ? 'checks reported results that need human confirmation' : null,
                    (confidence !== null && isAtOrAboveInterval('scores.confidence', confidence * 100, 'bad'))
                        ? 'the engine was not confident about what it found' : null,
                    (measuredConfidence !== null && confidenceCoverage < 1)
                        ? `only ${Math.round(confidenceCoverage * 100)}% of what was found carried a reliability signal, so the confidence figure speaks for part of the run`
                        : null,
                    evaluation.state === 'notMeasurable'
                        ? 'too little of the page was testable to measure how dense the findings are'
                        : null,
                    (domMetrics && domMetrics.capped === true) ? 'the scan hit a size cap, so results are partial' : null,
                    isAtOrAboveInterval('dom.statefulComponentsCount', statefulComponentsCount, 'warn')
                        ? 'many stateful components, whose states automation does not exercise' : null,
                    isAtOrAboveInterval('dom.hiddenRatio', hiddenRatio, 'warn')
                        ? 'a lot of hidden or conditional content that was not in scope' : null,
                    safeNum(domMetrics && domMetrics.shadowHostCount, 0) > 0
                        ? 'shadow DOM present, which can hide content from checks' : null,
                    (linksPer1k > 60 && isAtOrAboveInterval('controls.linksNoTextNoNameRate', linksNoTextNoNameRate, 'warn'))
                        ? 'icon-only links whose accessible names need checking' : null,
                    (buttonsPer1k > 20 && isAtOrAboveInterval('controls.buttonsNoTextNoNameRate', buttonsNoTextNoNameRate, 'warn'))
                        ? 'icon-only buttons whose accessible names need checking' : null
                ].filter(Boolean)
            }
        };
    }

    return {
        buildA11ySummary,
        // Exported so global-summary.js can reuse the exact same weighting/normalization
        // logic instead of maintaining a second copy that could drift out of sync.
        IMPACT_WEIGHTS,
        weightForImpact,
        impactFromSeverity,
        clamp,
        safeNum,
        satScore,
        composeAdjusted,
        contentUnitsFrom,
        primaryContentUnit,
        CONTENT_UNIT_SCALE
    };
});
