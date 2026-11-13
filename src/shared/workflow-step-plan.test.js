'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const P = require('./workflow-step-plan.js');
const plan = (actions, customSteps) => P.planWorkflowSteps(actions, { customSteps });

describe('planWorkflowSteps: plain actions', () => {
    test('every executed action is one step, containers included', () => {
        const out = plan([
            { type: 'navigate' },
            { type: 'group', actions: [{ type: 'click' }, { type: 'a11yScan' }] }
        ]);
        // navigate + group itself + click + a11yScan
        assert.equal(out.min, 4);
        assert.equal(out.max, 4);
        assert.equal(out.unsized, 0);
    });

    test('byType keys every action type separately', () => {
        const out = plan([{ type: 'a11yScan' }, { type: 'a11yScan' }, { type: 'click' }]);
        assert.deepEqual({ ...out.byType.a11yScan }, { min: 2, max: 2, unsized: 0 });
        assert.deepEqual({ ...out.byType.click }, { min: 1, max: 1, unsized: 0 });
    });

    test('disabled actions are excluded, matching the engine skipping them', () => {
        const out = plan([{ type: 'click' }, { type: 'a11yScan', disabled: true }]);
        assert.equal(out.max, 1);
        assert.equal(out.byType.a11yScan, undefined);
    });

    test('entries with no type, and non-objects, are ignored without throwing', () => {
        const out = plan([null, 'nope', {}, { type: 'click' }]);
        assert.equal(out.max, 1);
    });

    test('a non-array actions value yields an empty plan', () => {
        const out = plan(null);
        assert.deepEqual({ min: out.min, max: out.max, unsized: out.unsized }, { min: 0, max: 0, unsized: 0 });
        assert.deepEqual({ ...out.byType }, {});
        assert.deepEqual(out.unsizedLoops, []);
    });

    test('an action type colliding with an Object.prototype key does not corrupt byType', () => {
        const out = plan([{ type: 'constructor' }]);
        assert.deepEqual({ ...out.byType.constructor }, { min: 1, max: 1, unsized: 0 });
    });
});

describe('planWorkflowSteps: if', () => {
    test('min takes the cheaper branch, max the dearer one', () => {
        const out = plan([{
            type: 'if',
            actions: [{ type: 'a11yScan' }, { type: 'a11yScan' }],
            elseActions: [{ type: 'click' }]
        }]);
        assert.equal(out.min, 2); // the if + the click
        assert.equal(out.max, 3); // the if + two scans
    });

    test('a branchless if is just itself', () => {
        const out = plan([{ type: 'if' }]);
        assert.equal(out.min, 1);
        assert.equal(out.max, 1);
    });

    test('records both branch costs so a counter can reclaim the road not taken', () => {
        const out = plan([{ type: 'if', actions: [{ type: 'a11yScan' }], elseActions: [] }]);
        const node = out.nodes['1'];
        assert.deepEqual(
            { kind: node.kind, type: node.type, thenMax: node.thenMax, elseMax: node.elseMax },
            { kind: 'if', type: 'if', thenMax: 1, elseMax: 0 }
        );
        assert.deepEqual({ ...node.thenByType }, { a11yScan: 1 });
        assert.deepEqual({ ...node.elseByType }, {});
    });

    test('unsized loops in either branch are a max, not a sum: only one branch runs', () => {
        const out = plan([{
            type: 'if',
            actions: [{ type: 'forEachElement', actions: [{ type: 'a11yScan' }] }],
            elseActions: [{ type: 'crawlQueue', actions: [{ type: 'a11yScan' }] }]
        }]);
        assert.equal(out.unsized, 1);
        // ...but both are listed, since either could be the one that runs.
        assert.equal(out.unsizedLoops.length, 2);
    });
});

describe('planWorkflowSteps: switch', () => {
    const sw = {
        type: 'switch',
        urlPart: 'hash',
        cases: [
            { type: 'case', value: '/a', actions: [{ type: 'a11yScan' }, { type: 'a11yScan' }] },
            { type: 'case', value: '/b', actions: [{ type: 'click' }], disabled: true },
            { type: 'case', value: '/c', actions: [] }
        ],
        defaultActions: [{ type: 'click' }]
    };

    test('one branch runs: min is the cheapest branch, max the dearest; a case is not a step', () => {
        const out = plan([sw]);
        assert.equal(out.min, 1); // the switch + the empty case
        assert.equal(out.max, 3); // the switch + two scans
        assert.equal(out.byType.case, undefined);
    });

    test('records every enabled branch by case number, disabled cases keeping theirs', () => {
        const node = plan([sw]).nodes['1'];
        assert.equal(node.kind, 'switch');
        assert.deepEqual(Object.keys(node.branches), ['case:1', 'case:3', 'default']);
        assert.deepEqual(
            Object.fromEntries(Object.entries(node.branches).map(([k, v]) => [k, v.max])),
            { 'case:1': 2, 'case:3': 0, default: 1 }
        );
    });

    test('a case\'s nested steps are numbered under the case, the default\'s under the switch', () => {
        const out = plan([{
            type: 'switch',
            cases: [{ type: 'case', actions: [{ type: 'if', actions: [] }] }],
            defaultActions: [{ type: 'if', actions: [] }]
        }]);
        assert.ok(out.nodes['1.1.1'], 'the if in case 1');
        assert.ok(out.nodes['1.1'], 'the if in the default');
    });
});

