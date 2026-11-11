'use strict';

// DOM tests for a finding's "View details" dialog (a11y-ui.rendering.js):
// titled with the rule's name, what every occurrence shares said once at the
// top, the occurrences grouped by page, one close, and the selector "Copy
// selector" copies shown beside it. Driven under jsdom.

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
                id: 'wcag-1.1.1-non-text-content',
                ruleId: 'wcag-1.1.1-non-text-content',
                title: 'Non-text content: text alternatives',
                outcome: 'fail',
                severity: 'serious',
                tags: ['wcag2a'],
                wcag: [],
                occurrences
            }]
        }
    }]);
    fillLazyDialogs(resultsEl);
    return resultsEl.querySelector('dialog.src-dialog');
}

function occurrence(target, page, extra = {}) {
    return {
        target: [target],
        html: `<img src="${target}.png">`,
        failureSummary: 'This <img> has no alt attribute.',
        hint: 'Add an alt attribute that says what the image shows.',
        atomicCheckId: 'img-alt-present',
        pageUrl: page,
        elementScreenshot: {skipped: 'max-reached', max: 20},
        ...extra,
    };
}

const A = 'https://example.test/en/many-failures';
const B = 'https://example.test/en/other';

describe('finding details dialog', () => {
    test('is titled with the rule name; the rule id, impact and count are under it', () => {
        const dialog = render([occurrence('#a', A), occurrence('#b', A)]);
        const title = dialog.querySelector('#' + dialog.getAttribute('aria-labelledby'));
        assert.equal(title.textContent, 'Non-text content: text alternatives');
        const meta = dialog.querySelector('.src-dialog-header .src-dialog-meta').textContent;
        assert.match(meta, /^Rule wcag-1\.1\.1-non-text-content · Impact: serious · 2 occurrences/);
    });

    test('has one close control, in its header', () => {
        const dialog = render([occurrence('#a', A), occurrence('#b', A)]);
        const closes = dialog.querySelectorAll('.src-dialog-close');
        assert.equal(closes.length, 1);
        assert.ok(closes[0].closest('.src-dialog-header'));
        assert.equal(dialog.querySelector('.src-dialog-footer'), null, 'no footer when every occurrence is listed');
    });

    test('says what every occurrence shares once, at the top', () => {
        const dialog = render([occurrence('#a', A), occurrence('#b', A), occurrence('#c', B)]);
        const common = dialog.querySelector('.occurrences-common');
        assert.equal(common.querySelector('h2').textContent, 'For all 3 occurrences');
        assert.match(common.textContent, /This <img> has no alt attribute\./);
        assert.match(common.textContent, /How to fix: Add an alt attribute/);
        assert.match(common.textContent, /Check: img-alt-present/);
        assert.match(common.textContent, /No picture: the scan reached its limit of 20 pictures\./);
        for (const node of dialog.querySelectorAll('.example-node')) {
            assert.doesNotMatch(node.textContent, /How to fix|No picture|has no alt attribute|Check:/);
        }
    });

    test('keeps on each occurrence what differs between them', () => {
        const dialog = render([
            occurrence('#a', A, {failureSummary: 'First reason.'}),
            occurrence('#b', A, {failureSummary: 'Second reason.', elementScreenshot: {skipped: 'zero-size'}}),
            occurrence('#c', A),
        ]);
        const nodes = Array.from(dialog.querySelectorAll('.example-node'));
        assert.match(nodes[0].textContent, /First reason\./);
        assert.match(nodes[1].textContent, /Second reason\./);
        // Two of three share the reason for no picture: said once, with how many.
        assert.match(dialog.querySelector('.occurrences-common').textContent, /No picture for 2 of them: the scan reached its limit/);
        assert.match(nodes[1].textContent, /No picture: the element has no width or height\./);
    });

    test('groups the occurrences by page, each page named once', () => {
        const dialog = render([occurrence('#a', A), occurrence('#b', B), occurrence('#c', A)]);
        const groups = Array.from(dialog.querySelectorAll('.occurrence-group'));
        assert.equal(groups.length, 2);
        assert.match(groups[0].querySelector('h2').textContent, /^Found on example\.test\/en\/many-failures · 2 occurrences$/);
        assert.match(groups[1].querySelector('h2').textContent, /^Found on example\.test\/en\/other · 1 occurrence$/);
        assert.equal(groups[0].querySelectorAll('.copy-urls-btn').length, 1);
        // Numbered in the order they are shown.
        assert.deepEqual(Array.from(dialog.querySelectorAll('.example-node h3')).map((h) => h.textContent),
            ['Occurrence 1', 'Occurrence 2', 'Occurrence 3']);
        assert.equal(dialog.querySelectorAll('.example-node .node-pages').length, 0, 'no page line on each occurrence');
    });

    test('shows the selector "Copy selector" copies', () => {
        const dialog = render([occurrence('#a', A), occurrence('#b', A)]);
        const line = dialog.querySelector('.example-node .node-selector');
        assert.equal(line.querySelector('code').textContent, '#a');
        const button = line.querySelector('.copy-selector-btn');
        assert.equal(button.getAttribute('data-selector'), '#a');
        assert.equal(button.getAttribute('aria-label'), 'Copy selector of Occurrence 1');
    });
});
