'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseMetrics, summarizeMetrics, median } = require('./queue-metrics-summary');

const T0 = Date.parse('2026-10-21T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const line = (s, r) => JSON.stringify({ t: at(s), ...r });

/**
 * Run A alone for 60 s (6 scans, 10 s apart), then A and B together for 60 s
 * (A 3 scans 20 s apart, B 3), then B alone until 150 s.
 */
function batch() {
    const out = [
        line(0, { kind: 'session', host: { cpus: 4 } }),
        line(0, { kind: 'run-start', item: 'a', name: 'A', running: 1 }),
    ];
    for (let i = 1; i <= 6; i += 1) out.push(line(i * 10 - 1, { kind: 'scan', item: 'a', sinceLastMs: 10000, scanMs: 1000, running: 1 }));
    out.push(line(60, { kind: 'run-start', item: 'b', name: 'B', running: 2 }));
    for (let i = 1; i <= 3; i += 1) {
        out.push(line(60 + i * 20 - 1, { kind: 'scan', item: 'a', sinceLastMs: 20000, scanMs: 3000, running: 2 }));
        out.push(line(60 + i * 20 - 2, { kind: 'scan', item: 'b', sinceLastMs: 20000, scanMs: 3000, running: 2 }));
    }
    out.push(line(30, { kind: 'sample', heapUsedMb: 300, heapPct: 7.5, heapLimitMb: 4000, rssMb: 500, browser: { rssMb: 800, processes: 5 }, loopDelayMs: { p99: 20, max: 40 }, cpuPct: 50 }));
    out.push(line(90, { kind: 'sample', heapUsedMb: 900, heapPct: 22.5, heapLimitMb: 4000, rssMb: 1200, browser: { rssMb: 1500, processes: 8 }, loopDelayMs: { p99: 120, max: 400 }, cpuPct: 150 }));
    out.push(line(120, { kind: 'run-end', item: 'a', status: 'done', durationMs: 120000, running: 1 }));
    out.push(line(150, { kind: 'run-end', item: 'b', status: 'error', durationMs: 90000, running: 0 }));
    out.push(line(150, { kind: 'session-end' }));
    return out.join('\n') + '\n{"t": "cut off';
}

describe('queue metrics summary', () => {
    test('parseMetrics sorts by time and skips a half-written line', () => {
        const records = parseMetrics(batch());
        assert.equal(records[0].kind, 'session');
        assert.equal(records[records.length - 1].kind, 'session-end');
        assert.ok(records.every((r, i) => i === 0 || r.ms >= records[i - 1].ms));
    });

    test('throughput at each number of runs going at once', () => {
        const s = summarizeMetrics(parseMetrics(batch()));
        assert.equal(s.activeMs, 150000);
        assert.equal(s.scans, 12);
        assert.deepEqual(s.byRunning.map((r) => [r.running, r.timeMs, r.scans, r.scansPerMin, r.medianSinceLastMs]), [
            [1, 90000, 6, 4, 10000],
            [2, 60000, 6, 6, 20000],
        ]);
        assert.deepEqual(s.host, { cpus: 4 });
    });

    test('the peaks', () => {
        const { peaks } = summarizeMetrics(parseMetrics(batch()));
        assert.equal(peaks.heapUsedMb, 900);
        assert.equal(peaks.heapPct, 22.5);
        assert.equal(peaks.browserRssMb, 1500);
        assert.equal(peaks.browserProcesses, 8);
        assert.equal(peaks.loopP99Ms, 120);
        assert.equal(peaks.cpuPct, 150);
        assert.equal(peaks.cpuPctMean, 100);
    });

    test("each run's slowdown, first scans against last", () => {
        const { runs } = summarizeMetrics(parseMetrics(batch()));
        const a = runs.find((r) => r.item === 'a');
        assert.deepEqual([a.status, a.scans, a.earlyMedianMs, a.lateMedianMs, a.slowdown], ['done', 9, 10000, 20000, 2]);
        const b = runs.find((r) => r.item === 'b');
        assert.equal(b.slowdown, null, 'too few scans to compare');
    });

    test('a resumed session does not count the time the server was down', () => {
        const text = [
            line(0, { kind: 'session' }),
            line(0, { kind: 'run-start', item: 'a', running: 1 }),
            line(60, { kind: 'scan', item: 'a', sinceLastMs: 60000, running: 1 }),
            // crash: no run-end, no session-end
            line(3600, { kind: 'session' }),
            line(3600, { kind: 'run-start', item: 'b', running: 1 }),
            line(3630, { kind: 'run-end', item: 'b', status: 'done', running: 0 }),
            line(3630, { kind: 'session-end' }),
        ].join('\n');
        assert.equal(summarizeMetrics(parseMetrics(text)).activeMs, 90000);
    });

    test('median', () => {
        assert.equal(median([3, 1, 2]), 2);
        assert.equal(median([4, 1, 2, 3]), 2.5);
        assert.equal(median([null, undefined]), null);
    });
});
