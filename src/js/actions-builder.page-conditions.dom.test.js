'use strict';

// DOM tests for the steps that set how a page is shown. Set color scheme and
// contrast: each select starts on "Keep as it is", an empty value the step
// leaves out, so a new step changes neither until one is chosen. Set
// language: a language from the list or typed, a typed one wins, and one of
// the two is needed.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let win;

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
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    if (!globalThis.IntersectionObserver) {
        globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    }

    ({ createActionsBuilder } = await import('./actions-builder.module.js'));
});

function newBuilder(actions) {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({
        defs: ACTION_DEFINITIONS,
        actionsEl,
        toolbarEl,
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const field = (actionsEl, name) =>
    actionsEl.querySelector(`.line .field[data-field-name="${name}"] select`);
const input = (actionsEl, name) =>
    actionsEl.querySelector(`.line .field[data-field-name="${name}"] input`);

describe('Set color scheme and contrast', () => {
    test('a field the step leaves out starts on "Keep as it is", and is saved out', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setColorScheme', colorScheme: 'dark' }]);
        const contrast = field(actionsEl, 'highContrast');
        assert.equal(contrast.value, '');
        assert.equal(contrast.selectedOptions[0].textContent, 'Keep as it is');
        assert.equal(field(actionsEl, 'colorScheme').value, 'dark');

        const out = builder.getValue();
        assert.equal(out.ok, true);
        assert.equal(out.value[0].colorScheme, 'dark');
        assert.equal('highContrast' in out.value[0], false);
    });

    test('a value the step names is shown, and "Keep as it is" can be chosen again', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setColorScheme', highContrast: 'off' }]);
        const contrast = field(actionsEl, 'highContrast');
        assert.equal(contrast.value, 'off');
        assert.equal(field(actionsEl, 'colorScheme').value, '');

        contrast.value = 'on';
        assert.equal(builder.getValue().value[0].highContrast, 'on');
        field(actionsEl, 'colorScheme').value = 'light';
        contrast.value = '';
        const step = builder.getValue().value[0];
        assert.equal(step.colorScheme, 'light');
        assert.equal('highContrast' in step, false);
    });

    test('Run default is a color scheme of its own, saved as default', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setColorScheme', colorScheme: 'default' }]);
        const scheme = field(actionsEl, 'colorScheme');
        assert.equal(scheme.value, 'default');
        assert.equal(scheme.selectedOptions[0].textContent, 'Run default');
        assert.equal(builder.getValue().value[0].colorScheme, 'default');
    });

    test('both kept as they are would change nothing, so the step asks for one', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setColorScheme' }]);
        assert.equal(builder.getValue().ok, false);
        const scheme = field(actionsEl, 'colorScheme');
        assert.equal(scheme.getAttribute('aria-invalid'), 'true');

        field(actionsEl, 'highContrast').value = 'on';
        assert.equal(builder.getValue().ok, true);
    });
});

describe('Set language', () => {
    test('a new step chooses nothing, and asks for a language', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setLanguage' }]);
        const listed = field(actionsEl, 'language');
        assert.equal(listed.value, '');
        assert.equal(listed.options[1].value, 'default');
        assert.equal(builder.getValue().ok, false);
        assert.equal(listed.getAttribute('aria-invalid'), 'true');

        listed.value = 'de-DE';
        const out = builder.getValue();
        assert.equal(out.ok, true);
        assert.equal(out.value[0].language, 'de-DE');
        assert.equal('customLanguage' in out.value[0], false);
    });

    test('a typed language is enough on its own, and is checked unless a variable gives it', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setLanguage', customLanguage: 'es-MX' }]);
        assert.equal(input(actionsEl, 'customLanguage').value, 'es-MX');
        assert.equal(builder.getValue().ok, true);

        input(actionsEl, 'customLanguage').value = 'not a tag';
        assert.equal(builder.getValue().ok, false);
        assert.equal(input(actionsEl, 'customLanguage').getAttribute('aria-invalid'), 'true');

        input(actionsEl, 'customLanguage').value = '{var:lang}';
        assert.equal(builder.getValue().ok, true);
        assert.equal(builder.getValue().value[0].customLanguage, '{var:lang}');
    });

    test('a saved step shows its language, and Run default is one of the list', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'setLanguage', language: 'default' }]);
        assert.equal(field(actionsEl, 'language').value, 'default');
        assert.equal(field(actionsEl, 'language').selectedOptions[0].textContent, 'Run default');
        assert.equal(builder.getValue().value[0].language, 'default');
    });
});
