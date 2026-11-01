'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scanStepsOf, checkScanSteps } = require('./scan-step-check');

// The engines as the facade describes them; the default one for no id. The
// two others are made up, to cover the other ways an engine selects rules.
const ENGINES = {
    surea11y: { id: 'surea11y', name: 'surea11y', selectsBy: 'standard' },
    'engine-b': { id: 'engine-b', name: 'Engine B', selectsBy: 'version' },
    'engine-c': { id: 'engine-c', name: 'Engine C', selectsBy: 'level' },
};
function describeEngine(id) {
    const e = ENGINES[id || 'surea11y'];
    if (!e) throw new Error(`Failed to resolve accessibility engine "${id}" by id or name.`);
    return e;
}
const check = (actions, customSteps = [], options) => () => checkScanSteps(actions, customSteps, describeEngine, options);

describe('scanStepsOf', () => {
    test('finds the scan steps at any depth', () => {
        const actions = [
            { type: 'a11yScan', label: 'top' },
            { type: 'group', actions: [{ type: 'mergedScan', actions: [{ type: 'a11yScan', label: 'deep' }] }] },
            { type: 'if', selectorExists: '#x', actions: [], else: [{ type: 'a11yScan', label: 'else' }] },
        ];
        assert.deepEqual(scanStepsOf(actions).map((s) => s.label), ['top', 'deep', 'else']);
    });
});

describe('checkScanSteps', () => {
    test('passes scans whose engine can check their profile, and those with none', () => {
        assert.doesNotThrow(check([
            { type: 'a11yScan', profile: 'en301549-v3.2.1' },
            { type: 'a11yScan', engine: 'engine-b', profile: 'en301549-v4.1.1' },
            { type: 'a11yScan', engine: 'engine-c', profile: 'wcag22-aaa' },
            { type: 'a11yScan', engine: 'engine-b', profile: '{var:target}' },
            { type: 'a11yScan', engine: 'engine-b' },
        ]));
    });

    test('fails on a profile the step\'s engine cannot check, naming the scan, the engine and the profile', () => {
        assert.throws(check([{ type: 'a11yScan', label: 'Home', engine: 'engine-b', profile: 'en301549-v3.2.1' }]), {
            message: 'Scan "Home": Engine B cannot check EN 301 549 V3.2.1. Choose another profile.',
        });
    });

    test('a scan without a profile checks WCAG 2.2 AA, which every engine can', () => {
        assert.doesNotThrow(check([{ type: 'a11yScan', label: 'Home', engine: 'engine-c' }, { type: 'a11yScan', engine: 'engine-b', profile: '' }]));
    });

    test('fails on a bare level or any other value that is not a profile, rather than scan at another level', () => {
        assert.throws(check([{ type: 'a11yScan', label: 'Home', profile: 'AA' }]), {
            message: 'Scan "Home": "AA" is not a profile. Choose one of wcag22-a, wcag22-aa, wcag22-aaa, en301549-v4.1.1, en301549-v3.2.1.',
        });
        assert.throws(check([{ type: 'a11yScan', profile: 'iso-40500' }]), /"iso-40500" is not a profile/);
    });

    test('fails on an engine that is not installed, and checks the custom steps too', () => {
        assert.throws(check([], [{ id: 'c', actions: [{ type: 'a11yScan', engine: 'nope' }] }]), {
            message: 'Scan without a label: Failed to resolve accessibility engine "nope" by id or name.',
        });
    });

    test('names every problem at once', () => {
        assert.throws(check([
            { type: 'a11yScan', label: 'A', engine: 'engine-b', profile: 'en301549-v3.2.1' },
            { type: 'a11yScan', label: 'B', engine: 'engine-c', profile: 'en301549-v3.2.1' },
        ]), (e) => e.message.split('\n').length === 2);
    });
});
