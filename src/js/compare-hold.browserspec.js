'use strict';

// Real-Chrome test: Compare takes one load at a time (a11y-ui.js,
// runCompareLoad). A load adds its reports over many frames, so while one is
// under way everything else that changes the comparison is held: another
// batch's Send to Compare, the batch's own Delete, Load reports and dropping
// files, the Compare button of the Report tab, Remove all, removing or moving
// a report, what the reports are, and Download. Held controls stay focusable,
// read as unavailable and say why when pressed; all of them are let go when
// the load ends.
//
// The hold lives in the page's setup and reaches across tabs, so the test
// drives the app itself: the real server serves the page, and the queue's
// state and the batches' results are answered by request interception. A
// result is held back until the test lets it go, so a load stays under way
// for exactly as long as the test needs.
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');

const { REPORTS_ROOT } = require('../server-side/report-paths');

const ROOT = path.join(__dirname, '..', '..');
const LOADING = 'Reports are still loading into Compare. Try again once they have.';

function report(id, month) {
    return {
        runId: id, timestamp: `2026-0${month}-01T00:00:00Z`, scenarioName: id, url: 'https://x/',
        scans: [{
            id: 's', url: 'https://x/', scanTags: [],
            canonical: {
                findings: [{
                    ruleId: 'r', id: 'r', title: 't', severity: 'serious', outcome: 'fail',
                    wcag: { sc: ['1.4.3'] }, occurrences: [{ pageUrl: 'https://x/p', target: ['.a'] }],
                }],
            },
        }],
        metrics: { a11ySummary: { scores: { avgPageAccessibility: 60 + month, confidence: 90 } } },
    };
}

/** A finished batch of `runs` runs, each with a saved result, in row order. */
function batch(id, runs, startedAt) {
    return {
        id, name: id, startedAt, finishedAt: startedAt, state: 'finished', resumable: false,
        counts: { total: runs, done: runs },
        items: Array.from({ length: runs }, (_, i) => ({
            id: `${id}-${i + 1}`, name: `${id} run ${i + 1}`, url: 'https://x/', status: 'done', row: i + 1,
            scans: 1, findings: { fail: 1, cantTell: 0, pass: 0 }, durationMs: 1000,
            file: `${id}-${i + 1}.json`, fileUrl: `/reports/batches/${id}/${id}-${i + 1}.json`,
            error: null, needsValues: false, hasConfig: false,
        })),
        manifestUrl: `/reports/batches/${id}/batch.json`,
        zipUrl: `/queue/sessions/${id}/download.zip`,
    };
}

const QUEUE = {
    concurrency: 1, maxConcurrency: 4, hold: null, resources: null,
    sessions: [batch('A', 3, '2026-10-12T14:00:00.000Z'), batch('B', 2, '2026-10-11T14:00:00.000Z')],
};

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
let queueDir;
let browser;
let page;
// Results asked for and not yet answered, oldest first.
let pending;
let holdResults;
let pageErrors;

before(async () => {
    const port = await freePort();
    // Its own queue folder, so the server finds no batches of the reader's.
    const sub = `compare-hold-spec-${process.pid}`;
    queueDir = path.join(REPORTS_ROOT, sub);
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', A11Y_QUEUE_DIR: sub },
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

    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (e) {
        throw new Error(`compare-hold.browserspec.js needs a working Chrome (via Puppeteer): ${e && e.message ? e.message : e}`);
    }
});

after(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
        server.removeAllListeners('exit');
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        await exited;
    }
    if (queueDir) fs.rmSync(queueDir, { recursive: true, force: true });
});

beforeEach(async () => {
    pending = [];
    holdResults = true;
    pageErrors = [];
    page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = new URL(req.url());
        if (url.pathname === '/queue' && req.method() === 'GET') {
            req.respond({ contentType: 'application/json', body: JSON.stringify(QUEUE) });
            return;
        }
        const m = url.pathname.match(/^\/reports\/batches\/(\w+)\/\w+-(\d+)\.json$/);
        if (m) {
            const answer = () => req.respond({ contentType: 'application/json', body: JSON.stringify(report(`${m[1]}${m[2]}`, Number(m[2]))) });
            if (holdResults) pending.push(answer);
            else answer();
            return;
        }
        req.continue();
    });
    await page.goto(`${base}/src/`, { waitUntil: 'networkidle2' });
});

afterEach(async () => {
    releaseResults();
    await page.close();
    assert.deepEqual(pageErrors, [], 'no errors in the page');
});

/** Lets every held result go, and those asked for later. */
function releaseResults() {
    holdResults = false;
    for (const answer of pending.splice(0)) answer();
}

async function waitFor(fn, what, ...args) {
    try {
        await page.waitForFunction(fn, { timeout: 10000 }, ...args);
    } catch {
        throw new Error(`timed out waiting for ${what}`);
    }
}

