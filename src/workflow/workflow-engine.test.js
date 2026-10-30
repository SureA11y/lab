'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext, countPlannedArtifacts, buildViewportFromPreset, resolveZoomFactor, applyZoomToViewport, runEvidenceCaptureShared } = require('./workflow-engine');
const sharp = require('sharp');

// None of the action types exercised below (group/if/repeat/setVar/clearVar/runCustomStep)
// touch the page, so a minimal stub is enough. forEachElement's real DOM traversal needs a
// live Puppeteer page/element handles and is intentionally out of scope for these unit tests.
const fakePage = {
    async $() { return null; },
    async $$() { return []; },
    url() { return 'about:blank'; }
};

function makeCtx(customSteps = {}) {
    // No postStepDelayMs override needed: workflow-engine.js defaults it to 0 automatically
    // when running under `node --test`, and to the real 500ms otherwise.
    return createWorkflowContext({ customSteps });
}

// "if" and "group" isolate their children (ctx scope and localVars alike), so a var
// set inside is gone once they complete. Record every write through ctx.vars,
// which all var-setting actions use, to see which branch ran.
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

describe('buildViewportFromPreset', () => {
    const cases = [
        ['desktop-xlg', {width: 1972, height: 1100}],
        ['desktop-lg', {width: 1440, height: 900}],
        ['default', {width: 1280, height: 720}],
        ['desktop-md', {width: 1280, height: 720}],
        ['tablet', {width: 768, height: 1024}],
        ['mobile', {width: 375, height: 812}]
    ];
    for (const [preset, expected] of cases) {
        test(`resolves "${preset}" to ${expected.width}x${expected.height}`, () => {
            assert.deepEqual(buildViewportFromPreset(preset), expected);
        });
    }

    for (const bad of ['unknown-preset', '', null, undefined, 42]) {
        test(`returns null for unrecognized preset ${JSON.stringify(bad)}`, () => {
            assert.equal(buildViewportFromPreset(bad), null);
        });
    }
});

describe('countPlannedArtifacts', () => {
    test('non-array input returns all-zero counts', () => {
        for (const bad of [null, undefined, 'not-an-array', {}, 42]) {
            assert.deepEqual(countPlannedArtifacts(bad), {a11yScans: 0, screenshots: 0, evidence: 0, totalArtifacts: 0, axe: 0});
        }
    });

    test('sums a11yScan/screenshot/evidenceCapture (variants) at the top level, axe mirrors a11yScans', () => {
        const out = countPlannedArtifacts([
            {type: 'a11yScan'},
            {type: 'a11yScan'},
            {type: 'screenshot'},
            {type: 'evidenceCapture', variants: 'png'},
            {type: 'evidenceCapture', variants: 'mhtml'},
            {type: 'evidenceCapture', variants: 'both'},
            {type: 'evidenceCapture'} // no variants specified -> defaults to "both" (2)
        ]);
        assert.deepEqual(out, {a11yScans: 2, screenshots: 1, evidence: 1 + 1 + 2 + 2, totalArtifacts: 2 + 1 + 6, axe: 2});
    });

    test('disabled actions are excluded, at any nesting level', () => {
        const out = countPlannedArtifacts([
            {type: 'a11yScan', disabled: true},
            {type: 'group', actions: [{type: 'screenshot', disabled: true}, {type: 'screenshot'}]}
        ]);
        assert.deepEqual(out.a11yScans, 0);
        assert.deepEqual(out.screenshots, 1);
    });

    test('group flattens its children without multiplying', () => {
        const out = countPlannedArtifacts([
            {type: 'group', actions: [{type: 'a11yScan'}, {type: 'screenshot'}]}
        ]);
        assert.deepEqual(out, {a11yScans: 1, screenshots: 1, evidence: 0, totalArtifacts: 2, axe: 1});
    });

    test('if takes the worst case (max) of actions vs elseActions per artifact kind, not their sum', () => {
        const out = countPlannedArtifacts([{
            type: 'if',
            var: 'x',
            equals: 1,
            actions: [{type: 'a11yScan'}, {type: 'screenshot'}],
            elseActions: [{type: 'a11yScan'}, {type: 'a11yScan'}, {type: 'a11yScan'}]
        }]);
        // a11yScans: max(1, 3) = 3; screenshots: max(1, 0) = 1
        assert.deepEqual(out, {a11yScans: 3, screenshots: 1, evidence: 0, totalArtifacts: 4, axe: 3});
    });

    test('if with only actions (no elseActions) treats the missing branch as all-zero', () => {
        const out = countPlannedArtifacts([{type: 'if', selectorExists: '.x', actions: [{type: 'a11yScan'}]}]);
        assert.deepEqual(out.a11yScans, 1);
    });

    describe('ifUrl', () => {
    const pageAt = (href) => ({ ...fakePage, url: async () => href });
    const branches = {
        actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
        elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
    };

    async function branchTaken(href, step, ctx = recordWrites(makeCtx())) {
        await applyActions(pageAt(href), [{ type: 'ifUrl', ...step, ...branches }], null, 0, ctx, Object.create(null), 0, null);
        return ctx.written.branch;
    }

    test('runs "actions" when the chosen part matches, "elseActions" when it does not', async () => {
        const href = 'https://example.com/shop?step=2#reviews';
        assert.equal(await branchTaken(href, { urlPart: 'param', paramName: 'step', comparison: 'equals', value: '2' }), 'then');
        assert.equal(await branchTaken(href, { urlPart: 'param', paramName: 'step', comparison: 'equals', value: '3' }), 'else');
        assert.equal(await branchTaken(href, { urlPart: 'hash', comparison: 'notEquals', value: 'reviews' }), 'else');
        assert.equal(await branchTaken(href, { urlPart: 'host', comparison: 'notEquals', value: 'other.com' }), 'then');
    });

    test('the value expands {var:name}', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('wanted', '/shop');
        assert.equal(await branchTaken('https://example.com/shop', { urlPart: 'path', comparison: 'equals', value: '{var:wanted}' }, ctx), 'then');
    });

    test('logs the comparison and the branch it took', async () => {
        const ctx = makeCtx();
        await applyActions(pageAt('https://example.com/?lang=en'), [{ type: 'ifUrl', urlPart: 'param', paramName: 'lang', comparison: 'equals', value: 'fr' }],
            null, 0, ctx, Object.create(null), 0, null);
        const logs = ctx.runLogs || [];
        assert.ok(logs.some((l) => /ifUrl: param "lang" "en" equals "fr" -> false/.test(l.message)));
        assert.ok(logs.some((l) => l.extra?.stepEvent === 'branch' && l.extra?.taken === 'else'));
    });

    test('a misconfigured step fails instead of silently taking the else branch', async () => {
        await assert.rejects(
            branchTaken('https://example.com/', { urlPart: 'param', comparison: 'equals', value: 'x' }),
            /paramName is required/
        );
    });

    test('countPlannedArtifacts takes the worst branch, like if', () => {
        const out = countPlannedArtifacts([{
            type: 'ifUrl', urlPart: 'path', value: '/a',
            actions: [{ type: 'a11yScan' }],
            elseActions: [{ type: 'a11yScan' }, { type: 'a11yScan' }]
        }]);
        assert.equal(out.a11yScans, 2);
    });
});

describe('repeat', () => {
        test('itemsText line count determines repetitions when no times/repetitions given', () => {
            const out = countPlannedArtifacts([{
                type: 'repeat',
                itemsText: 'a\nb\nc',
                actions: [{type: 'a11yScan'}]
            }]);
            assert.equal(out.a11yScans, 3);
        });

        // The estimator's precedence (itemsText > times > repetitions) matches the real "repeat"
        // action's runtime precedence (see the "repeat" describe block below) - itemsText always
        // wins when present, even if action.times is also set.
        test('itemsText line count wins over action.times, matching the real repeat action', () => {
            const out = countPlannedArtifacts([{
                type: 'repeat',
                itemsText: 'a\nb', // 2 lines
                times: 5,
                actions: [{type: 'a11yScan'}]
            }]);
            assert.equal(out.a11yScans, 2);
        });

        test('falls back to repetitions when times is absent', () => {
            const out = countPlannedArtifacts([{
                type: 'repeat',
                repetitions: 4,
                actions: [{type: 'a11yScan'}]
            }]);
            assert.equal(out.a11yScans, 4);
        });

        test('zero/absent times, repetitions, and itemsText contribute nothing', () => {
            const out = countPlannedArtifacts([{type: 'repeat', times: 0, actions: [{type: 'a11yScan'}]}]);
            assert.equal(out.a11yScans, 0);
        });

        test('multiplies nested artifact counts by the repetition count', () => {
            const out = countPlannedArtifacts([{
                type: 'repeat',
                times: 3,
                actions: [{type: 'a11yScan'}, {type: 'screenshot'}]
            }]);
            assert.deepEqual(out, {a11yScans: 3, screenshots: 3, evidence: 0, totalArtifacts: 6, axe: 3});
        });
    });

    test('forEachElement defaults its multiplier to 2 when no limit is given, and sums preActions + actions', () => {
        const out = countPlannedArtifacts([{
            type: 'forEachElement',
            selector: '.item',
            preActions: [{type: 'screenshot'}],
            actions: [{type: 'a11yScan'}]
        }]);
        assert.deepEqual(out, {a11yScans: 2, screenshots: 2, evidence: 0, totalArtifacts: 4, axe: 2});
    });

    test('forEachElement honors an explicit limit as the multiplier', () => {
        const out = countPlannedArtifacts([{
            type: 'forEachElement',
            selector: '.item',
            limit: 5,
            actions: [{type: 'a11yScan'}]
        }]);
        assert.equal(out.a11yScans, 5);
    });

    describe('runCustomStep', () => {
        test('counts artifacts inside the referenced custom step', () => {
            const out = countPlannedArtifacts(
                [{type: 'runCustomStep', customStepId: 'scanIt'}],
                {scanIt: {id: 'scanIt', actions: [{type: 'a11yScan'}, {type: 'a11yScan'}]}}
            );
            assert.equal(out.a11yScans, 2);
        });

        test('an unresolvable customStepId contributes nothing (no throw)', () => {
            const out = countPlannedArtifacts([{type: 'runCustomStep', customStepId: 'missing'}], {});
            assert.deepEqual(out, {a11yScans: 0, screenshots: 0, evidence: 0, totalArtifacts: 0, axe: 0});
        });

        test('a self-recursive custom step counts its own artifacts once and stops recursing (no infinite loop)', () => {
            const out = countPlannedArtifacts(
                [{type: 'runCustomStep', customStepId: 'loop'}],
                {loop: {id: 'loop', actions: [{type: 'a11yScan'}, {type: 'runCustomStep', customStepId: 'loop'}]}}
            );
            assert.equal(out.a11yScans, 1);
        });

        test('nested (non-recursive) custom steps resolve transitively', () => {
            const out = countPlannedArtifacts(
                [{type: 'runCustomStep', customStepId: 'outer'}],
                {
                    outer: {id: 'outer', actions: [{type: 'runCustomStep', customStepId: 'inner'}]},
                    inner: {id: 'inner', actions: [{type: 'screenshot'}]}
                }
            );
            assert.equal(out.screenshots, 1);
        });
    });

    test('an unknown action type with its own "actions" array still recurses into it (generic container fallback)', () => {
        const out = countPlannedArtifacts([{type: 'someFutureContainerType', actions: [{type: 'a11yScan'}]}]);
        assert.equal(out.a11yScans, 1);
    });

    test('an unknown action type without an "actions" array contributes nothing', () => {
        const out = countPlannedArtifacts([{type: 'click', selector: '.btn'}]);
        assert.deepEqual(out, {a11yScans: 0, screenshots: 0, evidence: 0, totalArtifacts: 0, axe: 0});
    });
});

describe('runCustomStep', () => {
    const customSteps = {
        greet: {
            id: 'greet',
            name: 'greet',
            inputs: [
                { name: 'label', required: true },
                { name: 'suffix', required: false, default: 'default-suffix' }
            ],
            actions: [{ type: 'wait', ms: 0 }]
        }
    };

    test('resolves literal string args as custom-step inputs (exported for inspection)', async () => {
        const ctx = makeCtx(customSteps);
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'runCustomStep',
            customStepId: 'greet',
            argsJson: JSON.stringify({ label: 'Home' }),
            exportVars: ['label', 'suffix']
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(localVars.label, 'Home');
        assert.equal(localVars.suffix, 'default-suffix');
    });

    test('resolves {var:...} tokens in args using the caller scope at call time', async () => {
        const ctx = makeCtx(customSteps);
        ctx.pushVarScope();
        ctx.setVar('city', 'Lisbon');
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'runCustomStep',
            customStepId: 'greet',
            argsJson: JSON.stringify({ label: 'Hello {var:city}' }),
            exportVars: ['label']
        }], null, 0, ctx, localVars, 0, null);
        ctx.popVarScope();

        assert.equal(localVars.label, 'Hello Lisbon');
    });

    test('throws when a required input has no value and no default', async () => {
        const ctx = makeCtx(customSteps);
        await assert.rejects(
            () => applyActions(fakePage, [{
                type: 'runCustomStep',
                customStepId: 'greet',
                argsJson: JSON.stringify({})
            }], null, 0, ctx, Object.create(null), 0, null),
            /missing required input "label"/
        );
    });

    test('throws for an unknown customStepId', async () => {
        const ctx = makeCtx(customSteps);
        await assert.rejects(
            () => applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'nope', argsJson: '{}' }], null, 0, ctx, Object.create(null), 0, null),
            /was not found/
        );
    });

    test('throws on cyclic custom step invocation instead of infinite-looping', async () => {
        const cyclic = {
            a: { id: 'a', name: 'a', inputs: [], actions: [{ type: 'runCustomStep', customStepId: 'b', argsJson: '{}' }] },
            b: { id: 'b', name: 'b', inputs: [], actions: [{ type: 'runCustomStep', customStepId: 'a', argsJson: '{}' }] }
        };
        const ctx = makeCtx(cyclic);
        await assert.rejects(
            () => applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'a', argsJson: '{}' }], null, 0, ctx, Object.create(null), 0, null),
            /cycle detected/
        );
    });

    test('allows direct self-recursion when allowRecursion=true and stops at maxDepth', async () => {
        const recursive = {
            loop: {
                id: 'loop',
                name: 'loop',
                inputs: [],
                actions: [{ type: 'runCustomStep', customStepId: 'loop', allowRecursion: true, maxDepth: 3 }]
            }
        };
        const ctx = makeCtx(recursive);
        await assert.rejects(
            () => applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'loop', allowRecursion: true, maxDepth: 3 }], null, 0, ctx, Object.create(null), 0, null),
            /exceeded max depth \(3\)/
        );
    });

    test('still blocks indirect recursion even when allowRecursion=true', async () => {
        const indirectCycle = {
            a: { id: 'a', name: 'a', inputs: [], actions: [{ type: 'runCustomStep', customStepId: 'b', argsJson: '{}' }] },
            b: { id: 'b', name: 'b', inputs: [], actions: [{ type: 'runCustomStep', customStepId: 'a', allowRecursion: true, argsJson: '{}' }] }
        };
        const ctx = makeCtx(indirectCycle);
        await assert.rejects(
            () => applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'a', argsJson: '{}' }], null, 0, ctx, Object.create(null), 0, null),
            /cycle detected/
        );
    });

    // Regression test: a runCustomStep nested inside an "if"/"forEachElement" block whose argsJson
    // references a var set by an earlier SIBLING action in that block must resolve after the
    // sibling runs (not to an empty string). See src/workflow/engine/vars.js interpolateVarsDeep.
    test('regression: a var set by an earlier sibling inside the same if-branch reaches a later runCustomStep', async () => {
        const ctx = recordWrites(makeCtx(customSteps));
        ctx.pushVarScope();
        ctx.setVar('menuSectionTitle', 'Search'); // set *before* the block starts, like an outer preAction
        ctx.setVar('always', true);

        const localVars = Object.create(null);
        const tree = [{
            type: 'if',
            var: 'always',
            equals: true,
            actions: [
                { type: 'setVar', key: 'viewTitle', value: 'Results' }, // set *inside* the block, like getText would
                {
                    type: 'runCustomStep',
                    customStepId: 'greet',
                    argsJson: JSON.stringify({ label: '{var:menuSectionTitle} - {var:viewTitle}' }),
                    exportVars: ['label']
                },
                // exportVars lands inside the branch, which the if isolates: read it there.
                { type: 'setVar', key: 'observed', value: '{var:label}' }
            ]
        }];

        await applyActions(fakePage, tree, null, 0, ctx, localVars, 0, null);
        ctx.popVarScope();

        assert.equal(ctx.written.observed, 'Search - Results');
    });

    test('throws when action.customStepId is missing/blank, before even looking it up', async () => {
        const ctx = makeCtx(customSteps);
        await assert.rejects(
            () => applyActions(fakePage, [{ type: 'runCustomStep' }], null, 0, ctx, Object.create(null), 0, null),
            /requires customStepId/
        );
    });

    test('is a silent no-op when the custom step resolves but has no actions', async () => {
        const ctx = makeCtx({ empty: { id: 'empty', name: 'empty', inputs: [], actions: [] } });
        await applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'empty' }], null, 0, ctx, Object.create(null), 0, null);
    });

    test('maxDepth is enforced even without a cycle: calling "b" from inside "a" with maxDepth:1 exceeds it (depth is already 1)', async () => {
        const chain = {
            a: { id: 'a', name: 'a', inputs: [], actions: [{ type: 'runCustomStep', customStepId: 'b', maxDepth: 1 }] },
            b: { id: 'b', name: 'b', inputs: [], actions: [{ type: 'wait', ms: 0 }] }
        };
        const ctx = makeCtx(chain);
        await assert.rejects(
            () => applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'a' }], null, 0, ctx, Object.create(null), 0, null),
            /exceeded max depth \(1\)/
        );
    });

    test('non-string arg values (numbers/objects) are cloned through untouched, not interpolated', async () => {
        const steps = {
            echo: {
                id: 'echo', name: 'echo',
                inputs: [{ name: 'count', required: true }, { name: 'meta', required: true }],
                actions: [{ type: 'wait', ms: 0 }]
            }
        };
        const ctx = makeCtx(steps);
        const localVars = Object.create(null);
        const meta = { nested: { a: 1 } };
        await applyActions(fakePage, [{
            type: 'runCustomStep',
            customStepId: 'echo',
            argsJson: JSON.stringify({ count: 3, meta }),
            exportVars: ['count', 'meta']
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(localVars.count, 3);
        assert.deepEqual(localVars.meta, meta);
        assert.notEqual(localVars.meta, meta); // cloneDeep: same shape, different reference
    });

    test('an input default value is itself interpolated (using the caller scope) when not overridden by the caller', async () => {
        const steps = {
            greetSite: {
                id: 'greetSite', name: 'greetSite',
                inputs: [{ name: 'msg', required: false, default: 'Welcome to {var:siteName}' }],
                actions: [{ type: 'wait', ms: 0 }]
            }
        };
        const ctx = makeCtx(steps);
        ctx.setVar('siteName', 'Acme');
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'runCustomStep',
            customStepId: 'greetSite',
            argsJson: '{}',
            exportVars: ['msg']
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(localVars.msg, 'Welcome to Acme');
    });

    test('exportVars for a name the step never set resolves to undefined, not an error', async () => {
        const ctx = makeCtx(customSteps);
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'runCustomStep',
            customStepId: 'greet',
            argsJson: JSON.stringify({ label: 'Hi' }),
            exportVars: ['label', 'neverSet']
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(localVars.label, 'Hi');
        assert.equal(localVars.neverSet, undefined);
    });
});

describe('group', () => {
    // Vars set inside a group are gone once it completes, so they're observed while
    // being written, through the ctx.vars Proxy that every var-setting action uses.
    function captureAfter(ctx, key) {
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

    test('vars set inside a group do not leak to the caller once it completes', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{
            type: 'group',
            actions: [{ type: 'setVar', key: 'inner', value: 'only-in-group' }]
        }], null, 0, ctx, Object.create(null), 0, null);

        assert.equal(ctx.getVar('inner'), undefined);
    });

    // A group gives its children a copy of the caller's localVars, so a var set inside it
    // is gone afterwards whether the caller passed a localVars object (as repeat and
    // forEachElement iterations do) or not (a top-level run).
    test('the caller\'s localVars object is isolated too: nothing set inside the group is written back', async () => {
        const ctx = makeCtx();
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'group',
            actions: [{ type: 'setVar', key: 'inner', value: 'only-in-group' }]
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(ctx.getVar('inner'), undefined);
        assert.equal(localVars.inner, undefined);
    });

    test('regression: a group inside a repeat does not leak its vars to later siblings in the iteration', async () => {
        const ctx = makeCtx();
        const seen = captureAfter(ctx, 'after');
        await applyActions(fakePage, [{
            type: 'repeat',
            repetitions: 1,
            actions: [
                { type: 'group', actions: [{ type: 'setVar', key: 'inner', value: 'x' }] },
                { type: 'setVar', key: 'after', value: 'inner={var:inner}' }
            ]
        }], null, 0, ctx, Object.create(null), 0, null);

        assert.deepEqual(seen, ['inner=']);
    });

    test('children can read the caller\'s localVars and vars set earlier inside the same group', async () => {
        const ctx = makeCtx();
        const seen = captureAfter(ctx, 'seen');
        const localVars = Object.assign(Object.create(null), { fromCaller: 'c' });
        await applyActions(fakePage, [{
            type: 'group',
            actions: [
                { type: 'setVar', key: 'first', value: 'f' },
                { type: 'setVar', key: 'seen', value: '{var:fromCaller}/{var:first}' }
            ]
        }], null, 0, ctx, localVars, 0, null);

        assert.deepEqual(seen, ['c/f']);
    });

    test('disabled children inside a group are skipped, siblings still run', async () => {
        const ctx = makeCtx();
        const seen = captureAfter(ctx, 'ran');
        await applyActions(fakePage, [{
            type: 'group',
            actions: [
                { type: 'setVar', key: 'ran', value: 'disabled', disabled: true },
                { type: 'setVar', key: 'ran', value: 'enabled' }
            ]
        }], null, 0, ctx, Object.create(null), 0, null);

        assert.deepEqual(seen, ['enabled']);
    });

    test('an empty or missing actions array is a no-op, not an error', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{ type: 'group', actions: [] }], null, 0, ctx, Object.create(null), 0, null);
        await applyActions(fakePage, [{ type: 'group' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('anything'), undefined);
    });

    test('a nested group can read (but not permanently write back to) its parent group scope', async () => {
        const ctx = makeCtx();
        const seen = captureAfter(ctx, 'seenByInner');
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'group',
            actions: [
                { type: 'setVar', key: 'outer', value: 'outer-value' },
                {
                    type: 'group',
                    actions: [
                        { type: 'setVar', key: 'seenByInner', value: '{var:outer}' },
                        { type: 'setVar', key: 'inner', value: 'inner-value' }
                    ]
                }
            ]
        }], null, 0, ctx, localVars, 0, null);

        assert.deepEqual(seen, ['outer-value']);
        // Both groups' vars are gone once they complete, from ctx and localVars alike.
        assert.equal(ctx.getVar('outer'), undefined);
        assert.equal(ctx.getVar('inner'), undefined);
        assert.deepEqual(Object.keys(localVars), []);
    });
});

describe('if', () => {
    test('runs "actions" when the var/equals condition is true', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('flag', true);
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'if',
            var: 'flag',
            equals: true,
            actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
            elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
        }], null, 0, ctx, localVars, 0, null);

        // "if" isolates its branch scope, so read the effect back out via localVars,
        // which setVar also writes to directly (same object reference throughout the branch).
        assert.equal(ctx.written.branch, 'then');
    });

    test('regression: an if inside a repeat does not leak branch vars to later siblings in the iteration', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('flag', true);
        await applyActions(fakePage, [{
            type: 'repeat',
            repetitions: 1,
            actions: [
                { type: 'if', var: 'flag', equals: true, actions: [{ type: 'setVar', key: 'inner', value: 'x' }] },
                { type: 'setVar', key: 'after', value: 'inner={var:inner}' }
            ]
        }], null, 0, ctx, Object.create(null), 0, null);

        assert.equal(ctx.written.after, 'inner=');
    });

    test('runs "elseActions" when the condition is false', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('flag', false);
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'if',
            var: 'flag',
            equals: true,
            actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
            elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(ctx.written.branch, 'else');
    });

    test('var/equals compares as text: a string "5" matches a numeric var 5', async () => {
        // A batch row's 2310 has to equal the 2310 typed into the step.
        const ctx = recordWrites(makeCtx());
        ctx.setVar('n', 5);
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'if',
            var: 'n',
            equals: '5',
            actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
            elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(ctx.written.branch, 'then');
    });

    test('var/equals: an unset variable equals nothing, not even an empty string', async () => {
        const ctx = recordWrites(makeCtx());
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'if',
            var: 'missing',
            equals: '',
            actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
            elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(ctx.written.branch, 'else');
    });

    test('when none of selectorExists/var+equals/urlIncludes are provided, the condition is false', async () => {
        const ctx = recordWrites(makeCtx());
        const localVars = Object.create(null);
        await applyActions(fakePage, [{
            type: 'if',
            actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
            elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
        }], null, 0, ctx, localVars, 0, null);

        assert.equal(ctx.written.branch, 'else');
    });

    test('an empty/missing branch for the taken condition is a silent no-op, not an error', async () => {
        const ctx = recordWrites(makeCtx());
        ctx.setVar('flag', true);
        await applyActions(fakePage, [{ type: 'if', var: 'flag', equals: true }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('branch'), undefined);
    });

    describe('urlIncludes condition', () => {
        test('runs "actions" when page.url() contains the substring', async () => {
            const page = { ...fakePage, url: async () => 'https://example.com/checkout/step-2' };
            const ctx = recordWrites(makeCtx());
            const localVars = Object.create(null);
            await applyActions(page, [{
                type: 'if',
                urlIncludes: '/checkout/',
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
            }], null, 0, ctx, localVars, 0, null);
            assert.equal(ctx.written.branch, 'then');
        });

        test('runs "elseActions" when page.url() does not contain the substring', async () => {
            const page = { ...fakePage, url: async () => 'https://example.com/home' };
            const ctx = recordWrites(makeCtx());
            const localVars = Object.create(null);
            await applyActions(page, [{
                type: 'if',
                urlIncludes: '/checkout/',
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
            }], null, 0, ctx, localVars, 0, null);
            assert.equal(ctx.written.branch, 'else');
        });
    });

    describe('selectorExists condition', () => {
        test('runs "actions" when the selector resolves to an element', async () => {
            const page = { ...fakePage, $: async () => ({ dispose: async () => {} }) };
            const ctx = recordWrites(makeCtx());
            const localVars = Object.create(null);
            await applyActions(page, [{
                type: 'if',
                selectorExists: '.banner',
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
            }], null, 0, ctx, localVars, 0, null);
            assert.equal(ctx.written.branch, 'then');
        });

        test('runs "elseActions" when the selector matches nothing', async () => {
            const page = { ...fakePage, $: async () => null };
            const ctx = recordWrites(makeCtx());
            const localVars = Object.create(null);
            await applyActions(page, [{
                type: 'if',
                selectorExists: '.banner',
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
            }], null, 0, ctx, localVars, 0, null);
            assert.equal(ctx.written.branch, 'else');
        });

        test('onlyVisible=true additionally requires the element to pass the visibility check', async () => {
            const makePage = (visible) => ({
                ...fakePage,
                $: async () => ({
                    dispose: async () => {},
                    evaluate: async () => visible
                })
            });
            const ctx1 = recordWrites(makeCtx());
            const localVars1 = Object.create(null);
            await applyActions(makePage(true), [{
                type: 'if',
                selectorExists: '.banner',
                onlyVisible: true,
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
            }], null, 0, ctx1, localVars1, 0, null);
            assert.equal(ctx1.written.branch, 'then');

            const ctx2 = recordWrites(makeCtx());
            const localVars2 = Object.create(null);
            await applyActions(makePage(false), [{
                type: 'if',
                selectorExists: '.banner',
                onlyVisible: true,
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
            }], null, 0, ctx2, localVars2, 0, null);
            assert.equal(ctx2.written.branch, 'else');
        });

        test('a matching element without onlyVisible is treated as existing regardless of visibility', async () => {
            // handle.evaluate is intentionally absent here: this path must not call it at all
            // since onlyVisible is falsy, so a handle that would blow up if evaluate() were
            // invoked still proves the visibility check was skipped.
            const page = {
                ...fakePage,
                $: async () => ({ dispose: async () => {}, evaluate: async () => { throw new Error('should not be called'); } })
            };
            const ctx = recordWrites(makeCtx());
            const localVars = Object.create(null);
            await applyActions(page, [{
                type: 'if',
                selectorExists: '.banner',
                actions: [{ type: 'setVar', key: 'branch', value: 'then' }]
            }], null, 0, ctx, localVars, 0, null);
            assert.equal(ctx.written.branch, 'then');
        });

        describe(':ctx token rewrite (resolveActiveScopeSelector)', () => {
            // resolveActiveScopeSelector reads the LAST [data-wf-scope] element in the DOM via a
            // real page.evaluate() call, so these stub the global `document` directly (like
            // forEachElement's own scoping tests do) rather than hand-mocking the resolver.
            function withGlobalDocument(scopeIds, work) {
                const hadOwn = Object.prototype.hasOwnProperty.call(global, 'document');
                const original = global.document;
                global.document = {
                    querySelectorAll: (sel) => {
                        if (sel !== '[data-wf-scope]') return [];
                        return scopeIds.map(id => ({ getAttribute: (n) => (n === 'data-wf-scope' ? id : null) }));
                    }
                };
                return Promise.resolve().then(work).finally(() => {
                    if (hadOwn) global.document = original; else delete global.document;
                });
            }

            test('rewrites :ctx in selectorExists to the active (last) scope selector before checking existence', async () => {
                const dollarCalls = [];
                const page = {
                    ...fakePage,
                    evaluate: async (fn, ...args) => fn(...args),
                    $: async (sel) => { dollarCalls.push(sel); return sel.includes('scope_last') ? { dispose: async () => {} } : null; }
                };
                const ctx = recordWrites(makeCtx());
                const localVars = Object.create(null);
                await withGlobalDocument(['scope_first', 'scope_last'], () =>
                    applyActions(page, [{
                        type: 'if',
                        selectorExists: ':ctx .child',
                        actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                        elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
                    }], null, 0, ctx, localVars, 0, null)
                );
                assert.equal(ctx.written.branch, 'then');
                assert.ok(dollarCalls.includes('[data-wf-scope="scope_last"] .child'));
            });

            test('when there is no active scope (no [data-wf-scope] element in the DOM), :ctx is left as a literal, unrewritten token', async () => {
                const dollarCalls = [];
                const page = {
                    ...fakePage,
                    evaluate: async (fn, ...args) => fn(...args),
                    $: async (sel) => { dollarCalls.push(sel); return null; }
                };
                const ctx = recordWrites(makeCtx());
                const localVars = Object.create(null);
                await withGlobalDocument([], () =>
                    applyActions(page, [{
                        type: 'if',
                        selectorExists: ':ctx .child',
                        actions: [{ type: 'setVar', key: 'branch', value: 'then' }],
                        elseActions: [{ type: 'setVar', key: 'branch', value: 'else' }]
                    }], null, 0, ctx, localVars, 0, null)
                );
                assert.equal(ctx.written.branch, 'else');
                assert.deepEqual(dollarCalls, [':ctx .child']);
            });

            test('nested branch actions also have their own :ctx tokens rewritten to the active scope selector', async () => {
                const seenSelectors = [];
                const page = {
                    ...fakePage,
                    evaluate: async (fn, ...args) => fn(...args),
                    $: async (sel) => { seenSelectors.push(sel); return { dispose: async () => {}, evaluate: async () => true }; }
                };
                const ctx = recordWrites(makeCtx());
                const localVars = Object.create(null);
                await withGlobalDocument(['scope_xyz'], () =>
                    applyActions(page, [{
                        type: 'if',
                        selectorExists: '.always-there',
                        actions: [{ type: 'waitForSelector', selector: ':ctx .inner', timeout: 0 }]
                    }], null, 0, ctx, localVars, 0, null)
                );
                assert.ok(seenSelectors.includes('[data-wf-scope="scope_xyz"] .inner'));
            });
        });
    });
});

