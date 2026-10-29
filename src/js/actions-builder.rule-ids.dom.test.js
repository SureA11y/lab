'use strict';

// A scan step's rule ids are checked against the rule ids the selected
// engines accept (/api/engine/rule-ids): an id none of them has runs
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

// Answers the rule ids endpoint with each engine's list in `lists`, and
// records what it asked.
function stubFetch(lists) {
    const asked = [];
    globalThis.fetch = async (url) => {
        asked.push(String(url));
        const id = new URL(String(url), 'http://lab').searchParams.get('engineId');
        if (String(url).startsWith('/api/engine/rule-ids') && id in lists) {
            return { ok: true, json: async () => ({ engines: [{ id, ruleIds: lists[id] }] }) };
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
    const lists = { surea11y: ['img-alt-present', 'region'], axe: ['color-contrast', 'region'], alfa: null };

    test('asks for the ids of the step\'s engine, the default one without', async () => {
        const own = await builderFor({ type: 'a11yScan', engine: 'axe' }, lists);
        assert.ok(own.asked.includes('/api/engine/rule-ids?engineId=axe'), own.asked.join(' '));

        const none = await builderFor({ type: 'a11yScan' }, lists);
        assert.ok(none.asked.includes('/api/engine/rule-ids?engineId=surea11y'), none.asked.join(' '));
    });

    test('flags an id the step\'s engine does not have, and accepts one it has', async () => {
        const { builder, actionsEl } = await builderFor({ type: 'a11yScan', engine: 'axe', includeRuleIds: 'color-contrast, img-alt-present' }, lists);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'includeRuleIds'), 'axe has no rule named "img-alt-present"');
    });

    test('names every unknown id, in the exclude fields too', async () => {
        const { builder, actionsEl } = await builderFor({ type: 'a11yScan', excludeRuleIds: 'nope, zilch' }, lists);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'excludeRuleIds'), 'surea11y has no rules named "nope", "zilch"');
    });

    test('says nothing when the engine publishes no list, or for a variable token', async () => {
        const unknownList = await builderFor({ type: 'a11yScan', engine: 'alfa', includeRuleIds: 'anything' }, lists);
        assert.equal(unknownList.builder.validate().ok, true);

        const token = await builderFor({ type: 'a11yScan', includeRuleIds: '{var:rules}' }, lists);
        assert.equal(token.builder.validate().ok, true);
    });
});
