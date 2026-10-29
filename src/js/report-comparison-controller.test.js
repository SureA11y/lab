'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

globalThis.A11Y_REPORT_DIFF = require('../shared/report-diff.js');
globalThis.A11Y_REPORT_MULTI_DIFF = require('../shared/report-multi-diff.js');
globalThis.A11Y_REPORT_IDENTITY = require('../shared/report-identity.js');
globalThis.A11Y_PLAIN_LANGUAGE = require('../shared/plain-language.js');

let mod;
async function load() {
    if (!mod) mod = await import('./report-comparison-controller.js');
    return mod;
}

function report(o = {}) {
    return {
        runId: o.runId, timestamp: o.timestamp, scenarioName: o.name || null, url: 'https://x/',
        scans: [{
            id: 's', url: 'https://x/', scanTags: o.tags || [],
            canonical: {
                findings: o.findings || [{
                    ruleId: o.rule || 'r', id: o.rule || 'r', title: 't', severity: 'serious', outcome: 'fail',
                    wcag: { sc: ['1.4.3'] },
                    occurrences: [{ pageUrl: 'https://x/p', target: ['.a'] }],
                }],
            },
        }],
        metrics: { a11ySummary: { scores: { avgPageAccessibility: o.score ?? 70, confidence: 90 } } },
    };
}

async function make() {
    const { createComparisonController } = await load();
    const cap = { html: null, state: null, count: 0 };
    const ctrl = createComparisonController({
        setHTML: (html, state) => { cap.html = html; cap.state = state; cap.count += 1; },
    });
    return { ctrl, cap };
}

describe('comparison controller — states', () => {
    test('needs at least two reports', async () => {
        const { ctrl, cap } = await make();
        assert.equal(ctrl.refresh(), 'needs-more');
        assert.match(cap.html, /Load at least two reports/);

        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }));
        assert.equal(ctrl.getState(), 'needs-more');
        assert.match(cap.html, /\(1 loaded\)/);
    });

    test('two reports render the pairwise diff, three render the dashboard', async () => {
        const { ctrl, cap } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }));
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z' }));

        assert.equal(ctrl.getState(), 'ready');
        assert.equal(ctrl.shape(), 'pair');
        assert.ok(!cap.html.includes('cmp2--dash'), 'two reports keep the view that already shipped');

        ctrl.addReport(report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z' }));
        assert.equal(ctrl.shape(), 'series');
        assert.ok(cap.html.includes('cmp2--dash'), 'three reports open the dashboard');
        assert.match(cap.html, /What to fix first/);
    });

    test('removing a report falls back to the pairwise view', async () => {
        const { ctrl, cap } = await make();
        const keys = ['a', 'b', 'c'].map((id, i) => {
            ctrl.addReport(report({ runId: id, timestamp: `2026-0${i + 1}-01T00:00:00Z` }));
            return ctrl.list()[i].key;
        });
        assert.ok(cap.html.includes('cmp2--dash'));

        assert.equal(ctrl.removeReport(keys[2]), true);
        assert.equal(ctrl.count(), 2);
        assert.ok(!cap.html.includes('cmp2--dash'));

        assert.equal(ctrl.removeReport(999), false, 'an unknown key is a no-op');
    });

    test('clear empties the tab', async () => {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }));
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z' }));
        assert.equal(ctrl.clear(), 'needs-more');
        assert.equal(ctrl.count(), 0);
    });
});

describe('comparison controller — framing', () => {
    test('the framing maps to the series mode', async () => {
        const { ctrl, cap } = await make();
        for (const [i, id] of ['a', 'b', 'c'].entries()) {
            ctrl.addReport(report({ runId: id, timestamp: `2026-0${i + 1}-01T00:00:00Z`, name: id.toUpperCase() }));
        }
        assert.match(cap.html, /data-mode="trend"/);

        ctrl.setMode('ab');
        assert.equal(ctrl.getMode(), 'ab');
        assert.match(cap.html, /data-mode="matrix"/);
        assert.match(cap.html, /variants compared/);

        ctrl.setMode('nonsense');
        assert.equal(ctrl.getMode(), 'evolution', 'anything unrecognised falls back to the directional framing');
    });
});

