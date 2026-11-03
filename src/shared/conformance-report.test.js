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

describe('a standard registered from its pack', () => {
    const { registerStandard, clearStandards } = require('./conformance-report.js');
    const LISTING = {
        key: 'demo', standard: 'Demo Standard', version: '2.0',
        requirements: [
            { id: '1.1', title: null },
            { id: '1.2', title: 'Restates 1.4.3', wcag: '1.4.3' },
            { id: '2.1', title: 'Forms are labelled' },
            { id: '7', title: null },
        ],
        groups: [
            { id: '1', title: 'Images', requirements: [], groups: [{ id: '1.x', title: 'Sub', requirements: ['1.1', '1.2'], groups: [] }] },
            { id: '2', title: 'Forms', requirements: ['2.1'], groups: [] },
        ],
    };
    const scanned = (profile, findings = []) => ({
        ...report,
        scans: [{ ...report.scans[0], profile: { id: profile, label: 'Demo 2.0' }, canonical: { ...report.scans[0].canonical, findings: [...report.scans[0].canonical.findings, ...findings] } }],
    });

    test('a report whose scans used its profile gets a table per group, of the requirements of its own', () => {
        clearStandards();
        assert.equal(registerStandard(LISTING, { profiles: ['demo-2.0'] }), true);
        try {
            const acr = buildConformanceReport(scanned('demo-2.0', [{
                ruleId: 'r', title: 'Alt', outcome: 'fail', wcag: { sc: ['1.1.1'] }, occurrences: [{}, {}],
                standards: { normativeMappings: [{ standard: 'Demo Standard', requirement: '1.1', version: '2.0', title: 'Images have alternatives' }, { standard: 'Other', requirement: '2.1' }] },
            }]));
            const demo = acr.tables.filter((t) => t.standard === 'demo');
            assert.deepEqual(demo.map((t) => [t.id, t.title, t.version, t.rows.map((r) => r.id)]), [
                ['std-demo-1', 'Demo Standard 2.0: Images', '2.0', ['1.1']],
                ['std-demo-2', 'Demo Standard 2.0: Forms', '2.0', ['2.1']],
                ['std-demo-other', 'Demo Standard 2.0: Other requirements', '2.0', ['7']],
            ]);
            assert.equal(demo[0].rows[0].conformance, 'doesNotSupport', 'drafted from the findings that name it');
            assert.equal(demo[0].rows[0].name, 'Images have alternatives', 'a title its listing lacks, as its findings name it');
            assert.match(demo[0].rows[0].remarks, /2 failing elements/);
            assert.equal(demo[1].rows[0].remarks, 'Only a person can check this.', 'another standard\'s mapping is not its');
            assert.equal(demo[2].rows[0].name, 'Requirement 7', 'no title anywhere');
            assert.ok(!conformanceReportHTML(acr).includes('Demo Standard'), 'the VPAT shows WCAG and EN 301 549 alone');
            assert.equal(buildConformanceReport(scanned('wcag22-aa')).tables.some((t) => t.standard === 'demo'), false, 'not for a report that did not scan against it');
        } finally {
            clearStandards();
        }
    });

    test('its verdicts are kept by standard and version, and carried forward', () => {
        clearStandards();
        registerStandard(LISTING, { profiles: ['demo-2.0'] });
        try {
            const review = { standards: { demo: { '2.0': { '2.1': { conformance: 'supports', facets: { a: { result: 'pass', label: 'A' } } } } } } };
            const acr = buildConformanceReport({ ...scanned('demo-2.0'), conformanceReview: review });
            const row = acr.tables.find((t) => t.id === 'std-demo-2').rows[0];
            assert.equal(row.conformance, 'supports');
            assert.equal(row.checks.length, 1);
            const mine = { product: {}, criteria: {}, clauses: {}, standards: { demo: { '2.0': { '1.1': { remarks: 'Mine.' } } } } };
            const other = { standards: { demo: { '2.0': { '1.1': { conformance: 'doesNotSupport', remarks: 'Theirs.' }, '2.1': { conformance: 'supports' } } } } };
            assert.equal(carryReviewForward(mine, other), 2);
            assert.deepEqual(mine.standards.demo['2.0']['1.1'], { conformance: 'doesNotSupport', remarks: 'Mine.' });
        } finally {
            clearStandards();
        }
    });

    test('a listing that is not one is refused', () => {
        assert.equal(registerStandard(null), false);
        assert.equal(registerStandard({ key: 'x' }), false, 'no version');
    });
});

