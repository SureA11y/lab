'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildGlobalDomMetrics,
    buildGlobalTextMetrics,
    buildGlobalSummary,
    buildScanCoverage,
    automationCoverageFromScans,
    computePortfolioMergedInputs,
    computeGlobalEvidenceFromMerged
} = require('./global-summary');

const { buildA11ySummary } = require('./a11y-summary');

describe('computePortfolioMergedInputs', () => {
    test('counts and weighted breadth by impact', () => {
        const merged = {
            violations: [{ impact: 'critical', nodes: [] }, { impact: 'minor', nodes: [] }],
            incomplete: [{ impact: 'moderate', nodes: [] }],
            passes: [{}, {}]
        };
        const out = computePortfolioMergedInputs(merged);
        assert.equal(out.counts.violations, 2);
        assert.equal(out.counts.incomplete, 1);
        assert.equal(out.counts.passes, 2);
        assert.equal(out.breadth.violationsWeighted, 10 + 1); // critical(10) + minor(1)
        assert.equal(out.breadth.incompleteWeighted, 3); // moderate
    });

    test('depth groups nodes by URL and sums sqrt(count) per URL, not sqrt of the raw total', () => {
        // Same rule, 4 occurrences, but split 2+2 across two URLs -> sqrt(2)+sqrt(2), not sqrt(4).
        const splitAcrossUrls = computePortfolioMergedInputs({
            violations: [{
                impact: 'minor',
                nodes: [
                    { url: 'https://a.example/' }, { url: 'https://a.example/' },
                    { url: 'https://b.example/' }, { url: 'https://b.example/' }
                ]
            }]
        });
        const sameUrl = computePortfolioMergedInputs({
            violations: [{
                impact: 'minor',
                nodes: [
                    { url: 'https://a.example/' }, { url: 'https://a.example/' },
                    { url: 'https://a.example/' }, { url: 'https://a.example/' }
                ]
            }]
        });

        assert.ok(Math.abs(splitAcrossUrls.depthAbs.violationsWeighted - Math.sqrt(2) * 2) < 1e-9);
        assert.ok(Math.abs(sameUrl.depthAbs.violationsWeighted - Math.sqrt(4)) < 1e-9);
        // Same total occurrence count, but spread across more URLs yields *more* weighted depth
        // (sqrt is sublinear, so summing per-URL sqrt beats sqrt of the combined total).
        assert.ok(splitAcrossUrls.depthAbs.violationsWeighted > sameUrl.depthAbs.violationsWeighted);
    });

    test('nodes without a recognizable URL are grouped under a single "unknown" bucket', () => {
        const out = computePortfolioMergedInputs({
            violations: [{ impact: 'minor', nodes: [{}, {}, {}] }]
        });
        // All 3 nodes fall into the same unknown bucket -> sqrt(3), not 3 * sqrt(1)
        assert.ok(Math.abs(out.depthAbs.violationsWeighted - Math.sqrt(3)) < 1e-9);
    });

    test('missing/empty merged input produces all-zero output, not a crash', () => {
        const out = computePortfolioMergedInputs(null);
        assert.deepEqual(out.counts, { violations: 0, incomplete: 0, passes: 0 });
        assert.deepEqual(out.breadth, { violationsWeighted: 0, incompleteWeighted: 0 });
        assert.deepEqual(out.depthAbs, { violationsWeighted: 0, incompleteWeighted: 0 });
    });
});

describe('computeGlobalEvidenceFromMerged', () => {
    test('empty merged input yields maximal evidence (100)', () => {
        const out = computeGlobalEvidenceFromMerged({ violations: [], incomplete: [], passes: [] }, 500);
        assert.equal(out.evidence, 100);
    });

    test('domTotal is clamped to at least 1 (no division by zero)', () => {
        assert.doesNotThrow(() => computeGlobalEvidenceFromMerged({}, 0));
    });

    test('more/heavier violations reduce evidence', () => {
        const light = computeGlobalEvidenceFromMerged({ violations: [{ impact: 'minor', nodes: [] }] }, 500);
        const heavy = computeGlobalEvidenceFromMerged({
            violations: Array.from({ length: 5 }, () => ({ impact: 'critical', nodes: [{}, {}, {}] }))
        }, 500);
        assert.ok(heavy.evidence < light.evidence);
    });
});

