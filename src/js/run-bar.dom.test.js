'use strict';

// DOM tests for installRunBar, under jsdom: the bar is marked stuck only
// while its place at the configuration's end is below the window, and its
// height is kept on the page for the scroll padding. CSS does the sticking;
// jsdom lays nothing out, so the observers are stubbed.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let installRunBar;
before(async () => {
    ({ installRunBar } = await import('./run-bar.js'));
});

const VIEW = { top: 0, bottom: 700 };

function page({ height = 69 } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <section id="config-section"><div id="config-content"></div>
            <div class="inline-actions"><button type="submit">Run</button></div>
        </section></body></html>`);
    const win = dom.window;
    const doc = win.document;
    let seen;
    let observed;
    win.IntersectionObserver = class {
        constructor(cb) { seen = cb; }
        observe(el) { observed = el; }
    };
    let resized;
    win.ResizeObserver = class {
        constructor(cb) { resized = cb; }
        observe() {}
    };
    const bar = doc.querySelector('.inline-actions');
    let barHeight = height;
    bar.getBoundingClientRect = () => ({ height: barHeight });
    installRunBar({ bar, doc });
    // Where the place at the configuration's end is, against the window.
    const placeAt = (top) => seen([{
        isIntersecting: top >= VIEW.top && top < VIEW.bottom,
        boundingClientRect: { top },
        rootBounds: VIEW,
    }]);
    const resize = (h) => { barHeight = h; resized([]); };
    return { doc, bar, placeAt, resize, observed: () => observed };
}

describe('run bar', () => {
    test('watches a place right after the bar, out of the accessibility tree', () => {
        const { bar, observed } = page();
        const place = observed();
        assert.equal(place, bar.nextElementSibling);
        assert.equal(place.className, 'run-bar-sentinel');
        assert.equal(place.getAttribute('aria-hidden'), 'true');
    });

    test('is stuck while its place is below the window', () => {
        const { bar, placeAt } = page();
        placeAt(1500);
        assert.equal(bar.classList.contains('is-stuck'), true);
    });

    test('is not stuck once its place is in view', () => {
        const { bar, placeAt } = page();
        placeAt(1500);
        placeAt(400);
        assert.equal(bar.classList.contains('is-stuck'), false);
    });

    test('is not stuck once its place has scrolled above the window', () => {
        const { bar, placeAt } = page();
        placeAt(1500);
        placeAt(-300);
        assert.equal(bar.classList.contains('is-stuck'), false);
    });

    test('keeps its height on the page, as it changes', () => {
        const { doc, resize } = page({ height: 68.4 });
        const root = doc.documentElement;
        assert.equal(root.style.getPropertyValue('--run-bar-h'), '69px');
        resize(138);
        assert.equal(root.style.getPropertyValue('--run-bar-h'), '138px');
    });

    test('does nothing without a bar', () => {
        assert.equal(installRunBar({ bar: null }), null);
    });
});
