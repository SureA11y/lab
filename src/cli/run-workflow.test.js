'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { formatLogLine, countInstances, forceExit } = require('./run-workflow');

describe('formatLogLine', () => {
    test('indents by depth so nested actions stay readable', () => {
        assert.equal(formatLogLine({ message: 'top', depth: 0 }), 'top');
        assert.equal(formatLogLine({ message: 'nested', depth: 2 }), '    nested');
    });

    test('marks errors and leaves other types unprefixed', () => {
        assert.equal(formatLogLine({ message: 'boom', type: 'error' }), 'ERROR boom');
        assert.equal(formatLogLine({ message: 'fine', type: 'info' }), 'fine');
    });

    test('survives an entry with nothing usable in it', () => {
        assert.equal(formatLogLine({}), '');
        assert.equal(formatLogLine(null), '');
        assert.equal(formatLogLine({ message: 'x', depth: -3 }), 'x');
        assert.equal(formatLogLine({ message: 'x', depth: 'deep' }), 'x');
    });
});

describe('forceExit', () => {
    // Backs the second-Ctrl+C path: it used to call process.exit() directly,
    // skipping closeBrowser() entirely and leaking the browser process.
    test('closes the browser before exiting', async () => {
        const calls = [];
        await forceExit(42, {
            closeBrowserFn: async () => { calls.push('close'); },
            exitFn: (code) => calls.push(`exit:${code}`),
            timeoutMs: 50,
        });
        assert.deepEqual(calls, ['close', 'exit:42']);
    });

    test('still exits promptly even when closeBrowser hangs forever', async () => {
        const calls = [];
        await forceExit(42, {
            closeBrowserFn: () => new Promise(() => {}), // never resolves
            exitFn: (code) => calls.push(`exit:${code}`),
            timeoutMs: 10,
        });
        assert.deepEqual(calls, ['exit:42']);
    });

    test('still exits when closeBrowser rejects', async () => {
        const calls = [];
        await forceExit(42, {
            closeBrowserFn: async () => { throw new Error('boom'); },
            exitFn: (code) => calls.push(`exit:${code}`),
            timeoutMs: 50,
        });
        assert.deepEqual(calls, ['exit:42']);
    });

    test('still exits when closeBrowser throws synchronously', async () => {
        const calls = [];
        await forceExit(42, {
            closeBrowserFn: () => { throw new Error('boom'); },
            exitFn: (code) => calls.push(`exit:${code}`),
            timeoutMs: 50,
        });
        assert.deepEqual(calls, ['exit:42']);
    });
});

describe('countInstances', () => {
    test('sums occurrences rather than counting merged rules', () => {
        const findings = [
            { ruleId: 'image-alt', occurrences: [{}, {}, {}] },
            { ruleId: 'link-name', occurrences: [{}] },
        ];

        assert.equal(countInstances(findings), 4);
    });

    test('counts a finding with no occurrences as none', () => {
        assert.equal(countInstances([{ ruleId: 'image-alt' }, { ruleId: 'link-name', occurrences: [] }]), 0);
    });

    test('returns zero for anything that is not a list', () => {
        assert.equal(countInstances(undefined), 0);
        assert.equal(countInstances(null), 0);
        assert.equal(countInstances({ fail: [] }), 0);
    });
});

describe('priorOfFinishedRuns', () => {
    const { priorOfFinishedRuns } = require('./run-workflow');
    const MIN = 60000;
    const steps = [{ type: 'a11yScan' }, { type: 'a11yScan' }];
    const run = (url, actions = steps) => ({ spec: { url, actions } });
    const done = (over = {}) => ({ status: 'done', durationMs: 4 * MIN, scansRun: 2, scans: 2, ...over });

    test('is what the earlier runs of the same workflow took', () => {
        const runs = [run('a'), run('b'), run('c')];
        const prior = priorOfFinishedRuns(runs, [done(), done(), { status: 'waiting' }], 2);
        assert.equal(prior.runs, 2);
        assert.equal(prior.perScanMs, 2 * MIN);
    });

    test('needs two finished runs, and none before the first', () => {
        const runs = [run('a'), run('b'), run('c')];
        assert.equal(priorOfFinishedRuns(runs, [done(), { status: 'waiting' }, { status: 'waiting' }], 2), null);
        assert.equal(priorOfFinishedRuns(runs, [{ status: 'waiting' }, { status: 'waiting' }, { status: 'waiting' }], 0), null);
    });

    test('leaves out runs that failed or were cancelled, and runs of another workflow', () => {
        const runs = [run('a'), run('b', [{ type: 'click' }]), run('c'), run('d')];
        const items = [done(), done(), done({ status: 'error' }), { status: 'waiting' }];
        assert.equal(priorOfFinishedRuns(runs, items, 3), null, 'one run of this workflow finished, not two');
    });

    test('counts every scan a run ran, merged contexts included', () => {
        const runs = [run('a'), run('b'), run('c')];
        const prior = priorOfFinishedRuns(runs, [done({ scans: 1, scansRun: 2 }), done({ scans: 1, scansRun: 2 }), {}], 2);
        assert.equal(prior.meanScans, 2);
    });
});
