'use strict';

// "Where the failures are" in the report view (a11y-ui.rendering.js): shown
// only when a rule fails in the scans in view.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let renderer;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="results"></div><div id="shots"></div></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.A11Y_ISSUE_DISPERSION = require('../shared/issue-dispersion.js');
    globalThis.A11Y_ISSUE_DISPERSION_VIEW = require('../shared/issue-dispersion-view.js');
    const {createRenderer} = await import('./a11y-ui.rendering.js');
    renderer = createRenderer({
        resultsEl: document.getElementById('results'),
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: (s) => String(s),
        escapeHtml: (s) => String(s),
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
    });
});

function scan(id, findings) {
    return {id, label: id, canonical: {findings}};
}

describe('Where the failures are', () => {
    test('is left out when no rule fails, even with things to review', () => {
        const scans = [
            scan('a', [{ruleId: 'r1', outcome: 'cantTell', occurrences: [{target: ['#x']}]}]),
            scan('b', [{ruleId: 'r2', outcome: 'pass'}]),
        ];
        assert.equal(renderer.buildDispersionSectionHtml(scans), '');
        assert.equal(renderer.buildDispersionSectionHtml([]), '');
    });

    test('is shown once a rule fails', () => {
        const scans = [
            scan('a', [{ruleId: 'r1', outcome: 'fail', occurrences: [{target: ['#x']}]}]),
            scan('b', []),
        ];
        assert.match(renderer.buildDispersionSectionHtml(scans), /<summary>Where the failures are<\/summary>/);
    });
});
