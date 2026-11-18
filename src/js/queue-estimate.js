'use strict';

/**
 * The time left for the queue's runs and for the batch, from what GET /queue
 * says of them (shared/scan-time-estimate.js does the arithmetic).
 *
 * A run is described by counts, not by when each scan finished: how many scans
 * ran (`scansRun`), how long it has been going (`elapsedMs`) and how long ago
 * its last scan ended (`sinceScanMs`). Each run also says how many scans it is
 * expected to do (`expectedScans`: the number it was given, else the one its
 * workflow is certain to run) and a `workflowKey`, the same for runs of one
 * workflow.
 *
 * What finished runs of a workflow took is where its other runs start from:
 * a run that has not begun, or has done a scan or two, leans on them, and its
 * own pace takes over as it goes. A run with no number of its own, in a
 * workflow others have finished, is expected to do what they did.
 */

const getEstimator = () => globalThis.A11Y_SCAN_TIME_ESTIMATE || null;

const FINISHED_OK = 'done';

function scansOf(item) {
    if (Number.isFinite(item.scansRun) && item.scansRun > 0) return item.scansRun;
    return Number.isFinite(item.scans) && item.scans > 0 ? item.scans : 0;
}

/**
 * What the finished runs of each workflow took: { byKey: Map, pooled }.
 * `pooled` is all of them together, for a run whose workflow has no finished
 * run of its own.
 */
export function priorsFrom(items, estimator = getEstimator()) {
    const byKey = new Map();
    if (!estimator) return { byKey, pooled: null };

    const runsByKey = new Map();
    const all = [];
    for (const item of items) {
        if (item.status !== FINISHED_OK || !(item.durationMs > 0) || scansOf(item) < 1) continue;
        const run = { scans: scansOf(item), durationMs: item.durationMs, ok: true };
        all.push(run);
        if (!item.workflowKey) continue;
        if (!runsByKey.has(item.workflowKey)) runsByKey.set(item.workflowKey, []);
        runsByKey.get(item.workflowKey).push(run);
    }
    for (const [key, runs] of runsByKey) {
        const prior = estimator.priorFromRuns(runs);
        if (prior) byKey.set(key, prior);
    }
    return { byKey, pooled: estimator.priorFromRuns(all) };
}

/**
 * The time left of one run that has not finished, or null when there is no
 * number to put it on. `from` says where the number of scans came from:
 * 'set' (given, or certain from the workflow) or 'earlier' (what finished runs
 * of the workflow did).
 */
export function estimateItem(item, prior, estimator = getEstimator()) {
    if (!estimator) return null;
    const running = item.status === 'running';
    if (!running && item.status !== 'waiting') return null;
    // Saving its result: every scan is done, and what is left is not scans.
    if (running && item.phase === 'saving') return null;

    const given = Number.isInteger(item.expectedScans) && item.expectedScans > 0 ? item.expectedScans : null;
    const fromPrior = prior ? Math.max(1, Math.round(prior.meanScans)) : null;
    const expectedScans = given != null ? given : fromPrior;
    if (expectedScans == null) return null;

    const estimate = estimator.estimateFromCounts({
        expectedScans,
        scansDone: running ? scansOf(item) : 0,
        elapsedMs: running ? item.elapsedMs : null,
        sinceScanMs: running ? item.sinceScanMs : null,
        prior,
    });
    return { ...estimate, from: given != null ? 'set' : 'earlier' };
}

/**
 * -> { byItem: Map<id, estimate>, batch }
 *
 * `batch` is the time left of the whole batch ({state, remainingMs, rangeMs,
 * priorRuns}), or null when the batch is not running. `counts` is the session's
 * counts: the runs of a batch come a page at a time, so some that wait may not
 * be among `items`, and are counted as the average run.
 */
