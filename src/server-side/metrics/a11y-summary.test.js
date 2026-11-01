'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildA11ySummary } = require('./a11y-summary');

function finding(outcome, severity, occurrenceCount = 1) {
    return {
        outcome,
        severity,
        occurrences: Array.from({ length: occurrenceCount }, () => ({}))
    };
}

describe('buildA11ySummary: empty/default input', () => {
    test('no canonical findings and no domMetrics: nothing was found, so nothing is claimed about confidence', () => {
        const out = buildA11ySummary({ canonical: null, domMetrics: null, textMetrics: null });
        assert.equal(out.inputs.engine.violations, 0);
        assert.equal(out.inputs.engine.incomplete, 0);
        assert.equal(out.inputs.engine.passes, 0);
        assert.equal(out.scores.confidence, null);
        assert.equal(out.scores.confidenceSource, 'notMeasured');
        assert.equal(out.scores.confidenceByDom, 94); // 100 - 6 (dom.coverageRatio "warn" penalty)
        // no coverage summary supplied, so the score is not gated
        assert.equal(out.scores.evaluationState, 'unknown');
        assert.equal(out.scores.evidence, 100);
        assert.equal(out.scores.adjusted, 100);
    });

    test('domMetrics.totalElements of 0 does not divide by zero (clamped to 1)', () => {
        assert.doesNotThrow(() => {
            const out = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { totalElements: 0 } });
            assert.equal(out.inputs.domTotal, 1);
        });
    });

    test('canonical.findings missing/non-array is treated as no findings', () => {
        const out = buildA11ySummary({ canonical: {} });
        assert.equal(out.inputs.engine.violations, 0);
        assert.equal(out.scores.evidence, 100);
    });
});

describe('buildA11ySummary: outcome filtering into violations/incomplete/passes', () => {
    test('counts each outcome bucket independently by canonical finding outcome', () => {
        const canonical = {
            findings: [
                finding('fail', 'serious'),
                finding('fail', 'minor'),
                finding('cantTell', 'moderate'),
                finding('pass', 'minor'),
                finding('notApplicable', 'minor') // not counted in any of the three buckets
            ]
        };
        const out = buildA11ySummary({ canonical, domMetrics: { totalElements: 100 } });
        assert.equal(out.inputs.engine.violations, 2);
        assert.equal(out.inputs.engine.incomplete, 1);
        assert.equal(out.inputs.engine.passes, 1);
    });

    test('incomplete findings mark manualReviewNeeded', () => {
        const canonical = { findings: [finding('cantTell', 'moderate')] };
        const out = buildA11ySummary({ canonical, domMetrics: { totalElements: 100 } });
        assert.equal(out.flags.manualReviewNeeded, true);
    });
});

