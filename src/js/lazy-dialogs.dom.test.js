'use strict';

// "View details" dialogs drawn when first opened (src/js/lazy-dialogs.js).

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let L;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    L = await import('./lazy-dialogs.js');
});

beforeEach(() => {
    L.clearLazyBodies();
    document.body.innerHTML = '';
});

function lazyDialog(build, count = 1) {
    const id = L.registerLazyBody(build);
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<div class="src-dialog-body" data-lazy-body="' + id + '" data-lazy-count="' + count + '"></div>';
    // jsdom's dialogs do not open modally; the state is all these tests need.
    dialog.showModal = () => { dialog.setAttribute('open', ''); };
    document.body.append(dialog);
    return dialog;
}

const bodyOf = (dialog) => dialog.querySelector('.src-dialog-body');

describe('lazy dialogs', () => {
    test('a body is drawn once, when its dialog is first opened', async () => {
        let calls = 0;
        const dialog = lazyDialog(() => { calls += 1; return '<p class="occ">one</p>'; });
        assert.equal(bodyOf(dialog).innerHTML, '', 'nothing drawn up front');

        await L.openLazyDialog(dialog);
        assert.equal(dialog.open, true);
        assert.equal(bodyOf(dialog).querySelector('.occ').textContent, 'one');
        assert.equal(bodyOf(dialog).hasAttribute('data-lazy-body'), false);

        dialog.removeAttribute('open');
        await L.openLazyDialog(dialog);
        assert.equal(calls, 1, 'opened again, not drawn again');
    });

    test('a long list opens on a skeleton and is drawn after a paint', async () => {
        const dialog = lazyDialog(() => '<p class="occ">many</p>', L.SKELETON_FROM);
        let seenWhilePainting = null;
        await L.openLazyDialog(dialog, {
            afterPaint: async () => {
                seenWhilePainting = {
                    open: dialog.open,
                    busy: bodyOf(dialog).getAttribute('aria-busy'),
                    loading: bodyOf(dialog).querySelector('.lazy-dialog-loading')?.textContent,
                    skeletonHidden: bodyOf(dialog).querySelector('.lazy-skeleton')?.getAttribute('aria-hidden'),
                };
            },
        });
        assert.deepEqual(seenWhilePainting, {
            open: true,
            busy: 'true',
            loading: `Loading ${L.SKELETON_FROM} occurrences…`,
            skeletonHidden: 'true',
        });
        assert.equal(bodyOf(dialog).querySelector('.occ').textContent, 'many');
        assert.equal(bodyOf(dialog).hasAttribute('aria-busy'), false);
    });

    test('a copy of the page gets every body, and the page still draws its own', () => {
        const a = lazyDialog(() => '<p class="occ">a</p>');
        const b = lazyDialog(() => '<p class="occ">b</p>');
        const copy = document.body.cloneNode(true);

        L.fillLazyDialogs(copy);
        assert.deepEqual([...copy.querySelectorAll('.occ')].map((p) => p.textContent), ['a', 'b']);
        assert.equal(copy.querySelector('[data-lazy-body]'), null);

        assert.equal(bodyOf(a).innerHTML, '', 'the page itself is untouched');
        L.fillLazyDialog(b);
        assert.equal(bodyOf(b).textContent, 'b');
    });

    test('a body whose report was cleared says so instead of staying empty', () => {
        const dialog = lazyDialog(() => '<p>gone</p>');
        L.clearLazyBodies();
        L.fillLazyDialog(dialog);
        assert.match(bodyOf(dialog).textContent, /no longer available/);
    });
});

describe('lazy dialogs per results tab', () => {
    test('clearing one tab\'s bodies leaves the other tab\'s', () => {
        L.setLazyScope('report');
        const report = lazyDialog(() => '<p>report</p>');
        L.setLazyScope('run');
        const run = lazyDialog(() => '<p>run</p>');

        L.clearLazyBodies('run');
        L.fillLazyDialog(report);
        L.fillLazyDialog(run);
        assert.equal(bodyOf(report).textContent, 'report');
        assert.match(bodyOf(run).textContent, /no longer available/);
        L.setLazyScope(null);
    });
});

describe('lazy dialogs in a copy of the page as text', () => {
    test('every waiting body is drawn into the text, through the transform', () => {
        L.clearLazyBodies();
        const a = lazyDialog(() => '<p class="occ">a()</p>');
        lazyDialog(() => '<p class="occ">b</p>');
        L.fillLazyDialog(a);
        const html = document.body.innerHTML;

        const filled = L.fillLazyBodiesInHtml(html, (body) => body.replaceAll('()', ''));
        assert.equal(filled.includes('data-lazy-body'), false);
        assert.ok(filled.includes('<div class="src-dialog-body"><p class="occ">b</p></div>'));
        assert.ok(filled.includes('<p class="occ">a()</p>'), 'a body drawn already is left as it is');
    });
});
