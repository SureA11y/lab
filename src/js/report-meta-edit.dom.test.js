'use strict';

// DOM tests for the "(modify)" controls on the report metadata line, driven
// under jsdom. The module enhances an already-rendered metadata block: every
// row that names a payload key gets a link-styled button, the field it opens,
// and the two actions that close it again. node's test runner isolates each
// file in its own process.

// The reader's zone is the machine's: pinned, so these cases read the same
// wherever they run (CET, UTC+1, in winter; CEST, UTC+2, in summer).
process.env.TZ = 'Europe/Zurich';

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

let mountReportMetaEditors;
let META_FIELD_ATTR;
let META_VALUE_CLASS;
let container;
let saved;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    // Run the frame callbacks the module defers focus to inline, so a test can
    // assert where the focus landed without waiting a frame.
    globalThis.requestAnimationFrame = (fn) => fn();

    ({
        mountReportMetaEditors,
        META_FIELD_ATTR,
        META_VALUE_CLASS
    } = await import('./report-meta-edit.js'));
});

beforeEach(() => {
    document.body.innerHTML = '<div id="report-data"></div>';
    container = document.getElementById('report-data');
    saved = [];
});

const REPORT = {
    reportName: 'Q3 audit',
    url: 'https://example.com/checkout',
    timestamp: '2026-08-27T12:30:00.000Z'
};

// The metadata line as writeReportData paints it: label, value, nothing live.
// Rows carry the payload key they show; the engine row deliberately does not.
function renderMeta(report = REPORT) {
    const rows = [];

    if (report.reportName) rows.push(row('Report name', report.reportName, 'reportName'));
    else if (report.scenarioName) rows.push(row('Scenario', report.scenarioName, 'scenarioName'));
    if (report.url) rows.push(row('URL', `<a href="${report.url}">${report.url}</a>`, 'url'));
    if (report.timestamp) rows.push(row('Timestamp', 'Thursday, 27 August 2026 at 14:30', 'timestamp'));
    rows.push('<li><strong>Engine:</strong> <span>surea11y 1.4.0</span></li>');

    container.innerHTML = `<ul class="report-meta">${rows.join('')}</ul>`;
}

function row(label, valueHtml, field) {
    return (
        `<li ${META_FIELD_ATTR}="${field}"><strong>${label}:</strong>` +
            `<span class="meta-value"><span class="${META_VALUE_CLASS}">${valueHtml}</span></span>` +
        '</li>'
    );
}

function mount(report = REPORT, overrides = {}) {
    return mountReportMetaEditors(container, {
        read: (field) => report[field],
        onSave: (field, value) => saved.push([field, value]),
        ...overrides
    });
}

const rowFor = (field) => container.querySelector(`[${META_FIELD_ATTR}="${field}"]`);
const editButton = (field) => rowFor(field).querySelector('.report-meta-edit');
const editor = (field) => rowFor(field).querySelector('.report-meta-editor');
const fieldInput = (field) => rowFor(field).querySelector('.report-meta-editor__input');
const saveButton = (field) => rowFor(field).querySelector('.report-meta-editor__save');
const cancelButton = (field) => rowFor(field).querySelector('.report-meta-editor__cancel');
const errorText = (field) => rowFor(field).querySelector('.report-meta-editor__error').textContent;
const valueText = (field) => rowFor(field).querySelector(`.${META_VALUE_CLASS}`);

