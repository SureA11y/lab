'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const D = require('./issue-dispersion.js');
const V = require('./issue-dispersion-view.js');

// A scan whose failing rules are given as { ruleId: elementCount }.
function scan(i, rules = {}, extra = {}) {
    const findings = Object.entries(rules).map(([ruleId, n]) => ({
        ruleId, id: ruleId, title: `${ruleId} title`, severity: extra.severity || 'serious', outcome: 'fail',
        occurrences: Array.from({ length: n }, (_, k) => ({ target: [`#${ruleId}-${k}`] })),
    }));
    return { id: `s${i}`, label: extra.label || `Step ${i + 1}`, canonical: { findings }, ...extra.scan };
}
function run(n, rulesAt) {
    return Array.from({ length: n }, (_, i) => scan(i, rulesAt(i), { label: labelAt(i) }));
}
function labelAt(i) {
    if (i >= 118 && i < 125) return 'Payment';
    return i < 118 ? 'Browse' : 'Account';
}
const range = (a, b) => (i) => i >= a && i < b;

describe('analyseDispersion — metrics', () => {
    test('same three rules in every scan: widespread, full footprint', () => {
        const r = D.analyseDispersion(run(300, () => ({ region: 1, 'link-name': 2, 'color-contrast': 1 })));
        assert.equal(r.scansAnalyzed, 300);
        assert.equal(r.rulesFailing, 3);
        assert.equal(r.affectedScans, 300);
        assert.equal(r.affectedRate, 1);
        assert.equal(r.footprint, 1);
        assert.equal(r.pattern, 'widespread');
        assert.deepEqual(r.bands, { widespread: 3, partial: 0, local: 0 });
        assert.equal(r.rules.find((x) => x.ruleId === 'link-name').intensity, 2);
        assert.equal(r.rules[0].kind, 'component');
        assert.equal(r.hotspots.length, 0);
    });

    test('same three rules in only five scans: concentrated, with a named hotspot', () => {
        const inPay = range(118, 123);
        const r = D.analyseDispersion(run(300, (i) => (inPay(i) ? { region: 1, 'link-name': 3, 'color-contrast': 4 } : {})));
        assert.equal(r.rulesFailing, 3);
        assert.equal(r.affectedScans, 5);
        assert.equal(r.pattern, 'concentrated');
        assert.equal(r.hotspots.length, 1);
        assert.equal(r.hotspots[0].fromIndex, 118);
        assert.equal(r.hotspots[0].toIndex, 122);
        assert.deepEqual(r.hotspots[0].labels, ['Payment']);
        assert.equal(r.hotspots[0].share, 1);
        assert.equal(r.scansFor80, 4);
        assert.equal(r.top10Share, 1);
    });

    test('many rules, each in a few scans: scattered', () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
        const r = D.analyseDispersion(run(100, (i) => ({ [ids[i % 10]]: 1 })));
        assert.equal(r.affectedRate, 1);
        assert.equal(r.bands.local, 10);
        assert.equal(r.pattern, 'scattered');
        assert.ok(Math.abs(r.footprint - 0.1) < 1e-9);
    });

    test('widespread core plus a local hotspot: mixed', () => {
        const r = D.analyseDispersion(run(300, (i) => ({
            region: 1,
            ...(range(118, 125)(i) ? { label: 5, 'button-name': 3 } : {}),
        })));
        assert.equal(r.pattern, 'mixed');
        assert.equal(r.bands.widespread, 1);
        assert.equal(r.cleanIfWidespreadFixed, 293);
        assert.equal(r.hotspots[0].fromIndex, 118);
        assert.equal(r.hotspots[0].toIndex, 124);
    });

    test('fewer than ten scans: no pattern claimed', () => {
        const r = D.analyseDispersion(run(6, () => ({ region: 1 })));
        assert.equal(r.enoughData, false);
        assert.equal(r.pattern, 'few');
    });

    test('no failures: clean', () => {
        const r = D.analyseDispersion(run(20, () => ({})));
        assert.equal(r.pattern, 'clean');
        assert.equal(r.rulesFailing, 0);
        assert.equal(r.scansFor80, 0);
    });

    test('excluded and skipped scans are left out of the denominator', () => {
        const scans = run(12, () => ({ region: 1 }));
        scans.push({ ...scan(12, { other: 1 }), includedInReport: false });
        scans.push({ ...scan(13, {}), skipped: true });
        scans.push({ ...scan(14, {}), skipInfo: { reason: 'x' } });
        const r = D.analyseDispersion(scans);
        assert.equal(r.scansAnalyzed, 12);
        assert.equal(r.rulesFailing, 1);
    });

    test('order follows the scans given, so moving scans moves the hotspot', () => {
        const scans = run(40, (i) => (i === 3 || i === 30 ? { label: 3, list: 2 } : {}));
        const before = D.analyseDispersion(scans);
        assert.equal(before.hotspots.length, 2);
        const moved = scans.slice();
        const [x] = moved.splice(30, 1);
        moved.splice(4, 0, x);
        const after = D.analyseDispersion(moved);
        assert.equal(after.hotspots.length, 1);
        assert.equal(after.hotspots[0].fromIndex, 3);
        assert.equal(after.hotspots[0].toIndex, 4);
        assert.equal(after.pattern, before.pattern);
        assert.equal(after.top10Share, before.top10Share);
    });

    test("can't-tell occurrences are counted apart, never as failures", () => {
        const s = {
            id: 'a',
            canonical: {
                findings: [
                    { ruleId: 'mixed-rule', outcome: 'fail', severity: 'serious', occurrences: [
                        { target: ['#1'], occurrenceOutcome: 'fail' },
                        { target: ['#2'], occurrenceOutcome: 'cantTell' },
                    ] },
                    { ruleId: 'review-only', outcome: 'cantTell', severity: 'minor', occurrences: [{ target: ['#3'] }] },
                    { ruleId: 'fail-only-by-occ', outcome: 'fail', occurrences: [{ target: ['#4'], occurrenceOutcome: 'cantTell' }] },
                ],
            },
        };
        const r = D.analyseDispersion([s]);
        assert.deepEqual(r.rules.map((x) => x.ruleId), ['mixed-rule']);
        assert.equal(r.rules[0].elements, 1);
        assert.equal(r.cantTell.rules, 3);
        assert.equal(r.cantTell.scans, 1);
    });

    test('a failing finding without occurrences still counts once', () => {
        const r = D.analyseDispersion([{ id: 'x', canonical: { findings: [{ ruleId: 'r', outcome: 'fail' }] } }]);
        assert.equal(r.rules[0].elements, 1);
    });

    test('hotspot labels summarise long stretches', () => {
        const scans = Array.from({ length: 50 }, (_, i) => scan(i, i >= 10 && i < 16 ? { a: 2, b: 2 } : {},
            { label: `Product ${i}` }));
        const r = D.analyseDispersion(scans);
        assert.deepEqual(r.hotspots[0].labels, ['Product 10', 'Product 15']);
        assert.equal(r.hotspots[0].ellipsis, true);
    });
});

