'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let installGuideBar;
before(async () => {
    ({ installGuideBar } = await import('./guide-bar.js'));
});

function page() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div class="guide-bar" id="guide-bar" inert>
            <a class="guide-bar-brand" href="/">surea11y scanner<span>: back to the scanner</span></a>
            <span data-guide-bar="status" aria-hidden="true"></span>
            <button type="button" data-guide-bar="contents" aria-expanded="false" aria-controls="guide-bar-toc">Contents</button>
            <nav id="guide-bar-toc" aria-label="Contents" hidden><div data-guide-bar="toc"></div></nav>
            <button type="button" data-guide-bar="expand">Expand all</button>
            <button type="button" data-guide-bar="collapse">Collapse all</button>
            <button type="button" data-guide-bar="top" aria-label="Back to top"></button>
        </div>
        <input type="search" id="guide-search">
        <div class="guide-results-bar"><p id="guide-status" role="status">WCAG 2.2, Level A and AA: 55 criteria, 78 checks.</p>
            <button id="guide-expand">Expand all</button><button id="guide-collapse">Collapse all</button></div>
        <div id="guide-toc-list"><ul><li><a href="#grp-1" data-toc="grp-1" aria-current="location">1 Perceivable</a></li><li><a href="#grp-2" data-toc="grp-2">2 Operable</a></li></ul></div>
        <p id="outside">The guide</p>
        </body></html>`, { url: 'http://127.0.0.1:3000/src/guide.html' });
    const win = dom.window;
    const doc = win.document;
    const scrolls = [];
    win.scrollTo = (opts) => scrolls.push(opts);
    win.requestAnimationFrame = (f) => f();
    const anchor = doc.querySelector('.guide-results-bar');
    let bottom = 400;
    anchor.getBoundingClientRect = () => ({ bottom });
    const presses = [];
    doc.getElementById('guide-expand').addEventListener('click', () => presses.push('expand'));
    doc.getElementById('guide-collapse').addEventListener('click', () => presses.push('collapse'));
    const bar = doc.getElementById('guide-bar');
    installGuideBar({
        doc,
        bar,
        anchor,
        status: doc.getElementById('guide-status'),
        expand: doc.getElementById('guide-expand'),
        collapse: doc.getElementById('guide-collapse'),
        search: doc.getElementById('guide-search'),
        tocList: doc.getElementById('guide-toc-list'),
    });
    const scrollTo = (b) => {
        bottom = b;
        win.dispatchEvent(new win.Event('scroll'));
    };
    const q = (sel) => bar.querySelector(sel);
    return { win, doc, bar, q, scrolls, presses, scrollTo };
}

describe('the testing guide\'s bar', () => {
    test('stays hidden and out of reach while the filters are in view', () => {
        const { doc, bar } = page();
        assert.equal(bar.classList.contains('is-shown'), false);
        assert.equal(bar.inert, true);
        assert.equal(doc.documentElement.classList.contains('guide-bar-on'), false);
    });

    test('shows once the results line is above it, and hides again when it comes back', () => {
        const { doc, bar, scrollTo } = page();
        scrollTo(-10);
        assert.equal(bar.classList.contains('is-shown'), true);
        assert.equal(bar.inert, false);
        assert.equal(doc.documentElement.classList.contains('guide-bar-on'), true);
        scrollTo(300);
        assert.equal(bar.classList.contains('is-shown'), false);
        assert.equal(bar.inert, true);
    });

    test('says what is shown, as the page\'s status does, and follows it', async () => {
        const { doc, q } = page();
        assert.equal(q('[data-guide-bar="status"]').textContent, 'WCAG 2.2, Level A and AA: 55 criteria, 78 checks');
        doc.getElementById('guide-status').textContent = 'WCAG 2.2, Level A and AA: 12 of 55 criteria shown, 20 checks.';
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(q('[data-guide-bar="status"]').textContent, 'WCAG 2.2, Level A and AA: 12 of 55 criteria shown, 20 checks');
    });

    test('its logo links back to the scanner', () => {
        const { q } = page();
        assert.equal(q('.guide-bar-brand').getAttribute('href'), '/');
    });

    test('Expand all and Collapse all do what the page\'s own do', () => {
        const { q, presses, scrollTo } = page();
        scrollTo(-10);
        q('[data-guide-bar="expand"]').click();
        q('[data-guide-bar="collapse"]').click();
        assert.deepEqual(presses, ['expand', 'collapse']);
    });

    test('Back to top scrolls to the top and puts focus on the search', () => {
        const { doc, q, scrolls, scrollTo } = page();
        scrollTo(-10);
        q('[data-guide-bar="top"]').click();
        assert.equal(scrolls.length, 1);
        assert.equal(scrolls[0].top, 0);
        assert.equal(doc.activeElement.id, 'guide-search');
    });

    test('Contents opens the guide\'s contents as they are, and closes on a link, Escape or a click outside', () => {
        const { win, doc, q, scrollTo } = page();
        scrollTo(-10);
        const button = q('[data-guide-bar="contents"]');
        const panel = doc.getElementById('guide-bar-toc');
        button.click();
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        assert.equal(panel.hidden, false);
        assert.deepEqual([...panel.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.getAttribute('aria-current')]),
            [['#grp-1', 'location'], ['#grp-2', null]]);

        panel.querySelector('a[href="#grp-2"]').click();
        assert.equal(button.getAttribute('aria-expanded'), 'false');
        assert.equal(panel.hidden, true);

        button.click();
        panel.querySelector('a').focus();
        panel.querySelector('a').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(panel.hidden, true);
        assert.equal(doc.activeElement, button, 'focus goes back to Contents');

        button.click();
        doc.getElementById('outside').click();
        assert.equal(panel.hidden, true);
    });

    test('the contents close when the bar hides', () => {
        const { doc, q, scrollTo } = page();
        scrollTo(-10);
        q('[data-guide-bar="contents"]').click();
        scrollTo(300);
        assert.equal(doc.getElementById('guide-bar-toc').hidden, true);
        assert.equal(q('[data-guide-bar="contents"]').getAttribute('aria-expanded'), 'false');
    });
});
