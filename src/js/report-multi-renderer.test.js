'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

globalThis.A11Y_PLAIN_LANGUAGE = require('../shared/plain-language.js');
const { diffReportSeries } = require('../shared/report-multi-diff.js');

let R;
async function load() {
    if (!R) R = await import('./report-multi-renderer.js');
    return R;
}

function finding(ruleId, severity, n, sc = '1.4.3') {
    return {
        ruleId, id: ruleId, title: `${ruleId} title`, severity, outcome: 'fail',
        wcag: { sc: [sc] },
        occurrences: Array.from({ length: n }, (_, i) => ({ pageUrl: 'https://x/p', target: [`${ruleId}-${i}`] })),
    };
}
function report(o = {}) {
    return {
        runId: o.runId, timestamp: o.timestamp, scenarioName: o.name || null, url: 'https://x/',
        scans: Array.from({ length: o.pages || 1 }, (_, i) => ({
            id: `s${i}`, url: 'https://x/', scanTags: o.tags || [],
            canonical: { findings: i === 0 ? (o.findings || []) : [] },
        })),
        metrics: { a11ySummary: { scores: { avgPageAccessibility: o.score ?? 70, confidence: o.conf ?? 90 } } },
    };
}

// Three runs: contrast improving, a keyboard trap that comes and goes, tap
// targets appearing late.
function trend() {
    return diffReportSeries([
        report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', score: 60, findings: [
            finding('a11ycore-contrast-minimum', 'serious', 9, '1.4.3'),
            finding('a11ycore-aria-hidden-focus', 'serious', 4, '4.1.2'),
        ] }),
        report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', score: 68, findings: [
            finding('a11ycore-contrast-minimum', 'serious', 5, '1.4.3'),
        ] }),
        report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', score: 71, findings: [
            finding('a11ycore-contrast-minimum', 'serious', 3, '1.4.3'),
            finding('a11ycore-aria-hidden-focus', 'serious', 2, '4.1.2'),
            finding('a11ycore-target-size-minimum', 'moderate', 6, '2.5.8'),
        ] }),
    ], { mode: 'trend' });
}

function matrix() {
    return diffReportSeries([
        report({ runId: 'r', name: 'Desktop', tags: ['desktop'], findings: [finding('a11ycore-css-hidden-focus', 'serious', 7, '2.4.7')] }),
        report({ runId: 'r', name: 'Tablet', tags: ['tablet'], findings: [finding('a11ycore-css-hidden-focus', 'serious', 7, '2.4.7')] }),
        report({ runId: 'r', name: 'Mobile', tags: ['mobile'], findings: [
            finding('a11ycore-css-hidden-focus', 'serious', 7, '2.4.7'),
            finding('a11ycore-target-size-minimum', 'moderate', 9, '2.5.8'),
        ] }),
    ], { mode: 'matrix' });
}

describe('multi-report renderer — what a non-technical reader sees first', () => {
    test('the headline is a status, a sentence and three figures', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        assert.match(html, /dash-status--good/);
        assert.match(html, /Improving/);
        assert.match(html, /Failures today/);
        assert.match(html, /Best the site has been/);
        // The verdict sentence, not a rule id
        assert.match(html, /fewer failures/);
    });

    test('problems are named in plain language before rule ids appear', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        const plainAt = html.indexOf('Text too faint to read');
        const ruleAt = html.indexOf('a11ycore-contrast-minimum');
        assert.ok(plainAt > -1, 'the plain-language name is used');
        assert.ok(ruleAt > -1, 'the rule id is still available');
        assert.ok(plainAt < ruleAt, 'the plain name comes first on the page');
        assert.match(html, /Hidden content still reachable by keyboard/);
    });

    test('a rule that keeps coming back is called out, with its last size', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        assert.match(html, /Keeps coming back/);
        assert.match(html, /Gone and come back 1 time across 3 runs/);
    });
});

describe('multi-report renderer — readable without a pointer or colour', () => {
    test('the document outline runs h2 to h4 with no level skipped', async () => {
        const { comparisonSeriesHTML } = await load();
        const levels = [...comparisonSeriesHTML(trend()).matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

        assert.equal(levels[0], 2, 'the view opens at h2, under the page title');
        assert.ok(!levels.includes(1),
            'and never claims the page title for itself: the export promotes the masthead instead');
        for (let i = 1; i < levels.length; i += 1) {
            assert.ok(levels[i] <= levels[i - 1] + 1,
                `h${levels[i - 1]} is followed by h${levels[i]}, which skips a level`);
        }
    });

    test('the severity chart prints its totals rather than hiding them behind hover', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        assert.match(html, /class="dash-bar-total"/, 'each column carries its total on screen');
        // The stacking order is what identifies a band without its colour.
        assert.match(html, /stacked in that order, critical at the bottom/);
        assert.match(html, /<th scope="col">Moderate<\/th>/, 'and every figure is in a table too');
        assert.match(html, /<th scope="col">Total<\/th>/);
    });

    test('every chart carries a table of the same numbers', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        // Charts that carry values, not the sparklines, which are shape only
        // and aria-hidden, and the KPI beside each one prints its number.
        const charts = html.match(/class="dash-(runchart|sevchart|flowchart)"/g) || [];
        const tables = html.match(/Show the numbers as a table/g) || [];

        assert.ok(charts.length >= 3, 'the run, severity and flow charts are all drawn');
        assert.equal(tables.length, charts.length, 'nothing is available only as a picture');
    });
});

