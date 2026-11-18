'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const E = require('./scan-time-estimate.js');
const { planWorkflowSteps } = require('./workflow-step-plan.js');

const MIN = 60000;
const scan = () => ({ type: 'a11yScan' });
const click = () => ({ type: 'click' });

// Scans finishing every `every` ms, `n` of them.
const evenly = (n, every) => Array.from({ length: n }, (_, i) => (i + 1) * every);

describe('exactScanCount', () => {
    const count = (actions) => E.exactScanCount(planWorkflowSteps(actions));

    test('a linear workflow with two scans is certain', () => {
        assert.equal(count([click(), scan(), click(), scan()]), 2);
    });

    test('a workflow with no scans has no count', () => {
        assert.equal(count([click(), click()]), null);
    });

    test('a condition that only wraps clicks does not make it uncertain', () => {
        const actions = [scan(), { type: 'if', actions: [click()], elseActions: [click(), click()] }, scan()];
        assert.equal(count(actions), 2);
    });

    test('a condition with a scan on one side only is uncertain', () => {
        const actions = [scan(), { type: 'if', actions: [scan()], elseActions: [click()] }];
        assert.equal(count(actions), null);
    });

    test('a condition with the same scans on both sides is certain', () => {
        const actions = [{ type: 'if', actions: [scan()], elseActions: [click(), scan()] }];
        assert.equal(count(actions), 1);
    });

    test('a fixed repeat around a scan multiplies it', () => {
        const actions = [{ type: 'repeat', times: 5, actions: [scan()] }];
        assert.equal(count(actions), 5);
    });

    test('a loop with a limit is uncertain, since it can find fewer items', () => {
        const actions = [{ type: 'forEachElement', selector: 'a', limit: 10, actions: [scan()] }];
        assert.equal(count(actions), null);
    });

    test('a loop with no limit is uncertain', () => {
        const actions = [{ type: 'forEachElement', selector: 'a', actions: [scan()] }];
        assert.equal(count(actions), null);
    });

    test('a loop with no limit that holds no scan does not matter', () => {
        const actions = [scan(), { type: 'forEachElement', selector: 'a', actions: [click()] }];
        assert.equal(count(actions), 1);
    });

    test('disabled scans are not counted', () => {
        assert.equal(count([scan(), { type: 'a11yScan', disabled: true }]), 1);
    });

    test('no plan gives nothing', () => {
        assert.equal(E.exactScanCount(null), null);
        assert.equal(E.exactScanCount({}), null);
    });
});

describe('ownPace', () => {
    test('nothing done gives nothing', () => {
        assert.equal(E.ownPace([]), null);
        assert.equal(E.ownPace(undefined), null);
    });

    test('the first scan counts for half', () => {
        // First scan 90s (start-up), then 60s each: (90*.5 + 60 + 60) / 2.5 = 66s.
        const pace = E.ownPace([90000, 150000, 210000]);
        assert.equal(Math.round(pace.perScanMs), 66000);
        assert.equal(pace.scans, 3);
    });

    test('a long history is blended with the latest scans', () => {
        // 10 scans at 60s, then 3 at 120s: the latest five are 60,60,120,120,120.
        const times = [];
        let at = 0;
        for (let i = 0; i < 10; i += 1) { at += 60000; times.push(at); }
        for (let i = 0; i < 3; i += 1) { at += 120000; times.push(at); }
        const plain = E.ownPace(times.slice(0, 5)).perScanMs;
        const pace = E.ownPace(times).perScanMs;
        assert.equal(Math.round(plain), 60000);
        // Overall ~ 72.7s, recent 96s: a blend, above the overall mean.
        assert.ok(pace > 72000 && pace < 90000, String(pace));
    });
});

