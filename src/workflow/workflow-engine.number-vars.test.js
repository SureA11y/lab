'use strict';

// getCount, and number fields that take their value from a variable
// (repeat's repetitions: "{var:count}").

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext, countPlannedArtifacts } = require('./workflow-engine');

function makeCtx() {
    return createWorkflowContext({});
}

/**
 * A minimal DOM for getCount's in-page counter: a tree of nodes (children and
 * optional shadowRoot), and per-root match lists keyed by selector. Only the
 * members the counter touches are modelled.
 */
function makeDom({ light = {}, shadow = {} } = {}) {
    const host = { children: [], shadowRoot: null };
    const shadowRoot = {
        children: [{ children: [] }],
        querySelectorAll: (sel) => {
            if (sel === 'bad[') throw new SyntaxError(`'${sel}' is not a valid selector`);
            return new Array(shadow[sel] || 0).fill({});
        }
    };
    host.shadowRoot = shadowRoot;
    const documentElement = { children: [host, { children: [] }] };
    return {
        documentElement,
        body: null,
        querySelectorAll: (sel) => {
            if (sel === 'bad[') throw new SyntaxError(`'${sel}' is not a valid selector`);
            return new Array(light[sel] || 0).fill({});
        }
    };
}

function makePage(dom) {
    return {
        async $() { return null; },
        async $$() { return []; },
        url() { return 'about:blank'; },
        evaluate: async (fn, ...args) => {
            const prev = globalThis.document;
            globalThis.document = dom;
            try {
                return fn(...args);
            } finally {
                if (prev === undefined) delete globalThis.document;
                else globalThis.document = prev;
            }
        }
    };
}

async function run(page, actions, ctx = makeCtx()) {
    await applyActions(page, actions, null, 0, ctx, Object.create(null), 0, null);
    return ctx;
}

describe('getCount', () => {
    test('stores the number of matches, including inside open shadow roots, as a number', async () => {
        const page = makePage(makeDom({ light: { li: 3 }, shadow: { li: 2 } }));
        const ctx = await run(page, [{ type: 'getCount', selector: 'li', var: 'items' }]);
        assert.equal(ctx.getVar('items'), 5);
        assert.equal(typeof ctx.getVar('items'), 'number');
    });

    test('nothing matching stores 0 rather than failing', async () => {
        const page = makePage(makeDom());
        const ctx = await run(page, [{ type: 'getCount', selector: '.none', var: 'n' }]);
        assert.equal(ctx.getVar('n'), 0);
    });

    test('logValue writes the stored count to the run log; without it nothing is logged', async () => {
        const page = makePage(makeDom({ light: { li: 4 } }));
        const logged = await run(page, [{ type: 'getCount', selector: 'li', var: 'n', logValue: true }]);
        const entry = logged.runLogs.find((l) => /getCount:/.test(l.message));
        assert.ok(entry, 'expected a getCount log entry');
        assert.equal(entry.message, 'getCount: n = 4 (li)');
        assert.equal(entry.extra.value, 4);

        const quiet = await run(page, [{ type: 'getCount', selector: 'li', var: 'n' }]);
        assert.equal(quiet.runLogs.some((l) => /getCount:/.test(l.message)), false);
    });

    test('an invalid selector fails the step with a clear message', async () => {
        const page = makePage(makeDom());
        await assert.rejects(
            () => run(page, [{ type: 'getCount', selector: 'bad[', var: 'n' }]),
            /getCount: could not count "bad\["/
        );
    });

    test('a missing selector or variable name is a no-op, like getText', async () => {
        const page = makePage(makeDom({ light: { li: 1 } }));
        const ctx = await run(page, [
            { type: 'getCount', var: 'n' },
            { type: 'getCount', selector: 'li', var: '  ' }
        ]);
        assert.deepEqual(Object.keys(ctx.getVarsFlat()), []);
    });

    test('the count can be used as text elsewhere', async () => {
        const page = makePage(makeDom({ light: { li: 2 } }));
        const ctx = await run(page, [
            { type: 'getCount', selector: 'li', var: 'n' },
            { type: 'setVar', key: 'msg', value: '{var:n} items' }
        ]);
        assert.equal(ctx.getVar('msg'), '2 items');
    });
});