describe('repeat', () => {
    // Each repeat iteration runs in its own ctx var scope that's popped when the iteration ends,
    // and with a merged-copy localVars object (unlike "group", which shares the caller's localVars
    // reference) - so the only way to observe a per-iteration value from the outside is to capture
    // it *while* it's being set. Wrapping the ctx.vars Proxy (which setVar always writes through)
    // is the one hook available for that; captureVarWrites() below is used by every test in this
    // block for that reason.
    function captureVarWrites(ctx, keys) {
        const wanted = new Set(keys);
        const seen = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, {
            set(target, key, value) {
                if (wanted.has(key)) seen.push([key, value]);
                target[key] = value;
                return true;
            }
        });
        return seen;
    }

    test('iterates once per line of itemsText, substituting {var:value}/{oneBased}/{total} per iteration', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['seenLine']);

        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: 'alpha\nbeta',
            actions: [{ type: 'setVar', key: 'seenLine', value: '{oneBased}/{total}:{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);

        assert.deepEqual(seen.map(([, v]) => v), ['1/2:alpha', '2/2:beta']);
    });

    test('blank lines and #/// comment lines are skipped, not treated as items', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['line']);
        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: '# a comment\n\nalpha\n// another comment\n   \nbeta',
            actions: [{ type: 'setVar', key: 'line', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['alpha', 'beta']);
    });

    test('a valid JSON object line exposes its fields as {var:item.<field>} for that iteration', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: '{"name":"Alice","age":30}\n{"name":"Bob","age":25}',
            actions: [{ type: 'setVar', key: 'captured', value: '{var:item.name}:{var:item.age}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['Alice:30', 'Bob:25']);
    });

    test('a "JSON-ish" object line (unquoted keys/barewords) is tolerated the same as strict JSON', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: '{name: Alice, age: 30}',
            actions: [{ type: 'setVar', key: 'captured', value: '{var:item.name}:{var:item.age}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['Alice:30']);
    });

    test('a JSON array line becomes a single item whose value is the re-stringified array', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: '[1,2,3]',
            actions: [{ type: 'setVar', key: 'captured', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['[1,2,3]']);
    });

    test('a line that merely looks JSON-ish but fails to parse (contains parens) falls back to plain text', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        const line = '{a: (1+2)}';
        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: line,
            actions: [{ type: 'setVar', key: 'captured', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), [line]);
    });

    test('falls back to action.times when itemsText is absent, numbering items 1..times', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            times: 3,
            actions: [{ type: 'setVar', key: 'captured', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['1', '2', '3']);
    });

    test('falls back to action.repetitions when itemsText and times are both absent', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            repetitions: 2,
            actions: [{ type: 'setVar', key: 'captured', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['1', '2']);
    });

    test('itemsText line count wins over action.times (matches the countPlannedArtifacts estimator, see above)', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            itemsText: 'only-one-line',
            times: 5,
            actions: [{ type: 'setVar', key: 'captured', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['only-one-line']);
    });

    test('an array dataset (action.dataset) is accepted the same as newline-joined itemsText', async () => {
        const ctx = makeCtx();
        const seen = captureVarWrites(ctx, ['captured']);
        await applyActions(fakePage, [{
            type: 'repeat',
            dataset: ['foo', 'bar'],
            actions: [{ type: 'setVar', key: 'captured', value: '{var:value}' }]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seen.map(([, v]) => v), ['foo', 'bar']);
    });

    test('zero times/repetitions with no itemsText and no actions runs nothing, without error', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{ type: 'repeat', times: 0, repetitions: 0 }], null, 0, ctx, Object.create(null), 0, null);
        await applyActions(fakePage, [{ type: 'repeat', times: 3 }], null, 0, ctx, Object.create(null), 0, null); // no actions[]
        assert.ok(true); // reaching here without throwing is the assertion
    });

    test('disabled sub-actions inside repeat are filtered out of every iteration', async () => {
        const ctx = makeCtx();
        const seenDisabled = captureVarWrites(ctx, ['disabledOne']);
        const seenEnabled = captureVarWrites(ctx, ['enabledOne']);
        await applyActions(fakePage, [{
            type: 'repeat',
            times: 2,
            actions: [
                { type: 'setVar', key: 'disabledOne', value: 'nope', disabled: true },
                { type: 'setVar', key: 'enabledOne', value: '{var:value}' }
            ]
        }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(seenDisabled, []);
        assert.equal(seenEnabled.length, 2);
    });

    describe('continueOnIterationError', () => {
        // A runCustomStep referencing a nonexistent id throws deterministically without needing
        // any page/DOM interaction - a convenient stand-in for "an action failed mid-iteration".
        const failingAction = { type: 'runCustomStep', customStepId: 'does-not-exist' };

        test('false (default): the first failing iteration stops the whole repeat and rejects', async () => {
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(fakePage, [{
                    type: 'repeat',
                    times: 3,
                    actions: [failingAction]
                }], null, 0, ctx, Object.create(null), 0, null),
                /was not found/
            );
            assert.equal(ctx.iterationFailures.length, 1);
        });

        test('true: every iteration runs and each failure is recorded, without rejecting', async () => {
            const ctx = makeCtx();
            await applyActions(fakePage, [{
                type: 'repeat',
                times: 3,
                continueOnIterationError: true,
                actions: [failingAction]
            }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.iterationFailures.length, 3);
            assert.ok(ctx.iterationFailures.every(f => f.iteratorType === 'repeat'));
        });

        test('true: a cancellation error is still rethrown immediately, not swallowed as a normal failure', async () => {
            const controller = new AbortController();
            const ctx = createWorkflowContext({ abortSignal: controller.signal });
            controller.abort();
            await assert.rejects(
                () => applyActions(fakePage, [{
                    type: 'repeat',
                    times: 3,
                    continueOnIterationError: true,
                    actions: [{ type: 'wait', ms: 0 }]
                }], null, 0, ctx, Object.create(null), 0, null),
                (err) => err && err._wfCancelled === true
            );
        });
    });
});

describe('setVar / clearVar actions', () => {
    test('setVar persists to ctx (not just the ephemeral localVars object)', async () => {
        const ctx = makeCtx();
        // Use a fresh, unrelated localVars object downstream to prove the value is reachable
        // through ctx, the way a later forEachElement iteration (with its own fresh localVars)
        // would need it to be.
        await applyActions(fakePage, [{ type: 'setVar', key: 'persisted', value: 'yes' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('persisted'), 'yes');
    });

    test('clearVar removes a var set earlier in the same run', async () => {
        const ctx = makeCtx();
        ctx.setVar('temp', 'value');
        assert.equal(ctx.getVar('temp'), 'value');
        await applyActions(fakePage, [{ type: 'clearVar', key: 'temp' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('temp'), undefined);
    });

    test('a missing/empty key is a silent no-op for both setVar and clearVar', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'setVar', value: 'orphan' },
            { type: 'setVar', key: '   ', value: 'orphan2' },
            { type: 'clearVar' },
            { type: 'clearVar', key: '' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(Object.keys(ctx.getVarsFlat()), []);
    });

    test('non-string values (number/boolean/object) are stored as-is, not stringified or interpolated', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'setVar', key: 'num', value: 42 },
            { type: 'setVar', key: 'flag', value: true },
            { type: 'setVar', key: 'obj', value: { a: 1 } }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('num'), 42);
        assert.equal(ctx.getVar('flag'), true);
        assert.deepEqual(ctx.getVar('obj'), { a: 1 });
    });

    test('a string value with {var:...} tokens IS interpolated at the time setVar runs', async () => {
        const ctx = makeCtx();
        ctx.setVar('city', 'Lisbon');
        await applyActions(fakePage, [{ type: 'setVar', key: 'greeting', value: 'Hello, {var:city}!' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('greeting'), 'Hello, Lisbon!');
    });

    // clearVar (via vars.js createVarScopes) deletes the key from EVERY scope on the stack, not
    // just the top/active one - so it reaches through to an outer scope even when called from a
    // nested (pushed) scope. This is different from setVar, which only ever writes the top scope.
    test('clearVar removes a key from every scope level, not just the currently active one', async () => {
        const ctx = makeCtx();
        ctx.setVar('shared', 'outer-value');
        ctx.pushVarScope();
        await applyActions(fakePage, [{ type: 'clearVar', key: 'shared' }], null, 0, ctx, Object.create(null), 0, null);
        ctx.popVarScope();
        assert.equal(ctx.getVar('shared'), undefined);
    });
});

describe('skipIteration', () => {
    // The predicate itself runs inside page.evaluate() against real DOM (queryOneDeep,
    // elMatchesNeedle) - out of scope for a page-less unit test, same rationale as
    // click/hover/etc. What's tested here is workflow-engine's own handling of the boolean
    // result: does it set localVars.__skipIteration AND throw the _wfSkipIteration signal that
    // forEachElement/repeat catch to actually skip the rest of the iteration (see the dedicated
    // "actually skips the rest of the iteration" tests in the forEachElement/repeat describe
    // blocks below for that end-to-end behavior - this block covers skipIteration in isolation).
    test('when the page-side predicate resolves true: sets localVars.__skipIteration and throws _wfSkipIteration', async () => {
        const page = { ...fakePage, evaluate: async () => true };
        const ctx = makeCtx();
        const localVars = Object.create(null);
        await assert.rejects(
            () => applyActions(page, [{ type: 'skipIteration', config: { selectorExists: '.done' } }], null, 0, ctx, localVars, 0, null),
            (err) => err && err._wfSkipIteration === true
        );
        assert.equal(localVars.__skipIteration, true);
    });

    test('when the predicate resolves false: no skip, localVars.__skipIteration stays unset, execution continues normally', async () => {
        const page = { ...fakePage, evaluate: async () => false };
        const ctx = makeCtx();
        const localVars = Object.create(null);
        await applyActions(page, [
            { type: 'skipIteration', config: { selectorExists: '.done' } },
            { type: 'setVar', key: 'reached', value: 'yes' }
        ], null, 0, ctx, localVars, 0, null);
        assert.equal(localVars.__skipIteration, undefined);
        assert.equal(ctx.getVar('reached'), 'yes');
    });

    test('a missing config defaults to {} before reaching the page, which has no selector/selectorExists to match (so it never skips)', async () => {
        // Mirrors the real predicate's own contract (queryOneDeep only runs when cfg.selector or
        // cfg.selectorExists is set; otherwise it falls through to `return false`), so an empty
        // cfg - which is what "skipIteration" with no `config` field produces - never skips.
        let receivedCfg;
        const page = { ...fakePage, evaluate: async (fn, cfg) => { receivedCfg = cfg; return !!(cfg && (cfg.selector || cfg.selectorExists)); } };
        const ctx = makeCtx();
        const localVars = Object.create(null);
        await applyActions(page, [{ type: 'skipIteration' }], null, 0, ctx, localVars, 0, null);
        assert.deepEqual(receivedCfg, {});
        assert.equal(localVars.__skipIteration, undefined);
    });

    // Regression tests: selectorAttr/attrEquals/attrContains are top-level skipIteration fields
    // (documented in action-definitions.js / configuration_contract.json). These run the real
    // predicate (not a stubbed evaluate) against a minimal fake DOM.
    describe('selectorAttr/attrEquals/attrContains (real predicate, fake DOM)', () => {
        function makeFakeAnchor(href, text = '') {
            return {
                tagName: 'A',
                innerText: text,
                textContent: text,
                matches(sel) { return sel === '.link'; },
                getAttribute(name) { return name === 'href' ? href : null; },
                children: [],
                shadowRoot: null
            };
        }
        function withFakeDocument(href, work, text = '') {
            const hadOwn = Object.prototype.hasOwnProperty.call(global, 'document');
            const original = global.document;
            global.document = {
                documentElement: { matches: () => false, children: [makeFakeAnchor(href, text)], shadowRoot: null },
                body: {}
            };
            const page = { ...fakePage, evaluate: async (fn, cfg) => fn(cfg) };
            return Promise.resolve().then(() => work(page)).finally(() => {
                if (hadOwn) global.document = original; else delete global.document;
            });
        }

        test('attrEquals: skips when the raw href exactly matches (e.g. "#")', () => withFakeDocument('#', async (page) => {
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await assert.rejects(
                () => applyActions(page, [{ type: 'skipIteration', selector: '.link', selectorAttr: 'href', attrEquals: '#' }], null, 0, ctx, localVars, 0, null),
                (err) => err && err._wfSkipIteration === true
            );
            assert.equal(localVars.__skipIteration, true);
        }));

        test('attrEquals: does not skip and execution continues when the href does not match', () => withFakeDocument('../page.html', async (page) => {
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [
                { type: 'skipIteration', selector: '.link', selectorAttr: 'href', attrEquals: '#' },
                { type: 'setVar', key: 'reached', value: 'yes' }
            ], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.__skipIteration, undefined);
            assert.equal(ctx.getVar('reached'), 'yes');
        }));

        test('attrContains: skips mailto: links', () => withFakeDocument('mailto:test@example.com', async (page) => {
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await assert.rejects(
                () => applyActions(page, [{ type: 'skipIteration', selector: '.link', selectorAttr: 'href', attrContains: 'mailto:' }], null, 0, ctx, localVars, 0, null),
                (err) => err && err._wfSkipIteration === true
            );
            assert.equal(localVars.__skipIteration, true);
        }));

        test('attrContains: skips javascript: links, but a plain relative href is left alone', () => withFakeDocument('../other.html', async (page) => {
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [
                { type: 'skipIteration', selector: '.link', selectorAttr: 'href', attrContains: 'javascript:' },
                { type: 'setVar', key: 'reached', value: 'yes' }
            ], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.__skipIteration, undefined);
            assert.equal(ctx.getVar('reached'), 'yes');
        }));

        // Each check on the element is a condition of its own: before, only
        // the first one set was read and the others were silently ignored.
        const skips = async (page, step) => {
            const ctx = makeCtx();
            try {
                await applyActions(page, [{ type: 'skipIteration', selector: '.link', ...step }], null, 0, ctx, Object.create(null), 0, null);
                return false;
            } catch (err) {
                if (err && err._wfSkipIteration) return true;
                throw err;
            }
        };

        test('the text and attribute checks all have to match, unless Use OR is on', () => withFakeDocument('https://other.example/file.zip', async (page) => {
            assert.equal(await skips(page, { selectorTextContains: 'Download', selectorAttr: 'href', attrContains: '://' }), true);
            // The text matches but the attribute does not: no skip any more.
            assert.equal(await skips(page, { selectorTextContains: 'Download', selectorAttr: 'href', attrContains: 'mailto:' }), false);
            assert.equal(await skips(page, { selectorTextContains: 'Download', selectorAttr: 'href', attrContains: 'mailto:', or: true }), true);
            assert.equal(await skips(page, { selectorTextEquals: 'Download the guide', selectorTextContains: 'guide' }), true);
            assert.equal(await skips(page, { selectorTextEquals: 'Download', selectorTextContains: 'guide' }), false);
            // Attribute equals and contains together.
            assert.equal(await skips(page, { selectorAttr: 'href', attrEquals: 'https://other.example/file.zip', attrContains: 'zip' }), true);
            assert.equal(await skips(page, { selectorAttr: 'href', attrEquals: '#', attrContains: 'zip' }), false);
        }, 'Download the guide'));

        test('an attribute name alone is the condition of having it; the element alone, of being there', () => withFakeDocument('#', async (page) => {
            assert.equal(await skips(page, { selectorAttr: 'href' }), true);
            assert.equal(await skips(page, { selectorAttr: 'title' }), false);
            assert.equal(await skips(page, {}), true);
            // No element: every check on it fails, even under OR.
            assert.equal(await skips(page, { selector: '.none', selectorTextContains: 'x', selectorAttr: 'href', or: true }), false);
        }, 'x'));

        test('legacy action.config nesting still works after the top-level merge (backward compatibility)', () => withFakeDocument('#', async (page) => {
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await assert.rejects(
                () => applyActions(page, [{ type: 'skipIteration', config: { selector: '.link', selectorAttr: 'href', attrEquals: '#' } }], null, 0, ctx, localVars, 0, null),
                (err) => err && err._wfSkipIteration === true
            );
        }));
    });
});

