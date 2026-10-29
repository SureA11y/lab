'use strict';

// DOM round-trip tests for collectOutput's "tags" and "when" fields, driving the REAL
// actions builder under jsdom (same technique as actions-builder.scan-tags.test.js).
//
// Regression test: a config with tags:[...] (array) and when:{...} (object) must survive
// the round-trip through the builder to /workflow-start without being stringified - tags
// stays an array (widget: "tags") and when stays a JSON string (like runCustomStep's
// argsJson). See docs/design/workflow-collected-metadata-design.md §5.1.1.
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

function fieldFor(scope, name) {
    return scope.querySelector(`.field[data-field-name="${name}"]`);
}

function readCollectOutput(builder) {
    const out = builder.getValue({ validate: false, maskValues: 'text' });
    return (out.value || []).find((a) => a.type === 'collectOutput');
}

describe('collectOutput tags/when fields (DOM round-trip)', () => {
    test('tags renders the existing chip widget, not a bare text input', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('collectOutput');
        const field = fieldFor(actionsEl, 'tags');
        assert.ok(field, 'tags field is rendered');
        assert.equal(field.dataset.widget, 'tags');
        assert.ok(field._tagsWidget, 'widget instance is attached');
    });

    test('tags: load -> save round-trip preserves a single-element array (the actual regression)', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions([
            { type: 'collectOutput', key: 'lowRatedBook', from: 'url', tags: ['lowRated'] }
        ], {});

        assert.deepEqual(fieldFor(actionsEl, 'tags')._tagsWidget.getTags(), ['lowRated']);

        const saved = readCollectOutput(builder);
        assert.deepEqual(saved.tags, ['lowRated']);
        assert.notEqual(saved.tags, 'lowRated', 'must stay an array, not collapse to a bare string');
    });

    test('tags: a multi-tag array round-trips too', () => {
        const { actionsEl, builder } = newBuilder();
        builder.loadActions([
            { type: 'collectOutput', key: 'k', value: 'v', tags: ['price', 'checkout'] }
        ], {});
        assert.deepEqual(readCollectOutput(builder).tags, ['price', 'checkout']);
    });

    test('tags: save -> load -> save round-trip preserves tags', () => {
        const a = newBuilder();
        a.builder.loadActions([{ type: 'collectOutput', key: 'k', value: 'v' }], {});
        fieldFor(a.actionsEl, 'tags')._tagsWidget.setTags(['emptyView']);
        const saved = a.builder.getValue({ validate: false, maskValues: 'text' });

        const b = newBuilder();
        b.builder.loadActions(saved.value, {});
        assert.deepEqual(readCollectOutput(b.builder).tags, ['emptyView']);
    });

    test('when renders as a plain string field, not an object-typed widget that would mangle it', () => {
        const { actionsEl, builder } = newBuilder();
        builder.addAction('collectOutput');
        const field = fieldFor(actionsEl, 'when');
        assert.ok(field, 'when field is rendered');
        assert.notEqual(field.dataset.widget, 'tags');
    });

    test('when: load -> save round-trip preserves the JSON string verbatim (the actual regression)', () => {
        const { builder } = newBuilder();
        const whenJson = '{"selectorExists": "p.star-rating.One"}';
        builder.loadActions([
            { type: 'collectOutput', key: 'lowRatedBook', from: 'url', when: whenJson }
        ], {});

        const saved = readCollectOutput(builder);
        assert.equal(saved.when, whenJson);
        assert.notEqual(saved.when, '[object Object]', 'must not collapse to JS\'s default object-to-string coercion');
        assert.deepEqual(JSON.parse(saved.when), { selectorExists: 'p.star-rating.One' });
    });

    test('when: save -> load -> save round-trip preserves the condition', () => {
        const a = newBuilder();
        a.builder.loadActions([{ type: 'collectOutput', key: 'k', value: 'v' }], {});
        const whenField = fieldFor(a.actionsEl, 'when');
        const textarea = whenField.querySelector('textarea') || whenField.querySelector('input');
        textarea.value = '{"urlIncludes": "/account/"}';
        textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
        const saved = a.builder.getValue({ validate: false, maskValues: 'text' });

        const b = newBuilder();
        b.builder.loadActions(saved.value, {});
        assert.deepEqual(JSON.parse(readCollectOutput(b.builder).when), { urlIncludes: '/account/' });
    });
});
