'use strict';

// Passwords must never leave the browser. The value of a "Set password value"
// step (secret: true in the action definitions) is hidden on screen and kept
// out of saved configs, shareable links, and the run spec inside a config -
// what travels is `valueMasked: true` and no value at all. Its eye button only
// reveals the value on screen.
//
// These drive the REAL builder under jsdom, same technique as
// actions-builder.collect-output.test.js.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let redactMaskedFieldsDeep;
let withPasswordStepTypeDeep;
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

    ({ createActionsBuilder, redactMaskedFieldsDeep, withPasswordStepTypeDeep } = await import('./actions-builder.module.js'));
});

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

function valueField(scope) {
    return scope.querySelector('.field[data-field-name="value"]');
}

function revealButton(scope) {
    return valueField(scope).querySelector('.sb-input-with-icon__btn');
}

function passwordInput(scope) {
    return valueField(scope).querySelector('input');
}

/** A setPassword step with its value typed in. */
function passwordStep() {
    const { builder, actionsEl } = newBuilder();
    builder.loadActions([{ type: 'setPassword', selector: '#password', value: 'hunter2' }], {});
    return { builder, actionsEl };
}

function firstStep(builder, opts) {
    return builder.getValue({ validate: false, ...opts }).value[0];
}

describe('passwords: what gets saved', () => {
    test('the password is left out of the saved step, which carries the flag instead', () => {
        const { builder } = passwordStep();

        const saved = firstStep(builder, { maskValues: 'redact', markMasked: true });

        assert.equal('value' in saved, false, 'the value key must not be written at all');
        assert.equal(saved.valueMasked, true);
        assert.equal(saved.type, 'setPassword');
        assert.equal(saved.selector, '#password', 'the rest of the step is saved normally');
    });

    test('a revealed password is not saved either', () => {
        const { builder, actionsEl } = passwordStep();
        revealButton(actionsEl).click();

        const saved = firstStep(builder, { maskValues: 'redact', markMasked: true });

        assert.equal(passwordInput(actionsEl).type, 'text', 'revealed on screen');
        assert.equal('value' in saved, false);
        assert.equal(saved.valueMasked, true);
    });

    test('an empty password still saves the flag', () => {
        const { builder } = newBuilder();
        builder.addAction('setPassword');

        const saved = firstStep(builder, { maskValues: 'redact', markMasked: true });

        assert.equal('value' in saved, false);
        assert.equal(saved.valueMasked, true);
    });

    test('no part of the password survives anywhere in the saved JSON', () => {
        const { builder } = passwordStep();

        const json = JSON.stringify(builder.getValue({ validate: false, maskValues: 'redact', markMasked: true }).value);

        assert.doesNotMatch(json, /hunter2/);
    });

    test('a "Set field value" value is always saved as a plain string, with no flag and no eye button', () => {
        const { builder, actionsEl } = newBuilder();
        builder.loadActions([{ type: 'setValue', selector: '#email', value: 'user@example.com' }], {});

        const saved = firstStep(builder, { maskValues: 'redact', markMasked: true });

        assert.equal(saved.value, 'user@example.com');
        assert.equal('valueMasked' in saved, false);
        assert.equal(valueField(actionsEl).querySelector('.sb-input-with-icon'), null);
    });

    test('a password inside a nested action is redacted too', () => {
        const { builder } = newBuilder();
        builder.loadActions([{
            type: 'repeat',
            repetitions: 2,
            actions: [{ type: 'setPassword', selector: '#password', value: 'hunter2' }]
        }], {});

        const saved = firstStep(builder, { maskValues: 'redact', markMasked: true });
        const nested = saved.actions[0];

        assert.equal('value' in nested, false);
        assert.equal(nested.valueMasked, true);
    });

    test('running from the app still gets the real value: text mode is untouched', () => {
        const { builder } = passwordStep();

        assert.equal(firstStep(builder, { maskValues: 'text' }).value, 'hunter2');
    });

    test('undo/redo snapshots and copies carry the value as a plain string', () => {
        const { builder } = passwordStep();

        assert.equal(firstStep(builder, {}).value, 'hunter2');
    });
});

describe('passwords: on screen', () => {
    test('hidden by default, and the button reveals and hides it again', () => {
        const { actionsEl } = passwordStep();
        const input = passwordInput(actionsEl);
        const btn = revealButton(actionsEl);

        assert.equal(input.type, 'password');
        assert.equal(btn.getAttribute('aria-pressed'), 'false');

        btn.click();
        assert.equal(input.type, 'text');
        assert.equal(btn.getAttribute('aria-pressed'), 'true');

        btn.click();
        assert.equal(input.type, 'password');
        assert.equal(btn.getAttribute('aria-pressed'), 'false');
    });

    test('focus stays on the button when it reveals or hides the value', () => {
        const { actionsEl } = passwordStep();
        const btn = revealButton(actionsEl);

        btn.focus();
        btn.click();
        assert.equal(document.activeElement, btn, 'still on the button after revealing');
        btn.click();
        assert.equal(document.activeElement, btn, 'still on the button after hiding');
    });

    test('the button name and tooltip agree', () => {
        const { actionsEl } = passwordStep();
        const btn = revealButton(actionsEl);

        assert.equal(btn.getAttribute('aria-label'), 'Show value');
        assert.equal(btn.title, btn.getAttribute('aria-label'), 'tooltip must not disagree with the accessible name');
    });

    test('password managers are not offered the value', () => {
        const { actionsEl } = passwordStep();

        assert.equal(passwordInput(actionsEl).autocomplete, 'new-password');
    });
});

