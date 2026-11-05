'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

globalThis.A11Y_REPORT_DIFF = require('../shared/report-diff.js');
globalThis.A11Y_REPORT_MULTI_DIFF = require('../shared/report-multi-diff.js');
globalThis.A11Y_REPORT_IDENTITY = require('../shared/report-identity.js');
globalThis.A11Y_SHARED_PROFILES = require('../shared/shared-profiles.js');
globalThis.A11Y_PLAIN_LANGUAGE = require('../shared/plain-language.js');

const { buildA11ySummary } = require('../shared/a11y-summary.js');

let view;
let pairRenderer;
let seriesRenderer;
let controllerMod;
async function load() {
    view = view || await import('./profile-breakdown-view.js');
    pairRenderer = pairRenderer || await import('./report-comparison-renderer.js');
    seriesRenderer = seriesRenderer || await import('./report-multi-renderer.js');
    controllerMod = controllerMod || await import('./report-comparison-controller.js');
    return { ...view, ...pairRenderer, ...seriesRenderer, ...controllerMod };
}

const AA = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
const ARIA = { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' };
const DOM = { totalElements: 400, counts: { evaluable: 200 } };
const BOTH = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'fail' };
const ARIA_ONLY = { 'wcag22-aa': 'pass', 'wai-aria-1.2': 'fail' };
const WCAG_ONLY = { 'wcag22-aa': 'fail', 'wai-aria-1.2': 'pass' };

const rule = (ruleId, verdicts, targets = ['#x']) => ({
    ruleId, outcome: 'fail', severity: 'serious', meta: { atomic: true }, wcag: { sc: ['4.1.2'] }, verdicts,
    occurrences: targets.map((t) => ({ target: [t], pageUrl: 'https://example.com/', verdicts })),
});
function report(runId, day, findings) {
    const canonical = { findings };
    return {
        runId, timestamp: `2026-11-0${day}T10:00:00Z`, url: 'https://example.com/',
        metrics: { a11ySummary: { scores: { avgPageAccessibility: 60, confidence: 80 } } },
        scans: [{
            id: 's1', url: 'https://example.com/', profile: ARIA, profiles: [AA, ARIA],
            wcag: { version: '2.2', level: 'AA' }, canonical,
            metrics: { domMetrics: DOM, a11ySummary: buildA11ySummary({ canonical, domMetrics: DOM, coverageSummary: null }) },
        }],
    };
}
const a = () => report('a', 1, [rule('wcag-only', WCAG_ONLY), rule('both', BOTH)]);
const b = () => report('b', 2, [rule('aria-1', ARIA_ONLY), rule('aria-2', ARIA_ONLY, ['#a', '#b']), rule('both', BOTH)]);
const c = () => report('c', 3, [rule('aria-1', ARIA_ONLY)]);

