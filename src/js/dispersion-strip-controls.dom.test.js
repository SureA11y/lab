'use strict';

// The scan strips' controls (issue-dispersion-view.js): the rule filter and
// the column height switch, driven by the delegated interaction layer from
// what the markup carries.

const {test, describe, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

const D = require('../shared/issue-dispersion.js');
const V = require('../shared/issue-dispersion-view.js');

function scan(i, fails) {
    return {
        id: `s${i}`, label: `Page ${i + 1}`,
        canonical: {
            findings: Object.entries(fails).map(([ruleId, n]) => ({
                ruleId, outcome: 'fail', impact: 'serious',
                occurrences: Array.from({length: n}, (_, k) => ({target: [`#e${k}`]})),
            })),
        },
    };
}
// region everywhere (widespread); color-contrast heavy in scan 3; link-name in two scans.
function run(n) {
    return Array.from({length: n}, (_, i) => scan(i, {
        region: 1,
        ...(i === 3 ? {'color-contrast': 100} : {}),
        ...(i === 1 || i === 6 ? {'link-name': 2} : {}),
    }));
}

let doc, win;
function mount(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {pretendToBeVisual: true});
    win = dom.window;
    doc = win.document;
    V.installDispersionInteractions(doc);
    return doc;
}
function fire(el, type) {
    el.dispatchEvent(new win.Event(type, {bubbles: true}));
}
function click(el) {
    el.dispatchEvent(new win.MouseEvent('click', {bubbles: true}));
}
function check(value, on = true) {
    const box = doc.querySelector(`.dsp-filter-panel input[value="${value}"]`);
    box.checked = on;
    fire(box, 'change');
}
function setHeight(mode) {
    const radio = doc.querySelector(`.dsp-seg input[value="${mode}"]`);
    radio.checked = true;
    fire(radio, 'change');
}
// Column heights, scan by scan, of a strip's svg.
function heights(strip) {
    const n = JSON.parse(strip.getAttribute('data-dsp-strip')).length;
    const h = new Array(n).fill(0);
    strip.querySelectorAll('rect.dsp-s-wide, rect.dsp-s-other').forEach((r) => {
        h[Number(r.getAttribute('x')) / 4] += Number(r.getAttribute('height'));
    });
    return h;
}
const status = () => doc.querySelector('[data-dsp-status]').textContent;

