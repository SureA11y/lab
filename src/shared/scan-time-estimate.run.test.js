'use strict';

// The run estimator (createRunEstimator in scan-time-estimate.js): how many
// scans a run has left, counted from its loops and the plan as its log
// entries arrive, and the time they take at the run's own pace.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const E = require('./scan-time-estimate.js');
const { planWorkflowSteps } = require('./workflow-step-plan.js');

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const SEC = 1000;
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

const started = (path, seconds, actionType = 'group') => ({ time: at(seconds), extra: { stepEvent: 'action-start', actionPath: path, actionType } });
const ended = (path, seconds, actionType = 'group', stepEvent = 'action-end') => ({ time: at(seconds), extra: { stepEvent, actionPath: path, actionType } });
const scanned = (path, seconds) => ended(path, seconds, 'a11yScan');
const item = (path, index, total, seconds) => ({ time: at(seconds), extra: { stepEvent: 'loop-iteration', actionPath: path, index, total } });

const scan = () => ({ type: 'a11yScan' });
const click = () => ({ type: 'click', selector: 'a' });

function estimator(actions, options = {}) {
    return E.createRunEstimator({ plan: planWorkflowSteps(actions), ...options });
}

function feed(est, entries) {
    for (const entry of entries) est.accept(entry);
    return est;
}

// The workflow of the stress test, small: a repeat over categories of
// different sizes, each a scan and a loop over its books (a scan, and another
// only for some); after it, a loop of a fixed 3 and a last scan.
const categories = [
    { type: 'repeat', itemsText: 'a\nb\nc\nd\ne\nf', actions: [
        scan(),
        { type: 'forEachElement', targetSelector: 'h3 a', actions: [
            click(), scan(), { type: 'if', selectorExists: '.five', actions: [scan()] }
        ] }
    ] },
    { type: 'forEachElement', targetSelector: 'h3 a', limit: 3, actions: [click(), scan()] },
    scan()
];

// Category k: a scan, then `books[k]` books of one scan each (two for every
// third), each 10 s a scan. Returns the entries and the clock.
function categoriesLog(books, upTo = books.length) {
    const entries = [started('1', 0, 'repeat')];
    let t = 0;
    for (let k = 0; k < upTo; k += 1) {
        entries.push(item('1', k, books.length, t));
        t += 10; entries.push(scanned('1.1', t));
        entries.push(started('1.2', t, 'forEachElement'));
        for (let b = 0; b < books[k]; b += 1) {
            entries.push(item('1.2', b, books[k], t));
            t += 10; entries.push(scanned('1.2.2', t));
            if (b % 3 === 2) { t += 10; entries.push(scanned('1.2.3.1', t)); }
        }
        entries.push(ended('1.2', t, 'forEachElement'));
    }
    return { entries, t };
}