describe('comparison controller — column order', () => {
    async function loaded(order) {
        const { ctrl, cap } = await make();
        // Loaded out of order on purpose.
        ctrl.addReport(report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', name: 'March' }), 'c.json');
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'January' }), 'a.json');
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', name: 'February' }), 'b.json');
        if (order) ctrl.setOrder(order);
        return { ctrl, cap };
    }
    const names = (ctrl) => ctrl.list().map((e) => e.name).join(' ');

    test('a timeline defaults to the reports own dates, whatever order they arrived in', async () => {
        const { ctrl } = await loaded();
        assert.equal(ctrl.getOrder(), 'time');
        assert.equal(names(ctrl), 'a.json b.json c.json');
        assert.deepEqual(ctrl.list().map((e) => e.position), [1, 2, 3]);
    });

    test('variants and versions start in date order too, whatever order the reports were loaded in', async () => {
        const { ctrl } = await loaded();
        ctrl.setContext('variants');
        assert.equal(ctrl.getOrder(), 'given');
        assert.equal(names(ctrl), 'a.json b.json c.json');
        ctrl.setContext('versions');
        assert.equal(names(ctrl), 'a.json b.json c.json');
    });

    test('a hand-made arrangement is kept by versions and variants, never by runs over time', async () => {
        const { ctrl, cap } = await loaded();
        ctrl.setContext('versions');
        const march = ctrl.list().find((e) => e.name === 'c.json');
        ctrl.moveReport(march.key, -1);
        assert.equal(names(ctrl), 'a.json c.json b.json');

        ctrl.setContext('time');
        assert.equal(names(ctrl), 'a.json b.json c.json', 'over time is always by date');

        ctrl.setContext('variants');
        assert.equal(names(ctrl), 'a.json c.json b.json', 'the arrangement survives the detour');
        const headers = [...cap.html.matchAll(/dash-col-name">([^<]+)</g)].map((m) => m[1]);
        assert.deepEqual(headers.slice(0, 3), ctrl.list().map((e) => e.label), 'and the view follows it');

        ctrl.setContext('versions');
        assert.equal(names(ctrl), 'a.json c.json b.json');
    });

    test('a report added after an arrangement joins its end; a fresh load starts from dates again', async () => {
        const { ctrl } = await loaded();
        ctrl.setContext('versions');
        ctrl.moveReport(ctrl.list().find((e) => e.name === 'c.json').key, -1);
        ctrl.addReport(report({ runId: 'z', timestamp: '2025-12-01T00:00:00Z', name: 'December' }), 'z.json');
        assert.equal(names(ctrl), 'a.json c.json b.json z.json');

        ctrl.clear();
        ctrl.addReport(report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z' }), 'c.json');
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }), 'a.json');
        assert.equal(names(ctrl), 'a.json c.json');
    });

    test('moving a report freezes what is on screen and moves it one place', async () => {
        const { ctrl } = await loaded();
        const march = ctrl.list().find((e) => e.name === 'c.json');

        assert.equal(ctrl.moveReport(march.key, -1), true);
        assert.equal(ctrl.getOrder(), 'given', 'a nudge makes the arrangement explicit');
        assert.equal(names(ctrl), 'a.json c.json b.json');

        assert.equal(ctrl.moveReport(march.key, -1), true);
        assert.equal(names(ctrl), 'c.json a.json b.json');
    });

    test('a report cannot be moved off either end', async () => {
        const { ctrl } = await loaded();
        const first = ctrl.list()[0];
        assert.equal(ctrl.moveReport(first.key, -1), false);
        assert.equal(names(ctrl), 'a.json b.json c.json', 'and nothing moved');

        const last = ctrl.list()[2];
        assert.equal(ctrl.moveReport(last.key, 1), false);
        assert.equal(ctrl.moveReport('nope', 1), false);
    });

    test('the order can be handed back to the dates', async () => {
        const { ctrl } = await loaded();
        const march = ctrl.list().find((e) => e.name === 'c.json');
        ctrl.moveReport(march.key, -1);
        assert.equal(ctrl.orderIsDefault(), false);

        ctrl.setOrder('time');
        assert.equal(names(ctrl), 'a.json b.json c.json');
        ctrl.setOrder(null);
        assert.equal(ctrl.orderIsDefault(), true, 'and back to following the framing');
    });

    test('the rendered view is ordered the same way the chips are', async () => {
        const { ctrl, cap } = await loaded();
        const march = ctrl.list().find((e) => e.name === 'c.json');
        ctrl.moveReport(march.key, -1);

        // The dashboard draws more than one column-headed grid (rules, then
        // WCAG criteria). Every one of them has to agree with the chips, so the
        // headers are read in chunks rather than as a single row.
        const expected = ctrl.list().map((e) => e.label);
        const headers = [...cap.html.matchAll(/dash-col-name">([^<]+)</g)].map((m) => m[1]);

        assert.ok(headers.length >= expected.length, 'at least one grid is drawn');
        assert.equal(headers.length % expected.length, 0, 'every grid carries every column');
        for (let at = 0; at < headers.length; at += expected.length) {
            assert.deepEqual(headers.slice(at, at + expected.length), expected);
        }
        assert.match(cap.html, /In the order you arranged them/);
    });

    test('three versions scanned out of order can be arranged, and the view follows', async () => {
        const { ctrl, cap } = await make();
        // All three scanned on one afternoon, in whatever order they were
        // installed locally: v1.2 first, then v1.3, then v1.1.
        const version = (ts) => report({ runId: `run-${ts}`, timestamp: ts, name: 'Web Banking' });
        ctrl.addReport(version('2026-05-01T09:00:00Z'), 'v1.2.a11y-report.json');
        ctrl.addReport(version('2026-05-01T10:00:00Z'), 'v1.3.a11y-report.json');
        ctrl.addReport(version('2026-05-01T11:00:00Z'), 'v1.1.a11y-report.json');

        assert.deepEqual(ctrl.list().map((e) => e.name),
            ['v1.2.a11y-report.json', 'v1.3.a11y-report.json', 'v1.1.a11y-report.json'],
            'by scan date, which is the wrong order for these versions');

        // Put v1.1 first, where it belongs.
        const v11 = ctrl.list().find((e) => e.name.startsWith('v1.1'));
        ctrl.moveReport(v11.key, -1);
        ctrl.moveReport(v11.key, -1);

        assert.deepEqual(ctrl.list().map((e) => e.name),
            ['v1.1.a11y-report.json', 'v1.2.a11y-report.json', 'v1.3.a11y-report.json']);

        // The columns are now named after the files, not after scan times.
        // Sliced to one grid's worth: the dashboard draws several, all sharing
        // these headers.
        const headers = [...cap.html.matchAll(/dash-col-name">([^<]+)</g)].map((m) => m[1]);
        assert.deepEqual(headers.slice(0, 3), ['v1.1', 'v1.2', 'v1.3']);
    });

    test('at two reports the arrangement decides the baseline, not the clock', async () => {
        const { ctrl, cap } = await make();
        ctrl.addReport(report({ runId: 'newer-scan', timestamp: '2026-05-01T11:00:00Z', name: 'v1.1' }), 'v1.1.json');
        ctrl.addReport(report({ runId: 'older-scan', timestamp: '2026-05-01T09:00:00Z', name: 'v1.2' }), 'v1.2.json');

        // By date the later scan (v1.1) is treated as the latest state.
        assert.equal(ctrl.list()[0].name, 'v1.2.json');

        const v11 = ctrl.list().find((e) => e.name === 'v1.1.json');
        ctrl.moveReport(v11.key, -1);

        assert.equal(ctrl.list()[0].name, 'v1.1.json');
        const baselineAt = cap.html.indexOf('v1.1');
        const currentAt = cap.html.indexOf('v1.2');
        assert.ok(baselineAt > -1 && currentAt > -1 && baselineAt < currentAt,
            'the pairwise view reads the arrangement, not the timestamps');
    });

    test('a context sets the framing, the order and the noun in one choice', async () => {
        const { ctrl, cap } = await make();
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-05-01T10:00:00Z', name: 'App' }), 'v1.3.json');
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-05-01T09:00:00Z', name: 'App' }), 'v1.2.json');
        ctrl.addReport(report({ runId: 'c', timestamp: '2026-05-01T11:00:00Z', name: 'App' }), 'v1.1.json');

        assert.equal(ctrl.getContext(), 'time');
        assert.match(cap.html, /than a day ago|than \d+ (hours|days) ago|than a day/,
            'a dated series says how long ago, not how many columns');

        ctrl.setContext('versions');
        assert.equal(ctrl.getContext(), 'versions');
        assert.equal(ctrl.getOrder(), 'given', 'versions are in the order you put them');
        assert.deepEqual(ctrl.list().map((e) => e.name), ['v1.2.json', 'v1.3.json', 'v1.1.json'],
            'loaded out of order, but they start out by date until you arrange them');
        assert.match(cap.html, /than 2 versions ago/, 'and the sentences count in versions');
        assert.match(cap.html, /Every problem, version by version/);

        ctrl.setContext('variants');
        assert.equal(ctrl.getContext(), 'variants');
        assert.match(cap.html, /data-mode="matrix"/);

        ctrl.setContext('nonsense');
        assert.equal(ctrl.getContext(), 'variants', 'an unknown context changes nothing');
    });

    test('moving a report by hand lands you in the versions context', async () => {
        const { ctrl } = await make();
        ['a', 'b', 'c'].forEach((id, i) => ctrl.addReport(
            report({ runId: id, timestamp: `2026-0${i + 1}-01T00:00:00Z`, name: 'App' }), `${id}.json`
        ));
        assert.equal(ctrl.getContext(), 'time');

        ctrl.moveReport(ctrl.list()[2].key, -1);
        assert.equal(ctrl.getContext(), 'versions', 'arranging by hand is what versions means');
    });

    test('reports with no timestamp are counted so the tab can say so', async () => {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }), 'dated.json');
        ctrl.addReport(report({ runId: 'b', name: 'no clock' }), 'undated.json');

        assert.equal(ctrl.undatedCount(), 1);
        const [, second] = ctrl.list();
        assert.equal(second.name, 'undated.json');
        assert.equal(second.dated, false, 'and it sorts last');
    });
});

