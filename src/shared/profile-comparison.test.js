'use strict';

// A comparison read on the profiles the reader chooses, scored again on them,
// and how much of it each profile accounts for (shared-profiles.js
// prepareComparison and rescoreReport, report-diff.js profileBreakdown).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { comparisonProfiles, prepareComparison, rescoreReport, compareOnShared } = require('./shared-profiles.js');
const { diffReports } = require('./report-diff.js');
const { diffReportSeries } = require('./report-multi-diff.js');
const { buildA11ySummary } = require('./a11y-summary.js');

const AA = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
const AAA = { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' };
const ARIA = { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' };

const DOM = { totalElements: 400, counts: { evaluable: 200, focusable: 40, interactive: 30 } };

const occ = (target, verdicts) => ({ target: [target], pageUrl: 'https://example.com/', occurrenceOutcome: 'fail', ...(verdicts ? { verdicts } : {}) });
// A rule's own finding, with what each profile makes of it.
const rule = (ruleId, verdicts, targets = ['#x'], severity = 'serious') => {
    const ranks = { notApplicable: 0, pass: 1, cantTell: 2, fail: 3 };
    const outcome = Object.values(verdicts).sort((x, y) => ranks[y] - ranks[x])[0];
    return {
        ruleId, outcome, severity, meta: { atomic: true }, wcag: { sc: ['4.1.2'] }, verdicts,
        occurrences: targets.map((t) => occ(t, verdicts)),
    };
};
const BOTH = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'fail' };
const WCAG_ONLY = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'pass' };
const ARIA_ONLY = { 'wcag22-aa': 'pass', 'wai-aria-1.2': 'fail' };

function scan(profiles, findings, { dom = DOM } = {}) {
    const wcag = profiles.find((p) => /^wcag22-/.test(p.id));
    const canonical = { findings };
    return {
        id: 's1', url: 'https://example.com/',
        profile: profiles.find((p) => p !== wcag) || wcag,
        ...(profiles.length > 1 ? { profiles } : {}),
        wcag: { version: '2.2', level: wcag ? wcag.label.split(' ').pop() : null },
        canonical,
        metrics: {
            ...(dom ? { domMetrics: dom } : {}),
            a11ySummary: dom ? buildA11ySummary({ canonical, domMetrics: dom, coverageSummary: null }) : { scores: { avgPageAccessibility: 90 } },
        },
    };
}

function report(runId, day, scans) {
    return {
        runId, timestamp: `2026-11-0${day}T10:00:00Z`, url: 'https://example.com/',
        metrics: { a11ySummary: { scores: { avgPageAccessibility: 50, confidence: 70 } } },
        scans,
    };
}

const before = () => report('a', 1, [scan([AA, ARIA], [
    rule('wcag-only-1', WCAG_ONLY),
    rule('aria-only-1', ARIA_ONLY, ['#a', '#b']),
    rule('both-1', BOTH),
])]);
const after = () => report('b', 2, [scan([AA, ARIA], [
    rule('aria-only-1', ARIA_ONLY),
    rule('aria-only-2', ARIA_ONLY, ['#c', '#d', '#e'], 'critical'),
    rule('both-1', BOTH),
    rule('both-2', BOTH),
])]);

