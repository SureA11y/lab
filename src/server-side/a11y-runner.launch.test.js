'use strict';

// Runs that start together, before the shared browser is up, share the one
// launch: each launched its own, and only the last was kept.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

test('runs that start together share one browser launch', async () => {
    let launches = 0;
    const fakeBrowser = () => ({ connected: true, on() {}, targets: () => [], close: async () => {} });
    const fakePuppeteer = { launch: async () => { launches += 1; await new Promise((r) => setTimeout(r, 20)); return fakeBrowser(); } };
    const load = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'puppeteer') return fakePuppeteer;
        return load.call(this, request, ...rest);
    };
    try {
        delete require.cache[require.resolve('./a11y-runner')];
        const { getBrowser } = require('./a11y-runner');
        const browsers = await Promise.all([getBrowser(), getBrowser(), getBrowser(), getBrowser()]);
        assert.equal(launches, 1);
        assert.ok(browsers.every((b) => b === browsers[0]));
        await getBrowser();
        assert.equal(launches, 1, 'the one up is reused');
    } finally {
        Module._load = load;
        delete require.cache[require.resolve('./a11y-runner')];
    }
});
