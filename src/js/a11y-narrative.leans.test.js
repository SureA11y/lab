'use strict';

// The narrative's reasons for review, when some of the scan's questions
// lean toward a failure (core 1.14's lean): it says how many, and that
// those come first.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let renderA11yNarrative;

before(async () => {
    ({ renderA11yNarrative } = await import('./a11y-narrative.js'));
});

const summary = (axe) => ({ scores: { adjusted: 70, evidence: 80, confidence: 60 }, inputs: { axe }, flags: {} });
const dom = { totalElements: 400 };

describe('narrative: questions that lean fail', () => {
    test('says how many questions likely fail, to confirm first', () => {
        const html = renderA11yNarrative({ a11ySummary: summary({ violations: 0, incomplete: 3, incompleteLikelyFail: 2, passes: 10 }), domMetrics: dom, seed: 1 });
        assert.match(html, /2 of their questions lean toward a failure|2 of their questions likely fail|2 of them likely failures/);
    });

    test('without leans, the general advice', () => {
        const html = renderA11yNarrative({ a11ySummary: summary({ violations: 0, incomplete: 3, passes: 10 }), domMetrics: dom, seed: 1 });
        assert.doesNotMatch(html, /likely fail/);
    });
});
