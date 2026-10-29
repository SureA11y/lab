'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const { createRunResultStore, sendWithPayloadFile } = require('./run-results');
const { sweepFinishedRuns } = require('./run-sweep');

const PAYLOAD = { reportVersion: 3, runId: 'run_1', scans: [{ id: 's1', canonical: { findings: [] } }], note: 'ünïcødé' };

async function fetchFrom(handler) {
    const app = express();
    app.get('/r', handler);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/r`);
        return { status: res.status, type: res.headers.get('content-type'), length: Number(res.headers.get('content-length')), text: await res.text() };
    } finally {
        server.closeAllConnections();
        server.close();
    }
}

test('a result kept in a file is sent as the same JSON the object would be', async () => {
    const store = createRunResultStore();
    try {
        const kept = await store.keep('run_1', PAYLOAD);
        assert.ok(fs.existsSync(kept.file));
        assert.equal(kept.bytes, Buffer.byteLength(JSON.stringify(PAYLOAD)));
        const head = { status: 'done', dryRun: { steps: 1 } };
        const res = await fetchFrom((req, r) => sendWithPayloadFile(r, head, kept.file));
        assert.equal(res.status, 200);
        assert.match(res.type, /^application\/json/);
        assert.deepEqual(JSON.parse(res.text), { ...head, payload: PAYLOAD });
        assert.equal(res.length, Buffer.byteLength(res.text));
    } finally {
        store.clear();
    }
});

test('a swept run takes its result file with it', async () => {
    const store = createRunResultStore();
    try {
        const { file } = await store.keep('run_2', PAYLOAD);
        const runs = new Map([['run_2', { status: 'done', finishedAt: 0, resultFile: file }]]);
        sweepFinishedRuns(runs, { isFinished: () => true, now: 31 * 60 * 1000, onRemove: (run) => store.remove(run.resultFile) });
        assert.equal(runs.size, 0);
        assert.equal(fs.existsSync(file), false);
    } finally {
        store.clear();
    }
});

test('a result that cannot be written is said so, to be kept in memory instead', async () => {
    // A folder that cannot be made: its parent is a file.
    const notAFolder = path.join(os.tmpdir(), `run-results-file-${process.pid}`);
    fs.writeFileSync(notAFolder, '');
    try {
        const store = createRunResultStore({ dir: path.join(notAFolder, 'results') });
        assert.equal(await store.keep('run_3', PAYLOAD), null);
    } finally {
        fs.rmSync(notAFolder, { force: true });
    }
});
