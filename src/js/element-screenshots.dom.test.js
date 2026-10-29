'use strict';

// DOM tests for the pictures of flagged elements (an occurrence's
// elementScreenshot, see src/server-side/element-screenshots.js), shown in
// a finding's occurrence list, driven under jsdom.

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
                id: 'img-alt-present',
                ruleId: 'img-alt-present',
                title: 'Images have a text alternative',
                outcome: 'fail',
                severity: 'serious',
                tags: ['wcag2a'],
                wcag: [],
                occurrences
            }]
        }
    }]);
    // The occurrences are drawn when a dialog opens (lazy-dialogs.js).
    fillLazyDialogs(resultsEl);
}

function occurrence(target, elementScreenshot) {
    return {target: [target], html: `<img id="${target}">`, failureSummary: 'No text alternative.', pageUrl: 'https://example.test/', ...(elementScreenshot ? {elementScreenshot} : {})};
}

describe('element screenshots', () => {
    test('shows the picture of each flagged element in its occurrence', () => {
        render([
            occurrence('#a', {url: '/reports/evidence/run/elements-s1/element-aaaaaaaaaaaa.png', box: {x: 16, y: 16, width: 50, height: 20}}),
            occurrence('#b', {url: 'data:image/png;base64,iVBORw0KGgo=', box: null, cropped: true})
        ]);
        const figures = Array.from(resultsEl.querySelectorAll('.example-node .node-screenshot'));
        assert.equal(figures.length, 2);
        assert.equal(figures[0].querySelector('img').getAttribute('src'), '/reports/evidence/run/elements-s1/element-aaaaaaaaaaaa.png');
        // Each says which occurrence, and what element, it shows.
        assert.deepEqual(figures.map((f) => f.querySelector('img').getAttribute('alt')), [
            'Occurrence 1: the flagged img element, with a box drawn around it',
            'Occurrence 2: the flagged img element, with a box drawn around it'
        ]);
        assert.equal(figures[0].querySelector('figcaption'), null);
        assert.equal(figures[1].querySelector('figcaption').textContent, 'Only part of the element fits in the picture.');
    });

    test('a report loaded from its package shows its pictures; its JSON on its own says they are not included', () => {
        render([
            occurrence('#q', {url: 'blob:http://lab.test/3f2a', box: null}),
            occurrence('#r', {url: 'images/0123456789abcdef0123.png', box: null}),
            occurrence('#s', {skipped: 'not-included'})
        ]);
        const nodes = Array.from(resultsEl.querySelectorAll('.example-node'));
        assert.equal(nodes[0].querySelector('.node-screenshot img').getAttribute('src'), 'blob:http://lab.test/3f2a');
        for (const node of nodes.slice(1)) {
            assert.equal(node.querySelector('img'), null);
            assert.equal(node.querySelector('.node-screenshot-none').textContent, 'No picture: it is not included with this copy of the report.');
        }
    });

    test('in a merged scan, says which context the picture shows, when the occurrence is in more than one', () => {
        const url = '/reports/evidence/run/elements-s1/element-aaaaaaaaaaaa.png';
        render([
            {...occurrence('#k', {url, box: null, context: 'Dark', cropped: true}), contexts: ['Light', 'Dark'], contextsTotal: 2},
            {...occurrence('#l', {url, box: null, context: 'Dark'}), contexts: ['Dark'], contextsTotal: 2}
        ]);
        const captions = Array.from(resultsEl.querySelectorAll('.node-screenshot')).map((f) => f.querySelector('figcaption')?.textContent || null);
        assert.deepEqual(captions, ['Pictured in Dark. Only part of the element fits in the picture.', null]);
    });

    test('says why an occurrence has no picture', () => {
        render([
            occurrence('#c', {skipped: 'not-rendered'}),
            occurrence('#h', {skipped: 'time-limit'}),
            occurrence('#i', {skipped: 'max-reached', max: 20}),
            occurrence('#j', {skipped: 'max-reached'}),
            occurrence('#o', {skipped: 'rule-limit', max: 3}),
            occurrence('#p', {skipped: 'rule-limit', max: 1}),
            occurrence('#m', {skipped: 'capture-failed', error: 'Protocol error: Target closed.'}),
            occurrence('#n', {skipped: 'store-failed', error: 'ENOSPC: no space left on device'}),
            occurrence('#d', {skipped: 'something-new'})
        ]);
        assert.deepEqual(
            Array.from(resultsEl.querySelectorAll('.node-screenshot-none')).map((el) => el.textContent),
            [
                'No picture: the element is not rendered (hidden by CSS, for instance).',
                'No picture: the scan ran out of time for pictures.',
                'No picture: the scan reached its limit of 20 pictures.',
                'No picture: the scan reached its limit of pictures.',
                'No picture: this rule reached its limit of 3 pictures.',
                'No picture: this rule reached its limit of 1 picture.',
                'No picture: the picture could not be taken (Protocol error: Target closed).',
                'No picture: the picture was taken but could not be saved (ENOSPC: no space left on device).',
                'No picture: something-new'
            ]
        );
    });

    test('shows nothing for a scan taken without pictures, and no picture from anywhere else', () => {
        render([occurrence('#e', null), occurrence('#f', {url: 'https://elsewhere.example/x.png'}), occurrence('#g', {url: 'javascript:alert(1)'})]);
        assert.equal(resultsEl.querySelectorAll('.node-screenshot, .node-screenshot-none').length, 0);
        assert.ok(resultsEl.querySelectorAll('.example-node').length >= 1);
    });
});
