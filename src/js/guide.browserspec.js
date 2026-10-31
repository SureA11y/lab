'use strict';

// Real-Chrome test: the testing guide (guide.html), served by the lab, as a
// person uses it. With a core that has test procedures:
// - the app's header links to it, in a tab of its own;
// - an address with a requirement opens the guide there, its heading focused;
// - the filters narrow it, and the address keeps them;
// - another standard (EN 301 549's pack) loads in it;
// - "Save as a page" gives core's page of the same procedures.
// With one that has none, the header has no link and the guide says so.
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');
const HAS_PROCEDURES = typeof require('@surea11y/core').listProcedures === 'function';

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

let server;
let base;
let browser;

before(async () => {
    const port = await freePort();
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', A11Y_QUEUE_DIR: `guide-spec-${process.pid}` },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    base = `http://127.0.0.1:${port}`;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the server did not start')), 30000);
        server.stdout.on('data', (chunk) => {
            if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); }
        });
        server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the server exited (${code})`)); });
    });
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
});

after(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
        server.removeAllListeners('exit');
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        await exited;
    }
    require('node:fs').rmSync(path.join(ROOT, 'reports', `guide-spec-${process.pid}`), { recursive: true, force: true });
});

async function open(url) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + url, { waitUntil: 'networkidle0' });
    return { page, errors };
}

const statusOf = (page) => page.$eval('#guide-status', (el) => el.textContent);
const settled = (page, pattern) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-status').textContent), { timeout: 30000 }, pattern.source);

test('the app\'s header links to the guide when there is one to show', async () => {
    const { page, errors } = await open('/');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const link = await page.$eval('#guide-link', (a) => ({ hidden: a.hidden, href: a.getAttribute('href'), target: a.target, name: a.getAttribute('aria-label') }));
    assert.equal(link.hidden, !HAS_PROCEDURES);
    assert.equal(link.href, '/guide');
    assert.equal(link.target, '_blank');
    assert.match(link.name, /opens in a new tab/);
    assert.deepEqual(errors, []);
    await page.close();
});

test('opened at a requirement, the guide shows it with its heading focused; filters narrow it, and the address keeps them', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag&id=1.4.12');
    await settled(page, /checks\./);
    assert.match(await statusOf(page), /^WCAG 2\.2, Level A and AA: 55 criteria, \d+ checks\.$/);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '1.4.12 Text Spacing');
    assert.ok(await page.$$eval('#reqh-1-4-12 ~ .guide-facets > li', (els) => els.length) >= 2);

    await page.click('input[name="tool"][value="screen-reader"]');
    await settled(page, /of 55 criteria shown/);
    assert.match(page.url(), /tools=screen-reader/);
    await page.click('input[name="automation"][value="person"]');
    await settled(page, /of 55 criteria shown/);
    assert.match(page.url(), /automation=person/);

    await page.select('#guide-standard', 'en301549');
    await settled(page, /^EN 301 549 V4\.1\.1: /);
    assert.ok(await page.$('#reqh-4-2-1'), 'EN 301 549\'s own requirements, from its pack');
    assert.deepEqual(errors, []);
    await page.close();
});

test('"Save as a page" gives core\'s page of the same procedures', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page } = await open('/guide?standard=wcag&levels=A');
    await settled(page, /checks\./);
    const href = await page.$eval('#guide-save', (a) => a.getAttribute('href'));
    assert.match(href, /^\/api\/procedures\/page\?standard=wcag&version=2\.2&levels=A$/);
    const res = await fetch(base + href);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename=".+testing guide\.html"/);
    assert.match(await res.text(), /^<!doctype html>/i);
    await page.close();
});

test('with a core without procedures, the guide says there is nothing to show', { skip: HAS_PROCEDURES && 'the installed core has test procedures' }, async () => {
    const { page, errors } = await open('/guide');
    await settled(page, /No test procedures/);
    assert.match(await page.$eval('#guide-content', (el) => el.textContent), /has no test procedures/);
    assert.deepEqual(errors, []);
    await page.close();
});
