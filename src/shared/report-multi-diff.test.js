'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { diffReportSeries, orderReportsByTime } = require('./report-multi-diff.js');

function finding(ruleId, severity, n, extra = {}) {
    return {
        ruleId, id: ruleId, title: extra.title || `${ruleId} title`, severity, outcome: 'fail',
        wcag: { sc: [extra.wcag || '1.4.3'] },
        occurrences: Array.from({ length: n }, (_, i) => ({
            pageUrl: 'https://x/p', target: [`${ruleId}-${i}`],
        })),
    };
}
function report(o = {}) {
    return {
        runId: o.runId, timestamp: o.timestamp, scenarioName: o.name || null, url: 'https://x/',
        scans: Array.from({ length: o.pages || 1 }, (_, i) => ({
            id: `s${i}`, url: 'https://x/', scanTags: o.tags || [],
            canonical: { findings: i === 0 ? (o.findings || []) : [] },
        })),
        metrics: { a11ySummary: { scores: { avgPageAccessibility: o.score ?? 70, confidence: o.conf ?? 90 } } },
    };
}
// A rule present in the runs whose index is listed, with `n` occurrences.
function series(spec, base = {}) {
    return spec.map((counts, i) => report({
        runId: `r${i}`,
        timestamp: `2026-0${i + 1}-01T00:00:00Z`,
        findings: Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([id, n]) => finding(id, base[id] || 'serious', n)),
        pages: 1,
    }));
}

