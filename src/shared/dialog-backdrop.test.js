'use strict';

// A modal dialog closes on a click on its backdrop (dialog-backdrop.js): only
// when the press and the release both fall outside its box, through its
// cancel event as Escape does, and not when it says it must not.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const B = require('./dialog-backdrop.js');

let win;
let doc;
beforeEach(() => {
    win = new JSDOM('<!doctype html><body></body>').window;
    doc = win.document;
    B.installBackdropClose(doc);
});

// An open dialog whose box is 100,100 to 300,300.
function openDialog(attrs = {}) {
    const dialog = doc.createElement('dialog');
    for (const [k, v] of Object.entries(attrs)) if (k !== 'nonModal') dialog.setAttribute(k, v);
    doc.body.append(dialog);
    dialog.setAttribute('open', '');
    dialog.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new win.Event('close')); };
    dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 });
    // As showModal() leaves it, which jsdom does not track.
    const matches = dialog.matches.bind(dialog);
    dialog.matches = (sel) => (sel === ':modal' ? !attrs.nonModal : matches(sel));
    return dialog;
}
const at = (type, target, x, y) => target.dispatchEvent(new win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
function clickAt(dialog, down, up) {
    // jsdom's PointerEvent may be missing: a MouseEvent named pointerdown carries the point.
    dialog.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, clientX: down[0], clientY: down[1] }));
    at('click', dialog, up[0], up[1]);
}

describe('a click on a modal dialog\'s backdrop', () => {
    test('closes it, through its cancel event', () => {
        const dialog = openDialog();
        let cancelled = 0;
        dialog.addEventListener('cancel', () => { cancelled += 1; });
        clickAt(dialog, [20, 20], [20, 20]);
        assert.equal(dialog.open, false);
        assert.equal(cancelled, 1);
    });

    test('inside its box (its padding), the dialog stays open', () => {
        const dialog = openDialog();
        clickAt(dialog, [150, 150], [150, 150]);
        assert.equal(dialog.open, true);
    });

    test('a press inside released outside (selecting text, dragging) is no click on the backdrop', () => {
        const dialog = openDialog();
        clickAt(dialog, [150, 150], [20, 20]);
        assert.equal(dialog.open, true);
    });

    test('a dialog that handles cancel itself closes its own way', () => {
        const dialog = openDialog();
        let own = 0;
        dialog.addEventListener('cancel', (e) => { e.preventDefault(); own += 1; });
        clickAt(dialog, [20, 20], [20, 20]);
        assert.equal(own, 1);
        assert.equal(dialog.open, true, 'prevented: the dialog decides');
    });

    test('a dialog marked data-no-backdrop-close stays open', () => {
        const dialog = openDialog({ 'data-no-backdrop-close': '' });
        clickAt(dialog, [20, 20], [20, 20]);
        assert.equal(dialog.open, true);
    });

    test('a dialog opened without showModal() has no backdrop to click', () => {
        const dialog = openDialog({ nonModal: true });
        clickAt(dialog, [20, 20], [20, 20]);
        assert.equal(dialog.open, true);
    });

    test('a click on something inside the dialog is not on its backdrop', () => {
        const dialog = openDialog();
        const button = doc.createElement('button');
        dialog.append(button);
        button.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20 }));
        at('click', button, 20, 20);
        assert.equal(dialog.open, true);
    });
});
