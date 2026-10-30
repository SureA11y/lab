'use strict';

// The runner resolves the rule catalog once and turns it into an automation
// coverage scope for each conformance level. These tests cover the two things
// that are easy to get wrong: caching across engines, and what happens when an
// engine cannot produce a catalog at all.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { getAutomationCoverage } = require('./a11y-runner');

describe('runner automation coverage', () => {
    test('the default engine yields a scope sized to the requested conformance level', async () => {
        const aa = await getAutomationCoverage('AA');
        const a = await getAutomationCoverage('A');

        assert.equal(aa.scope.level, 'AA');
        assert.equal(aa.totals.inScope, 55);
        assert.equal(a.totals.inScope, 31);
        assert.ok(aa.totals.automatic > 0);
    });

    test('automation reaches a minority of WCAG AA, so the scope must not be assumed complete', () => {
        return getAutomationCoverage('AA').then((cov) => {
            assert.ok(cov.totals.notAutomatable > cov.totals.automatic);
        });
    });

    test('a missing or oddly cased level falls back to AA', async () => {
        const fallback = await getAutomationCoverage(undefined);
        const lower = await getAutomationCoverage('aa');
        assert.equal(fallback.totals.inScope, 55);
        assert.equal(lower.scope.level, 'AA');
    });

    test('repeated calls return the identical memoized object rather than rebuilding', async () => {
        const first = await getAutomationCoverage('AA');
        const second = await getAutomationCoverage('AA');
        assert.equal(first, second);
    });

    test('different levels are cached separately', async () => {
        const aa = await getAutomationCoverage('AA');
        const aaa = await getAutomationCoverage('AAA');
        assert.notEqual(aa, aaa);
        assert.equal(aaa.totals.inScope, 86);
    });

    test('a failed engine lookup does not poison the default engine cache', async () => {
        await getAutomationCoverage('AA', 'engine-b');
        const cov = await getAutomationCoverage('AA');
        assert.ok(cov && cov.totals.inScope === 55);
    });
});
