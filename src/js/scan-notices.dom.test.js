'use strict';

// DOM tests for the notes an engine leaves on a scan (canonical.notices),
// shown under the scan's header in the results view, driven under jsdom.
// node's test runner isolates each file in its own process.

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
    // The occurrences are drawn when a dialog opens (lazy-dialogs.js).
    fillLazyDialogs(resultsEl);
}

function scan(id, notices) {
    return {id, label: id, canonical: {page: {url: 'https://example.test/'}, findings: [], notices}};
}

describe('scan notices', () => {
    test('lists each engine note under the scan header', () => {
        render([scan('s1', [
            {engineId: 'surea11y', code: 'unknown-rule-ids', message: 'surea11y has no rule named color-contrast; it ignored it.'},
            {engineId: 'surea11y', code: 'context-unmatched', message: 'The scan scope "#app" matched nothing.'}
        ])]);
        const box = resultsEl.querySelector('.scan-notices');
        assert.ok(box, 'has a notes box');
        assert.equal(box.querySelector('.scan-notices-title').textContent, 'Notes on this scan');
        assert.deepEqual(
            Array.from(box.querySelectorAll('li')).map((li) => li.textContent),
            ['surea11y has no rule named color-contrast; it ignored it.', 'The scan scope "#app" matched nothing.']
        );
    });

    test('says a single note once, even when two engines gave it', () => {
        const n = {code: 'x', message: 'Same note.'};
        render([scan('s1', [{...n, engineId: 'a'}, {...n, engineId: 'b'}])]);
        const box = resultsEl.querySelector('.scan-notices');
        assert.equal(box.querySelector('.scan-notices-title').textContent, 'Note on this scan');
        assert.equal(box.querySelectorAll('li').length, 1);
    });

    test('adds nothing to a scan without notes', () => {
        render([scan('s1', []), {id: 's2', label: 's2', canonical: {findings: []}}]);
        assert.equal(resultsEl.querySelector('.scan-notices'), null);
    });

    test('shows a note as text, not markup', () => {
        render([scan('s1', [{code: 'x', message: '<b>bold</b>'}])]);
        const li = resultsEl.querySelector('.scan-notices li');
        assert.equal(li.textContent, '<b>bold</b>');
        assert.equal(li.querySelector('b'), null);
    });
});

describe('notes on what a scan could not see', () => {
    const hookNote = {engineId: 'surea11y', code: 'listener-hook', message: 'surea11y could not see which elements respond to clicks, keys or the mouse.'};
    const scopeNote = {engineId: 'surea11y', code: 'context-unmatched', message: 'The scan scope "#app" matched nothing.'};

    test('go below the results, collapsed and after the closest passes, while the rest stay at the top', () => {
        const s = scan('s1', [hookNote, scopeNote, {...hookNote, code: 'forced-colors', message: 'Shown in forced colors.'}]);
        s.canonical.margins = [{ruleId: 'target-size-minimum', title: 'Targets', unit: 'px', limit: 'min', threshold: 24, value: 30, headroom: 6, selector: 'a'}];
        render([s]);
        assert.deepEqual(Array.from(resultsEl.querySelectorAll('.scan-notices li')).map((li) => li.textContent), [scopeNote.message]);
        const box = resultsEl.querySelector('.scan-notices-after');
        assert.equal(box.tagName, 'DETAILS');
        assert.equal(box.open, false);
        assert.equal(box.querySelector('summary').textContent, 'What this scan could not see (2 notes)');
        assert.deepEqual(Array.from(box.querySelectorAll('li')).map((li) => li.textContent), [hookNote.message, 'Shown in forced colors.']);
        assert.equal(resultsEl.querySelector('.a11y-margins').nextElementSibling, box);
    });

    test('take a page that did not follow Set language below the results too', () => {
        const languageNote = {engineId: null, code: 'language-mismatch', message: 'The page says it is in English.'};
        render([scan('s1', [scopeNote, languageNote])]);
        assert.deepEqual(Array.from(resultsEl.querySelectorAll('.scan-notices li')).map((li) => li.textContent), [scopeNote.message]);
        assert.deepEqual(Array.from(resultsEl.querySelectorAll('.scan-notices-after li')).map((li) => li.textContent), [languageNote.message]);
    });

    test('take the iframes the scan left out below too, and keep one that could not be scanned at the top', () => {
        const leftOut = {engineId: 'surea11y', code: 'frames-left-out', message: "3 of the page's 4 iframes were left out: 3 show nothing."};
        const off = {engineId: 'surea11y', code: 'frames-off', message: 'This page has 1 iframe, and this scan left it out.'};
        const missed = {engineId: 'surea11y', code: 'frames-not-scanned', message: "1 of the page's 4 iframes could not be scanned."};
        render([scan('s1', [leftOut, off, missed])]);
        assert.deepEqual(Array.from(resultsEl.querySelectorAll('.scan-notices li')).map((li) => li.textContent), [missed.message]);
        assert.deepEqual(Array.from(resultsEl.querySelectorAll('.scan-notices-after li')).map((li) => li.textContent), [leftOut.message, off.message]);
    });

    test('leave no box at the top when they are all there is', () => {
        render([scan('s1', [hookNote])]);
        assert.equal(resultsEl.querySelector('.scan-notices'), null);
        assert.equal(resultsEl.querySelector('.scan-notices-after summary').textContent, 'What this scan could not see (1 note)');
    });
});

