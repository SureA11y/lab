'use strict';

// One site under two paths (/v1/, /v2/) compared page by page: the prefixes
// a comparison leaves out of the paths it matches on (report-format.js
// withPathPrefixes), and what the diff engines make of them.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const format = require('./report-format.js');
const { diffReports } = require('./report-diff.js');
const { diffReportSeries } = require('./report-multi-diff.js');

const { normalizePathPrefixes, withPathPrefixes, pagePath, suggestPathPrefixes, occurrenceIdOf } = format;

const page = (path, findings) => ({ id: path, url: `https://shop.example${path}`, canonical: { findings } });
const fail = (ruleId, target, url) => ({
    ruleId, id: ruleId, outcome: 'fail', severity: 'serious', wcag: { sc: ['1.1.1'] },
    occurrences: [{ target: [target], pageUrl: url }],
});
const report = (runId, day, prefix, rules) => ({
    runId, timestamp: `2026-11-0${day}T10:00:00Z`, url: `https://shop.example${prefix}/`,
    scans: [
        page(`${prefix}/cart.html`, rules.map((r) => fail(r, `#${r}`, `https://shop.example${prefix}/cart.html`))),
        page(`${prefix}/login.html`, [fail('label', '#user', `https://shop.example${prefix}/login.html`)]),
    ],
});

describe('normalizePathPrefixes', () => {
    test('one leading slash, no trailing one, blanks and the root left out, longest first', () => {
        assert.deepEqual(normalizePathPrefixes('v1, /v1/beta/ , /, ,/v2'), ['/v1/beta', '/v1', '/v2']);
        assert.deepEqual(normalizePathPrefixes(['/v1', '/v1/']), ['/v1']);
        assert.deepEqual(normalizePathPrefixes(null), []);
    });
});

describe('pagePath, with prefixes left out', () => {
    test('a prefix goes at a segment\'s end only, and only while the comparison runs', () => {
        const paths = withPathPrefixes(['/v1'], () => [
            pagePath('https://h/v1/cart.html'),
            pagePath('https://h/v10/cart.html'),
            pagePath('https://h/v1'),
            pagePath('https://h/v1?q=1'),
            pagePath('https://h/other/v1/cart.html'),
        ]);
        assert.deepEqual(paths, ['/cart.html', '/v10/cart.html', '/', '/?q=1', '/other/v1/cart.html']);
        assert.equal(pagePath('https://h/v1/cart.html'), '/v1/cart.html');
    });

    test('nested runs give the outer prefixes back', () => {
        withPathPrefixes(['/v1'], () => {
            withPathPrefixes([], () => assert.equal(pagePath('https://h/v1/a'), '/v1/a'));
            assert.equal(pagePath('https://h/v1/a'), '/a');
        });
    });

    test('an occurrence keeps the id its report gives it', () => {
        const o = { target: ['#a'], pageUrl: 'https://h/v1/cart.html' };
        const own = occurrenceIdOf('rule', o, '');
        assert.equal(withPathPrefixes(['/v1'], () => occurrenceIdOf('rule', o, '')), own);
    });
});

describe('suggestPathPrefixes', () => {
    test('each report under one folder of its own, and pages they then share', () => {
        assert.deepEqual(suggestPathPrefixes([report('a', 1, '/v1', ['x']), report('b', 2, '/v2', ['x'])]), ['/v1', '/v2']);
    });

    test('nothing when the reports already share pages, or their pages differ anyway', () => {
        assert.deepEqual(suggestPathPrefixes([report('a', 1, '/v1', ['x']), report('b', 2, '/v1', ['x'])]), []);
        const other = { runId: 'c', scans: [page('/v3/elsewhere.html', [])] };
        assert.deepEqual(suggestPathPrefixes([report('a', 1, '/v1', ['x']), other]), []);
        const root = { runId: 'd', scans: [page('/cart.html', [])] };
        assert.deepEqual(suggestPathPrefixes([report('a', 1, '/v1', ['x']), root]), []);
    });
});

describe('a comparison with path prefixes left out', () => {
    const a = () => report('a', 1, '/v1', ['image-alt', 'contrast']);
    const b = () => report('b', 2, '/v2', ['contrast', 'link-name']);

    test('two reports: one site\'s pages match, and the note can say how', () => {
        const as = diffReports(a(), b());
        assert.equal(as.document.pagesUnmatched, true);
        assert.ok(as.rows.every((r) => r.occ.every((o) => o.tag !== 'still')), 'no page in common: nothing still fails');

        const d = diffReports(a(), b(), { pathPrefixes: ['/v1', '/v2'] });
        assert.equal(d.document.pagesUnmatched, undefined);
        assert.deepEqual(d.document.pathPrefixes, ['/v1', '/v2']);
        const tags = Object.fromEntries(d.rows.map((r) => [r.ruleId, r.occ.map((o) => o.tag).join()]));
        assert.deepEqual(tags, { 'image-alt': 'fixed', contrast: 'still', 'link-name': 'new', label: 'still' });
    });

    test('what is shown keeps its own address', () => {
        const d = diffReports(a(), b(), { pathPrefixes: '/v1, /v2' });
        const still = d.rows.find((r) => r.ruleId === 'contrast').occ[0];
        assert.match(still.pageUrl, /\/v[12]\/cart\.html$/);
    });

    test('a series matches its pages the same way', () => {
        const c = () => report('c', 3, '/v3', ['contrast']);
        const s = diffReportSeries([a(), b(), c()], { pathPrefixes: ['/v1', '/v2', '/v3'] });
        assert.deepEqual(s.document.pathPrefixes, ['/v1', '/v2', '/v3']);
        assert.equal(s.document.pagesUnmatched, undefined);
        assert.deepEqual(s.gate.subjects, ['/']);
    });

    test('no prefixes, no change', () => {
        const d = diffReports(a(), b(), { pathPrefixes: [] });
        assert.equal(d.document.pathPrefixes, undefined);
    });
});
