'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const G = require('./scan-groups.js');
const U = require('./scan-url-groups.js');

// Scans with the given URLs, s0, s1…; a path is put on https://shop.example.com.
function scans(urls) {
    return urls.map((u, i) => ({ id: `s${i}`, url: /^[a-z]+:/i.test(u) ? u : `https://shop.example.com${u}` }));
}
function group(urls, options) {
    return G.findGroups(scans(urls), { sources: [U.createUrlGroupSource(options)] });
}
// The tree as nested [label, size, children?] for readable assertions.
function shape(level) {
    return level.map((g) => (g.children.length
        ? [g.label, g.size, shape(g.children)]
        : [g.label, g.size]));
}
const labels = (r) => G.flattenGroups(r.groups).map((g) => g.label);

describe('urlSignature', () => {
    test('host lowercased, default port dropped, other ports kept', () => {
        assert.equal(U.urlSignature('https://Shop.Example.COM:443/a').host, 'shop.example.com');
        assert.equal(U.urlSignature('http://example.com:8080/a').host, 'example.com:8080');
    });

    test('www. is kept: hosts are never folded', () => {
        assert.notEqual(U.urlSignature('https://www.example.com/').host,
            U.urlSignature('https://example.com/').host);
    });

    test('segments are decoded; empty ones and the trailing slash dropped', () => {
        assert.deepEqual(U.urlSignature('https://a.com//caf%C3%A9/x/').segments, ['café', 'x']);
        assert.equal(U.urlSignature('https://a.com/x/').identity, U.urlSignature('https://a.com/x').identity);
    });

    test('case in the path is kept', () => {
        assert.deepEqual(U.urlSignature('https://a.com/About').segments, ['About']);
    });

    test('query keys sorted and deduplicated; values kept in the identity only', () => {
        const s = U.urlSignature('https://a.com/p?b=2&a=1&b=3');
        assert.deepEqual(s.queryKeys, ['a', 'b']);
        assert.notEqual(s.identity, U.urlSignature('https://a.com/p?a=1&b=2').identity);
        assert.equal(U.urlSignature('https://a.com/p?b=2&a=1').identity,
            U.urlSignature('https://a.com/p?a=1&b=2').identity);
    });

    test('tracking keys are left out', () => {
        const s = U.urlSignature('https://a.com/p?id=4&utm_source=x&utm_medium=y&gclid=1&fbclid=2');
        assert.deepEqual(s.queryKeys, ['id']);
        assert.equal(s.identity, U.urlSignature('https://a.com/p?id=4').identity);
    });

    test('the tracking list is an option', () => {
        const s = U.urlSignature('https://a.com/p?id=4&ref=x', { trackingKeys: ['ref'] });
        assert.deepEqual(s.queryKeys, ['id']);
    });

    test('a plain fragment is dropped', () => {
        assert.equal(U.urlSignature('https://a.com/p#reviews').identity, U.urlSignature('https://a.com/p').identity);
    });

    test('a hash route adds its segments and query', () => {
        const s = U.urlSignature('https://a.com/app/#/products/42?tab=specs');
        assert.deepEqual(s.segments, ['app', 'products', '42']);
        assert.deepEqual(s.queryKeys, ['tab']);
        assert.deepEqual(U.urlSignature('https://a.com/#!/users/7').segments, ['users', '7']);
    });

    test('URLs that cannot be grouped give null', () => {
        for (const u of ['about:blank', 'data:text/html,hi', 'file:///tmp/x.html', 'not a url', '', null, undefined, 42]) {
            assert.equal(U.urlSignature(u), null, String(u));
        }
    });
});

describe('no patterns where nothing repeats', () => {
    test('a small site of different pages has none', () => {
        const r = group(['/', '/about', '/contact', '/pricing', '/blog/hello']);
        assert.deepEqual(r.groups, []);
        assert.equal(r.ungrouped.length, 5);
    });

    test('one scan has none', () => {
        assert.deepEqual(group(['/products/red-shirt']).groups, []);
    });

    test('one URL scanned several times is not a pattern', () => {
        assert.deepEqual(group(['/app', '/app', '/app', '/app#step-2']).groups, []);
    });

    test('scans that all ended on one login page are not a pattern', () => {
        assert.deepEqual(group(['/login?next=a', '/login?next=a', '/login?next=a']).groups, []);
    });

    test('a single product page scanned twice is not a pattern', () => {
        assert.deepEqual(group(['/products/a', '/products/a', '/about']).groups, []);
    });

    test('top-level pages never make /{*}', () => {
        assert.deepEqual(group(['/about', '/contact', '/team', '/jobs', '/press', '/legal']).groups, []);
    });

    test('scans without a usable URL are ungrouped', () => {
        const r = group(['about:blank', '/products/a', '/products/b', '']);
        assert.deepEqual(labels(r), ['/products/{slug}']);
        assert.deepEqual(r.ungrouped, ['s0', 's3']);
    });

    test('items without a url field are ungrouped', () => {
        const list = [{ id: 'a' }, { id: 'b', url: 'https://x.com/p/1' }, { id: 'c', url: 'https://x.com/p/2' }];
        const r = G.findGroups(list, { sources: [U.createUrlGroupSource()] });
        assert.deepEqual(r.ungrouped, ['a']);
    });
});

