'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');

const { buildBaselineEntries } = require('@surea11y/core/baseline');
const { leaningFailures } = require('@surea11y/core');
const { parseFormats, scanFileStem, baselineEntriesFor, likelyFailures, writeExports } = require('./export-formats');
const { mergeCoreResults } = require('../server-side/merged-scan');

// A real surea11y result, from a small page scanned under jsdom, so the
// renderers get exactly what the adapter keeps. node's test runner isolates
// each file in its own process, so the globals set here do not leak.
let coreResult;
let tmp;

before(async () => {
    const dom = new JSDOM(
        '<!doctype html><html lang="en"><head><title>Checkout</title></head>' +
        '<body><main><img src="a.png"><button></button></main></body></html>',
        { pretendToBeVisual: true, url: 'https://example.test/checkout' }
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    const { runa11yCoreInPage } = require('@surea11y/core');
    coreResult = await runa11yCoreInPage('https://example.test/checkout', null, { locale: 'en' }, null);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surea11y-exports-'));
});

after(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parseFormats', () => {
    test('accepts a comma-separated list in any case and order, without repeats', () => {
        assert.deepEqual(parseFormats('JUnit, sarif,junit'), { formats: ['sarif', 'junit'], errors: [] });
    });

    test('reports an unknown format and an empty value', () => {
        assert.match(parseFormats('sarif,html').errors[0], /Unknown format "html"/);
        assert.match(parseFormats('  ').errors[0], /at least one/);
    });
});

describe('scanFileStem', () => {
    test('numbers the scan and names it from its label', () => {
        assert.equal(scanFileStem({ label: 'Checkout – Step 2' }, 0, 3), '01-checkout-step-2');
        assert.equal(scanFileStem({ url: 'https://example.test/' }, 11, 120), '012-https-example-test');
        assert.equal(scanFileStem({}, 4, 5), '05');
    });
});

describe('writeExports', () => {
    test('writes each format once per scan that ran surea11y', () => {
        const outDir = path.join(tmp, 'all');
        const { written, known } = writeExports(
            [
                { label: 'Home', result: coreResult },
                { label: 'Another engine only', result: null },
                { label: 'Checkout', result: coreResult }
            ],
            ['sarif', 'junit', 'earl'],
            outDir
        );

        assert.equal(known, 0);
        assert.deepEqual(written.map((f) => path.basename(f)), [
            '01-home.sarif', '01-home.junit.xml', '01-home.earl.jsonld',
            '02-checkout.sarif', '02-checkout.junit.xml', '02-checkout.earl.jsonld'
        ]);

        const sarif = JSON.parse(fs.readFileSync(path.join(outDir, 'exports', '01-home.sarif'), 'utf8'));
        assert.equal(sarif.version, '2.1.0');
        assert.ok(sarif.runs[0].results.length > 0, 'the page has failures, so SARIF should list them');

        const junit = fs.readFileSync(path.join(outDir, 'exports', '01-home.junit.xml'), 'utf8');
        assert.match(junit, /<testsuites[\s>]/);
        assert.match(junit, /<failure/);

        const earl = JSON.parse(fs.readFileSync(path.join(outDir, 'exports', '01-home.earl.jsonld'), 'utf8'));
        assert.equal(earl['@graph'][0].source, 'https://example.test/checkout');
        assert.ok(earl['@graph'][0].assertions.length > 0);
    });

    test('writes nothing when no scan has a surea11y result', () => {
        const outDir = path.join(tmp, 'none');
        assert.deepEqual(writeExports([{ label: 'x', result: null }], ['sarif'], outDir), { written: [], known: 0, likely: null });
        assert.equal(fs.existsSync(path.join(outDir, 'exports')), false);
    });
});

describe('writeExports with a baseline', () => {
    const url = 'https://example.test/checkout';

    function exportAgainst(baselinePayload, name) {
        const outDir = path.join(tmp, name);
        const res = writeExports([{ label: 'Checkout', url, result: coreResult }], ['sarif', 'junit'], outDir, { baselinePayload });
        const sarif = JSON.parse(fs.readFileSync(path.join(outDir, 'exports', '01-checkout.sarif'), 'utf8'));
        const junit = fs.readFileSync(path.join(outDir, 'exports', '01-checkout.junit.xml'), 'utf8');
        return { ...res, sarif, junit };
    }

    test('a failure the baseline already had is not reported again', () => {
        const baseline = { scans: [{ label: 'Checkout', url, coreBaseline: buildBaselineEntries(coreResult) }] };
        const fresh = exportAgainst(null, 'fresh');
        const known = exportAgainst(baseline, 'known');

        assert.ok(known.known > 0);
        assert.equal(known.known, buildBaselineEntries(coreResult).length);
        assert.equal(known.sarif.runs[0].results.filter((r) => r.level === 'error').length, 0);
        assert.ok(fresh.sarif.runs[0].results.some((r) => r.level === 'error'));
        assert.doesNotMatch(known.junit, /<failure/);
    });

    test('a baseline without stored entries filters nothing', () => {
        const res = exportAgainst({ scans: [{ label: 'Checkout', url }] }, 'no-entries');
        assert.equal(res.known, 0);
        assert.match(res.junit, /<failure/);
    });
});

