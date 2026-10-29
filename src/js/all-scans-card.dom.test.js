'use strict';

// DOM tests for the "View all scans" dialog card builder (renderAllScansCard),
// driven under jsdom. The card matches the live-preview scan card: a plain
// <article> whose contents include the scanned-page URL as a real link, with
// only the screenshot acting as the link to the scan's result section. These
// tests pin that structure and the excluded/skipped variants. node's test
// runner isolates each file in its own process.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let renderAllScansCard;

const deps = {
    resolveLabelTemplate: (s) => s,
    escapeHtml: (s) => s,
    escapeAttr: (s) => s
};

function baseProps(overrides = {}) {
    return {
        label: 'SEPA direct debits',
        counts: {violations: 3, incomplete: 4, passes: 12},
        meta: {durationMs: 401, estimatedNodes: 1094},
        url: 'https://wb-example.test/sepa',
        previewUrl: 'data:image/jpeg;base64,AAAA',
        viewportRatio: 1.4,
        scanId: 'scan-1',
        excluded: false,
        filteredOut: false,
        skipped: false,
        skipInfo: null,
        ...overrides
    };
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;

    ({renderAllScansCard} = await import('./stream-ui.js'));
});

describe('renderAllScansCard', () => {
    test('is a non-link <article> whose screenshot links to the scan result', () => {
        const card = renderAllScansCard(baseProps(), deps);
        assert.equal(card.tagName, 'ARTICLE');
        assert.ok(card.classList.contains('stream-card'));
        assert.ok(card.classList.contains('all-scans-card'));

        const thumb = card.querySelector('.all-scans-thumb');
        assert.ok(thumb, 'has a screenshot link');
        assert.equal(thumb.tagName, 'A');
        assert.equal(thumb.getAttribute('href'), '#sc-scan-1');
    });

    test('renders the title, coloured counts, and duration/DOM line', () => {
        const card = renderAllScansCard(baseProps(), deps);
        assert.match(card.querySelector('.stream-card-title').textContent, /^Scan: SEPA direct debits/);

        assert.match(card.querySelector('.stream-fail').textContent, /3 fail/);
        assert.match(card.querySelector('.stream-cantTell').textContent, /4 can't tell/);
        assert.match(card.querySelector('.stream-pass').textContent, /12 pass/);

        const info = [...card.querySelectorAll('.stream-counts')].map((n) => n.textContent).join(' | ');
        assert.match(info, /401ms/);
        assert.match(info, /DOM 1094/);
    });

    test('renders the scanned-page URL as a real external link', () => {
        const card = renderAllScansCard(baseProps(), deps);
        const link = card.querySelector('.stream-url a');
        assert.ok(link, 'has a real <a> in the URL row');
        assert.equal(link.getAttribute('href'), 'https://wb-example.test/sepa');
        assert.equal(link.getAttribute('target'), '_blank');
    });

    test('the thumbnail is the anchor to the result, with the scan screenshot', () => {
        const card = renderAllScansCard(baseProps(), deps);
        const frame = card.querySelector('.stream-preview .screenshot-btn');
        assert.ok(frame, 'has a screenshot frame');
        assert.equal(frame.tagName, 'A', 'frame is the result link');
        assert.equal(frame.getAttribute('href'), '#sc-scan-1');
        const img = frame.querySelector('img');
        assert.equal(img.getAttribute('src'), 'data:image/jpeg;base64,AAAA');
        assert.equal(img.getAttribute('loading'), 'lazy');
    });

    test('flags excluded scans with the marker class and an Excluded badge', () => {
        const card = renderAllScansCard(baseProps({excluded: true}), deps);
        assert.ok(card.classList.contains('scan-summary-excluded'));
        const badge = card.querySelector('.scan-excluded-badge');
        assert.ok(badge);
        assert.equal(badge.textContent, 'Excluded');
    });

    test('marks tag-filtered scans with scan-filtered-out', () => {
        const card = renderAllScansCard(baseProps({filteredOut: true}), deps);
        assert.ok(card.classList.contains('scan-filtered-out'));
    });

    test('renders skipped scans compactly: reason instead of counts', () => {
        const card = renderAllScansCard(baseProps({
            skipped: true,
            skipInfo: {reason: 'DOM too large for a full scan'},
            previewUrl: null
        }), deps);

        assert.equal(card.tagName, 'ARTICLE');
        assert.equal(card.querySelector('.all-scans-thumb'), null, 'no screenshot link when skipped');
        assert.equal(card.querySelector('.stream-fail'), null, 'no counts for a skipped scan');
        assert.match(card.textContent, /Skipped — DOM too large for a full scan/);
    });
});
