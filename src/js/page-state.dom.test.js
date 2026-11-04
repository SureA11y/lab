'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const tick = () => new Promise((res) => setTimeout(res, 0));

test('the page knows while a dialog is open, wherever it is', async () => {
    const { trackOpenDialogs } = await import('./page-state.js');
    const { window } = new JSDOM('<!doctype html><html><body><main><dialog id="a"></dialog></main></body></html>');
    const doc = window.document;
    trackOpenDialogs(doc);
    const root = doc.documentElement;
    assert.equal(root.classList.contains('has-open-dialog'), false);
    doc.getElementById('a').setAttribute('open', '');
    await tick();
    assert.equal(root.classList.contains('has-open-dialog'), true);
    doc.getElementById('a').removeAttribute('open');
    await tick();
    assert.equal(root.classList.contains('has-open-dialog'), false);
});

test('a dialog taken out of the page while open frees the page', async () => {
    const { trackOpenDialogs } = await import('./page-state.js');
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = window.document;
    trackOpenDialogs(doc);
    const d = doc.createElement('dialog');
    d.setAttribute('open', '');
    doc.body.append(d);
    await tick();
    assert.equal(doc.documentElement.classList.contains('has-open-dialog'), true);
    d.remove();
    await tick();
    assert.equal(doc.documentElement.classList.contains('has-open-dialog'), false);
});

test('opening a details element is not a dialog', async () => {
    const { trackOpenDialogs } = await import('./page-state.js');
    const { window } = new JSDOM('<!doctype html><html><body><details id="d"><summary>x</summary></details></body></html>');
    const doc = window.document;
    trackOpenDialogs(doc);
    doc.getElementById('d').setAttribute('open', '');
    await tick();
    assert.equal(doc.documentElement.classList.contains('has-open-dialog'), false);
});
