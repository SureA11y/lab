'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { axeRunOnly } = require('./axe-engine');

describe('axe-engine: axeRunOnly', () => {
    test('a selection becomes its version/level tags, and best-practice', () => {
        assert.deepEqual(axeRunOnly({ selection: { version: '2.1', level: 'AA', profile: null, bestPractices: true } }), {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
            includeRuleIds: [],
            excludeRuleIds: []
        });
        assert.deepEqual(axeRunOnly({ selection: { version: '2.0', level: 'AA', profile: null, bestPractices: false } }).values,
            ['wcag2a', 'wcag2aa']);
    });

    test('keeps the caller\'s rule ids and other rule tags beside the selection', () => {
        const ro = axeRunOnly({
            selection: { version: '2.2', level: 'A', profile: null, bestPractices: false },
            runOnly: { tags: ['wcag2aaa', 'keyboard'], includeRuleIds: 'image-alt, label', excludeRuleIds: ['region'] }
        });
        assert.deepEqual(ro.values, ['wcag2a', 'wcag21a', 'wcag22a', 'keyboard']);
        assert.deepEqual(ro.includeRuleIds, ['image-alt', 'label']);
        assert.deepEqual(ro.excludeRuleIds, ['region']);
    });

    test('without a selection, WCAG tags and a level make one; with nothing, axe runs as it would', () => {
        assert.deepEqual(axeRunOnly({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag21aa'] }, wcagLevel: 'A' }).values,
            ['wcag2a', 'wcag21a']);
        assert.equal(axeRunOnly({}), null);
        assert.equal(axeRunOnly({ selection: null }), null);
    });
});
