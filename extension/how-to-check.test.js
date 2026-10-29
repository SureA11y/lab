'use strict';

// The extension adds each question's steps (howToCheck) to a result after the
// scan, as the binding does in Node: core's browser entry
// (engines/vendor/surea11y-how-to-check.min.js) with the review dictionaries
// the extension ships (engines/vendor/review/en.json, the extension scans in English). These run the
// real bundles: the engine in a jsdom page through runInTab, then
// addHowToCheck and canonicalize, as the panel does. node's test runner
// isolates each file in its own process.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');

let SUREA11Y;

const VENDOR = path.join(__dirname, 'engines', 'vendor');

before(() => {
    globalThis.A11Y_SCAN_NOTES = require('./scan-notes.js');
    globalThis.A11Y_CONFORMANCE_TARGETS = require('./conformance-targets.js');
    vm.runInThisContext(fs.readFileSync(path.join(VENDOR, 'surea11y-how-to-check.min.js'), 'utf8'));
    require('./engines/a11y-extension-surea11y-engine.js');
    SUREA11Y = globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE;
});

const BUNDLE = fs.readFileSync(path.join(VENDOR, 'surea11y.browser.min.js'), 'utf8');

function pageWith(html) {
    const dom = new JSDOM(html, {runScripts: 'outside-only', url: 'https://example.test/'});
    dom.window.eval(BUNDLE);
    const execInTab = async (_tabId, details) => {
        const run = dom.window.eval(`(${details.func.toString()})`);
        return [await run(...details.args)];
    };
    return {execInTab};
}

// The dictionaries as the panel fetches them, read from disk, counting what
// was asked for.
function fetchFromDisk(asked) {
    return async (file) => {
        asked.push(file);
        return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    };
}

const PAGE = '<!doctype html><html lang="en"><head><title>Prices</title></head>'
    + '<body><main><h1>Prices</h1><h3>Skipped level</h3></main></body></html>';

const headingOccurrences = (canonical) =>
    canonical.findings.filter((f) => f.ruleId === 'heading-order').flatMap((f) => f.occurrences || []);

describe('extension surea11y adapter: how to check', () => {
    test('a question keeps its lean and gets its steps, in English', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, {pageReadyTimeoutMs: 0, engineOptions: {locale: 'en'}, runOnly: {includeRuleIds: ['heading-order']}}, {execInTab});
        const asked = [];
        const withSteps = await SUREA11Y.addHowToCheck(native, {fetchJson: fetchFromDisk(asked)});
        assert.deepEqual(asked, ['engines/vendor/review/en.json']);

        const [occ] = headingOccurrences(SUREA11Y.canonicalize(withSteps, {engine: {id: '@surea11y', name: 'surea11y', version: null}}));
        assert.equal(occ.lean.toward, 'fail');
        assert.ok(occ.howToCheck.steps.length >= 2);
        const en = JSON.parse(fs.readFileSync(path.join(VENDOR, 'review', 'en.json'), 'utf8'));
        assert.ok(Object.values(en).includes(occ.howToCheck.steps[0]), 'the steps are core\'s English ones');
        assert.deepEqual(fs.readdirSync(path.join(VENDOR, 'review')), ['en.json'], 'only the English dictionary ships');
    });

    test('each dictionary is fetched once, and without the browser entry the result is left as it was', async () => {
        const {execInTab} = pageWith(PAGE);
        const native = await SUREA11Y.runInTab(1, {pageReadyTimeoutMs: 0, runOnly: {includeRuleIds: ['heading-order']}}, {execInTab});
        const asked = [];
        await SUREA11Y.addHowToCheck(native, {fetchJson: fetchFromDisk(asked)});
        assert.deepEqual(asked, [], 'English was fetched by the test before');

        const entry = globalThis.A11Y_HOW_TO_CHECK;
        delete globalThis.A11Y_HOW_TO_CHECK;
        try {
            assert.equal(await SUREA11Y.addHowToCheck(native), native);
        } finally {
            globalThis.A11Y_HOW_TO_CHECK = entry;
        }
    });
});
