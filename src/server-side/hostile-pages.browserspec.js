'use strict';

// Real-Chrome test: pages that never finish loading or are too large to
// picture still get their scan, in about the time any page takes, and a page
// that cannot be opened fails the run.
//
// - An image that never finishes keeps the document loading, and
//   document.fonts.ready unsettled with it: opening the page and settling it
//   before the scan waited on it with no limit (240 s, and no scan).
// - A frame that never answers held the page's navigation (Puppeteer's goto
//   waits for every frame) until it timed out, twice: 121 s and no scan.
// - A page laid out far taller than a capture can take in never finished its
//   picture: the scan waited out its stage limit and kept none.
// - A start page that cannot be opened (nothing listening) ended "done",
//   with an empty report: the run is an error, saying why.
// - A page that opens a dialog (an alert on load, a confirm on a click, a
//   leave-page dialog) blocked until a timeout: the dialog is answered OK.
// - A popup the page opens (window.open) came to the front and hid the run's
//   page: its screenshot and its scan waited out their time limits.
// - Cancelling while the start page did not answer waited out both tries of
//   it (two minutes): the run ends cancelled at once.
// - forEachElement at a concurrency, each worker page in a tab of its own:
//   a background tab runs no animation frame, so its scans waited out their
//   stage limit and were lost (19 of 60 kept).
// - A site whose certificate the browser does not trust (self-signed, or a
//   network that inspects HTTPS) failed with Chrome's code alone, and no run
//   could open it: the runner asked to accept it with an option Puppeteer no
//   longer reads. It is refused, saying why and what to do, unless the run
//   accepts untrusted certificates, and a run that does says so.
//
// The workflow runs end to end (executeWorkflowRun, as the app and the CLI do).
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { executeWorkflowRun } = require('./workflow-run');
const { closeBrowser } = require('./a11y-runner');

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hostile</title></head><body><main><h1>Hostile</h1>${body}</main></body></html>`;

// Each page by the start of its address; /hang never answers.
const ROUTES = {
    '/slow-asset': () => page('<img alt="never loads" src="/hang">'),
    '/tall': () => page('<div style="height:400000px;background:linear-gradient(#fff,#ccc)">Tall</div>'),
    '/list': () => page('<ul>' + [0, 1, 2, 3].map((i) => `<li><a class="item" href="/item?i=${i}">Item ${i}</a></li>`).join('') + '</ul>'),
    '/dialogs': () => page('<button id="b" onclick="document.getElementById(\'r\').textContent=String(confirm(\'Sure?\'))">Ask</button><p id="r"></p>'
        + '<script>alert("hello"); addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });</script>'),
    '/frame-hang': () => page('<iframe title="never" src="/hang"></iframe>'),
    '/popup': () => page('<button id="open" onclick="window.open(\'/item?i=opened\')">Open</button>'),
    '/item': () => page('<p>An item</p><img src="/none.png">'),
};

let server;
let base;

before(async () => {
    server = http.createServer((req, res) => {
        if (req.url.startsWith('/hang')) return; // never answers
        const route = Object.keys(ROUTES).find((prefix) => req.url.startsWith(prefix));
        const body = route ? ROUTES[route]() : '';
        res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await closeBrowser();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

async function timedRun(spec, hooks) {
    const started = Date.now();
    const out = await executeWorkflowRun(spec, hooks);
    return { ...out, seconds: (Date.now() - started) / 1000 };
}

describe('hostile pages', () => {
    test('a page with an image that never finishes is opened and scanned', async () => {
        const { status, payload, seconds } = await timedRun({
            url: `${base}/slow-asset`,
            actions: [{ type: 'a11yScan', label: 'slow asset', screenshotView: false }],
        });
        assert.equal(status, 'done');
        assert.equal(payload.scans.length, 1);
        assert.ok(payload.scans[0].canonical, 'the scan has its findings');
        assert.ok(seconds < 45, `took ${seconds} s`);
    });

    test('a page 400,000 px tall is scanned with a picture, in time', async () => {
        const { status, payload, seconds } = await timedRun({
            url: `${base}/tall`,
            actions: [{ type: 'a11yScan', label: 'tall' }],
        });
        assert.equal(status, 'done');
        assert.equal(payload.scans.length, 1);
        assert.ok(JSON.stringify(payload).includes('data:image/jpeg;base64,'), 'the scan kept its picture');
        assert.equal(payload.scans[0].screenshots.at(-1).clipped, true, 'and says it shows only the top');
        assert.ok(seconds < 45, `took ${seconds} s`);
    });

    test('a start page that cannot be opened ends the run in error, saying why', async () => {
        const closed = http.createServer();
        await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
        const port = closed.address().port;
        await new Promise((resolve) => closed.close(resolve));
        const { status, payload } = await timedRun({
            url: `http://127.0.0.1:${port}/`,
            actions: [{ type: 'a11yScan', label: 'nothing there' }],
        });
        assert.equal(status, 'error');
        assert.equal(payload.failed, true);
        assert.match(payload.errorDetails.message, /ERR_CONNECTION_REFUSED/);
    });

    test('forEachElement at concurrency 2 in pages of the same context scans every item', async () => {
        const { status, payload, seconds } = await timedRun({
            url: `${base}/list`,
            actions: [{
                type: 'forEachElement', targetSelector: 'a.item', concurrency: 2,
                actions: [{ type: 'click', selector: ':ctx' }, { type: 'a11yScan', label: 'item', stageTimeout: 15000 }],
            }],
        });
        assert.equal(status, 'done');
        assert.equal(payload.scans.length, 4);
        assert.ok(seconds < 90, `took ${seconds} s`);
    });

    test('alert, confirm and leave-page dialogs are answered OK, and logged', async () => {
        const log = [];
        const started = Date.now();
        const { status, payload } = await executeWorkflowRun({
            url: `${base}/dialogs`,
            actions: [
                { type: 'click', selector: '#b' },
                { type: 'getText', selector: '#r', var: 'answer' },
                { type: 'collectOutput', key: 'answer', value: '{var:answer}' },
                { type: 'type', selector: '#b', text: 'x', optional: true },
                { type: 'navigate', url: `${base}/item?i=0` },
                { type: 'a11yScan', label: 'after leaving', screenshotView: false },
            ],
        }, { progress: (e) => log.push(e) });
        assert.equal(status, 'done');
        assert.equal(payload.scans.length, 1);
        assert.equal(payload.collectedOutputs[0].value, 'true');
        const dialogs = log.filter((e) => /^The page opened a dialog/.test(e.message)).map((e) => e.message);
        assert.ok(dialogs.some((m) => m.includes('(alert)')) && dialogs.some((m) => m.includes('(confirm)')), dialogs.join(' | '));
        assert.ok((Date.now() - started) / 1000 < 45);
    });

    test('a popup the page opens leaves the run\'s page shown: its screenshot and scan go on', async () => {
        const { status, payload, seconds } = await timedRun({
            url: `${base}/popup`,
            actions: [
                { type: 'click', selector: '#open' },
                { type: 'wait', ms: 300 },
                { type: 'screenshot', label: 'after the popup' },
                { type: 'a11yScan', label: 'after the popup', stageTimeout: 15000 },
            ],
        });
        assert.equal(status, 'done');
        assert.equal(payload.scans.length, 1);
        assert.ok(seconds < 40, `took ${seconds} s`);
    });

    test('cancelling while the start page does not answer ends the run at once', async () => {
        const abort = new AbortController();
        setTimeout(() => abort.abort(), 1500);
        const { status, seconds } = await timedRun({
            url: `${base}/hang`,
            actions: [{ type: 'a11yScan', label: 'never' }],
        }, { isCancelled: () => abort.signal.aborted, abortSignal: abort.signal });
        assert.equal(status, 'cancelled');
        assert.ok(seconds < 15, `took ${seconds} s`);
    });

    test('a page with a frame that never answers is opened, navigated to and scanned', async () => {
        const { status, payload, seconds } = await timedRun({
            url: `${base}/frame-hang`,
            actions: [
                { type: 'a11yScan', label: 'start', screenshotView: false },
                { type: 'navigate', url: `${base}/frame-hang?again` },
                { type: 'a11yScan', label: 'after navigate', screenshotView: false },
            ],
        });
        assert.equal(status, 'done');
        assert.equal(payload.scans.length, 2);
        assert.ok(seconds < 60, `took ${seconds} s`);
    });

    test('a site whose certificate the browser does not trust is refused, saying why, unless the run accepts it', async (t) => {
        // A certificate no authority signed, made for this test only.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-signed-'));
        try {
            execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
                '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
        } catch {
            t.skip('openssl is not installed');
            return;
        }
        const secure = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) },
            (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('<p>Self-signed</p>')); });
        await new Promise((resolve) => secure.listen(0, '127.0.0.1', resolve));
        try {
            const spec = {
                url: `https://127.0.0.1:${secure.address().port}/`,
                actions: [{ type: 'a11yScan', label: 'self-signed', screenshotView: false }],
            };
            const refused = await timedRun(spec);
            assert.equal(refused.status, 'error');
            assert.match(refused.payload.errorDetails.message, /ERR_CERT_AUTHORITY_INVALID.*does not trust this site's certificate.*Untrusted certificates to Accept/s);
            assert.ok(!(refused.payload.runDiagnostics || {}).untrustedCertsAccepted);

            const log = [];
            const accepted = await timedRun({ ...spec, acceptUntrustedCerts: true }, { progress: (entry) => log.push(entry) });
            assert.equal(accepted.status, 'done', accepted.payload.errorDetails && accepted.payload.errorDetails.message);
            assert.equal(accepted.payload.scans.length, 1);
            assert.ok(accepted.payload.scans[0].canonical, 'the scan has its findings');
            assert.equal(accepted.payload.runDiagnostics.untrustedCertsAccepted, true);
            assert.ok(log.some((e) => e.type === 'warn' && /accepts certificates the browser does not trust/.test(e.message)), 'the run says so in its log');
        } finally {
            secure.closeAllConnections();
            await new Promise((resolve) => secure.close(resolve));
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
