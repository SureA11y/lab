'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createStepCounter } = require('./workflow-step-counter.js');

const actionEnd = (actionType, actionPath) =>
    ({ type: 'action-end', extra: { stepEvent: 'action-end', actionType, actionPath } });

const actionFailed = (actionType, actionPath) =>
    ({ type: 'error', extra: { stepEvent: 'action-failed', actionType, actionPath, optional: true } });

const branch = (actionPath, taken) =>
    ({ type: 'info', extra: { stepEvent: 'branch', actionPath, taken } });

const loopIteration = (actionPath, index, total) =>
    ({ type: 'info', extra: { stepEvent: 'loop-iteration', actionPath, index, total } });

describe('createStepCounter: done', () => {
    test('starts at zero done, with remaining at the plan ceiling', () => {
        const c = createStepCounter({ actions: [{ type: 'navigate' }, { type: 'a11yScan' }] });
        const s = c.snapshot();
        assert.equal(s.done, 0);
        assert.equal(s.remaining, 2);
        assert.equal(s.total, 2);
    });

    test('counts finished actions, overall and by type', () => {
        const c = createStepCounter({ actions: [{ type: 'navigate' }, { type: 'a11yScan' }, { type: 'a11yScan' }] });
        c.accept(actionEnd('navigate', '1'));
        c.accept(actionEnd('a11yScan', '2'));
        const s = c.accept(actionEnd('a11yScan', '3'));
        assert.equal(s.done, 3);
        assert.deepEqual(s.doneByType, { navigate: 1, a11yScan: 2 });
        assert.equal(s.remaining, 0);
    });

    test('a failed action still counts as done: it ran, it is not coming back', () => {
        const c = createStepCounter({ actions: [{ type: 'click' }, { type: 'a11yScan' }] });
        const s = c.accept(actionFailed('click', '1'));
        assert.equal(s.done, 1);
        assert.equal(s.remaining, 1);
    });

    test('log entries with no step marker are ignored', () => {
        const c = createStepCounter({ actions: [{ type: 'click' }] });
        c.accept({ type: 'info', message: 'something happened' });
        c.accept({ type: 'action-start', extra: { stepEvent: 'action-start', actionType: 'click', actionPath: '1' } });
        c.accept(null);
        assert.equal(c.snapshot().done, 0);
    });

    test('acceptAll folds a whole log array in order', () => {
        const c = createStepCounter({ actions: [{ type: 'click' }, { type: 'click' }] });
        const s = c.acceptAll([actionEnd('click', '1'), actionEnd('click', '2')]);
        assert.equal(s.done, 2);
    });

    test('remaining never goes negative, however many events arrive', () => {
        const c = createStepCounter({ actions: [{ type: 'click' }] });
        c.acceptAll([actionEnd('click', '1'), actionEnd('click', '1'), actionEnd('click', '1')]);
        assert.equal(c.snapshot().remaining, 0);
    });
});

describe('createStepCounter: if', () => {
    const actions = [{
        type: 'if',
        actions: [{ type: 'a11yScan' }, { type: 'a11yScan' }, { type: 'a11yScan' }],
        elseActions: [{ type: 'click' }]
    }];

    test('taking the cheap branch reclaims the dear one', () => {
        const c = createStepCounter({ actions });
        assert.equal(c.snapshot().remaining, 4); // if + 3 scans
        const s = c.accept(branch('1', 'else'));
        assert.equal(s.remaining, 2); // if + 1 click
        assert.equal(s.ratchetHits, 0);
    });

    test('taking the dear branch changes nothing: it was already the ceiling', () => {
        const c = createStepCounter({ actions });
        const s = c.accept(branch('1', 'then'));
        assert.equal(s.remaining, 4);
    });

    test('the reclaim shows up per type too', () => {
        const c = createStepCounter({ actions });
        const s = c.accept(branch('1', 'else'));
        assert.equal(s.remainingByType.a11yScan, 0);
        assert.equal(s.remainingByType.click, 1);
    });
});

describe('createStepCounter: bounded loops', () => {
    const actions = [{ type: 'forEachElement', limit: 10, actions: [{ type: 'a11yScan' }] }];

    test('resolving under the ceiling reclaims the slack', () => {
        const c = createStepCounter({ actions });
        assert.equal(c.snapshot().remaining, 11);
        const s = c.accept(loopIteration('1', 0, 3));
        assert.equal(s.remaining, 4); // the loop + 3 scans
        assert.equal(s.lastResolution, null, 'a reclaim is not a resolution the UI needs to announce');
    });

    test('resolving at the ceiling changes nothing', () => {
        const c = createStepCounter({ actions });
        const s = c.accept(loopIteration('1', 0, 10));
        assert.equal(s.remaining, 11);
    });

    test('only the first iteration carries the size; later ones are just work', () => {
        const c = createStepCounter({ actions });
        c.accept(loopIteration('1', 0, 2));
        const before = c.snapshot().remaining;
        c.accept(loopIteration('1', 1, 2));
        assert.equal(c.snapshot().remaining, before);
    });

    test('a loop reporting no size at all leaves the estimate alone', () => {
        const c = createStepCounter({ actions });
        const s = c.accept(loopIteration('1', 0, null));
        assert.equal(s.remaining, 11);
    });
});

