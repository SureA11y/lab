'use strict';

// The guarantee this whole feature exists for, checked end to end through the
// REAL builder and the REAL config IO rather than a stub of either: a password in a
// "Set password value" step is nowhere in the exported config.
//
// The pieces are covered separately (actions-builder.masked-value.test.js for the
// redaction, config-io.dom.test.js for the options config IO asks for); this is
// the one that fails if they are ever wired up to each other wrongly.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

const FORM_HTML = `
<form id="scan-form">
  <div class="config-data">
    <input id="url-input" value="https://example.com/login">
  </div>
</form>`;

let createActionsBuilder;
let createConfigIO;
let win;

before(async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${FORM_HTML}</body></html>`, {
        pretendToBeVisual: true,
        url: 'https://example.com/',
    });
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
    ({ createConfigIO } = await import('./config-io.js'));
});

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

/** A login workflow with the password in a setPassword step and the username in a setValue one. */
function loginBuilder() {
    const { builder, actionsEl } = newBuilder();
    builder.loadActions([
        { type: 'setValue', selector: '#user', value: 'ada@example.com' },
        { type: 'setPassword', selector: '#password', value: 'hunter2' },
        { type: 'a11yScan', label: 'After login' }
    ], {});

    return { builder, actionsEl };
}

function configIOFor(builder, extraDeps = {}) {
    return createConfigIO({
        form: win.document.getElementById('scan-form'),
        urlInput: win.document.getElementById('url-input'),
        actionsBuilder: builder,
        getCustomSteps: () => ({ ok: true, value: [] }),
        setStatusRun: () => {},
        STATUS: {},
        ...extraDeps,
    });
}

describe('exporting a config with a password', () => {
    test('the password is nowhere in the file, in any shape', () => {
        const config = configIOFor(loginBuilder().builder).buildConfigFile();

        assert.doesNotMatch(JSON.stringify(config), /hunter2/);
    });

    test('the run spec saved beside the state does not carry it either', () => {
        const { builder } = loginBuilder();
        const io = configIOFor(builder, {
            getRunSpec: () => ({
                type: 'a11y-run-spec',
                actions: builder.getValue({ maskValues: 'redact', markMasked: true }).value
            })
        });

        assert.doesNotMatch(JSON.stringify(io.buildConfigFile().runSpec), /hunter2/);
    });

    test('the rest of the workflow is saved exactly as before', () => {
        const steps = configIOFor(loginBuilder().builder).buildConfigFile().state['actions-workflow'];

        assert.equal(steps.length, 3);
        assert.equal(steps[0].value, 'ada@example.com', 'a visible value is still saved');
        assert.equal(steps[1].selector, '#password', 'the password step keeps everything but its value');
        assert.equal(steps[1].valueMasked, true);
        assert.equal('value' in steps[1], false);
        assert.equal(steps[2].type, 'a11yScan');
    });

    test('loading it back leaves the field empty, hidden, and explained - and not runnable until refilled', () => {
        const config = configIOFor(loginBuilder().builder).buildConfigFile();

        const { builder, actionsEl } = newBuilder();
        builder.loadActions(config.state['actions-workflow'], {});

        const [user, password] = actionsEl.querySelectorAll('.field[data-field-name="value"] input');
        assert.equal(user.value, 'ada@example.com');
        assert.equal(password.value, '');
        assert.equal(password.type, 'password');
        assert.match(password.placeholder, /not saved/i);

        assert.equal(builder.getValue({ validate: true }).ok, false, 'the empty required value stops a run');
        assert.equal(password.getAttribute('aria-invalid'), 'true');
    });
});
