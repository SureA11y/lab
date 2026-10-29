'use strict';

// DOM tests for how the builder loads and saves step fields whose value is not
// plain text: a boolean saved as text, and an object in a text field.

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
    return { builder, actionsEl };
}

const fieldControl = (actionsEl, name) =>
    actionsEl.querySelector(`.line .field[data-field-name="${name}"] select, .line .field[data-field-name="${name}"] textarea, .line .field[data-field-name="${name}"] input`);
const saved = (builder) => builder.getValue({ validate: false }).value[0];

describe('a click step\'s programmatic', () => {
    test('is a true/false choice, saved as a boolean', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'click', selector: '#a', programmatic: true }]);
        assert.equal(fieldControl(actionsEl, 'programmatic').value, 'true');
        assert.equal(saved(builder).programmatic, true);
    });

    test('"false" saved as text loads as false, not as a true string would', () => {
        const { builder } = newBuilder([{ type: 'click', selector: '#a', programmatic: 'false' }]);
        assert.equal(saved(builder).programmatic, false);
    });
});

describe('a custom step call\'s argsJson', () => {
    test('an object shows as its JSON, and saves as that text', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'runCustomStep', customStepId: 'login', argsJson: { user: 'ana', tries: 2 } }]);
        assert.equal(fieldControl(actionsEl, 'argsJson').value, '{"user":"ana","tries":2}');
        assert.deepEqual(JSON.parse(saved(builder).argsJson), { user: 'ana', tries: 2 });
    });

    test('text stays as it was written', () => {
        const { builder } = newBuilder([{ type: 'runCustomStep', customStepId: 'login', argsJson: '{"user": "ana"}' }]);
        assert.equal(saved(builder).argsJson, '{"user": "ana"}');
    });
});

describe('loading steps the builder does not have', () => {
    test('leaves them out and says where each was, nested ones included', () => {
        const actionsEl = win.document.createElement('div');
        const toolbarEl = win.document.createElement('div');
        win.document.body.append(actionsEl, toolbarEl);
        const builder = createActionsBuilder({ defs: ACTION_DEFINITIONS, actionsEl, toolbarEl, options: { useHorizontalStepper: false } });
        const result = builder.loadActions([
            { type: 'save' },
            { type: 'a11yScan', label: 'Home' },
            { type: 'group', actions: [{ type: 'click', selector: '#a' }, { type: 'nope' }] },
            { type: 'if', selectorExists: '#x', actions: [], elseActions: [{ type: 'oops' }] },
        ], { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });

        assert.deepEqual(result.errors.map((e) => [e.type, e.indexPath]), [['save', '1'], ['nope', '3.2'], ['oops', '4.1']]);
        assert.equal(result.added.length, 3);
        assert.deepEqual(builder.getValue({ validate: false }).value.map((a) => a.type), ['a11yScan', 'group', 'if']);
    });
});
