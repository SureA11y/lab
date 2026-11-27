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

describe('pictures', () => {
    const { withoutPictures } = require('./outgoing');
    const { endpointProvider } = require('./provider');
    const { entryFor } = require('./registry');

    test('are taken out at any depth, and an endpoint gets none unless turned on', () => {
        const evidence = { screenshot: 'data:x', focusWalk: { stops: [{ n: 1, screenshot: 'data:y', name: 'A' }] } };
        assert.deepEqual(withoutPictures(evidence), { focusWalk: { stops: [{ n: 1, name: 'A' }] } });
        const off = endpointProvider({ A11Y_AI_ENDPOINT: 'http://127.0.0.1:1/a' }).bodyFor({ evidence });
        assert.doesNotMatch(JSON.stringify(off), /data:/);
        const on = endpointProvider({ A11Y_AI_ENDPOINT: 'http://127.0.0.1:1/a', A11Y_AI_ENDPOINT_PICTURE: 'on' }).bodyFor({ evidence });
        assert.match(JSON.stringify(on), /data:y/);
    });

    test('the focus and keyboard questions are found by their rule; keyboard may not be passed by the AI', () => {
        assert.deepEqual([entryFor('manual-review', 'wcag-2.4.7-focus-visible').check, entryFor('manual-review', 'wcag-2.4.7-focus-visible').tier], ['focus-visible', 1]);
        assert.equal(entryFor('focus-order').check, 'focus-order');
        assert.equal(entryFor('manual-review', 'wcag-2.4.11-focus-not-obscured-minimum').check, 'focus-not-obscured');
        assert.deepEqual([entryFor('manual-review', 'wcag-2.1.1-keyboard').check, entryFor('manual-review', 'wcag-2.1.1-keyboard').passAllowed], ['keyboard', false]);
        assert.equal(entryFor('manual-review', 'wcag-2.4.13-focus-appearance').check, 'focus-appearance');
        assert.equal(entryFor('manual-review', 'wcag-2.4.12-focus-not-obscured-enhanced').check, 'focus-not-obscured-enhanced-page');
        assert.equal(entryFor('focus-not-obscured-enhanced', 'wcag-2.4.12-focus-not-obscured-enhanced').check, 'focus-not-obscured-enhanced-box', 'the scanner\'s per-box check');
        assert.equal(entryFor('css-focus-indicator-suppressed', 'wcag-2.4.13-focus-appearance').check, 'focus-appearance-element');
        assert.deepEqual([entryFor('css-focus-indicator-suppressed', 'wcag-1.4.11-non-text-contrast').check, entryFor('css-focus-indicator-suppressed', 'wcag-1.4.11-non-text-contrast').element], ['focus-contrast-element', true]);
        assert.equal(entryFor('css-focus-indicator-suppressed', 'wcag-9.9.9-other'), null, 'a rule it is not mapped for');
        assert.equal(entryFor('manual-review', 'wcag-9.9.9-unknown'), null);
        assert.equal(entryFor('manual-review'), null);
        assert.deepEqual([entryFor('img-alt-quality').check, entryFor('img-alt-quality').tier], ['img-alt-quality', 0]);
    });
});

