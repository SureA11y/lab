'use strict';

// The review's model and views (scan-review-view.js): grouped by the real URL
// source and groups by hand, merged by the real fold, read as a person and a
// screen reader would.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const G = require('./scan-groups.js');
const U = require('./scan-url-groups.js');
const C = require('./scan-group-choice.js');
const F = require('./scan-fold.js');
const M = require('./scan-group-merge.js');
const V = require('./scan-review-view.js');

const SHOP = 'https://shop.example.com';
const P = 'url:shop.example.com/products/{*}';

function occ(path, target) {
    return { pageUrl: `${SHOP}${path}`, target: [target], html: `<i class="${target}"></i>`, failureSummary: 'x', occurrenceOutcome: 'fail' };
}
function fail(ruleId, path, target) {
    return { uid: `surea11y|surea11y:fail:${ruleId}`, ruleId, id: ruleId, title: `${ruleId} title`, outcome: 'fail', severity: 'serious', occurrences: [occ(path, target)] };
}
// Products failing the cart button; b also its photo; gift built otherwise.
function scans() {
    const page = (i, path, extra = {}) => ({
        id: `s${i}`, label: extra.label || `Scan ${i}`, url: `${SHOP}${path}`,
        canonical: { findings: [fail('button-name', path, 'cart'), ...(extra.own || [])], bestPractices: [], notices: [], margins: [] },
        metrics: { domMetrics: { totalElements: extra.elements || 100 } },
        ...(extra.excluded ? { includedInReport: false } : {}),
        ...(extra.more || {}),
    });
    return [
        page(0, '/', { label: 'Home' }),
        page(1, '/products/a', { label: 'A' }),
        page(2, '/products/b', { label: 'B', own: [fail('image-alt', '/products/b', 'photo')] }),
        page(3, '/products/c', { label: 'C', excluded: true }),
        page(4, '/products/gift', { label: 'Gift', elements: 400 }),
        page(5, '/about', { label: 'About' }),
    ];
}
function modelOf(list, patterns = []) {
    const choice = C.readChoice({ scanGrouping: { patterns } });
    const result = G.findGroups(list, { sources: [U.createUrlGroupSource(), C.createManualGroupSource(choice)] });
    const shown = M.scansAsShown(list, result, choice, { fold: F });
    return V.reviewModel({ scans: list, result, choice, shown, membersOf: C.membersOf });
}
const dom = (h) => new JSDOM(`<!doctype html><body>${h}</body>`).window.document;
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

describe('the model', () => {
    test('every pattern is a group, with no step to choose it; the rest is what no group holds', () => {
        const m = modelOf(scans());
        assert.deepEqual(m.patterns.map((n) => [n.key, n.name, n.ids.length, n.included]), [[P, '/products/{slug}', 4, 3]]);
        assert.deepEqual(m.rest, ['s0', 's5']);
        assert.deepEqual(m.totals, { scans: 6, included: 5, inReport: 5, failures: 6, merged: 0, runMerged: 0, excluded: 1, repeat: 4, templates: 1 });
    });

    test('a group named, merged, with scans taken out; groups by hand; the totals as shown', () => {
        const m = modelOf(scans(), [
            { key: P, name: 'Products', merge: true, remove: ['s4'] },
            { key: 'manual:1', name: 'Info', members: ['s0', 's5'] },
        ]);
        const products = V.nodeOf(m, P);
        assert.equal(products.name, 'Products');
        assert.deepEqual(products.ids, ['s1', 's2', 's3']);
        assert.deepEqual(products.taken, ['s4']);
        assert.equal(products.merged, true);
        assert.deepEqual(m.byHand.map((n) => [n.key, n.name, n.ids]), [['manual:1', 'Info', ['s0', 's5']]]);
        assert.deepEqual(m.rest, ['s4']);
        // Home, Info by hand is not merged; Products merged from A and B; Gift; About.
        assert.equal(m.totals.inReport, 4);
        assert.equal(m.totals.merged, 1);
    });

    test('nodes for the rest and for a run\'s merged scan', () => {
        const list = scans();
        list[0] = { ...list[0], mergedScan: true, contexts: [{ name: 'Light', scan: {} }, { name: 'Dark', scan: {} }] };
        const m = modelOf(list, [{ key: 'run:s0', remove: ['1'] }]);
        assert.deepEqual(V.nodeOf(m, 'rest').ids, ['s0', 's5']);
        const run = V.nodeOf(m, 'run:s0');
        assert.deepEqual([run.name, run.kept, run.unmerged, run.contexts.map((c) => c.out)], ['Home', true, false, [false, true]]);
        assert.equal(V.nodeOf(m, 'url:nothing'), null);
    });
});

