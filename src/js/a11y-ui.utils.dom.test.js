'use strict';

// DOM tests for the split button's outside-click-to-close menu behavior, and
// specifically for a document-level listener leak: createSplitButton() used to
// call document.addEventListener('click', ...) on every invocation, so every
// re-render (e.g. loading a new report) permanently leaked another listener
// rather than sharing one. node's test runner isolates each file in its own
// process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createSplitButton;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true, url: 'http://127.0.0.1:3000/'});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.HTMLImageElement = win.HTMLImageElement;

    ({createSplitButton} = await import('./a11y-ui.utils.js'));
});

beforeEach(() => {
    document.body.innerHTML = '';
});

function makeSplitButton(label = 'Download report') {
    const btn = createSplitButton({
        label,
        onAction: () => {},
        items: [{id: 'x', label: 'Other option', onSelect: () => {}}],
    });
    document.body.appendChild(btn);
    return btn;
}

describe('createSplitButton: document click listener', () => {
    test('creating many split buttons across re-renders installs only one document click listener', () => {
        let addedClickListeners = 0;
        const realAdd = document.addEventListener.bind(document);
        document.addEventListener = (type, ...rest) => {
            if (type === 'click') addedClickListeners += 1;
            return realAdd(type, ...rest);
        };

        try {
            for (let i = 0; i < 5; i++) {
                document.body.innerHTML = ''; // simulate a re-render discarding the old button
                makeSplitButton();
            }
        } finally {
            document.addEventListener = realAdd;
        }

        assert.equal(addedClickListeners, 1);
    });

    test('a click outside the button still closes its open menu', () => {
        const root = makeSplitButton();
        const chevron = root.querySelector('.split-button__chevron');
        const menu = root.querySelector('.split-button__menu');

        chevron.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        assert.equal(menu.hidden, false);

        document.body.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        assert.equal(menu.hidden, true);
    });

    test('a click after an earlier button was discarded by a re-render (without ever closing its menu) does not throw', () => {
        makeSplitButton('First');
        document.body.innerHTML = ''; // discard it - this is what used to strand a listener
        const second = makeSplitButton('Second');
        const chevron = second.querySelector('.split-button__chevron');
        chevron.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));

        assert.doesNotThrow(() => {
            document.body.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        });
    });
});

describe('appendImgToDialog', () => {
    test('an item is found by its address as given, a relative one too', async () => {
        const {appendImgToDialog} = await import('./a11y-ui.utils.js');
        const items = [];
        const dialog = {addItem: (item) => items.push(item)};
        for (const src of ['images/03d45ad8b99de9f23afc.jpg', '/reports/batches/x/images/a.jpg', 'data:image/png;base64,AAAA']) {
            const img = document.createElement('img');
            img.src = src;
            appendImgToDialog(img, dialog);
        }
        // A queued result names its pictures "images/…"; the thumbnail opens
        // the dialog by that, not by the absolute address img.src gives.
        assert.deepEqual(items.map((i) => i.id), ['images/03d45ad8b99de9f23afc.jpg', '/reports/batches/x/images/a.jpg', 'data:image/png;base64,AAAA']);
    });
});