describe('comparison controller — what it refuses and what it flags', () => {
    test('a report with no scan results is refused', async () => {
        const { ctrl } = await make();
        const result = ctrl.addReport({ scans: [{ id: 's', url: 'https://x/' }] });
        assert.equal(result.ok, false);
        assert.match(result.error, /no scan results/);
        assert.equal(ctrl.count(), 0);
    });

    test('reports sharing an identity are accepted but flagged', async () => {
        const { ctrl } = await make();
        const first = ctrl.addReport(report({ runId: 'same', timestamp: '2026-01-01T00:00:00Z' }));
        const again = ctrl.addReport(report({ runId: 'same', timestamp: '2026-01-01T00:00:00Z' }));
        assert.equal(first.duplicate, false);
        assert.equal(again.ok, true);
        assert.equal(again.duplicate, true, 'the same run twice is legal, but the tab should say so');
    });

    test('one run exported per tag is not treated as a duplicate', async () => {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'run', timestamp: '2026-01-01T00:00:00Z', tags: ['desktop'] }));
        const mobile = ctrl.addReport(report({ runId: 'run', timestamp: '2026-01-01T00:00:00Z', tags: ['mobile'] }));
        assert.equal(mobile.duplicate, false);
    });

    test('the tab holds a stated maximum', async () => {
        const { ctrl } = await make();
        const { MAX_REPORTS } = await load();
        for (let i = 0; i < MAX_REPORTS; i += 1) {
            ctrl.addReport(report({ runId: `r${i}`, timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
        }
        const overflow = ctrl.addReport(report({ runId: 'one-too-many', timestamp: '2026-06-01T00:00:00Z' }));
        assert.equal(overflow.ok, false);
        assert.match(overflow.error, new RegExp(String(MAX_REPORTS)));
        assert.equal(ctrl.count(), MAX_REPORTS);
    });

    test('a report with no name of its own falls back to what it calls itself', async () => {
        const { ctrl } = await make();
        const added = ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'Nightly' }));
        const [entry] = ctrl.list();
        assert.equal(entry.name, 'Nightly', 'the in-app shortcut passes no file name');
        assert.equal(entry.columnName, 'Nightly');
        assert.equal(added.name, 'Nightly', 'and the caller is told, so it can say what it added');
    });

    test('a name that was passed comes back as given', async () => {
        const { ctrl } = await make();
        const added = ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }), 'run-a.json');
        assert.equal(added.name, 'run-a.json');
    });

    test('list() names each loaded report for the chips', async () => {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'Nightly' }), 'run-a.json');
        const [entry] = ctrl.list();
        assert.equal(entry.name, 'run-a.json');
        assert.equal(entry.label, 'Nightly');
        assert.equal(entry.timestamp, '2026-01-01T00:00:00Z');
    });
});

