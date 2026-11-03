'use strict';

// Real-Chrome test: the app itself, served by its server, loads and does its
// main things without a page error. a11y-ui.js's parts live in modules that
// reach the rest through `app`, made as the page boots: one made after the
// code that first used it threw while the page loaded, and every unit test
// still passed. This drives the page as a person would:
// - it loads, and every tab opens;
// - a workflow runs on a small page and ends with its summary;
// - a report opens on the Open report tab, and two in Compare.
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');

const { executeWorkflowRun } = require('../server-side/workflow-run');
const { closeBrowser } = require('../server-side/a11y-runner');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head>'
    + '<body><main><h1>Fixture</h1><img src="/none.png"><a href="#"></a><p>Some text.</p></main></body></html>';

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

let site;
let siteUrl;
let server;
let base;
let browser;
let reportFile;

before(async () => {
    site = http.createServer((req, res) => {
        res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/html' });
        res.end(req.url === '/' ? PAGE : '');
    });
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${site.address().port}/`;

    // A report to open: the same page's run, made here as the runner makes it.
    const { status, payload } = await executeWorkflowRun({ url: siteUrl, actions: [{ type: 'a11yScan', label: 'Fixture', screenshotView: false }] });
    assert.equal(status, 'done');
    reportFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app-boot-')), 'fixture.a11y-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(payload));

    const port = await freePort();
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', A11Y_QUEUE_DIR: `app-boot-spec-${process.pid}` },
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
    await closeBrowser();
    if (server && server.exitCode === null) {
        server.removeAllListeners('exit');
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        await exited;
    }
    fs.rmSync(path.join(ROOT, 'reports', `app-boot-spec-${process.pid}`), { recursive: true, force: true });
    if (reportFile) fs.rmSync(path.dirname(reportFile), { recursive: true, force: true });
    await new Promise((resolve) => site.close(resolve));
});

async function openApp() {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/', { waitUntil: 'networkidle0' });
    return { page, errors };
}

const statusOf = (page, id) => page.$eval(id, (el) => el.textContent.trim());

test('the app loads and every tab opens, with no page error', async () => {
    const { page, errors } = await openApp();
    for (const tab of ['#mode-open', '#mode-compare', '#mode-queue', '#mode-run']) {
        await page.click(tab);
        assert.equal(await page.$eval(tab, (el) => el.getAttribute('aria-selected')), 'true', tab);
    }
    assert.deepEqual(errors, []);
    await page.close();
});

test('a workflow runs and ends with its summary', async () => {
    const { page, errors } = await openApp();
    await page.$eval('#url-input', (el, url) => { el.value = url; el.dispatchEvent(new Event('input', { bubbles: true })); }, siteUrl);
    await page.click('#scan-button');
    // "Finished" comes when the run ends; "Finished: …" once its results
    // are fetched and drawn, which is the summary this test is about.
    await page.waitForFunction(() => /^(Finished:|Workflow failed)/.test(document.querySelector('#statusRun').textContent.trim()), { timeout: 120000 });
    assert.match(await statusOf(page, '#statusRun'), /^Finished:/);
    assert.ok((await page.$$('#results .scan-results-wrapper')).length >= 1, 'its scan is drawn');
    assert.deepEqual(errors, []);
    await page.close();
});

test('a report opens on the Open report tab, and two in Compare', async () => {
    const { page, errors } = await openApp();
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(reportFile);
    await page.waitForFunction(() => document.querySelectorAll('#results .scan-results-wrapper').length >= 1, { timeout: 30000 });
    assert.match(await statusOf(page, '#statusReport'), /loaded/i);

    await page.click('#mode-compare');
    await (await page.$('#compare-input')).uploadFile(reportFile, reportFile);
    await page.waitForFunction(() => document.querySelectorAll('#compare-reports > li').length >= 1, { timeout: 30000 });
    assert.deepEqual(errors, []);
    await page.close();
});

test('the Sort select is as tall as the Hide excluded button beside it', async () => {
    const { page, errors } = await openApp();
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(reportFile);
    await page.waitForSelector('#scan-sort-select', { timeout: 30000 });
    const heights = await page.evaluate(() => ['#scan-sort-select', '#hide-excluded-scans-btn']
        .map((id) => Math.round(document.querySelector(id).getBoundingClientRect().height)));
    assert.equal(heights[0], heights[1], `select ${heights[0]}px, button ${heights[1]}px`);
    assert.deepEqual(errors, []);
    await page.close();
});

test('the Profiles selector hides a scan whose profiles are all off, and shows the others with only the profiles on', async () => {
    // The fixture's scan of WCAG 2.2 AA, beside one of WCAG 2.2 AA and
    // WAI-ARIA 1.2 with a WAI-ARIA requirement of its own.
    const payload = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const wcagOnly = { ...payload.scans[0], id: 'wcag-only', label: 'WCAG only' };
    const both = JSON.parse(JSON.stringify(payload.scans[0]));
    Object.assign(both, {
        id: 'both', label: 'Both',
        profile: { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' },
        profiles: [{ id: 'wcag22-aa', label: 'WCAG 2.2 AA' }, { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' }],
    });
    both.canonical.findings.push({
        id: 'wai-aria-1.2-roles', uid: 'surea11y|surea11y:fail:wai-aria-1.2-roles',
        ruleId: 'wai-aria-1.2-roles', title: 'Roles are valid WAI-ARIA roles', outcome: 'fail', severity: 'serious',
        meta: { atomic: false }, wcag: { sc: [] },
        evidence: { rollup: { profiles: ['wai-aria-1.2'], checksIds: [] } },
        occurrences: [{ target: ['#widget'], html: '<div role="widget"></div>', pageUrl: siteUrl, occurrenceOutcome: 'fail' }],
    });
    const file = path.join(path.dirname(reportFile), 'profiles.a11y-report.json');
    fs.writeFileSync(file, JSON.stringify({ ...payload, scans: [wcagOnly, both] }));

    const { page, errors } = await openApp();
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(file);
    const settle = () => page.waitForFunction(() => document.querySelectorAll('#results .scan-results-wrapper').length >= 2, { timeout: 30000 });
    await settle();

    const chips = () => page.$$eval('#scan-profile-filter .scan-tag-filter__chip', (els) => els.map((el) => ({
        label: el.textContent, on: el.getAttribute('aria-pressed') === 'true', locked: el.getAttribute('aria-disabled') === 'true',
    })));
    const wrapper = (id) => `#results .scan-results-wrapper[data-scan-id="${id}"]`;
    const shows = (id, text) => page.$eval(wrapper(id), (el, t) => el.textContent.includes(t), text);
    const hidden = (id) => page.$eval(wrapper(id), (el) => !!el.closest('.scan-filtered-out') || el.offsetParent === null);
    const press = async (label) => {
        const handles = await page.$$('#scan-profile-filter .scan-tag-filter__chip, #scan-profile-filter .scan-tag-filter__clear');
        for (const h of handles) if ((await h.evaluate((el) => el.textContent)) === label) return h.click();
        throw new Error(`no ${label}`);
    };

    // Every profile shown to begin with.
    assert.deepEqual(await chips(), [
        { label: 'WCAG 2.2 AA', on: true, locked: false },
        { label: 'WAI-ARIA 1.2', on: true, locked: false },
    ]);
    assert.equal(await shows('both', 'Roles are valid WAI-ARIA roles'), true);

    // WAI-ARIA off: the scan of both stays, without WAI-ARIA's results; the
    // last profile on can't be turned off.
    await press('WAI-ARIA 1.2');
    await settle();
    assert.deepEqual(await chips(), [
        { label: 'WCAG 2.2 AA', on: true, locked: true },
        { label: 'WAI-ARIA 1.2', on: false, locked: false },
    ]);
    assert.equal(await hidden('both'), false);
    assert.equal(await shows('both', 'Roles are valid WAI-ARIA roles'), false);

    // Both shown again, then WCAG off: the scan of WCAG alone is hidden.
    await press('Show all');
    await settle();
    await press('WCAG 2.2 AA');
    await settle();
    assert.equal(await hidden('wcag-only'), true);
    assert.equal(await hidden('both'), false);
    assert.equal(await shows('both', 'Roles are valid WAI-ARIA roles'), true);
    assert.deepEqual(errors, []);
    await page.close();
});

