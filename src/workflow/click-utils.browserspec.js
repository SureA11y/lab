'use strict';

// Real-Chrome integration tests for click-utils.js.
//
// Why real Chrome, not mocks: every function here decides what to do based on real layout
// (getBoundingClientRect, elementFromPoint hit-testing) and real input dispatch (CDP mouse
// events, DOM click()). A hand-rolled page/element mock can't reproduce hit-testing/occlusion
// or event dispatch faithfully, so it would prove nothing about the actual bug-prone behavior.
//
// This file is intentionally NOT named *.test.js so `node --test` (the default `npm test`)
// never picks it up and never depends on a working Chrome install. Run explicitly via:
//   npm run test:dom
// If Chrome can't launch, the `before()` hook throws and the whole file fails loudly - it does
// not skip silently.
//
// Coverage caveat: `npm run test:dom:coverage` will always understate real coverage for
// click-utils.js. Most of its logic runs inside callbacks passed to page.evaluate()/
// handle.evaluate() (e.g. clickViaMouseAtVerifiedPoint's elementFromPoint probing), which get
// serialized and actually execute inside Chrome's own V8 isolate via CDP, not in the Node.js
// process - so Node's coverage instrumentation has no visibility into them at all, even though
// the tests below genuinely exercise that code (that's what the real-DOM assertions verify).
// The reported uncovered line ranges for those callback bodies are a blind spot in what the
// tool can measure, not a gap in what's actually tested.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { clickViaMouseAtVerifiedPoint, activateClickHandle } = require('./click-utils');

let browser;
let page;

before(async () => {
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (e) {
        throw new Error(
            `click-utils.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n` +
            `Original error: ${e && e.message ? e.message : e}`
        );
    }
});

after(async () => {
    if (browser) await browser.close().catch(() => {});
});

beforeEach(async () => {
    page = await browser.newPage();
});

afterEach(async () => {
    if (page) await page.close().catch(() => {});
});

async function setHtml(html) {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
}

async function clickCount() {
    return page.evaluate(() => window.__clicks || 0);
}

describe('clickViaMouseAtVerifiedPoint', () => {
    test('clicks a normal, unobstructed, visible button', async () => {
        await setHtml(`<button id="btn" onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>`);
        const handle = await page.$('#btn');
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 1000);
        assert.equal(ok, true);
        assert.equal(await clickCount(), 1);
    });

    test('fails (false) within the timeout when the button is fully covered by an overlay', async () => {
        await setHtml(`
            <div style="position:relative">
                <button id="btn" style="width:100px;height:40px"
                    onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
                <div id="overlay" style="position:absolute; inset:0; background:rgba(0,0,0,0.01)"></div>
            </div>
        `);
        const handle = await page.$('#btn');
        const started = Date.now();
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 300);
        assert.equal(ok, false);
        assert.equal(await clickCount(), 0);
        assert.ok(Date.now() - started >= 280, 'should have actually waited out the timeout, not bailed early');
    });

    test('gives up after about half a second when the same overlay stays still over the button', async () => {
        await setHtml(`
            <div style="position:relative">
                <button id="btn" style="width:100px;height:40px"
                    onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
                <div id="overlay" style="position:absolute; inset:0; background:rgba(0,0,0,0.01)"></div>
            </div>
        `);
        const handle = await page.$('#btn');
        const started = Date.now();
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 3000);
        const ms = Date.now() - started;
        assert.equal(ok, false);
        assert.equal(await clickCount(), 0);
        assert.ok(ms >= 450 && ms < 1500, `took ${ms}ms; the timeout was 3000ms`);
    });

    test('keeps retrying while the overlay moves, and clicks once it is out of the way', async () => {
        // A panel sliding off the button, then removed: never the same for
        // half a second, so the retry must not give up on it.
        await setHtml(`
            <div style="position:relative">
                <button id="btn" style="width:100px;height:40px"
                    onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
                <div id="overlay" style="position:absolute; inset:0; background:#fff"></div>
            </div>
            <script>
                const o = document.getElementById('overlay');
                let x = 0;
                const t = setInterval(() => {
                    x += 2;
                    o.style.transform = 'translateX(' + x + 'px)';
                    if (x >= 200) { clearInterval(t); o.remove(); }
                }, 10);
            </script>
        `);
        const handle = await page.$('#btn');
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 3000);
        assert.equal(ok, true);
        assert.equal(await clickCount(), 1);
    });

    test('succeeds via one of the off-center sample points when only the exact center is covered', async () => {
        // The function samples the center plus 4 offset points; a small overlay pinned to the
        // exact center should still leave the offset points hittable.
        await setHtml(`
            <div style="position:relative">
                <button id="btn" style="width:200px;height:100px"
                    onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
                <div id="overlay" style="position:absolute; left:50%; top:50%;
                    width:6px; height:6px; transform:translate(-50%,-50%); background:red"></div>
            </div>
        `);
        const handle = await page.$('#btn');
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 1000);
        assert.equal(ok, true);
        assert.equal(await clickCount(), 1);
    });

    test('accepts a hit-test point that lands on a child element inside the target button', async () => {
        await setHtml(`
            <button id="btn" style="position:relative; width:180px; height:60px"
                onclick="window.__clicks=(window.__clicks||0)+1">
                Set and reload
                <span style="position:absolute; inset:0; display:block"></span>
            </button>
        `);
        const handle = await page.$('#btn');
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 1000);
        assert.equal(ok, true);
        assert.equal(await clickCount(), 1);
    });

    test('fails (false) quickly for a display:none element (no rect)', async () => {
        await setHtml(`<button id="btn" style="display:none" onclick="window.__clicks=1">Click me</button>`);
        const handle = await page.$('#btn');
        const ok = await clickViaMouseAtVerifiedPoint(page, handle, 250);
        assert.equal(ok, false);
        assert.equal(await clickCount(), 0);
    });
});

