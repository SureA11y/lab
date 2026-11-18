'use strict';

// The time left for the queue's runs and the batch (queue-estimate.js): what
// finished runs of a workflow say about the others, and how a run's counts
// become a time.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');

const estimator = require('../shared/scan-time-estimate.js');

let Q;
before(async () => {
    Q = await import('./queue-estimate.js');
});

const MIN = 60000;
const done = (id, over = {}) => ({id, status: 'done', workflowKey: 'k', scans: 10, scansRun: 10, durationMs: 5 * MIN, ...over});
const running = (id, over = {}) => ({
    id, status: 'running', workflowKey: 'k', scans: 4, scansRun: 4, elapsedMs: 2.5 * MIN, sinceScanMs: 0, expectedScans: 10, ...over
});
const waiting = (id, over = {}) => ({id, status: 'waiting', workflowKey: 'k', expectedScans: null, ...over});

const est = (items, extra = {}) => Q.estimateQueue(items, {estimator, ...extra});

describe('priorsFrom', () => {
    test('is what the finished runs of one workflow took, by workflow', () => {
        const {byKey, pooled} = Q.priorsFrom([done('a'), done('b'), done('c', {workflowKey: 'other'})], estimator);
        assert.equal(byKey.get('k').runs, 2);
        assert.equal(byKey.get('k').perScanMs, 30000);
        assert.equal(byKey.has('other'), false, 'one run is not enough');
        assert.equal(pooled.runs, 3);
    });

    test('leaves out runs that failed, were cancelled or have no scans or time', () => {
        const items = [done('a'), done('b'), done('c', {status: 'error'}), done('d', {scans: 0, scansRun: 0}), done('e', {durationMs: 0}), done('f', {status: 'cancelled'})];
        assert.equal(Q.priorsFrom(items, estimator).byKey.get('k').runs, 2);
    });

    test('counts every scan a run ran, the contexts of a Merged scan included', () => {
        const items = [done('a', {scans: 5, scansRun: 10}), done('b', {scans: 5, scansRun: 10})];
        assert.equal(Q.priorsFrom(items, estimator).byKey.get('k').meanScans, 10);
    });

    test('has nothing without the shared estimator', () => {
        const {byKey, pooled} = Q.priorsFrom([done('a'), done('b')], null);
        assert.equal(byKey.size, 0);
        assert.equal(pooled, null);
    });
});

describe('estimateItem', () => {
    const prior = {perScanMs: 30000, meanScans: 10, meanDurationMs: 5 * MIN, runs: 2, spread: 0.1};

    test('a running run with a number: its pace, leaning on the others at first', () => {
        const e = Q.estimateItem(running('r'), prior, estimator);
        assert.equal(e.state, estimator.STATE.ESTIMATING);
        assert.equal(e.basis, estimator.BASIS.BLEND);
        assert.equal(e.from, 'set');
        // 4 scans in 2.5 min: 37.5 s each; with 4 of 7 weight on it, 34.3 s; 6 left.
        assert.equal(Math.round(e.remainingMs / 1000), 206);
    });

    test('with no finished runs the run\'s own pace counts alone', () => {
        const e = Q.estimateItem(running('r'), null, estimator);
        assert.equal(e.basis, estimator.BASIS.OWN);
        assert.equal(Math.round(e.remainingMs / 1000), 225);
    });

    test('a waiting run with a number is that many scans at the pace of the others', () => {
        const e = Q.estimateItem(waiting('w', {expectedScans: 20}), prior, estimator);
        assert.equal(e.remainingMs, 20 * 30000);
        assert.equal(e.from, 'set');
    });

    test('a run with no number is expected to do what the others did', () => {
        const e = Q.estimateItem(waiting('w'), prior, estimator);
        assert.equal(e.remainingMs, 10 * 30000);
        assert.equal(e.from, 'earlier');
        assert.equal(e.expectedScans, 10);
    });

    test('a run with neither a number nor finished runs has no time', () => {
        assert.equal(Q.estimateItem(waiting('w'), null, estimator), null);
        assert.equal(Q.estimateItem(running('r', {expectedScans: null}), null, estimator), null);
    });

    test('a run that is saving, cancelling or over has none', () => {
        assert.equal(Q.estimateItem(running('r', {phase: 'saving'}), prior, estimator), null);
        assert.equal(Q.estimateItem(running('r', {status: 'cancelling'}), prior, estimator), null);
        assert.equal(Q.estimateItem(done('d'), prior, estimator), null);
    });

    test('a run past its number says so', () => {
        const e = Q.estimateItem(running('r', {scansRun: 12, expectedScans: 10}), prior, estimator);
        assert.equal(e.state, estimator.STATE.PAST);
    });
});

