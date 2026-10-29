'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createQueueGovernor } = require('./queue-governor');

const sample = (heapPct) => ({ heapPct, heapUsedMb: heapPct * 40, heapLimitMb: 4000 });

describe('queue governor', () => {
    test('lets runs start until the heap reaches the hold mark', () => {
        const g = createQueueGovernor();
        assert.equal(g.allowsStart(3), true, 'no reading yet');
        assert.equal(g.observe(sample(59.9)), null);
        assert.equal(g.allowsStart(3), true);
        assert.equal(g.observe(sample(60)), 'hold');
        assert.equal(g.allowsStart(3), false);
    });

    test('a run always starts when none is running, held or not', () => {
        const g = createQueueGovernor();
        g.observe(sample(90));
        assert.equal(g.allowsStart(0), true);
        assert.equal(g.allowsStart(1), false);
    });

    test('ends the hold only below the resume mark, so it does not flap', () => {
        const g = createQueueGovernor();
        g.observe(sample(65));
        assert.equal(g.observe(sample(55)), null, 'between the marks: still held');
        assert.equal(g.allowsStart(2), false);
        assert.equal(g.view().hold.heapPct, 55, 'the hold shows the latest reading');
        assert.equal(g.observe(sample(49)), 'resume');
        assert.equal(g.allowsStart(2), true);
        assert.equal(g.observe(sample(55)), null, 'not held again until the hold mark');
    });

    test('shows the latest reading and the hold', () => {
        const g = createQueueGovernor({ now: () => Date.parse('2026-10-21T10:00:00Z') });
        assert.deepEqual(g.view(), { hold: null, resources: null });
        g.observe(sample(70));
        assert.deepEqual(g.view(), {
            hold: { reason: 'memory', heapPct: 70, holdAtPct: 60, resumeBelowPct: 50, since: '2026-10-21T10:00:00.000Z' },
            resources: { heapPct: 70, heapUsedMb: 2800, heapLimitMb: 4000, at: '2026-10-21T10:00:00.000Z' },
        });
        g.reset();
        assert.deepEqual(g.view(), { hold: null, resources: null });
    });

    test('a sample with no heap figure changes nothing', () => {
        const g = createQueueGovernor();
        g.observe(sample(80));
        assert.equal(g.observe({}), null);
        assert.equal(g.allowsStart(1), false);
        assert.equal(g.observe(null), null);
    });

    test('the marks can be set', () => {
        const g = createQueueGovernor({ holdAtPct: 30, resumeBelowPct: 20 });
        assert.equal(g.observe(sample(30)), 'hold');
        assert.equal(g.observe(sample(19)), 'resume');
    });
});