describe('buildA11ySummary: risk/evidence responds to violations', () => {
    test('more violations (or higher severity) never increases evidence', () => {
        const none = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { totalElements: 500 } });
        const minorOnly = buildA11ySummary({
            canonical: { findings: [finding('fail', 'minor')] },
            domMetrics: { totalElements: 500 }
        });
        const criticalMany = buildA11ySummary({
            canonical: { findings: Array.from({ length: 5 }, () => finding('fail', 'critical', 10)) },
            domMetrics: { totalElements: 500 }
        });

        assert.ok(none.scores.evidence >= minorOnly.scores.evidence);
        assert.ok(minorOnly.scores.evidence >= criticalMany.scores.evidence);
        assert.equal(none.scores.evidence, 100);
    });

    test('higher-impact violations weigh at least as much as lower-impact ones (breadth)', () => {
        const minor = buildA11ySummary({ canonical: { findings: [finding('fail', 'minor')] }, domMetrics: { totalElements: 500 } });
        const critical = buildA11ySummary({ canonical: { findings: [finding('fail', 'critical')] }, domMetrics: { totalElements: 500 } });
        assert.ok(critical.inputs.breadth.violationsWeighted > minor.inputs.breadth.violationsWeighted);
    });

    test('an unknown/missing severity is weighted like the documented default (between minor and moderate)', () => {
        const minor = buildA11ySummary({ canonical: { findings: [finding('fail', 'minor')] }, domMetrics: { totalElements: 500 } });
        const unknown = buildA11ySummary({ canonical: { findings: [finding('fail', undefined)] }, domMetrics: { totalElements: 500 } });
        const moderate = buildA11ySummary({ canonical: { findings: [finding('fail', 'moderate')] }, domMetrics: { totalElements: 500 } });
        assert.ok(unknown.inputs.breadth.violationsWeighted > minor.inputs.breadth.violationsWeighted);
        assert.ok(unknown.inputs.breadth.violationsWeighted < moderate.inputs.breadth.violationsWeighted);
    });

    test('"info" severity is weighted lower than "minor", not higher (it is the lightest recognized severity)', () => {
        const info = buildA11ySummary({ canonical: { findings: [finding('fail', 'info')] }, domMetrics: { totalElements: 500 } });
        const minor = buildA11ySummary({ canonical: { findings: [finding('fail', 'minor')] }, domMetrics: { totalElements: 500 } });
        assert.ok(info.inputs.breadth.violationsWeighted < minor.inputs.breadth.violationsWeighted);
    });

    test('alias severity spellings ("severe"/"medium"/"low"/"informational") are normalized to their canonical equivalents, matching weight exactly', () => {
        const pairs = [
            ['severe', 'serious'],
            ['medium', 'moderate'],
            ['low', 'minor'],
            ['informational', 'info']
        ];
        for (const [alias, canonical] of pairs) {
            const aliasOut = buildA11ySummary({ canonical: { findings: [finding('fail', alias)] }, domMetrics: { totalElements: 500 } });
            const canonicalOut = buildA11ySummary({ canonical: { findings: [finding('fail', canonical)] }, domMetrics: { totalElements: 500 } });
            assert.equal(aliasOut.inputs.breadth.violationsWeighted, canonicalOut.inputs.breadth.violationsWeighted, `${alias} should weigh the same as ${canonical}`);
        }
    });
});

describe('buildA11ySummary: score bounds', () => {
    test('evidence, the structural proxy and adjusted are always within their bounds', () => {
        const out = buildA11ySummary({
            canonical: { findings: Array.from({ length: 50 }, () => finding('fail', 'critical', 100)) },
            domMetrics: {
                totalElements: 10,
                semanticRatio: 0, coverageRatio: 0, customControlsRatio: 5, hiddenRatio: 1,
                depthMax: 999, statefulComponentsCount: 999, shadowHostCount: 5, capped: true
            },
            textMetrics: {
                links: { linksPer1k: 999, linkTextShare: 0, linksNoVisibleTextRate: 1, linksNoTextNoNameSignalRate: 1 },
                buttons: { buttonsPer1k: 999, buttonTextShare: 0, buttonsNoVisibleTextRate: 1, buttonsNoTextNoNameSignalRate: 1 }
            }
        });
        assert.ok(out.scores.evidence >= 0 && out.scores.evidence <= 100);
        assert.ok(out.scores.confidenceByDom >= 60 && out.scores.confidenceByDom <= 100); // the proxy is clamped [0.6, 1.0] then *100
        assert.ok(out.scores.adjusted >= 0 && out.scores.adjusted <= 100);
    });
});

