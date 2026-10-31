'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildConformanceReport, carryReviewForward } = require('./conformance-report.js');
const { conformanceReportHTML } = require('./conformance-report-html.js');

function finding(sc, outcome, elements = 1) {
    return {
        ruleId: `wcag-${sc}`,
        title: `Rule for ${sc}`,
        outcome,
        wcag: { sc: [sc], scNormative: [sc] },
        occurrences: Array.from({ length: elements }, (_, i) => ({ target: [`#e${i}`] })),
    };
}

function scan(label, findings, criteria) {
    return {
        label: `Scan: ${label}`,
        url: `https://shop.test/${label.toLowerCase()}`,
        canonical: { findings, engines: [{ id: 'surea11y', name: 'surea11y', version: '1.14.1' }] },
        metrics: { coverageSummary: { criteria } },
    };
}

const report = {
    scenarioName: 'Shop',
    timestamp: '2026-10-30T09:00:00Z',
    scans: [
        scan('Home', [finding('1.1.1', 'fail', 2), finding('2.4.7', 'cantTell')], [
            { sc: '1.1.1', status: 'doesNotSupport' },
            { sc: '1.2.1', status: 'notApplicable' },
            { sc: '1.4.1', status: 'supports' },
            { sc: '2.4.7', status: 'needsReview' },
        ]),
        scan('Cart', [finding('1.1.1', 'fail', 1)], [
            { sc: '1.1.1', status: 'doesNotSupport' },
            { sc: '1.2.1', status: 'notApplicable' },
        ]),
    ],
};

const rowOf = (acr, tableId, id) => acr.tables.find((t) => t.id === tableId).rows.find((r) => r.id === id);

describe('the conformance report\'s draft', () => {
    const acr = buildConformanceReport(report);

    test('a failure on some page is "Does Not Support", with where and how many', () => {
        const r = rowOf(acr, 'wcag-a', '1.1.1');
        assert.equal(r.conformance, 'doesNotSupport');
        assert.equal(r.source, 'draft');
        assert.equal(r.remarks, 'Automated checks found 3 failing elements, on Home and Cart.');
    });

    test('nothing to apply to on any page is "Not Applicable", to confirm', () => {
        const r = rowOf(acr, 'wcag-a', '1.2.1');
        assert.equal(r.conformance, 'notApplicable');
        assert.match(r.remarks, /confirm for the rest of the product/);
    });

    test('automation never says "Supports": no failure is "Not Evaluated", and says why', () => {
        assert.equal(rowOf(acr, 'wcag-a', '1.4.1').conformance, 'notEvaluated');
        assert.match(rowOf(acr, 'wcag-a', '1.4.1').remarks, /check only part of this criterion/);
        assert.equal(rowOf(acr, 'wcag-aa', '2.4.7').conformance, 'notEvaluated');
        assert.match(rowOf(acr, 'wcag-aa', '2.4.7').remarks, /need a person to confirm this on Home/);
        assert.equal(rowOf(acr, 'wcag-a', '2.1.1').remarks, 'Only a person can check this.');
        assert.equal(acr.totals.byLevel.supports, 0);
        assert.equal(acr.totals.byLevel.partiallySupports, 0);
    });

    test('WCAG 2.2 AA by default, with EN 301 549 V4.1.1, whose chapter 9 restates it', () => {
        assert.deepEqual(acr.target, { wcagVersion: '2.2', level: 'AA', en301549: 'V4.1.1' });
        assert.equal(acr.totals.criteria, 55);
        const ch9 = acr.tables.find((t) => t.id === 'en-9').rows;
        assert.equal(ch9.filter((r) => r.wcag).length, 55);
        assert.deepEqual(ch9.filter((r) => !r.wcag).map((r) => r.id), ['9.6', '9.7'], 'then its own requirements');
        assert.equal(rowOf(acr, 'en-9', '9.1.1.1').conformance, 'doesNotSupport');
        assert.ok(!ch9.some((r) => r.id === '9.4.1.1'), '4.1.1 is not in WCAG 2.2');
    });

    test('chapters 4 and 12 and the others are for the author', () => {
        assert.equal(acr.tables.find((t) => t.id === 'en-4').rows.length, 11);
        assert.equal(acr.tables.find((t) => t.id === 'en-12').rows.length, 5);
        assert.ok(acr.tables.find((t) => t.id === 'en-4').rows.every((r) => r.conformance === 'notEvaluated'));
    });

    test('the product and what was evaluated come from the report', () => {
        assert.equal(acr.product.name, 'Shop');
        assert.equal(acr.product.date, '2026-10-30');
        assert.deepEqual(acr.evaluation.pages.map((p) => p.label), ['Home', 'Cart']);
        assert.deepEqual(acr.evaluation.engine, { name: 'surea11y', version: '1.14.1' });
    });
});

