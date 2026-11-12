'use strict';

// A step's card as the editor draws it: its kind as a pill before a title of
// its own, Collapse always beside the menu of its other buttons, "Then" and
// "Otherwise (optional)" for a condition's branches, and an empty list as
// "Nothing runs here." with one add button. Drives the REAL builder under
// jsdom, as the other builder DOM tests.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let win;
// The width the responsive menu is told the header has.
let headerWidth = 900;
const observers = [];

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
    globalThis.ResizeObserver = class {
        constructor(cb) { this.cb = cb; observers.push(this); }
        observe(el) { this.el = el; }
        unobserve() {}
        disconnect() {}
        fire() { this.cb([{ borderBoxSize: [{ inlineSize: headerWidth }] }]); }
    };
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

const header = (line) => line.querySelector(':scope > .line-header');

describe("a step's header", () => {
    test('its kind is a pill before a title of its own, and not there when the title is the kind', () => {
        const { actionsEl } = newBuilder([{ type: 'setVar', alias: 'The start locale', key: 'locale', value: 'en' }, { type: 'setVar', key: 'b', value: 'c' }]);
        const [named, plain] = actionsEl.querySelectorAll(':scope > .line');
        const pill = header(named).querySelector('.line-title-action-type');
        assert.equal(pill.hidden, false);
        assert.equal(pill.textContent, 'Set variable', 'no quotes, no hyphen');
        assert.equal(pill.nextElementSibling, header(named).querySelector('.line-title'), 'before the title');
        assert.equal(header(named).querySelector('.line-title').textContent, '1 - The start locale');
        assert.equal(header(plain).querySelector('.line-title-action-type').hidden, true);
        // One id per page: the pill no longer repeats the title's.
        const ids = Array.from(win.document.querySelectorAll('[id]')).map((e) => e.id);
        assert.equal(new Set(ids).size, ids.length);
    });

    test('Collapse stays beside the menu when the other buttons go into it', () => {
        const { actionsEl } = newBuilder([{ type: 'click', selector: 'a' }]);
        const controls = header(actionsEl.querySelector('.line')).querySelector('.line-controls');
        const collapse = controls.querySelector('.toggle-action');
        assert.equal(collapse.parentElement, controls);
        assert.equal(controls.classList.contains('is-menu'), false);
        // A sign of more, drawn only, before Collapse.
        const sign = controls.querySelector('.line-controls__more');
        assert.equal(sign.getAttribute('aria-hidden'), 'true');
        assert.equal(sign.nextElementSibling, collapse);
        headerWidth = 300;
        observers.forEach((o) => o.el && controls.closest('.line-header') === o.el && o.fire());
        headerWidth = 900;
        assert.equal(controls.classList.contains('is-menu'), true);
        assert.equal(collapse.parentElement, controls, 'not moved into the menu');
        const menu = controls.querySelector('.flyout-menu');
        assert.deepEqual(Array.from(menu.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
            ['Show info', 'Disable this action', 'Move up', 'Move down', 'Copy action', 'Remove']);
        assert.equal(controls.lastElementChild, collapse, 'at the row\'s end');
    });
});

describe('a call to a custom step', () => {
    test('"Open this custom step" sits beside the choice, the field taking the whole row', () => {
        const defs = { ...ACTION_DEFINITIONS, runCustomStep: { ...ACTION_DEFINITIONS.runCustomStep } };
        defs.runCustomStep.fields = { ...defs.runCustomStep.fields };
        defs.runCustomStep.fields.customStepId = {
            ...defs.runCustomStep.fields.customStepId,
            optionsProvider: () => [{ value: 'multi', label: 'multi - Multi-viewport scan' }]
        };
        const opened = [];
        defs.runCustomStep.openCustomStep = (id) => opened.push(id);
        const actionsEl = win.document.createElement('div');
        const toolbarEl = win.document.createElement('div');
        win.document.body.append(actionsEl, toolbarEl);
        const builder = createActionsBuilder({ defs, actionsEl, toolbarEl, options: { useHorizontalStepper: false } });
        builder.loadActions([{ type: 'runCustomStep', customStepId: 'multi' }], { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });

        const field = actionsEl.querySelector('.line > .fields > .field[data-field-name="customStepId"]');
        assert.equal(field.dataset.wide, 'row');
        const row = field.querySelector('.runcustomstep-pick');
        const select = row.querySelector(':scope > select');
        const open = row.querySelector(':scope > .runcustomstep-open');
        assert.equal(select.nextElementSibling, open, 'the button right after the choice, in one row');
        assert.equal(field.querySelector('label').htmlFor, select.id, 'the choice still named by its label');
        assert.equal(open.hidden, false);
        open.click();
        assert.deepEqual(opened, ['multi']);
        select.value = '';
        select.dispatchEvent(new win.Event('change'));
        assert.equal(open.hidden, true, 'no way to a custom step not chosen');
    });
});

describe("a condition's branches and empty lists", () => {
    test('are "Then" and "Otherwise (optional)"; an empty one says nothing runs, with one add button', () => {
        const { actionsEl } = newBuilder([{ type: 'if', selectorExists: '#otp', actions: [{ type: 'click', selector: '#verify' }] }]);
        const lists = Array.from(actionsEl.querySelectorAll('.line > .action-arrays-below > .action-array'));
        const titleOf = (list) => list.querySelector('.action-array__title').textContent;
        assert.deepEqual(lists.map(titleOf), ['Then', 'Otherwise(optional)']);
        const [then, otherwise] = lists;
        assert.equal(then.classList.contains('is-empty'), false);
        assert.equal(otherwise.classList.contains('is-empty'), true);
        const empty = otherwise.querySelector(':scope > .action-array__empty');
        assert.equal(empty.querySelector('.action-array__empty-note').textContent, 'Nothing runs here.');
        assert.equal(empty.querySelector('.action-array__add-first').textContent.trim(), 'Add step');
        // The list's group is still named by its title.
        assert.equal(otherwise.getAttribute('aria-labelledby'), otherwise.querySelector('.action-array__title').id);
    });

    test('the full row comes back with the first step, and goes with the last', () => {
        const { actionsEl } = newBuilder([{ type: 'group', actions: [] }]);
        const list = actionsEl.querySelector('.action-array');
        assert.equal(list.classList.contains('is-empty'), true);
        // A shortcut of the full row adds a step, as the palette would.
        Array.from(list.querySelectorAll('.action-array__footer button')).find((b) => b.textContent.trim() === 'Click').click();
        assert.equal(list.classList.contains('is-empty'), false);
        list.querySelector('.actions-subcontainer > .line .remove').click();
        assert.equal(list.classList.contains('is-empty'), true);
    });
});
