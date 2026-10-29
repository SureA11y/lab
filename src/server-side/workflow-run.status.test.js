'use strict';

// How a run ended, as the runner reports it, is the run's status: a run the
// runner says failed (a page it could not open, a step that failed and was
// not optional) is an error, with what it had done so far. The browser side
// is stubbed: what matters is what executeWorkflowRun makes of its answer.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const runner = require('./a11y-runner');
let answer = null;
require.cache[require.resolve('./a11y-runner')].exports = {
    ...runner,
    runA11yWorkflow: async () => answer,
};
const { executeWorkflowRun } = require('./workflow-run');

const SPEC = { url: 'https://example.com/', actions: [{ type: 'a11yScan', label: 'home' }] };
const base = { url: SPEC.url, scans: [], screenshots: [], actionResults: [], runDiagnostics: {} };

test('a run the runner says failed is an error, with its message and a payload', async () => {
    answer = { ...base, failed: true, error: { message: 'net::ERR_CONNECTION_REFUSED at https://example.com/', actionPath: null } };
    const { status, payload } = await executeWorkflowRun(SPEC, { stepsChecked: true });
    assert.equal(status, 'error');
    assert.equal(payload.failed, true);
    assert.equal(payload.errorDetails.message, 'net::ERR_CONNECTION_REFUSED at https://example.com/');
    assert.equal(payload.cancelled, undefined);
});

test('a run that finished is done; a cancelled one is cancelled, not failed', async () => {
    answer = { ...base };
    assert.equal((await executeWorkflowRun(SPEC, { stepsChecked: true })).status, 'done');
    answer = { ...base, cancelled: true, failed: true };
    const { status, payload } = await executeWorkflowRun(SPEC, { stepsChecked: true });
    assert.equal(status, 'cancelled');
    assert.equal(payload.failed, undefined);
});

test('a start url that is not a web page stops the run before the browser', async () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', undefined]) {
        answer = { ...base };
        const { status, payload, error } = await executeWorkflowRun({ ...SPEC, url }, { stepsChecked: true });
        assert.equal(status, 'error');
        assert.equal(payload, null);
        assert.match(error.details, /^The workflow cannot run: (Unsupported protocol|Missing url)/);
    }
});

test('a spec with no actions, or actions that are not a list, stops the run before the browser', async () => {
    for (const actions of [[], { type: 'a11yScan' }, undefined]) {
        const { status, payload, error } = await executeWorkflowRun({ ...SPEC, actions }, { stepsChecked: true });
        assert.equal(status, 'error');
        assert.equal(payload, null);
        assert.match(error.details, /has no actions/);
    }
});
