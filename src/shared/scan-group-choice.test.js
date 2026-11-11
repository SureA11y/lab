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

describe('merging a group (§9)', () => {
    test('the merge flag is kept, and only said when true', () => {
        assert.deepEqual(C.readChoice({ scanGrouping: { patterns: [
            { key: 'url:a', name: null, merge: true }, { key: 'url:b', merge: false }, { key: 'url:c', merge: 'yes' },
        ] } }), [{ key: 'url:a', name: null, merge: true }, { key: 'url:b', name: null }, { key: 'url:c', name: null }]);
    });

    test('setMerged turns it on and off, and chooses a group not chosen yet', () => {
        let c = C.setMerged([], 'url:a', true);
        assert.deepEqual(c, [{ key: 'url:a', name: null, merge: true }]);
        c = C.setName(c, 'url:a', 'Products');
        assert.deepEqual(c, [{ key: 'url:a', name: 'Products', merge: true }]);
        c = C.setMerged(c, 'url:a', false);
        assert.deepEqual(c, [{ key: 'url:a', name: 'Products' }]);
        assert.deepEqual(C.setMerged([], 'url:z', false), []);
    });

    test('unchoosing a merged group takes the merge away with it', () => {
        assert.deepEqual(C.setChosen([{ key: 'url:a', name: 'A', merge: true }], 'url:a', false), []);
    });

    test('merging reports: merged in any of them is merged', () => {
        assert.deepEqual(C.mergeChoices([
            { scanGrouping: { patterns: [{ key: 'url:a' }] } },
            { scanGrouping: { patterns: [{ key: 'url:a', merge: true }] } },
        ]), [{ key: 'url:a', name: null, merge: true }]);
    });
});

describe('changing a group by hand (§9.2, step 7)', () => {
    const group = { key: 'url:p', members: ['s1', 's2', 's3'] };

    test('the scans of a group: the pattern\'s, with those added, without those taken out', () => {
        assert.deepEqual(C.membersOf(group, null), ['s1', 's2', 's3']);
        assert.deepEqual(C.membersOf(group, { key: 'url:p', add: ['s9'], remove: ['s2'] }), ['s1', 's3', 's9']);
        assert.deepEqual(C.membersOf(null, { key: 'manual:1', members: ['a', 'b'] }), ['a', 'b']);
    });

    test('adding, taking out and putting back', () => {
        let c = [{ key: 'url:p', name: null, merge: true }];
        c = C.addScan(c, 'url:p', 's9');
        assert.deepEqual(c[0].add, ['s9']);
        c = C.removeScan(c, 'url:p', 's9');
        assert.equal('add' in c[0], false, 'taking out what was added undoes the add');
        c = C.removeScan(c, 'url:p', 's2');
        assert.deepEqual(c[0].remove, ['s2']);
        c = C.addScan(c, 'url:p', 's2');
        assert.equal('remove' in c[0], false, 'adding a scan taken out puts it back');
        c = C.removeScan(c, 'url:p', 's3');
        c = C.putBack(c, 'url:p', 's3');
        assert.deepEqual(c, [{ key: 'url:p', name: null, merge: true }]);
    });

    test('a scan added to a group leaves any group it was added to before', () => {
        let c = [{ key: 'url:a', merge: true }, { key: 'url:b', merge: true }];
        c = C.addScan(c, 'url:a', 's9');
        c = C.addScan(c, 'url:b', 's9');
        assert.equal('add' in c[0], false);
        assert.deepEqual(c[1].add, ['s9']);
    });

    test('a group by hand: made with two scans or more, numbered, merged by default', () => {
        const none = C.addManualGroup([], { name: 'x', members: ['s1'] });
        assert.equal(none.key, null);
        const made = C.addManualGroup([{ key: 'manual:1', members: ['a', 'b'] }], { name: ' Checkout ', members: ['s1', 's2', 's1'] });
        assert.equal(made.key, 'manual:2');
        assert.deepEqual(made.choice[1], { key: 'manual:2', name: 'Checkout', members: ['s1', 's2'], merge: true });
        assert.equal(C.addManualGroup([], { members: ['a', 'b'], merge: false }).choice[0].merge, undefined);
    });

    test('a group by hand gains and loses scans in its own list, and goes below two', () => {
        let c = C.addManualGroup([], { members: ['a', 'b'] }).choice;
        c = C.addScan(c, 'manual:1', 'c');
        assert.deepEqual(c[0].members, ['a', 'b', 'c']);
        c = C.removeScan(c, 'manual:1', 'a');
        c = C.removeScan(c, 'manual:1', 'b');
        assert.deepEqual(c, []);
    });

    test('read from a report: what makes no sense is dropped', () => {
        assert.deepEqual(C.readChoice({ scanGrouping: { patterns: [
            { key: 'manual:1', members: ['a'] },
            { key: 'url:p', add: ['x', 'x', 3], remove: ['x', 'y'] },
        ] } }), [{ key: 'url:p', name: null, add: ['x'], remove: ['y'] }]);
    });

    test('the manual source proposes the groups by hand, by their own keys', () => {
        const G = require('./scan-groups.js');
        const c = C.addManualGroup([], { name: 'Checkout', members: ['s1', 's3'] }).choice;
        const r = G.findGroups([{ id: 's1' }, { id: 's2' }, { id: 's3' }], { sources: [C.createManualGroupSource(c)] });
        assert.deepEqual(r.groups.map((g) => [g.key, g.label, g.members]), [['manual:1', 'Checkout', ['s1', 's3']]]);
    });

    test('merging reports: what was added or taken out in any of them', () => {
        assert.deepEqual(C.mergeChoices([
            { scanGrouping: { patterns: [{ key: 'url:p', add: ['a'] }] } },
            { scanGrouping: { patterns: [{ key: 'url:p', add: ['b'], remove: ['a', 'c'] }] } },
        ]), [{ key: 'url:p', name: null, add: ['a', 'b'], remove: ['c'] }]);
    });
});

