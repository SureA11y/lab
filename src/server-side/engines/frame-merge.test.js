'use strict';

// A page's iframes are scanned whole and their findings merged into the
// page's (surea11y-scan.js): each occurrence names its frame, and a rule
// fails on the page if it fails in any frame.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mergeFrameResults } = require('./surea11y-scan');

const check = (ruleId, outcome, occurrences = [], data) => ({ ruleId, outcome, occurrences, ...(data ? { data } : {}) });

test('a frame\'s findings join the page\'s, each naming its frame; the worse outcome wins', () => {
    const top = {
        checksResults: [check('button-name-present', 'notApplicable'), check('img-alt-present', 'fail', [{ selector: 'img' }])],
        rulesResults: [check('wcag-4.1.2-name', 'pass', [], { details: { contributors: [{ testId: 'button-name-present', outcome: 'notApplicable' }] } })],
    };
    const frames = [
        { url: 'https://x.test/a', frameSelectors: ['main > iframe:nth-of-type(1)'], result: {
            checksResults: [check('button-name-present', 'fail', [{ selector: 'button' }]), check('frame-only', 'cantTell', [{ selector: 'p' }])],
            rulesResults: [check('wcag-4.1.2-name', 'fail', [], { details: { contributors: [{ testId: 'button-name-present', outcome: 'fail' }] } })],
        } },
        { url: 'https://x.test/b', error: 'detached' },
    ];
    mergeFrameResults(top, frames);
    const byId = Object.fromEntries(top.checksResults.map((r) => [r.ruleId, r]));
    assert.equal(byId['button-name-present'].outcome, 'fail');
    assert.deepEqual(byId['button-name-present'].occurrences, [{ selector: 'button', occurrenceOutcome: 'fail', frameUrl: 'https://x.test/a', frameSelectors: ['main > iframe:nth-of-type(1)'] }]);
    assert.equal(byId['img-alt-present'].outcome, 'fail', 'the page\'s own fail stays');
    assert.equal(byId['frame-only'].outcome, 'cantTell', 'a rule only a frame ran is added');
    const rollup = top.rulesResults[0];
    assert.equal(rollup.outcome, 'fail');
    assert.deepEqual(rollup.data.details.contributors, [{ testId: 'button-name-present', outcome: 'fail' }]);
});

test('a capped list\'s counts add up across frames', () => {
    const counts = (n, listed) => ({ details: { elementCount: n, reportedCount: listed, maxOccurrences: 50, truncated: n > listed } });
    const top = { checksResults: [check('contrast-minimum', 'fail', [], counts(80, 50))], rulesResults: [] };
    mergeFrameResults(top, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: { checksResults: [check('contrast-minimum', 'fail', [], counts(3, 3))], rulesResults: [] } }]);
    assert.deepEqual(top.checksResults[0].data.details, { elementCount: 83, reportedCount: 53, maxOccurrences: 50, truncated: true });
});

test('each element keeps its own document\'s tier, and a note of a document that passed the rule is left out of a failing one', () => {
    const top = { checksResults: [check('contrast-minimum', 'fail', [{ selector: '#low' }, { selector: '#unsure', occurrenceOutcome: 'cantTell' }])], rulesResults: [] };
    mergeFrameResults(top, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: {
        checksResults: [check('contrast-minimum', 'pass', [{ selector: '', summary: 'All text meets the minimum contrast' }])], rulesResults: [],
    } }]);
    assert.deepEqual(top.checksResults[0].occurrences.map((o) => [o.selector, o.occurrenceOutcome]), [['#low', 'fail'], ['#unsure', 'cantTell']]);
    // And the other way: the page's note goes when a frame fails the rule.
    const top2 = { checksResults: [check('contrast-minimum', 'pass', [{ selector: '' }])], rulesResults: [] };
    mergeFrameResults(top2, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: { checksResults: [check('contrast-minimum', 'fail', [{ selector: 'p' }])], rulesResults: [] } }]);
    assert.deepEqual(top2.checksResults[0].occurrences.map((o) => o.occurrenceOutcome), ['fail']);
    // Two documents that passed keep their notes.
    const top3 = { checksResults: [check('contrast-minimum', 'pass', [{ selector: '' }])], rulesResults: [] };
    mergeFrameResults(top3, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: { checksResults: [check('contrast-minimum', 'pass', [{ selector: '' }])], rulesResults: [] } }]);
    assert.equal(top3.checksResults[0].occurrences.length, 2);
});

