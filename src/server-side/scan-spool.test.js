'use strict';

// A queued run's page screenshots wait in files, not memory, and the result
// written from them is byte for byte the one written from the buffers.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createScanSpool, spoolDirFor, SPOOL_PREFIX } = require('./scan-spool');
const { createWorkflowPayloadBuilder } = require('../shared/workflow-payload-builder');
const { writeJsonFile } = require('./json-file-writer');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-spool-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const PAYLOAD = createWorkflowPayloadBuilder({
    METRIC_DEFS: {},
    sortByOrderKey: (arr) => arr,
    findingsByOutcome: () => ({}),
    getA11yGlobalFindings: () => [],
    buildGlobalSummary: () => ({ domMetrics: null, a11ySummary: null }),
});

const jpeg = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n + 1, n + 2, 0xff, 0xd9]);

/** A capture artifact as captureScreenshotArtifact returns it. */
const artifact = (n) => ({
    buffer: jpeg(n), base64: null, dataUrl: null, filePath: null, publicUrl: null,
    mimeType: 'image/jpeg', bytes: 9, viewportRatio: 1.5, sources: ['buffer'],
});

/** A Merged scan's context screenshot, as merged-scan.js's contextShot makes it. */
const contextShot = (n, name) => ({ buffer: jpeg(n), name, label: name, viewportRatio: 0.5 });

function scans() {
    return [
        { id: 'a', scanId: 'a', canonical: { findings: [] }, screenshot: artifact(1), viewportRatio: 1.5 },
        { id: 'b', scanId: 'b', canonical: { findings: [] }, screenshot: jpeg(2) },
        { id: 'c', scanId: 'c', canonical: { findings: [] }, screenshot: new Uint8Array(jpeg(3)) },
        { id: 'd', scanId: 'd', canonical: { findings: [] }, screenshot: { ...artifact(4), buffer: Buffer.alloc(0) } },
        { id: 'e', scanId: 'e', canonical: { findings: [] }, screenshot: { publicUrl: '/reports/x.jpg' } },
        {
            id: 'f', scanId: 'f', canonical: { findings: [] }, mergedScan: true, contexts: [],
            screenshots: [contextShot(5, 'Mobile'), contextShot(6, 'Desktop')],
        },
    ];
}

async function written(list, name) {
    const payload = PAYLOAD.buildWorkflowPayloadBase({ url: 'http://x', timestamp: '2026-10-21T00:00:00.000Z', scans: list });
    PAYLOAD.finalizeWorkflowPayload(payload);
    const file = path.join(tmp, name);
    await writeJsonFile(file, payload);
    return fs.readFileSync(file, 'utf8');
}

describe('scan spool', () => {
    test('the result written from spooled screenshots is the one written from the buffers', async () => {
        const spool = createScanSpool(path.join(tmp, '.spool-x'));
        const spooled = [];
        for (const scan of scans()) {
            const s = { ...scan };
            s.screenshot = await spool.spillScreenshot(s.screenshot);
            if (Array.isArray(s.screenshots)) {
                s.screenshots = await Promise.all(s.screenshots.map((shot) => spool.spillScreenshot(shot)));
            }
            spooled.push(s);
        }
        assert.equal(spooled[0].screenshot.buffer, undefined, 'the bytes left memory');
        assert.equal(fs.readdirSync(spool.dir).length, 5, 'one file per screenshot with bytes');

        const expected = await written(scans(), 'memory.json');
        assert.equal(await written(spooled, 'spooled.json'), expected);
        assert.match(expected, /data:image\/jpeg;base64,/);
    });

    test('leaves alone what has no bytes to move', async () => {
        const spool = createScanSpool(path.join(tmp, '.spool-y'));
        const link = { publicUrl: '/reports/x.jpg', buffer: jpeg(1) };
        assert.equal(await spool.spillScreenshot(link), link);
        assert.equal(await spool.spillScreenshot(null), null);
        assert.equal(await spool.spillScreenshot('data:image/jpeg;base64,AA=='), 'data:image/jpeg;base64,AA==');
        const empty = { buffer: Buffer.alloc(0) };
        assert.equal(await spool.spillScreenshot(empty), empty);
        assert.equal(fs.existsSync(spool.dir), false, 'no folder for nothing');
    });

    test('remove deletes the folder, and is a no-op when nothing was spooled', async () => {
        const used = createScanSpool(path.join(tmp, '.spool-z'));
        await used.spillScreenshot(artifact(1));
        assert.equal(fs.existsSync(used.dir), true);
        await used.remove();
        assert.equal(fs.existsSync(used.dir), false);
        await createScanSpool(path.join(tmp, '.spool-none')).remove();
    });

    test('spoolDirFor names a dot folder in the session', () => {
        assert.equal(spoolDirFor('/s', 'id-1'), path.join('/s', `${SPOOL_PREFIX}id-1`));
        assert.ok(SPOOL_PREFIX.startsWith('.'));
    });
});
