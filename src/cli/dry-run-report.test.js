'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildDryRunReport } = require('./dry-run-report');

const actions = [
    { type: 'click', selector: '#accept', label: 'Accept cookies' },
    { type: 'a11yScan', label: 'Basket', context: '#basket' },
    { type: 'group', alias: 'Checkout', actions: [{ type: 'click', selector: '#checkout' }] },
    { type: 'a11yScan', label: 'Payment' },
];

const scanLog = (path, problem) => ({
    type: problem ? 'warning' : 'info',
    message: problem
        ? 'Dry run: scan "Basket" would check nothing: its context "#basket" matches nothing on the page'
        : 'Dry run: scan "Home" not run',
    extra: { actionPath: path, ...(problem ? { dryRunProblem: 'context' } : {}) },
});

describe('buildDryRunReport', () => {
    test('says each step, where a nested one failed, what was not reached, and scans with nothing to check', () => {
        const payload = {
            url: 'https://example.com/',
            actionResults: [
                { index: 0, type: 'click', label: 'Accept cookies', status: 'ok', actionPath: '1' },
                { index: 1, type: 'a11yScan', label: 'Basket', status: 'ok', actionPath: '2' },
                { index: 2, type: 'group', label: null, status: 'failed', error: 'click failed: "#checkout" not found', failedAt: '3.1', actionPath: '3' },
            ],
        };
        const { lines, exitCode } = buildDryRunReport({ actions, payload, status: 'error', logs: [scanLog('2', true)] });
        const text = lines.join('\n');
        assert.match(text, /done {5}1 {4}Click "Accept cookies"/);
        assert.match(text, /done {5}2 {4}A11y scan "Basket"\n {16}would check nothing: its context "#basket" matches nothing on the page/);
        assert.match(text, /FAILED {3}3 {4}Checkout \(at step 3\.1\): click failed: "#checkout" not found/);
        assert.match(text, /not run {2}4 {4}A11y scan "Payment"/);
        assert.match(text, /Result {5}the workflow does not fit the site as it stands: 2 problems above/);
        assert.equal(exitCode, 4);
    });

    test('a workflow whose every step ran fits the site', () => {
        const payload = { url: 'https://example.com/', actionResults: actions.map((a, i) => ({ index: i, type: a.type, label: a.label || null, status: 'ok', actionPath: String(i + 1) })) };
        const { lines, exitCode } = buildDryRunReport({ actions, payload, status: 'done', logs: [scanLog('2'), scanLog('4')] });
        assert.match(lines.join('\n'), /Scans {6}2 scans not run\nResult {5}every step ran: the workflow fits the site/);
        assert.equal(exitCode, 0);
    });

    test('an optional step that failed is said, but the workflow still fits', () => {
        const payload = { url: 'u', actionResults: [{ index: 0, type: 'click', label: 'Accept cookies', status: 'failed-optional', error: 'not found', actionPath: '1' }] };
        const { lines, exitCode } = buildDryRunReport({ actions: actions.slice(0, 1), payload, status: 'done' });
        assert.match(lines.join('\n'), /optional 1 {4}Click "Accept cookies": not found/);
        assert.equal(exitCode, 0);
    });

    test('loops whose iterations failed do not fit', () => {
        const payload = { url: 'u', actionResults: [], iterationFailureSummary: { total: 2, topErrors: [{ error: 'boom' }] } };
        const { lines, exitCode } = buildDryRunReport({ actions: [], payload, status: 'done' });
        assert.match(lines.join('\n'), /Loops {6}2 iterations failed: boom/);
        assert.equal(exitCode, 4);
    });

    test('a run that could not start, or was cancelled, says so', () => {
        assert.equal(buildDryRunReport({ payload: null, status: 'error', error: { details: 'Invalid url' } }).exitCode, 1);
        assert.equal(buildDryRunReport({ payload: null, status: 'cancelled' }).exitCode, 130);
    });
});
