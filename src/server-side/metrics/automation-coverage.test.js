'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildAutomationCoverage, AUTOMATION } = require('./automation-coverage');

function rule({ ruleId, sc = [], type = 'automatic', scNormative = null }) {
    return { ruleId, type, wcag: { sc, scNormative: scNormative === null ? sc : scNormative } };
}

function scOf(cov, sc) {
    return cov.criteria.find((c) => c.sc === sc);
}

describe('buildAutomationCoverage: classification', () => {
    const rules = [
        rule({ ruleId: 'contrast', sc: ['1.4.3'] }),
        rule({ ruleId: 'name-role', sc: ['4.1.2'] }),
        rule({ ruleId: 'focus-order-review', sc: ['2.4.3'], type: 'manual' })
    ];

    test('a criterion with an automatic rule is automatic', () => {
        assert.equal(scOf(buildAutomationCoverage({ rules }), '1.4.3').automation, AUTOMATION.AUTOMATIC);
    });

    test('a criterion reachable only by a manual rule is manualOnly, not automatic', () => {
        const e = scOf(buildAutomationCoverage({ rules }), '2.4.3');
        assert.equal(e.automation, AUTOMATION.MANUAL_ONLY);
        assert.deepEqual(e.manualRuleIds, ['focus-order-review']);
        assert.deepEqual(e.automaticRuleIds, []);
    });

    test('a criterion no rule touches is notAutomatable', () => {
        assert.equal(scOf(buildAutomationCoverage({ rules }), '2.4.5').automation, AUTOMATION.NOT_AUTOMATABLE);
    });

    test('an automatic rule wins over a manual one on the same criterion', () => {
        const mixed = [rule({ ruleId: 'auto', sc: ['2.4.3'] }), rule({ ruleId: 'manual', sc: ['2.4.3'], type: 'manual' })];
        const e = scOf(buildAutomationCoverage({ rules: mixed }), '2.4.3');
        assert.equal(e.automation, AUTOMATION.AUTOMATIC);
        assert.deepEqual(e.automaticRuleIds, ['auto']);
        assert.deepEqual(e.manualRuleIds, ['manual']);
    });

    test('rule ids are de-duplicated and sorted', () => {
        const dupes = [rule({ ruleId: 'b', sc: ['1.4.3'] }), rule({ ruleId: 'a', sc: ['1.4.3'] }), rule({ ruleId: 'b', sc: ['1.4.3'] })];
        assert.deepEqual(scOf(buildAutomationCoverage({ rules: dupes }), '1.4.3').automaticRuleIds, ['a', 'b']);
    });

    test('a rule with no explicit type counts as automatic', () => {
        const untyped = [{ ruleId: 'x', wcag: { scNormative: ['1.4.3'] } }];
        assert.equal(scOf(buildAutomationCoverage({ rules: untyped }), '1.4.3').automation, AUTOMATION.AUTOMATIC);
    });

    test('only normative mappings count, so an informative reference never claims coverage', () => {
        const informative = [rule({ ruleId: 'x', sc: ['1.4.3', '1.3.1'], scNormative: ['1.4.3'] })];
        const cov = buildAutomationCoverage({ rules: informative });
        assert.equal(scOf(cov, '1.4.3').automation, AUTOMATION.AUTOMATIC);
        assert.equal(scOf(cov, '1.3.1').automation, AUTOMATION.NOT_AUTOMATABLE);
    });

    test('a rule with no scNormative field falls back to sc', () => {
        const legacy = [{ ruleId: 'x', type: 'automatic', wcag: { sc: ['1.4.3'] } }];
        assert.equal(scOf(buildAutomationCoverage({ rules: legacy }), '1.4.3').automation, AUTOMATION.AUTOMATIC);
    });
});

