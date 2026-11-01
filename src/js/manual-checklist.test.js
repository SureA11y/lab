'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'manual-checklist.js')).href);

const facet = (id, automation, extra = {}) => ({
    id, label: `Label of ${id}`, automation, rules: [], variants: [],
    tools: automation === 'full' ? [] : [{ id: 'keyboard', label: 'A keyboard' }],
    procedure: automation === 'full' ? null : { steps: [`Step for ${id}.`], passWhen: `${id} passes.`, failWhen: `${id} fails.` },
    ...extra,
});

const ACR = {
    product: { name: 'Shop <2>', date: '2026-10-30' },
    target: { wcagVersion: '2.2', level: 'AA' },
    tables: [
        { id: 'wcag-a', title: 'Table 1: Success Criteria, Level A', rows: [
            { id: '2.1.1', name: 'Keyboard', level: 'A', draft: { conformance: 'notEvaluated', remarks: 'Only a person can check this.' } },
            { id: '9.9.9', name: 'Unknown', level: 'A', draft: { conformance: 'notEvaluated', remarks: '' } },
        ] },
        { id: 'wcag-aa', title: 'Table 2: Success Criteria, Level AA', rows: [
            { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', draft: { conformance: 'doesNotSupport', remarks: 'Automated checks found 3 failing elements, on Home.' } },
        ] },
        { id: 'en-4', title: 'Chapter 4', rows: [{ id: '4.2.1', name: 'Usage without vision', draft: {} }] },
    ],
};

const PROCEDURES = {
    '2.1.1': { id: '2.1.1', facets: [facet('all-by-keyboard', 'manual'), facet('tech', 'manual', { coveredBy: 'all-by-keyboard', procedure: null })] },
    '1.4.3': { id: '1.4.3', facets: [facet('contrast-measured', 'full'), facet('contrast-images', 'partial')] },
    '9.9.9': null,
};

test('lists each WCAG criterion with what the scans found and the checks left for a person', async () => {
    const { buildManualChecklistHTML } = await load();
    const html = buildManualChecklistHTML({
        acr: ACR, procedures: PROCEDURES,
        review: { criteria: { '2.1.1': { conformance: 'partiallySupports', remarks: 'The menu traps focus.', facets: { 'all-by-keyboard': 'fail' } } } },
        levelLabels: { partiallySupports: 'Partially Supports' },
    });
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.doesNotMatch(html, / lang="(?!en")/, 'procedures in English, as the page, are not marked');
    assert.match(html, /<title>Shop &lt;2&gt;: manual review checklist<\/title>/);
    assert.match(html, /WCAG 2\.2 Level AA: 3 criteria; 2 checks for a person\. Report of 2026-10-30\./);
    assert.match(html, /<h2 id="t-wcag-a">Table 1: Success Criteria, Level A<\/h2>/);
    assert.doesNotMatch(html, /Chapter 4/, 'WCAG only, without EN 301 549\'s procedures');
    assert.match(html, /<h3 id="h-2-1-1">2\.1\.1 Keyboard \(Level A\)<\/h3>/);
    assert.match(html, /Recorded so far:<\/span> Partially Supports\. The menu traps focus\./);
    assert.match(html, /value="fail" checked\/>Fails/, 'a recorded answer is ticked');
    assert.doesNotMatch(html, /Label of tech/, 'a facet another covers is not asked twice');
    assert.match(html, /What the scans found:<\/span> Automated checks found 3 failing elements, on Home\./);
    assert.match(html, /\(automated checks decide part of it\)/);
    assert.match(html, /Automated checks decide:<\/span> Label of contrast-measured\./);
    assert.match(html, /No procedure for this criterion yet/);
});

test('the page is in English and each procedure says the language it was read in', async () => {
    const { buildManualChecklistHTML } = await load();
    const html = buildManualChecklistHTML({
        acr: ACR,
        procedures: {
            ...PROCEDURES,
            '2.1.1': { ...PROCEDURES['2.1.1'], locale: 'es' },
        },
        lang: 'fr',
    });
    assert.match(html, /^<!doctype html>\n<html lang="en">/, 'the page\'s own words are English');
    assert.match(html, /<h1>Shop &lt;2&gt;: manual review checklist<\/h1>/);
    // 2.1.1 says it was read in Spanish: its texts are marked so.
    assert.match(html, /<strong lang="es">Label of all-by-keyboard<\/strong>/);
    assert.match(html, /<span class="term">You need:<\/span> <span lang="es">A keyboard<\/span>/);
    assert.match(html, /<ol class="steps" lang="es"><li>Step for all-by-keyboard\.<\/li><\/ol>/);
    assert.match(html, /<span class="term">Passes:<\/span> <span lang="es">all-by-keyboard passes\.<\/span>/);
    assert.match(html, /<span class="term">Fails:<\/span> <span lang="es">all-by-keyboard fails\.<\/span>/);
    assert.match(html, /<legend><span class="visually-hidden"><span lang="es">Label of all-by-keyboard<\/span>: <\/span>Result<\/legend>/);
    // 1.4.3 doesn't say: it takes the language the procedures were read in.
    assert.match(html, /<strong lang="fr">Label of contrast-images<\/strong>/);
    assert.match(html, /Automated checks decide:<\/span> <span lang="fr">Label of contrast-measured<\/span>\./);
    // The page's own words around them stay unmarked.
    assert.match(html, /<span class="term">What the scans found:<\/span> Automated checks found/);
    assert.match(html, /value="pass"\/>Passes<\/label>/);
});