describe('buildA11ySummary: structural confidence proxy (confidenceByDom)', () => {
    const baseDom = { totalElements: 1000, semanticRatio: 0.5, coverageRatio: 0.5, customControlsRatio: 0, hiddenRatio: 0, depthMax: 10, statefulComponentsCount: 0 };

    test('domMetrics.capped reduces confidence', () => {
        const capped = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, capped: true } });
        const notCapped = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, capped: false } });
        assert.ok(capped.scores.confidenceByDom < notCapped.scores.confidenceByDom);
    });

    test('shadowHostCount > 0 reduces confidence', () => {
        const withShadow = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, shadowHostCount: 3 } });
        const without = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, shadowHostCount: 0 } });
        assert.ok(withShadow.scores.confidenceByDom < without.scores.confidenceByDom);
    });

    test('customControlsRatio at/above the def-driven 0.40 "warn" threshold (dom.customControlsRatio in METRIC_DEFS) reduces confidence', () => {
        const many = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, customControlsRatio: 2 } });
        const few = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, customControlsRatio: 0.1 } });
        assert.ok(many.scores.confidenceByDom < few.scores.confidenceByDom);
    });

    test('low coverageRatio (below the 0.15 "warn" threshold) reduces confidence', () => {
        const low = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, coverageRatio: 0.05 } });
        const high = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, coverageRatio: 0.5 } });
        assert.ok(low.scores.confidenceByDom < high.scores.confidenceByDom);
    });

    test('high hiddenRatio (at/above the 0.30 "warn" threshold) reduces confidence', () => {
        const high = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, hiddenRatio: 0.5 } });
        const low = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, hiddenRatio: 0.1 } });
        assert.ok(high.scores.confidenceByDom < low.scores.confidenceByDom);
    });

    test('statefulComponentsCount at/above the 15 "warn" threshold reduces confidence', () => {
        const many = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, statefulComponentsCount: 20 } });
        const few = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { ...baseDom, statefulComponentsCount: 2 } });
        assert.ok(many.scores.confidenceByDom < few.scores.confidenceByDom);
    });

    test('icon-only links/buttons (high NoTextNoName rate, above volume threshold) reduce confidence', () => {
        const iconOnlyLinks = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: baseDom,
            textMetrics: { links: { linksPer1k: 100, linksNoTextNoNameSignalRate: 0.5 } }
        });
        const namedLinks = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: baseDom,
            textMetrics: { links: { linksPer1k: 100, linksNoTextNoNameSignalRate: 0 } }
        });
        assert.ok(iconOnlyLinks.scores.confidenceByDom < namedLinks.scores.confidenceByDom);
    });

    test('the high-icon-only-rate penalty does not apply below the volume threshold (linksPer1k <= 60)', () => {
        const lowVolumeIconOnly = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: baseDom,
            textMetrics: { links: { linksPer1k: 10, linksNoTextNoNameSignalRate: 1 } }
        });
        const baseline = buildA11ySummary({ canonical: { findings: [] }, domMetrics: baseDom });
        assert.equal(lowVolumeIconOnly.scores.confidenceByDom, baseline.scores.confidenceByDom);
    });

    test('confidence never drops below the 0.6 floor even with every penalty stacked', () => {
        const out = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: {
                ...baseDom, coverageRatio: 0, hiddenRatio: 1, statefulComponentsCount: 999,
                customControlsRatio: 5, shadowHostCount: 10, capped: true
            },
            textMetrics: {
                links: { linksPer1k: 999, linksNoTextNoNameSignalRate: 1 },
                buttons: { buttonsPer1k: 999, buttonsNoTextNoNameSignalRate: 1, buttonsNoVisibleTextRate: 1 }
            }
        });
        assert.equal(out.scores.confidenceByDom, 60);
    });

    test('confidence still discriminates between "most signals" and "every signal" stacked, instead of both saturating to the same floor', () => {
        // Same as the "every penalty stacked" case above, but leaving the three
        // icon-only-control signals unset so 8 of 11 penalties fire instead of all 11.
        const mostSignals = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: {
                ...baseDom, coverageRatio: 0, hiddenRatio: 1, statefulComponentsCount: 999,
                customControlsRatio: 5, shadowHostCount: 10, capped: true
            },
            textMetrics: {
                links: { linksPer1k: 999, linksNoTextNoNameSignalRate: 0 },
                buttons: { buttonsPer1k: 999, buttonsNoTextNoNameSignalRate: 0, buttonsNoVisibleTextRate: 0 }
            }
        });
        const everySignal = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: {
                ...baseDom, coverageRatio: 0, hiddenRatio: 1, statefulComponentsCount: 999,
                customControlsRatio: 5, shadowHostCount: 10, capped: true
            },
            textMetrics: {
                links: { linksPer1k: 999, linksNoTextNoNameSignalRate: 1 },
                buttons: { buttonsPer1k: 999, buttonsNoTextNoNameSignalRate: 1, buttonsNoVisibleTextRate: 1 }
            }
        });
        assert.ok(mostSignals.scores.confidenceByDom > 60, 'partial stacking should not already sit at the floor');
        assert.equal(everySignal.scores.confidenceByDom, 60);
        assert.ok(mostSignals.scores.confidenceByDom > everySignal.scores.confidenceByDom);
    });
});

