'use strict';

// DOM tests for the URL condition step (ifUrl), driving the REAL actions builder
// under jsdom (same technique as actions-builder.collect-output.test.js): its part
// and comparison render as choices, and a saved step survives the round-trip.
//
// node's test runner isolates each file in its own process, so the DOM globals
// installed here don't leak into other suites.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let win;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    win = dom.window;

    // Mirror the DOM constructors/globals the builder touches onto globalThis.
    globalThis.window = win;
    for (const key of Object.getOwnPropertyNames(win)) {
        if (key in globalThis) continue;
        try { globalThis[key] = win[key]; } catch { /* some props are getters-only */ }
    }
    globalThis.document = win.document;
    globalThis.CSS = win.CSS || { escape: (s) => String(s) };
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    // jsdom doesn't implement these; the builder's responsive menu only needs no-ops.
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    if (!globalThis.IntersectionObserver) {
        globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    }

    ({ createActionsBuilder } = await import('./actions-builder.module.js'));
});

// Build a fresh builder wired exactly like the web app (non-stepper mode).
function newBuilder() {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({
        defs: ACTION_DEFINITIONS,
        actionsEl,
        toolbarEl,
        engineCapabilities: null,
        options: { useHorizontalStepper: false },
    });
    return { builder, actionsEl };
}

function fieldFor(scope, name) {
    return scope.querySelector(`.field[data-field-name="${name}"]`);
}

function readIfUrl(builder) {
    const out = builder.getValue({ validate: false, maskValues: 'text' });
    return (out.value || []).find((a) => a.type === 'ifUrl');
}

describe('ifUrl (URL condition) in the builder', () => {
    test('the URL part and the comparison are choices, the part starting on a prompt', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('ifUrl');
        const part = fieldFor(actionsEl, 'urlPart').querySelector('select');
        assert.deepEqual([...part.options].map((o) => o.value), ['', 'host', 'port', 'path', 'query', 'param', 'hash']);
        assert.equal(part.value, '');
        const comparison = fieldFor(actionsEl, 'comparison').querySelector('select');
        assert.deepEqual([...comparison.options].map((o) => o.value), ['equals', 'notEquals', 'contains', 'notContains']);
        assert.equal(comparison.value, 'equals');
    });

    test('its branches carry the then / else chips, like the condition step', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('ifUrl');
        assert.ok(actionsEl.querySelector('.branch-chip--then'));
        assert.ok(actionsEl.querySelector('.branch-chip--else'));
    });

    test('load -> save round-trip keeps every field', () => {
        const { builder } = newBuilder();
        const step = {
            type: 'ifUrl',
            urlPart: 'param',
            paramName: 'step',
            comparison: 'notEquals',
            value: 'payment',
            actions: [{ type: 'goBack' }]
        };
        builder.loadActions([step], {});
        const saved = readIfUrl(builder);
        assert.equal(saved.urlPart, 'param');
        assert.equal(saved.paramName, 'step');
        assert.equal(saved.comparison, 'notEquals');
        assert.equal(saved.value, 'payment');
        assert.equal(saved.actions.length, 1);
        assert.equal(saved.actions[0].type, 'goBack');
    });
});
