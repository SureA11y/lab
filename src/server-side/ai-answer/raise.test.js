'use strict';

// Phase 2 (raise.js): which criteria a step asks for, a place's status from
// the AI's answer, and the pass keeping every place asked, apart from the
// findings.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { raiseCriteriaOf, statusOf } = require('./raise');
const { answerCantTells } = require('./index');

test('a step asks for built criteria only; "reading" is the first group', () => {
    assert.deepEqual(raiseCriteriaOf(undefined), []);
    assert.deepEqual(raiseCriteriaOf(['3.1.2', '9.9.9', '3.1.2']), ['3.1.2']);
    assert.deepEqual(raiseCriteriaOf('reading'), ['3.1.2']);
    assert.deepEqual(raiseCriteriaOf('3.1.2, 1.3.3'), ['3.1.2']);
});

test('raised only for a sure fail whose quote is in the text', () => {
    const text = 'Our motto: la vie est belle, every day.';
    assert.equal(statusOf({ provenance: 'ai-supported', verdict: 'fail', quote: 'La vie  est belle' }, text), 'raised');
    assert.equal(statusOf({ provenance: 'ai-supported', verdict: 'fail', quote: 'carpe diem' }, text), 'quote-not-found');
    assert.equal(statusOf({ provenance: 'ai-supported', verdict: 'fail' }, text), 'quote-not-found');
    assert.equal(statusOf({ provenance: 'ai-supported', verdict: 'pass' }, text), 'not-raised');
    assert.equal(statusOf({ provenance: 'unresolved', verdict: 'fail', quote: 'la vie' }, text), 'unresolved');
});

test('the pass asks about each place the finder picks, keeps them apart from the findings, and never passes a criterion', async () => {
    const places = [
        { selector: '#a', html: '<p id="a">Nous livrons partout en France et en Belgique.</p>', text: 'Nous livrons partout en France et en Belgique.', facts: { lang: 'en', pageLang: 'en', guess: { by: 'words', language: 'fr' } } },
        { selector: '#b', html: '<p id="b">Café Rouge is our partner.</p>', text: 'Café Rouge is our partner.', facts: { lang: 'en', pageLang: 'en', guess: { by: 'words', language: 'fr' } } },
    ];
    // A page whose evaluate returns the places for the finder, and nothing else.
    const page = { url: () => 'https://shop.example/p', evaluate: async (fn) => (fn.name === 'languageOfPartsInPage' ? places : null) };
    const prompts = [];
    const provider = { name: 't', model: 't', ask: async (p) => { prompts.push(p); return /Nous livrons/.test(p) ? '{"verdict":"fail","confidence":0.9,"rationale":"French","quote":"Nous livrons partout en France"}' : '{"verdict":"pass","confidence":0.9,"rationale":"a name"}'; } };
    const canonical = { findings: [] };
    const s = await answerCantTells({ page, canonical, provider, options: { raise: ['3.1.2'] }, env: {} });
    assert.deepEqual(s.raised, { criteria: ['3.1.2'], places: 2, asked: 2, raised: 1, quoteNotFound: 0 });
    assert.deepEqual(canonical.aiRaised.map((r) => [r.selector, r.status, r.sc]), [['#a', 'raised', '3.1.2'], ['#b', 'not-raised', '3.1.2']]);
    assert.equal(canonical.aiRaised[0].ai.quote, 'Nous livrons partout en France');
    assert.deepEqual(canonical.findings, [], 'nothing joins the findings');
    assert.match(prompts[0], /"quote"/);
});
