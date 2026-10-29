'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { findingsByOutcome, CANON_VERSION, fromAxeResults } = require('./a11y-canonical');

describe('a11y-canonical: re-exports from the shared module', () => {
    test('CANON_VERSION and fromAxeResults are re-exported and usable', () => {
        assert.equal(typeof CANON_VERSION, 'string');
        assert.equal(typeof fromAxeResults, 'function');
        assert.equal(fromAxeResults({}).version, CANON_VERSION);
    });
});

describe('findingsByOutcome', () => {
    function scanWith(url, findings) {
        return { url, canonical: { findings } };
    }

    test('groups findings into fail/pass/cantTell/notApplicable buckets and attaches the scan url', () => {
        const scans = [
            scanWith('https://a.example/', [
                { uid: 'f1', outcome: 'fail' },
                { uid: 'p1', outcome: 'pass' }
            ])
        ];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail.length, 1);
        assert.equal(grouped.pass.length, 1);
        assert.deepEqual(grouped.fail[0].url, ['https://a.example/']);
    });

    test('returns all four buckets even when empty', () => {
        const grouped = findingsByOutcome([]);
        assert.deepEqual(Object.keys(grouped).sort(), ['cantTell', 'fail', 'notApplicable', 'pass']);
        for (const k of Object.keys(grouped)) assert.deepEqual(grouped[k], []);
    });

    test('a scan with no canonical.findings array is skipped without throwing', () => {
        const scans = [{ url: 'https://a.example/' }, scanWith('https://b.example/', [{ uid: 'f1', outcome: 'fail' }])];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail.length, 1);
    });

    test('a finding with an outcome outside the four known buckets is silently dropped', () => {
        const scans = [scanWith('https://a.example/', [{ uid: 'f1', outcome: 'somethingElse' }])];
        const grouped = findingsByOutcome(scans);
        for (const k of Object.keys(grouped)) assert.deepEqual(grouped[k], []);
    });

    test('findings sharing the same uid across different scans are merged, with urls combined', () => {
        const scans = [
            scanWith('https://a.example/', [{ uid: 'shared', outcome: 'fail', occurrences: [{ uid: 'occ1' }] }]),
            scanWith('https://b.example/', [{ uid: 'shared', outcome: 'fail', occurrences: [{ uid: 'occ2' }] }])
        ];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail.length, 1);
        assert.deepEqual(grouped.fail[0].url.sort(), ['https://a.example/', 'https://b.example/']);
        assert.equal(grouped.fail[0].occurrences.length, 2);
    });

    test('does not mutate the original finding objects', () => {
        const finding = { uid: 'f1', outcome: 'fail' };
        const scans = [scanWith('https://a.example/', [finding])];
        findingsByOutcome(scans);
        assert.equal('url' in finding, false);
    });

    test('non-array scans input is treated as empty', () => {
        const grouped = findingsByOutcome(null);
        for (const k of Object.keys(grouped)) assert.deepEqual(grouped[k], []);
    });
});

describe('a11y-canonical: mergeFindingsByUid (exercised indirectly via findingsByOutcome)', () => {
    function scanWith(url, findings) {
        return { url, canonical: { findings } };
    }

    test('findings without a uid are kept as separate entries, never merged together', () => {
        const scans = [scanWith('https://a.example/', [
            { outcome: 'fail', ruleId: 'x' },
            { outcome: 'fail', ruleId: 'x' }
        ])];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail.length, 2);
    });

    test('for a shared uid, the first-seen finding\'s scalar fields win (later ones do not overwrite title)', () => {
        const scans = [
            scanWith('https://a.example/', [{ uid: 'shared', outcome: 'fail', title: 'First title' }]),
            scanWith('https://b.example/', [{ uid: 'shared', outcome: 'fail', title: 'Second title' }])
        ];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail[0].title, 'First title');
    });

    test('occurrence de-duplication prefers occurrence.uid, then .key, then selector+html, then selector', () => {
        const scans = [scanWith('https://a.example/', [{
            uid: 'shared',
            outcome: 'fail',
            occurrences: [
                { uid: 'occ-uid-1' },
                { uid: 'occ-uid-1' }, // exact duplicate by uid -> deduped
                { key: 'k1' },
                { key: 'k1' }, // duplicate by key -> deduped
                { selector: '.a', html: '<div>a</div>' },
                { selector: '.a', html: '<div>a</div>' }, // duplicate by selector+html -> deduped
                { selector: '.b' },
                { selector: '.b' } // duplicate by selector alone -> deduped
            ]
        }])];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail[0].occurrences.length, 4);
    });

    test('occurrences with no uid/key/selector fall back to a JSON.stringify dedupe key, even when that throws (circular refs)', () => {
        const circular = {};
        circular.self = circular; // JSON.stringify(circular) throws -> falls back to String(o)
        const scans = [scanWith('https://a.example/', [{
            uid: 'shared',
            outcome: 'fail',
            occurrences: [
                { note: 'plain, no uid/key/selector' },
                { note: 'plain, no uid/key/selector' }, // same JSON.stringify() -> deduped
                circular,
                circular // same String(o) fallback ("[object Object]") -> deduped against itself
            ]
        }])];
        const grouped = findingsByOutcome(scans);
        assert.equal(grouped.fail[0].occurrences.length, 2);
    });
});