describe('what the run merged (§8, step 9)', () => {
    test('saved only once changed: unmerged, contexts taken out or excluded', () => {
        assert.deepEqual(C.readChoice({ scanGrouping: { patterns: [
            { key: 'run:s1' },
            { key: 'run:s2', merge: false, exclude: [1, '1', 'x'] },
            { key: 'run:s3', merge: true, remove: ['0'] },
        ] } }), [{ key: 'run:s2', merge: false, exclude: ['1'] }, { key: 'run:s3', remove: ['0'] }]);
    });

    test('unmerging and merging again', () => {
        let c = C.setRunMerged([], 's1', false);
        assert.deepEqual(c, [{ key: 'run:s1', merge: false }]);
        c = C.setRunContextExcluded(c, 's1', 2, true);
        assert.deepEqual(c, [{ key: 'run:s1', merge: false, exclude: ['2'] }]);
        // Merged again, as the run made it: nothing left to save.
        assert.deepEqual(C.setRunMerged(c, 's1', true), []);
    });

    test('taking a context out and putting it back', () => {
        let c = C.setRunContextOut([{ key: 'url:a', merge: true }], 's1', 0, true);
        assert.deepEqual(c, [{ key: 'url:a', name: null, merge: true }, { key: 'run:s1', remove: ['0'] }]);
        c = C.setRunContextOut(c, 's1', 0, false);
        assert.deepEqual(c, [{ key: 'url:a', name: null, merge: true }]);
        assert.equal(C.runKey('s9'), 'run:s9');
        assert.ok(C.isRun('run:s9') && !C.isRun('url:x'));
    });
});

describe('mergedGroupNames', () => {
    test('the merged groups, by name, else pattern, else "a group by hand"', () => {
        assert.deepEqual(C.mergedGroupNames({ scanGrouping: { patterns: [
            { key: 'url:shop.example.com/products/{*}', name: 'Products', merge: true },
            { key: 'url:shop.example.com/blog/{*}/{*}', merge: true },
            { key: 'url:shop.example.com/search?q', name: 'Search' },
            { key: 'manual:1', members: ['a', 'b'], merge: true },
            { key: 'run:s1', merge: false },
        ] } }), ['Products', '/blog/{*}/{*}', 'a group by hand']);
        assert.deepEqual(C.mergedGroupNames({}), []);
    });
});

