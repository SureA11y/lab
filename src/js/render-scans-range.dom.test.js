'use strict';

// Drawing a report's scans a few at a time (renderAllScans with `range`),
// driven under jsdom.

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

function renderer() {
    return createRenderer({
        resultsEl,
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: (s) => String(s),
        escapeHtml: (s) => String(s),
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
    });
}

const scans = ['a', 'b', 'c', 'd', 'e'].map((id) => ({id, label: id, canonical: {page: {url: 'https://example.test/'}, findings: []}}));
const drawn = () => Array.from(resultsEl.querySelectorAll('.scan-results-wrapper'), (w) => w.getAttribute('data-scan-id'));

describe('drawing scans a few at a time', () => {
    test('ranges drawn one after another give the same scans, in order, as one draw', () => {
        const r = renderer();
        r.renderAllScans(scans, {range: [0, 2]});
        assert.deepEqual(drawn(), ['a', 'b']);
        r.renderAllScans(scans, {range: [2, 4]});
        r.renderAllScans(scans, {range: [4, 8]});
        const inBatches = resultsEl.innerHTML;

        resultsEl.innerHTML = '';
        renderer().renderAllScans(scans);
        assert.deepEqual(drawn(), ['a', 'b', 'c', 'd', 'e']);
        assert.equal(resultsEl.innerHTML, inBatches);
    });
});
