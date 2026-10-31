'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'procedures.js')).href);

const PROCEDURE = {
    id: '1.4.12',
    title: 'Text Spacing',
    facets: [
        { id: 'avoid-inline-spacing', label: 'Inline style does not force spacing', automation: 'full', rules: ['avoid-inline-spacing'], tools: [], procedure: null, variants: [] },
        {
            id: 'text-spacing-content-loss', label: 'No text is cut off', automation: 'partial', rules: ['text-spacing-content-loss'],
            tools: [{ id: 'devtools', label: "The browser's developer tools" }],
            procedure: { steps: ['Apply the spacing.', 'Look for <cut> text.'], passWhen: 'Nothing is lost.', failWhen: 'Text is cut off, which fails WCAG 1.4.12.' },
            variants: [],
        },
        { id: 'controls-keep-working', label: 'Controls keep working', automation: 'manual', rules: [], tools: [{ id: 'keyboard', label: 'A keyboard' }], procedure: { steps: ['Use each control.'], passWhen: 'They work.', failWhen: 'One does not.' }, variants: [] },
        { id: 'img-thing', label: 'A technology facet', automation: 'manual', coveredBy: 'controls-keep-working', procedure: null, tools: [], variants: [] },
    ],
};

beforeEach(async () => (await load()).clearProceduresCache());

