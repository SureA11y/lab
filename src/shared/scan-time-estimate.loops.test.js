'use strict';

// The loop tracker (createLoopTracker in scan-time-estimate.js): the time left in
// the outermost running loop, from the engine's "item k of n" entries.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const E = require('./scan-time-estimate.js');

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();
const SEC = 1000;

const iteration = (path, index, total, seconds) => ({
    time: at(seconds), type: 'info', message: '',
    extra: { stepEvent: 'loop-iteration', actionPath: path, index, total, loopType: 'forEachElement' }
});
const ended = (path, seconds, stepEvent = 'action-end') => ({ time: at(seconds), extra: { stepEvent, actionPath: path } });

function track(entries) {
    const tracker = E.createLoopTracker();
    for (const entry of entries) tracker.accept(entry);
    return tracker;
}

// A loop of `total` iterations, one every `every` seconds, started at 0.
const steady = (path, total, every, upTo) =>
    Array.from({ length: upTo + 1 }, (_, i) => iteration(path, i, total, i * every));

describe('createLoopTracker', () => {
    test('says nothing before there is a loop', () => {
        assert.equal(E.createLoopTracker().estimate(T0), null);
    });

    test('the time left in a loop is its iterations left at the pace of the finished ones', () => {
        // Iteration 5 of 10 started at 40 s, after four of 10 s: 5 s into it.
        const e = track(steady('2', 10, 10, 4)).estimate(T0 + 45 * SEC);
        assert.equal(e.state, E.STATE.ESTIMATING);
        assert.equal(e.basis, E.BASIS.LOOP);
        // 5 s left of this one, five more of 10 s.
        assert.equal(e.remainingMs, 55 * SEC);
        assert.deepEqual(e.loop, { path: '2', iteration: 5, total: 10, done: 4 });
    });

    test('an iteration running late has nothing left of its average, not a negative time', () => {
        const e = track(steady('2', 10, 10, 4)).estimate(T0 + 70 * SEC);
        assert.equal(e.remainingMs, 50 * SEC);
    });

    test('waits for two finished iterations: one is mostly start-up', () => {
        assert.equal(track(steady('2', 10, 10, 0)).estimate(T0 + 5 * SEC), null);
        assert.equal(track(steady('2', 10, 10, 1)).estimate(T0 + 15 * SEC), null);
        assert.notEqual(track(steady('2', 10, 10, 2)).estimate(T0 + 25 * SEC), null);
    });

    test('a loop with no known size says nothing', () => {
        assert.equal(track(steady('2', null, 10, 5)).estimate(T0 + 55 * SEC), null);
    });

    test('a loop that grows says so as it goes', () => {
        const entries = steady('2', 10, 10, 3);
        entries.push(iteration('2', 4, 14, 40));
        const e = track(entries).estimate(T0 + 40 * SEC);
        assert.equal(e.loop.total, 14);
        // This iteration, 10 s, and nine more of 10 s.
        assert.equal(e.remainingMs, 100 * SEC);
    });

    test('the end of the loop takes it away, and what comes after is not in the estimate', () => {
        const entries = [...steady('2', 10, 10, 9), ended('2', 100)];
        assert.equal(track(entries).estimate(T0 + 101 * SEC), null);
        assert.equal(track([...steady('2', 10, 10, 9), ended('2', 100, 'action-failed')]).estimate(T0 + 101 * SEC), null);
    });

    test('the next loop starts with a clean slate', () => {
        const entries = [...steady('2', 10, 10, 9), ended('2', 100), ...steady('4', 6, 5, 3).map((e, i) => iteration('4', i, 6, 110 + i * 5))];
        const e = track(entries).estimate(T0 + 125 * SEC);
        assert.deepEqual(e.loop, { path: '4', iteration: 4, total: 6, done: 3 });
        // Iteration 4 has 5 s of its average, and two more of 5 s.
        assert.equal(e.remainingMs, 15 * SEC);
    });

    test('a loop inside another: the outer one decides once it has iterations behind it', () => {
        // The outer loop, 4 iterations of 30 s; the inner loop of each 3 items.
        const entries = [];
        for (let o = 0; o < 3; o += 1) {
            entries.push(iteration('1', o, 4, o * 30));
            for (let i = 0; i < 3; i += 1) entries.push(iteration('1.2', i, 3, o * 30 + 5 + i * 8));
            entries.push(ended('1.2', o * 30 + 29));
        }
        // Outer iteration 3 (index 2) started at 60 s, now 70 s into the run.
        const e = track(entries.filter((x) => Date.parse(x.time) <= T0 + 70 * SEC)).estimate(T0 + 70 * SEC);
        assert.equal(e.loop.path, '1');
        // The inner loop of this iteration is at item 2 (index 1) of 3, with its first two
        // iterations behind it: not enough to say, so the outer's own average: 30 s each.
        // Iteration 3 has 20 s left; one more, 30 s.
        assert.equal(e.remainingMs, 50 * SEC);
    });

    test('in the first outer iteration, the inner loop says how long it will be', () => {
        // Outer iteration 1 of 5 has run 44 s and its inner loop is at item 7 of 10 (4 s each, from 20 s).
        const entries = [iteration('1', 0, 5, 0)];
        for (let i = 0; i < 7; i += 1) entries.push(iteration('1.2', i, 10, 20 + i * 4));
        const e = track(entries).estimate(T0 + 44 * SEC);
        // The inner loop has 4 s left of this item and two more of 4 s: 16 s. So this outer
        // iteration is 44 + 16 = 60 s long, and four more like it follow.
        assert.equal(e.loop.path, '1');
        assert.equal(e.remainingMs, (16 + 4 * 60) * SEC);
    });

    test('a loop inside a loop starts again with each outer iteration', () => {
        const entries = [iteration('1', 0, 3, 0), iteration('1.2', 0, 5, 1), iteration('1.2', 4, 5, 9), ended('1.2', 10),
            iteration('1', 1, 3, 11), iteration('1.2', 0, 5, 12)];
        const tracker = track(entries);
        assert.deepEqual(tracker.loops().map((l) => [l.path, l.index]), [['1', 1], ['1.2', 0]]);
    });

    test('paths inside a custom step count as inside the loop that calls it', () => {
        const tracker = track([iteration('5', 0, 4, 0), iteration('5::customStep(scan).1.14', 0, 6, 3)]);
        assert.deepEqual(tracker.loops().map((l) => l.path), ['5', '5::customStep(scan).1.14']);
        assert.equal(track([iteration('5', 0, 4, 0), iteration('50', 0, 6, 3)]).loops().length, 1, '"50" is not inside "5"');
    });

    test('a loop that is not inside the outermost one does not count', () => {
        const tracker = track([iteration('1', 0, 4, 0), iteration('2', 0, 4, 1)]);
        assert.deepEqual(tracker.loops().map((l) => l.path), ['1']);
    });

    test('the range holds the estimate and widens with uneven iterations', () => {
        const even = track(steady('2', 40, 10, 10)).estimate(T0 + 100 * SEC);
        const uneven = E.createLoopTracker();
        let clock = 0;
        for (let i = 0; i <= 10; i += 1) { uneven.accept(iteration('2', i, 40, clock)); clock += i % 2 ? 4 : 16; }
        const u = uneven.estimate(T0 + clock * SEC);
        const width = (r) => (r.rangeMs.high - r.rangeMs.low) / r.remainingMs;
        assert.ok(even.rangeMs.low < even.remainingMs && even.remainingMs < even.rangeMs.high);
        assert.ok(width(u) > width(even) - 1e-9);
    });

    test('is not thrown by entries with nothing to use', () => {
        const tracker = E.createLoopTracker();
        for (const bad of [null, undefined, {}, { extra: null }, { extra: { stepEvent: 'loop-iteration' } },
            { time: 'soon', extra: { stepEvent: 'loop-iteration', actionPath: '1', index: 0, total: 3 } },
            { time: at(0), extra: { stepEvent: 'loop-iteration', actionPath: '1', index: -1, total: 3 } }]) {
            assert.doesNotThrow(() => tracker.accept(bad));
        }
        assert.equal(tracker.estimate(NaN), null);
        assert.equal(tracker.estimate(T0), null);
    });

    test('names where the estimate comes from', () => {
        const e = track(steady('2', 10, 10, 4)).estimate(T0 + 45 * SEC);
        assert.match(E.describeBasis(e), /^From the loop it is in: 4 of 10 items done/);
        assert.match(E.describeBasis(e), /steps after the loop are not in it/);
    });
});