describe('buildGlobalDomMetrics', () => {
    function scanWithDom(dom) {
        return { domMetrics: dom };
    }

    test('sums raw counters across scans', () => {
        const out = buildGlobalDomMetrics([
            scanWithDom({ totalElements: 100, iframeCount: 1, shadowHostCount: 0, positiveTabindexCount: 2 }),
            scanWithDom({ totalElements: 200, iframeCount: 2, shadowHostCount: 1, positiveTabindexCount: 3 })
        ]);
        assert.equal(out.totalElements, 300);
        assert.equal(out.iframeCount, 3);
        assert.equal(out.shadowHostCount, 1);
        assert.equal(out.positiveTabindexCount, 5);
    });

    test('capped is OR across scans (any capped scan makes the global result capped)', () => {
        const out = buildGlobalDomMetrics([
            scanWithDom({ totalElements: 10, capped: false }),
            scanWithDom({ totalElements: 10, capped: true })
        ]);
        assert.equal(out.capped, true);
    });

    test('ratios are recomputed from SUMMED counts, not averaged per-scan ratios', () => {
        // Scan A: 90 evaluable out of 100 total (ratio 0.9). Scan B: 10 evaluable out of 1000 (ratio 0.01).
        // A naive average of ratios would be ~0.455; the sum-based ratio should be ~100/1100 = 0.0909.
        const out = buildGlobalDomMetrics([
            scanWithDom({ totalElements: 100, counts: { evaluable: 90, div: 0, span: 0, semantic: 0, interactiveNative: 0, customControls: 0, hidden: 0, focusable: 0, dialog: 0, details: 0, tablist: 0, ariaExpanded: 0 } }),
            scanWithDom({ totalElements: 1000, counts: { evaluable: 10, div: 0, span: 0, semantic: 0, interactiveNative: 0, customControls: 0, hidden: 0, focusable: 0, dialog: 0, details: 0, tablist: 0, ariaExpanded: 0 } })
        ]);
        const expected = (100 + 1) / (1100 + 1);
        assert.ok(Math.abs(out.coverageRatio - expected) < 1e-9);
        assert.ok(out.coverageRatio < 0.2); // nowhere near the naive average of ~0.455
    });

    test('depthMax and statefulComponentsCount use the P90 percentile across scans, not the max or the sum', () => {
        const scans = [10, 20, 30, 40, 50].map(depthMax => scanWithDom({ totalElements: 100, depthMax }));
        const out = buildGlobalDomMetrics(scans);
        // percentile([10,20,30,40,50], 90) -> idx = floor(0.9*4) = 3 -> 40
        assert.equal(out.depthMax, 40);
    });

    test('counts.* are summed per key across scans', () => {
        const out = buildGlobalDomMetrics([
            scanWithDom({ totalElements: 10, counts: { div: 3, span: 1 } }),
            scanWithDom({ totalElements: 10, counts: { div: 2, span: 4 } })
        ]);
        assert.equal(out.counts.div, 5);
        assert.equal(out.counts.span, 5);
    });

    test('scans with no domMetrics at all are skipped without crashing', () => {
        const out = buildGlobalDomMetrics([{}, scanWithDom({ totalElements: 50 })]);
        assert.equal(out.totalElements, 50);
    });

    test('pickDomMetrics also accepts the scan.metrics.domMetrics shape', () => {
        const out = buildGlobalDomMetrics([{ metrics: { domMetrics: { totalElements: 42 } } }]);
        assert.equal(out.totalElements, 42);
    });

    test('an empty scans array produces a zeroed, non-crashing result', () => {
        const out = buildGlobalDomMetrics([]);
        assert.equal(out.totalElements, 0);
        assert.equal(out.capped, false);
    });
});

