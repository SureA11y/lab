'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let b;
before(async () => {
    b = await import('./steps-bulk-edit.js');
});

const defs = {
    a11yScan: {
        fieldOrder: { primary: ['label', 'scanTags', 'profile'] },
        fields: {
            label: { type: 'string', alias: 'Scan label' },
            scanTags: { type: 'string[]', alias: 'Tags' },
            profile: { type: 'string|string[]', alias: 'Profile', options: [{ value: 'wcag22-aa', label: 'WCAG 2.2 AA' }, { value: 'wcag22-aaa', label: 'WCAG 2.2 AAA' }] },
            includeBestPractice: { type: 'boolean', alias: 'Include best-practice rules' },
            waitTimeout: { type: 'number', alias: 'Wait timeout (ms)' },
            optional: { type: 'boolean', alias: 'Optional action' }
        }
    },
    click: {
        fields: {
            selector: { type: 'string', alias: 'Selector', required: true },
            password: { type: 'string' },
            timeout: { type: 'number', alias: 'Timeout (ms)' },
            optional: { type: 'boolean', alias: 'Optional action' },
            label: { type: 'string', alias: 'Log label' }
        }
    },
    group: { fields: { optional: { type: 'boolean', alias: 'Optional group' }, actions: { type: 'Action[]' } } }
};

describe('edit together: the fields steps share', () => {
    test('steps of one type share their fields, the ones shown first first, and not their names', () => {
        const fields = b.sharedFields(['a11yScan', 'a11yScan'], defs);
        assert.deepEqual(fields.map((f) => f.name), ['scanTags', 'profile', 'includeBestPractice', 'waitTimeout', 'optional']);
        assert.deepEqual(fields.map((f) => f.kind), ['list', 'choice', 'boolean', 'number', 'boolean']);
        assert.equal(fields[1].label, 'Profile');
    });

    test('steps of several types share only what they all have, alike', () => {
        assert.deepEqual(b.sharedFields(['a11yScan', 'click'], defs).map((f) => f.name), ['optional']);
        assert.deepEqual(b.sharedFields(['click', 'group'], defs).map((f) => f.name), ['optional']);
    });

    test('secrets and the steps inside a container are never shared', () => {
        assert.ok(!b.sharedFields(['click'], defs).some((f) => f.name === 'password'));
        assert.deepEqual(b.sharedFields(['group'], defs).map((f) => f.name), ['optional']);
    });
});

describe('edit together: what each step would get', () => {
    let fields;
    before(() => { fields = b.sharedFields(['a11yScan'], defs); });
    const steps = [
        { id: 's1', values: { scanTags: ['desktop'], profile: 'wcag22-aa', includeBestPractice: false } },
        { id: 's2', values: { scanTags: ['desktop', 'release-12'], profile: 'wcag22-aaa', includeBestPractice: true } },
        { id: 's3', values: { scanTags: 'mobile', profile: 'wcag22-aa' } }
    ];

    test('says what the steps hold now, most common first', () => {
        const profile = fields.find((f) => f.name === 'profile');
        assert.deepEqual(b.tally(steps.map((s) => s.values.profile), profile), [{ text: 'WCAG 2.2 AA', n: 2 }, { text: 'WCAG 2.2 AAA', n: 1 }]);
    });

    test('a choice changes only the steps that do not have it', () => {
        const plan = b.planChanges(steps, { profile: { value: 'wcag22-aa' } }, fields);
        assert.deepEqual(plan.map((p) => p.id), ['s2']);
        assert.deepEqual(plan[0].changes[0], { name: 'profile', label: 'Profile', before: 'wcag22-aaa', after: 'wcag22-aa', beforeText: 'WCAG 2.2 AAA', afterText: 'WCAG 2.2 AA' });
    });

    test('a list adds what a step lacks and keeps what it has', () => {
        const plan = b.planChanges(steps, { scanTags: { value: 'release-12', mode: 'add' } }, fields);
        assert.deepEqual(plan.map((p) => [p.id, p.changes[0].after]), [['s1', ['desktop', 'release-12']], ['s3', ['mobile', 'release-12']]]);
    });

    test('a list removes from the steps that have it', () => {
        const plan = b.planChanges(steps, { scanTags: { value: 'release-12', mode: 'remove' } }, fields);
        assert.deepEqual(plan.map((p) => [p.id, p.changes[0].after]), [['s2', ['desktop']]]);
    });

    test('yes or no compares as yes or no, whatever form it is in', () => {
        const plan = b.planChanges(steps, { includeBestPractice: { value: 'false' } }, fields);
        // s1 is No already, and s3, which does not say, is No too.
        assert.deepEqual(plan.map((p) => p.id), ['s2']);
    });

    test('a field left as Keep changes nothing', () => {
        assert.deepEqual(b.planChanges(steps, { profile: { value: '' }, scanTags: { value: '  ', mode: 'add' }, waitTimeout: { value: 'x' } }, fields), []);
    });

    test('several fields at once, each step with its own changes', () => {
        const plan = b.planChanges(steps, { profile: { value: 'wcag22-aa' }, waitTimeout: { value: '5000' } }, fields);
        assert.deepEqual(plan.map((p) => [p.id, p.changes.map((c) => `${c.name}:${c.afterText}`)]), [
            ['s1', ['waitTimeout:5000']],
            ['s2', ['profile:WCAG 2.2 AA', 'waitTimeout:5000']],
            ['s3', ['waitTimeout:5000']]
        ]);
    });
});