describe('mounting', () => {
    test('gives every editable row a control, closed', () => {
        renderMeta();
        mount();

        for (const field of ['reportName', 'url', 'timestamp']) {
            assert.ok(editButton(field), `${field} has no control`);
            assert.equal(editButton(field).getAttribute('aria-expanded'), 'false');
            assert.equal(editor(field).hidden, true);
        }
    });

    test('leaves rows that name no field alone', () => {
        renderMeta();
        mount();

        // What ran is the one thing on the line the report cannot be talked
        // out of, so the engine row carries no key and gets no control.
        const engineRow = [...container.querySelectorAll('li')]
            .find((li) => li.textContent.startsWith('Engine:'));

        assert.equal(engineRow.querySelector('.report-meta-edit'), null);
        assert.equal(container.querySelectorAll('.report-meta-edit').length, 3);
    });

    test('ignores a row naming something that is not editable', () => {
        container.innerHTML =
            `<ul class="report-meta"><li ${META_FIELD_ATTR}="metrics"><strong>Metrics:</strong>` +
            `<span class="meta-value"><span class="${META_VALUE_CLASS}">42</span></span></li></ul>`;

        mount();

        assert.equal(container.querySelector('.report-meta-edit'), null);
    });

    test('builds each field as the kind of value it holds', () => {
        renderMeta();
        mount();

        assert.equal(fieldInput('reportName').type, 'text');
        assert.equal(fieldInput('url').type, 'url');
        assert.equal(fieldInput('timestamp').type, 'datetime-local');
    });

    test('keeps the visible label inside each accessible name', () => {
        renderMeta();
        mount();

        // WCAG 2.5.3: what a speech user says has to be what they can see, so
        // the wording that says which row this is gets appended in hidden text
        // rather than replacing the label through aria-label.
        const names = {
            reportName: '(modify) the report name',
            url: '(modify) the report URL',
            timestamp: '(modify) the report date and time'
        };

        for (const [field, name] of Object.entries(names)) {
            assert.equal(editButton(field).textContent, name);
            assert.equal(editButton(field).firstChild.textContent, '(modify)');
            assert.equal(editButton(field).hasAttribute('aria-label'), false);
        }
    });

    test('labels each field and wires it to its message', () => {
        renderMeta();
        mount();

        const label = editor('url').querySelector('label');
        assert.equal(label.getAttribute('for'), fieldInput('url').id);
        assert.equal(label.textContent, 'URL');

        const error = rowFor('url').querySelector('.report-meta-editor__error');
        assert.equal(error.getAttribute('role'), 'alert');
        assert.equal(fieldInput('url').getAttribute('aria-describedby'), error.id);
    });

    test('names the zone on the one field whose value depends on it', () => {
        renderMeta();
        mount();

        const hint = rowFor('timestamp').querySelector('.report-meta-editor__hint');
        assert.equal(hint.textContent, 'Europe/Zurich time');
        assert.deepEqual(
            fieldInput('timestamp').getAttribute('aria-describedby').split(/\s+/),
            [hint.id, rowFor('timestamp').querySelector('.report-meta-editor__error').id]
        );

        assert.equal(rowFor('url').querySelector('.report-meta-editor__hint'), null);
    });

    test('gives each mount its own ids, so a repaint leaves no duplicates', () => {
        renderMeta();
        mount();
        const first = fieldInput('url').id;

        renderMeta();
        mount();

        assert.notEqual(fieldInput('url').id, first);
        assert.equal(container.querySelectorAll('.report-meta-editor__input').length, 3);
    });

    test('does nothing when the line has no editable row at all', () => {
        container.innerHTML = '<ul class="report-meta"><li><strong>Engine:</strong> surea11y</li></ul>';

        const api = mount();

        assert.equal(container.querySelector('.report-meta-edit'), null);
        // Still safe to ask it for focus.
        api.focusEditButton('url');
    });
});

describe('opening', () => {
    test('swaps the value for the field, seeded from the value as it stands', () => {
        renderMeta();
        mount();

        editButton('url').click();

        assert.equal(fieldInput('url').value, 'https://example.com/checkout');
        assert.equal(editor('url').hidden, false);
        assert.equal(editButton('url').hidden, true);
        assert.equal(valueText('url').hidden, true);
        assert.equal(document.activeElement, fieldInput('url'));
    });

    test('seeds the date field with the zone wall-clock time', () => {
        renderMeta();
        mount();

        editButton('timestamp').click();

        assert.equal(fieldInput('timestamp').value, '2026-08-27T14:30');
    });

    test('reads the value at open time, not at mount time', () => {
        renderMeta();
        const report = {...REPORT};
        mount(report);

        report.reportName = 'Renamed elsewhere';
        editButton('reportName').click();

        assert.equal(fieldInput('reportName').value, 'Renamed elsewhere');
    });

    test('leaves the other rows as they were', () => {
        renderMeta();
        mount();

        editButton('url').click();

        assert.equal(editor('timestamp').hidden, true);
        assert.equal(valueText('timestamp').hidden, false);
    });
});