describe('diffReportSeries — trend categories', () => {
    test('resolved / new / persistent / flapping', () => {
        const reports = series([
            { gone: 2, always: 3, flaps: 1 },
            { always: 3 },
            { always: 2, flaps: 4, appeared: 5 },
        ]);
        const d = diffReportSeries(reports, { mode: 'trend' });
        const by = Object.fromEntries(d.rows.map((r) => [r.ruleId, r]));

        assert.equal(by.gone.category, 'resolved');
        assert.equal(by.appeared.category, 'new');
        assert.equal(by.always.category, 'persistent');
        assert.equal(by.flaps.category, 'flapping', 'present, absent, present is the case two runs cannot express');
        assert.deepEqual(by.always.counts, [3, 3, 2]);
        assert.equal(by.always.direction, 'improving');
    });

    test('a flapping rule reports how many times it came back', () => {
        const [d] = [diffReportSeries(series([{ f: 1 }, {}, { f: 1 }, {}, { f: 2 }]), { mode: 'trend' })];
        const row = d.rows.find((r) => r.ruleId === 'f');
        assert.equal(row.lifecycle.returns, 2);
        assert.equal(row.lifecycle.transitions, 4);
        assert.equal(row.category, 'flapping');
    });

    test('orders by time regardless of the order they were passed in', () => {
        const [a, b, c] = series([{ r: 3 }, { r: 2 }, { r: 1 }]);
        const d = diffReportSeries([c, a, b], { mode: 'trend' });
        assert.deepEqual(d.columns.map((col) => col.identity.runId), ['r0', 'r1', 'r2']);
        assert.deepEqual(d.rows[0].counts, [3, 2, 1]);
    });

    test('an explicit order overrides the timestamps', () => {
        const [a, b, c] = series([{ r: 3 }, { r: 2 }, { r: 1 }]);

        const byTime = diffReportSeries([c, a, b], { mode: 'trend' });
        assert.deepEqual(byTime.rows[0].counts, [3, 2, 1], 'sorted oldest to newest');
        assert.equal(byTime.ordering.by, 'time');

        const asGiven = diffReportSeries([c, a, b], { mode: 'trend', order: 'given' });
        assert.deepEqual(asGiven.rows[0].counts, [1, 3, 2], 'kept the caller order');
        assert.equal(asGiven.ordering.by, 'given');
    });

    test('variants keep the caller order unless asked to sort', () => {
        const columns = [
            report({ runId: 'r', name: 'Mobile', timestamp: '2026-03-01T00:00:00Z', findings: [finding('x', 'serious', 1)] }),
            report({ runId: 'r', name: 'Desktop', timestamp: '2026-01-01T00:00:00Z', findings: [finding('x', 'serious', 1)] }),
        ];
        assert.deepEqual(diffReportSeries(columns, { mode: 'matrix' }).columns.map((c) => c.label),
            ['Mobile', 'Desktop']);
        // Sorted by date, but still named by what they are: ordering variants
        // chronologically is a convenience, not a claim about them.
        assert.deepEqual(diffReportSeries(columns, { mode: 'matrix', order: 'time' }).columns.map((c) => c.label),
            ['Desktop', 'Mobile']);
    });

    test('an arranged timeline is labelled by version, not by scan date', () => {
        // Three local versions, scanned in whatever order they were installed:
        // same scenario, same URL, timestamps that say nothing about version.
        const version = (ts) => report({
            runId: `run-${ts}`, timestamp: ts, name: 'Web Banking',
            findings: [finding('r', 'serious', 1)],
        });
        const v2 = version('2026-05-01T09:00:00Z');
        const v3 = version('2026-05-01T10:00:00Z');
        const v1 = version('2026-05-01T11:00:00Z');

        const dated = diffReportSeries([v2, v3, v1], { mode: 'trend' });
        assert.deepEqual(dated.columns.map((c) => c.label), ['May 1 09:00', 'May 1 10:00', 'May 1 11:00'],
            'by default the columns are moments, dated to the minute when they share a day');

        const arranged = diffReportSeries([v1, v2, v3], {
            mode: 'trend', order: 'given', fallbackLabels: ['v1.1', 'v1.2', 'v1.3'],
        });
        assert.deepEqual(arranged.columns.map((c) => c.label), ['v1.1', 'v1.2', 'v1.3'],
            'arranged by hand, the columns are what the reader calls them');
    });

    test('a name scanned on two days is told apart by the day, not by every tag one copy carries', () => {
        // The same versions scanned on 19 Oct and again on 21 Oct, the second
        // time with a tag per section; the files are named the same.
        const sections = ['Accessibility', 'Assets', 'Changelog', 'Guides', 'Home', 'Search'];
        const scan = (v, day, tags = []) => report({
            runId: `${v}-${day}`, timestamp: `2026-10-${day}T09:00:00Z`, name: `UI-SDK ${v}`, tags,
            findings: [finding('r', 'serious', 1)],
        });
        const reports = [scan('v22.2.0', 19), scan('v22.3.0', 19), scan('v22.3.0', 21, sections)];

        const d = diffReportSeries(reports, {
            mode: 'trend', order: 'given',
            fallbackLabels: ['UI-SDK v22.2.0.json', 'UI-SDK v22.3.0.json', 'UI-SDK v22.3.0.json'],
        });
        assert.deepEqual(d.columns.map((c) => c.label), ['UI-SDK v22.2.0', 'UI-SDK v22.3.0 · Oct 19', 'UI-SDK v22.3.0 · Oct 21']);
        assert.deepEqual(d.columns.map((c) => c.undatedLabel), [null, 'UI-SDK v22.3.0', 'UI-SDK v22.3.0'],
            'where the date shows anyway, the name alone');
    });

    test('file names still come before the day, and an untagged copy keeps its name beside a tagged one', () => {
        const scan = (day, tags = []) => report({
            runId: `r${day}${tags.length}`, timestamp: `2026-10-${day}T09:00:00Z`, name: 'Web Banking', tags,
            findings: [finding('r', 'serious', 1)],
        });
        const byFile = diffReportSeries([scan(19), scan(21)], { mode: 'trend', order: 'given', fallbackLabels: ['v1.1', 'v1.2'] });
        assert.deepEqual(byFile.columns.map((c) => c.label), ['v1.1', 'v1.2']);

        // Same day, no file names: the tags only one carries, cut short.
        const tags = ['a', 'b', 'c', 'd', 'e'];
        const byTag = diffReportSeries([scan(19), scan(19, tags)], { mode: 'trend', order: 'given' });
        assert.deepEqual(byTag.columns.map((c) => c.label), ['Web Banking', 'Web Banking · a / b / +3 more']);
        assert.deepEqual(byTag.columns.map((c) => c.undatedLabel), [null, null]);
    });

    test('exports of one run are told apart by their tags before their file names', () => {
        const scan = (tag) => report({ runId: 'one-run', timestamp: '2026-10-19T09:00:00Z', name: 'Web Banking', tags: [tag],
            findings: [finding('r', 'serious', 1)] });
        const d = diffReportSeries([scan('desktop'), scan('mobile')], { mode: 'ab', fallbackLabels: ['a.json', 'b.json'] });
        assert.deepEqual(d.columns.map((c) => c.label), ['Web Banking · desktop', 'Web Banking · mobile']);
    });

    test('a named column keeps its name when its neighbours need a fallback', () => {
        // Three scans of one scenario: nothing in the payloads separates them,
        // so the other two columns fall back to their file names.
        const same = (ts) => report({ runId: `r${ts}`, timestamp: ts, name: 'Web Banking',
            findings: [finding('r', 'serious', 1)] });

        const d = diffReportSeries([same('2026-05-01T09:00:00Z'), same('2026-05-01T10:00:00Z'), same('2026-05-01T11:00:00Z')], {
            mode: 'trend',
            order: 'given',
            labels: ['v1.1 · baseline', null, null],
            fallbackLabels: ['v1.1', 'v1.2', 'v1.3'],
        });

        assert.deepEqual(d.columns.map((c) => c.label), ['v1.1 · baseline', 'v1.2', 'v1.3']);
    });

    test('columns are always told apart, even when every field matches', () => {
        const same = () => report({ runId: 'one-run', timestamp: '2026-05-01T09:00:00Z', name: 'Web Banking',
            findings: [finding('r', 'serious', 1)] });

        const labels = diffReportSeries([same(), same()], { mode: 'trend', order: 'given' }).columns.map((c) => c.label);
        assert.equal(new Set(labels).size, 2, 'position separates what metadata cannot');
        assert.deepEqual(labels, ['1. Web Banking', '2. Web Banking']);
    });

    test('undated reports are counted, not silently sorted', () => {
        const dated = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 2)] });
        const undated = report({ runId: 'b', name: 'no clock', findings: [finding('r', 'serious', 1)] });

        const d = diffReportSeries([undated, dated], { mode: 'trend' });
        assert.equal(d.ordering.undated, 1);
        assert.equal(d.columns[d.columns.length - 1].identity.scenarioName, 'no clock',
            'a report with no timestamp sorts last rather than being guessed at');

        const given = diffReportSeries([undated, dated], { mode: 'trend', order: 'given' });
        assert.equal(given.ordering.undated, 0, 'nothing is undated when dates are not being used');
    });

    test('verdict names the best run and the largest regression', () => {
        const d = diffReportSeries(series([{ r: 10 }, { r: 2 }, { r: 8 }, { r: 4 }]), { mode: 'trend' });
        assert.equal(d.verdict.net, -6);
        assert.equal(d.verdict.tone, 'good');
        assert.equal(d.verdict.bestIndex, 1);
        assert.equal(d.verdict.fromBest, 2, 'the latest run is 2 worse than the best in the window');
        assert.deepEqual(d.verdict.rise, { from: 1, to: 2, move: 6 });
    });
});

