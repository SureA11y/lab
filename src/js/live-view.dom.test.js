'use strict';

// DOM tests for one live view (createLiveView), under jsdom: progress entries
// fill its own log, totals and cards; two views never share state; destroy
// takes its pieces away. The carousel needs ResizeObserver, stubbed here.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let createLiveView;
let resolveLabelTemplate;
let utils;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.Element = win.Element;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.MutationObserver = win.MutationObserver;
    globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win);
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    win.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    ({createLiveView, resolveLabelTemplate} = await import('./live-view.js'));
    utils = await import('./a11y-ui.utils.js');
});

beforeEach(() => {
    document.body.innerHTML = '';
});

const frame = () => new Promise((r) => setTimeout(r, 50));

function view(idPrefix = 'v') {
    const root = document.createElement('div');
    root.innerHTML = '<div class="t"></div><div class="s" style="display:none"><div class="g"></div></div><div class="l"></div>';
    document.body.append(root);
    const v = createLiveView({
        totalsMount: root.querySelector('.t'),
        streamEl: root.querySelector('.s'),
        gridEl: root.querySelector('.g'),
        logEl: root.querySelector('.l'),
        idPrefix,
        helpers: {
            escapeHtml: utils.escapeHtml,
            escapeAttr: utils.escapeAttr,
            linkifyUrlsToHtml: utils.linkifyUrlsToHtml,
            indentPrefix: utils.indentPrefix,
            parseForEachIteration: utils.parseForEachIteration,
            parseRepeatIteration: utils.parseRepeatIteration,
        },
    });
    return {v, root};
}

const scan = (label, failCount, vars) => ({
    type: 'scan',
    message: 'a11yScan ready',
    extra: {label, url: 'https://example.com/', summary: {failCount, reviewCount: 1, passesCount: 10}, meta: {estimatedNodes: 100}, vars},
});

describe('live view', () => {
    test('a scan fills its log, its totals and a card', async () => {
        const {v, root} = view();
        v.start({actions: [{type: 'a11yScan'}]});
        v.processMany([{type: 'info', message: 'Opening https://example.com/'}, scan('Home', 3)]);
        await frame();
        const logs = root.querySelectorAll('.l .log-panel-entry');
        assert.equal(logs.length, 2);
        assert.match(logs[0].innerHTML, /<a href="https:\/\/example.com\/"/);
        const totals = root.querySelector('.t .live-totals--inline');
        assert.ok(totals, 'inline totals in their mount');
        assert.match(totals.querySelector('.live-totals-fail .live-totals-value').textContent, /^3$/);
        assert.equal(root.querySelectorAll('.stream-card').length, 1);
        assert.equal(root.querySelector('.s').style.display, 'block');
    });

    test('streams without a workflow too: there is just no step plan', async () => {
        const {v, root} = view();
        v.start({actions: []});
        v.processMany([scan('Home', 1)]);
        await frame();
        assert.equal(root.querySelectorAll('.stream-card').length, 1);
    });

    test('two views keep their own totals and variables', async () => {
        const a = view('a');
        const b = view('b');
        a.v.processMany([scan('A', 5, {lang: 'en'})]);
        b.v.processMany([scan('B', 1, {lang: 'fr'})]);
        await frame();
        assert.equal(a.root.querySelector('.live-totals-fail .live-totals-value').textContent, '5');
        assert.equal(b.root.querySelector('.live-totals-fail .live-totals-value').textContent, '1');
        assert.ok(document.getElementById('a-totals') && document.getElementById('b-totals'));
        // The run tab's resolver does not see a view's variables.
        assert.equal(resolveLabelTemplate('{var:lang}', null, undefined), '');
    });

    test('destroy removes its totals and its lightbox', async () => {
        const {v, root} = view();
        v.processMany([scan('Home', 1)]);
        const dialogs = document.querySelectorAll('dialog').length;
        v.destroy();
        assert.equal(root.querySelector('.live-totals'), null);
        assert.equal(document.querySelectorAll('dialog').length, dialogs - 1);
    });
});
