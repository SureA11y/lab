'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const format = require('./report-format.js');

describe('report-format', () => {
    test('a report without a version is version 1', () => {
        assert.equal(format.reportVersionOf({}), 1);
        assert.equal(format.reportVersionOf({ reportVersion: 2 }), 2);
        assert.equal(format.reportVersionOf(null), 1);
    });

    test('an occurrence id is the same on another origin, and differs by rule, page or element', () => {
        const o = { target: ['#main', 'img'] };
        const id = format.occurrenceId('image-alt', o, 'https://example.com/a?x=1');
        assert.match(id, /^occ_[0-9a-f]{14}$/);
        assert.equal(format.occurrenceId('image-alt', o, 'https://staging.example.com/a?x=1'), id);
        assert.notEqual(format.occurrenceId('link-name', o, 'https://example.com/a?x=1'), id);
        assert.notEqual(format.occurrenceId('image-alt', o, 'https://example.com/b?x=1'), id);
        assert.notEqual(format.occurrenceId('image-alt', { target: ['img'] }, 'https://example.com/a?x=1'), id);
    });

    test('an element in a shadow root is named by its hosts too; one outside keeps its id', () => {
        const inRoot = (host) => ({ target: ['button:not(* > *)'], shadowHostSelectors: [host] });
        const a = format.occurrenceId('button-name', inRoot('#m > div:nth-of-type(2)'), 'https://example.com/');
        const b = format.occurrenceId('button-name', inRoot('#m > div:nth-of-type(4)'), 'https://example.com/');
        assert.notEqual(a, b);
        assert.equal(format.elementTarget(inRoot('#a')), '#a >>> button:not(* > *)');
        const plain = { target: ['main > button'] };
        assert.equal(format.elementTarget(plain), 'main > button');
        assert.equal(
            format.occurrenceId('button-name', { ...plain, shadowHostSelectors: [] }, 'https://example.com/'),
            format.occurrenceId('button-name', plain, 'https://example.com/'));
    });

    test('a finding is on the elements it lists and those its rule counted only', () => {
        assert.equal(format.occurrenceTotal({ occurrences: [{}, {}], unlisted: 950 }), 952);
        assert.equal(format.occurrenceTotal({ occurrences: [{}] }), 1);
        assert.equal(format.occurrenceTotal(null), 0);
    });

    test('an occurrence\'s own page wins over its scan\'s', () => {
        const o = { pageUrl: 'https://example.com/b', target: ['img'] };
        assert.equal(
            format.occurrenceId('image-alt', o, 'https://example.com/a'),
            format.occurrenceId('image-alt', { target: ['img'] }, 'https://example.com/b'));
    });

    test('occurrenceIdOf keeps a saved id', () => {
        assert.equal(format.occurrenceIdOf('r', { occurrenceId: 'occ_saved', target: ['a'] }, 'u'), 'occ_saved');
        assert.equal(format.occurrenceIdOf('r', { target: ['a'] }, 'u'), format.occurrenceId('r', { target: ['a'] }, 'u'));
    });

    test('upgradeScans brings an older scan to the current format', () => {
        const scans = [{
            url: 'https://example.com/',
            wcagLevel: 'AA',
            wcagVersion: '2.2',
            conformanceProfile: { id: 'section508', label: 'Section 508' },
            canonical: { findings: [{ ruleId: 'image-alt', outcome: 'fail', occurrences: [{ target: ['img'] }, { target: ['p'], occurrenceId: 'occ_kept' }] }] },
        }];
        format.upgradeScans(scans);
        const [scan] = scans;
        assert.deepEqual(scan.profile, { id: 'section508', label: 'Section 508' });
        assert.deepEqual(scan.wcag, { version: '2.2', level: 'AA' });
        assert.equal('wcagLevel' in scan || 'wcagVersion' in scan || 'conformanceProfile' in scan, false);
        const [first, second] = scan.canonical.findings[0].occurrences;
        assert.equal(first.occurrenceId, format.occurrenceId('image-alt', { target: ['img'] }, 'https://example.com/'));
        assert.equal(second.occurrenceId, 'occ_kept');
    });

    test('upgradeScans leaves a current scan\'s fields as they are', () => {
        const scan = { profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' }, wcag: { version: '2.2', level: 'AA' } };
        format.upgradeScans([scan]);
        assert.deepEqual(scan, { profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' }, wcag: { version: '2.2', level: 'AA' } });
    });

    test('an occurrence loses what it repeats: summary, and the engine\'s record of the same element', () => {
        const page = 'https://example.com/a';
        const o = {
            pageUrl: page, target: ['img'], html: '<img>', failureSummary: 'No alt.', summary: 'No alt.',
            evidence: { engineNode: { url: [page], pageUrl: page, target: ['img'], html: '<img>', failureSummary: 'No alt.' } },
        };
        format.compactOccurrence(o);
        assert.deepEqual(o, { pageUrl: page, target: ['img'], html: '<img>', failureSummary: 'No alt.' });
        // Again changes nothing.
        assert.deepEqual(format.compactOccurrence({ ...o }), o);
    });

    test('what an engine records beyond the occurrence stays, and so does what differs from it', () => {
        const o = {
            pageUrl: 'https://example.com/a', target: ['img'], html: '<img>', failureSummary: 'No alt.', summary: 'Other words.',
            evidence: {
                engineNode: { target: [['#host', 'img']], html: '<img>', any: [{ id: 'has-alt' }], impact: 'critical' },
                other: 1,
            },
        };
        format.compactOccurrence(o);
        assert.equal(o.summary, 'Other words.');
        assert.deepEqual(o.evidence, { engineNode: { target: [['#host', 'img']], any: [{ id: 'has-alt' }], impact: 'critical' }, other: 1 });
        // An engine that had no record of the element.
        const none = { target: [], evidence: { engineNode: null } };
        assert.deepEqual(format.compactOccurrence(none), { target: [] });
    });

    test('upgradeReport brings a version 2 report to 3: its findings by outcome go, its occurrences are compacted', () => {
        const page = 'https://example.com/';
        const occurrence = () => ({ pageUrl: page, target: ['img'], failureSummary: 'No alt.', summary: 'No alt.', evidence: { engineNode: { pageUrl: page, target: ['img'] } } });
        const report = {
            reportVersion: 2,
            scans: [{ profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' }, wcag: { version: '2.2', level: 'AA' }, url: page, canonical: { findings: [{ ruleId: 'image-alt', outcome: 'fail', occurrences: [occurrence()] }] } }],
            findings: { fail: [{ ruleId: 'image-alt', outcome: 'fail', occurrences: [occurrence()] }] },
            a11yGlobalFindings: { fail: [] },
        };
        format.upgradeReport(report);
        assert.equal(report.reportVersion, 3);
        assert.equal('findings' in report || 'a11yGlobalFindings' in report, false);
        const [o] = report.scans[0].canonical.findings[0].occurrences;
        assert.deepEqual(Object.keys(o).sort(), ['failureSummary', 'occurrenceId', 'pageUrl', 'target']);
    });
});

describe('pagePath', () => {
    test('gives a page\'s path and query, the same for an address met again', () => {
        assert.equal(format.pagePath('https://example.com/a/b?x=1#top'), '/a/b?x=1');
        assert.equal(format.pagePath('https://example.com/a/b?x=1#top'), '/a/b?x=1');
        assert.equal(format.pagePath('not a url'), 'not a url');
        assert.equal(format.pagePath(undefined), '');
    });
});
