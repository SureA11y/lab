'use strict';

// DOM tests for what a long workflow costs the step editor, driving the REAL
// actions builder under jsdom (same technique as
// actions-builder.switch.dom.test.js): each step is numbered by its place in
// its list under the number of the step holding it, however deep, without
// looking each step up in its list again (1000 steps took 5 s), and a step's
// info dialog is built when it is first opened (built up front, it was most of
// the editor's DOM).
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

    // jsdom has no modal dialogs; the step palette only needs them to open.
    win.HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
    win.HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };

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
    return { builder, actionsEl, toolbarEl };
}

const arrayField = (line, name) => line.querySelector(`:scope > .action-arrays-below > .action-array[data-field-name="${name}"]`);
const controlsOf = (arr) => arr.querySelector(':scope > .action-array__footer .inline-actions');
const buttonByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const rootLine = (actionsEl) => actionsEl.querySelector('.line');
const titles = (actionsEl) => [...actionsEl.querySelectorAll('.line-title')].map((el) => el.textContent);

describe('step numbers', () => {
    test('nested steps are numbered under the step holding them, however deep', () => {
        const { builder, actionsEl } = newBuilder();
        builder.loadActions([
            { type: 'wait', ms: 1 },
            { type: 'repeat', repetitions: 2, actions: [
                { type: 'wait', ms: 1 },
                { type: 'group', actions: [{ type: 'wait', ms: 1 }, { type: 'group', actions: [{ type: 'wait', ms: 1 }] }] },
            ] },
            { type: 'wait', ms: 1 },
        ], {});
        assert.deepEqual(titles(actionsEl).map((t) => t.split(' - ')[0]), ['1', '2', '2.1', '2.2', '2.2.1', '2.2.2', '2.2.2.1', '3']);
    });

    test('a long workflow is numbered in one pass over its lists', () => {
        const { builder, actionsEl } = newBuilder();
        builder.loadActions(Array.from({ length: 300 }, () => ({ type: 'wait', ms: 1 })), {});
        const proto = win.Element.prototype;
        const real = proto.querySelectorAll;
        let listings = 0;
        proto.querySelectorAll = function (selector) {
            if (selector === ':scope > .line') listings += 1;
            return real.call(this, selector);
        };
        try {
            builder.loadActions(Array.from({ length: 300 }, () => ({ type: 'wait', ms: 1 })), {});
        } finally {
            proto.querySelectorAll = real;
        }
        const numbers = titles(actionsEl).map((t) => Number(t.split(' - ')[0]));
        assert.deepEqual(numbers, Array.from({ length: 300 }, (_, i) => i + 1));
        // Once a step was 306; a few now, whatever the length.
        assert.ok(listings <= 20, `${listings} listings of a list for 300 steps`);
    });
});

describe('a step\'s info dialog', () => {
    test('is empty until it is first opened, then holds the step\'s fields', () => {
        const { builder, actionsEl } = newBuilder();
        builder.loadActions([{ type: 'click', selector: '#a' }], {});
        const line = actionsEl.querySelector('.line');
        const body = line.querySelector('dialog .src-dialog-body');
        assert.equal(body.childElementCount, 0);
        line.querySelector('.info-button').click();
        assert.ok(body.querySelector('table.sb-action-info__fields'));
        // Opening it again does not build it twice.
        line.querySelector('.info-button').click();
        assert.equal(body.querySelectorAll('table.sb-action-info__fields').length, 1);
    });
});