/** Clicks with the DOM's click(), as a keyboard or pointer press would end. */
const press = (selector) => page.$eval(selector, (el) => el.click());
const state = (selector) => page.$eval(selector, (el) => ({
    disabled: el.getAttribute('aria-disabled'),
    action: el.dataset.queueAction || null,
    busy: el.dataset.busy || null,
}));
const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());
const chips = () => page.$$eval('#compare-reports [data-remove-key]', (bs) => bs.length);
const context = () => page.$eval('.ctx-opt[aria-pressed="true"]', (o) => o.dataset.context);
const loadIdle = () => waitFor(() => !document.querySelector('#compare-load').dataset.busy, 'the load to end');

async function openQueue() {
    await press('#mode-queue');
    await page.waitForSelector('[data-focus-key="compare:A"]');
    for (const id of ['A', 'B']) {
        const open = await page.$eval(`[data-focus-key="session:${id}"]`, (b) => b.getAttribute('aria-expanded') === 'true');
        if (!open) await press(`[data-focus-key="session:${id}"]`);
    }
}

/** Sends batch A to Compare and leaves it loading: its results are held. */
async function startSendingA() {
    await openQueue();
    await press('[data-focus-key="compare:A"]');
    await waitFor(() => document.querySelector('#compare-load').dataset.busy === 'true', 'the load to start');
}

