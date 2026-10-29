'use strict';

// Real-Chrome checks for how long a step waits after a click. Each case is
// timed, because the bug they guard against was time: a click that does not
// navigate (a toggle, a menu, a theme switch) used to wait out the whole
// navigation timeout, 8 s, before the next step ran; and a click that loads a
// new document returned as soon as its address changed, before the load the
// step had asked for.
//
// Run with `npm run test:dom`. Requires a working Chrome install (via Puppeteer).

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const puppeteer = require('puppeteer');

const { waitForPossibleNavigation } = require('./nav');
const { createWorkflowContext, applyActions } = require('../workflow-engine');

const HOME = `<!doctype html><title>home</title>
<button id="toggle" onclick="document.body.classList.toggle('dark')">Theme</button>
<a id="hash" href="#/route">route</a>
<a id="slow" href="/slow">slow page</a>
<button id="late" onclick="setTimeout(() => history.pushState({}, '', '/later'), 300)">late route</button>
<div id="panels">
  <details><summary>One</summary>1</details>
  <details><summary>Two</summary>2</details>
  <details><summary>Three</summary>3</details>
</div>`;

let server;
let base;
let browser;
let page;

before(async () => {
    server = http.createServer((req, res) => {
        res.setHeader('content-type', 'text/html');
        // Answers late, then holds its load event on an image, so "the address
        // changed" and "the page has loaded" are half a second apart.
        if (req.url === '/slow') {
            setTimeout(() => res.end('<!doctype html><title>slow</title><img src="/img">loaded'), 1200);
            return;
        }
        if (req.url === '/img') {
            setTimeout(() => res.end(''), 500);
            return;
        }
        res.end(HOME);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/`;
    try {
        browser = await puppeteer.launch({ headless: 'new' });
    } catch (e) {
        throw new Error(
            'nav.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n'
            + `Original error: ${e && e.message ? e.message : e}`
        );
    }
});

after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
    page = await browser.newPage();
    await page.goto(base, { waitUntil: 'load' });
});

afterEach(async () => {
    if (page) await page.close().catch(() => {});
});

async function timedClick(selector) {
    const t0 = Date.now();
    const navigated = await waitForPossibleNavigation(page, page.url(), {
        waitUntil: 'load',
        timeout: 8000,
        trigger: () => page.click(selector),
    });
    return { navigated, ms: Date.now() - t0 };
}

describe('waitForPossibleNavigation in Chrome', () => {
    test('a click that does not navigate is done after the grace period, not the timeout', async () => {
        const { navigated, ms } = await timedClick('#toggle');
        assert.equal(navigated, false);
        assert.ok(ms < 2500, `took ${ms}ms; the timeout was 8000ms`);
        assert.equal(await page.evaluate(() => document.body.classList.contains('dark')), true, 'and the click happened');
    });

    test('a client-side route is done as soon as the address changes', async () => {
        const { navigated, ms } = await timedClick('#hash');
        assert.equal(navigated, true);
        assert.ok(ms < 1000, `took ${ms}ms`);
    });

    test('a route that changes the address shortly after the click is still caught', async () => {
        const { navigated } = await timedClick('#late');
        assert.equal(navigated, true);
        assert.equal(await page.evaluate(() => location.pathname), '/later');
    });

    test('a link to a slow page is waited for until that page has loaded', async () => {
        const { navigated, ms } = await timedClick('#slow');
        assert.equal(navigated, true);
        assert.ok(ms >= 1500, `took ${ms}ms: it returned before the image held up the load`);
        assert.equal(await page.evaluate(() => document.readyState), 'complete');
        assert.equal(await page.title(), 'slow');
    });
});

describe('forEachElement in Chrome', () => {
    test('a loop whose targets are used up ends without waiting out its timeout', async () => {
        const ctx = createWorkflowContext({ postStepDelayMs: 0 });
        const t0 = Date.now();
        await applyActions(page, [{
            type: 'forEachElement',
            // Each click takes its target out of the selector, which is what
            // dynamic mode is for: it looks for the next unvisited match.
            targetSelector: '#panels > details:not([open]) > summary',
            dynamic: true,
            timeout: 10000,
            actions: [{ type: 'click', selector: ':ctx', timeout: 10000 }],
        }], [], 0, ctx);
        const ms = Date.now() - t0;

        assert.equal(await page.$$eval('#panels > details[open]', (els) => els.length), 3, 'every panel was opened');
        // Three clicks at about a second each, then the closing check: about
        // 5 s, where it used to be the same plus the 10 s timeout.
        assert.ok(ms < 9000, `took ${ms}ms`);
    });
});
