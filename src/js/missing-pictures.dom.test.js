'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let M;
let doc;
before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.window = dom.window;
    doc = dom.window.document;
    M = await import('./missing-pictures.js');
    M.watchForMissingPictures(doc);
});

function fail(img) {
    img.dispatchEvent(new doc.defaultView.Event('error'));
}

describe('missing pictures', () => {
    test('a picture that does not load says why, in its place', () => {
        doc.body.innerHTML = '<figure class="node-screenshot"><img src="images/abc.png" alt="Occurrence 1: the flagged img element"><figcaption>Cropped.</figcaption></figure>';
        fail(doc.querySelector('img'));
        assert.equal(doc.querySelector('img'), null);
        const note = doc.querySelector('figure .picture-missing');
        assert.equal(note.textContent, 'No picture: it is not included with this copy of the report.');
        assert.ok(doc.querySelector('figcaption'), 'the rest stays');
    });

    test('a picture that is a button goes with its button, which would open nothing', () => {
        doc.body.innerHTML = '<article><h3>Screenshot: Home</h3><button class="screenshot-btn"><span><img src="/reports/runs/r/a.jpg" alt="Screenshot: Home"></span></button></article>';
        fail(doc.querySelector('img'));
        assert.equal(doc.querySelector('button'), null);
        assert.equal(doc.querySelector('.picture-missing').textContent,
            'No picture: it was kept by the lab that ran the scan, which does not have it now.');
    });

    test('the reasons', () => {
        assert.equal(M.whyPictureMissing('images/x.jpg'), 'it is not included with this copy of the report.');
        assert.equal(M.whyPictureMissing('http://127.0.0.1:3000/reports/evidence/x.png'), 'it was kept by the lab that ran the scan, which does not have it now.');
        assert.equal(M.whyPictureMissing('blob:http://x/1'), 'it could not be loaded.');
    });

    test('other errors are left alone', () => {
        doc.body.innerHTML = '<script src="x.js"></script><img src="images/a.png">';
        doc.querySelector('script').dispatchEvent(new doc.defaultView.Event('error'));
        assert.equal(doc.querySelectorAll('.picture-missing').length, 0);
    });
});
