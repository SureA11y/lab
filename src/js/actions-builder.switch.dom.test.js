'use strict';

// DOM tests for the switch step, driving the REAL actions builder under jsdom
// (same technique as actions-builder.if-url.dom.test.js): a switch's cases list
// only takes case steps, a case stays out of every other list, a case's title
// says what it matches, and a saved switch survives the round-trip.
// See docs/design/switch-step-design.md.
//
// node's test runner isolates each file in its own process, so the DOM globals
// installed here don't leak into other suites.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

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

    // jsdom has no modal dialogs; the step palette only needs them to open.
    win.HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
    win.HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };

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
    return { builder, actionsEl, toolbarEl };
}

const arrayField = (line, name) => line.querySelector(`:scope > .action-arrays-below > .action-array[data-field-name="${name}"]`);
const controlsOf = (arr) => arr.querySelector(':scope > .action-array__footer .inline-actions');
const buttonByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const rootLine = (actionsEl) => actionsEl.querySelector('.line');
const titleOf = (line) => line.querySelector(':scope > .line-header .line-title').textContent;

function readSwitch(builder) {
    const out = builder.getValue({ validate: false, maskValues: 'text' });
    return (out.value || []).find((a) => a.type === 'switch');
}

describe('switch in the builder', () => {
    test('the cases list offers only "Add case": no step palette, no shortcuts', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('switch');
        const cases = arrayField(rootLine(actionsEl), 'cases');
        const buttons = [...controlsOf(cases).querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim());
        assert.deepEqual(buttons, ['Add case', 'Paste action']);
    });

    test('the default list keeps the usual palette and shortcuts, and carries the default chip', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('switch');
        const defaults = arrayField(rootLine(actionsEl), 'defaultActions');
        assert.ok(controlsOf(defaults).querySelector('button[aria-label="Add nested action"]'));
        assert.ok(defaults.querySelector('.branch-chip--default'));
    });

    test('"Add case" adds a case, whose title says what it matches and follows edits', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('switch');
        const cases = arrayField(rootLine(actionsEl), 'cases');
        buttonByText(controlsOf(cases), 'Add case').click();
        const kase = cases.querySelector('.actions-subcontainer > .line');
        assert.equal(kase.dataset.actionType, 'case');
        assert.equal(titleOf(kase), '1.1 - Case · is equal to ""');

        const value = kase.querySelector(':scope > .fields > .field[data-field-name="value"] input');
        value.value = '/changelog';
        value.dispatchEvent(new win.Event('input', { bubbles: true }));
        const comparison = kase.querySelector(':scope > .fields > .field[data-field-name="comparison"] select');
        comparison.value = 'contains';
        comparison.dispatchEvent(new win.Event('change', { bubbles: true }));
        assert.equal(titleOf(kase), '1.1 - Case · contains "/changelog"');
    });

    test('a case is not offered in the step palette', () => {
        const { toolbarEl, builder } = newBuilder();
        builder.addAction('switch');
        toolbarEl.querySelector('button[title^="Add any action"]').click();
        const keys = [...win.document.querySelectorAll('.sb-palette [data-key]')].map((el) => el.dataset.key);
        assert.ok(keys.includes('switch'), 'the palette rendered');
        assert.ok(!keys.includes('case'));
    });

    test('a copied case pastes into a cases list only; other steps paste anywhere but there', () => {
        const { actionsEl, toolbarEl, builder } = newBuilder();
        builder.loadActions([
            { type: 'switch', urlPart: 'hash', cases: [{ type: 'case', comparison: 'equals', value: '/a' }], defaultActions: [{ type: 'wait', ms: 1 }] }
        ], {});
        const line = rootLine(actionsEl);
        const cases = arrayField(line, 'cases');
        const defaults = arrayField(line, 'defaultActions');
        const pasteIn = (arr) => controlsOf(arr).querySelector('.paste-button');
        const toolbarPaste = toolbarEl.querySelector('.paste-button');

        cases.querySelector('.actions-subcontainer > .line .copy-button').click();
        assert.equal(pasteIn(cases).disabled, false);
        assert.equal(pasteIn(defaults).disabled, true);
        assert.equal(toolbarPaste.disabled, true);

        defaults.querySelector('.actions-subcontainer > .line .copy-button').click();
        assert.equal(pasteIn(cases).disabled, true);
        assert.equal(pasteIn(defaults).disabled, false);
        assert.equal(toolbarPaste.disabled, false);

        pasteIn(cases).click(); // refused: a wait is not a case
        assert.equal(cases.querySelectorAll('.actions-subcontainer > .line').length, 1);
    });

    test('shows only the fields the subject uses: URL part (and parameter name for one parameter), or variable name', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('switch');
        const line = rootLine(actionsEl);
        const field = (name) => line.querySelector(`:scope > .fields > .field[data-field-name="${name}"]`);
        const pick = (name, value) => {
            const select = field(name).querySelector('select');
            select.value = value;
            select.dispatchEvent(new win.Event('change', { bubbles: true }));
        };
        const shown = () => ['urlPart', 'paramName', 'var'].filter((n) => !field(n).hidden);

        assert.deepEqual(shown(), ['urlPart']);
        pick('urlPart', 'param');
        assert.deepEqual(shown(), ['urlPart', 'paramName']);
        pick('subject', 'var');
        assert.deepEqual(shown(), ['var']);

        builder.loadActions([{ type: 'switch', subject: 'url', urlPart: 'param', paramName: 'step', cases: [] }], {});
        const loaded = rootLine(actionsEl);
        assert.deepEqual(['urlPart', 'paramName', 'var'].filter((n) => !loaded.querySelector(`:scope > .fields > .field[data-field-name="${n}"]`).hidden),
            ['urlPart', 'paramName']);
    });

    test('load -> save round-trip keeps the subject, every case in order, and the default', () => {
        const { builder } = newBuilder();
        const step = {
            type: 'switch',
            subject: 'var',
            var: 'section',
            cases: [
                { type: 'case', comparison: 'contains', value: 'Forms', actions: [{ type: 'wait', ms: 5 }] },
                { type: 'case', comparison: 'notEquals', value: 'Home', disabled: true }
            ],
            defaultActions: [{ type: 'goBack' }]
        };
        builder.loadActions([step], {});
        const saved = readSwitch(builder);
        assert.equal(saved.subject, 'var');
        assert.equal(saved.var, 'section');
        assert.deepEqual(saved.cases.map((c) => [c.type, c.comparison, c.value, !!c.disabled]),
            [['case', 'contains', 'Forms', false], ['case', 'notEquals', 'Home', true]]);
        assert.equal(saved.cases[0].actions[0].type, 'wait');
        assert.equal(saved.defaultActions[0].type, 'goBack');
    });
});
