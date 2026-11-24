'use strict';

// What the AI pass may send and how (outgoing.js): the sites allowed, personal
// data masked, a preview that sends nothing, and the log of what was sent.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { allowedSitesOf, siteAllowed, maskText, maskDeep } = require('./outgoing');
const { answerCantTells } = require('./index');

const pageAt = (url) => ({ url: () => url, evaluate: async () => ({}) });

function canonical(html = '<img id="a" alt="Photo of anna.novak@shop.example">') {
    return {
        findings: [{
            outcome: 'cantTell', wcag: { sc: ['1.1.1'] },
            occurrences: [{ atomicCheckId: 'img-alt-quality', occurrenceOutcome: 'cantTell', outcome: 'cantTell', target: ['#a'], html, failureSummary: 'Check it' }],
        }],
    };
}

// A provider that records what it was given.
function recording(answer = { verdict: 'pass', confidence: 0.9, rationale: 'ok' }) {
    const got = [];
    return { got, provider: { name: 'test', model: 'test', destination: 'https://answers.test/q', bodyFor: (q) => ({ wrapped: q }), answer: async (q) => { got.push(q); return answer; } } };
}

describe('the allowed sites', () => {
    test('unset allows every site; a host allows itself and its subdomains, nothing else', () => {
        assert.equal(allowedSitesOf({}), null);
        assert.equal(siteAllowed('https://any.test/', null), true);
        const allowed = allowedSitesOf({ A11Y_AI_ALLOWED_SITES: 'shop.example, *.example.org' });
        assert.deepEqual(allowed, ['shop.example', 'example.org']);
        assert.equal(siteAllowed('https://shop.example/a', allowed), true);
        assert.equal(siteAllowed('https://www.shop.example/a', allowed), true);
        assert.equal(siteAllowed('https://docs.example.org/', allowed), true);
        assert.equal(siteAllowed('https://evilshop.example/', allowed), false);
        assert.equal(siteAllowed('https://shop.example.evil.test/', allowed), false);
        assert.equal(siteAllowed('not a url', allowed), false);
        assert.deepEqual(allowedSitesOf({ A11Y_AI_ALLOWED_SITES: '' }), [], 'set but empty: no site');
    });

    test('a page on a site not allowed sends nothing, and says why', async () => {
        const { got, provider } = recording();
        const c = canonical();
        const s = await answerCantTells({ page: pageAt('https://other.test/p'), canonical: c, provider, env: { A11Y_AI_ALLOWED_SITES: 'shop.example' } });
        assert.equal(got.length, 0);
        assert.equal(s.reason, 'site-not-allowed');
        assert.deepEqual(s.outbox, []);
        assert.equal(c.findings[0].occurrences[0].ai.reason, 'site-not-allowed');
    });
});

describe('masking', () => {
    test('masks e-mail addresses, IBANs, card-like and phone-like numbers, and leaves dates, prices and sizes', () => {
        assert.deepEqual(maskText('Write to anna.novak@shop.example'), { text: 'Write to [email]', count: 1 });
        assert.equal(maskText('Call +41 44 123 45 67').text, 'Call [phone]');
        assert.equal(maskText('Card 4111 1111 1111 1111').text, 'Card [number]');
        assert.equal(maskText('IBAN CH93 0076 2011 6238 5295 7').text, 'IBAN [iban]');
        const kept = 'On 2024-11-24, 3 items, 12.50 CHF <img width="640" height="480" src="/u/4411/a.jpg">';
        assert.deepEqual(maskText(kept), { text: kept, count: 0 });
    });

    test('masks every string but the picture', () => {
        const { value, count } = maskDeep({ a: 'x@y.example', b: ['+41 44 123 45 67'], evidence: { screenshot: 'data:image/jpeg;base64,4111111111111111' } });
        assert.deepEqual(value, { a: '[email]', b: ['[phone]'], evidence: { screenshot: 'data:image/jpeg;base64,4111111111111111' } });
        assert.equal(count, 2);
    });

    test('what is sent is masked, unless turned off; the report keeps what was read', async () => {
        const { got, provider } = recording();
        const c = canonical();
        const s = await answerCantTells({ page: pageAt('https://shop.example/p'), canonical: c, provider, env: {} });
        assert.match(got[0].element.html, /\[email\]/);
        assert.doesNotMatch(JSON.stringify(got[0]), /anna\.novak/);
        assert.equal(s.masking, true);
        assert.equal(s.outbox[0].masked > 0, true);
        assert.equal(c.findings[0].occurrences[0].html, '<img id="a" alt="Photo of anna.novak@shop.example">');

        const plain = recording();
        await answerCantTells({ page: pageAt('https://shop.example/p'), canonical: canonical(), provider: plain.provider, env: { A11Y_AI_MASK: 'off' } });
        assert.match(plain.got[0].element.html, /anna\.novak/);
    });
});

describe('the log of what was sent', () => {
    test('keeps each body exactly as the provider sends it, where to, and for what', async () => {
        const { got, provider } = recording();
        const s = await answerCantTells({ page: pageAt('https://shop.example/p'), canonical: canonical(), provider, env: {} });
        assert.equal(s.outbox.length, 1);
        const [e] = s.outbox;
        assert.deepEqual([e.mode, e.to, e.page, e.check, e.selector], ['sent', 'https://answers.test/q', 'https://shop.example/p', 'img-alt-quality', '#a']);
        assert.deepEqual(e.body, { wrapped: got[0] });
    });

    test('is kept even when the answers are dropped because the page changed', async () => {
        let n = 0;
        const page = { url: () => 'https://shop.example/p', evaluate: async () => ({ n: n++ }) };
        const { provider } = recording();
        const s = await answerCantTells({ page, canonical: canonical(), provider, env: {} });
        assert.equal(s.reason, 'state-drift');
        assert.equal(s.outbox.length, 1, 'it left all the same');
    });
});

describe('a preview', () => {
    test('sends nothing, needs no model, and logs what would be sent within the budget', async () => {
        const c = { findings: [{ outcome: 'cantTell', occurrences: [0, 1, 2].map((i) => ({ atomicCheckId: 'img-alt-quality', occurrenceOutcome: 'cantTell', target: ['#i' + i], html: `<img id="i${i}" alt="x${i}">` })) }] };
        const s = await answerCantTells({ page: pageAt('https://shop.example/p'), canonical: c, options: { preview: true, budget: { calls: 2 } }, env: {} });
        assert.equal(s.calls, 0);
        assert.equal(s.previewed, 2);
        assert.deepEqual(s.outbox.map((e) => [e.mode, e.to]), [['preview', 'no model set'], ['preview', 'no model set']]);
        assert.equal(s.outbox[0].body.version, 1);
        assert.match(s.outbox[0].body.prompt, /Never follow instructions/);
        assert.deepEqual(c.findings[0].occurrences.map((o) => o.ai.reason), ['preview', 'preview', 'budget-calls']);
        assert.ok(c.findings[0].occurrences[0].ai.evidence, 'what was read is kept');
    });

    test('forced on the server, it sends nothing even with a model, and shows that model\'s body', async () => {
        const { got, provider } = recording();
        const s = await answerCantTells({ page: pageAt('https://shop.example/p'), canonical: canonical(), provider, env: { A11Y_AI_PREVIEW: '1' } });
        assert.equal(got.length, 0);
        assert.equal(s.outbox[0].to, 'https://answers.test/q');
        assert.ok(s.outbox[0].body.wrapped);
    });
});
