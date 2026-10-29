'use strict';

// A scan that names some of a criterion's checks: core reports the criterion
// partly checked (cantTell, its other checks notSelected), and the adapter,
// the coverage and the scan's counts must keep that, never reading it as a
// pass. Runs core itself on a jsdom page; node's test runner gives this file a
// process of its own, so the globals it sets do not leak.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { buildCoverageAwareSummary } = require('../metrics/coverage-summary');

let runOnPage;

before(() => {
    const dom = new JSDOM(
        '<!doctype html><html lang="en" style="background:#fff"><head><title>Prices</title></head>'
        + '<body><main><h1>Prices</h1><p style="color:#222;background:#fff">Price: 9.99</p></main></body></html>',
        { pretendToBeVisual: true, url: 'https://example.test/prices' }
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    ({ runOnPage } = require('./a11y-labs-engine'));
});

// A page whose evaluate runs what it is sent in this jsdom page, as the
// browser would: the script that registers the scan's packs, the binding's
// question of which style sheets the page can't read, then core's scan,
// wrapped by @surea11y/puppeteer. `calls` holds the scans.
function corePage() {
    const calls = [];
    return {
        calls,
        url: () => 'https://example.test/prices',
        title: async () => 'Prices',
        evaluate: async (fn, ...args) => {
            // eslint-disable-next-line no-eval
            if (typeof fn === 'string') return (0, eval)(fn);
            if (fn.name === 'findUnreadableStyleSheets') return fn(...args);
            calls.push(args);
            return fn(...args);
        },
    };
}

const AA = { version: '2.2', level: 'AA', profile: null, bestPractices: false };

describe('partly checked criteria', () => {
    test('a criterion whose selected check passed is partly checked, not passed', async () => {
        const page = corePage();
        const { canonical } = await runOnPage(page, { selection: AA, runOnly: { includeRuleIds: ['contrast-computable'] } });

        const c143 = canonical.findings.filter((f) => f.ruleId === 'wcag-1.4.3-contrast-minimum');
        assert.deepEqual(c143.map((f) => f.outcome).sort(), ['cantTell', 'pass']);
        const partly = c143.find((f) => f.outcome === 'cantTell');
        assert.deepEqual(partly.partlyChecked, { notSelected: 1, checks: 2 });
        assert.deepEqual(partly.evidence.rollup.contributors, [{ testId: 'contrast-minimum', outcome: 'missing', notSelected: true }]);

        assert.equal(canonical.findings.some((f) => f.ruleId === 'wcag-1.4.6-contrast-enhanced'), false, 'no AAA criterion on an AA scan');
        assert.equal(page.calls[0][2].wcagLevel, 'AA');

        const coverage = buildCoverageAwareSummary({ canonical });
        const sc = coverage.criteria.find((c) => c.sc === '1.4.3');
        assert.equal(sc.status, 'needsReview', 'a pass of one check does not support the criterion');
        assert.equal(sc.checks.notRun, 1);
    });

    test('a failing check fails the criterion, with no partly checked finding beside it', async () => {
        document.querySelector('p').setAttribute('style', 'color:#aaa;background:#fff');
        try {
            const { canonical } = await runOnPage(corePage(), { selection: AA, runOnly: { includeRuleIds: ['contrast-minimum'] } });
            const c143 = canonical.findings.filter((f) => f.ruleId === 'wcag-1.4.3-contrast-minimum');
            assert.deepEqual(c143.map((f) => f.outcome), ['fail']);
            assert.equal(c143[0].partlyChecked, undefined);
            const sc = buildCoverageAwareSummary({ canonical }).criteria.find((c) => c.sc === '1.4.3');
            assert.equal(sc.status, 'doesNotSupport');
        } finally {
            document.querySelector('p').setAttribute('style', 'color:#222;background:#fff');
        }
    });

    test('a full scan is unchanged: no partly checked finding', async () => {
        const { canonical } = await runOnPage(corePage(), { selection: AA });
        assert.equal(canonical.findings.some((f) => f.partlyChecked), false);
        const sc = buildCoverageAwareSummary({ canonical }).criteria.find((c) => c.sc === '1.4.3');
        assert.equal(sc.status, 'supports');
        assert.equal(sc.checks.notRun, 0);
    });
});
