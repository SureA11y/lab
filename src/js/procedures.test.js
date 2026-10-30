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
