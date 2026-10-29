'use strict';

// The switch step against the real engine, with a stub page: it only reads
// page.url(), so no browser is needed. See docs/design/switch-step-design.md.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext, countPlannedArtifacts } = require('./workflow-engine');

const pageAt = (href) => ({
    async $() { return null; },
    async $$() { return []; },
    async evaluate() { return null; },
    url: async () => href
});

const makeCtx = (customSteps = {}) => createWorkflowContext({ customSteps });

// Branches isolate their variables, so record every write through ctx.vars to
// see which branch ran.
function recordWrites(ctx) {
    const written = Object.create(null);
    const realVars = ctx.vars;
    ctx.vars = new Proxy(realVars, {
        set(target, k, v) {
            written[k] = v;
            target[k] = v;
            return true;
        }
    });
    ctx.written = written;
    return ctx;
}

const mark = (value) => [{ type: 'setVar', key: 'branch', value }];
const kase = (comparison, value, branch, extra = {}) => ({ type: 'case', comparison, value, actions: mark(branch), ...extra });

async function run(href, step, { ctx = recordWrites(makeCtx()), localVars = Object.create(null) } = {}) {
    await applyActions(pageAt(href), [step], null, 0, ctx, localVars, 0, null);
    return ctx;
}

describe('switch on a URL part', () => {
    const href = 'https://docs.example.com/ui/#/components/avq-popover/examples';

    test('runs the first case that matches, and only that one', async () => {
        const ctx = await run(href, {
            type: 'switch', subject: 'url', urlPart: 'hash',
            cases: [
                kase('contains', '/avq-filter/examples', 'filter'),
                kase('contains', '/examples', 'any-examples'),
                kase('contains', '/avq-popover/examples', 'popover')
            ],
            defaultActions: mark('default')
        });
        assert.equal(ctx.written.branch, 'any-examples');
    });

    test('runs the default when no case matches', async () => {
        const ctx = await run(href, {
            type: 'switch', subject: 'url', urlPart: 'hash',
            cases: [kase('equals', '/changelog', 'changelog')],
            defaultActions: mark('default')
        });
        assert.equal(ctx.written.branch, 'default');
    });

    test('no match and no default runs nothing', async () => {
        const ctx = await run(href, { type: 'switch', subject: 'url', urlPart: 'hash', cases: [kase('equals', '/x', 'x')] });
        assert.equal(ctx.written.branch, undefined);
    });

    test('the subject defaults to the URL, and reads parts like the URL condition', async () => {
        const ctx = await run('https://Shop.Example.com/?step=20', {
            type: 'switch', urlPart: 'param', paramName: 'step',
            cases: [kase('equals', '2', 'two'), kase('equals', '20', 'twenty')]
        });
        assert.equal(ctx.written.branch, 'twenty');
        const host = await run('https://Shop.Example.com/', {
            type: 'switch', urlPart: 'host', cases: [kase('equals', 'SHOP.example.com', 'host')]
        });
        assert.equal(host.written.branch, 'host');
    });

    test('a disabled case is skipped', async () => {
        const ctx = await run(href, {
            type: 'switch', urlPart: 'hash',
            cases: [kase('contains', 'popover', 'disabled', { disabled: true }), kase('contains', 'popover', 'enabled')]
        });
        assert.equal(ctx.written.branch, 'enabled');
    });

    test('case values expand {var:name}', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('component', 'avq-popover');
        await run(href, {
            type: 'switch', urlPart: 'hash',
            cases: [kase('contains', '/{var:component}/examples', 'matched')]
        }, { ctx });
        assert.equal(ctx.written.branch, 'matched');
    });
});

describe('switch on a variable', () => {
    test('compares the variable as text', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('build', 2310);
        await run('about:blank', {
            type: 'switch', subject: 'var', var: 'build',
            cases: [kase('equals', '2309', 'old'), kase('equals', '2310', 'current')]
        }, { ctx });
        assert.equal(ctx.written.branch, 'current');
    });

    test('an unset variable equals nothing, so it falls to a negated case or the default', async () => {
        const ctx = await run('about:blank', {
            type: 'switch', subject: 'var', var: 'missing',
            cases: [kase('equals', '', 'empty'), kase('notEquals', 'x', 'not-x')],
            defaultActions: mark('default')
        });
        assert.equal(ctx.written.branch, 'not-x');
    });

    test('finds the variable the way {var:name} does: a custom step\'s exported variable counts', async () => {
        const customSteps = {
            pick: { id: 'pick', actions: [{ type: 'setVar', key: 'section', value: 'Forms' }] }
        };
        const ctx = recordWrites(makeCtx(customSteps));
        const localVars = Object.create(null);
        await applyActions(pageAt('about:blank'), [
            { type: 'runCustomStep', customStepId: 'pick', exportVars: ['section'] },
            { type: 'switch', subject: 'var', var: 'section', cases: [kase('equals', 'Forms', 'forms')], defaultActions: mark('default') },
            { type: 'setVar', key: 'viaToken', value: '{var:section}' }
        ], null, 0, ctx, localVars, 0, null);
        assert.equal(ctx.written.viaToken, 'Forms');
        assert.equal(ctx.written.branch, 'forms');
    });
});

