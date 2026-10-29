'use strict';

// The Merged scan step in the editor (docs/design/merged-scan-design.md): one inside
// another is flagged when the workflow is checked, since a scan cannot belong
// to two. Drives the REAL builder under jsdom, as the other builder DOM tests.

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
        engineCapabilities: null,
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const arrayErrors = (actionsEl) => [...actionsEl.querySelectorAll('.action-array__error')]
    .filter((e) => !e.hidden).map((e) => e.textContent);

describe('Merged scan in the editor', () => {
    test('a Merged scan of scans is valid, and saves as written', () => {
        const step = { type: 'mergedScan', label: 'Product page', actions: [{ type: 'a11yScan', label: 'Light' }, { type: 'a11yScan', label: 'Dark' }] };
        const { builder, actionsEl } = newBuilder([step]);
        assert.equal(builder.validate().ok, true, arrayErrors(actionsEl).join('; '));
        const { value } = builder.getValue({ validate: false });
        assert.equal(value[0].type, 'mergedScan');
        assert.equal(value[0].label, 'Product page');
        assert.deepEqual(value[0].actions.map((a) => a.label), ['Light', 'Dark']);
    });

    test('one inside another, at any depth, is flagged', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'mergedScan', label: 'Outer', actions: [
            { type: 'group', actions: [{ type: 'mergedScan', label: 'Inner', actions: [{ type: 'a11yScan' }] }] },
        ] }]);
        assert.equal(builder.validate().ok, false);
        assert.ok(arrayErrors(actionsEl).includes('A Merged scan cannot contain another Merged scan'));
    });

    test('a disabled one inside does not count', () => {
        const { builder } = newBuilder([{ type: 'mergedScan', label: 'Outer', actions: [
            { type: 'a11yScan' },
            { type: 'mergedScan', label: 'Inner', disabled: true, actions: [{ type: 'a11yScan' }] },
        ] }]);
        assert.equal(builder.validate().ok, true);
    });
});
