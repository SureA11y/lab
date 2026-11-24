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

describe('the proof picture', () => {
    test('shows a data-URL picture of the element and refuses anything else', async () => {
        const { proofHtml, aiAnalysisHtml } = await load();
        const good = { screenshot: 'data:image/jpeg;base64,/9j/4AAQ' };
        assert.match(proofHtml(good, helpers), /<img class="air-shot"[^>]+src="data:image\/jpeg;base64,\/9j\/4AAQ"/);
        assert.equal(proofHtml({ screenshot: 'https://evil/x.png' }, helpers), '');
        assert.equal(proofHtml({ screenshot: 'data:image/jpeg;base64,"><script>' }, helpers), '');
        assert.equal(proofHtml(null, helpers), '');
        const ai = { ...node().ai, evidence: { ...node().ai.evidence, ...good } };
        assert.match(aiAnalysisHtml(ai, helpers), /What the AI was given<\/summary><img class="air-shot"/);
    });
});

describe('why you differ, and the resolved result', () => {
    const ai = { verdict: 'pass', confidence: 0.9, rationale: 'Names the product.', provenance: 'ai-supported' };

    test('a reason is asked for when you differ or are unsure, and only then', async () => {
        const { whyHint } = await load();
        assert.match(whyHint('different', ''), /why you differ/);
        assert.match(whyHint('unsure', '  '), /hard to tell/);
        assert.equal(whyHint('different', 'only a file name'), '');
        assert.equal(whyHint('same', ''), '');
        assert.equal(whyHint(null, ''), '');
    });

    test('a reviewer pass or fail resolves the question; the AI alone resolves it only provisionally; unsure resolves nothing', async () => {
        const { resolvedOf } = await load();
        assert.deepEqual(resolvedOf({ verdict: 'fail', note: 'file name' }, ai), { source: 'reviewer', verdict: 'fail', reason: 'file name', differs: true });
        assert.equal(resolvedOf({ verdict: 'pass' }, ai).differs, false);
        assert.deepEqual(resolvedOf(null, ai), { source: 'ai', verdict: 'pass', reason: 'Names the product.', differs: false });
        assert.equal(resolvedOf({ verdict: 'unsure' }, ai), null);
        assert.equal(resolvedOf(null, { ...ai, provenance: 'unresolved' }), null);
        assert.equal(resolvedOf(null, null), null);
    });

    test('the resolved line says who confirmed it, escapes the reason, and asks for one on a fail', async () => {
        const { resolvedHtml } = await load();
        const html = resolvedHtml({ verdict: 'fail', note: '<b>x</b>' }, ai, helpers);
        assert.match(html, /Resolved: Fail<\/strong>, confirmed by a reviewer\. Reason: &lt;b&gt;x&lt;\/b&gt;/);
        assert.doesNotMatch(html, /<b>x/);
        assert.match(resolvedHtml({ verdict: 'fail' }, ai, helpers), /No reason given yet/);
        assert.match(resolvedHtml(null, ai, helpers), /not yet confirmed by a person/);
        assert.equal(resolvedHtml(null, null, helpers), '');
    });

    test('the answer block shows the prompt for a reason and the resolved line', async () => {
        const { answerFieldsetHtml } = await load();
        const html = answerFieldsetHtml('k', ai, { verdict: 'fail' }, helpers);
        assert.match(html, /ai-review--needs-why/);
        assert.match(html, /ai-why-hint[^>]*>Please say why you differ/);
        assert.match(html, /aria-invalid="true"/);
        const done = answerFieldsetHtml('k', ai, { verdict: 'fail', note: 'file name' }, helpers);
        assert.doesNotMatch(done, /ai-review--needs-why/);
        assert.match(done, /Resolved: Fail/);
    });

    test('the summary counts what a reviewer resolved, what only the AI answered, what is open and differences without a reason', async () => {
        const { resolveSummary, aiReviewKey } = await load();
        const occ = (html, aiv) => ({ atomicCheckId: 'img-alt-quality', html, target: ['#' + html], ai: aiv ? { ...ai, verdict: aiv } : { provenance: 'unresolved', reason: 'unsure' } });
        const payload = { scans: [{ url: 'u', canonical: { findings: [{ outcome: 'cantTell', occurrences: [occ('a', 'pass'), occ('b', 'pass'), occ('c', 'pass'), occ('d')] }] } }] };
        const key = (h) => aiReviewKey({ sourceAtomicRules: ['img-alt-quality'], html: h, target: ['#' + h] });
        payload.aiReview = { [key('a')]: { verdict: 'fail' }, [key('b')]: { verdict: 'pass' } };
        assert.deepEqual(resolveSummary(payload), { total: 4, reviewerPass: 1, reviewerFail: 1, aiOnly: 1, open: 1, withoutReason: 1 });
    });
});

