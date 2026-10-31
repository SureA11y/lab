'use strict';

// Real-Chrome test: checking by hand with core's test procedures, through
// the app as a person does it. With a core that has them:
// - Review conformance shows each criterion's checks, which take answers;
// - answering all of a criterion's checks suggests its level, and Use it
//   sets it, with remarks;
// - the manual review checklist and the conformance report carry the
//   answers.
// With a core that has none (the published one, as CI has it), none of it
// shows and nothing fails.
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
    + '<body><main><h1>Fixture</h1><p>Some text.</p></main></body></html>';
const HAS_PROCEDURES = typeof require('@surea11y/core').proceduresFor === 'function';
// EN 301 549's own requirements come from its pack, when the pack has them.
// Whether the EN 301 549 pack gives procedures of its own: any requirement
// it lists that restates no WCAG criterion.
const HAS_EN_PROCEDURES = (() => {
    const core = require('@surea11y/core');
    if (typeof core.listProcedures !== 'function') return false;
    const pack = require('../server-side/standard-packs').packForStandard('en301549');
    const listing = pack && core.listProcedures({ packs: [pack], standard: 'en301549' });
    return !!(listing && listing.requirements.some((r) => !r.wcag));
})();

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
let server;
let base;
let browser;
let tmp;
let reportFile;

before(async () => {
    site = http.createServer((req, res) => {
        res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/html' });
        res.end(req.url === '/' ? PAGE : '');
    });
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    const siteUrl = `http://127.0.0.1:${site.address().port}/`;

    const { status, payload } = await executeWorkflowRun({ url: siteUrl, actions: [{ type: 'a11yScan', label: 'Fixture', screenshotView: false }] });
    assert.equal(status, 'done');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-procedures-'));
    reportFile = path.join(tmp, 'fixture.a11y-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(payload));

    const port = await freePort();
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', A11Y_QUEUE_DIR: `conformance-procedures-spec-${process.pid}` },
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
    fs.rmSync(path.join(ROOT, 'reports', `conformance-procedures-spec-${process.pid}`), { recursive: true, force: true });
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    await new Promise((resolve) => site.close(resolve));
});

// The app with the report open, downloads going to `downloads`.
async function openReport(downloads) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.goto(base + '/', { waitUntil: 'networkidle0' });
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(reportFile);
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport')?.textContent || ''), { timeout: 60000 });
    return { page, errors };
}

const buttonNamed = (page, pattern) => page.evaluateHandle((source) => {
    const re = new RegExp(source);
    return [...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim())) || null;
}, pattern.source);

async function download(page, downloads, itemPattern, filePattern) {
    const item = await buttonNamed(page, itemPattern);
    assert.ok(await item.evaluate((b) => !!b), `the Download menu has ${itemPattern}`);
    await item.evaluate((b) => b.click());
    for (let i = 0; i < 80; i++) {
        const name = fs.readdirSync(downloads).find((f) => filePattern.test(f) && !f.endsWith('.crdownload'));
        if (name) return fs.readFileSync(path.join(downloads, name), 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`no ${filePattern} downloaded`);
}

// The procedures are core's and the packs': these tests take whichever
// requirement the review shows with checks, and what the pack lists, so a
// change there is shown, not a failure here.

// A review row to answer: the first of `sections` whose draft is no failure
// and that has at least `min` checks. Its data-key, and its requirement id.
function pickRow(page, sections, min) {
    return page.evaluate((secs, least) => {
        for (const sec of document.querySelectorAll('.acr-section')) {
            if (!secs.some((s) => sec.dataset.section.startsWith(s))) continue;
            for (const row of sec.querySelectorAll('.acr-row')) {
                const checks = row.querySelectorAll('.how-facets > li').length;
                if (checks >= least && !/Does Not Support/.test(row.querySelector('.acr-draft')?.textContent || '')) {
                    return { key: row.dataset.key, table: row.dataset.table, id: row.querySelector('[data-acr-how]').dataset.acrHow, checks };
                }
            }
        }
        return null;
    }, sections, min);
}

const rowSel = (r) => `.acr-row[data-table="${r.table}"][data-key="${r.key}"]`;
const headingId = (prefix, id) => `h-${prefix}${String(id).replace(/[^A-Za-z0-9_-]/g, '-')}`;

test('with procedures: answer a criterion by hand, take the suggestion, and download the answers', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const downloads = fs.mkdtempSync(path.join(tmp, 'dl-'));
    const { page, errors } = await openReport(downloads);

    await (await buttonNamed(page, /^Review conformance$/)).click();
    await page.waitForSelector('.acr-row[data-standard="wcag"] .how-assess', { timeout: 30000 });
    const picked = await pickRow(page, ['wcag-'], 2);
    assert.ok(picked, 'a criterion with two checks or more, not failed by the scans');
    const row = rowSel(picked);
    await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        r.closest('.acr-section').open = true;
        r.querySelector('.how-assess').open = true;
    }, row);

    // Every check passes but the last, which fails: Partially Supports.
    const passes = await page.$$(`${row} input[type=radio][value="pass"]`);
    for (const r of passes.slice(0, -1)) await r.click();
    const fails = await page.$$(`${row} input[type=radio][value="fail"]`);
    await fails[fails.length - 1].click();

    const answered = await page.$eval(`${row} [data-how-answered]`, (el) => el.textContent);
    assert.match(answered, new RegExp(`${picked.checks} of ${picked.checks} answered`));
    assert.match(await page.$eval(`${row} [data-acr-suggest]`, (el) => el.textContent), /suggest: Partially Supports/);

    await page.click(`${row} [data-acr-use]`);
    const after = await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        return {
            level: r.querySelector('[data-part="conformance"]').value,
            remarks: r.querySelector('[data-part="remarks"]').value,
            status: document.querySelector('[data-acr-status]').textContent,
            focused: document.activeElement === r.querySelector('[data-part="conformance"]'),
        };
    }, row);
    assert.equal(after.level, 'partiallySupports');
    assert.match(after.remarks, /^Checked by hand, \d+ checks: 1 fails, \d+ pass(es)?\.$/);
    assert.match(after.status, /set to Partially Supports, with remarks from your answers/);
    assert.ok(after.focused, 'focus on the level it set');
    await page.click('[data-acr-close]');

    const checklist = await download(page, downloads, /^Manual review checklist/, /manual review checklist\.html$/);
    assert.ok(checklist.includes(`<h3 id="${headingId('', picked.id)}">${picked.id} `), 'the criterion is in it');
    assert.match(checklist, /Recorded so far:<\/span> Partially Supports/);
    assert.equal((checklist.match(/ checked\/>/g) || []).length, picked.checks, 'its answers are ticked');

    const acr = await download(page, downloads, /^Conformance report(?!.*Word)/, /conformance report\.html$/);
    assert.match(acr, /Checked by hand:<\/p><ul class="checks">/);
    assert.match(acr, /answered, on 1 WCAG criterion/);

    assert.deepEqual(errors, []);
    await page.close();
});

