'use strict';

/**
 * main-metrics.js (scoped)
 * Wrapped to avoid leaking top-level identifiers like `buildA11ySummary` into
 * the global scope.
 *
 * Exposes only:
 *   globalThis.A11Y_METRICS = { METRIC_DEFS, buildA11ySummary }
 */
(() => {

    const METRIC_DEFS = {
        'scores.adjusted': {
            intervals: [
                { from: 0, to: 40, key: 'bad' },
                { from: 40, to: 60, key: 'warn' },
                { from: 60, to: 85, key: 'ok' },
                { from: 85, to: 100, key: 'good' }
            ]
        },
        'scores.avgPageAccessibility': {
            intervals: [
                { from: 0, to: 40, key: 'bad' },
                { from: 40, to: 60, key: 'warn' },
                { from: 60, to: 85, key: 'ok' },
                { from: 85, to: 100, key: 'good' }
            ]
        },
        'scores.evidence': {
            intervals: [
                { from: 0, to: 40, key: 'bad' },
                { from: 40, to: 60, key: 'warn' },
                { from: 60, to: 85, key: 'ok' },
                { from: 85, to: 100, key: 'good' }
            ]
        },
        'scores.readiness': {
            intervals: [
                { from: 0, to: 40, key: 'bad' },
                { from: 40, to: 60, key: 'warn' },
                { from: 60, to: 85, key: 'ok' },
                { from: 85, to: 100, key: 'good' }
            ]
        },
        'scores.confidence': {
            intervals: [
                { from: 0, to: 75, key: 'bad' },
                { from: 75, to: 85, key: 'warn' },
                { from: 85, to: 100, key: 'good' }
            ]
        },
        'dom.coverageRatio': {
            intervals: [
                { from: 0, to: 0.15, key: 'warn' }
            ]
        },
        'dom.hiddenRatio': {
            intervals: [
                { from: 0.30, to: 1, key: 'warn' }
            ]
        },
        'dom.statefulComponentsCount': {
            intervals: [
                { from: 15, to: Number.POSITIVE_INFINITY, key: 'warn' }
            ]
        },
        'controls.linksNoTextNoNameRate': {
            intervals: [
                { from: 0.10, to: 1, key: 'warn' }
            ]
        },
        'controls.buttonsNoTextNoNameRate': {
            intervals: [
                { from: 0.10, to: 1, key: 'warn' }
            ]
        }
    };

    const IMPACT_WEIGHTS = { critical: 10, serious: 6, moderate: 3, minor: 1 };

    function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
    function safeNum(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
    function weightForImpact(impact) { return IMPACT_WEIGHTS[String(impact || '').toLowerCase()] || 2; }

    function sumWeightedInstanceDepth(items) {
        let total = 0;
        for (const it of items || []) {
            const n = (it && it.nodes && Array.isArray(it.nodes)) ? it.nodes.length : 0;
            total += weightForImpact(it && it.impact) * Math.sqrt(Math.max(0, n));
        }
        return total;
    }
    function sumWeightedRuleBreadth(items) {
        let total = 0;
        for (const it of items || []) total += weightForImpact(it && it.impact);
        return total;
    }
    function satScore(x, s = 10) { return 100 * (1 - Math.exp(-Math.max(0, x) / s)); }

    function isAtOrAboveInterval(key, value, intervalKey) {
        const def = METRIC_DEFS && METRIC_DEFS[key] ? METRIC_DEFS[key] : null;
        if (!def || !Array.isArray(def.intervals) || !def.intervals.length) return false;

        const v = Number(value);
        if (!Number.isFinite(v)) return false;

        for (const it of def.intervals) {
            if (!it || it.key !== intervalKey) continue;

            const from = Number(it.from);
            const toRaw = it.to;
            const to = (toRaw === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : Number(toRaw);

            if (!Number.isFinite(from) || (!Number.isFinite(to) && to !== Number.POSITIVE_INFINITY)) continue;

            if (to === Number.POSITIVE_INFINITY) {
                if (v >= from) return true;
            } else {
                if (v >= from && v <= to) return true;
            }
        }
        return false;
    }

    function buildA11ySummary({ canonical, domMetrics, textMetrics }) {
        const domTotal = Math.max(1, safeNum(domMetrics && domMetrics.totalElements, 1));

        let violations = [];
        let incomplete = [];
        let passes = [];

        const findings = Array.isArray(canonical && canonical.findings) ? canonical.findings : null;
        if (findings) {
            const toMetricItem = (f) => ({
                impact: f && f.severity ? f.severity : 'unknown',
                nodes: Array.isArray(f && f.occurrences) ? f.occurrences : []
            });

            violations = findings.filter((f) => f && f.outcome === 'fail').map(toMetricItem);
            incomplete = findings.filter((f) => f && f.outcome === 'cantTell').map(toMetricItem);
            passes = findings.filter((f) => f && f.outcome === 'pass').map(toMetricItem);
        }

        const violationBreadth = sumWeightedRuleBreadth(violations);
        const incompleteBreadth = sumWeightedRuleBreadth(incomplete);

        const violationDepthPer1k = (sumWeightedInstanceDepth(violations) / domTotal) * 1000;
        const incompleteDepthPer1k = (sumWeightedInstanceDepth(incomplete) / domTotal) * 1000;

        const riskByDomRaw =
            satScore(violationBreadth, 8) +
            0.25 * satScore(incompleteBreadth, 10) +
            satScore(violationDepthPer1k, 35) +
            0.2 * satScore(incompleteDepthPer1k, 45);

        const riskWeightsSum = (1 + 0.25 + 1 + 0.2);
        const riskByDom = clamp(riskByDomRaw / riskWeightsSum, 0, 100);

        const evidence = clamp(100 - riskByDom, 0, 100);

        const semanticRatio = safeNum(domMetrics && domMetrics.semanticRatio, 0);
        const coverageRatio = safeNum(domMetrics && domMetrics.coverageRatio, 0);
        const customControlsRatio = safeNum(domMetrics && domMetrics.customControlsRatio, 0);
        const hiddenRatio = safeNum(domMetrics && domMetrics.hiddenRatio, 0);
        const depthMax = safeNum(domMetrics && domMetrics.depthMax, 0);
        const statefulComponentsCount = safeNum(domMetrics && domMetrics.statefulComponentsCount, 0);

        const tm = (domMetrics && domMetrics.textMetrics)
            ? domMetrics.textMetrics
            : (textMetrics || null);

        const links = tm && tm.links ? tm.links : null;
        const buttons = tm && tm.buttons ? tm.buttons : null;

        const linksPer1k = safeNum(links && links.linksPer1k, 0);
        const linkTextShare = safeNum(links && links.linkTextShare, 1);

        const buttonsPer1k = safeNum(buttons && buttons.buttonsPer1k, 0);
        const buttonTextShare = safeNum(buttons && buttons.buttonTextShare, 1);

        const linksNoTextRate = clamp(safeNum(links && links.linksNoVisibleTextRate, 0), 0, 1);
        const linksNoTextNoNameRate = clamp(safeNum(links && links.linksNoTextNoNameSignalRate, 0), 0, 1);

        const buttonsNoTextRate = clamp(safeNum(buttons && buttons.buttonsNoVisibleTextRate, 0), 0, 1);
        const buttonsNoTextNoNameRate = clamp(safeNum(buttons && buttons.buttonsNoTextNoNameSignalRate, 0), 0, 1);

        const readiness = clamp(
            0.25 * semanticRatio * 100 +
            0.25 * coverageRatio * 100 +
            0.15 * (100 - satScore(customControlsRatio, 0.8)) +
            0.15 * (100 - satScore(hiddenRatio * 100, 20)) +
            0.10 * (100 - satScore(depthMax - 20, 10)) +
            0.10 * (100 - satScore(statefulComponentsCount, 15)),
            0,
            100
        );

        let confidence = 1.0;

        if (isAtOrAboveInterval('dom.coverageRatio', coverageRatio, 'warn')) confidence -= 0.15;
        if (isAtOrAboveInterval('dom.hiddenRatio', hiddenRatio, 'warn')) confidence -= 0.10;
        if (isAtOrAboveInterval('dom.statefulComponentsCount', statefulComponentsCount, 'warn')) confidence -= 0.10;

        if (customControlsRatio > 0.40) confidence -= 0.10;
        if (safeNum(domMetrics && domMetrics.shadowHostCount, 0) > 0) confidence -= 0.05;
        if (domMetrics && domMetrics.capped === true) confidence -= 0.10;

        if (linksPer1k > 180) confidence -= 0.05;
        if (buttonsPer1k > 80) confidence -= 0.05;

        if (linksPer1k > 60 && isAtOrAboveInterval('controls.linksNoTextNoNameRate', linksNoTextNoNameRate, 'warn')) {
            confidence -= 0.08;
        }
        if (buttonsPer1k > 20 && isAtOrAboveInterval('controls.buttonsNoTextNoNameRate', buttonsNoTextNoNameRate, 'warn')) {
            confidence -= 0.12;
        }

        if (buttonsPer1k > 20 && buttonsNoTextRate > 0.50) confidence -= 0.05;

        confidence = clamp(confidence, 0.6, 1.0);

        const adjusted = clamp(evidence * confidence, 0, 100);
        const hasIncomplete = incomplete.length > 0;

        return {
            inputs: {
                domTotal,
                engine: { violations: violations.length, incomplete: incomplete.length, passes: passes.length },
                breadth: {
                    violationsWeighted: Math.round(violationBreadth * 10) / 10,
                    incompleteWeighted: Math.round(incompleteBreadth * 10) / 10
                },
                depthPer1k: {
                    violationsWeighted: Math.round(violationDepthPer1k * 10) / 10,
                    incompleteWeighted: Math.round(incompleteDepthPer1k * 10) / 10
                },
                risk: { engineRaw: Math.round(riskByDomRaw * 10) / 10, engineClamped: Math.round(riskByDom * 10) / 10 },
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
                evidence: Math.round(evidence),
                readiness: Math.round(clamp(readiness, 0, 100)),
                confidence: Math.round(confidence * 100),
                adjusted: Math.round(adjusted),
                avgPageAccessibility: Math.round(adjusted)
            },
            flags: {
                manualReviewNeeded:
                    hasIncomplete ||
                    confidence < 0.85 ||
                    isAtOrAboveInterval('dom.statefulComponentsCount', statefulComponentsCount, 'warn') ||
                    isAtOrAboveInterval('dom.hiddenRatio', hiddenRatio, 'warn') ||
                    safeNum(domMetrics && domMetrics.shadowHostCount, 0) > 0 ||
                    (domMetrics && domMetrics.capped === true) ||
                    (linksPer1k > 60 && isAtOrAboveInterval('controls.linksNoTextNoNameRate', linksNoTextNoNameRate, 'warn')) ||
                    (buttonsPer1k > 20 && isAtOrAboveInterval('controls.buttonsNoTextNoNameRate', buttonsNoTextNoNameRate, 'warn'))
            }
        };
    }

    // Expose as a stable global for main.js (ONLY public surface)
    globalThis.A11Y_METRICS = Object.freeze({
        METRIC_DEFS,
        buildA11ySummary
    });

})();
