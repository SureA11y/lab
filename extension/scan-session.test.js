'use strict';

// The extension's session (scan-session.js): the scans kept in order,
// removed one by one, emptied for a new session, and which of them a new
// session would lose: those added since it was last downloaded or opened in
// the lab. In memory here; IndexedDB in the browser.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {createScanSession, memoryBackend} = require('./scan-session.js');

function sessionAt(start = 1000) {
    let t = start;
    const changes = [];
    const s = createScanSession({backend: memoryBackend(), now: () => ++t, channel: null});
    s.onChange(() => changes.push(t));
    return {s, changes};
}

const scan = (id, label) => ({scanId: id, label, url: `https://example.test/${id}`, canonical: {findings: []}});

describe('the session', () => {
    test('keeps its scans in the order they were added', async () => {
        const {s} = sessionAt();
        assert.equal(await s.add(scan('b', 'Second page')), 1);
        assert.equal(await s.add(scan('a', 'First page')), 2);
        assert.deepEqual((await s.list()).map((r) => r.scan.label), ['Second page', 'First page']);
    });

    test('a scan added again by its id replaces it', async () => {
        const {s} = sessionAt();
        await s.add(scan('a', 'Old'));
        await s.add(scan('a', 'New'));
        assert.deepEqual((await s.list()).map((r) => r.scan.label), ['New']);
    });

    test('refuses a scan without its id', async () => {
        const {s} = sessionAt();
        await assert.rejects(() => s.add({label: 'x'}), /scanId/);
    });

    test('removes one scan, and empties for a new session', async () => {
        const {s} = sessionAt();
        await s.add(scan('a'));
        await s.add(scan('b'));
        await s.remove('a');
        assert.deepEqual((await s.list()).map((r) => r.scanId), ['b']);
        await s.clear();
        assert.deepEqual(await s.list(), []);
    });

    test('says when it changes', async () => {
        const {s, changes} = sessionAt();
        await s.add(scan('a'));
        await s.remove('a');
        await s.markShared();
        await s.clear();
        assert.equal(changes.length, 4);
    });

    test('keeps what it holds as copies, not the objects given', async () => {
        const {s} = sessionAt();
        const given = scan('a', 'Label');
        await s.add(given);
        given.label = 'Changed after';
        assert.equal((await s.list())[0].scan.label, 'Label');
    });
});

describe('what a new session would lose', () => {
    test('every scan, while the session was never downloaded or opened', async () => {
        const {s} = sessionAt();
        await s.add(scan('a'));
        await s.add(scan('b'));
        assert.equal(await s.unsharedCount(), 2);
    });

    test('only the scans added since it was last shared', async () => {
        const {s} = sessionAt();
        await s.add(scan('a'));
        await s.markShared();
        assert.equal(await s.unsharedCount(), 0);
        await s.add(scan('b'));
        assert.equal(await s.unsharedCount(), 1);
    });

    test('nothing, once it is emptied', async () => {
        const {s} = sessionAt();
        await s.add(scan('a'));
        await s.clear();
        assert.equal(await s.unsharedCount(), 0);
    });
});