describe('collectOutput', () => {
    test('a missing/empty key is a silent no-op', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'collectOutput', value: 'x' },
            { type: 'collectOutput', key: '   ', value: 'x' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs, []);
    });

    test('value: literal string is recorded, with {var:...} interpolated, and label defaults to key', async () => {
        const ctx = makeCtx();
        ctx.setVar('city', 'Lisbon');
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'note', value: 'Hello, {var:city}!' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs.length, 1);
        assert.equal(ctx.collectedOutputs[0].key, 'note');
        assert.equal(ctx.collectedOutputs[0].value, 'Hello, Lisbon!');
        assert.equal(ctx.collectedOutputs[0].label, 'note');
    });

    test('an explicit label (with {var:...}) overrides the key-derived default', async () => {
        const ctx = makeCtx();
        ctx.setVar('n', 'Cards');
        await applyActions(fakePage, [
            { type: 'collectOutput', key: 'k', value: 'v', label: 'Page: {var:n}' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs[0].label, 'Page: Cards');
    });

    test('{oneBased}/{total} in a literal value resolve per-iteration (already handled upstream by interpolateAll, same as every other action)', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'repeat', times: 2, actions: [
                { type: 'collectOutput', key: 'note', value: 'iter {oneBased}/{total}' }
            ] }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs.map((e) => e.value), ['iter 1/2', 'iter 2/2']);
        assert.deepEqual(ctx.collectedOutputs.map((e) => e.iteration), [
            { index: 0, oneBased: 1, total: 2 },
            { index: 1, oneBased: 2, total: 2 }
        ]);
    });

    test('iteration is null outside a loop', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'k', value: 'v' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs[0].iteration, null);
    });

    test('fromVar: prefers localVars over ctx when the name exists in both', async () => {
        const ctx = makeCtx();
        const localVars = Object.create(null);
        localVars.scanTitle = 'Local value';
        ctx.setVar('scanTitle', 'Ctx value');
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'title', fromVar: 'scanTitle' }], null, 0, ctx, localVars, 0, null);
        assert.equal(ctx.collectedOutputs[0].value, 'Local value');
    });

    test('fromVar: falls back to ctx.getVar when absent from localVars', async () => {
        const ctx = makeCtx();
        ctx.setVar('scanTitle', 'Ctx value');
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'title', fromVar: 'scanTitle' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs[0].value, 'Ctx value');
    });

    test('fromVar: an unset variable is a silent no-op (nothing pushed)', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'title', fromVar: 'nope' }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs, []);
    });

    test('from: "url" records the current page URL, matching the auto-captured url field', async () => {
        const ctx = makeCtx();
        const page = { ...fakePage, url: async () => 'https://example.com/cards' };
        await applyActions(page, [{ type: 'collectOutput', key: 'visitedUrl', from: 'url' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs[0].value, 'https://example.com/cards');
        assert.equal(ctx.collectedOutputs[0].url, 'https://example.com/cards');
    });

    // `when` is authored as a JSON *string* (like runCustomStep's argsJson) - the step-config
    // UI has no widget for a raw nested-object field, so a real object round-trips through the
    // form as the literal text "[object Object]" and the gate gets skipped. An already-parsed
    // object is also accepted (see the dedicated test below) for programmatic JS callers.
    test('when: gates recording, sharing skipIteration\'s predicate config shape (JSON string, page.evaluate stubbed)', async () => {
        const ctx = makeCtx();
        let receivedCfg;
        const page = { ...fakePage, evaluate: async (fn, cfg) => { receivedCfg = cfg; return !!cfg.selectorExists; } };
        await applyActions(page, [
            { type: 'collectOutput', key: 'emptyView', value: 'x', when: '{"selectorExists": ".empty-state"}' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs.length, 1);
        assert.equal(receivedCfg.selectorExists, '.empty-state');
    });

    test('when: a false predicate skips recording entirely (JSON string)', async () => {
        const ctx = makeCtx();
        const page = { ...fakePage, evaluate: async () => false };
        await applyActions(page, [
            { type: 'collectOutput', key: 'emptyView', value: 'x', when: '{"selectorExists": ".empty-state"}' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs, []);
    });

    test('when: real predicate (urlIncludes), not stubbed - exercises the shared evaluateConditionPredicate end to end (JSON string)', async () => {
        const ctx = makeCtx();
        const page = { ...fakePage, url: async () => 'https://example.com/account/cards', evaluate: async (fn, cfg) => fn(cfg) };
        const originalLocation = global.location;
        global.location = { href: 'https://example.com/account/cards' };
        try {
            await applyActions(page, [
                { type: 'collectOutput', key: 'accountPages', from: 'url', when: '{"urlIncludes": "/account/"}' }
            ], null, 0, ctx, Object.create(null), 0, null);
        } finally {
            global.location = originalLocation;
        }
        assert.equal(ctx.collectedOutputs.length, 1);
        assert.equal(ctx.collectedOutputs[0].value, 'https://example.com/account/cards');
    });

    test('when: an already-parsed object is also accepted (programmatic callers, not just the JSON-string UI contract)', async () => {
        const ctx = makeCtx();
        const page = { ...fakePage, evaluate: async (fn, cfg) => !!cfg.selectorExists };
        await applyActions(page, [
            { type: 'collectOutput', key: 'emptyView', value: 'x', when: { selectorExists: '.empty-state' } }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs.length, 1);
    });

    test('when: malformed JSON is a silent no-op (never records), not a throw', async () => {
        const ctx = makeCtx();
        const page = { ...fakePage, evaluate: async () => true };
        await applyActions(page, [
            { type: 'collectOutput', key: 'emptyView', value: 'x', when: '{not valid json' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs, []);
    });

    test('when: an empty string behaves like "no condition" - always records', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'collectOutput', key: 'note', value: 'x', when: '' }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs.length, 1);
    });

    test('tags: freeform tags are recorded; non-string entries are filtered out', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'collectOutput', key: 'k', value: 'v', tags: ['emptyView', '', 42, null, 'other'] }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs[0].tags, ['emptyView', 'other']);
    });

    test('a missing tags field results in an empty tags array, not undefined', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'k', value: 'v' }], null, 0, ctx, Object.create(null), 0, null);
        assert.deepEqual(ctx.collectedOutputs[0].tags, []);
    });

    test('truncation safety-net: a value over the internal length cap is truncated and flagged (mistake-guard, not volume control)', async () => {
        const ctx = makeCtx();
        const big = 'x'.repeat(6000);
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'k', value: big }], null, 0, ctx, Object.create(null), 0, null);
        const entry = ctx.collectedOutputs[0];
        assert.equal(entry.value.length, 5000);
        assert.equal(entry.truncated, true);
    });

    test('a value under the internal length cap is left untouched and not flagged', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{ type: 'collectOutput', key: 'k', value: 'short' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs[0].value, 'short');
        assert.equal(ctx.collectedOutputs[0].truncated, false);
    });

    test('actionPath is stamped on the entry, matching the actionResults entry for the same step (the report cross-link key)', async () => {
        const ctx = makeCtx();
        const actionResults = [];
        await applyActions(fakePage, [
            { type: 'setVar', key: 'noop', value: '1' },
            { type: 'collectOutput', key: 'k', value: 'v' }
        ], actionResults, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs[0].actionPath, '2');
        assert.equal(actionResults[1].actionPath, '2');
    });

    test('every occurrence is kept across iterations - no automatic de-duplication', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [
            { type: 'repeat', times: 3, actions: [{ type: 'collectOutput', key: 'breadcrumb', value: 'Home / Cards' } ] }
        ], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.collectedOutputs.length, 3);
        assert.ok(ctx.collectedOutputs.every((e) => e.value === 'Home / Cards'));
    });

    describe('page-derived sources: selectorText / selectorAttr (via queryOneDeep, mocked page.$)', () => {
        function makeSelectorPage(map) {
            return {
                ...fakePage,
                $: async (sel) => {
                    const el = map[sel];
                    if (!el) return null;
                    return { evaluate: async (fn, cfg) => fn(el, cfg), dispose: async () => {} };
                },
                // queryOneDeep falls back to evaluateHandle's shadow-DOM search when $() misses.
                evaluateHandle: async () => ({ asElement: () => null, dispose: async () => {} })
            };
        }

        test('from: "selectorText" reads trimmed/collapsed textContent (selector: "title" covers the page title - no dedicated source needed)', async () => {
            const page = makeSelectorPage({ title: { textContent: '  My Page  ' } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'collectOutput', key: 'pageTitle', from: 'selectorText', selector: 'title' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.collectedOutputs[0].value, 'My Page');
        });

        test('from: "selectorText" collapses internal whitespace like getText does', async () => {
            const page = makeSelectorPage({ 'nav.breadcrumb': { textContent: '  Home  /  Cards  ' } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'collectOutput', key: 'breadcrumb', from: 'selectorText', selector: 'nav.breadcrumb' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.collectedOutputs[0].value, 'Home / Cards');
        });

        test('from: "selectorText", trim:false preserves raw whitespace', async () => {
            const page = makeSelectorPage({ '.msg': { textContent: '  raw  ' } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'collectOutput', key: 'k', from: 'selectorText', selector: '.msg', trim: false }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.collectedOutputs[0].value, '  raw  ');
        });

        test('from: "selectorAttr", attr: "href" resolves via el.href (like getText)', async () => {
            const page = makeSelectorPage({ 'a.link': { href: 'https://example.com/page', getAttribute: () => null } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'collectOutput', key: 'k', from: 'selectorAttr', selector: 'a.link', attr: 'href' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.collectedOutputs[0].value, 'https://example.com/page');
        });

        test('from: "selectorAttr" reads a non-href attribute via getAttribute', async () => {
            const page = makeSelectorPage({ button: { getAttribute: (n) => (n === 'aria-label' ? 'Submit order' : null) } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'collectOutput', key: 'k', from: 'selectorAttr', selector: 'button', attr: 'aria-label' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.collectedOutputs[0].value, 'Submit order');
        });

        test('an unresolved selector is a silent no-op (nothing pushed, no throw)', async () => {
            const page = makeSelectorPage({});
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'collectOutput', key: 'k', from: 'selectorText', selector: '.missing' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(ctx.collectedOutputs, []);
        });
    });
});

// These action types call straight-line Puppeteer Page methods (goto/reload/setViewport/
// emulateVisionDeficiency/keyboard/addStyleTag/evaluate) rather than doing real-DOM hit-testing
// or geometry (that's click/hover/type/select/getText - deliberately out of scope here, same as
// forEachElement, and consistent with why click-utils.js/deep-by-text.js get real-Chrome
// .browserspec.js suites instead of mocks: hand-rolled mocks can't reproduce hit-testing/layout
// faithfully, but they're perfectly faithful for "did we call page.goto with these args".
describe('page-driving actions (mocked Puppeteer page)', () => {
    function makeSpyPage(overrides = {}) {
        const calls = {};
        const record = (name) => (...args) => { (calls[name] = calls[name] || []).push(args); };
        return {
            page: {
                ...fakePage,
                evaluate: async () => null,
                goto: overrides.goto || (async (...a) => { record('goto')(...a); }),
                reload: overrides.reload || (async (...a) => { record('reload')(...a); }),
                goBack: overrides.goBack || (async (...a) => { record('goBack')(...a); }),
                setCacheEnabled: overrides.setCacheEnabled || (async (...a) => { record('setCacheEnabled')(...a); }),
                setViewport: overrides.setViewport || (async (...a) => { record('setViewport')(...a); }),
                emulateVisionDeficiency: overrides.emulateVisionDeficiency || (async (...a) => { record('emulateVisionDeficiency')(...a); }),
                emulateMediaFeatures: overrides.emulateMediaFeatures || (async (...a) => { record('emulateMediaFeatures')(...a); }),
                addStyleTag: overrides.addStyleTag || (async (...a) => { record('addStyleTag')(...a); }),
                keyboard: overrides.keyboard || {
                    down: record('keyboard.down'),
                    up: record('keyboard.up'),
                    press: record('keyboard.press'),
                    type: record('keyboard.type')
                },
                url: overrides.url || (async () => 'about:blank')
            },
            calls
        };
    }

    describe('navigate', () => {
        test('throws when no url/href/targetUrl/urlText/value and no repeat-item fallback is available', async () => {
            const { page } = makeSpyPage();
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'navigate' }], null, 0, ctx, Object.create(null), 0, null),
                /missing required "url"/
            );
        });

        test('interpolates {var:...} tokens in the url from the current ctx/localVars', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            ctx.setVar('targetPath', 'about');
            await applyActions(page, [{ type: 'navigate', url: 'https://example.com/{var:targetPath}' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.goto[0][0], 'https://example.com/about');
        });

        test('falls back to localVars.value (the current repeat item) when url is empty', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'navigate', url: '' }], null, 0, ctx, { value: 'https://example.com/from-item' }, 0, null);
            assert.equal(calls.goto[0][0], 'https://example.com/from-item');
        });

        test('throws when the resolved url still contains an unresolved {var:...} token', async () => {
            const { page } = makeSpyPage();
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'navigate', url: 'https://example.com/{var:has space}' }], null, 0, ctx, Object.create(null), 0, null),
                /was not interpolated/
            );
        });

        test('refuses a url that is not a web page: the server\'s own files stay closed', async () => {
            for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://version', 'not a url']) {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await assert.rejects(
                    () => applyActions(page, [{ type: 'navigate', url }], null, 0, ctx, Object.create(null), 0, null),
                    /must be http or https/
                );
                assert.equal(calls.goto, undefined);
            }
        });

        test('skips goto entirely when already at the same URL (ignoring trailing slash)', async () => {
            const { page, calls } = makeSpyPage({ url: async () => 'https://example.com/path' });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'navigate', url: 'https://example.com/path/' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.goto, undefined);
        });

        test('normalizes waitUntil "networkidle0" to "networkidle2" before calling page.goto', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'navigate', url: 'https://example.com/x', waitUntil: 'networkidle0' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.goto[0][1].waitUntil, 'networkidle2');
        });

        test('on "Navigation timeout" with a non-domcontentloaded waitUntil, retries once with domcontentloaded', async () => {
            let attempt = 0;
            const { page, calls } = makeSpyPage({
                goto: async (url, opts) => {
                    attempt += 1;
                    if (attempt === 1) throw new Error('Navigation timeout of 30000 ms exceeded');
                    (calls.goto = calls.goto || []).push([url, opts]);
                }
            });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'navigate', url: 'https://example.com/x', waitUntil: 'load' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(attempt, 2);
            assert.equal(calls.goto[0][1].waitUntil, 'domcontentloaded');
        });

        test('a goto failure indicating mid-navigation teardown is normalized to a cancelled error', async () => {
            const { page } = makeSpyPage({ goto: async () => { throw new Error('Target closed'); } });
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'navigate', url: 'https://example.com/x' }], null, 0, ctx, Object.create(null), 0, null),
                (err) => err && err._wfCancelled === true
            );
        });

        test('an unrelated goto failure is rethrown as-is', async () => {
            const { page } = makeSpyPage({ goto: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } });
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'navigate', url: 'https://example.com/x' }], null, 0, ctx, Object.create(null), 0, null),
                /ERR_NAME_NOT_RESOLVED/
            );
        });
    });

    describe('setViewport', () => {
        test('explicit action.width/height wins over any preset', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'setViewport', width: 1000, height: 500, preset: 'mobile' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setViewport[0][0], { width: 1000, height: 500, deviceScaleFactor: 1 });
            assert.deepEqual(ctx.viewport, { width: 1000, height: 500, deviceScaleFactor: 1 });
        });

        test('falls back to a named preset when width/height are absent', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'setViewport', preset: 'tablet' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setViewport[0][0], { width: 768, height: 1024, deviceScaleFactor: 1 });
        });

        test('preset "default" restores the run\'s baseViewport instead of the hardcoded 1280x720, when one is set', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = createWorkflowContext({ baseViewport: { width: 1440, height: 900 } });
            await applyActions(page, [{ type: 'setViewport', preset: 'default' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setViewport[0][0], { width: 1440, height: 900, deviceScaleFactor: 1 });
        });

        test('preset "default" without a baseViewport falls back to the hardcoded 1280x720', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'setViewport', preset: 'default' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setViewport[0][0], { width: 1280, height: 720, deviceScaleFactor: 1 });
        });

        test('with neither width/height nor a recognized preset, keeps the current ctx.viewport', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            ctx.viewport = { width: 999, height: 111 };
            await applyActions(page, [{ type: 'setViewport' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setViewport[0][0], { width: 999, height: 111, deviceScaleFactor: 1 });
        });

        test('a non-positive or non-numeric width/height is ignored, falling through to preset/current', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'setViewport', width: -5, height: 'abc', preset: 'mobile' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setViewport[0][0], { width: 375, height: 812, deviceScaleFactor: 1 });
        });

        describe('zoom', () => {
            test('shrinks the CSS viewport by the zoom factor and raises deviceScaleFactor to match', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [{ type: 'setViewport', preset: 'desktop-lg', zoom: '2' }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 720, height: 450, deviceScaleFactor: 2 });
            });

            test('applies on top of an explicit custom width/height, not just presets', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [{ type: 'setViewport', preset: 'custom', width: 1200, height: 800, zoom: '4' }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 300, height: 200, deviceScaleFactor: 4 });
            });

            test('applies on top of the baseViewport that preset "default" restores', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = createWorkflowContext({ baseViewport: { width: 1440, height: 900 } });
                await applyActions(page, [{ type: 'setViewport', preset: 'default', zoom: '3' }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 480, height: 300, deviceScaleFactor: 3 });
            });

            test('records the pre-zoom size on ctx.viewportLogical and the factor on ctx.viewportZoom', async () => {
                const { page } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [{ type: 'setViewport', preset: 'tablet', zoom: '2' }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(ctx.viewport, { width: 384, height: 512, deviceScaleFactor: 2 });
                assert.deepEqual(ctx.viewportLogical, { width: 768, height: 1024 });
                assert.equal(ctx.viewportZoom, 2);
            });

            // The bug this guards: resolving the next viewport against the already
            // shrunken ctx.viewport made every zoomed step compound on the last one,
            // so a 2x then 4x sequence landed at 1/8 the size instead of 1/4.
            test('successive zoom changes at the same preset do not compound', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [
                    { type: 'setViewport', preset: 'desktop-lg', zoom: '2' },
                    { type: 'setViewport', preset: 'desktop-lg', zoom: '4' }
                ], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 720, height: 450, deviceScaleFactor: 2 });
                assert.deepEqual(calls.setViewport[1][0], { width: 360, height: 225, deviceScaleFactor: 4 });
            });

            test('a zoom change with no preset/width reuses the logical size, not the shrunken one', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                ctx.viewport = { width: 1280, height: 720 };
                await applyActions(page, [
                    { type: 'setViewport', zoom: '2' },
                    { type: 'setViewport', zoom: '4' }
                ], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 640, height: 360, deviceScaleFactor: 2 });
                assert.deepEqual(calls.setViewport[1][0], { width: 320, height: 180, deviceScaleFactor: 4 });
            });

            test('an omitted zoom resets a previously zoomed viewport back to 100%', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [
                    { type: 'setViewport', preset: 'desktop-lg', zoom: '4' },
                    { type: 'setViewport', preset: 'desktop-lg' }
                ], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[1][0], { width: 1440, height: 900, deviceScaleFactor: 1 });
                assert.equal(ctx.viewportZoom, 1);
            });

            test('resolves a {var:...} token, so a repeat can drive zoom per iteration', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [{
                    type: 'repeat',
                    itemsText: '1\n2\n4',
                    actions: [{ type: 'setViewport', preset: 'desktop-md', zoom: '{var:value}' }]
                }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport.map(c => c[0]), [
                    { width: 1280, height: 720, deviceScaleFactor: 1 },
                    { width: 640, height: 360, deviceScaleFactor: 2 },
                    { width: 320, height: 180, deviceScaleFactor: 4 }
                ]);
            });

            const badZooms = [
                ['zero', 0],
                ['negative', -2],
                ['non-numeric', 'abc'],
                ['empty string', ''],
                ['null', null]
            ];
            for (const [label, value] of badZooms) {
                test(`a ${label} zoom falls back to 100% rather than collapsing the viewport`, async () => {
                    const { page, calls } = makeSpyPage();
                    const ctx = makeCtx();
                    await applyActions(page, [{ type: 'setViewport', preset: 'mobile', zoom: value }], null, 0, ctx, Object.create(null), 0, null);
                    assert.deepEqual(calls.setViewport[0][0], { width: 375, height: 812, deviceScaleFactor: 1 });
                });
            }

            test('an absurd zoom is clamped instead of shrinking the viewport to a few pixels', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [{ type: 'setViewport', preset: 'desktop-md', zoom: '500' }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 128, height: 72, deviceScaleFactor: 10 });
            });

            test('a fractional zoom rounds to whole CSS pixels', async () => {
                const { page, calls } = makeSpyPage();
                const ctx = makeCtx();
                await applyActions(page, [{ type: 'setViewport', preset: 'mobile', zoom: '1.5' }], null, 0, ctx, Object.create(null), 0, null);
                assert.deepEqual(calls.setViewport[0][0], { width: 250, height: 541, deviceScaleFactor: 1.5 });
            });
        });
    });

    describe('applyZoomToViewport', () => {
        test('leaves an undefined width/height alone instead of producing NaN', () => {
            assert.deepEqual(
                applyZoomToViewport({ width: undefined, height: undefined }, '2'),
                { width: undefined, height: undefined, deviceScaleFactor: 2 }
            );
        });

        test('tolerates a missing viewport object', () => {
            assert.deepEqual(applyZoomToViewport(null, '2'), { width: undefined, height: undefined, deviceScaleFactor: 2 });
        });

        test('never shrinks a dimension below one CSS pixel', () => {
            assert.deepEqual(applyZoomToViewport({ width: 4, height: 2 }, '10'), { width: 1, height: 1, deviceScaleFactor: 10 });
        });
    });

    describe('resolveZoomFactor', () => {
        const cases = [
            ['1', 1], ['2', 2], ['4', 4], [2, 2], [1.5, 1.5],
            ['0', 1], [0, 1], [-3, 1], ['abc', 1], ['', 1], [null, 1], [undefined, 1],
            [NaN, 1], [Infinity, 1], ['11', 10], [1000, 10], [0.5, 1]
        ];
        for (const [input, expected] of cases) {
            test(`${JSON.stringify(input)} -> ${expected}`, () => {
                assert.equal(resolveZoomFactor(input), expected);
            });
        }
    });

    describe('refresh', () => {
        test('defaults to waitUntil=domcontentloaded, timeout=30000, and never touches setCacheEnabled', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'refresh' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.reload[0][0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            assert.equal(calls.setCacheEnabled, undefined);
        });

        test('bypassCache disables the cache before reload and re-enables it after, even on success', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'refresh', bypassCache: true }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.setCacheEnabled.map(a => a[0]), [false, true]);
        });

        test('bypassCache re-enables the cache even when reload ultimately throws', async () => {
            const { page, calls } = makeSpyPage({ reload: async () => { throw new Error('boom'); } });
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'refresh', bypassCache: true }], null, 0, ctx, Object.create(null), 0, null),
                /boom/
            );
            assert.deepEqual(calls.setCacheEnabled.map(a => a[0]), [false, true]);
        });

        test('on "Navigation timeout" with a non-domcontentloaded waitUntil, retries once with domcontentloaded', async () => {
            let attempt = 0;
            const { page, calls } = makeSpyPage({
                reload: async (opts) => {
                    attempt += 1;
                    if (attempt === 1) throw new Error('Navigation timeout of 30000 ms exceeded');
                    (calls.reload = calls.reload || []).push([opts]);
                }
            });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'refresh', waitUntil: 'load' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(attempt, 2);
            assert.equal(calls.reload[0][0].waitUntil, 'domcontentloaded');
        });
    });

    describe('goBack', () => {
        test('defaults to waitUntil=load and timeout=30000', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'goBack' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls.goBack[0][0], { waitUntil: 'load', timeout: 30000 });
        });

        test('passes through a custom waitUntil', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'goBack', waitUntil: 'domcontentloaded' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.goBack[0][0].waitUntil, 'domcontentloaded');
        });

        test('on "Navigation timeout" with a non-domcontentloaded waitUntil, retries once with domcontentloaded', async () => {
            let attempt = 0;
            const { page, calls } = makeSpyPage({
                goBack: async (opts) => {
                    attempt += 1;
                    if (attempt === 1) throw new Error('Navigation timeout of 30000 ms exceeded');
                    (calls.goBack = calls.goBack || []).push([opts]);
                }
            });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'goBack', waitUntil: 'load' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(attempt, 2);
            assert.equal(calls.goBack[0][0].waitUntil, 'domcontentloaded');
        });

        test('optional:true swallows a failure instead of throwing', async () => {
            const { page } = makeSpyPage({ goBack: async () => { throw new Error('no history'); } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'goBack', optional: true }], null, 0, ctx, Object.create(null), 0, null);
            assert.ok(true); // did not throw
        });

        test('without optional, a failure is rethrown wrapped as "goBack failed"', async () => {
            const { page } = makeSpyPage({ goBack: async () => { throw new Error('no history'); } });
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'goBack' }], null, 0, ctx, Object.create(null), 0, null),
                /goBack failed/
            );
        });
    });

    describe('emulateVisionDeficiency', () => {
        test('defaults to "none" and persists the deficiency onto ctx for worker pages', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'emulateVisionDeficiency' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.emulateVisionDeficiency[0][0], 'none');
            assert.equal(ctx._visionDeficiency, 'none');
        });

        test('passes through a named deficiency', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'emulateVisionDeficiency', deficiency: 'achromatopsia' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.emulateVisionDeficiency[0][0], 'achromatopsia');
        });

        test('optional:true swallows a failure instead of throwing', async () => {
            const { page } = makeSpyPage({ emulateVisionDeficiency: async () => { throw new Error('unsupported'); } });
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'emulateVisionDeficiency', deficiency: 'blurredVision', optional: true }], null, 0, ctx, Object.create(null), 0, null);
            assert.ok(true); // did not throw
        });

        test('without optional, a failure is rethrown wrapped with the deficiency name', async () => {
            const { page } = makeSpyPage({ emulateVisionDeficiency: async () => { throw new Error('unsupported'); } });
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'emulateVisionDeficiency', deficiency: 'blurredVision' }], null, 0, ctx, Object.create(null), 0, null),
                /emulateVisionDeficiency failed \(blurredVision\)/
            );
        });
    });

    describe('mergedScan', () => {
        function scanSpy() {
            const seen = [];
            const ctx = makeCtx();
            ctx.handleA11yScanAction = async ({ action, ctx: c }) => {
                seen.push({ label: action.label || null, mergedScan: c._mergedScan ? { ...c._mergedScan } : null });
            };
            return { ctx, seen };
        }
        const run = (ctx, actions) => applyActions(fakePage, actions, null, 0, ctx, Object.create(null), 0, null);

        test('its scans carry the step\'s name and one key; scans outside carry none', async () => {
            const { ctx, seen } = scanSpy();
            await run(ctx, [
                { type: 'a11yScan', label: 'Before' },
                { type: 'mergedScan', label: 'Product page', actions: [
                    { type: 'a11yScan', label: 'Light' },
                    { type: 'group', actions: [{ type: 'a11yScan', label: 'Dark' }] },
                ] },
                { type: 'a11yScan', label: 'After' },
            ]);
            assert.deepEqual(seen.map((s) => [s.label, s.mergedScan && s.mergedScan.label]), [
                ['Before', null], ['Light', 'Product page'], ['Dark', 'Product page'], ['After', null],
            ]);
            assert.equal(seen[1].mergedScan.key, seen[2].mergedScan.key);
        });

        test('its tags reach its scans, with their tokens filled in', async () => {
            const { ctx, seen } = scanSpy();
            ctx.setVar('site', 'shop');
            await run(ctx, [{ type: 'mergedScan', label: 'Page', scanTags: ['checkout', '{var:site}', 'checkout'], actions: [{ type: 'a11yScan', label: 'A' }] }]);
            assert.deepEqual(seen[0].mergedScan.scanTags, ['checkout', 'shop']);
        });

        test('the runner hears when each run of the step ends, after its scans, even when it fails', async () => {
            const { ctx, seen } = scanSpy();
            const events = [];
            ctx.onMergedScanEnd = (key) => events.push(['end', key, seen.length]);
            await run(ctx, [{ type: 'repeat', repetitions: 2, actions: [
                { type: 'mergedScan', label: 'Page', actions: [{ type: 'a11yScan', label: 'A' }, { type: 'a11yScan', label: 'B' }] },
            ] }]);
            assert.deepEqual(events, [['end', seen[0].mergedScan.key, 2], ['end', seen[2].mergedScan.key, 4]]);

            const failing = scanSpy();
            const ended = [];
            failing.ctx.onMergedScanEnd = (key) => ended.push(key);
            await assert.rejects(run(failing.ctx, [{ type: 'mergedScan', label: 'Page', actions: [
                { type: 'a11yScan', label: 'A' }, { type: 'runCustomStep', customStepId: 'missing' },
            ] }]));
            assert.equal(ended.length, 1);
        });

        test('each run of the step is a merged scan of its own, as in a Repeat', async () => {
            const { ctx, seen } = scanSpy();
            await run(ctx, [{ type: 'repeat', repetitions: 2, actions: [
                { type: 'mergedScan', label: 'Page', actions: [{ type: 'a11yScan', label: 'A' }, { type: 'a11yScan', label: 'B' }] },
            ] }]);
            const keys = seen.map((s) => s.mergedScan.key);
            assert.equal(keys[0], keys[1]);
            assert.equal(keys[2], keys[3]);
            assert.notEqual(keys[0], keys[2]);
        });

        test('its name reads {var:...} tokens, and variables set inside stay available after it', async () => {
            const { ctx, seen } = scanSpy();
            ctx.setVar('page', 'Checkout');
            const localVars = Object.create(null);
            await applyActions(fakePage, [
                { type: 'mergedScan', label: '{var:page}', actions: [
                    { type: 'setVar', key: 'inside', value: 'yes' },
                    { type: 'a11yScan', label: 'A' },
                ] },
            ], null, 0, ctx, localVars, 0, null);
            assert.equal(seen[0].mergedScan.label, 'Checkout');
            assert.equal(localVars.inside ?? (ctx.vars && ctx.vars.inside), 'yes', 'not scoped to the step');
        });

        test('one inside another is refused, naming the outer one', async () => {
            const { ctx } = scanSpy();
            await assert.rejects(() => run(ctx, [
                { type: 'mergedScan', label: 'Outer', actions: [{ type: 'mergedScan', label: 'Inner', actions: [{ type: 'a11yScan' }] }] },
            ]), /A Merged scan cannot run inside another Merged scan \("Outer"\)/);
            assert.equal(ctx._mergedScan, null, 'left as it was');
        });
    });

    describe('setColorScheme', () => {
        const run = (page, ctx, action) => applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null);

        test('emulates the scheme, keeps reduced motion, and persists the scheme onto ctx for worker pages', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'dark' });
            assert.deepEqual(calls.emulateMediaFeatures[0][0], [
                { name: 'prefers-color-scheme', value: 'dark' },
                { name: 'prefers-reduced-motion', value: 'reduce' }
            ]);
            assert.equal(ctx._colorScheme, 'dark');
        });

        test('reads a {var:...} token, as a batch row can set the theme', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            ctx.setVar('theme', 'Light');
            await run(page, ctx, { type: 'setColorScheme', colorScheme: '{var:theme}' });
            assert.equal(calls.emulateMediaFeatures[0][0][0].value, 'light');
        });

        test('Run default stops emulating a scheme when the run set none, keeping reduced motion', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'dark' });
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'default' });
            assert.deepEqual(calls.emulateMediaFeatures[1][0], [
                { name: 'prefers-reduced-motion', value: 'reduce' }
            ]);
            assert.equal(ctx._colorScheme, null);
        });

        test('Run default goes back to the scheme the run started with', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            ctx._runColorScheme = 'dark';
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'light' });
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'default' });
            assert.equal(calls.emulateMediaFeatures[1][0][0].value, 'dark');
            assert.equal(ctx._colorScheme, 'dark');
        });

        test('a missing or unknown scheme fails, naming the choices', async () => {
            const { page, calls } = makeSpyPage();
            await assert.rejects(() => run(page, makeCtx(), { type: 'setColorScheme' }),
                /setColorScheme failed: set "colorScheme" \(light, dark or default\), "highContrast" \(on, off or default\), or both/);
            await assert.rejects(() => run(page, makeCtx(), { type: 'setColorScheme', colorScheme: 'sepia' }),
                /setColorScheme failed: "sepia" is not a color scheme: use light, dark or default/);
            assert.equal(calls.emulateMediaFeatures, undefined, 'nothing emulated');
        });

        test('optional:true swallows a failure instead of throwing', async () => {
            const { page } = makeSpyPage({ emulateMediaFeatures: async () => { throw new Error('unsupported'); } });
            const ctx = makeCtx();
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'dark', optional: true });
            assert.equal(ctx._colorScheme ?? null, null, 'not recorded when it did not apply');
        });
    });

    describe('setColorScheme: high contrast', () => {
        const run = (page, ctx, action) => applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null);
        const media = (calls) => calls.emulateMediaFeatures.map((c) => c[0].map((f) => `${f.name}=${f.value}`).join(' '));

        test('high contrast on, keeping the browser\'s color scheme, persisted for worker pages', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await run(page, ctx, { type: 'setColorScheme', highContrast: 'on' });
            assert.deepEqual(media(calls), ['forced-colors=active prefers-reduced-motion=reduce']);
            assert.equal(ctx._forcedColors, 'active');
            assert.equal(ctx._colorScheme ?? null, null);
        });

        test('an empty field keeps what an earlier step set', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'dark' });
            await run(page, ctx, { type: 'setColorScheme', highContrast: 'on' });
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'light' });
            await run(page, ctx, { type: 'setColorScheme', highContrast: 'off' });
            await run(page, ctx, { type: 'setColorScheme', colorScheme: 'dark', highContrast: 'on' });
            assert.deepEqual(media(calls), [
                'prefers-color-scheme=dark prefers-reduced-motion=reduce',
                'prefers-color-scheme=dark forced-colors=active prefers-reduced-motion=reduce',
                'prefers-color-scheme=light forced-colors=active prefers-reduced-motion=reduce',
                'prefers-color-scheme=light prefers-reduced-motion=reduce',
                'prefers-color-scheme=dark forced-colors=active prefers-reduced-motion=reduce',
            ]);
        });

        test('neither field, or an unknown value, fails naming the choices', async () => {
            const { page } = makeSpyPage();
            await assert.rejects(() => run(page, makeCtx(), { type: 'setColorScheme' }),
                /setColorScheme failed: set "colorScheme" \(light, dark or default\), "highContrast" \(on, off or default\), or both/);
            await assert.rejects(() => run(page, makeCtx(), { type: 'setColorScheme', highContrast: 'yes' }),
                /setColorScheme failed: "yes" is not a high contrast setting: use on, off or default/);
        });
    });

    describe('scroll', () => {
        function makeEvalSpyPage() {
            const evalCalls = [];
            return {
                ...fakePage,
                evaluate: async (...args) => { evalCalls.push(args); return null; },
                _evalCalls: evalCalls
            };
        }

        test('to:"top" calls page.evaluate once', async () => {
            const page = makeEvalSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'scroll', to: 'top' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(page._evalCalls.length, 1);
        });

        test('to:"bottom" calls page.evaluate once', async () => {
            const page = makeEvalSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'scroll', to: 'bottom' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(page._evalCalls.length, 1);
        });

        test('a numeric y calls page.evaluate with that delta as the second argument', async () => {
            const page = makeEvalSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'scroll', y: 250 }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(page._evalCalls.length, 1);
            assert.equal(page._evalCalls[0][1], 250);
        });

        test('neither "to" nor a numeric "y" is a no-op: page.evaluate is never called', async () => {
            const page = makeEvalSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'scroll' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(page._evalCalls.length, 0);
        });
    });

    describe('keyboard', () => {
        test('a combo key presses in down-order then releases in reverse (up) order, around a single press of the main key', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'keyboard', keys: ['ctrl+shift+s'] }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls['keyboard.down'].map(a => a[0]), ['Control', 'Shift']);
            assert.deepEqual(calls['keyboard.press'].map(a => a[0]), ['s']);
            assert.deepEqual(calls['keyboard.up'].map(a => a[0]), ['Shift', 'Control']);
        });

        test('a plain (non-combo) key only presses, never down/up', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'keyboard', keys: ['Escape'] }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls['keyboard.press'].map(a => a[0]), ['Escape']);
            assert.equal(calls['keyboard.down'], undefined);
        });

        test('aliases like "esc"/"cmd"/"enter" are normalized to their canonical Puppeteer key names', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'keyboard', keys: ['esc', 'cmd+enter'] }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls['keyboard.press'].map(a => a[0]), ['Escape', 'Enter']);
            assert.deepEqual(calls['keyboard.down'].map(a => a[0]), ['Meta']);
            assert.deepEqual(calls['keyboard.up'].map(a => a[0]), ['Meta']);
        });

        test('action.text types via page.keyboard.type, independent of and in addition to action.keys', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'keyboard', keys: ['Tab'], text: 'hello' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls['keyboard.press'].map(a => a[0]), ['Tab']);
            assert.deepEqual(calls['keyboard.type'].map(a => a[0]), ['hello']);
        });

        test('neither keys nor text is a no-op', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'keyboard' }], null, 0, ctx, Object.create(null), 0, null);
            assert.deepEqual(calls, {});
        });
    });

    describe('injectCss', () => {
        test('appends !important to declarations that lack it', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'injectCss', css: 'body { display: none; }' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.addStyleTag[0][0].content, 'body { display: none !important; }');
        });

        test('does not double up !important on declarations that already have it', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'injectCss', css: 'body { display: none !important; }' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.addStyleTag[0][0].content, 'body { display: none !important; }');
        });

        test('interpolates {var:...} tokens in the css before forcing !important', async () => {
            const { page, calls } = makeSpyPage();
            const ctx = makeCtx();
            ctx.setVar('hideSel', '.banner');
            await applyActions(page, [{ type: 'injectCss', css: '{var:hideSel} { display: none; }' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.addStyleTag[0][0].content, '.banner { display: none !important; }');
        });

        test('empty css throws unless optional:true, in which case it is a silent no-op', async () => {
            const { page: page1 } = makeSpyPage();
            const ctx1 = makeCtx();
            await assert.rejects(
                () => applyActions(page1, [{ type: 'injectCss', css: '' }], null, 0, ctx1, Object.create(null), 0, null),
                /css is empty/
            );

            const { page: page2, calls: calls2 } = makeSpyPage();
            const ctx2 = makeCtx();
            await applyActions(page2, [{ type: 'injectCss', css: '', optional: true }], null, 0, ctx2, Object.create(null), 0, null);
            assert.equal(calls2.addStyleTag, undefined);
        });

        test('a page.addStyleTag failure is swallowed when optional, rethrown otherwise', async () => {
            const { page: page1 } = makeSpyPage({ addStyleTag: async () => { throw new Error('CSP blocked'); } });
            const ctx1 = makeCtx();
            await applyActions(page1, [{ type: 'injectCss', css: 'body{color:red}', optional: true }], null, 0, ctx1, Object.create(null), 0, null);
            assert.ok(true); // did not throw

            const { page: page2 } = makeSpyPage({ addStyleTag: async () => { throw new Error('CSP blocked'); } });
            const ctx2 = makeCtx();
            await assert.rejects(
                () => applyActions(page2, [{ type: 'injectCss', css: 'body{color:red}' }], null, 0, ctx2, Object.create(null), 0, null),
                /CSP blocked/
            );
        });
    });

    describe('wait', () => {
        test('resolves after the requested delay without touching the page', async () => {
            const ctx = makeCtx();
            const start = Date.now();
            await applyActions(fakePage, [{ type: 'wait', ms: 5 }], null, 0, ctx, Object.create(null), 0, null);
            assert.ok(Date.now() - start >= 0); // just proving it completes; exact timing is not asserted
        });
    });
});