// A comparison downloaded with its reports comes back as it was: the same
// columns in the same order, framed and named the same way.
describe('comparison controller — snapshot and restore', () => {
    async function arranged() {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', name: 'March' }), 'c.json');
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'January' }), 'a.json');
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', name: 'February' }), 'b.json');
        return ctrl;
    }
    const names = (ctrl) => ctrl.list().map((e) => e.name).join(' ');

    test('a snapshot lists the reports in column order, with the context, order and name', async () => {
        const ctrl = await arranged();
        ctrl.setContext('versions');
        ctrl.moveReport(ctrl.list()[2].key, -1);
        ctrl.setDocument({ title: 'Checkout', note: 'Why', generatedAt: '2026-04-01T00:00:00.000Z' });
        const snap = ctrl.snapshot();
        assert.equal(snap.context, 'versions');
        assert.equal(snap.order, 'given');
        assert.deepEqual(snap.document, { title: 'Checkout', note: 'Why', generatedAt: '2026-04-01T00:00:00.000Z' });
        assert.deepEqual(snap.reports.map((r) => r.name), ctrl.list().map((e) => e.name));
    });

    test('restore replaces what is loaded and puts back a hand-made order', async () => {
        const source = await arranged();
        source.setContext('variants');
        source.moveReport(source.list()[0].key, 1);
        source.setDocument({ title: 'Devices', note: 'Phones' });
        const snap = source.snapshot();

        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'z', timestamp: '2025-01-01T00:00:00Z', name: 'Old' }), 'z.json');
        const result = ctrl.restore(snap);
        assert.deepEqual(result, { count: 3, failures: [] });
        assert.equal(names(ctrl), names(source));
        assert.equal(ctrl.getContext(), 'variants');
        assert.equal(ctrl.getMode(), 'ab');
        assert.deepEqual(ctrl.getDocument(), source.getDocument());
    });

    test('restore keeps a date order as the default, so later reports still sort by date', async () => {
        const source = await arranged();
        const { ctrl } = await make();
        ctrl.restore(source.snapshot());
        assert.equal(names(ctrl), 'a.json b.json c.json');
        assert.equal(ctrl.getContext(), 'time');
        assert.equal(ctrl.orderIsDefault(), true);
    });

    test('restore leaves out a report that cannot be compared, and says which', async () => {
        const { ctrl } = await make();
        const good = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' });
        const result = ctrl.restore({
            context: 'time', order: null, document: {},
            reports: [{ name: 'a.json', report: good }, { name: 'empty.json', report: { runId: 'e', scans: [] } }],
        });
        assert.equal(result.count, 1);
        assert.deepEqual(result.failures, [{ name: 'empty.json', error: 'no scan results to compare' }]);
        assert.ok(!Number.isNaN(new Date(ctrl.getDocument().generatedAt).getTime()), 'a missing date is stamped now');
    });
});