describe('buildLessons', () => {
    test('makes an example of each question settled with a reason, with the facts and what the AI said', async () => {
        const { buildLessons, aiReviewKey } = await load();
        const o = (html, extra = {}) => ({ atomicCheckId: 'img-alt-quality', html, target: ['#' + html], ai: { verdict: 'pass', provenance: 'ai-supported', evidence: { facts: { alt: html }, screenshot: 'data:image/jpeg;base64,AAAA' }, ...extra } });
        const payload = { scans: [{ url: 'u', canonical: { findings: [{ outcome: 'cantTell', occurrences: [o('a'), o('b'), o('c'), o('d', { evidence: {} })] }] } }] };
        const k = (h) => aiReviewKey({ sourceAtomicRules: ['img-alt-quality'], html: h, target: ['#' + h] });
        payload.aiReview = {
            [k('a')]: { verdict: 'fail', note: 'only a file name' },
            [k('b')]: { verdict: 'pass' },
            [k('c')]: { verdict: 'unsure', note: 'hard' },
            [k('d')]: { verdict: 'fail', note: 'no facts' },
        };
        const l = buildLessons(payload);
        assert.deepEqual(l, { version: 1, checks: { 'img-alt-quality': { rules: [], examples: [{ facts: { alt: 'a' }, verdict: 'fail', reason: 'only a file name', aiVerdict: 'pass' }] } } });
        assert.deepEqual(buildLessons({}), { version: 1, checks: {} });
    });
});

describe('the conformance link', () => {
    const build = async () => {
        const { aiReviewKey } = await load();
        const o = (html, sc) => ({ atomicCheckId: 'img-alt-quality', html, target: ['#' + html], pageUrls: ['https://x.test/' + html], ai: { verdict: 'pass', provenance: 'ai-supported', evidence: { facts: { alt: html } } } });
        const finding = (sc, ...occ) => ({ outcome: 'cantTell', wcag: { sc: [sc] }, occurrences: occ });
        const payload = { scans: [{ url: 'u', canonical: { findings: [finding('1.1.1', o('a'), o('b'), o('c')), finding('2.4.4', o('d'))] } }] };
        const k = (h) => aiReviewKey({ sourceAtomicRules: ['img-alt-quality'], html: h, target: ['#' + h] });
        payload.aiReview = { [k('a')]: { verdict: 'fail', note: 'only a file name' }, [k('b')]: { verdict: 'pass' }, [k('c')]: { verdict: 'fail' } };
        return payload;
    };

    test('only what a person settled counts, per criterion', async () => {
        const { confirmedByCriterion } = await load();
        const c = confirmedByCriterion(await build());
        assert.equal(c['1.1.1'].passes, 1);
        assert.equal(c['1.1.1'].fails.length, 2);
        assert.deepEqual(c['1.1.1'].fails[0], { check: 'img-alt-quality', reason: 'only a file name', url: 'https://x.test/a', selector: '#a', aiVerdict: 'pass' });
        assert.equal(c['2.4.4'], undefined, 'an AI answer nobody confirmed is not recorded');
    });

    test('the remarks name the page, the reason and the check, and say nothing about the level', async () => {
        const { confirmedByCriterion, remarksFromConfirmed } = await load();
        const text = remarksFromConfirmed(confirmedByCriterion(await build())['1.1.1']);
        assert.match(text, /confirmed by a reviewer: 2 questions failed/);
        assert.match(text, /1\) https:\/\/x\.test\/a: only a file name \(img-alt-quality\)\./);
        assert.match(text, /2\) https:\/\/x\.test\/c: failed on review, no reason given/);
        assert.doesNotMatch(text, /Supports/i);
        assert.equal(remarksFromConfirmed({ fails: [], passes: 3 }), '');
        assert.equal(remarksFromConfirmed(undefined), '');
    });

    test('the block escapes the text, offers the button only with fails, and leaves the level to the reviewer', async () => {
        const { confirmedBlockHtml } = await load();
        const html = confirmedBlockHtml({ fails: [{ check: 'c', reason: '<i>x</i>', url: '', selector: '', aiVerdict: '' }], passes: 0 }, helpers);
        assert.match(html, /data-acr-ai-add/);
        assert.match(html, /&lt;i&gt;x&lt;\/i&gt;/);
        assert.match(html, /stays yours to choose/);
        assert.doesNotMatch(confirmedBlockHtml({ fails: [], passes: 2 }, helpers), /data-acr-ai-add/);
        assert.equal(confirmedBlockHtml({ fails: [], passes: 0 }, helpers), '');
    });
});
