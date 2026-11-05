'use strict';

// One element several checks of a rollup flagged (an occurrence's `checks`)
// is one occurrence in a finding's details, each check's word under it; and
// the occurrence count says how many elements they are about when that is
// fewer, as in a merged scan whose contexts give one element two ids.
// Driven under jsdom.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRenderer;
let fillLazyDialogs;
let resultsEl;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.CSS = win.CSS;
    globalThis.requestAnimationFrame = (fn) => win.setTimeout(fn, 0);

    ({createRenderer} = await import('./a11y-ui.rendering.js'));
    ({fillLazyDialogs} = await import('./lazy-dialogs.js'));
});

beforeEach(() => {
    document.body.innerHTML = '<div id="results"></div><div id="shots"></div>';
    resultsEl = document.getElementById('results');
});

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(occurrences) {
    createRenderer({
        resultsEl,
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: escape,
        escapeHtml: escape,
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
    }).renderAllScans([{
        id: 's1',
        label: 's1',
        canonical: {
            page: {url: 'https://example.test/'},
            findings: [{
                id: 'wcag-4.1.2-aria-validity',
                ruleId: 'wcag-4.1.2-aria-validity',
                title: 'Name, role, value: ARIA validity',
                outcome: 'fail',
                severity: 'serious',
                tags: ['wcag2a'],
                wcag: {sc: ['4.1.2']},
                meta: {atomic: false},
                evidence: {rollup: {checksIds: ['nested-interactive-controls-absent', 'presentational-children-focusable-absent'], contributors: []}},
                occurrences
            }]
        }
    }]);
    fillLazyDialogs(resultsEl);
}

const NESTED = {checkId: 'nested-interactive-controls-absent', failureSummary: 'This <mat-option> has interactive controls nested inside it: a.', hint: 'Move the nested controls out of this element.', details: {nestedElements: ['a']}};
const PRESENTATIONAL = {checkId: 'presentational-children-focusable-absent', failureSummary: 'This role="option" element makes its children presentational.', hint: 'Move the focusable content out of this element.', details: {focusableElements: ['a']}};

function option(n, {contexts, checks = true} = {}) {
    return {
        target: [`#mat-option-${n}`],
        html: `<mat-option role="option" id="mat-option-${n}" aria-selected="false"><a href="/p${n % 3}">Page ${n % 3}</a></mat-option>`,
        pageUrl: 'https://example.test/',
        failureSummary: NESTED.failureSummary,
        hint: NESTED.hint,
        details: NESTED.details,
        atomicCheckId: NESTED.checkId,
        sourceAtomicRules: checks ? [NESTED.checkId, PRESENTATIONAL.checkId] : [NESTED.checkId],
        ...(checks ? {checks: [NESTED, PRESENTATIONAL]} : {}),
        ...(contexts ? {contexts, contextsTotal: 2} : {}),
    };
}

describe('an element several checks flagged', () => {
    test('is one occurrence, with what each check said under it', () => {
        render([option(0)]);
        const nodes = resultsEl.querySelectorAll('.example-node');
        assert.equal(nodes.length, 1);
        const checks = Array.from(nodes[0].querySelectorAll('.node-check'));
        assert.deepEqual(checks.map((c) => c.querySelector('.node-check-title code').textContent),
            ['nested-interactive-controls-absent', 'presentational-children-focusable-absent']);
        assert.match(checks[0].textContent, /interactive controls nested inside it/);
        assert.match(checks[0].textContent, /Move the nested controls/);
        assert.match(checks[1].textContent, /makes its children presentational/);
        assert.match(checks[1].textContent, /Focusable elements/);
        assert.match(nodes[0].querySelector('.node-checks-lead').textContent, /2 checks flagged this element/);
        assert.match(resultsEl.querySelector('.instances-meta').textContent, /^1 occurrence$/);
    });

    test('an element one check flagged keeps its single check line', () => {
        render([option(0, {checks: false})]);
        assert.equal(resultsEl.querySelectorAll('.node-check').length, 0);
        assert.match(resultsEl.querySelector('.example-node').textContent, /Check:\s*nested-interactive-controls-absent/);
    });
});

describe('the element count', () => {
    test('counts the same element of two contexts, with different ids, once', () => {
        const desktop = [0, 1, 2].map((n) => option(n, {contexts: ['Desktop']}));
        const mobile = [284, 285, 286].map((n) => option(n, {contexts: ['Mobile']}));
        render([...desktop, ...mobile]);
        assert.equal(resultsEl.querySelector('.instances-meta').textContent, '6 occurrences · 3 elements');
        assert.match(resultsEl.querySelector('.src-dialog-meta').textContent, /6 occurrences · 3 elements/);
    });

    test('says nothing when each occurrence is an element of its own', () => {
        render([0, 1, 2].map((n) => option(n)));
        assert.equal(resultsEl.querySelector('.instances-meta').textContent, '3 occurrences');
    });
});
