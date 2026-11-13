'use strict';

// DOM tests for a custom step's places in the REAL actions builder under
// jsdom: a call shows one list of steps for each place its custom step has,
// kept in step with it, saves only the places it gives steps for, and is
// checked for a required place left empty or steps for a place the custom
// step no longer has; a Slot step is only offered in a custom step's own
// steps. See docs/design/custom-step-slots-design.md.

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
    win.HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
    win.HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
    ({ createActionsBuilder } = await import('./actions-builder.module.js'));
});

// The custom steps a call can choose, and their places, as the app gives them.
const CUSTOM_STEPS = {
    'log-in': [{ name: 'beforeSubmit', label: 'Before signing in' }, { name: 'afterSubmit', label: 'After signing in' }],
    'strict': [{ name: 'afterSubmit', required: true }],
    'plain': [],
};

function newBuilder(actions, { inCustomStep = false } = {}) {
    const defs = {
        ...ACTION_DEFINITIONS,
        runCustomStep: {
            ...ACTION_DEFINITIONS.runCustomStep,
            fields: {
                ...ACTION_DEFINITIONS.runCustomStep.fields,
                customStepId: {
                    ...ACTION_DEFINITIONS.runCustomStep.fields.customStepId,
                    optionsProvider: () => [{ value: '', label: 'Select custom step...' }, ...Object.keys(CUSTOM_STEPS).map((id) => ({ value: id, label: id }))],
                },
            },
            getStepSlotsSchema: (id) => CUSTOM_STEPS[id] || null,
        },
    };
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({ defs, actionsEl, toolbarEl, options: { useHorizontalStepper: false, inCustomStep } });
    if (actions) builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl, toolbarEl };
}

const call = (actionsEl) => actionsEl.querySelector('.line[data-action-type="runCustomStep"]');
const places = (line) => Array.from(line.querySelectorAll(':scope > .action-arrays-below > .action-array[data-field-name="slots"] > .actions-subcontainer > .line'));
const titleOf = (line) => line.querySelector(':scope > .line-header .line-title').textContent;
const stepsIn = (place) => place.querySelectorAll(':scope > .action-arrays-below .actions-subcontainer > .line').length;
const saved = (builder) => builder.getValue({ validate: false }).value[0];
const fill = (slot, actions) => ({ type: 'slotSteps', slot, actions });

describe('a custom step call\'s places', () => {
    test('one list for each place the custom step has, in its order, titled with its label', () => {
        const { actionsEl } = newBuilder([{
            type: 'runCustomStep', customStepId: 'log-in',
            slots: [fill('afterSubmit', [{ type: 'click', selector: '#trust' }])],
        }]);
        const lines = places(call(actionsEl));
        assert.deepEqual(lines.map(titleOf), ['1.1 - Before signing in', '1.2 - After signing in']);
        assert.deepEqual(lines.map(stepsIn), [0, 1]);
        // Kept by the editor: not moved, copied or removed on their own.
        assert.equal(lines[0].querySelector(':scope > .line-header .remove'), null);
        assert.equal(lines[0].querySelector(':scope > .line-header .move-up'), null);
    });

    test('only the places given steps are saved', () => {
        const { builder } = newBuilder([{
            type: 'runCustomStep', customStepId: 'log-in',
            slots: [fill('afterSubmit', [{ type: 'click', selector: '#trust' }])],
        }]);
        assert.equal(saved(builder).slots.length, 1);
        assert.equal(saved(builder).slots[0].slot, 'afterSubmit');
        const { builder: none } = newBuilder([{ type: 'runCustomStep', customStepId: 'log-in' }]);
        assert.equal(saved(none).slots, undefined);
    });

    test('a custom step with no places shows no list', () => {
        const { actionsEl } = newBuilder([{ type: 'runCustomStep', customStepId: 'plain' }]);
        assert.equal(call(actionsEl).querySelector('.action-array[data-field-name="slots"]').hidden, true);
    });

    test('choosing another custom step shows its places; steps for a place it does not have are kept, said so', () => {
        const { actionsEl, builder } = newBuilder([{
            type: 'runCustomStep', customStepId: 'log-in',
            slots: [fill('beforeSubmit', [{ type: 'click', selector: '#terms' }])],
        }]);
        const select = call(actionsEl).querySelector(':scope > .fields > .field[data-field-name="customStepId"] select');
        select.value = 'strict';
        select.dispatchEvent(new win.Event('change', { bubbles: true }));
        const lines = places(call(actionsEl));
        assert.deepEqual(lines.map(titleOf), ['1.1 - After submit (required)', '1.2 - beforeSubmit: the custom step has no such place']);
        assert.equal(stepsIn(lines[1]), 1);

        const result = builder.validate({ reveal: false });
        assert.equal(result.ok, false);
        const errors = Array.from(call(actionsEl).querySelectorAll('.action-array__error:not([hidden])')).map((e) => e.textContent);
        assert.ok(errors.includes('The custom step requires steps here: add at least one'), errors.join(' | '));
        assert.ok(errors.includes('The custom step has no such place: move these steps to one of its places, or remove them'), errors.join(' | '));
    });
});

describe('the Slot step', () => {
    function paletteKeys(toolbarEl) {
        toolbarEl.querySelector('button[title^="Add any action"]').click();
        const keys = [...win.document.querySelectorAll('.sb-palette [data-key]')].map((el) => el.dataset.key);
        win.document.querySelectorAll('dialog[open]').forEach((d) => d.close());
        return keys;
    }

    test('is offered in a custom step\'s steps, not in the workflow\'s; a call\'s place never is', () => {
        const workflow = paletteKeys(newBuilder().toolbarEl);
        assert.ok(workflow.includes('runCustomStep'), 'the palette rendered');
        assert.ok(!workflow.includes('slot'));
        assert.ok(!workflow.includes('slotSteps'));
        const custom = paletteKeys(newBuilder(null, { inCustomStep: true }).toolbarEl);
        assert.ok(custom.includes('slot'));
        assert.ok(!custom.includes('slotSteps'));
    });

    test('a place with two Slot steps is an error on the second', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'slot', slot: 'afterSubmit' },
            { type: 'slot', slot: 'afterSubmit' },
        ], { inCustomStep: true });
        // No custom step is open here: give the two the same place to choose.
        actionsEl.querySelectorAll('.line[data-action-type="slot"] select').forEach((sel) => {
            if (![...sel.options].some((o) => o.value === 'afterSubmit')) sel.append(new win.Option('afterSubmit', 'afterSubmit'));
            sel.value = 'afterSubmit';
            sel.closest('.field').dataset.enum = JSON.stringify(['afterSubmit']);
        });
        builder.validate({ reveal: false });
        const errors = Array.from(actionsEl.querySelectorAll('.line[data-action-type="slot"] .error:not([hidden])')).map((e) => e.textContent);
        assert.deepEqual(errors, ['The place “afterSubmit” already has a Slot step: each place has one']);
    });
});