describe('buildGlobalTextMetrics', () => {
    function scanWithText(tm) {
        return { textMetrics: tm };
    }

    test('rates are recomputed from SUMMED counts, not averaged per-scan rates', () => {
        // Scan A: 1/10 links have no text (rate 0.1). Scan B: 1/1 links have no text (rate 1.0).
        // Naive average would be 0.55; the sum-based rate should be 2/11 =~ 0.1818.
        const out = buildGlobalTextMetrics([
            scanWithText({ links: { linksCount: 10, linksNoVisibleTextCount: 1 } }),
            scanWithText({ links: { linksCount: 1, linksNoVisibleTextCount: 1 } })
        ]);
        assert.ok(Math.abs(out.links.linksNoVisibleTextRate - (2 / 11)) < 1e-9);
    });

    test('totals are summed across scans', () => {
        const out = buildGlobalTextMetrics([
            scanWithText({ totals: { visibleTextChars: 100, elementsVisited: 10, headingCount: 2 } }),
            scanWithText({ totals: { visibleTextChars: 50, elementsVisited: 5, headingCount: 1 } })
        ]);
        assert.deepEqual(out.totals, { visibleTextChars: 150, elementsVisited: 15, headingCount: 3 });
    });

    test('paragraphs.count is summed, p50/p90 are the median of per-scan values, maxChars is the max', () => {
        const out = buildGlobalTextMetrics([
            scanWithText({ paragraphs: { count: 10, p50Chars: 100, p90Chars: 300, maxChars: 500 } }),
            scanWithText({ paragraphs: { count: 20, p50Chars: 200, p90Chars: 400, maxChars: 900 } })
        ]);
        assert.equal(out.paragraphs.count, 30);
        assert.equal(out.paragraphs.maxChars, 900);
        // median of two values, per the module's percentile(arr, 50) floor-index formula:
        // sorted [100,200], idx = floor(0.5 * 1) = 0 -> 100
        assert.equal(out.paragraphs.p50Chars, 100);
    });

    test('capped is OR across scans', () => {
        const out = buildGlobalTextMetrics([scanWithText({ capped: false }), scanWithText({ capped: true })]);
        assert.equal(out.capped, true);
    });

    test('pickTextMetrics falls back through domMetrics.textMetrics and metrics.domMetrics.textMetrics', () => {
        const viaDom = buildGlobalTextMetrics([{ domMetrics: { textMetrics: { totals: { visibleTextChars: 7 } } } }]);
        assert.equal(viaDom.totals.visibleTextChars, 7);

        const viaMetricsDom = buildGlobalTextMetrics([{ metrics: { domMetrics: { textMetrics: { totals: { visibleTextChars: 9 } } } } }]);
        assert.equal(viaMetricsDom.totals.visibleTextChars, 9);
    });

    test('an empty scans array produces a zeroed, non-crashing result', () => {
        const out = buildGlobalTextMetrics([]);
        assert.deepEqual(out.totals, { visibleTextChars: 0, elementsVisited: 0, headingCount: 0 });
        assert.equal(out.links.linksNoVisibleTextRate, 0);
    });
});

describe('buildScanCoverage', () => {
    test('a run with no scans reports zero totals and a zero analyzed ratio', () => {
        assert.deepEqual(buildScanCoverage([]), {
            scansTotal: 0,
            scansAnalyzed: 0,
            scansSkipped: 0,
            analyzedRatio: 0,
            skippedReasons: {},
            skippedScans: []
        });
    });

    test('non-array input is treated as an empty run', () => {
        assert.equal(buildScanCoverage(null).scansTotal, 0);
        assert.equal(buildScanCoverage(undefined).scansTotal, 0);
    });

    test('counts analyzed vs skipped and tallies reasons', () => {
        const cov = buildScanCoverage([
            { id: 'a', url: 'https://a.example/' },
            { id: 'b', url: 'https://b.example/', skipped: true, skipInfo: { reason: 'DOM too large for a full scan', estimatedNodes: 30000, threshold: 25000 } },
            { id: 'c', url: 'https://c.example/', skipped: true, skipInfo: { reason: 'DOM too large for a full scan', estimatedNodes: 41000, threshold: 25000 } },
            { id: 'd', url: 'https://d.example/' }
        ]);
        assert.equal(cov.scansTotal, 4);
        assert.equal(cov.scansAnalyzed, 2);
        assert.equal(cov.scansSkipped, 2);
        assert.equal(cov.analyzedRatio, 0.5);
        assert.deepEqual(cov.skippedReasons, { 'DOM too large for a full scan': 2 });
        assert.deepEqual(cov.skippedScans.map(s => s.id), ['b', 'c']);
        assert.equal(cov.skippedScans[1].estimatedNodes, 41000);
    });

    test('a scan carrying only skipInfo counts as skipped, and a missing reason is labelled', () => {
        const cov = buildScanCoverage([{ id: 'a', skipInfo: {} }]);
        assert.equal(cov.scansSkipped, 1);
        assert.equal(cov.skippedScans[0].reason, 'reason not provided');
        assert.deepEqual(cov.skippedReasons, { 'reason not provided': 1 });
    });

    test('falls back to scanId when the scan has no id, and nulls unusable skipInfo numbers', () => {
        const cov = buildScanCoverage([
            { scanId: 'scan-7', skipped: true, skipInfo: { reason: 'x', estimatedNodes: 'lots', threshold: null } }
        ]);
        assert.equal(cov.skippedScans[0].id, 'scan-7');
        assert.equal(cov.skippedScans[0].estimatedNodes, null);
        assert.equal(cov.skippedScans[0].threshold, null);
    });
});

