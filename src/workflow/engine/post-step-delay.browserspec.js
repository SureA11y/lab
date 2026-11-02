'use strict';

// Real-Chrome checks for the settle after a step (post-step-delay.js): a
// quiet page goes on at once, a page still changing is waited on until it
// stops, and one that never stops no longer than the cap.
//
// Run with `npm run test:dom`. Requires a working Chrome install (via Puppeteer).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { settlePage, POST_STEP_DELAY } = require('./post-step-delay');

let browser;
let page;

before(async () => {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    page = await browser.newPage();
});

after(async () => {
    await browser?.close();
});

async function timed(fn) {
    const t = Date.now();
    await fn();
    return Date.now() - t;
}

test('a quiet page goes on after a short look, not the old fixed pause', async () => {
    await page.setContent('<p>quiet</p>');
    const ms = await timed(() => settlePage(page));
    assert.ok(ms < 350, `${ms} ms`);
});

test('a page still changing is waited on until it stops', async () => {
    await page.setContent('<p id="p">0</p>');
    await page.evaluate(() => {
        let n = 0;
        const t = setInterval(() => { document.getElementById('p').textContent = String(++n); if (n === 5) clearInterval(t); }, 40);
    });
    const ms = await timed(() => settlePage(page));
    const final = await page.$eval('#p', (el) => el.textContent);
    assert.equal(final, '5', 'it waited for the changes to end');
    assert.ok(ms >= 200, `${ms} ms`);
});

test('a page that never stops changing is waited on no longer than the cap', async () => {
    await page.setContent('<p id="p">0</p>');
    await page.evaluate(() => { let n = 0; setInterval(() => { document.getElementById('p').textContent = String(++n); }, 20); });
    const ms = await timed(() => settlePage(page));
    assert.ok(ms >= POST_STEP_DELAY - 50 && ms < POST_STEP_DELAY + 300, `${ms} ms`);
});