describe('writeExports with failOnLean', () => {
    const url = 'https://example.test/checkout';
    const leaning = () => leaningFailures(coreResult).length;

    test('a question that leans fail gates: an error in SARIF, a failure in JUnit', () => {
        assert.ok(leaning() > 0, 'the page has no level-one heading, which leans fail');
        const outDir = path.join(tmp, 'lean');
        const res = writeExports([{ label: 'Checkout', url, result: coreResult }], ['sarif', 'junit'], outDir, { failOnLean: true });
        assert.deepEqual(res.likely, { total: leaning(), known: 0, new: leaning() });
        const sarif = JSON.parse(fs.readFileSync(path.join(outDir, 'exports', '01-checkout.sarif'), 'utf8'));
        const heading = sarif.runs[0].results.find((r) => r.ruleId === 'page-has-heading-one');
        assert.equal(heading.level, 'error');
        assert.match(heading.message.text, /How to check:/);

        const plain = writeExports([{ label: 'Checkout', url, result: coreResult }], ['sarif'], path.join(tmp, 'no-lean'));
        assert.equal(plain.likely, null);
        const plainSarif = JSON.parse(fs.readFileSync(path.join(tmp, 'no-lean', 'exports', '01-checkout.sarif'), 'utf8'));
        assert.equal(plainSarif.runs[0].results.find((r) => r.ruleId === 'page-has-heading-one').level, 'warning');
    });

    test('a likely failure the baseline recorded is known, not new', () => {
        const entries = buildBaselineEntries(coreResult, { leanFail: true });
        assert.deepEqual(likelyFailures(coreResult, entries), { total: leaning(), known: leaning(), new: 0 });
        // A baseline of failures only knows none of them.
        assert.deepEqual(likelyFailures(coreResult, buildBaselineEntries(coreResult)), { total: leaning(), known: 0, new: leaning() });
        // ...and the lean entries take nothing from the failures' match.
        const res = writeExports([{ label: 'Checkout', url, result: coreResult }], ['sarif'], path.join(tmp, 'lean-known'), {
            baselinePayload: { scans: [{ label: 'Checkout', url, coreBaseline: entries }] },
            failOnLean: true,
        });
        assert.equal(res.known, buildBaselineEntries(coreResult).length);
        assert.deepEqual(res.likely, { total: leaning(), known: leaning(), new: 0 });
    });
});

describe('writeExports for a merged scan', () => {
    test('one file per format, each failure once with its contexts, and a baseline that matches it', () => {
        const merged = mergeCoreResults([
            { context: 'Light', result: coreResult },
            { context: 'Dark', result: coreResult },
        ]);
        const outDir = path.join(tmp, 'merged');
        const { written } = writeExports([{ label: 'Checkout', result: merged }], ['sarif', 'junit', 'earl'], outDir);
        assert.equal(written.length, 3);

        const single = JSON.parse(fs.readFileSync(path.join(tmp, 'all', 'exports', '01-home.sarif'), 'utf8')).runs[0].results;
        const results = JSON.parse(fs.readFileSync(path.join(outDir, 'exports', '01-checkout.sarif'), 'utf8')).runs[0].results;
        assert.equal(results.length, single.length, 'the same failures, not twice as many');
        // Core puts a question's steps (How to check) after its message.
        assert.ok(results.every((r) => r.message.text.split('\n\nHow to check:')[0].endsWith('In all 2 contexts.')));
        assert.match(fs.readFileSync(path.join(outDir, 'exports', '01-checkout.junit.xml'), 'utf8'), /In all 2 contexts\./);

        assert.equal(buildBaselineEntries(merged).length, buildBaselineEntries(coreResult).length);
        const known = writeExports([{ label: 'Checkout', url: 'https://example.test/checkout', result: merged }], ['sarif'], path.join(tmp, 'merged-known'), {
            baselinePayload: { scans: [{ label: 'Checkout', url: 'https://example.test/checkout', coreBaseline: buildBaselineEntries(coreResult) }] },
        });
        assert.equal(known.known, buildBaselineEntries(coreResult).length);
    });
});

describe('baselineEntriesFor', () => {
    const a = { ruleId: 'a', reasonCode: 'DEFAULT', html: '<a>' };
    const b = { ruleId: 'b', reasonCode: 'DEFAULT', html: '<b>' };
    const c = { ruleId: 'c', reasonCode: 'DEFAULT', html: '<c>' };
    const baseline = {
        scans: [
            { label: 'Cart', url: 'https://prod.example/cart', coreBaseline: [a] },
            { label: 'Cart, dialog open', url: 'https://prod.example/cart', coreBaseline: [b] },
            { label: 'Home', url: 'https://prod.example/', coreBaseline: [c] }
        ]
    };

    test('prefers the scan with the same page and label, whatever the host', () => {
        assert.deepEqual(baselineEntriesFor({ label: 'Cart', url: 'https://staging.example/cart' }, baseline), [a]);
    });

    test('falls back to every scan of the page when the label changed', () => {
        assert.deepEqual(baselineEntriesFor({ label: 'Basket', url: 'https://staging.example/cart' }, baseline), [a, b]);
    });

    test('a page the baseline never scanned has no known failures', () => {
        assert.deepEqual(baselineEntriesFor({ label: 'Cart', url: 'https://prod.example/pay' }, baseline), []);
    });

    test('returns null when the baseline stored no entries at all', () => {
        assert.equal(baselineEntriesFor({ label: 'Cart', url: 'https://prod.example/cart' }, { scans: [{ label: 'Cart' }] }), null);
    });
});
