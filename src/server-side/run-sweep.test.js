'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    FINISHED_RUN_TTL_MS,
    IDLE_RUN_TTL_MS,
    sweepFinishedRuns,
    sweepIdleRuns,
    startRunSweeper,
} = require('./run-sweep');

const FINISHED = new Set(['done', 'cancelled', 'error']);
const isFinished = (status) => FINISHED.has(status);
const isOpen = (status) => status === 'collecting';

function registry(entries) {
    return new Map(Object.entries(entries));
}

describe('run sweep', () => {
    test('stamps a finished run the first time it is seen and keeps it', () => {
        const runs = registry({ a: { status: 'done' } });
        assert.equal(sweepFinishedRuns(runs, { isFinished, now: 1000 }), 0);
        assert.equal(runs.get('a').finishedAt, 1000);
    });

    test('removes a finished run once the ttl has passed, not before', () => {
        const runs = registry({ a: { status: 'done', finishedAt: 0 } });
        sweepFinishedRuns(runs, { isFinished, now: FINISHED_RUN_TTL_MS - 1 });
        assert.ok(runs.has('a'));
        assert.equal(sweepFinishedRuns(runs, { isFinished, now: FINISHED_RUN_TTL_MS }), 1);
        assert.ok(!runs.has('a'));
    });

    test('never removes a run that is still running or cancelling, however old', () => {
        const runs = registry({
            r: { status: 'running', createdAt: 0 },
            c: { status: 'cancelling', createdAt: 0 },
            m: { status: 'collecting', createdAt: 0 },
        });
        sweepFinishedRuns(runs, { isFinished, now: 10 * FINISHED_RUN_TTL_MS });
        assert.deepEqual([...runs.keys()], ['r', 'c', 'm']);
        for (const run of runs.values()) assert.equal(run.finishedAt, undefined);
    });

    test('counts the ttl from when the run finished, not when it started', () => {
        const runs = registry({ a: { status: 'running', createdAt: 0 } });
        sweepFinishedRuns(runs, { isFinished, now: 5 * FINISHED_RUN_TTL_MS });
        runs.get('a').status = 'done';
        sweepFinishedRuns(runs, { isFinished, now: 6 * FINISHED_RUN_TTL_MS });
        assert.ok(runs.has('a'));
        sweepFinishedRuns(runs, { isFinished, now: 7 * FINISHED_RUN_TTL_MS });
        assert.ok(!runs.has('a'));
    });

    test('treats done, cancelled and error alike and leaves the rest of the map alone', () => {
        const runs = registry({
            d: { status: 'done', finishedAt: 0 },
            c: { status: 'cancelled', finishedAt: 0 },
            e: { status: 'error', finishedAt: 0 },
            fresh: { status: 'done', finishedAt: 100 },
            live: { status: 'running' },
        });
        assert.equal(sweepFinishedRuns(runs, { isFinished, now: 100, ttlMs: 50 }), 3);
        assert.deepEqual([...runs.keys()], ['fresh', 'live']);
    });

    test('removes a collecting run idle since it was created, once the idle limit has passed', () => {
        const runs = registry({ m: { status: 'collecting', createdAt: 0 } });
        assert.equal(sweepIdleRuns(runs, { isOpen, now: IDLE_RUN_TTL_MS - 1 }), 0);
        assert.ok(runs.has('m'));
        assert.equal(sweepIdleRuns(runs, { isOpen, now: IDLE_RUN_TTL_MS }), 1);
        assert.ok(!runs.has('m'));
    });

    test('counts idleness from the last activity, so a session still receiving scans is kept', () => {
        const runs = registry({ m: { status: 'collecting', createdAt: 0, lastActivityAt: 3 * IDLE_RUN_TTL_MS } });
        sweepIdleRuns(runs, { isOpen, now: 3 * IDLE_RUN_TTL_MS + IDLE_RUN_TTL_MS - 1 });
        assert.ok(runs.has('m'));
        sweepIdleRuns(runs, { isOpen, now: 4 * IDLE_RUN_TTL_MS });
        assert.ok(!runs.has('m'));
    });

    test('the idle sweep leaves runs that are not open alone, and runs with no timestamps', () => {
        const runs = registry({
            done: { status: 'done', createdAt: 0 },
            running: { status: 'running', createdAt: 0 },
            undated: { status: 'collecting' },
        });
        assert.equal(sweepIdleRuns(runs, { isOpen, now: 10 * IDLE_RUN_TTL_MS }), 0);
        assert.deepEqual([...runs.keys()], ['done', 'running', 'undated']);
    });

    test('the sweeper only applies the idle limit to registries that say which runs are open', async () => {
        const workflow = registry({ r: { status: 'collecting', createdAt: 0 } });
        const manual = registry({ m: { status: 'collecting', createdAt: 0 } });
        const stop = startRunSweeper([
            { runs: workflow, isFinished },
            { runs: manual, isFinished, isOpen },
        ], { intervalMs: 5, ttlMs: 1, idleMs: 1 });
        try {
            await new Promise((resolve) => setTimeout(resolve, 30));
            assert.ok(workflow.has('r'));
            assert.ok(!manual.has('m'));
        } finally {
            stop();
        }
    });

    test('a registry\'s own ttl and idle limit override the sweeper defaults', async () => {
        const now = Date.now();
        const workflow = registry({ a: { status: 'done', finishedAt: now } });
        const manual = registry({
            b: { status: 'done', finishedAt: now },
            c: { status: 'collecting', createdAt: now },
        });
        const stop = startRunSweeper([
            { runs: workflow, isFinished },
            { runs: manual, isFinished, ttlMs: 60 * 60 * 1000, isOpen, idleMs: 60 * 60 * 1000 },
        ], { intervalMs: 5, ttlMs: 1, idleMs: 1 });
        try {
            await new Promise((resolve) => setTimeout(resolve, 30));
            assert.ok(!workflow.has('a'));
            assert.deepEqual([...manual.keys()], ['b', 'c']);
        } finally {
            stop();
        }
    });

    test('the sweeper runs every registry on its interval and stops when asked', async () => {
        const workflow = registry({ a: { status: 'done', finishedAt: 0 } });
        const manual = registry({ b: { status: 'error', finishedAt: 0 } });
        const stop = startRunSweeper([
            { runs: workflow, isFinished },
            { runs: manual, isFinished: (s) => s === 'done' || s === 'error' },
        ], { intervalMs: 5, ttlMs: 1 });
        try {
            await new Promise((resolve) => setTimeout(resolve, 30));
            assert.equal(workflow.size, 0);
            assert.equal(manual.size, 0);
        } finally {
            stop();
        }
    });
});
