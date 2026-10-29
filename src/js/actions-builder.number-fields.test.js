'use strict';

// Number fields in the actions builder accept either a number or a single
// variable token such as {var:count}, which the engine turns into a number when
// the step runs. Drives the REAL builder under jsdom, same technique as
// actions-builder.collect-output.test.js.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let parseNumberFieldText;
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

    ({ createActionsBuilder, parseNumberFieldText } = await import('./actions-builder.module.js'));
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


function setText(field, text) {
    const input = field.querySelector('input');
    input.value = text;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    return input;
}

function readAction(builder, type) {
    const out = builder.getValue({ validate: false, maskValues: 'text' });
    return (out.value || []).find((a) => a.type === type);
}

describe('parseNumberFieldText', () => {
    test('reads numbers and single variable tokens', () => {
        assert.deepEqual(parseNumberFieldText(' 3 '), { kind: 'number', value: 3 });
        assert.deepEqual(parseNumberFieldText('1.5'), { kind: 'number', value: 1.5 });
        assert.deepEqual(parseNumberFieldText('{var:count}'), { kind: 'token', value: '{var:count}' });
        assert.deepEqual(parseNumberFieldText('{oneBased}'), { kind: 'token', value: '{oneBased}' });
    });

    test('rejects anything else, and fractions when a whole number is required', () => {
        for (const t of ['', 'abc', '3 items', '1,234', '{var:a} {var:b}', '{var:}']) {
            assert.equal(parseNumberFieldText(t), null, t);
        }
        assert.equal(parseNumberFieldText('2.5', { integer: true }), null);
        assert.deepEqual(parseNumberFieldText('{var:n}', { integer: true }), { kind: 'token', value: '{var:n}' });
    });
});

describe('number fields accept variables (DOM round-trip)', () => {
    test('number fields render as text inputs so a {var:...} token can be typed', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('repeat');
        const input = fieldFor(actionsEl, 'repetitions').querySelector('input');
        assert.equal(input.type, 'text');
    });

    // A repeat needs at least one nested step to validate.
    const repeatWithBody = [{ type: 'repeat', repetitions: 1, actions: [{ type: 'wait', ms: 1 }] }];

    test('a {var:...} token is saved as text and validates', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions(repeatWithBody, {});
        setText(fieldFor(actionsEl, 'repetitions'), '{var:tabCount}');
        assert.equal(readAction(builder, 'repeat').repetitions, '{var:tabCount}');
        assert.equal(builder.validate().ok, true);
    });

    test('a literal number is still saved as a number', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('repeat');
        setText(fieldFor(actionsEl, 'repetitions'), ' 4 ');
        assert.strictEqual(readAction(builder, 'repeat').repetitions, 4);
    });

    test('a loaded token round-trips back into the field', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions([{ type: 'repeat', repetitions: '{var:n}', actions: [] }], {});
        assert.equal(fieldFor(actionsEl, 'repetitions').querySelector('input').value, '{var:n}');
        assert.equal(readAction(builder, 'repeat').repetitions, '{var:n}');
    });

    test('text that is neither a number nor a single token fails validation', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions(repeatWithBody, {});
        setText(fieldFor(actionsEl, 'repetitions'), '3 items');
        assert.equal(builder.validate().ok, false);
    });

    test('a whole-number field rejects a fraction; other number fields accept it', () => {
        const a = newBuilder();
        a.builder.loadActions(repeatWithBody, {});
        setText(fieldFor(a.actionsEl, 'repetitions'), '2.5');
        assert.equal(a.builder.validate().ok, false);

        const b = newBuilder();
        b.builder.addAction('wait');
        setText(fieldFor(b.actionsEl, 'ms'), '2.5');
        assert.equal(b.builder.validate().ok, true);
    });

    test('getCount renders its three fields', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('getCount');
        for (const name of ['selector', 'var', 'logValue']) {
            assert.ok(fieldFor(actionsEl, name), `${name} field is rendered`);
        }
    });
});
