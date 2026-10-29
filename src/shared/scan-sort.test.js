'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./scan-sort.js');

const scan = (failCount, occurrenceCount) => ({ summary: { failCount, occurrenceCount } });

describe('scanSortValues', () => {
    test('reads failures and occurrences from the summary', () => {
        assert.deepEqual(S.scanSortValues(scan(3, 12)), { failures: 3, occurrences: 12 });
    });
    test('missing summary yields zeros', () => {
        assert.deepEqual(S.scanSortValues({}), { failures: 0, occurrences: 0 });
        assert.deepEqual(S.scanSortValues(null), { failures: 0, occurrences: 0 });
    });
    test('falls back to canonical findings when summary lacks the fields', () => {
        const scan = {
            canonical: {
                findings: [
                    { outcome: 'fail', occurrences: [{}, {}, {}] },
                    { outcome: 'fail', occurrences: [{}] },
                    { outcome: 'pass', occurrences: [{}, {}] },
                    { outcome: 'cantTell', occurrences: [{}] },
                ],
            },
        };
        assert.deepEqual(S.scanSortValues(scan), { failures: 2, occurrences: 4 });
    });
    test('summary wins over canonical when present', () => {
        const scan = { summary: { failCount: 1, occurrenceCount: 9 }, canonical: { findings: [{ outcome: 'fail', occurrences: [{}, {}] }] } };
        assert.deepEqual(S.scanSortValues(scan), { failures: 1, occurrences: 9 });
    });
});

describe('scanSortAttrs', () => {
    test('emits order, failures and occurrences', () => {
        assert.equal(
            S.scanSortAttrs(scan(3, 12), 5),
            'data-sort-order="5" data-sort-failures="3" data-sort-occurrences="12"'
        );
    });
    test('non-numeric order falls back to 0', () => {
        assert.match(S.scanSortAttrs(scan(1, 1), undefined), /data-sort-order="0"/);
    });
});

describe('compareByKey', () => {
    const a = { order: 0, failures: 2, occurrences: 40 };
    const b = { order: 1, failures: 5, occurrences: 10 };

    test('failures: most first', () => {
        assert.ok(S.compareByKey(a, b, 'failures') > 0); // b (5) before a (2)
        assert.ok(S.compareByKey(b, a, 'failures') < 0);
    });
    test('occurrences: most first', () => {
        assert.ok(S.compareByKey(a, b, 'occurrences') < 0); // a (40) before b (10)
    });
    test('default: workflow order ascending', () => {
        assert.ok(S.compareByKey(a, b, 'default') < 0); // order 0 before 1
    });
    test('ties fall back to order (stable)', () => {
        const x = { order: 3, failures: 4, occurrences: 0 };
        const y = { order: 1, failures: 4, occurrences: 0 };
        assert.ok(S.compareByKey(x, y, 'failures') > 0); // equal failures -> order 1 first
    });
    test('unknown key id falls back to default', () => {
        assert.ok(S.compareByKey(a, b, 'nope') < 0); // default order
    });
});

describe('SORT_KEYS', () => {
    test('exposes the v1 keys with labels', () => {
        assert.deepEqual(S.SORT_KEYS.map((k) => k.id), ['default', 'failures', 'occurrences']);
        assert.equal(S.keyById('failures').label, 'Total failures (desc)');
        assert.equal(S.keyById('missing').id, 'default');
    });
});

// A minimal DOM stand-in exercises sortContainer without a browser: children
// with getAttribute/hasAttribute plus appendChild move-on-insert semantics.
describe('sortContainer (fake DOM)', () => {
    function makeEl(order, failures, occurrences) {
        const attrs = { 'data-sort-order': String(order), 'data-sort-failures': String(failures), 'data-sort-occurrences': String(occurrences) };
        return {
            attrs,
            hasAttribute: (n) => n in attrs,
            getAttribute: (n) => attrs[n],
        };
    }
    function makeContainer(els) {
        const children = els.slice();
        return {
            children,
            appendChild(node) {
                if (node.__frag) {
                    node.nodes.forEach((n) => this.appendChild(n));
                    return;
                }
                const i = children.indexOf(node);
                if (i !== -1) children.splice(i, 1);
                children.push(node);
            },
            order() { return children.map((c) => c.attrs['data-sort-order']); },
        };
    }
    const origFrag = global.document;
    function withFakeDoc(fn) {
        global.document = { createDocumentFragment: () => ({ __frag: true, nodes: [], appendChild(n) { this.nodes.push(n); } }) };
        try { fn(); } finally { global.document = origFrag; }
    }

    test('reorders by failures, most first', () => {
        withFakeDoc(() => {
            const c = makeContainer([makeEl(0, 2, 0), makeEl(1, 9, 0), makeEl(2, 5, 0)]);
            S.sortContainer(c, 'failures');
            assert.deepEqual(c.order(), ['1', '2', '0']); // 9, 5, 2
        });
    });
    test('default restores workflow order', () => {
        withFakeDoc(() => {
            const c = makeContainer([makeEl(2, 5, 0), makeEl(0, 2, 0), makeEl(1, 9, 0)]);
            S.sortContainer(c, 'default');
            assert.deepEqual(c.order(), ['0', '1', '2']);
        });
    });
    // A long report is sorted after each batch of scans it draws: cards already
    // in order are not moved, as moving one takes an open dialog in it out of
    // the top layer.
    test('cards already in order are left in place', () => {
        withFakeDoc(() => {
            const c = makeContainer([makeEl(0, 2, 0), makeEl(1, 9, 0), makeEl(2, 5, 0)]);
            let moved = 0;
            const append = c.appendChild;
            c.appendChild = function (node) { moved += 1; return append.call(this, node); };
            S.sortContainer(c, 'default');
            assert.equal(moved, 0);
            assert.deepEqual(c.order(), ['0', '1', '2']);
        });
    });
    test('moves cards with moveBefore where the browser has it', () => {
        withFakeDoc(() => {
            const c = makeContainer([makeEl(1, 0, 0), makeEl(0, 0, 0)]);
            c.appendChild = () => assert.fail('appended instead of moved');
            c.moveBefore = function (node, before) {
                assert.equal(before, null);
                this.children.splice(this.children.indexOf(node), 1);
                this.children.push(node);
            };
            S.sortContainer(c, 'default');
            assert.deepEqual(c.order(), ['0', '1']);
        });
    });
    test('an open modal dialog among the moved cards is shown modal again', () => {
        withFakeDoc(() => {
            const c = makeContainer([makeEl(1, 0, 0), makeEl(0, 0, 0)]);
            const calls = [];
            let modal = true;
            const dialog = {
                isConnected: true,
                matches: (sel) => sel === ':modal' && modal,
                removeAttribute: (n) => calls.push('remove ' + n),
                showModal: () => { calls.push('showModal'); modal = true; },
            };
            c.querySelectorAll = (sel) => (sel === 'dialog[open]' ? [dialog] : []);
            const append = c.appendChild;
            c.appendChild = function (node) { modal = false; return append.call(this, node); };
            S.sortContainer(c, 'default');
            assert.deepEqual(c.order(), ['0', '1']);
            assert.deepEqual(calls, ['remove open', 'showModal']);
        });
    });
});
