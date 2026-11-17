'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let mod;
before(async () => {
    mod = await import('./workflow-roadmap.js');
});

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const step = (id, depth, o = {}) => ({id, depth, type: 'click', typeTitle: 'Click', name: 'Click', disabled: false, container: false, ...o});

describe('workflow roadmap', () => {
    test('stepDetail says what a step acts on, never a value to type', () => {
        assert.equal(mod.stepDetail((n) => ({selector: '#username', value: 'secret'})[n] || ''), '#username');
        assert.equal(mod.stepDetail((n) => ({ms: '15000'})[n] || ''), '15 s');
        assert.equal(mod.stepDetail((n) => ({labelText: 'login'})[n] || ''), '"login"');
        assert.equal(mod.stepDetail((n) => ({value: 'secret'})[n] || ''), '');
        assert.ok(mod.stepDetail((n) => (n === 'url' ? 'x'.repeat(100) : '')).length <= 60);
    });

    test('roadmapTree nests by depth and leaves out headings', () => {
        const tree = mod.roadmapTree([
            step('a', 0), step('g', 0, {container: true}), step('b', 1), step('c', 2), step('d', 1), step('e', 0),
            {id: 'r', depth: 0, root: true}
        ]);
        assert.deepEqual(tree.map((i) => i.step.id), ['a', 'g', 'e']);
        assert.deepEqual(tree[1].children.map((i) => i.step.id), ['b', 'd']);
        assert.deepEqual(tree[1].children[0].children.map((i) => i.step.id), ['c']);
        assert.equal(mod.roadmapCount([step('a', 0), {root: true}]), 1);
    });

    test('renders groups as folds, scans marked, flags and details shown', () => {
        const d = doc();
        const el = mod.renderRoadmap(d, [
            step('g', 0, {container: true, name: 'Login', typeTitle: 'Group'}),
            step('s', 1, {name: 'Set value', typeTitle: 'Set value', detail: '#username', optional: true}),
            step('x', 0, {type: 'a11yScan', typeTitle: 'A11y scan', name: 'Home', disabled: true})
        ]);
        assert.equal(el.querySelectorAll('details').length, 1);
        assert.match(el.querySelector('details').textContent, /Login/);
        assert.ok(el.querySelector('.roadmap__row--scan'));
        assert.equal(el.querySelector('.roadmap__flag--off').textContent, 'off');
        assert.equal(el.querySelector('.roadmap__count').textContent, '1');
        assert.ok(el.textContent.includes('#username') && el.textContent.includes('optional'));
        assert.equal(el.querySelectorAll('button').length, 0, 'plain text without onGo');
    });

    test('with onGo each step is a button that goes to it', () => {
        const d = doc();
        const seen = [];
        const el = mod.renderRoadmap(d, [step('a', 0), step('b', 0)], {onGo: (s) => seen.push(s.id)});
        el.querySelectorAll('button')[1].click();
        assert.deepEqual(seen, ['b']);
    });

    test('no steps says so', () => {
        assert.match(mod.renderRoadmap(doc(), []).textContent, /No steps yet/);
    });
});

describe('custom steps in the roadmap', () => {
    const wf = [step('w1', 0, {path: '1'}), step('w2', 0, {path: '2', type: 'runCustomStep', calls: 'scan', name: 'Scan home'})];
    const custom = [
        {id: 'd0', root: true, depth: 0, name: 'Scan'},
        step('d0/1', 1, {path: '1', type: 'mergedScan', container: true}),
        step('d0/1.1', 2, {path: '1.1'}),
        step('d0/2', 1, {path: '2', type: 'runCustomStep', calls: 'scan'}),
        {id: 'd1', root: true, depth: 0, name: 'Other'},
        step('d1/1', 1, {path: '1'})
    ];
    const defs = [{id: 'scan', headId: 'd0', name: 'Scan desktop'}, {id: 'other', headId: 'd1', name: 'Other'}];

    test('opens a call in place, numbered after it, and names the custom step it runs', () => {
        const out = mod.expandCustomCalls(wf, custom, defs);
        assert.deepEqual(out.map((n) => `${n.path}@${n.depth}`), ['1@0', '2@0', '2.1@1', '2.1.1@2', '2.2@1']);
        assert.equal(out[1].detail, 'Scan desktop');
        assert.equal(out[2].from, 'custom');
        assert.equal(out[0].from, 'workflow');
    });

    test('a custom step that calls itself is opened once', () => {
        const out = mod.expandCustomCalls(wf, custom, defs);
        assert.equal(out.filter((n) => n.path === '2.2').length, 1);
        assert.equal(out.filter((n) => String(n.path).startsWith('2.2.')).length, 0);
    });

    test('a call to a custom step that is gone stays a single line', () => {
        const out = mod.expandCustomCalls([step('w', 0, {path: '1', calls: 'nope'})], custom, defs);
        assert.equal(out.length, 1);
        assert.equal(out[0].detail, 'nope');
    });

    test('a merged scan is marked as a scan', () => {
        const el = mod.renderRoadmap(doc(), [step('m', 0, {type: 'mergedScan'})]);
        assert.ok(el.querySelector('.roadmap__row--scan'));
    });
});

describe('folding the roadmap', () => {
    const deep = [
        step('a', 0, {container: true, path: '1'}),
        step('b', 1, {container: true, path: '1.1'}),
        step('c', 2, {container: true, path: '1.1.1'}),
        step('d', 3, {path: '1.1.1.1'})
    ];

    test('starts open down to two levels, the groups below folded', () => {
        const el = mod.renderRoadmap(doc(), deep, {onGo() {}});
        const open = [...el.querySelectorAll('details')].map((d) => d.open);
        assert.deepEqual(open, [true, true, false]);
    });

    test('openDepth sets how many levels start open', () => {
        const el = mod.renderRoadmap(doc(), deep, {openDepth: 1});
        assert.deepEqual([...el.querySelectorAll('details')].map((d) => d.open), [true, false, false]);
    });

    test('a group has a button that folds it, apart from the row that goes to the step', () => {
        const seen = [];
        const el = mod.renderRoadmap(doc(), deep, {onGo: (s) => seen.push(s.id)});
        const twisty = el.querySelector('button.roadmap__twisty');
        assert.equal(twisty.getAttribute('aria-expanded'), 'true');
        twisty.click();
        assert.equal(el.querySelector('details').open, false);
        assert.deepEqual(seen, [], 'folding does not go to the step');
        el.querySelector('summary .roadmap__row').click();
        assert.deepEqual(seen, ['a']);
        assert.equal(el.querySelector('details').open, false, 'going to a step does not fold it');
    });

    test('Expand all and Collapse all', () => {
        const el = mod.renderRoadmap(doc(), deep, {onGo() {}});
        const [expand, collapse] = el.querySelectorAll('.roadmap__tool');
        expand.click();
        assert.ok([...el.querySelectorAll('details')].every((d) => d.open));
        collapse.click();
        assert.ok([...el.querySelectorAll('details')].every((d) => !d.open));
    });

    test('without onGo it folds by the summary alone, with no buttons', () => {
        const el = mod.renderRoadmap(doc(), deep);
        assert.equal(el.querySelectorAll('button').length, 0);
        assert.ok(el.querySelector('summary'));
    });
});
