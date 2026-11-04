'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let createStepsPanel;
let readPanelHidden;
let readStepNodes;
let readActionNodes;
before(async () => {
    ({ createStepsPanel, readPanelHidden, readStepNodes, readActionNodes } = await import('./steps-panel.js'));
});

// Lines shaped as the actions builder draws them: a header with the
// numbered title, the step's own fields, and nested lists under containers.
function line(path, type, baseTitle, { fields = {}, children = null, alias = '', disabled = false } = {}) {
    const fieldHtml = Object.entries(fields)
        .map(([name, value]) => `<div class="field" data-field-name="${name}"><input value="${value}"></div>`).join('');
    const nested = children
        ? `<div class="action-arrays-below"><div class="action-array"><div class="actions-subcontainer" data-field-name="actions">${children.join('')}</div></div></div>`
        : '';
    return `<div class="line" data-action-type="${type}" data-base-title="${baseTitle}" data-action-index-path="${path}"`
        + (alias ? ` data-alias="${alias}"` : '') + (disabled ? ' data-explicit-disabled="true"' : '') + `>`
        + `<div class="line-header"><div class="line-title-wrapper"><div class="line-title">${path} - ${alias || baseTitle}</div></div></div>`
        + `<div class="fields">${fieldHtml}</div>${nested}</div>`;
}

function editorHtml() {
    return [
        line('1', 'click', 'Click', { fields: { selector: '#accept-cookies' } }),
        line('2', 'a11yScan', 'A11y scan', { fields: { label: 'Home' } }),
        line('3', 'group', 'Group', {
            alias: 'Product pages',
            children: [
                line('3.1', 'forEachElement', 'Iterate', {
                    fields: { selector: '.product-card' },
                    children: [
                        line('3.1.1', 'if', 'Condition', {
                            children: [
                                line('3.1.1.1', 'click', 'Click', { fields: { selector: '#size-toggle' } }),
                                line('3.1.1.2', 'a11yScan', 'A11y scan', { fields: { label: 'Size picker' } })
                            ]
                        })
                    ]
                })
            ]
        }),
        line('4', 'a11yScan', 'A11y scan', { fields: { label: 'Cart' }, disabled: true })
    ].join('');
}

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); }
    };
}

function setup({ storage = memoryStorage(), rects = null } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <aside id="panel"></aside><div id="editor">${editorHtml()}</div></body></html>`, { url: 'http://127.0.0.1:3000/' });
    const win = dom.window;
    const doc = win.document;
    // action-tree.js tells lines apart with `instanceof Element`.
    global.Element = win.Element;
    const went = [];
    const panel = createStepsPanel({
        host: doc.getElementById('panel'),
        editorEl: doc.getElementById('editor'),
        sectionKey: 'workflow',
        title: 'Workflow steps',
        goToLine: (lineEl, opts) => went.push({ path: lineEl.dataset.actionIndexPath, focus: opts.focus }),
        storage,
        win,
        isLineShown: () => true,
        isEditorShown: () => true,
        rectOf: (lineEl) => (rects ? rects(lineEl.dataset.actionIndexPath) : { top: 0, bottom: 0 })
    });
    const rows = () => Array.from(doc.querySelectorAll('#panel [role="treeitem"]'));
    const rowText = (r) => `${r.querySelector('.steps-panel__num').textContent} ${r.querySelector('.steps-panel__name').firstChild.data}`;
    const chip = (kind) => doc.querySelector(`#panel button[data-kind="${kind}"]`);
    const status = () => doc.querySelector('#panel .steps-panel__status-text').textContent;
    return { win, doc, panel, went, rows, rowText, chip, status, storage };
}