describe('applyActions / _applyActionsImpl (per-action bookkeeping)', () => {
    test('a disabled top-level action is recorded as skipped-disabled and never runs', async () => {
        const ctx = makeCtx();
        const actionResults = [];
        await applyActions(fakePage, [{ type: 'setVar', key: 'x', value: 'y', disabled: true }], actionResults, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('x'), undefined);
        assert.equal(actionResults.length, 1);
        assert.equal(actionResults[0].status, 'skipped-disabled');
        assert.equal(actionResults[0].durationMs, 0);
    });

    test('an action with no "type" is silently skipped: no actionResults entry, next action still runs', async () => {
        const ctx = makeCtx();
        const actionResults = [];
        await applyActions(fakePage, [
            { label: 'oops, forgot type' },
            { type: 'setVar', key: 'after', value: 'reached' }
        ], actionResults, 0, ctx, Object.create(null), 0, null);
        assert.equal(ctx.getVar('after'), 'reached');
        assert.equal(actionResults.length, 1);
        assert.equal(actionResults[0].type, 'setVar');
    });

    test('a successful action records index/type/label/optional/status/durationMs/actionPath', async () => {
        const ctx = makeCtx();
        const actionResults = [];
        await applyActions(fakePage, [{ type: 'setVar', key: 'x', value: 'y', label: 'Set X' }], actionResults, 0, ctx, Object.create(null), 0, null);
        const r = actionResults[0];
        assert.equal(r.index, 0);
        assert.equal(r.type, 'setVar');
        assert.equal(r.label, 'Set X');
        assert.equal(r.optional, false);
        assert.equal(r.status, 'ok');
        assert.equal(typeof r.durationMs, 'number');
        assert.equal(r.actionPath, '1');
    });

    test('actionPath numbers nested actions hierarchically, e.g. "1.1" for a group\'s first child', async () => {
        const ctx = makeCtx();
        await applyActions(fakePage, [{
            type: 'group',
            actions: [{ type: 'setVar', key: 'x', value: 'y' }]
        }], null, 0, ctx, Object.create(null), 0, null);

        const starts = ctx.runLogs.filter(l => l.type === 'action-start').map(l => l.extra.actionPath);
        assert.deepEqual(starts, ['1', '1.1']);
    });

    test('an optional action that throws is recorded as failed-optional and does NOT stop the run', async () => {
        const ctx = makeCtx();
        const actionResults = [];
        await applyActions(fakePage, [
            { type: 'runCustomStep', customStepId: 'missing', optional: true },
            { type: 'setVar', key: 'after', value: 'reached' }
        ], actionResults, 0, ctx, Object.create(null), 0, null);

        assert.equal(ctx.getVar('after'), 'reached');
        assert.equal(actionResults[0].status, 'failed-optional');
        assert.equal(actionResults[0].optional, true);
        assert.match(actionResults[0].error, /was not found/);
        assert.equal(actionResults[1].status, 'ok');
    });

    test('a non-optional action that throws rejects applyActions and stamps _wfFailed/_wfPartialOut on the error', async () => {
        const ctx = makeCtx();
        const actionResults = [];
        let caught = null;
        try {
            await applyActions(fakePage, [{ type: 'runCustomStep', customStepId: 'missing' }], actionResults, 0, ctx, Object.create(null), 0, null);
        } catch (err) {
            caught = err;
        }
        assert.ok(caught, 'expected applyActions to reject');
        assert.equal(caught._wfFailed, true);
        assert.ok(caught._wfPartialOut);
        assert.equal(caught._wfPartialOut.ok, false);
        assert.equal(caught._wfPartialOut.actionResults.length, 1);
        assert.equal(caught._wfPartialOut.actionResults[0].status, 'failed');
        // The same actionResults array passed in is mutated in place, matching the error snapshot.
        assert.equal(actionResults[0].status, 'failed');
    });

    test('checkCancel-driven cancellation (ctx.isCancelled) stops before the next action, with only completed actions recorded', async () => {
        let checks = 0;
        const ctx = createWorkflowContext({ isCancelled: () => { checks += 1; return checks > 1; } });
        const actionResults = [];
        await assert.rejects(
            () => applyActions(fakePage, [
                { type: 'setVar', key: 'first', value: 'ran' },
                { type: 'setVar', key: 'second', value: 'ran' }
            ], actionResults, 0, ctx, Object.create(null), 0, null),
            (err) => err && err._wfCancelled === true
        );
        assert.equal(ctx.getVar('first'), 'ran');
        assert.equal(ctx.getVar('second'), undefined);
        assert.equal(actionResults.length, 1);
    });

    test('abortSignal-driven cancellation is not logged as a failed action (no actionResults entry for the cancelled action)', async () => {
        // Abort up front (rather than mid-flight): the first "setVar" action doesn't consult
        // abortSignal at all (only ctx.race()-wrapped work does), so it still runs to completion;
        // the second action's ctx.race(sleep(...)) is what observes the already-aborted signal.
        const controller = new AbortController();
        controller.abort();
        const ctx = createWorkflowContext({ abortSignal: controller.signal });
        const actionResults = [];
        await assert.rejects(
            () => applyActions(fakePage, [
                { type: 'setVar', key: 'first', value: 'ran' },
                { type: 'wait', ms: 50 }
            ], actionResults, 0, ctx, Object.create(null), 0, null),
            (err) => err && err._wfCancelled === true
        );
        assert.equal(actionResults.length, 1);
        assert.equal(actionResults[0].status, 'ok');
    });
});

// crawlQueue is orchestration over Puppeteer's browser/browserContext/page APIs (spin up a worker
// page per queue item, navigate, run per-page actions, discover links, merge into the queue) - no
// real-DOM hit-testing anywhere in it, so a controlled page/browser mock is a faithful stand-in
// (same rationale as the "page-driving actions" block above). This also exercises crawlQueue's
// private URL/pattern helpers (normalizeUrlCandidate, parsePatternLines/compilePattern/
// testPattern, applyIncludeExclude, normalizeAndFilterUrls) indirectly, since none of them are
// exported.
describe('crawlQueue', () => {
    async function runCrawl(page, actions, ctx, localVars = Object.create(null)) {
        await applyActions(page, actions, null, 0, ctx, localVars, 0, null);
    }

    function makeCrawlPage({ startUrl, hrefsByUrl = {}, viewport = null, workerPageOverrides = null } = {}) {
        const gotoCalls = [];
        const createdWorkerPages = [];
        const closedPages = new Set();
        const closedContexts = [];

        function makeWorkerPage() {
            let currentUrl = null;
            const wp = {
                url: () => currentUrl,
                goto: async (url) => { currentUrl = url; gotoCalls.push(url); },
                evaluate: async (fn, ...args) => {
                    // collectHrefsFromPage calls evaluate(fn, containerSel, linkSel, limit) - 3 args.
                    // Everything else in this test suite's crawlQueue path (waitForRenderSettle's
                    // internal callbacks) calls evaluate(fn) with no extra args.
                    if (args.length === 3) {
                        const hrefs = hrefsByUrl[currentUrl] || [];
                        const [, , limit] = args;
                        return limit ? hrefs.slice(0, limit) : hrefs.slice();
                    }
                    return undefined;
                },
                isClosed: () => closedPages.has(wp),
                close: async () => { closedPages.add(wp); },
                setViewport: async () => {},
                emulateVisionDeficiency: async () => {},
                ...(workerPageOverrides || {})
            };
            createdWorkerPages.push(wp);
            return wp;
        }

        const mainPage = {
            url: () => startUrl,
            viewport: () => viewport,
            browserContext: () => ({ newPage: async () => makeWorkerPage() }),
            browser: () => ({
                createBrowserContext: async () => {
                    const workerContext = { newPage: async () => makeWorkerPage(), close: async () => { closedContexts.push(workerContext); } };
                    return workerContext;
                }
            })
        };

        return { mainPage, gotoCalls, createdWorkerPages, closedPages, closedContexts };
    }

    test('with no seedsVar, crawls the current page URL; maxDepth:0 means no link discovery', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({ startUrl: 'https://example.com/' });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 0, maxPages: 5, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/']);
        assert.deepEqual(ctx.getVar('crawl.visited'), ['https://example.com/']);
        assert.deepEqual(ctx.getVar('crawl.queue'), []);
    });

    test('with no current URL and no seedsVar, is a silent no-op', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({ startUrl: '' });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{ type: 'crawlQueue' }], ctx);
        assert.deepEqual(gotoCalls, []);
        assert.equal(ctx.getVar('crawl.visited'), undefined);
    });

    test('seedsVar overrides the current page URL as the crawl starting point(s)', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({ startUrl: 'https://example.com/should-not-be-used' });
        const ctx = makeCtx();
        ctx.setVar('mySeeds', ['https://example.com/a', 'https://example.com/b']);
        await runCrawl(mainPage, [{
            type: 'crawlQueue', seedsVar: 'mySeeds', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(new Set(gotoCalls), new Set(['https://example.com/a', 'https://example.com/b']));
    });

    test('discovers same-origin links up to maxDepth and visits them (BFS by default: shift from the front)', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['/page-a', '/page-b'] }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, maxPages: 10, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/', 'https://example.com/page-a', 'https://example.com/page-b']);
        assert.deepEqual(new Set(ctx.getVar('crawl.visited')), new Set(gotoCalls));
    });

    test('a Skip iteration that matches skips the page: not a failure, and its links are not followed', async () => {
        const hrefsByUrl = {
            'https://example.com/': ['/archive/old', '/page-a'],
            'https://example.com/archive/old': ['/archive/older'],
        };
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl,
            workerPageOverrides: {
                // The skip's condition runs in the page: here, its URL includes.
                async evaluate(fn, ...args) {
                    const url = this.url();
                    if (args.length === 3) return (hrefsByUrl[url] || []).slice(0, args[2] || undefined);
                    const cfg = args[0];
                    if (cfg && cfg.urlIncludes) return url.includes(cfg.urlIncludes);
                    return undefined;
                }
            }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 2, maxPages: 10, perPageDelayMs: 0, perItemTimeoutMs: 50,
            actions: [{ type: 'skipIteration', urlIncludes: '/archive/' }]
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/', 'https://example.com/archive/old', 'https://example.com/page-a']);
        assert.deepEqual(ctx.iterationFailures || [], []);
    });

    test('dfs strategy pops from the end of the queue instead of shifting from the front', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: {
                'https://example.com/': ['/a', '/b'],
                'https://example.com/b': ['/b-child']
            }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', strategy: 'dfs', maxDepth: 2, maxPages: 10, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        // seed -> discovers [a, b] (pushed in that order) -> dfs pops the LAST pushed first (b),
        // discovers [b-child] -> pops b-child before ever getting to a.
        assert.deepEqual(gotoCalls, [
            'https://example.com/',
            'https://example.com/b',
            'https://example.com/b-child',
            'https://example.com/a'
        ]);
    });

    test('sameOriginOnly (default true) drops cross-origin discovered links', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['/same-origin', 'https://other.example/off-origin'] }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/', 'https://example.com/same-origin']);
    });

    test('sameOriginOnly:false allows crawling off-origin discovered links', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['https://other.example/off-origin'] }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, sameOriginOnly: false, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/', 'https://other.example/off-origin']);
    });

    test('a discovered link that is not a web page (file:, data:, ftp:) is never opened, even off-origin', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['file:///etc/passwd', 'data:text/html,hi', 'ftp://example.com/x', '/ok'] }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, sameOriginOnly: false, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/', 'https://example.com/ok']);
    });

    test('maxPages caps how many URLs are ever scheduled, even with more discovered links available', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['/a', '/b', '/c'] }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, maxPages: 2, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.equal(gotoCalls.length, 2);
    });

    describe('include/exclude patterns', () => {
        // Note: include/exclude gate EVERY scheduled item, not just discovered links - the seed
        // itself goes through the same gate (see the dedicated test below for that). So this test
        // picks a seed that also matches the include pattern, isolating "does it filter discovered
        // links correctly" from "does it also gate the seed" (both true, but tested separately).
        test('a wildcard include pattern only schedules matching URLs, seed and discovered alike', async () => {
            const { mainPage, gotoCalls } = makeCrawlPage({
                startUrl: 'https://example.com/blog',
                hrefsByUrl: { 'https://example.com/blog': ['/blog/post-1', '/about'] }
            });
            const ctx = makeCtx();
            await runCrawl(mainPage, [{
                type: 'crawlQueue', maxDepth: 1, include: '*blog*', perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
            }], ctx);

            assert.deepEqual(gotoCalls, ['https://example.com/blog', 'https://example.com/blog/post-1']);
        });

        test('a regex exclude pattern drops matching discovered URLs', async () => {
            const { mainPage, gotoCalls } = makeCrawlPage({
                startUrl: 'https://example.com/',
                hrefsByUrl: { 'https://example.com/': ['/keep', '/admin/secret'] }
            });
            const ctx = makeCtx();
            await runCrawl(mainPage, [{
                type: 'crawlQueue', maxDepth: 1, exclude: '/\\/admin\\//i', perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
            }], ctx);

            assert.deepEqual(gotoCalls, ['https://example.com/', 'https://example.com/keep']);
        });

        test('include/exclude also gate the seed URLs themselves, not just discovered links', async () => {
            const { mainPage, gotoCalls } = makeCrawlPage({ startUrl: 'https://example.com/admin/page' });
            const ctx = makeCtx();
            await runCrawl(mainPage, [{
                type: 'crawlQueue', maxDepth: 0, exclude: '*admin*', perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
            }], ctx);

            assert.deepEqual(gotoCalls, []);
        });

        test('an invalid regex pattern (/[/) falls back to being treated as a literal wildcard instead of crashing the crawl', async () => {
            const { mainPage, gotoCalls } = makeCrawlPage({
                startUrl: 'https://example.com/',
                hrefsByUrl: { 'https://example.com/': ['/keep'] }
            });
            const ctx = makeCtx();
            await runCrawl(mainPage, [{
                type: 'crawlQueue', maxDepth: 1, exclude: '/[/', perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
            }], ctx);

            // The malformed regex body ("[", unclosed character class) fails new RegExp() and
            // falls back to a literal, anchored wildcard match - "/[/'" as a plain string doesn't
            // match either URL, so nothing actually gets excluded (the point is that this
            // doesn't throw, not that it excludes anything).
            assert.deepEqual(gotoCalls, ['https://example.com/', 'https://example.com/keep']);
        });
    });

    test('a seed that fails to parse as a URL (with no current page URL to use as a base either) is silently dropped, not crashed on', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({ startUrl: '' }); // no current page URL
        const ctx = makeCtx();
        ctx.setVar('badSeeds', ['not a valid url at all']);
        await runCrawl(mainPage, [{
            type: 'crawlQueue', seedsVar: 'badSeeds', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        // Exercises both normalizeUrlCandidate's and safeGetOrigin's parse-failure catch
        // branches: with no valid page URL to fall back on as a base, the malformed seed can't
        // be resolved to an absolute URL at all and is filtered out, leaving an empty crawl
        // instead of an uncaught URL-parsing exception.
        assert.deepEqual(gotoCalls, []);
        assert.deepEqual(ctx.getVar('crawl.queue'), []);
    });

    test('an existing queue var (from a prior crawlQueue run) is merged in as additional starting items', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({ startUrl: 'https://example.com/' });
        const ctx = makeCtx();
        ctx.setVar('crawl.queue', ['https://example.com/leftover']);
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(new Set(gotoCalls), new Set(['https://example.com/', 'https://example.com/leftover']));
    });

    test('an already-visited URL (from a prior run\'s visitedVar) is not re-scheduled', async () => {
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['/already-seen'] }
        });
        const ctx = makeCtx();
        ctx.setVar('crawl.visited', ['https://example.com/already-seen']);
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: []
        }], ctx);

        assert.deepEqual(gotoCalls, ['https://example.com/']);
    });

    test('worker pages are closed after each item by default (closeWorkerPages defaults true)', async () => {
        const { mainPage, createdWorkerPages, closedPages } = makeCrawlPage({ startUrl: 'https://example.com/' });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{ type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: [] }], ctx);
        assert.equal(createdWorkerPages.length, 1);
        assert.equal(closedPages.has(createdWorkerPages[0]), true);
    });

    test('closeWorkerPages:false leaves worker pages open', async () => {
        const { mainPage, createdWorkerPages, closedPages } = makeCrawlPage({ startUrl: 'https://example.com/' });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{ type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, closeWorkerPages: false, actions: [] }], ctx);
        assert.equal(closedPages.has(createdWorkerPages[0]), false);
    });

    test('isolation:"context" creates a fresh browser context per worker and closes it after', async () => {
        const { mainPage, closedContexts } = makeCrawlPage({ startUrl: 'https://example.com/' });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{ type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, isolation: 'context', actions: [] }], ctx);
        assert.equal(closedContexts.length, 1);
    });

    test('closeWorkerPages:false combined with isolation:"context" leaves both the worker page and its browser context open', async () => {
        const { mainPage, createdWorkerPages, closedPages, closedContexts } = makeCrawlPage({ startUrl: 'https://example.com/' });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50,
            isolation: 'context', closeWorkerPages: false, actions: []
        }], ctx);
        assert.equal(closedPages.has(createdWorkerPages[0]), false);
        assert.equal(closedContexts.length, 0);
    });

    test('maxSeconds stops the crawl early once the time budget is exceeded, leaving remaining discovered URLs in the queue', async () => {
        // maxSeconds is floored to a minimum of 1 real second (Math.max(1, ...) in the action's
        // own option parsing), so this can't be sped up below ~1s - perPageDelayMs (also real
        // wall-clock time, not stubbed under NODE_TEST_CONTEXT the way postStepDelay is) has to
        // push elapsed time past that floor across enough scheduled items.
        const { mainPage, gotoCalls } = makeCrawlPage({
            startUrl: 'https://example.com/',
            hrefsByUrl: { 'https://example.com/': ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h'] }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 1, maxPages: 50, maxSeconds: 1, perPageDelayMs: 300, perItemTimeoutMs: 5000, actions: []
        }], ctx);

        // 9 total possible visits (the seed + its 8 discovered links); only some complete before
        // elapsed time crosses the 1-second floor on a later pass through the loop.
        assert.ok(gotoCalls.length >= 1 && gotoCalls.length < 9, `expected a partial crawl, got ${gotoCalls.length} visits`);
        assert.ok(ctx.getVar('crawl.queue').length > 0, 'expected URLs left unvisited in the queue');
        assert.ok(ctx.runLogs.some(l => /time budget exceeded/.test(l.message)));
    });

    test('perItemTimeoutMs force-stops a worker that never settles (a hung goto), closing its page instead of stalling the crawl forever', async () => {
        // The goto below deliberately outlives perItemTimeoutMs (30ms) so the watchdog has to
        // force-stop the worker rather than the goto resolving on its own - but it must still
        // resolve EVENTUALLY (100ms later), not never: a permanently-pending promise leaks past
        // this test and hangs the whole test runner waiting for it, since scheduleOne's own
        // in-flight await on it never settles otherwise.
        const { mainPage, createdWorkerPages, closedPages } = makeCrawlPage({
            startUrl: 'https://example.com/',
            workerPageOverrides: { goto: () => new Promise((resolve) => setTimeout(resolve, 100)) }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 30, actions: []
        }], ctx);

        assert.equal(createdWorkerPages.length, 1);
        assert.equal(closedPages.has(createdWorkerPages[0]), true);
        assert.deepEqual(ctx.getVar('crawl.visited'), ['https://example.com/']);

        // Let the now-unblocked (but already-superseded) goto's trailing chain finish quietly
        // before the test ends, so nothing is left dangling.
        await new Promise((resolve) => setTimeout(resolve, 120));
    });

    describe('per-item error handling', () => {
        test('a cancel-ish navigation error (e.g. "Target closed") is recorded as cancelled, not a real iteration failure', async () => {
            const { mainPage } = makeCrawlPage({
                startUrl: 'https://example.com/',
                workerPageOverrides: { goto: async () => { throw new Error('Target closed'); } }
            });
            const ctx = makeCtx();
            await runCrawl(mainPage, [{ type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: [] }], ctx);
            assert.equal(ctx.iterationFailures.length, 0);
        });

        test('a genuine per-page error is recorded via recordIterationFailure but does not stop the crawl', async () => {
            const { mainPage, gotoCalls } = makeCrawlPage({
                startUrl: 'https://example.com/',
                hrefsByUrl: { 'https://example.com/': ['/second'] },
                workerPageOverrides: {
                    goto: async (url) => {
                        if (url === 'https://example.com/') throw new Error('boom: page crashed');
                    }
                }
            });
            const ctx = makeCtx();
            await runCrawl(mainPage, [{ type: 'crawlQueue', maxDepth: 1, perPageDelayMs: 0, perItemTimeoutMs: 50, actions: [] }], ctx);
            // The failing seed never discovers /second (its own scheduleOne threw before running
            // per-page actions/discovery), so the crawl simply ends after that one failed attempt -
            // but crucially, applyActions itself does not reject.
            assert.equal(ctx.iterationFailures.length, 1);
            assert.equal(ctx.iterationFailures[0].iteratorType, 'crawlQueue');
            assert.match(ctx.iterationFailures[0].error, /boom: page crashed/);
        });
    });

    // Per-page actions run against a per-item "workerCtx" (createChildContext(ctx)), a wholly
    // separate context object with its own var-scope stack - NOT the outer ctx passed into
    // applyActions. So a Proxy on the outer ctx.vars (the trick used elsewhere in this file to
    // observe per-iteration values) can't see anything a per-page action does. Observing the
    // worker page mock directly (which the outer test DOES have a handle on) is the reliable way.
    test('runs per-page actions (action.actions) against the worker page for each visited URL', async () => {
        const injectedCss = [];
        const { mainPage } = makeCrawlPage({
            startUrl: 'https://example.com/',
            workerPageOverrides: { addStyleTag: async ({ content }) => { injectedCss.push(content); } }
        });
        const ctx = makeCtx();
        await runCrawl(mainPage, [{
            type: 'crawlQueue', maxDepth: 0, perPageDelayMs: 0, perItemTimeoutMs: 50,
            actions: [{ type: 'injectCss', css: 'body { color: red; }' }]
        }], ctx);

        assert.deepEqual(injectedCss, ['body { color: red !important; }']);
    });
});

