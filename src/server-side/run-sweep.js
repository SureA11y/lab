'use strict';

/**
 * Expiry for the in-memory run registries in server.js (`Runs`, `ManualRuns`).
 *
 * A finished run keeps its whole result - scans, base64 screenshots, logs - in
 * memory so the page can fetch it. Nothing removed it afterwards, so memory grew
 * with every run until the process exited. A run is now removed a fixed time
 * after it is first seen finished, never while it is still running.
 *
 * Removal is time-based rather than on first fetch: `fetchWorkflowResult`
 * retries, and a reload would otherwise get "Unknown runId".
 *
 * The finish time is stamped by the sweep itself the first time it sees a
 * finished status, so every path that ends a run is covered without each one
 * having to record it. A run therefore lives between `ttlMs` and
 * `ttlMs + intervalMs` after it ends.
 *
 * A registry may also say which runs are still open but waiting on a client
 * (`isOpen`): an extension session that was started and never finished stays
 * "collecting" forever if DevTools is closed mid-capture. Such a run is removed
 * once nothing has touched it for `idleMs`, measured from `lastActivityAt`, or
 * from `createdAt` when it has had no activity yet.
 *
 * `ttlMs` and `idleMs` can be set per registry: extension sessions are finished
 * and fetched with separate clicks, so they get a longer window than app runs.
 */

const FINISHED_RUN_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const IDLE_RUN_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Removes the runs that finished at least `ttlMs` ago; stamps `finishedAt` on
 * finished runs seen for the first time. `onRemove(run)` lets go of what a
 * run holds outside the registry (its result file). Returns how many were
 * removed.
 */
function sweepFinishedRuns(runs, { isFinished, now = Date.now(), ttlMs = FINISHED_RUN_TTL_MS, onRemove = null } = {}) {
    let removed = 0;
    for (const [runId, run] of runs) {
        if (!run || !isFinished(run.status)) continue;
        if (!Number.isFinite(run.finishedAt)) {
            run.finishedAt = now;
            continue;
        }
        if (now - run.finishedAt >= ttlMs) {
            runs.delete(runId);
            if (onRemove) {
                try { onRemove(run); } catch {}
            }
            removed += 1;
        }
    }
    return removed;
}

/**
 * Removes the open runs nothing has touched for at least `idleMs`. Returns how
 * many were removed.
 */
function sweepIdleRuns(runs, { isOpen, now = Date.now(), idleMs = IDLE_RUN_TTL_MS } = {}) {
    let removed = 0;
    for (const [runId, run] of runs) {
        if (!run || !isOpen(run.status)) continue;
        const lastTouched = Number.isFinite(run.lastActivityAt) ? run.lastActivityAt : run.createdAt;
        if (!Number.isFinite(lastTouched)) continue;
        if (now - lastTouched >= idleMs) {
            runs.delete(runId);
            removed += 1;
        }
    }
    return removed;
}

/**
 * Sweeps each `{ runs, isFinished, ttlMs?, isOpen?, idleMs?, onRemove? }` registry on an
 * interval that does not keep the process alive; a registry's own `ttlMs` and
 * `idleMs` override the defaults given here. Returns a function that stops it.
 */
function startRunSweeper(registries, {
    intervalMs = SWEEP_INTERVAL_MS,
    ttlMs = FINISHED_RUN_TTL_MS,
    idleMs = IDLE_RUN_TTL_MS,
} = {}) {
    const timer = setInterval(() => {
        for (const registry of registries) {
            const { runs, isFinished, isOpen, onRemove } = registry;
            sweepFinishedRuns(runs, { isFinished, ttlMs: registry.ttlMs ?? ttlMs, onRemove });
            if (isOpen) sweepIdleRuns(runs, { isOpen, idleMs: registry.idleMs ?? idleMs });
        }
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
}

module.exports = {
    FINISHED_RUN_TTL_MS,
    SWEEP_INTERVAL_MS,
    IDLE_RUN_TTL_MS,
    sweepFinishedRuns,
    sweepIdleRuns,
    startRunSweeper,
};
