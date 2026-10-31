'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildCoverageAwareSummary, STATUS, VERIFICATION } = require('./coverage-summary');

function atomic({ ruleId, sc = [], outcome = 'pass', confidence = 0.95, type = 'automatic', occurrences = [], level = null }) {
    return {
        id: ruleId,
        ruleId,
        outcome,
        confidence,
        type,
        occurrences,
        wcag: { sc, scNormative: sc },
        standards: {
            normativeMappings: sc.map((s) => ({ standard: 'WCAG', requirement: s, conformanceLevel: level })),
            informativeReferences: []
        }
    };
}

function composite({ ruleId, sc = [], outcome = 'pass', contributors = [], confidence = 0.75, occurrences = [], level = null }) {
    return {
        id: ruleId,
        ruleId,
        outcome,
        confidence,
        type: 'automatic',
        occurrences,
        wcag: { sc, scNormative: sc },
        standards: {
            normativeMappings: sc.map((s) => ({ standard: 'WCAG', requirement: s, conformanceLevel: level })),
            informativeReferences: []
        },
        evidence: { rollup: { reasonCode: 'composite.rollup', checksIds: contributors.map(c => c.testId), contributors } }
    };
}

function scOf(summary, sc) {
    return summary.criteria.find((c) => c.sc === sc);
}

describe('buildCoverageAwareSummary: layer selection', () => {
    test('defaults to the composite layer when composites are present', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'check-a', sc: ['1.1.1'] }),
                composite({ ruleId: 'sc-1.1.1', sc: ['1.1.1'], contributors: [{ testId: 'check-a', outcome: 'pass' }] })
            ]
        };
        assert.equal(buildCoverageAwareSummary({ canonical }).layer, 'composite');
    });

    test('falls back to the atomic layer when the run carried no composites', () => {
        const canonical = { findings: [atomic({ ruleId: 'check-a', sc: ['1.1.1'] })] };
        assert.equal(buildCoverageAwareSummary({ canonical }).layer, 'atomic');
    });

    test('an explicit layer overrides the default', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'check-a', sc: ['1.1.1'] }),
                composite({ ruleId: 'sc-1.1.1', sc: ['1.1.1'], contributors: [{ testId: 'check-a', outcome: 'pass' }] })
            ]
        };
        assert.equal(buildCoverageAwareSummary({ canonical, layer: 'atomic' }).layer, 'atomic');
    });

    test('the two layers are never summed: one atomic under one composite counts once, not twice', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'check-a', sc: ['1.1.1'], outcome: 'fail' }),
                composite({ ruleId: 'sc-1.1.1', sc: ['1.1.1'], outcome: 'fail', contributors: [{ testId: 'check-a', outcome: 'fail' }] })
            ]
        };
        const out = buildCoverageAwareSummary({ canonical });
        assert.equal(scOf(out, '1.1.1').checks.total, 1);
        assert.equal(scOf(out, '1.1.1').checks.fail, 1);
    });

    test('findingsByKind is used when it holds real findings, and ignored when it holds serialized back-references', () => {
        const a = atomic({ ruleId: 'check-a', sc: ['1.1.1'] });
        const c = composite({ ruleId: 'sc-1.1.1', sc: ['1.1.1'], contributors: [{ testId: 'check-a', outcome: 'pass' }] });

        const usable = buildCoverageAwareSummary({ canonical: { findings: [a, c], findingsByKind: { composite: [c], atomic: [a] } } });
        assert.equal(usable.layer, 'composite');
        assert.equal(scOf(usable, '1.1.1').checks.pass, 1);

        const circular = buildCoverageAwareSummary({ canonical: { findings: [a, c], findingsByKind: { composite: ['[Circular]'], atomic: ['[Circular]'] } } });
        assert.equal(circular.layer, 'composite');
        assert.equal(scOf(circular, '1.1.1').checks.pass, 1);
    });
});