describe('estimateQueue', () => {
    test('puts a time on each unfinished run, and on the batch', () => {
        const {byItem, batch} = est([done('a'), done('b'), running('r'), waiting('w')], {counts: {waiting: 1}});
        assert.equal(byItem.has('a'), false);
        assert.ok(byItem.get('r').remainingMs > 0);
        assert.equal(byItem.get('w').remainingMs, 10 * 30000);
        assert.equal(batch.state, estimator.STATE.ESTIMATING);
        // The run going now plus the one waiting, one at a time.
        assert.equal(Math.round(batch.remainingMs / 1000), Math.round((byItem.get('r').remainingMs + 300000) / 1000));
    });

    test('shares the work over the runs going at once', () => {
        const items = [done('a'), done('b'), running('r1'), running('r2'), waiting('w1'), waiting('w2')];
        const one = est(items.filter((i) => i.id !== 'r2' && i.id !== 'w2'), {counts: {waiting: 1}}).batch;
        const two = est(items, {counts: {waiting: 2}}).batch;
        assert.ok(two.remainingMs < 2 * one.remainingMs);
    });

    test('runs not loaded yet count as the average run', () => {
        const items = [done('a'), done('b'), running('r')];
        const all = est(items, {counts: {waiting: 0}}).batch;
        const more = est(items, {counts: {waiting: 3}}).batch;
        assert.equal(Math.round((more.remainingMs - all.remainingMs) / 1000), 3 * 300);
    });

    test('each workflow leans on its own finished runs', () => {
        const items = [
            done('a'), done('b'),
            done('c', {workflowKey: 'slow', scansRun: 10, durationMs: 20 * MIN}), done('d', {workflowKey: 'slow', scansRun: 10, durationMs: 20 * MIN}),
            waiting('w1'), waiting('w2', {workflowKey: 'slow'}),
        ];
        const {byItem} = est(items, {counts: {waiting: 2}});
        assert.equal(byItem.get('w1').remainingMs, 5 * MIN);
        assert.equal(byItem.get('w2').remainingMs, 20 * MIN);
    });

    test('a workflow with no finished runs uses all of them', () => {
        const items = [done('a'), done('b'), waiting('w', {workflowKey: 'new'})];
        assert.equal(est(items, {counts: {waiting: 1}}).byItem.get('w').remainingMs, 5 * MIN);
    });

    test('a batch that is not running has none', () => {
        const {byItem, batch} = est([done('a'), done('b'), waiting('w')], {running: false});
        assert.equal(batch, null);
        assert.equal(byItem.has('w'), true);
    });

    test('the batch is unknown while a run has nothing to go on', () => {
        const {batch} = est([running('r', {expectedScans: null})], {counts: {waiting: 0}});
        assert.equal(batch.state, 'unknown');
        assert.equal(Q.describeBatchLeft(batch, estimator), '');
    });

    test('nothing without the shared estimator or without runs', () => {
        assert.equal(Q.estimateQueue([done('a')], {estimator: null}).batch, null);
        assert.equal(est(null).byItem.size, 0);
    });
});

