'use strict';

/**
 * What the server and its browser are using, sampled for the queue's metrics
 * log (docs/design/workflow-queue-batch-design.md §5.1): Node's heap against its
 * limit, how late the event loop runs, the process's CPU, and the memory of
 * the shared Chromium with all its child processes (renderers, GPU, ...).
 *
 * Every figure comes from Node itself except the browser's memory, read from
 * `ps` on macOS and Linux; it is null elsewhere, and while no browser runs.
 */

const os = require('os');
const v8 = require('v8');
const { execFile } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');

const MB = 1024 * 1024;
const PS_TIMEOUT_MS = 2000;

const round1 = (n) => Math.round(n * 10) / 10;
const mb = (bytes) => round1(bytes / MB);
const nsToMs = (ns) => (Number.isFinite(ns) ? round1(ns / 1e6) : null);

/**
 * The resident memory of `rootPid` and every process under it, from the text
 * `ps -A -o pid=,ppid=,rss=` prints (rss in KB): `{ rssKb, processes }`, or
 * null when `rootPid` is not listed.
 */
function processTreeRss(psOutput, rootPid) {
    const rss = new Map();
    const children = new Map();
    for (const line of String(psOutput || '').split('\n')) {
        const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
        if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isFinite(kb)) continue;
        rss.set(pid, kb);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
    }
    if (!rss.has(rootPid)) return null;
    let rssKb = 0;
    let processes = 0;
    const seen = new Set();
    const stack = [rootPid];
    while (stack.length) {
        const pid = stack.pop();
        if (seen.has(pid)) continue;
        seen.add(pid);
        rssKb += rss.get(pid) || 0;
        processes += 1;
        stack.push(...(children.get(pid) || []));
    }
    return { rssKb, processes };
}

function defaultReadPs() {
    return new Promise((resolve) => {
        execFile('ps', ['-A', '-o', 'pid=,ppid=,rss='], { timeout: PS_TIMEOUT_MS, maxBuffer: 4 * MB }, (err, stdout) => {
            resolve(err ? null : stdout);
        });
    });
}

/**
 * @param {object} [opts]
 * @param {() => number|null} [opts.browserPid] The shared browser's process id.
 * @param {() => Promise<string|null>} [opts.readPs] `ps` output, for tests.
 */
function createResourceSampler({
    browserPid = () => null,
    readPs = defaultReadPs,
    platform = process.platform,
} = {}) {
    const loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
    let lastCpu = process.cpuUsage();
    let lastAt = process.hrtime.bigint();

    async function browserMemory() {
        if (platform === 'win32') return null;
        let pid = null;
        try { pid = browserPid(); } catch {}
        if (!Number.isInteger(pid)) return null;
        const tree = processTreeRss(await readPs(), pid);
        return tree ? { rssMb: round1(tree.rssKb / 1024), processes: tree.processes } : null;
    }

    /** One sample; the CPU and event-loop figures cover the time since the last one. */
    async function sample() {
        const mem = process.memoryUsage();
        const heapLimit = v8.getHeapStatistics().heap_size_limit;

        const at = process.hrtime.bigint();
        const cpu = process.cpuUsage(lastCpu);
        const elapsedUs = Number(at - lastAt) / 1000;
        lastCpu = process.cpuUsage();
        lastAt = at;

        const loopDelayMs = {
            mean: nsToMs(loop.mean),
            p99: nsToMs(loop.percentile(99)),
            max: nsToMs(loop.max),
        };
        loop.reset();

        return {
            heapUsedMb: mb(mem.heapUsed),
            heapTotalMb: mb(mem.heapTotal),
            heapLimitMb: mb(heapLimit),
            heapPct: round1((mem.heapUsed / heapLimit) * 100),
            rssMb: mb(mem.rss),
            externalMb: mb(mem.external),
            arrayBuffersMb: mb(mem.arrayBuffers),
            loopDelayMs,
            // Of one core: above 100 when Node's own threads (GC, I/O) add up.
            cpuPct: elapsedUs > 0 ? round1(((cpu.user + cpu.system) / elapsedUs) * 100) : null,
            loadAvg1: platform === 'win32' ? null : round1(os.loadavg()[0]),
            freeMemMb: mb(os.freemem()),
            browser: await browserMemory(),
        };
    }

    /** What the machine is, once per session. */
    function host() {
        return {
            platform,
            node: process.version,
            cpus: os.cpus().length,
            totalMemMb: mb(os.totalmem()),
            heapLimitMb: mb(v8.getHeapStatistics().heap_size_limit),
        };
    }

    function stop() {
        loop.disable();
    }

    return { sample, host, stop };
}

module.exports = { createResourceSampler, processTreeRss };