describe('priorFromRuns', () => {
    const run = (scans, durationMs, ok = true) => ({ scans, durationMs, ok });

    test('needs at least two finished runs', () => {
        assert.equal(E.priorFromRuns([]), null);
        assert.equal(E.priorFromRuns([run(20, 600000)]), null);
    });

    test('is the ratio of sums, so long runs count for more', () => {
        const prior = E.priorFromRuns([run(10, 300000), run(30, 1200000)]);
        assert.equal(prior.perScanMs, 1500000 / 40);
        assert.equal(prior.meanScans, 20);
        assert.equal(prior.meanDurationMs, 750000);
        assert.equal(prior.runs, 2);
    });

    test('leaves out failed and cancelled runs and runs with no scans', () => {
        const prior = E.priorFromRuns([run(20, 600000), run(20, 600000), run(3, 9000, false), run(0, 5000)]);
        assert.equal(prior.runs, 2);
    });

    test('two failed runs are not enough', () => {
        assert.equal(E.priorFromRuns([run(20, 600000, false), run(20, 600000, false), run(20, 600000)]), null);
    });
});

describe('estimateRun', () => {
    test('with no total it reports only what it measured', () => {
        const r = E.estimateRun({ completedAtMs: evenly(3, MIN) });
        assert.equal(r.state, E.STATE.NO_TOTAL);
        assert.equal(r.remainingMs, null);
        assert.equal(r.rangeMs, null);
        assert.equal(r.scansDone, 3);
        assert.equal(Math.round(r.perScanMs), 60000);
    });

    test('a bad total is the same as none', () => {
        for (const expectedScans of [0, -3, 2.5, NaN, null, undefined, '20']) {
            assert.equal(E.estimateRun({ expectedScans, completedAtMs: evenly(3, MIN) }).state, E.STATE.NO_TOTAL);
        }
    });

    test('warms up on one scan with no prior: start-up is not a pace', () => {
        const r = E.estimateRun({ expectedScans: 20, completedAtMs: [100000] });
        assert.equal(r.state, E.STATE.WARMING_UP);
        assert.equal(r.remainingMs, null);
        assert.equal(r.scansLeft, 19);
    });

    test('with no scan done and no prior it is warming up too', () => {
        const r = E.estimateRun({ expectedScans: 20, completedAtMs: [] });
        assert.equal(r.state, E.STATE.WARMING_UP);
    });

    test('estimates from its own pace once two scans are done', () => {
        const r = E.estimateRun({ expectedScans: 10, completedAtMs: evenly(2, MIN), elapsedMs: 2 * MIN });
        assert.equal(r.state, E.STATE.ESTIMATING);
        assert.equal(r.basis, E.BASIS.OWN);
        assert.equal(r.weightOwn, 1);
        assert.equal(r.scansLeft, 8);
        assert.equal(Math.round(r.remainingMs), 8 * MIN);
    });

    test('the time already spent on the scan in progress comes off', () => {
        const r = E.estimateRun({ expectedScans: 10, completedAtMs: evenly(2, MIN), elapsedMs: 2 * MIN + 20000 });
        assert.equal(Math.round(r.remainingMs), 8 * MIN - 20000);
    });

    test('a scan running late does not take more than one scan off', () => {
        const r = E.estimateRun({ expectedScans: 10, completedAtMs: evenly(2, MIN), elapsedMs: 2 * MIN + 5 * MIN });
        assert.equal(Math.round(r.remainingMs), 7 * MIN);
    });

    test('the range surrounds the estimate', () => {
        const r = E.estimateRun({ expectedScans: 10, completedAtMs: evenly(4, MIN), elapsedMs: 4 * MIN });
        assert.ok(r.rangeMs.low < r.remainingMs && r.remainingMs < r.rangeMs.high);
    });

    test('the range narrows as the run goes, for a number the workflow worked out', () => {
        const at = (done) => E.estimateRun({ expectedScans: 100, completedAtMs: evenly(done, MIN), elapsedMs: done * MIN, numberUncertainty: 0 });
        const minutes = (r) => (r.rangeMs.high - r.rangeMs.low) / MIN;
        assert.ok(minutes(at(20)) > minutes(at(60)));
        assert.ok(minutes(at(60)) > minutes(at(90)));
        // The share of what is left it stands for falls too, until the slack of a few scans takes over.
        const share = (r) => (r.rangeMs.high - r.remainingMs - 3 * MIN) / r.remainingMs;
        assert.ok(share(at(20)) > share(at(60)));
    });

    test('a typed number widens it, by the same number of scans however far the run is', () => {
        const calc = E.estimateRun({ expectedScans: 100, completedAtMs: evenly(50, MIN), elapsedMs: 50 * MIN, numberUncertainty: 0 });
        const typed = E.estimateRun({ expectedScans: 100, completedAtMs: evenly(50, MIN), elapsedMs: 50 * MIN });
        // 5% of 100 scans, at a minute each, on each side.
        assert.equal(Math.round((typed.rangeMs.high - calc.rangeMs.high) / MIN), 5);
        assert.equal(Math.round((calc.rangeMs.low - typed.rangeMs.low) / MIN), 5);
    });

    test('a not started run gets its first number from the prior', () => {
        const prior = { perScanMs: 30000, meanScans: 20, meanDurationMs: 600000, runs: 3, spread: 0.2 };
        const r = E.estimateRun({ expectedScans: 20, completedAtMs: [], prior });
        assert.equal(r.state, E.STATE.ESTIMATING);
        assert.equal(r.basis, E.BASIS.PRIOR);
        assert.equal(r.weightOwn, 0);
        assert.equal(r.remainingMs, 20 * 30000);
        assert.equal(r.priorRuns, 3);
    });

    test('its own pace takes over from the prior as scans are done', () => {
        const prior = { perScanMs: 30000, runs: 3, spread: 0.2 };
        // This run is slower: 60s per scan, first scan included.
        const at = (n) => E.estimateRun({
            expectedScans: 30,
            completedAtMs: evenly(n, MIN),
            elapsedMs: n * MIN,
            prior
        });
        const one = at(1);
        const three = at(3);
        const twelve = at(12);
        assert.equal(one.basis, E.BASIS.BLEND);
        assert.equal(one.weightOwn, 0.25);
        assert.equal(three.weightOwn, 0.5);
        assert.equal(twelve.weightOwn, 0.8);

        const perScan = (r) => r.remainingMs / r.scansLeft;
        assert.ok(perScan(one) < perScan(three));
        assert.ok(perScan(three) < perScan(twelve));
        assert.ok(perScan(twelve) < 60000 && perScan(twelve) > 50000);
    });

    test('a faster run is not held to the prior', () => {
        const prior = { perScanMs: 60000, runs: 4, spread: 0.2 };
        const r = E.estimateRun({
            expectedScans: 40,
            completedAtMs: evenly(30, 20000),
            elapsedMs: 30 * 20000,
            prior
        });
        const perScan = r.remainingMs / r.scansLeft;
        assert.ok(perScan < 30000, String(perScan));
    });

    test('a run that has not started has the widest range, as a share of what is left', () => {
        const prior = { perScanMs: 60000, runs: 3, spread: 0.4 };
        const fromPrior = E.estimateRun({ expectedScans: 100, completedAtMs: [], prior, numberUncertainty: 0 });
        const own = E.estimateRun({ expectedScans: 100, completedAtMs: evenly(50, MIN), elapsedMs: 50 * MIN, numberUncertainty: 0 });
        const width = (r) => (r.rangeMs.high - r.rangeMs.low) / r.remainingMs;
        assert.ok(width(fromPrior) > width(own));
    });

    test('reaching the expected number is not an estimate', () => {
        const r = E.estimateRun({ expectedScans: 3, completedAtMs: evenly(3, MIN) });
        assert.equal(r.state, E.STATE.REACHED);
        assert.equal(r.remainingMs, null);
        assert.equal(r.scansLeft, 0);
    });

    test('going past the expected number is said, not shown as a negative time', () => {
        const r = E.estimateRun({ expectedScans: 3, completedAtMs: evenly(4, MIN) });
        assert.equal(r.state, E.STATE.PAST);
        assert.equal(r.remainingMs, null);
        assert.equal(r.scansLeft, 0);
    });

    test('changing the total recalculates', () => {
        const times = evenly(4, MIN);
        const a = E.estimateRun({ expectedScans: 10, completedAtMs: times, elapsedMs: 4 * MIN });
        const b = E.estimateRun({ expectedScans: 20, completedAtMs: times, elapsedMs: 4 * MIN });
        assert.equal(Math.round(a.remainingMs), 6 * MIN);
        assert.equal(Math.round(b.remainingMs), 16 * MIN);
    });

    test('never gives a negative or non-finite time', () => {
        const r = E.estimateRun({ expectedScans: 5, completedAtMs: [0, 0], elapsedMs: 0 });
        assert.ok(r.remainingMs >= 0 && Number.isFinite(r.remainingMs));
    });

    test('ignores a prior with no usable pace', () => {
        const r = E.estimateRun({ expectedScans: 5, completedAtMs: [], prior: { perScanMs: 0 } });
        assert.equal(r.state, E.STATE.WARMING_UP);
    });
});

