'use strict';

// The top-level mode tabs (src/js/tabs-ui.js).

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let T;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.CustomEvent = dom.window.CustomEvent;
    T = await import('./tabs-ui.js');
});

beforeEach(() => {
    document.body.innerHTML = `
        <button id="mode-run"></button><button id="mode-open"></button>
        <div id="pane-run"></div><div id="pane-open"></div>`;
});

function listen() {
    const seen = [];
    const onChange = (e) => seen.push({
        ...e.detail,
        selected: document.querySelector('[aria-selected="true"]')?.id,
        reportPaneHidden: document.getElementById('pane-open').hidden,
    });
    document.addEventListener('a11ylab:modechange', onChange);
    return {seen, stop: () => document.removeEventListener('a11ylab:modechange', onChange)};
}

describe('mode tabs', () => {
    test('the pressed tab and its pane are already shown when the listeners run', () => {
        T.setupModeSwitch({initialMode: 'run'});
        const {seen, stop} = listen();
        document.getElementById('mode-open').click();
        stop();
        assert.equal(seen.length, 1);
        assert.equal(seen[0].mode, 'report');
        assert.equal(seen[0].selected, 'mode-open');
        assert.equal(seen[0].reportPaneHidden, false);
    });

    test('a click says so; a change made from code does not', () => {
        const tabs = T.setupModeSwitch({initialMode: 'run'});
        const {seen, stop} = listen();
        document.getElementById('mode-open').click();
        tabs.setActive('run');
        stop();
        assert.deepEqual(seen.map((s) => s.fromClick), [true, false]);
    });
});