describe('pictures to the model (a step\'s pictures, A11Y_AI_PICTURES)', () => {
    const { picturesAllowed } = require('./outgoing');
    const { anthropicProvider, contentFor } = require('./provider');
    const { withPictureOf } = require('./index');
    const { entryFor } = require('./registry');
    const JPEG = 'data:image/jpeg;base64,QUJD';

    test('the server allows none unless set: on for every site, or hosts', () => {
        assert.equal(picturesAllowed('https://shop.example/', {}), false);
        assert.equal(picturesAllowed('https://shop.example/', { A11Y_AI_PICTURES: 'off' }), false);
        assert.equal(picturesAllowed('https://shop.example/', { A11Y_AI_PICTURES: 'on' }), true);
        assert.equal(picturesAllowed('https://www.shop.example/', { A11Y_AI_PICTURES: 'shop.example' }), true);
        assert.equal(picturesAllowed('https://other.example/', { A11Y_AI_PICTURES: 'shop.example' }), false);
    });

    test('the built-in call sends the picture as an image block, after the cached evidence', () => {
        const body = anthropicProvider({ ANTHROPIC_API_KEY: 'k' }).bodyFor('<evidence>\n{}\n</evidence>\nQuestion: q', { picture: JPEG });
        const content = body.messages[0].content;
        assert.deepEqual(content.map((p) => p.type), ['text', 'image', 'text']);
        assert.ok(content[0].cache_control);
        assert.deepEqual(content[1].source, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });
        assert.equal(typeof anthropicProvider({ ANTHROPIC_API_KEY: 'k' }).bodyFor('x').messages[0].content, 'string', 'no picture: as before');
        assert.deepEqual(contentFor('plain', { cache: false, picture: JPEG }).map((p) => p.type), ['image', 'text']);
        assert.equal(contentFor('plain', { picture: 'data:text/html;base64,QUJD' }), 'plain', 'not an image: left out');
    });

    test('only the questions that use one, and never a picture of a typed value', () => {
        const ev = { screenshot: JPEG };
        assert.equal(withPictureOf(entryFor('img-alt-quality'), ev, true), JPEG);
        assert.equal(withPictureOf(entryFor('image-of-text'), ev, true), JPEG);
        assert.equal(withPictureOf(entryFor('img-alt-quality'), ev, false), null, 'not asked by the step');
        assert.equal(withPictureOf(entryFor('heading-quality'), ev, true), null, 'a question that does not use one');
        assert.equal(withPictureOf(entryFor('img-alt-quality'), { ...ev, pictureNotSent: 'typed' }, true), null);
    });

    test('the pass sends it when the step asks and the server allows, and says so', async () => {
        const got = [];
        const provider = { name: 'test', model: 'test', ask: async (prompt, o) => { got.push({ prompt, picture: o.picture }); return '{"verdict":"pass","confidence":0.9,"rationale":"ok"}'; } };
        const page = { url: () => 'https://shop.example/p', evaluate: async () => ({ x: 0, y: 0, width: 40, height: 20 }), screenshot: async () => 'QUJD' };
        const asked = canonical('<img id="a" alt="Red shoes">');
        const s = await answerCantTells({ page, canonical: asked, provider, options: { pictures: true }, env: { A11Y_AI_PICTURES: 'shop.example' } });
        assert.equal(s.pictures, 'allowed');
        assert.equal(got[0].picture, JPEG);
        assert.match(got[0].prompt, /image attached is a picture of the element/);
        assert.equal(asked.findings[0].occurrences[0].ai.pictureSent, true);
        got.length = 0;
        const s2 = await answerCantTells({ page, canonical: canonical('<img id="a" alt="Red shoes">'), provider, options: { pictures: true }, env: {} });
        assert.equal(s2.pictures, 'not-allowed');
        assert.equal(got[0].picture, null);
        assert.doesNotMatch(got[0].prompt, /image attached/);
    });

    test('an endpoint gets the picture of a question sent with one, never of a typed value', () => {
        const { endpointProvider } = require('./provider');
        const ep = endpointProvider({ A11Y_AI_ENDPOINT: 'http://127.0.0.1:1/a' });
        assert.match(JSON.stringify(ep.bodyFor({ picture: true, evidence: { screenshot: JPEG } })), /QUJD/);
        const on = endpointProvider({ A11Y_AI_ENDPOINT: 'http://127.0.0.1:1/a', A11Y_AI_ENDPOINT_PICTURE: 'on' });
        assert.doesNotMatch(JSON.stringify(on.bodyFor({ evidence: { screenshot: JPEG, pictureNotSent: 'typed' } })), /QUJD/);
    });
});

describe('using the page\'s forms (a step\'s forms, A11Y_AI_FORM_HOSTS)', () => {
    const { formHostAllowed } = require('./outgoing');
    const { candidatesOf } = require('./index');

    test('only on the hosts listed; unset, or "on", allows none', () => {
        assert.equal(formHostAllowed('https://test.shop.example/', {}), false);
        assert.equal(formHostAllowed('https://test.shop.example/', { A11Y_AI_FORM_HOSTS: 'on' }), false);
        assert.equal(formHostAllowed('https://test.shop.example/', { A11Y_AI_FORM_HOSTS: 'test.shop.example, staging.example' }), true);
        assert.equal(formHostAllowed('https://www.shop.example/', { A11Y_AI_FORM_HOSTS: 'test.shop.example' }), false);
    });

    test('a question that pastes is asked after the reading ones, only when forms may be used', () => {
        const occ = (check) => ({ atomicCheckId: check, occurrenceOutcome: 'cantTell', target: ['#x'] });
        const c = { findings: [{ outcome: 'cantTell', occurrences: [occ('password-paste-enabled'), occ('img-alt-quality')] }] };
        assert.deepEqual(candidatesOf(c).map((t) => t.entry.check), ['password-paste-enabled', 'img-alt-quality']);
        assert.deepEqual(candidatesOf(c, { forms: true }).map((t) => t.entry.check), ['img-alt-quality', 'password-paste-enabled']);
    });

    test('a step that asks on a host not listed says so, and tries nothing', async () => {
        const got = [];
        const provider = { name: 't', model: 't', answer: async (q) => { got.push(q); return { verdict: 'unsure', confidence: 0 }; } };
        const c = { findings: [{ outcome: 'cantTell', occurrences: [{ atomicCheckId: 'password-paste-enabled', occurrenceOutcome: 'cantTell', target: ['#pw'], html: '<input id="pw" type="password" onpaste="return false">' }] }] };
        const s = await answerCantTells({ page: pageAt('https://www.shop.example/login'), canonical: c, provider, options: { forms: true }, env: {} });
        assert.deepEqual(s.forms, { allowed: false, probed: 0 });
        assert.equal(got[0].evidence.paste, undefined);
    });
});