describe('diffReportSeries — matrix categories', () => {
    test('universal / shared / unique, caller order preserved', () => {
        const reports = [
            report({ name: 'Desktop', findings: [finding('everywhere', 'serious', 2)] }),
            report({ name: 'Tablet', findings: [finding('everywhere', 'serious', 2), finding('touch', 'moderate', 3)] }),
            report({ name: 'Mobile', findings: [finding('everywhere', 'serious', 2), finding('touch', 'moderate', 4), finding('mobileOnly', 'minor', 1)] }),
        ];
        const d = diffReportSeries(reports, { mode: 'matrix' });
        const by = Object.fromEntries(d.rows.map((r) => [r.ruleId, r]));

        assert.equal(by.everywhere.category, 'universal');
        assert.equal(by.touch.category, 'shared');
        assert.equal(by.mobileOnly.category, 'unique');
        assert.deepEqual(d.columns.map((c) => c.label), ['Desktop', 'Tablet', 'Mobile']);
        assert.equal(d.verdict.outlier, 2, 'mobile carries the only variant-specific failure');
        assert.equal(d.verdict.cleanest, 0);
    });
});

describe('diffReportSeries — honesty guards', () => {
    test('flags a workload change so absolute counts are not read as verdict', () => {
        const reports = [
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', pages: 4, findings: [finding('r', 'serious', 2)] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', pages: 9, findings: [finding('r', 'serious', 3)] }),
        ];
        const d = diffReportSeries(reports, { mode: 'trend' });
        assert.equal(d.gate.comparable, false);
        assert.deepEqual(d.gate.pages, [4, 9]);
        assert.ok(d.narrative.some((p) => p.includes('Pages analyzed changed across the window (4 → 9)')));
    });

    test('a long window gives the range rather than every page count', () => {
        const reports = Array.from({ length: 12 }, (_, i) => report({
            runId: `r${i}`, timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
            pages: i === 5 ? 3 : 7,
            findings: [finding('r', 'serious', 2)],
        }));
        const line = diffReportSeries(reports, { mode: 'trend' }).narrative
            .find((p) => p.includes('Pages analyzed changed'));

        assert.match(line, /\(3 to 7\)/);
        assert.ok(!line.includes('→'), 'twelve numbers in a row is not a sentence');
    });

    test('severity takes the worst reading across columns', () => {
        const d = diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'minor', 1)] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'critical', 1)] }),
        ], { mode: 'trend' });
        assert.equal(d.rows[0].severity, 'critical');
    });

    test('rule names in prose can be supplied by the caller', () => {
        const d = diffReportSeries(series([{ f: 1 }, {}, { f: 1 }]), {
            mode: 'trend',
            ruleLabel: (row) => `PLAIN(${row.ruleId})`,
        });
        assert.ok(d.narrative.some((p) => p.includes('PLAIN(f)')));
    });

    test('fewer than two reports is refused', () => {
        assert.throws(() => diffReportSeries([report({})], { mode: 'trend' }), /at least two reports/);
    });

    test('orderReportsByTime does not mutate the caller array', () => {
        const list = series([{ r: 1 }, { r: 2 }]).reverse();
        const before = list.slice();
        orderReportsByTime(list);
        assert.deepEqual(list, before);
    });
});

