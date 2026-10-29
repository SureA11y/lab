'use strict';

// Tests that the coverage-aware summary survives the trip from a scan record into
// the report payload, on both the per-scan and the portfolio side. These use the
// real global-summary builder, so they also cover the portfolio path rebuilding
// its criterion scope from the per-scan summaries.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createWorkflowPayloadBuilder } = require('./workflow-payload-builder');
const { buildGlobalSummary } = require('../server-side/metrics/global-summary');
const { buildCoverageAwareSummary } = require('../server-side/metrics/coverage-summary');
const { buildAutomationCoverage } = require('../server-side/metrics/automation-coverage');

const AUTOMATION = buildAutomationCoverage({
    level: 'AA',
    rules: [
        { ruleId: 'contrast', type: 'automatic', wcag: { scNormative: ['1.4.3'] } },
        { ruleId: 'keyboard-review', type: 'manual', wcag: { scNormative: ['2.1.1'] } }
    ]
});

// uid carries the outcome, as the engines emit it - that is what keeps a pass on
// one page and a fail on another from collapsing during the portfolio merge.
function atomic(ruleId, sc, outcome, confidence = 0.9) {
    return {
        id: ruleId,
        uid: `surea11y:${outcome}:${ruleId}`,
        ruleId,
        outcome,
        confidence,
        type: 'automatic',
        occurrences: [],
        wcag: { sc: [sc], scNormative: [sc] },
        standards: { normativeMappings: [{ standard: 'WCAG', requirement: sc, conformanceLevel: 'AA' }], informativeReferences: [] }
    };
}

function builder() {
    return createWorkflowPayloadBuilder({
        METRIC_DEFS: {},
        sortByOrderKey: (arr) => arr,
        findingsByOutcome: () => ({}),
        getA11yGlobalFindings: () => [],
        buildGlobalSummary,
        cryptoSha1Hex16: (t) => String(t).slice(0, 16)
    });
}

describe('report payload: per-scan coverage summary', () => {
    function scanOut(scan) {
        const base = builder().buildWorkflowPayloadBase({
            url: 'http://x',
            scans: [{ id: 's', canonical: { findings: [] }, ...scan }]
        });
        return base.scans.find((s) => s.id === 's');
    }

    test('a scan-level coverageSummary reaches payload.metrics', () => {
        const coverageSummary = buildCoverageAwareSummary({
            canonical: { findings: [atomic('contrast', '1.4.3', 'fail')] },
            automationCoverage: AUTOMATION
        });
        const out = scanOut({ coverageSummary });
        assert.ok(out.metrics.coverageSummary);
        assert.equal(out.metrics.coverageSummary.coverage.criteriaInScope, 55);
    });

    test('a scan without one emits null rather than leaving the key undefined', () => {
        const out = scanOut({});
        assert.equal(out.metrics.coverageSummary, null);
        assert.ok('coverageSummary' in out.metrics);
    });

    test('an already-populated metrics block is not overwritten', () => {
        const existing = { criteria: [], coverage: {}, marker: 'kept' };
        const out = scanOut({ metrics: { coverageSummary: existing }, coverageSummary: {criteria: [], coverage: {}} });
        assert.equal(out.metrics.coverageSummary.marker, 'kept');
    });
});