describe('describeLeft', () => {
    const prior = {perScanMs: 30000, meanScans: 10, meanDurationMs: 5 * MIN, runs: 2, spread: 0.1};
    const left = (item, p = prior) => Q.describeLeft(Q.estimateItem(item, p, estimator), estimator);

    test('is the time and nothing else, with where it comes from in the tooltip', () => {
        const blend = left(running('r'));
        assert.deepEqual(Object.keys(blend).sort(), ['text', 'title']);
        assert.equal(blend.text, '~3 min');
        assert.match(blend.title, /^Estimate: about 3 min left/);
        assert.match(blend.title, /10 scans expected\./);
        assert.match(blend.title, /with 2 finished runs/);

        const fromPrior = left(waiting('w'));
        assert.equal(fromPrior.text, '~5 min');
        assert.match(fromPrior.title, /as the finished runs of this workflow did/);
    });

    test('a run on its own pace says so in the tooltip too', () => {
        assert.match(left(running('r'), null).title, /From how long the scans of this run have taken\./);
    });

    test('says finishing and over, not a negative time', () => {
        assert.equal(left(running('r', {scansRun: 10})).text, 'finishing');
        const over = left(running('r', {scansRun: 12}));
        assert.equal(over.text, 'over');
        assert.match(over.title, /past the 10 expected, so there is no estimate/);
    });

    test('a run with no estimate has nothing to say', () => {
        assert.deepEqual(left(waiting('w'), null), {text: '', title: ''});
        assert.deepEqual(Q.describeLeft(null, estimator), {text: '', title: ''});
    });

    test('shortRemaining fits a column', () => {
        assert.equal(Q.shortRemaining(20000, estimator), '< 1 min');
        assert.equal(Q.shortRemaining(6 * MIN, estimator), '~6 min');
        assert.equal(Q.shortRemaining(85 * MIN, estimator), '~1h 25m');
        assert.equal(Q.shortRemaining(120 * MIN, estimator), '~2h');
    });
});

describe('describeBatchLeft', () => {
    test('is the time and its range', () => {
        const {batch} = est([done('a'), done('b'), running('r')], {counts: {waiting: 0}});
        assert.match(Q.describeBatchLeft(batch, estimator), /^(about \d+ min|under a minute) left, estimated/);
    });

    test('is empty with no estimate', () => {
        assert.equal(Q.describeBatchLeft(null, estimator), '');
        assert.equal(Q.describeBatchLeft({state: 'unknown'}, estimator), '');
    });
});

describe('a run in a loop', () => {
    const loop = { remainingMs: 4 * MIN, lowMs: 3 * MIN, highMs: 5 * MIN, path: '2', iteration: 14, total: 40, done: 13 };

    test('says the time left from its loop, with no number and no finished runs', () => {
        const e = Q.estimateItem(running('r', { expectedScans: null, loopLeft: loop }), null, estimator);
        assert.equal(e.state, estimator.STATE.ESTIMATING);
        assert.equal(e.basis, estimator.BASIS.LOOP);
        assert.equal(e.from, 'loop');
        assert.equal(e.remainingMs, 4 * MIN);
        assert.deepEqual(e.rangeMs, { low: 3 * MIN, high: 5 * MIN });
    });

    test('says it before a typed number does', () => {
        const e = Q.estimateItem(running('r', { expectedScans: 500, loopLeft: loop }), { perScanMs: 30000, meanScans: 10, meanDurationMs: 5 * MIN, runs: 2, spread: 0.1 }, estimator);
        assert.equal(e.from, 'loop');
    });

    test('the tooltip says it is the loop, and that the steps after it are not in it', () => {
        const left = Q.describeLeft(Q.estimateItem(running('r', { expectedScans: null, loopLeft: loop }), null, estimator), estimator);
        assert.equal(left.text, '~4 min');
        assert.match(left.title, /^Estimate: about 4 min left/);
        assert.match(left.title, /From the loop it is in: 13 of 40 items done/);
        assert.doesNotMatch(left.title, /scans expected/);
    });

    test('a run not in a loop, or one that is saving, does not use it', () => {
        assert.equal(Q.estimateItem(running('r', { expectedScans: null, loopLeft: null }), null, estimator), null);
        assert.equal(Q.estimateItem(running('r', { expectedScans: null, loopLeft: loop, phase: 'saving' }), null, estimator), null);
        assert.equal(Q.estimateItem(waiting('w', { loopLeft: loop }), null, estimator), null);
    });

    test('a loop that did not come whole is not used', () => {
        assert.equal(Q.estimateItem(running('r', { expectedScans: null, loopLeft: { remainingMs: 4 * MIN } }), null, estimator), null);
    });

    test('the batch counts it as the time that run has left', () => {
        const { byItem, batch } = Q.estimateQueue([running('r', { expectedScans: null, loopLeft: loop })], { counts: { waiting: 0 }, estimator });
        assert.equal(byItem.get('r').remainingMs, 4 * MIN);
        assert.equal(batch.remainingMs, 4 * MIN);
    });
});