export function estimateQueue(items, { counts = null, running = true, estimator = getEstimator() } = {}) {
    const byItem = new Map();
    if (!estimator || !Array.isArray(items)) return { byItem, batch: null };

    const { byKey, pooled } = priorsFrom(items, estimator);
    const priorOf = (item) => (item.workflowKey && byKey.get(item.workflowKey)) || pooled || null;

    const goingNow = [];
    const waiting = [];
    for (const item of items) {
        const estimate = estimateItem(item, priorOf(item), estimator);
        if (estimate) byItem.set(item.id, estimate);
        if (item.status === 'running') goingNow.push({ item, estimate });
        else if (item.status === 'waiting') waiting.push(item);
    }

    if (!running || (!goingNow.length && !waiting.length && !(counts && counts.waiting > 0))) {
        return { byItem, batch: null };
    }

    const notLoaded = Math.max(0, ((counts && counts.waiting) || 0) - waiting.length);
    const queued = waiting.map((item) => ({
        expectedScans: Number.isInteger(item.expectedScans) ? item.expectedScans : null,
        prior: priorOf(item),
    }));
    for (let i = 0; i < notLoaded; i += 1) queued.push({ expectedScans: null, prior: pooled });

    const batch = estimator.estimateBatch({
        // A run saving its result has no estimate and nothing left worth one.
        running: goingNow
            .filter(({ item }) => item.phase !== 'saving')
            .map(({ estimate }) => estimate || { state: estimator.STATE.NO_TOTAL, remainingMs: null }),
        queued,
        prior: pooled,
        concurrency: Math.max(1, goingNow.length),
    });
    return { byItem, batch };
}

/** "about 6 min" as a column wants it: "~6 min", "< 1 min", "~1h 25m". */
export function shortRemaining(ms, estimator = getEstimator()) {
    const words = estimator ? estimator.formatRemaining(ms) : '';
    if (!words) return '';
    if (words === 'under a minute') return '< 1 min';
    const short = words.replace(/^about /, '~');
    // Hours and minutes, closer: the column is narrow and "1h 25m" is as clear.
    return /\d h/.test(short) ? short.replace(/ h/, 'h').replace(/ min$/, 'm') : short;
}

/**
 * How a run's time left reads in the table: { text, title } (both '' for a
 * run with none). The cell shows the time and nothing else; where the number
 * comes from is in the tooltip. It is an estimate, and says so.
 */
export function describeLeft(estimate, estimator = getEstimator()) {
    const none = { text: '', title: '' };
    if (!estimate || !estimator) return none;
    const S = estimator.STATE;

    if (estimate.state === S.REACHED) {
        return { text: 'finishing', title: `All ${estimate.expectedScans} expected scans are done.` };
    }
    if (estimate.state === S.PAST) {
        return { text: 'over', title: `${estimate.scansDone} scans are done, past the ${estimate.expectedScans} expected, so there is no estimate.` };
    }
    if (estimate.state !== S.ESTIMATING) return none;

    const range = estimator.formatRange(estimate.rangeMs);
    const where = estimate.from === 'set'
        ? `${estimate.expectedScans} scans expected.`
        : `${estimate.expectedScans} scans expected, as the finished runs of this workflow did.`;
    const title = [
        `Estimate: ${estimator.formatRemaining(estimate.remainingMs)} left${range ? ` (${range})` : ''}.`,
        where,
        estimator.describeBasis(estimate),
    ].filter(Boolean).join(' ');

    return { text: shortRemaining(estimate.remainingMs, estimator), title };
}

/** The batch's time left for its status line: "about 14 min left, estimated (12 to 18 min)", or ''. */
export function describeBatchLeft(batch, estimator = getEstimator()) {
    if (!batch || !estimator || batch.state !== estimator.STATE.ESTIMATING) return '';
    const range = estimator.formatRange(batch.rangeMs);
    return `${estimator.formatRemaining(batch.remainingMs)} left, estimated${range ? ` (${range})` : ''}`;
}
