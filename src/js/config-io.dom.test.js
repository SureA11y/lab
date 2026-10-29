'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { buildViewportFromPreset } = require('../shared/scan-inputs.js');
const { SCAN_TARGETS } = require('../shared/conformance-targets.js');
const { buildRunSpec, normalizeRunSpec } = require('../shared/run-spec.js');

let createConfigIO;

const FORM_HTML = `
<form id="scan-form">
  <div class="config-data">
    <input id="url-input" value="https://example.com/">
    <input id="scenario-name" value="Checkout">
    <input id="exclude-selectors-global" value=".ads">
    <fieldset data-config-exclude>
      <textarea id="batch-rows">[{"name":"v2.3"}]</textarea>
    </fieldset>
  </div>
</form>`;

before(async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${FORM_HTML}</body></html>`, {
        url: 'https://example.com/',
    });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.FileReader = dom.window.FileReader;

    ({ createConfigIO } = await import('./config-io.js'));
});

function makeConfigIO({ getRunSpec, onGetValue = () => {}, saveBlobAsJSON, getBatch, setBatch, getSections, setSections } = {}) {
    return createConfigIO({
        form: document.getElementById('scan-form'),
        urlInput: document.getElementById('url-input'),
        actionsBuilder: {
            getValue: (opts) => {
                onGetValue(opts);
                return { ok: true, value: [{ type: 'a11yScan', label: 'Home' }] };
            },
        },
        getCustomSteps: () => ({ ok: true, value: [] }),
        getRunSpec,
        getBatch,
        setBatch,
        getSections,
        setSections,
        setStatusRun: () => {},
        STATUS: {},
        jsonBlob: () => ({}),
        saveBlobAsJSON,
    });
}

/**
 * Clicks the save button and resolves with the options the saver handed to
 * saveBlobAsJSON - the suggested file name among them.
 */
function saveOptionsFor(scenarioName) {
    const scenarioEl = document.getElementById('scenario-name');
    const previous = scenarioEl.value;
    scenarioEl.value = scenarioName;

    return new Promise((resolve, reject) => {
        const button = document.createElement('button');
        makeConfigIO({ saveBlobAsJSON: (blob, options) => resolve(options) }).setupConfigSaver(button);
        button.dispatchEvent(new window.Event('click'));
        setTimeout(() => reject(new Error('saveBlobAsJSON was never called')), 1000);
    }).finally(() => {
        scenarioEl.value = previous;
    });
}

function uiRunSpec() {
    return buildRunSpec({
        url: 'https://example.com/',
        actions: [{ type: 'a11yScan', label: 'Home' }],
        scenarioName: 'Checkout',
        viewport: buildViewportFromPreset('desktop-lg'),
    });
}

describe('buildConfigFile', () => {
    test('keeps the form state that restores the app', () => {
        const config = makeConfigIO().buildConfigFile();

        assert.equal(config.type, 'a11y-ui-src-config');
        assert.equal(config.url, 'https://example.com/');
        assert.equal(config.state['scenario-name'], 'Checkout');
        assert.deepEqual(config.state['actions-workflow'], [{ type: 'a11yScan', label: 'Home' }]);
    });

    test('embeds the run spec next to the state', () => {
        const config = makeConfigIO({ getRunSpec: uiRunSpec }).buildConfigFile();

        assert.equal(config.runSpec.type, 'a11y-run-spec');
        assert.equal(config.runSpec.scenarioName, 'Checkout');
        assert.deepEqual(config.runSpec.viewport, { width: 1440, height: 900 });
    });

    test('what the app saves is what a headless run accepts', () => {
        const config = makeConfigIO({ getRunSpec: uiRunSpec }).buildConfigFile();
        const { ok, spec, errors, warnings } = normalizeRunSpec(config, { profiles: Object.keys(SCAN_TARGETS), buildViewportFromPreset });

        assert.equal(ok, true, errors.join(', '));
        assert.deepEqual(warnings, []);
        assert.equal(spec.url, 'https://example.com/');
        assert.equal(spec.scenarioName, 'Checkout');
        assert.deepEqual(spec.viewport, { width: 1440, height: 900 });
        assert.deepEqual(spec.actions, [{ type: 'a11yScan', label: 'Home' }]);
    });

    test('asks the builder to leave masked values out of the file', () => {
        // The whole point of "Set password value": a password is not written
        // to a config, only the flag saying it was there. See
        // actions-builder.masked-value.test.js for the redaction itself.
        let opts = null;
        makeConfigIO({ onGetValue: (o) => { opts = o; } }).buildConfigFile();

        assert.equal(opts?.maskValues, 'redact');
        assert.equal(opts?.markMasked, true);
    });

    test('checks the workflow without revealing, so the steps are saved open or collapsed as they were', () => {
        const seen = [];
        makeConfigIO({ onGetValue: (o) => seen.push(o) }).collectShareableState();
        assert.equal(seen[0]?.reveal, false);
    });

    test('the shareable link leaves masked values out too', () => {
        let opts = null;
        makeConfigIO({ onGetValue: (o) => { opts = o; } }).collectShareableState();

        assert.equal(opts?.maskValues, 'redact');
        assert.equal(opts?.markMasked, true);
    });

    test('checks the workflow without revealing, so the steps are saved open or collapsed as they were', () => {
        const seen = [];
        makeConfigIO({ onGetValue: (o) => seen.push(o) }).collectShareableState();
        assert.equal(seen[0]?.reveal, false);
    });

    test('saves without a spec when the workflow is not runnable', () => {
        const config = makeConfigIO({ getRunSpec: () => null }).buildConfigFile();

        assert.ok(!('runSpec' in config));
        assert.deepEqual(config.state['actions-workflow'], [{ type: 'a11yScan', label: 'Home' }]);
    });

    test('still saves the config when building the spec throws', () => {
        const config = makeConfigIO({
            getRunSpec: () => { throw new Error('builder is not ready'); },
        }).buildConfigFile();

        assert.ok(!('runSpec' in config));
        assert.equal(config.url, 'https://example.com/');
    });

    test('omits the spec when no builder is wired in', () => {
        assert.ok(!('runSpec' in makeConfigIO().buildConfigFile()));
    });
});

describe('setupConfigSaver', () => {
    test('offers the scenario name as the file name', async () => {
        // The scenario name is what the user calls this configuration, so it is
        // the name the save dialog should already be holding.
        const options = await saveOptionsFor('Checkout');

        assert.equal(options.suggestedBase, 'Checkout');
    });

    test('a workflow the builder finds invalid is saved as it stands, and the save says what to fix', async () => {
        // Before, the workflow was dropped from the file and the save said it
        // went well: loading the config then showed an empty workflow.
        const line = document.createElement('div');
        line.className = 'line';
        line.innerHTML = '<div class="line-title">1 - Navigate to URL</div>'
            + '<div class="field"><input id="bad-url"><div class="error">This field is required</div></div>';
        document.body.appendChild(line);
        try {
            const options = await new Promise((resolve, reject) => {
                const button = document.createElement('button');
                createConfigIO({
                    form: document.getElementById('scan-form'),
                    urlInput: document.getElementById('url-input'),
                    actionsBuilder: {
                        getValue: (opts) => (opts && opts.validate === false
                            ? { ok: true, value: [{ type: 'navigate', url: '' }] }
                            : { ok: false, value: null, firstErrorEl: document.getElementById('bad-url') }),
                    },
                    getCustomSteps: () => ({ ok: true, value: [] }),
                    setStatusRun: () => {},
                    STATUS: { OK: 'ok', WARNING: 'warning' },
                    jsonBlob: (config) => config,
                    saveBlobAsJSON: (blob, opts) => resolve({ ...opts, config: blob }),
                }).setupConfigSaver(button);
                button.dispatchEvent(new window.Event('click'));
                setTimeout(() => reject(new Error('saveBlobAsJSON was never called')), 1000);
            });
            assert.deepEqual(options.config.state['actions-workflow'], [{ type: 'navigate', url: '' }]);
            assert.equal(options.okStatus, 'warning');
            assert.match(options.okMsg, /1 - Navigate to URL: This field is required/);
        } finally {
            line.remove();
        }
    });

    test('falls back to the URL when the scenario has no name', async () => {
        const options = await saveOptionsFor('   ');

        assert.equal(options.suggestedBase, 'https://example.com/');
    });
});

describe('batch rows in a config', () => {
    test('fields marked data-config-exclude never enter the saved form state', () => {
        const state = makeConfigIO().collectShareableState();
        assert.equal('batch-rows' in state, false);
        assert.equal(state['scenario-name'], 'Checkout');
    });

    test('the batch travels with an export when the section offers it, and never into a queue item', () => {
        const batch = { rows: [{ name: 'v2.3' }], namePattern: 'P {var:name}' };
        const io = makeConfigIO({ getBatch: () => batch });
        assert.deepEqual(io.buildConfigFile().batch, batch);
        assert.equal('batch' in io.buildConfigFile({ includeBatch: false }), false);
        assert.equal('batch' in makeConfigIO({ getBatch: () => null }).buildConfigFile(), false);
    });

    test('saves which sections are collapsed, and puts them back last when loading', () => {
        const sections = { batch: true, customSteps: false, workflow: true };
        assert.deepEqual(makeConfigIO({ getSections: () => sections }).buildConfigFile().sections, sections);

        const order = [];
        const io = makeConfigIO({ setBatch: () => order.push('batch'), setSections: (s) => order.push(s) });
        io.applyConfig({ state: { 'url-input': 'https://example.com/' }, batch: { rows: [] }, sections });
        assert.deepEqual(order, ['batch', sections], 'after the batch, which opens its section');
        order.length = 0;
        io.applyConfig({ state: { 'url-input': 'https://example.com/' } });
        assert.deepEqual(order, [], 'an older config leaves the sections alone');
    });

    test('applying a config with a batch hands it back to the section', () => {
        const seen = [];
        const io = makeConfigIO({ setBatch: (b) => seen.push(b) });
        const batch = { rows: [{ name: 'v2.4' }] };
        assert.equal(io.applyConfig({ state: { 'url-input': 'https://example.com/' }, batch }), null);
        assert.deepEqual(seen, [batch]);
        io.applyConfig({ state: { 'url-input': 'https://example.com/' } });
        assert.equal(seen.length, 1, 'a config without one leaves the section alone');
    });
});

describe('loading a file with Load config', () => {
    function loadThrough(text, extra = {}) {
        const input = document.createElement('input');
        input.type = 'file';
        document.body.append(input);
        const statuses = [];
        let callbacks = 0;
        const io = createConfigIO({
            form: document.getElementById('scan-form'),
            urlInput: document.getElementById('url-input'),
            configFileEl: input,
            actionsBuilder: { getValue: () => ({ ok: true, value: [] }) },
            getCustomSteps: () => ({ ok: true, value: [] }),
            setStatusRun: (msg, tone) => statuses.push([msg, tone]),
            STATUS: { OK: 'ok', ERROR: 'error' },
            jsonBlob: () => ({}),
            ...extra,
        });
        io.setupConfigLoader(() => { callbacks += 1; });
        Object.defineProperty(input, 'files', { value: [new window.File([text], 'f.json', { type: 'application/json' })] });
        input.dispatchEvent(new window.Event('change'));
        // FileReader is asynchronous: wait for the loader to report.
        return (async () => {
            const deadline = Date.now() + 2000;
            while (!statuses.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
            return { statuses, callbacks: () => callbacks };
        })();
    }

    test('a batch rows file goes to the Batch section instead of failing, and the workflow is left alone', async () => {
        const loaded = [];
        const before = document.getElementById('url-input').value;
        const { statuses, callbacks } = await loadThrough('[{"name":"v2.3"}]', { loadBatchRows: (rows) => loaded.push(rows) });
        assert.deepEqual(loaded, [[{ name: 'v2.3' }]]);
        assert.equal(statuses.at(-1)[1], 'ok');
        assert.match(statuses.at(-1)[0], /list of batch workflows, not a configuration/);
        assert.equal(callbacks(), 0, 'the form is not reset');
        assert.equal(document.getElementById('url-input').value, before);
    });

    test('anything else without a state still gets the config error', async () => {
        const { statuses } = await loadThrough('{"rows": []}', { loadBatchRows: () => {} });
        assert.deepEqual(statuses.at(-1), ['Config JSON must contain a "state" object.', 'error']);
    });
});

describe('loading the configuration a download carries', () => {
    const JSZip = require('jszip');
    const config = (over = {}) => ({ version: 1, type: 'a11y-ui-src-config', url: 'https://shop.test/', state: { 'url-input': 'https://shop.test/', 'scenario-name': 'Shop' }, ...over });

    async function load(file, extra = {}) {
        globalThis.JSZip = JSZip;
        globalThis.A11Y_BATCH_CONFIG = require('../shared/batch-config.js');
        const input = document.createElement('input');
        input.type = 'file';
        document.body.append(input);
        const statuses = [];
        const batches = [];
        const io = createConfigIO({
            form: document.getElementById('scan-form'),
            urlInput: document.getElementById('url-input'),
            configFileEl: input,
            actionsBuilder: { getValue: () => ({ ok: true, value: [] }), loadActions: () => {}, setValue: () => {} },
            getCustomSteps: () => ({ ok: true, value: [] }),
            setStatusRun: (msg, tone) => statuses.push([msg, tone]),
            setBatch: (batch) => batches.push(batch),
            STATUS: { OK: 'ok', ERROR: 'error' },
            jsonBlob: () => ({}),
            ...extra,
        });
        io.setupConfigLoader(() => {});
        Object.defineProperty(input, 'files', { value: [file] });
        input.dispatchEvent(new window.Event('change'));
        const deadline = Date.now() + 2000;
        while (!statuses.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
        return { status: statuses.at(-1), batches };
    }

    async function zipOf(files) {
        const zip = new JSZip();
        for (const [name, value] of Object.entries(files)) zip.file(name, typeof value === 'string' ? value : JSON.stringify(value));
        return new window.File([await zip.generateAsync({ type: 'uint8array' })], 'download.zip', { type: 'application/zip' });
    }

    test('a batch zip sets the batch up again from the configuration beside its results', async () => {
        const batch = { rows: [{ name: 'v1', url: 'https://shop.test/v1' }, { name: 'v2', url: 'https://shop.test/v2' }], enabled: true };
        const { status, batches } = await load(await zipOf({
            'Shop.a11y-config.json': config({ batch }),
            'v1.json': { scans: [], config: config() },
            'batch.json': { items: [] },
            'images/a.png': 'x',
        }));
        assert.equal(status[1], 'ok');
        assert.deepEqual(batches, [batch]);
    });

    test('a batch saved before has its configuration rebuilt from batch.json', async () => {
        const { status, batches } = await load(await zipOf({
            'batch.json': {
                name: 'Shop',
                items: [
                    { name: 'v1', url: 'https://shop.test/v1', vars: { lang: 'en' }, config: config() },
                    { name: 'v2', url: 'https://shop.test/v2', config: config() },
                ],
            },
            'v1.json': { scans: [] },
        }));
        assert.equal(status[1], 'ok');
        assert.deepEqual(batches, [{ rows: [{ name: 'v1', url: 'https://shop.test/v1', vars: { lang: 'en' } }, { name: 'v2', url: 'https://shop.test/v2' }], enabled: true }]);
    });

    test('a report sets up the run it came from, and says when it carries hidden values to type again', async () => {
        const withPassword = config({ state: { 'url-input': 'https://shop.test/', 'actions-workflow': [{ type: 'setPassword', selector: '#p', valueMasked: true }] } });
        const report = new window.File([JSON.stringify({ scans: [{}], config: withPassword })], 'Shop.a11y-report.json', { type: 'application/json' });
        const { status } = await load(report);
        assert.equal(status[1], 'ok');
        assert.match(status[0], /^Configuration loaded from the report\. Type its hidden values again/);
    });

    test('a report saved before reports kept their configuration, or a zip with none, says so', async () => {
        const old = new window.File([JSON.stringify({ scans: [{}] })], 'old.json', { type: 'application/json' });
        assert.deepEqual((await load(old)).status, ['That report does not carry the configuration it ran: it was saved before reports kept it.', 'error']);
        assert.deepEqual((await load(await zipOf({ 'readme.txt': 'hi' }))).status, ['That zip holds no configuration.', 'error']);
    });
});