describe('a number the workflow worked out', () => {
    const prior = { perScanMs: 30000, meanScans: 10, meanDurationMs: 5 * MIN, runs: 2, spread: 0.1 };

    test('has no margin for being off, as one that was typed has', () => {
        const typed = Q.estimateItem(running('r'), prior, estimator);
        const worked = Q.estimateItem(running('r', { expectedExact: true }), prior, estimator);
        assert.equal(typed.remainingMs, worked.remainingMs);
        assert.ok(worked.rangeMs.high < typed.rangeMs.high);
        assert.ok(worked.rangeMs.low > typed.rangeMs.low);
    });
});

describe('the batch and the slots of the queue', () => {
    const eight = Array.from({ length: 8 }, (_, i) => running('r' + i, { expectedScans: 10, scansRun: 5, elapsedMs: 5 * MIN, sinceScanMs: 0 }));

    test('nine runs in eight slots take the ninth after the first slot frees', () => {
        const finished = [done('a'), done('b')];
        const items = [...finished, ...eight, waiting('w')];
        const counts = { waiting: 1 };
        const some = Q.estimateQueue(items, { counts, slots: 8, estimator });
        const run = some.byItem.get('r0').remainingMs;
        // The first of the eight ends in run ms, then the ninth takes its mean time, 5 min.
        assert.equal(Math.round(some.batch.remainingMs), Math.round(run + 5 * MIN));
    });

    test('without the setting the slots are the runs going, so the work is shared as before', () => {
        const items = [done('a'), done('b'), running('r1'), running('r2'), waiting('w1'), waiting('w2')];
        const withSetting = Q.estimateQueue(items, { counts: { waiting: 2 }, slots: 2, estimator }).batch;
        const without = Q.estimateQueue(items, { counts: { waiting: 2 }, estimator }).batch;
        assert.equal(withSetting.remainingMs, without.remainingMs);
    });

    test('more slots than runs end with the longest', () => {
        const items = [done('a'), done('b'), running('r1'), waiting('w1')];
        const wide = Q.estimateQueue(items, { counts: { waiting: 1 }, slots: 6, estimator });
        assert.equal(wide.batch.remainingMs, Math.max(wide.byItem.get('r1').remainingMs, wide.byItem.get('w1').remainingMs));
    });

    test('with no finished runs, a waiting run is expected to take what the run going is projected to', () => {
        const items = [running('r1', { expectedScans: 10, scansRun: 5, elapsedMs: 5 * MIN, sinceScanMs: 0 }), waiting('w1', { expectedScans: null })];
        const { byItem, batch } = Q.estimateQueue(items, { counts: { waiting: 1 }, slots: 1, estimator });
        const projected = 5 * MIN + byItem.get('r1').remainingMs;
        assert.equal(Math.round(batch.remainingMs), Math.round(byItem.get('r1').remainingMs + projected));
    });
});
