'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

let M;
before(async () => {
    M = await import(pathToFileURL(path.join(__dirname, 'occurrence-pages.js')).href);
});

const LOGIN = 'https://auth.service.example.com/auth/realms/MainRealm/protocol/openid-connect/auth?client_id=prod&redirect_uri=https%3A%2F%2Fexample.com&state=0fffe9ade666ed067ae0ebcb0d9a00c297cd3ca85b2671720cc73e9025b385cb&scope=openid+email';

function dom(html) {
    return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
}

describe('an address, shortened', () => {
    test('is its host and path, "?…" where a query or fragment was left out', () => {
        assert.equal(M.shortUrl('https://shop.test/'), 'shop.test');
        assert.equal(M.shortUrl('https://shop.test/cart/'), 'shop.test/cart');
        assert.equal(M.shortUrl('https://shop.test/cart?coupon=x'), 'shop.test/cart?…');
        assert.equal(M.shortUrl('http://localhost:8780/products.html#top'), 'localhost:8780/products.html?…');
    });

    test('a login redirect loses its token, a long path keeps its start and its end', () => {
        assert.equal(M.shortUrl(LOGIN), 'auth.service.example.com/auth/realms/MainRealm/protocol/openid-connect/auth?…');
        const long = `https://cdn.shop.test/assets/${'segment/'.repeat(12)}image.png`;
        const short = M.shortUrl(long);
        assert.match(short, /^cdn\.shop\.test\/assets\/segment\/.*….*\/image\.png$/);
        assert.ok(short.length <= 'cdn.shop.test'.length + 60, short);
    });

    test('anything else is shortened as it is', () => {
        assert.equal(M.shortUrl('about:blank'), 'about:blank');
        assert.ok(M.shortUrl(`file:///${'a'.repeat(200)}`).length <= 80);
    });
});

describe('the pages of an occurrence', () => {
    test('one page: a short link to the whole address, and Copy URL', () => {
        const doc = dom(M.occurrencePagesHtml([LOGIN]));
        const a = doc.querySelector('a');
        assert.equal(a.getAttribute('href'), LOGIN);
        assert.equal(a.textContent, M.shortUrl(LOGIN));
        assert.equal(doc.querySelector('.node-pages-label').textContent, 'Found on');
        const copy = doc.querySelector('button.copy-urls-btn');
        assert.equal(copy.textContent, 'Copy URL');
        assert.equal(copy.getAttribute('data-copy'), LOGIN);
        assert.equal(doc.querySelector('details'), null);
    });

    test('many pages: three named, the rest in a list to open, all of them copied', () => {
        const urls = Array.from({ length: 300 }, (_, i) => `https://shop.test/p/${i}`);
        const doc = dom(M.occurrencePagesHtml([...urls, urls[0]]));
        assert.equal(doc.querySelector('.node-pages-label').textContent, 'Found on 300 pages:');
        assert.equal(doc.querySelectorAll('.node-pages-line a').length, 3);
        assert.match(doc.querySelector('.node-pages-line').textContent, /and 297 more$/);
        assert.equal(doc.querySelector('details summary').textContent, 'The other 297 pages');
        assert.equal(doc.querySelectorAll('details li a').length, 297);
        assert.equal(doc.querySelector('button.copy-urls-btn').getAttribute('data-copy').split('\n').length, 300);
    });

    test('pages told apart only by their query keep it', () => {
        const doc = dom(M.occurrencePagesHtml(['https://shop.test/list?page=1', 'https://shop.test/list?page=2', 'https://shop.test/cart?x=1']));
        assert.deepEqual([...doc.querySelectorAll('.node-pages-line a')].map((a) => a.textContent),
            ['shop.test/list?page=1', 'shop.test/list?page=2', 'shop.test/cart?…']);
    });

    test('two or three pages are named, joined with "and"', () => {
        const doc = dom(M.occurrencePagesHtml(['https://shop.test/', 'https://shop.test/cart']));
        assert.equal(doc.querySelector('.node-pages-line').textContent, 'Found on 2 pages: shop.test and shop.test/cart');
    });

    test('nothing is written unescaped, and only web addresses are links', () => {
        const odd = 'https://shop.test/"><img src=x onerror=alert(1)>';
        const doc = dom(M.occurrencePagesHtml([odd, 'javascript:alert(1)']));
        assert.equal(doc.querySelector('img'), null);
        assert.equal(doc.querySelectorAll('a').length, 1);
        assert.equal(doc.querySelector('a').getAttribute('href'), odd);
        assert.ok(!doc.querySelector('a[href^="javascript"]'));
    });

    test('no pages, no line', () => {
        assert.equal(M.occurrencePagesHtml([]), '');
        assert.equal(M.occurrencePagesHtml(undefined), '');
    });
});
