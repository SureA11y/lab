'use strict';

// DOM tests for the honesty guarantees of the metrics panel: the headline score
// is labelled as an automated result rather than an accessibility grade, it never
// renders without the caveat that says what automation covered, and the same scan
// produces the same prose every time it is opened.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let generateA11yMetricsContents;
let METRIC_DEFS;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://example.com/page',
        pretendToBeVisual: true
    });
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.location = win.location;
    globalThis.localStorage = win.localStorage;
    globalThis.sessionStorage = win.sessionStorage;

    ({generateA11yMetricsContents} = await import('./a11y-metrics-renderer.js'));
    ({METRIC_DEFS} = await import('../server-side/metrics/a11y-metric-defs.cjs'));
});

function summary(overrides = {}) {
    return {
        inputs: {domTotal: 1000, axe: {violations: 2, incomplete: 1, passes: 5}, controls: {}},
        scores: {evidence: 70, readiness: 60, confidence: 90, adjusted: 63, avgPageAccessibility: 63},
        flags: {manualReviewNeeded: true},
        ...overrides
    };
}

const DOM_METRICS = {totalElements: 1000, counts: {}, semanticRatio: 0.5, coverageRatio: 0.3, hiddenRatio: 0.1};

function render(a11ySummary, coverageSummary) {
    return generateA11yMetricsContents({a11ySummary, domMetrics: DOM_METRICS, coverageSummary, metricDefs: METRIC_DEFS});
}

function rootOf(nodes) {
    const root = document.createElement('div');
    for (const el of nodes) root.appendChild(el.cloneNode(true));
    return root;
}

function htmlOf(nodes) {
    return nodes.map((n) => n.outerHTML || n.textContent || '').join('');
}

function metricsHtml(a11ySummary) {
    return htmlOf(render(a11ySummary).metricsEls);
}

function narrativeHtml(a11ySummary) {
    return htmlOf(render(a11ySummary).narrativeEls);
}

describe('metrics panel: score labelling', () => {
    test('the headline chip is labelled as an automated check result, not an accessibility score', () => {
        const html = metricsHtml(summary());
        assert.ok(html.includes('Automated check result'));
        assert.ok(!html.includes('Accessibility Score'));
    });

    test('the top band of the headline chip reads as "few findings", not "strong"', () => {
        const els = render(summary({
            scores: {evidence: 95, readiness: 95, confidence: 95, adjusted: 95, avgPageAccessibility: 95},
            flags: {manualReviewNeeded: false}
        })).metricsEls;

        const root = document.createElement('div');
        for (const el of els) root.appendChild(el.cloneNode(true));

        const gauge = root.querySelector('[aria-labelledby^="g_scores-avgpageaccessibility"]');
        assert.ok(gauge, 'headline gauge not found');
        assert.ok(gauge.textContent.includes('Few findings'));
        assert.ok(!gauge.textContent.includes('Strong'));
    });
});

describe('metrics panel: the score never renders alone', () => {
    test('a caveat accompanies the scores on every render', () => {
        const html = metricsHtml(summary());
        assert.match(html, /class="a11y-score-caveat"/);
        assert.ok(html.includes('Covers only what automation can test'));
    });

    test('skipped scans are reported next to the score instead of vanishing from the denominator', () => {
        const html = metricsHtml(summary({
            scanCoverage: {scansTotal: 5, scansAnalyzed: 3, scansSkipped: 2, analyzedRatio: 0.6, skippedReasons: {}, skippedScans: []}
        }));
        assert.ok(html.includes('3 of 5 scans analyzed'));
        assert.ok(html.includes('2 skipped'));
    });

    test('a run with nothing skipped states the caveat but claims no missing scans', () => {
        const html = metricsHtml(summary({
            scanCoverage: {scansTotal: 3, scansAnalyzed: 3, scansSkipped: 0, analyzedRatio: 1, skippedReasons: {}, skippedScans: []}
        }));
        assert.ok(html.includes('Covers only what automation can test'));
        assert.ok(!html.includes('scans analyzed'));
    });

    test('a summary with no coverage block still carries the caveat', () => {
        assert.ok(metricsHtml(summary()).includes('Covers only what automation can test'));
    });
});

