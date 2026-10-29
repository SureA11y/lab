'use strict';

// DOM tests for the Batch section (createBatchPanel), under jsdom: the verdict
// shown as rows are typed, the switch that makes Run run the batch, what the
// Run button is told to say, and the rows saved with and restored from a
// config.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createBatchPanel;
let runLabelFor;
const batchApi = require('../shared/batch-rows.js');

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.HTMLElement = dom.window.HTMLElement;
    ({createBatchPanel, runLabelFor} = await import('./batch-panel.js'));
});

beforeEach(() => {
    document.body.innerHTML = `
        <button id="toggle" aria-expanded="false">Batch <span id="badge" hidden></span></button>
        <div id="content" hidden>
            <button id="use">Enable batch</button>
            <textarea id="rows"></textarea>
            <input id="pattern">
            <button id="file-btn">Load file…</button><input type="file" id="file">
            <div id="check" class="status" role="status"></div>
            <ul id="problems" hidden></ul>
        </div>`;
});

const $ = (id) => document.getElementById(id);
const tick = () => new Promise((r) => setTimeout(r, 0));

function panel(opts = {}) {
    const statuses = [];
    const p = createBatchPanel({
        toggle: $('toggle'),
        content: $('content'),
        badge: $('badge'),
        useButton: $('use'),
        rowsInput: $('rows'),
        namePatternInput: $('pattern'),
        fileButton: $('file-btn'),
        fileInput: $('file'),
        checkEl: $('check'),
        problemsEl: $('problems'),
        getWorkflow: () => ({url: 'https://example.com/', workflow: {actions: [{type: 'a11yScan'}]}}),
        onChange: (s) => statuses.push(s),
        batchApi,
        debounceMs: 0,
        ...opts,
    });
    return {p, statuses, last: () => statuses.at(-1)};
}

const twoRows = JSON.stringify([
    {name: 'v2.3', url: 'https://example.com/v2.3', vars: {date: '2026-03-01'}},
    {name: 'v2.4', url: 'https://example.com/v2.4', vars: {build: 2402}},
]);

function type(text) {
    $('rows').value = text;
    $('rows').dispatchEvent(new window.Event('input'));
}

