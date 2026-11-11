'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

let M;
before(async () => {
    M = await import(pathToFileURL(path.join(__dirname, 'run-settings.js')).href);
});

const defaults = {
    'viewport-preset': { value: 'default', text: 'Default (1280 × 720)' },
    'run-color-scheme': { value: '', text: 'Browser default' },
    'run-high-contrast': { value: 'off', text: 'Off' },
    'run-language': { value: '', text: 'Browser default' },
    'run-language-other': { value: '', text: '' },
    'run-untrusted-certs': { value: 'off', text: 'Refuse untrusted' },
};

describe('the run settings, as their chips say them', () => {
    test('every one at its default, in the dialog\'s own words, and marked as such', () => {
        const summary = M.runSettingsSummary(defaults);
        assert.deepEqual(summary.map((s) => `${s.name}: ${s.label}`),
            ['Viewport: Default (1280 × 720)', 'Colors: Browser default', 'High contrast: Off', 'Language: Browser default', 'Certificates: Refuse untrusted']);
        assert.ok(summary.every((s) => !s.changed && !s.warn));
    });

    test('the changed ones marked, accepting untrusted certificates as a warning', () => {
        const summary = M.runSettingsSummary({
            ...defaults,
            'run-untrusted-certs': { value: 'on', text: 'Accept untrusted' },
            'viewport-preset': { value: 'mobile', text: 'Mobile (375 × 812)' },
            'run-color-scheme': { value: 'dark', text: 'Dark' },
            'run-high-contrast': { value: 'on', text: 'On' },
            'run-language': { value: 'es-ES', text: 'Spanish (Spain)' },
        });
        assert.deepEqual(summary.map((s) => s.label),
            ['Mobile (375 × 812)', 'Dark', 'On', 'Spanish (Spain)', 'Accept untrusted']);
        assert.ok(summary.every((s) => s.changed));
        assert.deepEqual(summary.filter((s) => s.warn).map((s) => s.id), ['run-untrusted-certs']);
    });

    test('a language typed with "Other…" is named as typed, and says so until one is', () => {
        const other = (typed) => M.runSettingsSummary({ ...defaults, 'run-language': { value: 'other', text: 'Other…' }, 'run-language-other': { value: typed } })[3];
        assert.equal(other(' {var:lang} ').label, '{var:lang}');
        assert.equal(other('').label, 'Other, not typed yet');
        assert.equal(other('').changed, true);
    });
});

describe('the chips', () => {
    test('a button each, "Name: value", the changed and the warning marked, nothing unescaped', () => {
        const doc = new JSDOM(`<div>${M.runSettingsChipsHtml([
            { id: 'run-color-scheme', name: 'Colors', label: 'Browser default', changed: false, warn: false },
            { id: 'run-untrusted-certs', name: 'Certificates', label: 'Accept untrusted', changed: true, warn: true },
            { id: 'run-language', name: 'Language', label: '<b>x</b>', changed: true, warn: false },
        ])}</div>`).window.document;
        const chips = [...doc.querySelectorAll('button.run-setting-chip')];
        assert.deepEqual(chips.map((c) => c.textContent), ['Colors: Browser default', 'Certificates: Accept untrusted', 'Language: <b>x</b>']);
        assert.equal(chips[0].dataset.field, 'run-color-scheme');
        assert.ok(!chips[0].classList.contains('is-changed'));
        assert.ok(chips[1].classList.contains('is-changed') && chips[1].classList.contains('is-warn'));
        assert.equal(doc.querySelector('b'), null);
    });
});