describe('buildCoverageAwareSummary: per-criterion status', () => {
    function statusFor(contributors) {
        const canonical = {
            findings: [composite({ ruleId: 'sc-x', sc: ['1.1.1'], contributors })]
        };
        return scOf(buildCoverageAwareSummary({ canonical }), '1.1.1');
    }

    test('all passing -> supports / verified', () => {
        const e = statusFor([{ testId: 'a', outcome: 'pass' }, { testId: 'b', outcome: 'pass' }]);
        assert.equal(e.status, STATUS.SUPPORTS);
        assert.equal(e.verification, VERIFICATION.VERIFIED);
    });

    test('all failing -> doesNotSupport', () => {
        assert.equal(statusFor([{ testId: 'a', outcome: 'fail' }]).status, STATUS.DOES_NOT_SUPPORT);
    });

    test('a mix of pass and fail -> partiallySupports', () => {
        assert.equal(statusFor([{ testId: 'a', outcome: 'pass' }, { testId: 'b', outcome: 'fail' }]).status, STATUS.PARTIALLY_SUPPORTS);
    });

    test('nothing but notApplicable -> notApplicable / notVerified, never a green "supports"', () => {
        const e = statusFor([{ testId: 'a', outcome: 'notApplicable' }, { testId: 'b', outcome: 'notApplicable' }]);
        assert.equal(e.status, STATUS.NOT_APPLICABLE);
        assert.equal(e.verification, VERIFICATION.NOT_VERIFIED);
    });

    test('nothing but cantTell -> needsReview / notVerified', () => {
        const e = statusFor([{ testId: 'a', outcome: 'cantTell' }]);
        assert.equal(e.status, STATUS.NEEDS_REVIEW);
        assert.equal(e.verification, VERIFICATION.NOT_VERIFIED);
    });

    test('cantTell alongside a conclusive outcome downgrades verification but keeps the verdict', () => {
        const e = statusFor([{ testId: 'a', outcome: 'pass' }, { testId: 'b', outcome: 'cantTell' }]);
        assert.equal(e.status, STATUS.SUPPORTS);
        assert.equal(e.verification, VERIFICATION.PARTIALLY_VERIFIED);
    });

    test('notApplicable checks do not dilute verification when something was actually evaluated', () => {
        const e = statusFor([
            { testId: 'a', outcome: 'pass' },
            { testId: 'b', outcome: 'notApplicable' },
            { testId: 'c', outcome: 'notApplicable' }
        ]);
        assert.equal(e.status, STATUS.SUPPORTS);
        assert.equal(e.verification, VERIFICATION.VERIFIED);
        assert.equal(e.checks.total, 3);
        assert.equal(e.checks.evaluated, 1);
    });

    test('a composite with no contributor breakdown falls back to its own verdict', () => {
        const canonical = { findings: [composite({ ruleId: 'sc-x', sc: ['1.1.1'], outcome: 'fail', contributors: [] })] };
        const e = scOf(buildCoverageAwareSummary({ canonical }), '1.1.1');
        assert.equal(e.checks.total, 1);
        assert.equal(e.status, STATUS.DOES_NOT_SUPPORT);
    });

    test('an unrecognised contributor outcome counts toward the total but is never treated as evaluated', () => {
        const e = statusFor([{ testId: 'a', outcome: 'pass' }, { testId: 'b', outcome: 'bogus' }]);
        assert.equal(e.checks.total, 2);
        assert.equal(e.checks.evaluated, 1);
        assert.equal(e.status, STATUS.SUPPORTS);
    });
});

