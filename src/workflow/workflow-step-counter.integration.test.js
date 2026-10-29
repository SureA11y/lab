'use strict';

/**
 * The step counter is only as good as the agreement between two things written
 * in different files: the static plan's idea of where an action sits in the
 * tree, and the `actionPath` the engine stamps on its logs. These tests run the
 * real engine and feed its real log stream to the counter, so a drift in either
 * numbering shows up here rather than as a quietly wrong number in the UI.
 *
 * Only action types that never touch the page are used - the same constraint
 * the unit tests in workflow-engine.test.js work under. forEachElement's own
 * DOM traversal needs a live Puppeteer page, so its events are covered
 * synthetically in src/shared/workflow-step-counter.test.js instead.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');
const { planWorkflowSteps } = require('../shared/workflow-step-plan.js');
const { createStepCounter } = require('../shared/workflow-step-counter.js');

const fakePage = {
    async $() { return null; },
    async $$() { return []; },
    url() { return 'about:blank'; }
};

async function run(actions, customSteps = {}) {
    const ctx = createWorkflowContext({ customSteps });
    await applyActions(fakePage, actions, null, 0, ctx, Object.create(null), 0, null);

    const counter = createStepCounter({ actions, customSteps });
    const snapshot = counter.acceptAll(ctx.runLogs || []);
    return { snapshot, plan: planWorkflowSteps(actions, { customSteps }), logs: ctx.runLogs || [] };
}

describe('step counter against the real engine', () => {
    test('every action the engine ran is counted once, by type', async () => {
        const { snapshot } = await run([
            { type: 'setVar', key: 'a', value: '1' },
            { type: 'group', actions: [{ type: 'setVar', key: 'b', value: '2' }, { type: 'clearVar', key: 'a' }] }
        ]);

        assert.equal(snapshot.done, 4);
        assert.deepEqual(snapshot.doneByType, { setVar: 2, group: 1, clearVar: 1 });
        assert.equal(snapshot.remaining, 0);
        assert.equal(snapshot.unmatched.length, 0);
    });

    test('done lands inside the range the plan predicted', async () => {
        const actions = [
            { type: 'setVar', key: 'x', value: '1' },
            { type: 'if', var: 'x', equals: '1', actions: [{ type: 'setVar', key: 'y', value: '2' }], elseActions: [] },
            { type: 'repeat', repetitions: 3, actions: [{ type: 'setVar', key: 'z', value: '3' }] }
        ];
        const { snapshot, plan } = await run(actions);

        assert.ok(snapshot.done >= plan.min, `${snapshot.done} < plan.min ${plan.min}`);
        assert.ok(snapshot.done <= plan.max, `${snapshot.done} > plan.max ${plan.max}`);
        assert.equal(snapshot.remaining, 0, 'a finished run has nothing left');
        assert.equal(snapshot.unmatched.length, 0);
    });

    test('the branch the engine did not take is reclaimed, not waited for', async () => {
        const actions = [
            { type: 'setVar', key: 'x', value: 'no' },
            {
                type: 'if', var: 'x', equals: 'yes',
                actions: [{ type: 'setVar', key: 'a', value: '1' }, { type: 'setVar', key: 'b', value: '2' }],
                elseActions: [{ type: 'setVar', key: 'c', value: '3' }]
            }
        ];
        const { snapshot, plan } = await run(actions);

        assert.equal(plan.max, 4);          // setVar + if + the two-action then branch
        assert.equal(snapshot.done, 3);     // setVar + if + the one-action else branch
        assert.equal(snapshot.remaining, 0);
        assert.equal(snapshot.ratchetHits, 0);
    });

    test('an ifUrl branch not taken is reclaimed the same way', async () => {
        const actions = [{
            type: 'ifUrl', urlPart: 'path', comparison: 'equals', value: '/checkout',
            actions: [{ type: 'setVar', key: 'a', value: '1' }, { type: 'setVar', key: 'b', value: '2' }],
            elseActions: [{ type: 'setVar', key: 'c', value: '3' }]
        }];
        const { snapshot, plan } = await run(actions);

        assert.equal(plan.max, 3);          // ifUrl + the two-action then branch
        assert.equal(snapshot.done, 2);     // about:blank: ifUrl + the else branch
        assert.equal(snapshot.remaining, 0);
        assert.equal(snapshot.unmatched.length, 0);
    });

    test('a switch: the cases and default not taken are reclaimed, nested paths match', async () => {
        const actions = [{
            type: 'switch', subject: 'var', var: 'missing',
            cases: [
                { type: 'case', comparison: 'equals', value: 'a', actions: [{ type: 'setVar', key: 'a', value: '1' }, { type: 'setVar', key: 'b', value: '2' }] },
                { type: 'case', comparison: 'notEquals', value: 'a', actions: [{ type: 'group', actions: [{ type: 'setVar', key: 'c', value: '3' }] }] }
            ],
            defaultActions: [{ type: 'setVar', key: 'd', value: '4' }, { type: 'setVar', key: 'e', value: '5' }, { type: 'setVar', key: 'f', value: '6' }]
        }];
        const { snapshot, plan } = await run(actions);

        assert.equal(plan.max, 4);          // switch + the three-step default
        assert.equal(snapshot.done, 3);     // switch + case 2's group and its step
        assert.equal(snapshot.remaining, 0);
        assert.equal(snapshot.unmatched.length, 0);
        assert.equal(snapshot.ratchetHits, 0);
    });

    test('a disabled action shifts no numbering the counter depends on', async () => {
        const actions = [
            { type: 'setVar', key: 'a', value: '1', disabled: true },
            { type: 'if', var: 'a', equals: '1', actions: [{ type: 'setVar', key: 'b', value: '2' }], elseActions: [{ type: 'clearVar', key: 'b' }] }
        ];
        const { snapshot } = await run(actions);

        assert.equal(snapshot.unmatched.length, 0, 'the if was found at its engine path');
        assert.equal(snapshot.remaining, 0);
    });

    test('a disabled action inside a repeat body, where the engine renumbers, still matches', async () => {
        const actions = [{
            type: 'repeat', repetitions: 2,
            actions: [
                { type: 'setVar', key: 'a', value: '1', disabled: true },
                { type: 'if', var: 'missing', equals: 'x', actions: [{ type: 'setVar', key: 'b', value: '2' }], elseActions: [] }
            ]
        }];
        const { snapshot } = await run(actions);

        assert.equal(snapshot.unmatched.length, 0);
        assert.equal(snapshot.remaining, 0);
    });

    test('custom step bodies are counted in their own path namespace', async () => {
        const customSteps = {
            twice: { id: 'twice', actions: [{ type: 'setVar', key: 'p', value: '1' }, { type: 'setVar', key: 'q', value: '2' }] }
        };
        const { snapshot } = await run([{ type: 'runCustomStep', customStepId: 'twice' }], customSteps);

        assert.equal(snapshot.done, 3); // the call + two actions inside
        assert.equal(snapshot.doneByType.setVar, 2);
        assert.equal(snapshot.unmatched.length, 0);
    });

    test('an optional action that fails is done, not pending', async () => {
        const actions = [
            { type: 'runCustomStep', customStepId: 'missing', optional: true },
            { type: 'setVar', key: 'a', value: '1' }
        ];
        const { snapshot } = await run(actions);

        assert.equal(snapshot.done, 2);
        assert.equal(snapshot.remaining, 0);
    });

    test('remaining falls monotonically over the engine\'s own log stream', async () => {
        const actions = [
            { type: 'setVar', key: 'x', value: 'no' },
            { type: 'if', var: 'x', equals: 'yes', actions: [{ type: 'setVar', key: 'a', value: '1' }], elseActions: [{ type: 'clearVar', key: 'x' }] },
            { type: 'repeat', repetitions: 3, actions: [{ type: 'setVar', key: 'z', value: '3' }, { type: 'clearVar', key: 'z' }] },
            { type: 'group', actions: [{ type: 'setVar', key: 'w', value: '9' }] }
        ];

        const ctx = createWorkflowContext({ customSteps: {} });
        await applyActions(fakePage, actions, null, 0, ctx, Object.create(null), 0, null);

        const counter = createStepCounter({ actions });
        let previous = counter.snapshot().remaining;
        for (const entry of ctx.runLogs) {
            const s = counter.accept(entry);
            assert.ok(s.remaining <= previous, `remaining rose from ${previous} to ${s.remaining} on ${entry.message}`);
            previous = s.remaining;
        }
        assert.equal(counter.snapshot().ratchetHits, 0);
        assert.equal(counter.snapshot().unmatched.length, 0);
    });
});
