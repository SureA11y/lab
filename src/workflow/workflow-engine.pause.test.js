'use strict';

// The pause the engine makes after each step, so the page can settle. Steps
// that never act on the page themselves (branching, grouping, calling a custom
// step, setting variables) or only read it (Get text, Get count, Collect
// output) skip it when they succeed, and so does a wait step, which is a pause
// already; every other step keeps it. Under `node --test` the
// pause is off by default, so these tests turn it on and count the pauses
// instead of timing them.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');

const fakePage = {
    async $() { return null; },
    async $$() { return []; },
    async evaluate() { return null; },
    url: async () => 'https://example.com/a'
};

/** Runs `actions` with a 1ms pause and returns how many pauses were made. */
async function countPauses(actions, customSteps = {}) {
    const ctx = createWorkflowContext({ customSteps, postStepDelayMs: 1 });
    let pauses = 0;
    const race = ctx.race;
    ctx.race = (promise, label) => {
        if (label === 'post-action delay') pauses += 1;
        return race(promise, label);
    };
    await applyActions(fakePage, actions, null, 0, ctx, Object.create(null), 0, null);
    return pauses;
}

// A step that acts on the page; it only scrolls, so the fake page is enough
// for it.
const act = { type: 'scroll', to: 'top' };

describe('the pause after a step', () => {
    test('a step that acts on the page pauses after itself', async () => {
        assert.equal(await countPauses([act, act, act]), 3);
    });

    test('a wait step does not pause again after itself', async () => {
        assert.equal(await countPauses([{ type: 'wait', ms: 0 }, { type: 'wait', ms: 0 }]), 0);
    });

    test('steps that only read the page do not pause: there is nothing to settle', async () => {
        assert.equal(await countPauses([
            { type: 'getCount', selector: 'a', var: 'n' },
            { type: 'collectOutput', key: 'k', value: 'v' }
        ]), 0);
    });

    test('setVar and clearVar do not pause', async () => {
        assert.equal(await countPauses([
            { type: 'setVar', key: 'a', value: '1' },
            { type: 'clearVar', key: 'a' }
        ]), 0);
    });

    test('if, ifUrl, switch, group and runCustomStep do not pause; the steps inside them do', async () => {
        const pauses = await countPauses([
            { type: 'if', var: 'missing', equals: 'x', actions: [act], elseActions: [act] },
            { type: 'ifUrl', urlPart: 'path', comparison: 'equals', value: '/a', actions: [act] },
            { type: 'switch', urlPart: 'path', cases: [{ type: 'case', comparison: 'equals', value: '/a', actions: [act] }] },
            { type: 'group', actions: [act, { type: 'group', actions: [act] }] },
            { type: 'runCustomStep', customStepId: 'w' }
        ], { w: { id: 'w', actions: [act] } });
        assert.equal(pauses, 6); // the six steps, and nothing for their containers
    });

    test('a container that failed keeps its pause: a step inside may have stopped halfway', async () => {
        const pauses = await countPauses([
            { type: 'group', optional: true, actions: [act, { type: 'case' }] }
        ]);
        assert.equal(pauses, 2); // the step, then the failed group
    });

    test('loops keep their pause', async () => {
        const pauses = await countPauses([{ type: 'repeat', repetitions: 2, actions: [{ type: 'setVar', key: 'a', value: '1' }] }]);
        assert.ok(pauses >= 1, `repeat paused ${pauses} times`);
    });
});