describe('multi-report renderer — the evidence layer', () => {
    test('every cell prints its number, so shading is never the only signal', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        // absent cells carry a middot rather than an empty box
        assert.match(html, /dash-c0[^>]*"><span class="dash-cell-v num" aria-label="[^"]*: 0">·/);
        assert.match(html, /dash-cell-v num" aria-label="[^"]*: 9">9/);
        assert.match(html, /Every cell prints its number/);
    });

    test('the grid has one column per report and a filter per category', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = trend();
        const html = comparisonSeriesHTML(d);

        d.columns.forEach((column, i) => {
            // The column's number, as on the charts, over its whole name.
            assert.ok(html.includes(
                `<th scope="col" class="dash-num-col"><span class="dash-col-n num" aria-hidden="true">${i + 1}</span>`
                + `<span class="dash-col-name">${column.label}</span></th>`,
            ), `${column.label} is missing a column`);
        });
        assert.match(html, /data-dash-filter="all"/);
        assert.match(html, /data-dash-filter="flapping"/);
    });

    test('charts carry a text alternative and a table of the same numbers', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(trend());

        assert.match(html, /role="img" aria-label="Failures per run\./);
        assert.match(html, /Show the numbers as a table/);
        assert.match(html, /<th scope="col">Serious or critical<\/th>/);
    });
});

describe('multi-report renderer — variants', () => {
    test('the matrix names the shared backlog and the outlier, and declares no winner', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(matrix());

        assert.match(html, /data-mode="matrix"/);
        assert.match(html, /rules? fails? everywhere|rule fails everywhere/);
        assert.match(html, /No winner is declared/);
        assert.match(html, /Most variant-specific problems/);
        assert.match(html, /Everywhere/);
        assert.ok(!html.includes('Improving'), 'a variant comparison never reads directionally');
    });

    test('variant columns are named by their scenario, not by a date', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(matrix());
        for (const name of ['Desktop', 'Tablet', 'Mobile']) {
            assert.ok(html.includes(`>${name}</th>`), `${name} column missing`);
        }
    });
});

