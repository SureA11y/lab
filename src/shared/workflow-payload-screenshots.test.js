'use strict';

// A scan's screenshot, held as a buffer, gets its data URL when the result is
// written, not when it is built: the written result is what it always was.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorkflowPayloadBuilder } = require('./workflow-payload-builder');
const { writeJsonFile } = require('../server-side/json-file-writer');

function builder() {
    return createWorkflowPayloadBuilder({
        METRIC_DEFS: {},
        sortByOrderKey: (arr) => arr,
        findingsByOutcome: () => ({}),
        getA11yGlobalFindings: () => [],
        buildGlobalSummary: () => ({ domMetrics: null, a11ySummary: null }),
    });
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const expected = 'data:image/jpeg;base64,' + jpeg.toString('base64');

function payloadWith(screenshot, extra = {}) {
    return builder().buildWorkflowPayloadBase({
        url: 'http://x',
        timestamp: '2026-10-14T00:00:00.000Z',
        scans: [{ id: 's', canonical: { findings: [] }, screenshot, ...extra }],
    });
}

describe('scan screenshots in a result', () => {
    test('stay a buffer until written, then read as the data URL', () => {
        const shot = payloadWith({ buffer: jpeg, scanId: 's', orderKey: 'main:0000' }).scans[0].screenshots[0];
        assert.notEqual(typeof shot.dataUrl, 'string', 'not encoded yet');
        const written = JSON.parse(JSON.stringify(shot));
        assert.equal(written.dataUrl, expected);
        assert.equal(written.name, 'Main screenshot');
        assert.equal(written.scanId, 's');
    });

    test('every form a run hands over is written as before', () => {
        // A capture artifact ({ buffer }), a Merged scan's context ({ buffer }
        // again), and the typed-array and raw-bytes forms.
        const view = new Uint8Array(jpeg);
        for (const screenshot of [{ buffer: jpeg }, { data: jpeg }, { buffer: view }, { buffer: view.buffer }]) {
            const written = JSON.parse(JSON.stringify(payloadWith(screenshot)));
            assert.equal(written.scans[0].screenshots[0].dataUrl, expected);
        }
    });

    test('a bare buffer is read as itself, not the memory block it sits in', () => {
        // Small Buffers share one pooled block; its .buffer is that block.
        const pooled = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
        assert.ok(pooled.buffer.byteLength > pooled.length, 'pooled');
        const written = JSON.parse(JSON.stringify(payloadWith(pooled)));
        assert.equal(written.scans[0].screenshots[0].dataUrl, 'data:image/jpeg;base64,' + pooled.toString('base64'));
    });

    test('an empty buffer is no screenshot, as before', () => {
        assert.deepEqual(payloadWith({ buffer: Buffer.alloc(0) }).scans[0].screenshots, []);
    });

    test('a screenshot already a data URL or a link goes through untouched', () => {
        const [a] = payloadWith({ dataUrl: expected }).scans[0].screenshots;
        const [b] = payloadWith({ publicUrl: '/reports/x.jpg' }).scans[0].screenshots;
        assert.equal(a.dataUrl, expected);
        assert.equal(b.publicUrl, '/reports/x.jpg');
    });

    test('the queue\'s file writer writes what JSON.stringify writes', async () => {
        const payload = payloadWith({ buffer: jpeg }, {
            extraScreenshots: [{ buffer: jpeg, name: 'Before' }],
        });
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
        try {
            const file = path.join(dir, 'r.json');
            await writeJsonFile(file, payload);
            assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(payload));
            assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).scans[0].screenshots.length, 2);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
