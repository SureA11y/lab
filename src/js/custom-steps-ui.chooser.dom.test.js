'use strict';

// Above the custom step editor, every custom step as a button, the one open
// marked, to switch between them; and the open one's inputs in a table.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let createCustomStepsUi;
let win;
before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Event = win.Event;
    ({ createCustomStepsUi } = await import('./custom-steps-ui.js'));
});

function setup() {
    const chooser = win.document.createElement('div');
    const inputs = win.document.createElement('div');
    const idInput = win.document.createElement('input');
    const nameInput = win.document.createElement('input');
    win.document.body.append(chooser, inputs, idInput, nameInput);
    const app = {
        customStepsData: [
            { id: 'login', name: 'Log in', inputs: [{ name: 'user', required: true, label: 'User name' }], actions: [] },
            { id: 'banners', name: 'Dismiss banners', inputs: [], actions: [] },
        ],
        selectedCustomStepIndex: 0,
        customStepsChooserEl: chooser,
        customStepInputsHost: inputs,
        customStepIdInput: idInput,
        customStepNameInput: nameInput,
        syncingCustomStepEditor: false,
        setCustomStepActionsHistoryBaselineToCurrent() {},
        resetCustomStepsHistory() {},
        scheduleCustomStepsHistoryPush() {},
        onCustomStepsListChanged() {},
    };
    const ui = createCustomStepsUi(app);
    // As the app sets it up: no builder in this test, so only what it needs.
    ui.initCustomStepsUi({});
    ui.setCustomStepsInUi(app.customStepsData);
    return { app, ui, chooser, inputs };
}

describe('the custom steps above the editor', () => {
    test('each is a button, the open one marked as current', () => {
        const { chooser } = setup();
        const buttons = Array.from(chooser.querySelectorAll('button'));
        assert.deepEqual(buttons.map((b) => b.textContent), ['Log in', 'Dismiss banners']);
        assert.equal(buttons[0].getAttribute('aria-current'), 'true');
        assert.equal(buttons[1].getAttribute('aria-current'), null);
        assert.equal(chooser.getAttribute('aria-labelledby'), 'custom-steps-chooser-title');
    });

    test('a button opens its custom step, its inputs in the table, and focus stays on it', () => {
        const { app, chooser, inputs } = setup();
        assert.equal(inputs.querySelector('.custom-step-inputs__label').value, 'User name');
        const second = chooser.querySelectorAll('button')[1];
        second.focus();
        second.click();
        assert.equal(app.selectedCustomStepIndex, 1);
        const now = chooser.querySelector('[aria-current="true"]');
        assert.equal(now.textContent, 'Dismiss banners');
        assert.equal(win.document.activeElement, now);
        assert.equal(inputs.querySelectorAll('tbody tr').length, 0);
    });

    test('an input added in the table is kept with the custom step, in the saved format', () => {
        const { app, inputs } = setup();
        inputs.querySelector('.custom-step-inputs__add').click();
        const row = inputs.querySelectorAll('tbody tr')[1];
        row.querySelector('.custom-step-inputs__name').value = 'password';
        row.querySelector('.custom-step-inputs__name').dispatchEvent(new win.Event('input'));
        assert.deepEqual(app.customStepsData[0].inputs, [{ name: 'user', required: true, label: 'User name' }, { name: 'password' }]);
    });
});
