'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { requestCancel } = require('./run-cancel');

const run = (status) => ({ status, cancelled: false, log: { entries: [], push(e) { this.entries.push(e); } }, abortController: new AbortController() });

test('a run still going is marked cancelling, logged and aborted', () => {
    const r = run('running');
    assert.deepEqual(requestCancel(r), { status: 'cancelling', changed: true });
    assert.equal(r.cancelled, true);
    assert.equal(r.abortController.signal.aborted, true);
    assert.equal(r.log.entries[0].message, 'Cancellation requested by user');
});

test('a run that has ended is left as it ended, and its log says nothing', () => {
    for (const status of ['done', 'error', 'cancelled']) {
        const r = run(status);
        assert.deepEqual(requestCancel(r), { status, changed: false });
        assert.equal(r.cancelled, false);
        assert.equal(r.abortController.signal.aborted, false);
        assert.equal(r.log.entries.length, 0);
    }
});