describe('estimateBatch', () => {
    const prior = { perScanMs: 30000, meanScans: 20, meanDurationMs: 600000, runs: 3, spread: 0.2 };
    const running = (remainingMs) => ({
        state: E.STATE.ESTIMATING,
        remainingMs,
        rangeMs: { low: remainingMs * 0.9, high: remainingMs * 1.1 }
    });

    test('shares the work over the runs that go at once', () => {
        const b = E.estimateBatch({ running: [], queued: [{ expectedScans: 20 }, { expectedScans: 20 }], prior, concurrency: 2 });
        assert.equal(b.state, E.STATE.ESTIMATING);
        assert.equal(b.remainingMs, 600000);
    });

    test('is never less than the longest run still going', () => {
        const b = E.estimateBatch({ running: [running(30 * MIN)], queued: [{ expectedScans: 2 }], prior, concurrency: 4 });
        assert.equal(b.remainingMs, 30 * MIN);
    });

    test('a queued run with no number is the average finished run', () => {
        const b = E.estimateBatch({ running: [], queued: [null], prior, concurrency: 1 });
        assert.equal(b.remainingMs, 600000);
    });

    test('a queued run with a number is that many scans at the prior pace', () => {
        const b = E.estimateBatch({ running: [], queued: [{ expectedScans: 10 }], prior, concurrency: 1 });
        assert.equal(b.remainingMs, 300000);
    });

    test('is unknown when a queued run has neither a number nor a prior', () => {
        const b = E.estimateBatch({ running: [], queued: [{ expectedScans: 10 }], prior: null, concurrency: 1 });
        assert.equal(b.state, 'unknown');
        assert.equal(b.remainingMs, null);
    });

    test('is unknown when a running run cannot be estimated yet', () => {
        const warming = E.estimateRun({ expectedScans: 20, completedAtMs: [100000] });
        const b = E.estimateBatch({ running: [warming], queued: [], prior, concurrency: 1 });
        assert.equal(b.state, 'unknown');
    });

    test('a run past its number adds nothing', () => {
        const past = E.estimateRun({ expectedScans: 3, completedAtMs: evenly(4, MIN) });
        const b = E.estimateBatch({ running: [past, running(5 * MIN)], queued: [], prior, concurrency: 2 });
        assert.equal(b.remainingMs, 5 * MIN);
    });

    test('an empty batch has nothing left', () => {
        const b = E.estimateBatch({ running: [], queued: [], prior: null, concurrency: 2 });
        assert.equal(b.state, E.STATE.ESTIMATING);
        assert.equal(b.remainingMs, 0);
    });

    test('the range surrounds the estimate', () => {
        const b = E.estimateBatch({ running: [running(4 * MIN)], queued: [{ expectedScans: 20 }], prior, concurrency: 2 });
        assert.ok(b.rangeMs.low <= b.remainingMs && b.remainingMs <= b.rangeMs.high);
    });
});

