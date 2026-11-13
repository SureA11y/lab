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

describe('the fields\' grid', () => {
    test('a URL, a selector, a text or a value take the whole row; a choice or a number does not', () => {
        const { actionsEl } = newBuilder([
            { type: 'navigate', url: 'https://example.com/' },
            { type: 'click', selector: '#a', programmatic: false },
            { type: 'type', selector: '#q', text: 'shoes' },
            { type: 'setVar', key: 'k', value: 'v' },
        ]);
        const wide = (name) => Array.from(actionsEl.querySelectorAll(`.field[data-field-name="${name}"]`)).map((f) => f.dataset.wide === 'true');
        assert.deepEqual(wide('url'), [true]);
        assert.deepEqual(wide('selector'), [true, true]);
        assert.deepEqual(wide('text'), [true]);
        assert.deepEqual(wide('value'), [true]);
        assert.deepEqual(wide('key'), [false]);
        assert.deepEqual(wide('programmatic'), [false]);
    });
});

describe('a custom step call\'s inputs', () => {
    function callWith(args, schema) {
        const defs = {
            ...ACTION_DEFINITIONS,
            runCustomStep: {
                ...ACTION_DEFINITIONS.runCustomStep,
                // As the app gives them: the custom steps to choose from, and their inputs.
                fields: {
                    ...ACTION_DEFINITIONS.runCustomStep.fields,
                    customStepId: { ...ACTION_DEFINITIONS.runCustomStep.fields.customStepId, optionsProvider: () => [{ value: '', label: 'Select custom step...' }, { value: 'scan', label: 'scan' }] },
                },
                getStepInputsSchema: (id) => (id === 'scan' ? schema : null),
            },
        };
        const actionsEl = win.document.createElement('div');
        const toolbarEl = win.document.createElement('div');
        win.document.body.append(actionsEl, toolbarEl);
        const builder = createActionsBuilder({ defs, actionsEl, toolbarEl, options: { useHorizontalStepper: false } });
        builder.loadActions([{ type: 'runCustomStep', customStepId: 'scan', argsJson: JSON.stringify(args) }], { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
        const select = fieldControl(actionsEl, 'customStepId');
        select.value = 'scan';
        select.dispatchEvent(new win.Event('change'));
        return { builder, actionsEl, wrap: actionsEl.querySelector('.runcustomstep-dynamic-inputs') };
    }

    test('are a group named "Inputs", each with its label tied to it', () => {
        const { wrap } = callWith({ label: 'Home' }, [{ name: 'label', required: true }, { name: 'tags' }]);
        assert.equal(wrap.getAttribute('role'), 'group');
        assert.equal(win.document.getElementById(wrap.getAttribute('aria-labelledby')).textContent, 'Inputs');
        const rows = Array.from(wrap.querySelectorAll('.runcustomstep-dynamic-input-row'));
        rows.forEach((row) => {
            const label = row.querySelector('label');
            assert.equal(label.htmlFor, row.querySelector('input, textarea').id);
        });
        assert.equal(rows[0].querySelector('input').getAttribute('aria-required'), 'true');
    });

    test('a value of several lines is a textarea of as many lines, kept as typed', () => {
        const { builder, wrap } = callWith({ viewports: 'desktop-lg\ntablet\nmobile', label: 'Home' }, [{ name: 'label' }, { name: 'viewports' }]);
        const area = wrap.querySelector('textarea');
        assert.ok(area);
        assert.equal(area.value, 'desktop-lg\ntablet\nmobile');
        assert.equal(area.rows, 3);
        area.value = 'desktop-lg\ntablet\nmobile\nwatch';
        area.dispatchEvent(new win.Event('input', { bubbles: true }));
        assert.equal(area.rows, 4);
        assert.deepEqual(JSON.parse(saved(builder).argsJson), { label: 'Home', viewports: 'desktop-lg\ntablet\nmobile\nwatch' });
    });
    const argsArea = (actionsEl) => fieldControl(actionsEl, 'argsJson');
    // Each input given that the custom step does not declare: its label, the
    // input's name, and its value.
    const given = (wrap) => Array.from(wrap.querySelectorAll('.runcustomstep-dynamic-input-row--given')).map((row) => {
        const field = row.querySelector('input, textarea');
        assert.equal(row.querySelector('label').htmlFor, field.id);
        return [row.querySelector('label').textContent, field.value];
    });
    const type = (el, text) => { el.value = text; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
    const newInput = (wrap) => wrap.querySelector('.runcustomstep-dynamic-inputs__new input');
    const addBtn = (wrap) => wrap.querySelector('.runcustomstep-dynamic-inputs__add');

    test('show as fields when loaded, without the JSON text', () => {
        const defs = { ...ACTION_DEFINITIONS, runCustomStep: { ...ACTION_DEFINITIONS.runCustomStep, getStepInputsSchema: () => null } };
        const actionsEl = win.document.createElement('div');
        const toolbarEl = win.document.createElement('div');
        win.document.body.append(actionsEl, toolbarEl);
        const builder = createActionsBuilder({ defs, actionsEl, toolbarEl, options: { useHorizontalStepper: false } });
        builder.loadActions([{ type: 'runCustomStep', customStepId: 'gone', argsJson: '{"user":"ana"}' }], { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
        const wrap = actionsEl.querySelector('.runcustomstep-dynamic-inputs');
        assert.equal(argsArea(actionsEl).hidden, true);
        assert.equal(wrap.hidden, false);
        assert.deepEqual(given(wrap), [['user', 'ana']]);
    });

    test('a custom step that declares none takes one field an input, labelled with its name, added and removed', () => {
        const { builder, wrap } = callWith({}, []);
        assert.equal(wrap.querySelector('.runcustomstep-dynamic-inputs__empty').hidden, false);
        type(newInput(wrap), 'section');
        addBtn(wrap).click();
        assert.deepEqual(given(wrap), [['section', '']]);
        const field = wrap.querySelector('.runcustomstep-dynamic-input-row--given input');
        assert.equal(win.document.activeElement, field);
        assert.equal(newInput(wrap).value, '');
        type(field, 'Main');
        assert.deepEqual(JSON.parse(saved(builder).argsJson), { section: 'Main' });
        const remove = wrap.querySelector('.runcustomstep-dynamic-input__remove');
        assert.equal(remove.getAttribute('aria-label'), 'Remove input section');
        remove.click();
        assert.equal(saved(builder).argsJson, undefined);
        assert.equal(win.document.activeElement, newInput(wrap));
    });

    test('keep the inputs the custom step does not declare, each a field of its own', () => {
        const { builder, wrap } = callWith({ label: 'Home', extra: 'x' }, [{ name: 'label' }]);
        assert.deepEqual(given(wrap), [['extra', 'x']]);
        type(wrap.querySelector('.runcustomstep-dynamic-input-row input'), 'Shop');
        assert.deepEqual(JSON.parse(saved(builder).argsJson), { label: 'Shop', extra: 'x' });
    });

    test('a value that is not text stays as it came until it is edited', () => {
        const { builder, wrap } = callWith({ tries: 2, flags: { a: true } }, [{ name: 'tries' }]);
        assert.equal(wrap.querySelector('.runcustomstep-dynamic-input-row input').value, '2');
        assert.deepEqual(given(wrap), [['flags', '{"a":true}']]);
        type(newInput(wrap), 'more');
        addBtn(wrap).click();
        assert.deepEqual(JSON.parse(saved(builder).argsJson), { tries: 2, flags: { a: true }, more: '' });
    });

    test('adding an input with no name, or the name of one there, says so and adds nothing', () => {
        const { wrap } = callWith({ label: 'Home' }, [{ name: 'label' }]);
        const error = wrap.querySelector('.runcustomstep-dynamic-inputs__error');
        addBtn(wrap).click();
        assert.match(error.textContent, /Type the input’s name/);
        assert.equal(newInput(wrap).getAttribute('aria-invalid'), 'true');
        assert.equal(newInput(wrap).getAttribute('aria-describedby'), error.id);
        type(newInput(wrap), 'label');
        assert.equal(error.hidden, true);
        addBtn(wrap).click();
        assert.match(error.textContent, /“label” is already an input/);
        assert.deepEqual(given(wrap), []);
    });

    test('text that is not a JSON object shows as written, to be put right', () => {
        const { actionsEl, wrap } = callWith(null, []);
        const area = argsArea(actionsEl);
        area.value = '{"user": ';
        actionsEl.querySelector('.line')._applyRunCustomStepInputs();
        assert.equal(area.hidden, false);
        assert.equal(wrap.hidden, true);
        area.value = '{"user": "ana"}';
        area.dispatchEvent(new win.Event('change', { bubbles: true }));
        assert.equal(area.hidden, true);
        assert.deepEqual(given(wrap), [['user', 'ana']]);
    });
});
