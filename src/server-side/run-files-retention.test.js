'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { retentionHoursFrom, sweepRunFiles, DEFAULT_HOURS } = require('./run-files-retention');

function aged(dir, hoursAgo) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'a.png');
    fs.writeFileSync(file, 'x');
    const t = (Date.now() - hoursAgo * 3600000) / 1000;
    fs.utimesSync(file, t, t);
    fs.utimesSync(dir, t, t);
}

test('a run\'s pictures and evidence go once older than the hours kept; newer ones and batches stay', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
    aged(path.join(root, 'runs', 'run_old'), 30);
    aged(path.join(root, 'evidence', 'run_old'), 30);
    aged(path.join(root, 'runs', 'run_new'), 2);
    aged(path.join(root, 'batches', '2026-01-01T00-00-00'), 300);
    const removed = sweepRunFiles(root, 24).map((d) => path.relative(root, d)).sort();
    assert.deepEqual(removed, [path.join('evidence', 'run_old'), path.join('runs', 'run_old')]);
    assert.ok(fs.existsSync(path.join(root, 'runs', 'run_new')));
    assert.ok(fs.existsSync(path.join(root, 'batches', '2026-01-01T00-00-00')));
});

test('0 hours keeps them for good; a folder written to lately is kept, however old the folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
    aged(path.join(root, 'runs', 'run_old'), 30);
    assert.deepEqual(sweepRunFiles(root, 0), []);
    fs.writeFileSync(path.join(root, 'runs', 'run_old', 'b.png'), 'y');
    assert.deepEqual(sweepRunFiles(root, 24), []);
});

test('A11Y_RUN_FILES_HOURS is a number from 0, else the default', () => {
    assert.equal(retentionHoursFrom('0'), 0);
    assert.equal(retentionHoursFrom('1.5'), 1.5);
    for (const bad of [undefined, '', '-1', 'soon']) assert.equal(retentionHoursFrom(bad), DEFAULT_HOURS);
});
