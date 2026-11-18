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
 * The loops of a workflow are a better guide than a count of scans where there
 * is one. The engine says "item 14 of 40" for each loop as it goes, and an
 * iteration (a page, with or without an extra scan) takes a steady time where
 * single scans do not: on a live run the time left from the loop was off by 3.5%
 * (median), from a typed number of scans by 8.1%, and it needs no number.
 * createLoopTracker follows those events; it estimates the time left in the
 * outermost loop that is running, not the steps after it.
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
    const NUMBER_UNCERTAINTY = 0.05;

    // The range around what a run that has not started will take, from the
    // finished runs of its workflow (estimateBatch).
    const BATCH_SPREAD_MIN = 0.1;
    const SPREAD_NO_HISTORY = 0.3;

    // A loop is trusted for a time once this many of its iterations are done:
    // one iteration is a guess, and the start-up is often in it.
    const MIN_LOOP_ITERATIONS = 2;

    // How many iteration times a loop keeps, for the scatter among them.
    const LOOP_TIMES_KEPT = 200;

    const BASIS = Object.freeze({
        LOOP: 'loop',
        NONE: 'none',
        PRIOR: 'prior',
        OWN: 'own',
        BLEND: 'blend'
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
     * shows.
     */
    function rangeAround(remainingMs, perScanMs, scansLeft, expectedScans, numberUncertainty = NUMBER_UNCERTAINTY) {
        const share = expectedScans > 0 ? Math.min(1, scansLeft / expectedScans) : 1;
        const relative = clamp(SPREAD_K * Math.sqrt(share), SPREAD_MIN, SPREAD_MAX);
        const half = relative * remainingMs
            + perScanMs * SLACK_SCANS
            + numberUncertainty * expectedScans * perScanMs;
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
            Number.isFinite(input.numberUncertainty) ? input.numberUncertainty : NUMBER_UNCERTAINTY
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
     * `running`      estimateRun results for the runs going now
     * `queued`       [{expectedScans, prior?}] for the runs not started, null where
     *                unknown; a run's own `prior` (its workflow's) wins over the batch's
     * `prior`        priorFromRuns(...) for runs with no number of their own
     * `concurrency`  how many runs go at once
     *
     * The work left, shared out over the runs that go at once, but never less
     * than the longest run still going. Returns {state, remainingMs, rangeMs,
     * priorRuns}; the state is 'estimating', or 'unknown' when some run has
     * neither a number nor a prior to stand on.
     */
    function estimateBatch(input = {}) {
        const running = Array.isArray(input.running) ? input.running : [];
        const queued = Array.isArray(input.queued) ? input.queued : [];
        const prior = input.prior && input.prior.perScanMs > 0 ? input.prior : null;
        const slots = isCount(input.concurrency) ? input.concurrency : 1;

        let low = 0;
        let high = 0;
        let total = 0;
        let longest = { remaining: 0, low: 0, high: 0 };

        for (const run of running) {
            if (!run || run.remainingMs == null) {
                if (run && (run.state === STATE.REACHED || run.state === STATE.PAST)) continue;
                return unknownBatch(prior);
            }
            total += run.remainingMs;
            low += run.rangeMs.low;
            high += run.rangeMs.high;
            if (run.remainingMs > longest.remaining) {
                longest = { remaining: run.remainingMs, low: run.rangeMs.low, high: run.rangeMs.high };
            }
        }

        for (const item of queued) {
            const scans = item && isCount(item.expectedScans) ? item.expectedScans : null;
            const own = item && item.prior && item.prior.perScanMs > 0 ? item.prior : prior;
            let ms = null;
            if (scans != null && own) ms = scans * own.perScanMs;
            else if (own) ms = own.meanDurationMs;
            if (ms == null) return unknownBatch(prior);

            const spread = clamp(own.spread != null ? own.spread : SPREAD_NO_HISTORY, BATCH_SPREAD_MIN, SPREAD_MAX);
            total += ms;
            low += ms * (1 - spread);
            high += ms * (1 + spread);
        }

        const share = (ms) => ms / slots;
        const remainingMs = Math.max(share(total), longest.remaining);
        return {
            state: STATE.ESTIMATING,
            remainingMs,
            rangeMs: {
                low: Math.max(share(low), longest.low),
                high: Math.max(share(high), longest.high)
            },
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

    /**
     * Follows the loops of a run as its log entries arrive, and says how long
     * the outermost running loop has left.
     *
     * accept(entry): a log entry, {time, extra: {stepEvent, actionPath, index,
     * total}}. A 'loop-iteration' entry starts an iteration (index 0 starts the
     * loop); the loop's own 'action-end', 'action-failed' or 'action-skipped'
     * ends it, and the loops inside it with it. Other entries are ignored.
     *
     * estimate(nowMs): {state, basis, remainingMs, rangeMs, loop} or null.
     * `nowMs` is on the clock of the entries' times. `loop` says which loop it
     * is {path, iteration (1-based), total, done}. Null when no loop is running,
     * the outermost one's size is not known, or too few of its iterations are
     * done for it to say (and nothing inside it can say either).
     *
     * An iteration of the outermost loop takes the time its finished ones took
     * on average; while one is running, what is left of it is what its inner
     * loops have left, when they can say, else what is left of that average.
     * The first iteration, with nothing finished, is the time it has taken so
     * far plus what the loop inside it has left. A loop that runs its iterations
     * side by side (workers) is as good: its iterations start at the pace it
     * finishes them.
     */
    function createLoopTracker() {
        const loops = new Map();

        function dropInside(path) {
            for (const other of [...loops.keys()]) if (isInsideLoop(other, path)) loops.delete(other);
        }

        function accept(entry) {
            const x = entry && entry.extra;
            if (!x || typeof x.actionPath !== 'string') return;
            const path = x.actionPath;
            if (x.stepEvent === 'loop-iteration' && Number.isInteger(x.index) && x.index >= 0) {
                const at = Date.parse(entry.time);
                if (!Number.isFinite(at)) return;
                let loop = loops.get(path);
                if (x.index === 0 || !loop) {
                    loop = { path, total: null, first: at, curStart: at, prevStart: at, index: 0, durations: [] };
                    loops.delete(path);
                    loops.set(path, loop);
                } else if (x.index > loop.index) {
                    loop.durations.push(at - loop.prevStart);
                    if (loop.durations.length > LOOP_TIMES_KEPT) loop.durations.shift();
                    loop.prevStart = at;
                }
                // The size of a loop that is not dynamic is known when it starts;
                // one that grows says so as it goes.
                loop.total = Number.isFinite(x.total) && x.total > 0 ? x.total : loop.total;
                loop.index = Math.max(loop.index, x.index);
                loop.curStart = at;
                // A new iteration of this loop ends the loops inside the last one.
                dropInside(path);
            } else if (x.stepEvent === 'action-end' || x.stepEvent === 'action-failed' || x.stepEvent === 'action-skipped') {
                if (loops.has(path)) loops.delete(path);
                dropInside(path);
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

        // Time left in loop k of the chain, or null.
        function left(list, k, nowMs) {
            const loop = list[k];
            if (loop.total == null) return null;
            const i = loop.index;
            const n = loop.total;
            if (i >= n) return null;
            const elapsed = Math.max(0, nowMs - loop.curStart);
            const inner = k + 1 < list.length ? left(list, k + 1, nowMs) : null;
            let each = i >= MIN_LOOP_ITERATIONS ? (loop.curStart - loop.first) / i : null;
            let current;
            if (inner != null) current = inner;
            else if (each != null) current = Math.max(0, each - elapsed);
            else return null;
            if (each == null) each = elapsed + current;
            return current + (n - i - 1) * each;
        }

        function estimate(nowMs) {
            if (!Number.isFinite(nowMs)) return null;
            const list = chain();
            if (!list.length || list[0].total == null) return null;
            const remainingMs = left(list, 0, nowMs);
            if (remainingMs == null) return null;

            const outer = list[0];
            const n = outer.total;
            const i = outer.index;
            const each = i >= MIN_LOOP_ITERATIONS ? (outer.curStart - outer.first) / i : remainingMs / Math.max(1, n - i);
            // How far the end may be: the scatter of the iterations over the ones
            // still to come, or the same share of what is left as for scans,
            // whichever is wider; and an iteration of slack.
            const cv = variation(outer.durations);
            const left_ = Math.max(1, n - i - 1);
            const byScatter = cv == null ? 0 : 1.65 * cv / Math.sqrt(left_);
            const relative = clamp(Math.max(byScatter, SPREAD_K * Math.sqrt((n - i) / n)), SPREAD_MIN, SPREAD_MAX);
            const half = relative * remainingMs + each;
            return {
                state: STATE.ESTIMATING,
                basis: BASIS.LOOP,
                remainingMs,
                rangeMs: { low: Math.max(0, remainingMs - half), high: remainingMs + half },
                loop: { path: outer.path, iteration: i + 1, total: n, done: i }
            };
        }

        return { accept, estimate, loops: () => chain().map((l) => ({ path: l.path, index: l.index, total: l.total })) };
    }

    /** Where an estimate comes from, in words, for a tooltip or a screen reader. */
    function describeBasis(estimate) {
        if (!estimate) return '';
        if (estimate.basis === BASIS.LOOP && estimate.loop) {
            return `From the loop it is in: ${estimate.loop.done} of ${estimate.loop.total} items done, and how long they took. The steps after the loop are not in it.`;
        }
        const runs = estimate.priorRuns > 0
            ? `${estimate.priorRuns} finished run${estimate.priorRuns === 1 ? '' : 's'} of this workflow`
            : '';
        if (estimate.basis === BASIS.OWN) return 'From how long the scans of this run have taken.';
        if (estimate.basis === BASIS.PRIOR) return `From ${runs}: this run has not done a scan yet.`;
        if (estimate.basis === BASIS.BLEND) return `From how long the scans of this run have taken, with ${runs}.`;
        return '';
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

    /** "5 to 8 min" for a range, or '' when it adds nothing (both ends round alike). */
    function formatRange(range) {
        if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) return '';
        if (range.high < 45000) return '';
        const lo = Math.max(1, Math.round(range.low / 60000));
        const hi = Math.max(1, Math.round(range.high / 60000));
        if (lo === hi) return '';
        if (hi >= 60) return '';
        return `${lo} to ${hi} min`;
    }

    return {
        BASIS,
        STATE,
        FIRST_SCAN_WEIGHT,
        PRIOR_STRENGTH,
        MIN_OWN_SCANS,
        MIN_PRIOR_RUNS,
        exactScanCount,
        createLoopTracker,
        resolveExpectedScans,
        effectiveExpectedScans,
        rangeAround,
        NUMBER_UNCERTAINTY,
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
