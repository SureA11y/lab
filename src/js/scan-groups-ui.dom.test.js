'use strict';

// Choosing, naming and acting on scan groups in the run summary
// (scan-groups-ui.js, docs/design/scan-grouping-design.md §6, §7): what each
// control saves in the report, what it asks the app to change, and where
// focus is left.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRunSummaryUi;
let createScanGroupsUi;
let dom;

before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="summary"></div></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.A11Y_SCAN_GROUPS = require('../shared/scan-groups.js');
    globalThis.A11Y_SCAN_URL_GROUPS = require('../shared/scan-url-groups.js');
    globalThis.A11Y_SCAN_GROUP_CHOICE = require('../shared/scan-group-choice.js');
    globalThis.A11Y_SCAN_GROUPS_VIEW = require('../shared/scan-groups-view.js');
    globalThis.A11Y_SCAN_FOLD = require('../shared/scan-fold.js');
    globalThis.A11Y_SCAN_GROUP_MERGE = require('../shared/scan-group-merge.js');
    ({createRunSummaryUi} = await import('./run-summary-ui.js'));
    ({createScanGroupsUi} = await import('./scan-groups-ui.js'));
});

const PRODUCTS = 'url:shop.example.com/products/{*}';

// The app as far as these two parts see it, over one report. Its
// applyScanInclusion does what a11y-ui.js does: set the flags, then draw the
// summary again and give focus back.
function setup(paths, payloadExtra = {}) {
    const old = document.getElementById('summary');
    const summaryEl = old.cloneNode(false);
    old.replaceWith(summaryEl);
    const payload = {
        scans: paths.map((p, i) => ({id: `s${i}`, label: `Scan ${i + 1}`, url: `https://shop.example.com${p}`})),
        ...payloadExtra,
    };
    const statuses = [];
    const inclusions = [];
    const redraws = [];
    const app = {
        summaryEl,
        resultsState: {activeMode: 'report'},
        getActiveBucket: () => ({payload}),
        setStatusReport: (m) => statuses.push(m),
        setStatusRun: (m) => statuses.push(m),
        updateResults: (control, work) => work(),
        buildScanTagChipsHtml: () => '',
        buildSummaryControlsHtml: () => '',
        isScanIncludedInReport: (scan) => scan.includedInReport !== false,
        scanMatchesActiveFilters: () => true,
        // What a11y-ui.js does: hold the section, draw the report again.
        redrawAsShown(p) {
            redraws.push(p);
            const token = app.runSummaryUi.captureGroupsFocus();
            app.runSummaryUi.holdGroupsState();
            summaryEl.textContent = '';
            write();
            app.runSummaryUi.restoreGroupsFocus(token);
        },
        applyScanInclusion(plan, message) {
            inclusions.push(plan);
            const token = app.runSummaryUi.captureGroupsFocus();
            for (const s of payload.scans) {
                if (plan.include.includes(s.id)) s.includedInReport = true;
                if (plan.exclude.includes(s.id)) s.includedInReport = false;
            }
            write();
            app.runSummaryUi.restoreGroupsFocus(token);
            statuses.push(message);
        },
    };
    app.runSummaryUi = createRunSummaryUi(app);
    const write = () => app.runSummaryUi.writeSummaryHtml({
        data: payload, totals: {totalViolations: 0, totalNodes: 0}, scansCount: payload.scans.length,
        scansListHtml: app.runSummaryUi.buildScansListHtml(payload.scans),
    });
    write();
    summaryEl.querySelector('[data-sg-section]').open = true;
    createScanGroupsUi(app);
    const $ = (sel) => summaryEl.querySelector(sel);
    return {payload, summaryEl, statuses, inclusions, redraws, $, write, runSummaryUi: app.runSummaryUi};
}

function check(box, on) {
    box.checked = on;
    box.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
}
function key(el, k) {
    el.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true}));
}
const included = (payload) => payload.scans.map((s) => s.includedInReport !== false);
const SHOP = ['/', '/products/a', '/products/b', '/products/c'];

