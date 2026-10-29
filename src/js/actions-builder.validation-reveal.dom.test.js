'use strict';

// A collapsed step hides its fields (CSS: .line.is-collapsed .fields {display:none}),
// so when a run is refused because a required field is empty, the message the
// builder just wrote would sit behind a closed panel - and the control it points
// at could not even take focus. Validation therefore does what picking a step in
// the step tree does: everything collapses except the flagged steps and the
// steps nesting them.
//
// These drive the REAL builder under jsdom, same technique as
// actions-builder.masked-value.test.js.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let SELECT_TOKEN_SENTINEL;
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

    ({ createActionsBuilder, SELECT_TOKEN_SENTINEL } = await import('./actions-builder.module.js'));
});

function newBuilder(actions) {
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
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const topLines = (actionsEl) => Array.from(actionsEl.querySelectorAll(':scope > .line'));
const isCollapsed = (lineEl) => lineEl.classList.contains('is-collapsed');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A click step whose "Mouse button" (a secondary field, so it lives behind
 *  "show more") is set to "From a variable…" with the token box left empty. */
function clickWithEmptyTokenOnAdvancedField() {
    const { builder, actionsEl } = newBuilder([{ type: 'click', selector: '#go', collapsed: true }]);
    const line = topLines(actionsEl)[0];
    const field = line.querySelector(':scope > .fields > .field[data-field-name="mouseButton"]');
    const select = field.querySelector('select');
    select.value = SELECT_TOKEN_SENTINEL;
    select.dispatchEvent(new win.Event('change'));
    return { builder, actionsEl, line, field };
}

describe('validation clears the way to the steps it flags', () => {
    test('a collapsed step missing a required field is expanded', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '', collapsed: true }
        ]);
        const [line] = topLines(actionsEl);
        assert.equal(isCollapsed(line), true, 'precondition: the step starts collapsed');

        const res = builder.validate();

        assert.equal(res.ok, false);
        assert.equal(isCollapsed(line), false, 'the flagged step is expanded');
    });

    test('the collapse toggle is re-labelled, so a second click collapses again', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '', collapsed: true }
        ]);
        builder.validate();

        const toggle = topLines(actionsEl)[0].querySelector('.toggle-action');
        assert.equal(toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(toggle.getAttribute('aria-label'), 'Collapse action panel');
    });

    test('the steps that are fine collapse, as they do from the step tree', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '#ready' },
            { type: 'focus', selector: '', collapsed: true },
            { type: 'navigate', url: 'https://example.com' }
        ]);
        const [beforeLine, badLine, afterLine] = topLines(actionsEl);

        const res = builder.validate();

        assert.equal(res.ok, false);
        assert.deepEqual(
            [isCollapsed(beforeLine), isCollapsed(badLine), isCollapsed(afterLine)],
            [true, false, true],
            'only the flagged step is left open'
        );
    });

    test('a valid workflow is left exactly as the user arranged it', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '#ready' },
            { type: 'focus', selector: '#field', collapsed: true }
        ]);
        const before = topLines(actionsEl).map(isCollapsed);

        const res = builder.validate();

        assert.equal(res.ok, true);
        assert.deepEqual(topLines(actionsEl).map(isCollapsed), before);
    });

    test('a sibling of the flagged step collapses even when it is nested', () => {
        const { builder, actionsEl } = newBuilder([
            {
                type: 'repeat',
                repetitions: 2,
                actions: [
                    { type: 'waitForSelector', selector: '#ready' },
                    { type: 'focus', selector: '' }
                ]
            }
        ]);
        const [parent] = topLines(actionsEl);
        const [okChild, badChild] = Array.from(parent.querySelectorAll('.action-array .line'));

        builder.validate();

        assert.equal(isCollapsed(parent), false, 'the step nesting the error stays open');
        assert.equal(isCollapsed(okChild), true);
        assert.equal(isCollapsed(badChild), false);
    });

    test('every flagged step is expanded, not only the first one', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'focus', selector: '', collapsed: true },
            { type: 'waitForSelector', selector: '', collapsed: true }
        ]);

        builder.validate();

        assert.deepEqual(topLines(actionsEl).map(isCollapsed), [false, false]);
    });

    test('a nested step is reached through its collapsed parent', () => {
        const { builder, actionsEl } = newBuilder([
            {
                type: 'repeat',
                repetitions: 2,
                collapsed: true,
                actions: [{ type: 'waitForSelector', selector: '', collapsed: true }]
            }
        ]);
        const [parent] = topLines(actionsEl);
        const child = parent.querySelector('.action-array .line');

        const res = builder.validate();

        assert.equal(res.ok, false);
        assert.equal(isCollapsed(parent), false, 'the wrapping step is opened too');
        assert.equal(isCollapsed(child), false);
    });

    test('a disabled step is skipped by validation and stays collapsed', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '', collapsed: true, disabled: true },
            { type: 'focus', selector: '' }
        ]);
        const [disabledLine] = topLines(actionsEl);

        builder.validate();

        assert.equal(isCollapsed(disabledLine), true);
    });

    test('focus goes to the first empty required field, not to the step', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'focus', selector: '', collapsed: true },
            { type: 'waitForSelector', selector: '', collapsed: true }
        ]);
        const [firstLine] = topLines(actionsEl);

        const res = builder.validate();

        assert.equal(
            res.firstErrorEl,
            firstLine.querySelector('.field[data-field-name="selector"] input'),
            'the earliest empty required field wins'
        );
    });

    test('an empty required field wins over an earlier error of another kind', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'click', selector: '#go' },
            { type: 'focus', selector: '' }
        ]);
        const [clickLine, focusLine] = topLines(actionsEl);
        // A step before it is broken too, but only by a blank variable token on
        // an optional field - nothing the user is being asked to fill in.
        const token = clickLine.querySelector('.field[data-field-name="mouseButton"] select');
        token.value = SELECT_TOKEN_SENTINEL;
        token.dispatchEvent(new win.Event('change'));

        const res = builder.validate();

        assert.equal(
            res.firstErrorEl,
            focusLine.querySelector('.field[data-field-name="selector"] input')
        );
    });

    test('a required field nested inside another step still gets the caret', () => {
        const { builder, actionsEl } = newBuilder([
            {
                type: 'repeat',
                repetitions: 2,
                collapsed: true,
                actions: [{ type: 'waitForSelector', selector: '', collapsed: true }]
            }
        ]);
        const child = topLines(actionsEl)[0].querySelector('.action-array .line');

        const res = builder.validate();

        assert.equal(res.firstErrorEl, child.querySelector('.field[data-field-name="selector"] input'));
    });

    test('with no field to fill in, the error that is there is used instead', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'repeat', repetitions: 2, actions: [] }]);

        const res = builder.validate();

        assert.equal(res.ok, false);
        assert.equal(
            res.firstErrorEl,
            topLines(actionsEl)[0].querySelector('.action-array[data-field-name="actions"]'),
            'the empty required action list is what the run stopped on'
        );
    });

    test('the reported error target is the control itself, so it can take focus', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '', collapsed: true }
        ]);

        const res = builder.validate();

        assert.ok(res.firstErrorEl, 'validation reports where the first error is');
        assert.match(res.firstErrorEl.tagName, /^(INPUT|SELECT|TEXTAREA)$/);
        assert.equal(res.firstErrorEl.getAttribute('aria-invalid'), 'true');
        assert.equal(res.firstErrorEl.closest('.line'), topLines(actionsEl)[0]);
    });

    test('a flagged field behind "show more" is brought back into view', () => {
        const { builder, line, field } = clickWithEmptyTokenOnAdvancedField();
        assert.equal(field.classList.contains('is-advanced'), true, 'precondition: the field is a secondary one');
        assert.equal(field.hidden, true, 'precondition: "show more" starts closed');

        const res = builder.validate();

        assert.equal(res.ok, false);
        assert.equal(isCollapsed(line), false);
        assert.equal(field.hidden, false, 'the advanced section is opened');
        assert.equal(
            line.querySelector('.fields-toggle').getAttribute('aria-expanded'),
            'true'
        );
    });

    test('opening "show more" does not steal focus from the field that failed', async () => {
        const { builder } = clickWithEmptyTokenOnAdvancedField();

        const res = builder.getValue({ validate: true });
        assert.equal(res.ok, false);
        const focused = win.document.activeElement;
        assert.equal(focused.className, 'select-token-input', 'the empty token box takes focus');

        // The "show more" toggle normally jumps focus to its first field; that
        // must not happen when validation is the one opening it.
        await tick();
        await tick();
        assert.equal(win.document.activeElement, focused);
    });
});

describe('checking without revealing (saving a config)', () => {
    test('getValue with reveal: false reports the problem and leaves every step and focus as they were', () => {
        const { builder, actionsEl } = newBuilder([
            { type: 'waitForSelector', selector: '#ready' },
            { type: 'focus', selector: '', collapsed: true },
            { type: 'navigate', url: 'https://example.com', collapsed: true }
        ]);
        const before = topLines(actionsEl).map(isCollapsed);
        const focused = win.document.activeElement;

        const res = builder.getValue({ maskValues: 'redact', markMasked: true, reveal: false });

        assert.equal(res.ok, false);
        assert.ok(res.firstErrorEl, 'the problem is still reported');
        assert.deepEqual(topLines(actionsEl).map(isCollapsed), before);
        assert.equal(win.document.activeElement, focused);
        // Read as it stands, each step keeps its own collapsed flag.
        const read = builder.getValue({ validate: false, maskValues: 'redact' });
        assert.deepEqual(read.value.map((a) => !!a.collapsed), [false, true, true]);
    });
});

