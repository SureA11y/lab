'use strict';

/**
 * Whether the queue may start its next run (docs/design/workflow-queue-batch-design.md
 * §5.2), from the resource samples it takes every few seconds.
 *
 * Runs share one Node process, and a run holds its findings until it ends, so
 * a batch that grows past the heap's limit crashes the server and loses every
 * running row. When the heap reaches `holdAtPct` of its limit, the next
 * waiting run is held; it starts once the heap is back below `resumeBelowPct`.
 * The gap keeps the hold from flapping while a garbage collection is due.
 *
 * It only ever holds a start: a running run is never paused or stopped, the
 * concurrency setting is left as it is, and with nothing running a run always
 * starts, so a batch cannot be held for good.
 */

const HOLD_AT_HEAP_PCT = 60;
const RESUME_BELOW_HEAP_PCT = 50;

function createQueueGovernor({
    holdAtPct = HOLD_AT_HEAP_PCT,
    resumeBelowPct = RESUME_BELOW_HEAP_PCT,
    now = Date.now,
} = {}) {
    let hold = null;
    let last = null;

    /**
     * Takes a sample (resource-sampler.js) and says whether the hold began
     * (`'hold'`) or ended (`'resume'`) with it, or null.
     */
    function observe(sample) {
        const heapPct = sample && Number.isFinite(sample.heapPct) ? sample.heapPct : null;
        last = heapPct === null ? null : {
            heapPct,
            heapUsedMb: Number.isFinite(sample.heapUsedMb) ? sample.heapUsedMb : null,
            heapLimitMb: Number.isFinite(sample.heapLimitMb) ? sample.heapLimitMb : null,
            at: new Date(now()).toISOString(),
        };
        if (heapPct === null) return null;
        if (!hold && heapPct >= holdAtPct) {
            hold = { reason: 'memory', heapPct, holdAtPct, resumeBelowPct, since: last.at };
            return 'hold';
        }
        if (hold && heapPct < resumeBelowPct) {
            hold = null;
            return 'resume';
        }
        if (hold) hold.heapPct = heapPct;
        return null;
    }

    /** Whether a run may start with `running` already going. */
    function allowsStart(running) {
        return running === 0 || !hold;
    }

    /** What the queue panel shows: the hold, if any, and the latest reading. */
    function view() {
        return { hold: hold ? { ...hold } : null, resources: last ? { ...last } : null };
    }

    /** Forgets the readings, when a batch ends. */
    function reset() {
        hold = null;
        last = null;
    }

    return { observe, allowsStart, view, reset };
}

module.exports = { createQueueGovernor, HOLD_AT_HEAP_PCT, RESUME_BELOW_HEAP_PCT };