describe('multi-report renderer — robustness', () => {
    describe('a workload change is stated in the headline, not hidden', () => {
        const window = (...pages) => diffReportSeries(pages.map((count, i) => report({
            runId: `r${i}`, timestamp: `2026-0${i + 1}-01T00:00:00Z`, pages: count,
            findings: [finding('r', 'serious', 3)],
        })), { mode: 'trend' });

        test('names the odd one out when only the latest differs', async () => {
            const { comparisonSeriesHTML } = await load();
            const html = comparisonSeriesHTML(window(4, 4, 9));
            assert.match(html, /dash-caveat/);
            assert.match(html, /The latest run covered 9 pages where the earlier ones covered 4/);
        });

        test('at two reports it says which one it is comparing against', async () => {
            const { comparisonSeriesHTML } = await load();
            assert.match(comparisonSeriesHTML(window(4, 9)),
                /The latest run covered 9 pages where the one before it covered 4/);
        });

        // The two ends can match while a run in the middle covered something
        // else entirely — reading only the ends claimed nothing had changed.
        test('gives the range when the ends match but the middle does not', async () => {
            const { comparisonSeriesHTML } = await load();
            const html = comparisonSeriesHTML(window(382, 300, 382));
            assert.match(html, /These runs covered 382, 300 and 382 pages, in that order/);
            assert.match(html, /whichever reached less of the site had less to find/);
            assert.ok(!/382 pages where/.test(html), 'and never claims 382 differs from 382');
        });

        test('says nothing at all when every run covered the same', async () => {
            const { comparisonSeriesHTML } = await load();
            const html = comparisonSeriesHTML(window(7, 7, 7));
            assert.ok(!html.includes('dash-caveat'), 'no caveat where there is nothing to caveat');
        });

        // Scoped to the caveat: other copy on the page may use the same words.
        const caveatOf = (html) => (html.match(/class="dash-caveat">[\s\S]*?<\/p>/) || [''])[0];

        test('gives a range once naming every one would be a wall of numbers', async () => {
            const { comparisonSeriesHTML } = await load();
            const caveat = caveatOf(comparisonSeriesHTML(window(7, 7, 3, 7, 7, 7, 9)));
            assert.match(caveat, /covered between 3 and 9 pages/);
            assert.ok(!caveat.includes('in that order'));
        });

        test('counts in versions when that is what the columns are', async () => {
            const { comparisonSeriesHTML } = await load();
            const d = diffReportSeries([382, 300, 382].map((count, i) => report({
                runId: `r${i}`, timestamp: `2026-0${i + 1}-01T00:00:00Z`, pages: count,
                findings: [finding('r', 'serious', 3)],
            })), { mode: 'trend', order: 'given', unit: 'version' });
            assert.match(comparisonSeriesHTML(d), /These versions covered 382, 300 and 382 pages/);
        });
    });

    test('long means are rounded wherever they are printed', async () => {
        const { comparisonSeriesHTML } = await load();
        const scored = (o) => {
            const r = report(o);
            r.metrics.a11ySummary.scores = { avgPageAccessibility: o.score, confidence: o.conf };
            return r;
        };
        const d = diffReportSeries([
            scored({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', score: 71.40549450549451, conf: 75.33333333, findings: [finding('r', 'serious', 4)] }),
            scored({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', score: 78.2, conf: 75, findings: [finding('r', 'serious', 3)] }),
            scored({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', score: 83.80890052356021, conf: 75, findings: [finding('r', 'serious', 2)] }),
        ], { mode: 'trend' });
        const html = comparisonSeriesHTML(d);

        assert.ok(!/\d\.\d{3}/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, '')),
            'no printed figure carries more than two decimals');
        assert.match(html, /dash-kpi-value num">83\.81</);
        assert.match(html, /dash-kpi-value num">75%</);
        assert.match(html, /up 12\.4</, 'and the deltas are rounded the same way');
        assert.match(html, /<td>71\.41<\/td>/, 'including the table under the chart');
    });

    test('a withheld score renders as an em dash rather than a fake number', async () => {
        const { comparisonSeriesHTML } = await load();
        // A run whose score was withheld carries no scores block at all.
        const unscored = (o) => { const r = report(o); delete r.metrics; return r; };
        const d = diffReportSeries([
            unscored({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 3)] }),
            unscored({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 2)] }),
            unscored({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', findings: [finding('r', 'serious', 1)] }),
        ], { mode: 'trend' });
        const html = comparisonSeriesHTML(d);
        assert.match(html, /dash-kpi-value num">—/);
        assert.match(html, /no comparable figure/);
    });

    test('report names are escaped', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = diffReportSeries([
            report({ runId: 'a', name: '<img src=x>', tags: ['x'], findings: [finding('r', 'serious', 1)] }),
            report({ runId: 'b', name: 'ok', tags: ['y'], findings: [finding('r', 'serious', 1)] }),
            report({ runId: 'c', name: 'fine', tags: ['z'], findings: [finding('r', 'serious', 1)] }),
        ], { mode: 'matrix' });
        const html = comparisonSeriesHTML(d);
        assert.ok(!html.includes('<img src=x>'));
        assert.match(html, /&lt;img src=x&gt;/);
    });

    // The test above only reaches heroMatrix/variantCards/narrativePanel/fixFirst's
    // "universal" branch and the table cells (which chartTable already escapes on
    // its own). The run chart and severity chart only render in trend mode, and
    // fixFirst's "where" list (matrix mode) only builds when a rule is shared
    // across some but not all variants - neither was covered above.
    test('report names are escaped in the trend run chart and severity chart aria-labels', async () => {
        const { comparisonSeriesHTML } = await load();
        // Column labels prefer a distinct-per-column date/time stamp over the
        // report name (report-multi-diff.js's variantLabels) - so the name only
        // surfaces as the label when the timestamps do not tell the columns
        // apart, e.g. all three left undated here.
        const d = diffReportSeries([
            report({ runId: 'a', name: '<img src=x>', findings: [finding('r', 'serious', 3)] }),
            report({ runId: 'b', name: 'ok', findings: [finding('r', 'serious', 2)] }),
            report({ runId: 'c', name: 'fine', findings: [finding('r', 'serious', 1)] }),
        ], { mode: 'trend' });
        const html = comparisonSeriesHTML(d);
        assert.ok(!html.includes('<img src=x>'));
        assert.match(html, /&lt;img src=x&gt;/);
    });

    test('report names are escaped in "what to fix first" when a rule is shared across some variants', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = diffReportSeries([
            report({ runId: 'a', name: '<img src=x>', tags: ['x'], findings: [finding('r', 'serious', 3)] }),
            report({ runId: 'b', name: 'ok', tags: ['y'], findings: [finding('r', 'serious', 3)] }),
            report({ runId: 'c', name: 'fine', tags: ['z'], findings: [] }),
        ], { mode: 'matrix' });
        const html = comparisonSeriesHTML(d);
        assert.ok(!html.includes('<img src=x>'));
        assert.match(html, /&lt;img src=x&gt;/);
    });

    test('nonsense input renders an empty panel rather than throwing', async () => {
        const { comparisonSeriesHTML } = await load();
        assert.match(comparisonSeriesHTML(null), /No comparison data/);
        assert.match(comparisonSeriesHTML({}), /No comparison data/);
    });
});

// A series with everything the richer sections need: criterion verdicts, a run
// that skipped scans, checks that concluded nothing, and per-page scores.
function rich() {
    const criteria = (fails, review = []) => ({
        criteria: [
            ...fails.map((sc) => ({ sc, status: 'doesNotSupport', level: sc === '1.4.3' ? 'AA' : 'A' })),
            ...review.map((sc) => ({ sc, status: 'needsReview', level: 'A' })),
            { sc: '2.4.2', status: 'supports', level: 'A' },
        ],
    });
    const cantTell = (ruleId) => ({
        ruleId, id: ruleId, title: `${ruleId} title`, severity: 'moderate', outcome: 'cantTell',
        wcag: { sc: ['1.1.1'] }, occurrences: [{ pageUrl: 'https://x/p', target: ['#q'] }],
    });

    const run = ({ id, ts, contrast, targets, review, skipped = 0, score }) => ({
        runId: id, timestamp: ts, scenarioName: null, url: 'https://x/',
        scans: Array.from({ length: 4 }, (_, i) => ({
            id: `${id}-s${i}`,
            url: `https://x/page-${i}`,
            ...(i >= 4 - skipped ? { skipped: true, skipInfo: { reason: 'over the size cap' } } : {}),
            summary: { score: score - 6 + i * 4 },
            canonical: {
                findings: i === 0
                    ? [
                        ...(contrast ? [finding('a11ycore-contrast-minimum', 'serious', contrast, '1.4.3')] : []),
                        ...(targets ? [finding('a11ycore-target-size-minimum', 'moderate', targets, '2.5.8')] : []),
                        ...(review ? [cantTell('a11ycore-canvas-text-alternative-present')] : []),
                    ]
                    : [],
            },
            metrics: {
                coverageSummary: i === 0
                    ? criteria([...(contrast ? ['1.4.3'] : []), ...(targets ? ['2.5.8'] : [])], review ? ['1.1.1'] : [])
                    : { criteria: [] },
            },
        })),
        metrics: { a11ySummary: { scores: { avgPageAccessibility: score, confidence: 90, evaluationState: 'evaluated' } } },
    });

    return diffReportSeries([
        run({ id: 'a', ts: '2026-01-01T00:00:00Z', contrast: 9, score: 60 }),
        run({ id: 'b', ts: '2026-02-01T00:00:00Z', contrast: 4, review: true, skipped: 2, score: 71 }),
        run({ id: 'c', ts: '2026-03-01T00:00:00Z', contrast: 3, targets: 6, review: true, score: 74 }),
    ], { mode: 'trend' });
}

describe('multi-report renderer — can these be read against each other', () => {
    test('the trust strip names the run that did not finish, and what it cost', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /Can these runs be compared\?/);
        assert.match(html, /1 of these runs did not cover everything they were asked to/);
        assert.match(html, /dash-trust-card--warn/);
        assert.match(html, /2 scans skipped/);
        assert.match(html, /<b class="num">2<\/b> of 4/, 'the column says how much of itself it actually scanned');
    });

    test('each column carries the spread behind its average, not only the average', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());
        assert.match(html, /worst page <b class="num">54<\/b>, best <b class="num">66<\/b>/);
    });

    test('a run with no score says its line breaks rather than showing a zero', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = rich();
        d.columns[1].stats.score = null;
        d.columns[1].stats.scoreState = 'notEvaluated';

        const html = comparisonSeriesHTML(d);
        assert.match(html, /No score: this run evaluated too little to carry one/);
        assert.match(html, /score <b class="num">—<\/b>/);
    });

    test('a score left out for comparing on fewer profiles says so, not that the run evaluated too little', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = rich();
        d.columns[1].stats.score = null;
        d.columns[1].stats.scoreLeftOut = true;

        const html = comparisonSeriesHTML(d);
        assert.match(html, /No score: the runs are compared on fewer profiles than it checked/);
        assert.doesNotMatch(html, /evaluated too little/);
    });

    test('a sparkline breaks at a missing value instead of drawing through it', async () => {
        const { comparisonSeriesHTML } = await load();
        const scored = (id, ts, count, score) => report({
            runId: id, timestamp: ts, score, findings: [finding('a11ycore-contrast-minimum', 'serious', count, '1.4.3')],
        });
        const d = diffReportSeries([
            scored('a', '2026-01-01T00:00:00Z', 9, 60),
            scored('b', '2026-02-01T00:00:00Z', 7, 64),
            scored('c', '2026-03-01T00:00:00Z', 5, 70),
            scored('d', '2026-04-01T00:00:00Z', 4, 74),
        ], { mode: 'trend' });
        d.columns[2].stats.score = null;

        const html = comparisonSeriesHTML(d);
        const sparks = html.match(/<svg class="dash-spark[^"]*"[\s\S]*?<\/svg>/g) || [];
        // The score series: one stroke over the first two columns, then a lone
        // mark for the last. Drawn as one path it would slope through a value
        // nobody measured.
        const broken = sparks.find((svg) => /dash-spark-line/.test(svg)
            && (svg.match(/dash-spark-dot/g) || []).length > 1);

        assert.ok(broken, 'the score series is drawn in pieces, not as one line across the gap');
    });
});

