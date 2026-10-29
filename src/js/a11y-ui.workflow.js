'use strict';

/**
 * Polls a run's progress until it ends. `progressUrl(since)` reads another
 * run's progress than /workflow-progress (a queued run being watched), and
 * `shouldStop()` ends the polling early - the run itself carries on - with
 * status 'stopped'.
 */
export async function pollWorkflowUntilDone(runId, {
    pollIntervalMs = 800,
    onProgress = () => {},
    onStatus = () => {},
    progressUrl = (since) => `/workflow-progress?runId=${encodeURIComponent(runId)}&since=${since}`,
    shouldStop = () => false
} = {}) {
    const ACTIVE = new Set(['running', 'cancelling']);
    const TERMINAL = new Set(['done', 'cancelled', 'error']);

    let since = 0;
    let status = 'running';

    while (ACTIVE.has(status)) {
        if (shouldStop()) return { status: 'stopped', since };
        const progRes = await fetch(progressUrl(since), { method: 'GET' });
        if (!progRes.ok) throw new Error('Progress polling failed');

        const prog = await progRes.json();

        // If server ever returns an unexpected value, keep the last known status
        // (or default to running) rather than flipping to undefined.
        status = (typeof prog.status === 'string' && prog.status) ? prog.status : (status || 'running');

        since = Number.isFinite(Number(prog.nextIndex)) ? Number(prog.nextIndex) : since;

        if (shouldStop()) return { status: 'stopped', since };

        onStatus(status);
        onProgress(prog);

        if (ACTIVE.has(status)) {
            await sleep(pollIntervalMs);
        }
    }

    // Optional guard: if we ever land in an unknown state, do not loop forever
    // and surface it to the caller.
    if (!TERMINAL.has(status)) {
        return { status: 'error', since, error: `Unknown workflow status: ${String(status)}` };
    }

    return { status, since };
}

export async function fetchWorkflowResult(runId, { retries = 30, retryDelayMs = 250 } = {}) {
    for (let i = 0; i < retries; i += 1) {
        const res = await fetch(`/workflow-result?runId=${encodeURIComponent(runId)}`, { method: 'GET' });
        if (!res.ok) throw new Error('Result fetch failed');

        // If server returns 202, fetch still resolves ok=false, but we already handled !ok above.
        // The server uses 202 with JSON {status:"running"|"cancelling"}.
        const data = await res.json();

        const status = data && typeof data.status === 'string' ? data.status : null;
        if (status !== 'running' && status !== 'cancelling') return data;

        await sleep(retryDelayMs);
    }
    throw new Error('Result not ready after polling');
}

/**
 * What to tell the user when a run could not go on: the request to start it,
 * or one while following it, failed. A request that never reached the server
 * (fetch rejects with a TypeError: it is stopped, or the network is down)
 * says so, and whether the run had started there, in which case it may still
 * be going on.
 */
export function runFailureMessage(err, { started = false } = {}) {
    const unreachable = err instanceof TypeError;
    if (unreachable && !started) {
        return 'Could not reach the lab\'s server, so the workflow did not start. '
            + 'Check that the server is running, then run the workflow again.';
    }
    if (unreachable) {
        return 'Lost the connection to the lab\'s server while the workflow was running. '
            + 'It may still be running there, but its results cannot be shown here.';
    }
    const detail = err && err.message ? err.message : String(err || 'Unknown error');
    return `Workflow failed: ${detail}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