describe('the summary card', () => {
    test('says how much of the run repeats a template, with a labelled bar, and opens the review', () => {
        const doc = dom(V.summaryCardHTML(modelOf(scans()), { thumbOf: (s) => (s.id === 's1' ? 'a.png' : null) }));
        assert.equal(text(doc.querySelector('#sr-card-h')), '4 of 6 pages share a layout, in 1 template.');
        // What merging it would do, from the report as it is (C excluded).
        assert.match(text(doc.querySelector('.sr-card-sub')), /^Merging \/products\/\{slug\} can shorten the report from 5 scans to 3\./);
        assert.equal(doc.querySelector('.sr-bar').getAttribute('aria-label'), '/products/{slug}: 4, in no template: 2');
        assert.equal(doc.querySelector('button[data-sr-open]').textContent, 'Review scans');
        // The pictures are decoration: the text says it all.
        assert.equal(doc.querySelector('.sr-stack').getAttribute('aria-hidden'), 'true');
        assert.equal(doc.querySelector('.sr-stack img').getAttribute('src'), 'a.png');
    });

    test('empty when nothing repeats and nothing is to review', () => {
        const list = scans().filter((s) => !s.url.includes('/products/'));
        assert.equal(V.summaryCardHTML(modelOf(list)), '');
    });
});

