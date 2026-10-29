'use strict';

// A merged scan's screenshots, one per context: the box holding them is
// marked so the first shows full size and the rest small, in rows of three.
// Driven under jsdom; node's test runner isolates each file in its own process.

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

const figure = () => {
    const f = document.createElement('figure');
    f.className = 'screenshot-context-figure';
    return f;
};
const button = () => {
    const b = document.createElement('button');
    b.className = 'screenshot-btn';
    return b;
};

function preview(elements, screenshots = undefined) {
    createRenderer({
        resultsEl,
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: (s) => String(s),
        escapeHtml: (s) => String(s),
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => elements,
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
    }).renderAllScans([{id: 's1', label: 's1', screenshots, canonical: {page: {url: 'https://example.test/'}, findings: []}}]);
    return resultsEl.querySelector('.screenshot-preview');
}

describe('screenshots of a merged scan', () => {
    test('several context screenshots are laid out as one large and the rest small', () => {
        const box = preview([figure(), figure(), figure()]);
        assert.ok(box.classList.contains('screenshot-preview--contexts'));
    });

    test('a single screenshot, or ones without contexts, keep the usual layout', () => {
        assert.equal(preview([figure()]).classList.contains('screenshot-preview--contexts'), false);
        assert.equal(preview([button(), button()]).classList.contains('screenshot-preview--contexts'), false);
    });
});

describe('a page pictured only in part', () => {
    test('a clipped picture is said to show only the top of the page', () => {
        const box = preview([button()], [{name: 'Main screenshot', dataUrl: 'data:image/jpeg;base64,AA==', clipped: true}]);
        assert.match(box.querySelector('.screenshot-clipped').textContent, /only the top of the page/);
    });

    test('a whole picture says nothing of it', () => {
        const box = preview([button()], [{name: 'Main screenshot', dataUrl: 'data:image/jpeg;base64,AA=='}]);
        assert.equal(box.querySelector('.screenshot-clipped'), null);
    });
});

describe('a Screenshot step\'s picture of a page too large', () => {
    test('says it shows only the top of the page', () => {
        const shots = document.getElementById('shots');
        createRenderer({
            resultsEl,
            screenshotsEl: shots,
            escapeAttr: (s) => String(s),
            escapeHtml: (s) => String(s),
            jsonToBrowserLink: () => '',
            buildScreenshotElements: () => [],
            imgToBtn: () => document.createElement('img'),
            dialogs: {screenshotsDialog: {openById() {}}},
        }).renderAllScreenshots([{name: 'Big', dataUrl: 'data:image/jpeg;base64,AA==', clipped: true}, {name: 'Small', dataUrl: 'data:image/jpeg;base64,AA=='}]);
        assert.equal(shots.querySelectorAll('.screenshot-clipped').length, 1);
    });
});
