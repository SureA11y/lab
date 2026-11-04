'use strict';

// A disabled step says so in its name, not with aria-disabled: on a group,
// aria-disabled says every control in it is unavailable, the button that
// turns the step back on among them.

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
    const builder = createActionsBuilder({ defs: ACTION_DEFINITIONS, actionsEl, toolbarEl, options: { useHorizontalStepper: false } });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

describe('a disabled step', () => {
    test('is not aria-disabled, so its Enable button is not announced as unavailable', () => {
        const { actionsEl } = newBuilder([{ type: 'click', selector: '#a', disabled: true }]);
        const line = actionsEl.querySelector('.line');
        assert.equal(line.hasAttribute('aria-disabled'), false);
        const toggle = line.querySelector(':scope > .line-header .toggle-disabled');
        assert.equal(toggle.getAttribute('aria-label'), 'Enable this action');
        assert.equal(toggle.disabled, false);
    });

    test('says it is disabled in its name, and stops saying it once enabled', () => {
        const { actionsEl } = newBuilder([{ type: 'click', selector: '#a', disabled: true }]);
        const line = actionsEl.querySelector('.line');
        const wrap = win.document.getElementById(line.getAttribute('aria-labelledby'));
        assert.match(wrap.textContent, /1 - Click, disabled/);
        line.querySelector(':scope > .line-header .toggle-disabled').click();
        assert.doesNotMatch(wrap.textContent, /disabled/);
        line.querySelector(':scope > .line-header .toggle-disabled').click();
        assert.match(wrap.textContent, /, disabled/);
    });
});
