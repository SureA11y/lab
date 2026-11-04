'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let m;
before(async () => {
    m = await import('./steps-panel-model.js');
});

// A config five levels deep: a scan in a Case in a Switch in a Condition in
// an Iterate in a Group, the shape that makes a long config hard to move in.
function node(id, path, type, extra = {}) {
    const depth = path.split('.').length - 1;
    return {
        id, path, depth, type, typeTitle: type, name: extra.name || type,
        parentId: extra.parentId || null, disabled: !!extra.disabled, container: !!extra.container,
        searchText: String(extra.searchText || extra.name || type).toLowerCase()
    };
}

function config() {
    return [
        node('a', '1', 'click', {name: 'Accept cookies', searchText: 'accept cookies #accept-cookies'}),
        node('b', '2', 'a11yScan', {name: 'Home'}),
        node('c', '3', 'group', {name: 'Product pages', container: true}),
        node('d', '3.1', 'forEachElement', {name: 'Each product card', container: true, parentId: 'c'}),
        node('e', '3.1.1', 'if', {name: 'Size picker is shown', container: true, parentId: 'd'}),
        node('f', '3.1.1.1', 'switch', {name: 'By product kind', container: true, parentId: 'e'}),
        node('g', '3.1.1.1.1', 'case', {name: 'shoes', container: true, parentId: 'f'}),
        node('h', '3.1.1.1.1.1', 'clickByText', {name: 'Open the size picker', parentId: 'g', searchText: 'open the size picker #size-toggle'}),
        node('i', '3.1.1.1.1.2', 'a11yScan', {name: 'Size picker', parentId: 'g'}),
        node('j', '4', 'a11yScan', {name: 'Cart', disabled: true})
    ];
}

describe('steps panel model', () => {
    test('without a filter, lists every step and marks nothing', () => {
        const r = m.applyFilter(config(), {kind: 'all', query: '  '});
        assert.equal(r.active, false);
        assert.equal(r.rows.length, 10);
        assert.ok(r.rows.every((row) => !row.match && !row.context));
        assert.deepEqual(r.matches, []);
    });

    test('a kind keeps its matches and the containers they are in, as context', () => {
        const r = m.applyFilter(config(), {kind: 'scan'});
        assert.equal(r.active, true);
        assert.deepEqual(r.matches.map((n) => n.id), ['b', 'i', 'j']);
        assert.deepEqual(r.rows.map((row) => row.node.id), ['b', 'c', 'd', 'e', 'f', 'g', 'i', 'j']);
        const ctx = r.rows.filter((row) => row.context).map((row) => row.node.id);
        assert.deepEqual(ctx, ['c', 'd', 'e', 'f', 'g']);
    });

    test('text looks in what each step says, selectors included, whatever the case', () => {
        const r = m.applyFilter(config(), {query: '#SIZE-toggle'});
        assert.deepEqual(r.matches.map((n) => n.id), ['h']);
        assert.equal(r.rows.length, 6);
    });

    test('kind and text together narrow to what both take', () => {
        assert.deepEqual(m.applyFilter(config(), {kind: 'click', query: 'size'}).matches.map((n) => n.id), ['h']);
        assert.deepEqual(m.applyFilter(config(), {kind: 'scan', query: 'size'}).matches.map((n) => n.id), ['i']);
    });

    test('a container that matches is a match, not context', () => {
        const r = m.applyFilter(config(), {kind: 'container'});
        assert.ok(r.rows.every((row) => row.match));
    });

    test('counts each kind', () => {
        assert.deepEqual(m.countKinds(config()), {all: 10, scan: 3, click: 2, container: 5, disabled: 1});
    });

    test('steps through the matches both ways and wraps', () => {
        const nodes = config();
        const {matches} = m.applyFilter(nodes, {kind: 'scan'});
        assert.equal(m.stepThroughMatches(nodes, matches, 'b', 1).id, 'i');
        assert.equal(m.stepThroughMatches(nodes, matches, 'j', 1).id, 'b');
        assert.equal(m.stepThroughMatches(nodes, matches, 'b', -1).id, 'j');
    });

    test('from a step that is not a match, goes to the nearest match that way', () => {
        const nodes = config();
        const {matches} = m.applyFilter(nodes, {kind: 'scan'});
        assert.equal(m.stepThroughMatches(nodes, matches, 'e', 1).id, 'i');
        assert.equal(m.stepThroughMatches(nodes, matches, 'e', -1).id, 'b');
        assert.equal(m.stepThroughMatches(nodes, matches, null, 1).id, 'b');
        assert.equal(m.stepThroughMatches(nodes, [], 'b', 1), null);
    });

    test('says where a match is among the matches', () => {
        const {matches} = m.applyFilter(config(), {kind: 'scan'});
        assert.equal(m.matchPosition(matches, 'i'), 2);
        assert.equal(m.matchPosition(matches, 'a'), 0);
    });

    test('gives each listed step its place among the siblings listed with it', () => {
        const r = m.applyFilter(config(), {kind: 'scan'});
        const pos = m.siblingPositions(r.rows);
        assert.deepEqual(pos.get('b'), {posinset: 1, setsize: 3});
        assert.deepEqual(pos.get('j'), {posinset: 3, setsize: 3});
        assert.deepEqual(pos.get('i'), {posinset: 1, setsize: 1});
    });
});