describe('buildAutomationCoverage: totals and scope', () => {
    const rules = [
        rule({ ruleId: 'contrast', sc: ['1.4.3'] }),
        rule({ ruleId: 'enhanced-contrast', sc: ['1.4.6'] }),
        rule({ ruleId: 'focus-order-review', sc: ['2.4.3'], type: 'manual' })
    ];

    test('totals partition the in-scope criteria', () => {
        const cov = buildAutomationCoverage({ rules });
        const { inScope, automatic, manualOnly, notAutomatable } = cov.totals;
        assert.equal(automatic + manualOnly + notAutomatable, inScope);
        assert.equal(inScope, cov.criteria.length);
    });

    test('byLevel partitions the same criteria per conformance level', () => {
        const cov = buildAutomationCoverage({ rules, level: 'AA' });
        const summed = Object.values(cov.byLevel).reduce((a, b) => a + b.inScope, 0);
        assert.equal(summed, cov.totals.inScope);
        assert.deepEqual(Object.keys(cov.byLevel).sort(), ['A', 'AA']);
    });

    test('a AAA criterion covered by a rule is reported as out of scope under an AA target', () => {
        const cov = buildAutomationCoverage({ rules, level: 'AA' });
        assert.ok(!scOf(cov, '1.4.6'));
        assert.deepEqual(cov.outOfScopeCriteria, [{ sc: '1.4.6', level: 'AAA' }]);
    });

    test('raising the target to AAA pulls that criterion into scope and empties the out-of-scope list', () => {
        const cov = buildAutomationCoverage({ rules, level: 'AAA' });
        assert.equal(scOf(cov, '1.4.6').automation, AUTOMATION.AUTOMATIC);
        assert.deepEqual(cov.outOfScopeCriteria, []);
    });

    test('a criterion outside the WCAG table is reported with a null level rather than dropped', () => {
        const cov = buildAutomationCoverage({ rules: [rule({ ruleId: 'x', sc: ['9.9.9'] })] });
        assert.deepEqual(cov.outOfScopeCriteria, [{ sc: '9.9.9', level: null }]);
    });

    test('scope is echoed back so a consumer can label the denominator', () => {
        assert.deepEqual(buildAutomationCoverage({ rules, level: 'A', version: '2.1' }).scope, { level: 'A', version: '2.1' });
    });

    test('an empty catalog leaves every in-scope criterion notAutomatable', () => {
        const cov = buildAutomationCoverage({ rules: [] });
        assert.equal(cov.totals.automatic, 0);
        assert.equal(cov.totals.notAutomatable, cov.totals.inScope);
        assert.equal(cov.totals.automatableRatio, 0);
    });

    test('missing or null rules do not throw', () => {
        assert.equal(buildAutomationCoverage({}).totals.automatic, 0);
        assert.equal(buildAutomationCoverage().totals.automatic, 0);
        assert.equal(buildAutomationCoverage({ rules: [null, undefined] }).totals.automatic, 0);
    });
});

describe('buildAutomationCoverage: against the real surea11y catalog', () => {
    test('Level AA coverage is a minority of criteria, and the keyboard topic is mostly unreachable', async () => {
        const { getRulesForRunOnly } = require('../engines/a11y-labs-engine');
        const rules = await getRulesForRunOnly({}, null);
        const cov = buildAutomationCoverage({ rules, level: 'AA' });

        assert.equal(cov.totals.inScope, 55);
        assert.ok(cov.totals.automatic > 0, 'the catalog should cover something');
        assert.ok(cov.totals.automatableRatio < 0.5, 'automation should not be claimed for most of WCAG AA');

        // The bucket most prone to reading as a false green.
        const keyboardScs = ['2.1.1', '2.1.2', '2.1.4', '2.4.3', '2.4.7', '2.4.11', '2.5.1', '2.5.2', '2.5.7'];
        const keyboard = cov.criteria.filter((c) => keyboardScs.includes(c.sc));
        const reachable = keyboard.filter((c) => c.automation === AUTOMATION.AUTOMATIC).length;
        assert.ok(reachable < keyboard.length / 2, 'most keyboard criteria are not machine-testable');
    });
});

describe('buildAutomationCoverage: catalogs of several engines together', () => {
    // What a multi-engine run reaches is what its engines reach between them, so
    // the run's coverage is built from their catalogs concatenated. Each engine's
    // own coverage stays its own catalog's - that is what makes reading a
    // two-engine report as one engine match running that engine alone.
    const axeLike = [rule({ ruleId: 'contrast', sc: ['1.4.3'] })];
    const otherLike = [rule({ ruleId: 'name-role', sc: ['4.1.2'] })];

    test('a criterion either engine reaches is reachable by the pair', () => {
        const both = buildAutomationCoverage({ rules: axeLike.concat(otherLike) });
        assert.equal(scOf(both, '1.4.3').automation, AUTOMATION.AUTOMATIC);
        assert.equal(scOf(both, '4.1.2').automation, AUTOMATION.AUTOMATIC);
    });

    test('one engine alone reaches only its own', () => {
        const axeOnly = buildAutomationCoverage({ rules: axeLike });
        assert.equal(scOf(axeOnly, '1.4.3').automation, AUTOMATION.AUTOMATIC);
        assert.equal(scOf(axeOnly, '4.1.2').automation, AUTOMATION.NOT_AUTOMATABLE);
    });

    test('a rule id both engines use collapses to one entry', () => {
        const shared = buildAutomationCoverage({
            rules: [rule({ ruleId: 'contrast', sc: ['1.4.3'] }), rule({ ruleId: 'contrast', sc: ['1.4.3'] })]
        });
        assert.deepEqual(scOf(shared, '1.4.3').automaticRuleIds, ['contrast']);
    });

    test('the criteria in scope come from the conformance level, not the catalogs', () => {
        // So the "in scope" denominator is the same however many engines ran.
        const one = buildAutomationCoverage({ rules: axeLike });
        const both = buildAutomationCoverage({ rules: axeLike.concat(otherLike) });
        assert.equal(one.criteria.length, both.criteria.length);
    });
});
