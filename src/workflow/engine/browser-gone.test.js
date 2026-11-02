'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { explainBrowserGone } = require('./browser-gone');

const pageOf = (connected) => ({ browser: () => ({ connected }) });

test('an error after the browser went away says the browser closed, and keeps what Puppeteer said', () => {
    const err = explainBrowserGone(new Error("Attempted to use detached Frame 'ABC'."), pageOf(false));
    assert.match(err.message, /^The browser closed unexpectedly/);
    assert.match(err.message, /The next run starts a new browser/);
    assert.match(err.message, /\(Attempted to use detached Frame 'ABC'\.\)$/);
    assert.equal(err.browserGone, true);
    assert.equal(explainBrowserGone(err, pageOf(false)).message, err.message, 'said once');
});

test('with the browser still there, the error is left as it is', () => {
    const original = new Error("Attempted to use detached Frame 'ABC'.");
    assert.equal(explainBrowserGone(original, pageOf(true)), original);
    assert.equal(original.message, "Attempted to use detached Frame 'ABC'.");
    assert.equal(explainBrowserGone('plain', null), 'plain');
});
