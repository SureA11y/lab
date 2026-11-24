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

describe('saving', () => {
    test('a report keeps the answers of a person when it is prepared for saving, and they validate against the schema', async () => {
        const { prepareDataForReport } = await import('./report-data.js');
        const { checkAgainstSchema } = require('../shared/json-schema-check');
        const { reportSchema } = require('../shared/report-schemas');
        const aiReview = { 'img-alt-quality|x1': { verdict: 'fail', note: 'n', at: '2026-11-24T10:00:00Z' } };
        const saved = prepareDataForReport({ scans: [], screenshots: [], scenarioName: 's', url: 'u', timestamp: 't', aiReview, notAReportKey: 1 });
        assert.deepEqual(saved.aiReview, aiReview);
        assert.equal(saved.notAReportKey, undefined);
        assert.deepEqual(checkAgainstSchema(reportSchema(), { ...saved, reportVersion: 4, runId: 'r' }), []);
        assert.notDeepEqual(checkAgainstSchema(reportSchema(), { ...saved, reportVersion: 4, runId: 'r', aiReview: { k: { verdict: 'maybe' } } }), []);
    });
});

describe('collectAiCases and keyFactRows', () => {
    test('one case per question across pages and scans, with the pages gathered', async () => {
        const { collectAiCases, aiReviewKey } = await load();
        const occ = (page) => ({ atomicCheckId: 'img-alt-quality', html: '<img alt="Shoes">', target: ['#i'], pageUrl: page, failureSummary: 'check', ai: { verdict: 'pass', provenance: 'ai-supported' } });
        const payload = { scans: [
            { canonical: { findings: [{ outcome: 'cantTell', title: 'Alt', wcag: { sc: ['1.1.1'] }, occurrences: [occ('https://a/'), { atomicCheckId: 'x', html: '<p>', target: ['p'] }] }] } },
            { canonical: { findings: [{ outcome: 'cantTell', title: 'Alt', occurrences: [occ('https://b/')] }, { outcome: 'fail', occurrences: [occ('https://c/')] }] } },
        ] };
        const cases = collectAiCases(payload);
        assert.equal(cases.length, 1);
        assert.deepEqual(cases[0].urls, ['https://a/', 'https://b/']);
        assert.equal(cases[0].key, aiReviewKey({ sourceAtomicRules: ['img-alt-quality'], html: '<img alt="Shoes">', target: ['#i'] }));
        assert.deepEqual(collectAiCases({}), []);
    });

    test('the alt text, name and control of an image are read off its facts, and an absent alt is said', async () => {
        const { keyFactRows } = await load();
        const rows = keyFactRows('img-alt-quality', { facts: { tag: 'img', alt: 'Canvas shoes', accessibleName: { role: 'image', name: 'Canvas shoes' }, control: { tag: 'a', href: '/p' }, shown: true, size: [200, 120] } }, helpers);
        const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.html]));
        assert.match(byLabel['Alt text'], /<q>Canvas shoes<\/q>/);
        assert.match(byLabel['Inside a control'], /a to <code>\/p<\/code>, no text of its own/);
        assert.match(byLabel['Shown on the page'], /yes, 200 x 120 px/);
        const none = keyFactRows('img-alt-quality', { facts: { tag: 'img', accessibleName: { role: 'image', name: '' }, shown: false } }, helpers);
        assert.match(none.find((r) => r.label === 'Alt text').html, /no alt attribute/);
        assert.match(none.find((r) => r.label === 'Accessible name').html, /nothing gives it a name/);
        assert.deepEqual(keyFactRows('img-alt-quality', null, helpers), []);
    });
});