describe('buildCoverageAwareSummary: criterion metadata', () => {
    test('level is resolved per criterion, so a check spanning two levels labels each correctly', () => {
        const canonical = {
            findings: [{
                ...atomic({ ruleId: 'contrast', sc: ['1.4.3', '1.4.6'] }),
                standards: {
                    normativeMappings: [
                        { standard: 'WCAG', requirement: '1.4.3', conformanceLevel: 'AA' },
                        { standard: 'WCAG', requirement: '1.4.6', conformanceLevel: 'AAA' }
                    ],
                    informativeReferences: []
                }
            }]
        };
        const out = buildCoverageAwareSummary({ canonical });
        assert.equal(scOf(out, '1.4.3').level, 'AA');
        assert.equal(scOf(out, '1.4.6').level, 'AAA');
    });

    test('a composite with no usable level of its own inherits it from a contributor', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'check-a', sc: ['2.4.7'], level: 'AA' }),
                composite({ ruleId: 'sc-2.4.7', sc: ['2.4.7'], contributors: [{ testId: 'check-a', outcome: 'pass' }] })
            ]
        };
        assert.equal(scOf(buildCoverageAwareSummary({ canonical }), '2.4.7').level, 'AA');
    });

    test('scNormative drives attribution, so informative-only criteria are not claimed as tested', () => {
        const canonical = {
            findings: [{
                ...atomic({ ruleId: 'check-a', sc: ['1.1.1'] }),
                wcag: { sc: ['1.1.1', '1.3.1'], scNormative: ['1.1.1'] }
            }]
        };
        const out = buildCoverageAwareSummary({ canonical });
        assert.ok(scOf(out, '1.1.1'));
        assert.equal(scOf(out, '1.3.1'), undefined);
    });

    test('a finding with no scNormative field falls back to sc', () => {
        const canonical = { findings: [{ ...atomic({ ruleId: 'check-a', sc: ['1.1.1'] }), wcag: { sc: ['1.1.1'] } }] };
        assert.ok(scOf(buildCoverageAwareSummary({ canonical }), '1.1.1'));
    });

    test('manual checks are counted so a criterion resting on human review can be flagged', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'auto', sc: ['2.1.1'], outcome: 'pass' }),
                atomic({ ruleId: 'manual', sc: ['2.1.1'], outcome: 'cantTell', type: 'manual' })
            ]
        };
        assert.equal(scOf(buildCoverageAwareSummary({ canonical }), '2.1.1').manualChecks, 1);
    });

    test('confidence averages only the checks that reached a conclusion', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'a', sc: ['1.1.1'], outcome: 'pass', confidence: 0.9 }),
                atomic({ ruleId: 'b', sc: ['1.1.1'], outcome: 'fail', confidence: 0.7 }),
                atomic({ ruleId: 'c', sc: ['1.1.1'], outcome: 'cantTell', confidence: 0.1 })
            ]
        };
        assert.equal(scOf(buildCoverageAwareSummary({ canonical }), '1.1.1').confidence, 0.8);
    });

    test('a criterion with nothing conclusive has a null confidence rather than a fabricated zero', () => {
        const canonical = { findings: [atomic({ ruleId: 'a', sc: ['2.1.1'], outcome: 'cantTell' })] };
        assert.equal(scOf(buildCoverageAwareSummary({ canonical }), '2.1.1').confidence, null);
    });

    test('occurrences are accumulated from the atomic layer under a composite verdict', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'check-a', sc: ['1.4.3'], outcome: 'fail', occurrences: [{ target: ['.a'] }, { target: ['.b'] }] }),
                composite({ ruleId: 'sc-1.4.3', sc: ['1.4.3'], outcome: 'fail', contributors: [{ testId: 'check-a', outcome: 'fail' }] })
            ]
        };
        assert.equal(scOf(buildCoverageAwareSummary({ canonical }), '1.4.3').occurrenceCount, 2);
    });

    test('criteria are sorted numerically, so 1.4.10 follows 1.4.9', () => {
        const canonical = {
            findings: [
                atomic({ ruleId: 'a', sc: ['1.4.10'] }),
                atomic({ ruleId: 'b', sc: ['1.4.9'] }),
                atomic({ ruleId: 'c', sc: ['1.1.1'] })
            ]
        };
        assert.deepEqual(buildCoverageAwareSummary({ canonical }).criteria.map(c => c.sc), ['1.1.1', '1.4.9', '1.4.10']);
    });
});

describe('buildCoverageAwareSummary: rollups', () => {
    const canonical = {
        findings: [
            atomic({ ruleId: 'p1', sc: ['1.1.1'], outcome: 'pass', confidence: 0.9 }),
            atomic({ ruleId: 'f1', sc: ['1.4.3'], outcome: 'fail', confidence: 0.8 }),
            atomic({ ruleId: 'r1', sc: ['2.1.1'], outcome: 'cantTell', type: 'manual' }),
            atomic({ ruleId: 'n1', sc: ['1.2.1'], outcome: 'notApplicable' })
        ]
    };

    test('coverage separates evaluated, needs-review and not-applicable criteria', () => {
        const out = buildCoverageAwareSummary({ canonical });
        assert.equal(out.coverage.criteriaTouched, 4);
        assert.equal(out.coverage.criteriaEvaluated, 2);
        assert.equal(out.coverage.criteriaNeedsReview, 1);
        assert.equal(out.coverage.criteriaNotApplicable, 1);
        assert.equal(out.coverage.evaluatedRatio, 0.5);
    });

    test('verification counts partition the criteria', () => {
        const out = buildCoverageAwareSummary({ canonical });
        const { verified, partiallyVerified, notVerified } = out.coverage;
        assert.equal(verified + partiallyVerified + notVerified, out.criteria.length);
        assert.equal(verified, 2);
        assert.equal(notVerified, 2);
    });

    test('passShareOfEvaluated is measured against what was testable, not against everything', () => {
        const out = buildCoverageAwareSummary({ canonical });
        assert.equal(out.outcome.supports, 1);
        assert.equal(out.outcome.doesNotSupport, 1);
        assert.equal(out.outcome.passShareOfEvaluated, 0.5);
    });

    test('reliability aggregates the per-criterion confidences that exist', () => {
        const out = buildCoverageAwareSummary({ canonical });
        assert.equal(out.reliability.criteriaWithConfidence, 2);
        assert.equal(out.reliability.min, 0.8);
        assert.equal(out.reliability.mean, 0.85);
    });

    test('needsReview lists every criterion with a cantTell, including ones that also concluded', () => {
        const mixed = {
            findings: [
                atomic({ ruleId: 'p', sc: ['2.4.7'], outcome: 'pass' }),
                atomic({ ruleId: 'r', sc: ['2.4.7'], outcome: 'cantTell' }),
                atomic({ ruleId: 'r2', sc: ['2.1.1'], outcome: 'cantTell' })
            ]
        };
        const out = buildCoverageAwareSummary({ canonical: mixed });
        assert.deepEqual(out.needsReview.map(r => r.sc), ['2.1.1', '2.4.7']);
        assert.deepEqual(out.needsReview.find(r => r.sc === '2.4.7').checks, ['r']);
    });
});

