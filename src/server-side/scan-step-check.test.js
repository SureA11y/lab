'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scanStepsOf, checkScanSteps, mergedScanNestingProblems } = require('./scan-step-check');

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

describe('checkScanSteps with several profiles', () => {
    const describeEngine = () => ({ id: 'surea11y', name: 'surea11y', selectsBy: 'standard' });
    const check = (actions) => () => checkScanSteps(actions, [], describeEngine);

    test('takes a list of profiles, one WCAG level and any standards', () => {
        assert.doesNotThrow(check([{ type: 'a11yScan', profile: ['wcag22-aaa', 'en301549-v4.1.1'] }]));
        assert.doesNotThrow(check([{ type: 'a11yScan', profile: ['en301549-v3.2.1'] }]));
    });

    test('fails on two WCAG levels, or a list naming something that is not a profile', () => {
        assert.throws(check([{ type: 'a11yScan', label: 'Home', profile: ['wcag22-a', 'wcag22-aa'] }]),
            /Scan "Home": WCAG 2\.2 A and WCAG 2\.2 AA are two WCAG levels/);
        assert.throws(check([{ type: 'a11yScan', profile: ['wcag22-aa', 'nope'] }]), /"nope" is not a profile/);
    });

    test('leaves a variable for the run to check', () => {
        assert.doesNotThrow(check([{ type: 'a11yScan', profile: '{var:profiles}' }]));
        assert.doesNotThrow(check([{ type: 'a11yScan', profile: ['wcag22-aa', '{var:standard}'] }]));
    });
});

describe('mergedScanNestingProblems', () => {
    const scan = { type: 'a11yScan', label: 'Desktop' };
    const merged = (label, actions) => ({ type: 'mergedScan', label, actions });
    const multi = { id: 'mv', name: 'Multi-viewport', actions: [merged('Viewports', [scan])] };

    test('a Merged scan inside another, at any depth, names both', () => {
        const problems = mergedScanNestingProblems([
            merged('Outer', [{ type: 'group', actions: [merged('Inner', [scan])] }]),
        ], []);
        assert.equal(problems.length, 1);
        assert.match(problems[0], /^\$\.actions\[0\]\.actions\[0\]\.actions\[0\] is the Merged scan "Inner", inside the Merged scan "Outer"\./);
    });

    test('through a custom step, at the Run custom step, naming the custom step', () => {
        const problems = mergedScanNestingProblems([
            { type: 'wait', ms: 10 },
            merged('4 - Scan cookies and close', [{ type: 'runCustomStep', customStepId: 'mv' }]),
        ], [multi]);
        assert.deepEqual(problems, ['$.actions[1].actions[0] runs the custom step "Multi-viewport" inside the Merged scan "4 - Scan cookies and close", and that custom step holds the Merged scan "Viewports". A Merged scan cannot hold another: run the custom step outside the Merged scan, or take the Merged scan out of the custom step.']);
    });

    test('through custom steps calling custom steps, and inside a custom step itself', () => {
        const outer = { id: 'outer', actions: [{ type: 'runCustomStep', customStepId: 'mv' }] };
        assert.equal(mergedScanNestingProblems([merged('A', [{ type: 'runCustomStep', customStepId: 'outer' }])], [outer, multi]).length, 1);
        const own = { id: 'own', actions: [merged('A', [merged('B', [scan])])] };
        assert.match(mergedScanNestingProblems([], [own])[0], /^\$\.customSteps\[0\]\.actions\[0\]\.actions\[0\] is the Merged scan "B"/);
    });

    test('a custom step with a Merged scan run outside one, a disabled step, a {var:...} id and a cycle pass', () => {
        assert.deepEqual(mergedScanNestingProblems([{ type: 'runCustomStep', customStepId: 'mv' }, merged('A', [scan])], [multi]), []);
        assert.deepEqual(mergedScanNestingProblems([merged('A', [{ ...merged('B', [scan]), disabled: true }])], []), []);
        assert.deepEqual(mergedScanNestingProblems([merged('A', [{ type: 'runCustomStep', customStepId: '{var:step}' }])], [multi]), []);
        const loop = { id: 'loop', actions: [{ type: 'runCustomStep', customStepId: 'loop' }] };
        assert.deepEqual(mergedScanNestingProblems([merged('A', [{ type: 'runCustomStep', customStepId: 'loop' }])], [loop]), []);
    });
});