describe('createRunEstimator', () => {
    test('says nothing before a log entry arrives', () => {
        assert.equal(estimator([scan(), scan()]).estimate(T0), null);
    });

    test('a workflow that cannot vary its scans: its count, at the pace of its scans', () => {
        const est = feed(estimator([scan(), click(), scan(), scan(), scan()]), [
            started('1', 0, 'a11yScan'), scanned('1', 60), started('2', 60, 'click'), ended('2', 61, 'click'),
            started('3', 61, 'a11yScan'), scanned('3', 120)
        ]);
        const e = est.estimate(T0 + 120 * SEC);
        assert.equal(e.state, E.STATE.ESTIMATING);
        assert.equal(e.expectedScans, 4);
        assert.equal(e.count, E.COUNT.PLAN);
        assert.equal(e.approximate, false);
        assert.equal(Math.round(e.remainingMs / SEC), 120);
    });

    test('a loop whose iterations each run a fixed number of scans counts from its first item', () => {
        const actions = [{ type: 'forEachElement', targetSelector: 'a', actions: [click(), scan()] }];
        const est = feed(estimator(actions), [started('1', 0, 'forEachElement'), item('1', 0, 10, 0), scanned('1.2', 30), item('1', 1, 10, 30), scanned('1.2', 60)]);
        const e = est.estimate(T0 + 60 * SEC);
        assert.equal(e.count, E.COUNT.LOOPS);
        assert.equal(e.expectedScans, 10);
        assert.deepEqual(e.loop, { path: '1', iteration: 2, total: 10, done: 1 });
        assert.equal(e.approximate, true);
    });

    test('a loop of uneven iterations waits for two of them, then counts from what they took', () => {
        const books = [10, 1, 6, 8, 3, 9];
        const first = categoriesLog(books, 1);
        const one = feed(estimator(categories), first.entries);
        assert.equal(one.estimate(T0 + first.t * SEC), null, 'the first category says nothing of the others');

        const { entries, t } = categoriesLog(books, 3);
        entries.push(item('1', 3, 6, t));
        const e = feed(estimator(categories), entries).estimate(T0 + t * SEC);
        // Done: 3 categories of 1 + 10+3, 1+1, 1+6+2 scans = 25; 25/3 a category
        // for the one starting and the 2 to come, then the 3 + 1 after the loop.
        assert.equal(e.count, E.COUNT.LOOPS);
        assert.equal(e.scansDone, 25);
        assert.equal(e.expectedScans, Math.round(25 + 3 * (25 / 3) + 4));
    });

    test('inside an iteration, its inner loop says how many scans it has left', () => {
        const books = [10, 1, 6, 8, 3, 9];
        const { entries, t } = categoriesLog(books, 3);
        // Category 4: its scan, then 2 of its 8 books (one scan each).
        entries.push(item('1', 3, 6, t), scanned('1.1', t + 10), started('1.2', t + 10, 'forEachElement'),
            item('1.2', 0, 8, t + 10), scanned('1.2.2', t + 20), item('1.2', 1, 8, t + 20), scanned('1.2.2', t + 30), item('1.2', 2, 8, t + 30));
        const e = feed(estimator(categories), entries).estimate(T0 + (t + 30) * SEC);
        // Book 3 of 8: the inner loop's own books so far ran a scan each, so this
        // one and the 5 after it are 6 more; then 2 categories of 25/3, and 4.
        assert.equal(e.scansDone, 28);
        assert.equal(e.expectedScans, Math.round(28 + 6 + 2 * (25 / 3) + 4));
    });

    test('after the loop, the steps the plan has left', () => {
        const books = [2, 2, 2, 2, 2, 2];
        const { entries, t } = categoriesLog(books);
        entries.push(ended('1', t, 'repeat'), started('2', t, 'forEachElement'), item('2', 0, 3, t), scanned('2.2', t + 10));
        const e = feed(estimator(categories), entries).estimate(T0 + (t + 10) * SEC);
        // 6 categories of 3 scans; then 1 of the 3 books, 2 left, and the last scan.
        assert.equal(e.scansDone, 19);
        assert.equal(e.expectedScans, 22);
    });

    test('a number given is used until the loops can count, and kept while they agree', () => {
        const books = [10, 1, 6, 8, 3, 9];
        const early = categoriesLog(books, 1);
        const typed = feed(estimator(categories, { expectedScans: 52 }), early.entries).estimate(T0 + early.t * SEC);
        assert.equal(typed.count, E.COUNT.TYPED);
        assert.equal(typed.expectedScans, 52);

        const { entries, t } = categoriesLog(books, 3);
        entries.push(item('1', 3, 6, t));
        const near = feed(estimator(categories, { expectedScans: 56 }), entries).estimate(T0 + t * SEC);
        assert.equal(near.count, E.COUNT.TYPED, 'within 5% of the count of 54');
        assert.equal(near.expectedScans, 56);
        assert.equal(near.loopScans, 54);

        const far = feed(estimator(categories, { expectedScans: 90 }), entries).estimate(T0 + t * SEC);
        assert.equal(far.count, E.COUNT.LOOPS, 'the count wins over a number far from it');
        assert.equal(far.expectedScans, 54);
    });

    test('a number passed is no longer one: the count goes on', () => {
        const books = [10, 1, 6, 8, 3, 9];
        const { entries, t } = categoriesLog(books, 3);
        entries.push(item('1', 3, 6, t));
        const e = feed(estimator(categories, { expectedScans: 20 }), entries).estimate(T0 + t * SEC);
        assert.equal(e.state, E.STATE.ESTIMATING);
        assert.equal(e.count, E.COUNT.LOOPS);
    });

    test('a number reached while the count has scans to go gives way to the count', () => {
        const books = [2, 2, 2, 2, 2, 2];
        const { entries, t } = categoriesLog(books);
        entries.push(ended('1', t, 'repeat'), started('2', t, 'forEachElement'), item('2', 0, 3, t), scanned('2.2', t + 10));
        // 19 done, the count says 22; a number of 19 (within 5% of nothing
        // useful) is reached, so the count goes on.
        const e = feed(estimator(categories, { expectedScans: 19 }), entries).estimate(T0 + (t + 10) * SEC);
        assert.equal(e.state, E.STATE.ESTIMATING);
        assert.equal(e.expectedScans, 22);
        const near = feed(estimator(categories, { expectedScans: 21 }), entries).estimate(T0 + (t + 10) * SEC);
        assert.equal(near.count, E.COUNT.TYPED, 'not reached, and within 5%');
    });

    test('the last run\'s count stands in for a typed number, with less margin', () => {
        const books = [10, 1, 6, 8, 3, 9];
        const { entries, t } = categoriesLog(books, 1);
        const last = feed(estimator(categories, { lastRunScans: 58 }), entries).estimate(T0 + t * SEC);
        const typed = feed(estimator(categories, { expectedScans: 58 }), entries).estimate(T0 + t * SEC);
        assert.equal(last.count, E.COUNT.LAST_RUN);
        assert.ok(last.rangeMs.high - last.rangeMs.low < typed.rangeMs.high - typed.rangeMs.low);
    });

    test('a typed number stands over the workflow\'s own count until the run passes it', () => {
        // The person may know a step hardly ever runs.
        const actions = [scan(), scan(), scan(), scan()];
        const est = feed(estimator(actions, { expectedScans: 3 }), [started('1', 0, 'a11yScan'), scanned('1', 60), scanned('2', 120)]);
        assert.equal(est.estimate(T0 + 120 * SEC).count, E.COUNT.TYPED);
        feed(est, [scanned('3', 180), scanned('4', 240)]);
        assert.equal(est.estimate(T0 + 240 * SEC).expectedScans, 4);
    });

    test('the loops of unknown size ahead leave no count, and a number fills in', () => {
        const actions = [scan(), { type: 'forEachElement', targetSelector: 'a', actions: [scan()] }];
        const est = feed(estimator(actions), [started('1', 0, 'a11yScan'), scanned('1', 30)]);
        assert.equal(est.estimate(T0 + 30 * SEC), null);
        const given = feed(estimator(actions, { expectedScans: 10 }), [started('1', 0, 'a11yScan'), scanned('1', 30), scanned('1', 60)]);
        assert.equal(given.estimate(T0 + 60 * SEC).count, E.COUNT.TYPED);
    });

    test('loops inside a custom step count as inside the step that calls it', () => {
        const est = E.createRunEstimator({ plan: { steps: [{ path: '1', byType: {} }], nodes: {} } });
        feed(est, [item('1', 0, 4, 0), item('1::customStep(scan).1', 0, 6, 3)]);
        assert.deepEqual(est.loops().map((l) => l.path), ['1', '1::customStep(scan).1']);
        const other = feed(E.createRunEstimator({ plan: { steps: [], nodes: {} } }), [item('5', 0, 4, 0), item('50', 0, 6, 3)]);
        assert.equal(other.loops().length, 1, '"50" is not inside "5"');
    });

    test('a new iteration ends the loops inside the last one', () => {
        const est = feed(E.createRunEstimator({ plan: { steps: [], nodes: {} } }), [item('1', 0, 3, 0), item('1.2', 0, 5, 1), item('1.2', 4, 5, 9), item('1', 1, 3, 11)]);
        assert.deepEqual(est.loops().map((l) => [l.path, l.index]), [['1', 1]]);
    });

    test('is not thrown by entries with nothing to use', () => {
        const est = estimator([scan()]);
        for (const bad of [null, undefined, {}, { extra: null }, { extra: { stepEvent: 'loop-iteration' } },
            { time: 'soon', extra: { stepEvent: 'loop-iteration', actionPath: '1', index: 0, total: 3 } },
            { time: at(0), extra: { stepEvent: 'loop-iteration', actionPath: '1', index: -1, total: 3 } }]) {
            assert.doesNotThrow(() => est.accept(bad));
        }
        assert.doesNotThrow(() => est.estimate(NaN));
        assert.doesNotThrow(() => E.createRunEstimator().estimate(T0));
    });
});