describe('number fields from variables', () => {
    const body = [{ type: 'setVar', key: 'ran', value: '{oneBased}' }];

    function captureWrites(ctx, key) {
        const seen = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, {
            set(target, k, v) {
                if (k === key) seen.push(v);
                target[k] = v;
                return true;
            }
        });
        return seen;
    }

    test('repeat runs {var:count} times when the count comes from getCount', async () => {
        const page = makePage(makeDom({ light: { '[role=tab]': 3 } }));
        const ctx = makeCtx();
        const seen = captureWrites(ctx, 'ran');
        await run(page, [
            { type: 'getCount', selector: '[role=tab]', var: 'tabs' },
            { type: 'repeat', repetitions: '{var:tabs}', actions: body }
        ], ctx);
        assert.deepEqual(seen, ['1', '2', '3']);
    });

    test('a text variable holding a number works too (getText/setVar store text)', async () => {
        const page = makePage(makeDom());
        const ctx = makeCtx();
        const seen = captureWrites(ctx, 'ran');
        await run(page, [
            { type: 'setVar', key: 'n', value: ' 2 ' },
            { type: 'repeat', repetitions: '{var:n}', actions: body }
        ], ctx);
        assert.deepEqual(seen, ['1', '2']);
    });

    test('text that is not a whole number runs 0 times and logs a warning naming the variable', async () => {
        for (const value of ['3 items', '2.5', '']) {
            const page = makePage(makeDom());
            const ctx = makeCtx();
            const seen = captureWrites(ctx, 'ran');
            await run(page, [
                { type: 'setVar', key: 'n', value },
                { type: 'repeat', repetitions: '{var:n}', actions: body }
            ], ctx);
            assert.deepEqual(seen, [], `value ${JSON.stringify(value)}`);
            const warning = ctx.runLogs.find((l) => l.type === 'warning' && /"repetitions"/.test(l.message));
            assert.ok(warning, `expected a warning for ${JSON.stringify(value)}`);
            assert.match(warning.message, /variable "n"/);
            assert.equal(warning.extra.rawValue, '{var:n}');
        }
    });

    test('an unset variable runs 0 times and says so', async () => {
        const page = makePage(makeDom());
        const ctx = await run(page, [{ type: 'repeat', repetitions: '{var:nope}', actions: body }]);
        const warning = ctx.runLogs.find((l) => l.type === 'warning');
        assert.match(warning.message, /is empty \(is the variable set\?\)/);
    });

    test('a count of 0 keeps the existing rule (no iterations) but is reported as below the minimum', async () => {
        const page = makePage(makeDom());
        const ctx = makeCtx();
        const seen = captureWrites(ctx, 'ran');
        await run(page, [
            { type: 'getCount', selector: '.none', var: 'n' },
            { type: 'repeat', repetitions: '{var:n}', actions: body }
        ], ctx);
        assert.deepEqual(seen, []);
        assert.ok(ctx.runLogs.some((l) => l.type === 'warning' && /below the minimum of 1/.test(l.message)));
    });

    test('literal numbers behave exactly as before, with no warnings', async () => {
        const page = makePage(makeDom());
        const ctx = makeCtx();
        const seen = captureWrites(ctx, 'ran');
        await run(page, [{ type: 'repeat', repetitions: 2, actions: body }], ctx);
        assert.deepEqual(seen, ['1', '2']);
        assert.equal(ctx.runLogs.some((l) => l.type === 'warning'), false);
    });

    test('other number fields accept variables too (wait.ms)', async (t) => {
        // A clock of its own: which wait was made, not how long a busy
        // machine took to make it.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const page = makePage(makeDom());
        const ctx = makeCtx();
        let done = false;
        const running = run(page, [
            { type: 'setVar', key: 'pause', value: '5' },
            { type: 'wait', ms: '{var:pause}' }
        ], ctx).then(() => { done = true; });
        for (let i = 0; i < 10 && !done; i += 1) {
            t.mock.timers.tick(5);
            await new Promise((r) => setImmediate(r));
        }
        await running;
        assert.equal(done, true, 'wait used the variable (5ms), not its 1000ms fallback');
        assert.equal(ctx.runLogs.some((l) => l.type === 'warning'), false);
    });
});

describe('getCount inside a group', () => {
    const reps = { type: 'repeat', repetitions: '{var:n}', actions: [{ type: 'wait', ms: 0 }] };
    const iterations = (ctx) => ctx.runLogs.filter((l) => l.extra?.stepEvent === 'loop-iteration').length;

    test('the count is available inside the group, and gone after it', async () => {
        const page = makePage(makeDom({ light: { li: 2 } }));
        const inside = await run(page, [{ type: 'group', actions: [{ type: 'getCount', selector: 'li', var: 'n' }, reps] }]);
        assert.equal(iterations(inside), 2);

        const after = await run(page, [{ type: 'group', actions: [{ type: 'getCount', selector: 'li', var: 'n' }] }, reps]);
        assert.equal(iterations(after), 0);
        assert.ok(after.runLogs.some((l) => l.type === 'warning' && /variable "n"/.test(l.message)));
    });

    test('the same holds when the group sits inside a repeat', async () => {
        const page = makePage(makeDom({ light: { li: 2 } }));
        const ctx = await run(page, [{
            type: 'repeat', repetitions: 1,
            actions: [{ type: 'group', actions: [{ type: 'getCount', selector: 'li', var: 'n' }] }, reps]
        }]);
        assert.equal(iterations(ctx), 1, 'only the outer repeat iterates');
    });
});

describe('countPlannedArtifacts with variable repetitions', () => {
    test('a variable count is estimated as one pass; number text is read as a number', () => {
        const scan = [{ type: 'a11yScan' }];
        assert.equal(countPlannedArtifacts([{ type: 'repeat', repetitions: '{var:n}', actions: scan }]).a11yScans, 1);
        assert.equal(countPlannedArtifacts([{ type: 'repeat', repetitions: '3', actions: scan }]).a11yScans, 3);
        assert.equal(countPlannedArtifacts([{ type: 'repeat', repetitions: 'x', actions: scan }]).a11yScans, 0);
    });
});
