'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { answerCantTells, candidatesOf, parseAnswer } = require('./index');

// A page that reads nothing and never changes.
const fakePage = { evaluate: async () => ({}) };

function canonicalOf(...checks) {
    return {
        findings: [{
            outcome: 'cantTell',
            occurrences: checks.map((check, i) => ({
                atomicCheckId: check, occurrenceOutcome: 'cantTell', outcome: 'cantTell',
                target: [`#e${i}`], html: `<p id="e${i}">${check} ${i}</p>`, failureSummary: 'check it',
            })),
        }],
    };
}

const answering = (answer) => ({ model: 'fake', ask: async () => JSON.stringify(answer) });

describe('parseAnswer', () => {
    test('reads the JSON in a reply, and refuses a verdict it does not know', () => {
        assert.deepEqual(parseAnswer('Sure: {"verdict":"pass","confidence":0.9,"rationale":"ok"}'),
            { verdict: 'pass', confidence: 0.9, rationale: 'ok' });
        assert.equal(parseAnswer('{"verdict":"maybe"}'), null);
        assert.equal(parseAnswer('no json'), null);
    });
});

describe('candidatesOf', () => {
    test('keeps only the checks the registry allows', () => {
        const c = canonicalOf('img-alt-quality', 'manual-review', 'page-title-patterns');
        assert.deepEqual(candidatesOf(c).map((x) => x.occurrence.atomicCheckId), ['img-alt-quality', 'page-title-patterns']);
    });
});

describe('answerCantTells', () => {
    test('attaches the answer beside the outcome and leaves the outcome alone', async () => {
        const c = canonicalOf('img-alt-quality');
        const s = await answerCantTells({ page: fakePage, canonical: c, provider: answering({ verdict: 'pass', confidence: 0.9, rationale: 'fits' }) });
        const o = c.findings[0].occurrences[0];
        assert.equal(o.outcome, 'cantTell');
        assert.equal(c.findings[0].outcome, 'cantTell');
        assert.equal(o.ai.verdict, 'pass');
        assert.equal(o.ai.provenance, 'ai-supported');
        assert.equal(o.ai.model, 'fake');
        assert.equal(o.ai.steps[0].tier, 0);
        assert.deepEqual([s.answered, s.unresolved, s.calls], [1, 0, 1]);
        assert.equal(c.ai, s);
    });

    test('an unsure or low-confidence answer stays unresolved', async () => {
        const c = canonicalOf('img-alt-quality', 'page-title-patterns');
        let n = 0;
        const provider = { ask: async () => JSON.stringify(n++ ? { verdict: 'unsure', confidence: 0.9, rationale: 'x' } : { verdict: 'fail', confidence: 0.3, rationale: 'x' }) };
        await answerCantTells({ page: fakePage, canonical: c, provider });
        assert.deepEqual(c.findings[0].occurrences.map((o) => [o.ai.provenance, o.ai.reason]), [['unresolved', 'unsure'], ['unresolved', 'unsure']]);
    });

    test('with no model every item stays as it was and says why', async () => {
        const c = canonicalOf('img-alt-quality');
        const saved = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try { await answerCantTells({ page: fakePage, canonical: c }); } finally { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; }
        const o = c.findings[0].occurrences[0];
        assert.deepEqual([o.ai.provenance, o.ai.reason], ['unresolved', 'no-model']);
    });

    test('the call budget is shared by the run and the rest stay unresolved', async () => {
        const shared = {};
        const provider = answering({ verdict: 'pass', confidence: 0.9, rationale: 'ok' });
        const a = canonicalOf('img-alt-quality', 'page-title-patterns');
        const b = canonicalOf('img-alt-decorative');
        await answerCantTells({ page: fakePage, canonical: a, options: { budget: { calls: 2 } }, shared, provider });
        await answerCantTells({ page: fakePage, canonical: b, options: { budget: { calls: 2 } }, shared, provider });
        assert.equal(shared.calls, 2);
        assert.equal(b.findings[0].occurrences[0].ai.reason, 'budget-calls');
    });

    test('the same question is asked once', async () => {
        let calls = 0;
        const provider = { ask: async () => { calls++; return JSON.stringify({ verdict: 'pass', confidence: 0.9, rationale: 'ok' }); } };
        const shared = {};
        const one = () => ({ findings: [{ outcome: 'cantTell', occurrences: [{ atomicCheckId: 'p-as-heading', occurrenceOutcome: 'cantTell', target: ['p'], html: '<p>Shop</p>' }] }] });
        const a = one();
        const b = one();
        await answerCantTells({ page: fakePage, canonical: a, shared, provider });
        const s = await answerCantTells({ page: fakePage, canonical: b, shared, provider });
        assert.equal(calls, 1);
        assert.equal(s.reused, 1);
        assert.equal(b.findings[0].occurrences[0].ai.reused, true);
    });

    test('a failing model never rejects and leaves the item unresolved', async () => {
        const c = canonicalOf('img-alt-quality');
        const s = await answerCantTells({ page: fakePage, canonical: c, provider: { ask: async () => { throw new Error('boom'); } } });
        assert.equal(c.findings[0].occurrences[0].ai.reason, 'model-error');
        assert.equal(s.answered, 0);
    });
});