describe('passwords: loading a saved config back', () => {
    test('the field comes back empty and hidden, and says why', () => {
        const { actionsEl, builder } = newBuilder();

        builder.loadActions([{ type: 'setPassword', selector: '#password', valueMasked: true }], {});

        const input = passwordInput(actionsEl);
        assert.equal(input.value, '');
        assert.equal(input.type, 'password');
        assert.match(input.placeholder, /not saved/i);
    });

    test('typing a value again clears the "not saved" placeholder', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions([{ type: 'setPassword', selector: '#password', valueMasked: true }], {});

        const input = passwordInput(actionsEl);
        input.value = 'hunter2';
        input.dispatchEvent(new win.Event('input', { bubbles: true }));

        assert.doesNotMatch(input.placeholder, /not saved/i);
    });

    test('save -> load -> save keeps the step valueless, not half-restored', () => {
        const a = passwordStep();
        const saved = a.builder.getValue({ validate: false, maskValues: 'redact', markMasked: true }).value;

        const b = newBuilder();
        b.builder.loadActions(saved, {});
        const resaved = firstStep(b.builder, { maskValues: 'redact', markMasked: true });

        assert.equal(resaved.type, 'setPassword');
        assert.equal('value' in resaved, false);
        assert.equal(resaved.valueMasked, true);
    });

    test('a "Set field value" step saved hidden, before passwords had their own step, loads as one', () => {
        const { actionsEl, builder } = newBuilder();

        builder.loadActions([{
            type: 'repeat',
            repetitions: 1,
            actions: [{ type: 'setValue', labelText: 'PIN', valueMasked: true }]
        }], {});

        const nested = firstStep(builder, { maskValues: 'redact', markMasked: true }).actions[0];
        assert.equal(nested.type, 'setPassword');
        assert.equal(nested.labelText, 'PIN');
        assert.equal(nested.valueMasked, true);
        assert.match(passwordInput(actionsEl).placeholder, /not saved/i);
    });

    test('a "Set field value" step with a value and no flag stays as it is', () => {
        const { actionsEl, builder } = newBuilder();

        builder.loadActions([{ type: 'setValue', selector: '#email', value: 'user@example.com' }], {});

        assert.equal(firstStep(builder, {}).type, 'setValue');
        assert.equal(passwordInput(actionsEl).value, 'user@example.com');
    });
});

describe('withPasswordStepTypeDeep (custom steps held as plain objects)', () => {
    test('converts flagged setValue steps at any depth and leaves the rest alone', () => {
        const actions = [
            { type: 'setValue', selector: '#email', value: 'user@example.com' },
            { type: 'setValue', selector: '#pass', valueMasked: true },
            { type: 'repeat', actions: [{ type: 'setValue', value: 'x', valueMasked: true }] },
            { type: 'setValue', value: 'kept', valueMasked: false }
        ];

        const out = withPasswordStepTypeDeep(actions);

        assert.deepEqual(out.map((a) => a.type), ['setValue', 'setPassword', 'repeat', 'setValue']);
        assert.equal(out[2].actions[0].type, 'setPassword');
        assert.equal(out[2].actions[0].value, 'x', 'a value held in memory is kept for runs from the app');
        assert.equal(actions[1].type, 'setValue', 'does not mutate what it was given');
    });
});

describe('redactMaskedFieldsDeep (for callers holding plain action objects)', () => {
    test('drops every flagged field, at any depth, and leaves the rest alone', () => {
        const steps = [{
            id: 'login',
            actions: [
                { type: 'setValue', selector: '#password', value: 'hunter2', valueMasked: true },
                { type: 'setValue', selector: '#email', value: 'user@example.com' },
                { type: 'repeat', actions: [{ type: 'setValue', value: 'nested-secret', valueMasked: true }] }
            ]
        }];

        const out = redactMaskedFieldsDeep(steps);

        assert.equal('value' in out[0].actions[0], false);
        assert.equal(out[0].actions[0].valueMasked, true);
        assert.equal(out[0].actions[0].selector, '#password');
        assert.equal(out[0].actions[1].value, 'user@example.com');
        assert.equal('value' in out[0].actions[2].actions[0], false);
        assert.doesNotMatch(JSON.stringify(out), /secret|hunter2/);
    });

    test('does not mutate what it was given, so the app can still run the step', () => {
        const steps = [{ actions: [{ type: 'setValue', value: 'hunter2', valueMasked: true }] }];

        redactMaskedFieldsDeep(steps);

        assert.equal(steps[0].actions[0].value, 'hunter2');
    });

    test('a flag set to anything but true is not a redaction instruction', () => {
        const out = redactMaskedFieldsDeep([{ type: 'setValue', value: 'kept', valueMasked: false }]);
        assert.equal(out[0].value, 'kept');
    });
});
