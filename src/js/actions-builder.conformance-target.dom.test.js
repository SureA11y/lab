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
        const note = field(actionsEl).querySelector('.profiles-input__note:not([hidden])');
        assert.ok(note);
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
        assert.match(notes, /No installed pack has demo-1\.0/);
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

    test('"Don’t check WCAG" with no standard is refused: it would check WCAG 2.2 AA', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        choose(radios(actionsEl).find((r) => r.value === ''));
        assert.match(field(actionsEl).querySelector('.profiles-input__summary').textContent, /Choose a WCAG level or a standard/);
        const result = builder.getValue({ validate: true });
        assert.equal(result.ok, false);
        assert.match(field(actionsEl).querySelector('.error').textContent, /with neither, the scan checks WCAG 2\.2 AA/);
        assert.equal(field(actionsEl).querySelector('fieldset.profiles-input').getAttribute('aria-invalid'), 'true');
        // A step saved with no profile, or an empty one, shows what it checks.
        for (const profile of [undefined, '', []]) {
            const again = newBuilder([{ type: 'a11yScan', ...(profile === undefined ? {} : { profile }) }]);
            assert.equal(radios(again.actionsEl).find((r) => r.checked).value, 'wcag22-aa', JSON.stringify(profile));
        }
    });

    test('a step saved with two WCAG levels keeps the first, says so, and can be put right', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: ['wcag22-aa', 'wcag22-aaa'] }]);
        assert.equal(radios(actionsEl).find((r) => r.checked).value, 'wcag22-aa');
        const note = Array.from(field(actionsEl).querySelectorAll('.profiles-input__note')).find((n) => !n.hidden);
        assert.match(note.textContent, /more than one WCAG level \(WCAG 2\.2 AA, WCAG 2\.2 AAA\)/);
        assert.deepEqual(saved(builder), 'wcag22-aa');
        choose(radios(actionsEl).find((r) => r.value === 'wcag22-aaa'));
        assert.deepEqual(saved(builder), 'wcag22-aaa');
        assert.equal(builder.getValue({ validate: true }).ok, true);
    });

    test('a standard no installed pack has can be taken off, and keeps its case', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: ['wcag22-aa', 'RGAA-4.1'] }]);
        const box = boxes(actionsEl).find((b) => b.value === 'RGAA-4.1');
        assert.ok(box && box.checked);
        assert.match(labelOf(box), /RGAA-4\.1 \(no installed pack has it\)/);
        assert.deepEqual(saved(builder), ['wcag22-aa', 'RGAA-4.1']);
        choose(box, false);
        assert.deepEqual(saved(builder), 'wcag22-aa');
    });

    test('a list with a variable in it is one value to fill in', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', profile: ['{var:q}', 'wcag22-aaa'] }]);
        assert.equal(field(actionsEl).querySelector('.profiles-input__token-toggle').checked, true);
        assert.equal(saved(builder), '{var:q},wcag22-aaa');
    });
});

describe('the profile field, folded', () => {
    const toggleOf = (actionsEl) => field(actionsEl).querySelector('.profiles-input__toggle');
    const panelOf = (actionsEl) => field(actionsEl).querySelector('.profiles-input__panel');

    test('shows what the scan checks on one line, the choices behind a Change button', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home', profile: ['wcag22-aa', 'en301549-v4.1.1'] }]);
        const toggle = toggleOf(actionsEl);
        const panel = panelOf(actionsEl);
        assert.equal(toggle.textContent, 'Change');
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(toggle.getAttribute('aria-controls'), panel.id);
        assert.equal(panel.hidden, true);
        assert.match(field(actionsEl).querySelector('.profiles-input__summary').textContent, /WCAG 2\.2 AA \+ EN 301 549 V4\.1\.1/);
        // A note that asks for attention stays on view while the panel is closed.
        const note = field(actionsEl).querySelector('.profiles-input__note:not([hidden])');
        assert.ok(note && !panel.contains(note));
    });

    test('Change opens the panel on the chosen level; Escape and Done close it, focus back on Change', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home', profile: 'wcag22-aaa' }]);
        const toggle = toggleOf(actionsEl);
        const panel = panelOf(actionsEl);
        toggle.click();
        assert.equal(panel.hidden, false);
        assert.equal(toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(win.document.activeElement.value, 'wcag22-aaa');
        win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(panel.hidden, true);
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(win.document.activeElement, toggle);
        toggle.click();
        panel.querySelector('.profiles-input__done').click();
        assert.equal(panel.hidden, true);
        assert.equal(win.document.activeElement, toggle);
        // A click outside closes it too.
        toggle.click();
        win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
        assert.equal(panel.hidden, true);
    });

    test('an error in the closed field takes focus on Change; in the open one, on the choice', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', label: 'Home' }]);
        choose(radios(actionsEl).find((r) => r.value === ''));
        const widget = field(actionsEl)._profilesWidget;
        assert.equal(widget.validate().el, toggleOf(actionsEl));
        widget.open();
        assert.equal(widget.validate().el.value, '');
        assert.equal(builder.getValue({ validate: true }).ok, false);
    });

    test('a variable shows on the line', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan', profile: '{var:profiles}' }]);
        assert.equal(field(actionsEl).querySelector('.profiles-input__summary').textContent, 'This scan checks the profiles {var:profiles} names.');
    });
});