describe('compareDispersion and seriesDispersion', () => {
    const wide = () => D.analyseDispersion(run(300, () => ({ region: 1, 'link-name': 2 })));
    const conc = () => D.analyseDispersion(run(300, (i) => (range(118, 123)(i) ? { region: 1, 'link-name': 2, label: 1 } : {})));

    test('same rules, reach collapsed: contained, plus new', () => {
        const c = D.compareDispersion(wide(), conc());
        const by = Object.fromEntries(c.rows.map((r) => [r.ruleId, r]));
        assert.equal(by.region.change, 'contained');
        assert.equal(by['link-name'].change, 'contained');
        assert.equal(by.label.change, 'new');
        assert.equal(c.counts.contained, 2);
    });

    test('spread and resolved', () => {
        const c = D.compareDispersion(conc(), wide());
        const by = Object.fromEntries(c.rows.map((r) => [r.ruleId, r]));
        assert.equal(by.region.change, 'spread');
        assert.equal(by.label.change, 'resolved');
    });

    test('series trends', () => {
        const s = D.seriesDispersion([wide(), conc(), D.analyseDispersion(run(300, () => ({})))]);
        const by = Object.fromEntries(s.rows.map((r) => [r.ruleId, r]));
        assert.equal(by.region.trend, 'resolved');
        assert.deepEqual(by.region.reach.map((v) => Math.round(v * 1000) / 1000), [1, 0.017, 0]);
        const s2 = D.seriesDispersion([wide(), conc()]);
        assert.equal(s2.rows.find((r) => r.ruleId === 'region').trend, 'contained');
        assert.equal(s2.rows.find((r) => r.ruleId === 'label').trend, 'new');
        const back = D.seriesDispersion([conc(), D.analyseDispersion(run(300, () => ({}))), conc()]);
        assert.equal(back.rows.find((r) => r.ruleId === 'label').trend, 'steady');
    });
});