describe('formatRemaining', () => {
    test('says under a minute for short times', () => {
        assert.equal(E.formatRemaining(0), 'under a minute');
        assert.equal(E.formatRemaining(44000), 'under a minute');
    });

    test('rounds to minutes', () => {
        assert.equal(E.formatRemaining(46000), 'about 1 min');
        assert.equal(E.formatRemaining(6 * MIN + 20000), 'about 6 min');
        assert.equal(E.formatRemaining(59 * MIN), 'about 59 min');
    });

    test('goes to hours and rounds to five minutes', () => {
        assert.equal(E.formatRemaining(85 * MIN), 'about 1 h 25 min');
        assert.equal(E.formatRemaining(87 * MIN), 'about 1 h 25 min');
        assert.equal(E.formatRemaining(120 * MIN), 'about 2 h');
    });

    test('gives nothing for a time that is not one', () => {
        for (const bad of [null, undefined, NaN, -1, Infinity]) assert.equal(E.formatRemaining(bad), '');
    });
});

describe('formatRange', () => {
    test('writes minutes', () => {
        assert.equal(E.formatRange({ low: 5 * MIN, high: 8 * MIN }), '5 to 8 min');
    });

    test('is empty when both ends round alike or are short', () => {
        assert.equal(E.formatRange({ low: 5.1 * MIN, high: 5.3 * MIN }), '');
        assert.equal(E.formatRange({ low: 10000, high: 30000 }), '');
    });

    test('is empty past an hour, where "about" says it better', () => {
        assert.equal(E.formatRange({ low: 50 * MIN, high: 70 * MIN }), '');
    });

    test('is empty for no range', () => {
        assert.equal(E.formatRange(null), '');
    });
});

