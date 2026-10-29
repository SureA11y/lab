'use strict';

/**
 * Reads a queue session's metrics.jsonl back (docs/design/workflow-queue-batch-design.md
 * §5.1) into what tells where a batch slowed down:
 *
 *  - throughput at each number of runs going at once: scans per minute while
 *    1, 2, 3 or 4 ran, with the median time between a run's scans. Four runs
 *    doing no more scans a minute than three means the fourth only adds load;
 *  - the peaks: Node heap (and how close to its limit), process memory, the
 *    browser's memory, event-loop delay, CPU;
 *  - each run's own slowdown: the median time between its last scans over the
 *    median between its first ones.
 */

// Scans compared at each end of a run for its slowdown.
const ENDS = 20;
// Fewer scans than this, and a run's ends overlap too much to compare.
const MIN_SCANS_FOR_SLOWDOWN = 6;

const round1 = (n) => Math.round(n * 10) / 10;

function median(values) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function maxOf(values) {
    const v = values.filter(Number.isFinite);
    return v.length ? Math.max(...v) : null;
}

function meanOf(values) {
    const v = values.filter(Number.isFinite);
    return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/** The records of a metrics.jsonl text, skipping lines cut off by a crash. */
function parseMetrics(text) {
    const records = [];
    for (const line of String(text || '').split('\n')) {
        if (!line.trim()) continue;
        try {
            const r = JSON.parse(line);
            const t = Date.parse(r && r.t);
            if (Number.isFinite(t)) records.push({ ...r, ms: t });
        } catch {
            // a half-written last line
        }
    }
    return records.sort((a, b) => a.ms - b.ms);
}

/**
 * How long each number of running runs lasted, from the run-start and run-end
 * records (each says how many run once it is counted). A resumed session's
 * gap while the server was down is not counted: its time is the span between
 * a session record and its session-end, or the last record before the next.
 */
function timeByRunning(records) {
    const time = new Map();
    let level = 0;
    let since = null;
    let lastMs = null;
    const close = (ms) => {
        if (since !== null && ms > since) time.set(level, (time.get(level) || 0) + (ms - since));
    };
    for (const r of records) {
        if (r.kind === 'session') {
            // One left without its session-end ended with its last record.
            if (since !== null) close(lastMs);
            level = 0;
            since = r.ms;
        } else if (r.kind === 'run-start' || r.kind === 'run-end') {
            if (since === null) since = r.ms;
            close(r.ms);
            level = Number.isInteger(r.running) ? r.running : level;
            since = r.ms;
        } else if (r.kind === 'session-end') {
            close(r.ms);
            since = null;
        }
        lastMs = r.ms;
    }
    if (since !== null && records.length) close(records[records.length - 1].ms);
    return time;
}

function summarizeMetrics(records) {
    const list = Array.isArray(records) ? records : [];
    const scans = list.filter((r) => r.kind === 'scan');
    const samples = list.filter((r) => r.kind === 'sample');
    const time = timeByRunning(list);
    const activeMs = [...time.entries()].filter(([n]) => n > 0).reduce((a, [, ms]) => a + ms, 0);

    const byRunning = [...time.keys()].filter((n) => n > 0).sort((a, b) => a - b).map((n) => {
        const at = scans.filter((s) => s.running === n);
        const ms = time.get(n) || 0;
        return {
            running: n,
            timeMs: ms,
            scans: at.length,
            scansPerMin: ms > 0 ? round1(at.length / (ms / 60000)) : null,
            medianSinceLastMs: median(at.map((s) => s.sinceLastMs)),
            medianScanMs: median(at.map((s) => s.scanMs)),
        };
    });

    const peaks = {
        heapUsedMb: maxOf(samples.map((s) => s.heapUsedMb)),
        heapPct: maxOf(samples.map((s) => s.heapPct)),
        heapLimitMb: maxOf(samples.map((s) => s.heapLimitMb)),
        rssMb: maxOf(samples.map((s) => s.rssMb)),
        browserRssMb: maxOf(samples.map((s) => s.browser && s.browser.rssMb)),
        browserProcesses: maxOf(samples.map((s) => s.browser && s.browser.processes)),
        loopP99Ms: maxOf(samples.map((s) => s.loopDelayMs && s.loopDelayMs.p99)),
        loopMaxMs: maxOf(samples.map((s) => s.loopDelayMs && s.loopDelayMs.max)),
        cpuPct: maxOf(samples.map((s) => s.cpuPct)),
        cpuPctMean: meanOf(samples.map((s) => s.cpuPct)),
    };

    const starts = new Map(list.filter((r) => r.kind === 'run-start').map((r) => [r.item, r]));
    const ends = new Map(list.filter((r) => r.kind === 'run-end').map((r) => [r.item, r]));
    const runs = [...starts.values()].map((start) => {
        const own = scans.filter((s) => s.item === start.item).map((s) => s.sinceLastMs);
        const end = ends.get(start.item) || null;
        const k = Math.min(ENDS, Math.floor(own.length / 3));
        const early = own.length >= MIN_SCANS_FOR_SLOWDOWN ? median(own.slice(0, k)) : null;
        const late = own.length >= MIN_SCANS_FOR_SLOWDOWN ? median(own.slice(-k)) : null;
        return {
            item: start.item,
            name: start.name || null,
            status: end ? end.status : 'unfinished',
            scans: own.length,
            durationMs: end && Number.isFinite(end.durationMs) ? end.durationMs : null,
            earlyMedianMs: early,
            lateMedianMs: late,
            slowdown: early && late ? round1(late / early) : null,
        };
    });

    const first = list.find((r) => r.kind === 'session');
    return {
        host: first ? first.host || null : null,
        activeMs,
        scans: scans.length,
        scansPerMin: activeMs > 0 ? round1(scans.length / (activeMs / 60000)) : null,
        byRunning,
        peaks,
        runs,
    };
}

module.exports = { parseMetrics, summarizeMetrics, median };
