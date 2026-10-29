'use strict';

// While a batch is on, its rows' variable names are given to the step editor
// (setReservedVariableNames). A step that would hide or remove one of them is
// a field error - shown as soon as the names and the step clash, and blocking
// a run like an empty required field - and only the errors this check set are
// ever cleared by it.
//
// Drives the REAL builder under jsdom, same technique as
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

function newBuilder(actions, defs = ACTION_DEFINITIONS) {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({
        defs,
        actionsEl,
        toolbarEl,
        engineCapabilities: null,
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

function control(actionsEl, fieldName, nth = 0) {
    const fields = actionsEl.querySelectorAll(`.field[data-field-name="${fieldName}"]`);
    return fields[nth].querySelector('input, select, textarea');
}

function errorOf(ctrl) {
    const err = ctrl.closest('.field').querySelector('.error');
    return err && !err.hidden ? err.textContent : '';
}

describe('batch workflow variables in the step editor', () => {
    test('no names, no errors: a Set variable named build is ordinary', () => {
        const { actionsEl } = newBuilder([{ type: 'setVar', key: 'build', value: '1' }]);
        assert.equal(errorOf(control(actionsEl, 'key')), '');
    });

    test('a Set variable, Get text or Get count naming a row variable is flagged as soon as the names arrive', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'setVar', key: 'build', value: '1' },
            { type: 'getText', selector: 'h1', var: 'date' },
            { type: 'getCount', selector: 'li', var: 'items' },
        ]);
        builder.setReservedVariableNames(['build', 'date']);
        const key = control(actionsEl, 'key');
        assert.match(errorOf(key), /“build” is also a batch workflow variable: from this step on, the workflow’s value is hidden/);
        assert.equal(key.getAttribute('aria-invalid'), 'true');
        assert.match(errorOf(control(actionsEl, 'var', 0)), /“date” is also a batch workflow variable/);
        assert.equal(errorOf(control(actionsEl, 'var', 1)), '', 'a name no workflow sets is fine');
    });

    test('clearing a row variable says the value is removed for the rest of the run', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'clearVar', key: 'build' }]);
        builder.setReservedVariableNames(['build']);
        assert.match(errorOf(control(actionsEl, 'key')), /clearing it removes the workflow’s value for the rest of the run/);
    });

    test('a custom step call: exporting or passing a different value under a row variable is flagged, passing it on is not', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'runCustomStep', customStepId: 'x', argsJson: '{"build":"{var:build}"}', exportVars: ['date'] },
            { type: 'runCustomStep', customStepId: 'x', argsJson: '{"build":"9"}' },
        ]);
        builder.setReservedVariableNames(['build', 'date']);
        assert.match(errorOf(control(actionsEl, 'exportVars', 0)), /exporting it from the custom step replaces the workflow’s value/);
        assert.equal(errorOf(control(actionsEl, 'argsJson', 0)), '');
        assert.match(errorOf(control(actionsEl, 'argsJson', 1)), /The argument “build” hides the batch workflow variable/);
    });

    test('a custom step input named like a row variable, not handed the row\'s value, is flagged on the call', () => {
        const defs = {
            ...ACTION_DEFINITIONS,
            runCustomStep: {
                ...ACTION_DEFINITIONS.runCustomStep,
                getStepInputsSchema: (id) => (id === 'login' ? [{ name: 'build', default: '1' }] : null),
            },
        };
        const { builder, actionsEl } = newBuilder([{ type: 'runCustomStep', customStepId: 'login' }], defs);
        // customStepId's options come from the app; give the select the one value.
        const idSelect = control(actionsEl, 'customStepId');
        if (idSelect.tagName === 'SELECT' && ![...idSelect.options].some((o) => o.value === 'login')) {
            idSelect.append(new win.Option('login', 'login'));
        }
        idSelect.value = 'login';
        builder.setReservedVariableNames(['build']);
        assert.match(errorOf(control(actionsEl, 'argsJson')), /The custom step’s input “build” hides the batch workflow variable/);
    });

    test('the error blocks validation like any other field error', () => {
        const { builder } = newBuilder([{ type: 'setVar', key: 'build', value: '1' }]);
        builder.setReservedVariableNames(['build']);
        assert.equal(builder.getValue({ validate: true }).ok, false);
        builder.setReservedVariableNames([]);
        assert.equal(builder.getValue({ validate: true }).ok, true);
    });

    test('renaming the variable or turning the batch off clears the error; other errors are left alone', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'setVar', key: 'build', value: '1' },
            { type: 'waitForSelector', selector: '' },
        ]);
        builder.getValue({ validate: true }); // the empty required selector now shows its own error
        const selector = control(actionsEl, 'selector');
        const before = errorOf(selector);
        assert.ok(before, 'a required-field error is showing');

        builder.setReservedVariableNames(['build']);
        const key = control(actionsEl, 'key');
        assert.ok(errorOf(key));

        key.value = 'build2';
        key.dispatchEvent(new win.Event('change', { bubbles: true }));
        assert.equal(errorOf(key), '', 'renamed');

        key.value = 'build';
        key.dispatchEvent(new win.Event('change', { bubbles: true }));
        assert.ok(errorOf(key), 'flagged again');

        builder.setReservedVariableNames([]);
        assert.equal(errorOf(key), '', 'batch off');
        assert.equal(errorOf(selector), before, 'the required-field error is untouched');
    });

    test('a disabled step is not flagged', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setVar', key: 'build', value: '1', disabled: true }]);
        builder.setReservedVariableNames(['build']);
        assert.equal(errorOf(control(actionsEl, 'key')), '');
    });
});