describe('effectiveExpectedScans', () => {
    const plan = (actions) => planWorkflowSteps(actions);

    test('the number the person gave wins over the one the workflow works out', () => {
        assert.equal(E.effectiveExpectedScans({ expectedScans: 7, plan: plan([scan(), scan()]) }), 7);
        assert.equal(E.effectiveExpectedScans({ expectedScans: '7', plan: plan([scan(), scan()]) }), 7);
    });

    test('with none, a workflow that cannot vary its scans gives its own', () => {
        assert.equal(E.effectiveExpectedScans({ plan: plan([scan(), click(), scan()]) }), 2);
        assert.equal(E.effectiveExpectedScans({ expectedScans: '', plan: plan([scan()]) }), 1);
    });

    test('a number that is not one is ignored', () => {
        for (const bad of [0, -1, 2.5, 'many', NaN]) {
            assert.equal(E.effectiveExpectedScans({ expectedScans: bad, plan: plan([scan()]) }), 1, String(bad));
        }
    });

    test('with none and an uncertain workflow there is no total', () => {
        const uncertain = plan([{ type: 'forEachElement', selector: 'a', actions: [scan()] }]);
        assert.equal(E.effectiveExpectedScans({ plan: uncertain }), null);
        assert.equal(E.effectiveExpectedScans({}), null);
    });
});

