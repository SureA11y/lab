'use strict';

// The scans as shown, with merged groups in place of their scans
// (scan-group-merge.js, docs/design/scan-grouping-design.md §9): grouped by
// the real URL source, folded by the real fold, scored by the real builders.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const G = require('./scan-groups.js');
const U = require('./scan-url-groups.js');
const F = require('./scan-fold.js');
const M = require('./scan-group-merge.js');
const S = require('./a11y-summary.js');
const COV = require('./coverage-summary.js');

const deps = { fold: F, buildA11ySummary: S.buildA11ySummary, buildCoverageAwareSummary: COV.buildCoverageAwareSummary };
const SHOP = 'https://shop.example.com';
const PRODUCTS = 'url:shop.example.com/products/{*}';

function occ(path, o = {}) {
    return {
        pageUrl: `${SHOP}${path}`,
        target: [o.target || '.add-to-cart'],
        html: o.html || '<button class="add-to-cart"></button>',
        failureSummary: o.summary || 'Button has no accessible name',
        occurrenceOutcome: 'fail',
    };
}
function finding(ruleId, occurrences, outcome = 'fail') {
    return { uid: `surea11y|surea11y:${outcome}:${ruleId}`, ruleId, id: ruleId, outcome, engineId: 'surea11y', severity: 'serious', occurrences, wcag: { sc: ['4.1.2'] } };
}
// A scan of `path`: the template's button failure, and its own extra failures.
function scan(i, path, extra = {}) {
    const own = (extra.own || []).map((r) => finding(r, [occ(path, { target: `.${r}`, html: `<i class="${r}"></i>` })]));
    return {
        id: `s${i}`,
        label: extra.label || `Scan ${i}`,
        url: `${SHOP}${path}`,
        profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' },
        wcag: { version: '2.2', level: 'AA' },
        scanTags: extra.tags || null,
        screenshots: [{ name: `shot-${i}` }],
        canonical: { findings: [finding('button-name', [occ(path)]), ...own], bestPractices: [], notices: [], margins: [] },
        metrics: {
            domMetrics: { totalElements: extra.elements || 100 },
            coverageSummary: { layer: 'auto', criteria: [{ sc: '4.1.2', level: 'A', automation: 'partial' }] },
        },
        ...(extra.excluded ? { includedInReport: false } : {}),
    };
}
function shop() {
    return [
        scan(0, '/', { label: 'Home' }),
        scan(1, '/products/red', { label: 'Red', own: ['image-alt'], elements: 120 }),
        scan(2, '/products/blue', { label: 'Blue', tags: ['sale'] }),
        scan(3, '/products/green', { label: 'Green', elements: 90 }),
        scan(4, '/about', { label: 'About' }),
    ];
}
function shown(scans, choice) {
    const result = G.findGroups(scans, { sources: [U.createUrlGroupSource()] });
    return M.scansAsShown(scans, result, choice, deps);
}

