'use strict';

// A scan step's rule ids are checked against the rule ids surea11y
// accepts (/api/engine/rule-ids): an id it does not have runs
// nothing, or every rule. Drives the REAL builder under jsdom, as
// actions-builder.validation-reveal.dom.test.js does, with fetch stubbed.

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
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const fieldOf = (actionsEl, name) => actionsEl.querySelector(`.line .field[data-field-name="${name}"]`);
const errorOf = (actionsEl, name) => {
    const err = fieldOf(actionsEl, name).querySelector('.error');
    return err && !err.hidden ? err.textContent : '';
};

// Answers the rule ids endpoint, which names the lab's engine, with its
// list in `lists`, and records what it asked.
function stubFetch(lists) {
    const asked = [];
    globalThis.fetch = async (url) => {
        asked.push(String(url));
        if (String(url).startsWith('/api/engine/rule-ids')) {
            return { ok: true, json: async () => ({ engines: Object.entries(lists).map(([id, ruleIds]) => ({ id, ruleIds })) }) };
        }
        return { ok: false, json: async () => ({}) };
    };
    return asked;
}

// The step's engine's list is loaded when the step is shown; let it land.
async function builderFor(step, lists) {
    const asked = stubFetch(lists);
    const made = newBuilder([step]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { ...made, asked };
}

describe('scan step rule ids', () => {
    const lists = { surea11y: ['img-alt-present', 'region'] };

    test('asks the server for the lab\'s engine\'s ids, once', async () => {
        const { asked } = await builderFor({ type: 'a11yScan' }, lists);
        assert.deepEqual(asked.filter((u) => u.startsWith('/api/engine/rule-ids')), ['/api/engine/rule-ids']);
    });

    test('flags an id surea11y does not have, and accepts one it has', async () => {
        const { builder, actionsEl } = await builderFor({ type: 'a11yScan', includeRuleIds: 'img-alt-present, color-contrast' }, lists);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'includeRuleIds'), 'surea11y has no rule named "color-contrast"');
    });

    test('names every unknown id, in the exclude fields too', async () => {
        const { builder, actionsEl } = await builderFor({ type: 'a11yScan', excludeRuleIds: 'nope, zilch' }, lists);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'excludeRuleIds'), 'surea11y has no rules named "nope", "zilch"');
    });

    test('says nothing when the list can\'t be had, or for a variable token', async () => {
        const unknownList = await builderFor({ type: 'a11yScan', includeRuleIds: 'anything' }, { surea11y: null });
        assert.equal(unknownList.builder.validate().ok, true);

        const token = await builderFor({ type: 'a11yScan', includeRuleIds: '{var:rules}' }, lists);
        assert.equal(token.builder.validate().ok, true);
    });
});
