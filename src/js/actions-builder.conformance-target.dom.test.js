'use strict';

// DOM tests for the scan step's Profile field (profiles-input.js): a WCAG 2.2
// level, as radios, and the standards, as checkboxes, so a scan can check
// against several at once; or a variable.

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

const field = (actionsEl) => actionsEl.querySelector('.line .field[data-field-name="profile"]');
const radios = (actionsEl) => Array.from(field(actionsEl).querySelectorAll('input[type="radio"]'));
const boxes = (actionsEl) => Array.from(field(actionsEl).querySelectorAll('.profiles-input__group input[type="checkbox"]'));
const labelOf = (input) => input.closest('label').textContent.trim();
const saved = (builder) => builder.getValue({ validate: false }).value[0].profile;
const choose = (input, checked = true) => {
    input.checked = checked;
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
};

describe('the profile field', () => {
    test('offers one WCAG 2.2 level, or none, and the standards, WCAG 2.2 AA chosen', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        const set = field(actionsEl).querySelector('fieldset.profiles-input');
        assert.equal(set.querySelector(':scope > legend').textContent, 'Profile');
        assert.deepEqual(radios(actionsEl).map(labelOf), ['Level A', 'Level AA', 'Level AAA', 'Don’t check WCAG']);
        assert.deepEqual(boxes(actionsEl).map(labelOf), ['EN 301 549 V4.1.1', 'EN 301 549 V3.2.1']);
        assert.equal(radios(actionsEl).find((r) => r.checked).value, 'wcag22-aa');
        assert.ok(boxes(actionsEl).every((b) => !b.checked));
        assert.match(field(actionsEl).querySelector('.profiles-input__summary').textContent, /This scan checks: WCAG 2\.2 AA$/);
    });

    test('a step left on the default saves it, so it says what it checks', () => {
        const { builder } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        assert.equal(saved(builder), 'wcag22-aa');
    });

    test('a step\'s own profile loads and saves as it was, one id', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: 'en301549-v3.2.1' }]);
        assert.equal(radios(actionsEl).find((r) => r.checked).value, '', 'no WCAG level of its own');
        assert.deepEqual(boxes(actionsEl).filter((b) => b.checked).map((b) => b.value), ['en301549-v3.2.1']);
        assert.equal(saved(builder), 'en301549-v3.2.1');
    });

    test('several profiles save as a list, the WCAG level first, and load back', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        choose(radios(actionsEl).find((r) => r.value === 'wcag22-aaa'));
        choose(boxes(actionsEl).find((b) => b.value === 'en301549-v4.1.1'));
        assert.deepEqual(saved(builder), ['wcag22-aaa', 'en301549-v4.1.1']);
        // EN 301 549 restates WCAG A and AA: beside a WCAG level, it says so.
        const note = field(actionsEl).querySelector('.profiles-input__note');
        assert.equal(note.hidden, false);
        assert.match(note.textContent, /EN 301 549 V4\.1\.1 restates WCAG Level A and AA/);
        assert.match(field(actionsEl).querySelector('.profiles-input__summary').textContent, /WCAG 2\.2 AAA \+ EN 301 549 V4\.1\.1/);

        const again = newBuilder([{ type: 'a11yScan', profile: ['en301549-v4.1.1', 'wcag22-a'] }]);
        assert.equal(radios(again.actionsEl).find((r) => r.checked).value, 'wcag22-a');
        assert.deepEqual(saved(again.builder), ['wcag22-a', 'en301549-v4.1.1']);
    });

    test('a standard no installed pack has is kept, and said', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: ['wcag22-aa', 'demo-1.0'] }]);
        assert.deepEqual(saved(builder), ['wcag22-aa', 'demo-1.0']);
        const notes = Array.from(field(actionsEl).querySelectorAll('.profiles-input__help')).map((n) => n.hidden ? '' : n.textContent).join(' ');
        assert.match(notes, /Also demo-1\.0, which no installed pack has/);
    });

    test('a variable holds the profiles: one, or several separated by commas', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: '{var:profiles}' }]);
        const toggle = field(actionsEl).querySelector('.profiles-input__token-toggle');
        const token = field(actionsEl).querySelector('.select-token-input');
        assert.equal(toggle.checked, true);
        assert.equal(token.value, '{var:profiles}');
        assert.equal(field(actionsEl).querySelector('.profiles-input__groups').hidden, true);
        assert.equal(saved(builder), '{var:profiles}');

        // Text that is no token is refused.
        token.value = 'wcag22-aa';
        assert.equal(builder.getValue({ validate: true }).ok, false);
        assert.match(field(actionsEl).querySelector('.error').textContent, /variable token like \{var:profile\}/);
    });

    test('nothing chosen saves no profile: the scan checks WCAG 2.2 AA', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        choose(radios(actionsEl).find((r) => r.value === ''));
        assert.equal('profile' in builder.getValue({ validate: false }).value[0], false);
        assert.match(field(actionsEl).querySelector('.profiles-input__summary').textContent, /Choose a WCAG level or a standard/);
    });
});
