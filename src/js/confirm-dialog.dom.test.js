'use strict';

// DOM tests for the question asked before an action that cannot be undone
// (confirm-dialog.js), such as closing a report: what it says, where focus
// starts, and what each answer resolves to. Driven under jsdom.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let askToConfirm;
let doc;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body><button id="opener">Close report</button></body></html>', {pretendToBeVisual: true});
    doc = dom.window.document;
    ({askToConfirm} = await import('./confirm-dialog.js'));
});

const QUESTION = {
    title: 'Close this report?',
    text: 'It leaves the screen.',
    confirmLabel: 'Close report',
    cancelLabel: 'Keep it open',
};

function open() {
    doc.getElementById('opener').focus();
    const answer = askToConfirm(doc, QUESTION);
    const dialog = doc.querySelector('dialog.confirm-dialog');
    const [confirm, cancel] = dialog.querySelectorAll('.confirm-dialog__actions button');
    return {answer, dialog, confirm, cancel};
}

describe('confirm dialog', () => {
    test('asks its question, named by its title and described by its text', async () => {
        const {answer, dialog, cancel} = open();
        const title = doc.getElementById(dialog.getAttribute('aria-labelledby'));
        assert.equal(title.textContent, 'Close this report?');
        assert.equal(doc.getElementById(dialog.getAttribute('aria-describedby')).textContent, 'It leaves the screen.');
        cancel.click();
        await answer;
    });

    test('starts on the answer that keeps things as they are', async () => {
        const {answer, cancel} = open();
        assert.equal(doc.activeElement, cancel);
        assert.equal(cancel.textContent, 'Keep it open');
        cancel.click();
        await answer;
    });

    test('confirming resolves true and removes the dialog', async () => {
        const {answer, confirm} = open();
        assert.equal(confirm.textContent, 'Close report');
        confirm.click();
        assert.equal(await answer, true);
        assert.equal(doc.querySelector('dialog.confirm-dialog'), null);
    });

    test('cancelling resolves false and gives focus back', async () => {
        const {answer, cancel} = open();
        cancel.click();
        assert.equal(await answer, false);
        assert.equal(doc.activeElement, doc.getElementById('opener'));
    });
});