describe('buildCoverageAwareSummary: with an automation-coverage denominator', () => {
    const { buildAutomationCoverage } = require('./automation-coverage');

    const automationCoverage = buildAutomationCoverage({
        level: 'AA',
        rules: [
            { ruleId: 'contrast', type: 'automatic', wcag: { scNormative: ['1.4.3'] } },
            { ruleId: 'keyboard-review', type: 'manual', wcag: { scNormative: ['2.1.1'] } }
        ]
    });

    const canonical = { findings: [atomic({ ruleId: 'contrast', sc: ['1.4.3'], outcome: 'fail' })] };

    test('criteria in scope that nothing touched are folded in as notEvaluated', () => {
        const out = buildCoverageAwareSummary({ canonical, automationCoverage });
        assert.equal(out.criteria.length, 55);
        assert.equal(scOf(out, '2.4.5').status, STATUS.NOT_EVALUATED);
        assert.equal(scOf(out, '2.4.5').verification, VERIFICATION.NOT_VERIFIED);
    });

    test('each criterion is labelled with how far automation could ever reach it', () => {
        const out = buildCoverageAwareSummary({ canonical, automationCoverage });
        assert.equal(scOf(out, '1.4.3').automation, 'automatic');
        assert.equal(scOf(out, '2.1.1').automation, 'manualOnly');
        assert.equal(scOf(out, '2.4.5').automation, 'notAutomatable');
    });

    test('criteriaTouched stays the scan-derived count while the scope denominator is reported separately', () => {
        const out = buildCoverageAwareSummary({ canonical, automationCoverage });
        assert.equal(out.coverage.criteriaTouched, 1);
        assert.equal(out.coverage.criteriaInScope, 55);
        assert.equal(out.coverage.criteriaEvaluated, 1);
    });

    test('evaluatedRatio is measured against what was touched, evaluatedRatioOfScope against the conformance target', () => {
        const out = buildCoverageAwareSummary({ canonical, automationCoverage });
        assert.equal(out.coverage.evaluatedRatio, 1);
        assert.equal(out.coverage.evaluatedRatioOfScope, round1000(1 / 55));
    });

    test('the not-automatable tally distinguishes an unreachable criterion from an untested one', () => {
        const out = buildCoverageAwareSummary({ canonical, automationCoverage });
        assert.equal(out.coverage.criteriaNotAutomatable, 53);
        assert.equal(out.coverage.criteriaManualOnly, 1);
        assert.equal(out.coverage.criteriaNotEvaluated, 54);
    });

    test('a criterion found by the scan but outside the target level is still reported, flagged out of scope', () => {
        const aaa = { findings: [atomic({ ruleId: 'enhanced', sc: ['1.4.6'], outcome: 'pass' })] };
        const out = buildCoverageAwareSummary({ canonical: aaa, automationCoverage });
        assert.equal(scOf(out, '1.4.6').inScope, false);
        assert.equal(scOf(out, '1.4.3').inScope, true);
    });

    test('without an automation coverage input the scope fields stay null rather than guessing', () => {
        const out = buildCoverageAwareSummary({ canonical });
        assert.equal(out.coverage.criteriaInScope, null);
        assert.equal(out.coverage.evaluatedRatioOfScope, null);
        assert.equal(scOf(out, '1.4.3').inScope, null);
        assert.equal(scOf(out, '1.4.3').automation, null);
    });

    function round1000(n) {
        return Math.round(n * 1000) / 1000;
    }
});

