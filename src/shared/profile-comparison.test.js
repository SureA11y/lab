'use strict';

// A comparison read on the profiles the reader chooses, scored again on them,
// and how much of it each profile accounts for (shared-profiles.js
// prepareComparison and rescoreReport, report-diff.js profileBreakdown).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { comparisonProfiles, prepareComparison, rescoreReport, rescoreScan, narrowScanToProfiles, compareOnShared } = require('./shared-profiles.js');
const { diffReports } = require('./report-diff.js');
const { diffReportSeries } = require('./report-multi-diff.js');
const { buildA11ySummary } = require('./a11y-summary.js');

const AA = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
const AAA = { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' };
const ARIA = { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' };

const DOM = { totalElements: 400, counts: { evaluable: 200, focusable: 40, interactive: 30 } };

const occ = (target, verdicts) => ({ target: [target], pageUrl: 'https://example.com/', occurrenceOutcome: 'fail', ...(verdicts ? { verdicts } : {}) });
// A rule's own finding, with what each profile makes of it.
const rule = (ruleId, verdicts, targets = [`#${ruleId}`], severity = 'serious') => {
    const ranks = { notApplicable: 0, pass: 1, cantTell: 2, fail: 3 };
    const outcome = Object.values(verdicts).sort((x, y) => ranks[y] - ranks[x])[0];
    return {
        ruleId, id: ruleId, outcome, severity, meta: { atomic: true }, wcag: { sc: ['4.1.2'] }, verdicts,
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
            // Scored as the run scores it: a scan of several profiles takes
            // its worst profile's score.
            a11ySummary: dom
                ? buildA11ySummary({ canonical, domMetrics: dom, coverageSummary: null, profiles: profiles.map((p) => p.id) })
                : { scores: { avgPageAccessibility: 90, scoredOn: profiles[0].id } },
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

    test('WCAG at two levels is one choice, naming the levels', () => {
        const a = report('a', 1, [scan([AAA, ARIA], [])]);
        assert.deepEqual(comparisonProfiles([a, after()]).map((p) => p.label), ['WCAG 2.2 AA to AAA', 'WAI-ARIA 1.2']);
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

describe('the report view: a scan read on some of its profiles', () => {
    test('is scored again on them, as the comparison scores it', () => {
        const r = after();
        const view = rescoreScan(narrowScanToProfiles(r.scans[0], ['wai-aria-1.2']));
        const scores = view.metrics.a11ySummary.scores;
        assert.equal(view.metrics.a11ySummary.scoreRecounted, true);
        assert.equal(view.metrics.a11ySummary.scoreLeftOut, undefined);
        const compared = diffReports(before(), after(), { profilesOff: ['wcag'] });
        assert.equal(scores.avgPageAccessibility, compared.stats.scoreB);
    });

    test('a scan with every profile on, or none to score from, is left as it is', () => {
        const r = after();
        assert.equal(rescoreScan(r.scans[0]), r.scans[0]);
        const old = scan([AA, ARIA], [rule('both-1', BOTH)], { dom: null });
        const narrowed = narrowScanToProfiles(old, ['wcag22-aa']);
        assert.equal(rescoreScan(narrowed), narrowed);
        assert.equal(narrowed.metrics.a11ySummary.scoreLeftOut, true);
    });
});

describe('how much each profile accounts for', () => {
    const byKey = (d) => Object.fromEntries(d.profiles.rows.map((r) => [r.key, r]));

    test('two reports: each broken element put down to the one profile that flags it, or to several', () => {
        const d = diffReports(before(), after());
        const rows = byKey(d);
        assert.deepEqual(d.profiles.profiles.map((p) => p.key), ['wcag', 'wai-aria-1.2']);
        assert.deepEqual(rows.wcag.change, { fixed: 1, new: 0, still: 0 });
        assert.deepEqual(rows['wai-aria-1.2'].change, { fixed: 2, new: 4, still: 0 });
        assert.deepEqual(rows.shared.change, { fixed: 0, new: 1, still: 1 });
        assert.deepEqual(rows.total.change, { fixed: 3, new: 5, still: 1 });
        assert.deepEqual(rows.wcag.columns.map((c) => c.elements), [1, 0]);
        assert.deepEqual(rows['wai-aria-1.2'].columns.map((c) => c.elements), [2, 4]);
        assert.deepEqual(rows.shared.columns.map((c) => c.elements), [1, 2]);
        assert.deepEqual(rows.total.columns.map((c) => c.elements), [4, 6]);
        // On its own: the profile's problems and failures, shared ones included.
        assert.deepEqual(rows['wai-aria-1.2'].columns.map((c) => [c.problems, c.failures]), [[2, 3], [4, 6]]);
        assert.equal(rows.shared.columns[0].problems, null);
    });

    test('two rules of two profiles on one element are one element, put down to both', () => {
        // WCAG 2.5.8 and EN 301 549's 9.2.5.8 on the same small target: two
        // rows, one element.
        const WC = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'pass' };
        const AR = { 'wcag22-aa': 'pass', 'wai-aria-1.2': 'fail' };
        const a = report('a', 1, [scan([AA, ARIA], [rule('wcag-row', WC, ['#t']), rule('aria-row', AR, ['#t'])])]);
        const b = report('b', 2, [scan([AA, ARIA], [])]);
        const rows = byKey(diffReports(a, b));
        assert.deepEqual(rows.shared.change, { fixed: 1, new: 0, still: 0 });
        assert.deepEqual(rows.wcag.columns.map((c) => c.elements), [0, 0]);
        assert.deepEqual(rows.wcag.columns.map((c) => c.problems), [1, 0], 'its own rule, on its own');
    });

    test('the elements put down add up to the comparison', () => {
        const d = diffReports(before(), after());
        const parts = d.profiles.rows.filter((r) => r.kind !== 'total');
        const total = d.profiles.rows.find((r) => r.kind === 'total');
        for (const col of [0, 1]) assert.equal(parts.reduce((n, r) => n + r.columns[col].elements, 0), total.columns[col].elements);
        assert.equal(total.columns[0].elements, d.stats.elementsA);
        assert.equal(total.columns[1].elements, d.stats.elementsB);
        assert.equal(total.columns[0].failures, d.stats.failuresA);
        for (const cat of ['fixed', 'new', 'still']) assert.equal(parts.reduce((n, r) => n + r.change[cat], 0), total.change[cat]);
    });

    test('each profile carries its own score, counted again on it alone', () => {
        const d = diffReports(before(), after());
        const aria = d.profiles.rows.find((r) => r.key === 'wai-aria-1.2');
        const alone = diffReports(before(), after(), { profilesOff: ['wcag'] });
        assert.deepEqual(aria.columns.map((c) => c.score), [alone.stats.scoreA, alone.stats.scoreB]);
        assert.deepEqual(d.profiles.rows.find((r) => r.kind === 'total').columns.map((c) => c.score), [50, 50]);
    });

    test('variants count by side', () => {
        const d = diffReports(before(), after(), { mode: 'ab' });
        assert.deepEqual(d.profiles.rows.find((r) => r.kind === 'total').change, { aonly: 3, bonly: 5, both: 1 });
    });

    test('a series: column by column, no categories', () => {
        const c = report('c', 3, [scan([AA, ARIA], [rule('both-2', BOTH)])]);
        const series = diffReportSeries([before(), after(), c]);
        const total = series.profiles.rows.find((r) => r.kind === 'total');
        assert.deepEqual(total.columns.map((col) => col.elements), [4, 6, 1]);
        assert.equal(total.change, null);
        assert.deepEqual(series.profiles.rows.find((r) => r.kind === 'shared').columns.map((col) => col.elements), [1, 2, 1]);
    });

    test('in the order the comparison put the reports in', () => {
        const d = diffReports(after(), before());
        assert.equal(d.swapped, true);
        assert.deepEqual(d.profiles.rows.find((r) => r.kind === 'total').columns.map((c) => c.elements), [4, 6]);
    });

    test('none when the comparison is read on one profile', () => {
        const a = report('a', 1, [scan([AA], [rule('x', { 'wcag22-aa': 'fail' })])]);
        const b = report('b', 2, [scan([AA], [])]);
        assert.equal(diffReports(a, b).profiles, undefined);
    });
});

describe('a scan of several profiles scores as its worst profile', () => {
    test('one defect two profiles restate is not counted twice', () => {
        const WC = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'pass' };
        const AR = { 'wcag22-aa': 'pass', 'wai-aria-1.2': 'fail' };
        const findings = [rule('wcag-row', WC, ['#t', '#u']), rule('aria-row', AR, ['#t', '#u'])];
        const ids = ['wcag22-aa', 'wai-aria-1.2'];
        const whole = buildA11ySummary({ canonical: { findings }, domMetrics: DOM }).scores;
        const scored = buildA11ySummary({ canonical: { findings }, domMetrics: DOM, profiles: ids }).scores;
        const alone = buildA11ySummary({ canonical: { findings: [findings[0]] }, domMetrics: DOM }).scores;
        assert.ok(whole.avgPageAccessibility < alone.avgPageAccessibility, 'as one, the defect counts twice');
        assert.equal(scored.avgPageAccessibility, alone.avgPageAccessibility);
        assert.ok(['wcag22-aa', 'wai-aria-1.2'].includes(scored.scoredOn));
        assert.deepEqual(Object.keys(scored.byProfile), ids);
    });

    test('the profile it does worst on gives the score', () => {
        const s = scan([AA, ARIA], [rule('aria-only-2', ARIA_ONLY, ['#a', '#b', '#c'], 'critical'), rule('wcag-only-1', WCAG_ONLY)]);
        const scores = s.metrics.a11ySummary.scores;
        assert.equal(scores.scoredOn, 'wai-aria-1.2');
        assert.equal(scores.avgPageAccessibility, Math.min(...Object.values(scores.byProfile)));
    });

    test('a report saved before is scored again in a comparison, and says so', () => {
        const old = before();
        const s0 = old.scans[0];
        s0.metrics.a11ySummary = buildA11ySummary({ canonical: s0.canonical, domMetrics: DOM });
        const d = diffReports(old, after());
        assert.equal(d.compared[0].scans[0].metrics.a11ySummary.scores.avgPageAccessibility, before().scans[0].metrics.a11ySummary.scores.avgPageAccessibility);
        assert.equal(d.document.scoresRecounted, true);
    });

    test('a run of such scans takes its worst profile over all of them', () => {
        const { buildGlobalSummary } = require('./global-summary.js');
        const r = before();
        const g = buildGlobalSummary({ scans: r.scans, options: { useMinConfidence: false } }).a11ySummary.scores;
        assert.ok(g.scoredOn);
        assert.equal(g.adjusted, Math.min(...Object.values(g.byProfile).filter((v) => v != null)));
    });
});

describe('a scan read at a lower WCAG level than it checked', () => {
    test('is scored on its WCAG findings at that level, not as if it had none', () => {
        const V = (w, a) => ({ 'wcag22-aaa': w, 'wai-aria-1.2': a });
        const W = (w, a) => ({ 'wcag22-aa': w, 'wai-aria-1.2': a });
        const a = report('a', 1, [scan([AAA, ARIA], [rule('wcag-row', V('fail', 'pass'), ['#a', '#b', '#c'], 'critical'), rule('aria-row', V('pass', 'fail'))])]);
        const b = report('b', 2, [scan([AA, ARIA], [rule('wcag-row', W('fail', 'pass'), ['#a', '#b', '#c'], 'critical'), rule('aria-row', W('pass', 'fail'))])]);
        const d = diffReports(a, b);
        assert.deepEqual(d.document.profiles.comparedOn.map((p) => p.id), ['wcag22-aa', 'wai-aria-1.2']);
        const narrowed = d.compared[0].scans[0];
        assert.equal(narrowed.metrics.a11ySummary.scores.scoredOn, 'wcag22-aa');
        assert.equal(d.stats.scoreA, d.stats.scoreB, 'the same findings score the same at the same level');
    });
});

describe('reports with no page in common', () => {
    const at = (s, path) => ({ ...s, url: `https://example.com/${path}` });
    test('are read on the profiles every report checked on some page, not said to share none', () => {
        const a = report('a', 1, [at(scan([AA, ARIA], [rule('wcag-only-1', WCAG_ONLY), rule('aria-only-1', ARIA_ONLY)]), 'v1/cart')]);
        const b = report('b', 2, [at(scan([AA], [rule('wcag-only-1', { 'wcag22-aa': 'fail' })]), 'v2/cart')]);
        const d = diffReports(a, b);
        assert.ok(!d.rows.some((r) => r.ruleId === 'aria-only-1'), 'WAI-ARIA, which only one checked, is not fixed');
        assert.equal(d.document.criteriaMismatch, false);
        assert.equal(d.document.pagesUnmatched, true);
        assert.deepEqual(d.document.profiles.comparedOn.map((p) => p.id), ['wcag22-aa']);
        assert.equal(d.document.profiles.byReport, true);
    });

    test('with the same profiles, they are compared as they are, and the pages said not to match', () => {
        const a = report('a', 1, [at(scan([AA, ARIA], [rule('x', BOTH)]), 'v1/cart')]);
        const b = report('b', 2, [at(scan([AA, ARIA], [rule('x', BOTH)]), 'v2/cart')]);
        const d = diffReports(a, b);
        assert.equal(d.document.pagesUnmatched, true);
        assert.equal(d.document.profiles, undefined);
    });
});

describe('a report whose pages are too small to score on their own', () => {
    test('keeps a score from all its pages together when read on fewer profiles', () => {
        const SMALL = { totalElements: 40, counts: { evaluable: 10 } };
        const a = report('a', 1, [scan([AA, ARIA], [rule('aria-only-1', ARIA_ONLY), rule('wcag-only-1', WCAG_ONLY)], { dom: SMALL })]);
        const b = report('b', 2, [scan([AA, ARIA], [rule('wcag-only-1', WCAG_ONLY)], { dom: SMALL })]);
        assert.equal(a.scans[0].metrics.a11ySummary.scores.avgPageAccessibility, null);
        const d = diffReports(a, b, { profilesOff: ['wai-aria-1.2'] });
        assert.equal(typeof d.stats.scoreA, 'number');
        assert.equal(typeof d.stats.scoreB, 'number');
    });
});