test("Ctrl+Z in the workflow keeps focus in the steps it rebuilds, the Profile panel's included", async () => {
    const { page, errors } = await openApp();
    const focused = () => page.evaluate(() => {
        const el = document.activeElement;
        return { tag: el.tagName, text: el.textContent.trim(), inSteps: !!document.querySelector('#actionsContainer').contains(el) };
    });
    // History takes a change once its edits settle (250 ms).
    const recorded = () => new Promise((resolve) => setTimeout(resolve, 400));
    // Two changes to the scan's profiles, the panel left open on a checkbox.
    await page.click('.profiles-input__toggle');
    await page.waitForSelector('.profiles-input__panel:popover-open input[value="en301549-v4.1.1"]', { visible: true });
    const pick = (value) => page.$eval(`.profiles-input input[value="${value}"]`, (el) => el.click());
    await pick('wcag22-aaa');
    await recorded();
    await pick('en301549-v4.1.1');
    await recorded();
    await page.focus('.profiles-input input[value="en301549-v4.1.1"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    await recorded();
    let now = await focused();
    assert.notEqual(now.tag, 'BODY');
    assert.equal(now.inSteps, true);
    assert.equal(now.text, 'Change');
    // From another control of the step.
    await page.evaluate(() => [...document.querySelectorAll('#actionsContainer button')].find((b) => b.textContent.trim() === 'Show more options').focus());
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    await recorded();
    now = await focused();
    assert.equal(now.inSteps, true);
    assert.equal(now.text, 'Show more options');
    assert.deepEqual(errors, []);
    await page.close();
});
