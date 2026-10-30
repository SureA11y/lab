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
        acr: ACR, procedures: PROCEDURES, lang: 'fr',
        review: { criteria: { '2.1.1': { conformance: 'partiallySupports', remarks: 'The menu traps focus.', facets: { 'all-by-keyboard': 'fail' } } } },
        levelLabels: { partiallySupports: 'Partially Supports' },
    });
    assert.match(html, /^<!doctype html>\n<html lang="fr">/);
    assert.match(html, /<title>Shop &lt;2&gt;: manual review checklist<\/title>/);
    assert.match(html, /WCAG 2\.2 Level AA: 3 criteria, 2 checks for a person\. Report of 2026-10-30\./);
    assert.match(html, /<h2 id="t-wcag-a">Table 1: Success Criteria, Level A<\/h2>/);
    assert.doesNotMatch(html, /Chapter 4/, 'WCAG only');
    assert.match(html, /<h3 id="h-2-1-1">2\.1\.1 Keyboard \(Level A\)<\/h3>/);
    assert.match(html, /Recorded so far:<\/span> Partially Supports\. The menu traps focus\./);
    assert.match(html, /value="fail" checked\/>Fails/, 'a recorded answer is ticked');
    assert.doesNotMatch(html, /Label of tech/, 'a facet another covers is not asked twice');
    assert.match(html, /What the scans found:<\/span> Automated checks found 3 failing elements, on Home\./);
    assert.match(html, /\(automated checks decide part of it\)/);
    assert.match(html, /Automated checks decide:<\/span> Label of contrast-measured\./);
    assert.match(html, /No procedure for this criterion yet/);
});

test('the radio groups are named apart and labelled by their check', async () => {
    const { buildManualChecklistHTML } = await load();
    const html = buildManualChecklistHTML({ acr: ACR, procedures: PROCEDURES });
    const names = [...html.matchAll(/name="([^"]+)" value="pass"/g)].map((m) => m[1]);
    assert.deepEqual(names, ['c-2-1-1-all-by-keyboard', 'c-1-4-3-contrast-images']);
    assert.match(html, /<legend><span class="visually-hidden">Label of all-by-keyboard: <\/span>Result<\/legend>/);
    for (const m of html.matchAll(/<label for="([^"]+)"><input type="radio" id="([^"]+)"/g)) assert.equal(m[1], m[2]);
});
