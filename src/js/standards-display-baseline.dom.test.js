'use strict';

// How reports show WCAG, EN 301 549 and RGAA beside each other, recorded
// before the standards a report shows came from its findings' mappings
// rather than from code naming EN 301 549 and RGAA, and held to since: each
// finding's pills, the report's criteria table (readConformance), and the
// comparison of two reports and of a series. The reports are a page of the
// demo shop scanned under WCAG 2.2 AA and under EN 301 549 V4.1.1, and an
// older report carrying RGAA criteria (src/js/fixtures/standards-*.json).
// A difference is a change in what a user sees: a bug unless it is meant,
// never a reason to record again. Recording writes only where no record is:
//   A11Y_RECORD_BASELINE=1 node --test src/js/standards-display-baseline.dom.test.js

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { readConformance } = require('../shared/report-conformance.js');
const { diffReports } = require('../shared/report-diff.js');
const { diffReportSeries } = require('../shared/report-multi-diff.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const RECORD = path.join(FIXTURES, 'standards-display-baseline.json');
const REPORTS = ['wcag', 'en301549', 'rgaa-legacy'];
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `standards-${name}.report.json`), 'utf8'));

let createRenderer;
let fillLazyDialogs;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.CSS = win.CSS;
    globalThis.requestAnimationFrame = (fn) => win.setTimeout(fn, 0);
    ({ createRenderer } = await import('./a11y-ui.rendering.js'));
    ({ fillLazyDialogs } = await import('./lazy-dialogs.js'));
});

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The pills of each row of each scan, in order: "rule: WCAG 1.1.1 | EN 301 549 9.1.1.1".
function pills(report) {
    document.body.innerHTML = '<div id="results"></div><div id="shots"></div>';
    const resultsEl = document.getElementById('results');
    createRenderer({
        resultsEl,
        screenshotsEl: document.getElementById('shots'),
        escapeAttr: escape,
        escapeHtml: escape,
        jsonToBrowserLink: () => '',
        buildScreenshotElements: () => [],
        imgToBtn: () => document.createElement('img'),
        dialogs: { screenshotsDialog: { openById() {} } },
    }).renderAllScans(report.scans);
    fillLazyDialogs(resultsEl);
    const out = [];
    for (const row of resultsEl.querySelectorAll('tr')) {
        const tags = [...row.querySelectorAll('.tag-pill')].map((el) => el.textContent.trim());
        if (tags.length) out.push(tags.join(' | '));
    }
    return out;
}

// When a diff was made is the clock's, not the reports'.
const undated = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'generatedAt' ? undefined : x)));

function current() {
    const reports = Object.fromEntries(REPORTS.map((name) => [name, load(name)]));
    return undated({
        pills: Object.fromEntries(REPORTS.map((name) => [name, pills(reports[name])])),
        conformance: Object.fromEntries(REPORTS.map((name) => [name, readConformance(reports[name])])),
        diff: {
            'wcag-en301549': diffReports(reports.wcag, reports.en301549),
            'wcag-rgaa': diffReports(reports.wcag, reports['rgaa-legacy']),
        },
        series: diffReportSeries([reports.wcag, reports.en301549, reports['rgaa-legacy']]),
    });
}

test('reports show WCAG, EN 301 549 and RGAA as they did when recorded', (t) => {
    const now = current();
    if (!fs.existsSync(RECORD)) {
        if (!process.env.A11Y_RECORD_BASELINE) return t.skip('no record yet');
        fs.writeFileSync(RECORD, JSON.stringify(now, null, 1) + '\n');
        return;
    }
    const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    for (const part of ['pills', 'conformance', 'diff', 'series']) assert.deepEqual(now[part], record[part], part);
});

test('a finding of a standard from a pack has a pill per requirement, named by its standard', () => {
    const shown = pills(load('sample'));
    assert.ok(shown.length > 0, 'its rows have pills');
    assert.ok(shown.some((row) => /(^| \| )Sample Standard 1( \||$)/.test(row)), shown.join('\n'));
    assert.ok(shown.every((row) => !/\(1\.0\)/.test(row)), 'one version: not repeated on each pill');
    const twoVersions = load('sample');
    const f = twoVersions.scans[0].canonical.findings[0];
    f.standards.normativeMappings = [...f.standards.normativeMappings, { ...f.standards.normativeMappings[0], version: '2.0' }];
    assert.ok(pills(twoVersions).some((row) => row.includes('Sample Standard 1 (1.0) | Sample Standard 1 (2.0)')));
});

test('a finding lists its criteria under each standard\'s name once, the pills holding only the numbers', () => {
    pills(load('en301549'));
    const cells = [...document.querySelectorAll('#results td[data-label="Criteria"]')].filter((td) => td.querySelector('.crit-group'));
    assert.ok(cells.length > 0, 'rows have grouped criteria');
    for (const td of cells) {
        const names = [...td.querySelectorAll('.crit-group__name')].map((el) => el.textContent);
        assert.equal(new Set(names).size, names.length, `each standard once: ${names.join(', ')}`);
        for (const group of td.querySelectorAll('.crit-group')) {
            const name = group.querySelector('.crit-group__name');
            assert.equal(name.getAttribute('aria-hidden'), 'true', 'the name over the group is not read twice');
            for (const pill of group.querySelectorAll('.tag-pill')) {
                const hidden = pill.querySelector('.visually-hidden');
                assert.equal(hidden && hidden.textContent, name.textContent + ' ', 'a screen reader still hears the standard');
                assert.ok(!pill.lastChild.textContent.startsWith(name.textContent), 'the visible text is only the number');
            }
        }
    }
});
