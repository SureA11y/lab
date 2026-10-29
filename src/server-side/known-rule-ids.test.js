'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const a11yEngine = require('./a11y-engine');
const { MORE_ENGINES_SKIP } = require('../test-support/more-engines');

describe('getKnownRuleIds', () => {
    test('lists surea11y\'s checks, rollups and prefixed ids', () => {
        const [sa] = a11yEngine.getKnownRuleIds('surea11y').engines;
        assert.equal(sa.id, 'surea11y');
        for (const id of ['img-alt-present', 'wcag-1.1.1-non-text-content', 'a11ycore-img-alt-present']) {
            assert.ok(sa.ruleIds.includes(id), id);
        }
    });

    test('lists each selected engine, and null for one that publishes no rules', { skip: MORE_ENGINES_SKIP }, () => {
        const engines = a11yEngine.getKnownRuleIds('surea11y,axe,alfa').engines;
        assert.deepEqual(engines.map((e) => e.id), ['surea11y', 'axe', 'alfa']);
        assert.ok(engines[1].ruleIds.includes('color-contrast'));
        assert.equal(engines[2].ruleIds, null);
    });

    test('uses the default engine without a selection', () => {
        assert.equal(a11yEngine.getKnownRuleIds().engines.length, 1);
    });
});