describe('describeBasis', () => {
    test('says where an estimate comes from', () => {
        assert.match(E.describeBasis({ basis: E.BASIS.OWN, priorRuns: 0 }), /this run have taken/);
        assert.match(E.describeBasis({ basis: E.BASIS.PRIOR, priorRuns: 3 }), /3 finished runs of this workflow/);
        assert.match(E.describeBasis({ basis: E.BASIS.PRIOR, priorRuns: 1 }), /1 finished run of this workflow/);
        assert.match(E.describeBasis({ basis: E.BASIS.BLEND, priorRuns: 2 }), /this run have taken, with 2 finished runs/);
    });

    test('says nothing when there is no basis', () => {
        assert.equal(E.describeBasis({ basis: E.BASIS.NONE, priorRuns: 0 }), '');
        assert.equal(E.describeBasis(null), '');
    });
});

describe('estimateFromCounts', () => {
    const prior = { perScanMs: 30000, meanScans: 20, meanDurationMs: 600000, runs: 3, spread: 0.2 };

    test('takes the pace from the time up to the last scan over the scans done', () => {
        // 4 scans in 4 min, the last one finished 30 s ago: 3.5 min / 4 scans.
        const r = E.estimateFromCounts({ expectedScans: 10, scansDone: 4, elapsedMs: 4 * MIN, sinceScanMs: 30000 });
        assert.equal(r.state, E.STATE.ESTIMATING);
        assert.equal(r.basis, E.BASIS.OWN);
        const perScan = 3.5 * MIN / 4;
        assert.equal(Math.round(r.remainingMs), Math.round(6 * perScan - 30000));
    });

    test('the range is the same as for a run that knows when each scan finished', () => {
        const counts = E.estimateFromCounts({ expectedScans: 10, scansDone: 4, elapsedMs: 4 * MIN, sinceScanMs: 0 });
        const times = E.estimateRun({ expectedScans: 10, completedAtMs: evenly(4, MIN), elapsedMs: 4 * MIN });
        assert.equal(Math.round(counts.rangeMs.high - counts.remainingMs), Math.round(times.rangeMs.high - times.remainingMs));
    });

    test('a number the workflow worked out has no margin for the number', () => {
        const typed = E.estimateFromCounts({ expectedScans: 10, scansDone: 4, elapsedMs: 4 * MIN, sinceScanMs: 0 });
        const calc = E.estimateFromCounts({ expectedScans: 10, scansDone: 4, elapsedMs: 4 * MIN, sinceScanMs: 0, numberUncertainty: 0 });
        assert.ok(calc.rangeMs.high < typed.rangeMs.high);
    });

    test('a run that has not started takes its number from the prior', () => {
        const r = E.estimateFromCounts({ expectedScans: 10, scansDone: 0, prior });
        assert.equal(r.basis, E.BASIS.PRIOR);
        assert.equal(r.remainingMs, 10 * 30000);
    });

    test('blends the run\'s pace with the prior as scans are done', () => {
        const r = E.estimateFromCounts({ expectedScans: 30, scansDone: 3, elapsedMs: 3 * MIN, sinceScanMs: 0, prior });
        assert.equal(r.basis, E.BASIS.BLEND);
        assert.equal(r.weightOwn, 0.5);
    });

    test('with no prior it waits for two scans', () => {
        const one = E.estimateFromCounts({ expectedScans: 10, scansDone: 1, elapsedMs: MIN, sinceScanMs: 0 });
        assert.equal(one.state, E.STATE.WARMING_UP);
        const two = E.estimateFromCounts({ expectedScans: 10, scansDone: 2, elapsedMs: 2 * MIN, sinceScanMs: 0 });
        assert.equal(two.state, E.STATE.ESTIMATING);
    });

    test('says reached and past like estimateRun does', () => {
        assert.equal(E.estimateFromCounts({ expectedScans: 3, scansDone: 3, elapsedMs: 3 * MIN }).state, E.STATE.REACHED);
        assert.equal(E.estimateFromCounts({ expectedScans: 3, scansDone: 4, elapsedMs: 4 * MIN }).state, E.STATE.PAST);
    });

    test('with no total it has no time', () => {
        const r = E.estimateFromCounts({ scansDone: 4, elapsedMs: 4 * MIN });
        assert.equal(r.state, E.STATE.NO_TOTAL);
        assert.equal(r.remainingMs, null);
    });

    test('bad numbers are no scans and no time', () => {
        const r = E.estimateFromCounts({ expectedScans: 5, scansDone: NaN, elapsedMs: -5, prior });
        assert.equal(r.scansDone, 0);
        assert.equal(r.state, E.STATE.ESTIMATING);
    });
});