describe('renameScanIds (reports opened as one, §11)', () => {
    test('renames the scans a choice names, not the patterns', () => {
        const choice = [
            { key: 'url:shop/p/{*}', merge: true, add: ['s1'], remove: ['s2'] },
            { key: 'manual:1', members: ['s1', 's3'], merge: true },
            { key: 'run:s4', merge: false, exclude: ['0'] },
        ];
        const rename = (id) => ({ s1: 's1__imp001', s4: 's4__imp001' })[id] || id;
        assert.deepEqual(C.renameScanIds(choice, rename), [
            { key: 'url:shop/p/{*}', name: null, merge: true, add: ['s1__imp001'], remove: ['s2'] },
            { key: 'manual:1', name: null, merge: true, members: ['s1__imp001', 's3'] },
            { key: 'run:s4__imp001', merge: false, exclude: ['0'] },
        ]);
    });

    test('a run entry\'s context indexes are not scan ids', () => {
        const out = C.renameScanIds([{ key: 'run:s4', remove: ['1'] }], () => 'x');
        assert.deepEqual(out, [{ key: 'run:x', remove: ['1'] }]);
    });
});

test('merging reports: each report\'s groups by hand stay apart, renumbered', () => {
    const merged = C.mergeChoices([
        { scanGrouping: { patterns: [{ key: 'manual:1', name: 'A', members: ['a1', 'a2'] }] } },
        { scanGrouping: { patterns: [{ key: 'manual:1', name: 'B', members: ['b1', 'b2'] }, { key: 'manual:2', members: ['b3', 'b4'] }] } },
    ]);
    // B's "manual:1" is renumbered clear of A's and of B's own "manual:2",
    // which keeps its number.
    assert.deepEqual(merged.map((p) => [p.key, p.name, p.members]), [
        ['manual:1', 'A', ['a1', 'a2']],
        ['manual:3', 'B', ['b1', 'b2']],
        ['manual:2', null, ['b3', 'b4']],
    ]);
});

describe('the contexts of a run\'s merged scan, as scans of their own', () => {
    const choice = () => C.readChoice({ scanGrouping: { patterns: [
        { key: 'run:s1', merge: false, exclude: ['1'] },
        { key: 'url:shop/products/{*}', add: ['s1~0'], remove: ['s1~1', 's9'] },
        { key: 'manual:1', name: 'Light', members: ['s1~0', 's4', 's5'] },
    ] } });

    test('says which groups hold them, and releases them from every one', () => {
        assert.deepEqual(C.runContextsHeld(choice(), 's1'), [
            { key: 'url:shop/products/{*}', ids: ['s1~0', 's1~1'] },
            { key: 'manual:1', ids: ['s1~0'] },
        ]);
        assert.deepEqual(C.runContextsHeld(choice(), 's2'), []);
        const released = C.releaseRunContexts(choice(), 's1');
        assert.deepEqual(C.runContextsHeld(released, 's1'), []);
        assert.deepEqual(released.find((p) => p.key === 'url:shop/products/{*}').remove, ['s9'], 'other scans stay');
        assert.deepEqual(released.find((p) => p.key === 'manual:1').members, ['s4', 's5']);
        assert.deepEqual(released.find((p) => p.key === 'run:s1').exclude, ['1'], 'the run\'s own entry is not touched');
    });

    test('a context\'s id follows its scan\'s when renamed', () => {
        const renamed = C.renameScanIds(choice(), (id) => (id === 's1' ? 's1b' : id));
        assert.ok(renamed.some((p) => p.key === 'run:s1b'));
        assert.deepEqual(renamed.find((p) => p.key === 'manual:1').members, ['s1b~0', 's4', 's5']);
        assert.deepEqual(renamed.find((p) => p.key === 'url:shop/products/{*}').add, ['s1b~0']);
    });

    test('put back in its merged scan, a context taken out is no longer excluded on its own', () => {
        const out = C.setRunContextExcluded(C.setRunContextOut([], 's1', 1, true), 's1', 1, true);
        assert.deepEqual(out.find((p) => p.key === 'run:s1').exclude, ['1']);
        const back = C.setRunContextOut(out, 's1', 1, false);
        assert.equal((back.find((p) => p.key === 'run:s1') || {}).exclude, undefined);
    });
});