// The Compare tab is normally fed by files, but the report on screen can be sent
// straight in. That shortcut has to know whether a report is comparable before it
// switches tabs, so the same guard the controller applies on arrival is exported.
describe('canCompareReport', () => {
    test('a report with rule-level findings can be compared', async () => {
        const { canCompareReport } = await load();
        assert.equal(canCompareReport(report({ runId: 'a' })), true);
    });

    test('a report whose scans carry no canonical findings cannot', async () => {
        const { canCompareReport } = await load();
        assert.equal(canCompareReport({ scans: [{ id: 's', url: 'https://x/' }] }), false);
        assert.equal(canCompareReport({ scans: [] }), false);
    });

    test('nothing at all is not comparable, and does not throw', async () => {
        const { canCompareReport } = await load();
        for (const value of [null, undefined, {}, 'report', 42]) {
            assert.equal(canCompareReport(value), false);
        }
    });

    test('it agrees with what addReport does on arrival', async () => {
        const { canCompareReport } = await load();
        const { ctrl } = await make();
        const empty = { scans: [{ id: 's', url: 'https://x/' }] };

        assert.equal(canCompareReport(empty), false);
        assert.equal(ctrl.addReport(empty).ok, false, 'the shortcut must not send in what the tab refuses');
    });
});

describe('comparison controller: naming the document', () => {
    test('a typed title and note reach the rendered view at two reports and at three', async () => {
        const { ctrl, cap } = await make();
        const r = (id, ts) => report({ runId: id, timestamp: ts, name: 'Web Banking' });

        ctrl.addReport(r('a', '2026-01-01T00:00:00Z'), 'a.json');
        ctrl.addReport(r('b', '2026-02-01T00:00:00Z'), 'b.json');
        ctrl.setDocument({ title: 'Q3 remediation', note: 'For the December sign-off.' });

        assert.match(cap.html, /<h2 class="doc-title">Q3 remediation<\/h2>/, 'the pairwise view carries it');
        assert.match(cap.html, /For the December sign-off\./);

        ctrl.addReport(r('c', '2026-03-01T00:00:00Z'), 'c.json');
        assert.match(cap.html, /<h2 class="doc-title">Q3 remediation<\/h2>/, 'and so does the dashboard');
    });

    test('an untitled comparison still names and dates itself', async () => {
        const { ctrl, cap } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'Web Banking' }), 'a.json');
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', name: 'Web Banking' }), 'b.json');

        assert.match(cap.html, /<h2 class="doc-title">Web Banking<\/h2>/);
        assert.match(cap.html, /data-doc-generated="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/);
        assert.match(cap.html, /What went into this comparison/);
    });

    test('the compiled stamp holds still while the columns are rearranged', async () => {
        const { ctrl, cap } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'A' }), 'a.json');
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', name: 'B' }), 'b.json');
        ctrl.addReport(report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', name: 'C' }), 'c.json');

        const before = /data-doc-generated="([^"]+)"/.exec(cap.html)[1];
        ctrl.moveReport(ctrl.list()[2].key, -1);
        ctrl.setDocument({ title: 'Renamed' });
        const after = /data-doc-generated="([^"]+)"/.exec(cap.html)[1];

        assert.equal(before, after, 'reordering and renaming do not restamp the document');
    });

    test('clearing the reports leaves no document behind', async () => {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }), 'a.json');
        ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z' }), 'b.json');
        ctrl.setDocument({ title: 'Q3 remediation' });

        assert.equal(ctrl.getDocument().title, 'Q3 remediation');
        ctrl.setDocument({ title: '', note: '' });
        assert.equal(ctrl.getDocument().title, '');
    });
});

