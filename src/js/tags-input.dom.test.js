'use strict';

// DOM tests for the shared tag-entry widget (buildTagsInputControl) under jsdom.
// It owns an ordered tag list surfaced as removable chips, a free-text entry
// that commits on Enter / comma / the "+" button, and a suggestion listbox
// driven by the host's getSuggestions. node's test runner isolates each file in
// its own process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let buildTagsInputControl;
let host;
let changes;
let suggestionPool;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;

    ({buildTagsInputControl} = await import('./tags-input.js'));
});

beforeEach(() => {
    document.body.innerHTML = '';
    changes = 0;
    suggestionPool = [];
});

function makeWidget(opts = {}) {
    const widget = buildTagsInputControl({
        fieldId: 'tags',
        labelText: 'Tags',
        getSuggestions: () => suggestionPool,
        onChange: () => { changes += 1; },
        ...opts,
    });
    host = document.createElement('div');
    host.appendChild(widget.el);
    document.body.appendChild(host);
    return widget;
}

const chipTexts = (widget) => Array.from(widget.el.querySelectorAll('.tag-input__chips .scan-tag'))
    .map((el) => el.textContent.replace('×', '').trim());
const options = (widget) => Array.from(widget.el.querySelectorAll('.tag-input__option')).map((o) => o.textContent);
const listbox = (widget) => widget.el.querySelector('.tag-input__listbox');

function typeInto(input, value) {
    input.value = value;
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
}

function pressKey(el, key) {
    const ev = new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
    el.dispatchEvent(ev);
    return ev;
}

function click(el) {
    el.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
}

