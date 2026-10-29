'use strict';

// DOM tests for the best practices a scan included (canonical.bestPractices),
// listed in a section of their own below the requirements in the results
// view, driven under jsdom. node's test runner isolates each file in its own
// process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRenderer;
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
});

beforeEach(() => {
    document.body.innerHTML = '<div id="results"></div><div id="shots"></div>';
    resultsEl = document.getElementById('results');
});

function render(scans) {
    createRenderer({
        resultsEl,
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: (s) => String(s),
        escapeHtml: (s) => String(s),
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
    }).renderAllScans(scans);
}

const finding = (ruleId, outcome, extra = {}) => ({
    id: ruleId, ruleId, outcome, severity: 'moderate', title: ruleId,
    provenance: {engine: {name: 'surea11y'}},
    occurrences: outcome === 'pass' ? [] : [{target: ['main'], html: '<main>', outcome}],
    ...extra
});

function scan(findings, bestPractices) {
    return {id: 's1', label: 'Home', url: 'https://example.test/', canonical: {page: {url: 'https://example.test/'}, findings, bestPractices}};
}

describe('best practices section', () => {
    test('lists them below the requirements, with their own counts', () => {
        render([scan(
            [finding('wcag-1.1.1', 'fail', {wcag: {sc: ['1.1.1']}})],
            [finding('region', 'fail', {bestPractice: true}), finding('heading-order', 'cantTell', {bestPractice: true}), finding('skip-link', 'pass', {bestPractice: true})]
        )]);
        const section = resultsEl.querySelector('.best-practices');
        assert.ok(section, 'has a best practices section');
        assert.equal(section.querySelector('h4').textContent, 'Best practices');
        assert.equal(section.getAttribute('aria-labelledby'), section.querySelector('h4').id);
        assert.match(section.querySelector('.best-practices-note').textContent, /^1 failing, 1 to review\. /);
        const text = section.textContent;
        assert.ok(text.includes('region') && text.includes('heading-order'));
        assert.ok(!text.includes('wcag-1.1.1'), 'the requirements stay in their own table');
        const before = resultsEl.textContent.indexOf('wcag-1.1.1');
        assert.ok(before >= 0 && before < resultsEl.textContent.indexOf('Best practices'), 'below the requirements');
    });

    test('shows the section even when no requirement failed', () => {
        render([scan([], [finding('region', 'fail', {bestPractice: true})])]);
        assert.ok(resultsEl.querySelector('.best-practices'));
    });

    test('adds nothing when no best practice failed or needs review', () => {
        render([scan([finding('wcag-1.1.1', 'fail')], [finding('region', 'pass', {bestPractice: true})])]);
        render([scan([finding('wcag-1.1.1', 'fail')], undefined)]);
        assert.equal(resultsEl.querySelector('.best-practices'), null);
    });
});