describe('createStepCounter: unsized loops', () => {
    const actions = [
        { type: 'navigate' },
        { type: 'forEachElement', actions: [{ type: 'a11yScan' }, { type: 'screenshot' }] }
    ];

    test('an unsized loop is kept out of remaining and counted separately', () => {
        const c = createStepCounter({ actions });
        const s = c.snapshot();
        assert.equal(s.remaining, 2); // navigate + the loop action itself, nothing for its body
        assert.equal(s.unsized, 1);
    });

    test('resolving it moves work into remaining and out of unsized, and says so', () => {
        const c = createStepCounter({ actions });
        const s = c.accept(loopIteration('2', 0, 4));
        assert.equal(s.remaining, 2 + 4 * 2);
        assert.equal(s.unsized, 0);
        assert.deepEqual(s.lastResolution, { actionPath: '2', type: 'forEachElement', total: 4, added: 8 });
        assert.equal(s.ratchetHits, 0, 'a resolution is sanctioned, not a ratchet violation');
    });

    test('a loop that never reports a size stays unsized for the whole run', () => {
        const c = createStepCounter({ actions });
        c.accept(loopIteration('2', 0, null));
        c.accept(loopIteration('2', 1, null));
        const s = c.snapshot();
        assert.equal(s.unsized, 1);
        assert.equal(s.remaining, 2);
    });

    test('a loop inside a bounded loop is one sizing event per entry', () => {
        const c = createStepCounter({
            actions: [{
                type: 'repeat', repetitions: 3,
                actions: [{ type: 'forEachElement', actions: [{ type: 'a11yScan' }] }]
            }]
        });
        assert.equal(c.snapshot().unsized, 3);
        c.accept(loopIteration('1.1', 0, 2));
        assert.equal(c.snapshot().unsized, 2);
        c.accept(loopIteration('1.1', 0, 2));
        assert.equal(c.snapshot().unsized, 1);
    });
});

describe('createStepCounter: events it cannot place', () => {
    test('an unknown actionPath is recorded and left alone rather than guessed at', () => {
        const c = createStepCounter({ actions: [{ type: 'click' }] });
        const before = c.snapshot().remaining;
        const s = c.accept(loopIteration('9.9', 0, 100));
        assert.equal(s.remaining, before);
        assert.equal(s.unmatched.length, 1);
        assert.equal(s.unmatched[0].reason, 'no-plan-node');
    });

    test('a branch event for a path that is not an if is recorded, not applied', () => {
        const c = createStepCounter({ actions: [{ type: 'forEachElement', limit: 2, actions: [{ type: 'click' }] }] });
        const before = c.snapshot().remaining;
        const s = c.accept(branch('1', 'then'));
        assert.equal(s.remaining, before);
        assert.equal(s.unmatched.length, 1);
    });
});

describe('createStepCounter: remaining only ever falls', () => {
    // The contract the whole module exists for. Everything below drives a
    // counter with a stream of legal events and checks the number never rises.

    // A small deterministic generator: a seeded stream is reproducible, so a
    // failure here names an exact sequence rather than "sometimes".
    function lcg(seed) {
        let state = seed >>> 0;
        return (n) => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state % n;
        };
    }

    const SIZED_WORKFLOW = [
        { type: 'navigate' },
        { type: 'if', actions: [{ type: 'a11yScan' }, { type: 'screenshot' }], elseActions: [{ type: 'click' }] },
        { type: 'forEachElement', limit: 8, actions: [{ type: 'a11yScan' }] },
        { type: 'repeat', repetitions: 2, actions: [{ type: 'click' }, { type: 'a11yScan' }] },
        { type: 'crawlQueue', maxPages: 5, actions: [{ type: 'a11yScan' }] }
    ];

    test('a fully sized workflow never sees remaining rise, across many seeds', () => {
        for (let seed = 1; seed <= 200; seed += 1) {
            const rand = lcg(seed);
            const c = createStepCounter({ actions: SIZED_WORKFLOW });

            const events = [];
            for (let i = 0; i < 40; i += 1) {
                switch (rand(4)) {
                    case 0: events.push(branch('2', rand(2) ? 'then' : 'else')); break;
                    case 1: events.push(loopIteration('3', rand(3) === 0 ? 0 : 1, rand(9))); break;
                    case 2: events.push(loopIteration('5', rand(3) === 0 ? 0 : 1, rand(6))); break;
                    default: events.push(actionEnd(['a11yScan', 'click', 'screenshot'][rand(3)], '1'));
                }
            }

            let previous = c.snapshot().remaining;
            for (const event of events) {
                const s = c.accept(event);
                assert.ok(
                    s.remaining <= previous,
                    `seed ${seed}: remaining rose from ${previous} to ${s.remaining} on ${JSON.stringify(event.extra)}`
                );
                previous = s.remaining;
            }
            assert.equal(c.snapshot().ratchetHits, 0, `seed ${seed}: the estimate tried to rise`);
        }
    });

    test('with unsized loops, remaining rises only on a resolution, and unsized only ever falls', () => {
        const withUnsized = SIZED_WORKFLOW.concat([{ type: 'forEachElement', actions: [{ type: 'a11yScan' }] }]);

        for (let seed = 1; seed <= 200; seed += 1) {
            const rand = lcg(seed);
            const c = createStepCounter({ actions: withUnsized });

            let previous = c.snapshot().remaining;
            let previousUnsized = c.snapshot().unsized;

            for (let i = 0; i < 40; i += 1) {
                const event = rand(3) === 0
                    ? loopIteration('6', rand(3) === 0 ? 0 : 1, rand(5))
                    : actionEnd('a11yScan', '1');

                const s = c.accept(event);
                if (s.remaining > previous) {
                    assert.ok(s.lastResolution, `seed ${seed}: remaining rose with no resolution to explain it`);
                    assert.equal(s.lastResolution.actionPath, '6');
                }
                assert.ok(s.unsized <= previousUnsized, `seed ${seed}: unsized rose`);
                previous = s.remaining;
                previousUnsized = s.unsized;
            }
            assert.equal(c.snapshot().ratchetHits, 0, `seed ${seed}: the estimate tried to rise`);
        }
    });
});

