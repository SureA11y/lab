'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const G = require('./scan-groups.js');
const U = require('./scan-url-groups.js');
const V = require('./scan-groups-view.js');

function scans(paths, extra = {}) {
    return paths.map((p, i) => ({
        id: `s${i}`,
        label: `Scan ${i + 1}`,
        url: /^[a-z]+:/i.test(p) ? p : `https://shop.example.com${p}`,
        ...(extra[i] || {}),
    }));
}
function html(list, opts) {
    const result = G.findGroups(list, { sources: [U.createUrlGroupSource()] });
    return V.sectionHTML(result, list, opts);
}
const summaries = (h) => [...h.matchAll(/<summary>(.*?)<\/summary>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

describe('Scan groups section', () => {
    test('nothing for fewer than two scans', () => {
        assert.equal(html(scans(['/products/a'])), '');
        assert.equal(html([]), '');
        assert.equal(V.sectionHTML(null, scans(['/a', '/b'])), '');
    });

    test('says so when the URLs repeat no pattern, and lists no groups', () => {
        const h = html(scans(['/', '/about', '/contact']));
        assert.match(h, /<summary>Scan groups<\/summary>/);
        assert.match(h, /The URLs of these 3 scans repeat no pattern, so there are no groups\./);
        assert.doesNotMatch(h, /data-sg-key/);
        assert.doesNotMatch(h, /Not grouped/);
    });

    test('a group shows its pattern, its scans and how many are included', () => {
        const h = html(scans(['/', '/products/a', '/products/b', '/products/c'], { 2: { includedInReport: false } }));
        assert.deepEqual(summaries(h), [
            'Scan groups',
            '/products/{slug} 3 scans · 2 of 3 included',
            'Not grouped 1 scan',
        ]);
        assert.match(h, /1 group of scans whose URLs repeat a pattern, as pages made from one template do, holding 3 scans of 4\./);
    });

    test('all, both and none included', () => {
        assert.match(html(scans(['/p/a', '/p/b', '/p/c'])), /3 scans · all included/);
        assert.match(html(scans(['/p/a', '/p/b'])), /2 scans · both included/);
        assert.match(html(scans(['/p/a', '/p/b'], { 0: { includedInReport: false }, 1: { includedInReport: false } })),
            /2 scans · none included/);
    });

    test('distinct URLs are shown when fewer than the scans', () => {
        assert.match(html(scans(['/p/a', '/p/a', '/p/b'])), /3 scans · 2 URLs · all included/);
    });

    test('members link to their scan card, show their URL and their exclusion', () => {
        const h = html(scans(['/p/a', '/p/b'], { 1: { includedInReport: false } }));
        assert.match(h, /<li class=""><a href="#sc-s0">Scan 1<\/a> <span class="sg-url">https:\/\/shop\.example\.com\/p\/a<\/span><\/li>/);
        assert.match(h, /<li class="scan-summary-excluded"><a href="#sc-s1">Scan 2<\/a> <span class="scan-excluded-badge">Excluded<\/span>/);
    });

    test('nested groups are nested, and a parent lists only the scans no child holds', () => {
        const h = html(scans([
            '/', '/blog', '/blog/a11y', '/blog/news',
            '/blog/a11y/alt', '/blog/a11y/contrast', '/blog/news/launch', '/blog/news/v2',
        ]));
        assert.deepEqual(summaries(h), [
            'Scan groups',
            '/blog/… 7 scans · all included',
            '/blog/{slug}/{slug} 4 scans · all included',
            '/blog/a11y/{slug} 2 scans · both included',
            '/blog/news/{slug} 2 scans · both included',
            '/blog/{slug} 2 scans · both included',
            'Not grouped 1 scan',
        ]);
        assert.match(h, /5 groups of scans whose URLs repeat a pattern, as pages made from one template do, holding 7 scans of 8\./);
        // /blog itself is in /blog/… only.
        assert.match(h, /1 scan in no smaller group:<\/p><ul class="sg-members"><li class=""><a href="#sc-s1">/);
    });

    test('the host is named only when the groups span several', () => {
        const one = html(scans(['/p/a', '/p/b']));
        assert.doesNotMatch(one, /sg-host/);
        const two = html(scans([
            'https://www.example.com/p/a', 'https://www.example.com/p/b',
            'https://m.example.com/p/a', 'https://m.example.com/p/b',
        ]));
        assert.match(two, /<span class="sg-host">on www\.example\.com<\/span>/);
        assert.match(two, /<span class="sg-host">on m\.example\.com<\/span>/);
    });

    test('starts closed; open and openKeys restore what was open', () => {
        const list = scans(['/', '/p/a', '/p/b']);
        assert.match(html(list), /<details class="a11y-details sg" data-sg-section>/);
        const h = html(list, { open: true, openKeys: ['url:shop.example.com/p/{*}', 'not-grouped'] });
        assert.match(h, /<details class="a11y-details sg" data-sg-section open>/);
        assert.match(h, /data-sg-key="url:shop\.example\.com\/p\/\{\*\}" open>/);
        assert.match(h, /data-sg-key="not-grouped" open>/);
    });

    test('labels, URLs and ids are escaped', () => {
        const list = [
            { id: 'a"1', label: '<b>x</b>', url: 'https://x.com/p/1?q=<i>' },
            { id: 'a2', label: 'y', url: 'https://x.com/p/2?q=2' },
        ];
        const h = html(list);
        assert.doesNotMatch(h, /<b>x<\/b>|<i>/);
        assert.match(h, /href="#sc-a&quot;1">&lt;b&gt;x&lt;\/b&gt;/);
    });

    test('groups from a source without hosts or URL counts are shown too', () => {
        const list = scans(['/a', '/b', '/c']);
        const result = G.findGroups(list, {
            sources: [{ id: 'markup', propose: () => [{ key: 't', label: 'Product template', members: ['s0', 's2'] }] }],
        });
        assert.deepEqual(summaries(V.sectionHTML(result, list)), [
            'Scan groups', 'Product template 2 scans · both included', 'Not grouped 1 scan',
        ]);
    });
});
