'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TIMEOUT_MS, resolveReadyTimeout, checkPageReady, readinessNotice } = require('./page-readiness');

describe('page readiness', () => {
    test('uses the step\'s timeout, 0 included, and the default otherwise', () => {
        assert.equal(resolveReadyTimeout(5000), 5000);
        assert.equal(resolveReadyTimeout('1500'), 1500);
        assert.equal(resolveReadyTimeout(0), 0);
        for (const v of [undefined, null, '', -1, 'soon', Infinity]) assert.equal(resolveReadyTimeout(v), DEFAULT_TIMEOUT_MS);
    });

    test('asks the page with core\'s waitForPageReady and the timeout', async () => {
        let seen;
        const page = { evaluate: async (fn, opts) => { seen = { fn, opts }; return { ready: true, waitedMs: 12, pending: { load: false, fonts: false, images: 0 } }; } };
        const r = await checkPageReady(page, { timeoutMs: 800 });
        assert.equal(seen.fn, require('@surea11y/core').waitForPageReady);
        assert.deepEqual(seen.opts, { timeoutMs: 800 });
        assert.equal(r.ready, true);
    });

    test('gives null, not an error, when the page cannot be asked', async () => {
        assert.equal(await checkPageReady({ evaluate: async () => { throw new Error('detached'); } }), null);
        assert.equal(await checkPageReady({ evaluate: async () => undefined }), null);
        assert.equal(await checkPageReady(null), null);
    });

    test('runs core\'s check for real in a jsdom page', async () => {
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM('<!doctype html><html><body><img src="x.png" loading="lazy"></body></html>');
        const page = { evaluate: async (fn, opts) => fn({ ...opts, document: dom.window.document }) };
        const r = await checkPageReady(page, { timeoutMs: 0 });
        assert.equal(r.ready, true, 'jsdom loads nothing, and a lazy image does not count');
        assert.deepEqual(r.pending, { load: false, fonts: false, images: 0 });
    });

    test('names what was still loading in a scan note', () => {
        const n = readinessNotice({ ready: false, waitedMs: 3004.2, pending: { load: false, fonts: true, images: 2 } });
        assert.equal(n.code, 'page-not-ready');
        assert.match(n.message, /still loading when it was scanned \(web fonts and 2 images, after waiting 3004 ms\)/);
        assert.match(readinessNotice({ ready: false, waitedMs: 0, pending: { load: true, fonts: false, images: 1 } }).message, /\(the page itself and 1 image,/);
    });

    test('adds no note for a page that was ready, or one never checked', () => {
        assert.equal(readinessNotice({ ready: true, waitedMs: 5, pending: { load: false, fonts: false, images: 0 } }), null);
        assert.equal(readinessNotice(null), null);
    });
});