describe('Compare holds everything that changes it while a load is under way', () => {
    test('a batch being sent holds the other batches, its own Delete and the Compare tab', async () => {
        await startSendingA();

        assert.deepEqual(await state('[data-focus-key="compare:A"]'), { disabled: 'true', action: 'blocked', busy: 'true' });
        assert.equal((await state('[data-focus-key="compare:B"]')).disabled, 'true');
        assert.equal((await state('[data-focus-key="delete:A"]')).disabled, 'true');
        assert.equal((await state('[data-focus-key="delete:B"]')).disabled, null, 'another batch can still be deleted');

        // Sending B now is what used to mix the two.
        await press('[data-focus-key="compare:B"]');
        assert.equal(await text('#queue-status'), LOADING);
        await press('[data-focus-key="delete:A"]');
        assert.match(await text('#queue-status'), /being sent to Compare/);

        assert.equal((await state('#compare-clear')).disabled, 'true');
        for (const held of await page.$$eval('.ctx-opt', (os) => os.map((o) => o.getAttribute('aria-disabled')))) {
            assert.equal(held, 'true');
        }
        assert.equal(await page.$eval('#compare-actions .split-button__action', (b) => b.disabled), true, 'Download waits');

        releaseResults();
        await loadIdle();

        assert.equal(await chips(), 3, 'only batch A’s runs');
        assert.equal(await context(), 'versions');
        assert.equal((await state('[data-focus-key="compare:B"]')).action, 'compare');
        assert.equal((await state('[data-focus-key="delete:A"]')).action, 'delete');
        assert.equal((await state('#compare-clear')).disabled, null);
        assert.equal(await page.$eval('.ctx-opt[data-context="time"]', (o) => o.getAttribute('aria-disabled')), null);
        assert.equal(await page.$eval('#compare-actions .split-button__action', (b) => b.disabled), false);
    });

    test('while a load waits to replace what is loaded, the comparison cannot be changed', async () => {
        releaseResults();
        await openQueue();
        await press('[data-focus-key="compare:A"]');
        await loadIdle();
        assert.equal(await chips(), 3);

        // B asks before replacing A's runs: the load is under way meanwhile.
        await press('#mode-queue');
        await press('[data-focus-key="compare:B"]');
        await waitFor(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Replace them'), 'the question');
        await press('#mode-compare');

        await press('.ctx-opt[data-context="variants"]');
        assert.equal(await text('#compare-status'), LOADING);
        assert.equal(await context(), 'versions', 'the framing is unchanged');

        await press('#compare-reports [data-remove-key]');
        assert.equal(await chips(), 3, 'nothing removed');
        await press('#compare-reports [data-move-key]:not([disabled])');
        await press('#compare-clear');
        assert.equal(await chips(), 3, 'nothing cleared');

        // Load reports shows the load under way rather than opening the picker.
        const picked = page.waitForFileChooser({ timeout: 500 }).then(() => true, () => false);
        await press('#compare-load');
        assert.equal(await picked, false);

        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Replace them').click());
        await loadIdle();
        assert.equal(await chips(), 2, 'B replaced A');

        // Let go: the framing changes again, drawn after a frame that shows
        // the comparison updating.
        await press('.ctx-opt[data-context="variants"]');
        await waitFor(() => document.querySelector('.ctx-opt[aria-pressed="true"]').dataset.context === 'variants', 'the framing to change');
        assert.equal(await context(), 'variants');
    });

    test('dropping files on Compare while it loads is refused', async () => {
        await startSendingA();
        await press('#mode-compare');
        await page.evaluate(() => {
            const zone = document.getElementById('pane-compare');
            const data = new DataTransfer();
            data.items.add(new File(['{}'], 'r.json', { type: 'application/json' }));
            for (const type of ['dragenter', 'dragover', 'drop']) {
                zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
            }
        });
        assert.match(await text('#compare-status'), /Still loading/);
        releaseResults();
        await loadIdle();
        assert.equal(await chips(), 3);
    });

    test('the Report tab’s Compare button waits too, saying why where the reader is', async () => {
        // A report open in the Report tab, from a file.
        const file = path.join(queueDir, 'open.json');
        fs.mkdirSync(queueDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(report('Open', 5)));
        await press('#mode-open');
        const input = await page.$('#resultsFiles');
        await input.uploadFile(file);
        await waitFor(() => document.querySelector('#report-files-load-btn')?.getAttribute('aria-disabled') !== 'true', 'the file to be staged');
        await press('#report-files-load-btn');
        await page.waitForSelector('[data-compare-report]', { timeout: 10000 });

        await startSendingA();
        assert.equal((await state('[data-compare-report]')).disabled, 'true');
        await press('#mode-open');
        await press('[data-compare-report]');
        assert.equal(await text('#statusReport'), LOADING);

        releaseResults();
        await loadIdle();
        assert.equal(await chips(), 3, 'the open report did not join the batch');
        assert.equal((await state('[data-compare-report]')).disabled, null);
    });
});

describe('a change to the comparison is drawn without freezing the page', () => {
    // Two reports of two profiles, so the Profiles compared switches show.
    const AA = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
    const ARIA = { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' };
    function twoProfileReport(id, month) {
        const r = report(id, month);
        r.scans[0].profile = ARIA;
        r.scans[0].profiles = [AA, ARIA];
        r.scans[0].canonical.findings[0].verdicts = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'pass' };
        r.scans[0].canonical.findings.push({
            ruleId: 'aria', id: 'aria', title: 'a', severity: 'serious', outcome: 'fail', wcag: { sc: ['4.1.2'] },
            verdicts: { 'wcag22-aa': 'pass', 'wai-aria-1.2': 'fail' },
            occurrences: [{ pageUrl: 'https://x/p', target: ['.b'] }],
        });
        return r;
    }

    test('the comparison says it is updating, holds the tab while it is, and gives focus back', async () => {
        releaseResults();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-update-'));
        try {
            const files = ['a', 'b'].map((id, i) => {
                const file = path.join(dir, `${id}.a11y-report.json`);
                fs.writeFileSync(file, JSON.stringify(twoProfileReport(id, i + 1)));
                return file;
            });
            await press('#mode-compare');
            const input = await page.$('#compare-input');
            await input.uploadFile(...files);
            await waitFor(() => document.querySelector('#compare-profiles [data-compare-profile="wai-aria-1.2"]'), 'the profile switches');
            await loadIdle();

            // The next frames wait, so the state before the redraw can be read.
            await page.evaluate(() => {
                window.__raf = window.requestAnimationFrame;
                window.__frames = [];
                window.requestAnimationFrame = (cb) => { window.__frames.push(cb); return 0; };
            });
            await press('#compare-profiles [data-compare-profile="wai-aria-1.2"]');
            const during = await page.evaluate(() => {
                const view = document.querySelector('#run-comparison');
                const pressed = document.querySelector('[data-compare-profile="wai-aria-1.2"]');
                return {
                    updating: view.classList.contains('compare-updating'),
                    inert: view.inert,
                    busy: view.getAttribute('aria-busy'),
                    note: view.querySelector('.compare-updating-pill')?.textContent || null,
                    status: document.querySelector('#compare-status').textContent,
                    spinner: pressed.dataset.busy || null,
                    other: document.querySelector('[data-compare-profile="wcag"]').getAttribute('aria-disabled'),
                    context: document.querySelector('.ctx-opt[data-context="variants"]').getAttribute('aria-disabled'),
                };
            });
            assert.deepEqual(during, {
                updating: true, inert: true, busy: 'true', note: 'Updating the comparison…',
                status: 'Updating the comparison…', spinner: 'true', other: 'true', context: 'true',
            });

            // A press meanwhile changes nothing.
            await press('#compare-profiles [data-compare-profile="wcag"]');
            assert.equal(await page.$eval('[data-compare-profile="wcag"]', (b) => b.getAttribute('aria-pressed')), 'true');

            await page.evaluate(() => {
                window.requestAnimationFrame = window.__raf;
                for (const cb of window.__frames.splice(0)) window.__raf(cb);
            });
            await waitFor(() => !document.querySelector('#run-comparison').classList.contains('compare-updating'), 'the update to end');
            const afterwards = await page.evaluate(() => ({
                inert: document.querySelector('#run-comparison').inert,
                busy: document.querySelector('#run-comparison').getAttribute('aria-busy'),
                note: !!document.querySelector('.compare-updating-note'),
                status: document.querySelector('#compare-status').textContent,
                pressed: document.querySelector('[data-compare-profile="wai-aria-1.2"]').getAttribute('aria-pressed'),
                focus: document.activeElement && document.activeElement.dataset.compareProfile,
                context: document.querySelector('.ctx-opt[data-context="variants"]').getAttribute('aria-disabled'),
            }));
            assert.deepEqual(afterwards, {
                inert: false, busy: null, note: false, status: 'Compared on WCAG 2.2 AA.',
                pressed: 'false', focus: 'wai-aria-1.2', context: null,
            });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
