'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { pushLog, interpolateLogMessage } = require('./log');

describe('interpolateLogMessage', () => {
    test('resolves {var:...} tokens via ctx.vars/ctx.getVar and {index}/{oneBased}/{total} via ctx._iterVars', () => {
        const ctx = { vars: { city: 'Lisbon' }, _iterVars: { index: 2, total: 5 } };
        const msg = interpolateLogMessage('at {var:city}, item {oneBased}/{total} (index {index})', ctx);
        assert.equal(msg, 'at Lisbon, item 3/5 (index 2)');
    });

    test('{index}/{oneBased}/{total} become empty strings when _iterVars is absent', () => {
        const msg = interpolateLogMessage('item {oneBased}/{total}', {});
        assert.equal(msg, 'item /');
    });

    test('a non-string/nullish message is coerced via String()', () => {
        assert.equal(interpolateLogMessage(null, {}), '');
        assert.equal(interpolateLogMessage(undefined, {}), '');
        assert.equal(interpolateLogMessage(42, {}), '42');
    });
});

describe('pushLog', () => {
    function makeCtx(overrides = {}) {
        return { runLogs: [], vars: {}, getVarsFlat: () => ({}), ...overrides };
    }

    test('pushes a well-formed entry onto ctx.runLogs, including the variables at top level', () => {
        const ctx = makeCtx({ getVarsFlat: () => ({ x: 1 }) });
        pushLog(ctx, 'info', 'hello');
        assert.equal(ctx.runLogs.length, 1);
        const entry = ctx.runLogs[0];
        assert.equal(entry.type, 'info');
        assert.equal(entry.message, 'hello');
        assert.equal(entry.depth, 0);
        assert.deepEqual(entry.vars, { x: 1 });
        assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T/);
    });

    test('explicit extra.depth wins over the inherited _logCtx.depth', () => {
        const ctx = makeCtx({ _logCtx: { depth: 3, actionPath: '1.2' } });
        pushLog(ctx, 'info', 'msg', { depth: 9 });
        assert.equal(ctx.runLogs[0].depth, 9);
    });

    test('with no explicit extra.depth, depth is inherited from ctx._logCtx.depth', () => {
        const ctx = makeCtx({ _logCtx: { depth: 3, actionPath: '1.2' } });
        pushLog(ctx, 'info', 'msg');
        assert.equal(ctx.runLogs[0].depth, 3);
    });

    test('inherited actionPath (from ctx._logCtx) is stashed onto extra.actionPath when extra omits it', () => {
        const ctx = makeCtx({ _logCtx: { depth: 0, actionPath: '2.1' } });
        pushLog(ctx, 'info', 'msg', { depth: 0 });
        assert.equal(ctx.runLogs[0].extra.actionPath, '2.1');
    });

    test('an explicit extra.actionPath is never overwritten by the inherited one', () => {
        const ctx = makeCtx({ _logCtx: { depth: 0, actionPath: 'inherited' } });
        pushLog(ctx, 'info', 'msg', { depth: 0, actionPath: 'explicit' });
        assert.equal(ctx.runLogs[0].extra.actionPath, 'explicit');
    });

    test('extra defaults to null on the entry when omitted', () => {
        const ctx = makeCtx();
        pushLog(ctx, 'info', 'msg');
        assert.equal(ctx.runLogs[0].extra, null);
    });

    test('when ctx.getVarsFlat is not a function, falls back to a shallow copy of ctx.vars', () => {
        const ctx = { runLogs: [], vars: { y: 2 } };
        pushLog(ctx, 'info', 'msg');
        assert.deepEqual(ctx.runLogs[0].vars, { y: 2 });
        assert.notEqual(ctx.runLogs[0].vars, ctx.vars); // shallow copy, not the same reference
    });

    test('does not throw when ctx.runLogs is missing or not an array', () => {
        assert.doesNotThrow(() => pushLog({ vars: {} }, 'info', 'msg'));
        assert.doesNotThrow(() => pushLog({ runLogs: 'not-an-array', vars: {} }, 'info', 'msg'));
    });

    test('calls ctx.progress(entry) when present, forwarding the same entry that was pushed', () => {
        const ctx = makeCtx();
        let received = null;
        ctx.progress = (entry) => { received = entry; };
        pushLog(ctx, 'info', 'hi');
        assert.equal(received, ctx.runLogs[0]);
    });

    test('a throwing ctx.progress is swallowed, not propagated to the caller', () => {
        const ctx = makeCtx();
        ctx.progress = () => { throw new Error('progress handler blew up'); };
        assert.doesNotThrow(() => pushLog(ctx, 'info', 'hi'));
        // The log entry itself is still recorded even though the progress callback failed.
        assert.equal(ctx.runLogs.length, 1);
    });

    test('the message itself is interpolated (ctx.vars + iteration tokens) before being stored', () => {
        const ctx = makeCtx({ vars: { name: 'Ana' }, _iterVars: { index: 0, total: 1 } });
        pushLog(ctx, 'info', 'hello {var:name}, {oneBased}/{total}');
        assert.equal(ctx.runLogs[0].message, 'hello Ana, 1/1');
    });
});

describe('the variables a log entry carries', () => {
    const { varsForLog, LOG_VALUE_MAX } = require('./log');

    test('only those that changed since the last entry went the same way', () => {
        const vars = { a: '1', b: '2' };
        const ctx = { runLogs: [], getVarsFlat: () => ({ ...vars }) };
        pushLog(ctx, 'info', 'one');
        pushLog(ctx, 'info', 'two');
        vars.b = '3';
        vars.c = ['x'];
        pushLog(ctx, 'info', 'three');
        assert.deepEqual(ctx.runLogs.map((e) => e.vars), [{ a: '1', b: '2' }, undefined, { b: '3', c: ['x'] }]);
    });

    test('a long value is cut to LOG_VALUE_MAX characters in the log, not in the run', () => {
        const big = 'x'.repeat(150 * 1024 * 1024);
        const ctx = { runLogs: [], getVarsFlat: () => ({ big }) };
        pushLog(ctx, 'info', 'with a big variable');
        assert.equal(ctx.runLogs[0].vars.big.length, LOG_VALUE_MAX + 1);
        assert.ok(ctx.runLogs[0].vars.big.endsWith('…'));
    });

    test('entries that go to another run start again', () => {
        const make = () => ({ runLogs: [], getVarsFlat: () => ({ a: '1' }) });
        assert.deepEqual(varsForLog(make()), { a: '1' });
        assert.deepEqual(varsForLog(make()), { a: '1' });
    });
});