describe('automationCoverageFromScans', () => {
    const criteria = [
        { sc: '1.4.3', level: 'AA', automation: 'automatic' },
        { sc: '2.1.1', level: 'A', automation: 'manualOnly' }
    ];

    test('rebuilds the criterion scope from a scan-level coverage summary', () => {
        const out = automationCoverageFromScans([{ coverageSummary: { criteria } }]);
        assert.deepEqual(out.criteria, criteria);
    });

    test('reads the summary from metrics.coverageSummary as the report payload nests it', () => {
        const out = automationCoverageFromScans([{ metrics: { coverageSummary: { criteria } } }]);
        assert.deepEqual(out.criteria.map(c => c.sc), ['1.4.3', '2.1.1']);
    });

    test('unions criteria across scans and de-duplicates, sorted numerically', () => {
        const out = automationCoverageFromScans([
            { coverageSummary: { criteria: [{ sc: '1.4.10', level: 'AA', automation: 'automatic' }, criteria[0]] } },
            { coverageSummary: { criteria: [criteria[0], criteria[1]] } }
        ]);
        assert.deepEqual(out.criteria.map(c => c.sc), ['1.4.3', '1.4.10', '2.1.1']);
    });

    test('criteria with no automation label are skipped, since they carry no scope information', () => {
        const out = automationCoverageFromScans([{ coverageSummary: { criteria: [{ sc: '1.4.3', level: 'AA' }] } }]);
        assert.equal(out, null);
    });

    test('returns null when no scan carries a coverage summary, so no scope is invented', () => {
        assert.equal(automationCoverageFromScans([{ url: 'https://a.example/' }]), null);
        assert.equal(automationCoverageFromScans([]), null);
        assert.equal(automationCoverageFromScans(null), null);
    });
});

