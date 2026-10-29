'use strict';

// DOM tests for the two gauge builders under jsdom, focused on the accessibility
// contract stated at the top of ui-gauge.js: the drawing is decorative, the value
// reaches assistive tech as a semantic <meter>, the rating band prints as a word
// beside the number, and a pass-rate reading never stands alone as a bare
// percentage. node's test runner isolates each file in its own process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let buildScoreGauge;
let buildRatingGauge;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;

    ({buildScoreGauge, buildRatingGauge} = await import('./ui-gauge.js'));
});

beforeEach(() => {
    document.body.innerHTML = '';
});

const BANDS = [
    {from: 0, to: 40, label: 'High risk', key: 'bad'},
    {from: 40, to: 60, label: 'Significant risk', key: 'warn'},
    {from: 60, to: 80, label: 'Moderate risk', key: 'ok'},
    {from: 80, to: 100, label: 'Low risk', key: 'good'},
];

const score = (opts = {}) => buildScoreGauge({name: 'Pass rate', value: 72, ...opts});
const rating = (opts = {}) => buildRatingGauge({name: 'Risk', value: 72, intervals: BANDS, ...opts});

// Every glyph that is repeated by adjacent words, so it must never be announced.
const DECORATIVE_GLYPHS = ['?'];

function assertGlyphsHidden(root) {
    const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
    let node;
    while ((node = walker.nextNode())) {
        for (const glyph of DECORATIVE_GLYPHS) {
            if (!node.textContent.includes(glyph)) continue;
            const owner = node.parentElement;
            assert.equal(
                owner.getAttribute('aria-hidden'), 'true',
                `"${glyph}" is announced inside <${owner.tagName.toLowerCase()} class="${owner.className}">`
            );
        }
    }
}

describe('buildScoreGauge — accessibility invariants', () => {
    test('the drawing is hidden from assistive tech', () => {
        const svg = score().querySelector('svg');
        assert.ok(svg);
        assert.equal(svg.getAttribute('aria-hidden'), 'true');
    });

    test('the value reaches assistive tech as a labelled meter', () => {
        const root = score({value: 72});
        const meter = root.querySelector('meter');

        assert.ok(meter, 'the arc must be backed by a semantic meter');
        assert.equal(meter.getAttribute('value'), '72');
        assert.equal(meter.getAttribute('min'), '0');
        assert.equal(meter.getAttribute('max'), '100');

        const labelId = meter.getAttribute('aria-labelledby');
        assert.ok(labelId, 'the meter must be labelled');
        assert.equal(root.querySelector(`#${labelId}`).textContent, 'Pass rate');
    });

    test('the container names itself from the same heading the meter uses', () => {
        const root = score();
        const labelId = root.getAttribute('aria-labelledby');
        assert.ok(labelId);
        assert.equal(root.querySelector(`#${labelId}`).tagName, 'H4');
    });

    test("the unresolved share prints as words, with the glyph decorative", () => {
        const root = score({unresolvedPct: 12});
        const unresolved = root.querySelector('.scoreGauge__unresolved');

        assert.ok(unresolved, 'a pass-rate reading must state its unresolved share');
        assert.match(unresolved.textContent, /12% can't tell/);
        assertGlyphsHidden(root);
    });

    test('the announced text drops the bare glyph but keeps the meaning', () => {
        const root = score({unresolvedPct: 12});
        const unresolved = root.querySelector('.scoreGauge__unresolved');

        const announced = [...unresolved.childNodes]
            .filter((n) => !(n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true'))
            .map((n) => n.textContent)
            .join('')
            .trim();

        assert.equal(announced, "12% can't tell");
    });

    test('no unresolved line is drawn when there is nothing unresolved', () => {
        assert.equal(score({unresolvedPct: 0}).querySelector('.scoreGauge__unresolved'), null);
        assert.equal(score().querySelector('.scoreGauge__unresolved'), null);
    });
});

describe('buildRatingGauge — accessibility invariants', () => {
    test('the speedometer drawing is hidden from assistive tech', () => {
        const svg = rating().querySelector('svg');
        assert.ok(svg);
        assert.equal(svg.getAttribute('aria-hidden'), 'true');
    });

    test('the band prints as a word beside the number, not only as colour', () => {
        const root = rating({value: 72});
        const status = root.querySelector('.scoreGauge__status');

        assert.ok(status, 'the band label must be rendered');
        assert.equal(status.textContent, 'Moderate risk');
        assert.equal(status.dataset.band, 'ok');
        assert.ok(root.querySelector('.scoreGauge__value').textContent.includes('72'));
    });

    test('each band across the scale still names itself', () => {
        for (const [value, label] of [[10, 'High risk'], [50, 'Significant risk'], [72, 'Moderate risk'], [95, 'Low risk']]) {
            assert.equal(rating({value}).querySelector('.scoreGauge__status').textContent, label,
                `value ${value} must print its band name`);
        }
    });

    test('the value reaches assistive tech as a labelled meter', () => {
        const root = rating({value: 72});
        const meter = root.querySelector('meter');

        assert.ok(meter);
        assert.equal(meter.getAttribute('value'), '72');
        assert.equal(root.querySelector(`#${meter.getAttribute('aria-labelledby')}`).textContent, 'Risk');
    });

    test('bands carry a stripe pattern so the reading survives greyscale', () => {
        const root = rating();
        const patterns = root.querySelectorAll('defs pattern');
        assert.equal(patterns.length, BANDS.length, 'every band needs its own stripe overlay');

        const angles = [...patterns].map((p) => p.getAttribute('patternTransform'));
        assert.ok(new Set(angles).size > 1, 'stripe direction must alternate, or the overlay adds no distinction');
    });

    test("the unresolved share prints as words, with the glyph decorative", () => {
        const root = rating({unresolvedPct: 8});
        const unresolved = root.querySelector('.scoreGauge__unresolved');

        assert.ok(unresolved);
        assert.match(unresolved.textContent, /8% can't tell/);
        assertGlyphsHidden(root);
    });

    test('a value outside the scale still reports a band rather than nothing', () => {
        assert.equal(rating({value: 250}).querySelector('.scoreGauge__status').textContent, 'Low risk');
        assert.equal(rating({value: -50}).querySelector('.scoreGauge__status').textContent, 'High risk');
    });

    test('a single-band scale still names its band', () => {
        const root = buildRatingGauge({
            name: 'Solo', value: 50,
            intervals: [{from: 0, to: 100, label: 'Everything', key: 'all'}]
        });
        assert.equal(root.querySelector('.scoreGauge__status').textContent, 'Everything');
    });
});

describe('gauge string output', () => {
    test('asText preserves the meter and the hidden drawing', () => {
        const html = buildRatingGauge({name: 'Risk', value: 72, intervals: BANDS, asText: true, unresolvedPct: 8});

        assert.equal(typeof html, 'string');
        assert.match(html, /<meter[^>]*aria-labelledby=/);
        assert.match(html, /<svg[^>]*aria-hidden="true"/);
        assert.match(html, /aria-hidden="true">\?<\/span>/);
        assert.match(html, /Moderate risk/);
    });
});