describe('buildCoverageAwareSummary: degenerate input', () => {
    test('no canonical at all produces a well-formed empty result', () => {
        const out = buildCoverageAwareSummary({});
        assert.deepEqual(out.criteria, []);
        assert.equal(out.coverage.criteriaTouched, 0);
        assert.equal(out.coverage.evaluatedRatio, 0);
        assert.equal(out.outcome.passShareOfEvaluated, null);
        assert.equal(out.reliability.mean, null);
        assert.deepEqual(out.needsReview, []);
    });

    test('called with no arguments at all does not throw', () => {
        assert.equal(buildCoverageAwareSummary().criteria.length, 0);
    });

    test('findings with no WCAG mapping are ignored rather than bucketed under an empty criterion', () => {
        const canonical = { findings: [{ ruleId: 'best-practice', outcome: 'fail', wcag: { sc: [] } }, { ruleId: 'no-wcag', outcome: 'fail' }] };
        assert.deepEqual(buildCoverageAwareSummary({ canonical }).criteria, []);
    });

    test('null entries inside findings are skipped', () => {
        const canonical = { findings: [null, atomic({ ruleId: 'a', sc: ['1.1.1'] }), undefined] };
        assert.equal(buildCoverageAwareSummary({ canonical }).criteria.length, 1);
    });
});

/**
 * A run can use several engines at once, and only some of them model their rules
 * as composites over contributing checks - others may emit atomics only,
 * surea11y emits both. The merged canonical concatenates them, so
 * resolving one layer for the whole set reads every engine through the layer of
 * whichever one emits composites, and drops the rest.
 */
