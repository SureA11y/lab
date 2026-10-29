'use strict';

// DOM tests for the scan step's Profile select: the run's profile, then the
// WCAG 2.2 levels and the standards in one plain list.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let SELECT_TOKEN_SENTINEL;
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

    ({ createActionsBuilder, SELECT_TOKEN_SENTINEL } = await import('./actions-builder.module.js'));
});

function newBuilder(actions) {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({
        defs: ACTION_DEFINITIONS,
        actionsEl,
        toolbarEl,
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const scanSelect = (actionsEl) =>
    actionsEl.querySelector('.line .field[data-field-name="profile"] select');

describe('the profile select', () => {
    test('offers the WCAG 2.2 levels and the standards, WCAG 2.2 AA chosen', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        const select = scanSelect(actionsEl);
        assert.equal(select.querySelector('optgroup'), null);
        const options = Array.from(select.options).filter((o) => o.value !== SELECT_TOKEN_SENTINEL).map((o) => o.textContent);
        assert.deepEqual(options, [
            'WCAG 2.2 A', 'WCAG 2.2 AA', 'WCAG 2.2 AAA',
            'EN 301 549 V4.1.1', 'EN 301 549 V3.2.1',
        ]);
        assert.equal(select.value, 'wcag22-aa');
    });

    test('a step left on the default saves it, so it says what it checks', () => {
        const { builder } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        assert.equal(builder.getValue({ validate: false }).value[0].profile, 'wcag22-aa');
    });

    test('a step\'s own profile loads and saves', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: 'en301549-v3.2.1' }]);
        assert.equal(scanSelect(actionsEl).value, 'en301549-v3.2.1');
        assert.equal(builder.getValue({ validate: false }).value[0].profile, 'en301549-v3.2.1');
    });
});