describe('batch panel', () => {
    test('the toggle opens and closes the section', () => {
        panel();
        $('toggle').click();
        assert.equal($('toggle').getAttribute('aria-expanded'), 'true');
        assert.equal($('content').hidden, false);
        $('toggle').click();
        assert.equal($('content').hidden, true);
    });

    test('an empty box is off and says nothing', () => {
        const {p} = panel();
        const s = p.check();
        assert.equal(s.state, 'empty');
        assert.equal(s.active, false);
        assert.equal($('check').textContent, '');
        assert.equal(runLabelFor(s), null, 'Run stays Run');
    });

    test('pasting rows into an empty box switches the batch on, and Run says it will run them', async () => {
        const {last} = panel();
        type(twoRows);
        await tick();
        assert.equal($('use').textContent, 'Disable batch');
        assert.equal(last().active, true);
        assert.equal(last().state, 'ready');
        assert.equal(runLabelFor(last()), 'Run batch (2 runs)');
        assert.equal($('check').textContent, '2 workflows, ready: Run will run the batch.');
        assert.equal($('badge').textContent, '2 workflows');
    });

    test('the button starts as Enable batch', () => {
        panel();
        assert.equal($('use').textContent, 'Enable batch');
    });

    test('disabling the batch keeps the rows and gives Run back its plain meaning', async () => {
        const {last} = panel();
        type(twoRows);
        await tick();
        $('use').click();
        assert.equal($('use').textContent, 'Enable batch');
        assert.equal(last().active, false);
        assert.equal(runLabelFor(last()), null);
        assert.equal($('rows').value, twoRows);
        assert.equal($('badge').textContent, '2 workflows, off');
        assert.match($('check').textContent, /Enable the batch to run them/);
        $('use').click();
        assert.equal(last().active, true);
        assert.equal(runLabelFor(last()), 'Run batch (2 runs)');
    });

    test('rows kept while the batch is disabled are shown dimmed; an empty box is not', async () => {
        panel();
        $('use').click();
        assert.equal($('content').classList.contains('is-off'), false, 'nothing to dim');
        type(twoRows);
        await tick();
        assert.equal($('content').classList.contains('is-off'), false, 'rows enable the batch');
        $('use').click();
        assert.equal($('content').classList.contains('is-off'), true);
        $('use').click();
        assert.equal($('content').classList.contains('is-off'), false);
    });

    test('editing rows that are already there does not enable a disabled batch again', async () => {
        const {last} = panel();
        type(twoRows);
        await tick();
        $('use').click();
        type(twoRows.replace('v2.4', 'v2.6'));
        await tick();
        assert.equal($('use').textContent, 'Enable batch');
        assert.equal(last().active, false);
    });

    test('problems: Run says how many, the status line gives a verdict, the list says what', async () => {
        const {last} = panel();
        type(JSON.stringify([{name: 'a', url: 'nope'}, {nmae: 'b'}]));
        await tick();
        assert.equal(last().state, 'invalid');
        assert.equal(runLabelFor(last()), 'Run batch (fix 2 problems)');
        assert.equal($('check').textContent, '2 problems to fix before the batch can run.');
        assert.deepEqual([...$('problems').children].map((li) => li.textContent), [
            'Workflow 1: "nope" is not a full URL.',
            'Workflow 2: "nmae" is not a workflow field. Use name, url and vars; other values go inside vars.',
        ]);
        assert.equal($('rows').getAttribute('aria-invalid'), 'true');
    });

    test('JSON that does not parse counts as one problem', async () => {
        const {last} = panel();
        type('[{"name": "v2.3",}]');
        await tick();
        assert.equal(runLabelFor(last()), 'Run batch (fix 1 problem)');
        assert.match($('check').textContent, /^This is not valid JSON/);
    });

    test('lists at most five problems and counts the rest', async () => {
        panel();
        type(JSON.stringify(Array.from({length: 8}, () => ({url: 'https://example.com/'}))));
        await tick();
        const items = [...$('problems').children].map((li) => li.textContent);
        assert.equal(items.length, 6);
        assert.equal(items[5], '…and 3 more problems.');
    });

    test('reports every variable name the rows set, for flagging steps that would hide them', async () => {
        const {last} = panel();
        type(twoRows);
        await tick();
        assert.deepEqual(last().varNames, ['date', 'build']);
    });

    test('warnings are listed without blocking the batch', async () => {
        const {last} = panel({getWorkflow: () => ({url: 'https://example.com/', workflow: {actions: [{type: 'navigate', url: '/{var:lang}'}]}})});
        type(twoRows);
        await tick();
        assert.equal(last().state, 'ready');
        assert.match($('problems').textContent, /uses \{var:lang\}, but no workflow sets it/);
        assert.equal($('problems').className, 'batch-problems batch-problems--warning');
    });

    test('the runs carry the pattern-made names', async () => {
        const {last} = panel();
        $('pattern').value = 'Product {var:name}';
        type(twoRows);
        await tick();
        assert.deepEqual(last().runs.map((r) => [r.row, r.name, r.url]), [
            [1, 'Product v2.3', 'https://example.com/v2.3'],
            [2, 'Product v2.4', 'https://example.com/v2.4'],
        ]);
    });

    test('after queuing, the rows stay and the section says so', async () => {
        const {p} = panel();
        type(twoRows);
        await tick();
        p.noteQueued(2);
        assert.equal($('rows').value, twoRows);
        assert.match($('check').textContent, /2 runs added to the queue\. The workflows stay here/);
    });

    test('rows always go into an exported config, as parsed rows or the draft as typed', () => {
        const {p} = panel();
        assert.equal(p.getBatchForConfig(), null, 'no rows, no batch');
        $('rows').value = twoRows;
        $('pattern').value = 'Product {var:name}';
        assert.deepEqual(p.getBatchForConfig(), {rows: JSON.parse(twoRows), rowsText: twoRows, namePattern: 'Product {var:name}', enabled: false});
        $('rows').value = '[{"name": ';
        assert.deepEqual(p.getBatchForConfig(), {rowsText: '[{"name":', namePattern: 'Product {var:name}', enabled: false});
    });

    test('rows laid out their own way come back exactly as typed', () => {
        const {p} = panel();
        $('rows').value = twoRows; // one line, no indentation
        const saved = p.getBatchForConfig();
        assert.deepEqual(saved.rows, JSON.parse(twoRows));
        assert.equal(saved.rowsText, twoRows);

        const {p: other} = panel();
        other.setBatchFromConfig(saved);
        assert.equal($('rows').value, twoRows);

        // The standard layout needs no copy of the text.
        $('rows').value = JSON.stringify(JSON.parse(twoRows), null, 2);
        assert.equal('rowsText' in p.getBatchForConfig(), false);
    });

    test('an exported config records whether the batch is enabled', async () => {
        const {p} = panel();
        type(twoRows);
        await tick();
        assert.equal(p.getBatchForConfig().enabled, true);
        $('use').click();
        assert.equal(p.getBatchForConfig().enabled, false);
    });

    test('a loaded config saved with the batch disabled restores the rows with the batch disabled', () => {
        const {p, last} = panel();
        p.setBatchFromConfig({rows: JSON.parse(twoRows), enabled: false});
        assert.deepEqual(JSON.parse($('rows').value), JSON.parse(twoRows));
        assert.equal($('use').textContent, 'Enable batch');
        assert.equal(last().active, false);
        assert.equal(runLabelFor(last()), null);
    });

    test('a rows file fills the box, switches the batch on and opens the section, leaving the run name alone', () => {
        const {p, last} = panel();
        $('pattern').value = 'Mine {var:name}';
        p.loadRows(JSON.parse(twoRows));
        assert.deepEqual(JSON.parse($('rows').value), JSON.parse(twoRows));
        assert.equal($('pattern').value, 'Mine {var:name}');
        assert.equal($('content').hidden, false);
        assert.equal(last().active, true);
    });

    test('one run sent back from the queue can replace the run name with its own', () => {
        const {p, last} = panel();
        $('pattern').value = 'Product {var:name}';
        p.loadRows([{name: 'Product v2.4', url: 'https://example.com/v2.4', vars: {build: 2402}}], {namePattern: ''});
        assert.equal($('pattern').value, '');
        assert.equal(last().runs[0].name, 'Product v2.4');
    });

    test('a loaded config with rows fills the section and enables the batch', () => {
        const {p, last} = panel();
        p.setBatchFromConfig({rows: JSON.parse(twoRows), namePattern: 'P {var:name}'});
        assert.deepEqual(JSON.parse($('rows').value), JSON.parse(twoRows));
        assert.equal($('pattern').value, 'P {var:name}');
        assert.equal($('content').hidden, false);
        assert.equal(runLabelFor(last()), 'Run batch (2 runs)');
    });
});