describe('buildCoverageAwareSummary: several engines in one canonical', () => {
    const withEngine = (finding, id) => ({
        ...finding,
        engineId: id,
        provenance: { engine: { id, name: id, version: '1' } }
    });

    const coverageOf = (scs) => ({
        criteria: scs.map((sc) => ({ sc, level: 'AA', automation: 'automatic' }))
    });

    // surea11y: a composite verdict over one contributing atomic.
    const surea11yFindings = [
        withEngine(atomic({ ruleId: 'alt-check', sc: ['1.1.1'] }), 'surea11y'),
        withEngine(composite({
            ruleId: 'sc-1.1.1',
            sc: ['1.1.1'],
            contributors: [{ testId: 'alt-check', outcome: 'pass' }]
        }), 'surea11y')
    ];

    // Another engine: atomics only, one of them failing.
    const otherFindings = [
        withEngine(atomic({ ruleId: 'color-contrast', sc: ['1.4.3'], outcome: 'fail', occurrences: [{}, {}] }), 'engine-b'),
        withEngine(atomic({ ruleId: 'aria-valid-attr', sc: ['4.1.2'], outcome: 'pass' }), 'engine-b')
    ];

    test('an engine that emits no composites still counts when another engine does', () => {
        const merged = buildCoverageAwareSummary({
            canonical: { findings: [...surea11yFindings, ...otherFindings] },
            automationCoverage: coverageOf(['1.1.1', '1.4.3', '4.1.2'])
        });

        // Before the layer was resolved per engine, these were 1 and 1: the other engine's
        // findings were read as contributors to surea11y's composites, matched
        // nothing, and vanished.
        assert.equal(merged.coverage.criteriaTouched, 3);
        assert.equal(merged.coverage.criteriaEvaluated, 3);

        assert.equal(scOf(merged, '1.1.1').status, STATUS.SUPPORTS);
        assert.equal(scOf(merged, '1.4.3').status, STATUS.DOES_NOT_SUPPORT);
        assert.equal(scOf(merged, '4.1.2').status, STATUS.SUPPORTS);
    });

    test("a criterion one engine failed is not reported as clean because another engine passed a different one", () => {
        const merged = buildCoverageAwareSummary({
            canonical: { findings: [...surea11yFindings, ...otherFindings] },
            automationCoverage: coverageOf(['1.1.1', '1.4.3', '4.1.2'])
        });

        assert.equal(merged.outcome.doesNotSupport, 1);
        assert.notEqual(scOf(merged, '1.4.3').status, STATUS.NOT_EVALUATED);
    });

    test('the layer reads as mixed when the engines that ran did not agree on one', () => {
        const merged = buildCoverageAwareSummary({
            canonical: { findings: [...surea11yFindings, ...otherFindings] }
        });
        assert.equal(merged.layer, 'mixed');
    });

    test('engines that all use the same layer still report that layer by name', () => {
        const bothAtomic = buildCoverageAwareSummary({
            canonical: {
                findings: [
                    ...otherFindings,
                    withEngine(atomic({ ruleId: 'html-has-lang', sc: ['3.1.1'] }), 'engine-c')
                ]
            }
        });
        assert.equal(bothAtomic.layer, 'atomic');
    });

    test('a contributor is looked up among its own engine\'s atomics, not another engine\'s', () => {
        // Both engines carry a rule called `alt-check`, with opposite outcomes.
        // surea11y's composite must roll up surea11y's, not the other engine's.
        const collidingOther = withEngine(
            atomic({ ruleId: 'alt-check', sc: ['1.1.1'], outcome: 'fail', occurrences: [{}] }),
            'engine-b'
        );

        const merged = buildCoverageAwareSummary({
            canonical: { findings: [...surea11yFindings, collidingOther] },
            automationCoverage: coverageOf(['1.1.1'])
        });

        // One pass from surea11y's rollup, one fail from the other engine's own atomic layer.
        assert.equal(scOf(merged, '1.1.1').status, STATUS.PARTIALLY_SUPPORTS);
        assert.equal(scOf(merged, '1.1.1').checks.pass, 1);
        assert.equal(scOf(merged, '1.1.1').checks.fail, 1);
    });

    test("a merged canonical carrying the first engine's findingsByKind is not read through it", () => {
        // `mergeCanonicalsByConcatenation` used to spread the base canonical, so
        // the merged object inherited an index listing only that engine's
        // findings. Trusting it read one engine's run as the whole.
        const merged = buildCoverageAwareSummary({
            canonical: {
                findings: [...surea11yFindings, ...otherFindings],
                findingsByKind: {
                    composite: [surea11yFindings[1]],
                    atomic: [surea11yFindings[0]]
                }
            },
            automationCoverage: coverageOf(['1.1.1', '1.4.3', '4.1.2'])
        });

        assert.equal(merged.coverage.criteriaEvaluated, 3);
        assert.equal(scOf(merged, '1.4.3').status, STATUS.DOES_NOT_SUPPORT);
    });

    test('a single-engine canonical is still read through its own findingsByKind', () => {
        const canonical = {
            findings: surea11yFindings,
            findingsByKind: { composite: [surea11yFindings[1]], atomic: [surea11yFindings[0]] }
        };
        assert.equal(buildCoverageAwareSummary({ canonical }).layer, 'composite');
    });

    test('an explicit layer still overrides the per-engine resolution', () => {
        const merged = buildCoverageAwareSummary({
            canonical: { findings: [...surea11yFindings, ...otherFindings] },
            layer: 'atomic',
            automationCoverage: coverageOf(['1.1.1', '1.4.3', '4.1.2'])
        });
        assert.equal(merged.layer, 'atomic');
        // Read as atomics throughout, surea11y's composite no longer rolls up.
        assert.equal(scOf(merged, '1.4.3').status, STATUS.DOES_NOT_SUPPORT);
    });
});

describe('buildCoverageAwareSummary: a scan under a standard\'s profile', () => {
    // Under EN 301 549's profile, or another pack's, a result names the
    // standard's requirement in place of WCAG's criteria; the criterion it
    // restates is its mapping's wcagSc.
    const asClause = (f, clause) => ({
        ...f,
        wcag: { sc: [], scNormative: [] },
        standards: { normativeMappings: f.wcag.sc.map((sc) => ({ standard: 'EN 301 549', version: 'V4.1.1', requirement: clause, wcagSc: [sc] })), informativeReferences: [] },
    });

    test('counts each result under the WCAG criterion its requirement restates, as a WCAG scan would', () => {
        const findings = [
            atomic({ ruleId: 'check-a', sc: ['1.1.1'], outcome: 'fail', occurrences: [{}] }),
            composite({ ruleId: 'sc-1.1.1', sc: ['1.1.1'], outcome: 'fail', contributors: [{ testId: 'check-a', outcome: 'fail' }], occurrences: [{}] }),
        ];
        const wcag = buildCoverageAwareSummary({ canonical: { findings } });
        const en = buildCoverageAwareSummary({ canonical: { findings: findings.map((f) => asClause(f, '9.1.1.1')) } });
        assert.equal(scOf(en, '1.1.1').status, scOf(wcag, '1.1.1').status);
        assert.equal(scOf(en, '1.1.1').status, STATUS.DOES_NOT_SUPPORT || 'doesNotSupport');
    });
});
