'use strict';

// The workflow and the custom-step editor each build their own actions builder
// instance, but users read them as one clipboard: copy a step in the workflow,
// paste it into a custom step (or the other way round). The clipboard therefore
// lives at module level, and every paste button - in either builder - follows it.
//
// These drive the REAL builder under jsdom, same technique as
// actions-builder.validation-reveal.dom.test.js.

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
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl, toolbarEl };
}

const topLines = (actionsEl) => Array.from(actionsEl.querySelectorAll(':scope > .line'));
const copyBtn = (actionsEl) => topLines(actionsEl)[0].querySelector('.copy-button');
const pasteBtn = (toolbarEl) => toolbarEl.querySelector('.paste-button');

describe('one clipboard across builder instances', () => {
    test('copying in one builder enables paste in the other', () => {
        const workflow = newBuilder([{ type: 'click', selector: '#go' }]);
        const customStep = newBuilder([]);

        assert.equal(pasteBtn(customStep.toolbarEl).disabled, true, 'nothing copied yet');

        copyBtn(workflow.actionsEl).click();

        assert.equal(pasteBtn(customStep.toolbarEl).disabled, false);
        assert.equal(pasteBtn(workflow.toolbarEl).disabled, false);
    });

    test('a step copied in one builder pastes into the other', () => {
        const workflow = newBuilder([{ type: 'click', selector: '#go' }]);
        const customStep = newBuilder([]);

        copyBtn(workflow.actionsEl).click();
        pasteBtn(customStep.toolbarEl).click();

        const pasted = customStep.builder.getValue({ validate: false }).value;
        assert.equal(pasted.length, 1);
        assert.equal(pasted[0].type, 'click');
        assert.equal(pasted[0].selector, '#go');
    });

    test('and the same holds in the other direction', () => {
        const customStep = newBuilder([{ type: 'waitForSelector', selector: '#ready' }]);
        const workflow = newBuilder([]);

        copyBtn(customStep.actionsEl).click();
        pasteBtn(workflow.toolbarEl).click();

        const pasted = workflow.builder.getValue({ validate: false }).value;
        assert.equal(pasted.length, 1);
        assert.equal(pasted[0].type, 'waitForSelector');
        assert.equal(pasted[0].selector, '#ready');
    });

    test('a paste button created after the copy starts enabled', () => {
        const workflow = newBuilder([{ type: 'click', selector: '#go' }]);
        copyBtn(workflow.actionsEl).click();

        const late = newBuilder([]);
        assert.equal(pasteBtn(late.toolbarEl).disabled, false);
    });
});
