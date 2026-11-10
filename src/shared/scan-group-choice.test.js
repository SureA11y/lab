'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const C = require('./scan-group-choice.js');

describe('the saved choice', () => {
    test('read from the report, normalized', () => {
        const payload = { scanGrouping: { patterns: [
            { key: 'url:a', name: '  Product   pages ' },
            { key: 'url:a', name: 'again' },
            { key: 'url:b', name: '' },
            { key: '' }, null, { name: 'no key' },
        ] } };
        assert.deepEqual(C.readChoice(payload), [{ key: 'url:a', name: 'Product pages' }, { key: 'url:b', name: null }]);
    });

    test('a report without one has none', () => {
        assert.deepEqual(C.readChoice({}), []);
        assert.deepEqual(C.readChoice({ scanGrouping: 'x' }), []);
        assert.deepEqual(C.readChoice(null), []);
    });

    test('written to the report, and removed when empty', () => {
        const payload = {};
        C.writeChoice(payload, [{ key: 'url:a', name: null }]);
        assert.deepEqual(payload.scanGrouping, { patterns: [{ key: 'url:a', name: null }] });
        C.writeChoice(payload, []);
        assert.equal('scanGrouping' in payload, false);
    });

    test('choosing adds at the end once; unchoosing removes the name too', () => {
        let c = C.setChosen([], 'url:a', true);
        c = C.setChosen(c, 'url:b', true);
        c = C.setChosen(c, 'url:a', true);
        assert.deepEqual(c.map((p) => p.key), ['url:a', 'url:b']);
        c = C.setName(c, 'url:a', 'Products');
        c = C.setChosen(c, 'url:a', false);
        assert.deepEqual(c, [{ key: 'url:b', name: null }]);
        assert.deepEqual(C.setChosen(c, 'url:a', true)[1], { key: 'url:a', name: null });
    });

    test('naming: trimmed, capped, empty puts the pattern back', () => {
        const c = [{ key: 'url:a', name: null }];
        assert.equal(C.setName(c, 'url:a', '  Blog  posts ')[0].name, 'Blog posts');
        assert.equal(C.setName(c, 'url:a', '   ')[0].name, null);
        assert.equal(C.setName(c, 'url:a', 'x'.repeat(500))[0].name.length, C.MAX_NAME);
        assert.deepEqual(C.setName(c, 'url:z', 'n'), c);
    });

    test('merging reports: every group once, the first name kept', () => {
        const merged = C.mergeChoices([
            { scanGrouping: { patterns: [{ key: 'url:a', name: null }, { key: 'url:b', name: 'B' }] } },
            {},
            { scanGrouping: { patterns: [{ key: 'url:a', name: 'A' }, { key: 'url:b', name: 'B2' }, { key: 'url:c' }] } },
        ]);
        assert.deepEqual(merged, [{ key: 'url:a', name: 'A' }, { key: 'url:b', name: 'B' }, { key: 'url:c', name: null }]);
    });
});

describe('planAction', () => {
    const scans = (states) => states.map((inc, i) => ({ id: `s${i}`, ...(inc ? {} : { includedInReport: false }) }));

    test('include: only the excluded members', () => {
        assert.deepEqual(C.planAction(scans([true, false, false, false]), ['s1', 's2', 's0'], 'include'),
            { include: ['s1', 's2'], exclude: [] });
    });

    test('exclude: only the included members', () => {
        assert.deepEqual(C.planAction(scans([true, false, true, true]), ['s0', 's1', 's2'], 'exclude'),
            { include: [], exclude: ['s0', 's2'] });
    });

    test('keep one: the first in report order stays, the rest go', () => {
        assert.deepEqual(C.planAction(scans([true, true, true, true]), ['s3', 's1', 's2'], 'keepOne'),
            { include: [], exclude: ['s2', 's3'] });
    });

    test('keep one keeps the first already included', () => {
        assert.deepEqual(C.planAction(scans([false, false, true, true]), ['s0', 's1', 's2', 's3'], 'keepOne'),
            { include: [], exclude: ['s3'] });
    });

    test('keep one with none included brings the first back', () => {
        assert.deepEqual(C.planAction(scans([false, false, false]), ['s1', 's2'], 'keepOne'),
            { include: ['s1'], exclude: [] });
    });

    test('nothing to change is an empty plan', () => {
        assert.deepEqual(C.planAction(scans([true, true]), ['s0', 's1'], 'include'), { include: [], exclude: [] });
        assert.deepEqual(C.planAction(scans([true]), ['zz'], 'exclude'), { include: [], exclude: [] });
    });

    test('an unknown action throws', () => {
        assert.throws(() => C.planAction([], [], 'delete'), TypeError);
    });
});

describe('a group that matches no scan', () => {
    test('stays in the choice when another group is chosen or named', () => {
        let c = [{ key: 'url:gone', name: 'Old' }];
        c = C.setChosen(c, 'url:a', true);
        c = C.setName(c, 'url:a', 'A');
        assert.deepEqual(c, [{ key: 'url:gone', name: 'Old' }, { key: 'url:a', name: 'A' }]);
    });
});