describe('scansAsShown', () => {
    test('nothing merged: the scans as they are, the same array', () => {
        const scans = shop();
        assert.equal(shown(scans, []).scans, scans);
        assert.equal(shown(scans, [{ key: PRODUCTS, name: null }]).scans, scans);
    });

    test('a merged group is one scan, at its first scan\'s place', () => {
        const { scans, merges } = shown(shop(), [{ key: PRODUCTS, name: 'Product pages', merge: true }]);
        assert.deepEqual(scans.map((s) => s.label), ['Home', 'Product pages', 'About']);
        const merged = scans[1];
        assert.equal(merged.id, M.mergedScanId(PRODUCTS));
        assert.match(merged.id, /^merged-[0-9a-f]{8}$/);
        assert.deepEqual(merges.get(merged.id), { id: merged.id, key: PRODUCTS, members: ['s1', 's2', 's3'] });
        assert.deepEqual(merged.mergedGroup.members.map((m) => m.label), ['Red', 'Blue', 'Green']);
        assert.equal(merged.mergedGroup.pattern, '/products/{slug}');
        assert.equal(merged.url, `${SHOP}/products/red`);
        assert.deepEqual(merged.scanTags, ['sale']);
        assert.deepEqual(merged.screenshots, [{ name: 'shot-1' }]);
    });

    test('the template\'s failure is one on every page; a page\'s own stays on its page', () => {
        const merged = shown(shop(), [{ key: PRODUCTS, merge: true }]).scans[1];
        const button = merged.canonical.findings.find((f) => f.ruleId === 'button-name').occurrences;
        assert.equal(button.length, 1);
        assert.deepEqual(button[0].scans, ['s1', 's2', 's3']);
        assert.deepEqual(button[0].pageUrls, [`${SHOP}/products/red`, `${SHOP}/products/blue`, `${SHOP}/products/green`]);
        assert.equal(button[0].pagesTotal, 3);
        const img = merged.canonical.findings.find((f) => f.ruleId === 'image-alt').occurrences;
        assert.deepEqual(img[0].pageUrls, [`${SHOP}/products/red`]);
        assert.deepEqual(merged.summary, { failCount: 2, reviewCount: 0, passesCount: 0, occurrenceCount: 2 });
    });

    test('scored on the member with the most elements, with coverage again', () => {
        const merged = shown(shop(), [{ key: PRODUCTS, merge: true }]).scans[1];
        assert.equal(merged.metrics.domMetrics.totalElements, 120);
        assert.ok(merged.metrics.a11ySummary && merged.metrics.a11ySummary.scores);
        assert.ok(Array.isArray(merged.metrics.coverageSummary.criteria));
    });

    test('only the included scans are folded; the members still list every scan', () => {
        const scans = shop();
        scans[1].includedInReport = false;
        const merged = shown(scans, [{ key: PRODUCTS, merge: true }]).scans[1];
        assert.equal(merged.includedInReport, true);
        assert.deepEqual(merged.canonical.findings.map((f) => f.ruleId), ['button-name']);
        assert.deepEqual(merged.mergedGroup.members.map((m) => m.includedInReport), [false, true, true]);
        assert.equal(merged.mergedGroup.pagesTotal, 2);
    });

    test('none included: one excluded scan, folded from all of them', () => {
        const scans = shop().map((s, i) => (i >= 1 && i <= 3 ? { ...s, includedInReport: false } : s));
        const merged = shown(scans, [{ key: PRODUCTS, merge: true }]).scans[1];
        assert.equal(merged.includedInReport, false);
        assert.ok(merged.canonical.findings.some((f) => f.ruleId === 'image-alt'));
    });

    test('a merged group inside a merged group is merged into it', () => {
        const blog = [
            scan(0, '/blog/a11y/alt'), scan(1, '/blog/a11y/contrast'),
            scan(2, '/blog/news/launch'), scan(3, '/blog/news/store'),
        ];
        const outer = 'url:shop.example.com/blog/{*}/{*}';
        const inner = 'url:shop.example.com/blog/a11y/{*}';
        const { scans, merges } = shown(blog, [{ key: inner, merge: true }, { key: outer, merge: true }]);
        assert.equal(scans.length, 1);
        assert.deepEqual([...merges.values()].map((m) => m.key), [outer]);
        // Unmerge the outer one: the inner one is merged again on its own.
        const again = shown(blog, [{ key: inner, merge: true }, { key: outer }]);
        assert.deepEqual(again.scans.map((s) => s.mergedGroup ? s.mergedGroup.key : s.id), [inner, 's2', 's3']);
    });

    test('a group that matches nothing, or one scan, is not merged', () => {
        assert.equal(shown(shop(), [{ key: 'url:gone', merge: true }]).scans.length, 5);
    });

    test('the members are not changed', () => {
        const scans = shop();
        const before = JSON.stringify(scans);
        shown(scans, [{ key: PRODUCTS, merge: true }]);
        assert.equal(JSON.stringify(scans), before);
    });

    test('the merged scan\'s id is stable, and differs by group', () => {
        assert.equal(M.mergedScanId(PRODUCTS), M.mergedScanId(PRODUCTS));
        assert.notEqual(M.mergedScanId(PRODUCTS), M.mergedScanId('url:shop.example.com/blog/…'));
    });
});

