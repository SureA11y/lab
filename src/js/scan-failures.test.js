'use strict';

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {
    isSkippedScan,
    scanHasFailures,
    scanHasReviewItems,
    isFailureFreeScan,
    failureFreeScansNote
} = require('./scan-failures.js');

// These decide which scans "Failures only" hides. They must agree with what the
// results table renders, or a scan with a failing row would vanish (or an empty
// one would stay).

const scanWith = (...findings) => ({canonical: {findings}});

describe('scanHasFailures', () => {
    test('a failing finding without occurrences counts', () => {
        assert.equal(scanHasFailures(scanWith({outcome: 'fail'})), true);
    });

    test('only can\'t-tell and pass findings do not count', () => {
        assert.equal(scanHasFailures(scanWith({outcome: 'cantTell'}, {outcome: 'pass'})), false);
    });

    test('an occurrence outcome overrides its finding, as the table split does', () => {
        const failingOcc = scanWith({outcome: 'cantTell', occurrences: [{occurrenceOutcome: 'fail'}]});
        assert.equal(scanHasFailures(failingOcc), true);

        const reviewOnly = scanWith({outcome: 'fail', occurrences: [{occurrenceOutcome: 'cantTell'}]});
        assert.equal(scanHasFailures(reviewOnly), false);
        assert.equal(scanHasReviewItems(reviewOnly), true);
    });

    test('occurrences without their own outcome inherit the finding\'s', () => {
        assert.equal(scanHasFailures(scanWith({outcome: 'fail', occurrences: [{}]})), true);
    });

    test('a scan without canonical findings has none', () => {
        assert.equal(scanHasFailures({}), false);
        assert.equal(scanHasFailures(null), false);
    });
});

describe('isFailureFreeScan', () => {
    test('true for a tested scan with no failures', () => {
        assert.equal(isFailureFreeScan(scanWith({outcome: 'cantTell'})), true);
        assert.equal(isFailureFreeScan(scanWith()), true);
    });

    test('false for a scan with failures', () => {
        assert.equal(isFailureFreeScan(scanWith({outcome: 'fail'})), false);
    });

    test('false for a skipped scan: not tested is not clean', () => {
        assert.equal(isSkippedScan({skipped: true}), true);
        assert.equal(isFailureFreeScan({skipped: true}), false);
        assert.equal(isFailureFreeScan({skipInfo: {reason: 'too large'}}), false);
    });

    test('false for a missing scan', () => {
        assert.equal(isFailureFreeScan(null), false);
    });
});

describe('failureFreeScansNote', () => {
    test('empty when every scan has failures or was skipped', () => {
        assert.equal(failureFreeScansNote([scanWith({outcome: 'fail'}), {skipped: true}]), '');
        assert.equal(failureFreeScansNote([]), '');
        assert.equal(failureFreeScansNote(undefined), '');
    });

    test('counts hidden scans and those still holding review items', () => {
        const scans = [
            scanWith({outcome: 'fail'}),
            scanWith({outcome: 'cantTell'}),
            scanWith({outcome: 'pass'}),
            scanWith({outcome: 'cantTell'})
        ];
        assert.equal(failureFreeScansNote(scans), '3 scans hidden: no failures (2 have can\'t-tell items to review).');
    });

    test('singular wording', () => {
        assert.equal(failureFreeScansNote([scanWith({outcome: 'pass'})]), '1 scan hidden: no failures.');
        assert.equal(failureFreeScansNote([scanWith({outcome: 'cantTell'})]), '1 scan hidden: no failures (1 has can\'t-tell items to review).');
    });
});