describe('issue-dispersion-view', () => {
    test('two hotspots get a line each, anchored to their own bracket, so their labels cannot overlap', () => {
        // Near the right end with long names, as in a run whose second
        // hotspot's label ran back over the first's.
        const scans = Array.from({ length: 191 }, (_, i) => scan(i,
            i >= 102 && i <= 106 ? { 'button-name': 4 } : i >= 175 && i <= 176 ? { label: 3 } : {},
            { label: i >= 175 && i <= 176 ? 'Laboratory - Filter chips - Examples' : `Page ${i + 1}` }));
        const r = D.analyseDispersion(scans);
        assert.equal(r.hotspots.length, 2);
        const html = V.stripHTML(r, {});
        assert.match(html, /class="dsp-strip-marks dsp-strip-marks--2"/);
        const labels = [...html.matchAll(/<span class="dsp-hot-label" style="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
        assert.deepEqual(labels.map(([, text]) => text.slice(0, 23)), ['Hotspot · scans 103–107', 'Hotspot · scans 176–177'], 'left to right, top to bottom');
        assert.deepEqual(labels.map(([style]) => /bottom:(\d+)px/.exec(style)[1]), ['26', '10']);
        assert.match(labels[1][0], /^right:7\.330%;max-width:92\.670%/, 'ends at its bracket, and never leaves the strip');

        const one = V.stripHTML({ ...r, hotspots: [r.hotspots[0]] }, {});
        assert.match(one, /class="dsp-strip-marks"/);
        assert.match(one, /bottom:10px/);
    });

    test('explanation states the key numbers for a concentrated run', () => {
        const r = D.analyseDispersion(run(300, (i) => (range(118, 123)(i) ? { region: 1, 'link-name': 3, 'color-contrast': 4 } : {})));
        const text = V.explainParagraphs(r).join(' ');
        assert.match(text, /5 of 300 scans \(1\.7%\)/);
        assert.match(text, /scans 119–123 \(Payment\)/);
        assert.match(text, /other 295 scans have no automatic failures/);
    });

    test('explanation for a mixed run names the core and what fixing it clears', () => {
        const r = D.analyseDispersion(run(300, (i) => ({ region: 1, ...(range(118, 125)(i) ? { label: 5, 'button-name': 3 } : {}) })));
        const text = V.explainParagraphs(r).join(' ');
        assert.match(text, /<code>region<\/code> fails in 100% of the 300 scans/);
        assert.match(text, /leave 293 of 300 scans clean/);
    });

    test("the can't-tell note says it is not counted", () => {
        const r = D.analyseDispersion([{ id: 'a', canonical: { findings: [{ ruleId: 'x', outcome: 'cantTell', occurrences: [{}] }] } }]);
        assert.equal(V.reviewNote(r), 'Also, 1 rule needs manual review in 1 scan. It is not counted here.');
    });

    test('report section: one strip column per scan, labels escaped, scan data for the strip', () => {
        const scans = run(12, (i) => (i < 3 ? { region: 1 } : {}));
        scans[0].label = '<img src=x>';
        const r = D.analyseDispersion(scans);
        const html = V.reportSectionHTML(r, { id: 'r1', linkScans: true });
        assert.equal((html.match(/class="dsp-s-(wide|other|clean)"/g) || []).length, 12);
        assert.ok(!html.includes('<img src=x>'));
        assert.match(html, /data-dsp-link="1"/);
        assert.match(html, /role="slider"/);
        assert.match(html, /aria-valuemax="12"/);
        assert.match(html, /Show as table/);
    });

    test('report section: open unless asked to start collapsed', () => {
        const r = D.analyseDispersion(run(12, (i) => (i < 3 ? { region: 1 } : {})));
        assert.match(V.reportSectionHTML(r, { id: 'r3' }), /^<details class="a11y-details dsp" open data-dsp-section=/);
        assert.match(V.reportSectionHTML(r, { id: 'r4', open: false }), /^<details class="a11y-details dsp" data-dsp-section=/);
    });

    test('clean report: verdict only, no charts', () => {
        const html = V.reportSectionHTML(D.analyseDispersion(run(12, () => ({}))), { id: 'r2' });
        assert.match(html, /No automatic failures/);
        assert.ok(!html.includes('data-dsp-strip'));
    });

    test('pair body explains a contained rule and notes different scan counts', () => {
        const a = D.analyseDispersion(run(300, () => ({ region: 1 })));
        const b = D.analyseDispersion(run(50, (i) => (i < 2 ? { region: 1 } : {})));
        const html = V.pairBodyHTML(D.compareDispersion(a, b), { labelA: 'Before', labelB: 'After' });
        assert.match(html, /The number of failing rules is unchanged \(1\), but scans with automatic failures went from 100% to 4%/);
        assert.match(html, /<code>region<\/code> was contained/);
        assert.match(html, /different numbers of scans \(300 and 50\)/);
        assert.match(html, /dsp-arrow--contained/);
    });

    test('series body: trend wording and one strip per report', () => {
        const res = [
            D.analyseDispersion(run(100, () => ({ region: 1 }))),
            D.analyseDispersion(run(100, (i) => (i < 5 ? { region: 1 } : {}))),
            D.analyseDispersion(run(100, () => ({}))),
        ];
        const html = V.seriesBodyHTML(D.seriesDispersion(res), { labels: ['r1', 'r2', 'r3'], mode: 'trend' });
        assert.match(html, /Over 3 runs, failing rules went 1 → 1 → 0/);
        assert.match(html, /The pattern moved Widespread → Concentrated → No automatic failures/);
        assert.equal((html.match(/data-dsp-strip=/g) || []).length, 3);
        const matrix = V.seriesBodyHTML(D.seriesDispersion(res), { labels: ['a', 'b', 'c'], mode: 'matrix' });
        assert.match(matrix, /Across 3 variants/);
    });
});
