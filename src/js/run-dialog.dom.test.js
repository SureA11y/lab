'use strict';

// DOM tests for the queued-run dialog frame (createRunDialog), under jsdom:
// what it shows, its footer buttons, and that closing it however it closes
// runs onClose and gives focus back. jsdom has no showModal, so a minimal one
// stands in: it sets `open` and fires `close` the way the browser does.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRunDialog;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    const proto = win.HTMLDialogElement.prototype;
    proto.showModal = function () { this.setAttribute('open', ''); };
    proto.close = function () {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new win.Event('close'));
    };
    ({createRunDialog} = await import('./run-dialog.js'));
});

beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Watch</button>';
});

describe('run dialog', () => {
    test('opens named by its title and described by its status, with focus on Close', () => {
        const d = createRunDialog({className: 'watch-dialog'});
        d.open({title: 'Watching “v2” (workflow 2 of 3)'});
        d.setStatus('Running.');
        const el = d.dialog;
        assert.ok(el.open);
        assert.ok(el.classList.contains('watch-dialog'));
        assert.equal(document.getElementById(el.getAttribute('aria-labelledby')).textContent, 'Watching “v2” (workflow 2 of 3)');
        assert.equal(document.getElementById(el.getAttribute('aria-describedby')).textContent, 'Running.');
        assert.equal(document.activeElement.textContent, 'Close');
    });

    test('a busy status carries a hidden spinner after its words, gone with the next status', () => {
        const d = createRunDialog();
        d.open({title: 't'});
        d.setStatus('Running', '', {busy: true});
        const status = d.dialog.querySelector('.run-dialog-status');
        const spin = status.querySelector('.tab-spinner');
        assert.ok(spin);
        assert.equal(spin.getAttribute('aria-hidden'), 'true');
        assert.equal(status.textContent.trim(), 'Running');
        d.setStatus('Finished.', 'ok');
        assert.equal(status.querySelector('.tab-spinner'), null);
    });

    test('footer buttons appear only when given', () => {
        const d = createRunDialog();
        d.open({title: 't'});
        const footer = d.dialog.querySelector('.run-dialog-footer');
        assert.equal(footer.hidden, true);
        let clicked = 0;
        d.setActions([{label: 'Open report', primary: true, onClick: () => clicked++}]);
        assert.equal(footer.hidden, false);
        footer.querySelector('button').click();
        assert.equal(clicked, 1);
    });

    test('the Close button closes it, runs onClose, empties the body and gives focus back', () => {
        const d = createRunDialog();
        let closed = 0;
        d.open({title: 't', onClose: () => closed++, returnFocus: () => document.getElementById('opener').focus()});
        d.body.append(document.createElement('p'));
        d.dialog.querySelector('.src-dialog-close').click();
        assert.equal(d.isOpen(), false);
        assert.equal(closed, 1);
        assert.equal(d.body.children.length, 0);
        assert.equal(document.activeElement.id, 'opener');
    });

    test('a click on the backdrop closes it; a click inside does not', () => {
        const d = createRunDialog();
        d.open({title: 't'});
        d.body.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        assert.equal(d.isOpen(), true);
        d.dialog.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        assert.equal(d.isOpen(), false);
    });

    test('closing with returnFocus: false leaves focus to the caller', () => {
        const d = createRunDialog();
        let returned = 0;
        d.open({title: 't', returnFocus: () => returned++});
        d.close({returnFocus: false});
        assert.equal(returned, 0);
    });

    test('opening again closes the first, running its onClose', () => {
        const d = createRunDialog();
        const log = [];
        d.open({title: 'one', onClose: () => log.push('one')});
        d.open({title: 'two', onClose: () => log.push('two')});
        assert.deepEqual(log, ['one']);
        assert.equal(d.isOpen(), true);
        assert.equal(document.getElementById(d.dialog.getAttribute('aria-labelledby')).textContent, 'two');
    });
});
