'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    createVarScopes,
    rewriteSelectorsWithCtx,
    interpolateIndexVars,
    interpolateTemplate,
    interpolateVarsDeep,
    interpolateVarTokensLoose,
    interpolateAll,
    resolveDisplayLabel
} = require('./vars');

describe('createVarScopes', () => {
    test('setVar/getVar round-trip on the initial scope', () => {
        const s = createVarScopes({ a: 1 });
        assert.equal(s.getVar('a'), 1);
        s.setVar('b', 2);
        assert.equal(s.getVar('b'), 2);
    });

    test('getVar returns undefined for unknown keys', () => {
        const s = createVarScopes();
        assert.equal(s.getVar('nope'), undefined);
    });

    test('pushVarScope shadows an outer var; popVarScope restores it', () => {
        const s = createVarScopes({ x: 'outer' });
        s.pushVarScope({ x: 'inner' });
        assert.equal(s.getVar('x'), 'inner');
        s.popVarScope();
        assert.equal(s.getVar('x'), 'outer');
    });

    test('a var set deep inside nested scopes remains visible to inner scopes until popped', () => {
        const s = createVarScopes();
        s.pushVarScope();
        s.setVar('menuSectionTitle', 'Search');
        s.pushVarScope();
        s.pushVarScope();
        // still reachable through two more nested (empty) scopes
        assert.equal(s.getVar('menuSectionTitle'), 'Search');
        s.popVarScope();
        s.popVarScope();
        assert.equal(s.getVar('menuSectionTitle'), 'Search');
        s.popVarScope();
        assert.equal(s.getVar('menuSectionTitle'), undefined);
    });

    test('popVarScope never pops below the root scope', () => {
        const s = createVarScopes({ a: 1 });
        s.popVarScope();
        s.popVarScope();
        assert.equal(s.getVar('a'), 1);
    });

    test('clearVar removes the key from every scope it appears in', () => {
        const s = createVarScopes({ a: 'root' });
        s.pushVarScope({ a: 'shadow' });
        s.clearVar('a');
        assert.equal(s.getVar('a'), undefined);
        s.popVarScope();
        // the root-scope copy must be gone too, not just the shadow
        assert.equal(s.getVar('a'), undefined);
    });

    test('getVarsFlat merges scopes with inner scopes winning', () => {
        const s = createVarScopes({ a: 1, b: 1 });
        s.pushVarScope({ b: 2, c: 3 });
        assert.deepEqual({ ...s.getVarsFlat() }, { a: 1, b: 2, c: 3 });
    });

    describe('vars Proxy', () => {
        test('set/get go through the scope stack', () => {
            const s = createVarScopes();
            const vars = s.makeVarsProxy();
            vars.foo = 'bar';
            assert.equal(vars.foo, 'bar');
            assert.equal(s.getVar('foo'), 'bar');
        });

        test('has reflects getVar presence', () => {
            const s = createVarScopes({ a: 1 });
            const vars = s.makeVarsProxy();
            assert.equal('a' in vars, true);
            assert.equal('missing' in vars, false);
        });

        test('hasOwnProperty works via the getOwnPropertyDescriptor trap (used by interpolateTemplate)', () => {
            const s = createVarScopes({ a: 1 });
            const vars = s.makeVarsProxy();
            assert.equal(Object.prototype.hasOwnProperty.call(vars, 'a'), true);
            assert.equal(Object.prototype.hasOwnProperty.call(vars, 'missing'), false);
        });

        test('delete on the proxy actually clears the underlying scope stack, not just the empty target', () => {
            const s = createVarScopes();
            s.setVar('temp', 'value');
            const vars = s.makeVarsProxy();
            assert.equal(vars.temp, 'value');
            delete vars.temp;
            assert.equal(vars.temp, undefined);
            assert.equal(s.getVar('temp'), undefined);
        });

        test('ownKeys reflects the flattened scope stack', () => {
            const s = createVarScopes({ a: 1 });
            s.pushVarScope({ b: 2 });
            const vars = s.makeVarsProxy();
            assert.deepEqual(Object.keys(vars).sort(), ['a', 'b']);
        });
    });
});

describe('interpolateIndexVars', () => {
    test('replaces {index}, {oneBased} and {total} in every string field', () => {
        const out = interpolateIndexVars(
            { label: 'Item {oneBased}/{total}', nested: { note: 'idx={index}' } },
            { index: 2, total: 5 }
        );
        assert.equal(out.label, 'Item 3/5');
        assert.equal(out.nested.note, 'idx=2');
    });

    test('leaves tokens alone when index/total are not numbers', () => {
        const out = interpolateIndexVars({ label: '{index}/{total}' }, {});
        assert.equal(out.label, '{index}/{total}');
    });

    test('does not mutate the input object', () => {
        const input = { label: '{index}' };
        interpolateIndexVars(input, { index: 0 });
        assert.equal(input.label, '{index}');
    });
});