describe('multi-report renderer — which reports these are', () => {
    test('the reports are listed right under the masthead, before any figure', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        const strip = html.indexOf('class="doc-reports"');
        assert.ok(strip > html.indexOf('class="doc-head"'), 'after the masthead');
        assert.ok(strip < html.indexOf('Can these runs be compared?'), 'and before the trust strip and the charts');
        assert.match(html, /doc-report--warn/, 'the run that did not finish is flagged where the reports are listed');
    });

    test('both charts number their columns, and one key under them names them in full', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = rich();
        const html = comparisonSeriesHTML(d);
        const numbers = d.columns.map((c, i) => String(i + 1));

        for (const cls of ['dash-runchart', 'dash-sevchart']) {
            const chart = html.match(new RegExp(`<svg class="${cls}"[\\s\\S]*?</svg>`))[0];
            const ticks = [...chart.matchAll(/class="dash-axis"[^>]*>([^<]+)<\/text><\/g>/g)].map((m) => m[1]);
            assert.deepEqual(ticks, numbers, `${cls}: a number per column, never a cut name`);
        }

        const split = html.match(/<section class="cmp2-sec dash-split">[\s\S]*?<\/section>/)[0];
        assert.equal((split.match(/<ol class="dash-key"/g) || []).length, 1, 'one key, shared by both');
        const key = split.match(/<div class="dash-split-key">[\s\S]*?<\/ol>/)[0];
        for (const c of d.columns) assert.ok(key.includes(c.label), `${c.label} is in the key`);
    });

    test('too many columns to number each one: the last is always numbered and none collide', async () => {
        const { comparisonSeriesHTML } = await load();
        const runs = Array.from({ length: 30 }, (_, i) => report({
            runId: `r${i}`, timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
            findings: [finding('a11ycore-contrast-minimum', 'serious', i + 1, '1.4.3')],
        }));
        const html = comparisonSeriesHTML(diffReportSeries(runs, { mode: 'trend' }));
        const chart = html.match(/<svg class="dash-sevchart"[\s\S]*?<\/svg>/)[0];
        const xs = [...chart.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
        const nums = [...chart.matchAll(/class="dash-axis"[^>]*>([^<]+)</g)].map((m) => m[1]);

        assert.equal(nums[nums.length - 1], '30');
        for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 18, 'badges are at least a badge apart');
    });

    test('the masthead and the strip both lead to the provenance table', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /<section class="cmp2-sec doc-source" id="cmp-sources">/);
        assert.match(html, /<dt>Covering<\/dt><dd><a href="#cmp-sources">/);
        assert.match(html, /class="doc-reports-more" href="#cmp-sources"/);
    });
});