describe('closest to the limit', () => {
    const withMargins = (margins) => ({id: 's1', label: 's1', canonical: {page: {url: 'https://example.test/'}, findings: [], margins}});
    const contrast = {ruleId: 'contrast-minimum', title: 'Text has enough contrast', unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.52, headroom: 0.02, selector: 'p.lead'};
    const target = {ruleId: 'target-size-minimum', title: 'Targets are big enough', unit: 'px', limit: 'min', threshold: 24, value: 30, headroom: 6, selector: 'a.more'};

    test('lists each rule\'s closest pass, collapsed and counted when one is a near miss', () => {
        render([withMargins([target, contrast])]);
        const box = resultsEl.querySelector('.a11y-margins');
        assert.ok(box, 'has the section');
        assert.equal(box.open, false);
        assert.equal(box.querySelector('summary').textContent, 'Closest to the limit (1 near miss)');
        const rows = Array.from(box.querySelectorAll('tbody tr'));
        assert.equal(rows.length, 2);
        assert.ok(rows[0].classList.contains('a11y-margins-near'), 'the near miss comes first');
        assert.deepEqual(Array.from(rows[0].children).map((c) => c.textContent.trim()),
            ['Text has enough contrast contrast-minimum', '4.52:1', 'at least 4.5:1', '0.02 near miss', 'p.lead']);
        assert.equal(rows[1].querySelector('.a11y-margins-badge'), null);
    });

    test('stays closed when every pass has room, and is left out without margins', () => {
        render([withMargins([target])]);
        const box = resultsEl.querySelector('.a11y-margins');
        assert.equal(box.open, false);
        assert.equal(box.querySelector('summary').textContent, 'Closest to the limit');

        resultsEl.innerHTML = '';
        render([withMargins([])]);
        assert.equal(resultsEl.querySelector('.a11y-margins'), null);
    });
});

describe('what the engine found for an occurrence', () => {
    const scanWith = (occ) => ({
        id: 's1', label: 's1',
        canonical: {
            page: {url: 'https://example.test/'},
            findings: [{
                ruleId: 'img-alt-quality', id: 'img-alt-quality', title: 'Alt text describes the image', outcome: 'cantTell', severity: 'moderate',
                meta: {atomic: true},
                occurrences: [{pageUrl: 'https://example.test/', target: ['img'], html: '<img alt="IMG_1234.jpg">', summary: 'Looks like a file name', ...occ}]
            }]
        }
    });

    test('lists the details as label and value, and the shadow hosts in order', () => {
        render([scanWith({
            details: {altSignal: 'file-name', recommendedMethods: ['label', 'aria-labelledby'], truncated: false, contrastRatio: 4.54222},
            shadowHostSelectors: ['my-app', 'x-card']
        })]);
        const measured = resultsEl.querySelector('.node-measured');
        assert.ok(measured, 'has the details');
        assert.deepEqual(
            Array.from(measured.querySelectorAll('.node-details-list > div')).map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]),
            [['Alt signal', 'file-name'], ['Recommended methods', 'label, aria-labelledby'], ['Truncated', 'no'], ['Contrast ratio', '4.54']]
        );
        const shadow = resultsEl.querySelector('.node-shadow');
        assert.deepEqual(Array.from(shadow.querySelectorAll('code')).map((c) => c.textContent), ['my-app', 'x-card']);
    });

    test('adds neither for an occurrence without them', () => {
        render([scanWith({})]);
        assert.equal(resultsEl.querySelector('.node-measured'), null);
        assert.equal(resultsEl.querySelector('.node-shadow'), null);
    });
});
