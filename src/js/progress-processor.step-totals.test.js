'use strict';

// The seam between the engine's log stream and the on-screen step counter.
// Everything either side of it is covered elsewhere - the counter's arithmetic
// in src/shared/workflow-step-counter.test.js, the panel's rendering in
// live-totals.dom.test.js - so what is checked here is the handover: which
// entries reach the counter, and that a slip in counting never costs the user
// the log line it was riding on.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

let createProgressProcessor;
let createStepCounter;

test('load the modules under test', async () => {
    ({createProgressProcessor} = await import('./progress-processor.js'));
    ({createStepCounter} = require('../shared/workflow-step-counter.js'));
});

function harness({counter, actions} = {}) {
    const logged = [];
    const pushed = [];

    const liveStepState = {
        counter: counter === undefined
            ? createStepCounter({actions: actions || [{type: 'navigate'}, {type: 'a11yScan'}]})
            : counter
    };

    const processor = createProgressProcessor({
        liveVarState: {vars: Object.create(null)},
        liveStepState,
        appendLog: (message, type) => logged.push({message, type}),
        setStepTotals: (snapshot) => pushed.push(snapshot),
        getUseLiveStream: () => false
    });

    return {processor, logged, pushed, liveStepState};
}

const stepEntry = (actionType, actionPath) => ({
    type: 'action-end',
    message: `Action ${actionPath} completed in 5ms`,
    extra: {stepEvent: 'action-end', actionType, actionPath}
});

describe('progress processor: step totals', () => {
    test('a step event advances the counter and pushes a fresh snapshot', () => {
        const {processor, pushed} = harness();

        processor.processOne(stepEntry('navigate', '1'));

        assert.equal(pushed.length, 1);
        assert.equal(pushed[0].done, 1);
        assert.equal(pushed[0].remaining, 1);
        assert.deepEqual(pushed[0].doneByType, {navigate: 1});
    });

    test('ordinary log lines are left alone, so the counter is touched once per action', () => {
        const {processor, pushed, logged} = harness();

        processor.processOne({type: 'info', message: 'a11yScan ready'});
        processor.processOne({type: 'info', message: 'crawlQueue: skipping page', extra: {depth: 1}});

        assert.equal(pushed.length, 0, 'no step marker, no counting');
        assert.equal(logged.length, 2, 'but both lines still reach the log panel');
    });

    test('the whole stream folds in order', () => {
        const {processor, pushed} = harness();

        processor.processMany([
            stepEntry('navigate', '1'),
            {type: 'info', message: 'noise'},
            stepEntry('a11yScan', '2')
        ]);

        assert.equal(pushed.length, 2);
        assert.equal(pushed[1].done, 2);
        assert.equal(pushed[1].remaining, 0);
    });

    test('a run with no counter just logs, and never calls out for totals', () => {
        const {processor, pushed, logged} = harness({counter: null});

        processor.processOne(stepEntry('navigate', '1'));

        assert.equal(pushed.length, 0);
        assert.equal(logged.length, 1);
    });

    test('a counter that throws costs the log line nothing', () => {
        const exploding = {
            accept() { throw new Error('boom'); },
            snapshot() { return null; }
        };
        const {processor, pushed, logged} = harness({counter: exploding});

        processor.processOne(stepEntry('navigate', '1'));

        assert.equal(pushed.length, 0);
        assert.equal(logged.length, 1, 'the user still sees what the engine said');
    });

    test('branch and loop markers reach the counter too, not just finished actions', () => {
        const {processor, pushed} = harness({
            actions: [{
                type: 'if',
                actions: [{type: 'a11yScan'}, {type: 'a11yScan'}, {type: 'a11yScan'}],
                elseActions: [{type: 'click'}]
            }]
        });

        processor.processOne({
            type: 'info',
            message: 'if branch: false',
            extra: {stepEvent: 'branch', actionPath: '1', taken: 'else'}
        });

        assert.equal(pushed.length, 1);
        assert.equal(pushed[0].remaining, 2, 'the two extra scans in the then branch were reclaimed');
    });
});
