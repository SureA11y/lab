'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildSummaryMarkdown, outcomeOf } = require('./summary-report');

// A finding as a scan holds it: the summary groups them by outcome itself.
const finding = (ruleId, outcome, occurrences) => ({ uid: `surea11y:${outcome}:${ruleId}`, ruleId, outcome, occurrences });
const at = (...targets) => targets.map((t) => ({ target: [t] }));

function scan(id, findings) {
    return { id, url: 'https://example.com/', canonical: { findings } };
}

function payload(extra = {}) {
    return {
        runId: 'run_1',
        timestamp: '2026-08-17T10:00:00.000Z',
        scenarioName: 'Web Banking',
        url: 'https://example.com/',
        scans: [scan('s1', [finding('image-alt', 'fail', at('.a', '.b')), finding('color-contrast', 'cantTell', at('.c'))])],
        ...extra,
    };
}

function comparison(extra = {}) {
    return {
        swapped: false,
        summary: {
            rules: { new: 1, resolved: 2, persistent: 3 },
            occurrences: { new: 4, fixed: 5, still: 6 },
            newRules: [{ ruleId: 'button-name', title: 'Buttons need names', severity: 'critical', occurrences: 2 }],
            net: -1,
            headline: 'improved',
            ...extra.summary,
        },
        ...extra,
    };
}

const CLEAN = { degraded: false, reasons: [], optionalFailures: [] };

describe('outcomeOf', () => {
    test('ranks a failed run above everything else', () => {
        assert.equal(outcomeOf({ status: 'error', health: { degraded: true }, summary: { occurrences: { new: 3 } } }).key, 'error');
        assert.equal(outcomeOf({ status: 'cancelled', health: { degraded: true } }).key, 'cancelled');
    });

    test('ranks degradation above a regression', () => {
        const out = outcomeOf({ status: 'done', health: { degraded: true }, summary: { occurrences: { new: 3 } } });
        assert.equal(out.key, 'degraded');
    });

    test('separates a compared run with nothing new from one never compared', () => {
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: { occurrences: { new: 0 } } }).key, 'clean');
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: null }).key, 'done');
    });
});

describe('buildSummaryMarkdown', () => {
    test('leads with what the reader needs to decide whether to look', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: CLEAN,
            comparison: comparison(),
            baselineLabel: 'release-1.4',
        });

        assert.match(md, /^# Web Banking/);
        assert.match(md, /\*\*New failing instances since the baseline\*\*/);
        assert.match(md, /## Compared to release-1\.4/);
    });

    test('counts instances rather than merged rules', () => {
        const md = buildSummaryMarkdown({ payload: payload(), status: 'done', health: CLEAN });

        assert.match(md, /- Failing: 1 rules, 2 instances/);
        assert.match(md, /- Can't tell: 1 rules, 1 instance$/m);
    });

    test('reads the findings from the scans, one rule across them counted once', () => {
        const md = buildSummaryMarkdown({
            payload: payload({ scans: [scan('s1', [finding('image-alt', 'fail', at('.a'))]), scan('s2', [finding('image-alt', 'fail', at('.b', '.c'))])] }),
            status: 'done',
            health: CLEAN,
        });

        assert.match(md, /- Scans: 2/);
        assert.match(md, /- Failing: 1 rules, 3 instances/);
    });

    test('names the rules that appeared', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: CLEAN,
            comparison: comparison(),
        });

        assert.match(md, /### New/);
        assert.match(md, /- \*\*button-name\*\* \(critical\) — 2 instances/);
    });

    test('says a clean comparison is clean', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: CLEAN,
            comparison: comparison({ summary: { occurrences: { new: 0, fixed: 0, still: 6 }, newRules: [] } }),
        });

        assert.match(md, /\*\*Nothing new since the baseline\*\*/);
        assert.doesNotMatch(md, /### New/);
    });

    test('reports a comparison whose counts are missing rather than throwing', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: CLEAN,
            comparison: { summary: {} },
        });

        assert.match(md, /- Rules: 0 new, 0 resolved, 0 persistent/);
        assert.match(md, /- Instances: 0 new, 0 fixed, 0 still failing/);
    });

    test('warns that fewer failures mean nothing when coverage dropped', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: {
                degraded: true,
                reasons: [{ kind: 'skipped-scans', count: 1, detail: 'Checkout' }],
                optionalFailures: [],
            },
            comparison: comparison(),
        });

        assert.match(md, /\*\*Ran, but covered less than the spec asked for\*\*/);
        assert.match(md, /## Coverage/);
        assert.match(md, /- 1 scan skipped: Checkout/);
        assert.match(md, /Fewer failures than the baseline is not good news while this is true\./);
    });

    test('mentions optional failures without calling the run degraded', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: { degraded: false, reasons: [], optionalFailures: [{ label: '2 Accept' }] },
        });

        assert.match(md, /## Coverage/);
        assert.match(md, /- 1 optional action failed, which the spec allows/);
        assert.doesNotMatch(md, /covered less than the spec asked for/);
    });

    test('says plainly when nothing was compared', () => {
        const md = buildSummaryMarkdown({ payload: payload(), status: 'done', health: CLEAN });
        assert.match(md, /No baseline was given, so nothing is being compared\./);
    });

    test('flags a baseline newer than the run', () => {
        const md = buildSummaryMarkdown({
            payload: payload(),
            status: 'done',
            health: CLEAN,
            comparison: comparison({ swapped: true }),
        });

        assert.match(md, /baseline is newer than this run/);
    });

    test('carries the error of a failed run', () => {
        const md = buildSummaryMarkdown({
            payload: payload({ failed: true, errorDetails: { message: 'navigation timed out' } }),
            status: 'error',
            health: { degraded: false, reasons: [], optionalFailures: [] },
        });

        assert.match(md, /\*\*Run failed\*\*/);
        assert.match(md, /- Error: navigation timed out/);
    });

    test('writes a usable summary from a payload with almost nothing in it', () => {
        const md = buildSummaryMarkdown({ payload: {}, status: 'done', health: null });

        assert.match(md, /^# Workflow run/);
        assert.match(md, /- Failing: 0 rules, 0 instances/);
        assert.match(md, /- Run: \(none\) at \(no timestamp\)/);
    });

    test('produces the same text for the same run', () => {
        const args = { payload: payload(), status: 'done', health: CLEAN, comparison: comparison() };
        assert.equal(buildSummaryMarkdown(args), buildSummaryMarkdown(args));
    });
});