describe('buildTagsInputControl', () => {
    test('starts empty with the entry collapsed and no add button', () => {
        const widget = makeWidget();
        assert.deepEqual(widget.getTags(), []);
        assert.deepEqual(chipTexts(widget), []);
        assert.equal(widget.el.querySelector('.tag-input__add').hidden, true);
    });

    test('setTags normalizes and renders chips', () => {
        const widget = makeWidget();
        widget.setTags(['  Desktop ', 'checkout', 'DESKTOP', '']);

        assert.deepEqual(widget.getTags(), ['Desktop', 'checkout']);
        assert.deepEqual(chipTexts(widget), ['Desktop', 'checkout']);
    });

    test('setTags accepts a comma-separated string', () => {
        const widget = makeWidget();
        widget.setTags('desktop, checkout');
        assert.deepEqual(widget.getTags(), ['desktop', 'checkout']);
    });

    test('getTags returns a copy, so callers cannot mutate the widget state', () => {
        const widget = makeWidget();
        widget.setTags(['desktop']);

        widget.getTags().push('sneaky');

        assert.deepEqual(widget.getTags(), ['desktop']);
    });

    test('Enter commits the typed tag and clears the entry', () => {
        const widget = makeWidget();
        const entry = widget.entry;

        typeInto(entry, 'desktop');
        pressKey(entry, 'Enter');

        assert.deepEqual(widget.getTags(), ['desktop']);
        assert.equal(entry.value, '');
        assert.equal(changes, 1);
    });

    test('a comma commits the typed tag like Enter', () => {
        const widget = makeWidget();
        typeInto(widget.entry, 'checkout');
        pressKey(widget.entry, ',');

        assert.deepEqual(widget.getTags(), ['checkout']);
    });

    test('the add button appears once text is typed and commits on click', () => {
        const widget = makeWidget();
        const addBtn = widget.el.querySelector('.tag-input__add');

        typeInto(widget.entry, 'mobile');
        assert.equal(addBtn.hidden, false);

        click(addBtn);
        assert.deepEqual(widget.getTags(), ['mobile']);
        assert.equal(addBtn.hidden, true);
    });

    test('duplicate tags are rejected case-insensitively without firing a change', () => {
        const widget = makeWidget();
        widget.setTags(['Desktop']);
        changes = 0;

        typeInto(widget.entry, 'desktop');
        pressKey(widget.entry, 'Enter');

        assert.deepEqual(widget.getTags(), ['Desktop']);
        assert.equal(changes, 0);
    });

    test('blank input does not commit a tag', () => {
        const widget = makeWidget();
        typeInto(widget.entry, '   ');
        pressKey(widget.entry, 'Enter');

        assert.deepEqual(widget.getTags(), []);
        assert.equal(changes, 0);
    });

    test('the chip remove button drops that tag and fires a change', () => {
        const widget = makeWidget();
        widget.setTags(['desktop', 'checkout']);
        changes = 0;

        click(widget.el.querySelectorAll('.scan-tag__remove')[0]);

        assert.deepEqual(widget.getTags(), ['checkout']);
        assert.equal(changes, 1);
    });

    test('Backspace on an empty entry removes the last tag', () => {
        const widget = makeWidget();
        widget.setTags(['desktop', 'checkout']);

        widget.entry.value = '';
        pressKey(widget.entry, 'Backspace');

        assert.deepEqual(widget.getTags(), ['desktop']);
    });

    test('Backspace with text in the entry leaves the tags alone', () => {
        const widget = makeWidget();
        widget.setTags(['desktop']);

        typeInto(widget.entry, 'che');
        pressKey(widget.entry, 'Backspace');

        assert.deepEqual(widget.getTags(), ['desktop']);
    });

    test('pasting a comma-separated list commits every tag', () => {
        const widget = makeWidget();
        const ev = new window.Event('paste', {bubbles: true, cancelable: true});
        ev.clipboardData = {getData: () => 'desktop, checkout ,desktop'};

        widget.entry.dispatchEvent(ev);

        assert.deepEqual(widget.getTags(), ['desktop', 'checkout']);
    });

    test('pasting a single value falls through to the browser default', () => {
        const widget = makeWidget();
        const ev = new window.Event('paste', {bubbles: true, cancelable: true});
        ev.clipboardData = {getData: () => 'desktop'};

        widget.entry.dispatchEvent(ev);

        assert.deepEqual(widget.getTags(), []);
        assert.equal(ev.defaultPrevented, false);
    });

    test('suggestions open on focus and filter as the user types', () => {
        suggestionPool = ['desktop', 'mobile', 'checkout'];
        const widget = makeWidget();

        widget.entry.dispatchEvent(new window.Event('focus', {bubbles: true}));
        assert.deepEqual(options(widget), ['desktop', 'mobile', 'checkout']);

        typeInto(widget.entry, 'o');
        assert.deepEqual(options(widget), ['desktop', 'mobile', 'checkout']);

        typeInto(widget.entry, 'che');
        assert.deepEqual(options(widget), ['checkout']);
    });

    test('an already-taken tag is not offered', () => {
        suggestionPool = ['desktop', 'mobile'];
        const widget = makeWidget();
        widget.setTags(['DESKTOP']);

        widget.entry.dispatchEvent(new window.Event('focus', {bubbles: true}));

        assert.deepEqual(options(widget), ['mobile']);
    });

    test('the listbox stays closed when nothing matches', () => {
        suggestionPool = ['desktop'];
        const widget = makeWidget();

        typeInto(widget.entry, 'zzz');

        assert.equal(listbox(widget).hidden, true);
        assert.equal(widget.entry.getAttribute('aria-expanded'), 'false');
    });

    test('mousedown on a suggestion commits it', () => {
        suggestionPool = ['desktop', 'mobile'];
        const widget = makeWidget();
        widget.entry.dispatchEvent(new window.Event('focus', {bubbles: true}));

        const opt = widget.el.querySelectorAll('.tag-input__option')[1];
        opt.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true, cancelable: true}));

        assert.deepEqual(widget.getTags(), ['mobile']);
        assert.deepEqual(options(widget), ['desktop']);
    });

    test('ArrowDown activates a suggestion and Enter commits it instead of the typed text', () => {
        suggestionPool = ['desktop', 'mobile'];
        const widget = makeWidget();

        typeInto(widget.entry, 'o');
        pressKey(widget.entry, 'ArrowDown');

        assert.equal(widget.entry.getAttribute('aria-activedescendant'), 'tags__suggest__0');

        pressKey(widget.entry, 'Enter');
        assert.deepEqual(widget.getTags(), ['desktop']);
    });

    test('ArrowUp from the top wraps to the last suggestion', () => {
        suggestionPool = ['desktop', 'mobile'];
        const widget = makeWidget();

        widget.entry.dispatchEvent(new window.Event('focus', {bubbles: true}));
        pressKey(widget.entry, 'ArrowUp');

        assert.equal(widget.entry.getAttribute('aria-activedescendant'), 'tags__suggest__1');
    });

    test('Escape closes an open listbox and marks the event consumed', () => {
        suggestionPool = ['desktop'];
        const widget = makeWidget();
        widget.entry.dispatchEvent(new window.Event('focus', {bubbles: true}));

        const ev = pressKey(widget.entry, 'Escape');

        assert.equal(listbox(widget).hidden, true);
        assert.equal(ev.defaultPrevented, true);
    });

    test('Escape with the listbox closed is left for the host to handle', () => {
        const widget = makeWidget();

        const ev = pressKey(widget.entry, 'Escape');

        assert.equal(ev.defaultPrevented, false);
    });

    test('the entry is labelled and wired to its listbox', () => {
        const widget = makeWidget();

        assert.equal(widget.entry.getAttribute('role'), 'combobox');
        assert.equal(widget.entry.getAttribute('aria-label'), 'Tags: type to add a tag');
        assert.equal(widget.entry.getAttribute('aria-controls'), 'tags__suggest');
        assert.equal(listbox(widget).getAttribute('role'), 'listbox');
    });

    test('each chip offers a labelled remove button', () => {
        const widget = makeWidget();
        widget.setTags(['desktop']);

        const remove = widget.el.querySelector('.scan-tag__remove');
        assert.equal(remove.getAttribute('aria-label'), 'Remove tag desktop');
    });
});
