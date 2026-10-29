'use strict';

// The scan step's context and exclude fields are CSS selectors core parses
// with querySelectorAll: one it can't parse fails the scan, so the builder
// flags it before a run. Drives the REAL builder under jsdom, same technique
// as actions-builder.validation-reveal.dom.test.js.

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
        engineCapabilities: null,
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const fieldOf = (actionsEl, name) => actionsEl.querySelector(`.line .field[data-field-name="${name}"]`);
const errorOf = (actionsEl, name) => {
    const err = fieldOf(actionsEl, name).querySelector('.error');
    return err && !err.hidden ? err.textContent : '';
};

describe('scan step selectors', () => {
    test('flags a context selector the browser cannot parse', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', context: '##main' }]);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'context'), '"##main" is not a valid CSS selector');
    });

    test('names the piece of an exclude list at fault', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', exclude: '.cookie, [data-x=, .ads' }]);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'exclude'), '"[data-x=" is not a valid CSS selector');
    });

    test('accepts valid selectors, selector lists with commas inside, and variable tokens', () => {
        for (const step of [
            { type: 'a11yScan', context: '#main > article:first-of-type', exclude: '.cookie, .ads' },
            { type: 'a11yScan', exclude: ':is(.a, .b) > p' },
            { type: 'a11yScan', context: '{var:region}' },
            { type: 'a11yScan' },
        ]) {
            const { builder, actionsEl } = newBuilder([step]);
            assert.equal(builder.validate().ok, true, JSON.stringify(step));
            assert.equal(errorOf(actionsEl, 'context'), '');
        }
    });
});
