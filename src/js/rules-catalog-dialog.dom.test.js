'use strict';

// DOM tests for the rules catalog dialog (setupRulesCatalogDialog), under
// jsdom, with the catalog served the way /api/engine/rules sends it: what each
// rule shows, that its checkbox is named by the rule, that filtering keeps the
// selection and Apply keeps typed ids the catalog does not list.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let setupRulesCatalogDialog;
let win;

const PAYLOAD = {
    engines: [{id: 'surea11y', name: 'surea11y', version: '1.14.0'}],
    version: '1.14.0',
    rules: [
        {ruleId: 'area-alt-present', title: '<area> must have an accessible name',
            description: 'Checks <area> names.', tags: ['wcag2a', 'images'], wcagSc: ['1.1.1'],
            helpUrl: 'https://example.test/area', defaultSeverity: 'serious'},
        {ruleId: 'accesskeys', title: 'accesskey values must be unique',
            description: 'Checks accesskeys.', tags: ['best-practice'], wcagSc: [], helpUrl: ''}
    ]
};

function flush() {
    return new Promise((r) => setTimeout(r, 0));
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Element = win.Element;
    const proto = win.HTMLDialogElement.prototype;
    proto.showModal = function () { this.setAttribute('open', ''); };
    proto.close = function () {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new win.Event('close'));
    };
    ({setupRulesCatalogDialog} = await import('./rules-catalog-dialog.module.js'));
});

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = async () => ({ok: true, json: async () => PAYLOAD});
});

describe('rules catalog dialog', () => {
    test('names the engine, lists each rule with its WCAG criteria, and names checkboxes by their rule', async () => {
        const rc = setupRulesCatalogDialog();
        await rc.open({select: true, fieldLabel: 'Include rules'});
        const els = rc.elements;

        assert.equal(els.summary.textContent, 'surea11y 1.14.0');
        assert.match(document.querySelector('.axd-title').textContent, /Include rules/);

        const items = els.list.querySelectorAll('.rules-catalog__item');
        assert.equal(items.length, 2);
        // Sorted by id: accesskeys first.
        const [first, second] = items;
        assert.match(second.querySelector('.rules-catalog__facts').textContent, /WCAG1\.1\.1/);

        const cb = first.querySelector('input[type=checkbox]');
        const label = document.querySelector(`label[for="${cb.id}"]`);
        assert.ok(label, 'the checkbox has a label');
        assert.match(label.textContent, /accesskeys/);
        assert.equal(document.getElementById(cb.getAttribute('aria-describedby')).textContent, 'Checks accesskeys.');

        // The documentation link is outside the label, and says where it goes.
        const link = els.list.querySelector('.rules-catalog__link');
        assert.equal(link.closest('label'), null);
        assert.match(link.textContent, /area-alt-present.*new tab/);
    });

    test('filtering keeps the selection, and Apply keeps typed ids the catalog does not list', async () => {
        const rc = setupRulesCatalogDialog();
        let applied = null;
        await rc.open({
            select: true,
            preselectedIds: ['accesskeys', 'wcag-1.4.3-contrast-minimum'],
            onAccept: (ids) => { applied = ids; }
        });
        const els = rc.elements;
        assert.match(els.selectedCount.textContent, /2 selected \(1 not in this catalog/);

        els.filter.value = 'zzzz';
        els.filter.dispatchEvent(new win.Event('input'));
        assert.equal(els.list.children.length, 0);
        assert.equal(els.empty.hidden, false);

        els.filter.value = 'area';
        els.filter.dispatchEvent(new win.Event('input'));
        const cb = els.list.querySelector('input[type=checkbox]');
        cb.checked = true;
        cb.dispatchEvent(new win.Event('change'));

        document.querySelector('.axd-footer-accept').click();
        assert.deepEqual(applied, ['accesskeys', 'wcag-1.4.3-contrast-minimum', 'area-alt-present']);
    });

    test('Escape in a filled filter clears it and leaves the dialog open', async () => {
        const rc = setupRulesCatalogDialog();
        await rc.open({select: true});
        const els = rc.elements;
        els.filter.value = 'area';
        els.filter.dispatchEvent(new win.Event('input'));

        const esc = new win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
        els.filter.dispatchEvent(esc);
        assert.equal(esc.defaultPrevented, true);
        assert.equal(els.filter.value, '');
        assert.equal(els.list.children.length, 2);
    });

    test('says so when the catalog cannot be loaded', async () => {
        globalThis.fetch = async () => ({ok: false, status: 501, json: async () => ({})});
        const rc = setupRulesCatalogDialog();
        await rc.open({select: true, engineId: 'nope'});
        await flush();
        assert.match(rc.elements.count.textContent, /could not be loaded/);
    });
});
