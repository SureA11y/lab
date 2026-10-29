'use strict';

// "Where the failures are" in the Compare tab: the controller computes the
// dispersion from the reports it holds and the renderers place it. The diff
// engines only say how they ordered the reports.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const D = require('../shared/report-diff.js');
const M = require('../shared/report-multi-diff.js');
const DSP = require('../shared/issue-dispersion.js');
const VIEW = require('../shared/issue-dispersion-view.js');
globalThis.A11Y_PLAIN_LANGUAGE = globalThis.A11Y_PLAIN_LANGUAGE || require('../shared/plain-language.js');

function scans(n, rulesAt) {
    return Array.from({ length: n }, (_, i) => ({
        id: `s${i}`, label: `Step ${i + 1}`, url: 'https://x/',
        canonical: {
            findings: Object.entries(rulesAt(i)).map(([ruleId, k]) => ({
                ruleId, id: ruleId, title: `${ruleId} title`, severity: 'serious', outcome: 'fail',
                occurrences: Array.from({ length: k }, (_, j) => ({ pageUrl: 'https://x/', target: [`#${ruleId}-${i}-${j}`] })),
            })),
        },
    }));
}
function report(runId, timestamp, n, rulesAt) {
    return { runId, timestamp, url: 'https://x/', scenarioName: 'Flow', scans: scans(n, rulesAt) };
}
const wide = () => report('w', '2026-01-01T00:00:00Z', 30, () => ({ region: 1 }));
const conc = () => report('c', '2026-02-01T00:00:00Z', 30, (i) => (i < 2 ? { region: 1 } : {}));
const clean = () => report('k', '2026-03-01T00:00:00Z', 30, () => ({}));

describe('diff engines report their ordering', () => {
    test('diffReports says when evolution put the second report first', () => {
        assert.equal(D.diffReports(wide(), conc(), { mode: 'evolution' }).swapped, false);
        assert.equal(D.diffReports(conc(), wide(), { mode: 'evolution' }).swapped, true);
        assert.equal(D.diffReports(conc(), wide(), { mode: 'ab' }).swapped, false);
    });

    test('diffReportSeries gives each column its index in the list given', () => {
        const s = M.diffReportSeries([clean(), wide(), conc()], { mode: 'trend' });
        assert.deepEqual(s.ordering.source, [1, 2, 0]);
    });
});

describe('renderers place the dispersion section when given one', () => {
    let pair, series;
    before(async () => {
        globalThis.A11Y_ISSUE_DISPERSION_VIEW = VIEW;
        pair = await import('./report-comparison-renderer.js');
        series = await import('./report-multi-renderer.js');
    });
    after(() => { delete globalThis.A11Y_ISSUE_DISPERSION_VIEW; });

    test('pair: section present with the contained rule, absent without data', () => {
        const d = D.diffReports(wide(), conc(), { mode: 'evolution' });
        const dsp = DSP.compareDispersion(DSP.analyseDispersion(wide().scans), DSP.analyseDispersion(conc().scans));
        const html = pair.comparisonDiffHTML(d, { dispersion: dsp });
        assert.match(html, /<h3>Where the failures are<\/h3>/);
        assert.match(html, /<code>region<\/code> was contained/);
        assert.match(html, /Baseline/);
        assert.doesNotMatch(pair.comparisonDiffHTML(d), /Where the failures are/);
    });

    test('series: section present, one strip per column, in column order', () => {
        const list = [clean(), wide(), conc()];
        const s = M.diffReportSeries(list, { mode: 'trend' });
        const ordered = s.ordering.source.map((i) => list[i]);
        const dsp = DSP.seriesDispersion(ordered.map((r) => DSP.analyseDispersion(r.scans)));
        const html = series.comparisonSeriesHTML(s, { dispersion: dsp });
        assert.match(html, /<h3>Where the failures are<\/h3>/);
        assert.match(html, /failing rules went 1 → 1 → 0/);
        assert.equal((html.match(/data-dsp-strip=/g) || []).length, 3);
    });
});
