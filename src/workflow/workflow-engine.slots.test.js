'use strict';

// A custom step's places (slot steps) and the steps a call gives for them
// (its slots list of slotSteps steps), against the real engine with a stub
// page. See docs/design/custom-step-slots-design.md.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');

const page = {
    async $() { return null; },
    async $$() { return []; },
    async evaluate() { return null; },
    url: async () => 'https://example.com/'
};

// Every write through ctx.vars, in order: which steps ran, and when.
function makeCtx(customSteps) {
    const ctx = createWorkflowContext({ customSteps });
    const trail = [];
    const realVars = ctx.vars;
    ctx.vars = new Proxy(realVars, {
        set(target, k, v) {
            trail.push(`${String(k)}=${v}`);
            target[k] = v;
            return true;
        }
    });
    ctx.trail = trail;
    return ctx;
}

const mark = (key, value = 'x') => ({ type: 'setVar', key, value });
const fill = (slot, actions, extra = {}) => ({ type: 'slotSteps', slot, actions, ...extra });

const LOG_IN = {
    id: 'log-in',
    inputs: [{ name: 'user', required: true }],
    slots: [{ name: 'beforeSubmit' }, { name: 'afterSubmit' }],
    actions: [
        mark('typed', '{var:user}'),
        { type: 'slot', slot: 'beforeSubmit' },
        mark('submitted'),
        { type: 'slot', slot: 'afterSubmit' },
        mark('done')
    ]
};

async function run(step, customSteps = [LOG_IN]) {
    const ctx = makeCtx(customSteps);
    await applyActions(page, [step], null, 0, ctx, Object.create(null), 0, null);
    return ctx;
}

describe('a custom step\'s places', () => {
    test('run the call\'s steps where the custom step puts them', async () => {
        const ctx = await run({
            type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}',
            slots: [fill('afterSubmit', [mark('trusted')]), fill('beforeSubmit', [mark('terms')])]
        });
        assert.deepEqual(ctx.trail, ['typed=ana', 'terms=x', 'submitted=x', 'trusted=x', 'done=x']);
    });

    test('a place the call gives nothing for is skipped', async () => {
        const ctx = await run({ type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}' });
        assert.deepEqual(ctx.trail, ['typed=ana', 'submitted=x', 'done=x']);
        assert.ok(ctx.runLogs.some((l) => /slot "afterSubmit": the call gives no steps, skipped/.test(l.message)));
    });

    test('a disabled list of steps gives nothing', async () => {
        const ctx = await run({
            type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}',
            slots: [fill('afterSubmit', [mark('trusted')], { disabled: true })]
        });
        assert.deepEqual(ctx.trail, ['typed=ana', 'submitted=x', 'done=x']);
    });

    test('the call\'s steps read the call\'s inputs', async () => {
        const ctx = await run({
            type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}',
            slots: [fill('afterSubmit', [mark('who', 'it was {var:user}')])]
        });
        assert.ok(ctx.trail.includes('who=it was ana'));
    });

    test('a required place must be given steps', async () => {
        const strict = { ...LOG_IN, slots: [{ name: 'afterSubmit', required: true }] };
        await assert.rejects(
            run({ type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}' }, [strict]),
            /missing steps for its required place "afterSubmit"/
        );
        await assert.rejects(
            run({ type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}', slots: [fill('afterSubmit', [])] }, [strict]),
            /required place "afterSubmit"/
        );
    });

    test('steps for a place the custom step does not have are refused', async () => {
        await assert.rejects(
            run({ type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}', slots: [fill('afterLogin', [mark('x')])] }),
            /has no place "afterLogin"/
        );
    });

    test('a call\'s places only hold slotSteps steps', async () => {
        await assert.rejects(
            run({ type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}', slots: [mark('x')] }),
            /only hold slotSteps steps/
        );
    });

    test('a slot step outside a custom step, or a slotSteps step on its own, is refused', async () => {
        await assert.rejects(run({ type: 'slot', slot: 'afterSubmit' }, []), /only runs inside a custom step/);
        await assert.rejects(run(fill('afterSubmit', [mark('x')]), []), /only runs as one of a custom step call's places/);
    });

    test('a slot step for a place the custom step does not declare is refused', async () => {
        const typo = { id: 'typo', actions: [{ type: 'slot', slot: 'nowhere' }] };
        await assert.rejects(run({ type: 'runCustomStep', customStepId: 'typo' }, [typo]), /has no place "nowhere"/);
    });

    test('a slot step in the call\'s steps is the caller\'s place, and the same custom step can be called from them', async () => {
        const wrapper = {
            id: 'wrapper',
            slots: [{ name: 'extra' }],
            actions: [
                mark('wrapper-start'),
                // Hands its own place on to log-in's afterSubmit, and calls
                // log-in again from there: not a cycle, the call's steps are the
                // caller's.
                {
                    type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"inner"}',
                    slots: [fill('afterSubmit', [{ type: 'slot', slot: 'extra' }])]
                },
                mark('wrapper-end')
            ]
        };
        const ctx = await run({
            type: 'runCustomStep', customStepId: 'wrapper',
            slots: [fill('extra', [{ type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"nested"}' }])]
        }, [LOG_IN, wrapper]);
        assert.deepEqual(ctx.trail, [
            'wrapper-start=x',
            'typed=inner', 'submitted=x',
            'typed=nested', 'submitted=x', 'done=x',
            'done=x',
            'wrapper-end=x'
        ]);
    });

    test('the call\'s steps are numbered under the slot step', async () => {
        const ctx = await run({
            type: 'runCustomStep', customStepId: 'log-in', argsJson: '{"user":"ana"}',
            slots: [fill('afterSubmit', [mark('a'), mark('b')])]
        });
        const started = ctx.runLogs.filter((l) => l.level === 'action-start' || /started$/.test(l.message || ''))
            .map((l) => l.actionPath || (l.extra && l.extra.actionPath)).filter(Boolean);
        assert.ok(started.includes('4.1'), started.join(' '));
        assert.ok(started.includes('4.2'), started.join(' '));
    });
});