describe('saving', () => {
    test('hands the host the field and what it parsed', () => {
        renderMeta();
        mount();

        editButton('reportName').click();
        fieldInput('reportName').value = '  Q4 audit  ';
        saveButton('reportName').click();

        assert.deepEqual(saved, [['reportName', 'Q4 audit']]);
        assert.equal(editor('reportName').hidden, true);
        assert.equal(editButton('reportName').getAttribute('aria-expanded'), 'false');
    });

    test('hands over a URL settled into the spelling that was checked', () => {
        renderMeta();
        mount();

        editButton('url').click();
        fieldInput('url').value = 'https://EXAMPLE.com/checkout';
        saveButton('url').click();

        assert.deepEqual(saved, [['url', 'https://example.com/checkout']]);
    });

    test('hands over the instant a typed wall-clock time stands for', () => {
        renderMeta();
        mount();

        editButton('timestamp').click();
        fieldInput('timestamp').value = '2026-03-04T09:45';
        saveButton('timestamp').click();

        assert.deepEqual(saved, [['timestamp', '2026-03-04T08:45:00.000Z']]);
    });

    test('Enter in the field saves too', () => {
        renderMeta();
        mount();

        editButton('reportName').click();
        fieldInput('reportName').value = 'Q4 audit';
        fieldInput('reportName').dispatchEvent(
            new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true})
        );

        assert.deepEqual(saved, [['reportName', 'Q4 audit']]);
    });

    test('returns focus to the control the edit started from', () => {
        renderMeta();
        mount();

        editButton('url').click();
        fieldInput('url').value = 'https://example.com/basket';
        saveButton('url').click();

        assert.equal(document.activeElement, editButton('url'));
    });

    test('leaves focus to the replacement when the host repaints the line', () => {
        renderMeta();
        // What the app does on save: store the value, paint the line again,
        // mount fresh editors onto it and focus the button for that field. The
        // editor that was saved from is gone by then and must not fight for it.
        const report = {...REPORT};
        mount(report, {
            onSave: (field, value) => {
                report[field] = value;
                renderMeta(report);
                mount(report).focusEditButton(field);
            }
        });

        const original = editButton('url');
        original.click();
        fieldInput('url').value = 'https://example.com/basket';
        saveButton('url').click();

        assert.notEqual(editButton('url'), original);
        assert.equal(document.activeElement, editButton('url'));
    });

    test('refuses a value the field cannot take, and says why', () => {
        renderMeta();
        mount();

        editButton('url').click();
        fieldInput('url').value = 'javascript:alert(1)';
        saveButton('url').click();

        assert.deepEqual(saved, []);
        assert.equal(editor('url').hidden, false, 'the editor stays open on a value it refused');
        assert.match(errorText('url'), /starts with http:\/\/ or https:\/\//);
        assert.equal(fieldInput('url').getAttribute('aria-invalid'), 'true');
        assert.equal(document.activeElement, fieldInput('url'));
    });

    test('refuses an empty value, which would take the control with it', () => {
        renderMeta();
        mount();

        for (const field of ['reportName', 'url', 'timestamp']) {
            editButton(field).click();
            fieldInput(field).value = '';
            saveButton(field).click();

            assert.deepEqual(saved, [], `${field} accepted an empty value`);
            assert.equal(editor(field).hidden, false);
            assert.ok(errorText(field), `${field} refused a value without saying so`);

            cancelButton(field).click();
        }
    });

    test('drops the complaint as soon as the value is being fixed', () => {
        renderMeta();
        mount();

        editButton('reportName').click();
        fieldInput('reportName').value = '';
        saveButton('reportName').click();
        fieldInput('reportName').value = 'Q4 audit';
        fieldInput('reportName').dispatchEvent(new window.Event('input', {bubbles: true}));

        assert.equal(errorText('reportName'), '');
        assert.equal(fieldInput('reportName').hasAttribute('aria-invalid'), false);
    });
});

describe('cancelling', () => {
    test('closes without telling the host anything', () => {
        renderMeta();
        mount();

        editButton('timestamp').click();
        fieldInput('timestamp').value = '2030-01-01T00:00';
        cancelButton('timestamp').click();

        assert.deepEqual(saved, []);
        assert.equal(editor('timestamp').hidden, true);
        assert.equal(valueText('timestamp').hidden, false);
        assert.equal(document.activeElement, editButton('timestamp'));
    });

    test('Escape in the field cancels', () => {
        renderMeta();
        mount();

        editButton('reportName').click();
        fieldInput('reportName').value = 'Something else';
        fieldInput('reportName').dispatchEvent(
            new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
        );

        assert.deepEqual(saved, []);
        assert.equal(editor('reportName').hidden, true);
        assert.equal(document.activeElement, editButton('reportName'));
    });
});

describe('the exported report', () => {
    // The list of selectors getReportContent strips from its clone of the
    // results container: anything mounted here travels unless it is named.
    function removedSelectors() {
        const source = fs.readFileSync(path.join(__dirname, 'export.js'), 'utf8');
        const list = source.slice(
            source.indexOf('const removeSelectors = ['),
            source.indexOf('];', source.indexOf('const removeSelectors = ['))
        );

        return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }

    test('drops every part of every editor', () => {
        renderMeta();
        mount();

        const removed = removedSelectors();

        for (const selector of ['.report-meta-edit', '.report-meta-editor']) {
            assert.ok(container.querySelector(selector), `expected the editors to mount ${selector}`);
            assert.ok(
                removed.includes(selector),
                `${selector} is mounted onto the report metadata but export.js does not strip it`
            );
        }

        // Everything an editor builds sits inside one of those two, so nothing
        // is left behind once they go.
        for (const el of container.querySelectorAll('[class*="report-meta-editor__"]')) {
            assert.ok(el.closest('.report-meta-editor'), `${el.className} would survive the export`);
        }
    });

    test('keeps the values themselves', () => {
        assert.equal(
            removedSelectors().includes(`.${META_VALUE_CLASS}`),
            false,
            'the values the line states must survive into the exported document'
        );
    });

    test('reads the report name off the line without the editor coming with it', async () => {
        // The exported file name and title are taken from the rendered line, so
        // a control mounted into the name row must not end up in either.
        const {reportNameFromMeta} = await import('./export.js');

        renderMeta({...REPORT, reportName: 'Q3 audit'});
        mount();

        assert.equal(reportNameFromMeta(container), 'Q3 audit');
    });

    test('reads no name from a report that only has a scenario', async () => {
        const {reportNameFromMeta} = await import('./export.js');

        renderMeta({scenarioName: 'Checkout', url: REPORT.url, timestamp: REPORT.timestamp});
        mount();

        assert.equal(reportNameFromMeta(container), '');
    });
});
