'use strict';

// Opening a configuration or run spec saved in the older format with "Load
// config": it is brought up to the current format, and the status says so.

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
    <input id="scan-context" value="#before">
    <input id="exclude-selectors-global" value=".before">
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

const OLD_STEPS = [
    { type: 'navigate', url: 'https://example.com/' },
    { type: 'group', label: 'Cookies', actions: [
        { type: 'click', selector: '#accept', programmatic: 'true' },
        { type: 'a11yScan', label: 'Home', wcagLevel: 'AA', timeout: 90000, optInRules: 'none' },
    ] },
];

const oldConfig = () => ({
    version: 1,
    type: 'a11y-ui-src-config',
    url: 'https://example.com/',
    state: {
        'url-input': 'https://example.com/',
        'scenario-name': 'Saved last week',
        'custom-steps-json': JSON.stringify([{ id: 'page', actions: [{ type: 'a11yScan', label: '{var:name}', wcagLevel: 'AAA' }] }]),
        'actions-workflow': OLD_STEPS,
    },
});

describe('a configuration the queue kept in the older format', () => {
    test('is brought up to date when the queue puts it back in the form, and says so', () => {
        const io = createConfigIO({
            urlInput: win.document.getElementById('url-input'),
            actionsBuilder: { loadActions: (actions) => { calls.actions = actions; } },
            setCustomSteps: (raw) => { calls.customSteps = raw; },
            setStatusRun: () => {},
            STATUS: { OK: 'ok', ERROR: 'error', WARNING: 'warning' },
        });
        assert.equal(io.applyConfig(oldConfig()), null);
        assert.equal(calls.actions[1].actions[1].profile, 'wcag22-aa');
        const notes = io.takeLoadNotes();
        assert.equal(notes.length, 1);
        assert.match(notes[0], /older format and is now brought up to date, 5 changes/);
    });
});

describe('Load config with a configuration in the older format', () => {
    test('maps its steps\' fields to the current ones, nested and custom steps included', async () => {
        await openFile('old.a11y-config.json', JSON.stringify(oldConfig()));
        const [, group] = calls.actions;
        assert.deepEqual(group.actions[0], { type: 'click', selector: '#accept', programmatic: true });
        assert.deepEqual(group.actions[1], { type: 'a11yScan', label: 'Home', profile: 'wcag22-aa', waitTimeout: 90000, stageTimeout: 90000 });
        assert.deepEqual(JSON.parse(calls.customSteps)[0].actions[0], { type: 'a11yScan', label: '{var:name}', profile: 'wcag22-aaa' });
        assert.equal(value('scenario-name'), 'Saved last week');
    });

    test('says it was brought up to date, and that Export config saves the new format', async () => {
        await openFile('old.a11y-config.json', JSON.stringify(oldConfig()));
        const { message, tone } = lastStatus();
        assert.equal(tone, 'warning');
        assert.match(message, /saved in the older format and is now brought up to date, 5 changes: step 2\.1: programmatic "true" → true;/);
        assert.match(message, /and 2 more \(listed in the console\)/);
        assert.match(message, /Export config saves it in the current format/);
    });

    test('drops a scan\'s engine, and notes one that was not surea11y', async () => {
        const cfg = oldConfig();
        cfg.state['actions-workflow'] = [{ type: 'a11yScan', engine: 'other-engine', wcagLevel: 'A' }];
        await openFile('old.a11y-config.json', JSON.stringify(cfg));
        assert.deepEqual(calls.actions[0], { type: 'a11yScan', profile: 'wcag22-a' });
        assert.match(lastStatus().message, /Note: step 1: it named the engine "other-engine", which the lab no longer has: it runs with surea11y now/);
    });

    test('a configuration already current loads as before, with nothing said', async () => {
        const cfg = oldConfig();
        cfg.state['custom-steps-json'] = '[]';
        cfg.state['actions-workflow'] = [{ type: 'a11yScan', label: 'Home', profile: 'wcag22-aa' }];
        await openFile('new.a11y-config.json', JSON.stringify(cfg));
        assert.deepEqual(calls.actions, cfg.state['actions-workflow']);
        assert.equal(lastStatus().tone, 'ok');
        assert.doesNotMatch(lastStatus().message, /older format/);
    });

    test('a run spec in the older format is brought up to date too', async () => {
        await openFile('old.spec.json', JSON.stringify({
            type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/', tags: ['wcag22a'],
            actions: [{ type: 'a11yScan', label: 'Home', timeout: 5000 }],
        }));
        // Its tags came to WCAG 2.2 A, which a run no longer has: its scan does.
        assert.deepEqual(calls.actions, [{ type: 'a11yScan', label: 'Home', waitTimeout: 5000, profile: 'wcag22-a' }]);
        assert.match(lastStatus().message, /older format/);
    });
});
