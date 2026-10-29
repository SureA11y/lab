'use strict';

// A batch row's vars are the run's starting variables. These tests hold the
// engine to the promise the Batch section makes: a row variable is readable by
// any step, however deep it is nested, and an `if` on it compares as text.
//
// Kept apart from workflow-engine.test.js, which needs sharp. None of the
// steps used here touch the page; forEachElement needs a live one, so repeat
// stands in as the loop.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');

const fakePage = {
    async $() { return null; },
    async $$() { return []; },
    url() { return 'about:blank'; },
};

// if, group and loops isolate what is set inside them, so watch writes
// through ctx.vars, which every var-setting step uses.
function recordWrites(ctx) {
    const written = Object.create(null);
    const real = ctx.vars;
    ctx.vars = new Proxy(real, {
        set(target, k, v) { written[k] = v; target[k] = v; return true; },
    });
    ctx.written = written;
    return ctx;
}

function rowContext(vars, customSteps = {}) {
    return recordWrites(createWorkflowContext({ customSteps, vars }));
}

const run = (ctx, actions) => applyActions(fakePage, actions, null, 0, ctx, Object.create(null), 0, null);

const branchOn = (variable, equals, key) => ({
    type: 'if', var: variable, equals,
    actions: [{ type: 'setVar', key, value: 'then' }],
    elseActions: [{ type: 'setVar', key, value: 'else' }],
});

describe('batch row variables', () => {
    test('reach an if inside a custom step, inside a repeat, inside a group', async () => {
        const customSteps = {
            inner: {
                id: 'inner',
                actions: [
                    branchOn('variant', 'logged-in', 'variantSeen'),
                    { type: 'setVar', key: 'label', value: 'Build {var:build} on {var:variant}' },
                ],
            },
        };
        const ctx = rowContext({ variant: 'logged-in', build: 2310 }, customSteps);
        await run(ctx, [{
            type: 'group',
            actions: [{
                type: 'repeat',
                repetitions: 2,
                actions: [{ type: 'runCustomStep', customStepId: 'inner' }],
            }],
        }]);
        assert.equal(ctx.written.variantSeen, 'then');
        assert.equal(ctx.written.label, 'Build 2310 on logged-in');
    });

    test('reach both branches of nested ifs', async () => {
        const ctx = rowContext({ variant: 'guest', lang: 'es' });
        await run(ctx, [{
            type: 'if', var: 'variant', equals: 'guest',
            actions: [{ type: 'group', actions: [branchOn('lang', 'es', 'langSeen')] }],
        }]);
        assert.equal(ctx.written.langSeen, 'then');
    });

    test('a row with a different value takes the other branch: one workflow, steps chosen per row', async () => {
        const ctx = rowContext({ variant: 'guest' });
        await run(ctx, [branchOn('variant', 'logged-in', 'variantSeen')]);
        assert.equal(ctx.written.variantSeen, 'else');
    });
});

describe('if compares variables as text', () => {
    test('a number from a row equals the same digits typed into the step', async () => {
        const ctx = rowContext({ build: 2310 });
        await run(ctx, [branchOn('build', '2310', 'seen')]);
        assert.equal(ctx.written.seen, 'then');
    });

    test('a boolean equals its text, either way round', async () => {
        const ctx = rowContext({ beta: true, flag: 'false' });
        await run(ctx, [branchOn('beta', 'true', 'betaSeen'), branchOn('flag', false, 'flagSeen')]);
        assert.equal(ctx.written.betaSeen, 'then');
        assert.equal(ctx.written.flagSeen, 'then');
    });

    test('an unset variable equals nothing, not even the text "undefined"', async () => {
        const ctx = rowContext({});
        await run(ctx, [branchOn('missing', 'undefined', 'seen'), branchOn('missing', '', 'emptySeen')]);
        assert.equal(ctx.written.seen, 'else');
        assert.equal(ctx.written.emptySeen, 'else');
    });
});