describe('diffReportSeries — what moved, not just where it ended', () => {
    test('each step reports what was cleared and what was introduced, not the net', () => {
        // Net across the window is zero. That is exactly the window where a net
        // figure tells the reader nothing about what anyone did.
        const d = diffReportSeries(series([
            { a: 10, b: 0 },
            { a: 4, b: 6 },
            { a: 4, b: 6 },
        ]), { mode: 'trend' });

        assert.deepEqual(d.flow.steps.map((s) => [s.fixed, s.introduced]), [[6, 6], [0, 0]]);
        assert.equal(d.flow.totals.fixed, 6);
        assert.equal(d.flow.totals.introduced, 6);
        assert.equal(d.verdict.net, 0, 'and the headline delta still says nothing happened');
    });

    test('rules gone and rules new are counted beside the instances', () => {
        const d = diffReportSeries(series([{ a: 3 }, { b: 2 }]), { mode: 'trend' });
        const [step] = d.flow.steps;

        assert.equal(step.rulesFixed, 1);
        assert.equal(step.rulesNew, 1);
        assert.equal(step.fixed, 3);
        assert.equal(step.introduced, 2);
    });

    test('unordered variants get no flow at all', () => {
        const d = diffReportSeries(series([{ a: 1 }, { a: 2 }]), { mode: 'matrix' });
        assert.equal(d.flow, null, 'columns with no order have no steps between them');
    });
});