describe('the workspace', () => {
    test('the tree: templates, the rest, current one marked; a merged group says so', () => {
        const doc = dom(V.treeHTML(modelOf(scans(), [{ key: P, merge: true }]), P));
        const nodes = [...doc.querySelectorAll('.sr-node')].map((b) => [b.getAttribute('data-sr-node'), b.getAttribute('aria-current'), text(b)]);
        assert.deepEqual(nodes, [
            [P, 'true', '/products/{slug} merged 4'],
            ['rest', 'false', 'In no group 2'],
        ]);
    });

    test('the grid: those that differ first, outlined and said, each picture opening it large', () => {
        const m = modelOf(scans());
        const node = V.nodeOf(m, P);
        const issues = M.groupIssues(node.ids.map((id) => m.byId.get(id)), { fold: F });
        const doc = dom(V.gridHTML(m, node, { issues, thumbOf: () => null }));
        const tiles = [...doc.querySelectorAll('.sr-tile')];
        assert.deepEqual(tiles.map((t) => text(t.querySelector('.sr-tile-name'))), ['Gift', 'B', 'A', 'C']);
        // One short line each; a badge, no outline as well.
        assert.deepEqual(tiles.map((t) => text(t.querySelector('.sr-badges'))), ['Differs · built otherwise', 'Differs · 1 own failure', '', 'excluded']);
        assert.equal(doc.querySelector('.sr-tile--differs'), null);
        assert.match(text(doc.querySelector('.sr-note')), /^4 scans; 2 differ from the others, first\./);
        assert.equal(tiles[0].querySelector('button.sr-thumb').getAttribute('aria-label'), 'See Gift large');
        // Each checkbox is labelled by its scan's name.
        const box = tiles[1].querySelector('input[type=checkbox]');
        assert.equal(text(doc.querySelector(`label[for="${box.id}"]`)), 'B');
        // No screenshot: the address stands in for it.
        assert.equal(text(tiles[2].querySelector('.sr-noshot-path')), '/products/a');
    });

    test('the grid in report order; a selection gets its actions', () => {
        const m = modelOf(scans());
        const node = V.nodeOf(m, P);
        const doc = dom(V.gridHTML(m, node, { sort: 'report', selected: new Set(['s2', 's3']) }));
        assert.deepEqual([...doc.querySelectorAll('.sr-tile-name')].map(text), ['A', 'B', 'C', 'Gift']);
        assert.equal(text(doc.querySelector('.sr-selbar strong')), '2 selected');
        // B is included and C excluded: both apply. The rarer ones under More, closed.
        assert.deepEqual([...doc.querySelectorAll('[data-sr-bulk]')].map((b) => b.getAttribute('data-sr-bulk')), ['exclude', 'include', 'out', 'byhand', 'clear']);
        const more = doc.querySelector('[data-sr-more]');
        assert.equal(more.getAttribute('aria-expanded'), 'false');
        assert.equal(doc.getElementById(more.getAttribute('aria-controls')).hidden, true);
    });

    test('a selection gets only the actions that apply; More holds Add to group when there is another group', () => {
        const m = modelOf(scans());
        const doc = dom(V.gridHTML(m, V.nodeOf(m, P), { selected: new Set(['s1', 's2']), moreOpen: true, targets: [{ key: 'manual:1', name: 'Info' }] }));
        assert.deepEqual([...doc.querySelectorAll('[data-sr-bulk]')].map((b) => b.getAttribute('data-sr-bulk')), ['exclude', 'out', 'byhand', 'add', 'clear']);
        assert.equal(doc.querySelector('[data-sr-more]').getAttribute('aria-expanded'), 'true');
        assert.equal(doc.querySelector('#sr-more-menu').hidden, false);
        assert.equal(text(doc.querySelector('[data-sr-bulk="add"]')), 'Add to group…');
    });

    test('merged: the grid says so, and each page in the merged scan is marked', () => {
        const m = modelOf(scans(), [{ key: P, merge: true }]);
        const doc = dom(V.gridHTML(m, V.nodeOf(m, P), { sort: 'report' }));
        assert.match(text(doc.querySelector('.sr-note')), /^4 scans, shown as 1 merged scan in the report;/);
        assert.deepEqual([...doc.querySelectorAll('.sr-tile')].map((t) => !!t.querySelector('.sr-badge--merged')), [true, true, false, true]);
    });

    test('scans taken out are listed apart, to put back', () => {
        const m = modelOf(scans(), [{ key: P, merge: true, remove: ['s4'] }]);
        const doc = dom(V.gridHTML(m, V.nodeOf(m, P), {}));
        assert.equal(text(doc.querySelector('h4.sr-sub')), 'Taken out of the group, shown on their own');
        assert.equal(doc.querySelector('[data-sr-putback]').getAttribute('data-sr-putback'), 's4');
    });

    test('the detail: its failures, merging with what it changes, its actions', () => {
        const m = modelOf(scans());
        const node = V.nodeOf(m, P);
        const issues = M.groupIssues(node.ids.map((id) => m.byId.get(id)), { fold: F });
        const closed = dom(V.detailHTML(m, node, { issues }));
        // Not merged: said in words, and a button that says what it covers;
        // what it changes is not shown yet.
        assert.match(text(closed.querySelector('.sr-merge-state')), /^Not merged · Each page is a scan of its own/);
        assert.equal(text(closed.querySelector('[data-sr-merge]')), 'Merge its 3 included pages…');
        assert.equal(closed.querySelector('[data-sr-merge]').getAttribute('aria-expanded'), 'false');
        assert.equal(closed.querySelector('.sr-impact'), null);
        const doc = dom(V.detailHTML(m, node, { issues, impact: { scans: [5, 2], failures: [6, 3] }, impactOpen: true }));
        assert.equal(text(doc.querySelector('label[for="sr-name"]')), 'Name');
        // Opened: what it changes, to apply or cancel.
        assert.equal(doc.querySelector('[data-sr-merge]').getAttribute('aria-expanded'), 'true');
        assert.equal(doc.querySelector('[data-sr-merge]').getAttribute('aria-controls'), 'sr-impact');
        assert.equal(text(doc.querySelector('[data-sr-apply-merge]')), 'Merge 3 pages');
        assert.deepEqual([...doc.querySelectorAll('.sr-impact-row')].map(text), ['Scans in the report 5 → 2', 'Failures listed 6 → 3']);
        assert.match(text(doc.querySelector('.sr-impact')), /what 1 page fails on its own stays on it/);
        assert.deepEqual([...doc.querySelectorAll('.sr-fails li')].map(text), [
            'button-name title serious 4 of 4 · fix once',
            'image-alt title serious 1 of 4',
        ]);
        // The group's actions right under merging, before its failures.
        assert.deepEqual([...doc.querySelectorAll('[data-sr-act]')].map((b) => text(b)), ['Keep one page, exclude the rest…', 'Exclude all', 'Include all', 'Show only these']);
        const order = [...doc.querySelectorAll('.sr-merge, [data-sr-act], .sr-fails')].map((el) => (el.matches('.sr-merge') ? 'merge' : el.matches('.sr-fails') ? 'fails' : 'act'));
        assert.deepEqual([...new Set(order)], ['merge', 'act', 'fails']);
        const keys = [...doc.querySelectorAll('[data-sr-focus]')].map((el) => el.getAttribute('data-sr-focus'));
        assert.equal(new Set(keys).size, keys.length);
    });

    test('merged: it says how it is shown, and Unmerge…', () => {
        const m = modelOf(scans(), [{ key: P, merge: true }]);
        const doc = dom(V.detailHTML(m, V.nodeOf(m, P), {}));
        assert.equal(text(doc.querySelector('.sr-merge-state')), 'Merged · Shown as 1 scan in the report · 3 pages, 1 excluded left out');
        assert.equal(text(doc.querySelector('[data-sr-merge]')), 'Unmerge…');
    });

    test('a run\'s merged scan: Merged by the run, and Unmerge… with what it changes', () => {
        const list = scans();
        list[0] = { ...list[0], mergedScan: true, contexts: [{ name: 'Light', scan: {} }, { name: 'Dark', scan: {} }] };
        const m = modelOf(list);
        const run = V.nodeOf(m, 'run:s0');
        const doc = dom(V.detailHTML(m, run, { impact: { scans: [5, 6], failures: [6, 6] }, impactOpen: true }));
        assert.equal(text(doc.querySelector('.sr-merge-state')), 'Merged by the run · Shown as 1 scan in the report · 2 contexts');
        assert.equal(doc.querySelector('[data-sr-merge]').getAttribute('data-sr-merge'), 'run:s0');
        assert.equal(text(doc.querySelector('[data-sr-merge]')), 'Unmerge…');
        assert.equal(text(doc.querySelector('[data-sr-apply-merge]')), 'Unmerge into 2 scans');
        assert.equal(m.totals.runMerged, 1);
        // The header counts it, said apart.
        assert.match(text(dom(V.statsHTML(m)).body), /Merged 1 scan \(by the run\)/);
    });

    test('the header: each count with its unit', () => {
        const doc = dom(V.statsHTML(modelOf(scans(), [{ key: P, merge: true }])));
        assert.deepEqual([...doc.querySelectorAll('.sr-stat')].map(text), ['In the report 3 scans', 'Failures listed 4', 'Merged 1 scan', 'Excluded 1 scan']);
    });

    test('the rest: show only, group by hand, exclude; never merge', () => {
        const m = modelOf(scans());
        const doc = dom(V.detailHTML(m, V.nodeOf(m, 'rest'), {}));
        assert.deepEqual([...doc.querySelectorAll('[data-sr-rest]')].map((b) => b.getAttribute('data-sr-rest')), ['focus', 'byhand', 'exclude']);
        assert.equal(doc.querySelector('[data-sr-merge]'), null);
    });

    test('names, labels and addresses are escaped', () => {
        const list = scans();
        list[1] = { ...list[1], label: '<b>A</b>' };
        const m = modelOf(list, [{ key: P, name: '<script>' }]);
        const html = V.gridHTML(m, V.nodeOf(m, P), {}) + V.detailHTML(m, V.nodeOf(m, P), {}) + V.treeHTML(m, P);
        assert.doesNotMatch(html, /<b>A<\/b>|<script>/);
    });
});

