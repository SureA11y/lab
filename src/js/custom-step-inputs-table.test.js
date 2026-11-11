'use strict';

// A custom step's inputs as a table: name, label, required, a row each,
// read and written in the format custom steps are saved in.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let M;
let win;
before(async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="t"></div></body></html>');
    win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    M = await import('./custom-step-inputs-table.js');
});

function table(inputs) {
    const host = win.document.createElement('div');
    win.document.body.append(host);
    let changes = 0;
    const t = M.createInputsTable({ host, onChange: () => { changes += 1; } });
    t.setInputs(inputs);
    return { t, host, changes: () => changes, rows: () => Array.from(host.querySelectorAll('tbody tr')) };
}

describe('inputLabelOf', () => {
    test('its own label, or its name in words', () => {
        assert.equal(M.inputLabelOf({ name: 'viewLabel', label: ' View label ' }), 'View label');
        assert.equal(M.inputLabelOf({ name: 'elementScreenshots' }), 'Element screenshots');
        assert.equal(M.inputLabelOf({ name: 'element-screenshots' }), 'Element screenshots');
        assert.equal(M.inputLabelOf({ name: 'max_URLCount' }), 'Max url count');
        assert.equal(M.inputLabelOf({ name: 'waitMs' }), 'Wait ms');
        assert.equal(M.inputLabelOf({ name: '' }), '');
    });
});

describe('the inputs table', () => {
    test('shows each input as a row, and reads back the same, its default kept', () => {
        const saved = [
            { name: 'label', required: true, label: 'Scan name' },
            { name: 'viewports', required: true },
            { name: 'waitMs', default: '500' },
        ];
        const { t, rows } = table(saved);
        assert.equal(rows().length, 3);
        assert.equal(rows()[0].querySelector('.custom-step-inputs__label').value, 'Scan name');
        assert.equal(rows()[1].querySelector('.custom-step-inputs__required').checked, true);
        assert.equal(rows()[2].querySelector('.custom-step-inputs__label').placeholder, 'Wait ms', 'what a call shows without one');
        assert.deepEqual(t.getInputs(), saved);
    });

    test('every field is named with its row, and the table by its title', () => {
        const { host, rows } = table([{ name: 'a' }, { name: 'b' }]);
        const table_ = host.querySelector('table');
        assert.equal(win.document.getElementById(table_.getAttribute('aria-labelledby')).textContent, 'Inputs');
        const second = rows()[1];
        assert.equal(second.querySelector('.custom-step-inputs__name').getAttribute('aria-label'), 'Input 2 name');
        assert.equal(second.querySelector('.custom-step-inputs__label').getAttribute('aria-label'), 'Input 2 label');
        assert.equal(second.querySelector('.custom-step-inputs__required').getAttribute('aria-label'), 'Input 2 required');
        assert.equal(second.querySelector('.custom-step-inputs__remove').getAttribute('aria-label'), 'Remove input 2, b');
        assert.deepEqual(Array.from(host.querySelectorAll('th')).map((th) => th.getAttribute('scope')), ['col', 'col', 'col', 'col']);
    });

    test('Add input adds a row and puts focus in its name; Remove takes focus to the row after', () => {
        const { t, host, rows, changes } = table([{ name: 'a' }, { name: 'b' }]);
        host.querySelector('.custom-step-inputs__add').click();
        assert.equal(rows().length, 3);
        assert.equal(win.document.activeElement, rows()[2].querySelector('.custom-step-inputs__name'));
        rows()[2].querySelector('.custom-step-inputs__name').value = 'section';
        rows()[2].querySelector('.custom-step-inputs__name').dispatchEvent(new win.Event('input'));
        rows()[2].querySelector('.custom-step-inputs__required').checked = true;
        rows()[2].querySelector('.custom-step-inputs__required').dispatchEvent(new win.Event('change'));
        assert.deepEqual(t.getInputs(), [{ name: 'a' }, { name: 'b' }, { name: 'section', required: true }]);
        rows()[0].querySelector('.custom-step-inputs__remove').click();
        assert.deepEqual(t.getInputs().map((i) => i.name), ['b', 'section']);
        assert.equal(win.document.activeElement, rows()[0].querySelector('.custom-step-inputs__name'));
        assert.ok(changes() >= 4);
        // The last one removed: focus goes to Add input, and the table says it has none.
        rows()[1].querySelector('.custom-step-inputs__remove').click();
        rows()[0].querySelector('.custom-step-inputs__remove').click();
        assert.equal(win.document.activeElement, host.querySelector('.custom-step-inputs__add'));
        assert.equal(host.querySelector('table').hidden, true);
        assert.equal(host.querySelector('.custom-step-inputs__empty').hidden, false);
    });

    test('a name given twice is marked, said, and kept once; an empty name is not kept', () => {
        const { t, host, rows } = table([{ name: 'a' }, { name: 'a', required: true }, { name: '' }]);
        assert.deepEqual(t.getInputs(), [{ name: 'a' }]);
        assert.equal(rows()[0].querySelector('.custom-step-inputs__name').getAttribute('aria-invalid'), null);
        assert.equal(rows()[1].querySelector('.custom-step-inputs__name').getAttribute('aria-invalid'), 'true');
        assert.match(host.querySelector('.custom-step-inputs__error').textContent, /“a” is the name of more than one input/);
    });

    test('with no custom step open, its fields and buttons are off', () => {
        const { t, host } = table([{ name: 'a' }]);
        t.setDisabled(true);
        assert.ok(Array.from(host.querySelectorAll('input, button')).every((el) => el.disabled));
        t.setDisabled(false);
        assert.ok(Array.from(host.querySelectorAll('input, button')).every((el) => !el.disabled));
    });
});
