'use strict';

// The engine's part of a dry run (run-workflow.js --dry-run): no screenshots
// or evidence, in nested steps too; and where a nested step failed.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');

const page = { async $() { return null; }, async $$() { return []; }, url() { return 'about:blank'; } };

describe('a dry run', () => {
    test('takes no screenshot and captures no evidence, nested ones included', async () => {
        const ctx = createWorkflowContext({ dryRun: true });
        let saved = 0;
        ctx.saveScreenshotFile = async () => { saved += 1; return {}; };
        ctx.saveEvidenceFile = async () => { saved += 1; return {}; };
        const logs = [];
        ctx.progress = (e) => logs.push(e.message);
        await applyActions(page, [
            { type: 'screenshot', label: 'Home' },
            { type: 'group', actions: [{ type: 'evidenceCapture', label: 'Deep' }] },
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(saved, 0);
        assert.ok(logs.includes('Dry run: screenshot not taken'));
        assert.ok(logs.includes('Dry run: evidence not captured'));
    });
});

describe('a failed step\'s result', () => {
    test('says where in it a nested step failed', async () => {
        const results = [];
        await assert.rejects(applyActions(page, [
            { type: 'setVar', key: 'a', value: 1 },
            { type: 'group', actions: [{ type: 'setVar', key: 'b', value: 2 }, { type: 'nope' }] },
        ], results, 0, createWorkflowContext({}), Object.create(null), 0, null));
        assert.equal(results[1].status, 'failed');
        assert.equal(results[1].failedAt, '2.2');
    });

    test('says nothing more when the step itself failed', async () => {
        const results = [];
        await assert.rejects(applyActions(page, [{ type: 'nope' }], results, 0, createWorkflowContext({}), Object.create(null), 0, null));
        assert.equal('failedAt' in results[0], false);
    });
});