describe('metrics panel: deterministic narrative', () => {
    test('the same scan renders the same prose on every view', () => {
        const a = narrativeHtml(summary());
        const b = narrativeHtml(summary());
        const c = narrativeHtml(summary());
        assert.equal(a, b);
        assert.equal(a, c);
    });

    test('different results still produce different prose', () => {
        const poor = narrativeHtml(summary({
            scores: {evidence: 10, readiness: 20, confidence: 65, adjusted: 8, avgPageAccessibility: 8}
        }));
        const good = narrativeHtml(summary({
            scores: {evidence: 95, readiness: 95, confidence: 95, adjusted: 95, avgPageAccessibility: 95},
            flags: {manualReviewNeeded: false}
        }));
        assert.notEqual(poor, good);
    });

    test('the good-band banner states what was checked rather than praising the page', () => {
        const html = narrativeHtml(summary({
            scores: {evidence: 95, readiness: 95, confidence: 95, adjusted: 95, avgPageAccessibility: 95},
            flags: {manualReviewNeeded: false}
        }));
        assert.ok(!html.includes('Promising snapshot'));
    });
});

describe('metrics panel: automated coverage section', () => {
    const {buildCoverageAwareSummary} = require('../server-side/metrics/coverage-summary');
    const {buildAutomationCoverage} = require('../server-side/metrics/automation-coverage');

    const automationCoverage = buildAutomationCoverage({
        level: 'AA',
        rules: [
            {ruleId: 'contrast', type: 'automatic', wcag: {scNormative: ['1.4.3']}},
            {ruleId: 'keyboard-review', type: 'manual', wcag: {scNormative: ['2.1.1']}}
        ]
    });

    function finding(ruleId, sc, outcome) {
        return {
            id: ruleId,
            uid: `surea11y:${outcome}:${ruleId}`,
            ruleId,
            outcome,
            confidence: 0.9,
            type: 'automatic',
            occurrences: [],
            wcag: {sc: [sc], scNormative: [sc]},
            standards: {normativeMappings: [{standard: 'WCAG', requirement: sc, conformanceLevel: 'AA'}]}
        };
    }

    const coverage = buildCoverageAwareSummary({
        canonical: {findings: [finding('contrast', '1.4.3', 'fail')]},
        automationCoverage
    });

    function section(cov, a11ySummaryOverride) {
        return rootOf(render(a11ySummaryOverride || summary(), cov).metricsEls).querySelector('.a11y-coverage');
    }

    test('the headline carries every denominator: evaluated, reachable and in scope', () => {
        const text = section(coverage).querySelector('.a11y-cov-headline').textContent;
        assert.match(text, /1 of the 1 criteria automation can reach were evaluated, out of 55 in scope/);
    });

    test('the gauge card is the dial alone, its numbers stated in the text beside it', () => {
        const sec = section(coverage);
        assert.equal(sec.querySelectorAll('.a11y-cov-gauges .a11y-chip').length, 1);
        assert.equal(sec.querySelector('.a11y-cov-gauges .a11y-cov-caption'), null);
    });

    test('the headline names what automation could never reach', () => {
        const text = section(coverage).querySelector('.a11y-cov-headline').textContent;
        assert.match(text, /have no automated check/);
        assert.match(text, /manual review only/);
    });

    test('the per-criterion table is not rendered; the headline and gauges carry it', () => {
        assert.equal(section(coverage).querySelectorAll('table').length, 0);
    });

    test('criteria needing a human are named, not just counted', () => {
        const withReview = buildCoverageAwareSummary({
            canonical: {findings: [finding('keyboard', '2.1.1', 'cantTell')]},
            automationCoverage
        });
        const text = section(withReview).querySelector('.a11y-cov-review').textContent;
        assert.match(text, /Needs a human:/);
        assert.match(text, /2\.1\.1/);
    });

    test('with nothing to review that line is omitted', () => {
        assert.equal(section(coverage).querySelector('.a11y-cov-review'), null);
    });

    test('the conformance limit is carried by the panel caveat, not a block of its own', () => {
        const root = rootOf(render(summary(), coverage).metricsEls);
        assert.equal(root.querySelector('.a11y-coverage .a11y-cov-caption'), null);
        assert.match(root.querySelector('.a11y-score-caveat').textContent, /a check tests just part of what a criterion requires/);
    });

    test('the three reference blocks start collapsed', () => {
        const root = rootOf(render(summary(), coverage).metricsEls);
        for (const d of root.querySelectorAll('details.a11y-details')) {
            assert.equal(d.hasAttribute('open'), false, `${d.querySelector('summary')?.textContent.trim()} should start collapsed`);
        }
    });

    test('the gauges sit in their own column beside the explanation', () => {
        const sec = section(coverage);
        assert.ok(sec.querySelector('.a11y-cov-layout > .a11y-cov-gauges'));
        assert.ok(sec.querySelector('.a11y-cov-layout > .a11y-cov-explain'));
    });

    test('a run with no scope denominator still reports what it reached', () => {
        const noScope = buildCoverageAwareSummary({canonical: {findings: [finding('contrast', '1.4.3', 'fail')]}});
        const text = section(noScope).querySelector('.a11y-cov-headline').textContent;
        assert.match(text, /1 of 1 criteria reached by this scan/);
    });

    test('the section falls back to a coverage summary carried on the a11ySummary', () => {
        const withNested = summary({coverageSummary: coverage});
        assert.ok(section(null, withNested));
    });

    test('nothing is rendered when there is no coverage data at all', () => {
        assert.equal(section(null), null);
        assert.equal(section({criteria: [], coverage: {}}), null);
    });

});

