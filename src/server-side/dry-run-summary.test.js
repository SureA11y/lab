'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { summarizeDryRun } = require('./dry-run-summary');

describe('summarizeDryRun', () => {
    test('gives each step as the app shows it, with notes under the step they belong to', () => {
        const actions = [
            { type: 'a11yScan', label: 'Basket', context: '#basket' },
            { type: 'group', alias: 'Checkout', actions: [{ type: 'a11yScan', label: 'Pay', context: '#pay' }, { type: 'click', selector: '#go' }] },
            { type: 'a11yScan', label: 'Done' },
        ];
        const payload = {
            url: 'https://example.com/',
            actionResults: [
                { index: 0, type: 'a11yScan', label: 'Basket', status: 'ok', actionPath: '1' },
                { index: 1, type: 'group', label: null, status: 'failed', error: 'click failed', failedAt: '2.2', actionPath: '2' },
            ],
        };
        const logs = [
            { message: 'Dry run: scan "Basket" would check nothing: its context "#basket" matches nothing on the page', extra: { actionPath: '1', dryRunProblem: 'context' } },
            { message: 'Dry run: scan "Pay" would check nothing: its context "#pay" matches nothing on the page', extra: { actionPath: '2.1', dryRunProblem: 'context' } },
        ];
        const summary = summarizeDryRun({ actions, payload, status: 'error', logs });

        assert.equal(summary.outcome, 'finished');
        assert.deepEqual(summary.steps.map((s) => [s.number, s.status, s.title]), [
            ['1', 'done', 'A11y scan "Basket"'],
            ['2', 'failed', 'Checkout'],
            ['3', 'not-run', 'A11y scan "Done"'],
        ]);
        assert.deepEqual(summary.steps[0].notes, ['would check nothing: its context "#basket" matches nothing on the page']);
        assert.deepEqual(summary.steps[1].notes, ['step 2.1: would check nothing: its context "#pay" matches nothing on the page']);
        assert.equal(summary.steps[1].failedAt, '2.2');
        assert.equal(summary.scansNotRun, 2);
        assert.equal(summary.scansWithNothing, 2);
        assert.equal(summary.problems, 3);
        assert.equal(summary.fits, false);
    });

    test('a run that never started, or was cancelled, says so', () => {
        assert.deepEqual(
            summarizeDryRun({ payload: null, status: 'error', error: { details: 'The workflow cannot run: Step 1: …' } }),
            { outcome: 'not-started', startError: 'The workflow cannot run: Step 1: …', steps: [], problems: 0, fits: false }
        );
        assert.equal(summarizeDryRun({ status: 'cancelled' }).outcome, 'cancelled');
    });

    test('is plain data, as the server sends it to the app', () => {
        const summary = summarizeDryRun({ actions: [{ type: 'wait' }], payload: { url: 'u', actionResults: [{ index: 0, type: 'wait', status: 'ok', actionPath: '1' }] }, status: 'done' });
        assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
        assert.equal(summary.fits, true);
    });
});