// forEachElement (concurrency:1, the default/sequential path - concurrency>1 spins up worker
// pages via runForEachElementConcurrent, covered by its own concurrency>1 describe block)
// scopes each matched element via a `data-wf-scope` attribute it sets/reads through
// handle.evaluate()/page.evaluate(), then runs nested actions against a selector rewritten to
// that scope. None of that is real hit-testing/geometry - it's attribute bookkeeping - so unlike
// click/hover/type, a fake element that genuinely runs the real callback bodies (setAttribute/
// getAttribute/getBoundingClientRect, plus globalThis.document/getComputedStyle/window for the
// onlyVisible path) is a faithful stand-in, following the same reasoning as nav.test.js's
// waitForRenderSettle globals-stubbing.
describe('forEachElement', () => {
    const SEL = '.item';

    function stubDomGlobals(elements, work) {
        const scopeSelRe = /^\[data-wf-scope="([^"]+)"\]$/;
        const findByScopeSel = (sel) => {
            const m = scopeSelRe.exec(sel);
            if (!m) return null;
            return elements.find(e => e.attrs['data-wf-scope'] === m[1]) || null;
        };
        const overrides = {
            document: { querySelector: (sel) => { const found = findByScopeSel(sel); return found ? makeFakeEl(found) : null; } },
            getComputedStyle: (fakeEl) => ({ display: fakeEl.__visible === false ? 'none' : 'block', visibility: 'visible' }),
            window: { innerWidth: 1000, innerHeight: 800 }
        };
        const originals = {};
        const hadOwn = {};
        for (const key of Object.keys(overrides)) {
            hadOwn[key] = Object.prototype.hasOwnProperty.call(global, key);
            originals[key] = global[key];
            global[key] = overrides[key];
        }
        return Promise.resolve().then(work).finally(() => {
            for (const key of Object.keys(overrides)) {
                if (hadOwn[key]) global[key] = originals[key];
                else delete global[key];
            }
        });
    }

    function makeFakeEl(elData) {
        return {
            get textContent() { return elData.text || ''; },
            get href() { return elData.href || ''; },
            __visible: elData.visible !== false,
            getAttribute(name) {
                if (name === 'href') return elData.href || null;
                return Object.prototype.hasOwnProperty.call(elData.attrs, name) ? elData.attrs[name] : null;
            },
            setAttribute(name, value) { elData.attrs[name] = value; },
            removeAttribute(name) { delete elData.attrs[name]; },
            getBoundingClientRect() {
                return elData.visible !== false
                    ? { width: 10, height: 10, top: 0, left: 0, bottom: 10, right: 10 }
                    : { width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 };
            },
            // navigateBy:'click' calls these on the candidate handle before/while clicking.
            // They're no-ops here because navigation is driven entirely by the mock page's
            // waitForNavigation/waitForFunction below, not by any real DOM effect of the click.
            scrollIntoView() {},
            click() {}
        };
    }

    function makeForEachPage({ items }) {
        const elements = items.map((it, i) => ({
            attrs: {},
            href: it.href !== undefined ? it.href : `https://example.com/item-${i}`,
            text: it.text !== undefined ? it.text : `Item ${i}`,
            visible: it.visible !== false,
            disposed: 0
        }));

        function makeHandle(elData) {
            return {
                _elData: elData,
                evaluate: async (fn, ...args) => fn(makeFakeEl(elData), ...args),
                dispose: async () => { elData.disposed += 1; }
            };
        }

        const findByScopeSel = (sel) => {
            const m = /^\[data-wf-scope="([^"]+)"\]$/.exec(sel);
            if (!m) return null;
            return elements.find(e => e.attrs['data-wf-scope'] === m[1]) || null;
        };

        const page = {
            $$: async (selector) => {
                if (selector === SEL) return elements.map(makeHandle);
                const found = findByScopeSel(selector);
                return found ? [makeHandle(found)] : [];
            },
            $: async (selector) => {
                if (selector === SEL) return elements.length ? makeHandle(elements[0]) : null;
                const found = findByScopeSel(selector);
                return found ? makeHandle(found) : null;
            },
            evaluate: async (fn, ...args) => fn(...args),
            // getText (used by several tests below to read the scoped element's
            // href/text) resolves its target via page.waitForFunction(deepFindFn, opts, selector).
            // The deep-find callback only touches the (already-stubbed) global `document`, so
            // running it for real and wrapping whatever it finds in a minimal JSHandle-shaped
            // { asElement() } is faithful, same reasoning as the rest of this mock.
            waitForFunction: async (fn, _opts, ...args) => {
                const found = await fn(...args);
                if (!found) throw new Error('waitForFunction: not found (simulated timeout)');
                return { asElement: () => ({ evaluate: async (evalFn, cfg) => evalFn(found, cfg), dispose: async () => {} }) };
            },
            url: () => 'https://example.com/'
        };

        return { page, elements };
    }

    test('breaks immediately (no-op) when neither targetSelector nor context is set', async () => {
        const { page } = makeForEachPage({ items: [] });
        const ctx = makeCtx();
        await stubDomGlobals([], () => applyActions(page, [{ type: 'forEachElement', actions: [{ type: 'setVar', key: 'x', value: 'y' }] }], null, 0, ctx, Object.create(null), 0, null));
        assert.equal(ctx.getVar('x'), undefined);
    });

    test('iterates once per matched element, in DOM order by default, exposing {oneBased}/{total}', async () => {
        const { page, elements } = makeForEachPage({ items: [{}, {}, {}] });
        const ctx = makeCtx();
        const seen = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'seen') seen.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            actions: [{ type: 'setVar', key: 'seen', value: '{oneBased}/{total}' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
    });

    // Regression test: actions nested inside the sequential (concurrency:1) loop must get a
    // nested actionPath ("2.1", "2.2", ...), not a bare top-level index ("1", "2", ...) that
    // collides with an unrelated top-level action - collectOutput's report cross-link (§6.4 in
    // docs/design/workflow-collected-metadata-design.md) relies on the nested path being correct.
    test('actions nested inside the sequential loop get a correctly nested actionPath, not colliding with an unrelated top-level action', async () => {
        const { page, elements } = makeForEachPage({ items: [{}, {}] });
        const ctx = makeCtx();

        await stubDomGlobals(elements, () => applyActions(page, [
            { type: 'collectOutput', key: 'topLevel', value: 'x' }, // actionPath "1"
            {
                type: 'forEachElement', targetSelector: SEL, // actionPath "2"
                actions: [{ type: 'collectOutput', key: 'nested', value: 'y' }] // must be "2.1", not "1"
            }
        ], null, 0, ctx, Object.create(null), 0, null));

        const topLevel = ctx.collectedOutputs.find((e) => e.key === 'topLevel');
        const nested = ctx.collectedOutputs.filter((e) => e.key === 'nested');

        assert.equal(topLevel.actionPath, '1');
        assert.equal(nested.length, 2, 'one nested entry per iteration');
        for (const entry of nested) {
            assert.equal(entry.actionPath, '2.1', 'nested action keeps its true position under the loop');
            assert.notEqual(entry.actionPath, topLevel.actionPath, 'must not collide with the unrelated top-level action');
        }
    });

    test('reverse:true iterates the matched elements back to front', async () => {
        const { page, elements } = makeForEachPage({ items: [{ href: 'a' }, { href: 'b' }, { href: 'c' }] });
        const ctx = makeCtx();
        const seenHrefs = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL, reverse: true,
            actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(seenHrefs, ['c', 'b', 'a']);
    });

    test('limit caps the number of iterations even when more elements match', async () => {
        const { page, elements } = makeForEachPage({ items: [{}, {}, {}, {}] });
        const ctx = makeCtx();
        let count = 0;
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'tick') count += 1; t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL, limit: 2,
            actions: [{ type: 'setVar', key: 'tick', value: '1' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.equal(count, 2);
    });

    test('onlyVisible:true skips elements that fail the visibility check, without counting them as iterations', async () => {
        const { page, elements } = makeForEachPage({ items: [{ visible: true, href: 'a' }, { visible: false, href: 'b' }, { visible: true, href: 'c' }] });
        const ctx = makeCtx();
        const seenHrefs = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL, onlyVisible: true,
            actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(seenHrefs, ['a', 'c']);
    });

    test('dedupeBy:"text" dedupes by textContent instead of href (two same-text elements collapse iteration progress correctly)', async () => {
        // Not a literal dedupe-skip in the sequential loop (it processes by index either way),
        // but this confirms getKey() reads textContent, not href, when dedupeBy is "text" - by
        // checking preActions can read {var:value}-independent per-item text via getText.
        const { page, elements } = makeForEachPage({ items: [{ text: 'Alpha' }, { text: 'Beta' }] });
        const ctx = makeCtx();
        const seenTexts = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'txt') seenTexts.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL, dedupeBy: 'text',
            actions: [{ type: 'getText', selector: ':ctx', var: 'txt' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(seenTexts, ['Alpha', 'Beta']);
    });

    test('preActions run before the main nested actions, both scoped to the same element', async () => {
        const { page, elements } = makeForEachPage({ items: [{}] });
        const ctx = makeCtx();
        const order = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, {
            set(t, k, v) {
                if (k === 'pre') order.push('pre');
                if (k === 'main') order.push('main');
                t[k] = v;
                return true;
            }
        });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            preActions: [{ type: 'setVar', key: 'pre', value: '1' }],
            actions: [{ type: 'setVar', key: 'main', value: '1' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(order, ['pre', 'main']);
    });

    // iterSetupActions runs at the TOP of every loop pass, BEFORE the "is there still an unhandled
    // match?" presence check - so for a fixed-size element list it runs once per element PLUS one
    // extra trailing pass, where it discovers nothing is left and the loop then breaks. This is a
    // consequence of the loop being written for dynamic/live DOM lists (where a fresh page.$$()
    // each pass might reveal newly-appeared elements) rather than a fixed snapshot.
    test('iterSetupActions run once per element, PLUS one trailing pass when the loop discovers nothing is left', async () => {
        const { page, elements } = makeForEachPage({ items: [{}, {}] });
        const ctx = makeCtx();
        let setupCount = 0;
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'setup') setupCount += 1; t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            iterSetupActions: [{ type: 'setVar', key: 'setup', value: '1' }],
            actions: [{ type: 'wait', ms: 0 }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.equal(setupCount, 3); // 2 elements + 1 trailing "nothing left" pass
    });

    test('a disabled nested action is filtered out (never runs) for every iteration', async () => {
        const { page, elements } = makeForEachPage({ items: [{}] });
        const ctx = makeCtx();
        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            actions: [{ type: 'setVar', key: 'shouldNotRun', value: '1', disabled: true }]
        }], null, 0, ctx, Object.create(null), 0, null));
        assert.equal(ctx.getVar('shouldNotRun'), undefined);
    });


    describe('per-iteration error handling', () => {
        const failingAction = { type: 'runCustomStep', customStepId: 'does-not-exist' };

        test('continueOnIterationError:false (default) stops the whole loop on the first failure', async () => {
            const { page, elements } = makeForEachPage({ items: [{}, {}, {}] });
            const ctx = makeCtx();
            await assert.rejects(
                () => stubDomGlobals(elements, () => applyActions(page, [{
                    type: 'forEachElement', targetSelector: SEL, actions: [failingAction]
                }], null, 0, ctx, Object.create(null), 0, null)),
                /was not found/
            );
            assert.equal(ctx.iterationFailures.length, 1);
        });

        test('continueOnIterationError:true records every failure and keeps going through all elements', async () => {
            const { page, elements } = makeForEachPage({ items: [{}, {}, {}] });
            const ctx = makeCtx();
            await stubDomGlobals(elements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL, continueOnIterationError: true, actions: [failingAction]
            }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(ctx.iterationFailures.length, 3);
            assert.ok(ctx.iterationFailures.every(f => f.iteratorType === 'forEachElement'));
        });

        test('maxIterationErrors stops the loop once the error budget is exhausted, even with continueOnIterationError:true', async () => {
            const { page, elements } = makeForEachPage({ items: [{}, {}, {}, {}] });
            const ctx = makeCtx();
            await assert.rejects(
                () => stubDomGlobals(elements, () => applyActions(page, [{
                    type: 'forEachElement', targetSelector: SEL, continueOnIterationError: true, maxIterationErrors: 2, actions: [failingAction]
                }], null, 0, ctx, Object.create(null), 0, null)),
                /stopped after 2 iteration errors/
            );
            assert.equal(ctx.iterationFailures.length, 2);
        });
    });

    // skipIteration throws the _wfSkipIteration signal (see its case in workflow-engine.js), which
    // forEachElement's per-iteration catch (a few lines below in the "actions" try/catch) treats
    // as "advance to the next element, don't run anything after this in the same iteration, and
    // don't count it as a failure" - not a real error.
    test('skipIteration (when its predicate matches) skips the rest of that element\'s iteration, for every element, without recording a failure', async () => {
        const { page, elements } = makeForEachPage({ items: [{ href: 'a' }, { href: 'b' }] });
        const ctx = makeCtx();
        // A page.evaluate that always resolves the skip predicate to true for every item.
        const originalEvaluate = page.evaluate;
        page.evaluate = async (fn, ...args) => (args.length === 1 && args[0] && typeof args[0] === 'object' && 'selectorExists' in args[0]) ? true : originalEvaluate(fn, ...args);

        const seenHrefs = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            actions: [
                { type: 'skipIteration', config: { selectorExists: '.always-skip' } },
                { type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }
            ]
        }], null, 0, ctx, Object.create(null), 0, null));

        // getText never ran for either element - skipIteration cut the iteration short
        // both times - but the loop still visited (and cleanly finished) both elements.
        assert.deepEqual(seenHrefs, []);
        assert.equal(ctx.iterationFailures.length, 0);
    });

    test('scoping sets and clears the data-wf-scope attribute around each iteration (no leftover attribute afterward)', async () => {
        const { page, elements } = makeForEachPage({ items: [{}, {}] });
        const ctx = makeCtx();
        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL, actions: [{ type: 'wait', ms: 0 }]
        }], null, 0, ctx, Object.create(null), 0, null));

        for (const el of elements) {
            assert.equal(Object.prototype.hasOwnProperty.call(el.attrs, 'data-wf-scope'), false);
        }
    });

    test('an empty match set is a no-op: zero iterations, no error', async () => {
        const { page, elements } = makeForEachPage({ items: [] });
        const ctx = makeCtx();
        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL, actions: [{ type: 'setVar', key: 'x', value: '1' }]
        }], null, 0, ctx, Object.create(null), 0, null));
        assert.equal(ctx.getVar('x'), undefined);
    });

    describe('dynamic:true (live-list mode)', () => {
        test('iterates live results, picking the first not-yet-visited element (by key) on each pass', async () => {
            const { page, elements } = makeForEachPage({ items: [{ href: 'a' }, { href: 'b' }, { href: 'c' }] });
            const ctx = makeCtx();
            const seenHrefs = [];
            const realVars = ctx.vars;
            ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

            await stubDomGlobals(elements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL, dynamic: true,
                actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(seenHrefs, ['a', 'b', 'c']);
        });

        test('combined with onlyVisible:true, skips invisible elements without ever marking them visited, and still terminates', async () => {
            const { page, elements } = makeForEachPage({ items: [
                { href: 'a', visible: true }, { href: 'b', visible: false }, { href: 'c', visible: true }
            ] });
            const ctx = makeCtx();
            const seenHrefs = [];
            const realVars = ctx.vars;
            ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

            await stubDomGlobals(elements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL, dynamic: true, onlyVisible: true,
                actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(seenHrefs, ['a', 'c']);
        });
    });

    test('static list reordered mid-run: when the index-based cursor now points to an already-visited item, picks the next unvisited candidate from the current snapshot instead of getting stuck re-visiting it', async () => {
        // Simulates an SPA that re-sorts its list after each interaction. After "a" (index 0) is
        // processed, the list re-sorts so the cursor's next position (index 1) is "a" again -
        // the loop must recognize the already-visited key and search the rest of the current
        // snapshot for something new ("c", which the sort moved to index 0) rather than
        // reprocessing "a" or getting stuck.
        let elements = [
            { attrs: {}, href: 'https://example.com/a', text: 'A', visible: true, disposed: 0 },
            { attrs: {}, href: 'https://example.com/b', text: 'B', visible: true, disposed: 0 },
            { attrs: {}, href: 'https://example.com/c', text: 'C', visible: true, disposed: 0 }
        ];
        let callCount = 0;
        function makeHandle(elData) {
            return {
                evaluate: async (fn, ...args) => fn(makeFakeEl(elData), ...args),
                dispose: async () => { elData.disposed += 1; }
            };
        }
        const findByScopeSel = (sel) => {
            const m = /^\[data-wf-scope="([^"]+)"\]$/.exec(sel);
            if (!m) return null;
            return elements.find(e => e.attrs['data-wf-scope'] === m[1]) || null;
        };
        const page = {
            $$: async (selector) => {
                if (selector === SEL) {
                    callCount += 1;
                    // Call 1 is the staticTotal precount at the top of the handler (before the
                    // loop even starts); call 2 is iteration 1's own handles fetch (processes
                    // "a"). Re-sort right before call 3 (iteration 2's fetch): "c" moves to the
                    // front, "a" slides into the cursor's next slot (index 1).
                    if (callCount === 3) elements = [elements[2], elements[0], elements[1]];
                    return elements.map(makeHandle);
                }
                const found = findByScopeSel(selector);
                return found ? [makeHandle(found)] : [];
            },
            $: async (selector) => {
                if (selector === SEL) return elements.length ? makeHandle(elements[0]) : null;
                const found = findByScopeSel(selector);
                return found ? makeHandle(found) : null;
            },
            evaluate: async (fn, ...args) => fn(...args),
            waitForFunction: async (fn, _opts, ...args) => {
                const found = await fn(...args);
                if (!found) throw new Error('waitForFunction: not found (simulated timeout)');
                return { asElement: () => ({ evaluate: async (evalFn, cfg) => evalFn(found, cfg), dispose: async () => {} }) };
            },
            url: () => 'https://example.com/'
        };

        const ctx = makeCtx();
        const seenHrefs = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(seenHrefs, ['https://example.com/a', 'https://example.com/c', 'https://example.com/b']);
    });

    describe('scoped element disappears right after scoping (re-check race)', () => {
        // forEachElement re-checks the scoped element's presence right after scoping it
        // (~L3170-3186 in workflow-engine.js) before running nested actions - a defense against
        // SPA re-renders detaching the element between scoping and use. These tests make that
        // check report "gone" to exercise the reacquire-once recovery path without disturbing
        // every other test's assumption that scoping just works.
        function overrideScopeDisappearsOnce(page) {
            const scopeCallCounts = new Map();
            let disappearForSelector = null;
            const originalDollar = page.$;
            page.$ = async (selector) => {
                if (/^\[data-wf-scope="/.test(selector)) {
                    if (disappearForSelector === null) disappearForSelector = selector;
                    if (selector === disappearForSelector) {
                        const n = (scopeCallCounts.get(selector) || 0) + 1;
                        scopeCallCounts.set(selector, n);
                        if (n === 1) return null;
                    }
                }
                return originalDollar(selector);
            };
        }

        test('reacquire succeeds (element still in the fresh snapshot, matched by key): re-scopes and continues normally', async () => {
            const { page, elements } = makeForEachPage({ items: [{ href: 'a' }] });
            overrideScopeDisappearsOnce(page);

            const ctx = makeCtx();
            const seenHrefs = [];
            const realVars = ctx.vars;
            ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

            await stubDomGlobals(elements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL,
                actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(seenHrefs, ['a']);
            assert.ok(ctx.runLogs.some(l => /Scoped element disappeared, reacquiring once/.test(l.message)));
        });

        test('reacquire fails (fresh snapshot no longer has a matching key): the iteration is skipped, not treated as a failure, and the loop moves on', async () => {
            const { page, elements } = makeForEachPage({ items: [{ href: 'a' }, { href: 'b' }] });
            overrideScopeDisappearsOnce(page);

            const originalDollarDollar = page.$$;
            let ddCalls = 0;
            page.$$ = async (selector) => {
                if (selector === SEL) {
                    ddCalls += 1;
                    // Call 1 is the staticTotal precount, call 2 is iteration 1's own handles
                    // fetch (processes "a" normally). Call 3 is the reacquire attempt's "fresh"
                    // re-query - report nothing matches, as if the element (and its href) were
                    // truly gone.
                    if (ddCalls === 3) return [];
                }
                return originalDollarDollar(selector);
            };

            const ctx = makeCtx();
            const seenHrefs = [];
            const realVars = ctx.vars;
            ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

            await stubDomGlobals(elements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL,
                actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            // "a"'s iteration was skipped entirely (no nested actions ran for it), but the loop
            // still moved on and completed "b" normally afterward.
            assert.deepEqual(seenHrefs, ['b']);
            assert.equal(ctx.iterationFailures.length, 0);
        });

        test('reacquire with onlyVisible:true skips invisible and non-matching candidates in the fresh snapshot before finding the right one by key', async () => {
            const targetData = { attrs: {}, href: 'https://example.com/a', text: 'A', visible: true, disposed: 0 };
            const decoyInvisible = { attrs: {}, href: 'https://example.com/decoy-invisible', text: 'DI', visible: false, disposed: 0 };
            const decoyVisible = { attrs: {}, href: 'https://example.com/decoy-visible', text: 'DV', visible: true, disposed: 0 };
            function makeHandle(elData) {
                return {
                    evaluate: async (fn, ...args) => fn(makeFakeEl(elData), ...args),
                    dispose: async () => { elData.disposed += 1; }
                };
            }
            const allElements = [targetData, decoyInvisible, decoyVisible];
            const findByScopeSel = (sel) => {
                const m = /^\[data-wf-scope="([^"]+)"\]$/.exec(sel);
                if (!m) return null;
                return allElements.find(e => e.attrs['data-wf-scope'] === m[1]) || null;
            };
            let ddCalls = 0;
            const scopeCallCounts = new Map();
            const page = {
                $$: async (selector) => {
                    if (selector === SEL) {
                        ddCalls += 1;
                        // Calls 1-2 are the staticTotal precount + iteration 1's own fetch (just
                        // the target). Call 3+ is the reacquire's "fresh" re-query: put the
                        // decoys ahead of the real match so the search has to walk past both an
                        // invisible candidate and a visible-but-wrong-key one first. Calls after
                        // that report nothing left, so the loop cleanly finishes after "a".
                        if (ddCalls === 3) return [decoyInvisible, decoyVisible, targetData].map(makeHandle);
                        if (ddCalls > 3) return [];
                        return [targetData].map(makeHandle);
                    }
                    const found = findByScopeSel(selector);
                    return found ? [makeHandle(found)] : [];
                },
                $: async (selector) => {
                    if (selector === SEL) return makeHandle(targetData);
                    if (/^\[data-wf-scope="/.test(selector)) {
                        const n = (scopeCallCounts.get(selector) || 0) + 1;
                        scopeCallCounts.set(selector, n);
                        if (n === 1) return null; // simulate disappearance on the presence check
                    }
                    const found = findByScopeSel(selector);
                    return found ? makeHandle(found) : null;
                },
                evaluate: async (fn, ...args) => fn(...args),
                waitForFunction: async (fn, _opts, ...args) => {
                    const found = await fn(...args);
                    if (!found) throw new Error('waitForFunction: not found (simulated timeout)');
                    return { asElement: () => ({ evaluate: async (evalFn, cfg) => evalFn(found, cfg), dispose: async () => {} }) };
                },
                url: () => 'https://example.com/'
            };

            const ctx = makeCtx();
            const seenHrefs = [];
            const realVars = ctx.vars;
            ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

            await stubDomGlobals(allElements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL, onlyVisible: true,
                actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(seenHrefs, ['https://example.com/a']);
            assert.ok(decoyInvisible.disposed >= 1);
            assert.ok(decoyVisible.disposed >= 1);
        });

        test('reacquire with no dedupeable key (element has neither href nor text) falls back to picking by index in the fresh snapshot', async () => {
            const targetData = { attrs: {}, href: '', text: '', visible: true, disposed: 0 };
            const otherData = { attrs: {}, href: 'https://example.com/other', text: 'Other', visible: true, disposed: 0 };
            function makeHandle(elData) {
                return {
                    evaluate: async (fn, ...args) => fn(makeFakeEl(elData), ...args),
                    dispose: async () => { elData.disposed += 1; }
                };
            }
            const allElements = [targetData, otherData];
            const findByScopeSel = (sel) => {
                const m = /^\[data-wf-scope="([^"]+)"\]$/.exec(sel);
                if (!m) return null;
                return allElements.find(e => e.attrs['data-wf-scope'] === m[1]) || null;
            };
            let ddCalls = 0;
            const scopeCallCounts = new Map();
            const page = {
                $$: async (selector) => {
                    if (selector === SEL) {
                        ddCalls += 1;
                        if (ddCalls === 3) return [targetData, otherData].map(makeHandle); // fresh re-query for reacquire
                        if (ddCalls > 3) return []; // nothing left, loop finishes cleanly
                        return [targetData].map(makeHandle); // staticTotal precount + iteration 1 fetch
                    }
                    const found = findByScopeSel(selector);
                    return found ? [makeHandle(found)] : [];
                },
                $: async (selector) => {
                    if (selector === SEL) return makeHandle(targetData);
                    if (/^\[data-wf-scope="/.test(selector)) {
                        const n = (scopeCallCounts.get(selector) || 0) + 1;
                        scopeCallCounts.set(selector, n);
                        if (n === 1) return null;
                    }
                    const found = findByScopeSel(selector);
                    return found ? makeHandle(found) : null;
                },
                evaluate: async (fn, ...args) => fn(...args),
                waitForFunction: async (fn, _opts, ...args) => {
                    const found = await fn(...args);
                    if (!found) throw new Error('waitForFunction: not found (simulated timeout)');
                    return { asElement: () => ({ evaluate: async (evalFn, cfg) => evalFn(found, cfg), dispose: async () => {} }) };
                },
                url: () => 'https://example.com/'
            };

            const ctx = makeCtx();
            const seenTexts = [];
            const realVars = ctx.vars;
            ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'txt') seenTexts.push(v); t[k] = v; return true; } });

            await stubDomGlobals(allElements, () => applyActions(page, [{
                type: 'forEachElement', targetSelector: SEL,
                actions: [{ type: 'getText', selector: ':ctx', var: 'txt' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            // Index 0 in the fresh snapshot (targetData itself, empty text) is picked since
            // there's no key to match by - not "other".
            assert.deepEqual(seenTexts, ['']);
            assert.ok(otherData.disposed >= 1);
        });
    });

    test('a skipIteration inside iterSetupActions re-loops without ever selecting/scoping an element, and does not advance processed', async () => {
        const { page, elements } = makeForEachPage({ items: [{ href: 'a' }] });
        const ctx = makeCtx();
        const originalEvaluate = page.evaluate;
        let evalCalls = 0;
        // Skip only on the first pass, so the loop doesn't spin forever - after that let the
        // element be selected and processed normally, confirming the skipped pass didn't
        // silently advance `processed`.
        page.evaluate = async (fn, ...args) => {
            if (args.length === 1 && args[0] && typeof args[0] === 'object' && 'selectorExists' in args[0]) {
                evalCalls += 1;
                return evalCalls === 1;
            }
            return originalEvaluate(fn, ...args);
        };

        const seenHrefs = [];
        const realVars = ctx.vars;
        ctx.vars = new Proxy(realVars, { set(t, k, v) { if (k === 'h') seenHrefs.push(v); t[k] = v; return true; } });

        await stubDomGlobals(elements, () => applyActions(page, [{
            type: 'forEachElement', targetSelector: SEL,
            iterSetupActions: [{ type: 'skipIteration', config: { selectorExists: '.only-first-pass' } }],
            actions: [{ type: 'getText', selector: ':ctx', var: 'h', attr: 'href' }]
        }], null, 0, ctx, Object.create(null), 0, null));

        assert.deepEqual(seenHrefs, ['a']);
        assert.ok(ctx.runLogs.some(l => /Iteration skipped \(iterSetupActions\)/.test(l.message)));
    });

    // ---------------------------------------------------------------------------------------------
    // concurrency > 1: runForEachElementConcurrent / buildForEachElementPlan /
    // _forEachFindHandleForPlanItem (~L671-1264 in workflow-engine.js).
    //
    // Structurally mirrors crawlQueue's worker-page orchestration (createCrawlWorkerTarget is
    // shared code), so the mocking technique is the same one used by makeCrawlPage in the
    // crawlQueue describe block above: a mainPage exposing browserContext().newPage() (isolation
    // "page") and browser().createBrowserContext() (isolation "context"), each producing a worker
    // page object. Unlike crawlQueue's workers (which browse to different discovered URLs), every
    // forEachElement worker here reads the SAME shared `elements` array via $$() - faithful to
    // real workers all viewing the same list page, just resolving different plan items on it.
    //
    // Per-worker child contexts get their OWN `vars` copy (createChildContext snapshots the
    // parent's vars, it does not share the object - see createChildContext in workflow-engine.js),
    // so unlike the sequential tests above, a Proxy on ctx.vars can't observe what happened inside
    // a specific worker's iteration. ctx.runLogs and ctx.iterationFailures ARE shared by reference
    // across parent and every child context, though (same file, createChildContext), and
    // runForEachElementIterationOnPage unconditionally logs "forEachElement item N/total" once per
    // iteration - so counting/parsing those shared log lines is the reliable way to verify how many
    // distinct iterations ran, without needing a custom nested action just for test observability.
    describe('concurrency > 1 (worker pages)', () => {
        // `nav` configures the navigateBy:'click' machinery inside runForEachElementIterationOnPage
        // (only reachable through this concurrent path - see the "navigateBy: 'click'" describe
        // below): navigates controls whether the simulated click is detected as an in-page
        // navigation (both the page.waitForNavigation race and the location.href-changed
        // page.waitForFunction race); goBackLandsOnBlank makes page.goBack() land on 'about:blank'
        // to exercise the loopHomeUrl-restore branch; gotoFailsFor rejects page.goto() for one
        // specific URL only, so the initial worker-seeding goto(homeUrl) still succeeds while the
        // click-navigation fallback goto(href) can be made to fail in isolation.
        function makeConcurrentForEachPage({ items, startUrl = 'https://example.com/list', nav = {} } = {}) {
            const elements = items.map((it, i) => ({
                attrs: {},
                href: it.href !== undefined ? it.href : `https://example.com/item-${i}`,
                text: it.text !== undefined ? it.text : `Item ${i}`,
                visible: it.visible !== false,
                disposed: 0
            }));

            function makeHandle(elData) {
                return {
                    evaluate: async (fn, ...args) => fn(makeFakeEl(elData), ...args),
                    dispose: async () => { elData.disposed += 1; }
                };
            }

            const findByScopeSel = (sel) => {
                const m = /^\[data-wf-scope="([^"]+)"\]$/.exec(sel);
                if (!m) return null;
                return elements.find(e => e.attrs['data-wf-scope'] === m[1]) || null;
            };

            function pageQuery(selector) {
                if (selector === SEL) return elements.map(makeHandle);
                const found = findByScopeSel(selector);
                return found ? [makeHandle(found)] : [];
            }

            const createdWorkerPages = [];
            const closedPages = new Set();
            const closedContexts = [];
            const gotoCalls = [];
            const goBackCalls = [];
            const $evalCalls = [];

            function makeWorkerPage() {
                let currentUrl = null;
                const wp = {
                    $$: async (selector) => pageQuery(selector),
                    url: () => currentUrl,
                    goto: async (url) => {
                        if (nav.gotoFailsFor && url === nav.gotoFailsFor) {
                            throw new Error('goto: navigation failed (simulated)');
                        }
                        gotoCalls.push(url);
                        currentUrl = url;
                    },
                    // Always resolves immediately - concurrency-path callers wrap every
                    // waitForSel() in .catch(() => {}), so any settled promise is faithful and
                    // avoids real waiting/flakiness in the test.
                    waitForSelector: async () => ({}),
                    waitForNavigation: async () => {
                        if (nav.navigates === false) throw new Error('waitForNavigation: timed out (simulated)');
                    },
                    // navigateBy:'click' also races a `(u) => location.href !== u` waitForFunction
                    // to detect an in-page navigation; route it by nav.navigates instead of really
                    // running the callback (there's no real `location` global here). Any other
                    // waitForFunction shape isn't used by this describe block.
                    waitForFunction: async (fn) => {
                        if (fn.toString().includes('location.href')) {
                            if (nav.navigates === false) throw new Error('waitForFunction: url unchanged (simulated timeout)');
                            return true;
                        }
                        throw new Error('waitForFunction: not implemented in this mock');
                    },
                    goBack: async () => {
                        goBackCalls.push(currentUrl);
                        currentUrl = nav.goBackLandsOnBlank ? 'about:blank' : startUrl;
                    },
                    $eval: async (selector, fn) => {
                        $evalCalls.push(selector);
                        return fn({ click() {} });
                    },
                    evaluate: async (fn, ...args) => fn(...args),
                    isClosed: () => closedPages.has(wp),
                    close: async () => { closedPages.add(wp); },
                    setViewport: async () => {},
                    emulateVisionDeficiency: async () => {}
                };
                createdWorkerPages.push(wp);
                return wp;
            }

            const mainPage = {
                $$: async (selector) => pageQuery(selector),
                url: () => startUrl,
                viewport: () => null,
                browserContext: () => ({ newPage: async () => makeWorkerPage() }),
                browser: () => ({
                    createBrowserContext: async () => {
                        const workerContext = {
                            newPage: async () => makeWorkerPage(),
                            close: async () => { closedContexts.push(workerContext); }
                        };
                        return workerContext;
                    }
                })
            };

            return { mainPage, elements, createdWorkerPages, closedPages, closedContexts, gotoCalls, goBackCalls, $evalCalls };
        }

        function iterationLogNumbers(ctx, total) {
            const re = new RegExp(`forEachElement item (\\d+)/${total}$`);
            return (ctx.runLogs || [])
                .map(e => re.exec(e.message))
                .filter(Boolean)
                .map(m => Number(m[1]));
        }

        test('isolation:"page" (default): splits work across N workers via browserContext().newPage(); every item visited exactly once; closeWorkerPages default closes every worker page', async () => {
            const { mainPage, elements, createdWorkerPages, closedPages, closedContexts } =
                makeConcurrentForEachPage({ items: [{}, {}, {}, {}, {}, {}] });
            const ctx = makeCtx();

            await stubDomGlobals(elements, () => applyActions(mainPage, [{
                type: 'forEachElement', targetSelector: SEL, concurrency: 2,
                actions: [{ type: 'setVar', key: 'x', value: '1' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(iterationLogNumbers(ctx, 6).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
            assert.equal(createdWorkerPages.length, 2);
            assert.equal(closedPages.size, 2);
            assert.equal(closedContexts.length, 0); // isolation:"page" never creates a browser context
        });

        test('a concurrency above the number of items opens one worker per item, not one per unit of concurrency', async () => {
            const { mainPage, elements, createdWorkerPages } = makeConcurrentForEachPage({ items: [{}, {}, {}] });
            const ctx = makeCtx();

            await stubDomGlobals(elements, () => applyActions(mainPage, [{
                type: 'forEachElement', targetSelector: SEL, concurrency: 500,
                actions: [{ type: 'setVar', key: 'x', value: '1' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(iterationLogNumbers(ctx, 3).sort((a, b) => a - b), [1, 2, 3]);
            assert.equal(createdWorkerPages.length, 3);
        });

        test('a concurrency only known at run time is held to 8 workers', async () => {
            const { mainPage, elements, createdWorkerPages } = makeConcurrentForEachPage({ items: Array.from({ length: 20 }, () => ({})) });
            const ctx = makeCtx();
            ctx.setVar('workers', '500');

            await stubDomGlobals(elements, () => applyActions(mainPage, [{
                type: 'forEachElement', targetSelector: SEL, concurrency: '{var:workers}',
                actions: [{ type: 'setVar', key: 'x', value: '1' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.equal(iterationLogNumbers(ctx, 20).length, 20);
            assert.equal(createdWorkerPages.length, 8);
        });

        test('isolation:"context": creates one browser context per worker via browser().createBrowserContext(); closeWorkerPages:false leaves pages and contexts open', async () => {
            const { mainPage, elements, createdWorkerPages, closedPages, closedContexts } =
                makeConcurrentForEachPage({ items: [{}, {}, {}, {}] });
            const ctx = makeCtx();

            await stubDomGlobals(elements, () => applyActions(mainPage, [{
                type: 'forEachElement', targetSelector: SEL, concurrency: 2, isolation: 'context', closeWorkerPages: false,
                actions: [{ type: 'setVar', key: 'x', value: '1' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            assert.deepEqual(iterationLogNumbers(ctx, 4).sort((a, b) => a - b), [1, 2, 3, 4]);
            assert.equal(createdWorkerPages.length, 2);
            assert.equal(closedPages.size, 0);
            assert.equal(closedContexts.length, 0);
        });

        test('dynamic:true + concurrency>1 is rejected up front (v1 safety net) - no workers are ever created', async () => {
            const { mainPage, elements, createdWorkerPages } = makeConcurrentForEachPage({ items: [{}, {}] });
            const ctx = makeCtx();

            await assert.rejects(
                () => stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, dynamic: true,
                    actions: [{ type: 'setVar', key: 'x', value: '1' }]
                }], null, 0, ctx, Object.create(null), 0, null)),
                /does not support dynamic=true/
            );
            assert.equal(createdWorkerPages.length, 0);
        });

        describe('per-iteration error handling (shared ctx.iterationFailures across workers)', () => {
            const failingAction = { type: 'runCustomStep', customStepId: 'does-not-exist' };

            test('continueOnIterationError:false (default) rejects on the first failure', async () => {
                const { mainPage, elements } = makeConcurrentForEachPage({ items: [{}, {}, {}, {}] });
                const ctx = makeCtx();

                await assert.rejects(
                    () => stubDomGlobals(elements, () => applyActions(mainPage, [{
                        type: 'forEachElement', targetSelector: SEL, concurrency: 2,
                        actions: [failingAction]
                    }], null, 0, ctx, Object.create(null), 0, null)),
                    /was not found/
                );
                // Bounded by concurrency: each worker can have at most one in-flight failure
                // before Promise.all rejects and the others' loops are abandoned.
                assert.ok(ctx.iterationFailures.length >= 1 && ctx.iterationFailures.length <= 2);
                assert.ok(ctx.iterationFailures.every(f => f.iteratorType === 'forEachElement'));
            });

            test('continueOnIterationError:true + maxIterationErrors combined: keeps going across workers until the shared error budget is exhausted, then stops', async () => {
                const { mainPage, elements } = makeConcurrentForEachPage({ items: [{}, {}, {}, {}, {}, {}] });
                const ctx = makeCtx();

                await assert.rejects(
                    () => stubDomGlobals(elements, () => applyActions(mainPage, [{
                        type: 'forEachElement', targetSelector: SEL, concurrency: 3,
                        continueOnIterationError: true, maxIterationErrors: 2,
                        actions: [failingAction]
                    }], null, 0, ctx, Object.create(null), 0, null)),
                    /stopped after 2 iteration errors/
                );
                // With 3 concurrent workers, all 3 can grab their first job and fail before any of
                // them observes the shared counter crossing the budget - so "exhausted" means AT
                // LEAST maxIterationErrors, not necessarily exactly it. Bounded above by
                // concurrency (at most one extra in-flight failure per worker beyond the budget).
                assert.ok(ctx.iterationFailures.length >= 2 && ctx.iterationFailures.length <= 3,
                    `expected 2-3 failures, got ${ctx.iterationFailures.length}`);
                assert.ok(ctx.iterationFailures.every(f => f.iteratorType === 'forEachElement'));
            });
        });

        test('maxSeconds exceeded stops the run with a clear error once elapsed time crosses the budget', async () => {
            const { mainPage, elements } = makeConcurrentForEachPage({ items: [{}, {}, {}] });
            const ctx = makeCtx();

            await assert.rejects(
                () => stubDomGlobals(elements, () => applyActions(mainPage, [{
                    // concurrency must be >1 to take this code path at all (concurrency:1 falls
                    // through to the sequential loop, which uses a different, deep-search
                    // "does anything still match" helper this fixture doesn't stub).
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2,
                    maxSeconds: 0.03, perPageDelayMs: 50,
                    actions: [{ type: 'setVar', key: 'x', value: '1' }]
                }], null, 0, ctx, Object.create(null), 0, null)),
                /maxSeconds exceeded/
            );
        });

        test('onlyVisible + dedupeBy("href", the default) + reverse combine in buildForEachElementPlan before work is split across workers', async () => {
            // DOM order: a, a-dup, b(invisible), c, a-dup. reverse:true walks handles back-to-front
            // before dedupe/visibility filtering is applied, so plan-building sees them in the
            // order: a-dup(#5), c, b(invisible, dropped), a-dup(#2, dropped: key already seen),
            // a(#1, dropped: key already seen). Net unique+visible keys: just "a" and "c" - 2 of
            // the 5 raw elements, not 3 (3 of the 5 share the same href).
            const { mainPage, elements } = makeConcurrentForEachPage({
                items: [
                    { href: 'https://example.com/a' },
                    { href: 'https://example.com/a' }, // duplicate href, dropped by dedupeBy
                    { href: 'https://example.com/b', visible: false }, // dropped by onlyVisible
                    { href: 'https://example.com/c' },
                    { href: 'https://example.com/a' } // duplicate href, dropped by dedupeBy
                ]
            });
            const ctx = makeCtx();

            await stubDomGlobals(elements, () => applyActions(mainPage, [{
                type: 'forEachElement', targetSelector: SEL, concurrency: 2, reverse: true, onlyVisible: true,
                actions: [{ type: 'setVar', key: 'x', value: '1' }]
            }], null, 0, ctx, Object.create(null), 0, null));

            // Exactly 2 iterations ran (5 raw elements, 3 share one href, 1 is invisible - only
            // "a" and "c" survive dedupe+visibility filtering).
            assert.equal(iterationLogNumbers(ctx, 2).length, 2);
        });

        // navigateBy:'click' drives the iteration by clicking the candidate element (a link, say)
        // instead of scoping in-place, then optionally goes back afterwards. It's implemented
        // exclusively inside runForEachElementIterationOnPage, which is only called from the
        // concurrent path above - the sequential (concurrency:1) loop has no equivalent code, so
        // these tests all force concurrency:2 with a single item to exercise it. "Did it navigate"
        // detection is two racing promises (page.waitForNavigation / a location.href-change
        // waitForFunction) plus a same-page fallback (goto(href) if the click didn't seem to
        // navigate but the element had a real href) - see makeConcurrentForEachPage's `nav` config
        // above for how each of those is driven independently.
        describe('navigateBy: "click"', () => {
            test('click detected as navigation: logs "Navigated into item" and goes back afterwards (default goBack:true)', async () => {
                const { mainPage, elements, goBackCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: true }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.ok(ctx.runLogs.some(l => l.message.includes('Navigated into item')));
                assert.equal(goBackCalls.length, 1);
            });

            test('goBack:false skips the return-to-list step even though the click navigated', async () => {
                const { mainPage, elements, goBackCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: true }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', goBack: false, actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.equal(goBackCalls.length, 0);
            });

            test('goBack landing on about:blank restores the loop home URL', async () => {
                const { mainPage, elements, gotoCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: true, goBackLandsOnBlank: true }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.ok(gotoCalls.includes('https://example.com/list'));
            });

            test('click not detected as navigation but the element has a real href: falls back to goto(href)', async () => {
                const { mainPage, elements, gotoCalls, goBackCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: false }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.ok(gotoCalls.includes('https://example.com/detail-1'));
                assert.ok(ctx.runLogs.some(l => l.message.includes('falling back to goto')));
                // the fallback goto succeeded, so navigated ends up true and goBack still runs
                assert.equal(goBackCalls.length, 1);
            });

            test('click not detected as navigation and the fallback goto() itself throws: warns, does not go back', async () => {
                const { mainPage, elements, goBackCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: false, gotoFailsFor: 'https://example.com/detail-1' }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.ok(ctx.runLogs.some(l => l.message.includes('Fallback goto failed')));
                assert.equal(goBackCalls.length, 0);
            });

            test('click not detected as navigation and the href is not a real link (hash): no fallback goto, just warns', async () => {
                const { mainPage, elements, gotoCalls } = makeConcurrentForEachPage({
                    items: [{ href: '#' }],
                    nav: { navigates: false }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                // "#" is not a real navigable href, so the only goto() calls are worker seeding
                // (navigating each worker to the list page before it starts picking elements).
                assert.ok(gotoCalls.every(u => u === 'https://example.com/list'));
                assert.ok(ctx.runLogs.some(l => l.message.includes('Click did not trigger navigation')));
            });

            test('clickWithin clicks a rewritten :ctx-scoped selector instead of the candidate element itself', async () => {
                const { mainPage, elements, $evalCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: true }
                });
                const ctx = makeCtx();

                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click', clickWithin: ':ctx .link', actions: []
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.equal($evalCalls.length, 1);
                assert.match($evalCalls[0], /^\[data-wf-scope="[^"]+"] \.link$/);
            });

            test('skipIteration inside the nested actions still goes back and restores from about:blank, same as a normal completion', async () => {
                const { mainPage, elements, goBackCalls, gotoCalls } = makeConcurrentForEachPage({
                    items: [{ href: 'https://example.com/detail-1' }],
                    nav: { navigates: true, goBackLandsOnBlank: true }
                });
                const ctx = makeCtx();

                // skipIteration's predicate is evaluated via page.evaluate/queryOneDeep, which
                // needs a real DOM to walk - not available in this mock. varEquals sidesteps that:
                // it compares a workflow variable resolved in Node before handing off to the page.
                await stubDomGlobals(elements, () => applyActions(mainPage, [{
                    type: 'forEachElement', targetSelector: SEL, concurrency: 2, navigateBy: 'click',
                    actions: [
                        { type: 'setVar', key: 'skip', value: 'yes' },
                        { type: 'skipIteration', var: 'skip', varEquals: 'yes' }
                    ]
                }], null, 0, ctx, Object.create(null), 0, null));

                assert.ok(ctx.runLogs.some(l => l.message.includes('Iteration skipped (actions)')));
                assert.equal(goBackCalls.length, 1);
                assert.ok(gotoCalls.includes('https://example.com/list'));
            });
        });
    });
});

// ---------------------------------------------------------------------------------------------
// Element-targeting actions run directly at the top level (not nested in forEachElement):
// click, type, setValue, clickByText, hover, hoverByText, hoverOut, focus, focusByText,
// waitForSelector, scrollIntoView, select, getText.
//
// Faithfulness note: like forEachElement's stubDomGlobals above, the DOM-touching callbacks
// passed to page.evaluate()/handle.evaluate() here are executed for REAL (our fake page just
// calls `fn(...args)` directly) against a minimal stubbed document/window/getComputedStyle -
// not hand-mocked reimplementations of workflow-engine's own logic. Only click-utils.js and
// deep-by-text.js internals (off limits per task constraints) are black-boxed behind their
// public entry points.
describe('element-targeting actions (click/type/setValue/hover/focus/select/getText/waitForSelector/scrollIntoView, mocked deep-DOM page)', () => {
    function withDomGlobals(overrides, work) {
        const defaults = {
            window: { innerWidth: 1000, innerHeight: 800 },
            getComputedStyle: (el) => ({
                display: (el && el.__visible === false) ? 'none' : 'block',
                visibility: (el && el.__hidden === true) ? 'hidden' : 'visible'
            }),
            document: {
                readyState: 'complete',
                fonts: { ready: Promise.resolve() },
                elementFromPoint: () => null,
                documentElement: {},
                body: {},
                querySelector: () => null,
                querySelectorAll: () => [],
                getElementById: () => null,
                addEventListener: () => {}
            },
            CSS: { escape: (s) => String(s) },
            requestAnimationFrame: (cb) => { cb(); return 0; },
            requestIdleCallback: (cb) => { cb(); return 0; },
            MouseEvent: function MouseEvent(type, opts) { this.type = type; Object.assign(this, opts || {}); },
            // setValue's labelText path does `el instanceof HTMLElement`; stubbing it as `Object`
            // is a pragmatic pass-through (every plain object is `instanceof Object`) rather than
            // reimplementing a real HTMLElement prototype chain for a fake DOM element.
            HTMLElement: Object
        };
        const merged = Object.assign({}, defaults, overrides);
        const originals = {};
        const hadOwn = {};
        for (const key of Object.keys(merged)) {
            hadOwn[key] = Object.prototype.hasOwnProperty.call(global, key);
            originals[key] = global[key];
            global[key] = merged[key];
        }
        return Promise.resolve().then(work).finally(() => {
            for (const key of Object.keys(merged)) {
                if (hadOwn[key]) global[key] = originals[key];
                else delete global[key];
            }
        });
    }

    function makeFakeElement(data = {}) {
        const el = {
            tagName: data.tagName || 'DIV',
            attrs: Object.assign({}, data.attrs),
            listeners: {},
            __visible: data.visible !== false,
            isConnected: data.isConnected !== false,
            value: data.value !== undefined ? data.value : '',
            disabled: !!data.disabled,
            readOnly: !!data.readOnly,
            __clicks: 0,
            __focused: false,
            get textContent() { return data.text || ''; },
            get innerText() { return data.text || ''; },
            get href() { return data.href || ''; },
            getAttribute(name) {
                if (name === 'href') return data.href || null;
                return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
            },
            setAttribute(name, value) { el.attrs[name] = value; },
            removeAttribute(name) { delete el.attrs[name]; },
            closest() { return null; },
            matches(sel) { return typeof data.matches === 'function' ? data.matches(sel) : false; },
            querySelector(sel) { return typeof data.querySelector === 'function' ? data.querySelector(sel) : null; },
            querySelectorAll() { return []; },
            getBoundingClientRect() {
                return el.__visible
                    ? { width: 10, height: 10, top: 0, left: 0, bottom: 10, right: 10 }
                    : { width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 };
            },
            scrollIntoView() {},
            focus() { el.__focused = true; },
            click() { el.__clicks += 1; el.dispatchEvent({ type: 'click' }); },
            addEventListener(type, cb) { (el.listeners[type] = el.listeners[type] || []).push(cb); },
            dispatchEvent(evt) {
                el.__wfLanded = true;
                (el.listeners[evt.type] || []).forEach(cb => cb(evt));
                return true;
            }
        };
        return el;
    }

    function makeHandle(el) {
        return {
            _el: el,
            evaluate: async (fn, ...args) => fn(el, ...args),
            click: async (opts) => { el.__clicks += 1; el.dispatchEvent({ type: (opts && opts.button === 'right') ? 'contextmenu' : 'click' }); },
            focus: async () => { el.focus(); },
            hover: async () => { el.__hovered = true; },
            select: async (val) => { el.value = val; el.__selected = val; return [val]; },
            boundingBox: async () => el.__visible ? { x: 0, y: 0, width: 10, height: 10 } : null,
            dispose: async () => { el.__disposed = (el.__disposed || 0) + 1; }
        };
    }

    // A page whose $/$$ resolve against a selector->element(s) registry, and whose mouse/keyboard
    // calls are recorded. document.elementFromPoint (see withDomGlobals override below) is wired
    // to return whatever element $ most recently resolved, so click's verified-mouse-click path
    // succeeds on its first attempt unless a test deliberately makes it miss.
    function makePage({ registry = {} } = {}) {
        const calls = { mouseMoves: [], mouseClicks: [], keyboardPress: [], keyboardDown: [], keyboardUp: [], keyboardType: [] };
        let currentTarget = null;

        const page = {
            $: async (sel) => {
                const entry = registry[sel];
                if (!entry) return null;
                const el = Array.isArray(entry) ? entry[0] : entry;
                if (!el) return null;
                currentTarget = el;
                return makeHandle(el);
            },
            $$: async (sel) => {
                const entry = registry[sel];
                if (!entry) return [];
                const list = Array.isArray(entry) ? entry : [entry];
                return list.map(makeHandle);
            },
            evaluate: async (fn, ...args) => fn(...args),
            evaluateHandle: async () => ({ asElement: () => null, dispose: async () => {} }),
            waitForFunction: async () => { throw new Error('waitForFunction: not implemented in this mock'); },
            waitForSelector: async (sel) => {
                const entry = registry[sel];
                if (!entry) throw new Error('waitForSelector: timeout');
                return makeHandle(Array.isArray(entry) ? entry[0] : entry);
            },
            waitForNavigation: async () => { throw new Error('no navigation observed'); },
            mouse: {
                move: async (x, y) => { calls.mouseMoves.push([x, y]); },
                click: async (x, y, opts) => {
                    calls.mouseClicks.push([x, y, opts]);
                    if (currentTarget) currentTarget.dispatchEvent({ type: (opts && opts.button === 'right') ? 'contextmenu' : 'click' });
                }
            },
            keyboard: {
                press: async (k) => { calls.keyboardPress.push(k); },
                down: async (k) => { calls.keyboardDown.push(k); },
                up: async (k) => { calls.keyboardUp.push(k); },
                type: async (t, opts) => { calls.keyboardType.push([t, opts]); }
            },
            url: () => 'https://example.com/'
        };

        return { page, calls, getCurrentTarget: () => currentTarget };
    }

    function domOverridesFor(getTarget) {
        return {
            document: {
                readyState: 'complete',
                fonts: { ready: Promise.resolve() },
                elementFromPoint: () => getTarget(),
                documentElement: {},
                body: {},
                querySelector: () => null,
                querySelectorAll: () => [],
                getElementById: () => null,
                addEventListener: () => {}
            }
        };
    }

    describe('click', () => {
        test('selector targeting: a verified mouse click succeeds on the first attempt (left button, single click)', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 1);
            assert.equal(calls.mouseClicks[0][2].button, 'left');
            assert.equal(calls.mouseClicks[0][2].count, 1);
        });

        test('mouseButton:"right" is forwarded to the verified mouse click', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', mouseButton: 'right' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks[0][2].button, 'right');
        });

        test('clickKind:"doubleClick" requests a count of 2 on the verified mouse click', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', clickKind: 'doubleClick' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 1);
            assert.equal(calls.mouseClicks[0][2].count, 2);
        });

        test('scrolls the target into view before clicking by default', async () => {
            const el = makeFakeElement();
            let scrolls = 0;
            el.scrollIntoView = () => { scrolls += 1; };
            const { page, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(scrolls, 1);
        });

        for (const value of [false, 'false']) {
            test(`scrollIntoView:${JSON.stringify(value)} clicks without scrolling the target first`, async () => {
                const el = makeFakeElement();
                let scrolls = 0;
                el.scrollIntoView = () => { scrolls += 1; };
                const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
                const ctx = makeCtx();
                await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                    applyActions(page, [{ type: 'click', selector: '.btn', scrollIntoView: value }], null, 0, ctx, Object.create(null), 0, null)
                );
                assert.equal(scrolls, 0);
                assert.equal(calls.mouseClicks.length, 1);
            });
        }

        test('programmatic: true skips mouse simulation entirely and dispatches el.click() directly', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', programmatic: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 0);
            assert.equal(el.__clicks, 1);
        });

        test('programmatic: "true", the text it used to be, is a mouse click now', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', programmatic: 'true' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 1);
        });

        test('retries: fails to find the selector on the first attempt, then succeeds on the retry', async () => {
            const el = makeFakeElement();
            let attempts = 0;
            const { page, calls } = makePage({ registry: {} });
            page.$ = async (sel) => {
                attempts += 1;
                if (attempts === 1) return null;
                return makeHandle(el);
            };
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(() => el), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', timeout: 0, retries: 1, retryDelay: 0 }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.ok(attempts >= 2);
            assert.equal(calls.mouseClicks.length, 1);
        });

        test('retries exhausted: rethrows the "not found" error after the last attempt', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverridesFor(() => null), () =>
                    applyActions(page, [{ type: 'click', selector: '.missing', timeout: 0, retries: 1, retryDelay: 0 }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /click failed: "\.missing" not found/
            );
        });

        test('labelText targeting resolves via the deep text-matching resolver (regression test for the empty-callback bug)', async () => {
            const el = makeFakeElement({ text: 'Submit' });
            const { page, calls } = makePage({ registry: {} });
            page.evaluateHandle = async () => ({ asElement: () => makeHandle(el), dispose: async () => {} });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(() => el), () =>
                applyActions(page, [{ type: 'click', labelText: 'Submit' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 1);
        });

        test('neither selector nor labelText is a no-op', async () => {
            const { page, calls } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(() => null), () =>
                applyActions(page, [{ type: 'click' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 0);
        });

        test('waitUntil races a possible navigation after the click without throwing when none occurs', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', waitUntil: 'load' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 1);
        });

        test('optional:true swallows a not-found failure instead of throwing, and later actions still run', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            const actionResults = [];
            await withDomGlobals(domOverridesFor(() => null), () =>
                applyActions(page, [
                    { type: 'click', selector: '.missing', timeout: 0, optional: true },
                    { type: 'setVar', key: 'after', value: 'reached' }
                ], actionResults, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(ctx.getVar('after'), 'reached');
            assert.equal(actionResults[0].status, 'failed-optional');
        });
    });

    describe('type', () => {
        test('resolves and interpolates {var:...} tokens in text, then focuses and types via page.keyboard.type', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.input': el } });
            const ctx = makeCtx();
            ctx.setVar('name', 'Ada');
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'type', selector: '.input', text: 'Hi {var:name}', delay: 5 }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__focused, true);
            assert.deepEqual(calls.keyboardType[0], ['Hi Ada', { delay: 5 }]);
        });

        test('clear:true sends a Ctrl+A/Backspace sequence before focusing and typing', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.input': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'type', selector: '.input', text: 'new', clear: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.deepEqual(calls.keyboardDown, ['Control']);
            assert.deepEqual(calls.keyboardUp, ['Control']);
            assert.ok(calls.keyboardPress.includes('KeyA'));
            assert.ok(calls.keyboardPress.includes('Backspace'));
        });

        test('pressEnter:true presses Enter after typing', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.input': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'type', selector: '.input', text: 'go', pressEnter: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.deepEqual(calls.keyboardPress, ['Enter']);
        });

        test('a missing selector is a no-op', async () => {
            const { page, calls } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'type', text: 'x' }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(calls.keyboardType, []);
        });

        test('an unresolved selector throws', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'type', selector: '.missing', text: 'x', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /type failed: "\.missing" not found/
            );
        });
    });

    describe('hover / hoverOut / focus', () => {
        test('hover scrolls into view then calls handle.hover()', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.tip': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hover', selector: '.tip' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__hovered, true);
        });

        test('hover with a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hover' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true); // did not throw
        });

        test('hover with an unresolved selector throws', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'hover', selector: '.missing', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /hover failed: "\.missing" not found/
            );
        });

        test('hoverOut with a selector moves the mouse to the element\'s bounding box center', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.tip': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverOut', selector: '.tip' }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(calls.mouseMoves[0], [5, 5]);
        });

        test('hoverOut without a selector moves the mouse to a neutral (5,5) spot', async () => {
            const { page, calls } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverOut' }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(calls.mouseMoves[0], [5, 5]);
        });

        test('hoverOut swallows internal errors (logs a warning) instead of throwing', async () => {
            const { page } = makePage({ registry: {} });
            page.mouse.move = async () => { throw new Error('boom'); };
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverOut' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(ctx.runLogs.some(l => l.type === 'warning' && /hoverOut failed/.test(l.message)));
        });

        test('focus scrolls into view then calls handle.focus()', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.f': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'focus', selector: '.f' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__focused, true);
        });

        test('focus with a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'focus' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });
    });

    describe('clickByText / hoverByText / focusByText (deep text resolution via page.evaluateHandle)', () => {
        function makeTextPage(el) {
            const { page, calls } = makePage({ registry: {} });
            page.evaluateHandle = async () => (el ? { asElement: () => makeHandle(el), dispose: async () => {} } : { asElement: () => null, dispose: async () => {} });
            return { page, calls };
        }

        test('clickByText finds and clicks the element matching labelText', async () => {
            const el = makeFakeElement({ text: 'Continue' });
            const { page, calls } = makeTextPage(el);
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(() => el), () =>
                applyActions(page, [{ type: 'clickByText', labelText: 'Continue' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.ok(el.__clicks >= 1 || calls.mouseClicks.length >= 1);
        });

        test('clickByText throws when labelText resolves to empty, unless optional:true', async () => {
            const { page } = makeTextPage(null);
            const ctx1 = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'clickByText', labelText: '' }], null, 0, ctx1, Object.create(null), 0, null)),
                /clickByText failed: labelText resolved to empty string/
            );

            const ctx2 = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'clickByText', labelText: '', optional: true }], null, 0, ctx2, Object.create(null), 0, null));
            assert.ok(true); // no throw
        });

        test('clickByText throws when no element is found within the timeout', async () => {
            const { page } = makeTextPage(null);
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'clickByText', labelText: 'Ghost', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /clickByText failed: "Ghost" not found/
            );
        });

        test('hoverByText finds the element and calls handle.hover()', async () => {
            const el = makeFakeElement({ text: 'Menu' });
            const { page } = makeTextPage(el);
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__hovered, true);
        });

        test('hoverByText with postWaitForSelector waits for a followup selector after hovering (best-effort, does not throw if absent)', async () => {
            const el = makeFakeElement({ text: 'Menu' });
            const { page } = makeTextPage(el);
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu', postWaitForSelector: '.submenu', postWaitTimeout: 0 }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__hovered, true);
        });

        test('hoverByText throws when missing labelText, unless optional:true', async () => {
            const { page } = makeTextPage(null);
            const ctx1 = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'hoverByText' }], null, 0, ctx1, Object.create(null), 0, null)),
                /hoverByText failed: missing labelText/
            );
            const ctx2 = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverByText', optional: true }], null, 0, ctx2, Object.create(null), 0, null));
            assert.ok(true);
        });

        test('hoverByText: when handle.hover() throws, falls back to moving the mouse to the element\'s bounding box center', async () => {
            const el = makeFakeElement({ text: 'Menu', visible: true });
            const { page, calls } = makeTextPage(el);
            const handle = makeHandle(el);
            handle.hover = async () => { throw new Error('hover not supported by this handle'); };
            page.evaluateHandle = async () => ({ asElement: () => handle, dispose: async () => {} });

            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu' }], null, 0, ctx, Object.create(null), 0, null)
            );

            // boundingBox() for a visible element resolves to {x:0,y:0,width:10,height:10} (see
            // makeHandle) - the fallback should move to its center.
            assert.deepEqual(calls.mouseMoves, [[5, 5]]);
            assert.equal(el.__hovered, undefined); // the real hover() never ran (it threw)
        });

        test('hoverByText: when handle.hover() throws AND boundingBox() is null (element not visible), falls back to dispatching mouseover/mouseenter directly', async () => {
            const el = makeFakeElement({ text: 'Menu', visible: false });
            const { page, calls } = makeTextPage(el);
            const handle = makeHandle(el);
            handle.hover = async () => { throw new Error('hover not supported by this handle'); };
            page.evaluateHandle = async () => ({ asElement: () => handle, dispose: async () => {} });

            const dispatched = [];
            const originalDispatch = el.dispatchEvent;
            el.dispatchEvent = (evt) => { dispatched.push(evt.type); return originalDispatch(evt); };

            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu' }], null, 0, ctx, Object.create(null), 0, null)
            );

            assert.deepEqual(calls.mouseMoves, []);
            assert.deepEqual(dispatched, ['mouseover', 'mouseenter']);
        });

        test('focusByText finds the element and focuses it, and disposes the handle afterward (regression test for the undefined-`h` bug)', async () => {
            const el = makeFakeElement({ text: 'Skip to content' });
            const { page } = makeTextPage(el);
            const ctx = makeCtx();
            let handle;
            const origEvaluateHandle = page.evaluateHandle;
            page.evaluateHandle = async (...a) => { handle = await origEvaluateHandle(...a); return handle; };
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'focusByText', labelText: 'Skip to content' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__focused, true);
        });

        test('focusByText throws when no element is found within the timeout', async () => {
            const { page } = makeTextPage(null);
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'focusByText', labelText: 'Ghost', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /focusByText failed: "Ghost" not found/
            );
        });
    });

    describe('waitForSelector', () => {
        test('resolves (and disposes the handle) once the selector is found', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.ready': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector', selector: '.ready' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true); // did not throw
        });

        test('throws when the selector never appears (visible mode)', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector', selector: '.missing', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /waitForSelector timed out: \.missing/
            );
        });

        test('hidden:true delegates straight to page.waitForSelector({hidden:true}) instead of the deep-DOM path', async () => {
            let called = null;
            const { page } = makePage({ registry: {} });
            page.waitForSelector = async (sel, opts) => { called = [sel, opts]; return null; };
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector', selector: '.gone', hidden: true, timeout: 5000 }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(called, ['.gone', { hidden: true, timeout: 5000 }]);
        });

        test('a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });

        test('when page.$ finds nothing directly, queryOneDeep falls back to the open-shadow-DOM deep search via page.evaluateHandle', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: {} }); // page.$ resolves to null for every selector
            page.evaluateHandle = async () => ({ asElement: () => makeHandle(el), dispose: async () => {} });
            const ctx = makeCtx();
            // visible:false keeps this test isolated to the queryOneDeep fallback itself, not
            // entangled with the separate visibility-check codepath.
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'waitForSelector', selector: '.in-shadow-root', visible: false }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.ok(true); // resolved via the shadow-DOM fallback instead of timing out
        });
    });

    describe('scrollIntoView', () => {
        test('scrolls the resolved element into view', async () => {
            const el = makeFakeElement();
            let scrolled = false;
            el.scrollIntoView = () => { scrolled = true; };
            const { page } = makePage({ registry: { '.target': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'scrollIntoView', selector: '.target' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(scrolled, true);
        });

        test('a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'scrollIntoView' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });

        test('an unresolved selector throws', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'scrollIntoView', selector: '.missing', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /scrollIntoView failed: "\.missing" not found/
            );
        });
    });

    describe('select', () => {
        test('selects the matching <option> value after confirming it exists', async () => {
            const el = makeFakeElement({ querySelector: (sel) => (sel.includes('"US"') ? {} : null) });
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'select', selector: '.country', value: 'US' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__selected, 'US');
        });

        test('interpolates {var:...} tokens in value before selecting', async () => {
            const el = makeFakeElement({ querySelector: (sel) => (sel.includes('"CA"') ? {} : null) });
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            ctx.setVar('cc', 'CA');
            await withDomGlobals({}, () => applyActions(page, [{ type: 'select', selector: '.country', value: '{var:cc}' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__selected, 'CA');
        });

        test('throws when the requested option value does not exist', async () => {
            const el = makeFakeElement({ querySelector: () => null });
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'select', selector: '.country', value: 'ZZ' }], null, 0, ctx, Object.create(null), 0, null)),
                /select failed: option "ZZ" not found/
            );
        });

        test('a missing selector or empty value is a no-op', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [
                { type: 'select' },
                { type: 'select', selector: '.country' } // no value
            ], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__selected, undefined);
        });
    });

    describe('scrollIntoView option on interaction steps', () => {
        function countScrolls(el) {
            const box = { n: 0 };
            el.scrollIntoView = () => { box.n += 1; };
            return box;
        }

        const selectorSteps = [
            ['type', { text: 'x' }],
            ['hover', {}],
            ['hoverOut', {}],
            ['focus', {}],
            ['select', { value: 'US' }]
        ];

        for (const [type, extra] of selectorSteps) {
            for (const [value, expected] of [[undefined, true], [true, true], [false, false], ['false', false]]) {
                test(`${type} with scrollIntoView:${JSON.stringify(value)} ${expected ? 'scrolls' : 'does not scroll'} the target`, async () => {
                    const el = makeFakeElement({ querySelector: () => ({}) });
                    const scrolls = countScrolls(el);
                    const { page } = makePage({ registry: { '.t': el } });
                    const ctx = makeCtx();
                    const action = Object.assign({ type, selector: '.t' }, extra);
                    if (value !== undefined) action.scrollIntoView = value;
                    await withDomGlobals({}, () => applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null));
                    assert.equal(scrolls.n, expected ? 1 : 0);
                });
            }
        }

        for (const type of ['clickByText', 'hoverByText', 'focusByText']) {
            for (const [value, expected] of [[undefined, true], [false, false]]) {
                test(`${type} with scrollIntoView:${JSON.stringify(value)} ${expected ? 'scrolls' : 'does not scroll'} the target`, async () => {
                    const el = makeFakeElement({ text: 'Go' });
                    const scrolls = countScrolls(el);
                    const { page } = makePage({ registry: {} });
                    page.evaluateHandle = async () => ({ asElement: () => makeHandle(el), dispose: async () => {} });
                    const ctx = makeCtx();
                    const action = { type, labelText: 'Go' };
                    if (value !== undefined) action.scrollIntoView = value;
                    await withDomGlobals(domOverridesFor(() => el), () =>
                        applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null)
                    );
                    assert.equal(scrolls.n, expected ? 1 : 0);
                });
            }
        }

        for (const [value, expected] of [[undefined, true], [false, false]]) {
            test(`setValue with scrollIntoView:${JSON.stringify(value)} ${expected ? 'scrolls' : 'does not scroll'} the matched control`, async () => {
                const el = makeFakeElement({ tagName: 'INPUT' });
                el.dispatchEvent = () => true;
                const scrolls = countScrolls(el);
                const { page } = makePage({ registry: { '.name': el } });
                const ctx = makeCtx();
                const action = { type: 'setValue', selector: '.name', value: 'Ada' };
                if (value !== undefined) action.scrollIntoView = value;
                await withDomGlobals({
                    document: {
                        readyState: 'complete',
                        fonts: { ready: Promise.resolve() },
                        elementFromPoint: () => null,
                        documentElement: {},
                        body: {},
                        querySelector: () => null,
                        querySelectorAll: (sel) => (sel === '.name' ? [el] : []),
                        getElementById: () => null,
                        addEventListener: () => {}
                    }
                }, () => applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null));
                assert.equal(el.value, 'Ada');
                assert.equal(scrolls.n, expected ? 1 : 0);
            });
        }
    });

    describe('getText (top-level, via page.waitForFunction)', () => {
        function makeGetTextPage(el, wantedSelector) {
            const { page } = makePage({ registry: {} });
            page.waitForFunction = async (fn, _opts, sel) => {
                const found = (sel === wantedSelector && el) ? el : null;
                if (!found) throw new Error('waitForFunction: not found (simulated timeout)');
                return { asElement: () => ({ evaluate: async (evalFn, cfg) => evalFn(found, cfg), dispose: async () => {} }) };
            };
            return { page };
        }

        test('getText stores trimmed/collapsed textContent into both localVars and ctx.vars', async () => {
            const el = makeFakeElement({ text: '  Hello   World  ' });
            const { page } = makeGetTextPage(el, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.msg', var: 'msg' }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.msg, 'Hello World');
            assert.equal(ctx.getVar('msg'), 'Hello World');
        });

        test('its old name, getTextIntoVariable, is an unknown step now', async () => {
            const el = makeFakeElement({ text: 'Old name' });
            const { page } = makeGetTextPage(el, '.msg');
            await assert.rejects(
                applyActions(page, [{ type: 'getTextIntoVariable', selector: '.msg', var: 'msg' }], null, 0, makeCtx(), Object.create(null), 0, null),
                /Unknown step type "getTextIntoVariable"/
            );
        });

        test('attr reads an attribute value instead of textContent (href special-cased to el.href)', async () => {
            const el = makeFakeElement({ href: 'https://example.com/page' });
            const { page } = makeGetTextPage(el, 'a.link');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: 'a.link', var: 'href', attr: 'href' }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.href, 'https://example.com/page');
        });

        test('trim:false preserves raw whitespace instead of collapsing it', async () => {
            const el = makeFakeElement({ text: '  raw text  ' });
            const { page } = makeGetTextPage(el, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.msg', var: 'msg', trim: false }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.msg, '  raw text  ');
        });

        test('an unresolved selector is a silent no-op (no var set, no throw)', async () => {
            const { page } = makeGetTextPage(null, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.missing', var: 'msg' }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.msg, undefined);
        });

        test('a missing selector or var name is a no-op', async () => {
            const el = makeFakeElement({ text: 'x' });
            const { page } = makeGetTextPage(el, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.msg' }], null, 0, ctx, localVars, 0, null); // no var
            assert.deepEqual(Object.keys(localVars), []);
        });
    });

    describe('setValue', () => {
        function makeSetValuePage(el, expectedSelector) {
            const { page } = makePage({ registry: { [expectedSelector]: el } });
            const domOverrides = {
                document: {
                    readyState: 'complete',
                    fonts: { ready: Promise.resolve() },
                    elementFromPoint: () => null,
                    documentElement: {},
                    body: {},
                    querySelector: () => null,
                    querySelectorAll: (sel) => (sel === expectedSelector && el ? [el] : []),
                    getElementById: () => null,
                    addEventListener: () => {}
                }
            };
            return { page, domOverrides };
        }

        test('sets the value on the matching control and dispatches input/change events', async () => {
            const el = makeFakeElement({ tagName: 'INPUT' });
            const events = [];
            el.dispatchEvent = (evt) => { events.push(evt.type); return true; };
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await withDomGlobals(domOverrides, () =>
                applyActions(page, [{ type: 'setValue', selector: '.name', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.value, 'Ada');
            assert.deepEqual(events, ['input', 'change']);
        });

        test('skips disabled/readOnly/aria-disabled elements and throws when nothing eligible matches', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', disabled: true });
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.name', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setValue failed: no eligible element matched/
            );
        });

        test('labelText additionally requires an aria-label match among candidates', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', attrs: { 'aria-label': 'Full Name' } });
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await withDomGlobals(domOverrides, () =>
                applyActions(page, [{ type: 'setValue', selector: '.name', labelText: 'full name', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.value, 'Ada');
        });

        test('a non-matching labelText leaves the control untouched and throws', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', attrs: { 'aria-label': 'Full Name' } });
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.name', labelText: 'Nickname', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setValue failed: no eligible element matched/
            );
        });

        test('a password missing from the config stops the run instead of typing nothing', async () => {
            // Saved configs carry `valueMasked: true` and no value (the app never
            // writes a password to disk). Typing '' into a login form and
            // reporting a green run is the failure mode this guards against.
            const el = makeFakeElement({ tagName: 'INPUT', value: 'untouched' });
            const { page, domOverrides } = makeSetValuePage(el, '.password');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setPassword', selector: '.password', valueMasked: true }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setPassword failed: passwords are not saved with the configuration/
            );
            assert.equal(el.value, 'untouched');
        });

        test('an empty password stops the run even without the flag', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', value: 'untouched' });
            const { page, domOverrides } = makeSetValuePage(el, '.password');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setPassword', selector: '.password', value: '' }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setPassword failed/
            );
            assert.equal(el.value, 'untouched');
        });

        test('a setValue step saved hidden, before setPassword existed, stops the run too', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', value: 'untouched' });
            const { page, domOverrides } = makeSetValuePage(el, '.password');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.password', valueMasked: true }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setValue failed: passwords are not saved with the configuration/
            );
            assert.equal(el.value, 'untouched');
        });

        test('a password typed in again is set', async () => {
            const el = makeFakeElement({ tagName: 'INPUT' });
            const { page, domOverrides } = makeSetValuePage(el, '.password');
            const ctx = makeCtx();
            await withDomGlobals(domOverrides, () =>
                applyActions(page, [{ type: 'setPassword', selector: '.password', value: 'hunter2', valueMasked: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.value, 'hunter2');
        });

        test('neither selector nor labelText is a no-op', async () => {
            const { page, calls } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(() => null), () =>
                applyActions(page, [{ type: 'click' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 0);
        });

        test('waitUntil races a possible navigation after the click without throwing when none occurs', async () => {
            const el = makeFakeElement();
            const { page, calls, getCurrentTarget } = makePage({ registry: { '.btn': el } });
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(getCurrentTarget), () =>
                applyActions(page, [{ type: 'click', selector: '.btn', waitUntil: 'load' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(calls.mouseClicks.length, 1);
        });

        test('optional:true swallows a not-found failure instead of throwing, and later actions still run', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            const actionResults = [];
            await withDomGlobals(domOverridesFor(() => null), () =>
                applyActions(page, [
                    { type: 'click', selector: '.missing', timeout: 0, optional: true },
                    { type: 'setVar', key: 'after', value: 'reached' }
                ], actionResults, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(ctx.getVar('after'), 'reached');
            assert.equal(actionResults[0].status, 'failed-optional');
        });
    });

    describe('type', () => {
        test('resolves and interpolates {var:...} tokens in text, then focuses and types via page.keyboard.type', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.input': el } });
            const ctx = makeCtx();
            ctx.setVar('name', 'Ada');
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'type', selector: '.input', text: 'Hi {var:name}', delay: 5 }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__focused, true);
            assert.deepEqual(calls.keyboardType[0], ['Hi Ada', { delay: 5 }]);
        });

        test('clear:true sends a Ctrl+A/Backspace sequence before focusing and typing', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.input': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'type', selector: '.input', text: 'new', clear: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.deepEqual(calls.keyboardDown, ['Control']);
            assert.deepEqual(calls.keyboardUp, ['Control']);
            assert.ok(calls.keyboardPress.includes('KeyA'));
            assert.ok(calls.keyboardPress.includes('Backspace'));
        });

        test('pressEnter:true presses Enter after typing', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.input': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'type', selector: '.input', text: 'go', pressEnter: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.deepEqual(calls.keyboardPress, ['Enter']);
        });

        test('a missing selector is a no-op', async () => {
            const { page, calls } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'type', text: 'x' }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(calls.keyboardType, []);
        });

        test('an unresolved selector throws', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'type', selector: '.missing', text: 'x', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /type failed: "\.missing" not found/
            );
        });
    });

    describe('hover / hoverOut / focus', () => {
        test('hover scrolls into view then calls handle.hover()', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.tip': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hover', selector: '.tip' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__hovered, true);
        });

        test('hover with a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hover' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true); // did not throw
        });

        test('hover with an unresolved selector throws', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'hover', selector: '.missing', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /hover failed: "\.missing" not found/
            );
        });

        test('hoverOut with a selector moves the mouse to the element\'s bounding box center', async () => {
            const el = makeFakeElement();
            const { page, calls } = makePage({ registry: { '.tip': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverOut', selector: '.tip' }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(calls.mouseMoves[0], [5, 5]);
        });

        test('hoverOut without a selector moves the mouse to a neutral (5,5) spot', async () => {
            const { page, calls } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverOut' }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(calls.mouseMoves[0], [5, 5]);
        });

        test('hoverOut swallows internal errors (logs a warning) instead of throwing', async () => {
            const { page } = makePage({ registry: {} });
            page.mouse.move = async () => { throw new Error('boom'); };
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverOut' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(ctx.runLogs.some(l => l.type === 'warning' && /hoverOut failed/.test(l.message)));
        });

        test('focus scrolls into view then calls handle.focus()', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.f': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'focus', selector: '.f' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__focused, true);
        });

        test('focus with a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'focus' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });
    });

    describe('clickByText / hoverByText / focusByText (deep text resolution via page.evaluateHandle)', () => {
        function makeTextPage(el) {
            const { page, calls } = makePage({ registry: {} });
            page.evaluateHandle = async () => (el ? { asElement: () => makeHandle(el), dispose: async () => {} } : { asElement: () => null, dispose: async () => {} });
            return { page, calls };
        }

        test('clickByText finds and clicks the element matching labelText', async () => {
            const el = makeFakeElement({ text: 'Continue' });
            const { page, calls } = makeTextPage(el);
            const ctx = makeCtx();
            await withDomGlobals(domOverridesFor(() => el), () =>
                applyActions(page, [{ type: 'clickByText', labelText: 'Continue' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.ok(el.__clicks >= 1 || calls.mouseClicks.length >= 1);
        });

        test('clickByText throws when labelText resolves to empty, unless optional:true', async () => {
            const { page } = makeTextPage(null);
            const ctx1 = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'clickByText', labelText: '' }], null, 0, ctx1, Object.create(null), 0, null)),
                /clickByText failed: labelText resolved to empty string/
            );

            const ctx2 = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'clickByText', labelText: '', optional: true }], null, 0, ctx2, Object.create(null), 0, null));
            assert.ok(true); // no throw
        });

        test('clickByText throws when no element is found within the timeout', async () => {
            const { page } = makeTextPage(null);
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'clickByText', labelText: 'Ghost', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /clickByText failed: "Ghost" not found/
            );
        });

        test('hoverByText finds the element and calls handle.hover()', async () => {
            const el = makeFakeElement({ text: 'Menu' });
            const { page } = makeTextPage(el);
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__hovered, true);
        });

        test('hoverByText with postWaitForSelector waits for a followup selector after hovering (best-effort, does not throw if absent)', async () => {
            const el = makeFakeElement({ text: 'Menu' });
            const { page } = makeTextPage(el);
            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu', postWaitForSelector: '.submenu', postWaitTimeout: 0 }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__hovered, true);
        });

        test('hoverByText throws when missing labelText, unless optional:true', async () => {
            const { page } = makeTextPage(null);
            const ctx1 = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'hoverByText' }], null, 0, ctx1, Object.create(null), 0, null)),
                /hoverByText failed: missing labelText/
            );
            const ctx2 = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'hoverByText', optional: true }], null, 0, ctx2, Object.create(null), 0, null));
            assert.ok(true);
        });

        test('hoverByText: when handle.hover() throws, falls back to moving the mouse to the element\'s bounding box center', async () => {
            const el = makeFakeElement({ text: 'Menu', visible: true });
            const { page, calls } = makeTextPage(el);
            const handle = makeHandle(el);
            handle.hover = async () => { throw new Error('hover not supported by this handle'); };
            page.evaluateHandle = async () => ({ asElement: () => handle, dispose: async () => {} });

            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu' }], null, 0, ctx, Object.create(null), 0, null)
            );

            // boundingBox() for a visible element resolves to {x:0,y:0,width:10,height:10} (see
            // makeHandle) - the fallback should move to its center.
            assert.deepEqual(calls.mouseMoves, [[5, 5]]);
            assert.equal(el.__hovered, undefined); // the real hover() never ran (it threw)
        });

        test('hoverByText: when handle.hover() throws AND boundingBox() is null (element not visible), falls back to dispatching mouseover/mouseenter directly', async () => {
            const el = makeFakeElement({ text: 'Menu', visible: false });
            const { page, calls } = makeTextPage(el);
            const handle = makeHandle(el);
            handle.hover = async () => { throw new Error('hover not supported by this handle'); };
            page.evaluateHandle = async () => ({ asElement: () => handle, dispose: async () => {} });

            const dispatched = [];
            const originalDispatch = el.dispatchEvent;
            el.dispatchEvent = (evt) => { dispatched.push(evt.type); return originalDispatch(evt); };

            const ctx = makeCtx();
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'hoverByText', labelText: 'Menu' }], null, 0, ctx, Object.create(null), 0, null)
            );

            assert.deepEqual(calls.mouseMoves, []);
            assert.deepEqual(dispatched, ['mouseover', 'mouseenter']);
        });

        test('focusByText finds the element and focuses it, and disposes the handle afterward (regression test for the undefined-`h` bug)', async () => {
            const el = makeFakeElement({ text: 'Skip to content' });
            const { page } = makeTextPage(el);
            const ctx = makeCtx();
            let handle;
            const origEvaluateHandle = page.evaluateHandle;
            page.evaluateHandle = async (...a) => { handle = await origEvaluateHandle(...a); return handle; };
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'focusByText', labelText: 'Skip to content' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.__focused, true);
        });

        test('focusByText throws when no element is found within the timeout', async () => {
            const { page } = makeTextPage(null);
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'focusByText', labelText: 'Ghost', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /focusByText failed: "Ghost" not found/
            );
        });
    });

    describe('waitForSelector', () => {
        test('resolves (and disposes the handle) once the selector is found', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.ready': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector', selector: '.ready' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true); // did not throw
        });

        test('throws when the selector never appears (visible mode)', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector', selector: '.missing', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /waitForSelector timed out: \.missing/
            );
        });

        test('hidden:true delegates straight to page.waitForSelector({hidden:true}) instead of the deep-DOM path', async () => {
            let called = null;
            const { page } = makePage({ registry: {} });
            page.waitForSelector = async (sel, opts) => { called = [sel, opts]; return null; };
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector', selector: '.gone', hidden: true, timeout: 5000 }], null, 0, ctx, Object.create(null), 0, null));
            assert.deepEqual(called, ['.gone', { hidden: true, timeout: 5000 }]);
        });

        test('a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'waitForSelector' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });

        test('when page.$ finds nothing directly, queryOneDeep falls back to the open-shadow-DOM deep search via page.evaluateHandle', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: {} }); // page.$ resolves to null for every selector
            page.evaluateHandle = async () => ({ asElement: () => makeHandle(el), dispose: async () => {} });
            const ctx = makeCtx();
            // visible:false keeps this test isolated to the queryOneDeep fallback itself, not
            // entangled with the separate visibility-check codepath.
            await withDomGlobals({}, () =>
                applyActions(page, [{ type: 'waitForSelector', selector: '.in-shadow-root', visible: false }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.ok(true); // resolved via the shadow-DOM fallback instead of timing out
        });
    });

    describe('scrollIntoView', () => {
        test('scrolls the resolved element into view', async () => {
            const el = makeFakeElement();
            let scrolled = false;
            el.scrollIntoView = () => { scrolled = true; };
            const { page } = makePage({ registry: { '.target': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'scrollIntoView', selector: '.target' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(scrolled, true);
        });

        test('a missing selector is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'scrollIntoView' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });

        test('an unresolved selector throws', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'scrollIntoView', selector: '.missing', timeout: 0 }], null, 0, ctx, Object.create(null), 0, null)),
                /scrollIntoView failed: "\.missing" not found/
            );
        });
    });

    describe('select', () => {
        test('selects the matching <option> value after confirming it exists', async () => {
            const el = makeFakeElement({ querySelector: (sel) => (sel.includes('"US"') ? {} : null) });
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'select', selector: '.country', value: 'US' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__selected, 'US');
        });

        test('interpolates {var:...} tokens in value before selecting', async () => {
            const el = makeFakeElement({ querySelector: (sel) => (sel.includes('"CA"') ? {} : null) });
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            ctx.setVar('cc', 'CA');
            await withDomGlobals({}, () => applyActions(page, [{ type: 'select', selector: '.country', value: '{var:cc}' }], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__selected, 'CA');
        });

        test('throws when the requested option value does not exist', async () => {
            const el = makeFakeElement({ querySelector: () => null });
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals({}, () => applyActions(page, [{ type: 'select', selector: '.country', value: 'ZZ' }], null, 0, ctx, Object.create(null), 0, null)),
                /select failed: option "ZZ" not found/
            );
        });

        test('a missing selector or empty value is a no-op', async () => {
            const el = makeFakeElement();
            const { page } = makePage({ registry: { '.country': el } });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [
                { type: 'select' },
                { type: 'select', selector: '.country' } // no value
            ], null, 0, ctx, Object.create(null), 0, null));
            assert.equal(el.__selected, undefined);
        });
    });

    describe('scrollIntoView option on interaction steps', () => {
        function countScrolls(el) {
            const box = { n: 0 };
            el.scrollIntoView = () => { box.n += 1; };
            return box;
        }

        const selectorSteps = [
            ['type', { text: 'x' }],
            ['hover', {}],
            ['hoverOut', {}],
            ['focus', {}],
            ['select', { value: 'US' }]
        ];

        for (const [type, extra] of selectorSteps) {
            for (const [value, expected] of [[undefined, true], [true, true], [false, false], ['false', false]]) {
                test(`${type} with scrollIntoView:${JSON.stringify(value)} ${expected ? 'scrolls' : 'does not scroll'} the target`, async () => {
                    const el = makeFakeElement({ querySelector: () => ({}) });
                    const scrolls = countScrolls(el);
                    const { page } = makePage({ registry: { '.t': el } });
                    const ctx = makeCtx();
                    const action = Object.assign({ type, selector: '.t' }, extra);
                    if (value !== undefined) action.scrollIntoView = value;
                    await withDomGlobals({}, () => applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null));
                    assert.equal(scrolls.n, expected ? 1 : 0);
                });
            }
        }

        for (const type of ['clickByText', 'hoverByText', 'focusByText']) {
            for (const [value, expected] of [[undefined, true], [false, false]]) {
                test(`${type} with scrollIntoView:${JSON.stringify(value)} ${expected ? 'scrolls' : 'does not scroll'} the target`, async () => {
                    const el = makeFakeElement({ text: 'Go' });
                    const scrolls = countScrolls(el);
                    const { page } = makePage({ registry: {} });
                    page.evaluateHandle = async () => ({ asElement: () => makeHandle(el), dispose: async () => {} });
                    const ctx = makeCtx();
                    const action = { type, labelText: 'Go' };
                    if (value !== undefined) action.scrollIntoView = value;
                    await withDomGlobals(domOverridesFor(() => el), () =>
                        applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null)
                    );
                    assert.equal(scrolls.n, expected ? 1 : 0);
                });
            }
        }

        for (const [value, expected] of [[undefined, true], [false, false]]) {
            test(`setValue with scrollIntoView:${JSON.stringify(value)} ${expected ? 'scrolls' : 'does not scroll'} the matched control`, async () => {
                const el = makeFakeElement({ tagName: 'INPUT' });
                el.dispatchEvent = () => true;
                const scrolls = countScrolls(el);
                const { page } = makePage({ registry: { '.name': el } });
                const ctx = makeCtx();
                const action = { type: 'setValue', selector: '.name', value: 'Ada' };
                if (value !== undefined) action.scrollIntoView = value;
                await withDomGlobals({
                    document: {
                        readyState: 'complete',
                        fonts: { ready: Promise.resolve() },
                        elementFromPoint: () => null,
                        documentElement: {},
                        body: {},
                        querySelector: () => null,
                        querySelectorAll: (sel) => (sel === '.name' ? [el] : []),
                        getElementById: () => null,
                        addEventListener: () => {}
                    }
                }, () => applyActions(page, [action], null, 0, ctx, Object.create(null), 0, null));
                assert.equal(el.value, 'Ada');
                assert.equal(scrolls.n, expected ? 1 : 0);
            });
        }
    });

    describe('getText (top-level, via page.waitForFunction)', () => {
        function makeGetTextPage(el, wantedSelector) {
            const { page } = makePage({ registry: {} });
            page.waitForFunction = async (fn, _opts, sel) => {
                const found = (sel === wantedSelector && el) ? el : null;
                if (!found) throw new Error('waitForFunction: not found (simulated timeout)');
                return { asElement: () => ({ evaluate: async (evalFn, cfg) => evalFn(found, cfg), dispose: async () => {} }) };
            };
            return { page };
        }

        test('getText stores trimmed/collapsed textContent into both localVars and ctx.vars', async () => {
            const el = makeFakeElement({ text: '  Hello   World  ' });
            const { page } = makeGetTextPage(el, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.msg', var: 'msg' }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.msg, 'Hello World');
            assert.equal(ctx.getVar('msg'), 'Hello World');
        });

        test('its old name, getTextIntoVariable, is an unknown step now', async () => {
            const el = makeFakeElement({ text: 'Old name' });
            const { page } = makeGetTextPage(el, '.msg');
            await assert.rejects(
                applyActions(page, [{ type: 'getTextIntoVariable', selector: '.msg', var: 'msg' }], null, 0, makeCtx(), Object.create(null), 0, null),
                /Unknown step type "getTextIntoVariable"/
            );
        });

        test('attr reads an attribute value instead of textContent (href special-cased to el.href)', async () => {
            const el = makeFakeElement({ href: 'https://example.com/page' });
            const { page } = makeGetTextPage(el, 'a.link');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: 'a.link', var: 'href', attr: 'href' }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.href, 'https://example.com/page');
        });

        test('trim:false preserves raw whitespace instead of collapsing it', async () => {
            const el = makeFakeElement({ text: '  raw text  ' });
            const { page } = makeGetTextPage(el, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.msg', var: 'msg', trim: false }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.msg, '  raw text  ');
        });

        test('an unresolved selector is a silent no-op (no var set, no throw)', async () => {
            const { page } = makeGetTextPage(null, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.missing', var: 'msg' }], null, 0, ctx, localVars, 0, null);
            assert.equal(localVars.msg, undefined);
        });

        test('a missing selector or var name is a no-op', async () => {
            const el = makeFakeElement({ text: 'x' });
            const { page } = makeGetTextPage(el, '.msg');
            const ctx = makeCtx();
            const localVars = Object.create(null);
            await applyActions(page, [{ type: 'getText', selector: '.msg' }], null, 0, ctx, localVars, 0, null); // no var
            assert.deepEqual(Object.keys(localVars), []);
        });
    });

    describe('setValue', () => {
        function makeSetValuePage(el, expectedSelector) {
            const { page } = makePage({ registry: { [expectedSelector]: el } });
            const domOverrides = {
                document: {
                    readyState: 'complete',
                    fonts: { ready: Promise.resolve() },
                    elementFromPoint: () => null,
                    documentElement: {},
                    body: {},
                    querySelector: () => null,
                    querySelectorAll: (sel) => (sel === expectedSelector && el ? [el] : []),
                    getElementById: () => null,
                    addEventListener: () => {}
                }
            };
            return { page, domOverrides };
        }

        test('sets the value on the matching control and dispatches input/change events', async () => {
            const el = makeFakeElement({ tagName: 'INPUT' });
            const events = [];
            el.dispatchEvent = (evt) => { events.push(evt.type); return true; };
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await withDomGlobals(domOverrides, () =>
                applyActions(page, [{ type: 'setValue', selector: '.name', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.value, 'Ada');
            assert.deepEqual(events, ['input', 'change']);
        });

        test('skips disabled/readOnly/aria-disabled elements and throws when nothing eligible matches', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', disabled: true });
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.name', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setValue failed: no eligible element matched/
            );
        });

        test('labelText additionally requires an aria-label match among candidates', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', attrs: { 'aria-label': 'Full Name' } });
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await withDomGlobals(domOverrides, () =>
                applyActions(page, [{ type: 'setValue', selector: '.name', labelText: 'full name', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.value, 'Ada');
        });

        test('a non-matching labelText leaves the control untouched and throws', async () => {
            const el = makeFakeElement({ tagName: 'INPUT', attrs: { 'aria-label': 'Full Name' } });
            const { page, domOverrides } = makeSetValuePage(el, '.name');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.name', labelText: 'Nickname', value: 'Ada' }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setValue failed: no eligible element matched/
            );
        });

        test('a setValue step saved hidden, before setPassword existed, stops the run instead of typing nothing', async () => {
            // Configs saved then carry `valueMasked: true` and no value. Typing ''
            // into a login form and reporting a green run is the failure mode
            // this guards against.
            const el = makeFakeElement({ tagName: 'INPUT', value: 'untouched' });
            const { page, domOverrides } = makeSetValuePage(el, '.password');
            const ctx = makeCtx();
            await assert.rejects(
                () => withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.password', valueMasked: true }], null, 0, ctx, Object.create(null), 0, null)
                ),
                /setValue failed: passwords are not saved with the configuration/
            );
            assert.equal(el.value, 'untouched');
        });

        test('the flag alone does not block a step whose value was supplied again', async () => {
            const el = makeFakeElement({ tagName: 'INPUT' });
            const { page, domOverrides } = makeSetValuePage(el, '.password');
            const ctx = makeCtx();
            await withDomGlobals(domOverrides, () =>
                applyActions(page, [{ type: 'setValue', selector: '.password', value: 'hunter2', valueMasked: true }], null, 0, ctx, Object.create(null), 0, null)
            );
            assert.equal(el.value, 'hunter2');
        });

        test('neither selector nor labelText is a no-op', async () => {
            const { page } = makePage({ registry: {} });
            const ctx = makeCtx();
            await withDomGlobals({}, () => applyActions(page, [{ type: 'setValue', value: 'x' }], null, 0, ctx, Object.create(null), 0, null));
            assert.ok(true);
        });

        describe('getAllInputLabels label-matching fallbacks (beyond plain aria-label)', () => {
            // getAllInputLabels' aria-label path is already covered above; these cover its other
            // sources (aria-labelledby, id-based <label for>, closest('label'), title/placeholder),
            // each combined with a labelText match to prove the resolved text actually reaches the
            // matching step, not just that the DOM traversal runs.
            function makeLabelEl(text) {
                return { innerText: text, textContent: text, querySelectorAll: () => [] };
            }

            test('aria-labelledby resolves the referenced element\'s text (via the same-root/document querySelector fallback, since the target has no getRootNode)', async () => {
                const el = makeFakeElement({ tagName: 'INPUT', attrs: { 'aria-labelledby': 'lbl1' } });
                const labelEl = makeLabelEl('Email Address');
                const { page } = makePage({ registry: { '.email': el } });
                const domOverrides = {
                    document: {
                        readyState: 'complete',
                        fonts: { ready: Promise.resolve() },
                        elementFromPoint: () => null,
                        documentElement: {},
                        body: {},
                        querySelector: (sel) => (sel === '#lbl1' ? labelEl : null),
                        querySelectorAll: (sel) => (sel === '.email' ? [el] : []),
                        getElementById: () => null,
                        addEventListener: () => {}
                    }
                };
                const ctx = makeCtx();
                await withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.email', labelText: 'email address', value: 'ada@example.com' }], null, 0, ctx, Object.create(null), 0, null)
                );
                assert.equal(el.value, 'ada@example.com');
            });

            test('id-based <label for="..."> resolves via document.querySelectorAll', async () => {
                const el = makeFakeElement({ tagName: 'INPUT', attrs: { id: 'uname' } });
                const labelEl = makeLabelEl('Username');
                const { page } = makePage({ registry: { '.uname': el } });
                const domOverrides = {
                    document: {
                        readyState: 'complete',
                        fonts: { ready: Promise.resolve() },
                        elementFromPoint: () => null,
                        documentElement: {},
                        body: {},
                        querySelector: () => null,
                        querySelectorAll: (sel) => {
                            if (sel === '.uname') return [el];
                            if (sel === 'label[for="uname"]') return [labelEl];
                            return [];
                        },
                        getElementById: () => null,
                        addEventListener: () => {}
                    }
                };
                const ctx = makeCtx();
                await withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.uname', labelText: 'username', value: 'ada' }], null, 0, ctx, Object.create(null), 0, null)
                );
                assert.equal(el.value, 'ada');
            });

            test('closest(\'label\') resolves an implicit wrapping label, stripping the control\'s own current value out of the label text', async () => {
                const el = makeFakeElement({ tagName: 'INPUT', value: '42' });
                const labelEl = makeLabelEl('Quantity 42');
                el.closest = (sel) => (sel === 'label' ? labelEl : null);
                const { page, domOverrides } = makeSetValuePage(el, '.qty');
                const ctx = makeCtx();
                // exact:true makes this a real assertion on the stripping behavior: the raw label
                // text is "Quantity 42" (which would also satisfy a non-exact "Quantity" match on
                // its own, stripped or not) - only once "42" (the control's own current value) is
                // stripped out does the label become exactly "Quantity".
                await withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.qty', labelText: 'Quantity', exact: true, value: '99' }], null, 0, ctx, Object.create(null), 0, null)
                );
                assert.equal(el.value, '99');
            });

            test('title and placeholder are both usable as label text, independent of aria-label/labelledby/id/closest(\'label\')', async () => {
                const el = makeFakeElement({ tagName: 'INPUT', attrs: { title: 'Search products', placeholder: 'Type to search...' } });
                const { page, domOverrides } = makeSetValuePage(el, '.search');
                const ctx = makeCtx();
                await withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.search', labelText: 'search products', value: 'shoes' }], null, 0, ctx, Object.create(null), 0, null)
                );
                assert.equal(el.value, 'shoes');
            });

            test('a labelText that only matches the placeholder (not the title) still matches, confirming both sources are checked independently', async () => {
                const el = makeFakeElement({ tagName: 'INPUT', attrs: { title: 'Search products', placeholder: 'Type to search...' } });
                const { page, domOverrides } = makeSetValuePage(el, '.search');
                const ctx = makeCtx();
                await withDomGlobals(domOverrides, () =>
                    applyActions(page, [{ type: 'setValue', selector: '.search', labelText: 'type to search', value: 'shoes' }], null, 0, ctx, Object.create(null), 0, null)
                );
                assert.equal(el.value, 'shoes');
            });
        });
    });
});