describe('multi-report renderer — the work behind the delta', () => {
    test('cleared and introduced are both on screen, with the ratio between them', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /Cleared and introduced, run by run/);
        assert.match(html, /dash-flow-total--good"><b class="num">6<\/b> cleared/);
        assert.match(html, /dash-flow-total--bad"><b class="num">6<\/b> introduced/);
        assert.match(html, /<th scope="col">Cleared<\/th>/, 'and the numbers are in a table too');
    });

    test('the flow chart shows a band per report, not per step', async () => {
        const { comparisonSeriesHTML } = await load();
        // Four reports, three steps. A chart with three bands reads as a lost
        // report, because the reader counts what they loaded.
        const run = (id, ts, count) => report({
            runId: id, timestamp: ts, findings: [finding('a11ycore-contrast-minimum', 'serious', count, '1.4.3')],
        });
        const d = diffReportSeries([
            run('a', '2026-01-01T00:00:00Z', 20),
            run('b', '2026-02-01T00:00:00Z', 12),
            run('c', '2026-03-01T00:00:00Z', 8),
            run('d', '2026-04-01T00:00:00Z', 5),
        ], { mode: 'trend' });

        const html = comparisonSeriesHTML(d);
        const chart = html.match(/<svg class="dash-flowchart"[\s\S]*?<\/svg>/)[0];
        const ticks = [...chart.matchAll(/class="dash-axis"[^>]*>([^<]+)</g)].map((m) => m[1]);

        assert.equal(d.flow.steps.length, 3);
        assert.deepEqual(ticks.filter((t) => /^\d+$/.test(t)), ['1', '2', '3', '4'], 'a numbered band per report');
        const key = html.slice(html.indexOf(chart)).match(/<ol class="dash-key"[\s\S]*?<\/ol>/)[0];
        for (const column of d.columns) assert.ok(key.includes(column.label), `${column.label} is in the chart's key`);
        assert.match(key, /\(starting point\)/, 'the key says which one the bars are measured from');
        assert.match(chart, /starting point/);
        assert.match(chart, /dash-flow-origin/);
    });

    test('the flow chart moves its line toward the smaller side instead of centring it', async () => {
        const { comparisonSeriesHTML } = await load();
        const run = (id, ts, contrast, alt) => report({
            runId: id, timestamp: ts, findings: [
                finding('a11ycore-contrast-minimum', 'serious', contrast, '1.4.3'),
                finding('a11ycore-image-alt', 'critical', alt, '1.1.1'),
            ],
        });
        // 200 cleared and 4 introduced: a centred line would leave the half
        // below it nearly empty.
        const d = diffReportSeries([
            run('a', '2026-01-01T00:00:00Z', 200, 1),
            run('b', '2026-02-01T00:00:00Z', 0, 5),
        ], { mode: 'trend' });

        const chart = comparisonSeriesHTML(d).match(/<svg class="dash-flowchart"[\s\S]*?<\/svg>/)[0];
        const mid = Number(chart.match(/class="dash-flow-axis"[^>]*y1="([\d.]+)"/)[1]);
        const up = Number(chart.match(/class="dash-flow-fixed"[^>]*height="([\d.]+)"/)[1]);
        const down = Number(chart.match(/class="dash-flow-new"[^>]*height="([\d.]+)"/)[1]);

        assert.ok(mid > 22 + 188 / 2 + 40, `the line sits well below the middle (y=${mid})`);
        assert.ok(mid <= 22 + 188 - 30, 'but leaves room below for the number and the word');
        const { fixed, introduced } = d.flow.steps[0];
        assert.ok(Math.abs(up / fixed - down / introduced) < 0.05,
            `both sides share one scale (${up}/${fixed} vs ${down}/${introduced})`);
    });

    test('the arithmetic behind the missing bar is stated, not left to be worked out', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /3 runs give 2 steps: Jan 1 is the starting point/);
        assert.match(html, /<th scope="row">Jan 1 → Feb 1<\/th>/, 'and the table names the whole move');
    });

    test('the longest-open problem is named in plain language, with its age', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /Open the longest/);
        assert.match(html, /Text too faint to read/);
        assert.match(html, /failing for 8 weeks, unbroken since Jan 1 or earlier/);
    });

    test('checks waiting on a person are counted separately from failures', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /Questions to review/);
        assert.match(html, /Not failures, and not in any failure count/);
        // In their own group, after the failure tiles.
        assert.ok(html.indexOf('Score and open questions') > html.indexOf('What failed'));
        assert.ok(html.indexOf('Questions to review') > html.indexOf('Score and open questions'));
    });

    test('every failure count says what one failure is, beside the broken elements', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /<p class="dash-kpi-label">Failures<\/p>/);
        assert.match(html, /<p class="dash-kpi-label">Broken elements<\/p>/);
        assert.match(html, /A failure is one element failing one (criterion|rule) on one page, so an element that breaks three .* counts three times\./);
        assert.match(html, /<th scope="col">Broken elements<\/th>/);
        assert.doesNotMatch(html, /Problems (by version|over time)/);
    });
});

