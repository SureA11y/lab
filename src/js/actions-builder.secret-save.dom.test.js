'use strict';

// A password (a secret field) is never saved in a config, so one loaded back has
// it empty. Saving it again must not refuse the workflow for that, while a run
// still requires the value. Drives the REAL builder under jsdom, as the other
// builder DOM tests.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let win;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    win = dom.window;

    globalThis.window = win;
    for (const key of Object.getOwnPropertyNames(win)) {
        if (key in globalThis) continue;
        try { globalThis[key] = win[key]; } catch { /* getters-only */ }
    }
    globalThis.document = win.document;
    globalThis.CSS = win.CSS || { escape: (s) => String(s) };
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    if (!globalThis.IntersectionObserver) {
        globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    }

    ({ createActionsBuilder } = await import('./actions-builder.module.js'));
});

function newBuilder(actions) {
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
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

describe('an empty password', () => {
    // As a config brings it back: the value left out, the step marked masked.
    const step = { type: 'setPassword', selector: '#password', valueMasked: true };

    test('does not stop a config from being saved, inside a Merged scan too', () => {
        const { builder } = newBuilder([step, { type: 'mergedScan', label: 'Page', actions: [step, { type: 'a11yScan', label: 'Light' }] }]);
        const saved = builder.getValue({ maskValues: 'redact', markMasked: true });
        assert.equal(saved.ok, true);
        assert.equal(saved.value[0].type, 'setPassword');
        assert.equal(saved.value[0].value, undefined, 'never written');
        assert.equal(saved.value[0].valueMasked, true);
    });

    test('is still required to run', () => {
        const { builder } = newBuilder([step]);
        assert.equal(builder.getValue().ok, false);
        assert.equal(builder.validate().ok, false);
    });

    test('other required fields are still checked when saving', () => {
        const { builder } = newBuilder([step, { type: 'navigate', url: '' }]);
        assert.equal(builder.getValue({ maskValues: 'redact', markMasked: true }).ok, false);
    });
});

describe('a password read from the environment', () => {
    const step = { type: 'setPassword', selector: '#password', value: { $env: 'SHOP_PASSWORD' } };

    test('says so, and is kept as the reference to run and to save', () => {
        const { builder, actionsEl } = newBuilder([step]);
        const input = actionsEl.querySelector('.sb-input-with-icon input');
        assert.equal(input.value, '');
        assert.equal(input.placeholder, 'From the environment: SHOP_PASSWORD');
        const note = actionsEl.querySelector('.secret-env-note');
        assert.match(note.textContent, /environment variable SHOP_PASSWORD/);
        assert.ok(input.getAttribute('aria-describedby').split(' ').includes(note.id));

        const run = builder.getValue();
        assert.equal(run.ok, true);
        assert.deepEqual(run.value[0].value, { $env: 'SHOP_PASSWORD' });

        const saved = builder.getValue({ maskValues: 'redact', markMasked: true });
        assert.deepEqual(saved.value[0].value, { $env: 'SHOP_PASSWORD' });
        assert.equal(saved.value[0].valueMasked, undefined, 'nothing was masked');
    });

    test('typing a value replaces it, and that value is never saved', () => {
        const { builder, actionsEl } = newBuilder([step]);
        const input = actionsEl.querySelector('.sb-input-with-icon input');
        input.value = 'typed';
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
        assert.equal(actionsEl.querySelector('.secret-env-note'), null);
        assert.equal(input.hasAttribute('aria-describedby'), false);
        assert.equal(builder.getValue().value[0].value, 'typed');
        const saved = builder.getValue({ maskValues: 'redact', markMasked: true });
        assert.equal(saved.value[0].value, undefined);
        assert.equal(saved.value[0].valueMasked, true);
    });
});