describe('Choosing a pattern', () => {
    test('saves it in the report, shows it under Your groups, and keeps focus on the checkbox', () => {
        const {payload, $, statuses} = setup(SHOP);
        const box = $(`[data-sg-choose="${PRODUCTS}"]`);
        box.focus();
        check(box, true);
        assert.deepEqual(payload.scanGrouping, {patterns: [{key: PRODUCTS, name: null}]});
        assert.ok($(`[data-sg-key="chosen:${PRODUCTS}"]`));
        assert.equal($('#sg-yours-h').textContent, 'Your groups');
        assert.equal(document.activeElement.getAttribute('data-sg-focus'), `choose:${PRODUCTS}`);
        assert.equal(document.activeElement.checked, true);
        assert.equal(statuses.at(-1), 'Grouping the scans by /products/{slug}.');
    });

    test('unchoosing removes it, and the field when nothing is left', () => {
        const {payload, $, statuses} = setup(SHOP, {scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products'}]}});
        assert.ok($(`[data-sg-key="chosen:${PRODUCTS}"]`));
        check($(`[data-sg-choose="${PRODUCTS}"]`), false);
        assert.equal('scanGrouping' in payload, false);
        assert.equal($('#sg-yours-h'), null);
        assert.equal(statuses.at(-1), 'No longer grouping the scans by /products/{slug}.');
    });

    test('a saved choice shows when the report is drawn', () => {
        const {$} = setup(SHOP, {scanGrouping: {patterns: [{key: PRODUCTS, name: 'Product pages'}]}});
        assert.equal($(`[data-sg-choose="${PRODUCTS}"]`).checked, true);
        assert.match($(`[data-sg-key="chosen:${PRODUCTS}"] > summary`).textContent, /^Product pages/);
    });
});

describe('Naming a group', () => {
    const chosen = {scanGrouping: {patterns: [{key: PRODUCTS, name: null}]}};

    test('Enter saves the name and leaves focus in the field', () => {
        const {payload, $, statuses} = setup(SHOP, structuredClone(chosen));
        const input = $(`[data-sg-name="${PRODUCTS}"]`);
        input.focus();
        input.value = '  Product   pages ';
        key(input, 'Enter');
        assert.deepEqual(payload.scanGrouping.patterns, [{key: PRODUCTS, name: 'Product pages'}]);
        assert.equal(document.activeElement.getAttribute('data-sg-focus'), `name:${PRODUCTS}`);
        assert.equal(document.activeElement.value, 'Product pages');
        assert.match($(`[data-sg-key="chosen:${PRODUCTS}"] > summary`).textContent, /^Product pages \/products\/\{slug\}/);
        assert.equal(statuses.at(-1), 'Group /products/{slug} named "Product pages".');
    });

    test('leaving the field saves it too; the same name again changes nothing', () => {
        const {payload, $, statuses} = setup(SHOP, structuredClone(chosen));
        const input = $(`[data-sg-name="${PRODUCTS}"]`);
        input.value = 'Products';
        input.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
        assert.equal(payload.scanGrouping.patterns[0].name, 'Products');
        const n = statuses.length;
        const again = $(`[data-sg-name="${PRODUCTS}"]`);
        again.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
        assert.equal(statuses.length, n);
    });

    test('an empty name shows the pattern again', () => {
        const {payload, $, statuses} = setup(SHOP, {scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products'}]}});
        const input = $(`[data-sg-name="${PRODUCTS}"]`);
        input.value = '';
        key(input, 'Enter');
        assert.equal(payload.scanGrouping.patterns[0].name, null);
        assert.equal(statuses.at(-1), 'Group /products/{slug} shown by its pattern again.');
    });

    test('Escape puts back the saved name without saving', () => {
        const {payload, $} = setup(SHOP, {scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products'}]}});
        const input = $(`[data-sg-name="${PRODUCTS}"]`);
        input.value = 'Something else';
        key(input, 'Escape');
        assert.equal(input.value, 'Products');
        assert.equal(payload.scanGrouping.patterns[0].name, 'Products');
    });
});

describe('Acting on a group', () => {
    const chosen = () => ({scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products'}]}});
    const press = ($, action) => $(`[data-sg-action="${action}"][data-sg-group="${PRODUCTS}"]`).click();

    test('Exclude all takes its scans out, says how many, and keeps focus on the button', () => {
        const {payload, $, statuses} = setup(SHOP, chosen());
        const btn = $(`[data-sg-action="exclude"][data-sg-group="${PRODUCTS}"]`);
        btn.focus();
        btn.click();
        assert.deepEqual(included(payload), [true, false, false, false]);
        assert.equal(statuses.at(-1), '3 scans of Products excluded from the summary report.');
        assert.equal(document.activeElement.getAttribute('data-sg-focus'), `exclude:${PRODUCTS}`);
        assert.match($(`[data-sg-key="chosen:${PRODUCTS}"] > summary`).textContent, /none included/);
    });

    test('Include all brings them back', () => {
        const {payload, $, statuses} = setup(SHOP, chosen());
        payload.scans[2].includedInReport = false;
        payload.scans[3].includedInReport = false;
        press($, 'include');
        assert.deepEqual(included(payload), [true, true, true, true]);
        assert.equal(statuses.at(-1), '2 scans of Products included in the summary report.');
    });

    test('Keep one keeps the first included scan and names it', () => {
        const {payload, $, statuses, inclusions} = setup(SHOP, chosen());
        payload.scans[1].includedInReport = false;
        press($, 'keepOne');
        assert.deepEqual(inclusions.at(-1), {include: [], exclude: ['s3']});
        assert.deepEqual(included(payload), [true, false, true, false]);
        assert.equal(statuses.at(-1), 'Kept Scan 3 of Products in the summary report; 1 other scan excluded.');
    });

    test('nothing to change: said, and the report left alone', () => {
        const {$, statuses, inclusions} = setup(SHOP, chosen());
        press($, 'include');
        assert.equal(inclusions.length, 0);
        assert.equal(statuses.at(-1), 'Nothing to change: every scan of Products is already included.');
    });

    test('an action on a group acts on the groups inside it too', () => {
        const blog = ['/', '/blog/a11y/a', '/blog/a11y/b', '/blog/news/c', '/blog/news/d'];
        const outer = 'url:shop.example.com/blog/{*}/{*}';
        const inner = 'url:shop.example.com/blog/a11y/{*}';
        const {payload, $} = setup(blog, {scanGrouping: {patterns: [{key: outer}, {key: inner}]}});
        $(`[data-sg-action="exclude"][data-sg-group="${outer}"]`).click();
        assert.deepEqual(included(payload), [true, false, false, false, false]);
        $(`[data-sg-action="include"][data-sg-group="${inner}"]`).click();
        assert.deepEqual(included(payload), [true, true, true, false, false]);
    });
});

describe('Redrawing the section', () => {
    test('refreshScanGroups shows a renamed scan, keeping what was open', () => {
        const {payload, $, runSummaryUi} = setup(SHOP);
        $(`[data-sg-key="${PRODUCTS}"]`).open = true;
        payload.scans[1].label = 'Red shirt';
        runSummaryUi.refreshScanGroups(payload);
        assert.match($(`[data-sg-key="${PRODUCTS}"]`).textContent, /Red shirt/);
        assert.equal($(`[data-sg-key="${PRODUCTS}"]`).open, true);
        assert.equal($('[data-sg-section]').open, true);
    });
});

describe('Merging a group (§9)', () => {
    const chosen = () => ({scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products'}]}});

    test('the switch saves the merge, draws the report again, and keeps focus and what was open', () => {
        const {payload, $, statuses, redraws} = setup(SHOP, chosen());
        $(`[data-sg-key="chosen:${PRODUCTS}"]`).open = true;
        const box = $(`[data-sg-merge="${PRODUCTS}"]`);
        assert.equal(box.checked, false);
        assert.equal(document.querySelector(`label[for="${box.id}"]`).textContent, 'Merge into one scan');
        box.focus();
        check(box, true);
        assert.deepEqual(payload.scanGrouping.patterns, [{key: PRODUCTS, name: 'Products', merge: true}]);
        assert.equal(redraws.length, 1);
        assert.equal(statuses.at(-1), 'Products: its 3 scans shown as one merged scan.');
        assert.equal(document.activeElement.getAttribute('data-sg-focus'), `merge:${PRODUCTS}`);
        assert.equal(document.activeElement.checked, true);
        assert.equal($(`[data-sg-key="chosen:${PRODUCTS}"]`).open, true);
        assert.equal($('[data-sg-section]').open, true);
    });

    test('unmerging keeps the group and its name', () => {
        const {payload, $, statuses} = setup(SHOP, {scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products', merge: true}]}});
        check($(`[data-sg-merge="${PRODUCTS}"]`), false);
        assert.deepEqual(payload.scanGrouping.patterns, [{key: PRODUCTS, name: 'Products'}]);
        assert.equal(statuses.at(-1), 'Products: its 3 scans shown each on its own again.');
    });

    test('a group inside a merged one says it is shown merged into it', () => {
        const blog = ['/', '/blog/a11y/a', '/blog/a11y/b', '/blog/news/c', '/blog/news/d'];
        const outer = 'url:shop.example.com/blog/{*}/{*}';
        const inner = 'url:shop.example.com/blog/a11y/{*}';
        const {$} = setup(blog, {scanGrouping: {patterns: [{key: outer, name: 'Posts', merge: true}, {key: inner, merge: true}]}});
        assert.equal($(`[data-sg-key="chosen:${inner}"] .sg-merged-into`).textContent,
            'Shown merged into Posts, the larger merged group it is in.');
        assert.equal($(`[data-sg-key="chosen:${outer}"]`).querySelector(':scope > .sg-merged-into'), null);
        assert.equal($(`[data-sg-merge="${inner}"]`).checked, true);
    });

    test('the scans as shown: one merged scan for the report, the scans themselves for the groups', () => {
        const {payload, $, runSummaryUi} = setup(SHOP, {scanGrouping: {patterns: [{key: PRODUCTS, name: 'Products', merge: true}]}});
        const {scans, merges} = runSummaryUi.shownScans(payload);
        assert.deepEqual(scans.map((s) => s.label), ['Scan 1', 'Products']);
        assert.deepEqual([...merges.values()][0].members, ['s1', 's2', 's3']);
        const view = runSummaryUi.viewPayload(payload);
        assert.notEqual(view, payload);
        assert.equal(view.scans, scans);
        assert.equal(payload.scans.length, 4);
        // Worked out once while nothing changes.
        assert.equal(runSummaryUi.shownScans(payload), runSummaryUi.shownScans(payload));
        // The groups still hold the products one by one.
        assert.match($(`[data-sg-key="chosen:${PRODUCTS}"] > summary`).textContent, /3 scans/);
    });

    test('nothing merged: the report as it is', () => {
        const {payload, runSummaryUi} = setup(SHOP, chosen());
        assert.equal(runSummaryUi.viewPayload(payload), payload);
    });
});
