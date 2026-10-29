'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { mineOccurrences, normalizeSelector } = require('./occurrence-mining');

function occ(pageUrl, target, html = '<img>') {
    return { pageUrl, target: [target], html };
}

function finding(ruleId, occurrences, outcome = 'fail') {
    return { uid: `u:${outcome}:${ruleId}`, ruleId, outcome, severity: 'serious', occurrences };
}

describe('normalizeSelector', () => {
    test('drops positional indices so repeated instances collapse together', () => {
        assert.equal(normalizeSelector('main:nth-of-type(1) > div > section:nth-of-type(7)'), 'main > div > section');
        assert.equal(normalizeSelector('li:nth-child(3) > a'), 'li > a');
    });

    test('keeps attribute names but drops their values', () => {
        assert.equal(normalizeSelector('a[aria-label="Find out more"] > span'), 'a[aria-label] > span');
        assert.equal(normalizeSelector('[data-test="test"] > div'), '[data-test] > div');
    });

    test('masks generated ids so one component does not read as many local defects', () => {
        const a = normalizeSelector('#glide-d181964c-4745-4875-ac52-c81643bbc033 > div > img');
        const b = normalizeSelector('#glide-9f2b1a55-1111-2222-3333-444455556666 > div > img');
        assert.equal(a, b);
        assert.equal(a, '#glide-* > div > img');
    });

    test('a meaningful id survives', () => {
        assert.equal(normalizeSelector('#main-nav > a'), '#main-nav > a');
    });

    test('whitespace around combinators is normalized', () => {
        assert.equal(normalizeSelector('div>span'), 'div > span');
        assert.equal(normalizeSelector('  div   >   span  '), 'div > span');
    });

    test('empty and non-string input yields an empty string', () => {
        for (const v of ['', null, undefined, 0]) assert.equal(normalizeSelector(v), '');
    });
});

describe('mineOccurrences: clustering', () => {
    const findings = [
        finding('img-alt', [occ('https://a/', 'img'), occ('https://a/', '.hero > img'), occ('https://b/', 'img')]),
        finding('contrast', [occ('https://a/', 'button'), occ('https://a/', 'button')])
    ];

    test('patterns are ranked by occurrence count', () => {
        const out = mineOccurrences({ findings });
        assert.equal(out.topPatterns[0].pattern, 'button');
        assert.equal(out.topPatterns[0].occurrences, 2);
    });

    test('the failing element is reported separately from the full path', () => {
        const out = mineOccurrences({ findings });
        const img = out.topElements.find((e) => e.element === 'img');
        assert.equal(img.occurrences, 3, 'both bare img and .hero > img count as an img');
    });

    test('a cluster records which rules hit it and how many pages it spans', () => {
        const out = mineOccurrences({ findings });
        const img = out.topElements.find((e) => e.element === 'img');
        assert.deepEqual(img.ruleIds, ['img-alt']);
        assert.equal(img.pages, 2);
    });

    test('a sample of the markup is kept for the first occurrence in a cluster', () => {
        const out = mineOccurrences({ findings: [finding('r', [occ('https://a/', 'img', '<img src=x>')])] });
        assert.equal(out.topPatterns[0].sampleHtml, '<img src=x>');
    });

    test('the limit caps how many clusters are returned', () => {
        const many = finding('r', Array.from({ length: 30 }, (_, i) => occ('https://a/', `div.c${i}`)));
        assert.equal(mineOccurrences({ findings: [many], limit: 5 }).topPatterns.length, 5);
    });

    test('passes and notApplicable carry no debt and are excluded', () => {
        const out = mineOccurrences({
            findings: [finding('p', [occ('https://a/', 'img')], 'pass'), finding('n', [occ('https://a/', 'img')], 'notApplicable')]
        });
        assert.equal(out.totals.clusteredOccurrences, 0);
    });

    test('cantTell findings are clustered, since they still need attention', () => {
        const out = mineOccurrences({ findings: [finding('r', [occ('https://a/', 'img')], 'cantTell')] });
        assert.equal(out.totals.clusteredOccurrences, 1);
    });

    test('occurrences with no usable target are skipped rather than bucketed under an empty key', () => {
        const out = mineOccurrences({ findings: [finding('r', [{ pageUrl: 'https://a/', target: [] }, occ('https://a/', 'img')])] });
        assert.equal(out.totals.distinctPatterns, 1);
    });
});

describe('mineOccurrences: scope', () => {
    const onEvery = finding('everywhere', [occ('https://a/', 'img'), occ('https://b/', 'img')]);
    const onOne = finding('here', [occ('https://a/', 'button')]);

    test('present on every scanned page reads as systemic', () => {
        const out = mineOccurrences({ findings: [onEvery, onOne], pagesScanned: 2 });
        assert.equal(out.reach.find((r) => r.ruleId === 'everywhere').scope, 'systemic');
    });

    test('present on one page of several reads as local', () => {
        const out = mineOccurrences({ findings: [onEvery, onOne], pagesScanned: 2 });
        assert.equal(out.reach.find((r) => r.ruleId === 'here').scope, 'local');
    });

    test('present on some but not all reads as partial', () => {
        const out = mineOccurrences({ findings: [onEvery, onOne], pagesScanned: 3 });
        assert.equal(out.reach.find((r) => r.ruleId === 'everywhere').scope, 'partial');
    });

    test('a single scanned page cannot tell systemic from local, and says unknown', () => {
        const out = mineOccurrences({ findings: [onOne], pagesScanned: 1 });
        assert.equal(out.reach[0].scope, 'unknown');
    });

    test('with no page count given, the distinct pages seen are used', () => {
        const out = mineOccurrences({ findings: [onEvery] });
        assert.equal(out.pagesScanned, 2);
        assert.equal(out.reach[0].scope, 'systemic');
    });

    test('totals tally the scopes', () => {
        const out = mineOccurrences({ findings: [onEvery, onOne], pagesScanned: 2 });
        assert.equal(out.totals.systemic, 1);
        assert.equal(out.totals.local, 1);
        assert.equal(out.totals.partial, 0);
    });

    test('reach is ordered by pages affected, then occurrences', () => {
        const out = mineOccurrences({ findings: [onOne, onEvery], pagesScanned: 2 });
        assert.deepEqual(out.reach.map((r) => r.ruleId), ['everywhere', 'here']);
    });
});

describe('mineOccurrences: degenerate input', () => {
    test('no findings produces a well-formed empty result', () => {
        const out = mineOccurrences({ findings: [] });
        assert.deepEqual(out.topPatterns, []);
        assert.deepEqual(out.reach, []);
        assert.equal(out.totals.clusteredOccurrences, 0);
    });

    test('missing input does not throw', () => {
        assert.equal(mineOccurrences().totals.distinctPatterns, 0);
        assert.equal(mineOccurrences({ findings: null }).totals.distinctPatterns, 0);
        assert.equal(mineOccurrences({ findings: [null, undefined] }).totals.distinctPatterns, 0);
    });

    test('a finding with no occurrences contributes nothing', () => {
        assert.equal(mineOccurrences({ findings: [finding('r', [])] }).reach.length, 0);
    });
});
