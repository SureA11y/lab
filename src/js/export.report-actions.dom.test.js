'use strict';

// DOM tests for the two report-level action buttons that sit beside the download
// split button: "Compare", which hands the report on screen to the Compare tab,
// and "Clear", which discards it.
//
// What is pinned here is the labelling rather than the wiring (the click handlers
// live at the a11y-ui.js call site). Both buttons show a bare verb, so the thing
// each verb applies to only reaches a screen reader through the accessible name —
// and that name has to keep the visible word inside it, or a voice-control user
// saying "clear" no longer matches the button (WCAG 2.5.3 Label in Name). In an
// accessibility lab of all places, that is worth a test.
//
// node's test runner isolates each file in its own process.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createCompareReportBtn;
let createClearReportBtn;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;

    ({createCompareReportBtn, createClearReportBtn} = await import('./export.js'));
});

function accessibleName(button) {
    return button.getAttribute('aria-label') || button.textContent;
}

describe('report action buttons', () => {
    test('both are plain buttons, styled as the secondary actions they are', () => {
        for (const button of [createCompareReportBtn(), createClearReportBtn()]) {
            // Without an explicit type a button submits the form it lands in.
            assert.equal(button.type, 'button');
            assert.ok(button.classList.contains('secondary-button'));
        }
    });

    test('each shows a bare verb', () => {
        assert.equal(createCompareReportBtn().textContent, 'Compare');
        assert.equal(createClearReportBtn().textContent, 'Clear');
    });

    test('the accessible name says what the verb applies to', () => {
        assert.equal(accessibleName(createCompareReportBtn()), 'Compare this report with another');
        assert.equal(accessibleName(createClearReportBtn()), 'Clear report');
    });

    test('the caller can name what is being cleared or compared', () => {
        const compare = createCompareReportBtn({accessibleName: 'Compare these run results with another report'});
        const clear = createClearReportBtn({accessibleName: 'Clear run results'});

        assert.equal(accessibleName(compare), 'Compare these run results with another report');
        assert.equal(accessibleName(clear), 'Clear run results');
    });

    test('the visible label stays inside the accessible name, whoever names it', () => {
        const buttons = [
            createCompareReportBtn(),
            createClearReportBtn(),
            createCompareReportBtn({accessibleName: 'Compare these run results with another report'}),
            createClearReportBtn({accessibleName: 'Clear run results'}),
        ];

        for (const button of buttons) {
            assert.ok(
                accessibleName(button).toLowerCase().includes(button.textContent.toLowerCase()),
                `"${accessibleName(button)}" must contain the visible "${button.textContent}"`
            );
        }
    });
});