describe('a reviewer\'s verdicts', () => {
    const review = {
        product: { name: 'Shop', version: '3.1' },
        criteria: { '1.1.1': { conformance: 'partiallySupports', remarks: 'Product images lack alt text.' } },
        clauses: { '4.2.1': { conformance: 'supports', remarks: 'Tested with a screen reader.' } },
    };
    const acr = buildConformanceReport(report, { review });

    test('take the draft\'s place, in WCAG and in chapter 9 alike', () => {
        for (const [table, id] of [['wcag-a', '1.1.1'], ['en-9', '9.1.1.1']]) {
            const r = rowOf(acr, table, id);
            assert.equal(r.conformance, 'partiallySupports');
            assert.equal(r.source, 'review');
            assert.equal(r.remarks, 'Product images lack alt text.');
            assert.equal(r.draft.conformance, 'doesNotSupport', 'the draft is kept beside it');
        }
        assert.equal(rowOf(acr, 'en-4', '4.2.1').conformance, 'supports');
        assert.equal(acr.product.version, '3.1');
        assert.equal(acr.totals.reviewed, 1);
    });

    test('an unknown level is ignored rather than shown', () => {
        const odd = buildConformanceReport(report, { review: { criteria: { '1.1.1': { conformance: 'great' } } } });
        assert.equal(rowOf(odd, 'wcag-a', '1.1.1').source, 'draft');
    });
});

test('a WCAG 2.1 target uses EN 301 549 V3.2.1, whose chapter 9 has 4.1.1 and not WCAG 2.2\'s criteria', () => {
    const acr = buildConformanceReport(report, { target: { wcagVersion: '2.1' } });
    assert.equal(acr.target.en301549, 'V3.2.1');
    const ids = acr.tables.find((t) => t.id === 'en-9').rows.map((r) => r.id);
    assert.ok(ids.includes('9.4.1.1'));
    assert.ok(!ids.includes('9.2.4.11'));
    assert.equal(acr.totals.criteria, 50);
});

describe('the HTML file', () => {
    const html = conformanceReportHTML(buildConformanceReport({ ...report, scenarioName: 'Shop <script>alert(1)</script>' }), { generatedAt: '2026-10-30' });

    test('is a complete, titled, English document', () => {
        assert.match(html, /^<!doctype html>\n<html lang="en">/);
        assert.match(html, /<title>Shop &lt;script&gt;alert\(1\)&lt;\/script&gt;: Accessibility Conformance Report<\/title>/);
        assert.doesNotMatch(html, /<script>alert/);
    });

    test('has a captioned table for each part, with a row header per criterion', () => {
        assert.equal((html.match(/<table class="criteria" role="table"><caption>/g) || []).length, 6);
        assert.match(html, /<th scope="row" role="rowheader">1\.1\.1 Non-text Content \(Level A\)<\/th>/);
        assert.match(html, /<th scope="row" role="rowheader">9\.1\.1\.1 Non-text Content \(Level A\)<\/th>/);
    });

    test('says which entries are still the draft', () => {
        assert.match(html, /still the automated draft/);
        assert.match(html, /Automated draft<\/span>/);
    });
});