describe('buildA11ySummary: adjusted score composition', () => {
    test('with no measured confidence there is no uncertainty to apply, so adjusted equals evidence', () => {
        const out = buildA11ySummary({
            canonical: { findings: [finding('fail', 'serious')] },
            domMetrics: { totalElements: 500, hiddenRatio: 0.5, coverageRatio: 0.5, statefulComponentsCount: 0 }
        });
        assert.equal(out.scores.confidence, null);
        assert.ok(Math.abs(out.scores.adjusted - out.scores.evidence) <= 1);
    });

    test('measured confidence inflates the risk the headline is derived from', () => {
        const scored = (confidence) => buildA11ySummary({
            canonical: { findings: [{ outcome: 'fail', severity: 'serious', confidence, occurrences: [{}] }] },
            domMetrics: { totalElements: 500, counts: { evaluable: 100 } }
        });
        const sure = scored(0.95);
        const unsure = scored(0.4);
        assert.equal(sure.scores.evidence, unsure.scores.evidence);
        assert.ok(unsure.scores.adjusted < sure.scores.adjusted);
    });

    test('avgPageAccessibility mirrors adjusted for a single summary', () => {
        const out = buildA11ySummary({ canonical: { findings: [finding('fail', 'moderate')] }, domMetrics: { totalElements: 300 } });
        assert.equal(out.scores.avgPageAccessibility, out.scores.adjusted);
    });
});

describe('buildA11ySummary: the headline is normalized by content, not DOM size', () => {
    const canonical = { findings: [finding('fail', 'serious', 4), finding('cantTell', 'moderate', 2)] };
    const counts = { evaluable: 120, focusable: 60, interactiveNative: 55, customControls: 5 };
    const textMetrics = { totals: { visibleTextChars: 4000 } };

    test('DOM bloat alone moves the superseded score but leaves the headline untouched', () => {
        const lean = buildA11ySummary({ canonical, domMetrics: { totalElements: 800, counts, textMetrics } });
        const bloated = buildA11ySummary({ canonical, domMetrics: { totalElements: 8000, counts, textMetrics } });

        assert.ok(bloated.scores.evidenceByDom > lean.scores.evidenceByDom, 'the old model rewarded bloat');
        assert.equal(bloated.scores.evidence, lean.scores.evidence);
        assert.equal(bloated.scores.adjusted, lean.scores.adjusted);
    });

    test('adding real defects still lowers the headline', () => {
        const domMetrics = { totalElements: 800, counts, textMetrics };
        const few = buildA11ySummary({ canonical: { findings: [finding('fail', 'minor', 1)] }, domMetrics });
        const many = buildA11ySummary({
            canonical: { findings: [finding('fail', 'critical', 20), finding('fail', 'serious', 15)] },
            domMetrics
        });
        assert.ok(many.scores.adjusted < few.scores.adjusted);
    });

    test('growing the evaluable surface lowers density for the same defects', () => {
        const small = buildA11ySummary({ canonical, domMetrics: { totalElements: 800, counts: { ...counts, evaluable: 20 }, textMetrics } });
        const large = buildA11ySummary({ canonical, domMetrics: { totalElements: 800, counts: { ...counts, evaluable: 400 }, textMetrics } });
        assert.ok(large.inputs.depthPerContentUnit.violationsWeighted < small.inputs.depthPerContentUnit.violationsWeighted);
    });

    test('contentUnits reports the units it derived and which one it normalized by', () => {
        const out = buildA11ySummary({ canonical, domMetrics: { totalElements: 800, counts, textMetrics } });
        assert.deepEqual(out.inputs.contentUnits, {
            evaluable: 120,
            focusable: 60,
            interactive: 60,
            visibleWords: 800,
            primary: 'evaluable',
            primarySize: 120
        });
    });

    test('falls back to interactive controls, then to words, then to a safe unit', () => {
        const dm = (c, tm) => ({ totalElements: 800, counts: c, textMetrics: tm });

        const viaInteractive = buildA11ySummary({ canonical, domMetrics: dm({ evaluable: 0, interactiveNative: 12, customControls: 3 }, textMetrics) });
        assert.equal(viaInteractive.inputs.contentUnits.primary, 'interactive');
        assert.equal(viaInteractive.inputs.contentUnits.primarySize, 15);

        const viaWords = buildA11ySummary({ canonical, domMetrics: dm({ evaluable: 0 }, textMetrics) });
        assert.equal(viaWords.inputs.contentUnits.primary, 'words100');
        assert.equal(viaWords.inputs.contentUnits.primarySize, 8);

        const viaNothing = buildA11ySummary({ canonical, domMetrics: dm({}, null) });
        assert.equal(viaNothing.inputs.contentUnits.primary, 'none');
        assert.ok(Number.isFinite(viaNothing.scores.adjusted));
    });

    test('a clean page scores a maximal headline', () => {
        const out = buildA11ySummary({ canonical: { findings: [] }, domMetrics: { totalElements: 800, counts, textMetrics } });
        assert.equal(out.scores.evidence, 100);
        assert.equal(out.scores.adjusted, 100);
    });

    test('the superseded DOM-normalized model is still reported for comparison', () => {
        const out = buildA11ySummary({ canonical, domMetrics: { totalElements: 800, counts, textMetrics } });
        for (const key of ['evidenceByDom', 'confidenceByDom', 'adjustedByDom']) {
            assert.ok(Number.isFinite(out.scores[key]), `${key} should be reported`);
        }
        assert.ok(Number.isFinite(out.inputs.risk.engineClamped));
        assert.ok(Number.isFinite(out.inputs.risk.contentClamped));
    });
});