describe('comparison controller — arrange', () => {
    test('puts the listed reports first, in the order given, and keeps it under Versions', async () => {
        const { ctrl } = await make();
        ctrl.addReport(report({ runId: 'x', timestamp: '2026-01-01T00:00:00Z' }), 'x.json');
        // Scanned out of row order: row 2 finished first.
        const row2 = ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z' }), 'v2.4.json');
        const row1 = ctrl.addReport(report({ runId: 'a', timestamp: '2026-02-02T00:00:00Z' }), 'v2.3.json');
        assert.ok(Number.isInteger(row1.key) && Number.isInteger(row2.key));

        ctrl.arrange([row1.key, row2.key]);
        ctrl.setContext('versions');
        assert.deepEqual(ctrl.list().map((e) => e.name), ['v2.3.json', 'v2.4.json', 'x.json']);
        assert.equal(ctrl.getContext(), 'versions');

        // A report added later joins the arrangement at the end, not by date.
        ctrl.addReport(report({ runId: 'c', timestamp: '2025-01-01T00:00:00Z' }), 'old.json');
        assert.equal(ctrl.list().at(-1).name, 'old.json');
    });
});

describe('comparison controller: where the failures are', () => {
    test('left out when no report fails, shown once one does', async () => {
        globalThis.A11Y_ISSUE_DISPERSION = require('../shared/issue-dispersion.js');
        globalThis.A11Y_ISSUE_DISPERSION_VIEW = require('../shared/issue-dispersion-view.js');
        try {
            const review = [{ ruleId: 'r', id: 'r', title: 't', severity: 'minor', outcome: 'cantTell', occurrences: [{ target: ['.a'] }] }];
            const { ctrl, cap } = await make();
            ctrl.addReport(report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: review }));
            ctrl.addReport(report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [] }));
            assert.doesNotMatch(cap.html, /Where the failures are/, 'pair, none failing');
            ctrl.addReport(report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', findings: [] }));
            assert.doesNotMatch(cap.html, /Where the failures are/, 'dashboard, none failing');
            ctrl.addReport(report({ runId: 'd', timestamp: '2026-04-01T00:00:00Z' }));
            assert.match(cap.html, /Where the failures are/, 'one fails');
        } finally {
            delete globalThis.A11Y_ISSUE_DISPERSION;
            delete globalThis.A11Y_ISSUE_DISPERSION_VIEW;
        }
    });
});

describe('comparison controller — adding several', () => {
    test('reports added with draw: false are drawn once, by refresh, as they would have been one by one', async () => {
        const { ctrl, cap } = await make();
        for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) {
            ctrl.addReport(report({ runId: id, timestamp: `2026-0${i + 1}-01T00:00:00Z` }), undefined, { draw: false });
        }
        assert.equal(cap.count, 0, 'nothing drawn while they are added');
        assert.equal(ctrl.refresh(), 'ready');
        assert.equal(cap.count, 1);
        const once = cap.html;

        const { ctrl: oneByOne, cap: drawn } = await make();
        for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) {
            oneByOne.addReport(report({ runId: id, timestamp: `2026-0${i + 1}-01T00:00:00Z` }));
        }
        assert.equal(drawn.count, 4);
        // Each drawing is stamped with the time it was made, to the second.
        const unstamped = (html) => html.replace(/data-doc-generated="[^"]*"/g, '');
        assert.equal(unstamped(once), unstamped(drawn.html));
    });
});