describe('switch and variable scope', () => {
    test('a variable set inside a case does not outlive the switch, like in an if', async () => {
        const ctx = recordWrites(makeCtx());
        const localVars = Object.create(null);
        await applyActions(pageAt('https://example.com/a'), [
            { type: 'switch', urlPart: 'path', cases: [{ type: 'case', comparison: 'equals', value: '/a', actions: [{ type: 'setVar', key: 'inner', value: 'x' }] }] },
            { type: 'setVar', key: 'after', value: 'inner={var:inner}' }
        ], null, 0, ctx, localVars, 0, null);
        assert.equal(ctx.written.inner, 'x');
        assert.equal(ctx.written.after, 'inner=');
        assert.equal(localVars.inner, undefined);
    });

    test('a case sees the variables set before the switch', async () => {
        const ctx = recordWrites(makeCtx());
        await applyActions(pageAt('https://example.com/a'), [
            { type: 'setVar', key: 'before', value: 'b' },
            { type: 'switch', urlPart: 'path', cases: [{ type: 'case', comparison: 'equals', value: '/a', actions: [{ type: 'setVar', key: 'seen', value: '{var:before}' }] }] }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.written.seen, 'b');
    });

    test('the default is scoped the same way', async () => {
        const ctx = recordWrites(makeCtx());
        const localVars = Object.create(null);
        await applyActions(pageAt('https://example.com/a'), [
            { type: 'switch', urlPart: 'path', cases: [], defaultActions: [{ type: 'setVar', key: 'inner', value: 'x' }] },
            { type: 'setVar', key: 'after', value: 'inner={var:inner}' }
        ], null, 0, ctx, localVars, 0, null);
        assert.equal(ctx.written.after, 'inner=');
    });
});

describe('if + var uses the same variable lookup as {var:name}', () => {
    test('a custom step\'s exported variable is seen by an if', async () => {
        const customSteps = { pick: { id: 'pick', actions: [{ type: 'setVar', key: 'mode', value: 'on' }] } };
        const ctx = recordWrites(makeCtx(customSteps));
        await applyActions(pageAt('about:blank'), [
            { type: 'runCustomStep', customStepId: 'pick', exportVars: ['mode'] },
            { type: 'if', var: 'mode', equals: 'on', actions: mark('then'), elseActions: mark('else') }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.written.branch, 'then');
    });
});

describe('switch logging and errors', () => {
    test('logs the subject, the case taken, and a branch event the step counter reads', async () => {
        const ctx = makeCtx();
        await applyActions(pageAt('https://example.com/?lang=en'), [{
            type: 'switch', urlPart: 'param', paramName: 'lang',
            cases: [kase('equals', 'fr', 'fr'), kase('equals', 'en', 'en')]
        }], null, 0, ctx, Object.create(null), 0, null);
        const logs = ctx.runLogs || [];
        assert.ok(logs.some((l) => l.message === 'switch: URL param "lang" "en" -> case 2'));
        const branch = logs.find((l) => l.extra?.stepEvent === 'branch');
        assert.deepEqual([branch.extra.actionPath, branch.extra.taken, branch.extra.caseIndex], ['1', 'case', 2]);
    });

    test('a case\'s steps are numbered under the case, the default\'s under the switch', async () => {
        const ctx = makeCtx();
        await applyActions(pageAt('https://example.com/a'), [
            { type: 'setVar', key: 'x', value: '1' },
            { type: 'switch', urlPart: 'path', cases: [kase('equals', '/b', 'b'), kase('equals', '/a', 'a')] },
            { type: 'switch', urlPart: 'path', cases: [kase('equals', '/b', 'b')], defaultActions: mark('default') }
        ], null, 0, ctx, Object.create(null), 0, null);
        const starts = (ctx.runLogs || []).filter((l) => l.extra?.stepEvent === 'action-start').map((l) => l.extra.actionPath);
        assert.deepEqual(starts, ['1', '2', '2.2.1', '3', '3.1']);
    });

    test('fails on a misconfigured switch instead of running the default', async () => {
        const step = (extra) => ({ type: 'switch', cases: [kase('equals', 'x', 'x')], defaultActions: mark('default'), ...extra });
        await assert.rejects(run('https://example.com/', step({ subject: 'page' })), /subject must be one of/);
        await assert.rejects(run('https://example.com/', step({ urlPart: 'param' })), /paramName is required/);
        await assert.rejects(run('https://example.com/', step({ subject: 'var' })), /var is required/);
        await assert.rejects(run('https://example.com/', step({ urlPart: 'path', cases: [kase('startsWith', 'x', 'x')] })), /comparison must be one of/);
        await assert.rejects(run('https://example.com/', step({ urlPart: 'path', cases: [{ type: 'click', selector: 'a' }] })), /only holds case steps/);
    });

    test('a case step met outside a switch fails', async () => {
        await assert.rejects(run('https://example.com/', kase('equals', 'x', 'x')), /only runs inside a switch/);
    });
});

describe('countPlannedArtifacts and switch', () => {
    test('takes the worst branch, cases and default alike', () => {
        const out = countPlannedArtifacts([{
            type: 'switch', urlPart: 'path',
            cases: [
                { type: 'case', value: '/a', actions: [{ type: 'a11yScan' }] },
                { type: 'case', value: '/b', actions: [{ type: 'a11yScan' }, { type: 'a11yScan' }, { type: 'a11yScan' }], disabled: true }
            ],
            defaultActions: [{ type: 'a11yScan' }, { type: 'a11yScan' }]
        }]);
        assert.equal(out.a11yScans, 2);
    });
});