describe('the preview', () => {
    test('what it shares with the template, what only it has, and what it lacks', () => {
        const m = modelOf(scans());
        const node = V.nodeOf(m, P);
        const issues = M.groupIssues(node.ids.map((id) => m.byId.get(id)), { fold: F });
        const b = dom(V.previewHTML(m.byId.get('s2'), 'b.png', issues.byScan.get('s2'), { issues }));
        assert.equal(b.querySelector('img').getAttribute('alt'), 'Screenshot of B');
        assert.deepEqual([...b.querySelectorAll('h4')].map(text), ['Shares with the template', 'Only on this page']);
        assert.match(text(b.querySelectorAll('.sr-fails')[0]), /button-name title/);
        assert.match(text(b.querySelectorAll('.sr-fails')[1]), /image-alt title/);
    });

    test('a page without the template\'s failure says it lacks it', () => {
        const list = scans();
        // A lacks the cart button's failure the others have.
        list[1] = { ...list[1], canonical: { ...list[1].canonical, findings: [fail('image-alt', '/products/a', 'photo')] } };
        const m = modelOf(list);
        const node = V.nodeOf(m, P);
        const issues = M.groupIssues(node.ids.map((id) => m.byId.get(id)), { fold: F });
        const a = dom(V.previewHTML(m.byId.get('s1'), null, issues.byScan.get('s1'), { issues }));
        const sections = [...a.querySelectorAll('h4')].map(text);
        assert.ok(sections.includes('The template\'s failures it lacks'), sections.join(', '));
        assert.match(text(a.querySelectorAll('.sr-fails')[sections.indexOf('The template\'s failures it lacks')]), /button-name title/);
    });
});