describe('diffReportSeries — how long a problem has been open', () => {
    test('age is measured from the current unbroken run, not from first sight', () => {
        // Failed, was fixed, came back: it has been broken since it came back.
        const d = diffReportSeries(series([{ a: 2 }, {}, { a: 2 }, { a: 2 }]), { mode: 'trend' });
        const row = d.rows.find((r) => r.ruleId === 'a');

        assert.equal(row.age.sinceIndex, 2);
        assert.equal(row.age.runs, 2);
        assert.equal(row.age.fromStart, false, 'dating it to the first run would overstate the neglect');
    });

    test('a rule present from the start is flagged as possibly older than the window', () => {
        const d = diffReportSeries(series([{ a: 1 }, { a: 1 }, { a: 1 }]), { mode: 'trend' });
        const row = d.rows.find((r) => r.ruleId === 'a');

        assert.equal(row.age.fromStart, true);
        assert.equal(row.age.runs, 3);
        assert.ok(row.age.spanMs > 0, 'dated columns give an elapsed time as well as a count');
    });

    test('a rule that is clean in the latest column has no age', () => {
        const d = diffReportSeries(series([{ a: 1 }, {}]), { mode: 'trend' });
        assert.equal(d.rows.find((r) => r.ruleId === 'a').age, null);
    });

    test('elapsed time is only claimed when the dates did the ordering', () => {
        const d = diffReportSeries(series([{ a: 1 }, { a: 1 }]), { mode: 'trend', order: 'given' });
        assert.equal(d.rows[0].age.spanMs, null, 'an arrangement is not a timeline');
        assert.equal(d.rows[0].age.runs, 2);
    });

    test('the verdict names the longest-standing open problem', () => {
        const d = diffReportSeries(series([
            { old: 1, recent: 0 },
            { old: 1, recent: 0 },
            { old: 1, recent: 5 },
        ]), { mode: 'trend' });

        assert.equal(d.verdict.oldest.ruleId, 'old', 'age outranks size');
    });
});

describe('diffReportSeries — checks that concluded nothing', () => {
    function reviewReport(o) {
        const base = report(o);
        base.scans[0].canonical.findings = [
            ...(o.findings || []),
            ...(o.review || []).map((id) => ({
                ruleId: id, id, title: `${id} title`, severity: 'moderate', outcome: 'cantTell',
                wcag: { sc: ['1.1.1'] },
                occurrences: [{ pageUrl: 'https://x/p', target: ['#a'] }],
            })),
        ];
        return base;
    }

    test('needs-review items are counted per column and kept out of the failure totals', () => {
        const d = diffReportSeries([
            reviewReport({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 3)] }),
            reviewReport({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 3)], review: ['q'] }),
        ], { mode: 'trend' });

        assert.deepEqual(d.columns.map((c) => c.stats.failures), [3, 3]);
        assert.deepEqual(d.columns.map((c) => c.stats.reviewOccurrences), [0, 1]);
        assert.deepEqual(d.columns.map((c) => c.stats.review), [0, 1]);
    });

    test('a rule that stops failing and starts needing review is not reported as fixed', () => {
        const d = diffReportSeries([
            reviewReport({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 3)] }),
            reviewReport({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', review: ['r'] }),
        ], { mode: 'trend' });

        assert.deepEqual(d.review.map((r) => r.ruleId), ['r']);
        assert.equal(d.verdict.movedToReview, 1);
        assert.ok(d.narrative.some((p) => p.includes('stopped failing but now')),
            'the reader is told, because the failure count alone says it was fixed');
    });
});

describe('diffReportSeries — whether a column can be read at face value', () => {
    function degraded(o) {
        const base = report(o);
        base.scans.push({ id: 'skipped', url: 'https://x/deep', skipped: true, skipInfo: { reason: 'over the size cap' } });
        return base;
    }

    test('a skipped scan marks the column and the gate, and reaches the prose', () => {
        const d = diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 4)] }),
            degraded({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 1)] }),
        ], { mode: 'trend' });

        assert.equal(d.columns[0].health.ok, true);
        assert.equal(d.columns[1].health.ok, false);
        assert.equal(d.columns[1].health.skippedScans, 1);
        assert.equal(d.columns[1].stats.analyzed, 1);
        assert.equal(d.columns[1].stats.pages, 2);

        assert.equal(d.gate.healthy, false);
        assert.deepEqual(d.gate.degraded, [1]);
        assert.ok(d.narrative.some((p) => p.includes('did not complete cleanly')));
    });

    test('a failed action degrades a column even when every scan ran', () => {
        const withFailure = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [] });
        withFailure.actionResults = [{ type: 'click', status: 'failed', label: 'open the drawer' }];

        const d = diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 4)] }),
            withFailure,
        ], { mode: 'trend' });

        assert.equal(d.columns[1].health.ok, false);
        assert.equal(d.columns[1].health.failedActions, 1);
    });

    test('a withheld score is reported as withheld rather than as zero', () => {
        const unscored = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [] });
        unscored.metrics.a11ySummary.scores = { avgPageAccessibility: null, confidence: null, evaluationState: 'notEvaluated' };

        const d = diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 1)] }),
            unscored,
        ], { mode: 'trend' });

        assert.equal(d.columns[1].stats.score, null);
        assert.equal(d.columns[1].stats.scoreState, 'notEvaluated');
        assert.equal(d.gate.scored, false);
    });
});