describe('report payload: portfolio coverage summary', () => {
    function finalize(scans) {
        const b = builder();
        const base = b.buildWorkflowPayloadBase({ url: 'http://x', scans });
        return b.finalizeWorkflowPayload(base);
    }

    const failScan = {
        id: 'a',
        url: 'https://a.example/',
        canonical: { findings: [atomic('contrast', '1.4.3', 'fail')] },
        domMetrics: { totalElements: 500, counts: {} },
        coverageSummary: buildCoverageAwareSummary({
            canonical: { findings: [atomic('contrast', '1.4.3', 'fail')] },
            automationCoverage: AUTOMATION
        })
    };

    const passScan = {
        id: 'b',
        url: 'https://b.example/',
        canonical: { findings: [atomic('contrast', '1.4.3', 'pass')] },
        domMetrics: { totalElements: 500, counts: {} },
        coverageSummary: buildCoverageAwareSummary({
            canonical: { findings: [atomic('contrast', '1.4.3', 'pass')] },
            automationCoverage: AUTOMATION
        })
    };

    test('the finalized payload carries a portfolio coverage summary', () => {
        const payload = finalize([failScan]);
        assert.ok(payload.metrics.coverageSummary);
        assert.equal(payload.metrics.coverageSummary.coverage.criteriaEvaluated, 1);
    });

    test('the portfolio scope is rebuilt from the per-scan summaries, with no rule catalog in reach', () => {
        const payload = finalize([failScan]);
        assert.equal(payload.metrics.coverageSummary.coverage.criteriaInScope, 55);
        assert.equal(payload.metrics.coverageSummary.criteria.length, 55);
    });

    test('a criterion that fails on one page and passes on another reads as partially supporting across the portfolio', () => {
        const payload = finalize([failScan, passScan]);
        const sc = payload.metrics.coverageSummary.criteria.find((c) => c.sc === '1.4.3');
        assert.equal(sc.status, 'partiallySupports');
        assert.equal(sc.checks.pass, 1);
        assert.equal(sc.checks.fail, 1);
    });

    test('with no per-scan summaries the portfolio still reports what it saw, without inventing a scope', () => {
        const payload = finalize([{ id: 'c', url: 'https://c.example/', canonical: { findings: [atomic('contrast', '1.4.3', 'fail')] }, domMetrics: { totalElements: 500, counts: {} } }]);
        const cs = payload.metrics.coverageSummary;
        assert.equal(cs.coverage.criteriaInScope, null);
        assert.equal(cs.coverage.criteriaTouched, 1);
    });

    test('a skipped page contributes nothing to the criteria but is still counted in scan coverage', () => {
        const payload = finalize([failScan, { id: 'skip', url: 'https://big.example/', skipped: true, skipInfo: { reason: 'DOM too large for a full scan' } }]);
        assert.equal(payload.metrics.a11ySummary.scanCoverage.scansSkipped, 1);
        assert.equal(payload.metrics.coverageSummary.coverage.criteriaEvaluated, 1);
    });
});

describe('report payload: findingsByKind stays out of the result', () => {
    // A rollup, as surea11y marks one: what findingsByKind sorts by.
    function rollup(ruleId, sc, outcome) {
        return { ...atomic(ruleId, sc, outcome), meta: { atomic: false }, evidence: { rollup: true } };
    }

    function scanWithKinds() {
        const findings = [rollup('wcag-1.4.3', '1.4.3', 'fail'), atomic('contrast', '1.4.3', 'fail')];
        return {
            id: 's',
            canonical: {
                findings,
                summary: { failCount: 2 },
                findingsByKind: { composite: [findings[0]], atomic: [findings[1]] }
            }
        };
    }

    test('the payload\'s canonical has everything but findingsByKind', () => {
        const scan = scanWithKinds();
        const out = builder().buildWorkflowPayloadBase({ url: 'http://x', scans: [scan] }).scans[0];
        assert.equal('findingsByKind' in out.canonical, false);
        assert.deepEqual(out.canonical.findings, scan.canonical.findings);
        assert.deepEqual(out.canonical.summary, scan.canonical.summary);
        assert.ok(scan.canonical.findingsByKind, 'the run\'s own copy keeps it while in memory');
    });

    test('coverage read from the saved canonical is the coverage read with findingsByKind', () => {
        const scan = scanWithKinds();
        const out = builder().buildWorkflowPayloadBase({ url: 'http://x', scans: [scan] }).scans[0];
        const saved = JSON.parse(JSON.stringify(out.canonical));
        assert.deepEqual(
            buildCoverageAwareSummary({ canonical: saved, automationCoverage: AUTOMATION }),
            buildCoverageAwareSummary({ canonical: scan.canonical, automationCoverage: AUTOMATION })
        );
    });

    test('a canonical without it, or none at all, goes through as it was', () => {
        const canonical = { findings: [] };
        const [a, b] = builder().buildWorkflowPayloadBase({
            url: 'http://x', scans: [{ id: 'a', canonical }, { id: 'b' }],
        }).scans;
        assert.equal(a.canonical, canonical);
        assert.equal(b.canonical, null);
    });
});
