'use strict';

// The exported report is a file read away from the lab, so a picture the lab
// serves from /reports/ has to travel inside it: buildReport() gives each one
// as a data URL, which the zip then moves to images/.
//
// node's test runner isolates each file in its own process.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let inlineServedImages;
let largeSingleFileQuestion;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function response(body, {status = 200, type = 'image/png'} = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Not Found',
        headers: {get: (name) => (name.toLowerCase() === 'content-type' ? type : null)},
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
}

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.HTMLElement = dom.window.HTMLElement;
    ({inlineServedImages, largeSingleFileQuestion} = await import('./export.js'));
});

describe('inlineServedImages', () => {
    test('a picture the lab serves becomes a data URL, fetched once however often it shows', async () => {
        const fetched = [];
        const url = '/reports/evidence/run/elements-scan/element-1.png';
        const html = `<div class="example-node"><figure class="node-screenshot"><img src="${url}" alt="a"></figure></div>` +
            `<figure class="node-screenshot"><img src="${url}" alt="b"></figure>`;
        const out = await inlineServedImages(html, {fetchImpl: async (u) => { fetched.push(u); return response(PNG); }});

        assert.deepEqual(fetched, [url]);
        const expected = `data:image/png;base64,${PNG.toString('base64')}`;
        assert.equal(out.split(expected).length - 1, 2);
        assert.ok(!out.includes('/reports/'));
        assert.ok(out.includes('class="node-screenshot"'), 'the markup around it stays');
    });

    test('other images and markup without a served picture are left as they are', async () => {
        const html = '<img src="data:image/png;base64,AAAA" alt=""><p>/reports/ is only text here</p>';
        const out = await inlineServedImages(html, {fetchImpl: async () => { throw new Error('not called'); }});
        assert.equal(out, html);
        assert.equal(await inlineServedImages('', {}), '');
    });

    test('a picture that cannot be fetched keeps its URL, and the rest still export', async (t) => {
        t.mock.method(console, 'warn', () => {});
        const html = '<img src="/reports/gone.png" alt=""><img src="/reports/page.html" alt=""><img src="/reports/ok.png" alt="">';
        const out = await inlineServedImages(html, {
            fetchImpl: async (u) => (u === '/reports/gone.png'
                ? response(PNG, {status: 404})
                : u === '/reports/page.html' ? response(PNG, {type: 'text/html'}) : response(PNG)),
        });
        assert.ok(out.includes('src="/reports/gone.png"'));
        assert.ok(out.includes('src="/reports/page.html"'));
        assert.ok(!out.includes('src="/reports/ok.png"'));
        assert.equal(console.warn.mock.callCount(), 2);
    });
});

describe('inlineServedImages: a report loaded from its package', () => {
    test('its pictures, shown from blob: links of this page only, go into the file too', async () => {
        const html = '<figure class="node-screenshot"><img src="blob:http://lab.test/1" alt="a"></figure>';
        const out = await inlineServedImages(html, {
            fetchImpl: async () => ({ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer}),
        });
        assert.ok(out.includes('src="data:image/png;base64,AQID"'));
    });
});

describe('a large single file', () => {
    test('asks before saving one over 50 MB, saying the zip holds the same report', () => {
        assert.equal(largeSingleFileQuestion(10 * 1024 * 1024), null);
        assert.equal(largeSingleFileQuestion(50 * 1024 * 1024), null);
        const q = largeSingleFileQuestion(85 * 1024 * 1024);
        assert.match(q, /^This single file is 85 MB/);
        assert.match(q, /The zip holds the same report, its pictures as files\./);
    });
});