describe('buildGlobalSummary', () => {
    function scan({ url, findings = [], domMetrics = { totalElements: 100 }, a11ySummary = null }) {
        return { url, canonical: { findings }, domMetrics, a11ySummary };
    }

    test('a portfolio coverage summary is attached, driven by the merged canonical', () => {
        const finding = (outcome) => ({
            uid: `surea11y:${outcome}:contrast`,
            ruleId: 'contrast',
            outcome,
            confidence: 0.9,
            type: 'automatic',
            occurrences: [],
            wcag: { sc: ['1.4.3'], scNormative: ['1.4.3'] },
            standards: { normativeMappings: [{ standard: 'WCAG', requirement: '1.4.3', conformanceLevel: 'AA' }] }
        });

        const out = buildGlobalSummary({
            scans: [scan({ url: 'https://a.example/', findings: [finding('fail')] }), scan({ url: 'https://b.example/', findings: [finding('pass')] })]
        });

        const cs = out.a11ySummary.coverageSummary;
        assert.ok(cs);
        assert.equal(cs.criteria.length, 1);
        assert.equal(cs.criteria[0].sc, '1.4.3');
        assert.equal(cs.criteria[0].status, 'partiallySupports');
    });

    test('an explicit automationCoverage option takes precedence over the one rebuilt from scans', () => {
        const explicit = { criteria: [{ sc: '9.9.9', level: 'A', automation: 'notAutomatable' }] };
        const out = buildGlobalSummary({
            scans: [{ url: 'https://a.example/', canonical: { findings: [] }, domMetrics: { totalElements: 100 }, coverageSummary: { criteria: [{ sc: '1.4.3', level: 'AA', automation: 'automatic' }] } }],
            options: { automationCoverage: explicit }
        });
        assert.deepEqual(out.a11ySummary.coverageSummary.criteria.map(c => c.sc), ['9.9.9']);
    });

    test('scanCoverage records skipped pages that contribute nothing to the scores', () => {
        const scans = [
            scan({ url: 'https://a.example/', a11ySummary: { scores: { confidence: 90, adjusted: 80 } } }),
            { url: 'https://big.example/', skipped: true, skipInfo: { reason: 'DOM too large for a full scan', estimatedNodes: 30000, threshold: 25000 }, canonical: null, domMetrics: null, a11ySummary: null }
        ];
        const out = buildGlobalSummary({ scans });

        assert.equal(out.a11ySummary.scanCoverage.scansTotal, 2);
        assert.equal(out.a11ySummary.scanCoverage.scansAnalyzed, 1);
        assert.equal(out.a11ySummary.scanCoverage.scansSkipped, 1);
        assert.equal(out.a11ySummary.scanCoverage.skippedScans[0].url, 'https://big.example/');

        // the skipped page is absent from the score denominator, which is exactly why
        // scanCoverage has to report it
        assert.equal(out.a11ySummary.stats.pageAccessibility.n, 1);
    });

    test('scanCoverage reports full coverage when nothing was skipped', () => {
        const out = buildGlobalSummary({ scans: [scan({ url: 'https://a.example/' }), scan({ url: 'https://b.example/' })] });
        assert.equal(out.a11ySummary.scanCoverage.scansSkipped, 0);
        assert.equal(out.a11ySummary.scanCoverage.analyzedRatio, 1);
    });

    test('accepts both call signatures: an options object, and (scans, mergedA11y, options) positional args', () => {
        const scans = [scan({ url: 'https://a.example/' })];
        const viaObject = buildGlobalSummary({ scans });
        const viaPositional = buildGlobalSummary(scans, null, {});
        assert.equal(viaObject.a11ySummary.scores.evidence, viaPositional.a11ySummary.scores.evidence);
    });

    // Note: buildGlobalSummary internally builds a deduplicated "portfolioCanonical" (same uid ->
    // merged occurrences, byKey merge), but inputs.engine.violations is populated separately, by
    // computeGlobalEvidenceFromCanonicalScans() counting findings per-scan directly - it does not
    // consult the deduplicated structure at all. So the same rule uid failing on two different
    // scans correctly contributes 2 to the portfolio violations tally, not 1: this reflects "how
    // many times did this fail across the portfolio" (feeding the per-URL depth/risk model),
    // not "how many distinct rules failed anywhere". The byKey merge's own dedup is not otherwise
    // observable through buildGlobalSummary's return value (portfolioCanonical itself is never
    // exposed), so it isn't asserted on here.
    test('a shared-uid finding across two scans counts once per scan in the portfolio violations tally', () => {
        const scans = [
            scan({
                url: 'https://a.example/',
                findings: [{ uid: 'shared', outcome: 'fail', occurrences: [{ pageUrl: 'https://a.example/', target: ['.btn'] }] }]
            }),
            scan({
                url: 'https://b.example/',
                findings: [{ uid: 'shared', outcome: 'fail', occurrences: [{ pageUrl: 'https://b.example/', target: ['.link'] }] }]
            })
        ];
        const out = buildGlobalSummary({ scans });
        assert.equal(out.a11ySummary.inputs.engine.violations, 2);
    });

    test('legacy mergedA11y, when explicitly provided, drives evidence instead of the canonical scans', () => {
        const scans = [scan({ findings: [{ uid: 'a', outcome: 'fail', severity: 'minor', occurrences: [{}] }] })];
        const canonicalOnly = buildGlobalSummary({ scans });
        const withMerged = buildGlobalSummary({
            scans,
            mergedA11y: { violations: Array.from({ length: 10 }, () => ({ impact: 'critical', nodes: [{}, {}, {}] })) }
        });
        assert.notEqual(withMerged.a11ySummary.scores.evidence, canonicalOnly.a11ySummary.scores.evidence);
        assert.ok(withMerged.a11ySummary.scores.evidence < canonicalOnly.a11ySummary.scores.evidence);
    });

    test('useMinConfidence (default true) sets global confidence to the minimum of per-scan confidences', () => {
        const scans = [
            scan({ a11ySummary: { scores: { confidence: 95, adjusted: 90 } } }),
            scan({ a11ySummary: { scores: { confidence: 70, adjusted: 60 } } })
        ];
        const out = buildGlobalSummary({ scans });
        assert.equal(out.a11ySummary.scores.confidence, 70);
    });

    test('useMinConfidence:false leaves confidence as computed by buildA11ySummary on the portfolio data, ignoring per-scan values', () => {
        const scans = [
            scan({ a11ySummary: { scores: { confidence: 20, adjusted: 10 } } }) // would drag min-confidence way down
        ];
        const withMin = buildGlobalSummary({ scans });
        const withoutMin = buildGlobalSummary({ scans, options: { useMinConfidence: false } });
        assert.notEqual(withoutMin.a11ySummary.scores.confidence, 20);
        assert.equal(withMin.a11ySummary.scores.confidence, 20);
    });

    test('avgPageAccessibility is the mean of per-scan scores (avgPageAccessibility, falling back to adjusted)', () => {
        const scans = [
            scan({ a11ySummary: { scores: { adjusted: 80, avgPageAccessibility: 80 } } }),
            scan({ a11ySummary: { scores: { adjusted: 40 } } }) // no avgPageAccessibility -> falls back to adjusted
        ];
        const out = buildGlobalSummary({ scans });
        assert.equal(out.a11ySummary.scores.avgPageAccessibility, 60);
    });

    test('a portfolio of pages that produced no findings reports no score rather than a perfect one', () => {
        const scans = [
            scan({ url: 'https://a.example/', findings: [], domMetrics: { totalElements: 200 } }),
            scan({ url: 'https://b.example/', findings: [], domMetrics: { totalElements: 200 } })
        ];
        const out = buildGlobalSummary({ scans });
        assert.equal(out.a11ySummary.stats.pageAccessibility.n, 0);
        assert.equal(out.a11ySummary.scores.evaluationState, 'notEvaluated');
        assert.equal(out.a11ySummary.scores.adjusted, null);
        assert.equal(out.a11ySummary.scores.avgPageAccessibility, null);
        assert.equal(out.a11ySummary.flags.manualReviewNeeded, true);
    });

    test('a portfolio where something did conclude still reports a score', () => {
        const out = buildGlobalSummary({
            scans: [scan({ url: 'https://a.example/', findings: [{ uid: 'a', outcome: 'fail', severity: 'serious', occurrences: [{ pageUrl: 'https://a.example/' }] }] })]
        });
        assert.equal(out.a11ySummary.scores.evaluationState, 'evaluated');
        assert.ok(Number.isFinite(out.a11ySummary.scores.adjusted));
    });

    test('stats.pageAccessibility reports a correct distribution for a known dataset', () => {
        const scores = [10, 20, 30, 40, 50];
        const scans = scores.map(adjusted => scan({ a11ySummary: { scores: { adjusted } } }));
        const out = buildGlobalSummary({ scans });
        const stats = out.a11ySummary.stats.pageAccessibility;
        assert.equal(stats.n, 5);
        assert.equal(stats.min, 10);
        assert.equal(stats.max, 50);
        assert.equal(stats.mean, 30);
        assert.equal(stats.median, 30);
        assert.equal(stats.p10, 10);
        assert.equal(stats.p25, 20);
        assert.equal(stats.p75, 40);
        assert.equal(stats.p90, 40);
        assert.equal(stats.iqr, 20);
        assert.equal(stats.stddev, Math.round(Math.sqrt(200) * 10) / 10);
    });

    test('no scans at all is well-formed and non-crashing, and claims no result', () => {
        const out = buildGlobalSummary({ scans: [] });
        assert.equal(out.a11ySummary.scores.evaluationState, 'notEvaluated');
        assert.equal(out.a11ySummary.scores.evidence, null);
        assert.equal(out.a11ySummary.scores.adjusted, null);
        assert.equal(out.a11ySummary.stats.pageAccessibility.n, 0);
        assert.equal(out.domMetrics.totalElements, 0);
    });

    test('cantTell findings count as incomplete (with depth contribution from their occurrences), pass findings count as passes with no depth contribution', () => {
        const scans = [scan({
            findings: [
                { uid: 'a', outcome: 'cantTell', severity: 'moderate', occurrences: [{ pageUrl: 'https://a.example/' }] },
                { uid: 'b', outcome: 'pass', severity: 'minor', occurrences: [{ pageUrl: 'https://a.example/' }] }
            ]
        })];
        const out = buildGlobalSummary({ scans });
        assert.equal(out.a11ySummary.inputs.engine.incomplete, 1);
        assert.equal(out.a11ySummary.inputs.engine.passes, 1);
        assert.equal(out.a11ySummary.inputs.engine.violations, 0);
        // The cantTell finding has an occurrence, so it contributes incomplete depth (line ~599);
        // pass findings never reach the depth-accumulation code at all (outcome check bails first).
        assert.ok(out.a11ySummary.inputs.depthPer1k.incompleteWeighted > 0);
    });

    test('the portfolio names its counts and risk after no engine in particular', () => {
        const scans = [scan({ findings: [{ uid: 'a', outcome: 'fail', severity: 'serious', occurrences: [{}] }] })];
        const out = buildGlobalSummary({ scans });
        assert.equal(out.a11ySummary.inputs.engine.violations, 1);
        assert.deepEqual(Object.keys(out.a11ySummary.inputs.risk), ['engineRaw', 'engineClamped']);
    });

    test('an alias severity spelling ("severe") produces the same portfolio evidence as its canonical equivalent ("serious"), and the same as buildA11ySummary would score it per-page - both paths share one normalization function', () => {
        const findingWith = (severity) => [{ uid: 'a', outcome: 'fail', severity, occurrences: [{ pageUrl: 'https://a.example/' }] }];

        const aliasScans = [scan({ url: 'https://a.example/', findings: findingWith('severe') })];
        const canonicalScans = [scan({ url: 'https://a.example/', findings: findingWith('serious') })];

        const aliasPortfolio = buildGlobalSummary({ scans: aliasScans });
        const canonicalPortfolio = buildGlobalSummary({ scans: canonicalScans });
        assert.equal(aliasPortfolio.a11ySummary.scores.evidence, canonicalPortfolio.a11ySummary.scores.evidence);

        const aliasPerPage = buildA11ySummary({ canonical: { findings: findingWith('severe') }, domMetrics: { totalElements: 100 } });
        const canonicalPerPage = buildA11ySummary({ canonical: { findings: findingWith('serious') }, domMetrics: { totalElements: 100 } });
        assert.equal(aliasPerPage.scores.evidence, canonicalPerPage.scores.evidence);

        // Both scoring paths must also agree with each other on this single-scan case.
        assert.equal(aliasPortfolio.a11ySummary.scores.evidence, aliasPerPage.scores.evidence);
    });
});