describe('buildA11ySummary: reliability drives the headline', () => {
    const counts = { evaluable: 100 };

    function scored(outcome, confidence, severity = 'serious', occ = 1) {
        return { outcome, severity, confidence, occurrences: Array.from({ length: occ }, () => ({})) };
    }

    function run(findings) {
        return buildA11ySummary({ canonical: { findings }, domMetrics: { totalElements: 800, counts } });
    }

    test('the engine confidence of the findings a verdict rests on becomes the reported confidence', () => {
        const out = run([scored('fail', 0.9), scored('cantTell', 0.7)]);
        assert.equal(out.scores.confidence, 80);
        assert.equal(out.scores.confidenceSource, 'engine');
    });

    test('pass and notApplicable findings do not drag the measured confidence around', () => {
        const out = run([scored('fail', 0.9), scored('pass', 0.1), scored('notApplicable', 0.1)]);
        assert.equal(out.scores.confidence, 90);
    });

    test('the structural proxy never stands in for confidence, because it rates the DOM and not the findings', () => {
        const noConfidence = run([{ outcome: 'fail', severity: 'serious', occurrences: [{}] }]);
        assert.equal(noConfidence.scores.confidenceSource, 'notMeasured');
        assert.equal(noConfidence.scores.confidence, null);
        assert.ok(Number.isFinite(noConfidence.scores.confidenceByDom), 'still reported separately');

        const clean = run([]);
        assert.equal(clean.scores.confidence, null);
        assert.equal(clean.scores.confidenceSource, 'notMeasured');
    });

    test('out-of-range confidences are ignored rather than skewing the mean', () => {
        const out = run([scored('fail', 0.8), scored('fail', 42), scored('fail', -1), scored('fail', NaN)]);
        assert.equal(out.scores.confidence, 80);
    });

    test('low confidence amplifies measured risk instead of scaling the whole score', () => {
        const sure = run([scored('fail', 0.95, 'serious', 5)]);
        const unsure = run([scored('fail', 0.4, 'serious', 5)]);

        assert.equal(sure.scores.evidence, unsure.scores.evidence, 'the same defects carry the same risk');
        assert.ok(unsure.scores.adjusted < sure.scores.adjusted, 'uncertainty costs the headline');
        assert.equal(Math.round(unsure.inputs.risk.uncertaintyAdjusted), 100 - unsure.scores.adjusted);
    });

    test('a page with almost no risk is not punished for the engine being unsure about the little it found', () => {
        const out = run([scored('cantTell', 0.4, 'minor', 1)]);
        assert.ok(out.scores.adjusted >= 95, `expected a near-clean headline, got ${out.scores.adjusted}`);
    });

    test('uncertainty about nothing cannot move the headline at all', () => {
        const clean = buildA11ySummary({
            canonical: { findings: [] },
            domMetrics: { totalElements: 800, counts, coverageRatio: 0, hiddenRatio: 1, capped: true, shadowHostCount: 3 }
        });
        assert.ok(clean.scores.confidence < 100, 'the structural proxy should be penalized here');
        assert.equal(clean.scores.adjusted, 100);
    });

    test('manualReviewNeeded uses the shared confidence band rather than its own threshold', () => {
        // 0.74 falls in the def's "bad" band (<75); 0.80 does not.
        assert.equal(run([scored('fail', 0.74)]).flags.manualReviewNeeded, true);
        assert.equal(run([scored('fail', 0.80)]).flags.manualReviewNeeded, false);
    });
});