describe('By profile', () => {
    test('two reports: a row per profile, the shared row and the total, with the categories', async () => {
        const { pairProfilesHTML } = await load();
        const d = globalThis.A11Y_REPORT_DIFF.diffReports(a(), b());
        const html = pairProfilesHTML(d.profiles, { mode: 'evolution', sides: ['Baseline', 'Latest'] });
        assert.match(html, /<h3>By profile<\/h3>/);
        assert.match(html, /<th scope="col">Fixed<\/th><th scope="col">Newly failing<\/th><th scope="col">Still failing<\/th>/);
        assert.match(html, /<th scope="row">WAI-ARIA 1\.2<span class="byprof-hint">on its own, shared ones included: from 1 to 3 problems<\/span><\/th><td class="num">0<\/td><td class="num">2<\/td><td class="num">0<\/td>/);
        assert.match(html, /More than one profile/);
        assert.match(html, /<tr class="byprof-row byprof-row--total"><th scope="row">As compared<\/th><td class="num">1<\/td><td class="num">2<\/td><td class="num">1<\/td>/);
        assert.match(html, /WAI-ARIA 1\.2 alone accounts for 2 of the 3 problems in Latest\./);
    });

    test('variants name the sides', async () => {
        const { pairProfilesHTML } = await load();
        const d = globalThis.A11Y_REPORT_DIFF.diffReports(a(), b(), { mode: 'ab' });
        const html = pairProfilesHTML(d.profiles, { mode: 'ab', sides: ['A', 'B'] });
        assert.match(html, /<th scope="col">Only A<\/th><th scope="col">Only B<\/th><th scope="col">Both<\/th>/);
    });

    test('nothing without a breakdown', async () => {
        const { pairProfilesHTML, seriesProfilesHTML } = await load();
        assert.equal(pairProfilesHTML(undefined), '');
        assert.equal(seriesProfilesHTML(null), '');
    });

    test('a series: a column per report, the score on each profile alone', async () => {
        const { seriesProfilesHTML } = await load();
        const s = globalThis.A11Y_REPORT_MULTI_DIFF.diffReportSeries([a(), b(), c()]);
        const html = seriesProfilesHTML(s.profiles, { labels: ['One', 'Two', 'Three'] });
        assert.match(html, /<th scope="col">One<\/th><th scope="col">Two<\/th><th scope="col">Three<\/th>/);
        assert.match(html, /byprof-score">score <span class="num">\d+<\/span>/);
    });

    test('the two-report view and the dashboard carry it', async () => {
        const { comparisonDiffHTML, comparisonSeriesHTML } = await load();
        const d = globalThis.A11Y_REPORT_DIFF.diffReports(a(), b());
        assert.match(comparisonDiffHTML(d), /class="cmp2-sec byprof"/);
        const s = globalThis.A11Y_REPORT_MULTI_DIFF.diffReportSeries([a(), b(), c()]);
        assert.match(comparisonSeriesHTML(s), /class="cmp2-sec byprof"/);
    });

    test('the note says which profiles are off and that the scores were counted again', async () => {
        const { comparisonDiffHTML } = await load();
        const d = globalThis.A11Y_REPORT_DIFF.diffReports(a(), b(), { profilesOff: ['wai-aria-1.2'] });
        const html = comparisonDiffHTML(d);
        assert.match(html, /Compared on WCAG 2\.2 AA only: WAI-ARIA 1\.2 turned off above, so its results are left out\./);
        assert.match(html, /Each report's score is counted again on the profiles compared/);
        assert.doesNotMatch(html, /class="cmp2-sec byprof"/, 'one profile: nothing to break down');
    });
});

describe('comparison controller — profiles', () => {
    async function make() {
        const { createComparisonController } = await load();
        const cap = { html: '' };
        const ctrl = createComparisonController({ setHTML: (html) => { cap.html = html; } });
        ctrl.addReport(a(), 'a.json');
        ctrl.addReport(b(), 'b.json');
        return { ctrl, cap };
    }

    test('offers the profiles every report checked, all on', async () => {
        const { ctrl } = await make();
        assert.deepEqual(ctrl.profiles(), [
            { key: 'wcag', label: 'WCAG 2.2 AA', on: true },
            { key: 'wai-aria-1.2', label: 'WAI-ARIA 1.2', on: true },
        ]);
    });

    test('turning one off draws the comparison on the rest', async () => {
        const { ctrl, cap } = await make();
        ctrl.setProfile('wai-aria-1.2', false);
        assert.deepEqual(ctrl.profiles().map((p) => p.on), [true, false]);
        assert.match(cap.html, /Compared on WCAG 2\.2 AA only/);
        ctrl.setProfile('wai-aria-1.2', true);
        assert.doesNotMatch(cap.html, /only: WAI-ARIA/);
    });

    test('the last one on stays on', async () => {
        const { ctrl } = await make();
        ctrl.setProfile('wcag', false);
        ctrl.setProfile('wai-aria-1.2', false);
        assert.deepEqual(ctrl.profiles().map((p) => p.on), [false, true]);
        ctrl.showAllProfiles();
        assert.deepEqual(ctrl.profiles().map((p) => p.on), [true, true]);
    });

    test('the choice travels in a snapshot and comes back with it', async () => {
        const { ctrl } = await make();
        ctrl.setProfile('wcag', false);
        const snap = ctrl.snapshot();
        assert.deepEqual(snap.profilesOff, ['wcag']);
        const { ctrl: other } = await make();
        other.restore(snap);
        assert.deepEqual(other.profiles().map((p) => p.on), [false, true]);
    });

    test('a manifest keeps the profiles turned off', async () => {
        const { buildManifest, readManifest } = await import('./comparison-bundle.js');
        const manifest = buildManifest({ context: 'time', order: null, profilesOff: ['wcag'], document: {}, reports: [{ name: 'a' }] }, ['reports/1 a.json']);
        assert.deepEqual(manifest.profilesOff, ['wcag']);
        assert.deepEqual(readManifest(JSON.parse(JSON.stringify(manifest))).profilesOff, ['wcag']);
        const none = buildManifest({ context: 'time', reports: [{ name: 'a' }] }, ['reports/1 a.json']);
        assert.equal('profilesOff' in none, false);
    });
});
