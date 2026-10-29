'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const JSZip = require('jszip');
const files = require('./queue-files');

const { createRunQueue } = require('./run-queue');
const { registerQueueRoutes, resolveQueueBaseDir } = require('./queue-routes');

let reportsRoot;
let baseDir;
let server;
let origin;
let pending;

before(async () => {
    reportsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-routes-'));
    baseDir = path.join(reportsRoot, 'batches');
    pending = [];
    const queue = createRunQueue({
        baseDir,
        executeRun: () => new Promise((resolve) => pending.push(resolve)),
        validateUrl: (u) => { if (!/^https?:\/\//.test(String(u))) throw new Error('Invalid url'); },
        logError: () => {},
    });
    queue.init();

    const app = express();
    app.use(express.json());
    app.use('/reports', express.static(reportsRoot, { dotfiles: 'deny', index: false }));
    registerQueueRoutes(app, queue, { reportsRoot, baseDir, logError: () => {} });

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.close();
    fs.rmSync(reportsRoot, { recursive: true, force: true });
});

async function api(method, url, body) {
    const res = await fetch(origin + url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer(), headers: res.headers };
}

async function waitForState(check) {
    const deadline = Date.now() + 2000;
    for (;;) {
        const { body } = await api('GET', '/queue');
        if (check(body)) return body;
        if (Date.now() > deadline) throw new Error('Timed out waiting for the queue');
        await new Promise((r) => setTimeout(r, 5));
    }
}

const run = (name) => ({ run: { url: 'https://example.com/', scenarioName: name, actions: [{ type: 'a11yScan' }] } });

describe('queue routes', () => {
    test('queues, runs, links each result and zips the session', async () => {
        const added = await api('POST', '/queue/items', { items: [run('Product v2.3'), run('Product v2.4')], name: 'Product' });
        assert.equal(added.status, 200);
        const { sessionId } = added.body;

        let state = (await api('GET', '/queue')).body;
        assert.equal(state.sessions[0].name, 'Product');
        assert.equal(state.concurrency, 1);
        assert.equal(state.maxConcurrency, 8);
        assert.equal(state.sessions[0].zipUrl, `/queue/sessions/${sessionId}/download.zip`);
        assert.equal(state.sessions[0].zipName, `Product-queue-${sessionId}.zip`);
        assert.equal(state.sessions[0].manifestUrl, `/reports/batches/${sessionId}/batch.json`);

        pending.shift()({ status: 'done', payload: { scans: [{}], findings: { fail: [], cantTell: [] } } });
        await waitForState((s) => s.sessions[0].items[1].status === 'running');
        pending.shift()({ status: 'done', payload: { scans: [{}, {}], findings: { fail: [], cantTell: [] } } });
        state = await waitForState((s) => s.sessions[0].state === 'finished');

        const [first, second] = state.sessions[0].items;
        assert.equal(first.fileUrl, `/reports/batches/${sessionId}/Product-v2.3.json`);
        const saved = await api('GET', second.fileUrl);
        assert.equal(saved.status, 200);
        assert.equal(saved.body.scans.length, 2);

        const zip = await api('GET', state.sessions[0].zipUrl);
        assert.equal(zip.status, 200);
        assert.equal(zip.headers.get('content-type'), 'application/zip');
        assert.match(zip.headers.get('content-disposition'), new RegExp(`"Product-queue-${sessionId}\\.zip"`));
        const entries = Object.keys((await JSZip.loadAsync(zip.body)).files).sort();
        assert.deepEqual(entries, ['Product-v2.3.json', 'Product-v2.4.json', 'batch.json']);
    });

    test('a running run\'s progress can be read, with its file\'s URL once saved', async () => {
        const added = await api('POST', '/queue/items', { items: [run('Watched')] });
        const itemId = added.body.itemIds[0];
        const live = await api('GET', `/queue/items/${itemId}/progress?since=0`);
        assert.equal(live.status, 200);
        assert.equal(live.body.status, 'running');
        assert.equal(live.body.fileUrl, null);
        pending.shift()({ status: 'done', payload: { scans: [{}], findings: { fail: [], cantTell: [] } } });
        await waitForState((s) => s.sessions[0].state === 'finished');
        const done = await api('GET', `/queue/items/${itemId}/progress?since=0`);
        assert.equal(done.body.status, 'done');
        assert.equal(done.body.fileUrl, `/reports/batches/${added.body.sessionId}/Watched.json`);
        assert.equal((await api('GET', '/queue/items/nope/progress')).status, 404);
    });

    test('a batch zips as a report package, and each run as its own: its result and only its pictures', async () => {
        const shot = (byte) => ({ scans: [{ screenshots: [{ name: 'Main', dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, byte, 0xff, 0xd9]).toString('base64')}` }] }], findings: { fail: [], cantTell: [] } });
        const added = await api('POST', '/queue/items', { items: [run('Home'), run('Cart')], name: 'Shop' });
        pending.shift()({ status: 'done', payload: shot(1) });
        await waitForState((s) => s.sessions[0].items[1].status === 'running');
        pending.shift()({ status: 'done', payload: shot(2) });
        const state = await waitForState((s) => s.sessions[0].state === 'finished');
        const session = state.sessions.find((x) => x.id === added.body.sessionId);

        const all = await JSZip.loadAsync((await api('GET', session.zipUrl)).body);
        const images = Object.keys(all.files).filter((n) => n.startsWith('images/') && !all.files[n].dir);
        assert.equal(images.length, 2);

        const [home] = session.items;
        assert.equal(home.zipUrl, `/queue/sessions/${session.id}/items/${home.id}/download.zip`);
        assert.equal(home.zipName, 'Home.zip');
        const own = await api('GET', home.zipUrl);
        assert.match(own.headers.get('content-disposition'), /"Home\.zip"/);
        const zip = await JSZip.loadAsync(own.body);
        const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
        const named = JSON.parse(await zip.file('Home.json').async('string')).scans[0].screenshots[0].dataUrl;
        assert.deepEqual(entries, ['Home.json', named], 'its result and its one picture, not Cart\'s');
        assert.equal((await api('GET', `/queue/sessions/${session.id}/items/nope/download.zip`)).status, 404);
    });

    test('a batch keeps its configuration beside its results, and each run\'s in its result and its own zip', async () => {
        const runConfig = (name) => ({ version: 1, type: 'a11y-ui-src-config', state: { 'scenario-name': name, 'actions-workflow': [{ type: 'setPassword', valueMasked: true, value: 'hunter2' }] } });
        const batchConfig = { ...runConfig('Shop'), batch: { rows: [{ name: 'Home' }], enabled: true } };
        const added = await api('POST', '/queue/items', { items: [{ ...run('Home'), config: runConfig('Home') }], name: 'Shop', config: batchConfig });
        pending.shift()({ status: 'done', payload: { scans: [{}], findings: { fail: [], cantTell: [] } } });
        const state = await waitForState((s) => s.sessions.find((x) => x.id === added.body.sessionId)?.state === 'finished');
        const session = state.sessions.find((x) => x.id === added.body.sessionId);

        const dir = path.join(baseDir, session.id);
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'Shop.a11y-config.json'), 'utf8'));
        assert.deepEqual(saved.batch, batchConfig.batch);
        assert.ok(!JSON.stringify(saved).includes('hunter2'), 'a masked value never reaches disk');
        assert.equal(files.readManifest(dir).configFile, 'Shop.a11y-config.json');
        assert.equal(session.items.length, 1, 'the configuration is not taken for a result');
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'Home.json'), 'utf8')).config.state['scenario-name'], 'Home');

        const all = await JSZip.loadAsync((await api('GET', session.zipUrl)).body);
        assert.ok(all.file('Shop.a11y-config.json'));
        const own = await JSZip.loadAsync((await api('GET', session.items[0].zipUrl)).body);
        assert.equal(JSON.parse(await own.file('Home.a11y-config.json').async('string')).state['scenario-name'], 'Home');
    });

    test('a batch saved before its configuration was kept gets one rebuilt in its zip', async () => {
        const id = '2026-01-02T03-04-05';
        const dir = path.join(baseDir, id);
        fs.mkdirSync(dir, { recursive: true });
        files.writeManifest(dir, {
            type: files.MANIFEST_TYPE, version: 1, id, name: 'Old shop', startedAt: '2026-01-02T03:04:05.000Z', finishedAt: '2026-01-02T03:05:00.000Z',
            items: [{ id: 'a', name: 'v1', url: 'https://shop.test/v1', status: 'done', file: null, config: { version: 1, type: 'a11y-ui-src-config', state: {} } }],
        });
        const zip = await JSZip.loadAsync((await api('GET', `/queue/sessions/${id}/download.zip`)).body);
        const rebuilt = JSON.parse(await zip.file('Old-shop.a11y-config.json').async('string'));
        assert.deepEqual(rebuilt.batch.rows, [{ name: 'v1', url: 'https://shop.test/v1' }]);
        assert.equal(rebuilt.metadata.rebuiltFrom, 'batch.json');
    });

    test('zips leave out temporary files', async () => {
        const state = (await api('GET', '/queue')).body;
        const id = state.sessions[0].id;
        fs.writeFileSync(path.join(baseDir, id, '.half-written.json.1.tmp'), '{');
        const zip = await api('GET', `/queue/sessions/${id}/download.zip`);
        const entries = Object.keys((await JSZip.loadAsync(zip.body)).files);
        assert.ok(!entries.some((e) => e.startsWith('.')));
    });

    test('settings, cancel and resume answer with the right status codes', async () => {
        assert.equal((await api('POST', '/queue/settings', { concurrency: 2 })).body.concurrency, 2);
        assert.equal((await api('POST', '/queue/settings', { concurrency: 9 })).status, 400);
        assert.equal((await api('POST', '/queue/items/nope/cancel')).status, 404);
        assert.equal((await api('POST', '/queue/sessions/2020-01-01T00-00-00/resume')).status, 404);
        assert.equal((await api('POST', '/queue/cancel')).body.cancelled, 0);
    });

    test('a bad item rejects the request with its reason', async () => {
        const res = await api('POST', '/queue/items', { items: [{ run: { url: 'file:///etc/passwd', actions: [{ type: 'a11yScan' }] } }] });
        assert.equal(res.status, 400);
        assert.equal(res.body.error, 'Invalid url');
        assert.equal((await api('POST', '/queue/items', {})).status, 400);
    });

    test('delete removes a finished session, and refuses an unknown one', async () => {
        const id = (await api('GET', '/queue')).body.sessions[0].id;
        assert.deepEqual((await api('POST', `/queue/sessions/${id}/delete`)).body, { deleted: id });
        assert.equal(fs.existsSync(path.join(baseDir, id)), false);
        assert.equal((await api('POST', `/queue/sessions/${id}/delete`)).status, 404);
        assert.equal((await api('POST', '/queue/sessions/..%2F..%2Fetc/delete')).status, 404);
    });

    test('download refuses anything that is not a session id', async () => {
        for (const id of ['..', '..%2F..%2Fetc', 'not-a-session', '2020-01-01T00-00-00']) {
            assert.equal((await api('GET', `/queue/sessions/${id}/download.zip`)).status, 404, id);
        }
    });
});

describe('resolveQueueBaseDir', () => {
    test('keeps the queue folder inside the reports folder', () => {
        const root = path.join(os.tmpdir(), 'reports');
        const warn = () => {};
        assert.equal(resolveQueueBaseDir(root, undefined, { warn }), path.join(root, 'batches'));
        assert.equal(resolveQueueBaseDir(root, 'queue/runs', { warn }), path.join(root, 'queue', 'runs'));
        for (const outside of ['..', '../elsewhere', '/tmp/x', '.']) {
            assert.equal(resolveQueueBaseDir(root, outside, { warn }), path.join(root, 'batches'), outside);
        }
    });
});
