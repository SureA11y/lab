'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveScanTarget, resolveScanSelection, selectionFromTags, selectionTags, selectionLabel, wcagTags, targetLabel, CONFORMANCE_TARGETS,
    SCAN_TARGETS, DEFAULT_SCAN_TARGET, targetSupported, scanTargetsFor, selectionFromRunOnly,
    splitOutcomeCounts, separateBestPractices
} = require('./conformance-targets');

describe('resolveScanTarget', () => {
    test('a WCAG target is that version and level, and no standard', () => {
        assert.deepEqual(resolveScanTarget({ profile: 'WCAG22-AAA' }), { level: 'AAA', version: '2.2', profile: null });
        assert.deepEqual(resolveScanTarget({ profile: 'wcag22-aa' }), { level: 'AA', version: '2.2', profile: null });
    });

    test('a bare level is not a profile', () => {
        assert.deepEqual(resolveScanTarget({ profile: 'aaa' }), { level: null, version: null, profile: null });
    });

    test('a standard is read as a standard at its version and Level AA', () => {
        assert.deepEqual(resolveScanTarget({ profile: 'EN301549-V3.2.1' }), { level: 'AA', version: '2.1', profile: 'en301549-v3.2.1' });
    });

    test('anything unknown is neither', () => {
        assert.deepEqual(resolveScanTarget({ profile: 'iso-40500' }), { level: null, version: null, profile: null });
        assert.deepEqual(resolveScanTarget(), { level: null, version: null, profile: null });
    });
});

describe('the scan targets', () => {
    test('are the three WCAG 2.2 levels, then the standards, with WCAG 2.2 AA by default', () => {
        assert.deepEqual(Object.keys(SCAN_TARGETS), [
            'wcag22-a', 'wcag22-aa', 'wcag22-aaa', 'en301549-v4.1.1', 'en301549-v3.2.1'
        ]);
        assert.equal(DEFAULT_SCAN_TARGET, 'wcag22-aa');
    });

    test('only the standards are surea11y profiles', () => {
        assert.deepEqual(Object.keys(CONFORMANCE_TARGETS), ['en301549-v4.1.1', 'en301549-v3.2.1']);
    });

    test('each engine gets the targets it can check', () => {
        assert.deepEqual(scanTargetsFor('standard'), Object.keys(SCAN_TARGETS));
        assert.deepEqual(scanTargetsFor('version'), ['wcag22-a', 'wcag22-aa', 'wcag22-aaa', 'en301549-v4.1.1']);
        assert.deepEqual(scanTargetsFor('level'), ['wcag22-a', 'wcag22-aa', 'wcag22-aaa', 'en301549-v4.1.1']);
        // An engine that does not say selects by level.
        assert.deepEqual(scanTargetsFor(undefined), scanTargetsFor('level'));
    });

    test('no target is one every engine checks', () => {
        assert.equal(targetSupported(undefined, 'level'), true);
        assert.equal(targetSupported('en301549-v3.2.1', 'version'), false);
        assert.equal(targetSupported('EN301549-V3.2.1', 'standard'), true);
    });
});