describe('multi-report renderer — WCAG in the standard’s own words', () => {
    test('criteria are shown by principle and then one row each', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /WCAG, criterion by criterion/);
        assert.match(html, /Perceivable/);
        assert.match(html, /Can people work the controls\?/);
        assert.match(html, /WCAG 1\.4\.3 · level AA/);
    });

    test('a criterion names its EN 301 549 clause when the reports recorded one', async () => {
        const { comparisonSeriesHTML } = await load();
        const withClauses = (f, en301549) => Object.assign(f, { en301549 });
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [
                withClauses(finding('a11ycore-contrast-minimum', 'serious', 2, '1.4.3'), [{ clause: '9.1.4.3', versions: ['V3.2.1', 'V4.1.1'] }]),
                withClauses(finding('a11ycore-target-size-minimum', 'moderate', 1, '2.5.8'), [{ clause: '9.2.5.8', versions: ['V4.1.1'] }]),
            ] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [
                finding('a11ycore-contrast-minimum', 'serious', 1, '1.4.3'),
            ] }),
        ], { mode: 'trend' }));

        assert.match(html, /WCAG 1\.4\.3 · EN 301 549 9\.1\.4\.3</);
        assert.match(html, /WCAG 2\.5\.8 · EN 301 549 9\.2\.5\.8 \(V4\.1\.1\)</);
    });

    test('criteria and problems name their RGAA criteria when the reports targeted RGAA', async () => {
        const { comparisonSeriesHTML } = await load();
        const withRgaa = (f, criteria) => Object.assign(f, { rgaa: criteria.map((criterion) => ({ criterion, tests: [] })) });
        // heading-order maps to no WCAG criterion, so only the problems table can show it.
        const headingOrder = { ...finding('heading-order', 'moderate', 1), wcag: { sc: [] } };
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [
                withRgaa(finding('img-alt-present', 'critical', 2, '1.1.1'), ['1.1']),
                withRgaa(headingOrder, ['9.1']),
            ] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [
                withRgaa(finding('img-alt-present', 'critical', 1, '1.1.1'), ['1.1']),
            ] }),
        ], { mode: 'trend' }));

        assert.match(html, /WCAG 1\.1\.1 · RGAA 1\.1</);
        assert.match(html, /heading-order/);
        assert.match(html, /· RGAA 9\.1/);
    });

    test('EN 301 549 clauses follow the standard every compared scan targeted', async () => {
        const { comparisonSeriesHTML } = await load();
        const run = (runId, timestamp, target) => {
            const r = report({ runId, timestamp, findings: [
                Object.assign(finding('a11ycore-contrast-minimum', 'serious', 1, '1.4.3'), { en301549: [{ clause: '9.1.4.3', versions: ['V3.2.1', 'V4.1.1'] }] }),
            ] });
            r.scans.forEach((scan) => { scan.conformanceProfile = target ? { id: target } : null; });
            return r;
        };
        const html = (targets) => comparisonSeriesHTML(diffReportSeries(
            targets.map((t, i) => run(`r${i}`, `2026-0${i + 1}-01T00:00:00Z`, t)), { mode: 'trend' }));

        assert.doesNotMatch(html(['section508', 'section508']), /EN 301 549 9\.1\.4\.3/);
        assert.doesNotMatch(html(['rgaa-4.1.2', 'rgaa-4.1.2']), /EN 301 549 9\.1\.4\.3/);
        assert.match(html(['en301549-v4.1.1', 'en301549-v4.1.1']), /WCAG 1\.4\.3 · EN 301 549 9\.1\.4\.3</);
        assert.match(html(['section508', null]), /EN 301 549 9\.1\.4\.3/, 'mixed targets keep the cross-reference');
    });

    test('every status cell carries a word, never a colour alone', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());

        assert.match(html, /dash-sc--bad"><span class="dash-cell-v" aria-label="[^"]*: does not support">fails</);
        assert.match(html, /aria-label="[^"]*: not evaluated"/);
    });

    test('a criterion nothing checked is not presented as one that passed', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(rich());
        assert.match(html, /An empty cell means nothing was checked there, never that it passed|a criterion the run passed is shown as passed/);
    });
});

