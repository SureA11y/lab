'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./toast.js');

function fakeDom() {
    const nodes = new Map();
    const make = (tag) => {
        const el = {
            tag, id: '', className: '', textContent: '', children: [], parentNode: null,
            attrs: {},
            setAttribute(k, v) { this.attrs[k] = v; },
            getAttribute(k) { return this.attrs[k]; },
            appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
            removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
        };
        return el;
    };
    const body = make('body');
    global.document = {
        body,
        createElement: make,
        getElementById: (id) => nodes.get(id) || null,
    };
    const origAppend = body.appendChild.bind(body);
    body.appendChild = (c) => { if (c.id) nodes.set(c.id, c); return origAppend(c); };
    return { body };
}

describe('toast', () => {
    test('creates one live region and appends toasts into it', () => {
        const { body } = fakeDom();
        try {
            const dismiss = T.showToast('Sorted by most failures', { duration: 0 });
            const region = body.children.find((c) => c.id === T.REGION_ID);
            assert.ok(region, 'region created');
            assert.equal(region.getAttribute('aria-live'), 'polite');
            assert.equal(region.getAttribute('role'), 'status');
            assert.equal(region.children.length, 1);
            assert.equal(region.children[0].textContent, 'Sorted by most failures');
            // dismiss removes it; region is reused (not recreated)
            dismiss();
            assert.equal(region.children.length, 0);
            T.showToast('again', { duration: 0 });
            assert.equal(body.children.filter((c) => c.id === T.REGION_ID).length, 1);
        } finally {
            delete global.document;
        }
    });

    test('no-ops without a document instead of throwing', () => {
        delete global.document;
        assert.doesNotThrow(() => {
            const dismiss = T.showToast('x');
            dismiss();
        });
    });
});
