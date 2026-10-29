'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { levelOnlySelectionNotice, levelOnlySelection } = require('./selection-scope');

const sel = (version, level, profile = null) => ({ version, level, profile, bestPractices: false });

describe('levelOnlySelectionNotice', () => {
    test('notes a selection of an earlier WCAG version for an engine that selects by level', () => {
        const n = levelOnlySelectionNotice({ engineId: 'pa11y-htmlcs', engineName: 'Pa11y (HTML_CodeSniffer)', selection: sel('2.1', 'AA') });
        assert.equal(n.engineId, 'pa11y-htmlcs');
        assert.equal(n.code, 'level-only-selection');
        assert.equal(n.message, 'Pa11y (HTML_CodeSniffer) selects by WCAG level only, so it ran its Level A and AA checks for every '
            + 'WCAG version it covers, not only WCAG 2.1 AA as this scan asked. Some of its findings can be outside that selection.');
    });

    test('names a standard with the WCAG version it restates', () => {
        const n = levelOnlySelectionNotice({ engineId: 'alfa', engineName: 'Alfa', selection: sel('2.1', 'AA', 'en301549-v3.2.1') });
        assert.match(n.message, /not only EN 301 549 V3\.2\.1 \(WCAG 2\.1 AA\) as/);
        const a = levelOnlySelectionNotice({ engineId: 'qualweb', selection: sel('2.0', 'A') });
        assert.match(a.message, /^qualweb selects .* its Level A checks/);
    });

    test('says nothing for WCAG 2.2, no selection, or an engine that selects by version', () => {
        assert.equal(levelOnlySelectionNotice({ engineId: 'qualweb-act', selection: sel('2.2', 'AA') }), null);
        assert.equal(levelOnlySelectionNotice({ engineId: 'alfa', selection: null }), null);
        for (const engineId of ['surea11y', 'axe', 'qualweb-bp']) {
            assert.equal(levelOnlySelectionNotice({ engineId, selection: sel('2.1', 'AA') }), null, engineId);
        }
    });
});

describe('levelOnlySelection', () => {
    test('the selection\'s level and best-practice switch', () => {
        assert.deepEqual(levelOnlySelection({ selection: { version: '2.0', level: 'A', profile: null, bestPractices: true } }),
            { level: 'A', bestPractices: true });
    });

    test('from a caller\'s WCAG tags and level when it gives no selection, else nothing', () => {
        assert.deepEqual(levelOnlySelection({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag21aa', 'best-practice'] } }),
            { level: 'AA', bestPractices: true });
        assert.deepEqual(levelOnlySelection({ runOnly: { tags: ['wcag2aa'] }, wcagLevel: 'AAA' }), { level: 'AAA', bestPractices: false });
        assert.deepEqual(levelOnlySelection({ engineOptions: { profile: 'en301549-v3.2.1' } }), { level: 'AA', bestPractices: false });
        assert.deepEqual(levelOnlySelection({ runOnly: { tags: ['best-practice'] } }), { level: null, bestPractices: false });
        assert.deepEqual(levelOnlySelection({ selection: null }), { level: null, bestPractices: false });
    });
});
