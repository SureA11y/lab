'use strict';

// Real-Chrome test: a standard the lab has no code of its own for, from its
// pack alone. test-fixtures/pack-sample is the pack core's generator writes
// (surea11y-pack new --kind standard); installed through A11Y_PACKS, the lab
// should:
// - offer its profiles in the scan step, and scan against them;
// - list it at /api/standards, with its requirements;
// - ask its requirements of its own in Review conformance, with their
//   procedures, and keep the answers;
// - list them in the manual review checklist, and leave them out of the
//   VPAT, which is WCAG's and EN 301 549's.
// Needs a core with test procedures; skips with one without.
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

process.env.A11Y_PACKS = './test-fixtures/pack-sample';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');
const HAS_PROCEDURES = typeof require('@surea11y/core').listProcedures === 'function';
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head>'
    + '<body><main><h1>Fixture</h1><p><a href="/next" target="_blank">More</a></p><img src="/none.png"></main></body></html>';

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
let payload;

before(async () => {
    if (!HAS_PROCEDURES) return;
    process.chdir(ROOT);
    const { executeWorkflowRun } = require('../server-side/workflow-run');
    site = http.createServer((req, res) => {
        res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/html' });
        res.end(req.url === '/' ? PAGE : '');
    });
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    const run = await executeWorkflowRun({
        url: `http://127.0.0.1:${site.address().port}/`,
        actions: [{ type: 'a11yScan', label: 'Fixture', profile: 'sample-1.0', screenshotView: false }],
    });
    assert.equal(run.status, 'done');
    payload = run.payload;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-packs-'));
    reportFile = path.join(tmp, 'fixture.a11y-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(payload));

    const port = await freePort();
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', A11Y_QUEUE_DIR: `standard-packs-spec-${process.pid}` },
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
    if (HAS_PROCEDURES) await require('../server-side/a11y-runner').closeBrowser();
    if (server && server.exitCode === null) {
        server.removeAllListeners('exit');
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        await exited;
    }
    fs.rmSync(path.join(ROOT, 'reports', `standard-packs-spec-${process.pid}`), { recursive: true, force: true });
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (site) await new Promise((resolve) => site.close(resolve));
});

const skip = !HAS_PROCEDURES && 'the installed core has no test procedures';

test('a scan against the sample standard\'s profile names its requirements', { skip }, () => {
    const scan = payload.scans[0];
    assert.equal(scan.profile.id, 'sample-1.0');
    assert.match(scan.profile.label, /^Sample Standard 1\.0/);
    const named = scan.canonical.findings.flatMap((f) => (f.standards?.normativeMappings || []).map((m) => m.standard));
    assert.ok(named.includes('Sample Standard'), named.join(', '));
});

test('the server lists the sample standard and offers its profiles', { skip }, async () => {
    const { standards } = await (await fetch(`${base}/api/standards`)).json();
    const sample = standards.find((s) => s.key === 'sample');
    assert.ok(sample, 'listed');
    assert.deepEqual(sample.versions, ['1.0']);
    assert.ok(sample.listings['1.0'].requirements.length >= 2);
    const defs = await (await fetch(`${base}/workflows/actions`)).json();
    const options = (defs.a11yScan || defs.actions?.a11yScan).fields.profile.options.map((o) => o.value);
    assert.ok(options.includes('sample-1.0') && options.includes('en301549-v4.1.1'), options.join(', '));
});

test('Review conformance asks its requirements of its own, and the checklist lists them', { skip }, async () => {
    const downloads = fs.mkdtempSync(path.join(tmp, 'dl-'));
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

    // Its findings' pills name its requirements, by the standard's name.
    const shownPills = await page.$$eval('#results .tag-pill', (els) => els.map((e) => e.textContent.trim()));
    assert.ok(shownPills.some((t) => /^Sample Standard \d/.test(t)), shownPills.join(', '));

    const review = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^Review conformance$/.test(b.textContent.trim())));
    await review.click();
    await page.waitForSelector('.acr-row[data-standard="sample"] .how-assess', { timeout: 30000 });
    const sections = await page.$$eval('.acr-section[data-standard="sample"]', (els) => els.map((s) => ({
        title: s.querySelector('.acr-section-title').textContent,
        rows: [...s.querySelectorAll('.acr-row')].map((r) => [r.dataset.key, !!r.querySelector('.how-assess')]),
    })));
    assert.ok(sections.length >= 1 && sections.every((s) => /^Sample Standard 1\.0: /.test(s.title)), JSON.stringify(sections));
    const rows = sections.flatMap((s) => s.rows);
    assert.ok(rows.every(([, how]) => how), 'each says how to check it');
    const key = rows[0][0];

    const row = `.acr-row[data-standard="sample"][data-key="${key}"]`;
    await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        r.closest('.acr-section').open = true;
        r.querySelector('.how-assess').open = true;
    }, row);
    for (const r of await page.$$(`${row} input[type=radio][value="pass"]`)) await r.click();
    await page.click(`${row} [data-acr-use]`);
    assert.equal(await page.$eval(`${row} [data-part="conformance"]`, (el) => el.value), 'supports');
    await page.click('[data-acr-close]');

    const item = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^Manual review checklist/.test(b.textContent.trim())));
    await item.evaluate((b) => b.click());
    let checklist = null;
    for (let i = 0; i < 80 && !checklist; i++) {
        const name = fs.readdirSync(downloads).find((f) => f.endsWith('checklist.html'));
        if (name) checklist = fs.readFileSync(path.join(downloads, name), 'utf8');
        else await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(checklist, 'downloaded');
    assert.match(checklist, /<h2 id="t-std-sample-[^"]+">Sample Standard 1\.0: /);
    assert.match(checklist, /requirements of Sample Standard 1\.0/);

    const vpat = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^Conformance report(?!.*Word)/.test(b.textContent.trim())));
    await vpat.evaluate((b) => b.click());
    let acr = null;
    for (let i = 0; i < 80 && !acr; i++) {
        const name = fs.readdirSync(downloads).find((f) => f.endsWith('conformance report.html'));
        if (name) acr = fs.readFileSync(path.join(downloads, name), 'utf8');
        else await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(acr, 'downloaded');
    // Its tables and the standards it covers are WCAG's and EN 301 549's;
    // only its evaluation methods name what the scans checked against.
    assert.ok(!/<(h2|caption|th|td)\b[^>]*>[^<]*Sample Standard/.test(acr), 'the VPAT is WCAG\'s and EN 301 549\'s');
    assert.match(acr, /Automated checks with surea11y [\d.]+ against Sample Standard 1\.0 \(sample-1\.0\), not against WCAG\./);
    assert.deepEqual(errors, []);
    await page.close();
});
