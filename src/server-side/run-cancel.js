'use strict';

/**
 * A cancel asked of a /workflow-start run (server.js). A run still going is
 * marked and its browser work aborted; one that has ended is left as it
 * ended: the answer gives its status, and its log does not say a cancel was
 * asked for, which it read as before.
 */

const FINISHED = new Set(['done', 'cancelled', 'error']);

/** -> { status, changed } */
function requestCancel(run, { now = () => new Date().toISOString() } = {}) {
    if (FINISHED.has(run.status)) return { status: run.status, changed: false };

    run.cancelled = true;
    if (run.status === 'running') run.status = 'cancelling';
    run.log.push({ time: now(), type: 'info', message: 'Cancellation requested by user' });
    try { run.abortController?.abort(); } catch {}
    return { status: run.status, changed: true };
}

module.exports = { requestCancel, FINISHED };