/**
 * Engines disagree about whether a check carries a confidence at all: one may
 * stamp a flat 1.0 on everything, surea11y maps its own high/medium/low, and
 * another may report none. A run of several engines therefore mixes findings
 * that carry one with findings that do not, and the mean has to say how much of
 * the evidence it actually speaks for.
 */
describe('buildA11ySummary: confidence measured over only part of the evidence', () => {
    const dom = {
        totalElements: 2000,
        counts: { evaluable: 500 },
        coverageRatio: 0.35,
        textMetrics: { totals: { visibleTextChars: 12000 }, links: {}, buttons: {} }
    };

    const fails = (count, confidence) => Array.from({ length: count }, () => ({
        outcome: 'fail',
        severity: 'moderate',
        ...(confidence == null ? {} : { confidence }),
        occurrences: [{}, {}]
    }));

    const summarize = (findings) => buildA11ySummary({ canonical: { findings }, domMetrics: dom });

    test('every verdict carrying a confidence reads as engine-measured, at full coverage', () => {
        const out = summarize(fails(6, 1));
        assert.equal(out.scores.confidence, 100);
        assert.equal(out.scores.confidenceCoverage, 100);
        assert.equal(out.scores.confidenceSource, 'engine');
    });

    test('no verdict carrying one is still not measured, and the proxy does not stand in', () => {
        const out = summarize(fails(6, null));
        assert.equal(out.scores.confidence, null);
        assert.equal(out.scores.confidenceCoverage, null);
        assert.equal(out.scores.confidenceSource, 'notMeasured');
    });

    test('some verdicts carrying one reads as partial, with the share it covers', () => {
        const out = summarize([...fails(3, 0.4), ...fails(3, null)]);
        assert.equal(out.scores.confidence, 40);
        assert.equal(out.scores.confidenceCoverage, 50);
        assert.equal(out.scores.confidenceSource, 'partial');
    });

    test('one engine\'s full confidence does not speak for another engine\'s unmeasured findings', () => {
        // One engine contributes a single finding at 1.0, another twenty with no
        // confidence at all. Reporting "engine" at 100 here claimed the
        // whole run was certain on the strength of one finding out of twenty-one.
        const out = summarize([...fails(1, 1), ...fails(20, null)]);
        assert.equal(out.scores.confidenceSource, 'partial');
        assert.equal(out.scores.confidenceCoverage, 5);
    });

    test('uncertainty is amplified only over the evidence it was measured on', () => {
        const half = summarize([...fails(3, 0.4), ...fails(3, null)]);
        const all = summarize(fails(6, 0.4));
        const none = summarize(fails(6, null));

        // Same measured mean, but the half-covered run is not penalised as though
        // that mean described findings it never saw.
        assert.equal(half.scores.confidence, all.scores.confidence);
        assert.ok(half.scores.adjusted > all.scores.adjusted);
        assert.ok(half.scores.adjusted < none.scores.adjusted);
    });

    test('a single-engine run is scored exactly as it was before coverage was tracked', () => {
        // Every engine either stamps a confidence on all of its findings or on
        // none, so a single-engine run is always at coverage 1 or 0 - the two
        // endpoints where the weighting is the identity.
        // Stated as the endpoint property rather than by restating the composition:
        // at full coverage the measured confidence applies undiluted, so an uncertain
        // run scores below its evidence; at zero coverage nothing is applied at all.
        const allMeasured = summarize(fails(5, 0.75));
        assert.equal(allMeasured.scores.confidenceCoverage, 100);
        assert.ok(allMeasured.scores.adjusted < allMeasured.scores.evidence);

        const certain = summarize(fails(5, 1));
        assert.equal(certain.scores.adjusted, certain.scores.evidence);

        const noneMeasured = summarize(fails(5, null));
        assert.equal(noneMeasured.scores.adjusted, noneMeasured.scores.evidence);
    });

    test('passes and notApplicable findings are not part of the denominator', () => {
        const out = summarize([
            ...fails(2, 0.5),
            { outcome: 'pass', severity: 'minor', occurrences: [] },
            { outcome: 'notApplicable', severity: 'minor', occurrences: [] }
        ]);
        assert.equal(out.scores.confidenceCoverage, 100);
        assert.equal(out.scores.confidenceSource, 'engine');
    });

    test('cantTell verdicts count toward the denominator, since a verdict rests on them', () => {
        const out = summarize([
            ...fails(2, 0.8),
            { outcome: 'cantTell', severity: 'moderate', occurrences: [{}] }
        ]);
        assert.equal(out.scores.confidenceCoverage, 67);
        assert.equal(out.scores.confidenceSource, 'partial');
    });
});