describe('steps panel', () => {
    test('lists every step with its number, its depth and what it is called', () => {
        const { rows, rowText, status } = setup();
        assert.deepEqual(rows().map(rowText), [
            '1 Click', '2 Home', '3 Product pages', '3.1 Iterate', '3.1.1 Condition', '3.1.1.1 Click', '3.1.1.2 Size picker', '4 Cart'
        ]);
        assert.deepEqual(rows().map((r) => r.getAttribute('aria-level')), ['1', '1', '1', '2', '3', '4', '4', '1']);
        assert.equal(rows()[2].getAttribute('aria-expanded'), 'true');
        assert.equal(rows()[0].getAttribute('aria-expanded'), null);
        assert.equal(status(), '8 steps');
    });

    test('says a disabled step is disabled, in words', () => {
        const { rows } = setup();
        const cart = rows()[7];
        assert.ok(cart.classList.contains('is-disabled'));
        assert.match(cart.textContent, /\(disabled\)/);
    });

    test('a step inside a disabled container reads as disabled too', () => {
        const { doc, panel, rows } = setup();
        doc.querySelector('#editor .line[data-action-index-path="3"]').dataset.explicitDisabled = 'true';
        panel.refresh();
        const disabled = rows().filter((r) => r.classList.contains('is-disabled')).map((r) => r.querySelector('.steps-panel__num').textContent);
        assert.deepEqual(disabled, ['3', '3.1', '3.1.1', '3.1.1.1', '3.1.1.2', '4']);
    });

    test('a chip keeps the matches and, dimmed, the containers they are in', () => {
        const { rows, rowText, chip, status } = setup();
        chip('scan').click();
        assert.deepEqual(rows().map(rowText), ['2 Home', '3 Product pages', '3.1 Iterate', '3.1.1 Condition', '3.1.1.2 Size picker', '4 Cart']);
        const context = rows().filter((r) => r.classList.contains('is-context')).map(rowText);
        assert.deepEqual(context, ['3 Product pages', '3.1 Iterate', '3.1.1 Condition']);
        assert.match(rows()[1].textContent, /holds matches/);
        assert.equal(chip('scan').getAttribute('aria-pressed'), 'true');
        assert.equal(status(), '3 matches');
    });

    test('text finds what a step says, its selector included', () => {
        const { doc, win, rows, rowText } = setup();
        const find = doc.querySelector('#panel input[type="search"]');
        find.value = 'size-toggle';
        find.dispatchEvent(new win.Event('input'));
        assert.deepEqual(rows().filter((r) => r.classList.contains('is-match')).map(rowText), ['3.1.1.1 Click']);
    });

    test('says when nothing matches, and clearing the filter lists everything again', () => {
        const { doc, win, rows, status } = setup();
        const find = doc.querySelector('#panel input[type="search"]');
        find.value = 'nothing like this';
        find.dispatchEvent(new win.Event('input'));
        assert.equal(rows().length, 0);
        assert.equal(status(), 'No steps match.');
        doc.querySelector('#panel .steps-panel__clear').click();
        assert.equal(rows().length, 8);
        assert.equal(find.value, '');
    });

    test('clicking a step goes to it, focus included, and marks it current', () => {
        const { rows, went } = setup();
        rows()[6].click();
        assert.deepEqual(went, [{ path: '3.1.1.2', focus: true }]);
        const current = rows().find((r) => r.getAttribute('aria-current') === 'true');
        assert.equal(current.querySelector('.steps-panel__num').textContent, '3.1.1.2');
    });

    test('a chip stays the same button when pressed, so it keeps focus', () => {
        const { doc, chip } = setup();
        const scan = chip('scan');
        scan.focus();
        scan.click();
        assert.equal(chip('scan'), scan);
        assert.equal(doc.activeElement, scan);
        assert.equal(scan.getAttribute('aria-pressed'), 'true');
        assert.equal(chip('all').getAttribute('aria-pressed'), 'false');
    });

    test('going to a step keeps the row that has focus in place', () => {
        const { doc, win, rows } = setup();
        const row = rows()[6];
        row.focus();
        row.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.equal(rows()[6], row);
        assert.equal(row.getAttribute('aria-current'), 'true');
        assert.equal(row.getAttribute('tabindex'), '0');
        assert.equal(rows().filter((r) => r.getAttribute('tabindex') === '0').length, 1);
        assert.ok(doc.contains(row));
    });

    test('reading the editor again keeps focus on the same step', () => {
        const { doc, panel, rows } = setup();
        rows()[4].focus();
        panel.refresh();
        assert.equal(doc.activeElement.dataset.stepId, rows()[4].dataset.stepId);
        assert.notEqual(doc.activeElement, doc.body);
    });

    test('next and previous go through the matches without taking focus', () => {
        const { rows, chip, went, status, doc } = setup();
        chip('scan').click();
        const next = doc.querySelector('#panel button[aria-label="Next match"]');
        const prev = doc.querySelector('#panel button[aria-label="Previous match"]');
        next.click();
        next.click();
        assert.deepEqual(went.map((w) => w.path), ['2', '3.1.1.2']);
        assert.ok(went.every((w) => w.focus === false));
        assert.equal(status(), '3 matches · 2 of 3');
        prev.click();
        prev.click();
        assert.deepEqual(went.map((w) => w.path), ['2', '3.1.1.2', '2', '4']);
        assert.ok(rows().length > 0);
    });

    test('the keyboard moves through the tree and Enter goes to the step', () => {
        const { doc, win, rows, went } = setup();
        const first = rows()[0];
        assert.equal(first.getAttribute('tabindex'), '0');
        first.focus();
        first.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        assert.equal(doc.activeElement.querySelector('.steps-panel__num').textContent, '4');
        doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        assert.equal(doc.activeElement.querySelector('.steps-panel__num').textContent, '3.1.1');
        doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.deepEqual(went, [{ path: '3.1.1', focus: true }]);
        assert.equal(rows().filter((r) => r.getAttribute('tabindex') === '0').length, 1);
    });

    test('hides to a rail, which the browser remembers for the section', () => {
        const storage = memoryStorage();
        const { doc, panel } = setup({ storage });
        doc.querySelector('#panel .steps-panel__hide').click();
        assert.equal(panel.isHidden(), true);
        assert.equal(doc.querySelector('#panel .steps-panel__full').hidden, true);
        assert.equal(doc.querySelector('#panel .steps-panel__rail').hidden, false);
        assert.equal(doc.activeElement, doc.querySelector('#panel .steps-panel__show'));
        assert.equal(readPanelHidden(storage, 'workflow'), true);

        const again = setup({ storage });
        assert.equal(again.panel.isHidden(), true);
        again.doc.querySelector('#panel .steps-panel__show').click();
        assert.equal(readPanelHidden(storage, 'workflow'), false);
    });

    test('works when the browser keeps nothing', () => {
        const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
        const { doc, panel } = setup({ storage: broken });
        assert.equal(panel.isHidden(), false);
        doc.querySelector('#panel .steps-panel__hide').click();
        assert.equal(panel.isHidden(), true);
    });

    test('the rail says how many steps match the filter', () => {
        const { doc, chip } = setup();
        chip('scan').click();
        doc.querySelector('#panel .steps-panel__hide').click();
        const count = doc.querySelector('#panel .steps-panel__rail-count');
        assert.equal(count.hidden, false);
        assert.equal(count.textContent, '3');
    });

    test('highlights the step at the top of the editor as it scrolls', () => {
        // Each step 100px tall, the editor scrolled so 3.1.1.1 spans the reading line.
        const order = ['1', '2', '3', '3.1', '3.1.1', '3.1.1.1', '3.1.1.2', '4'];
        const containers = { 3: '3.1.1.2', 3.1: '3.1.1.2', '3.1.1': '3.1.1.2' };
        // 3.1.1.1 runs from 50px to 150px: it spans the reading line, 120px down.
        const offset = 450;
        const rects = (path) => {
            const top = order.indexOf(path) * 100 - offset;
            const lastChild = containers[path];
            const bottom = lastChild ? order.indexOf(lastChild) * 100 + 100 - offset : top + 100;
            return { top, bottom };
        };
        const { panel, rows } = setup({ rects });
        panel.syncInView();
        const inView = rows().filter((r) => r.classList.contains('is-in-view'));
        assert.equal(inView.length, 1);
        assert.equal(inView[0].querySelector('.steps-panel__num').textContent, '3.1.1.1');
    });

    test('reads the editor again once an edit pauses', async () => {
        const { doc, win, rows, rowText } = setup();
        const label = doc.querySelector('#editor .line[data-action-index-path="2"] .field[data-field-name="label"] input');
        label.value = 'Front page';
        label.dispatchEvent(new win.Event('input', { bubbles: true }));
        assert.equal(rowText(rows()[1]), '2 Home');
        await new Promise((r) => setTimeout(r, 260));
        assert.equal(rowText(rows()[1]), '2 Front page');
    });

    test('steps read from saved data get the keys and numbers the editor gives them', () => {
        const { doc } = setup();
        const fromLines = readStepNodes(doc.getElementById('editor'), (line, key) => key).nodes;
        const saved = [
            { type: 'click', selector: '#accept-cookies' },
            { type: 'a11yScan', label: 'Home' },
            { type: 'group', alias: 'Product pages', actions: [
                { type: 'forEachElement', selector: '.product-card', actions: [
                    { type: 'if', actions: [{ type: 'click', selector: '#size-toggle' }, { type: 'a11yScan', label: 'Size picker' }] }
                ] }
            ] },
            { type: 'a11yScan', label: 'Cart', disabled: true }
        ];
        const fromData = readActionNodes(saved, {
            idOf: (key) => key,
            typeTitleOf: (t) => t,
            nameOf: (a) => a.label || a.alias || '',
            listsOf: (t) => (['group', 'forEachElement', 'if'].includes(t) ? ['actions'] : [])
        });
        assert.deepEqual(fromData.map((n) => n.key), fromLines.map((n) => n.key));
        assert.deepEqual(fromData.map((n) => n.path), fromLines.map((n) => n.path));
        assert.deepEqual(fromData.map((n) => n.disabled), fromLines.map((n) => n.disabled));
        assert.match(fromData[0].searchText, /#accept-cookies/);
    });

    test('going to a step that has no line yet opens it first, then goes to its line', () => {
        const dom = new JSDOM('<!doctype html><body><aside id="p"></aside><div id="ed"></div></body>', { url: 'http://127.0.0.1:3000/' });
        const win = dom.window;
        const doc = win.document;
        global.Element = win.Element;
        let opened = null;
        const went = [];
        const lineOf = doc.createElement('div');
        const head = { id: 'd1', key: '', path: '', depth: 0, parentId: null, root: true, container: true, type: 'customStep', typeTitle: 'Custom step', name: 'Log in', note: 'not used', disabled: false, searchText: 'log in' };
        const step = { id: 'd1/2|', key: '2|', path: '2', depth: 1, parentId: 'd1', container: false, type: 'click', typeTitle: 'Click', name: 'Submit', disabled: false, searchText: 'submit' };
        const panel = createStepsPanel({
            host: doc.getElementById('p'), editorEl: doc.getElementById('ed'), sectionKey: 'custom', title: 'Custom steps',
            storage: null, win, isLineShown: () => true, isEditorShown: () => true, rectOf: () => ({ top: 0, bottom: 0 }),
            read: () => ({ nodes: [head, step], lineById: opened ? new Map([[step.id, lineOf]]) : new Map() }),
            open: (node) => { opened = node.id; },
            goToLine: (line, { node }) => went.push({ line, id: node.id })
        });
        const rows = () => Array.from(doc.querySelectorAll('#p [role="treeitem"]'));
        assert.match(rows()[0].textContent, /not used/);
        assert.equal(doc.querySelector('#p .steps-panel__status-text').textContent, '1 step');
        rows()[1].click();
        assert.equal(opened, 'd1/2|');
        assert.deepEqual(went, [{ line: lineOf, id: 'd1/2|' }]);
        rows()[0].click();
        assert.deepEqual(went[1], { line: null, id: 'd1' });
    });

    test('says how many steps match in the other section, and leads there with the same filter', () => {
        const dom = new JSDOM('<!doctype html><body><aside id="p"></aside><div id="ed"></div></body>', { url: 'http://127.0.0.1:3000/' });
        const win = dom.window;
        const doc = win.document;
        global.Element = win.Element;
        const led = [];
        const panel = createStepsPanel({
            host: doc.getElementById('p'), editorEl: doc.getElementById('ed'), sectionKey: 'w', title: 'Workflow steps',
            storage: null, win, isLineShown: () => true, isEditorShown: () => true, rectOf: () => ({ top: 0, bottom: 0 }),
            read: () => ({ nodes: [], lineById: new Map() }),
            goToLine: () => {},
            elsewhere: { label: 'Custom steps', count: (kind) => (kind === 'scan' ? 3 : 0), go: (kind, query) => led.push([kind, query]) }
        });
        const link = doc.querySelector('#p .steps-panel__elsewhere');
        assert.equal(link.hidden, true);
        panel.setFilter('scan', 'cart');
        assert.equal(link.hidden, false);
        assert.equal(link.textContent, '3 more matches in Custom steps →');
        assert.equal(doc.querySelector('#p input[type="search"]').value, 'cart');
        link.click();
        assert.deepEqual(led, [['scan', 'cart']]);
    });
});
