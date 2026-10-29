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