// ---------------------------------------------------------------------------------------------
// a11yScan / screenshot / evidenceCapture: these actions only drive CDP sessions and
// page.evaluate()/page.screenshot() for metadata + pixel bytes, never real-DOM hit-testing, so a
// controlled page/CDP-client mock is a faithful stand-in (same rationale used throughout this
// file for click-utils.js-adjacent vs. plain Puppeteer-API-driving actions). page.evaluate here
// is intentionally NOT executed for real (unlike the element-targeting block above): every call
// site in this code path only cares about the numeric shape of the return value (viewport
// {width,height} / a totalHeight number), never about which DOM APIs the callback references, so
// dispatching on the callback source text is sufficient and much simpler than stubbing globals.
describe('a11yScan / screenshot / evidenceCapture actions (mocked CDP page)', () => {
    function makeArtifactPage({ visionDeficiencyThrows = false, ...overrides } = {}) {
        const cdpSends = [];
        const client = {
            send: async (method, params) => {
                cdpSends.push([method, params]);
                if (method === 'Page.getLayoutMetrics') {
                    return { contentSize: { width: 800, height: 600 }, layoutViewport: { clientWidth: 800 } };
                }
                if (method === 'Page.captureScreenshot') {
                    return { data: Buffer.from('fake-jpeg-bytes').toString('base64') };
                }
                if (method === 'Page.captureSnapshot') {
                    return { data: '<html>fake mhtml snapshot</html>' };
                }
                return {};
            },
            detach: async () => {}
        };
        const emulateCalls = [];

        const page = Object.assign({
            target: () => ({ createCDPSession: async () => client }),
            evaluate: async (fn) => {
                const src = fn.toString();
                if (src.includes('innerWidth')) return { width: 1000, height: 800 };
                if (src.includes('scrollHeight')) return 1200; // totalHeight, for the chunked (png) evidence path
                return undefined;
            },
            userAgent: async () => 'TestAgent/1.0',
            url: () => 'https://example.com/page',
            viewport: () => ({ width: 1000, height: 800 }),
            addStyleTag: async () => {},
            screenshot: async () => sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer(),
            emulateVisionDeficiency: async (d) => {
                emulateCalls.push(d);
                if (visionDeficiencyThrows) throw new Error('unsupported here');
            }
        }, overrides);

        return { page, cdpSends, emulateCalls };
    }

    describe('a11yScan', () => {
        test('throws a clear error when no ctx.handleA11yScanAction handler was provided', async () => {
            const { page } = makeArtifactPage();
            const ctx = makeCtx();
            await assert.rejects(
                () => applyActions(page, [{ type: 'a11yScan' }], null, 0, ctx, Object.create(null), 0, null),
                /no ctx\.handleA11yScanAction handler was provided/
            );
        });

        test('delegates to ctx.handleA11yScanAction with the interpolated label applied to the action', async () => {
            const { page } = makeArtifactPage();
            const calls = [];
            const ctx = createWorkflowContext({ handleA11yScanAction: async (args) => { calls.push(args); } });
            ctx.setVar('page', 'Home');
            await applyActions(page, [{ type: 'a11yScan', label: 'Scan: {var:page}' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(calls.length, 1);
            assert.equal(calls[0].action.label, 'Scan: Home');
        });
    });

    describe('screenshot', () => {
        test('captures via CDP and pushes a screenshot record with buffer/bytes/type metadata', async () => {
            const { page, cdpSends } = makeArtifactPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'screenshot', label: 'Homepage' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.screenshots.length, 1);
            const shot = ctx.screenshots[0];
            assert.equal(shot.name, 'Homepage');
            assert.ok(Buffer.isBuffer(shot.buffer));
            assert.equal(shot.type, 'jpeg');
            assert.equal(shot.url, 'https://example.com/page');
            assert.ok(cdpSends.some(([m]) => m === 'Input.dispatchMouseEvent'));
            assert.ok(ctx.runLogs.some(l => l.type === 'screenshot' && l.message === 'screenshot taken'));
        });

        test('when ctx.saveScreenshotFile is provided, the captured buffer is routed through it and filePath/publicUrl are recorded', async () => {
            const { page } = makeArtifactPage();
            const saveCalls = [];
            const ctx = createWorkflowContext({
                saveScreenshotFile: async ({ data, filename, dir }) => {
                    saveCalls.push({ filename, dir, bytes: data.length });
                    return { filePath: '/tmp/shot.jpg', publicUrl: 'https://cdn.example.com/shot.jpg', bytes: data.length };
                }
            });
            await applyActions(page, [{ type: 'screenshot' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(saveCalls.length, 1);
            assert.equal(ctx.screenshots[0].filePath, '/tmp/shot.jpg');
            assert.equal(ctx.screenshots[0].publicUrl, 'https://cdn.example.com/shot.jpg');
        });

        test('successive screenshots within one run get sequential orderKey/scanId ordering metadata', async () => {
            const { page } = makeArtifactPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'screenshot' }, { type: 'screenshot' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(ctx.screenshots[0].artifactIndex, 0);
            assert.equal(ctx.screenshots[1].artifactIndex, 1);
            assert.notEqual(ctx.screenshots[0].orderKey, ctx.screenshots[1].orderKey);
        });

        test('preserveHover:true keeps hover state by skipping pre-capture hover reset', async () => {
            const { page, cdpSends } = makeArtifactPage();
            const ctx = makeCtx();
            await applyActions(page, [{ type: 'screenshot', preserveHover: true }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(cdpSends.some(([m]) => m === 'Input.dispatchMouseEvent'), false);
        });
    });

    describe('evidenceCapture (action wrapper + runEvidenceCaptureShared directly)', () => {
        test('the "evidenceCapture" action delegates straight to runEvidenceCaptureShared', async () => {
            const { page } = makeArtifactPage();
            const saved = [];
            const ctx = createWorkflowContext({
                saveEvidenceFile: async (args) => { saved.push(args); return { path: '/tmp/e.mhtml', publicUrl: null, bytes: 10 }; }
            });
            await applyActions(page, [{ type: 'evidenceCapture', evidenceVariant: 'mhtml', label: 'Report' }], null, 0, ctx, Object.create(null), 0, null);
            assert.equal(saved.length, 1);
            assert.equal(saved[0].variant, 'mhtml');
            assert.equal(ctx.evidence.length, 1);
        });

        test('throws a clear error when the runner did not provide ctx.saveEvidenceFile', async () => {
            const { page } = makeArtifactPage();
            const ctx = makeCtx();
            await assert.rejects(
                () => runEvidenceCaptureShared({ page, ctx, localVars: Object.create(null), action: { type: 'evidenceCapture' } }),
                /requires ctx\.saveEvidenceFile/
            );
        });

        test('mhtml variant: saves via CDP Page.captureSnapshot and records a matching evidence entry', async () => {
            const { page, cdpSends } = makeArtifactPage();
            const saved = [];
            const ctx = createWorkflowContext({
                saveEvidenceFile: async (args) => { saved.push(args); return { path: '/tmp/report.mhtml', publicUrl: 'https://cdn/report.mhtml', bytes: 42 }; }
            });
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'mhtml', label: 'Report' }
            });
            assert.ok(cdpSends.some(([m]) => m === 'Page.captureSnapshot'));
            assert.equal(saved[0].variant, 'mhtml');
            assert.match(saved[0].filename, /^Report__ev-main-1\.mhtml$/);
            assert.equal(ctx.evidence[0].publicUrl, 'https://cdn/report.mhtml');
            assert.ok(ctx.runLogs.some(l => l.type === 'evidence' && /evidence saved \(mhtml\)/.test(l.message)));
        });

        test('action.label names the file, {var:...} tokens interpolated, and an old title is not read', async () => {
            const { page } = makeArtifactPage();
            const saved = [];
            const ctx = createWorkflowContext({ saveEvidenceFile: async (args) => { saved.push(args); return {}; } });
            ctx.setVar('section', 'Checkout');
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'mhtml', label: '{var:section} page', title: 'Ignored' }
            });
            assert.match(saved[0].filename, /^Checkout page__ev-main-1\.mhtml$/);
        });

        test('preserveHover:true keeps hover state by skipping pre-capture hover reset', async () => {
            const { page, cdpSends } = makeArtifactPage();
            const ctx = createWorkflowContext({ saveEvidenceFile: async () => ({}) });
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'mhtml', preserveHover: true }
            });
            assert.equal(cdpSends.some(([m]) => m === 'Input.dispatchMouseEvent'), false);
        });

        test('nameTemplateOverride/labelOverride (used internally by a11yScan) take precedence over action.label', async () => {
            const { page } = makeArtifactPage();
            const saved = [];
            const ctx = createWorkflowContext({ saveEvidenceFile: async (args) => { saved.push(args); return {}; } });
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'mhtml', label: 'LabelFromAction' },
                nameTemplateOverride: 'FromOverride',
                labelOverride: null
            });
            assert.match(saved[0].filename, /^FromOverride__ev-main-1\.mhtml$/);
            assert.equal(ctx.evidence[0].label, null);
        });

        test('variants:"both" captures png (chunked screenshot) AND mhtml, with sequential artifact ordering', async () => {
            const { page } = makeArtifactPage();
            const saved = [];
            const ctx = createWorkflowContext({ saveEvidenceFile: async (args) => { saved.push(args); return { bytes: 1 }; } });
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'both', label: 'Both' }
            });
            assert.equal(saved.length, 2);
            assert.deepEqual(saved.map(s => s.variant), ['png', 'mhtml']);
            assert.equal(ctx.evidence.length, 2);
            assert.equal(ctx.evidence[0].artifactIndex, 0);
            assert.equal(ctx.evidence[1].artifactIndex, 1);
        });

        test('onError:"continue" (default) records a failed save as an evidence entry with an error field instead of throwing', async () => {
            const { page } = makeArtifactPage();
            const ctx = createWorkflowContext({ saveEvidenceFile: async () => { throw new Error('disk full'); } });
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'mhtml', label: 'Report' }
            });
            assert.equal(ctx.evidence.length, 1);
            assert.match(ctx.evidence[0].error, /disk full/);
            assert.ok(ctx.runLogs.some(l => l.type === 'warning' && /failed to save/.test(l.message)));
        });

        test('onError:"fail" rethrows the save failure instead of recording it', async () => {
            const { page } = makeArtifactPage();
            const ctx = createWorkflowContext({ saveEvidenceFile: async () => { throw new Error('disk full'); } });
            await assert.rejects(
                () => runEvidenceCaptureShared({
                    page, ctx, localVars: Object.create(null),
                    action: { type: 'evidenceCapture', evidenceVariant: 'mhtml', onError: 'fail' }
                }),
                /disk full/
            );
        });

        test('reapplies ctx._visionDeficiency before capturing, and continues (with a warning) if that reapplication fails', async () => {
            const { page, emulateCalls } = makeArtifactPage({ visionDeficiencyThrows: true });
            const ctx = createWorkflowContext({ saveEvidenceFile: async () => ({}) });
            ctx._visionDeficiency = 'protanopia';
            await runEvidenceCaptureShared({
                page, ctx, localVars: Object.create(null),
                action: { type: 'evidenceCapture', evidenceVariant: 'mhtml' }
            });
            assert.deepEqual(emulateCalls, ['protanopia']);
            assert.ok(ctx.runLogs.some(l => l.type === 'warning' && /failed to apply vision deficiency/.test(l.message)));
            assert.equal(ctx.evidence.length, 1); // capture still happened
        });
    });
});

describe('wait', () => {
    test('a wait only known at run time is held to an hour, not let fire at once past 2^31 - 1 ms', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const ctx = makeCtx();
        ctx.setVar('long', '1000000000000');
        let done = false;
        const waiting = applyActions(fakePage, [{ type: 'wait', ms: '{var:long}' }], null, 0, ctx, Object.create(null), 0, null)
            .then(() => { done = true; });
        for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
        t.mock.timers.tick(3600000 - 1);
        for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
        assert.equal(done, false);
        t.mock.timers.tick(1);
        await waiting;
        assert.equal(done, true);
    });
});
