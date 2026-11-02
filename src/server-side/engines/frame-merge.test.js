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
    assert.deepEqual(byId['button-name-present'].occurrences, [{ selector: 'button', frameUrl: 'https://x.test/a', frameSelectors: ['main > iframe:nth-of-type(1)'] }]);
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