describe('groupIssues (step 6)', () => {
    const products = () => shop().slice(1, 4);

    test('a failure on every page is the template\'s; one on some pages is their content\'s', () => {
        const r = M.groupIssues(products(), deps);
        assert.equal(r.scansTotal, 3);
        assert.deepEqual(r.template.map((e) => [e.ruleId, e.elements, e.scans]), [['button-name', 1, ['s1', 's2', 's3']]]);
        assert.deepEqual(r.content.map((e) => [e.ruleId, e.elements, e.scans]), [['image-alt', 1, ['s1']]]);
    });

    test('excluded scans count: the person sees what excluding hides', () => {
        const scans = products();
        scans[0].includedInReport = false;
        assert.deepEqual(M.groupIssues(scans, deps).content.map((e) => e.scans), [['s1']]);
    });

    test('a rule failing on some pages, on several elements, counts its elements and joins its pages', () => {
        const scans = products();
        scans[2].canonical.findings.push(finding('image-alt', [occ('/products/green', { target: '.x', html: '<img class="x">' })]));
        const img = M.groupIssues(scans, deps).content.find((e) => e.ruleId === 'image-alt');
        assert.equal(img.elements, 2);
        assert.deepEqual(img.scans, ['s1', 's3']);
    });

    test('fewer than two scans: nothing to compare', () => {
        assert.equal(M.groupIssues(products().slice(0, 1), deps), null);
        assert.equal(M.groupIssues([], deps), null);
    });

    test('the scans are not changed', () => {
        const scans = products();
        const before = JSON.stringify(scans);
        M.groupIssues(scans, deps);
        assert.equal(JSON.stringify(scans), before);
    });
});

describe('merged groups changed by hand (step 7)', () => {
    const C = require('./scan-group-choice.js');
    // The URL groups and the groups by hand of a choice, as the app finds them.
    function shownWith(scans, choice) {
        const result = G.findGroups(scans, { sources: [U.createUrlGroupSource(), C.createManualGroupSource(choice)] });
        return M.scansAsShown(scans, result, C.readChoice({ scanGrouping: { patterns: choice } }), deps);
    }

    test('a scan added to a merged group is merged with it, wherever it is', () => {
        const { scans, merges } = shownWith(shop(), [{ key: PRODUCTS, merge: true, add: ['s4'] }]);
        assert.deepEqual([...merges.values()][0].members, ['s1', 's2', 's3', 's4']);
        // About (s4) is merged into the products, unnamed: shown by its pattern.
        assert.deepEqual(scans.map((s) => s.label), ['Home', '/products/{slug}']);
    });

    test('a scan taken out of a merged group is shown on its own', () => {
        const { scans, merges } = shownWith(shop(), [{ key: PRODUCTS, merge: true, remove: ['s2'] }]);
        assert.deepEqual([...merges.values()][0].members, ['s1', 's3']);
        assert.deepEqual(scans.map((s) => s.label), ['Home', '/products/{slug}', 'Blue', 'About']);
    });

    test('a group by hand is merged from its own scans, named by the person', () => {
        const { choice } = C.addManualGroup([], { name: 'Info pages', members: ['s0', 's4'] });
        const { scans } = shownWith(shop(), choice);
        assert.deepEqual(scans.map((s) => s.label), ['Info pages', 'Red', 'Blue', 'Green']);
        assert.deepEqual(scans[0].mergedGroup.members.map((m) => m.id), ['s0', 's4']);
    });

    test('a scan put in a group by hand is that group\'s, not its pattern\'s', () => {
        const { choice } = C.addManualGroup([{ key: PRODUCTS, merge: true }], { name: 'Picks', members: ['s1', 's4'] });
        const { merges } = shownWith(shop(), choice);
        const byKey = new Map([...merges.values()].map((m) => [m.key, m.members]));
        assert.deepEqual(byKey.get(PRODUCTS), ['s2', 's3']);
        assert.deepEqual(byKey.get('manual:1'), ['s1', 's4']);
    });
});
