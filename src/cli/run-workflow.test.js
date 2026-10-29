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