describe('diffReportSeries — how far a problem reaches', () => {
    function spread(ruleId, pages, perPage = 1) {
        return {
            ruleId, id: ruleId, title: `${ruleId} title`, severity: 'serious', outcome: 'fail',
            wcag: { sc: ['1.4.3'] },
            occurrences: pages.flatMap((page) => Array.from({ length: perPage }, (_, i) => ({
                pageUrl: `https://x${page}`, target: [`${ruleId}-${page}-${i}`],
            }))),
        };
    }

    test('pages are counted per column, so a component is told apart from a page', () => {
        const everywhere = report({
            runId: 'a', timestamp: '2026-01-01T00:00:00Z', pages: 8,
            findings: [spread('wide', ['/a', '/b', '/c', '/d', '/e', '/f']), spread('narrow', ['/a'], 6)],
        });
        const same = report({
            runId: 'b', timestamp: '2026-02-01T00:00:00Z', pages: 8,
            findings: [spread('wide', ['/a', '/b', '/c', '/d', '/e', '/f']), spread('narrow', ['/a'], 6)],
        });

        const d = diffReportSeries([everywhere, same], { mode: 'trend' });
        const by = Object.fromEntries(d.rows.map((r) => [r.ruleId, r]));

        assert.equal(by.wide.reach.pages, 6);
        assert.equal(by.wide.reach.scope, 'systemic');
        assert.equal(by.narrow.reach.pages, 1);
        assert.equal(by.narrow.reach.scope, 'local');
        assert.equal(by.wide.counts[0], by.narrow.counts[0], 'the same instance count either way');
    });
});

describe('diffReportSeries — WCAG travels with the rules', () => {
    test('criteria are classified with the same vocabulary as rules', () => {
        const withCriteria = (runId, ts, statuses) => ({
            runId, timestamp: ts, url: 'https://x/',
            scans: [{
                id: 's0', url: 'https://x/', canonical: { findings: [] },
                metrics: { coverageSummary: { criteria: statuses } },
            }],
            metrics: { a11ySummary: { scores: { avgPageAccessibility: 70, confidence: 90 } } },
        });
        const fail = (sc) => ({ sc, status: 'doesNotSupport', level: 'AA' });
        const pass = (sc) => ({ sc, status: 'supports', level: 'AA' });

        const d = diffReportSeries([
            withCriteria('a', '2026-01-01T00:00:00Z', [fail('1.4.3'), fail('2.4.7')]),
            withCriteria('b', '2026-02-01T00:00:00Z', [pass('1.4.3'), fail('2.4.7')]),
            withCriteria('c', '2026-03-01T00:00:00Z', [fail('1.4.3'), fail('2.4.7')]),
        ], { mode: 'trend' });

        assert.equal(d.conformance.source, 'coverage');
        const bySc = Object.fromEntries(d.conformance.rows.map((r) => [r.sc, r.category]));
        assert.equal(bySc['1.4.3'], 'flapping');
        assert.equal(bySc['2.4.7'], 'persistent');
    });

    test('a set mixing reports with and without criterion verdicts says so', () => {
        const withVerdicts = {
            runId: 'a', timestamp: '2026-01-01T00:00:00Z', url: 'https://x/',
            scans: [{
                id: 's', url: 'https://x/', canonical: { findings: [finding('r', 'serious', 1)] },
                metrics: { coverageSummary: { criteria: [{ sc: '1.4.3', status: 'doesNotSupport', level: 'AA' }] } },
            }],
            metrics: { a11ySummary: { scores: {} } },
        };

        const d = diffReportSeries([
            withVerdicts,
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 1)] }),
        ], { mode: 'trend' });

        assert.equal(d.conformance.source, 'mixed');
    });
});