describe('names from the pages\' titles', () => {
    test('the section most titles end with, without the site\'s name', () => {
        const site = { end: ['Example Bank'], words: new Set() };
        assert.equal(V.suggestName(['Post 1 - Blog - Example Bank', 'Post 2 - Blog - Example Bank', 'Other - Blog - Example Bank'], site), 'Blog pages');
    });

    test('else a word most titles have, but not one every title of the run has', () => {
        const titles = ['Red shirt product - Shop', 'Blue product - Shop', 'Gift card product - Shop', 'Green product - Shop', 'Hat - Shop'];
        assert.equal(V.suggestName(titles, { end: ['Shop'], words: new Set() }), 'Product pages');
        assert.equal(V.suggestName(titles, { end: ['Shop'], words: new Set(['product']) }), null);
        assert.equal(V.suggestName(['Only one'], {}), null);
    });

    test('the group is named by it, its pattern a second line; the person\'s name wins', () => {
        const list = scans().map((s) => ({ ...s, label: `${s.label}${s.url.includes('/products/') ? ' product' : ''} - Shop` }));
        let m = modelOf(list);
        let node = V.nodeOf(m, P);
        assert.deepEqual([node.name, node.suggested, node.pattern], ['Product pages', 'Product pages', '/products/{slug}']);
        const tree = dom(V.treeHTML(m, P));
        assert.equal(text(tree.querySelector('.sr-node-pattern')), '/products/{slug}');
        const detail = dom(V.detailHTML(m, node, {}));
        assert.equal(detail.querySelector('#sr-name').getAttribute('placeholder'), 'Product pages');
        assert.equal(detail.querySelector('#sr-name').getAttribute('aria-describedby'), 'sr-name-hint');
        m = modelOf(list, [{ key: P, name: 'Catalogue' }]);
        node = V.nodeOf(m, P);
        assert.equal(node.name, 'Catalogue');
    });

    test('a pattern inside another named alike says what sets it apart', () => {
        const page = (id, path) => ({ id, label: `${id} product - Shop`, url: `${SHOP}${path}` });
        const list = [page('a', '/p/x/1'), page('b', '/p/x/2'), page('c', '/p/y/3'), page('d', '/p/y/4'), { id: 'h', label: 'Home - Shop', url: `${SHOP}/` }];
        const result = G.findGroups(list, { sources: [U.createUrlGroupSource()] });
        const names = [...V.suggestNames(list, result.groups).values()];
        assert.ok(names.includes('Product pages · x'), names.join(', '));
    });
});