describe('metrics panel: structural signals replace the readiness score', () => {
    test('no readiness chip is rendered', () => {
        const html = metricsHtml(summary());
        assert.ok(!html.includes('Structural signals'));
        assert.ok(!/aria-labelledby="g_scores-readiness/.test(html));
    });

    test('the structure signals are still listed individually', () => {
        const html = metricsHtml(summary());
        assert.ok(html.includes('Page structure signals'));
        assert.ok(html.includes('Semantic markup'));
        assert.ok(html.includes('Hidden content'));
    });

    test('review signals are listed rather than summed into a score', () => {
        const els = render(summary({
            flags: {
                manualReviewNeeded: true,
                manualReviewReasons: ['a lot of hidden or conditional content that was not in scope', 'shadow DOM present, which can hide content from checks']
            }
        })).metricsEls;
        const root = rootOf(els);
        const block = root.querySelector('.a11y-review-signals');
        assert.ok(block);
        assert.match(block.querySelector('.a11y-review-signals-head').textContent, /2 signals that automation may not have seen everything/);
        assert.equal(block.querySelectorAll('.a11y-review-signals-list li').length, 2);
    });

    test('a single signal is counted in the singular', () => {
        const root = rootOf(render(summary({
            flags: {manualReviewNeeded: true, manualReviewReasons: ['the scan hit a size cap, so results are partial']}
        })).metricsEls);
        assert.match(root.querySelector('.a11y-review-signals-head').textContent, /^1 signal that/);
    });

    test('with no signals the panel says so instead of leaving a gap', () => {
        const root = rootOf(render(summary({flags: {manualReviewNeeded: false, manualReviewReasons: []}})).metricsEls);
        const block = root.querySelector('.a11y-review-signals-none');
        assert.ok(block);
        assert.match(block.textContent, /No signals suggesting automation missed part of this page/);
    });

    test('a summary with no reasons array does not throw', () => {
        assert.ok(rootOf(render(summary({flags: {manualReviewNeeded: false}})).metricsEls).querySelector('.a11y-review-signals-none'));
    });
});

describe('metrics panel: where the issues cluster', () => {
    function mined(overrides = {}) {
        return {
            pagesScanned: 3,
            topPatterns: [
                {pattern: '.hero > img', element: 'img', occurrences: 12, pages: 3, ruleIds: ['img-alt'], sampleHtml: '<img>'},
                {pattern: 'button', element: 'button', occurrences: 4, pages: 2, ruleIds: ['contrast'], sampleHtml: null}
            ],
            topElements: [{pattern: 'img', element: 'img', occurrences: 12, pages: 3, ruleIds: ['img-alt'], sampleHtml: null}],
            reach: [
                {ruleId: 'img-alt', outcome: 'fail', severity: 'serious', occurrences: 12, pagesAffected: 3, pagesScanned: 3, scope: 'systemic'},
                {ruleId: 'contrast', outcome: 'fail', severity: 'serious', occurrences: 4, pagesAffected: 1, pagesScanned: 3, scope: 'local'}
            ],
            totals: {clusteredOccurrences: 16, distinctPatterns: 2, systemic: 1, partial: 0, local: 1},
            ...overrides
        };
    }

    function section(occurrences) {
        return rootOf(render(summary({occurrences})).metricsEls).querySelector('.a11y-occurrences');
    }

    test('the top patterns are listed with their occurrence and page counts', () => {
        const rows = section(mined()).querySelectorAll('table')[0].querySelectorAll('tbody tr');
        assert.equal(rows.length, 2);
        assert.match(rows[0].textContent, /\.hero > img/);
        assert.match(rows[0].textContent, /12/);
    });

    test('a defect on every page is labelled systemic, one page local', () => {
        const text = section(mined()).textContent;
        assert.match(text, /On every page scanned/);
        assert.match(text, /On one page only/);
    });

    test('the headline counts systemic and local defects', () => {
        const head = section(mined()).querySelector('.a11y-cov-headline').textContent;
        assert.match(head, /16 occurrences across 2 distinct patterns/);
        assert.match(head, /1 defect\(s\) on every page, 1 on one page only/);
    });

    test('a single-page run says scope cannot be told rather than claiming local', () => {
        const one = mined({
            pagesScanned: 1,
            reach: [{ruleId: 'img-alt', outcome: 'fail', severity: 'serious', occurrences: 12, pagesAffected: 1, pagesScanned: 1, scope: 'unknown'}],
            totals: {clusteredOccurrences: 12, distinctPatterns: 1, systemic: 0, partial: 0, local: 0}
        });
        const head = section(one).querySelector('.a11y-cov-headline').textContent;
        assert.match(head, /Scan more than one page to tell systemic defects from local ones/);
    });

    test('nothing renders when no occurrences were clustered', () => {
        assert.equal(section(mined({totals: {clusteredOccurrences: 0, distinctPatterns: 0, systemic: 0, partial: 0, local: 0}})), null);
        assert.equal(section(null), null);
        assert.equal(rootOf(render(summary()).metricsEls).querySelector('.a11y-occurrences'), null);
    });

    test('wide pattern tables scroll inside their own container', () => {
        assert.ok(section(mined()).querySelectorAll('.a11y-cov-tablewrap').length >= 2);
    });
});

describe('metrics panel: confidence on both report types', () => {
    function chipNames(a11ySummary) {
        const grid = rootOf(render(a11ySummary).metricsEls).querySelector('.a11y-scoregrid:not(.a11y-cov-gauges)');
        return [...grid.children].map((c) => c.querySelector('h4')?.textContent.trim() || '?');
    }

    const asPortfolio = (s) => ({...s, stats: {pageAccessibility: {n: 3, mean: 60}}});

    test('a single-page report shows the confidence chip', () => {
        assert.ok(chipNames(summary()).includes('Assessment Confidence'));
    });

    test('a portfolio report shows it too, alongside the risk indicator', () => {
        const names = chipNames(asPortfolio(summary()));
        assert.ok(names.includes('Assessment Confidence'));
        assert.ok(names.includes('Accessibility Risk Ind.'));
        assert.equal(names.length, 4);
    });

    test('the risk indicator stays off single-page reports', () => {
        assert.ok(!chipNames(summary()).includes('Accessibility Risk Ind.'));
    });
});

describe('metrics panel: absent values say why they are absent', () => {
    function chipFor(label, a11ySummary) {
        return [...rootOf(render(a11ySummary).metricsEls).querySelectorAll('.a11y-chip-unevaluated')]
            .find((c) => c.querySelector('h4')?.textContent.trim() === label) || null;
    }

    test('unmeasured confidence is reported as not measured, not as unevaluated', () => {
        const chip = chipFor('Assessment Confidence', summary({scores: {...summary().scores, confidence: null}}));
        assert.ok(chip);
        assert.equal(chip.querySelector('.a11y-chip-unevaluated-value').textContent.trim(), 'Not measured');
        assert.match(chip.querySelector('.a11y-cov-caption').textContent, /Nothing found carried a confidence/);
    });

    test('a withheld score still reports that nothing was evaluated', () => {
        const chip = chipFor('Automated check result', summary({
            scores: {...summary().scores, avgPageAccessibility: null, adjusted: null}
        }));
        assert.ok(chip);
        assert.equal(chip.querySelector('.a11y-chip-unevaluated-value').textContent.trim(), 'Not evaluated');
        assert.match(chip.querySelector('.a11y-cov-caption').textContent, /No criteria were evaluated/);
    });
});

describe('metrics panel — accessibility invariants', () => {
    test('help affordances are focusable disclosures, not inert spans', () => {
        const root = rootOf(render(summary()).metricsEls);
        const disclosures = [...root.querySelectorAll('.a11y-help-disclosure')];
        assert.ok(disclosures.length, 'expected the metric help affordances');

        for (const d of disclosures) {
            assert.equal(d.tagName, 'DETAILS',
                'the help must be a disclosure the platform can focus and expand without script');
            const summaryEl = d.querySelector('summary.a11y-help');
            assert.ok(summaryEl, 'the disclosure needs a summary to act as its button');
            assert.ok(d.querySelector('.a11y-help-body')?.textContent.trim().length > 1,
                'the disclosure must hold the help text as real content');
            assert.equal(d.hasAttribute('open'), false, 'help starts collapsed');
        }
    });

    test('the help glyph is decorative and the summary names its metric', () => {
        const root = rootOf(render(summary()).metricsEls);

        for (const summaryEl of root.querySelectorAll('summary.a11y-help')) {
            const glyph = summaryEl.querySelector('[aria-hidden="true"]');
            assert.equal(glyph?.textContent, '?', 'the "?" must be decorative');

            const named = summaryEl.querySelector('.visually-hidden')?.textContent?.trim() || '';
            assert.match(named, /^About .+/,
                `the disclosure is named only "${named}", which does not say what it explains`);
        }
    });

    test('no help text is left reachable only by pointer', () => {
        const html = htmlOf(render(summary()).metricsEls);
        assert.doesNotMatch(html, /class="a11y-help"[^>]*\btitle=/,
            'title is pointer-only; the help belongs in the disclosure body');
    });

    test('the assessment banner states its severity in words, not only in colour', () => {
        const root = rootOf(render(summary()).narrativeEls);
        const banner = root.querySelector('.a11y-banner');
        assert.ok(banner, 'expected the assessment banner');

        const severityClass = [...banner.classList].find((c) => /^a11y-banner-/.test(c));
        assert.ok(severityClass, 'banner encodes severity in a class');

        const title = banner.querySelector('.a11y-banner-title')?.textContent?.trim() || '';
        assert.ok(title.length > 0,
            'the severity class must be accompanied by a worded title, or colour is the only cue');
    });

    test('every table ships headers with a scope', () => {
        const root = rootOf(render(summary()).metricsEls.concat(render(summary()).narrativeEls));
        for (const th of root.querySelectorAll('th')) {
            assert.ok(['col', 'row'].includes(th.getAttribute('scope')),
                `<th>${th.textContent.trim()}</th> has no scope`);
        }
    });
});

describe('metrics panel: chips without usable definitions', () => {
    // A report saved before a metric def existed arrives with no defs at all.
    function renderWithoutDefs(a11ySummary) {
        return generateA11yMetricsContents({a11ySummary, domMetrics: DOM_METRICS, coverageSummary: null, metricDefs: {}});
    }

    test('a chip with no gauge still reads as a metric, never as "undefined"', () => {
        const root = rootOf(renderWithoutDefs(summary()).metricsEls);
        const chips = [...root.querySelectorAll('.a11y-chip')];
        assert.ok(chips.length, 'expected the score chips');

        for (const chip of chips) {
            assert.doesNotMatch(chip.textContent, /undefined/,
                'an absent gauge must not be interpolated into the chip');
            assert.ok(chip.querySelector('.a11y-chip-name')?.textContent.trim().length,
                'the fallback must still name the metric');
            assert.ok(chip.querySelector('.a11y-chip-value')?.textContent.trim().length,
                'the fallback must still state the value');
        }
    });

    test('no rendered metric markup leaks the string "undefined"', () => {
        const {metricsEls, narrativeEls} = renderWithoutDefs(summary());
        assert.doesNotMatch(htmlOf(metricsEls) + htmlOf(narrativeEls), /undefined/);
    });
});

/**
 * A withheld score is shown in its withheld state, never dropped. An absent tile and a
 * clean tile look identical to a reader who does not know the tile is sometimes
 * hidden - and in an exported report nobody knows that.
 */
describe('metrics panel: a scan too thin to measure', () => {
    const thin = summary({
        inputs: {
            domTotal: 146,
            axe: {violations: 2, incomplete: 5, passes: 32},
            controls: {},
            contentUnits: {evaluable: 12, primary: 'evaluable', primarySize: 12}
        },
        scores: {
            evidence: null,
            confidence: 82,
            adjusted: null,
            avgPageAccessibility: null,
            evaluationState: 'notMeasurable',
            criteriaEvaluated: 20,
            criteriaInScope: 55
        }
    });

    const root = () => rootOf(render(thin).metricsEls);

    test('the score cards give way to the statement, which says more than they did', () => {
        // Two of the three would have repeated the same sentence and the third would
        // have shown a confident dial beside them. Nothing goes unsaid: the statement
        // is more prominent than the cards it replaces.
        assert.equal(root().querySelectorAll('.a11y-scoregrid:not(.a11y-cov-gauges)').length, 0);
        assert.ok(root().querySelector('.a11y-score-state-notmeasurable'));
    });

    test('no score is rendered as a number anywhere in the block', () => {
        const notice = root().querySelector('.a11y-score-state-notmeasurable');
        assert.doesNotMatch(notice.querySelector('.a11y-score-state-head').textContent, /\b0\b/);
    });

    test('a confident engine reading never stands alone as a verdict on the page', () => {
        const notice = root().querySelector('.a11y-score-state-notmeasurable').textContent;
        // The reading is kept, but tied to the checks it describes.
        assert.match(notice, /82% confidence in the checks that did run/);
        assert.match(notice, /not that the page was covered/);
    });

    test('the reason is stated once for the scan, not repeated per chip', () => {
        const notices = root().querySelectorAll('.a11y-score-state-notmeasurable');
        assert.equal(notices.length, 1);
        assert.match(notices[0].textContent, /No score for this scan/);
        assert.match(notices[0].textContent, /12 testable elements/);
    });

    test('what the run did find is still reported as real and actionable', () => {
        const notice = root().querySelector('.a11y-score-state-notmeasurable');
        assert.match(notice.textContent, /2 failing checks/);
        assert.match(notice.textContent, /5 needing review/);
        assert.match(notice.textContent, /real and worth acting on/);
    });

    test('it points at the likely cause rather than leaving the reader guessing', () => {
        const notice = root().querySelector('.a11y-score-state-notmeasurable');
        assert.match(notice.textContent, /after its content had rendered/);
    });

    test('a measurable scan shows no such notice', () => {
        const ok = rootOf(render(summary({
            scores: {...summary().scores, evaluationState: 'evaluated'}
        })).metricsEls);
        assert.equal(ok.querySelectorAll('.a11y-score-state-notmeasurable').length, 0);
    });
});

describe('metrics panel: confidence measured over part of the evidence', () => {
    const withCoverage = (confidenceCoverage) => summary({
        scores: {...summary().scores, confidence: 100, confidenceCoverage}
    });

    const textOf = (a11ySummary) => {
        const grid = rootOf(render(a11ySummary).metricsEls).querySelector('.a11y-scoregrid:not(.a11y-cov-gauges)');
        const chip = [...grid.children].find((c) => /Assessment Confidence/.test(c.textContent));
        return chip ? chip.textContent : '';
    };

    test('a partial reading says what share of the findings it covers', () => {
        assert.match(textOf(withCoverage(5)), /measured on 5% of findings/);
    });

    test('a full reading carries no qualifier', () => {
        assert.doesNotMatch(textOf(withCoverage(100)), /measured on/);
    });

    test('a report with no coverage figure at all is unchanged', () => {
        assert.doesNotMatch(textOf(withCoverage(undefined)), /measured on/);
    });
});
