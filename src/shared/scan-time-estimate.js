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

    // The range around an estimate, as a share of it.
    const SPREAD_MIN = 0.1;
    const SPREAD_MAX = 0.5;
    const SPREAD_NO_HISTORY = 0.3;

    const BASIS = Object.freeze({
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
     * The scan count a run is expected to do: the one the person gave if it is
     * a usable count, else the one the workflow is certain to run, else null.
     * The person's always wins, since they may know a branch hardly ever runs.
     * `plan` is what planWorkflowSteps returns.
     */
    function effectiveExpectedScans({ expectedScans = null, plan = null, type = 'a11yScan' } = {}) {
        const given = typeof expectedScans === 'string' && /^\s*\d+\s*$/.test(expectedScans)
            ? Number(expectedScans)
            : expectedScans;
        if (isCount(given)) return given;
        return exactScanCount(plan, type);
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

    function spreadOf(own, prior, weightOwn) {
        const ownSpread = own && own.variation != null ? own.variation : null;
        const priorSpread = prior && prior.spread != null ? prior.spread : null;
        let raw;
        if (ownSpread != null && priorSpread != null) {
            raw = weightOwn * ownSpread + (1 - weightOwn) * priorSpread;
        } else {
            raw = ownSpread != null ? ownSpread : (priorSpread != null ? priorSpread : SPREAD_NO_HISTORY);
        }
        return clamp(raw, SPREAD_MIN, SPREAD_MAX);
    }

    /**
     * estimateRun({expectedScans, completedAtMs, elapsedMs, prior})
     *
     * `expectedScans`  how many scans the run is expected to do, or null
     * `completedAtMs`  active-clock time of each finished scan, oldest first
     * `elapsedMs`      active-clock time now (defaults to the last scan's)
     * `prior`          priorFromRuns(...), or null
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

        const spread = spreadOf(own, prior, weightOwn);
        result.state = STATE.ESTIMATING;
        result.perScanMs = own ? own.perScanMs : perScanMs;
        result.remainingMs = remainingMs;
        result.rangeMs = { low: remainingMs * (1 - spread), high: remainingMs * (1 + spread) };
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
    function estimateFromCounts({ expectedScans = null, scansDone = 0, elapsedMs = null, sinceScanMs = null, prior = null } = {}) {
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
            prior
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

            const spread = clamp(own.spread != null ? own.spread : SPREAD_NO_HISTORY, SPREAD_MIN, SPREAD_MAX);
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

    /** Where an estimate comes from, in words, for a tooltip or a screen reader. */
    function describeBasis(estimate) {
        if (!estimate) return '';
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
        effectiveExpectedScans,
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