describe('shape patterns', () => {
    test('a shop: products grouped, the rest not', () => {
        const r = group(['/', '/about', '/products/red-shirt', '/products/blue-shirt', '/products/green-hat']);
        assert.deepEqual(shape(r.groups), [['/products/{slug}', 3]]);
        assert.deepEqual(r.ungrouped, ['s0', 's1']);
    });

    test('two distinct products are already a pattern (minUrls 2)', () => {
        assert.deepEqual(labels(group(['/products/a', '/products/b'])), ['/products/{slug}']);
    });

    test('minUrls is an option', () => {
        assert.deepEqual(group(['/products/a', '/products/b'], { minUrls: 3 }).groups, []);
        assert.deepEqual(labels(group(['/products/a', '/products/b', '/products/c'], { minUrls: 3 })),
            ['/products/{slug}']);
    });

    test('scans of one URL count once toward minUrls, but are all members', () => {
        const r = group(['/products/a', '/products/a', '/products/b'], { minUrls: 3 });
        assert.deepEqual(r.groups, []);
        const r2 = group(['/products/a', '/products/a', '/products/b']);
        assert.deepEqual(r2.groups[0].members, ['s0', 's1', 's2']);
        assert.equal(r2.groups[0].evidence.urls, 2);
    });

    test('wildcard names: {id} for numbers, {slug} for words, {*} otherwise', () => {
        assert.deepEqual(labels(group(['/orders/17', '/orders/2048'])), ['/orders/{id}']);
        assert.deepEqual(labels(group(['/u/Ana', '/u/bob_2'])), ['/u/{*}']);
    });

    test('a literal tail stays literal', () => {
        assert.deepEqual(labels(group(['/products/a/reviews', '/products/b/reviews'])),
            ['/products/{slug}/reviews']);
    });

    test('a tail that is the only literal anchors the pattern', () => {
        assert.deepEqual(labels(group(['/red/reviews', '/blue/reviews'])), ['/{slug}/reviews']);
    });

    test('different tails under one shape are told apart', () => {
        const r = group([
            '/products/a/reviews', '/products/b/reviews', '/products/c/reviews',
            '/products/a/specs', '/products/b/specs',
        ]);
        assert.deepEqual(shape(r.groups), [['/products/{slug}/{slug}', 5, [
            ['/products/{slug}/reviews', 3],
            ['/products/{slug}/specs', 2],
        ]]]);
    });

    test('the same sub-pages under every product make no group per product', () => {
        const urls = [];
        for (let i = 0; i < 50; i++) urls.push(`/products/p-${i}/reviews`, `/products/p-${i}/specs`);
        const r = group(urls);
        assert.deepEqual(shape(r.groups), [['/products/{slug}/{slug}', 100, [
            ['/products/{slug}/reviews', 50],
            ['/products/{slug}/specs', 50],
        ]]]);
    });

    test('a category keeps its pattern when its posts are its own', () => {
        const r = group(['/blog/a11y/alt', '/blog/a11y/contrast', '/blog/news/launch', '/blog/news/alt']);
        assert.ok(labels(r).includes('/blog/a11y/{slug}'));
    });

    test('a blog with one category scanned: the category pattern, not /blog/{*}/{*}', () => {
        const r = group(['/blog/accessibility/a', '/blog/accessibility/b', '/blog/accessibility/c']);
        assert.deepEqual(labels(r), ['/blog/accessibility/{slug}']);
    });

    test('evidence describes the pattern', () => {
        const g = group(['/products/a', '/products/b']).groups[0];
        assert.deepEqual(g.evidence, {
            kind: 'shape', host: 'shop.example.com', segments: ['products', null], queryKeys: [], urls: 2,
        });
        assert.equal(g.key, 'url:shop.example.com/products/{*}');
    });
});