describe('multi-report renderer — holding up under awkward data', () => {
    function longNamed() {
        const name = 'Checkout flow, logged-in customer with a saved card, EU locale, reduced motion enabled';
        // Arranged by hand, so the columns are named after the reports rather
        // than dated: that is the framing where a long name reaches an axis.
        return diffReportSeries([
            report({ runId: 'a', name, timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 124876, '1.4.3')] }),
            report({ runId: 'b', name: `${name} (second)`, timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 3, '1.4.3')] }),
            report({ runId: 'c', name: `${name} (third)`, timestamp: '2026-03-01T00:00:00Z', findings: [finding('r', 'serious', 1, '1.4.3')] }),
        ], { mode: 'trend', order: 'given' });
    }

    test('no chart draws a name on its axis, so a long one cannot be cut or collide', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(longNamed());
        const charts = html.match(/<svg class="dash-(?:runchart|sevchart|flowchart)"[\s\S]*?<\/svg>/g);
        assert.equal(charts.length, 3);
        for (const chart of charts) {
            const ticks = [...chart.matchAll(/class="dash-axis"[^>]*>([^<]+)<\/text><\/g>/g)].map((m) => m[1]);
            assert.deepEqual(ticks, ['1', '2', '3']);
        }
        assert.ok(!html.includes('…'), 'and no name is cut anywhere');
        assert.match(html, /aria-label="[^"]*Checkout flow, logged-in customer with a saved card/);
    });

    test('grid headers carry the whole name, wrapped rather than clipped', async () => {
        const { comparisonSeriesHTML } = await load();
        assert.match(comparisonSeriesHTML(longNamed()),
            /<span class="dash-col-name">Checkout flow, logged-in customer with a saved card, EU locale, reduced motion enabled<\/span>/);
    });

    test('anything wider than a phone scrolls in a named box that says it scrolls', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(longNamed());
        const boxes = [...html.matchAll(/<div class="(dash-(?:grid|chart)-scroll)" tabindex="0" role="region" aria-label="([^"]+)">/g)];
        assert.deepEqual(boxes.map((m) => m[1]).sort(),
            ['dash-chart-scroll', 'dash-chart-scroll', 'dash-grid-scroll', 'dash-grid-scroll']);
        assert.ok(boxes.every((m) => m[2].length > 5), 'each with a name');
        assert.match(html, /Scroll sideways to see all 3 runs →/);
    });

    test('a chart that is one image holds nothing that takes focus', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(longNamed());
        const images = [...html.matchAll(/<svg[^>]*role="img"[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0]);
        assert.ok(images.some((svg) => svg.includes('dash-runchart')), 'the run chart is among them');
        for (const svg of images) assert.doesNotMatch(svg.slice(svg.indexOf('>') + 1), /tabindex=/);
    });

    test('a rounded percentage never claims problems are gone while they remain', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 124876, '1.4.3')] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 10, '1.4.3')] }),
            report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', findings: [finding('r', 'serious', 10, '1.4.3')] }),
        ], { mode: 'trend' }));

        assert.match(html, /over 99% lower/);
        assert.ok(!/>100% lower/.test(html), '100% lower would say the problems are gone');
    });

    test('from no failures, the headline says how many there are now, not a percentage', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [] }),
            report({ runId: 'b', timestamp: '2026-01-01T00:01:00Z', findings: [finding('r', 'serious', 2, '1.4.3')] }),
            report({ runId: 'c', timestamp: '2026-01-01T00:01:00Z', findings: [finding('r', 'serious', 2, '1.4.3')] }),
        ], { mode: 'trend' }));
        assert.match(html, /<strong>2 accessibility failures<\/strong>, where a minute ago there were none/);
        assert.doesNotMatch(html, /0% lower/);
        assert.doesNotMatch(html, /1 minutes/);
    });

    test('with as many failures as at the start, the headline says they are the same', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 3, '1.4.3')] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 1, '1.4.3')] }),
            report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', findings: [finding('r', 'serious', 3, '1.4.3')] }),
        ], { mode: 'trend' }));
        assert.match(html, /Accessibility failures are <strong>the same<\/strong> as/);
    });

    test('reports that start from different pages are said to be different subjects', async () => {
        const { comparisonSeriesHTML } = await load();
        const at = (o, url) => ({ ...report(o), url });
        const html = comparisonSeriesHTML(diffReportSeries([
            at({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }, 'https://x/cart'),
            at({ runId: 'b', timestamp: '2026-02-01T00:00:00Z' }, 'https://x/login'),
            at({ runId: 'c', timestamp: '2026-03-01T00:00:00Z' }, 'https://staging.x/login'),
        ], { mode: 'trend' }));
        assert.match(html, /start from 2 different pages/);
        const same = comparisonSeriesHTML(diffReportSeries([
            at({ runId: 'a', timestamp: '2026-01-01T00:00:00Z' }, 'https://x/login'),
            at({ runId: 'b', timestamp: '2026-02-01T00:00:00Z' }, 'https://staging.x/login'),
        ], { mode: 'trend' }));
        assert.doesNotMatch(same, /different pages/);
    });

    test('a non-zero band is never drawn as nothing beside a huge one', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', 100000, '1.4.3')] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', 3, '1.4.3')] }),
            report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', findings: [finding('r', 'serious', 3, '1.4.3')] }),
        ], { mode: 'trend' }));

        const heights = [...html.matchAll(/class="dash-sev dash-sev--serious"[^>]*height="([\d.]+)"/g)]
            .map((m) => Number(m[1]));
        assert.equal(heights.length, 3);
        assert.ok(heights.every((h) => h >= 2), 'a band that exists has to be visible');
    });

    test('a matrix with no shared backlog does not promise a single fix', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'r', name: 'Desktop', findings: [finding('a', 'serious', 1, '1.4.3')] }),
            report({ runId: 'r', name: 'Mobile', findings: [finding('b', 'serious', 1, '2.5.8')] }),
            report({ runId: 'r', name: 'Tablet', findings: [finding('c', 'serious', 1, '2.4.7')] }),
        ], { mode: 'matrix' }));

        assert.match(html, /No rule fails on every variant, so there is no single fix that moves all of them/);
    });
});