describe('opt-in rules', () => {
    test('the run says which scans also ran rules only one standard requires', () => {
        const md = buildSummaryMarkdown({
            payload: payload({ scans: [{ id: 's1', optInRules: ['rgaa'] }, { id: 's2' }] }),
            status: 'done', health: CLEAN, comparison: null,
        });
        assert.match(md, /- Also ran RGAA-only rules in 1 of 2 scans/);
        assert.doesNotMatch(buildSummaryMarkdown({ payload: payload(), status: 'done', health: CLEAN, comparison: null }), /-only rules/);
    });

    test('the comparison says when the baseline ran different ones', () => {
        const md = buildSummaryMarkdown({
            payload: payload(), status: 'done', health: CLEAN,
            comparison: comparison({ optInRules: { baseline: [], current: ['rgaa'] } }),
        });
        assert.match(md, /The baseline ran no opt-in rules and this run RGAA-only rules/);
        const same = buildSummaryMarkdown({
            payload: payload(), status: 'done', health: CLEAN,
            comparison: comparison({ optInRules: { baseline: ['rgaa'], current: ['rgaa'] } }),
        });
        assert.doesNotMatch(same, /The baseline ran/);
    });
});

describe('questions that lean', () => {
    test('the run says which way its questions lean', () => {
        const md = buildSummaryMarkdown({
            payload: payload({ scans: [scan('s1', [finding('heading-order', 'cantTell', [{ target: ['.a'], lean: { toward: 'fail' } }, { target: ['.b'], lean: { toward: 'fail' } }, { target: ['.c'] }])])] }),
            status: 'done',
            health: CLEAN,
        });
        assert.match(md, /- Can't tell: 1 rules, 3 instances\n {2}- 2 likely fail, 1 needs a person/);
    });

    test('--fail-on-lean: new likely failures lead, after new failing instances', () => {
        const likely = { total: 3, known: 1, new: 2 };
        const clean = comparison({ summary: { occurrences: { new: 0, fixed: 0, still: 0 } } });
        const md = buildSummaryMarkdown({ payload: payload(), status: 'done', health: CLEAN, comparison: clean, likely });
        assert.match(md, /\*\*New likely failures to confirm\*\*/);
        assert.match(md, /- Likely failures \(--fail-on-lean\): 3, 2 new since the baseline/);
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: comparison().summary, likely }).key, 'regressed');
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: null, likely: { total: 0, known: 0, new: 0 } }).key, 'done');
    });

    test('--fail-on-failures: a run with failures and no baseline says so first', () => {
        const md = buildSummaryMarkdown({ payload: payload(), status: 'done', health: CLEAN, comparison: null, failing: 8 });
        assert.match(md, /\*\*Failing instances, and no baseline to compare with\*\*/);
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: null, failing: 0 }).key, 'done');
        // Failing instances with a baseline come from scans it couldn't be compared with.
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: { occurrences: { new: 0 } }, failing: 8, baseline: true }).key, 'notCompared');
        assert.equal(outcomeOf({ status: 'done', health: CLEAN, summary: null, failing: 8, baseline: true }).headline, 'Failing instances the baseline could not be compared with');
    });
});

describe('engine releases', () => {
    test('the comparison says when the baseline used another release of an engine', () => {
        const md = buildSummaryMarkdown({
            payload: payload(), status: 'done', health: CLEAN,
            comparison: comparison({ engineChanges: [{ name: 'surea11y', versions: ['1.13.1', '1.14.0'] }] }),
        });
        assert.match(md, /- The baseline and this run were made with different releases of surea11y \(1\.13\.1, 1\.14\.0\), so some differences may come from the engine rather than the pages/);
        assert.doesNotMatch(buildSummaryMarkdown({ payload: payload(), status: 'done', health: CLEAN, comparison: comparison() }), /different releases/);
    });
});
