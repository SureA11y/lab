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
            <button type="button" data-guide-bar="contents" aria-expanded="false" aria-controls="guide-bar-toc">Contents</button>
            <button type="button" data-guide-bar="filters" aria-expanded="false" aria-controls="guide-bar-filters-panel" hidden>
                <span>Filters:</span> <span data-guide-bar="summary"></span></button>
            <button type="button" data-guide-bar="expand">Expand all</button>
            <button type="button" data-guide-bar="collapse">Collapse all</button>
            <button type="button" data-guide-bar="top" aria-label="Back to top"></button>
            <div id="guide-bar-filters-panel" hidden></div>
            <nav id="guide-bar-toc" aria-label="Contents" hidden>
                <button type="button" data-guide-bar="expand">Expand all</button>
                <button type="button" data-guide-bar="collapse">Collapse all</button>
                <div data-guide-bar="toc"></div>
            </nav>
        </div>
        <main>
            <div class="guide-hero"><h1>Testing guide</h1></div>
            <form id="guide-filters"><select id="guide-standard"><option>WCAG</option></select>
                <input type="search" id="guide-search"></form>
            <div class="guide-results-bar"><p id="guide-status" role="status">WCAG 2.2, Level A and AA: 55 criteria, 78 checks.</p>
                <button id="guide-expand">Expand all</button><button id="guide-collapse">Collapse all</button></div>
            <div id="guide-toc-list"><ul><li><a href="#grp-1" data-toc="grp-1" aria-current="location">1 Perceivable</a></li><li><a href="#grp-2" data-toc="grp-2">2 Operable</a></li></ul></div>
            <p id="outside">The guide</p>
        </main>
        </body></html>`, { url: 'http://127.0.0.1:3000/src/guide.html' });
    const win = dom.window;
    const doc = win.document;
    const scrolls = [];
    win.scrollTo = (opts) => scrolls.push(opts);
    win.requestAnimationFrame = (f) => f();
    // Where the title and the filters are, by their bottom edge: below the
    // bar's 52px, they are in view.
    const at = { hero: 300, filters: 500 };
    doc.querySelector('.guide-hero').getBoundingClientRect = () => ({ bottom: at.hero });
    const form = doc.getElementById('guide-filters');
    form.getBoundingClientRect = () => ({ bottom: at.filters });
    const presses = [];
    doc.getElementById('guide-expand').addEventListener('click', () => presses.push('expand'));
    doc.getElementById('guide-collapse').addEventListener('click', () => presses.push('collapse'));
    const bar = doc.getElementById('guide-bar');
    const api = installGuideBar({
        doc,
        bar,
        hero: doc.querySelector('.guide-hero'),
        filters: form,
        status: doc.getElementById('guide-status'),
        expand: doc.getElementById('guide-expand'),
        collapse: doc.getElementById('guide-collapse'),
        search: doc.getElementById('guide-search'),
        tocList: doc.getElementById('guide-toc-list'),
    });
    // The placeholder the filters leave stands where they were.
    const scrollTo = (hero, filters) => {
        at.hero = hero;
        at.filters = filters;
        const placeholder = doc.querySelector('.guide-filters-placeholder');
        if (placeholder) placeholder.getBoundingClientRect = () => ({ bottom: filters });
        win.dispatchEvent(new win.Event('scroll'));
    };
    const q = (sel) => bar.querySelector(sel);
    const key = (el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
    return { win, doc, bar, form, q, scrolls, presses, scrollTo, key, api };
}

describe('the testing guide\'s bar', () => {
    test('stays hidden and out of reach while the title is in view', () => {
        const { doc, bar } = page();
        assert.equal(bar.classList.contains('is-shown'), false);
        assert.equal(bar.inert, true);
        assert.equal(doc.documentElement.classList.contains('guide-bar-on'), false);
    });

    test('shows once the title is gone, with no filters while they are still in view', () => {
        const { doc, bar, q, scrollTo } = page();
        scrollTo(-10, 300);
        assert.equal(bar.classList.contains('is-shown'), true);
        assert.equal(bar.inert, false);
        assert.equal(doc.documentElement.classList.contains('guide-bar-on'), true);
        assert.equal(q('[data-guide-bar="filters"]').hidden, true);
        assert.equal(bar.classList.contains('has-filters'), false);
    });

    test('once the filters are gone too, says what is shown on a Filters button; back at the top, hides', () => {
        const { bar, q, scrollTo } = page();
        scrollTo(-400, -100);
        assert.equal(q('[data-guide-bar="filters"]').hidden, false);
        assert.equal(bar.classList.contains('has-filters'), true);
        assert.equal(q('[data-guide-bar="filters"]').textContent.replace(/\s+/g, ' ').trim(), 'Filters: WCAG 2.2 · A and AA · 55 criteria, 78 checks');
        scrollTo(300, 500);
        assert.equal(bar.classList.contains('is-shown'), false);
        assert.equal(bar.inert, true);
        assert.equal(q('[data-guide-bar="filters"]').hidden, true);
    });

    test('what is shown follows the page\'s status', async () => {
        const { doc, q } = page();
        doc.getElementById('guide-status').textContent = 'WCAG 2.2, Level A and AA: 12 of 55 criteria shown, 20 checks.';
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(q('[data-guide-bar="summary"]').textContent, 'WCAG 2.2 · A and AA · 12 of 55 criteria shown, 20 checks');
    });

    test('its logo links back to the scanner', () => {
        const { q } = page();
        assert.equal(q('.guide-bar-brand').getAttribute('href'), '/');
    });

    test('Filters opens the page\'s own filters under the bar, leaving their place in the page, and focuses the first', () => {
        const { doc, form, q, scrollTo } = page();
        scrollTo(-400, -100);
        q('[data-guide-bar="filters"]').click();
        const panel = doc.getElementById('guide-bar-filters-panel');
        assert.equal(q('[data-guide-bar="filters"]').getAttribute('aria-expanded'), 'true');
        assert.equal(panel.hidden, false);
        assert.equal(form.parentElement, panel, 'the same form, not a copy');
        assert.equal(doc.querySelectorAll('#guide-filters').length, 1);
        assert.ok(doc.querySelector('main .guide-filters-placeholder'), 'its place kept');
        assert.equal(doc.activeElement.id, 'guide-standard');

        q('[data-guide-bar="filters"]').click();
        assert.equal(panel.hidden, true);
        assert.equal(form.parentElement.tagName, 'MAIN', 'back where it was');
        assert.equal(doc.querySelector('.guide-filters-placeholder'), null);
    });

    test('Escape puts the filters back and focus on Filters; with text in the search, it clears that first', () => {
        const { doc, form, q, scrollTo, key } = page();
        scrollTo(-400, -100);
        q('[data-guide-bar="filters"]').click();
        const search = doc.getElementById('guide-search');
        search.value = 'contrast';
        key(search, 'Escape');
        assert.equal(q('[data-guide-bar="filters"]').getAttribute('aria-expanded'), 'true', 'the search clears first');
        search.value = '';
        key(search, 'Escape');
        assert.equal(q('[data-guide-bar="filters"]').getAttribute('aria-expanded'), 'false');
        assert.equal(form.parentElement.tagName, 'MAIN');
        assert.equal(doc.activeElement, q('[data-guide-bar="filters"]'));
    });

    test('scrolled back to where they sit, the filters go back, keeping focus; a click outside also puts them back', () => {
        const { doc, form, q, scrollTo } = page();
        scrollTo(-400, -100);
        q('[data-guide-bar="filters"]').click();
        scrollTo(-400, 200);
        assert.equal(form.parentElement.tagName, 'MAIN');
        assert.equal(doc.activeElement.id, 'guide-standard');

        scrollTo(-400, -100);
        q('[data-guide-bar="filters"]').click();
        doc.getElementById('outside').click();
        assert.equal(form.parentElement.tagName, 'MAIN');
    });

    test('Expand all and Collapse all do what the page\'s own do, and leave what is open in the bar open', () => {
        const { doc, q, presses, scrollTo } = page();
        scrollTo(-400, -100);
        q('[data-guide-bar="filters"]').click();
        q('[data-guide-bar="expand"]').click();
        q('[data-guide-bar="collapse"]').click();
        assert.deepEqual(presses, ['expand', 'collapse']);
        assert.equal(doc.getElementById('guide-bar-filters-panel').hidden, false);
    });

    test('Back to top puts the filters back, scrolls to the top and puts focus on the search', () => {
        const { doc, form, q, scrolls, scrollTo } = page();
        scrollTo(-400, -100);
        q('[data-guide-bar="filters"]').click();
        q('[data-guide-bar="top"]').click();
        assert.equal(form.parentElement.tagName, 'MAIN');
        assert.equal(scrolls.length, 1);
        assert.equal(scrolls[0].top, 0);
        assert.equal(doc.activeElement.id, 'guide-search');
    });

    test('Contents opens the guide\'s contents as they are, with Expand all and Collapse all, and closes on a link, Escape or a click outside', () => {
        const { doc, q, presses, scrollTo, key } = page();
        scrollTo(-10, 300);
        const button = q('[data-guide-bar="contents"]');
        const panel = doc.getElementById('guide-bar-toc');
        button.click();
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        assert.equal(panel.hidden, false);
        assert.deepEqual([...panel.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.getAttribute('aria-current')]),
            [['#grp-1', 'location'], ['#grp-2', null]]);
        panel.querySelector('[data-guide-bar="expand"]').click();
        assert.deepEqual(presses, ['expand']);
        assert.equal(panel.hidden, false, 'still open');

        panel.querySelector('a[href="#grp-2"]').click();
        assert.equal(button.getAttribute('aria-expanded'), 'false');
        assert.equal(panel.hidden, true);

        button.click();
        key(panel.querySelector('a'), 'Escape');
        assert.equal(panel.hidden, true);
        assert.equal(doc.activeElement, button, 'focus goes back to Contents');

        button.click();
        doc.getElementById('outside').click();
        assert.equal(panel.hidden, true);
    });

    test('Contents and Filters do not open together, and both close when the bar hides', () => {
        const { doc, form, q, scrollTo } = page();
        scrollTo(-400, -100);
        q('[data-guide-bar="contents"]').click();
        q('[data-guide-bar="filters"]').click();
        assert.equal(doc.getElementById('guide-bar-toc').hidden, true);
        q('[data-guide-bar="contents"]').click();
        assert.equal(doc.getElementById('guide-bar-filters-panel').hidden, true);
        assert.equal(form.parentElement.tagName, 'MAIN');
        scrollTo(300, 500);
        assert.equal(doc.getElementById('guide-bar-toc').hidden, true);
        assert.equal(q('[data-guide-bar="contents"]').getAttribute('aria-expanded'), 'false');
    });
});