describe('activateClickHandle', () => {
    test('happy path: fires a real click on a normal visible button', async () => {
        await setHtml(`<button id="btn" onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>`);
        const handle = await page.$('#btn');
        await activateClickHandle({ page, handle, label: 'btn', timeoutMs: 1000 });
        assert.equal(await clickCount(), 1);
    });

    test('programmatic:true fires via DOM click() specifically (no real mouse event dispatched)', async () => {
        await setHtml(`
            <button id="btn"
                onclick="window.__clicks=(window.__clicks||0)+1"
                onmousedown="window.__mousedown=true">Click me</button>
        `);
        const handle = await page.$('#btn');
        await activateClickHandle({ page, handle, label: 'btn', timeoutMs: 1000, programmatic: true });
        assert.equal(await clickCount(), 1);
        assert.equal(await page.evaluate(() => window.__mousedown || false), false);
    });

    // Puppeteer's Mouse.click() reads options.count to decide how many click cycles to dispatch
    // and ignores clickCount, so clickViaMouseAtVerifiedPoint must pass `count` for a real
    // double-click (page.mouse.click(x, y, { clickCount: 2 }) only fires a single down/up pair).
    test('clickKind "doubleClick" fires a real dblclick event', async () => {
        await setHtml(`
            <button id="btn" ondblclick="window.__dblclicks=(window.__dblclicks||0)+1">Click me</button>
        `);
        const handle = await page.$('#btn');
        await activateClickHandle({ page, handle, label: 'btn', timeoutMs: 1000, clickKind: 'doubleClick' });
        assert.equal(await page.evaluate(() => window.__dblclicks || 0), 1);
    });

    test('scrollIntoView: false leaves the scroll position untouched (programmatic click)', async () => {
        await setHtml(`
            <div style="height:3000px"></div>
            <button id="btn" onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
        `);
        const handle = await page.$('#btn');
        await activateClickHandle({ page, handle, label: 'btn', timeoutMs: 1000, programmatic: true, scrollIntoView: false });
        assert.equal(await clickCount(), 1);
        assert.equal(await page.evaluate(() => window.scrollY), 0);
    });

    test('scrollIntoView defaults to true and scrolls an off-screen target into view', async () => {
        await setHtml(`
            <div style="height:3000px"></div>
            <button id="btn" onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
        `);
        const handle = await page.$('#btn');
        await activateClickHandle({ page, handle, label: 'btn', timeoutMs: 1000, programmatic: true });
        assert.equal(await clickCount(), 1);
        assert.ok(await page.evaluate(() => window.scrollY) > 0);
    });

    // handle.click() resolves WITHOUT throwing even when the click never reaches the element -
    // e.g. pointer-events:none, or an element covered by an overlay - so "no exception" can't be
    // trusted as success. activateClickHandle instruments the element to verify the click actually
    // landed before trusting handle.click(); this covers any occluded element (overlays, modals,
    // sticky headers, cookie banners), not just pointer-events:none.
    test('falls back to keyboard activation when the element is pointer-events:none (mouse hit-testing can never land)', async () => {
        await setHtml(`
            <button id="btn" style="pointer-events:none"
                onclick="window.__clicks=(window.__clicks||0)+1">Click me</button>
        `);
        const handle = await page.$('#btn');
        await activateClickHandle({ page, handle, label: 'btn', timeoutMs: 300 });
        assert.equal(await clickCount(), 1);
    });

    test('right-click mode does not throw against a normal button (context-menu path)', async () => {
        await setHtml(`<button id="btn">Right click me</button>`);
        const handle = await page.$('#btn');
        await assert.doesNotReject(() =>
            activateClickHandle({ page, handle, label: 'btn', timeoutMs: 500, mouseButton: 'right' })
        );
    });
});