test('carrying a review forward fills in only what this report has not decided', () => {
    const review = {
        product: { name: 'Shop' },
        criteria: { '1.1.1': { conformance: 'doesNotSupport', remarks: 'Still missing.' } },
        clauses: {},
    };
    const earlier = {
        product: { name: 'Old name', version: '3.0' },
        reviewer: 'A. Reviewer',
        criteria: {
            '1.1.1': { conformance: 'supports', remarks: 'Fixed then.' },
            '2.1.1': { conformance: 'supports', remarks: 'Keyboard checked.' },
            '2.4.7': { remarks: 'A note without a level.' },
        },
        clauses: { '4.2.1': { conformance: 'partiallySupports', remarks: 'Screen reader gaps.' } },
    };
    assert.equal(carryReviewForward(review, earlier), 2);
    assert.equal(review.criteria['1.1.1'].conformance, 'doesNotSupport', 'this report\'s own verdict stays');
    assert.equal(review.criteria['2.1.1'].remarks, 'Keyboard checked.');
    assert.equal(review.criteria['2.4.7'], undefined, 'a note without a level is not a verdict');
    assert.equal(review.clauses['4.2.1'].conformance, 'partiallySupports');
    assert.deepEqual(review.product, { name: 'Shop', version: '3.0' });
    assert.equal(review.reviewer, 'A. Reviewer');
    assert.equal(carryReviewForward(review, null), 0);
});

test('carrying a review forward keeps the answers and remarks a row already has', () => {
    const review = { product: {}, criteria: { '2.1.1': { remarks: 'Mine.', facets: { a: 'fail' } }, '1.1.1': { conformance: 'supports' } }, clauses: {} };
    const other = { criteria: { '2.1.1': { conformance: 'doesNotSupport', remarks: 'Theirs.', facets: { a: 'pass', b: 'pass' } }, '1.1.1': { conformance: 'doesNotSupport' } } };
    assert.equal(carryReviewForward(review, other), 1);
    assert.deepEqual(review.criteria['2.1.1'], { conformance: 'doesNotSupport', remarks: 'Mine.', facets: { a: 'fail', b: 'pass' } });
    assert.equal(review.criteria['1.1.1'].conformance, 'supports', 'a verdict of its own is kept');
});

test('the checks a person answered are listed under their criterion, and counted in the methods', () => {
    const reviewed = {
        ...report,
        conformanceReview: {
            reviewer: 'Ana',
            criteria: {
                '2.4.7': { conformance: 'partiallySupports', remarks: 'Checked by hand, 2 checks: 1 fails, 1 passes.', facets: {
                    'focus-visible-keyboard': { result: 'fail', label: 'Focus is visible <always>' },
                    'focus-visible-custom': { result: 'pass', label: 'Custom focus styles show' },
                } },
                '1.4.1': { facets: { 'color-only': 'na', bogus: { result: 'maybe' } } },
            },
        },
    };
    const acr = buildConformanceReport(reviewed);
    assert.deepEqual(rowOf(acr, 'wcag-aa', '2.4.7').checks.map((c) => [c.resultLabel, c.label]), [['Fails', 'Focus is visible <always>'], ['Passes', 'Custom focus styles show']]);
    assert.deepEqual(rowOf(acr, 'wcag-a', '1.4.1').checks.map((c) => [c.id, c.resultLabel, c.label]), [['color-only', "Doesn't apply", 'color-only']], 'answers alone, with no verdict yet, are listed too');
    assert.deepEqual(rowOf(acr, 'wcag-a', '1.1.1').checks, []);
    assert.equal(rowOf(acr, 'en-9', '9.2.4.7').checks.length, 2, 'chapter 9 restates the criterion');
    assert.deepEqual(acr.evaluation.manualChecks, { checks: 3, criteria: 2, enRequirements: 0 });
    assert.equal(acr.evaluation.methodsText, 'Automated checks with surea11y 1.14.1 against WCAG 2.2 Level AA. Manual review by Ana. '
        + 'Manual checks following the test procedures of surea11y 1.14.1: 3 checks answered, on 2 WCAG criteria, each listed under its row.');
    assert.doesNotMatch(buildConformanceReport(report).evaluation.methodsText, /Manual checks/, 'none without answers');

    const html = conformanceReportHTML(acr);
    assert.match(html, /<p class="checks-head">Checked by hand:<\/p><ul class="checks"><li><span class="result" data-result="fail">Fails:<\/span> Focus is visible &lt;always&gt;<\/li>/);
    assert.match(html, /<dt>Evaluation methods<\/dt><dd>[^<]*3 checks answered, on 2 WCAG criteria/);
});

