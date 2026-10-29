'use strict';

// The busy state slow actions show on their control (src/js/busy.js).

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let B;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
    B = await import('./busy.js');
});

function button(attrs = {}) {
    const b = document.createElement('button');
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    document.body.append(b);
    return b;
}

describe('busy controls', () => {
    test('setBusy marks a control unavailable and gives back what it had', () => {
        const plain = button();
        B.setBusy(plain, true);
        assert.equal(plain.dataset.busy, 'true');
        assert.equal(plain.getAttribute('aria-disabled'), 'true');
        B.setBusy(plain, false);
        assert.equal(plain.hasAttribute('data-busy'), false);
        assert.equal(plain.hasAttribute('aria-disabled'), false);

        const already = button({'aria-disabled': 'true'});
        B.setBusy(already, true);
        B.setBusy(already, false);
        assert.equal(already.getAttribute('aria-disabled'), 'true', 'still unavailable, as it was');
    });

    test('runBusy waits a frame, runs the work once, and releases the control even when it fails', async () => {
        const b = button();
        let runs = 0;
        let finish;
        const first = B.runBusy(b, () => { runs += 1; return new Promise((r) => { finish = r; }); });
        assert.equal(B.isBusy(b), true, 'busy at once');
        assert.equal(runs, 0, 'the work waits for a frame');
        assert.equal(await B.runBusy(b, () => { runs += 1; }), undefined, 'a second press does nothing');

        while (!finish) await new Promise((r) => setTimeout(r, 5));
        finish('done');
        assert.equal(await first, 'done');
        assert.equal(runs, 1);
        assert.equal(B.isBusy(b), false);

        await assert.rejects(B.runBusy(b, async () => { throw new Error('nope'); }), /nope/);
        assert.equal(B.isBusy(b), false, 'released after a failure');
    });
});
