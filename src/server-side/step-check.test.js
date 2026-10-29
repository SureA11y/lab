'use strict';

// Every run checks its steps before a browser opens (step-check.js), from the
// app, the queue or the command line alike.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { checkWorkflowSteps } = require('./step-check');
const { executeWorkflowRun } = require('./workflow-run');

describe('checkWorkflowSteps', () => {
    test('passes a workflow that can run', () => {
        assert.deepEqual(checkWorkflowSteps({ actions: [{ type: 'a11yScan', label: 'Home' }] }), { errors: [], warnings: [] });
    });

    test('reports steps, custom steps and scans in one pass', () => {
        const { errors, warnings } = checkWorkflowSteps({
            actions: [
                { type: 'save' },
                { type: 'a11yScan', label: 'Old', profile: 'AA' },
                { type: 'runCustomStep', customStepId: 'login' },
                { type: 'screenshot', label: 'Home', size: 'big' },
            ],
            customSteps: JSON.stringify([{ id: 'login', actions: [{ type: 'navigate' }] }]),
        });
        assert.equal(errors.length, 3);
        assert.match(errors[0], /\$\.actions\[0\]\.type "save" is not a step type/);
        assert.match(errors[1], /\$\.customSteps\[0\]\.actions\[0\] needs "url"/);
        assert.match(errors[2], /^Scan "Old": "AA" is not a profile/);
        assert.deepEqual(warnings, ['$.actions[3].size "size" is not a known field']);
    });
});

describe('checkWorkflowSteps in the builder\'s words', () => {
    const inSteps = (args) => checkWorkflowSteps({ ...args, wording: 'steps' });

    test('names a step by its number and title, and a field by its label', () => {
        const { errors } = inSteps({ actions: [{ type: 'a11yScan' }, { type: 'click', selector: '#a', programmatic: 'true' }] });
        assert.deepEqual(errors, ['Step 2 - Click, Programmatic click: must be true or false, not "true"']);
    });

    test('numbers a nested step as the builder does, and says which list holds it', () => {
        const { errors } = inSteps({ actions: [
            { type: 'a11yScan' },
            { type: 'a11yScan' },
            { type: 'if', selectorExists: '#x', actions: [], elseActions: [{ type: 'navigate' }] },
        ] });
        assert.deepEqual(errors, ['Step 3.1 - Navigate to URL (Else actions): needs URL']);
    });

    test('uses the step\'s own title when it has one', () => {
        const { warnings } = inSteps({ actions: [{ type: 'group', alias: 'Log in', actions: [], size: 1 }] });
        assert.deepEqual(warnings, ['Step 1 - Log in, size: "size" is not a known field']);
    });

    test('names a custom step by its place and id', () => {
        const { errors } = inSteps({
            actions: [{ type: 'runCustomStep', customStepId: 'login' }],
            customSteps: [{ id: 'login', actions: [{ type: 'navigate' }] }, { id: 'login', actions: [] }],
        });
        assert.deepEqual(errors, [
            'Custom step 1 "login", step 1 - Navigate to URL: needs URL',
            'Custom step 2 "login", id: "login" is used by an earlier custom step',
        ]);
    });

    test('a step type it does not have is named by its number alone', () => {
        assert.match(inSteps({ actions: [{ type: 'save' }] }).errors[0], /^Step 1: "save" is not a step type/);
    });

    test('a step\'s own title, folded state and switch are known fields', () => {
        assert.deepEqual(inSteps({ actions: [{ type: 'a11yScan', alias: 'Home', collapsed: true, disabled: false }] }), { errors: [], warnings: [] });
    });
});

describe('executeWorkflowRun', () => {
    test('a workflow that cannot run stops before a browser opens, every problem in the log', async () => {
        const log = [];
        const result = await executeWorkflowRun(
            { url: 'https://example.com/', actions: [{ type: 'save' }, { type: 'navigate' }] },
            { progress: (entry) => log.push(entry) }
        );
        assert.equal(result.status, 'error');
        assert.equal(result.payload, null);
        assert.equal(result.error.details, 'The workflow cannot run: 2 problems, each in the log above.');
        assert.deepEqual(log.map((e) => e.type), ['error', 'error']);
        assert.match(log[0].message, /^Check: Step 1: "save" is not a step type/);
        assert.equal(log[1].message, 'Check: Step 2 - Navigate to URL: needs URL');
    });

    test('one problem is said in the result itself, and only there', async () => {
        const log = [];
        const result = await executeWorkflowRun({ url: 'https://example.com/', actions: [{ type: 'save' }] }, { progress: (e) => log.push(e) });
        assert.match(result.error.details, /^The workflow cannot run: Step 1: "save" is not a step type/);
        assert.deepEqual(log, []);
    });
});

describe('number fields\' bounds', () => {
    test('a Wait over an hour, or below zero, is refused before the run', () => {
        const { errors } = checkWorkflowSteps({ actions: [{ type: 'wait', ms: 1e12 }, { type: 'wait', ms: -5 }, { type: 'wait', ms: 3600000 }], wording: 'steps' });
        assert.equal(errors.length, 2);
        assert.match(errors[0], /^Step 1 - Wait, Milliseconds:/);
        assert.match(errors[1], /^Step 2 - Wait, Milliseconds:/);
    });
});

describe('how deep steps nest', () => {
    const nested = (depth, inner = { type: 'wait', ms: 0 }) => Array.from({ length: depth - 1 }).reduce((step) => ({ type: 'group', actions: [step] }), inner);

    test('a workflow nested deeper than the limit is refused, before the steps\' own check', () => {
        const { MAX_STEP_DEPTH } = require('./step-check');
        assert.deepEqual(checkWorkflowSteps({ actions: [nested(MAX_STEP_DEPTH)] }), { errors: [], warnings: [] });
        const { errors } = checkWorkflowSteps({ actions: [nested(300)] });
        assert.deepEqual(errors, [`The workflow has steps nested more than ${MAX_STEP_DEPTH} levels deep, inside groups, ifs or repeats: at most ${MAX_STEP_DEPTH}`]);
    });

    test('an if\'s else actions and a custom step\'s steps count too', () => {
        const { MAX_STEP_DEPTH } = require('./step-check');
        const deepElse = { type: 'if', selectorExists: '#a', actions: [], elseActions: [nested(MAX_STEP_DEPTH)] };
        assert.equal(checkWorkflowSteps({ actions: [deepElse] }).errors.length, 1);
        const { errors } = checkWorkflowSteps({ actions: [{ type: 'wait', ms: 0 }], customSteps: [{ id: 'deep', actions: [nested(MAX_STEP_DEPTH + 1)] }] });
        assert.match(errors[0], /^Custom step 1 has steps nested more than/);
    });

    test('a run nested too deep stops with that one reason, not a stack overflow per level', async () => {
        const result = await executeWorkflowRun({ url: 'https://example.com/', actions: [nested(300)] });
        assert.equal(result.status, 'error');
        assert.match(result.error.details, /nested more than \d+ levels deep/);
    });
});