describe('diffReportSeries — room before failing (margins)', () => {
    const m = (ruleId, headroom) => ({ ruleId, title: `${ruleId} title`, unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.5 + headroom, headroom, selector: 'p' });
    const run = (runId, timestamp, margins) => ({
        runId, timestamp, url: 'https://x/',
        scans: [{ id: 's', url: 'https://x/', canonical: { findings: [], margins } }],
    });

    test('lines each rule\'s tightest pass up by column, and says where the room went first to last', () => {
        const d = diffReportSeries([
            run('a', '2026-01-01T00:00:00Z', [m('contrast-minimum', 0.8), m('link-in-text-block', 1)]),
            run('b', '2026-02-01T00:00:00Z', [m('contrast-minimum', 0.3)]),
            run('c', '2026-03-01T00:00:00Z', [m('contrast-minimum', 0.02), m('link-in-text-block', 1.5)]),
        ], { mode: 'trend' });
        assert.deepEqual(d.margins.map((r) => [r.ruleId, r.change]), [['contrast-minimum', 'closer'], ['link-in-text-block', 'further']]);
        assert.deepEqual(d.margins[0].cells.map((c) => c && c.headroom), [0.8, 0.3, 0.02]);
        assert.deepEqual(d.margins[1].cells.map((c) => c && c.headroom), [1, null, 1.5]);
    });

    test('says a rule fails on more elements in the latest column than in the first', () => {
        const last = run('c', '2026-03-01T00:00:00Z', [m('contrast-minimum', 13.7)]);
        last.scans[0].canonical.findings = [{ ruleId: 'contrast-minimum', outcome: 'fail', meta: { atomic: true }, occurrences: [{ target: ['p'] }] }];
        const d = diffReportSeries([run('a', '2026-01-01T00:00:00Z', [m('contrast-minimum', 0.5)]), last], { mode: 'trend' });
        assert.equal(d.margins[0].change, 'failsMore');
    });

    test('names no direction across variants, and is empty without margins', () => {
        const d = diffReportSeries([run('a', null, [m('contrast-minimum', 0.8)]), run('b', null, [m('contrast-minimum', 0.1)])], { mode: 'matrix' });
        assert.equal(d.margins[0].change, null);
        assert.deepEqual(diffReportSeries([run('a', null, []), run('b', null, [])], { mode: 'matrix' }).margins, []);
    });
});

describe('diffReportSeries — failures and broken elements', () => {
    test('an element failing three criteria is three failures and one broken element', () => {
        const input = (n) => ({ pageUrl: 'https://x/p', target: [`#input-${n}`] });
        const criterion = (ruleId, occurrences) => ({ ...finding(ruleId, 'serious', 0), occurrences });
        const reports = [0, 1].map((i) => ({
            ...report({ runId: `r${i}`, timestamp: `2026-0${i + 1}-01T00:00:00Z` }),
            scans: [{
                id: 's0', url: 'https://x/', scanTags: [],
                canonical: {
                    findings: [
                        criterion('wcag-1.3.1-info-and-relationships', [input(1), input(2)]),
                        criterion('wcag-3.3.2-labels-or-instructions', [input(1), input(2)]),
                        criterion('wcag-4.1.2-name', [input(1), input(2), { pageUrl: 'https://x/p', target: ['#icon-button'] }]),
                    ].slice(0, i === 0 ? 3 : 1),
                },
            }],
        }));
        const d = diffReportSeries(reports, { mode: 'trend' });
        assert.deepEqual(d.columns.map((c) => c.stats.failures), [7, 2]);
        assert.deepEqual(d.columns.map((c) => c.stats.elements), [3, 2]);
    });
});
