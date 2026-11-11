'use strict';

// Passwords to type again: a config loaded back has its passwords empty, as
// they are never saved. Each step with one says "Needs password" in its
// header, the builder lists the fields left to type in the order they run,
// and tells the app how many there are. Drives the REAL builder under jsdom,
// as the other builder DOM tests.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

let createActionsBuilder;
let MASKED_VALUE_PLACEHOLDER;
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

    ({ createActionsBuilder, MASKED_VALUE_PLACEHOLDER } = await import('./actions-builder.module.js'));
});

function newBuilder(actions) {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const counts = [];
    const builder = createActionsBuilder({
        defs: ACTION_DEFINITIONS,
        actionsEl,
        toolbarEl,
        options: { useHorizontalStepper: false, onPasswordsChange: (n) => counts.push(n) },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl, counts };
}

const password = (alias) => ({ type: 'setPassword', alias, selector: '#p', valueMasked: true });
const badgeOf = (line) => line.querySelector(':scope > .line-header .line-badge--password');

describe('passwords to type again', () => {
    test('each step with one says so in its header, nested ones too, and the count is told', () => {
        const { builder, actionsEl, counts } = newBuilder([
            password('Customer'),
            { type: 'group', actions: [{ type: 'click', selector: 'a' }, password('Admin')] },
            { type: 'setPassword', selector: '#q', value: { $env: 'SHOP_PASSWORD' } },
        ]);
        const fields = builder.passwordsToType();
        assert.equal(fields.length, 2, 'the one read from the environment has nothing to type');
        assert.deepEqual(fields.map((f) => f.closest('.line').dataset.alias), ['Customer', 'Admin']);
        const flagged = Array.from(actionsEl.querySelectorAll('.line[data-needs-password="true"]'));
        assert.equal(flagged.length, 2);
        flagged.forEach((line) => {
            const badge = badgeOf(line);
            assert.equal(badge.hidden, false);
            assert.equal(badge.textContent, 'Needs password');
            // In the step's title, which names the step for a screen reader.
            assert.ok(badge.closest('.line-title-wrapper'));
        });
        assert.equal(counts.at(-1), 2);
        assert.equal(fields[0].placeholder, MASKED_VALUE_PLACEHOLDER);
        assert.equal(MASKED_VALUE_PLACEHOLDER, 'Type it again: not saved with the configuration');
    });

    test('typing one clears its badge at once and lowers the count', () => {
        const { builder, actionsEl, counts } = newBuilder([password('Customer'), password('Admin')]);
        const [first] = builder.passwordsToType();
        first.value = 'secret';
        first.dispatchEvent(new win.Event('input', { bubbles: true }));
        const line = first.closest('.line');
        assert.equal(line.dataset.needsPassword, undefined);
        assert.equal(badgeOf(line).hidden, true);
        assert.equal(builder.passwordsToType().length, 1);
        assert.equal(counts.at(-1), 1);
        assert.equal(actionsEl.querySelectorAll('.line[data-needs-password]').length, 1);
    });

    test('a step turned off, or inside one, does not run, so it needs nothing', () => {
        const { builder } = newBuilder([
            { ...password('Off'), disabled: true },
            { type: 'group', disabled: true, actions: [password('Inside')] },
            password('On'),
        ]);
        assert.deepEqual(builder.passwordsToType().map((f) => f.closest('.line').dataset.alias), ['On']);
    });
});
