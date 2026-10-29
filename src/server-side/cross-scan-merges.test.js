'use strict';

// The three merges that combine a run's scans at its end (findingsByOutcome,
// getA11yGlobalFindings, buildGlobalSummary) give what they always gave, in
// time linear in the occurrences: they used to re-key every occurrence merged
// so far on each merge, and a 150-scan run over distinct pages held the
// server's event loop for some 20 seconds.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { findingsByOutcome } = require('./a11y-canonical');
const { getA11yGlobalFindings } = require('./a11y-runner');
const { buildGlobalSummary } = require('./metrics/global-summary');

const occ = (target, extra = {}) => ({ target: [target], html: '<img>', failureSummary: 'Fix it', ...extra });
const scan = (url, findings) => ({ url, canonical: { findings } });
const fail = (uid, occurrences, extra = {}) => ({ uid, outcome: 'fail', severity: 'serious', occurrences, ...extra });

/** The old findingsByOutcome dedupe: every merge rebuilt from all held so far. */
function referenceFindingsByOutcome(scans) {
    const keyOf = (o) => {
        if (typeof o.uid === 'string') return `uid:${o.uid}`;
        if (typeof o.key === 'string') return `key:${o.key}`;
        if (typeof o.selector === 'string' && typeof o.html === 'string') return `sel+html:${o.selector}::${o.html}`;
        if (typeof o.selector === 'string') return `sel:${o.selector}`;
        return JSON.stringify(o);
    };
    const unique = (arr, k) => { const s = new Set(); return arr.filter((x) => (s.has(k(x)) ? false : (s.add(k(x)), true))); };
    const out = { fail: [], pass: [], cantTell: [], notApplicable: [] };
    for (const outcome of Object.keys(out)) {
        const byUid = new Map();
        for (const s of scans) {
            for (const f of s.canonical.findings) {
                if (f.outcome !== outcome) continue;
                const urls = typeof s.url === 'string' && s.url ? [s.url] : [];
                const held = byUid.get(f.uid);
                if (!held) byUid.set(f.uid, { ...f, url: urls, occurrences: unique(f.occurrences || [], keyOf) });
                else {
                    held.url = unique([...held.url, ...urls], String);
                    held.occurrences = unique([...held.occurrences, ...(f.occurrences || [])], keyOf);
                }
            }
        }
        out[outcome] = [...byUid.values()];
    }
    return out;
}

/** Random scans over a few pages, rules and elements, with repeats. */
function randomScans(seed, count) {
    let x = seed;
    const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    return Array.from({ length: count }, (_, i) => scan(pick(['https://a.test/', 'https://b.test/']), Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
        uid: pick(['r1', 'r2', 'r3']),
        outcome: pick(['fail', 'cantTell', 'pass']),
        occurrences: Array.from({ length: Math.floor(rnd() * 5) }, () => occ(pick(['#a', '#b', 'img']), {
            failureSummary: pick(['Fix it', 'Check it']),
            ...(rnd() < 0.5 ? { pageUrl: pick(['https://a.test/', 'https://b.test/']) } : {}),
            ...(rnd() < 0.2 ? { selector: pick(['#a', 'img']) } : {}),
            ...(i % 7 === 0 ? { hint: 'differs only here' } : {}),
        })),
    }))));
}

describe('findingsByOutcome', () => {
    test('merges as it always did', () => {
        for (let seed = 1; seed <= 50; seed += 1) {
            const scans = randomScans(seed, 30);
            assert.deepEqual(findingsByOutcome(scans), referenceFindingsByOutcome(scans), `seed ${seed}`);
        }
    });

    test('keeps occurrences of the same element that differ in anything, drops exact repeats', () => {
        const scans = [
            scan('https://a.test/', [fail('r', [occ('#a'), occ('#a', { hint: 'other' })])]),
            scan('https://a.test/', [fail('r', [occ('#a'), occ('#a', { hint: 'other' }), occ('#b')])]),
        ];
        assert.deepEqual(findingsByOutcome(scans).fail[0].occurrences.map((o) => [o.target[0], o.hint || null]),
            [['#a', null], ['#a', 'other'], ['#b', null]]);
    });

    test('serializes no occurrence when none shares a page, target and html with another', () => {
        const scans = Array.from({ length: 50 }, (_, i) => scan(`https://site.test/${i}`, [
            fail('r', Array.from({ length: 20 }, (_, j) => occ(`#e${j}`, { pageUrl: `https://site.test/${i}` }))),
        ]));
        const stringify = JSON.stringify;
        let calls = 0;
        JSON.stringify = (...args) => { calls += 1; return stringify(...args); };
        try {
            assert.equal(findingsByOutcome(scans).fail[0].occurrences.length, 1000);
        } finally {
            JSON.stringify = stringify;
        }
        assert.equal(calls, 0);
    });
});

describe('getA11yGlobalFindings', () => {
    test('merges each rule across scans, occurrences once each', () => {
        const scans = [
            scan('https://a.test/', [fail('r', [occ('#a', { pageUrl: 'https://a.test/' }), occ('#a', { pageUrl: 'https://a.test/' })], { wcag: { sc: ['1.1.1'] } })]),
            scan('https://b.test/', [fail('r', [occ('#a', { pageUrl: 'https://a.test/' }), occ('#a', { pageUrl: 'https://b.test/' })], { wcag: { sc: ['4.1.2'] } })]),
        ];
        const [merged] = getA11yGlobalFindings(scans).fail;
        assert.deepEqual(merged.occurrences.map((o) => o.pageUrl), ['https://a.test/', 'https://b.test/']);
        assert.deepEqual(merged.wcag.sc, ['1.1.1', '4.1.2']);
    });
});

describe('buildGlobalSummary', () => {
    const reach = (scans) => buildGlobalSummary({ scans, options: {} }).a11ySummary.occurrences.reach[0].occurrences;

    test('an occurrence with no pageUrl is the same one on every scan it is merged from', () => {
        assert.equal(reach([scan('https://a.test/', [fail('r', [occ('#a')])]), scan('https://b.test/', [fail('r', [occ('#a')])])]), 1);
    });

    test('one with a pageUrl is matched by it, against those with and without one', () => {
        const scans = [
            scan('https://a.test/', [fail('r', [occ('#a', { pageUrl: 'https://a.test/' })])]),
            scan('https://b.test/', [fail('r', [occ('#a', { pageUrl: 'https://a.test/' }), occ('#a', { pageUrl: 'https://b.test/' })])]),
            scan('https://b.test/', [fail('r', [occ('#a')])]),
        ];
        assert.equal(reach(scans), 2, 'the a.test one once, the b.test one once, and the bare one on b.test is it');
    });
});
