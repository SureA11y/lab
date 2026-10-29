'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let installBackToTop;
before(async () => {
    ({ installBackToTop } = await import('./back-to-top.js'));
});

function page() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <header><h1>Lab</h1></header>
        <div class="mode-bar">
            <div role="tablist"><button role="tab" id="a" aria-selected="false">a</button><button role="tab" id="b" aria-selected="true">b</button></div>
            <button type="button" id="back-to-top">Back to top</button>
        </div></body></html>`, { url: 'http://127.0.0.1:3000/src/' });
    const win = dom.window;
    const doc = win.document;
    const scrolls = [];
    win.scrollTo = (opts) => scrolls.push(opts);
    let observe;
    win.IntersectionObserver = class {
        constructor(cb) { observe = cb; }
        observe() {}
    };
    const bar = doc.querySelector('.mode-bar');
    const button = doc.getElementById('back-to-top');
    installBackToTop({ bar, button, header: doc.querySelector('header'), doc });
    return { doc, bar, button, scrolls, headerVisible: (v) => observe([{ isIntersecting: v }]) };
}

describe('back to top', () => {
    test('stays hidden and out of reach while the header is in view', () => {
        const { bar, button, headerVisible } = page();
        assert.equal(button.classList.contains('is-shown'), false);
        assert.equal(button.inert, true);
        headerVisible(true);
        assert.equal(bar.classList.contains('is-stuck'), false);
    });

    test('shows, and the bar is marked stuck, once the header scrolls away', () => {
        const { bar, button, headerVisible } = page();
        headerVisible(false);
        assert.equal(button.classList.contains('is-shown'), true);
        assert.equal(button.inert, false);
        assert.equal(bar.classList.contains('is-stuck'), true);
    });

    test('scrolls to the top and puts focus on the selected tab', () => {
        const { doc, button, scrolls, headerVisible } = page();
        headerVisible(false);
        button.click();
        assert.equal(scrolls.length, 1);
        assert.equal(scrolls[0].top, 0);
        assert.equal(doc.activeElement.id, 'b');
    });
});
