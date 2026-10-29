'use strict';

// DOM round-trip tests for the a11yScan "Tags" (scanTags) authoring widget,
// driving the REAL actions builder under jsdom. These lock in the behaviour
// that matters to users:
//   - saving a workflow captures the tags on each scan (getValue)
//   - loading a saved workflow restores the tags into the widget (loadActions)
//   - typing a tag + Enter commits it (not just programmatic setTags)
//   - a new scan can pick a tag already used by another scan (suggestions)
//
// node's test runner isolates each file in its own process, so the DOM globals
// installed here don't leak into other suites.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createRequire } = require('node:module');

const requireFromHere = createRequire(__filename);
const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let win;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    win = dom.window;

    // Mirror the DOM constructors/globals the builder touches onto globalThis.
    globalThis.window = win;
    for (const key of Object.getOwnPropertyNames(win)) {
        if (key in globalThis) continue;
        try { globalThis[key] = win[key]; } catch { /* some props are getters-only */ }
    }
    globalThis.document = win.document;
    globalThis.CSS = win.CSS || { escape: (s) => String(s) };
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    // jsdom doesn't implement these; the builder's responsive menu only needs no-ops.
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    if (!globalThis.IntersectionObserver) {
        globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    }

    ({ createActionsBuilder } = await import('./actions-builder.module.js'));
});

// Build a fresh builder wired exactly like the web app (non-stepper mode).
function newBuilder() {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({
        defs: ACTION_DEFINITIONS,
        actionsEl,
        toolbarEl,
        engineCapabilities: null,
        options: { useHorizontalStepper: false },
    });
    return { builder, actionsEl };
}

function tagField(scope) {
    return scope.querySelector('.field[data-field-name="scanTags"]');
}

function readA11yScan(builder) {
    const out = builder.getValue({ validate: false, maskValues: 'text' });
    return (out.value || []).find((a) => a.type === 'a11yScan');
}

describe('a11yScan scanTags authoring widget (DOM)', () => {
    test('renders as the tag widget for the scanTags field', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        const field = tagField(actionsEl);
        assert.ok(field, 'scanTags field is rendered');
        assert.equal(field.dataset.widget, 'tags');
        assert.ok(field._tagsWidget, 'widget instance is attached');
    });

    test('saving captures tags set on a scan (getValue)', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        tagField(actionsEl)._tagsWidget.setTags(['desktop', 'checkout']);

        // Both the explicit-options call and the bare getValue() config-io uses.
        assert.deepEqual(readA11yScan(builder).scanTags, ['desktop', 'checkout']);
        const bare = (builder.getValue().value || []).find((a) => a.type === 'a11yScan');
        assert.deepEqual(bare.scanTags, ['desktop', 'checkout']);
    });

    test('typing a tag and pressing Enter commits and serializes it', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        const entry = tagField(actionsEl).querySelector('.tag-input__entry');

        entry.value = 'desktop';
        entry.dispatchEvent(new win.Event('input', { bubbles: true }));
        entry.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        assert.equal(actionsEl.querySelectorAll('.field[data-field-name="scanTags"] .scan-tag').length, 1);
        assert.equal(entry.value, '', 'entry clears after commit');
        assert.deepEqual(readA11yScan(builder).scanTags, ['desktop']);
    });

    test('the inline "+" button is hidden until text is typed', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        const field = tagField(actionsEl);
        const entry = field.querySelector('.tag-input__entry');
        const addBtn = field.querySelector('.tag-input__add');

        assert.ok(addBtn, 'add button exists');
        assert.equal(addBtn.hidden, true, 'hidden with an empty field');

        entry.value = 'desktop';
        entry.dispatchEvent(new win.Event('input', { bubbles: true }));
        assert.equal(addBtn.hidden, false, 'shown once there is text');
    });

    test('clicking "+" commits the typed tag like Enter and hides again', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        const field = tagField(actionsEl);
        const entry = field.querySelector('.tag-input__entry');
        const addBtn = field.querySelector('.tag-input__add');

        entry.value = 'checkout';
        entry.dispatchEvent(new win.Event('input', { bubbles: true }));
        addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

        assert.equal(field.querySelectorAll('.scan-tag').length, 1);
        assert.equal(entry.value, '');
        assert.equal(addBtn.hidden, true, 'hidden again after commit');
        assert.deepEqual(readA11yScan(builder).scanTags, ['checkout']);
    });

    test('loading a saved workflow restores the tags into the scan', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions([{ type: 'a11yScan', label: 'Home', scanTags: ['mobile', 'tablet'] }], {});

        const field = tagField(actionsEl);
        assert.deepEqual(field._tagsWidget.getTags(), ['mobile', 'tablet']);
        assert.equal(field.querySelectorAll('.scan-tag').length, 2, 'chips rendered on load');
        assert.deepEqual(readA11yScan(builder).scanTags, ['mobile', 'tablet']);
    });

    test('save -> load -> save round-trip preserves tags', () => {
        const a = newBuilder();
        a.builder.addAction('a11yScan');
        tagField(a.actionsEl)._tagsWidget.setTags(['alpha', 'beta']);
        const saved = a.builder.getValue(); // as config export does

        const b = newBuilder();
        b.builder.loadActions(saved.value, {}); // as config import does
        assert.deepEqual(readA11yScan(b.builder).scanTags, ['alpha', 'beta']);
    });

    test('a new scan can pick a tag already used by another scan (suggestions)', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        builder.addAction('a11yScan');
        const fields = actionsEl.querySelectorAll('.field[data-field-name="scanTags"]');

        fields[0]._tagsWidget.setTags(['desktop']);

        const entry2 = fields[1].querySelector('.tag-input__entry');
        entry2.dispatchEvent(new win.FocusEvent('focus', { bubbles: true }));

        const listbox = fields[1].querySelector('.tag-input__listbox');
        const options = [...fields[1].querySelectorAll('.tag-input__option')].map((o) => o.textContent);
        assert.equal(listbox.hidden, false, 'suggestion list opens on focus');
        assert.deepEqual(options, ['desktop']);
    });

    test('a suggested tag already on the current scan is not re-offered', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('a11yScan');
        builder.addAction('a11yScan');
        const fields = actionsEl.querySelectorAll('.field[data-field-name="scanTags"]');

        fields[0]._tagsWidget.setTags(['desktop', 'mobile']);
        fields[1]._tagsWidget.setTags(['desktop']); // already has desktop

        const entry2 = fields[1].querySelector('.tag-input__entry');
        entry2.dispatchEvent(new win.FocusEvent('focus', { bubbles: true }));

        const options = [...fields[1].querySelectorAll('.tag-input__option')].map((o) => o.textContent);
        assert.deepEqual(options, ['mobile'], 'only tags not already on this scan are suggested');
    });
});