test('a person is given what they check, once, and told what automated checks decide', async () => {
    const { splitFacets, buildHowToAssessHTML } = await load();
    const { forPerson, automatic } = splitFacets(PROCEDURE);
    assert.deepEqual(forPerson.map((f) => f.id), ['text-spacing-content-loss', 'controls-keep-working']);
    assert.deepEqual(automatic.map((f) => f.id), ['avoid-inline-spacing']);

    const html = buildHowToAssessHTML(PROCEDURE);
    assert.match(html, /<summary>How to check it by hand \(2 checks\)<\/summary>/);
    assert.match(html, /automated checks decide part of it/);
    assert.match(html, /You need:<\/span> The browser&#39;s developer tools/);
    assert.match(html, /<li>Look for &lt;cut&gt; text\.<\/li>/, 'escaped');
    assert.match(html, /Fails:<\/span> Text is cut off/);
    assert.match(html, /Automated checks decide:[\s\S]*Inline style does not force spacing/);
    assert.doesNotMatch(html, /A technology facet/);
});

test('nothing for a person, or no procedure, draws nothing', async () => {
    const { buildHowToAssessHTML } = await load();
    assert.equal(buildHowToAssessHTML(null), '');
    assert.equal(buildHowToAssessHTML({ facets: [PROCEDURE.facets[0]] }), '');
});

test('procedures are asked once per criterion and locale', async () => {
    const { loadProcedures } = await load();
    const asked = [];
    const fetchImpl = async (url) => {
        asked.push(url);
        const ids = new URL(url, 'http://x').searchParams.get('ids').split(',');
        return { ok: true, json: async () => ({ available: true, procedures: Object.fromEntries(ids.map((id) => [id, { id }])) }) };
    };
    assert.deepEqual(await loadProcedures(['1.1.1', '2.4.3'], 'en', { fetchImpl }), { '1.1.1': { id: '1.1.1' }, '2.4.3': { id: '2.4.3' } });
    await loadProcedures(['1.1.1', '1.4.13'], 'en', { fetchImpl });
    assert.equal(asked.length, 2);
    assert.match(asked[1], /ids=1\.4\.13&/, 'only the one not yet asked');
});

test('a server whose core has none, or that fails, gives null', async () => {
    const { loadProcedures } = await load();
    assert.equal(await loadProcedures(['1.1.1'], 'en', { fetchImpl: async () => ({ ok: true, json: async () => ({ available: false }) }) }), null);
    assert.equal(await loadProcedures(['1.1.1'], 'en', { fetchImpl: async () => { throw new Error('offline'); } }), null);
});

test('a report\'s procedures are in the locale its scans ran in', async () => {
    const { reportLocale } = await load();
    assert.equal(reportLocale({ scans: [{ canonical: { runOptions: { locale: { resolved: 'de' } } } }] }), 'de');
    assert.equal(reportLocale({}), 'en');
});

test('with a name, each check can be answered, and the answers so far are kept', async () => {
    const { buildHowToAssessHTML } = await load();
    const html = buildHowToAssessHTML(PROCEDURE, { name: 'acr-x', answers: { 'controls-keep-working': 'fail' } });
    assert.match(html, /1 of 2 answered/);
    assert.match(html, /<legend><span class="visually-hidden">Controls keep working: <\/span>Result<\/legend>/);
    assert.match(html, /name="acr-x-controls-keep-working" value="fail" data-facet="controls-keep-working" checked/);
    assert.match(html, /name="acr-x-text-spacing-content-loss" value="" data-facet="text-spacing-content-loss" checked/, 'not checked yet');
    assert.doesNotMatch(buildHowToAssessHTML(PROCEDURE), /type="radio"/, 'without a name, steps only');
});

test('answers suggest a level once every check is answered', async () => {
    const { suggestFromAnswers } = await load();
    const both = (a, b) => ({ 'text-spacing-content-loss': a, 'controls-keep-working': b });
    assert.equal(suggestFromAnswers(PROCEDURE, { 'controls-keep-working': 'pass' }), null, 'one left');
    assert.equal(suggestFromAnswers(PROCEDURE, both('pass', 'pass')).conformance, 'supports');
    assert.equal(suggestFromAnswers(PROCEDURE, both('pass', 'na')).conformance, 'supports');
    assert.equal(suggestFromAnswers(PROCEDURE, both('na', 'na')).conformance, 'notApplicable');
    assert.equal(suggestFromAnswers(PROCEDURE, both('pass', 'fail')).conformance, 'partiallySupports');
    assert.equal(suggestFromAnswers(PROCEDURE, both('fail', 'fail')).conformance, 'doesNotSupport');

    const scansFailed = { conformance: 'doesNotSupport', remarks: 'Automated checks found 2 failing elements, on Home.' };
    const s = suggestFromAnswers(PROCEDURE, both('pass', 'pass'), scansFailed);
    assert.equal(s.conformance, 'partiallySupports', 'a failure the scans found counts');
    assert.equal(s.remarks, 'Automated checks found 2 failing elements, on Home. Checked by hand, 2 checks: 2 pass.');
    assert.equal(suggestFromAnswers(PROCEDURE, both('na', 'na'), scansFailed).conformance, 'doesNotSupport');
    assert.equal(suggestFromAnswers(PROCEDURE, both('fail', 'na')).remarks, "Checked by hand, 2 checks: 1 fails, 1 doesn't apply.");
    const one = { facets: [PROCEDURE.facets[2]] };
    assert.equal(suggestFromAnswers(one, { 'controls-keep-working': 'pass' }).remarks, 'Checked by hand: it passes.');
});

test('whether the server has procedures is asked once', async () => {
    const { proceduresAvailable, proceduresKnownAvailable } = await load();
    let asked = 0;
    const fetchImpl = async () => { asked += 1; return { ok: true, json: async () => ({ available: true, procedures: { '1.1.1': { id: '1.1.1' } } }) }; };
    assert.equal(proceduresKnownAvailable(), false);
    assert.equal(await proceduresAvailable({ fetchImpl }), true);
    assert.equal(await proceduresAvailable({ fetchImpl }), true);
    assert.equal(asked, 1);
    assert.equal(proceduresKnownAvailable(), true);
});

test('an answer is kept with the check\'s words, and read either way', async () => {
    const { resultOf, suggestFromAnswers } = await load();
    assert.equal(resultOf({ a: { result: 'fail', label: 'A' } }, 'a'), 'fail');
    assert.equal(resultOf({ a: 'pass' }, 'a'), 'pass');
    assert.equal(resultOf({ a: { result: 'maybe' } }, 'a'), '');
    assert.equal(resultOf(null, 'a'), '');
    const answers = { 'text-spacing-content-loss': { result: 'pass', label: 'x' }, 'controls-keep-working': { result: 'fail', label: 'y' } };
    assert.equal(suggestFromAnswers(PROCEDURE, answers).conformance, 'partiallySupports');
});

const INDEX = {
    available: true,
    wcag: { '2.2': ['1.1.1', '1.4.3'], '2.1': ['1.1.1', '1.4.3', '4.1.1'], '2.0': ['1.1.1', '4.1.1'] },
    standards: [
        { key: 'en301549', name: 'EN 301 549', versions: { 'V3.2.1': ['9.1.1.1', '9.4.1.1'], 'V4.1.1': ['9.1.1.1'] } },
        { key: 'sample', name: 'Sample Standard', versions: { '1.0': ['3'] } },
    ],
};

test('a finding links into the guide only for requirements the guide has, in the latest version that has them', async () => {
    const { guideLinksFor } = await load();
    const links = guideLinksFor({
        SC: ['1.4.3', '4.1.1', '9.9.9'],
        EN: [{ clause: '9.1.1.1', versions: ['V3.2.1', 'V4.1.1'] }, { clause: '9.4.1.1', versions: ['V4.1.1'] }, { clause: '9.4.1.1' }],
        STANDARDS: [{ standard: 'Sample Standard', requirement: '3', versions: ['1.0'] }, { standard: 'Sample Standard', requirement: '7' }, { standard: 'Unknown', requirement: '1' }],
    }, INDEX);
    assert.deepEqual(links, [
        { label: 'WCAG 1.4.3', href: '/guide?standard=wcag&version=2.2&id=1.4.3' },
        { label: 'WCAG 4.1.1', href: '/guide?standard=wcag&version=2.1&id=4.1.1' },
        { label: 'EN 301 549 9.1.1.1', href: '/guide?standard=en301549&version=V4.1.1&id=9.1.1.1' },
        { label: 'EN 301 549 9.4.1.1', href: '/guide?standard=en301549&version=V3.2.1&id=9.4.1.1' },
        { label: 'Sample Standard 3', href: '/guide?standard=sample&version=1.0&id=3' },
    ], 'none for 9.9.9, for 9.4.1.1 in V4.1.1 only, for 7, or for a standard not installed');
    assert.deepEqual(guideLinksFor({ SC: ['1.1.1'] }, null), [], 'none until the index has loaded');
});

test('the links are a line of their own, which a download leaves out', async () => {
    const { guideRefHtml, withoutGuideRefs } = await load();
    const html = guideRefHtml({ SC: ['1.1.1'] }, INDEX);
    assert.equal(html, '<p class="guide-ref"><span class="guide-ref-label">The full method, in the testing guide:</span> '
        + '<a href="/guide?standard=wcag&amp;version=2.2&amp;id=1.1.1" target="_blank" rel="noopener">WCAG 1.1.1<span class="visually-hidden"> (opens in a new tab)</span></a></p>');
    assert.equal(guideRefHtml({ SC: ['9.9.9'] }, INDEX), '');
    assert.equal(withoutGuideRefs(`<div>${html}<p>Kept.</p>${html}</div>`), '<div><p>Kept.</p></div>');
});
