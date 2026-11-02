'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createRunGate, maxRunsFrom, DEFAULT_MAX_RUNS } = require('./run-gate');

test('runs past the limit wait, and go in turn as others end', async () => {
    const gate = createRunGate(2);
    const order = [];
    const said = [];
    await gate.enter();
    await gate.enter();
    const third = gate.enter((active) => said.push(active)).then(() => order.push('third'));
    const fourth = gate.enter().then(() => order.push('fourth'));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, []);
    assert.deepEqual(said, [2]);
    assert.equal(gate.waiting, 2);
    gate.leave();
    await third;
    assert.deepEqual(order, ['third']);
    assert.equal(gate.active, 2);
    gate.leave();
    await fourth;
    gate.leave();
    gate.leave();
    assert.equal(gate.active, 0);
});

test('A11Y_MAX_RUNS is a whole number from 1, else the default', () => {
    assert.equal(maxRunsFrom('8'), 8);
    for (const bad of [undefined, '', '0', '-1', '2.5', 'many']) assert.equal(maxRunsFrom(bad), DEFAULT_MAX_RUNS);
});

test('a run cancelled while it waits leaves its place at once, and the next goes in turn', async () => {
    const gate = createRunGate(1);
    await gate.enter();
    const abort = new AbortController();
    const cancelled = gate.enter(null, abort.signal);
    const next = gate.enter();
    assert.equal(gate.waiting, 2);
    abort.abort();
    assert.equal(await cancelled, false);
    assert.equal(gate.waiting, 1);
    gate.leave();
    assert.equal(await next, true);
    assert.equal(gate.active, 1);
    // Aborted once it is in: nothing changes, it leaves as a run does.
    const late = new AbortController();
    const admitted = gate.enter(null, late.signal);
    gate.leave();
    assert.equal(await admitted, true);
    late.abort();
    assert.equal(gate.active, 1);
});

test('past the runs and the places to wait, the gate is full', async () => {
    const gate = createRunGate(1, 2);
    await gate.enter();
    assert.equal(gate.full, false);
    gate.enter();
    assert.equal(gate.full, false);
    gate.enter();
    assert.equal(gate.full, true);
});

test('A11Y_MAX_WAITING is a whole number from 0, else the default', () => {
    const { maxWaitingFrom, DEFAULT_MAX_WAITING } = require('./run-gate');
    assert.equal(maxWaitingFrom('0'), 0);
    assert.equal(maxWaitingFrom('120'), 120);
    for (const bad of [undefined, '', '-1', '2.5', 'many']) assert.equal(maxWaitingFrom(bad), DEFAULT_MAX_WAITING);
});