describe('buildGlobalSummary: pages that withheld a score', () => {
    function scored(url, scores) {
        return { url, canonical: { findings: [] }, domMetrics: { totalElements: 200 }, a11ySummary: { scores } };
    }

    test('a withheld per-page score is excluded from the mean, not counted as zero', () => {
        const out = buildGlobalSummary({
            scans: [
                scored('https://a.example/', { avgPageAccessibility: 80, adjusted: 80, confidence: 90 }),
                scored('https://b.example/', { avgPageAccessibility: 60, adjusted: 60, confidence: 90 }),
                scored('https://c.example/', { avgPageAccessibility: null, adjusted: null, confidence: null })
            ]
        });
        assert.equal(out.a11ySummary.stats.pageAccessibility.n, 2);
        assert.equal(out.a11ySummary.scores.avgPageAccessibility, 70);
    });

    test('a withheld per-page confidence does not become a zero minimum', () => {
        const out = buildGlobalSummary({
            scans: [
                scored('https://a.example/', { avgPageAccessibility: 80, adjusted: 80, confidence: 90 }),
                scored('https://b.example/', { avgPageAccessibility: null, adjusted: null, confidence: null })
            ],
            options: { useMinConfidence: true }
        });
        assert.equal(out.a11ySummary.scores.confidence, 90);
    });

    test('when every page withheld its score the portfolio reports none either', () => {
        const out = buildGlobalSummary({
            scans: [
                scored('https://a.example/', { avgPageAccessibility: null, adjusted: null, confidence: null }),
                scored('https://b.example/', { avgPageAccessibility: null, adjusted: null, confidence: null })
            ]
        });
        assert.equal(out.a11ySummary.stats.pageAccessibility.n, 0);
        assert.equal(out.a11ySummary.scores.avgPageAccessibility, null);
        assert.equal(out.a11ySummary.scores.evaluationState, 'notEvaluated');
    });
});
