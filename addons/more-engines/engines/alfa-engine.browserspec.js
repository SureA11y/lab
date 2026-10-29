'use strict';

// Real-Chrome integration tests for alfa-engine.js.
//
// Why real Chrome, not mocks: alfa-engine.js loads the real @siteimprove/alfa-*
// packages via dynamic import() inside runOnPage(), not require(), because they
// ship as pure ESM. That means the CJS require.cache substitution pa11y-engine's
// tests use to swap in a fake engine doesn't apply here - there is no synchronous
// hook to intercept an import(). A hand-rolled fake of Alfa's audit/outcome/DOM
// classes would also prove nothing about the actual risk in this adapter: whether
// its XPath-to-CSS-selector conversion (target.path() -> :nth-of-type chain)
// actually resolves back to the right element in a real DOM.
//
// This file is intentionally NOT named *.test.js so `node --test` (the default
// `npm test`) never picks it up and never depends on a working Chrome install or
// network access to npm. Run explicitly via:
//   npm run test:dom
// If Chrome can't launch, the `before()` hook throws and the whole file fails
// loudly - it does not skip silently.
//
// Determinism: every page here is static, inline HTML with no network requests,
// so the same input always produces the same Alfa outcomes.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { validateCanonical } = require('../../../src/server-side/canonical/validate-canonical');
const engine = require('./alfa-engine');

let browser;
let page;

before(async () => {
    try {
        browser = await puppeteer.launch({ headless: 'new', ignoreHTTPSErrors: true, args: ['--no-sandbox'] });
    } catch (e) {
        throw new Error(
            `alfa-engine.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n` +
            `Original error: ${e && e.message ? e.message : e}`
        );
    }
});

after(async () => {
    if (browser) await browser.close().catch(() => {});
});

beforeEach(async () => {
    page = await browser.newPage();
});

afterEach(async () => {
    if (page) await page.close().catch(() => {});
});

async function setHtml(html) {
    await page.setContent(`<!doctype html><html lang="en"><head><title>Fixture</title></head><body>${html}</body></html>`, {
        waitUntil: 'load'
    });
}

describe('alfa-engine: runOnPage against a real page', () => {
    test('finds the missing image alt text, with a canonical shape that passes strict validation', async () => {
        await setHtml('<div><img src="missing.png"></div>');

        const { canonical, native } = await engine.runOnPage(page, {});

        assert.equal(validateCanonical(canonical).ok, true);
        assert.equal(canonical.engine.id, 'alfa');
        assert.ok(native.ruleCount > 0);

        const altFinding = canonical.findings.find((f) => f.id === 'sia-r2');
        assert.ok(altFinding, 'expected a finding for rule sia-r2 (non-text content)');
        assert.equal(altFinding.outcome, 'fail');
        assert.deepEqual(altFinding.wcag, { sc: ['1.1.1'] });
        // 1.1.1 is a Level A criterion, so this should carry real severity, not "unknown".
        assert.equal(altFinding.severity, 'critical');

        const [occurrence] = altFinding.occurrences;
        assert.equal(occurrence.html, '<img src="missing.png">');
        assert.equal(
            occurrence.target[0],
            'html:nth-of-type(1) > body:nth-of-type(1) > div:nth-of-type(1) > img:nth-of-type(1)'
        );
    });

    test('a page with no accessibility issues in scope reports zero failures', async () => {
        // The explicit size keeps the button clear of Alfa's target-size-enhanced rule too,
        // so this fixture is genuinely clean rather than just missing the alt-text failure.
        await setHtml('<img src="ok.png" alt="a descriptive label"><button style="width:44px;height:44px">Save</button>');

        const { canonical } = await engine.runOnPage(page, {});

        assert.equal(canonical.summary.outcomes.fail, 0);
        assert.equal(canonical.findings.find((f) => f.id === 'sia-r2').outcome, 'pass');
    });

    test('runOnly.wcagLevel narrows the rule set and drops best-practice-only failures', async () => {
        // sia-r59 (document must have a heading) has no WCAG criterion requirement - it's
        // an Alfa "best practice" rule, so it should only fail when best practice is included.
        await setHtml('<p>No headings on this page.</p>');

        const full = await engine.runOnPage(page, { runOnly: { wcagLevel: null, includeBestPractice: true } });
        const fullFinding = full.canonical.findings.find((f) => f.id === 'sia-r59');
        assert.ok(fullFinding, 'expected sia-r59 to run when best practice is included');
        assert.equal(fullFinding.outcome, 'fail');

        const aaOnly = await engine.runOnPage(page, { runOnly: { wcagLevel: 'AA', includeBestPractice: false } });
        assert.equal(aaOnly.canonical.findings.find((f) => f.id === 'sia-r59'), undefined);
        assert.ok(aaOnly.native.ruleCount < full.native.ruleCount);
    });
});