test('EN 301 549\'s own rows follow the target version, chapter 13 included', () => {
    const v4 = buildConformanceReport(report, { target: { wcagVersion: '2.2', en301549: 'V4.1.1' } });
    const v3 = buildConformanceReport(report, { target: { wcagVersion: '2.1', en301549: 'V3.2.1' } });
    const ids = (acr, id) => acr.tables.find((t) => t.id === id).rows.map((r) => r.id);
    assert.deepEqual(ids(v4, 'en-12'), ['12.1', '12.2', '12.3', '12.4', '12.5'], 'V4.1.1 renumbered chapter 12');
    assert.deepEqual(ids(v3, 'en-12'), ['12.1.1', '12.1.2', '12.2.2', '12.2.3', '12.2.4']);
    assert.deepEqual(ids(v4, 'en-other'), ['5', '6', '7', '8', '10', '11', '13']);
    assert.equal(rowOf(v4, 'en-other', '11').name, 'Chapter 11: Non-web software');
    assert.equal(rowOf(v3, 'en-other', '11').name, 'Chapter 11: Software');
    assert.equal(ids(v4, 'en-4').length, 11);
});

test('answers on EN 301 549\'s own rows are listed, and counted apart from WCAG\'s', () => {
    const reviewed = {
        ...report,
        conformanceReview: {
            criteria: { '2.4.7': { facets: { a: { result: 'pass', label: 'A' } } } },
            clauses: {
                '4.2.1': { conformance: 'supports', facets: { tasks: { result: 'pass', label: 'Main tasks done with a screen reader' } } },
                'chapter-11': { conformance: 'notApplicable', facets: { applies: { result: 'na', label: 'The product is software' } } },
            },
        },
    };
    const acr = buildConformanceReport(reviewed);
    assert.deepEqual(rowOf(acr, 'en-4', '4.2.1').checks.map((c) => c.resultLabel), ['Passes']);
    assert.deepEqual(rowOf(acr, 'en-other', '11').checks.map((c) => c.label), ['The product is software']);
    assert.deepEqual(acr.evaluation.manualChecks, { checks: 3, criteria: 1, enRequirements: 2 });
    assert.match(acr.evaluation.methodsText, /3 checks answered, on 1 WCAG criterion and 2 EN 301 549 requirements of its own, each listed under its row\.$/);
});

test('chapter 9 has its own requirements after its clauses: 9.6, and 9.7 from V4.1.1', () => {
    const v4 = buildConformanceReport(report, { target: { wcagVersion: '2.2', en301549: 'V4.1.1' } });
    const v3 = buildConformanceReport(report, { target: { wcagVersion: '2.1', en301549: 'V3.2.1' } });
    const own = (acr) => acr.tables.find((t) => t.id === 'en-9').rows.filter((r) => !r.wcag).map((r) => `${r.id} ${r.name}`);
    assert.deepEqual(own(v4), ['9.6 WCAG conformance requirements', '9.7 User preferences for web pages']);
    assert.deepEqual(own(v3), ['9.6 WCAG conformance requirements']);
    assert.equal(rowOf(v4, 'en-9', '9.6').draft.conformance, 'notEvaluated');
    assert.equal(v4.tables.find((t) => t.id === 'en-12').title, 'Chapter 12: Information about Products and Services');
    assert.equal(v3.tables.find((t) => t.id === 'en-12').title, 'Chapter 12: Documentation and Support Services');
    const reviewed = buildConformanceReport({ ...report, conformanceReview: { clauses: { '9.7': { conformance: 'supports', facets: { colours: { result: 'pass', label: 'Colours' } } } } } });
    assert.equal(rowOf(reviewed, 'en-9', '9.7').conformance, 'supports');
    assert.equal(reviewed.evaluation.manualChecks.enRequirements, 1);
});