describe('estimateBatch with a prior of its own for each queued run', () => {
    const fast = { perScanMs: 10000, meanDurationMs: 100000, spread: 0.1, runs: 2 };
    const slow = { perScanMs: 60000, meanDurationMs: 600000, spread: 0.1, runs: 2 };

    test('a queued run reads its own workflow\'s prior before the batch\'s', () => {
        const b = E.estimateBatch({
            running: [],
            queued: [{ expectedScans: 10, prior: fast }, { expectedScans: 10, prior: slow }],
            prior: null,
            concurrency: 1
        });
        assert.equal(b.state, E.STATE.ESTIMATING);
        assert.equal(b.remainingMs, 10 * 10000 + 10 * 60000);
    });

    test('a queued run with no number is the mean run of its own workflow', () => {
        const b = E.estimateBatch({ running: [], queued: [{ prior: slow }], prior: fast, concurrency: 1 });
        assert.equal(b.remainingMs, 600000);
    });
});

describe('rangeAround', () => {
    const MINUTE = 60000;

    test('is a share of the time left, a few scans of slack, and the margin for a typed number', () => {
        // 100 of 100 scans left at a minute each: 25% of 100 minutes, 3 minutes of slack.
        const r = E.rangeAround(100 * MINUTE, MINUTE, 100, 100, 0);
        assert.equal(r.high - 100 * MINUTE, 28 * MINUTE);
        assert.equal(100 * MINUTE - r.low, 28 * MINUTE);
        // A typed number of 100 scans may be 5 off, on top.
        const typed = E.rangeAround(100 * MINUTE, MINUTE, 100, 100);
        assert.equal(typed.high - 100 * MINUTE, 33 * MINUTE);
    });

    test('the share shrinks with the square root of the scans left, between its floor and ceiling', () => {
        const rel = (left) => {
            const r = E.rangeAround(left * MINUTE, MINUTE, left, 100, 0);
            return (r.high - left * MINUTE - 3 * MINUTE) / (left * MINUTE);
        };
        assert.ok(Math.abs(rel(100) - 0.25) < 1e-9);
        assert.ok(Math.abs(rel(25) - 0.125) < 1e-9);
        assert.ok(Math.abs(rel(1) - 0.05) < 1e-9, 'not below its floor');
    });

    test('never goes below nothing', () => {
        assert.equal(E.rangeAround(MINUTE, MINUTE, 1, 100, 0.05).low, 0);
    });

    test('with no expected number it still gives a range', () => {
        const r = E.rangeAround(MINUTE, MINUTE, 1, 0, 0);
        assert.ok(Number.isFinite(r.high) && r.high >= MINUTE);
    });
});

describe('resolveExpectedScans', () => {
    const plan = (actions) => planWorkflowSteps(actions);

    test('a typed number is a guess, a worked out one is exact', () => {
        assert.deepEqual(E.resolveExpectedScans({ expectedScans: 7, plan: plan([scan(), scan()]) }), { count: 7, exact: false });
        assert.deepEqual(E.resolveExpectedScans({ expectedScans: '7' }), { count: 7, exact: false });
        assert.deepEqual(E.resolveExpectedScans({ plan: plan([scan(), scan()]) }), { count: 2, exact: true });
    });

    test('with neither there is none', () => {
        assert.deepEqual(E.resolveExpectedScans({}), { count: null, exact: false });
        assert.deepEqual(E.resolveExpectedScans({ expectedScans: 'many' }), { count: null, exact: false });
    });
});