test('with the pack\'s procedures: EN 301 549\'s own requirements are answered too, and listed in the checklist', { skip: !HAS_EN_PROCEDURES && 'the installed pack has no procedures of its own' }, async () => {
    const downloads = fs.mkdtempSync(path.join(tmp, 'dl-'));
    const { page, errors } = await openReport(downloads);
    await (await buttonNamed(page, /^Review conformance$/)).click();
    await page.waitForSelector('.acr-row[data-standard="en301549"] .how-assess', { timeout: 30000 });

    // What the pack lists of its own, for the version the report targets.
    const { standards } = await (await fetch(`${base}/api/standards`)).json();
    const version = await page.evaluate(() => globalThis.A11Y_CONFORMANCE_REPORT.buildConformanceReport({ scans: [] }).target.en301549);
    const listing = standards.find((s) => s.key === 'en301549').listings[version];
    const own = listing.requirements.filter((r) => !r.wcag).map((r) => String(r.id));
    const nine = listing.groups.find((g) => g.id === '9');
    const ownOfNine = own.filter((id) => nine && JSON.stringify(nine).includes(`"${id}"`));

    const shown = await page.$$eval('.acr-section[data-standard="en301549"] .acr-row', (rows) => rows.map((r) => [r.dataset.table, r.querySelector('[data-acr-how]').dataset.acrHow, !!r.querySelector('.how-assess')]));
    assert.deepEqual(shown.map(([, id]) => id).sort(), [...own].sort(), 'every requirement of its own the pack lists, once');
    assert.ok(shown.every(([, , how]) => how), 'each says how to check it');
    assert.deepEqual(shown.filter(([t]) => t === 'en-9').map(([, id]) => id).sort(), ownOfNine.sort(), 'of chapter 9, its own requirements only');

    const picked = await pickRow(page, ['en-'], 1);
    assert.ok(picked, 'a requirement of its own with checks');
    const row = rowSel(picked);
    await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        r.closest('.acr-section').open = true;
        r.querySelector('.how-assess').open = true;
    }, row);
    for (const r of await page.$$(`${row} input[type=radio][value="na"]`)) await r.click();
    assert.match(await page.$eval(`${row} [data-acr-suggest]`, (el) => el.textContent), /suggest: Not Applicable/);
    await page.click(`${row} [data-acr-use]`);
    assert.equal(await page.$eval(`${row} [data-part="conformance"]`, (el) => el.value), 'notApplicable');
    await page.click('[data-acr-close]');

    const checklist = await download(page, downloads, /^Manual review checklist/, /manual review checklist\.html$/);
    assert.match(checklist, /requirements of its own/);
    for (const id of own) assert.ok(checklist.includes(`id="${headingId('en-', id)}"`), `${id} is in it`);

    const acr = await download(page, downloads, /^Conformance report(?!.*Word)/, /conformance report\.html$/);
    assert.match(acr, /EN 301 549 requirement of its own, each listed under its row/);
    assert.deepEqual(errors, []);
    await page.close();
});

test('without procedures: nothing of them shows, and the review works as before', { skip: HAS_PROCEDURES && 'the installed core has test procedures' }, async () => {
    const downloads = fs.mkdtempSync(path.join(tmp, 'dl-'));
    const { page, errors } = await openReport(downloads);
    assert.equal(await (await buttonNamed(page, /^Manual review checklist/)).evaluate((b) => !!b), false, 'no checklist offered');
    await (await buttonNamed(page, /^Review conformance$/)).click();
    await page.waitForSelector('#acr-review-dialog .acr-row');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(await page.$$eval('#acr-review-dialog .how-assess', (els) => els.length), 0);
    assert.deepEqual(errors, []);
    await page.close();
});