describe('nested patterns', () => {
    const blog = [
        '/', '/about',
        '/blog/accessibility', '/blog/news',
        '/blog/accessibility/alt-text', '/blog/accessibility/contrast',
        '/blog/news/launch', '/blog/news/v2', '/blog/news/v3',
    ];

    test('categories and posts under one prefix, categories of posts inside', () => {
        const r = group(blog);
        assert.deepEqual(shape(r.groups), [['/blog/…', 7, [
            ['/blog/{slug}/{slug}', 5, [
                ['/blog/news/{slug}', 3],
                ['/blog/accessibility/{slug}', 2],
            ]],
            ['/blog/{slug}', 2],
        ]]]);
        assert.deepEqual(r.ungrouped, ['s0', 's1']);
    });

    test('a post is in every pattern on its path', () => {
        const r = group(blog);
        const holding = G.flattenGroups(r.groups).filter((g) => g.members.includes('s4')).map((g) => g.label);
        assert.deepEqual(holding, ['/blog/…', '/blog/{slug}/{slug}', '/blog/accessibility/{slug}']);
    });

    test('a prefix with a single pattern under it is that pattern', () => {
        const r = group(['/', '/blog/a', '/blog/b', '/blog/c']);
        assert.deepEqual(labels(r), ['/blog/{slug}']);
    });

    test('a prefix holding the whole host is the host, not a group', () => {
        const r = group(['/en/blog/a', '/en/blog/b', '/en/shop/x', '/en/shop/y']);
        assert.deepEqual(labels(r).sort(), ['/en/blog/{slug}', '/en/shop/{slug}', '/en/{slug}/{slug}'].sort());
        assert.ok(!labels(r).includes('/en/…'));
    });

    test('the index page of a section belongs to its prefix', () => {
        const r = group(['/', '/blog', '/blog/a', '/blog/b', '/blog/x/1', '/blog/y/2']);
        const prefix = G.flattenGroups(r.groups).find((g) => g.label === '/blog/…');
        assert.deepEqual(prefix.members, ['s1', 's2', 's3', 's4', 's5']);
    });
});

describe('query patterns', () => {
    test('one script, many ids', () => {
        const r = group(['/product.php?id=1', '/product.php?id=2', '/product.php?id=3', '/about']);
        assert.deepEqual(labels(r), ['/product.php?id=…']);
        assert.equal(r.groups[0].evidence.kind, 'query');
    });

    test('the root with a query parameter', () => {
        assert.deepEqual(labels(group(['/?p=1', '/?p=2'])), ['/?p=…']);
    });

    test('different query keys are different patterns', () => {
        const r = group(['/search?q=a', '/search?q=b', '/search?q=a&page=2', '/search?q=b&page=3']);
        assert.deepEqual(labels(r).sort(), ['/search?page=…&q=…', '/search?q=…']);
    });

    test('tracking parameters do not make another URL or pattern', () => {
        const r = group(['/products/a?utm_source=x', '/products/a?utm_source=y']);
        assert.deepEqual(r.groups, []);
    });
});

describe('hosts', () => {
    test('the same path on two hosts is two patterns', () => {
        const r = group([
            'https://www.example.com/products/a', 'https://www.example.com/products/b',
            'https://m.example.com/products/a', 'https://m.example.com/products/b',
        ]);
        assert.deepEqual(r.groups.map((g) => g.evidence.host).sort(), ['m.example.com', 'www.example.com']);
        assert.ok(r.groups.every((g) => g.size === 2));
    });

    test('one product on each of two hosts is no pattern', () => {
        const r = group(['https://a.example.com/products/x', 'https://b.example.com/products/y']);
        assert.deepEqual(r.groups, []);
    });
});

describe('the source', () => {
    test('reads the URL with getUrl', () => {
        const list = [{ id: 'a', ctx: { url: 'https://x.com/p/1' } }, { id: 'b', ctx: { url: 'https://x.com/p/2' } }];
        const source = U.createUrlGroupSource({ getUrl: (i) => i.ctx.url });
        assert.deepEqual(G.findGroups(list, { sources: [source] }).groups[0].members, ['a', 'b']);
    });

    test('is a findGroups source with the url id', () => {
        const source = U.createUrlGroupSource();
        assert.equal(source.id, U.SOURCE_ID);
        assert.equal(typeof source.propose, 'function');
    });

    test('a large run is grouped quickly', () => {
        const urls = [];
        for (let i = 0; i < 3000; i++) urls.push(`/products/item-${i}`);
        for (let i = 0; i < 1000; i++) urls.push(`/blog/cat-${i % 20}/post-${i}`);
        const t = Date.now();
        const r = group(urls);
        assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
        assert.ok(labels(r).includes('/products/{slug}'));
    });
});