describe('planWorkflowSteps: repeat', () => {
    test('a literal repetitions count multiplies the body exactly', () => {
        const out = plan([{ type: 'repeat', repetitions: 3, actions: [{ type: 'a11yScan' }] }]);
        assert.equal(out.min, 4); // the repeat + 3 scans
        assert.equal(out.max, 4);
        assert.equal(out.unsized, 0);
    });

    test('itemsText wins over times, matching the runtime precedence', () => {
        const out = plan([{ type: 'repeat', itemsText: 'a\nb', times: 9, actions: [{ type: 'click' }] }]);
        assert.equal(out.byType.click.max, 2);
    });

    test('a repeat with no count at all never iterates', () => {
        const out = plan([{ type: 'repeat', actions: [{ type: 'click' }] }]);
        assert.equal(out.max, 1);
        assert.equal(out.byType.click, undefined);
    });

    test('an itemsText carrying a var token is unsized: interpolation happens at runtime', () => {
        const out = plan([{ type: 'repeat', itemsText: '{var:rows}', actions: [{ type: 'click' }] }]);
        assert.equal(out.unsized, 1);
        assert.equal(out.unsizedLoops[0].reason, P.UNSIZED_REASONS.RUNTIME_REPETITIONS);
        assert.equal(out.unsizedLoops[0].perIteration.max, 1);
    });

    test('repetitions from a variable is unsized: the count is only known once the step runs', () => {
        const out = plan([{ type: 'repeat', repetitions: '{var:tabCount}', actions: [{ type: 'click' }] }]);
        assert.equal(out.unsized, 1);
        assert.equal(out.unsizedLoops[0].reason, P.UNSIZED_REASONS.RUNTIME_REPETITIONS);
    });

    test('repetitions given as number text is read as a number, like the engine does', () => {
        const out = plan([{ type: 'repeat', repetitions: '3', actions: [{ type: 'a11yScan' }] }]);
        assert.equal(out.min, 4);
        assert.equal(out.unsized, 0);
    });

    test('an empty body contributes nothing even with a count', () => {
        const out = plan([{ type: 'repeat', repetitions: 5, actions: [] }]);
        assert.equal(out.max, 1);
    });
});

describe('planWorkflowSteps: forEachElement', () => {
    test('limit caps max, and min stays 0 because a selector can match nothing', () => {
        const out = plan([{ type: 'forEachElement', limit: 4, actions: [{ type: 'a11yScan' }] }]);
        assert.equal(out.min, 1);  // just the loop action itself
        assert.equal(out.max, 5);  // the loop + 4 scans
        assert.equal(out.byType.a11yScan.min, 0);
        assert.equal(out.byType.a11yScan.max, 4);
    });

    test('iterSetupActions and preActions are per-iteration costs too', () => {
        const out = plan([{
            type: 'forEachElement', limit: 2,
            iterSetupActions: [{ type: 'wait' }],
            preActions: [{ type: 'screenshot' }],
            actions: [{ type: 'a11yScan' }]
        }]);
        assert.equal(out.max, 1 + 2 * 3);
    });

    test('no limit means unsized: nothing is added to max, one loop is flagged', () => {
        const out = plan([{ type: 'forEachElement', actions: [{ type: 'a11yScan' }] }]);
        assert.equal(out.max, 1);
        assert.equal(out.unsized, 1);
        assert.equal(out.unsizedLoops[0].reason, P.UNSIZED_REASONS.NO_LIMIT);
    });

    test('dynamic:true is still bounded when a limit is declared', () => {
        const out = plan([{ type: 'forEachElement', dynamic: true, limit: 3, actions: [{ type: 'click' }] }]);
        assert.equal(out.unsized, 0);
        assert.equal(out.max, 4);
    });
});

describe('planWorkflowSteps: crawlQueue', () => {
    test('maxPages bounds it the way limit bounds forEachElement', () => {
        const out = plan([{ type: 'crawlQueue', maxPages: 10, actions: [{ type: 'a11yScan' }] }]);
        assert.equal(out.min, 1);
        assert.equal(out.max, 11);
    });

    test('without maxPages the queue can grow without bound, so it is unsized', () => {
        const out = plan([{ type: 'crawlQueue', actions: [{ type: 'a11yScan' }] }]);
        assert.equal(out.unsized, 1);
        assert.equal(out.unsizedLoops[0].reason, P.UNSIZED_REASONS.NO_MAX_PAGES);
    });
});

