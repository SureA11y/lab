'use strict';

// payload.json is written a piece at a time, as the queue writes its results:
// a payload past V8's ~512 MB string limit cannot be one string. The run is
// stubbed: what matters is what the CLI writes of it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflowRun = require('../server-side/workflow-run');
const PAYLOAD = {
    reportVersion: 3,
    url: 'https://example.com/',
    runId: 'run_1',
    timestamp: '2026-10-28T10:00:00.000Z',
    scans: [{ id: 's1', url: 'https://example.com/', canonical: { findings: [{ uid: 'surea11y:fail:image-alt', ruleId: 'image-alt', outcome: 'fail', occurrences: [{ target: ['img'] }] }] } }],
};
let stringified = 0;
let next = PAYLOAD;
require.cache[require.resolve('../server-side/workflow-run')].exports = {
    ...workflowRun,
    executeWorkflowRun: async () => ({ status: 'done', payload: structuredClone(next) }),
};
const { main } = require('./run-workflow');

async function runCli(dir) {
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, JSON.stringify({ type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', actions: [{ type: 'a11yScan', label: 'Home' }] }));
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try {
        await main([spec, '--out', path.join(dir, 'out')]);
    } finally {
        console.log = log;
        console.error = error;
    }
}

test('a scan\'s picture is a file in images/, which the payload names by its path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-images-'));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    next = { ...PAYLOAD, scans: [{ ...PAYLOAD.scans[0], screenshots: [{ name: 'Main screenshot', dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` }] }] };
    try {
        await runCli(dir);
        const written = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'payload.json'), 'utf8'));
        const ref = written.scans[0].screenshots[0].dataUrl;
        assert.match(ref, /^images\/[0-9a-f]{20}\.jpg$/);
        assert.deepEqual(fs.readFileSync(path.join(dir, 'out', ref)), jpeg);
    } finally {
        next = PAYLOAD;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('payload.json is the payload as compact JSON, written without one JSON.stringify of it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-file-'));
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, JSON.stringify({ type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', actions: [{ type: 'a11yScan', label: 'Home' }] }));
    const realStringify = JSON.stringify;
    const out = [];
    const { log, error } = console;
    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => out.push(a.join(' '));
    // Counts whole-payload stringifies: the writer hands JSON.stringify pieces.
    JSON.stringify = function (value, ...rest) {
        if (value && value.runId === 'run_1' && Array.isArray(value.scans)) stringified += 1;
        return realStringify.call(this, value, ...rest);
    };
    try {
        await main([spec, '--out', path.join(dir, 'out')]);
    } finally {
        JSON.stringify = realStringify;
        console.log = log;
        console.error = error;
    }
    const written = fs.readFileSync(path.join(dir, 'out', 'payload.json'), 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(stringified, 0);
    assert.equal(written, JSON.stringify(PAYLOAD));
    assert.match(out.join('\n'), /Payload {5}.*payload\.json \(\d+ KB\)/);
});
