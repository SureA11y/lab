'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

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
// The section as a document, to read it as a person or a screen reader would.
function dom(h) {
    return new JSDOM(`<!doctype html><body>${h}</body>`).window.document;
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
// Each pattern row: its label, counts and whether it is chosen, nested.
function patterns(doc) {
    const walk = (ul) => [...ul.children].map((li) => {
        const row = li.querySelector(':scope > .sg-choose');
        const sub = li.querySelector(':scope > ul.sg-tree');
        const entry = [text(row.querySelector('label')), text(row.querySelector('.sg-counts')),
            row.querySelector('input').checked];
        return sub ? [...entry, walk(sub)] : entry;
    });
    const roots = doc.querySelector('[aria-labelledby="sg-found-h"] > ul.sg-roots');
    return roots ? walk(roots) : [];
}
// Each chosen group: what its summary says, and the scans listed in it, nested.
function yours(doc) {
    const walk = (ul) => [...ul.children].map((li) => {
        const d = li.querySelector(':scope > details');
        const members = [...d.querySelectorAll(':scope > ul.sg-members > li > a')].map(text);
        const sub = d.querySelector(':scope > ul.sg-tree');
        return sub ? [text(d.querySelector('summary')), members, walk(sub)] : [text(d.querySelector('summary')), members];
    });
    const roots = doc.querySelector('[aria-labelledby="sg-yours-h"] > ul.sg-roots');
    return roots ? walk(roots) : null;
}

const BLOG = ['/', '/blog', '/blog/a11y', '/blog/news',
    '/blog/a11y/alt', '/blog/a11y/contrast', '/blog/news/launch', '/blog/news/v2'];
const KEY = (p) => `url:shop.example.com${p}`;

describe('Scan groups section', () => {
    test('nothing for fewer than two scans', () => {
        assert.equal(html(scans(['/products/a'])), '');
        assert.equal(html([]), '');
        assert.equal(V.sectionHTML(null, scans(['/a', '/b'])), '');
    });

    test('says so when the URLs repeat no pattern, offers no pattern, and offers grouping by hand', () => {
        const doc = dom(html(scans(['/', '/about', '/contact'])));
        assert.equal(text(doc.querySelector('summary')), 'Scan groups');
        assert.match(text(doc.querySelector('.sg-intro')), /The URLs of these 3 scans repeat no pattern, so there are no groups to choose\..*Scans can still be grouped by hand\./);
        assert.equal(doc.querySelector('[data-sg-choose]'), null);
        assert.equal(doc.querySelector('h4'), null);
        assert.equal(text(doc.querySelector('[data-sg-key="group-by-hand"] > summary')), 'Group scans by hand');
        assert.equal(doc.querySelectorAll('[data-sg-new-member]').length, 3);
    });

    test('starts closed; open and openKeys restore what was open', () => {
        const list = scans(['/', '/p/a', '/p/b']);
        assert.equal(dom(html(list)).querySelector('[data-sg-section]').open, false);
        const doc = dom(html(list, { open: true, openKeys: [KEY('/p/{*}'), 'not-grouped'] }));
        assert.equal(doc.querySelector('[data-sg-section]').open, true);
        assert.equal(doc.querySelector(`[data-sg-key="${KEY('/p/{*}')}"]`).open, true);
        assert.equal(doc.querySelector('[data-sg-key="not-grouped"]').open, true);
    });
});

describe('Patterns found', () => {
    test('each pattern is a checkbox with its label and counts', () => {
        const doc = dom(html(scans(['/', '/products/a', '/products/b', '/products/c'], { 2: { includedInReport: false } })));
        assert.deepEqual(patterns(doc), [['/products/{slug}', '3 scans · 2 of 3 included', false]]);
        const input = doc.querySelector('[data-sg-choose]');
        assert.equal(input.type, 'checkbox');
        assert.equal(input.getAttribute('data-sg-choose'), KEY('/products/{*}'));
        assert.equal(doc.querySelector(`label[for="${input.id}"]`).textContent, '/products/{slug}');
        assert.match(text(doc.querySelector('[aria-labelledby="sg-found-h"] .sg-intro')),
            /1 pattern that the scans' URLs repeat, as pages made from one template do, holding 3 scans of 4\./);
        assert.equal(text(doc.querySelector('[data-sg-key="not-grouped"] > summary')), 'In no pattern 1 scan');
    });

    test('all, both and none included', () => {
        const counts = (list) => patterns(dom(html(list)))[0][1];
        assert.equal(counts(scans(['/p/a', '/p/b', '/p/c'])), '3 scans · all included');
        assert.equal(counts(scans(['/p/a', '/p/b'])), '2 scans · both included');
        assert.equal(counts(scans(['/p/a', '/p/b'], { 0: { includedInReport: false }, 1: { includedInReport: false } })),
            '2 scans · none included');
    });

    test('distinct URLs are shown when fewer than the scans', () => {
        assert.equal(patterns(dom(html(scans(['/p/a', '/p/a', '/p/b']))))[0][1], '3 scans · 2 URLs · all included');
    });

    test('nested patterns are nested; a parent lists the scans no child holds', () => {
        const doc = dom(html(scans(BLOG)));
        assert.deepEqual(patterns(doc), [
            ['/blog/…', '7 scans · all included', false, [
                ['/blog/{slug}/{slug}', '4 scans · all included', false, [
                    ['/blog/a11y/{slug}', '2 scans · both included', false],
                    ['/blog/news/{slug}', '2 scans · both included', false],
                ]],
                ['/blog/{slug}', '2 scans · both included', false],
            ]],
        ]);
        const blog = doc.querySelector(`[data-sg-key="${KEY('/blog/…')}"]`);
        assert.equal(text(blog.querySelector('.sg-caption')), '1 scan in no narrower pattern:');
        assert.equal(text(blog.querySelector(':scope > summary')), 'Scans of /blog/…');
        assert.deepEqual([...blog.querySelectorAll('.sg-members a')].map(text), ['Scan 2']);
        assert.match(text(doc.querySelector('[aria-labelledby="sg-found-h"] .sg-intro')), /^5 patterns/);
    });

    test('scans link to their card, with their URL and their exclusion', () => {
        const doc = dom(html(scans(['/p/a', '/p/b'], { 1: { includedInReport: false } })));
        const items = [...doc.querySelectorAll(`[data-sg-key="${KEY('/p/{*}')}"] .sg-members li`)];
        assert.equal(items[0].querySelector('a').getAttribute('href'), '#sc-s0');
        assert.equal(text(items[0]), 'Scan 1 https://shop.example.com/p/a');
        assert.ok(items[1].classList.contains('scan-summary-excluded'));
        assert.equal(text(items[1].querySelector('.scan-excluded-badge')), 'Excluded');
    });

    test('the host is named only when the patterns span several', () => {
        assert.equal(dom(html(scans(['/p/a', '/p/b']))).querySelector('.sg-host'), null);
        const doc = dom(html(scans([
            'https://www.example.com/p/a', 'https://www.example.com/p/b',
            'https://m.example.com/p/a', 'https://m.example.com/p/b',
        ])));
        assert.deepEqual([...doc.querySelectorAll('.sg-host')].map(text).sort(), ['on m.example.com', 'on www.example.com']);
    });

    test('a chosen pattern is checked', () => {
        const doc = dom(html(scans(['/p/a', '/p/b']), { choice: [{ key: KEY('/p/{*}'), name: null }] }));
        assert.equal(patterns(doc)[0][2], true);
    });

    test('checkbox ids are unique', () => {
        const doc = dom(html(scans(BLOG), { choice: [{ key: KEY('/blog/…') }, { key: KEY('/blog/a11y/{*}') }] }));
        const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
        assert.equal(new Set(ids).size, ids.length);
    });
});

describe('Your groups', () => {
    test('absent until something is chosen, and for chosen keys that match nothing', () => {
        assert.equal(yours(dom(html(scans(BLOG)))), null);
        assert.equal(yours(dom(html(scans(BLOG), { choice: [{ key: 'url:gone', name: 'Old' }] }))), null);
    });

    test('a scan is listed under the narrowest chosen group', () => {
        const doc = dom(html(scans(BLOG), {
            choice: [{ key: KEY('/blog/…'), name: null }, { key: KEY('/blog/a11y/{*}'), name: 'Accessibility posts' }],
        }));
        assert.deepEqual(yours(doc), [
            ['/blog/… 7 scans · all included', ['Scan 2', 'Scan 3', 'Scan 4', 'Scan 7', 'Scan 8'], [
                ['Accessibility posts /blog/a11y/{slug} 2 scans · both included', ['Scan 5', 'Scan 6']],
            ]],
        ]);
        const outer = doc.querySelector(`[data-sg-key="${V.CHOSEN_PREFIX}${KEY('/blog/…')}"]`);
        assert.equal(text(outer.querySelector(':scope > .sg-caption')), '5 scans in no narrower group you chose:');
        assert.equal(text(doc.querySelector('[data-sg-key="not-in-your-groups"] > summary')), 'Not in your groups 1 scan');
    });

    test('a group has a labelled name field and three actions, all keyed to it', () => {
        const key = KEY('/p/{*}');
        const doc = dom(html(scans(['/p/a', '/p/b']), { choice: [{ key, name: 'Products' }] }));
        const group = doc.querySelector(`[data-sg-key="${V.CHOSEN_PREFIX}${key}"]`);
        const input = group.querySelector('input[data-sg-name]');
        assert.equal(input.value, 'Products');
        // The pattern is in the summary; a placeholder would read as a value.
        assert.equal(input.hasAttribute('placeholder'), false);
        assert.equal(input.getAttribute('data-sg-name'), key);
        assert.equal(text(doc.querySelector(`label[for="${input.id}"]`)), 'Name');
        const actions = group.querySelector('[role="group"]');
        assert.equal(actions.getAttribute('aria-label'), 'Scans of Products');
        assert.deepEqual([...actions.querySelectorAll('button')].map((b) => [text(b), b.dataset.sgAction, b.dataset.sgGroup, b.type]), [
            ['Include all', 'include', key, 'button'],
            ['Exclude all', 'exclude', key, 'button'],
            ['Keep one', 'keepOne', key, 'button'],
        ]);
        // Every control can be found again after a redraw.
        const focusKeys = [...doc.querySelectorAll('[data-sg-focus]')].map((el) => el.dataset.sgFocus);
        assert.equal(new Set(focusKeys).size, focusKeys.length);
    });

    test('an unnamed group is shown by its pattern', () => {
        const doc = dom(html(scans(['/p/a', '/p/b']), { choice: [{ key: KEY('/p/{*}'), name: null }] }));
        assert.deepEqual(yours(doc), [['/p/{slug} 2 scans · both included', ['Scan 1', 'Scan 2']]]);
        assert.equal(doc.querySelector('[data-sg-name]').value, '');
    });

    test('a chosen group opens on its own key, apart from the pattern\'s scans', () => {
        const key = KEY('/p/{*}');
        const doc = dom(html(scans(['/p/a', '/p/b']), { choice: [{ key }], openKeys: [V.CHOSEN_PREFIX + key] }));
        assert.equal(doc.querySelector(`[data-sg-key="${V.CHOSEN_PREFIX}${key}"]`).open, true);
        assert.equal(doc.querySelector(`[data-sg-key="${key}"]`).open, false);
    });

    test('names, labels, URLs and ids are escaped', () => {
        const list = [
            { id: 'a"1', label: '<b>x</b>', url: 'https://x.com/p/1?q=<i>' },
            { id: 'a2', label: 'y', url: 'https://x.com/p/2?q=2' },
        ];
        const result = G.findGroups(list, { sources: [U.createUrlGroupSource()] });
        const h = V.sectionHTML(result, list, { choice: [{ key: result.groups[0].key, name: '<script>' }] });
        assert.doesNotMatch(h, /<b>x<\/b>|<i>|<script>/);
        assert.match(h, /href="#sc-a&quot;1">&lt;b&gt;x&lt;\/b&gt;/);
    });

    test('groups from a source without hosts or URL counts work the same', () => {
        const list = scans(['/a', '/b', '/c']);
        const result = G.findGroups(list, {
            sources: [{ id: 'markup', propose: () => [{ key: 't', label: 'Product template', members: ['s0', 's2'] }] }],
        });
        const doc = dom(V.sectionHTML(result, list, { choice: [{ key: 'markup:t', name: null }] }));
        assert.deepEqual(patterns(doc), [['Product template', '2 scans · both included', true]]);
        assert.deepEqual(yours(doc), [['Product template 2 scans · both included', ['Scan 1', 'Scan 3']]]);
    });
});

describe('Changing groups by hand (step 7)', () => {
    const C = require('./scan-group-choice.js');
    // The URL groups and the groups by hand, as the app finds them.
    function htmlWith(list, choice) {
        const result = G.findGroups(list, { sources: [U.createUrlGroupSource(), C.createManualGroupSource(choice)] });
        return V.sectionHTML(result, list, { choice: C.readChoice({ scanGrouping: { patterns: choice } }) });
    }
    const SHOP = ['/', '/p/a', '/p/b', '/p/c', '/about'];
    const P = KEY('/p/{*}');

    test('a merged group lists its scans to take out, those taken out to put back, and the others to add', () => {
        const doc = dom(htmlWith(scans(SHOP), [{ key: P, merge: true, remove: ['s2'], add: ['s4'] }]));
        const group = doc.querySelector(`[data-sg-key="${V.CHOSEN_PREFIX}${P}"]`);
        const lists = group.querySelectorAll(':scope > ul.sg-members');
        const row = (li) => [text(li.querySelector('a')), li.querySelector('button').textContent, li.querySelector('button').getAttribute('aria-label')];
        assert.deepEqual([...lists[0].children].map(row), [
            ['Scan 2', 'Take out', 'Take out Scan 2'],
            ['Scan 4', 'Take out', 'Take out Scan 4'],
            ['Scan 5', 'Take out', 'Take out Scan 5'],
        ]);
        assert.equal(text(lists[0].children[2].querySelector('.sg-host')), 'added by hand');
        assert.deepEqual([...lists[1].children].map(row), [['Scan 3', 'Put back', 'Put back Scan 3']]);
        const select = group.querySelector('select[data-sg-add-select]');
        assert.equal(text(doc.querySelector(`label[for="${select.id}"]`)), `Add a scan to /p/{slug}`);
        assert.deepEqual([...select.options].map((o) => o.value), ['', 's0']);
        assert.equal(group.querySelector('button[data-sg-add]').getAttribute('data-sg-add'), P);
    });

    test('a group by hand shows under Your groups, not among the patterns found', () => {
        const { choice } = C.addManualGroup([], { name: 'Info pages', members: ['s0', 's4'] });
        const doc = dom(htmlWith(scans(SHOP), choice));
        assert.match(text(doc.querySelector('[data-sg-key="chosen:manual:1"] > summary')), /^Info pages 2 scans/);
        assert.equal(doc.querySelector('[data-sg-choose="manual:1"]'), null);
        assert.deepEqual(patterns(doc).map((p) => p[0]), ['/p/{slug}']);
    });

    test('the form for a group by hand: a labelled name, every scan to pick, and merge on', () => {
        const doc = dom(htmlWith(scans(SHOP), []));
        const form = doc.querySelector('[data-sg-key="group-by-hand"]');
        const name = form.querySelector('[data-sg-new-name]');
        assert.equal(text(doc.querySelector(`label[for="${name.id}"]`)), 'Name');
        assert.equal(text(form.querySelector('legend')), 'Scans');
        assert.deepEqual([...form.querySelectorAll('[data-sg-new-member]')].map((i) => i.getAttribute('data-sg-new-member')), ['s0', 's1', 's2', 's3', 's4']);
        assert.equal(form.querySelector('[data-sg-new-merge]').checked, true);
        assert.equal(text(form.querySelector('[data-sg-new-group]')), 'Make the group');
        const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
        assert.equal(new Set(ids).size, ids.length);
    });
});

describe('the counts of a group changed by hand', () => {
    const C = require('./scan-group-choice.js');
    test('count the scans as left by hand', () => {
        const list = scans(['/', '/p/a', '/p/b', '/p/c', '/about']);
        const choice = [{ key: KEY('/p/{*}'), merge: true, remove: ['s1', 's2'], add: ['s4'] }];
        const result = G.findGroups(list, { sources: [U.createUrlGroupSource(), C.createManualGroupSource(choice)] });
        const doc = dom(V.sectionHTML(result, list, { choice: C.readChoice({ scanGrouping: { patterns: choice } }) }));
        assert.match(text(doc.querySelector(`[data-sg-key="${V.CHOSEN_PREFIX}${KEY('/p/{*}')}"] > summary`)), /2 scans · both included$/);
    });
});
