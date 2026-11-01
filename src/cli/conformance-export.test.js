'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { readReviewFile, carryReviewOnto, writeConformanceReport } = require('./conformance-export');

const review = { reviewer: 'A. Reviewer', criteria: { '2.1.1': { conformance: 'supports', remarks: 'Checked with the keyboard.' } } };

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lab-acr-'));
}

describe('--review', () => {
    test('reads the review of a report\'s JSON, or of the JSON in its package', async () => {
        const dir = tmp();
        const json = path.join(dir, 'payload.json');
        fs.writeFileSync(json, JSON.stringify({ scans: [], conformanceReview: review }));
        assert.deepEqual((await readReviewFile(json)).review, review);

        const zip = new JSZip();
        zip.file('Shop.a11y-report.json', JSON.stringify({ scans: [], conformanceReview: review }));
        const zipPath = path.join(dir, 'Shop.zip');
        fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
        assert.deepEqual((await readReviewFile(zipPath)).review, review);
    });

    test('says so when a report has no review, or cannot be read', async () => {
        const dir = tmp();
        const json = path.join(dir, 'payload.json');
        fs.writeFileSync(json, JSON.stringify({ scans: [] }));
        assert.deepEqual(await readReviewFile(json), { review: null });
        assert.match((await readReviewFile(path.join(dir, 'missing.json'))).error, /could not read/);
    });

    test('carries a review onto a run, and adds none when there is nothing to carry', () => {
        const payload = { scans: [] };
        assert.equal(carryReviewOnto(payload, review), 1);
        assert.equal(payload.conformanceReview.criteria['2.1.1'].conformance, 'supports');
        assert.equal(payload.conformanceReview.reviewer, 'A. Reviewer');

        const bare = { scans: [] };
        assert.equal(carryReviewOnto(bare, { criteria: {} }), 0);
        assert.equal('conformanceReview' in bare, false);
        assert.equal(carryReviewOnto(bare, null), 0);
    });
});

test('--format acr writes the run\'s conformance report as HTML and Word', async () => {
    const dir = tmp();
    const { written, totals } = await writeConformanceReport({ scenarioName: 'Shop', scans: [], conformanceReview: review }, dir, { generatedAt: '2026-10-30' });
    assert.deepEqual(written.map((f) => path.basename(f)), ['conformance-report.html', 'conformance-report.docx']);
    assert.match(fs.readFileSync(written[0], 'utf8'), /<title>Shop: Accessibility Conformance Report<\/title>/);
    assert.equal(fs.readFileSync(written[1]).subarray(0, 2).toString(), 'PK', 'a zip, as a .docx is');
    assert.equal(totals.reviewed, 1);
});
