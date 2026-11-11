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
const sharp = require('sharp');

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
        // The home page, and the pages of one template (/products/...).
        const ok = req.url === '/' || /^\/products\/[a-z]+$/.test(req.url);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/html' });
        res.end(ok ? PAGE : '');
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

test('a report\'s JSON opened without its zip says its pictures are in the zip', async () => {
    const payload = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    // As the JSON in a Download report zip names its pictures.
    payload.screenshots = [{ id: 'shot-1', label: 'Shot', dataUrl: 'images/0123456789abcdef0123.jpg' }];
    const file = path.join(path.dirname(reportFile), 'unzipped.a11y-report.json');
    fs.writeFileSync(file, JSON.stringify(payload));

    const { page, errors } = await openApp();
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(file);
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport').textContent), { timeout: 30000 });
    assert.match(await statusOf(page, '#statusReport'), /Its 1 picture came in the zip it was saved in.*open that zip, from Download report/);
    assert.match(await page.$eval('#report-files-list', (el) => el.textContent), /Ready\. Its 1 picture came in the zip/);

    assert.deepEqual(errors, []);
    await page.close();

    // A report with its pictures says nothing of the kind.
    const other = await openApp();
    await other.page.click('#mode-open');
    await (await other.page.$('#resultsFiles')).uploadFile(reportFile);
    await other.page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport').textContent), { timeout: 30000 });
    assert.doesNotMatch(await statusOf(other.page, '#statusReport'), /picture/);
    assert.deepEqual(other.errors, []);
    await other.page.close();
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
    // On the Run tab, whichever tab the last test left open; the steps are
    // drawn once their definitions load, after the page is idle.
    await page.click('#mode-run');
    const toggle = '#actionsContainer .profiles-input__toggle';
    await page.waitForSelector(toggle, { visible: true });
    await page.$eval(toggle, (el) => el.click());
    await page.waitForSelector('.profiles-input__panel:popover-open input[value="en301549-v4.1.1"]', { visible: true });
    const pick = (value) => page.$eval(`#actionsContainer .profiles-input input[value="${value}"]`, (el) => el.click());
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

const STEPS_PANELS = ['#workflow-steps-panel', '#custom-steps-steps-panel'];

/** Each steps panel's filter: its Find text and its pressed kind chip. */
const panelFilters = (page) => page.evaluate((ids) => ids.map((id) => {
    const host = document.querySelector(id);
    return {
        query: host.querySelector('.steps-panel__find').value,
        kind: host.querySelector('.steps-panel__chip[aria-pressed="true"]')?.dataset.kind
    };
}), STEPS_PANELS);

/** Sets a kind and some text in both steps panels' filters, then opens a config file through `inputId`. */
async function filterThenOpenConfig(page, inputId, config) {
    await page.click('#mode-run');
    await page.waitForSelector('#workflow-steps-panel .steps-panel__find');
    await page.evaluate((ids) => ids.forEach((id) => {
        const host = document.querySelector(id);
        host.querySelector('.steps-panel__chip[data-kind="scan"]').click();
        const find = host.querySelector('.steps-panel__find');
        find.value = 'cart';
        find.dispatchEvent(new Event('input', { bubbles: true }));
    }), STEPS_PANELS);
    assert.deepEqual(await panelFilters(page), STEPS_PANELS.map(() => ({ query: 'cart', kind: 'scan' })));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-boot-config-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify(config));
    try {
        await (await page.$(inputId)).uploadFile(file);
        await page.waitForFunction(() => /^(Configuration loaded|Appended|Config appended)/.test(document.querySelector('#statusRun').textContent.trim()));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('loading a config clears the filters of both steps panels', async () => {
    const { page, errors } = await openApp();
    await filterThenOpenConfig(page, '#config-file', { url: siteUrl, state: {} });
    assert.deepEqual(await panelFilters(page), STEPS_PANELS.map(() => ({ query: '', kind: 'all' })));
    assert.deepEqual(errors, []);
    await page.close();
});

test('appending a config clears the filters of both steps panels', async () => {
    const { page, errors } = await openApp();
    await filterThenOpenConfig(page, '#append-config-file', {
        state: { 'actions-workflow': [{ type: 'a11yScan', label: 'Appended' }] }
    });
    assert.deepEqual(await panelFilters(page), STEPS_PANELS.map(() => ({ query: '', kind: 'all' })));
    assert.deepEqual(errors, []);
    await page.close();
});

/**
 * How much of a focused control's outline shows: the share of points along
 * the middle of its straight edges whose colour on screen is the outline's.
 * Something painted over the ring lowers it.
 */
async function ringShown(page, selector) {
    // After a key press, focus() counts as the keyboard's: :focus-visible.
    await page.keyboard.press('Shift');
    await page.$eval(selector, (el) => {
        el.scrollIntoView({ block: 'center' });
        el.focus();
    });
    const ring = await page.$eval(selector, (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
            focused: document.activeElement === el,
            x: r.x, y: r.y, w: r.width, h: r.height,
            width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset),
            radius: parseFloat(cs.borderTopLeftRadius) || 0,
            colour: cs.outlineColor.match(/[\d.]+/g).slice(0, 3).map(Number)
        };
    });
    assert.ok(ring.focused, `${selector} takes focus`);
    const m = ring.offset + ring.width / 2;
    const inset = ring.radius + ring.offset + ring.width + 3;
    const points = [];
    for (let px = ring.x + inset; px <= ring.x + ring.w - inset; px += 2) points.push([px, ring.y - m], [px, ring.y + ring.h + m]);
    for (let py = ring.y + inset; py <= ring.y + ring.h - inset; py += 2) points.push([ring.x - m, py], [ring.x + ring.w + m, py]);
    const { data, info } = await sharp(await page.screenshot({ type: 'png' })).raw().toBuffer({ resolveWithObject: true });
    const shown = points.filter(([px, py]) => {
        const i = (Math.floor(py) * info.width + Math.floor(px)) * info.channels;
        return Math.abs(data[i] - ring.colour[0]) + Math.abs(data[i + 1] - ring.colour[1]) + Math.abs(data[i + 2] - ring.colour[2]) <= 60;
    });
    return shown.length / points.length;
}

test('a focused control shows its whole focus ring, over what is beside it', async () => {
    const { page, errors } = await openApp();
    await page.click('#mode-run');
    await page.waitForSelector('#actionsContainer .line');
    // The Workflow heading's toggles, over the steps panel and the first step
    // below them; Load config, over the chevron beside it.
    for (const selector of ['#workflow-toggle', '#workflow-collapse-all-toggle', '.split-button__action']) {
        assert.ok(await ringShown(page, selector) > 0.95, selector);
    }
    // On a narrow screen Export config wraps under Load config.
    await page.setViewport({ width: 420, height: 900 });
    assert.ok(await ringShown(page, '#save-config-button') > 0.95, '#save-config-button');
    // A button with aria-disabled keeps focus: faded, but not its ring.
    await page.setViewport({ width: 1280, height: 900 });
    await page.click('#mode-queue');
    assert.equal(await page.$eval('#queue-cancel-all', (el) => el.getAttribute('aria-disabled')), 'true');
    assert.ok(await ringShown(page, '#queue-cancel-all') > 0.95, '#queue-cancel-all');
    assert.deepEqual(errors, []);
    await page.close();
});

test('with no custom step chosen, its editor takes neither a click nor the keyboard, until one is', async () => {
    const { page, errors } = await openApp();
    await page.click('#mode-run');
    await page.click('#custom-steps-toggle');
    await page.waitForSelector('#custom-step-toolbar button');
    assert.equal(await page.$eval('#custom-step-actions-builder', (el) => el.classList.contains('is-disabled')), true);
    // Not even focus() reaches its buttons.
    const reachable = await page.$$eval('#custom-step-toolbar button', (buttons) => buttons.filter((b) => {
        b.focus();
        return document.activeElement === b;
    }).length);
    assert.equal(reachable, 0);
    assert.equal(await page.$$eval('#custom-step-actions-container .line', (lines) => lines.length), 0);
    // Once there is one, its toolbar adds steps from the keyboard.
    await page.click('button[aria-label="Add custom step"]');
    await page.waitForFunction(() => !document.querySelector('#custom-step-actions-builder').classList.contains('is-disabled'));
    const scan = await page.evaluateHandle(() => [...document.querySelectorAll('#custom-step-toolbar button')].find((b) => b.textContent.trim() === 'A11y scan'));
    await scan.focus();
    assert.equal(await page.evaluate((b) => document.activeElement === b, scan), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#custom-step-actions-container .line').length === 1);
    assert.deepEqual(errors, []);
    await page.close();
});

test('both steps panels start collapsed on every load, Add custom step in reach outside them', async () => {
    const { page, errors } = await openApp();
    await page.click('#mode-run');
    await page.waitForSelector('#workflow-steps-panel .steps-panel__show');
    const hidden = () => page.evaluate(() => ['#workflow-steps-panel', '#custom-steps-steps-panel'].map((id) => {
        const host = document.querySelector(id);
        return host.querySelector('.steps-panel__full').hidden && !host.querySelector('.steps-panel__rail').hidden;
    }));
    // The app opens with its one scan step, and both panels as a rail.
    assert.equal(await page.$$eval('#actionsContainer > .line', (lines) => lines.length), 1);
    assert.deepEqual(await hidden(), [true, true]);
    // Add custom step is in the editor's toolbar, not in the panel.
    await page.click('#custom-steps-toggle');
    assert.equal(await page.$eval('#custom-step-add-btn', (b) => !b.closest('.steps-panel') && !!b.closest('.custom-step-panel-toolbar') && b.offsetParent !== null), true);
    // Shown, and the page loaded again: folded again.
    await page.click('#workflow-steps-panel .steps-panel__show');
    assert.deepEqual(await hidden(), [false, true]);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#workflow-steps-panel .steps-panel__show');
    assert.deepEqual(await hidden(), [true, true]);
    assert.deepEqual(errors, []);
    await page.close();
});

test('a downloaded HTML report leaves out the review of scan groups and a merged scan\'s actions, and keeps what it stands for', async () => {
    // Three pages of one template, with their pictures, merged in the review.
    const actions = ['a', 'b', 'c'].flatMap((slug) => [
        { type: 'navigate', url: `${siteUrl}products/${slug}` },
        { type: 'a11yScan', label: `Product ${slug}`, screenshotView: true },
    ]);
    const { status, payload } = await executeWorkflowRun({ url: siteUrl, actions });
    assert.equal(status, 'done');
    const dir = path.dirname(reportFile);
    const file = path.join(dir, 'products.a11y-report.json');
    fs.writeFileSync(file, JSON.stringify(payload));
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'app-boot-dl-'));

    const { page, errors } = await openApp();
    page.on('dialog', (d) => d.accept());
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(file);
    await page.waitForSelector('[data-sr-open]', { timeout: 30000 });
    await page.click('[data-sr-open]');
    const node = await page.waitForFunction(() => [...document.querySelectorAll('.sr-node')]
        .find((n) => n.textContent.trim().startsWith('/products/{slug}')));
    await node.click();
    // Merge all 3 pages…, then what it changes, then apply.
    await page.waitForSelector('[data-sr-merge]');
    await page.click('[data-sr-merge]');
    await page.waitForSelector('[data-sr-apply-merge]');
    await page.click('[data-sr-apply-merge]');
    await page.waitForFunction(() => /Shown as 1 scan in the report/.test(document.querySelector('.sr-merge-state')?.textContent || ''));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#results .scan-filmstrip', { timeout: 30000 });
    // In the app: the review's card and the buttons into it, and the merged
    // scan's own actions.
    assert.ok(await page.$('#summary .sr-card'), 'the app shows the card');
    assert.ok(await page.$('#results button.scan-filmstrip__page'), 'the app\'s pictures open the review');
    assert.deepEqual(await page.$$eval('#results .scan-merged-actions button', (bs) => bs.map((b) => b.firstChild.textContent)), ['Review this group', 'Unmerge…']);
    // Unmerge… opens the review on what unmerging changes; cancelled, nothing changes.
    await page.click('#results [data-sr-unmerge]');
    await page.waitForFunction(() => document.activeElement?.matches('[data-sr-apply-merge]'));
    await page.click('[data-sr-cancel-merge]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.sr-dialog[open]'));
    assert.ok(await page.$('#results .scan-filmstrip'), 'still merged');

    const item = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^Download as a single file/.test(b.textContent.trim())));
    await item.evaluate((b) => b.click());
    await page.waitForSelector('dialog.report-name-dialog[open]');
    await page.click('dialog.report-name-dialog button[type="submit"]');
    let html = null;
    for (let i = 0; i < 160 && !html; i++) {
        const name = fs.readdirSync(downloads).find((f) => f.endsWith('.html'));
        if (name) html = fs.readFileSync(path.join(downloads, name), 'utf8');
        else await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(html, 'downloaded');

    // Read as the file a person opens: the review is not in it...
    const doc = await browser.newPage();
    await doc.setContent(html, { waitUntil: 'domcontentloaded' });
    const found = await doc.evaluate(() => ({
        card: document.querySelectorAll('.sr-card').length,
        intoReview: document.querySelectorAll('[data-sr-open], [data-sr-open-group], [data-sr-film]').length,
        filmButtons: document.querySelectorAll('button.scan-filmstrip__page').length,
        pictures: document.querySelectorAll('span.scan-filmstrip__page img').length,
        merged: (document.querySelector('.scan-contexts') || {}).textContent || '',
        actions: document.querySelectorAll('.scan-merged-actions, [data-sr-unmerge]').length,
        onPages: [...document.querySelectorAll('.issue-pages')].map((el) => el.textContent),
    }));
    assert.equal(found.card, 0, 'no review card');
    assert.equal(found.intoReview, 0, 'nothing opens the review');
    assert.equal(found.filmButtons, 0, 'its pictures are not buttons');
    assert.equal(found.actions, 0, 'no Review this group or Unmerge');
    // ...and what the merged scan stands for is.
    assert.equal(found.pictures, 3, 'the merged scan\'s pages, as pictures');
    assert.match(found.merged, /Merged from 3 scans of \/products\/\{slug\}: Product a; Product b; Product c\./);
    // Each failure of the merged scan says on how many of its pages it is.
    assert.ok(found.onPages.length > 0, 'its failures say on how many pages');
    assert.ok(found.onPages.every((t) => /^On (all 3|[12] of 3) pages$/.test(t)), found.onPages.join(', '));
    await doc.close();

    assert.deepEqual(errors, []);
    fs.rmSync(downloads, { recursive: true, force: true });
    await page.close();
});