describe('report view strip controls', () => {
    let section;
    beforeEach(() => {
        mount(V.reportSectionHTML(D.analyseDispersion(run(10)), {id: 'r'}));
        section = doc.querySelector('[data-dsp-section]');
    });

    test('opens on every rule counted by rule, as before', () => {
        const strip = doc.querySelector('[data-dsp-strip]');
        assert.equal(doc.querySelectorAll('.dsp-filter-panel input[type="checkbox"]').length, 3);
        assert.match(status(), /^Counting all 3 failing rules\. Tallest column: 2 rules \(scan 2\)\.$/);
        const h = heights(strip);
        assert.ok(h[1] > h[0] && h[0] > 0, 'two rules stand taller than one');
        assert.equal(doc.querySelector('[data-dsp-chips]').hidden, true);
    });

    test('filtering counts only the picked rules, and says so', () => {
        check('link-name');
        const strip = doc.querySelector('[data-dsp-strip]');
        const h = heights(strip);
        assert.deepEqual(h.map((x) => x > 0), [false, true, false, false, false, false, true, false, false, false]);
        assert.equal(strip.querySelectorAll('rect.dsp-s-clean').length, 8);
        assert.match(status(), /^Counting 1 of 3 failing rules\. Tallest column: 1 rule \(scan 2\)\. Switch the height to failing elements/);
        assert.equal(doc.querySelector('[data-dsp-clean]').textContent, 'None of the selected rules fail here');
        assert.ok(doc.querySelector('.dsp-strips').classList.contains('dsp-strips--filtered'));
        assert.equal(doc.querySelector('.dsp-filter-n').textContent, '1');
        assert.equal(doc.querySelector('[data-dsp-filter-toggle]').getAttribute('aria-label'), 'Filter rules, 1 selected');
        const chips = doc.querySelectorAll('[data-dsp-unselect]');
        assert.deepEqual(Array.from(chips, (c) => c.getAttribute('data-dsp-unselect')), ['link-name']);
    });

    test('the strip table follows the filter', () => {
        check('color-contrast');
        const rows = doc.querySelectorAll('[data-dsp-strip-table] tbody tr');
        assert.equal(rows.length, 1);
        assert.deepEqual(Array.from(rows[0].children, (c) => c.textContent), ['4', 'Page 4', '0', '1', '100', 'color-contrast']);
        assert.match(doc.querySelector('[data-dsp-strip-table] caption').textContent, /none of the other 9 scans/);
    });

    test('failing elements go on a square-root scale', () => {
        setHeight('elements');
        const h = heights(doc.querySelector('[data-dsp-strip]'));
        // scan 4 has 101 elements, scans 2 and 7 have 3, the rest 1.
        const unit = (96 - 4) / Math.sqrt(101);
        // Less the gap between the widespread and the other segment.
        assert.ok(Math.abs(h[3] - (Math.sqrt(101) * unit - 1.5)) < 0.05);
        assert.ok(Math.abs(h[0] - unit) < 0.05);
        assert.match(status(), /Tallest column: 101 failing elements \(scan 4\), on a square-root scale\./);
        assert.match(section.querySelector('[data-dsp-height-help]').textContent, /failing elements in that scan, on a square-root scale/);
    });

    test('the slider and the tooltip read what the strip counts', () => {
        check('link-name');
        const strip = doc.querySelector('[data-dsp-strip]');
        strip.focus();
        fire(strip, 'focusin');
        strip.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
        assert.equal(strip.getAttribute('aria-valuetext'), 'Scan 1 of 10 · Page 1: none of the selected rules fail');
        strip.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
        assert.equal(strip.getAttribute('aria-valuetext'), 'Scan 2 of 10 · Page 2: 1 selected rule failing (0 widespread, 1 other), 2 failing elements');
    });

    test('removing the last chip, or clearing, counts every rule again', () => {
        check('link-name');
        check('region');
        click(doc.querySelector('[data-dsp-unselect="link-name"]'));
        assert.equal(doc.activeElement.getAttribute('data-dsp-unselect'), 'region', 'focus moves to the next chip');
        click(doc.querySelector('[data-dsp-unselect="region"]'));
        assert.ok(doc.activeElement.matches('[data-dsp-filter-toggle]'));
        assert.match(status(), /^Counting all 3/);
        check('region');
        click(doc.querySelector('[data-dsp-chips] [data-dsp-clear]'));
        assert.equal(doc.querySelectorAll('.dsp-filter-panel input:checked').length, 0);
    });

    test('the rule list opens, finds, and closes on Escape', () => {
        const btn = doc.querySelector('[data-dsp-filter-toggle]');
        const panel = doc.querySelector('.dsp-filter-panel');
        click(btn);
        assert.equal(panel.hidden, false);
        assert.equal(btn.getAttribute('aria-expanded'), 'true');
        const find = panel.querySelector('[data-dsp-find]');
        assert.equal(doc.activeElement, find);
        find.value = 'LINK';
        fire(find, 'input');
        assert.deepEqual(Array.from(panel.querySelectorAll('[data-dsp-rule]:not([hidden])'), (o) => o.getAttribute('data-dsp-rule')), ['link-name']);
        find.value = 'zzz';
        fire(find, 'input');
        assert.equal(panel.querySelector('[data-dsp-nomatch]').hidden, false);
        find.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        assert.equal(panel.hidden, true);
        assert.equal(doc.activeElement, btn);
        click(btn);
        click(doc.body);
        assert.equal(panel.hidden, true, 'a click elsewhere closes it');
    });

    test('the view is kept in the markup, so a saved copy opens on it', () => {
        check('color-contrast');
        setHeight('elements');
        const copy = mount(section.outerHTML);
        assert.equal(copy.querySelector('.dsp-filter-panel input[value="color-contrast"]').checked, true);
        assert.equal(copy.querySelector('.dsp-seg input[value="elements"]').checked, true);
        assert.deepEqual(V.stripsView(copy.body), {mode: 'elements', rules: ['color-contrast']});
        check('link-name');
        assert.deepEqual(V.stripsView(copy.body).rules, ['color-contrast', 'link-name']);
    });

    test('a view carried over a re-render drops rules that are gone', () => {
        mount(V.reportSectionHTML(D.analyseDispersion(run(10)), {id: 'r'}));
        V.setStripsView(doc.body, {mode: 'elements', rules: ['link-name', 'gone']});
        assert.deepEqual(V.stripsView(doc.body), {mode: 'elements', rules: ['link-name']});
        assert.match(status(), /^Counting 1 of 3 failing rules\. Tallest column: 2 failing elements/);
    });
});

describe('compare strip controls', () => {
    test('one filter drives every strip, on one shared scale', () => {
        const a = D.analyseDispersion(run(10));
        const b = D.analyseDispersion(run(10).map((s, i) => (i === 3 ? scan(3, {'color-contrast': 4}) : scan(i, {}))));
        const series = D.seriesDispersion([a, b, D.analyseDispersion(run(10))]);
        mount(V.seriesBodyHTML(series, {labels: ['v1', 'v2', 'v3'], mode: 'trend'}));
        assert.equal(doc.querySelectorAll('[data-dsp-strips]').length, 1);
        assert.match(doc.querySelector('.dsp-opt[data-dsp-rule="region"] .dsp-opt-meta').textContent, /^2 of 3 reports · up to 100% of scans$/);
        check('color-contrast');
        setHeight('elements');
        const strips = doc.querySelectorAll('[data-dsp-strip]');
        const tall = heights(strips[0])[3], short = heights(strips[1])[3];
        assert.ok(Math.abs(short / tall - Math.sqrt(4) / Math.sqrt(100)) < 0.01, 'v2 is measured against v1\'s tallest column');
        assert.match(status(), /Tallest column: 100 failing elements \(scan 4 of v1\)/);
    });

    test('pair view: hotspots hide while filtered', () => {
        const a = D.analyseDispersion(run(10));
        const b = D.analyseDispersion(run(10).map((s, i) => (i < 2 ? scan(i, {label: 3}) : scan(i, {}))));
        mount(V.pairBodyHTML(D.compareDispersion(a, b), {labelA: 'A', labelB: 'B'}));
        assert.equal(doc.querySelectorAll('.dsp-filter-panel input[type="checkbox"]').length, 4);
        check('label');
        assert.ok(doc.querySelector('.dsp-strips').classList.contains('dsp-strips--filtered'));
        assert.match(status(), /scan 1 of B/);
    });
});
