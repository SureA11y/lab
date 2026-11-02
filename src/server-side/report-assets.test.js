'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ensureReportAssets, missingReportAssets } = require('./report-assets');

const BUILT = ['report.min.js', 'report.min.css', 'comparison.min.css'];

test('with every asset built, nothing is built again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
    for (const f of BUILT) fs.writeFileSync(path.join(dir, f), 'x');
    let ran = 0;
    assert.deepEqual(ensureReportAssets({ dir, run: () => { ran += 1; } }), { built: false, missing: [], error: null });
    assert.equal(ran, 0);
});

test('a missing asset is built, and one the build could not make is named, with how to build it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
    assert.deepEqual(missingReportAssets(dir), BUILT);
    const built = ensureReportAssets({ dir, run: () => { for (const f of BUILT) fs.writeFileSync(path.join(dir, f), 'x'); return { status: 0 }; } });
    assert.deepEqual(built, { built: true, missing: [], error: null });

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
    const failed = ensureReportAssets({ dir: empty, run: () => ({ status: 1, stderr: "Error: Cannot find module 'esbuild'\n" }) });
    assert.equal(failed.built, false);
    assert.deepEqual(failed.missing, BUILT);
    assert.match(failed.error, /Cannot find module 'esbuild'\. Build them with npm run build:report\./);
});
