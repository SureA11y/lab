'use strict';

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const {
    scanCardCounts,
    scanCardThumbnail,
    scanToAllScansCardProps
} = require('./all-scans-data.js');

// These back the "View all scans" dialog cards. They must derive the same
// numbers the results header shows and reuse the scan's existing screenshot, so
// a card reads identically to the live-preview card and the exported report.

describe('scanCardCounts', () => {
    test('counts canonical findings by outcome', () => {
        const scan = {
            canonical: {
                findings: [
                    {outcome: 'fail'}, {outcome: 'fail'},
                    {outcome: 'cantTell'},
                    {outcome: 'pass'}, {outcome: 'pass'}, {outcome: 'pass'}
                ]
            }
        };
        assert.deepEqual(scanCardCounts(scan), {violations: 2, incomplete: 1, passes: 3});
    });

    test('falls back to summary counts when there are no canonical findings', () => {
        const scan = {summary: {failCount: 4, reviewCount: 5, passesCount: 12}};
        assert.deepEqual(scanCardCounts(scan), {violations: 4, incomplete: 5, passes: 12});
    });

    test('canonical findings win over summary counts', () => {
        const scan = {
            canonical: {findings: [{outcome: 'fail'}]},
            summary: {failCount: 99, reviewCount: 99, passesCount: 99}
        };
        assert.deepEqual(scanCardCounts(scan), {violations: 1, incomplete: 0, passes: 0});
    });

    test('returns zeros when neither canonical nor summary is present', () => {
        assert.deepEqual(scanCardCounts({}), {violations: 0, incomplete: 0, passes: 0});
        assert.deepEqual(scanCardCounts(null), {violations: 0, incomplete: 0, passes: 0});
    });
});

describe('scanCardThumbnail', () => {
    test('uses the first screenshot string', () => {
        assert.equal(scanCardThumbnail({screenshots: ['a.jpg', 'b.jpg']}), 'a.jpg');
    });

    test('prefers publicUrl then dataUrl on a screenshot object', () => {
        assert.equal(scanCardThumbnail({screenshots: [{publicUrl: 'p.jpg', dataUrl: 'd'}]}), 'p.jpg');
        assert.equal(scanCardThumbnail({screenshots: [{dataUrl: 'd'}]}), 'd');
    });

    test('falls back to the report screenshot', () => {
        assert.equal(scanCardThumbnail({report: {screenshotPublicUrl: 'r.jpg'}}), 'r.jpg');
        assert.equal(scanCardThumbnail({report: {screenshotDataUrl: 'rd'}}), 'rd');
    });

    test('returns null when there is no image', () => {
        assert.equal(scanCardThumbnail({}), null);
        assert.equal(scanCardThumbnail({screenshots: []}), null);
    });
});

describe('scanToAllScansCardProps', () => {
    const fullScan = {
        id: 'scan-1',
        label: 'SEPA direct debits',
        wcagLevel: 'AA',
        viewportRatio: 1.5,
        canonical: {
            page: {url: 'https://example.test/sepa'},
            diagnostics: {durationMs: 401, estimatedNodes: 1094},
            findings: [{outcome: 'fail'}, {outcome: 'pass'}]
        },
        screenshots: [{publicUrl: 'shot.jpg'}]
    };

    test('maps the core card fields from a normal scan', () => {
        const p = scanToAllScansCardProps(fullScan, 0);
        assert.equal(p.label, 'SEPA direct debits');
        assert.equal(p.scanId, 'scan-1');
        assert.equal(p.url, 'https://example.test/sepa');
        assert.equal(p.previewUrl, 'shot.jpg');
        assert.equal(p.viewportRatio, 1.5);
        assert.deepEqual(p.meta, {durationMs: 401, estimatedNodes: 1094});
        assert.deepEqual(p.counts, {violations: 1, incomplete: 0, passes: 1});
        assert.equal(p.excluded, false);
        assert.equal(p.filteredOut, false);
        assert.equal(p.skipped, false);
    });

    test('label falls back to id then to a positional name', () => {
        assert.equal(scanToAllScansCardProps({id: 'x'}, 3).label, 'x');
        assert.equal(scanToAllScansCardProps({}, 3).label, 'Scan 4');
    });

    test('url falls back to scan.url when canonical page url is absent', () => {
        assert.equal(scanToAllScansCardProps({url: 'https://fallback.test'}, 0).url, 'https://fallback.test');
    });

    test('flags excluded scans (includedInReport === false)', () => {
        assert.equal(scanToAllScansCardProps({includedInReport: false}, 0).excluded, true);
        assert.equal(scanToAllScansCardProps({includedInReport: true}, 0).excluded, false);
        assert.equal(scanToAllScansCardProps({}, 0).excluded, false);
    });

    test('filteredOut is driven by the injected tag-filter predicate', () => {
        const hidden = scanToAllScansCardProps({id: 'a'}, 0, {matchesTagFilter: () => false});
        const shown = scanToAllScansCardProps({id: 'a'}, 0, {matchesTagFilter: () => true});
        assert.equal(hidden.filteredOut, true);
        assert.equal(shown.filteredOut, false);
    });

    test('recognises skipped scans and carries their skipInfo', () => {
        const skip = {id: 's', skipInfo: {reason: 'DOM too large for a full scan'}};
        const p = scanToAllScansCardProps(skip, 0);
        assert.equal(p.skipped, true);
        assert.equal(p.skipInfo.reason, 'DOM too large for a full scan');
    });

    test('defaults viewportRatio to 4/3 when the scan has none', () => {
        assert.equal(scanToAllScansCardProps({}, 0).viewportRatio, 4 / 3);
    });
});
