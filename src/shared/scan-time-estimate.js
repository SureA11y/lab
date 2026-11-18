'use strict';

/**
 * scan-time-estimate.js (shared)
 *
 * "How long is this run still going to take?", from what is known so far.
 *
 * Pure functions, no clock and no DOM: the caller passes the numbers in, so the
 * live panel, the queue table and the CLI line all call the same code and it
 * is tested without timers.
 *
 * What an estimate stands on
 * --------------------------
 * - The number of scans the run is expected to do. It comes from the person
 *   (`expectedScans` in the workflow config) or, when the workflow cannot vary
 *   it, from the plan (see exactScanCount). A workflow whose scan count depends
 *   on conditions or on how many items a loop finds has no honest total, and
 *   then no time estimate is made: the run only reports what it measured.
 * - The time each scan has taken so far, measured between scan completions on
 *   an *active* clock (the caller leaves paused time out). Measuring between
 *   completions means the clicks and navigation between scans are counted
 *   without being modelled. The first scan carries start-up (browser, login,
 *   first load), so it counts for half.
 * - Optionally, a prior: how long the same workflow took in finished runs of
 *   the same batch. It is where a run that has not started, or has just
 *   started, gets its first number. As the run does scans, its own pace takes
 *   over: its weight is done / (done + PRIOR_STRENGTH), so a run that turns out
 *   faster (fewer issues found, say) is not held to what the others did.
 *
 * The result always says how it was reached (`basis`) so a UI can show it.
 *
 * How many scans a run has left, where no one can say ahead (a loop whose
 * size the page decides, an `if` around a scan), comes from the run itself:
 * createRunEstimator follows the engine's "item k of n" for each loop and
 * counts the scans each iteration took, and the plan says what the steps after
 * the loop will run. The loops give the count and the scans give the pace. A
 * loop's own time per iteration is not used for the pace: iterations differ in
 * size (a category of one book, the next of twenty), where the time a scan
 * takes hardly moves. On real runs of a 205-scan workflow over 13 uneven
 * categories, the time per iteration was 23% off at the median; the scans
 * left, counted this way, times the scan pace, about 7%.
 *
 * Browser: available as globalThis.A11Y_SCAN_TIME_ESTIMATE.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_TIME_ESTIMATE = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // The first scan includes start-up, so it counts for this share of a
    // normal one when the run's pace is averaged.
    const FIRST_SCAN_WEIGHT = 0.5;

    // How many scans a run's own pace is worth, in prior scans: with this many
    // done, the run and the prior count equally.
    const PRIOR_STRENGTH = 3;

    // Without a prior, wait for this many scans before saying anything: one
    // scan is mostly start-up.
    const MIN_OWN_SCANS = 2;

    // A prior needs this many finished runs behind it.
    const MIN_PRIOR_RUNS = 2;

    // Past this many scans the pace blends the whole run with the latest few,
    // so a slow stretch moves the estimate without a long history hiding it.
    const RECENT_SCANS = 5;

    // The range around the estimate of a run (rangeAround), measured on 25
    // real runs of about 600 scans: how far the estimate was from the time that
    // was left. It is a share of the time left that shrinks as the run goes
    // (SPREAD_K times the square root of the share of scans left, at least
    // SPREAD_MIN and at most SPREAD_MAX), a few scans of slack, and, when the
    // number of scans was typed, a margin for the number being a little off.
    // The error of a long run is nowhere near the scatter of single scans (a
    // run is a sum of hundreds of them), so that scatter is not what it uses.
    const SPREAD_K = 0.25;
    const SPREAD_MIN = 0.05;
    const SPREAD_MAX = 0.5;
    const SLACK_SCANS = 3;
    // A typed number is a guess, often a round one: on the same runs, a number
    // 12% off left the real time outside a 5% margin a quarter to two fifths
    // of the time.
    const NUMBER_UNCERTAINTY = 0.15;
    // The last run of the same workflow did a number of scans; the next one
    // usually does the same, give or take what the site changed.
    const LAST_RUN_UNCERTAINTY = 0.05;

    // The range around what a run that has not started will take, from the
    // finished runs of its workflow (estimateBatch).
    const BATCH_SPREAD_MIN = 0.1;
    const SPREAD_NO_HISTORY = 0.3;

    // The outermost loop counts for the scans left once this many of its
    // iterations are done, unless the plan says how many scans each one runs:
    // the first iteration alone says little of the others.
    const MIN_LOOP_ITERATIONS = 2;

    // How many iteration scan counts a loop keeps, for the scatter among them.
    const LOOP_COUNTS_KEPT = 200;

    // A number given (typed, or the last run's) is kept while it is within this
    // share of the count from the loops: it is then the better of the two. Past
    // it, the count wins. On the runs above, a number 5 to 27% off then cost
    // 8 to 10% (the count's own error), where the right number gave 3%.
    const AGREE_SHARE = 0.05;

    // How far a count from the loops may be off, in scans: this many standard
    // deviations of the scans per iteration, over the iterations to come.
    const COUNT_SLACK_SD = 0.5;

    const BASIS = Object.freeze({
        NONE: 'none',
        PRIOR: 'prior',
        OWN: 'own',
        BLEND: 'blend'
    });

    // Where the number of scans an estimate stands on comes from.
    const COUNT = Object.freeze({
        // Typed by the person (expectedScans).
        TYPED: 'typed',
        // What the last run of the same workflow did.
        LAST_RUN: 'last-run',
        // The workflow is certain to run it, or the plan counts it.
        PLAN: 'plan',
        // The loops so far, and the plan for the steps after them.
        LOOPS: 'loops'
    });

    const STATE = Object.freeze({
        // No usable total: only measurements, no time estimate.
        NO_TOTAL: 'no-total',
        // A total, but not enough evidence to put a time on it yet.
        WARMING_UP: 'warming-up',
        // A time estimate.
        ESTIMATING: 'estimating',
        // As many scans as expected are done; the time to the end is not known.
        REACHED: 'reached',
        // More scans than expected are done.
        PAST: 'past'
    });

    function isCount(n) {
        return Number.isFinite(n) && n > 0 && Math.floor(n) === n;
    }

    function mean(values) {
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    function clamp(n, lo, hi) {
        return Math.min(hi, Math.max(lo, n));
    }

    /** Coefficient of variation: how large the scatter is next to the average. */
    function variation(values) {
        if (values.length < 2) return null;
        const avg = mean(values);
        if (!(avg > 0)) return null;
        const variance = mean(values.map((v) => (v - avg) * (v - avg)));
        return Math.sqrt(variance) / avg;
    }

    /**
     * The scan count a workflow is certain to run, or null.
     *
     * Certain means every path through the workflow runs the same number of
     * scans: the plan's minimum and maximum agree, and no loop around a scan
     * has an unknown size. Steps that are not scans do not matter, so a
     * condition that only wraps clicks still counts as certain, and a repeat
     * with a fixed count around one scan gives exactly that count.
     *
     * `plan` is what planWorkflowSteps returns.
     */
    function exactScanCount(plan, type = 'a11yScan') {
        if (!plan || !plan.byType) return null;
        const slot = plan.byType[type];
        if (!slot || !isCount(slot.max) || slot.min !== slot.max || slot.unsized) return null;

        const loops = Array.isArray(plan.unsizedLoops) ? plan.unsizedLoops : [];
        for (const loop of loops) {
            const per = loop && loop.perIterationByType;
            if (per && per[type] > 0) return null;
        }
        return slot.max;
    }

    /**
     * The scan count a run is expected to do and where it comes from:
     * {count, exact}, or {count: null, exact: false}. The number the person
     * gave wins, since they may know a branch hardly ever runs; it is a guess,
     * so `exact` is false. Else the one the workflow is certain to run, which is
     * exact. `plan` is what planWorkflowSteps returns.
     */
    function resolveExpectedScans({ expectedScans = null, plan = null, type = 'a11yScan' } = {}) {
        const given = typeof expectedScans === 'string' && /^\s*\d+\s*$/.test(expectedScans)
            ? Number(expectedScans)
            : expectedScans;
        if (isCount(given)) return { count: given, exact: false };
        const certain = exactScanCount(plan, type);
        return certain ? { count: certain, exact: true } : { count: null, exact: false };
    }

    /** The scan count a run is expected to do, or null (see resolveExpectedScans). */
    function effectiveExpectedScans(input = {}) {
        return resolveExpectedScans(input).count;
    }

    /**
     * The range around a time left worked out from the scans still to run:
     * {low, high}, in ms. `numberUncertainty` is how far off the expected
     * number of scans may be, as a share of it (0 for a number the workflow
     * worked out, NUMBER_UNCERTAINTY for one that was typed). It is slack in
     * scans, so it is the same however far the run is, and ever larger next to
     * a time left that is shrinking: the end of a run is where a wrong number
     * shows. `slackScans` is more slack, in scans: how far a count from the
     * loops may be off.
     */
    function rangeAround(remainingMs, perScanMs, scansLeft, expectedScans, numberUncertainty = NUMBER_UNCERTAINTY, slackScans = 0) {
        const share = expectedScans > 0 ? Math.min(1, scansLeft / expectedScans) : 1;
        const relative = clamp(SPREAD_K * Math.sqrt(share), SPREAD_MIN, SPREAD_MAX);
        const half = relative * remainingMs
            + perScanMs * SLACK_SCANS
            + numberUncertainty * expectedScans * perScanMs
            + Math.max(0, Number.isFinite(slackScans) ? slackScans : 0) * perScanMs;
        return { low: Math.max(0, remainingMs - half), high: remainingMs + half };
    }

    /**
     * The run's own time per scan, in ms, or null before any scan finished.
     *
     * `completedAtMs` are the active-clock times (ms since the run started,
     * paused time left out) at which each scan finished, oldest first.
     */
    function ownPace(completedAtMs) {
        const times = Array.isArray(completedAtMs) ? completedAtMs.filter(Number.isFinite) : [];
        if (!times.length) return null;

        const intervals = [];
        let before = 0;
        for (const at of times) {
            intervals.push(Math.max(0, at - before));
            before = at;
        }

        let weighted = 0;
        let weights = 0;
        intervals.forEach((ms, i) => {
            const w = i === 0 ? FIRST_SCAN_WEIGHT : 1;
            weighted += ms * w;
            weights += w;
        });
        let perScanMs = weighted / weights;

        if (intervals.length > RECENT_SCANS) {
            perScanMs = (perScanMs + mean(intervals.slice(-RECENT_SCANS))) / 2;
        }

        // The first scan is left out of the scatter: it is known to be long.
        const cv = variation(intervals.length > 2 ? intervals.slice(1) : intervals);
        return { perScanMs, scans: intervals.length, variation: cv };
    }

    /**
     * What finished runs of the same workflow say about the next one, or null
     * when there are too few to say anything.
     *
     * `runs` are {scans, durationMs, ok}; failed and cancelled runs (ok false)
     * say nothing about a full run and are left out. The caller decides which
     * runs count as "the same workflow"; this only does the arithmetic.
     */
    function priorFromRuns(runs) {
        const usable = (Array.isArray(runs) ? runs : [])
            .filter((r) => r && r.ok !== false && isCount(r.scans) && r.durationMs > 0);
        if (usable.length < MIN_PRIOR_RUNS) return null;

        const totalScans = usable.reduce((sum, r) => sum + r.scans, 0);
        const totalMs = usable.reduce((sum, r) => sum + r.durationMs, 0);
        const spread = variation(usable.map((r) => r.durationMs / r.scans));

        return {
            // Ratio of sums: a long run counts for more than a short one.
            perScanMs: totalMs / totalScans,
            meanScans: totalScans / usable.length,
            meanDurationMs: totalMs / usable.length,
            runs: usable.length,
            spread
        };
    }

    /**
     * estimateRun({expectedScans, completedAtMs, elapsedMs, prior})
     *
     * `expectedScans`  how many scans the run is expected to do, or null
     * `completedAtMs`  active-clock time of each finished scan, oldest first
     * `elapsedMs`      active-clock time now (defaults to the last scan's)
     * `prior`          priorFromRuns(...), or null
     * `numberUncertainty`  how far off the expected number may be, as a share of
     *                it: 0 for a number the workflow worked out (resolveExpectedScans
     *                says), the default for a typed one
     * `slackScans`   how many scans a counted number may be off by, for the range
     *
     * A caller that only knows counts, not each scan's time, passes `scansDone`,
     * `lastScanAtMs` and `pace` ({perScanMs, scans, variation}) in their place;
     * see estimateFromCounts.
     *
     * Returns {state, basis, scansDone, expectedScans, scansLeft, perScanMs,
     * remainingMs, rangeMs, weightOwn, priorRuns}. `remainingMs` and `rangeMs`
     * are null unless the state is 'estimating'.
     */
    function estimateRun(input = {}) {
        const times = Array.isArray(input.completedAtMs) ? input.completedAtMs.filter(Number.isFinite) : [];
        const given = input.pace && input.pace.perScanMs > 0 ? input.pace : null;
        const own = given || ownPace(times);
        const prior = input.prior && input.prior.perScanMs > 0 ? input.prior : null;
        const scansDone = Number.isInteger(input.scansDone) && input.scansDone >= 0 ? input.scansDone : times.length;
        const expectedScans = isCount(input.expectedScans) ? input.expectedScans : null;

        let weightOwn = 0;
        let perScanMs = null;
        let basis = BASIS.NONE;
        if (own && prior) {
            weightOwn = scansDone / (scansDone + PRIOR_STRENGTH);
            perScanMs = weightOwn * own.perScanMs + (1 - weightOwn) * prior.perScanMs;
            basis = BASIS.BLEND;
        } else if (own && scansDone >= MIN_OWN_SCANS) {
            weightOwn = 1;
            perScanMs = own.perScanMs;
            basis = BASIS.OWN;
        } else if (prior) {
            perScanMs = prior.perScanMs;
            basis = BASIS.PRIOR;
        }

        const result = {
            state: STATE.NO_TOTAL,
            basis,
            scansDone,
            expectedScans,
            scansLeft: null,
            // What the run has measured, shown even without a total.
            perScanMs: own ? own.perScanMs : null,
            remainingMs: null,
            rangeMs: null,
            weightOwn,
            priorRuns: prior ? prior.runs : 0
        };

        if (expectedScans == null) return result;

        result.scansLeft = Math.max(0, expectedScans - scansDone);
        if (scansDone > expectedScans) {
            result.state = STATE.PAST;
            return result;
        }
        if (scansDone === expectedScans) {
            result.state = STATE.REACHED;
            return result;
        }
        if (perScanMs == null) {
            result.state = STATE.WARMING_UP;
            return result;
        }

        const lastAt = Number.isFinite(input.lastScanAtMs)
            ? input.lastScanAtMs
            : (times.length ? times[times.length - 1] : 0);
        const elapsedMs = Number.isFinite(input.elapsedMs) ? Math.max(input.elapsedMs, lastAt) : lastAt;
        const sinceLast = elapsedMs - lastAt;

        // The scan in progress has already used part of its time. Once it runs
        // past the average it is simply late: the scans after it are still due.
        const floor = (result.scansLeft - 1) * perScanMs;
        const remainingMs = Math.max(result.scansLeft * perScanMs - sinceLast, floor);

        result.state = STATE.ESTIMATING;
        result.perScanMs = own ? own.perScanMs : perScanMs;
        result.remainingMs = remainingMs;
        result.rangeMs = rangeAround(
            remainingMs, perScanMs, result.scansLeft, expectedScans,
            Number.isFinite(input.numberUncertainty) ? input.numberUncertainty : NUMBER_UNCERTAINTY,
            input.slackScans
        );
        return result;
    }

    /**
     * estimateRun for a caller that knows how many scans are done and how long
     * the run has been going, but not when each scan finished: the queue's rows,
     * which the server describes that way. The pace is the time up to the last
     * scan over the scans done, so the start-up counts in it as it does not in
     * estimateRun, and there is no scatter to widen the range with.
     *
     * {expectedScans, scansDone, elapsedMs, sinceScanMs, prior}; `sinceScanMs`
     * is the time since the last scan finished, when known.
     */
    function estimateFromCounts({ expectedScans = null, scansDone = 0, elapsedMs = null, sinceScanMs = null, prior = null, numberUncertainty } = {}) {
        const done = Number.isFinite(scansDone) && scansDone > 0 ? Math.floor(scansDone) : 0;
        const elapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null;
        let lastScanAtMs = null;
        let pace = null;
        if (done > 0 && elapsed != null) {
            lastScanAtMs = Math.max(0, elapsed - (Number.isFinite(sinceScanMs) && sinceScanMs >= 0 ? sinceScanMs : 0));
            if (lastScanAtMs > 0) pace = { perScanMs: lastScanAtMs / done, scans: done, variation: null };
        }
        return estimateRun({
            expectedScans,
            scansDone: done,
            completedAtMs: [],
            lastScanAtMs: lastScanAtMs == null ? 0 : lastScanAtMs,
            elapsedMs: elapsed == null ? 0 : elapsed,
            pace,
            prior,
            numberUncertainty
        });
    }

    /**
     * estimateBatch({running, queued, prior, concurrency})
     *
     * `running`      estimateRun results for the runs going now, each with the
     *                `elapsedMs` it has been going when known
     * `queued`       [{expectedScans, prior?}] for the runs not started, null where
     *                unknown; a run's own `prior` (its workflow's) wins over the batch's
     * `prior`        priorFromRuns(...) for runs with no number of their own
     * `concurrency`  how many runs go at once (the queue's setting)
     *
     * When the batch ends: the runs are scheduled as the queue does. Each slot
     * is free when the run in it ends, and the next waiting run takes the first
     * slot to free up and runs its time; the batch ends with the last. Sharing
     * the work out evenly over the slots, as this did, is wrong whenever the
     * waiting runs do not fill them: nine runs in eight slots end when the
     * first run ends plus the ninth's own time, not at a ninth of the work.
     *
     * What a waiting run takes: from the finished runs of its workflow (its
     * `prior`, else the batch's); with none, from the runs going now, by their
     * pace for a run with a number of scans, else by the time they are projected
     * to take. A batch with a waiting run and nothing to go on is
     * 'unknown'. Returns {state, remainingMs, rangeMs, queued, priorRuns};
     * `queued` gives each waiting run, in order, {startsInMs, remainingMs,
     * rangeMs}: when it should start, and the time until it ends.
     */
    function estimateBatch(input = {}) {
        const running = Array.isArray(input.running) ? input.running : [];
        const queued = Array.isArray(input.queued) ? input.queued : [];
        const prior = input.prior && input.prior.perScanMs > 0 ? input.prior : null;
        const slots = isCount(input.concurrency) ? input.concurrency : Math.max(1, running.length);

        // When each slot is free: the runs going now, as the time they have left.
        const free = { mid: [], low: [], high: [] };
        const projected = [];
        const paces = [];
        for (const run of running) {
            if (!run || run.remainingMs == null) {
                // A run at or past its number is about to end: no time to add.
                if (run && (run.state === STATE.REACHED || run.state === STATE.PAST)) {
                    free.mid.push(0); free.low.push(0); free.high.push(0);
                    continue;
                }
                return unknownBatch(prior);
            }
            free.mid.push(run.remainingMs);
            free.low.push(run.rangeMs.low);
            free.high.push(run.rangeMs.high);
            if (Number.isFinite(run.elapsedMs)) projected.push(run.elapsedMs + run.remainingMs);
            if (run.perScanMs > 0) paces.push(run.perScanMs);
        }
        // What the runs going now say of the ones waiting, when there is no prior.
        const nowPace = paces.length ? mean(paces) : null;
        const nowLength = projected.length ? mean(projected) : null;

        const durations = { mid: [], low: [], high: [] };
        for (const item of queued) {
            const scans = item && isCount(item.expectedScans) ? item.expectedScans : null;
            const own = item && item.prior && item.prior.perScanMs > 0 ? item.prior : prior;
            let ms = null;
            let spread = SPREAD_NO_HISTORY;
            if (own) {
                ms = scans != null ? scans * own.perScanMs : own.meanDurationMs;
                spread = clamp(own.spread != null ? own.spread : SPREAD_NO_HISTORY, BATCH_SPREAD_MIN, SPREAD_MAX);
            } else if (scans != null && nowPace != null) {
                ms = scans * nowPace;
            } else if (nowLength != null) {
                // A run with no number, or none to put at their pace (a loop has no pace per scan).
                ms = nowLength;
            }
            if (ms == null) return unknownBatch(prior);
            durations.mid.push(ms);
            durations.low.push(ms * (1 - spread));
            durations.high.push(ms * (1 + spread));
        }

        // Each waiting run, in order, takes the slot that frees first: when it
        // starts and when it ends, and the batch ends with the last slot.
        const schedule = (freeAt, durs) => {
            const slotsAt = freeAt.slice();
            while (slotsAt.length < slots) slotsAt.push(0);
            const runs = [];
            for (const d of durs) {
                slotsAt.sort((x, y) => x - y);
                const startsAt = slotsAt[0];
                slotsAt[0] += d;
                runs.push({ startsAt, endsAt: slotsAt[0] });
            }
            return { end: Math.max(0, ...slotsAt), runs };
        };
        const mid = schedule(free.mid, durations.mid);
        const low = schedule(free.low, durations.low);
        const high = schedule(free.high, durations.high);
        return {
            state: STATE.ESTIMATING,
            remainingMs: mid.end,
            rangeMs: { low: low.end, high: high.end },
            // For each waiting run, in the order given: when it is expected to
            // start, and the time until it ends, its wait included.
            queued: mid.runs.map((r, i) => ({
                startsInMs: r.startsAt,
                remainingMs: r.endsAt,
                rangeMs: { low: low.runs[i].endsAt, high: high.runs[i].endsAt }
            })),
            priorRuns: prior ? prior.runs : 0
        };
    }

    function unknownBatch(prior) {
        return { state: 'unknown', remainingMs: null, rangeMs: null, priorRuns: prior ? prior.runs : 0 };
    }

    /** Whether the loop at `child` is inside the one at `parent` (paths as the engine numbers them). */
    function isInsideLoop(child, parent) {
        return child !== parent && (child.startsWith(parent + '.') || child.startsWith(parent + '::'));
    }

    function stdDev(values) {
        if (values.length < 2) return 0;
        const avg = mean(values);
        return Math.sqrt(mean(values.map((v) => (v - avg) * (v - avg))));
    }

    /**
     * The time left of one run, from its log entries as they arrive: used by the
     * CLI line, the app's live panel and the queue alike.
     *
     * createRunEstimator({plan, expectedScans, lastRunScans, prior, type})
     *   `plan`          planWorkflowSteps(...) for the run's workflow
     *   `expectedScans` the number typed, if any
     *   `lastRunScans`  how many scans the last run of the same workflow did, if known
     *   `prior`         priorFromRuns(...) of finished runs of the same workflow, or null
     *
     * accept(entry): a log entry ({time, extra: {stepEvent, actionPath,
     * actionType, index, total}}). Scans are the `type` actions that end or
     * fail; the workflow's own steps, its loops and their iterations are
     * followed from the step events. Other entries only move the clock.
     *
     * estimate(nowMs): estimateRun's result, with `count` (where the number of
     * scans comes from: COUNT), `approximate` (the number was counted, not
     * given or certain), `loop` ({path, iteration, total, done} of the
     * outermost loop running, or null) and `loopScans` (the number the loops
     * point to, when they point to one). Null when there is nothing to go on.
     * `nowMs` is on the clock of the entries' times.
     *
     * How many scans the run will do:
     * - Counted from the run as it goes: the scans done, the scans left in the
     *   outermost loop running (this iteration's, from its inner loops or what
     *   its iterations took, and the iterations to come at the scans per
     *   finished iteration, or as the plan says when each runs a fixed number),
     *   and the scans the plan has in the steps after it. While the outermost
     *   loop has fewer than two finished iterations and the plan cannot say
     *   what each runs, there is no count: the first iteration is no guide to
     *   the others.
     * - A number given (typed, the last run's, or one the workflow is certain
     *   to run) is used while there is no count, and kept while it agrees with
     *   the count; where they disagree, the count wins.
     * The time is the scans left at the run's own pace per scan (estimateRun).
     */
    function createRunEstimator(options = {}) {
        const type = options.type || 'a11yScan';
        const plan = options.plan && typeof options.plan === 'object' ? options.plan : null;
        const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
        const stepIndex = new Map(steps.map((step, i) => [step.path, i]));
        const nodes = (plan && plan.nodes) || {};
        const prior = options.prior && options.prior.perScanMs > 0 ? options.prior : null;
        const resolved = resolveExpectedScans({ expectedScans: options.expectedScans, plan, type });
        const lastRun = isCount(options.lastRunScans) ? options.lastRunScans : null;

        // The number given, if any, and how much it may be off.
        let given = null;
        if (resolved.count != null) {
            given = resolved.exact
                ? { count: resolved.count, from: COUNT.PLAN, uncertainty: 0 }
                : { count: resolved.count, from: COUNT.TYPED, uncertainty: NUMBER_UNCERTAINTY };
        } else if (lastRun != null) {
            given = { count: lastRun, from: COUNT.LAST_RUN, uncertainty: LAST_RUN_UNCERTAINTY };
        }
        const typeOf = (byType) => (byType && byType[type]) || null;

        let startMs = null;
        let lastMs = null;
        let done = 0;
        const scanTimes = [];
        let top = -1;
        let topScans = 0;
        let topEnded = false;
        const loops = new Map();
        // Whether a loop of this run has given a count yet.
        let measured = false;

        function dropInside(path) {
            for (const other of [...loops.keys()]) if (isInsideLoop(other, path)) loops.delete(other);
        }

        function accept(entry) {
            if (!entry || typeof entry !== 'object') return;
            const at = typeof entry.time === 'string' ? Date.parse(entry.time) : NaN;
            if (Number.isFinite(at)) {
                if (startMs == null) startMs = at;
                lastMs = lastMs == null ? at : Math.max(lastMs, at);
            }
            const x = entry.extra;
            if (!x || typeof x !== 'object' || typeof x.actionPath !== 'string') return;
            const path = x.actionPath;
            const event = x.stepEvent;
            const ended = event === 'action-end' || event === 'action-failed' || event === 'action-skipped';

            // Any entry from inside a later step of the workflow's own says the
            // run has reached it.
            const head = path.split('::')[0].split('.')[0];
            if (stepIndex.has(head) && stepIndex.get(head) > top) {
                top = stepIndex.get(head);
                topScans = done;
                topEnded = false;
            }
            if (event === 'action-start' && stepIndex.has(path)) {
                top = stepIndex.get(path);
                topScans = done;
                topEnded = false;
            }
            if ((event === 'action-end' || event === 'action-failed') && x.actionType === type) {
                done += 1;
                if (Number.isFinite(at) && startMs != null) scanTimes.push(Math.max(0, at - startMs));
            }
            if (event === 'loop-iteration' && Number.isInteger(x.index) && x.index >= 0) {
                let loop = loops.get(path);
                if (x.index === 0 || !loop) {
                    loop = { path, total: null, index: x.index, iterationStart: done, counts: [] };
                    loops.delete(path);
                    loops.set(path, loop);
                } else if (x.index > loop.index) {
                    // The scans of the iterations that finished; with workers
                    // running iterations side by side, shared out among them.
                    const passed = x.index - loop.index;
                    const each = (done - loop.iterationStart) / passed;
                    for (let k = 0; k < passed; k += 1) loop.counts.push(each);
                    if (loop.counts.length > LOOP_COUNTS_KEPT) loop.counts.splice(0, loop.counts.length - LOOP_COUNTS_KEPT);
                    loop.index = x.index;
                    loop.iterationStart = done;
                }
                // A loop that grows says so as it goes.
                loop.total = Number.isFinite(x.total) && x.total > 0 ? x.total : loop.total;
                // A new iteration of this loop ends the loops inside the last one.
                dropInside(path);
            } else if (ended) {
                if (loops.has(path)) loops.delete(path);
                dropInside(path);
                // A step of the workflow's own that ended is behind the run,
                // whether or not its start was seen.
                if (stepIndex.has(path) && stepIndex.get(path) >= top) {
                    top = stepIndex.get(path);
                    topEnded = true;
                }
            }
        }

        // The loops running, outermost first, each inside the one before.
        function chain() {
            const out = [];
            for (const loop of loops.values()) {
                if (!out.length || isInsideLoop(loop.path, out[out.length - 1].path)) out.push(loop);
            }
            return out;
        }

        // What one step of the plan runs, as a count: {scans, slack}, or null
        // when a loop of unknown size inside it runs scans. A range (a loop
        // with a limit, an if) counts its most, with the difference as slack.
        function planned(range) {
            if (!range) return { scans: 0, slack: 0 };
            if (range.unsized > 0) return null;
            return { scans: range.max, slack: range.max - range.min };
        }

        // Scans left in loop k of the chain: {scans, slack}, or null.
        function leftInLoop(list, k) {
            const loop = list[k];
            if (loop.total == null) return null;
            const n = loop.total;
            const i = loop.index;
            const inside = done - loop.iterationStart;
            const node = nodes[loop.path];
            const range = node && node.perIterationRangeByType ? typeOf(node.perIterationRangeByType) : null;
            const fixed = range && !range.unsized && range.min === range.max ? range.max : null;
            const enough = k === 0 ? MIN_LOOP_ITERATIONS : 1;
            const measured = loop.counts.length >= enough ? mean(loop.counts) : null;
            const per = fixed != null ? fixed : measured;

            let current = null;
            let slack = 0;
            if (k + 1 < list.length) {
                const inner = leftInLoop(list, k + 1);
                if (inner) { current = inner.scans; slack += inner.slack; }
            }
            if (current == null) {
                if (per != null) current = Math.max(0, per - inside);
                else if (range && !range.unsized) current = Math.max(0, (range.min + range.max) / 2 - inside);
                else return null;
            }
            const after = Math.max(0, n - i - 1);
            if (after > 0 && per == null) return null;
            if (after > 0 && fixed == null) slack += COUNT_SLACK_SD * stdDev(loop.counts) * Math.sqrt(after);
            return { scans: current + after * (per || 0), slack };
        }

        // The scans the run will do, counted: {scans, slack, loop}, or null.
        function count() {
            if (!steps.length) return null;
            let left = 0;
            let slack = 0;
            let loop = null;
            if (top >= 0 && !topEnded) {
                const list = chain();
                if (list.length) {
                    const inLoop = leftInLoop(list, 0);
                    if (!inLoop) return null;
                    left += inLoop.scans;
                    slack += inLoop.slack;
                    const outer = list[0];
                    if (outer.total != null) loop = { path: outer.path, iteration: outer.index + 1, total: outer.total, done: outer.index };
                } else {
                    const here = planned(typeOf(steps[top].byType));
                    if (!here) return null;
                    left += Math.max(0, here.scans - (done - topScans));
                    slack += here.slack;
                }
            }
            for (let j = Math.max(0, top + 1); j < steps.length; j += 1) {
                const ahead = planned(typeOf(steps[j].byType));
                if (!ahead) return null;
                left += ahead.scans;
                slack += ahead.slack;
            }
            return { scans: done + left, slack, loop };
        }

        function estimate(nowMs) {
            if (startMs == null) return null;
            const counted = count();
            let expected = null;
            let from = null;
            let uncertainty = 0;
            let slackScans = 0;
            if (counted && counted.loop) measured = true;
            // A number given stands while nothing better says otherwise: no
            // count, or one it agrees with, or only the plan's (a typed number
            // over the one the workflow works out is the person's word: they may
            // know an if hardly ever runs) before the run has measured a loop.
            // Once the run reaches the number, a count with scans still to go
            // takes over.
            const ahead = counted && given
                ? given.count > done || (given.count === done && Math.round(counted.scans) <= done)
                : true;
            const keep = given && (!counted || (ahead
                && (Math.abs(given.count - counted.scans) <= AGREE_SHARE * counted.scans || !measured)));
            if (keep) {
                expected = given.count;
                from = given.from;
                uncertainty = given.uncertainty;
            } else if (counted) {
                expected = Math.max(done, Math.round(counted.scans));
                from = counted.loop ? COUNT.LOOPS : COUNT.PLAN;
                slackScans = counted.slack;
            }
            if (expected == null || expected < 1) return null;

            const elapsedMs = Number.isFinite(nowMs) ? Math.max(0, nowMs - startMs) : (lastMs == null ? 0 : lastMs - startMs);
            const result = estimateRun({
                expectedScans: expected,
                completedAtMs: scanTimes,
                elapsedMs,
                prior,
                numberUncertainty: uncertainty,
                slackScans
            });
            result.count = from;
            // A number counted rather than given or certain: shown as "~205".
            result.approximate = from === COUNT.LOOPS || (from === COUNT.PLAN && slackScans > 0);
            result.loop = counted && counted.loop ? counted.loop : null;
            result.loopScans = counted && counted.loop ? Math.round(counted.scans) : null;
            return result;
        }

        return {
            accept,
            estimate,
            scansDone: () => done,
            loops: () => chain().map((l) => ({ path: l.path, index: l.index, total: l.total }))
        };
    }

    /** Where an estimate comes from, in words, for a tooltip or a screen reader. */
    function describeBasis(estimate) {
        if (!estimate) return '';
        const runs = estimate.priorRuns > 0
            ? `${estimate.priorRuns} finished run${estimate.priorRuns === 1 ? '' : 's'} of this workflow`
            : '';
        let pace = '';
        if (estimate.basis === BASIS.OWN) pace = 'From how long the scans of this run have taken.';
        else if (estimate.basis === BASIS.PRIOR) pace = `From ${runs}: this run has not done a scan yet.`;
        else if (estimate.basis === BASIS.BLEND) pace = `From how long the scans of this run have taken, with ${runs}.`;
        if (!pace) return '';
        const n = estimate.expectedScans;
        let count = '';
        if (estimate.count === COUNT.LOOPS) {
            count = `About ${n} scans in all, counted from the loops so far and the steps after them.`;
        } else if (estimate.count === COUNT.LAST_RUN) {
            count = `${n} scans, as the last run of this workflow did.`;
        } else if (estimate.count === COUNT.TYPED) {
            count = estimate.loopScans != null && estimate.loopScans !== n
                ? `${n} scans expected, as given; the loops point to about ${estimate.loopScans}.`
                : `${n} scans expected, as given.`;
        } else if (estimate.count === COUNT.PLAN) {
            count = `${n} scans, from the steps of the workflow.`;
        }
        return count ? `${count} ${pace}` : pace;
    }

    /**
     * A time left in words: "under a minute", "about 6 min", "about 1 h 25 min".
     * Rounded on purpose, so the text does not change every second.
     */
    function formatRemaining(ms) {
        if (!Number.isFinite(ms) || ms < 0) return '';
        if (ms < 45000) return 'under a minute';
        const minutes = Math.round(ms / 60000);
        if (minutes < 60) return `about ${minutes} min`;
        const step = 5;
        const rounded = Math.round(minutes / step) * step;
        const h = Math.floor(rounded / 60);
        const m = rounded % 60;
        return m ? `about ${h} h ${m} min` : `about ${h} h`;
    }

    /**
     * "5 to 8 min" for a range, "up to 2 min" when its low end is under a
     * minute, or '' when it adds nothing (both ends round alike). Given the
     * estimate it surrounds (`ms`), the range always holds it as it is shown:
     * "under a minute left (up to 2 min)", never "(1 to 2 min)".
     */
    function formatRange(range, ms) {
        if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) return '';
        if (range.high < 45000) return '';
        let lo = Math.max(0, Math.round(range.low / 60000));
        let hi = Math.max(1, Math.round(range.high / 60000));
        if (Number.isFinite(ms) && ms >= 0) {
            const shown = ms < 45000 ? 0 : Math.round(ms / 60000);
            lo = Math.min(lo, shown);
            hi = Math.max(hi, shown);
        }
        if (lo === hi) return '';
        if (hi >= 60) return '';
        return lo < 1 ? `up to ${hi} min` : `${lo} to ${hi} min`;
    }

    return {
        BASIS,
        COUNT,
        STATE,
        FIRST_SCAN_WEIGHT,
        PRIOR_STRENGTH,
        MIN_OWN_SCANS,
        MIN_PRIOR_RUNS,
        exactScanCount,
        createRunEstimator,
        resolveExpectedScans,
        effectiveExpectedScans,
        rangeAround,
        NUMBER_UNCERTAINTY,
        LAST_RUN_UNCERTAINTY,
        describeBasis,
        ownPace,
        priorFromRuns,
        estimateRun,
        estimateFromCounts,
        estimateBatch,
        formatRemaining,
        formatRange
    };
}));