describe('interpolateTemplate', () => {
    test('resolves from localVars first', () => {
        const out = interpolateTemplate('Hello {var:name}', { localVars: { name: 'World' } });
        assert.equal(out, 'Hello World');
    });

    test('falls back to ctx.vars when localVars does not have the key', () => {
        const scopes = createVarScopes();
        scopes.setVar('name', 'CtxValue');
        const ctx = { vars: scopes.makeVarsProxy() };
        const out = interpolateTemplate('Hello {var:name}', { localVars: {}, ctx });
        assert.equal(out, 'Hello CtxValue');
    });

    test('localVars takes precedence over ctx.vars when both have the key', () => {
        const scopes = createVarScopes();
        scopes.setVar('name', 'FromCtx');
        const ctx = { vars: scopes.makeVarsProxy() };
        const out = interpolateTemplate('{var:name}', { localVars: { name: 'FromLocal' }, ctx });
        assert.equal(out, 'FromLocal');
    });

    test('unresolved vars become empty string by default', () => {
        assert.equal(interpolateTemplate('[{var:missing}]', {}), '[]');
    });

    test('keepUnresolved preserves the raw token', () => {
        assert.equal(interpolateTemplate('[{var:missing}]', { keepUnresolved: true }), '[{var:missing}]');
    });

    test('a null/undefined resolved value renders as empty string, not the word "null"', () => {
        const out = interpolateTemplate('[{var:x}]', { localVars: { x: null } });
        assert.equal(out, '[]');
    });

    test('non-string input passes through untouched', () => {
        assert.equal(interpolateTemplate(42, {}), 42);
        assert.equal(interpolateTemplate(null, {}), null);
    });
});

describe('interpolateVarTokensLoose', () => {
    test('resolves dotted paths from localVars', () => {
        const out = interpolateVarTokensLoose('{var:user.name}', { localVars: { user: { name: 'Ada' } } });
        assert.equal(out, 'Ada');
    });

    test('falls back to ctx.getVar for simple (non-dotted) names', () => {
        const scopes = createVarScopes();
        scopes.setVar('title', 'Search');
        const ctx = { getVar: scopes.getVar };
        assert.equal(interpolateVarTokensLoose('{var:title}', { ctx }), 'Search');
    });

    test('falls back to ctx.vars for dotted paths ctx.getVar cannot serve', () => {
        const scopes = createVarScopes();
        scopes.setVar('user', { name: 'Ada' });
        const ctx = { getVar: scopes.getVar, vars: scopes.makeVarsProxy() };
        assert.equal(interpolateVarTokensLoose('{var:user.name}', { ctx }), 'Ada');
    });

    test('falls back to getVarsFlat as a last resort', () => {
        const ctx = { getVarsFlat: () => ({ z: 'flat-value' }) };
        assert.equal(interpolateVarTokensLoose('{var:z}', { ctx }), 'flat-value');
    });

    test('missing vars resolve to empty string', () => {
        assert.equal(interpolateVarTokensLoose('[{var:missing}]', {}), '[]');
    });
});

