'use strict';

// Reviewing a run's scans in the app (scan-review-ui.js with run-summary-ui.js,
// docs/design/scan-grouping-design.md §11.2): the card at the top of the
// summary, the workspace, what each control saves in the report, undo, and
// where focus is left.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRunSummaryUi;
let createScanReviewUi;
let dom;

before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="summary"></div></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    // jsdom has no modal dialogs: open and close are enough here.
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    globalThis.A11Y_SCAN_GROUPS = require('../shared/scan-groups.js');
    globalThis.A11Y_SCAN_URL_GROUPS = require('../shared/scan-url-groups.js');
    globalThis.A11Y_SCAN_GROUP_CHOICE = require('../shared/scan-group-choice.js');
    globalThis.A11Y_SCAN_FOLD = require('../shared/scan-fold.js');
    globalThis.A11Y_SCAN_GROUP_MERGE = require('../shared/scan-group-merge.js');
    globalThis.A11Y_SCAN_REVIEW_VIEW = require('../shared/scan-review-view.js');
    ({createRunSummaryUi} = await import('./run-summary-ui.js'));
    ({createScanReviewUi} = await import('./scan-review-ui.js'));
});

const P = 'url:shop.example.com/products/{*}';
const fail = (ruleId, url, target) => ({
    uid: `surea11y|surea11y:fail:${ruleId}`, ruleId, id: ruleId, title: `${ruleId} title`, outcome: 'fail', severity: 'serious',
    occurrences: [{pageUrl: url, target: [target], html: `<i class="${target}"></i>`, failureSummary: 'x', occurrenceOutcome: 'fail'}],
});
const SHOP = ['/', '/products/a', '/products/b', '/products/c', '/about'];

// The app as these parts see it, over one report; its redraw writes the
// summary again and draws the review again, as a11y-ui.js does.
function setup(paths = SHOP, extra = {}) {
    document.querySelectorAll('dialog').forEach((d) => d.remove());
    const old = document.getElementById('summary');
    const summaryEl = old.cloneNode(false);
    old.replaceWith(summaryEl);
    const payload = {
        scans: paths.map((p, i) => {
            const url = `https://shop.example.com${p}`;
            return {id: `s${i}`, label: `Scan ${i + 1}`, url,
                canonical: {findings: [fail('button-name', url, 'cart'), ...(p === '/products/b' ? [fail('image-alt', url, 'photo')] : [])],
                    bestPractices: [], notices: [], margins: []}};
        }),
        ...extra,
    };
    const statuses = [];
    const redraws = [];
    const app = {
        summaryEl,
        resultsState: {activeMode: 'report'},
        getActiveBucket: () => ({payload}),
        setStatusReport: (m) => statuses.push(m),
        setStatusRun: (m) => statuses.push(m),
        buildScanTagChipsHtml: () => '',
        buildSummaryControlsHtml: () => '',
        isScanIncludedInReport: (scan) => scan.includedInReport !== false,
        scanMatchesActiveFilters: () => true,
        redrawAsShown(p) {
            redraws.push(p);
            write();
            app.scanReview.refresh();
        },
    };
    app.runSummaryUi = createRunSummaryUi(app);
    const write = () => app.runSummaryUi.writeSummaryHtml({
        data: payload, totals: {totalViolations: 0, totalNodes: 0}, scansCount: payload.scans.length,
        scansListHtml: app.runSummaryUi.buildScansListHtml(payload.scans),
    });
    app.scanReview = createScanReviewUi(app);
    write();
    const dlg = () => document.querySelector('dialog.sr-dialog:not(.sr-preview):not(.sr-ask)');
    const $ = (sel) => dlg().querySelector(sel);
    return {app, payload, summaryEl, statuses, redraws, dlg, $, write};
}
const change = (el, value) => {
    if (value !== undefined) { if (el.type === 'checkbox') el.checked = value; else el.value = value; }
    el.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
};
const focusKey = () => document.activeElement && document.activeElement.getAttribute('data-sr-focus');

describe('the card at the top of the summary', () => {
    test('says how much repeats, and opens the review on the first template, focus on it', () => {
        const {summaryEl, dlg} = setup();
        assert.equal(summaryEl.querySelector('#sr-card-h').textContent, '3 of 5 scans are pages of 1 template');
        summaryEl.querySelector('[data-sr-open]').click();
        assert.ok(dlg().hasAttribute('open'));
        assert.equal(focusKey(), `node:${P}`);
        assert.equal(dlg().querySelector('.sr-grid h3').textContent, '/products/{slug}');
    });

    test('is left out when nothing repeats', () => {
        const {summaryEl} = setup(['/', '/about']);
        assert.equal(summaryEl.querySelector('.sr-card'), null);
    });
});

