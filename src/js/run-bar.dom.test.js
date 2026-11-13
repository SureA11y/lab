'use strict';

// DOM tests for installRunBar, under jsdom: the bar is marked stuck only
// while its place at the configuration's end is below the window, its
// height is kept on the page for the scroll padding, and a run's floating
// card moves up above it where they would meet. CSS does the sticking;
// jsdom lays nothing out, so positions and the resize observer are stubbed.

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
    let resized;
    win.ResizeObserver = class {
        constructor(cb) { resized = cb; }
        observe() {}
    };
    const bar = doc.querySelector('.inline-actions');
    let barHeight = height;
    let barTop = 2000;
    bar.getBoundingClientRect = () => ({ height: barHeight, top: barTop, bottom: barTop + barHeight });
    Object.defineProperty(win, 'innerHeight', { value: VIEW.bottom, configurable: true });
    // Where the place at the configuration's end is, against the window.
    let placeTop = 400;
    const realCreate = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
        const el = realCreate(tag);
        el.getBoundingClientRect = () => ({ top: placeTop, bottom: placeTop + 1, height: 1 });
        return el;
    };
    const api = installRunBar({ bar, doc });
    doc.createElement = realCreate;
    const placeAt = (top) => { placeTop = top; api.update(); };
    const resize = (h) => { barHeight = h; resized([]); };
    // A run's card, 160px tall, 16px from the bottom edge before it moves.
    const addCard = (className = 'live-totals') => {
        const card = doc.createElement('div');
        card.className = className;
        card.getBoundingClientRect = () => {
            const lift = parseFloat(doc.documentElement.style.getPropertyValue('--run-bar-lift')) || 0;
            const bottom = VIEW.bottom - 16 - lift;
            return { top: bottom - 160, bottom, height: 160 };
        };
        doc.body.append(card);
        return card;
    };
    const barAt = (top) => { barTop = top; api.update(); };
    const lift = () => doc.documentElement.style.getPropertyValue('--run-bar-lift');
    return { doc, bar, placeAt, resize, addCard, barAt, lift };
}

describe('run bar', () => {
    test('marks its place right after the bar, out of the accessibility tree', () => {
        const { bar } = page();
        const place = bar.nextElementSibling;
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

    test('is stuck after a jump from above its place to below it, never crossing the window', () => {
        const { bar, placeAt } = page();
        placeAt(-3000);
        assert.equal(bar.classList.contains('is-stuck'), false);
        placeAt(1500);
        assert.equal(bar.classList.contains('is-stuck'), true);
    });

    test('keeps its height on the page, as it changes', () => {
        const { doc, resize } = page({ height: 68.4 });
        const root = doc.documentElement;
        assert.equal(root.style.getPropertyValue('--run-bar-h'), '69px');
        resize(138);
        assert.equal(root.style.getPropertyValue('--run-bar-h'), '138px');
    });

    test("moves a run's card up above the bar stuck on the bottom edge", () => {
        const { addCard, barAt, lift } = page();
        addCard();
        barAt(VIEW.bottom - 69);
        // The bar's 69px, 8px between them, less the card's own 16px.
        assert.equal(lift(), '61px');
    });

    test('keeps the card above the bar back in its place, low in the window', () => {
        const { addCard, barAt, lift } = page();
        addCard();
        barAt(500);
        assert.equal(lift(), '192px');
    });

    test('leaves the card in its corner once the bar is clear of it', () => {
        const { addCard, barAt, lift } = page();
        addCard();
        barAt(VIEW.bottom - 69);
        barAt(300);
        assert.equal(lift(), '0px');
        barAt(-500);
        assert.equal(lift(), '0px');
    });

    test('leaves alone a card that is part of the content, or hidden', () => {
        const { addCard, barAt, lift } = page();
        addCard('live-totals live-totals--inline');
        addCard('live-totals is-tab-hidden');
        barAt(VIEW.bottom - 69);
        assert.equal(lift(), '');
    });

    test('does nothing without a bar', () => {
        assert.equal(installRunBar({ bar: null }), null);
    });
});