test('a report scanned under a standard\'s profile is drafted from the criteria its requirements restate', () => {
    // EN 301 549's profile: findings name clauses, not WCAG's criteria.
    const clause = (sc, outcome, n) => ({
        ...finding(sc, outcome, n),
        wcag: { sc: [], scNormative: [] },
        standards: { normativeMappings: [{ standard: 'EN 301 549', version: 'V4.1.1', requirement: `9.${sc}`, wcagSc: [sc] }] },
    });
    const en = { ...report, scans: [scan('Home', [clause('1.1.1', 'fail', 2), clause('2.4.7', 'cantTell')], [])] };
    const acr = buildConformanceReport(en);
    assert.equal(rowOf(acr, 'wcag-a', '1.1.1').conformance, 'doesNotSupport');
    assert.equal(rowOf(acr, 'wcag-a', '1.1.1').remarks, 'Automated checks found 2 failing elements, on Home.');
    assert.match(rowOf(acr, 'wcag-aa', '2.4.7').remarks, /need a person to confirm this on Home/);
});

test('an element counts once per criterion, however many findings and scans of its page name it', () => {
    // A WCAG finding and the EN 301 549 requirement restating it, in a scan
    // of both, and a second scan of the page: one element.
    const clause = { ...finding('1.1.1', 'fail'), ruleId: 'en-9.1.1.1', wcag: { sc: [], scNormative: [] },
        standards: { normativeMappings: [{ standard: 'EN 301 549', version: 'V4.1.1', requirement: '9.1.1.1', wcagSc: ['1.1.1'] }] } };
    const twice = { ...report, scans: [scan('Home', [finding('1.1.1', 'fail'), clause], []), scan('Home', [finding('1.1.1', 'fail')], [])] };
    const acr = buildConformanceReport(twice);
    assert.equal(rowOf(acr, 'wcag-a', '1.1.1').remarks, 'Automated checks found 1 failing element, on Home.');
});

test("a failing finding's questions are not failing elements: they ask a person to look", () => {
    const mixed = { ...finding('4.1.2', 'fail', 3) };
    mixed.occurrences = mixed.occurrences.map((o, i) => (i ? { ...o, occurrenceOutcome: 'cantTell' } : o));
    const acr = buildConformanceReport({ ...report, scans: [scan('Home', [mixed], [])] });
    assert.equal(rowOf(acr, 'wcag-a', '4.1.2').remarks, 'Automated checks found 1 failing element, on Home.');
});

test('a page whose iframes could not be scanned leaves "Not Applicable" a question', () => {
    const withFrames = { ...report, scans: [{ ...scan('Home', [], [{ sc: '1.1.1', status: 'notApplicable' }]),
        canonical: { findings: [], notices: [{ code: 'frames-not-scanned', message: '1 iframe could not be scanned' }] } }] };
    const r = rowOf(buildConformanceReport(withFrames), 'wcag-a', '1.1.1');
    assert.equal(r.conformance, 'notEvaluated');
    assert.match(r.remarks, /some iframes on Home were not scanned/);
});

test('a page whose iframes the scan left out (Scan iframes too off) leaves "Not Applicable" a question too', () => {
    const withFrames = { ...report, scans: [{ ...scan('Home', [], [{ sc: '1.1.1', status: 'notApplicable' }]),
        canonical: { findings: [], notices: [{ code: 'frames-off', message: 'This page has 1 iframe, and this scan left it out' }] } }] };
    const r = rowOf(buildConformanceReport(withFrames), 'wcag-a', '1.1.1');
    assert.equal(r.conformance, 'notEvaluated');
    assert.match(r.remarks, /some iframes on Home were not scanned/);
});

test('the same element in two iframes of a page is two failing elements', () => {
    const img = (frame) => ({ pageUrl: 'https://shop.test/', target: ['html > body > img'], ...(frame ? { frameSelectors: [frame] } : {}) });
    const finding = { ruleId: 'wcag-1.1.1', title: 'Images', outcome: 'fail', wcag: { sc: ['1.1.1'], scNormative: ['1.1.1'] },
        occurrences: [img(null), img('main > iframe:nth-of-type(1)'), img('main > iframe:nth-of-type(2)')] };
    const withFrames = { ...report, scans: [{ ...scan('Home', [], [{ sc: '1.1.1', status: 'doesNotSupport' }]),
        url: 'https://shop.test/', canonical: { findings: [finding] } }] };
    assert.match(rowOf(buildConformanceReport(withFrames), 'wcag-a', '1.1.1').remarks, /found 3 failing elements/);
});