describe('merging from the review', () => {
    test('ticking shows what it changes first, ticked; applying saves, redraws, keeps focus on the switch', () => {
        const {app, payload, $, statuses, redraws} = setup();
        app.scanReview.open();
        change($('[data-sr-merge]'), true);
        assert.equal($('[data-sr-merge]').checked, true);
        assert.deepEqual([...dlg2($).querySelectorAll('.sr-impact-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
            ['Scans in the report 5 → 3', 'Failures listed 6 → 4']);
        assert.equal(focusKey(), 'apply-merge');
        assert.equal(redraws.length, 0);
        $('[data-sr-apply-merge]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: null, merge: true}]);
        assert.equal(redraws.length, 1);
        assert.equal(statuses.at(-1), '/products/{slug}: its 3 scans shown as one merged scan.');
        assert.equal(focusKey(), 'merge');
        assert.equal($('[data-sr-merge]').checked, true);
    });

    test('Cancel puts the switch back and changes nothing', () => {
        const {app, payload, $} = setup();
        app.scanReview.open();
        change($('[data-sr-merge]'), true);
        $('[data-sr-cancel-merge]').click();
        assert.equal($('[data-sr-merge]').checked, false);
        assert.equal('scanGrouping' in payload, false);
    });
});
// The dialog of a query function, for reading several elements.
const dlg2 = ($) => $('.sr-body').closest('dialog');

describe('acting on pages', () => {
    test('those that differ come first; selected ones are taken out, and undo brings them back', () => {
        const {app, payload, $, statuses} = setup();
        app.scanReview.open();
        assert.deepEqual([...dlg2($).querySelectorAll('.sr-tile-name')].map((e) => e.textContent), ['Scan 3', 'Scan 2', 'Scan 4']);
        change($('[data-sr-pick="s1"]'), true);
        change($('[data-sr-pick="s3"]'), true);
        assert.equal($('.sr-selbar strong').textContent, '2 scans selected');
        $('[data-sr-bulk="out"]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: null, remove: ['s1', 's3']}]);
        assert.equal(statuses.at(-1), 'Took 2 scans out of /products/{slug}.');
        assert.deepEqual([...dlg2($).querySelectorAll('[data-sr-putback]')].map((b) => b.getAttribute('data-sr-putback')), ['s1', 's3']);
        $('[data-sr-undo]').click();
        assert.equal('scanGrouping' in payload, false);
        assert.equal(statuses.at(-1), 'Undone: Took 2 scans out of /products/{slug}.');
    });

    test('Keep one keeps the first included, and says so', () => {
        const {app, payload, $, statuses} = setup();
        app.scanReview.open();
        $('[data-sr-act="keepOne"]').click();
        assert.deepEqual(payload.scans.map((s) => s.includedInReport !== false), [true, true, false, false, true]);
        assert.equal(statuses.at(-1), 'Kept Scan 2 of /products/{slug}; excluded 2 other scans.');
    });

    test('naming a group saves it with the name, no choosing step', () => {
        const {app, payload, $} = setup();
        app.scanReview.open();
        change($('[data-sr-name]'), 'Product pages');
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: 'Product pages'}]);
        assert.equal(dlg2($).querySelector('.sr-node[aria-current="true"] .sr-node-label').textContent, 'Product pages /products/{slug}');
    });

    test('added to another group by hand from a selection', () => {
        const {app, payload, $} = setup();
        app.scanReview.open('rest');
        change($('[data-sr-pick="s0"]'), true);
        $('[data-sr-add-target]').value = P;
        $('[data-sr-bulk="add"]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: null, add: ['s0']}]);
    });
});

describe('the rest', () => {
    test('excluded after a confirmation listing them', () => {
        const {app, payload, $} = setup();
        app.scanReview.open('rest');
        $('[data-sr-rest="exclude"]').click();
        const ask = document.querySelector('dialog.sr-ask');
        assert.ok(ask.hasAttribute('open'));
        assert.equal(ask.querySelector('#sr-ask-title').textContent, 'Exclude 2 scans from the report?');
        assert.equal(ask.querySelectorAll('.sr-asklist li').length, 2);
        ask.querySelector('[data-sr-ask-ok]').click();
        assert.deepEqual(payload.scans.map((s) => s.includedInReport !== false), [false, true, true, true, false]);
    });

    test('grouped by hand with a name, merged, opened on the new group', () => {
        const {app, payload, $} = setup();
        app.scanReview.open('rest');
        $('[data-sr-rest="byhand"]').click();
        const ask = document.querySelector('dialog.sr-ask');
        ask.querySelector('#sr-hand-name').value = 'Info pages';
        ask.querySelector('[data-sr-ask-ok]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: 'manual:1', name: 'Info pages', members: ['s0', 's4'], merge: true}]);
        assert.equal(dlg2($).querySelector('.sr-node[aria-current="true"]').getAttribute('data-sr-node'), 'manual:1');
    });
});

describe('showing one group alone', () => {
    test('a view: the report shows only its scans, says so, and shows every scan again', () => {
        const {app, payload, $, summaryEl} = setup();
        app.scanReview.open();
        $('[data-sr-act="focus"]').click();
        assert.equal(app.runSummaryUi.groupFocus(payload), P);
        assert.equal(app.runSummaryUi.inGroupFocus(payload, payload.scans[1]), true);
        assert.equal(app.runSummaryUi.inGroupFocus(payload, payload.scans[0]), false);
        assert.match(summaryEl.querySelector('.sr-focusbar').textContent, /The report shows only \/products\/\{slug\}/);
        // Nothing is excluded.
        assert.ok(payload.scans.every((s) => s.includedInReport !== false));
        summaryEl.querySelector('[data-sr-unfocus]').click();
        assert.equal(app.runSummaryUi.groupFocus(payload), null);
    });

    test('a merged scan is in it when its scans are', () => {
        const {app, payload} = setup(SHOP, {scanGrouping: {patterns: [{key: P, merge: true}]}});
        app.runSummaryUi.setGroupFocus(payload, P);
        const merged = app.runSummaryUi.shownScans(payload).scans.find((s) => s.mergedGroup);
        assert.equal(app.runSummaryUi.inGroupFocus(payload, merged), true);
    });
});

describe('what the run merged', () => {
    test('unmerged from its switch, and merged again', () => {
        const ctxScan = {url: 'https://shop.example.com/', canonical: {findings: [], bestPractices: [], notices: [], margins: []}};
        const {app, payload, $} = setup(SHOP);
        payload.scans[0] = {...payload.scans[0], mergedScan: true, contexts: [{name: 'Light', scan: ctxScan}, {name: 'Dark', scan: ctxScan}]};
        app.scanReview.open('run:s0');
        change($('[data-sr-run-merge="s0"]'), false);
        assert.deepEqual(payload.scanGrouping.patterns, [{key: 'run:s0', merge: false}]);
        assert.equal(focusKey(), 'run-merge:s0');
        change($('[data-sr-run-merge="s0"]'), true);
        assert.equal('scanGrouping' in payload, false);
    });
});

describe('in the report', () => {
    test('each scan in a group says which, the narrowest; a merged scan and the rest do not', () => {
        const {app, payload} = setup(['/', '/blog/a/1', '/blog/a/2', '/blog/b/3', '/blog/b/4', '/about'],
            {scanGrouping: {patterns: [{key: 'url:shop.example.com/blog/a/{*}', name: 'Posts of a'}]}});
        const view = app.runSummaryUi.viewPayload(payload);
        assert.deepEqual(view.scans.map((s) => s.reviewGroup && [s.reviewGroup.name, s.reviewGroup.index, s.reviewGroup.total]), [
            undefined, ['Posts of a', 1, 2], ['Posts of a', 2, 2], ['/blog/b/{id}', 1, 2], ['/blog/b/{id}', 2, 2], undefined,
        ]);
        // Copies: the report's own scans are not changed.
        assert.equal('reviewGroup' in payload.scans[1], false);
    });

    test('a group by hand is said before a pattern', () => {
        const {app, payload} = setup(SHOP, {scanGrouping: {patterns: [{key: 'manual:1', name: 'Picks', members: ['s1', 's4']}]}});
        const s1 = app.runSummaryUi.viewPayload(payload).scans.find((s) => s.id === 's1');
        assert.deepEqual([s1.reviewGroup.key, s1.reviewGroup.index, s1.reviewGroup.total], ['manual:1', 1, 2]);
    });
});
