'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const G = require('./scan-groups.js');

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

// A source that proposes the groups it is given, as { key: [ids] } or
// { key: { members, specificity, label } }.
function fixed(id, groups) {
    return {
        id,
        propose: () => Object.entries(groups).map(([key, g]) => (Array.isArray(g)
            ? { key, members: g }
            : { key, ...g })),
    };
}

const keysOf = (level) => level.map((g) => g.key);

describe('findGroups — without groups', () => {
    test('no sources: no groups, every item ungrouped in order', () => {
        const r = G.findGroups(items(3));
        assert.deepEqual(r.groups, []);
        assert.deepEqual(r.ungrouped, ['s0', 's1', 's2']);
    });

    test('a source that sees nothing leaves everything ungrouped', () => {
        const r = G.findGroups(items(3), { sources: [fixed('a', {})] });
        assert.deepEqual(r.groups, []);
        assert.deepEqual(r.ungrouped, ['s0', 's1', 's2']);
    });

    test('a source must have an id and propose()', () => {
        assert.throws(() => G.findGroups(items(1), { sources: [{ id: 'x' }] }), TypeError);
        assert.throws(() => G.findGroups(items(1), { sources: [{ propose: () => [] }] }), TypeError);
    });

    test('empty or odd input does not throw', () => {
        assert.deepEqual(G.findGroups(null), { groups: [], ungrouped: [], ids: [] });
        assert.deepEqual(G.findGroups([null, {}, { id: 's0' }]).ungrouped, ['s0']);
    });
});

describe('findGroups — what a group is', () => {
    test('a group of one item is not a group', () => {
        const r = G.findGroups(items(3), { sources: [fixed('a', { one: ['s1'] })] });
        assert.deepEqual(r.groups, []);
    });

    test('unknown and repeated ids are dropped before counting', () => {
        const r = G.findGroups(items(3), { sources: [fixed('a', { g: ['s1', 's1', 'x9'] })] });
        assert.deepEqual(r.groups, []);
    });

    test('minMembers can be raised, never below 2', () => {
        const src = fixed('a', { g: ['s0', 's1'] });
        assert.equal(G.findGroups(items(3), { sources: [src], minMembers: 3 }).groups.length, 0);
        assert.equal(G.findGroups(items(3), { sources: [src], minMembers: 1 }).groups.length, 1);
    });

    test('keys are prefixed with the source; members follow item order', () => {
        const r = G.findGroups(items(3), { sources: [fixed('a', { g: ['s2', 's0'] })] });
        assert.equal(r.groups[0].key, 'a:g');
        assert.equal(r.groups[0].source, 'a');
        assert.deepEqual(r.groups[0].members, ['s0', 's2']);
        assert.deepEqual(r.ungrouped, ['s1']);
    });

    test('a key repeated by one source keeps its first group', () => {
        const src = { id: 'a', propose: () => [{ key: 'g', members: ['s0', 's1'] }, { key: 'g', members: ['s1', 's2'] }] };
        const r = G.findGroups(items(3), { sources: [src] });
        assert.deepEqual(keysOf(r.groups), ['a:g']);
        assert.deepEqual(r.groups[0].members, ['s0', 's1']);
    });

    test('the label falls back to the key', () => {
        const r = G.findGroups(items(2), { sources: [fixed('a', { g: ['s0', 's1'] })] });
        assert.equal(r.groups[0].label, 'g');
    });

    test('items are read with getId', () => {
        const list = [{ name: 'x' }, { name: 'y' }];
        const r = G.findGroups(list, { getId: (i) => i.name, sources: [fixed('a', { g: ['x', 'y'] })] });
        assert.deepEqual(r.groups[0].members, ['x', 'y']);
    });
});

describe('findGroups — nesting', () => {
    test('a group inside another is its child; the smallest holder is the parent', () => {
        const r = G.findGroups(items(6), {
            sources: [fixed('a', {
                all: ['s0', 's1', 's2', 's3', 's4'],
                mid: ['s0', 's1', 's2'],
                small: ['s0', 's1'],
            })],
        });
        assert.deepEqual(keysOf(r.groups), ['a:all']);
        assert.deepEqual(keysOf(r.groups[0].children), ['a:mid']);
        assert.deepEqual(keysOf(r.groups[0].children[0].children), ['a:small']);
        assert.equal(r.groups[0].children[0].children[0].parentKey, 'a:mid');
        assert.deepEqual(r.ungrouped, ['s5']);
    });

    test('groups that only overlap are siblings', () => {
        const r = G.findGroups(items(4), {
            sources: [fixed('a', { left: ['s0', 's1', 's2'], right: ['s2', 's3'] })],
        });
        assert.deepEqual(keysOf(r.groups), ['a:left', 'a:right']);
        assert.ok(r.groups.every((g) => g.parentKey === null));
    });

    test('siblings are listed largest first, then by label', () => {
        const r = G.findGroups(items(7), {
            sources: [fixed('a', {
                b: { members: ['s0', 's1'], label: 'Beta' },
                a: { members: ['s2', 's3'], label: 'Alpha' },
                c: { members: ['s4', 's5', 's6'], label: 'Gamma' },
            })],
        });
        assert.deepEqual(r.groups.map((g) => g.label), ['Gamma', 'Alpha', 'Beta']);
    });

    test('flattenGroups lists parents before children', () => {
        const r = G.findGroups(items(3), {
            sources: [fixed('a', { all: ['s0', 's1', 's2'], some: ['s0', 's1'] })],
        });
        assert.deepEqual(G.flattenGroups(r.groups).map((g) => g.key), ['a:all', 'a:some']);
    });
});

