'use strict';

// The scans the last run of a workflow did, kept in the browser for the next
// run's time left (last-run-scans.js).

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');

let L;
before(async () => {
    L = await import('./last-run-scans.js');
});

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        data
    };
}

describe('last run scans', () => {
    const actions = [{type: 'a11yScan'}, {type: 'forEachElement', targetSelector: 'a', actions: [{type: 'a11yScan'}]}];

    test('a workflow has the same key for the same steps, and another for others', () => {
        assert.equal(L.workflowKey(actions, []), L.workflowKey(JSON.parse(JSON.stringify(actions)), []));
        assert.notEqual(L.workflowKey(actions, []), L.workflowKey([{type: 'a11yScan'}], []));
        assert.notEqual(L.workflowKey(actions, []), L.workflowKey(actions, [{id: 'x', actions: []}]));
    });

    test('counts each scan, and each scan of a Merged scan', () => {
        assert.equal(L.scansRunOf({scans: [{}, {}, {contexts: [{}, {}, {skipped: true}]}]}), 4);
        assert.equal(L.scansRunOf({scans: []}), null);
        assert.equal(L.scansRunOf(null), null);
    });

    test('keeps the scans of a run for the next run of the same workflow', () => {
        const storage = memoryStorage();
        const key = L.workflowKey(actions, []);
        assert.equal(L.readLastRunScans(key, storage), null);
        L.rememberLastRunScans(key, 205, storage);
        assert.equal(L.readLastRunScans(key, storage), 205);
        assert.equal(L.readLastRunScans(L.workflowKey([], []), storage), null);
    });

    test('keeps the most recent fifty workflows', () => {
        const storage = memoryStorage();
        for (let i = 0; i < 55; i += 1) L.rememberLastRunScans(`k${i}`, i + 1, storage, 1000 + i);
        assert.equal(L.readLastRunScans('k0', storage), null);
        assert.equal(L.readLastRunScans('k54', storage), 55);
        assert.equal(Object.keys(JSON.parse(storage.data.get('a11y-lab-last-run-scans'))).length, 50);
    });

    test('storage that is missing, broken or full only means no number', () => {
        assert.equal(L.readLastRunScans('k', null), null);
        assert.equal(L.readLastRunScans('k', {getItem: () => 'not json'}), null);
        assert.equal(L.readLastRunScans('k', {getItem: () => { throw new Error('blocked'); }}), null);
        assert.doesNotThrow(() => L.rememberLastRunScans('k', 3, {getItem: () => null, setItem: () => { throw new Error('full'); }}));
        assert.doesNotThrow(() => L.rememberLastRunScans('k', 0, memoryStorage()));
    });
});
