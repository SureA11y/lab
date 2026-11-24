'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let V;
async function load() {
    if (!V) V = await import('./ai-answer-view.js');
    return V;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const helpers = { escapeHtml: esc, escapeAttr: esc };

const node = (extra = {}) => ({
    sourceAtomicRules: ['img-alt-quality'], html: '<img alt="Shoes">', target: ['#i'],
    ai: {
        verdict: 'pass', confidence: 0.9, rationale: 'The alt names the product.', provenance: 'ai-supported', model: 'm',
        evidence: { facts: { alt: 'Shoes', accessibleName: { role: 'image', name: 'Shoes' } }, context: '<li><a><img></a></li>' },
    },
    ...extra,
});

describe('aiReviewKey', () => {
    test('is the question, not the page: the same element and check give the same key', async () => {
        const { aiReviewKey } = await load();
        assert.equal(aiReviewKey(node({ urls: ['a'] })), aiReviewKey(node({ urls: ['b'] })));
        assert.notEqual(aiReviewKey(node()), aiReviewKey(node({ html: '<img alt="Bag">' })));
        assert.notEqual(aiReviewKey(node()), aiReviewKey(node({ sourceAtomicRules: ['img-alt-decorative'] })));
    });
});

describe('agreementOf', () => {
    test('compares a person with a confident AI answer only', async () => {
        const { agreementOf } = await load();
        const ai = { verdict: 'pass', provenance: 'ai-supported' };
        assert.equal(agreementOf({ verdict: 'pass' }, ai), 'same');
        assert.equal(agreementOf({ verdict: 'fail' }, ai), 'different');
        assert.equal(agreementOf({ verdict: 'unsure' }, ai), 'unsure');
        assert.equal(agreementOf({}, ai), null);
        assert.equal(agreementOf({ verdict: 'pass' }, { verdict: 'pass', provenance: 'unresolved' }), null);
    });
});

describe('aiBlockHtml', () => {
    test('shows the verdict, the reasoning and what the AI was given, and takes an answer', async () => {
        const { aiBlockHtml } = await load();
        const html = aiBlockHtml(node(), { verdict: 'fail', note: 'x "y"' }, helpers);
        assert.match(html, /The AI says pass\./);
        assert.match(html, /Confidence 90%/);
        assert.match(html, /The alt names the product\./);
        assert.match(html, /What the AI was given/);
        assert.match(html, /<dt>Alt<\/dt><dd>Shoes<\/dd>/);
        assert.match(html, /data-ai-verdict="pass"/);
        assert.match(html, /value="fail" data-ai-key="[^"]+" checked/);
        assert.match(html, /value="x &quot;y&quot;"/);
        assert.match(html, /Your answer is different from the AI/);
    });

    test('an unresolved question says why, and offers no AI verdict', async () => {
        const { aiBlockHtml } = await load();
        const html = aiBlockHtml(node({ ai: { provenance: 'unresolved', reason: 'budget-calls' } }), null, helpers);
        assert.match(html, /could not settle this/);
        assert.match(html, /budget/);
        assert.doesNotMatch(html, /data-ai-verdict/);
    });

    test('nothing without an AI answer, and page text is escaped', async () => {
        const { aiBlockHtml } = await load();
        assert.equal(aiBlockHtml(node({ ai: null }), null, helpers), '');
        const html = aiBlockHtml(node({ ai: { ...node().ai, rationale: '<script>x</script>' } }), null, helpers);
        assert.doesNotMatch(html, /<script>/);
    });
});

describe('badges', () => {
    test('a badge per answer and a count per row', async () => {
        const { aiBadgeHtml, aiRowSummaryHtml } = await load();
        assert.match(aiBadgeHtml(node().ai, helpers), /ai-badge-pass">AI: pass/);
        assert.match(aiBadgeHtml({ provenance: 'unresolved' }, helpers), /AI: unresolved/);
        assert.equal(aiBadgeHtml(null, helpers), '');
        assert.match(aiRowSummaryHtml([node(), node({ ai: { provenance: 'unresolved' } }), { ai: null }], helpers), /AI answered 1 of 3/);
        assert.equal(aiRowSummaryHtml([{ ai: null }], helpers), '');
    });
});

describe('applyAiReview', () => {
    test('keeps a verdict and a note by question, and drops an answer that is neither', async () => {
        const { applyAiReview } = await load();
        const payload = {};
        applyAiReview(payload, 'k', { verdict: 'fail' }, 'T1');
        applyAiReview(payload, 'k', { note: 'why' }, 'T2');
        assert.deepEqual(payload.aiReview, { k: { verdict: 'fail', note: 'why', at: 'T2' } });
        applyAiReview(payload, 'k', { verdict: '', note: '  ' }, 'T3');
        assert.equal(payload.aiReview, undefined);
        applyAiReview(null, 'k', { verdict: 'pass' });
        applyAiReview(payload, '', { verdict: 'pass' });
        assert.equal(payload.aiReview, undefined);
    });
});