test('a frame\'s pass note is no failing element of the criterion the rule fails on the page', async () => {
    const { runOnPage } = require('./a11y-labs-engine');
    const top = {
        checksResults: [{ ruleId: 'contrast-minimum', outcome: 'fail', severity: 'serious', occurrences: [{ selector: 'p', html: '<p>Low</p>', summary: 'Element has insufficient color contrast' }] }],
        rulesResults: [{ ruleId: 'wcag-1.4.3-contrast-minimum', outcome: 'fail', severity: 'serious', occurrences: [],
            data: { details: { checksIds: ['contrast-minimum'], contributors: [{ testId: 'contrast-minimum', outcome: 'fail' }] } } }],
    };
    mergeFrameResults(top, [{ url: 'https://example.test/ok', frameSelectors: ['iframe'], result: {
        checksResults: [{ ruleId: 'contrast-minimum', outcome: 'pass', severity: 'serious', occurrences: [{ selector: '', html: '', summary: 'All computable text meets minimum contrast (AA).' }] }],
        rulesResults: [{ ruleId: 'wcag-1.4.3-contrast-minimum', outcome: 'pass', severity: 'serious', occurrences: [],
            data: { details: { checksIds: ['contrast-minimum'], contributors: [{ testId: 'contrast-minimum', outcome: 'pass' }] } } }],
    } }]);
    const page = {
        url: async () => 'https://example.test/',
        title: async () => 'Example',
        evaluate: async () => ({ url: 'https://example.test/', title: 'Example', timestamp: null, ...top }),
    };
    const { canonical } = await runOnPage(page, { engineOptions: { findingsSource: 'composite' } });
    const rollup = canonical.findings.find((f) => f.ruleId === 'wcag-1.4.3-contrast-minimum');
    assert.deepEqual(rollup.occurrences.map((o) => o.target[0]), ['p']);
});

test('a scan of several profiles: a frame\'s failure is each profile\'s that fails it', () => {
    const top = { checksResults: [{ ...check('img-alt-present', 'pass'), verdicts: { 'wcag22-aa': 'pass' }, checkOutcome: 'pass' }], rulesResults: [] };
    mergeFrameResults(top, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: {
        checksResults: [{ ...check('img-alt-present', 'fail', [{ selector: 'img', verdicts: { 'wcag22-aa': 'fail' } }]), verdicts: { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'cantTell' }, checkOutcome: 'fail' }],
        rulesResults: [],
    } }]);
    const [merged] = top.checksResults;
    assert.equal(merged.outcome, 'fail');
    assert.deepEqual(merged.verdicts, { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'cantTell' });
    assert.equal(merged.checkOutcome, 'fail');
});

test('a standard\'s per-finding outcomes (findingOutcomes) cover the frame\'s findings too, in order', () => {
    const roll = (outcome, findingOutcomes) => check('wai-aria-1.2-roles', outcome, [], { details: { contributors: [{ testId: 'aria-roles-valid', outcome, byReasonCode: true, findingOutcomes }] } });
    const top = { checksResults: [check('aria-roles-valid', 'cantTell', [{ selector: '#abstract' }])], rulesResults: [roll('fail', ['fail'])] };
    mergeFrameResults(top, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: {
        checksResults: [check('aria-roles-valid', 'cantTell', [{ selector: '#unknown-token' }])],
        rulesResults: [roll('pass', [null])],
    } }]);
    assert.deepEqual(top.rulesResults[0].data.details.contributors[0].findingOutcomes, ['fail', null]);
    // A side that gives none for occurrences it has leaves the merged rule with none.
    const top2 = { checksResults: [check('aria-roles-valid', 'cantTell', [{ selector: '#a' }])], rulesResults: [roll('fail', ['fail'])] };
    mergeFrameResults(top2, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: {
        checksResults: [check('aria-roles-valid', 'cantTell', [{ selector: '#b' }])],
        rulesResults: [roll('cantTell', undefined)],
    } }]);
    assert.equal(top2.rulesResults[0].data.details.contributors[0].findingOutcomes, undefined);
});

test('a frame\'s count is kept where the page\'s result has none', () => {
    const top = { checksResults: [check('contrast-minimum', 'fail', [])], rulesResults: [] };
    mergeFrameResults(top, [{ url: 'https://x.test/a', frameSelectors: ['iframe'], result: { checksResults: [check('contrast-minimum', 'fail', [], { details: { elementCount: 7, reportedCount: 5, truncated: true } })], rulesResults: [] } }]);
    assert.deepEqual(top.checksResults[0].data.details, { elementCount: 7, reportedCount: 5, truncated: true });
});

test('the iframes left out are said by reason, most first, without an about:blank address', () => {
    const { framesLeftOutMessage } = require('./a11y-labs-engine');
    const blank = (skipped) => ({ url: 'about:blank', skipped });
    assert.equal(
        framesLeftOutMessage([blank('empty'), blank('empty'), blank('hidden')], 4),
        "3 of the page's 4 iframes were left out: 2 show nothing; 1 is not shown on the page, or an open dialog covers it."
    );
    assert.equal(
        framesLeftOutMessage([{ url: 'https://ads.test/a', skipped: 'excluded' }, { url: 'https://ads.test/a', skipped: 'excluded' }], 2),
        "2 of the page's 2 iframes were left out: 2 are excluded by the scan (https://ads.test/a)."
    );
});