/**
 * The floor of the scale has to mean "measured as bad", not "ran out of scale". The
 * multiplicative inflation overshot 100 and was clipped, so every page past the
 * ceiling reported exactly 0 - a page with two failing rules on a small page landed
 * on the same number as a page with fifty.
 */
describe('buildA11ySummary: uncertainty never manufactures a zero', () => {
    const dom = (evaluable) => ({
        totalElements: evaluable * 10,
        counts: { evaluable },
        coverageRatio: 0.35,
        textMetrics: { totals: { visibleTextChars: 12000 }, links: {}, buttons: {} }
    });

    const fails = (count, confidence, occ = 2) => Array.from({ length: count }, () => ({
        outcome: 'fail',
        severity: 'critical',
        confidence,
        occurrences: Array.from({ length: occ }, () => ({}))
    }));

    const score = (findings, evaluable = 200) =>
        buildA11ySummary({ canonical: { findings }, domMetrics: dom(evaluable) }).scores;

    test('a run whose inflated risk used to overshoot the ceiling still reports a reading', () => {
        const out = score(fails(30, 0.4, 8));
        assert.ok(out.adjusted > 0, `expected a reading above the floor, got ${out.adjusted}`);
    });

    test('worse pages still score lower - the ordering survives past the old ceiling', () => {
        const bad = score(fails(20, 0.4, 6));
        const worse = score(fails(60, 0.4, 20));
        assert.ok(worse.adjusted <= bad.adjusted);
        // and they are not both flattened onto the same floor
        assert.ok(bad.adjusted > 0);
    });

    test('lower confidence always costs, and never more than the headroom', () => {
        const certain = score(fails(12, 1));
        const unsure = score(fails(12, 0.4));

        assert.ok(unsure.adjusted < certain.adjusted);
        assert.ok(unsure.adjusted >= 0);
    });

    test('full confidence leaves the evidence untouched, at any risk', () => {
        for (const n of [1, 5, 20, 60]) {
            const out = score(fails(n, 1));
            assert.equal(out.adjusted, out.evidence, `mismatch at ${n} findings`);
        }
    });

    test('a page with nothing found is not penalised for uncertainty about nothing', () => {
        const out = score([]);
        assert.equal(out.evidence, 100);
        assert.equal(out.adjusted, 100);
    });

    test('the penalty stays proportional to the risk, so a near-clean page barely moves', () => {
        // One minor unresolved check at low confidence: there is a little risk, so a
        // little uncertainty - not the flat hit a whole-score multiplier would apply.
        const out = score([{ outcome: 'cantTell', severity: 'minor', confidence: 0.4, occurrences: [] }]);
        const risk = 100 - out.evidence;

        assert.ok(risk <= 5, `expected a near-clean page, got risk ${risk}`);
        assert.ok(out.evidence - out.adjusted <= risk, 'the loss must not exceed the measured risk');
    });
});

/**
 * Depth is reported per 100 evaluable elements, so on a page with a handful of them a
 * single finding is extrapolated into a density that saturates the curve. The findings
 * are real; the density is not measurable at that size.
 */