describe('RGAA rollups in the multi-report view', () => {
    const rgaaRollup = (n) => ({
        ruleId: 'rgaa-4.1.2-8.1', id: 'rgaa-4.1.2-8.1', severity: 'serious', outcome: 'fail',
        title: 'Chaque page web est-elle définie par un type de document ?', titleLang: 'fr',
        wcag: { sc: [], scNormative: [] }, rgaa: [{ criterion: '8.1', tests: [], version: '4.1.2' }],
        occurrences: Array.from({ length: n }, (_, i) => ({ pageUrl: 'https://x/p', target: [`html-${i}`] })),
    });
    const series = () => diffReportSeries([
        report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [rgaaRollup(1), finding('a11ycore-contrast-minimum', 'serious', 2)] }),
        report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [rgaaRollup(2), finding('a11ycore-contrast-minimum', 'serious', 1)] }),
    ]);

    test('a rollup is named by its French title, marked as French, not as "Accessibility problem"', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(series());
        assert.match(html, /<span class="dash-rule-name" lang="fr">Chaque page web est-elle définie par un type de document \?<\/span>/);
        assert.match(html, /· RGAA 8\.1/);
        assert.match(html, /&quot;rgaa-4\.1\.2-8\.1&quot;,&quot;Chaque page web est-elle définie par un type de document \?&quot;/, 'the CSV names it too');
    });

    test('a rollup that also lists its rules\' WCAG criteria is still named by its RGAA title', async () => {
        const { comparisonSeriesHTML } = await load();
        const images = (n) => ({
            ...rgaaRollup(n), ruleId: 'rgaa-4.1.2-1.1', id: 'rgaa-4.1.2-1.1',
            title: 'Chaque image porteuse d’information a-t-elle une alternative textuelle ?',
            wcag: { sc: ['1.1.1'], scNormative: ['1.1.1'] }, rgaa: [{ criterion: '1.1', tests: ['1.1.1'], version: '4.1.2' }],
        });
        const html = comparisonSeriesHTML(diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [images(1)] }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [images(2)] }),
        ]));
        assert.match(html, /<span class="dash-rule-name" lang="fr">Chaque image porteuse d’information a-t-elle une alternative textuelle \?<\/span>/);
        assert.match(html, /· WCAG 1\.1\.1 · RGAA 1\.1/);
    });

    test('a WCAG rule keeps its plain-language name and gets no lang', async () => {
        const { comparisonSeriesHTML } = await load();
        const html = comparisonSeriesHTML(series());
        const name = globalThis.A11Y_PLAIN_LANGUAGE.plainFor('a11ycore-contrast-minimum', '1.4.3').name;
        assert.ok(html.includes(`<span class="dash-rule-name">${name}</span>`));
    });
});

describe('series: room before failing', () => {
    const m = (headroom) => ({ ruleId: 'contrast-minimum', title: 'Text contrast', unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.5 + headroom, headroom, selector: 'p' });
    const run = (runId, timestamp, margins) => ({ ...report({ runId, timestamp }), scans: [{ id: 's', url: 'https://x/', canonical: { findings: [], margins } }] });

    test('shows each column\'s tightest pass and where the room went, first to last', async () => {
        const { comparisonSeriesHTML } = await load();
        const d = diffReportSeries([
            run('a', '2026-01-01T00:00:00Z', [m(0.8)]),
            run('b', '2026-02-01T00:00:00Z', []),
            run('c', '2026-03-01T00:00:00Z', [m(0.02)]),
        ], { mode: 'trend' });
        const html = comparisonSeriesHTML(d);
        assert.match(html, /<h3>Room before failing<\/h3>/);
        assert.match(html, /5\.30:1<\/span>, 0\.80 left<\/td><td>—<\/td><td><span class="num">4\.52:1<\/span>, 0\.02 left <span class="margin-near">near miss<\/span>/);
        assert.match(html, /margin-chg--closer">Closer to failing</);
        assert.match(html, /<th scope="col">First to last<\/th>/);
    });

    test('has no direction column across variants, and no section without margins', async () => {
        const { comparisonSeriesHTML } = await load();
        const matrix = comparisonSeriesHTML(diffReportSeries([run('a', null, [m(0.8)]), run('b', null, [m(0.1)])], { mode: 'matrix' }));
        assert.match(matrix, /Room before failing/);
        assert.doesNotMatch(matrix, /First to last/);
        assert.doesNotMatch(comparisonSeriesHTML(trend()), /Room before failing/);
    });
});

describe('multi-report renderer — the reports compared', () => {
    test('a report told apart from its namesake by the day shows its name, its date beside it', async () => {
        const { comparisonSeriesHTML } = await load();
        const scan = (v, day, tags = []) => report({
            runId: `${v}-${day}`, timestamp: `2026-10-${day}T09:00:00Z`, name: `UI-SDK ${v}`, tags,
            findings: [finding('r', 'serious', 1)],
        });
        const d = diffReportSeries([
            scan('v22.2.0', 19), scan('v22.3.0', 19), scan('v22.3.0', 21, ['Accessibility', 'Assets', 'Changelog', 'Guides']),
        ], { mode: 'trend', order: 'given' });
        const html = comparisonSeriesHTML(d);
        const strip = html.slice(html.indexOf('doc-reports-list'), html.indexOf('</ol>', html.indexOf('doc-reports-list')));
        const names = [...strip.matchAll(/doc-report-name">([^<]*)</g)].map((m) => m[1]);
        const metas = [...strip.matchAll(/doc-report-meta">([^<]*)</g)].map((m) => m[1]);
        assert.deepEqual(names, ['UI-SDK v22.2.0', 'UI-SDK v22.3.0', 'UI-SDK v22.3.0']);
        assert.deepEqual(metas.map((m) => m.split(' · ')[0]), ['19 Oct 2026', '19 Oct 2026', '21 Oct 2026']);
        assert.ok(!strip.includes('Changelog'), 'no tags in the card');
        assert.match(html, /dash-col-name">UI-SDK v22\.3\.0 · Oct 21</, 'the charts, with no date beside them, keep the day');
    });
});

describe('groups merged in the reports\' view (scan-grouping-design.md §11)', () => {
    test('the note is shown after the reports strip, only when given', async () => {
        const { comparisonSeriesHTML } = await load();
        const series = diffReportSeries([
            report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'v1' }),
            report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', name: 'v2' }),
            report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', name: 'v3' }),
        ], { mode: 'trend' });
        assert.match(comparisonSeriesHTML(series, { mergedNote: 'Merged here' }), /<p class="cmp2-note">Merged here<\/p>/);
        assert.doesNotMatch(comparisonSeriesHTML(series), /cmp2-note/);
    });
});
