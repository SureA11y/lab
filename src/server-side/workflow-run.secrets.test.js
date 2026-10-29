'use strict';

// A secret named by reference reaches the browser as its value, and every
// other place as the reference. The browser side is stubbed: what matters is
// what executeWorkflowRun hands it and what it writes.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const runner = require('./a11y-runner');
let handed = null;
require.cache[require.resolve('./a11y-runner')].exports = {
    ...runner,
    runA11yWorkflow: async (url, _unused, opts) => {
        handed = opts;
        return { scans: [], screenshots: [], actionResults: [], runDiagnostics: {} };
    },
};
const { executeWorkflowRun } = require('./workflow-run');

const ACTIONS = [
    { type: 'setPassword', selector: '#pwd', value: { $env: 'SHOP_PASSWORD' } },
    { type: 'runCustomStep', customStepId: 'login' },
];
const CUSTOM = [{ id: 'login', actions: [{ type: 'setPassword', selector: '#pin', value: { $env: 'SHOP_PIN' } }] }];

test('the browser gets the values; the report keeps the references', async () => {
    const { status, payload } = await executeWorkflowRun(
        { url: 'https://example.com/', actions: ACTIONS, customSteps: CUSTOM },
        { stepsChecked: true, env: { SHOP_PASSWORD: 'hunter2', SHOP_PIN: '1234' } },
    );
    assert.equal(status, 'done');
    assert.equal(handed.actions[0].value, 'hunter2');
    assert.equal(handed.customSteps[0].actions[0].value, '1234');
    assert.deepEqual(payload.actions[0].value, { $env: 'SHOP_PASSWORD' });
    assert.equal(JSON.stringify(payload).includes('hunter2'), false);
    assert.deepEqual(ACTIONS[0].value, { $env: 'SHOP_PASSWORD' });
});

test('an unset variable stops the run before the browser, naming it', async () => {
    handed = null;
    const { status, payload, error } = await executeWorkflowRun(
        { url: 'https://example.com/', actions: ACTIONS, customSteps: CUSTOM },
        { stepsChecked: true, env: { SHOP_PASSWORD: 'hunter2', SHOP_PIN: '' } },
    );
    assert.equal(status, 'error');
    assert.equal(payload, null);
    assert.equal(handed, null);
    assert.equal(error.details, 'The workflow cannot run: $SHOP_PIN is not set in the environment.');
});