describe('findGroups — the same members seen twice', () => {
    test('within a source, the more specific group is kept', () => {
        const r = G.findGroups(items(2), {
            sources: [fixed('a', {
                general: { members: ['s0', 's1'], specificity: 1 },
                precise: { members: ['s1', 's0'], specificity: 5 },
            })],
        });
        assert.deepEqual(keysOf(r.groups), ['a:precise']);
        assert.deepEqual(r.groups[0].equivalents.map((e) => e.key), ['a:general']);
    });

    test('across sources, the tie goes to the first source and names the other', () => {
        const r = G.findGroups(items(2), {
            sources: [fixed('url', { p: ['s0', 's1'] }), fixed('markup', { t: ['s0', 's1'] })],
        });
        assert.deepEqual(keysOf(r.groups), ['url:p']);
        assert.deepEqual(r.groups[0].equivalents, [{ key: 'markup:t', source: 'markup', label: 't' }]);
    });
});

describe('findGroups — more than one source', () => {
    // The point of the facade: a later way of telling scans apart (here a
    // stand-in for markup) adds its groups without touching the URL one, and
    // they nest by their members whatever their source.
    test('groups of different sources nest by members', () => {
        const r = G.findGroups(items(6), {
            sources: [
                fixed('url', { products: ['s0', 's1', 's2', 's3'] }),
                fixed('markup', { gallery: ['s1', 's2'], footer: ['s3', 's4', 's5'] }),
            ],
        });
        assert.deepEqual(keysOf(r.groups), ['url:products', 'markup:footer']);
        assert.deepEqual(keysOf(r.groups[0].children), ['markup:gallery']);
        assert.deepEqual(r.ungrouped, []);
    });

    test('each source gets the items and getId', () => {
        let seen = null;
        const spy = { id: 'spy', propose: (list, ctx) => { seen = { list, id: ctx.getId(list[0]) }; return []; } };
        const list = items(2);
        G.findGroups(list, { sources: [spy] });
        assert.equal(seen.list, list);
        assert.equal(seen.id, 's0');
    });

    test('evidence is passed through untouched', () => {
        const evidence = { kind: 'shape', anything: [1, 2] };
        const r = G.findGroups(items(2), {
            sources: [fixed('a', { g: { members: ['s0', 's1'], evidence } })],
        });
        assert.equal(r.groups[0].evidence, evidence);
    });
});

describe('chooseGroups', () => {
    // all ⊃ mid ⊃ small, and other beside them.
    const result = () => G.findGroups(items(8), {
        sources: [fixed('a', {
            all: ['s0', 's1', 's2', 's3', 's4'],
            mid: ['s0', 's1', 's2'],
            small: ['s0', 's1'],
            other: ['s5', 's6'],
        })],
    });
    const tree = (level) => level.map((n) => [n.key, n.own, tree(n.children)]);

    test('nothing chosen: no groups, every item ungrouped', () => {
        const c = G.chooseGroups(result(), []);
        assert.deepEqual(c.groups, []);
        assert.deepEqual(c.ungrouped, ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
        assert.deepEqual(c.missing, []);
    });

    test('an item is listed under the most specific chosen group', () => {
        const c = G.chooseGroups(result(), ['a:all', 'a:small']);
        assert.deepEqual(tree(c.groups), [
            ['a:all', ['s2', 's3', 's4'], [['a:small', ['s0', 's1'], []]]],
        ]);
        assert.deepEqual(c.groups[0].members, ['s0', 's1', 's2', 's3', 's4']);
        assert.deepEqual(c.ungrouped, ['s5', 's6', 's7']);
    });

    test('an unchosen group in between is skipped over', () => {
        const c = G.chooseGroups(result(), ['a:small', 'a:all']);
        assert.equal(c.groups[0].children[0].key, 'a:small');
    });

    test('a chosen child alone is a root', () => {
        const c = G.chooseGroups(result(), ['a:mid', 'a:other']);
        assert.deepEqual(tree(c.groups), [
            ['a:mid', ['s0', 's1', 's2'], []],
            ['a:other', ['s5', 's6'], []],
        ]);
        assert.deepEqual(c.ungrouped, ['s3', 's4', 's7']);
    });

    test('keys the result does not have are missing, not groups', () => {
        const c = G.chooseGroups(result(), ['a:gone', 'a:mid', 'a:mid']);
        assert.deepEqual(c.missing, ['a:gone']);
        assert.deepEqual(c.groups.map((g) => g.key), ['a:mid']);
    });

    test('odd input does not throw', () => {
        assert.deepEqual(G.chooseGroups(null, null), { groups: [], ungrouped: [], missing: [] });
    });
});
