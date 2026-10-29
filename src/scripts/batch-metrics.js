#!/usr/bin/env node
'use strict';

/**
 * Prints what a queue session's metrics.jsonl says about the batch: scans a
 * minute at each number of runs going at once, the memory, event-loop and CPU
 * peaks, and how much each run slowed down from its first scans to its last.
 *
 *   npm run batch:metrics -- reports/batches/2026-10-21T10-00-00
 *   npm run batch:metrics -- reports/batches/2026-10-21T10-00-00/metrics.jsonl --json
 */

const fs = require('fs');
const path = require('path');
const { METRICS_NAME } = require('../server-side/queue-files');
const { parseMetrics, summarizeMetrics } = require('../server-side/queue-metrics-summary');

const fmt = (v, unit = '') => (v === null || v === undefined ? '-' : `${v}${unit}`);
const mins = (ms) => {
    if (!Number.isFinite(ms)) return '-';
    return ms < 60000 ? `${(ms / 1000).toFixed(0)} s` : `${(ms / 60000).toFixed(1)} min`;
};
const secs = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '-');

function main(argv) {
    const args = argv.filter((a) => a !== '--json');
    if (!args[0]) {
        console.error('Usage: batch-metrics <session folder | metrics.jsonl> [--json]');
        return 2;
    }
    let file = path.resolve(args[0]);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, METRICS_NAME);
    if (!fs.existsSync(file)) {
        console.error(`No ${METRICS_NAME} at ${file}`);
        return 1;
    }

    const summary = summarizeMetrics(parseMetrics(fs.readFileSync(file, 'utf8')));
    if (argv.includes('--json')) {
        console.log(JSON.stringify(summary, null, 2));
        return 0;
    }

    const h = summary.host;
    if (h) console.log(`Host: ${h.platform}, Node ${h.node}, ${h.cpus} CPUs, ${h.totalMemMb} MB RAM, heap limit ${h.heapLimitMb} MB`);
    console.log(`Active ${mins(summary.activeMs)}, ${summary.scans} scans, ${fmt(summary.scansPerMin)} scans/min\n`);

    console.log('Runs at once   time        scans   scans/min   between scans   scan itself');
    for (const r of summary.byRunning) {
        console.log(`${String(r.running).padEnd(15)}${mins(r.timeMs).padEnd(12)}${String(r.scans).padEnd(8)}`
            + `${fmt(r.scansPerMin).padEnd(12)}${secs(r.medianSinceLastMs).padEnd(16)}${secs(r.medianScanMs)}`);
    }

    const p = summary.peaks;
    console.log('\nPeaks');
    console.log(`  Node heap      ${fmt(p.heapUsedMb, ' MB')} (${fmt(p.heapPct, '%')} of ${fmt(p.heapLimitMb, ' MB')})`);
    console.log(`  Node process   ${fmt(p.rssMb, ' MB')}`);
    console.log(`  Browser        ${fmt(p.browserRssMb, ' MB')} in ${fmt(p.browserProcesses)} processes`);
    console.log(`  Event loop     p99 ${fmt(p.loopP99Ms, ' ms')}, max ${fmt(p.loopMaxMs, ' ms')}`);
    console.log(`  CPU (1 core)   max ${fmt(p.cpuPct, '%')}, mean ${fmt(p.cpuPctMean, '%')}`);

    console.log('\nPer run (median time between scans, first vs last)');
    for (const r of summary.runs) {
        console.log(`  ${(r.name || r.item).slice(0, 40).padEnd(42)}${r.status.padEnd(12)}${String(r.scans).padEnd(6)}`
            + `${secs(r.earlyMedianMs)} -> ${secs(r.lateMedianMs)}${r.slowdown ? `  (x${r.slowdown})` : ''}`);
    }
    return 0;
}

process.exitCode = main(process.argv.slice(2));