describe('interpolateVarsDeep', () => {
    const ctxWith = (vars) => {
        const scopes = createVarScopes(vars);
        return { vars: scopes.makeVarsProxy() };
    };

    test('interpolates plain string fields', () => {
        const out = interpolateVarsDeep({ alias: 'Hi {var:name}' }, { ctx: ctxWith({ name: 'Ada' }) });
        assert.equal(out.alias, 'Hi Ada');
    });

    test('recurses into plain nested objects and arrays', () => {
        const out = interpolateVarsDeep(
            { nested: { alias: '{var:name}' }, list: ['{var:name}'] },
            { ctx: ctxWith({ name: 'Ada' }) }
        );
        assert.equal(out.nested.alias, 'Ada');
        assert.equal(out.list[0], 'Ada');
    });

    test('"label" fields are left untouched (resolved separately/late by callers)', () => {
        const out = interpolateVarsDeep({ label: '{var:name}' }, { ctx: ctxWith({ name: 'Ada' }) });
        assert.equal(out.label, '{var:name}');
    });

    test('dataset-bearing fields (itemsText, dataset, include, exclude, ...) are left raw', () => {
        const raw = '{var:name}';
        for (const key of ['itemsText', 'datasetText', 'items', 'dataset', 'datasetItemsText', 'datasetOnePerLine', 'datasetLines', 'include', 'exclude']) {
            const out = interpolateVarsDeep({ [key]: raw }, { ctx: ctxWith({ name: 'Ada' }) });
            assert.equal(out[key], raw, `expected ${key} to be left raw`);
        }
    });

    test('regression: nested action lists (actions/elseActions/preActions/iterSetupActions) are not eagerly interpolated', () => {
        // This mirrors the real bug: an "if"/"forEachElement" container action carries its
        // nested actions as a property. Interpolating them here (before the container's own
        // case handler actually runs those nested actions one at a time) would resolve
        // {var:...} tokens using whatever is in scope *now* - typically before a sibling
        // action inside that same nested list (e.g. getText/setVar) has had a chance to set
        // the variable the later sibling references. Once resolved to '', the token is gone
        // for good, even once the variable legitimately exists later.
        const ctx = ctxWith({ menuSectionTitle: 'Search' }); // set; viewTitle is NOT set yet
        const container = {
            type: 'if',
            actions: [
                { type: 'setVar', key: 'viewTitle', value: 'Results' },
                { type: 'runCustomStep', argsJson: '{"label":"{var:menuSectionTitle} - {var:viewTitle}"}' }
            ],
            elseActions: [
                { type: 'runCustomStep', argsJson: '{"label":"{var:menuSectionTitle}"}' }
            ],
            preActions: [{ type: 'getText', var: '{var:menuSectionTitle}' }],
            iterSetupActions: [{ type: 'getText', var: '{var:menuSectionTitle}' }]
        };

        const out = interpolateVarsDeep(container, { ctx });

        // The nested lists must come back byte-for-byte identical: untouched.
        assert.deepEqual(out.actions, container.actions);
        assert.deepEqual(out.elseActions, container.elseActions);
        assert.deepEqual(out.preActions, container.preActions);
        assert.deepEqual(out.iterSetupActions, container.iterSetupActions);
    });

    test('sibling fields outside the excluded keys still interpolate normally on the same object', () => {
        const ctx = ctxWith({ name: 'Ada' });
        const out = interpolateVarsDeep(
            { alias: 'Hi {var:name}', actions: [{ argsJson: '{var:name}' }] },
            { ctx }
        );
        assert.equal(out.alias, 'Hi Ada');
        assert.equal(out.actions[0].argsJson, '{var:name}'); // left raw, as above
    });
});

describe('rewriteSelectorsWithCtx', () => {
    test('replaces :ctx only inside "selector" fields, recursively', () => {
        const out = rewriteSelectorsWithCtx(
            {
                selector: ':ctx button',
                note: 'keeps :ctx untouched here',
                nested: { selector: 'a :ctx b' },
                list: [{ selector: ':ctx.item' }]
            },
            '[data-scope="s1"]'
        );
        assert.equal(out.selector, '[data-scope="s1"] button');
        assert.equal(out.note, 'keeps :ctx untouched here');
        assert.equal(out.nested.selector, 'a [data-scope="s1"] b');
        assert.equal(out.list[0].selector, '[data-scope="s1"].item');
    });

    test('does not mutate the input', () => {
        const input = { selector: ':ctx' };
        rewriteSelectorsWithCtx(input, '#scoped');
        assert.equal(input.selector, ':ctx');
    });
});

describe('resolveDisplayLabel', () => {
    test('interpolates a non-empty raw template', () => {
        const scopes = createVarScopes({ name: 'Ada' });
        const ctx = { getVar: scopes.getVar, vars: scopes.makeVarsProxy() };
        assert.equal(resolveDisplayLabel('Hi {var:name}', null, null, ctx), 'Hi Ada');
    });

    test('falls back to the computed label when there is no raw template', () => {
        assert.equal(resolveDisplayLabel(null, 'Computed', null, null), 'Computed');
    });

    test('returns null when neither template nor computed value is present', () => {
        assert.equal(resolveDisplayLabel(null, null, null, null), null);
    });
});

describe('interpolateAll', () => {
    test('applies index interpolation then var interpolation, respecting the same exclusions', () => {
        const ctx = { vars: createVarScopes({ name: 'Ada' }).makeVarsProxy() };
        const out = interpolateAll(
            { alias: 'Item {oneBased} - {var:name}', actions: [{ argsJson: '{var:name}' }] },
            { index: 0, total: 3, ctx }
        );
        assert.equal(out.alias, 'Item 1 - Ada');
        assert.equal(out.actions[0].argsJson, '{var:name}');
    });
});
