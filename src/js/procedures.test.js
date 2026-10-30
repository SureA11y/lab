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
    assert.equal(s.remarks, 'Automated checks found 2 failing elements, on Home. Checked by hand (2 checks). Passes: No text is cut off; Controls keep working.');
    assert.equal(suggestFromAnswers(PROCEDURE, both('na', 'na'), scansFailed).conformance, 'doesNotSupport');
    assert.equal(suggestFromAnswers(PROCEDURE, both('fail', 'na')).remarks, 'Checked by hand (2 checks). Fails: No text is cut off. Does not apply: Controls keep working.');
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
