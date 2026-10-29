'use strict';

// A question (cantTell) keeps what core 1.14 says about it: which way its
// evidence leans (`lean`) and the steps that answer it (`howToCheck`), which
// the binding adds after the scan. Runs core itself on a jsdom page; node's
// test runner gives this file a process of its own, so the globals it sets do
// not leak.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { validateCanonical } = require('../canonical/validate-canonical');

let runOnPage;

before(() => {
    const dom = new JSDOM(
        '<!doctype html><html lang="en"><head><title>Prices</title></head>'
        + '<body><main><h1>Prices</h1><h3>Skipped level</h3><img src="a.png"></main></body></html>',
        { pretendToBeVisual: true, url: 'https://example.test/prices' }
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    ({ runOnPage } = require('./a11y-labs-engine'));
});

// A page whose evaluate runs what it is sent in this jsdom page, as the
// browser would.
function corePage() {
    return {
        url: () => 'https://example.test/prices',
        title: async () => 'Prices',
        evaluate: async (fn, ...args) => {
            // eslint-disable-next-line no-eval
            if (typeof fn === 'string') return (0, eval)(fn);
            return fn(...args);
        },
    };
}

const occurrencesOf = (canonical, ruleId) =>
    canonical.findings.filter((f) => f.ruleId === ruleId).flatMap((f) => f.occurrences || []);

describe('questions keep their lean and their steps', () => {
    test('a skipped heading level leans fail, says why, and says how to check it', async () => {
        const { canonical } = await runOnPage(corePage(), { runOnly: { includeRuleIds: ['heading-order', 'img-alt-present'] } });

        const [heading] = occurrencesOf(canonical, 'heading-order');
        assert.equal(heading.occurrenceOutcome, 'cantTell');
        assert.equal(heading.lean.toward, 'fail');
        assert.ok(heading.lean.why, 'the lean says why');
        assert.ok(heading.howToCheck.steps.length >= 2, 'the steps that answer it');
        assert.ok(heading.howToCheck.passWhen && heading.howToCheck.failWhen);

        // A failure is no question: it has neither.
        const [img] = occurrencesOf(canonical, 'img-alt-present');
        assert.equal(img.occurrenceOutcome, 'fail');
        assert.equal(img.lean, undefined);
        assert.equal(img.howToCheck, undefined);

        assert.deepEqual(validateCanonical(canonical).errors || [], []);
    });
});

describe('a scan without a hook says what it judged without it', () => {
    // A core result, as a page without the internals and listener hooks gives it.
    const { HOOK_REASON_CODES } = require('@surea11y/core');
    const listener = HOOK_REASON_CODES.listener.find((e) => e.effect === 'decides');
    const result = {
        engine: { environment: { listenerHook: 'late' } },
        rulesResults: [],
        checksResults: [
            { ruleId: 'button-name-present', outcome: 'cantTell', occurrences: [{ selector: 'x-save', outcome: 'cantTell', data: { details: { reasonCode: 'name_internals' } } }] },
            { ruleId: listener.ruleId, outcome: 'cantTell', occurrences: [{ selector: '#save', outcome: 'cantTell', data: { details: { reasonCode: listener.reasonCode } } }] },
        ],
    };
    const page = {
        url: () => 'https://example.test/',
        title: async () => 'Example',
        evaluate: async (fn) => (typeof fn === 'string' ? undefined : fn && fn.name === 'findUnreadableStyleSheets' ? [] : JSON.parse(JSON.stringify(result))),
    };

    test('says in plain words what the scan could not see, how many results, and what to do', async () => {
        const { canonical } = await runOnPage(page, {});
        const byCode = Object.fromEntries(canonical.notices.map((n) => [n.code, n.message]));
        assert.match(byCode['internals-hook'], /^surea11y could not see the name, role and state that custom elements .*, so it was less sure about the results for 1 custom element\. This was turned off for this run \(A11Y_CORE_HOOKS\)/);
        // The rule by its title, and what to do when the page's scripts got there first.
        const title = require('@surea11y/core').getCheckDefById(listener.ruleId).title;
        assert.ok(byCode['listener-hook'].startsWith(`surea11y could not see which elements respond to clicks, keys or the mouse, so it was less sure about 1 result from the check (“${title}”).`));
        assert.match(byCode['listener-hook'], /The page's own scripts took over .*No scan setting changes this: check these results by hand\.$/);
        assert.equal(byCode['live-region-hook'], undefined, 'nothing the live-region hook decides');
    });
});

describe('a scan in forced colors says so', () => {
    test('the binding\'s forced-colors note, as a notice', async () => {
        const result = { engine: { environment: { forcedColors: 'active' } }, rulesResults: [], checksResults: [] };
        const page = {
            url: () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async (fn) => (typeof fn === 'string' ? undefined : fn && fn.name === 'findUnreadableStyleSheets' ? [] : JSON.parse(JSON.stringify(result))),
        };
        const { canonical } = await runOnPage(page, {});
        const note = canonical.notices.find((n) => n.code === 'forced-colors');
        assert.match(note.message, /forced colors \(high contrast\); contrast findings may differ with forced colors off/);
    });
});
