'use strict';

// Opening a bare run spec with "Load config": the spec becomes the form's
// state, its vars a Batch row, and what the form has no place for a note.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const runSpec = require('../shared/run-spec.js');
const scanInputs = require('../shared/scan-inputs.js');

const FORM_HTML = `
<form id="scan-form">
  <div class="config-data">
    <input id="url-input" value="https://before.example.com/">
    <input id="scenario-name" value="Before">
    <select id="viewport-preset">
      <option value="default">Default</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option>
    </select>
  </div>
  <input type="file" id="config-file">
</form>`;

let createConfigIO;
let win;

before(async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${FORM_HTML}</body></html>`, { url: 'https://example.com/' });
    win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.FileReader = win.FileReader;
    globalThis.A11Y_RUN_SPEC = runSpec;
    globalThis.A11Y_SCAN_INPUTS = scanInputs;
    // As the app loads it: a spec in an older format is brought up to date.
    globalThis.A11Y_CONFIG_UPGRADE = require('../shared/config-upgrade.js');
    ({ createConfigIO } = await import('./config-io.js'));
});

let calls;
beforeEach(() => {
    win.document.body.innerHTML = FORM_HTML;
    calls = { actions: null, customSteps: null, rows: null, status: [] };
});

function openFile(name, content) {
    const input = win.document.getElementById('config-file');
    const io = createConfigIO({
        form: win.document.getElementById('scan-form'),
        urlInput: win.document.getElementById('url-input'),
        configFileEl: input,
        actionsBuilder: { loadActions: (actions) => { calls.actions = actions; return calls.loadResult; } },
        setCustomSteps: (raw) => { calls.customSteps = raw; },
        loadBatchRows: (rows) => { calls.rows = rows; },
        setStatusRun: (message, tone) => calls.status.push({ message, tone }),
        STATUS: { OK: 'ok', ERROR: 'error', INFO: 'info', WARNING: 'warning' },
    });
    return new Promise((resolve) => {
        io.setupConfigLoader(() => resolve());
        const file = new win.File([content], name, { type: 'application/json' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new win.Event('change'));
    });
}

const value = (id) => win.document.getElementById(id).value;
const lastStatus = () => calls.status[calls.status.length - 1];

describe('Load config with a run spec', () => {
    test('fills the form, the workflow and the custom steps from it', async () => {
        await openFile('checkout.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1,
            url: 'https://example.com/checkout', scenarioName: 'Checkout',
            viewport: 'mobile',
            actions: [{ type: 'a11yScan', label: 'Cart', profile: 'en301549-v4.1.1' }],
            customSteps: [{ id: 'login', actions: [] }],
        }));

        assert.equal(value('url-input'), 'https://example.com/checkout');
        assert.equal(value('scenario-name'), 'Checkout');
        assert.equal(value('viewport-preset'), 'mobile');
        assert.deepEqual(calls.actions, [{ type: 'a11yScan', label: 'Cart', profile: 'en301549-v4.1.1' }]);
        assert.deepEqual(JSON.parse(calls.customSteps), [{ id: 'login', actions: [] }]);
        assert.equal(calls.rows, null);
        assert.equal(lastStatus().tone, 'ok');
        assert.match(lastStatus().message, /^Run spec loaded from file\./);
    });

    test('puts back the defaults of what the spec leaves out', async () => {
        await openFile('min.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', actions: [{ type: 'a11yScan' }],
        }));

        assert.equal(value('scenario-name'), '');
        assert.equal(value('viewport-preset'), 'default');
        assert.equal(calls.customSteps, '');
    });

    test('puts a spec\'s run-level Include and Exclude selectors on its scans, and says so', async () => {
        await openFile('scoped.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/',
            context: 'main', exclude: ['.ads', '.cookie-banner'],
            actions: [{ type: 'a11yScan', label: 'Cart' }],
        }));
        assert.deepEqual(calls.actions, [{ type: 'a11yScan', label: 'Cart', context: 'main', exclude: '.ads, .cookie-banner' }]);
        assert.match(lastStatus().message, /the run's Include selectors "main" put on each scan that has none/);
    });

    test('finds the preset a measured viewport is', async () => {
        await openFile('measured.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/',
            viewport: { width: 768, height: 1024 }, actions: [{ type: 'a11yScan' }],
        }));
        assert.equal(value('viewport-preset'), 'tablet');
    });

    test('puts its vars in a Batch row, and says so', async () => {
        await openFile('vars.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', scenarioName: 'Nightly',
            vars: { build: 2310 }, actions: [{ type: 'a11yScan' }],
        }));
        assert.deepEqual(calls.rows, [{ name: 'Nightly', url: 'https://example.com/', vars: { build: 2310 } }]);
        assert.match(lastStatus().message, /Its variables are in the Batch section\./);
    });

    test('says what the form has no place for, rather than dropping it silently', async () => {
        await openFile('odd.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/',
            viewport: { width: 1000, height: 700 }, profile: 'en301549-v4.1.1',
            actions: [{ type: 'a11yScan' }],
        }));
        const message = lastStatus().message;
        assert.match(message, /1000 × 700, is not a preset/);
        // Its run profile is now its scan's, and said so.
        assert.match(message, /older format.*the run's profile "en301549-v4\.1\.1" put on each scan that has none/);
        assert.deepEqual(calls.actions, [{ type: 'a11yScan', profile: 'en301549-v4.1.1' }]);
        assert.equal(lastStatus().tone, 'warning');
        assert.equal(value('viewport-preset'), 'default');
    });

    test('a saved configuration still loads as before', async () => {
        await openFile('saved.a11y-config.json', JSON.stringify({
            version: 1, type: 'a11y-ui-src-config', url: 'https://saved.example.com/',
            state: { 'url-input': 'https://saved.example.com/', 'scenario-name': 'Saved', 'actions-workflow': [{ type: 'a11yScan' }] },
        }));
        assert.equal(value('scenario-name'), 'Saved');
        assert.match(lastStatus().message, /^Configuration loaded from file\./);
    });

    test('says which steps the app left out, by their place in the file', async () => {
        calls.loadResult = { added: [], errors: [
            { index: 0, type: 'save', indexPath: '1' },
            { index: 2, type: 'nope', indexPath: '3.2' },
        ] };
        await openFile('typos.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', actions: [{ type: 'save' }],
        }));
        assert.match(lastStatus().message, /steps the app does not have, left out: "save" \(step 1 in the file\), "nope" \(step 3\.2 in the file\)\. Saving now would drop them for good\./);
        assert.equal(lastStatus().tone, 'warning');
    });

    test('says, step by step, what the steps hold that the app does not use, as a warning', async () => {
        const { unusedStepKeys } = await import('./actions-builder.module.js');
        const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
        const workflow = [
            { type: 'a11yScan' },
            // A switch's cases under "actions" rather than "cases", and an if
            // with "selector" rather than "selectorExists".
            { type: 'switch', var: 'locale', actions: [{ type: 'case', equals: 'en', actions: [{ type: 'click', selector: 'a' }] }] },
            { type: 'group', actions: [{ type: 'if', selector: '#otp', actions: [] }] },
        ];
        calls.loadResult = { added: [], errors: [], unused: unusedStepKeys(workflow, ACTION_DEFINITIONS) };
        let shown = 0;
        const input = win.document.getElementById('config-file');
        const io = createConfigIO({
            form: win.document.getElementById('scan-form'),
            urlInput: win.document.getElementById('url-input'),
            configFileEl: input,
            actionsBuilder: {
                loadActions: () => calls.loadResult,
                showFieldErrors: () => { shown += 1; },
                unusedKeys: (actions) => unusedStepKeys(actions, ACTION_DEFINITIONS),
            },
            setCustomSteps: () => {},
            setStatusRun: (message, tone) => calls.status.push({ message, tone }),
            STATUS: { OK: 'ok', ERROR: 'error', INFO: 'info', WARNING: 'warning' },
        });
        await new Promise((resolve) => {
            io.setupConfigLoader(() => resolve());
            const config = { version: 1, type: 'a11y-ui-src-config', state: {
                'actions-workflow': workflow,
                'custom-steps-json': JSON.stringify([{ id: 'banners', name: 'Dismiss banners', actions: [{ type: 'keyboard', key: 'Escape' }] }]),
            } };
            Object.defineProperty(input, 'files', { value: [new win.File([JSON.stringify(config)], 'c.json')], configurable: true });
            input.dispatchEvent(new win.Event('change'));
        });
        const { message, tone } = lastStatus();
        assert.equal(tone, 'warning');
        assert.match(message, /^Configuration loaded from file\./);
        assert.match(message, /Step 2 \(Switch\): 'actions' was not used, so 2 nested steps were left out/);
        assert.match(message, /Step 3\.1 \(Condition\): 'selector' was not used/);
        assert.match(message, /Custom step “Dismiss banners”, step 1 \(Keyboard input\): 'key' was not used/);
        assert.match(message, /Saving now would drop it for good\./);
        assert.equal(shown, 1, 'the empty required fields show as such once loaded');
    });
});
