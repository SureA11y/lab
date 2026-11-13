'use strict';

// DOM tests for the questions a scan leaves for a person (cantTell), as core
// 1.14 describes them: which way each one leans (lean) and the steps that
// answer it (howToCheck), shown in a finding's row and its occurrence list,
// driven under jsdom.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createRenderer;
let fillLazyDialogs;
let resultsEl;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.CSS = win.CSS;
    globalThis.requestAnimationFrame = (fn) => win.setTimeout(fn, 0);

    ({createRenderer} = await import('./a11y-ui.rendering.js'));
    ({fillLazyDialogs} = await import('./lazy-dialogs.js'));
});

beforeEach(() => {
    document.body.innerHTML = '<div id="results"></div><div id="shots"></div>';
    resultsEl = document.getElementById('results');
});

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(findings) {
    createRenderer({
        resultsEl,
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: escape,
        escapeHtml: escape,
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: {screenshotsDialog: {openById() {}}},
    }).renderAllScans([{id: 's1', label: 's1', canonical: {page: {url: 'https://example.test/'}, findings}}]);
    fillLazyDialogs(resultsEl);
}

function question(ruleId, occurrences, severity = 'moderate') {
    return {id: ruleId, ruleId, title: ruleId, outcome: 'cantTell', severity, tags: ['wcag2a'], wcag: [], occurrences};
}

function occ(target, extra = {}) {
    return {target: [target], html: `<h3 id="${target}">`, failureSummary: 'Check it.', pageUrl: 'https://example.test/', occurrenceOutcome: 'cantTell', ...extra};
}

const STEPS = {
    steps: ['Find the heading the report names.', 'Compare its level with the one before it.'],
    passWhen: 'Each heading is one level below its parent.',
    failWhen: 'A heading skips a level.'
};

describe('questions that lean', () => {
    test('a question says which way it leans, why, its caution, how often such a lean was right, and how to check it', () => {
        render([question('heading-order', [occ('#h', {
            lean: {toward: 'fail', why: 'The heading skips a level.', caution: 'A visual design may intend it.', measured: {agreed: 9, cases: 10}},
            howToCheck: STEPS
        })])]);
        const node = resultsEl.querySelector('.example-node');
        const lean = node.querySelector('.node-lean');
        assert.ok(lean.classList.contains('node-lean-fail'));
        assert.equal(lean.textContent, 'Likely fails: The heading skips a level. (right in 9 of 10 known cases)Caution: A visual design may intend it.');
        assert.equal(node.querySelector('h3 .lean-badge').textContent, 'likely fails');

        const how = node.querySelector('.node-how-to-check');
        assert.deepEqual(Array.from(how.querySelectorAll('li')).map((li) => li.textContent), STEPS.steps);
        // Collapsed, saying how many steps it holds.
        assert.equal(how.querySelector('details').open, false);
        assert.equal(how.querySelector('summary').textContent, 'How to check (2 steps)');
        assert.deepEqual(Array.from(how.querySelectorAll('p')).map((p) => p.textContent), [
            'Passes when: Each heading is one level below its parent.',
            'Fails when: A heading skips a level.',
        ]);
    });

    test('review rows: likely failures first, the row says how its questions lean', () => {
        render([
            question('aria-checked-state-mismatch', [occ('#c', {lean: {toward: 'pass', why: 'Browsers ignore it.'}})], 'serious'),
            question('link-name-quality', [occ('#l')], 'critical'),
            question('heading-order', [occ('#h1', {lean: {toward: 'fail', why: 'Skips.'}}), occ('#h2', {lean: {toward: 'fail', why: 'Skips.'}}), occ('#h3')], 'minor'),
        ]);
        const rows = Array.from(resultsEl.querySelectorAll('tr.cantTell'));
        assert.deepEqual(rows.map((r) => r.cells[2].textContent.split('Rule:')[0].trim()),
            ['heading-order', 'aria-checked-state-mismatch', 'link-name-quality']);
        assert.equal(rows[0].querySelector('.issue-status .lean-badge').textContent, 'likely fails');
        assert.equal(rows[1].querySelector('.issue-status .lean-badge').textContent, 'likely passes');
        assert.equal(rows[2].querySelector('.issue-status .lean-badge'), null, 'a question that leans nowhere needs a person');
        assert.equal(rows[0].querySelector('.instances-lean').textContent, '2 likely fail');
        // The row that likely fails stands out from the other review rows.
        assert.deepEqual(rows.map((r) => r.classList.contains('lean-fail')), [true, false, false]);

        // In the row's list, the likely failures come first.
        const headers = Array.from(rows[0].querySelectorAll('.example-node h3')).map((h) => h.querySelector('.lean-badge')?.textContent || '');
        assert.deepEqual(headers, ['likely fails', 'likely fails', '']);
    });

    test('a failure carries neither', () => {
        render([{id: 'img-alt-present', ruleId: 'img-alt-present', title: 'img', outcome: 'fail', severity: 'serious', tags: [], wcag: [],
            occurrences: [{target: ['#i'], html: '<img>', failureSummary: 'No alt.', occurrenceOutcome: 'fail'}]}]);
        assert.equal(resultsEl.querySelector('.node-lean'), null);
        assert.equal(resultsEl.querySelector('.node-how-to-check'), null);
        assert.equal(resultsEl.querySelector('.lean-badge'), null);
    });
});

describe('the scan\'s counts', () => {
    test('say how many questions likely fail', () => {
        render([
            question('heading-order', [occ('#h1', {lean: {toward: 'fail', why: 'Skips.'}}), occ('#h2', {lean: {toward: 'fail', why: 'Skips.'}}), occ('#h3')]),
            question('link-name-quality', [occ('#l')]),
        ]);
        assert.match(resultsEl.querySelector('.stream-cantTell').textContent, /2 can't tell \(2 likely fail\),$/);
    });
});

describe('steps every question shares', () => {
    test('are shown once, above the instances, and not under each', () => {
        render([question('heading-order', [occ('#h1', {howToCheck: STEPS}), occ('#h2', {howToCheck: STEPS}), occ('#h3', {howToCheck: STEPS})])]);
        const body = resultsEl.querySelector('tr.cantTell .src-dialog-body');
        const all = body.querySelectorAll('.node-how-to-check');
        assert.equal(all.length, 1);
        assert.ok(all[0].closest('.occurrences-common'), 'above the instances, with what they all share');
        assert.equal(all[0].closest('.example-node'), null, 'not inside one');
        assert.equal(all[0].querySelector('summary').textContent, 'How to check (2 steps), for every instance');
    });

    test('questions with different steps keep their own', () => {
        const other = {...STEPS, steps: ['Something else.']};
        render([question('heading-order', [occ('#h1', {howToCheck: STEPS}), occ('#h2', {howToCheck: other})])]);
        const body = resultsEl.querySelector('tr.cantTell .src-dialog-body');
        assert.deepEqual(Array.from(body.querySelectorAll('.example-node .node-how-to-check summary')).map((x) => x.textContent),
            ['How to check (2 steps)', 'How to check (1 step)']);
    });
});
