'use strict';

// The Workflow header's expected scans field: what it shows beside a number
// the person did not type, and that it never fills in a number of its own.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

const estimate = require('../shared/scan-time-estimate.js');
const plan = require('../shared/workflow-step-plan.js');

let setupExpectedScansField;
let describeExpectedScans;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    ({setupExpectedScansField, describeExpectedScans} = await import('./expected-scans-field.js'));
});

const scan = () => ({type: 'a11yScan'});
const click = () => ({type: 'click'});
const forEach = (extra = {}) => ({type: 'forEachElement', selector: 'a', actions: [scan()], ...extra});

beforeEach(() => {
    document.body.innerHTML = `
        <div id="steps"></div>
        <label class="run-expected-scans" for="run-expected-scans">
            <input type="number" id="run-expected-scans"/>
            <span id="run-expected-scans-note"></span>
        </label>
        <span id="run-expected-scans-hint"></span>`;
});

const input = () => document.getElementById('run-expected-scans');
const note = () => document.getElementById('run-expected-scans-note');
const hint = () => document.getElementById('run-expected-scans-hint');

function field(actions, extra = {}) {
    let workflow = {actions, customSteps: []};
    const api = setupExpectedScansField({
        doc: document,
        getWorkflow: () => workflow,
        estimate,
        plan,
        schedule: (fn) => { fn(); return 1; },
        ...extra
    });
    return {api, set: (next) => { workflow = {actions: next, customSteps: []}; }};
}

describe('describeExpectedScans', () => {
    const of = (actions) => describeExpectedScans(plan.planWorkflowSteps(actions), estimate);

    test('a workflow that cannot vary its scans is calculated', () => {
        assert.deepEqual(of([scan(), click(), scan()]), {kind: 'calculated', count: 2, ceiling: 2});
    });

    test('conditions and loops with a limit make it unsure, with a ceiling', () => {
        const info = of([scan(), {type: 'if', actions: [scan()], elseActions: []}]);
        assert.equal(info.kind, 'unsure');
        assert.equal(info.ceiling, 2);
        assert.equal(of([forEach({limit: 10})]).ceiling, 10);
    });

    test('a loop with no limit has no ceiling to name', () => {
        assert.deepEqual(of([forEach()]), {kind: 'unsure', count: null, ceiling: null});
    });

    test('a workflow with no scans has nothing to say', () => {
        assert.equal(of([click()]).kind, 'none');
    });
});

describe('setupExpectedScansField', () => {
    test('says calculated, and shows the number as a placeholder, not a value', () => {
        field([scan(), scan()]);
        assert.equal(note().textContent, 'calculated');
        assert.equal(input().placeholder, '2');
        assert.equal(input().value, '', 'what is saved stays what was typed');
        assert.match(hint().textContent, /2 scans on every path/);
    });

    test('says not sure when the count depends on a loop or a condition', () => {
        field([forEach({limit: 10})]);
        assert.equal(note().textContent, 'not sure');
        assert.equal(input().placeholder, 'up to 10');
        assert.match(hint().textContent, /Left empty, it comes from the last run of this workflow/);
    });

    test('says nothing for a workflow with no scans', () => {
        field([click()]);
        assert.equal(note().textContent, '');
        assert.equal(input().placeholder, '');
    });

    test('says nothing once a number is typed, and comes back when it is cleared', () => {
        field([scan(), scan()]);
        input().value = '5';
        input().dispatchEvent(new window.Event('input', {bubbles: true}));
        assert.equal(note().textContent, '');
        assert.equal(input().placeholder, '');
        assert.match(hint().textContent, /Clear it to use the workflow's own count/);

        input().value = '';
        input().dispatchEvent(new window.Event('input', {bubbles: true}));
        assert.equal(note().textContent, 'calculated');
    });

    test('looks again when the workflow changes', () => {
        const {api, set} = field([scan()]);
        assert.equal(input().placeholder, '1');
        set([scan(), scan(), scan()]);
        api.refresh();
        assert.equal(input().placeholder, '3');
    });

    test('a watched element that changes is read again', () => {
        const steps = document.getElementById('steps');
        const {set} = field([scan()], {watch: [steps]});
        set([forEach()]);
        steps.dispatchEvent(new window.Event('input', {bubbles: true}));
        assert.equal(note().textContent, 'not sure');
    });

    test('a workflow that cannot be read has nothing to offer', () => {
        setupExpectedScansField({doc: document, getWorkflow: () => null, estimate, plan});
        assert.equal(note().textContent, '');
        setupExpectedScansField({doc: document, getWorkflow: () => { throw new Error('x'); }, estimate, plan});
        assert.equal(note().textContent, '');
    });

    test('does nothing without the field or the shared modules', () => {
        document.body.innerHTML = '';
        assert.doesNotThrow(() => setupExpectedScansField({doc: document, getWorkflow: () => null, estimate, plan}).refresh());
        document.body.innerHTML = '<input id="run-expected-scans"/>';
        assert.doesNotThrow(() => setupExpectedScansField({doc: document, getWorkflow: () => null, estimate: null, plan}).refresh());
    });
});
