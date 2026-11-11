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
    document.getElementById('results')?.remove();
    const results = document.createElement('div');
    results.id = 'results';
    document.body.append(results);
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
        results,
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
    return {app, payload, summaryEl, results, statuses, redraws, dlg, $, write};
}
const change = (el, value) => {
    if (value !== undefined) { if (el.type === 'checkbox') el.checked = value; else el.value = value; }
    el.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
};
const focusKey = () => document.activeElement && document.activeElement.getAttribute('data-sr-focus');

describe('the card at the top of the summary', () => {
    test('says how much repeats, and opens the review on the first template, focus on it', () => {
        const {summaryEl, dlg} = setup();
        assert.equal(summaryEl.querySelector('#sr-card-h').textContent, '3 of 5 pages share a layout, in 1 template.');
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

const flat = (el) => el.textContent.replace(/\s+/g, ' ').trim();

describe('merging from the review', () => {
    test('the button shows what it changes first; applying saves, clears the selection, says how it is shown', () => {
        const {app, payload, $, statuses, redraws} = setup();
        app.scanReview.open();
        change($('[data-sr-pick="s1"]'), true);
        assert.equal(flat($('.sr-merge-state')), 'Not merged · Each page is a scan of its own in the report');
        assert.equal(flat($('[data-sr-merge]')), 'Merge all 3 pages…');
        $('[data-sr-merge]').click();
        assert.equal($('[data-sr-merge]').getAttribute('aria-expanded'), 'true');
        assert.deepEqual([...dlg2($).querySelectorAll('.sr-impact-row')].map(flat), ['Scans in the report 5 → 3', 'Failures listed 6 → 4']);
        assert.equal(focusKey(), 'apply-merge');
        assert.equal(redraws.length, 0);
        $('[data-sr-apply-merge]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: null, merge: true}]);
        assert.equal(redraws.length, 1);
        assert.equal(statuses.at(-1), '/products/{slug}: its 3 pages shown as one merged scan.');
        assert.equal(focusKey(), 'merge');
        // What the report shows of it now, in the panel, the grid and each page.
        assert.equal(flat($('.sr-merge-state')), 'Merged · Shown as 1 scan in the report · 3 pages');
        assert.equal(flat($('[data-sr-merge]')), 'Unmerge…');
        assert.equal($('.sr-selbar'), null);
        assert.match(flat($('.sr-grid .sr-note')), /shown as 1 merged scan in the report/);
        assert.equal(dlg2($).querySelectorAll('.sr-tile .sr-badge--merged').length, 3);
        // The header counts it.
        assert.match(flat($('.sr-stats')), /Merged 1 scan/);
    });

    test('Cancel closes what it changes, changes nothing, and focus goes back to the button', () => {
        const {app, payload, $} = setup();
        app.scanReview.open();
        $('[data-sr-merge]').click();
        $('[data-sr-cancel-merge]').click();
        assert.equal($('.sr-impact'), null);
        assert.equal($('[data-sr-merge]').getAttribute('aria-expanded'), 'false');
        assert.equal(focusKey(), 'merge');
        assert.equal('scanGrouping' in payload, false);
    });

    test('a merged scan\'s Unmerge in the report opens the review on what unmerging changes', () => {
        const {app, payload, results, $} = setup(SHOP, {scanGrouping: {patterns: [{key: P, merge: true}]}});
        results.innerHTML = `<p class="scan-merged-actions"><button type="button" data-sr-unmerge="${P}">Unmerge…</button></p>`;
        results.querySelector('[data-sr-unmerge]').click();
        assert.ok($('.sr-body').closest('dialog').hasAttribute('open'));
        assert.equal(dlg2($).querySelector('.sr-node[aria-current="true"]').getAttribute('data-sr-node'), P);
        assert.equal(flat($('[data-sr-apply-merge]')), 'Unmerge');
        assert.equal(focusKey(), 'apply-merge');
        $('[data-sr-apply-merge]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: null}]);
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
        assert.equal($('.sr-selbar strong').textContent, '2 selected');
        $('[data-sr-bulk="out"]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: null, remove: ['s1', 's3']}]);
        assert.equal(statuses.at(-1), 'Took 2 scans out of /products/{slug}.');
        assert.deepEqual([...dlg2($).querySelectorAll('[data-sr-putback]')].map((b) => b.getAttribute('data-sr-putback')), ['s1', 's3']);
        $('[data-sr-undo]').click();
        assert.equal('scanGrouping' in payload, false);
        assert.equal(statuses.at(-1), 'Undone: Took 2 scans out of /products/{slug}.');
    });

    test('Keep one asks first, listing what it excludes; then keeps the first included, and says so', () => {
        const {app, payload, $, statuses} = setup();
        app.scanReview.open();
        $('[data-sr-act="keepOne"]').click();
        const ask = document.querySelector('dialog.sr-ask');
        assert.ok(ask.hasAttribute('open'));
        assert.equal(ask.querySelector('#sr-ask-title').textContent, 'Keep one page of /products/{slug}?');
        assert.equal(ask.querySelectorAll('.sr-asklist li').length, 2);
        assert.ok(payload.scans.every((s) => s.includedInReport !== false));
        ask.querySelector('[data-sr-ask-ok]').click();
        assert.deepEqual(payload.scans.map((s) => s.includedInReport !== false), [true, true, false, false, true]);
        assert.equal(statuses.at(-1), 'Kept Scan 2 of /products/{slug}; excluded 2 other scans.');
    });

    test('the selection bar: More opens and closes, Escape closes it first, Clear selection empties it', () => {
        const {app, $} = setup();
        app.scanReview.open();
        // Clicked as a person does: the click, then the change it makes.
        $('[data-sr-pick="s1"]').click();
        assert.equal($('.sr-selbar strong').textContent, '1 selected');
        $('[data-sr-more]').click();
        assert.equal($('[data-sr-more]').getAttribute('aria-expanded'), 'true');
        assert.equal($('#sr-more-menu').hidden, false);
        assert.equal(focusKey(), 'bulk:byhand');
        document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
        assert.equal($('#sr-more-menu').hidden, true);
        assert.equal(focusKey(), 'more');
        assert.ok($('.sr-body').closest('dialog').hasAttribute('open'));
        $('[data-sr-bulk="clear"]').click();
        assert.equal($('.sr-selbar'), null);
        assert.equal(focusKey(), 'select-all');
    });

    test('naming a group saves it with the name, no choosing step', () => {
        const {app, payload, $} = setup();
        app.scanReview.open();
        change($('[data-sr-name]'), 'Product pages');
        assert.deepEqual(payload.scanGrouping.patterns, [{key: P, name: 'Product pages'}]);
        assert.equal(dlg2($).querySelector('.sr-node[aria-current="true"] .sr-node-label').textContent, 'Product pages /products/{slug}');
    });

    test('added to another group from a selection, chosen in a dialog', () => {
        const {app, payload, $} = setup();
        app.scanReview.open('rest');
        change($('[data-sr-pick="s0"]'), true);
        $('[data-sr-more]').click();
        $('[data-sr-bulk="add"]').click();
        const ask = document.querySelector('dialog.sr-ask');
        assert.ok(ask.hasAttribute('open'));
        const select = ask.querySelector('#sr-add-target');
        assert.equal(ask.querySelector('label[for="sr-add-target"]').textContent, 'Group');
        select.value = P;
        ask.querySelector('[data-sr-ask-ok]').click();
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
    test('Unmerge… shows what it changes; applied, it is unmerged, and merged again the same way', () => {
        const ctxScan = {url: 'https://shop.example.com/', canonical: {findings: [], bestPractices: [], notices: [], margins: []}};
        const {app, payload, $} = setup(SHOP);
        payload.scans[0] = {...payload.scans[0], mergedScan: true, contexts: [{name: 'Light', scan: ctxScan}, {name: 'Dark', scan: ctxScan}]};
        app.scanReview.open('run:s0');
        assert.equal(flat($('.sr-merge-state')), 'Merged by the run · Shown as 1 scan in the report · 2 contexts');
        $('[data-sr-merge="run:s0"]').click();
        assert.deepEqual([...dlg2($).querySelectorAll('.sr-impact-row')].map(flat)[0], 'Scans in the report 5 → 6');
        assert.equal('scanGrouping' in payload, false);
        $('[data-sr-apply-merge]').click();
        assert.deepEqual(payload.scanGrouping.patterns, [{key: 'run:s0', merge: false}]);
        assert.equal(focusKey(), 'merge');
        assert.equal(flat($('[data-sr-merge]')), 'Merge again…');
        $('[data-sr-merge]').click();
        $('[data-sr-apply-merge]').click();
        assert.equal('scanGrouping' in payload, false);
    });
});

describe('the contexts of a scan the run merged, unmerged', () => {
    // /products/a merged by the run from two contexts, each kept.
    function unmergedShop() {
        const env = setup(SHOP);
        const url = 'https://shop.example.com/products/a';
        const ctx = () => ({url, canonical: {findings: [fail('button-name', url, 'cart')], bestPractices: [], notices: [], margins: []}});
        env.payload.scans[1] = {...env.payload.scans[1], mergedScan: true, contexts: [{name: 'Light', scan: ctx()}, {name: 'Dark', scan: ctx()}]};
        env.payload.scanGrouping = {patterns: [{key: 'run:s1', merge: false}]};
        return env;
    }

    test('are scans of their own in their page\'s template, which merging holds them in', () => {
        const {app, payload} = unmergedShop();
        const model = app.runSummaryUi.reviewModelOf(payload);
        const node = model.patterns.find((n) => n.key === P);
        assert.deepEqual([...node.ids].sort(), ['s1~0', 's1~1', 's2', 's3']);
        assert.deepEqual(model.runMerges.map((r) => [r.key, r.unmerged]), [['run:s1', true]], 'still listed as merged by the run');
        // The template merged: its merged scan holds the contexts, which the
        // groups were found over the scans as saved left out.
        payload.scanGrouping.patterns.push({key: P, merge: true});
        const merged = app.runSummaryUi.shownScans(payload).scans.find((s) => s.mergedGroup);
        assert.deepEqual(merged.mergedGroup.members.map((m) => m.id).sort(), ['s1~0', 's1~1', 's2', 's3']);
    });

    test('a context is excluded on its own, in the choice, and Undo includes it again', () => {
        const {app, payload, $, summaryEl} = unmergedShop();
        app.scanReview.open(P);
        const box = $('[data-sr-pick="s1~1"]');
        box.checked = true;
        box.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
        $('[data-sr-bulk="exclude"]').click();
        assert.deepEqual(payload.scanGrouping.patterns.find((p) => p.key === 'run:s1').exclude, ['1']);
        const shown = app.runSummaryUi.shownScans(payload).scans;
        assert.equal(shown.find((s) => s.id === 's1~1').includedInReport, false);
        assert.equal(shown.find((s) => s.id === 's1~0').includedInReport !== false, true);
        $('[data-sr-undo]').click();
        assert.equal(payload.scanGrouping.patterns.find((p) => p.key === 'run:s1').exclude, undefined);
        void summaryEl;
    });

    test('merged again while a context is in a group by hand: asked first, then it leaves the group', () => {
        const {app, payload, $} = unmergedShop();
        payload.scanGrouping.patterns.push({key: 'manual:1', name: 'Light pages', members: ['s1~0', 's4']});
        app.scanReview.open('run:s1');
        $('[data-sr-merge="run:s1"]').click();
        $('[data-sr-apply-merge]').click();
        const ask = document.querySelector('dialog.sr-ask');
        assert.equal(ask.open, true, 'asked first');
        assert.match(flat(ask.querySelector('.sr-ask-body')), /Light pages: Scan 2 · Light/);
        assert.equal(payload.scanGrouping.patterns.find((p) => p.key === 'run:s1').merge, false, 'nothing changed yet');
        ask.querySelector('[data-sr-ask-ok]').click();
        // Nothing left changed: the choice is gone from the report.
        const left = (payload.scanGrouping && payload.scanGrouping.patterns) || [];
        assert.equal(left.some((p) => p.key === 'run:s1'), false, 'merged again as the run made it');
        assert.equal(left.some((p) => p.key === 'manual:1'), false, 'the group, left with one scan, goes');
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

describe('the tree of groups in the workspace', () => {
    test('a section folds and unfolds by its heading, focus staying on it', () => {
        const {summaryEl, $} = setup();
        summaryEl.querySelector('[data-sr-open]').click();
        const toggle = () => $('[data-sr-toggle="sec:rest"]');
        assert.equal(toggle().getAttribute('aria-expanded'), 'true');
        toggle().click();
        assert.equal(toggle().getAttribute('aria-expanded'), 'false');
        assert.equal($(`#${toggle().getAttribute('aria-controls')}`).hidden, true);
        assert.equal(focusKey(), 'toggle:sec:rest');
        toggle().click();
        assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    });
});
