'use strict';

// A step type the engine does not have fails the step, as any other step
// that cannot run does, instead of being skipped without a word.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');

const page = { async $() { return null; }, async $$() { return []; }, url() { return 'about:blank'; } };

function run(actions, ctx = createWorkflowContext({})) {
    return applyActions(page, actions, null, 0, ctx, Object.create(null), 0, null);
}

describe('an unknown step type', () => {
    test('fails the step, naming the type', async () => {
        await assert.rejects(run([{ type: 'save' }]), /Unknown step type "save": the engine has no such step/);
    });

    test('stops the steps after it, as a failed step does', async () => {
        const ctx = createWorkflowContext({});
        await assert.rejects(run([{ type: 'nope' }, { type: 'setVar', key: 'after', value: 'ran' }], ctx));
        assert.equal(ctx.getVar('after'), undefined);
    });

    test('marked optional, is a failed optional step and the run goes on', async () => {
        const ctx = createWorkflowContext({});
        const results = [];
        await applyActions(page, [{ type: 'nope', optional: true }, { type: 'setVar', key: 'after', value: 'ran' }], results, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('after'), 'ran');
        assert.equal(results[0].status, 'failed-optional');
    });

    test('switched off, is skipped like any switched-off step', async () => {
        await run([{ type: 'nope', disabled: true }]);
    });
});