describe('planWorkflowSteps: runCustomStep', () => {
    const steps = [{ id: 'scanIt', actions: [{ type: 'a11yScan' }, { type: 'screenshot' }] }];

    test('expands the referenced step body', () => {
        const out = plan([{ type: 'runCustomStep', customStepId: 'scanIt' }], steps);
        assert.equal(out.max, 3); // the call + two actions inside
        assert.equal(out.byType.a11yScan.max, 1);
    });

    test('accepts custom steps as an id-keyed object too', () => {
        const out = plan([{ type: 'runCustomStep', customStepId: 'scanIt' }], { scanIt: { actions: [{ type: 'a11yScan' }] } });
        assert.equal(out.max, 2);
    });

    test('an unresolvable id contributes only the call itself', () => {
        const out = plan([{ type: 'runCustomStep', customStepId: 'nope' }], steps);
        assert.equal(out.max, 1);
    });

    test('a self-referencing step is unsized rather than silently counted as nothing', () => {
        const recursive = [{ id: 'loop', actions: [{ type: 'click' }, { type: 'runCustomStep', customStepId: 'loop' }] }];
        const out = plan([{ type: 'runCustomStep', customStepId: 'loop' }], recursive);
        assert.equal(out.unsized, 1);
        assert.equal(out.unsizedLoops[0].reason, P.UNSIZED_REASONS.RECURSION);
    });
});

describe('planWorkflowSteps: paths match the engine actionPath numbering', () => {
    test('top level and group number by raw array index, so a disabled action keeps its slot', () => {
        const out = plan([
            { type: 'click', disabled: true },
            { type: 'if', actions: [{ type: 'a11yScan' }] }
        ]);
        assert.ok(out.nodes['2'], 'the if is at path 2, not 1');
    });

    test('repeat and forEachElement bodies renumber, because the engine filters them first', () => {
        const out = plan([{
            type: 'repeat', repetitions: 1,
            actions: [
                { type: 'click', disabled: true },
                { type: 'if', actions: [{ type: 'a11yScan' }] }
            ]
        }]);
        assert.ok(out.nodes['1.1'], 'the if shifts up to 1.1 inside a pre-filtered body');
    });

    test('a custom step body gets its own path namespace', () => {
        const out = plan(
            [{ type: 'runCustomStep', customStepId: 'x' }],
            [{ id: 'x', actions: [{ type: 'if', actions: [{ type: 'click' }] }] }]
        );
        assert.ok(out.nodes['1::customStep(x).1']);
    });
});

describe('planWorkflowSteps: a custom step\'s places', () => {
    const LOG_IN = { id: 'log-in', slots: ['after'], actions: [{ type: 'click' }, { type: 'slot', slot: 'after' }, { type: 'click' }] };
    const call = (slots) => ({ type: 'runCustomStep', customStepId: 'log-in', ...(slots ? { slots } : {}) });

    test('the call\'s steps count where its slot step is, the slot step too', () => {
        const out = plan([call([{ type: 'slotSteps', slot: 'after', actions: [{ type: 'a11yScan' }, { type: 'click' }] }])], [LOG_IN]);
        // call + click + slot + scan + click + click
        assert.equal(out.max, 6);
        assert.equal(out.byType.a11yScan.max, 1);
        assert.equal(out.byType.slot.max, 1);
        assert.equal(out.byType.slotSteps, undefined, 'the list itself is not a step');
    });

    test('a place given nothing, or a disabled list, counts only the slot step', () => {
        assert.equal(plan([call()], [LOG_IN]).max, 4);
        assert.equal(plan([call([{ type: 'slotSteps', slot: 'after', disabled: true, actions: [{ type: 'click' }] }])], [LOG_IN]).max, 4);
    });

    test('the call\'s steps are numbered under the slot step', () => {
        const out = plan([call([{ type: 'slotSteps', slot: 'after', actions: [{ type: 'if', actions: [] }] }])], [LOG_IN]);
        assert.ok(out.nodes['1::customStep(log-in).2.1']);
    });

    test('the call\'s steps are walked as the caller\'s: calling the same custom step from them is no recursion', () => {
        const out = plan([call([{ type: 'slotSteps', slot: 'after', actions: [call()] }])], [LOG_IN]);
        assert.equal(out.unsized, 0);
        // outer call (4 + the inner call's 4)
        assert.equal(out.max, 8);
    });
});

describe('planWorkflowSteps: nesting', () => {
    test('a bounded loop inside a bounded loop multiplies through', () => {
        const out = plan([{
            type: 'forEachElement', limit: 3,
            actions: [{ type: 'repeat', repetitions: 2, actions: [{ type: 'a11yScan' }] }]
        }]);
        // loop + 3 * (repeat + 2 scans)
        assert.equal(out.max, 1 + 3 * 3);
        assert.equal(out.byType.a11yScan.max, 6);
    });

    test('an unsized loop inside a bounded one is that many separate sizing events', () => {
        const out = plan([{
            type: 'repeat', repetitions: 3,
            actions: [{ type: 'forEachElement', actions: [{ type: 'a11yScan' }] }]
        }]);
        assert.equal(out.unsized, 3);
    });
});