test('a pack\'s facet keeps the language its pack gives it', async () => {
    const { buildManualChecklistHTML } = await load();
    const own = facet('own', 'manual', { lang: 'de', procedureLang: 'ja' });
    const html = buildManualChecklistHTML({
        acr: ACR, procedures: { '2.1.1': { id: '2.1.1', locale: 'fr', facets: [own] } },
    });
    assert.match(html, /<strong lang="de">Label of own<\/strong>/, 'its label, in the pack\'s language');
    assert.match(html, /<ol class="steps" lang="ja">/, 'its procedure, in the language the pack gives it');
    assert.match(html, /<span class="term">You need:<\/span> <span lang="fr">A keyboard<\/span>/, 'core\'s tools, in the locale read');
    // A tool core says is in English, read in French, is not marked French.
    const english = facet('own', 'manual', { tools: [{ id: 'zoom', label: 'Zoom', lang: 'en' }] });
    const mixed = buildManualChecklistHTML({ acr: ACR, procedures: { '2.1.1': { id: '2.1.1', locale: 'fr', facets: [english] } } });
    assert.match(mixed, /<span class="term">You need:<\/span> Zoom<\/p>/);
});

test('the radio groups are named apart and labelled by their check', async () => {
    const { buildManualChecklistHTML } = await load();
    const html = buildManualChecklistHTML({ acr: ACR, procedures: PROCEDURES });
    const names = [...html.matchAll(/name="([^"]+)" value="pass"/g)].map((m) => m[1]);
    assert.deepEqual(names, ['c-2-1-1-all-by-keyboard', 'c-1-4-3-contrast-images']);
    assert.match(html, /<legend><span class="visually-hidden">Label of all-by-keyboard: <\/span>Result<\/legend>/);
    for (const m of html.matchAll(/<label for="([^"]+)"><input type="radio" id="([^"]+)"/g)) assert.equal(m[1], m[2]);
});

test('with EN 301 549\'s procedures, its own requirements follow the WCAG criteria', async () => {
    const { buildManualChecklistHTML } = await load();
    const acr = {
        ...ACR,
        target: { ...ACR.target, en301549: 'V4.1.1' },
        tables: [
            ...ACR.tables,
            { id: 'en-9', title: 'Chapter 9: Web', rows: [{ id: '9.2.1.1', name: 'Keyboard', wcag: '2.1.1', draft: {} }, { id: '9.7', name: 'User preferences for web pages', draft: {} }] },
            { id: 'en-other', title: 'Chapters 5 to 8, 10, 11 and 13', rows: [{ id: '11', name: 'Chapter 11: Non-web software', draft: { remarks: 'For the author to answer.' } }] },
        ],
    };
    const enProcedures = {
        '4.2.1': { id: '4.2.1', facets: [facet('whole-tasks', 'manual')] },
        '11': { id: '11', facets: [facet('applies', 'manual')] },
    };
    const html = buildManualChecklistHTML({
        acr, procedures: PROCEDURES, enProcedures,
        review: { clauses: { '4.2.1': { facets: { 'whole-tasks': { result: 'pass', label: 'x' } } }, 'chapter-11': { conformance: 'notApplicable' } } },
        levelLabels: { notApplicable: 'Not Applicable' },
    });
    assert.match(html, /3 criteria, and EN 301 549 V4\.1\.1&#39;s 3 requirements of its own \(its chapter 9 is the WCAG criteria\); 4 checks for a person\./);
    assert.match(html, /<h2 id="t-en-4">EN 301 549 V4\.1\.1, Chapter 4<\/h2>/);
    assert.match(html, /<h3 id="h-en-4-2-1">4\.2\.1 Usage without vision<\/h3>/);
    assert.match(html, /<h3 id="h-en-11">Chapter 11: Non-web software<\/h3>/);
    assert.match(html, /Draft:<\/span> For the author to answer\./);
    assert.match(html, /Recorded so far:<\/span> Not Applicable/, 'a chapter\'s verdict, kept under chapter-11');
    assert.match(html, /name="c-en-4-2-1-whole-tasks" value="pass" checked/);
    assert.doesNotMatch(html, /9\.2\.1\.1/, 'a clause that is a WCAG criterion is not listed twice');
    assert.match(html, /<h3 id="h-en-9-7">9\.7 User preferences for web pages<\/h3>/, 'chapter 9\'s own requirement is');
    assert.match(html, /No procedure for this requirement yet\./, 'the test gives 9.7 none');
});

test('a requirement its standard only says something of shows that, and asks nothing', async () => {
    const { buildManualChecklistHTML } = await load();
    const html = buildManualChecklistHTML({
        acr: ACR,
        procedures: { '2.1.1': { id: '2.1.1', locale: 'de', note: 'Dieser Abschnitt ist gegenstandslos.', noteLang: 'de', facets: [] } },
    });
    assert.match(html, /<h3 id="h-2-1-1">2\.1\.1 Keyboard \(Level A\)<\/h3><p class="found">[^]*?<p class="note"><span class="term">The standard says:<\/span> <span lang="de">Dieser Abschnitt ist gegenstandslos\.<\/span><\/p><\/section>/);
    assert.doesNotMatch(html.split('h-2-1-1')[1].split('</section>')[0], /Automated checks decide|No procedure/);
});
