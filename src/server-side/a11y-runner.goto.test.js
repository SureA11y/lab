'use strict';

// How a run starts and ends: the start page's two tries share one time
// budget (a page that never answered took two full timeouts, 121 s, to fail),
// and a run asked to cancel ends cancelled, not in error.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { gotoWithFallback } = require('./a11y-runner');

function page(answers) {
    const calls = [];
    return {
        calls,
        goto: async (url, opts) => {
            calls.push(opts);
            const answer = answers.shift();
            if (answer instanceof Error) throw answer;
            return answer;
        },
        // waitForRenderSettle's calls: nothing to wait for.
        evaluate: async () => true,
        waitForNetworkIdle: async () => {},
    };
}

test('a timeout that used the whole budget is not tried again', async () => {
    const p = page([new Error('Navigation timeout of 60000 ms exceeded')]);
    const realNow = Date.now;
    const start = realNow();
    // The first try took the whole minute.
    let calls = 0;
    Date.now = () => (calls++ === 0 ? start : start + 60000);
    try {
        await assert.rejects(() => gotoWithFallback(p, 'https://example.com/', 60000, 'domcontentloaded'), /Navigation timeout/);
    } finally {
        Date.now = realNow;
    }
    assert.equal(p.calls.length, 1);
});

test('a quick failure is tried again, within what is left of the budget', async () => {
    const p = page([new Error('net::ERR_ABORTED at https://example.com/'), null]);
    await gotoWithFallback(p, 'https://example.com/', 60000, 'domcontentloaded');
    assert.equal(p.calls.length, 2);
    assert.ok(p.calls[1].timeout <= 60000 - 750 && p.calls[1].timeout > 55000, String(p.calls[1].timeout));
});

test('a failure not worth a second try is not tried again', async () => {
    const p = page([new Error('net::ERR_CONNECTION_REFUSED at https://example.com/')]);
    await assert.rejects(() => gotoWithFallback(p, 'https://example.com/', 60000, 'domcontentloaded'), /REFUSED/);
    assert.equal(p.calls.length, 1);
});

const { endedByCancel } = require('./a11y-runner');

test('a run asked to cancel ends cancelled, whatever its teardown threw', () => {
    const detached = new Error("Attempted to use detached Frame '1AAC'.");
    assert.equal(endedByCancel(detached, { cancelRequested: true }), true);
    assert.equal(endedByCancel(Object.assign(new Error('_WF_CANCELLED_'), { _wfCancelled: true })), true);
    // Not asked to cancel: a failure is a failure.
    assert.equal(endedByCancel(detached, { cancelRequested: false }), false);
});
