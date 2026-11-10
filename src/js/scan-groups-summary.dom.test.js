'use strict';

// "Scan groups" under the run summary's scans list (run-summary-ui.js,
// docs/design/scan-grouping-design.md §9 step 2): drawn from every scan, kept
// open across redraws, and up to date with the scans' exclusions.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRunSummaryUi;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="summary"></div></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.A11Y_SCAN_GROUPS = require('../shared/scan-groups.js');
    globalThis.A11Y_SCAN_URL_GROUPS = require('../shared/scan-url-groups.js');
    globalThis.A11Y_SCAN_GROUP_CHOICE = require('../shared/scan-group-choice.js');
    globalThis.A11Y_SCAN_GROUPS_VIEW = require('../shared/scan-groups-view.js');
    ({createRunSummaryUi} = await import('./run-summary-ui.js'));
});

function setup() {
    const summaryEl = document.getElementById('summary');
    summaryEl.innerHTML = '';
    const ui = createRunSummaryUi({
        summaryEl,
        resultsState: {activeMode: 'report'},
        buildScanTagChipsHtml: () => '',
        buildSummaryControlsHtml: () => '',
        isScanIncludedInReport: (scan) => scan.includedInReport !== false,
        scanMatchesActiveFilters: () => true,
    });
    const write = (data) => ui.writeSummaryHtml({
        data, totals: {totalViolations: 0, totalNodes: 0}, scansCount: data.scans.length,
        scansListHtml: ui.buildScansListHtml(data.scans),
    });
    return {summaryEl, write};
}

function run(paths) {
    return {
        scans: paths.map((p, i) => ({id: `s${i}`, label: `Scan ${i + 1}`, url: `https://shop.example.com${p}`})),
    };
}

describe('Scan groups in the run summary', () => {
    test('comes after the scans list, closed', () => {
        const {summaryEl, write} = setup();
        write(run(['/', '/products/a', '/products/b']));
        const section = summaryEl.querySelector('details[data-sg-section]');
        assert.ok(section);
        assert.equal(section.open, false);
        assert.equal(section.previousElementSibling.tagName, 'OL');
    });

    test('is left out for a single scan', () => {
        const {summaryEl, write} = setup();
        write(run(['/products/a']));
        assert.equal(summaryEl.querySelector('[data-sg-section]'), null);
    });

    test('counts excluded scans in their group, and updates on a redraw', () => {
        const {summaryEl, write} = setup();
        const data = run(['/', '/products/a', '/products/b']);
        write(data);
        const counts = () => summaryEl.querySelector('[data-sg-choose="url:shop.example.com/products/{*}"]')
            .closest('.sg-choose').querySelector('.sg-counts').textContent;
        assert.equal(counts(), '2 scans · both included');
        data.scans[1].includedInReport = false;
        write(data);
        assert.equal(counts(), '2 scans · 1 of 2 included');
    });

    test('keeps the section and its groups open across a redraw', () => {
        const {summaryEl, write} = setup();
        const data = run(['/', '/products/a', '/products/b']);
        write(data);
        summaryEl.querySelector('[data-sg-section]').open = true;
        summaryEl.querySelector('[data-sg-key="not-grouped"]').open = true;
        data.scans[0].label = 'Home';
        write(data);
        assert.equal(summaryEl.querySelector('[data-sg-section]').open, true);
        assert.equal(summaryEl.querySelector('[data-sg-key="not-grouped"]').open, true);
        assert.equal(summaryEl.querySelector('[data-sg-key="url:shop.example.com/products/{*}"]').open, false);
        assert.match(summaryEl.querySelector('[data-sg-key="not-grouped"]').textContent, /Home/);
    });

    test('a skipped scan is not grouped by its URL', () => {
        const {summaryEl, write} = setup();
        const data = run(['/products/a', '/products/b', '/products/c']);
        data.scans[2].skipped = true;
        write(data);
        const row = summaryEl.querySelector('[data-sg-choose="url:shop.example.com/products/{*}"]').closest('.sg-choose');
        assert.match(row.querySelector('.sg-counts').textContent, /^2 scans/);
        assert.match(summaryEl.querySelector('[data-sg-key="not-grouped"]').textContent, /Scan 3/);
    });

    test('regroups when the scans change', () => {
        const {summaryEl, write} = setup();
        write(run(['/', '/about']));
        assert.match(summaryEl.querySelector('[data-sg-section]').textContent, /repeat no pattern/);
        write(run(['/', '/blog/a', '/blog/b']));
        assert.ok(summaryEl.querySelector('[data-sg-key="url:shop.example.com/blog/{*}"]'));
    });
});