describe('createStepCounter: where the run is', () => {
    const start = (actionType, actionPath, depth, label = null) =>
        ({ type: 'action-start', extra: { stepEvent: 'action-start', actionType, actionPath, depth, label } });
    const end = (actionType, actionPath, depth) =>
        ({ type: 'action-end', extra: { stepEvent: 'action-end', actionType, actionPath, depth } });
    const skipped = (actionType, actionPath, depth) =>
        ({ type: 'info', extra: { stepEvent: 'action-skipped', actionType, actionPath, depth } });
    const item = (actionPath, index, total) =>
        ({ type: 'info', extra: { stepEvent: 'loop-iteration', actionPath, index, total } });

    const actions = [
        { type: 'navigate' },
        { type: 'forEachElement', actions: [{ type: 'click' }, { type: 'a11yScan' }] },
        { type: 'a11yScan', disabled: true },
    ];

    test('the workflow\'s own steps are counted from the list, before anything runs', () => {
        const s = createStepCounter({ actions }).snapshot();
        assert.deepEqual(s.workflow, { total: 3, done: 0, at: null });
        assert.equal(s.current, null);
    });

    test('only top-level steps move the workflow count; nested ones still count as run', () => {
        const c = createStepCounter({ actions });
        c.accept(start('navigate', '1', 0));
        let s = c.accept(end('navigate', '1', 0));
        assert.deepEqual(s.workflow, { total: 3, done: 1, at: 1 });

        c.accept(start('forEachElement', '2', 0));
        c.accept(item('2', 0, 2));
        c.accept(start('click', '2.1', 1));
        s = c.accept(end('click', '2.1', 1));
        assert.deepEqual(s.workflow, { total: 3, done: 1, at: 2 });
        assert.equal(s.done, 2);
    });

    test('a skipped top-level step counts as finished', () => {
        const c = createStepCounter({ actions });
        const s = c.acceptAll([end('navigate', '1', 0), end('forEachElement', '2', 0), skipped('a11yScan', '3', 0)]);
        assert.equal(s.workflow.done, 3);
    });

    test('current is the step that started last, with its label and the item of its loop', () => {
        const c = createStepCounter({ actions });
        c.acceptAll([start('forEachElement', '2', 0), item('2', 0, 5), item('2', 1, 5)]);
        const s = c.accept(start('click', '2.1', 1, 'Next page'));
        assert.deepEqual(s.current, { actionPath: '2.1', type: 'click', label: 'Next page', loop: { index: 1, total: 5 } });
    });

    test('a loop with no known size gives its item with no total', () => {
        const c = createStepCounter({ actions });
        c.acceptAll([start('forEachElement', '2', 0), item('2', 3, null)]);
        const s = c.accept(start('a11yScan', '2.2', 1));
        assert.deepEqual(s.current.loop, { index: 3, total: null });
    });

    test('a step after a loop is not shown inside it', () => {
        const c = createStepCounter({ actions: [{ type: 'forEachElement', actions: [{ type: 'click' }] }, { type: 'a11yScan' }] });
        c.acceptAll([start('forEachElement', '1', 0), item('1', 4, 5), start('click', '1.1', 1), end('click', '1.1', 1), end('forEachElement', '1', 0)]);
        const s = c.accept(start('a11yScan', '2', 0));
        assert.equal(s.current.loop, null);
    });
});