describe('comparisonProfiles', () => {
    test('the profiles every report checked, WCAG first', () => {
        assert.deepEqual(comparisonProfiles([before(), after()]), [
            { key: 'wcag', label: 'WCAG 2.2 AA' },
            { key: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' },
        ]);
    });

    test('a profile only one report checked is not offered', () => {
        const b = report('b', 2, [scan([AA], [rule('wcag-only-1', { 'wcag22-aa': 'fail' })])]);
        assert.deepEqual(comparisonProfiles([before(), b]), [{ key: 'wcag', label: 'WCAG 2.2 AA' }]);
    });

    test('WCAG at two levels is one choice, named at the lowest', () => {
        const a = report('a', 1, [scan([AAA, ARIA], [])]);
        assert.deepEqual(comparisonProfiles([a, after()]).map((p) => p.label), ['WCAG 2.2 AA', 'WAI-ARIA 1.2']);
    });
});

describe('a comparison with a profile turned off', () => {
    test('two reports: only what the profiles still on make of each rule', () => {
        const d = diffReports(before(), after(), { profilesOff: ['wai-aria-1.2'] });
        assert.deepEqual(d.rows.map((r) => `${r.ruleId}:${r.category}`).sort(), [
            'both-1:persistent', 'both-2:new', 'wcag-only-1:resolved',
        ]);
        assert.deepEqual(d.document.profileFilter, {
            shown: [{ key: 'wcag', label: 'WCAG 2.2 AA' }],
            off: [{ key: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' }],
        });
        // Read on one profile, so there is nothing to put down to profiles.
        assert.equal(d.profiles, undefined);
    });

    test('the score is counted again on the profiles left, not left out', () => {
        const d = diffReports(before(), after(), { profilesOff: ['wcag'] });
        const expected = (findings) => buildA11ySummary({ canonical: { findings }, domMetrics: DOM, coverageSummary: null }).scores.avgPageAccessibility;
        const [a, b] = d.compared;
        const ariaOf = (r) => r.scans[0].canonical.findings;
        assert.equal(d.stats.scoreA, expected(ariaOf(a)));
        assert.equal(d.stats.scoreB, expected(ariaOf(b)));
        assert.notEqual(d.stats.scoreA, 50, 'not the score the report carries');
        assert.equal(d.document.scoresRecounted, true);
        assert.equal(a.metrics.a11ySummary.scoreLeftOut, undefined);
        assert.equal(a.metrics.a11ySummary.scoreRecounted, true);
    });

    test('turning every profile off turns none off', () => {
        const d = diffReports(before(), after(), { profilesOff: ['wcag', 'wai-aria-1.2'] });
        assert.equal(d.document.profileFilter, undefined);
        assert.equal(d.rows.length, 5);
    });

    test('a profile no report checked is ignored', () => {
        const d = diffReports(before(), after(), { profilesOff: ['rgaa-4.1'] });
        assert.equal(d.document.profileFilter, undefined);
        assert.equal(d.stats.scoreA, 50, 'the report\'s own score, nothing narrowed');
    });

    test('a scan whose profiles are all off is left out', () => {
        const a = before();
        a.scans.push({ ...scan([ARIA], [rule('aria-only-3', { 'wai-aria-1.2': 'fail' })]), id: 's2', url: 'https://example.com/aria' });
        const b = after();
        b.scans.push({ ...scan([ARIA], [rule('aria-only-3', { 'wai-aria-1.2': 'fail' })]), id: 's2', url: 'https://example.com/aria' });
        const d = diffReports(a, b, { profilesOff: ['wai-aria-1.2'] });
        assert.equal(d.stats.pagesA, 1);
        assert.ok(!d.rows.some((r) => r.ruleId === 'aria-only-3'));
    });

    test('a series: every column read the same way', () => {
        const c = report('c', 3, [scan([AA, ARIA], [rule('both-2', BOTH)])]);
        const series = diffReportSeries([before(), after(), c], { profilesOff: ['wai-aria-1.2'] });
        assert.deepEqual(series.rows.map((r) => r.ruleId).sort(), ['both-1', 'both-2', 'wcag-only-1']);
        assert.ok(series.columns.every((col) => col.stats.score != null && col.stats.scoreRecounted));
        assert.deepEqual(series.document.profileFilter.off.map((p) => p.key), ['wai-aria-1.2']);
    });
});

describe('scores counted again', () => {
    test('a report that kept no page measurements keeps its score left out', () => {
        const a = report('a', 1, [scan([AA, ARIA], [rule('both-1', BOTH)], { dom: null })]);
        const b = report('b', 2, [scan([AA, ARIA], [rule('both-1', BOTH)], { dom: null })]);
        const d = diffReports(a, b, { profilesOff: ['wai-aria-1.2'] });
        assert.equal(d.stats.scoreA, null);
        assert.equal(d.compared[0].metrics.a11ySummary.scoreLeftOut, true);
        assert.equal(d.document.scoresRecounted, undefined);
    });

    test('reports narrowed to the profiles they share are scored again too', () => {
        const b = report('b', 2, [scan([AA], [rule('wcag-only-1', { 'wcag22-aa': 'fail' })])]);
        const d = diffReports(before(), b);
        assert.deepEqual(d.document.profiles.comparedOn, [AA]);
        assert.equal(typeof d.stats.scoreA, 'number');
        // It checked only what is compared: scored again, its page scores the same.
        assert.equal(d.stats.scoreB, b.scans[0].metrics.a11ySummary.scores.avgPageAccessibility);
    });

    test('a report not narrowed comes back as it is', () => {
        const a = before();
        assert.equal(rescoreReport(a), a);
        const shared = compareOnShared([a, after()]);
        assert.equal(shared.reports[0], a);
    });

    test('a merged scan counts each element of a rule once, as the run scored it', () => {
        const findings = [rule('aria-only-1', ARIA_ONLY, ['#a', '#a', '#b']), rule('both-1', BOTH)];
        const a = report('a', 1, [{ ...scan([AA, ARIA], findings), mergedScan: true }]);
        const out = prepareComparison([a, after()], { off: ['wcag'] }).reports[0];
        const once = buildA11ySummary({
            canonical: { findings: [rule('aria-only-1', ARIA_ONLY, ['#a', '#b']), rule('both-1', BOTH)] },
            domMetrics: DOM, coverageSummary: null,
        }).scores.avgPageAccessibility;
        assert.equal(out.scans[0].metrics.a11ySummary.scores.avgPageAccessibility, once);
    });
});

describe('how much each profile accounts for', () => {
    test('two reports: each problem put down to the one profile it fails under, or to several', () => {
        const d = diffReports(before(), after());
        const byKey = Object.fromEntries(d.profiles.rows.map((r) => [r.key, r]));
        assert.deepEqual(d.profiles.profiles.map((p) => p.key), ['wcag', 'wai-aria-1.2']);
        assert.deepEqual(byKey.wcag.change, { new: 0, resolved: 1, persistent: 0 });
        assert.deepEqual(byKey['wai-aria-1.2'].change, { new: 1, resolved: 0, persistent: 1 });
        assert.deepEqual(byKey.shared.change, { new: 1, resolved: 0, persistent: 1 });
        assert.deepEqual(byKey.total.change, { new: 2, resolved: 1, persistent: 2 });
        // Problems and failures, report by report.
        assert.deepEqual(byKey.wcag.columns.map((c) => c.problems), [1, 0]);
        assert.deepEqual(byKey['wai-aria-1.2'].columns.map((c) => [c.problems, c.failures]), [[1, 2], [2, 4]]);
        assert.deepEqual(byKey.shared.columns.map((c) => c.problems), [1, 2]);
        assert.deepEqual(byKey.total.columns.map((c) => c.problems), [3, 4]);
        // The profile alone counts what it shares, too.
        assert.deepEqual(byKey['wai-aria-1.2'].alone.map((c) => c.problems), [2, 4]);
    });

    test('the rows put down add up to the comparison', () => {
        const d = diffReports(before(), after());
        const parts = d.profiles.rows.filter((r) => r.kind !== 'total');
        const total = d.profiles.rows.find((r) => r.kind === 'total');
        for (const col of [0, 1]) {
            assert.equal(parts.reduce((n, r) => n + r.columns[col].problems, 0), total.columns[col].problems);
            assert.equal(parts.reduce((n, r) => n + r.columns[col].failures, 0), total.columns[col].failures);
        }
        assert.equal(total.columns[0].failures, d.stats.failuresA);
        assert.equal(total.columns[1].failures, d.stats.failuresB);
    });

    test('each profile carries its own score, counted again on it alone', () => {
        const d = diffReports(before(), after());
        const aria = d.profiles.rows.find((r) => r.key === 'wai-aria-1.2');
        const alone = diffReports(before(), after(), { profilesOff: ['wcag'] });
        assert.deepEqual(aria.columns.map((c) => c.score), [alone.stats.scoreA, alone.stats.scoreB]);
        // As compared, the reports' own scores: nothing was narrowed.
        assert.deepEqual(d.profiles.rows.find((r) => r.kind === 'total').columns.map((c) => c.score), [50, 50]);
    });

    test('variants count by side', () => {
        const d = diffReports(before(), after(), { mode: 'ab' });
        const total = d.profiles.rows.find((r) => r.kind === 'total');
        assert.deepEqual(total.change, { aonly: 1, bonly: 2, both: 2 });
    });

    test('a series: column by column, no categories', () => {
        const c = report('c', 3, [scan([AA, ARIA], [rule('both-2', BOTH)])]);
        const series = diffReportSeries([before(), after(), c]);
        const total = series.profiles.rows.find((r) => r.kind === 'total');
        assert.deepEqual(total.columns.map((col) => col.problems), [3, 4, 1]);
        assert.equal(total.change, null);
        assert.deepEqual(series.profiles.rows.find((r) => r.kind === 'shared').columns.map((col) => col.problems), [1, 2, 1]);
    });

    test('in the order the comparison put the reports in', () => {
        const d = diffReports(after(), before());
        assert.equal(d.swapped, true);
        assert.deepEqual(d.profiles.rows.find((r) => r.kind === 'total').columns.map((c) => c.problems), [3, 4]);
    });

    test('none when the comparison is read on one profile', () => {
        const a = report('a', 1, [scan([AA], [rule('x', { 'wcag22-aa': 'fail' })])]);
        const b = report('b', 2, [scan([AA], [])]);
        assert.equal(diffReports(a, b).profiles, undefined);
    });
});