describe('buildA11ySummary: pages too thin to carry a density', () => {
    const thinPage = {
        totalElements: 146,
        counts: { evaluable: 12, focusable: 7, interactiveNative: 7 },
        coverageRatio: 0.088,
        hiddenRatio: 0.46,
        textMetrics: { totals: { visibleTextChars: 145 }, links: {}, buttons: {} }
    };

    const twoFailures = {
        findings: [
            { outcome: 'fail', severity: 'critical', occurrences: [{}] },
            { outcome: 'fail', severity: 'serious', occurrences: [{}] }
        ]
    };

    const coverage = { coverage: { criteriaEvaluated: 20, criteriaInScope: 55 } };

    test('the score is withheld rather than reported off a denominator of twelve', () => {
        const out = buildA11ySummary({ canonical: twoFailures, domMetrics: thinPage, coverageSummary: coverage });

        assert.equal(out.scores.evaluationState, 'notMeasurable');
        assert.equal(out.scores.adjusted, null);
        assert.equal(out.scores.avgPageAccessibility, null);
        assert.equal(out.scores.evidence, null);
    });

    test('what was actually found is still reported - only the density is withheld', () => {
        const out = buildA11ySummary({ canonical: twoFailures, domMetrics: thinPage, coverageSummary: coverage });

        assert.equal(out.inputs.engine.violations, 2);
        assert.equal(out.scores.criteriaEvaluated, 20);
        assert.equal(out.scores.criteriaInScope, 55);
    });

    test('the same findings on a page with enough content are scored normally', () => {
        const out = buildA11ySummary({
            canonical: twoFailures,
            domMetrics: { ...thinPage, totalElements: 2400, counts: { evaluable: 520 } },
            coverageSummary: coverage
        });

        assert.equal(out.scores.evaluationState, 'evaluated');
        assert.ok(out.scores.adjusted > 50, `two findings over 520 elements should score well, got ${out.scores.adjusted}`);
    });

    test('a content size that was never established is not treated as a small page', () => {
        // No counts and no text: the size is unknown, which is not the same as thin.
        const out = buildA11ySummary({
            canonical: twoFailures,
            domMetrics: { totalElements: 500 },
            coverageSummary: coverage
        });

        assert.notEqual(out.scores.evaluationState, 'notMeasurable');
        assert.ok(Number.isFinite(out.scores.adjusted));
    });
});

/**
 * `Number(null)` is 0, so a coverage figure that was never established passed a
 * finiteness check as a hard zero - which is how an engine whose rule catalog was
 * unavailable reported "10 of 0 criteria" instead of "of an unknown scope".
 */
describe('buildA11ySummary: an unestablished coverage figure is unknown, not zero', () => {
    const dom = { totalElements: 2400, counts: { evaluable: 520 }, textMetrics: { totals: { visibleTextChars: 12000 }, links: {}, buttons: {} } };
    const canonical = { findings: [{ outcome: 'fail', severity: 'moderate', occurrences: [{}] }] };

    test('a null criteriaInScope stays null instead of collapsing to 0', () => {
        const out = buildA11ySummary({
            canonical,
            domMetrics: dom,
            coverageSummary: { coverage: { criteriaEvaluated: 10, criteriaInScope: null } }
        });

        assert.equal(out.scores.criteriaInScope, null);
        assert.equal(out.scores.criteriaEvaluated, 10);
    });

    test('a null criteriaEvaluated does not gate the score shut as if nothing concluded', () => {
        const out = buildA11ySummary({
            canonical,
            domMetrics: dom,
            coverageSummary: { coverage: { criteriaEvaluated: null, criteriaInScope: 55 } }
        });

        assert.equal(out.scores.evaluationState, 'unknown');
        assert.ok(Number.isFinite(out.scores.adjusted));
    });
});

describe('buildA11ySummary: questions that lean fail', () => {
    test('counts the incomplete checks\' questions whose evidence leans fail', () => {
        const canonical = { findings: [
            { outcome: 'cantTell', severity: 'minor', occurrences: [{ lean: { toward: 'fail' } }, { lean: { toward: 'pass' } }, {}] },
            { outcome: 'cantTell', severity: 'serious', occurrences: [{ lean: { toward: 'fail' } }] },
            { outcome: 'fail', severity: 'serious', occurrences: [{ lean: { toward: 'fail' } }] },
        ] };
        const out = buildA11ySummary({ canonical, domMetrics: null, textMetrics: null });
        assert.equal(out.inputs.engine.incomplete, 2);
        assert.equal(out.inputs.engine.incompleteLikelyFail, 2);
    });
});
