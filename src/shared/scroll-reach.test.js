'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { sync } = require('./scroll-reach.js');

// jsdom lays nothing out: each box is given the widths a browser would.
function boxIn(html, size) {
    const { document } = new JSDOM(`<!doctype html><body>${html}</body>`).window;
    const box = document.querySelector('[data-box]');
    resize(box, size);
    return box;
}

function resize(box, { scrollWidth, clientWidth, scrollHeight = 100, clientHeight = 100 }) {
    Object.defineProperty(box, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => clientWidth });
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => clientHeight });
}

describe('a box that scrolls', () => {
    test('takes focus as a region named by its caption while it overflows', () => {
        const box = boxIn('<div class="dash-table-scroll" data-box><table><caption>Failures by run</caption></table></div>', { scrollWidth: 600, clientWidth: 320 });
        sync(box);
        assert.equal(box.getAttribute('tabindex'), '0');
        assert.equal(box.getAttribute('role'), 'region');
        assert.equal(box.getAttribute('aria-label'), 'Failures by run');
    });

    test('without a caption, is named by the heading of its part', () => {
        const box = boxIn('<div class="dsp-block"><h4>How each rule\'s reach changed</h4><div class="dsp-table-wrap" data-box><table></table></div></div>', { scrollWidth: 600, clientWidth: 320 });
        sync(box);
        assert.equal(box.getAttribute('aria-label'), 'How each rule\'s reach changed');
    });

    test('is no stop in the tab order while it fits, and stops being one once it fits again', () => {
        const box = boxIn('<div class="dash-table-scroll" data-box><table><caption>Room before failing</caption></table></div>', { scrollWidth: 900, clientWidth: 900 });
        sync(box);
        assert.equal(box.hasAttribute('tabindex'), false);
        assert.equal(box.hasAttribute('role'), false);

        resize(box, { scrollWidth: 900, clientWidth: 320 });
        sync(box);
        assert.equal(box.getAttribute('tabindex'), '0');

        resize(box, { scrollWidth: 900, clientWidth: 900 });
        sync(box);
        assert.equal(box.hasAttribute('tabindex'), false);
        assert.equal(box.hasAttribute('role'), false);
        assert.equal(box.hasAttribute('aria-label'), false);
    });

    test('output grown past its box takes focus, under the name it is given', () => {
        const box = boxIn('<pre class="out" data-scroll-name="Scan output" data-box>…</pre>', { scrollWidth: 300, clientWidth: 300, scrollHeight: 1200, clientHeight: 350 });
        sync(box);
        assert.equal(box.getAttribute('tabindex'), '0');
        assert.equal(box.getAttribute('aria-label'), 'Scan output');
    });

    test('a box the markup already makes a stop is left as it is', () => {
        const box = boxIn('<div class="dash-table-scroll" tabindex="0" role="region" aria-label="Every problem" data-box></div>', { scrollWidth: 900, clientWidth: 900 });
        sync(box);
        assert.equal(box.getAttribute('tabindex'), '0');
        assert.equal(box.getAttribute('aria-label'), 'Every problem');
    });
});