test('the target is what the scans checked against, unless the options say otherwise', () => {
    const withScans = (scans) => ({ ...report, scans: scans.map((s) => ({ ...report.scans[0], ...s })) });
    // A WCAG 2.2 AAA scan beside a WAI-ARIA one: a WCAG 2.2 AAA report.
    const aaa = buildConformanceReport(withScans([{ wcag: { version: '2.2', level: 'AAA' }, profile: { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' },
        profiles: [{ id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' }, { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' }] }]));
    assert.deepEqual(aaa.target, { wcagVersion: '2.2', level: 'AAA', en301549: 'V4.1.1' });
    // EN 301 549 V3.2.1, among the profiles: its version, WCAG 2.1.
    const en = buildConformanceReport(withScans([{ wcag: { version: '2.1', level: 'AA' }, profile: { id: 'en301549-v3.2.1', label: 'EN 301 549 V3.2.1' } }]));
    assert.deepEqual(en.target, { wcagVersion: '2.1', level: 'AA', en301549: 'V3.2.1' });
    // The options still win.
    assert.equal(buildConformanceReport(withScans([{ wcag: { version: '2.2', level: 'AAA' } }]), { target: { level: 'A' } }).target.level, 'A');
});

test('a report whose scans checked no WCAG profile says what they checked, not a WCAG target', () => {
    const withScans = (scans) => ({ ...report, scans: scans.map((s) => ({ ...report.scans[0], ...s })) });
    const aria = { wcag: { version: '2.2', level: 'AA' }, profile: { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' } };
    const methods = buildConformanceReport(withScans([aria])).evaluation.methodsText;
    assert.match(methods, /^Automated checks with surea11y 1\.14\.1 against WAI-ARIA 1\.2, not against WCAG\./);
    assert.doesNotMatch(methods, /against WCAG 2\.2 Level AA/);
    const aa = { wcag: { version: '2.2', level: 'AA' }, profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' } };
    assert.match(buildConformanceReport(withScans([aa, aria])).evaluation.methodsText, /^Automated checks with surea11y 1\.14\.1 against WCAG 2\.2 Level AA\./);
});

test('the target does not depend on the order of the scans, and a WAI-ARIA scan says nothing of WCAG', () => {
    const withScans = (scans) => ({ ...report, scans: scans.map((s) => ({ ...report.scans[0], ...s })) });
    const en3 = { wcag: { version: '2.1', level: 'AA' }, profile: { id: 'en301549-v3.2.1', label: 'EN 301 549 V3.2.1' } };
    const aa = { wcag: { version: '2.2', level: 'AA' }, profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' } };
    const en4 = { wcag: { version: '2.2', level: 'AA' }, profile: { id: 'en301549-v4.1.1', label: 'EN 301 549 V4.1.1' } };
    assert.deepEqual(buildConformanceReport(withScans([en3, aa])).target, buildConformanceReport(withScans([aa, en3])).target);
    assert.deepEqual(buildConformanceReport(withScans([en3, aa])).target, { wcagVersion: '2.2', level: 'AA', en301549: 'V3.2.1' });
    // Both EN 301 549 versions: the one that restates the WCAG version.
    assert.equal(buildConformanceReport(withScans([en3, en4])).target.en301549, 'V4.1.1');
    // A scan of WAI-ARIA alone, recorded at WCAG AAA by mistake or not, is no WCAG level.
    const aria = { wcag: { version: '2.2', level: 'AAA' }, profile: { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' } };
    assert.equal(buildConformanceReport(withScans([aa, aria])).target.level, 'AA');
    // One scan's version and level, never one's version beside another's
    // level: WCAG 2.2 A beside EN 301 549 V3.2.1 (2.1 AA) is 2.1 AA.
    const a22 = { wcag: { version: '2.2', level: 'A' }, profile: { id: 'wcag22-a', label: 'WCAG 2.2 A' } };
    assert.deepEqual(buildConformanceReport(withScans([a22, en3])).target, { wcagVersion: '2.1', level: 'AA', en301549: 'V3.2.1' });
    assert.deepEqual(buildConformanceReport(withScans([en3, a22])).target, buildConformanceReport(withScans([a22, en3])).target);
});
