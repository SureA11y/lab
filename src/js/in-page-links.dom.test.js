'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let installInPageLinks;
before(async () => {
    ({ installInPageLinks } = await import('./in-page-links.js'));
});

function page(body) {
    const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url: 'http://127.0.0.1:3000/src/' });
    const doc = dom.window.document;
    const scrolled = [];
    dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
    installInPageLinks(doc);
    const click = (selector, init = {}) => {
        const ev = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
        doc.querySelector(selector).dispatchEvent(ev);
        return ev;
    };
    return { dom, doc, scrolled, click };
}

describe('in-page links', () => {
    test('go to their target, focus it, and leave the URL as it was', () => {
        const { dom, doc, scrolled, click } = page('<a id="go" href="#sc-scan-144">Home</a><h3 id="sc-scan-144" tabindex="-1">Scan: Home</h3>');
        const ev = click('#go');
        assert.equal(ev.defaultPrevented, true);
        assert.deepEqual(scrolled, ['sc-scan-144']);
        assert.equal(doc.activeElement.id, 'sc-scan-144');
        assert.equal(dom.window.location.href, 'http://127.0.0.1:3000/src/');
    });

    test('work from inside the link, and make a target that cannot take focus focusable', () => {
        const { doc, click } = page('<a href="#sc-x"><img id="thumb" alt="x"></a><div id="sc-x">Scan</div>');
        click('#thumb');
        assert.equal(doc.activeElement.id, 'sc-x');
        assert.equal(doc.getElementById('sc-x').getAttribute('tabindex'), '-1');
    });

    test('leave to the browser a link with no target on the page, or a click that asks for more', () => {
        const { click } = page('<a id="none" href="#nowhere">x</a><a id="go" href="#sc-1">y</a><h3 id="sc-1" tabindex="-1">s</h3>');
        assert.equal(click('#none').defaultPrevented, false);
        assert.equal(click('#go', { ctrlKey: true }).defaultPrevented, false);
        assert.equal(click('#go', { button: 1 }).defaultPrevented, false);
    });
});