describe('wcagTags', () => {
    test('every version and every level up to the target', () => {
        assert.deepEqual(wcagTags('2.0', 'A'), ['wcag2a']);
        assert.deepEqual(wcagTags('2.1', 'AA'), ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
        assert.equal(wcagTags('2.2', 'AAA').length, 9);
        assert.deepEqual(wcagTags('3.0', 'AA'), []);
    });
});

describe('selectionFromRunOnly', () => {
    // What an engine adapter is handed by the runner: a level it resolved, not a step's target.
    test('a level beats the tags\' level and keeps their version', () => {
        assert.deepEqual(selectionFromRunOnly({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag21a'] }, wcagLevel: 'AAA' }),
            { version: '2.1', level: 'AAA', profile: null, bestPractices: false });
    });

    test('a standard sets its own level', () => {
        assert.deepEqual(selectionFromRunOnly({ wcagLevel: 'A', profile: 'en301549-v3.2.1' }),
            { version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices: false });
    });

    test('nothing to go by is no selection', () => {
        assert.equal(selectionFromRunOnly({}), null);
    });
});

describe('resolveScanSelection', () => {
    test('a WCAG target sets its version, whatever the run says', () => {
        assert.deepEqual(resolveScanSelection({ profile: 'wcag22-a', version: '2.0' }), { version: '2.2', level: 'A', profile: null, bestPractices: false });
    });

    test('a step without a target is WCAG 2.2 AA unless the run says otherwise', () => {
        assert.deepEqual(resolveScanSelection({}), { version: '2.2', level: 'AA', profile: null, bestPractices: false });
        assert.deepEqual(resolveScanSelection({ version: '2.1' }).version, '2.1');
        // A bare level is not a profile: checkScanSteps stops the run before it gets here.
        assert.deepEqual(resolveScanSelection({ profile: 'A' }).level, 'AA');
    });

    test('a standard sets its version and Level AA', () => {
        assert.deepEqual(resolveScanSelection({ profile: 'en301549-v4.1.1', includeBestPractice: true }),
            { version: '2.2', level: 'AA', profile: 'en301549-v4.1.1', bestPractices: true });
        assert.deepEqual(resolveScanSelection({ profile: 'en301549-v3.2.1' }),
            { version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices: false });
    });

    test('a run\'s tags give the version, and the level of a step without one', () => {
        const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
        assert.deepEqual(resolveScanSelection({ tags }), { version: '2.1', level: 'AA', profile: null, bestPractices: true });
        assert.deepEqual(resolveScanSelection({ tags, profile: 'wcag22-a' }).level, 'A');
        assert.deepEqual(resolveScanSelection({ tags: 'wcag2a', version: '2.2' }).version, '2.2');
    });
});

describe('selectionFromTags', () => {
    test('the highest version and level named, and best-practice', () => {
        assert.deepEqual(selectionFromTags(['wcag2a', 'wcag22aa']), { version: '2.2', level: 'AA', bestPractices: false });
        assert.deepEqual(selectionFromTags('WCAG20AAA, best-practice'), { version: '2.0', level: 'AAA', bestPractices: true });
        assert.deepEqual(selectionFromTags(['wcag1412', 'keyboard']), { version: null, level: null, bestPractices: false });
        assert.deepEqual(selectionFromTags(null), { version: null, level: null, bestPractices: false });
    });
});

test('selectionTags and selectionLabel', () => {
    assert.deepEqual(selectionTags({ version: '2.0', level: 'AA', bestPractices: true }), ['wcag2a', 'wcag2aa', 'best-practice']);
    assert.deepEqual(selectionTags(null), []);
    assert.equal(selectionLabel({ version: '2.1', level: 'A', profile: null }), 'WCAG 2.1 A');
    assert.equal(selectionLabel({ version: '2.1', level: 'AA', profile: 'en301549-v3.2.1' }), 'EN 301 549 V3.2.1');
});

test('targetLabel names each standard', () => {
    assert.equal(targetLabel('en301549-v4.1.1'), 'EN 301 549 V4.1.1');
    assert.equal(targetLabel('nope'), null);
});

test('a saved RGAA profile is not a target any more', () => {
    assert.deepEqual(resolveScanTarget({ profile: 'rgaa-4.1.2' }), { level: null, version: null, profile: null });
    assert.equal(targetLabel('rgaa-4.1.2'), null);
});

describe('best practices', () => {
    const f = (outcome, bestPractice) => ({ outcome, ...(bestPractice ? { bestPractice: true } : {}) });

    test('splitOutcomeCounts counts the requirements and the best practices apart', () => {
        assert.deepEqual(splitOutcomeCounts([f('fail'), f('pass'), f('fail', true), f('cantTell', true)]), {
            outcomes: { fail: 1, cantTell: 0, pass: 1, notApplicable: 0 },
            bestPractices: { fail: 1, cantTell: 1, pass: 0, notApplicable: 0 }
        });
    });

    test('separateBestPractices moves them out of the findings, once', () => {
        const req = f('fail');
        const bp = f('fail', true);
        const canonical = { findings: [req, bp] };
        separateBestPractices(canonical);
        assert.deepEqual(canonical.findings, [req]);
        assert.deepEqual(canonical.bestPractices, [bp]);
        separateBestPractices(canonical);
        assert.deepEqual(canonical.bestPractices, [bp]);
        assert.equal(separateBestPractices(null), null);
    });
});
