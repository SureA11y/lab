'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    readConformance, conformanceMatrix, isFailing, principleOf,
} = require('./report-conformance.js');

function criterion(sc, status, level = null) {
    return { sc, status, level, failCount: status === 'doesNotSupport' ? 1 : 0, occurrenceCount: 0, ruleIds: [] };
}

/** A report whose scans carry the criterion verdicts the runner computed. */
function withCoverage(perScan) {
    return {
        scans: perScan.map((criteria, i) => ({
            id: `s${i}`,
            url: `https://x/p${i}`,
            canonical: { findings: [] },
            metrics: { coverageSummary: { criteria } },
        })),
    };
}

/** A report that carries findings only, as an older export would. */
function withFindings(findings) {
    return { scans: [{ id: 's0', url: 'https://x/', canonical: { findings } }] };
}

function finding(ruleId, sc, outcome, { level = null, occurrences = 1 } = {}) {
    return {
        id: ruleId, ruleId, outcome, severity: 'serious',
        wcag: { sc: [sc], scNormative: [sc] },
        standards: { normativeMappings: [{ requirement: sc, conformanceLevel: level }] },
        occurrences: Array.from({ length: occurrences }, (_, i) => ({ pageUrl: 'https://x/', target: [`#${i}`] })),
    };
}

describe('report-conformance — reading the criterion verdicts a run wrote', () => {
    test('merges the scans of one report by taking the worst verdict any page reached', () => {
        const conf = readConformance(withCoverage([
            [criterion('1.4.3', 'supports', 'AA'), criterion('1.1.1', 'supports', 'A')],
            [criterion('1.4.3', 'doesNotSupport', 'AA'), criterion('1.1.1', 'supports', 'A')],
        ]));

        assert.equal(conf.source, 'coverage');
        const bySc = Object.fromEntries(conf.criteria.map((c) => [c.sc, c.status]));
        assert.equal(bySc['1.4.3'], 'doesNotSupport', 'a criterion one page fails is one the site fails');
        assert.equal(bySc['1.1.1'], 'supports');
    });

    test('needsReview loses to a real failure but beats a pass', () => {
        const conf = readConformance(withCoverage([
            [criterion('1.4.3', 'supports'), criterion('2.4.7', 'supports')],
            [criterion('1.4.3', 'needsReview'), criterion('2.4.7', 'doesNotSupport')],
            [criterion('1.4.3', 'supports'), criterion('2.4.7', 'needsReview')],
        ]));
        const bySc = Object.fromEntries(conf.criteria.map((c) => [c.sc, c.status]));

        assert.equal(bySc['1.4.3'], 'needsReview');
        assert.equal(bySc['2.4.7'], 'doesNotSupport');
    });

    test('falls back to the findings when no scan carries a coverage summary, and says so', () => {
        const conf = readConformance(withFindings([
            finding('rule-a', '1.4.3', 'fail', { level: 'AA', occurrences: 4 }),
            finding('rule-b', '2.4.7', 'cantTell'),
            finding('rule-c', '1.1.1', 'pass'),
        ]));

        assert.equal(conf.source, 'derived');
        const bySc = Object.fromEntries(conf.criteria.map((c) => [c.sc, c.status]));
        assert.equal(bySc['1.4.3'], 'doesNotSupport');
        assert.equal(bySc['2.4.7'], 'needsReview');
        assert.equal(bySc['1.1.1'], 'supports');

        const contrast = conf.criteria.find((c) => c.sc === '1.4.3');
        assert.equal(contrast.occurrenceCount, 4);
        assert.equal(contrast.level, 'AA', 'the level comes from the payload, not from a table');
    });

    test('a level the report does not state is left unstated rather than assumed', () => {
        const conf = readConformance(withFindings([finding('rule-a', '1.4.3', 'fail')]));
        assert.equal(conf.criteria[0].level, null);
        assert.equal(conf.byLevel.unstated.failing, 1);
        assert.equal(conf.byLevel.AA.failing, 0, 'nothing is quietly filed under AA');
    });

    test('the principle is read off the criterion number', () => {
        assert.equal(principleOf('1.4.3'), '1');
        assert.equal(principleOf('4.1.2'), '4');
        assert.equal(principleOf('nonsense'), null);

        const conf = readConformance(withFindings([
            finding('a', '1.4.3', 'fail'),
            finding('b', '2.4.7', 'fail'),
            finding('c', '2.5.8', 'fail'),
        ]));
        assert.equal(conf.byPrinciple['1'].failing, 1);
        assert.equal(conf.byPrinciple['2'].failing, 2);
        assert.equal(conf.byPrinciple['3'].failing, 0);
    });

    test('the pass share is read against what could be concluded, not against all of WCAG', () => {
        const conf = readConformance(withCoverage([[
            criterion('1.4.3', 'doesNotSupport'),
            criterion('1.1.1', 'supports'),
            criterion('2.4.7', 'supports'),
            criterion('2.5.8', 'notEvaluated'),
            criterion('3.2.5', 'needsReview'),
        ]]));

        assert.equal(conf.totals.concluded, 3, 'notEvaluated and needsReview reached no verdict');
        assert.equal(conf.totals.failing, 1);
        assert.equal(conf.totals.passShare, 2 / 3);
    });

    test('a report with nothing to say reports no source rather than an empty verdict', () => {
        const conf = readConformance({ scans: [] });
        assert.equal(conf.source, 'none');
        assert.deepEqual(conf.criteria, []);
        assert.equal(conf.totals.passShare, null);
    });

    test('partial support counts as failing; not applicable does not', () => {
        assert.equal(isFailing('partiallySupports'), true);
        assert.equal(isFailing('doesNotSupport'), true);
        assert.equal(isFailing('notApplicable'), false);
        assert.equal(isFailing('needsReview'), false);
    });
});

describe('report-conformance — the criterion by column matrix', () => {
    const columns = [
        readConformance(withCoverage([[criterion('1.4.3', 'doesNotSupport', 'AA'), criterion('1.1.1', 'supports', 'A')]])),
        readConformance(withCoverage([[criterion('1.4.3', 'doesNotSupport', 'AA'), criterion('1.1.1', 'doesNotSupport', 'A')]])),
        readConformance(withCoverage([[criterion('1.4.3', 'supports', 'AA'), criterion('1.1.1', 'doesNotSupport', 'A')]])),
    ];

    test('one row per criterion that fails somewhere, with a cell per column', () => {
        const rows = conformanceMatrix(columns);
        const bySc = Object.fromEntries(rows.map((r) => [r.sc, r]));

        assert.deepEqual(Object.keys(bySc).sort(), ['1.1.1', '1.4.3']);
        assert.deepEqual(bySc['1.4.3'].failing, [true, true, false]);
        assert.deepEqual(bySc['1.1.1'].failing, [false, true, true]);
        assert.equal(bySc['1.4.3'].level, 'AA');
    });

    test('a criterion a column never reached is not counted as passed', () => {
        const rows = conformanceMatrix([
            readConformance(withCoverage([[criterion('2.5.8', 'doesNotSupport')]])),
            readConformance(withCoverage([[criterion('1.4.3', 'doesNotSupport')]])),
        ]);
        const targets = rows.find((r) => r.sc === '2.5.8');

        assert.equal(targets.statuses[1], 'notEvaluated');
        assert.equal(targets.failing[1], false);
        assert.equal(targets.everywhere, true, 'it failed everywhere it was actually looked at');
    });

    test('criteria that pass everywhere are left out, so the grid is the backlog', () => {
        const rows = conformanceMatrix([
            readConformance(withCoverage([[criterion('1.4.3', 'supports')]])),
            readConformance(withCoverage([[criterion('1.4.3', 'supports')]])),
        ]);
        assert.deepEqual(rows, []);
    });

    test('a criterion needing review is kept even where nothing fails', () => {
        const rows = conformanceMatrix([
            readConformance(withCoverage([[criterion('1.4.3', 'needsReview')]])),
            readConformance(withCoverage([[criterion('1.4.3', 'supports')]])),
        ]);
        assert.deepEqual(rows.map((r) => r.sc), ['1.4.3']);
        assert.equal(rows[0].columns, 0, 'it is not a failure, but it is not a pass either');
    });
});

describe('report-conformance — EN 301 549 clauses', () => {
    function withClause(f, en301549) { return Object.assign(f, { en301549 }); }

    test('each criterion carries the clause its findings name, with the versions that have it', () => {
        const conf = readConformance(withFindings([
            withClause(finding('img-alt', '1.1.1', 'fail'), [{ clause: '9.1.1.1', versions: ['V4.1.1', 'V3.2.1'] }]),
            withClause(finding('target-size', '2.5.8', 'fail'), [{ clause: '9.2.5.8', versions: ['V4.1.1'] }]),
        ]));
        const bySc = Object.fromEntries(conf.criteria.map((c) => [c.sc, c.en301549]));
        assert.deepEqual(bySc['1.1.1'], { clause: '9.1.1.1', versions: ['V3.2.1', 'V4.1.1'] });
        assert.deepEqual(bySc['2.5.8'], { clause: '9.2.5.8', versions: ['V4.1.1'] });
    });

    test('also reads surea11y\'s own mappings, and applies them to criteria from coverage summaries', () => {
        const report = withCoverage([[criterion('1.4.3', 'doesNotSupport', 'AA')]]);
        report.scans[0].canonical.findings = [{
            ruleId: 'contrast-minimum', outcome: 'fail', wcag: { sc: ['1.4.3'] },
            standards: { normativeMappings: [
                { standard: 'WCAG', requirement: '1.4.3' },
                { standard: 'EN 301 549', version: 'V3.2.1', requirement: '9.1.4.3' },
            ] },
        }];
        assert.deepEqual(readConformance(report).criteria[0].en301549, { clause: '9.1.4.3', versions: ['V3.2.1'] });
    });

    test('a report that names no clause gets none, rather than a guess', () => {
        const conf = readConformance(withFindings([finding('img-alt', '1.1.1', 'fail')]));
        assert.equal(conf.criteria[0].en301549, null);
    });

    test('the matrix merges the versions the columns saw', () => {
        const a = readConformance(withFindings([withClause(finding('x', '1.1.1', 'fail'), [{ clause: '9.1.1.1', versions: ['V3.2.1'] }])]));
        const b = readConformance(withFindings([withClause(finding('x', '1.1.1', 'fail'), [{ clause: '9.1.1.1', versions: ['V4.1.1'] }])]));
        const c = readConformance(withFindings([finding('x', '1.1.1', 'fail')]));
        assert.deepEqual(conformanceMatrix([c, a, b])[0].en301549, { clause: '9.1.1.1', versions: ['V3.2.1', 'V4.1.1'] });
    });
});

describe('report-conformance — RGAA criteria', () => {
    const withRgaa = (f, criteria) => Object.assign(f, { rgaa: criteria.map((criterion) => ({ criterion, tests: [], version: '4.1.2' })) });

    test('a WCAG criterion lists the RGAA criteria its findings named, in RGAA order', () => {
        const conf = readConformance(withFindings([
            withRgaa(finding('img-alt', '1.1.1', 'fail'), ['1.2', '1.1']),
            withRgaa(finding('img-decorative', '1.1.1', 'cantTell'), ['1.10']),
            finding('contrast', '1.4.3', 'fail'),
        ]));
        const bySc = Object.fromEntries(conf.criteria.map((c) => [c.sc, c.rgaa]));
        assert.deepEqual(bySc['1.1.1'], ['1.1', '1.2', '1.10']);
        assert.equal(bySc['1.4.3'], null, 'a report that did not target RGAA names none');
    });

    test('passing findings do not add RGAA criteria to a row', () => {
        const conf = readConformance(withFindings([
            withRgaa(finding('link-name', '4.1.2', 'fail'), ['6.2']),
            withRgaa(finding('iframe-name', '4.1.2', 'pass'), ['2.1']),
        ]));
        assert.deepEqual(conf.criteria[0].rgaa, ['6.2']);
    });

    test('the matrix merges what the columns named', () => {
        const a = readConformance(withFindings([withRgaa(finding('x', '2.4.4', 'fail'), ['6.2'])]));
        const b = readConformance(withFindings([withRgaa(finding('x', '2.4.4', 'fail'), ['6.1'])]));
        const c = readConformance(withFindings([finding('x', '2.4.4', 'fail')]));
        assert.deepEqual(conformanceMatrix([c, a, b])[0].rgaa, ['6.1', '6.2']);
    });
});

describe('report-conformance — clauses follow the standard the scans shared', () => {
    const { sharedTarget, en301549ForTarget } = require('./report-conformance.js');
    const withTarget = (id) => ({ scans: [
        { id: 'a', canonical: { findings: [] }, conformanceProfile: id ? { id } : null },
        { id: 'b', skipped: true, canonical: { findings: [] }, conformanceProfile: { id: 'section508' } },
    ] });

    test('a report\'s target is the one its scans share; skipped scans do not count', () => {
        assert.equal(readConformance(withTarget('rgaa-4.1.2')).target, 'rgaa-4.1.2');
        assert.equal(readConformance(withTarget(null)).target, null);
        const mixed = { scans: [{ conformanceProfile: { id: 'section508' } }, { conformanceProfile: { id: 'wcag22-aa' } }] };
        assert.equal(readConformance(mixed).target, 'mixed');
    });

    test('a set shares a target only when every report has the same one', () => {
        assert.equal(sharedTarget([{ target: 'section508' }, { target: 'section508' }]), 'section508');
        assert.equal(sharedTarget([{ target: 'section508' }, { target: null }]), 'mixed');
    });

    test('the clause shown depends on that target', () => {
        const both = { clause: '9.1.1.1', versions: ['V3.2.1', 'V4.1.1'] };
        const v4only = { clause: '9.2.5.8', versions: ['V4.1.1'] };
        assert.deepEqual(en301549ForTarget(both, null), both);
        assert.deepEqual(en301549ForTarget(both, 'mixed'), both);
        assert.deepEqual(en301549ForTarget(both, 'en301549-v3.2.1'), { clause: '9.1.1.1', versions: ['V3.2.1'], versionImplied: true });
        assert.equal(en301549ForTarget(v4only, 'en301549-v3.2.1'), null);
        assert.equal(en301549ForTarget(both, 'section508'), null);
        assert.equal(en301549ForTarget(both, 'rgaa-4.1.2'), null);
    });
});

describe('rgaaComplianceRate', () => {
    const { rgaaComplianceRate } = require('./report-conformance.js');
    // An RGAA rollup finding, as the adapter splits it by outcome.
    const rollup = (criterion, outcome) => ({
        ruleId: `rgaa-4.1.2-${criterion}`, outcome, meta: { atomic: false, standard: 'RGAA' },
        rgaa: [{ criterion, tests: [], version: '4.1.2' }],
    });
    const page = (...findings) => ({ canonical: { findings } });

    test('reads a criterion across pages as an audit does', () => {
        const r = rgaaComplianceRate([
            page(rollup('1.1', 'pass'), rollup('3.2', 'pass'), rollup('8.3', 'notApplicable'), rollup('11.1', 'pass'), rollup('9.1', 'pass')),
            page(rollup('1.1', 'pass'), rollup('3.2', 'fail'), rollup('8.3', 'notApplicable'), rollup('11.1', 'notApplicable'), rollup('9.1', 'cantTell')),
        ]);
        // 1.1 met everywhere; 3.2 fails on one page; 11.1 met where it applies;
        // 9.1 left undecided on one page; 8.3 applies nowhere.
        assert.deepEqual(r, { pages: 2, criteria: 5, met: 2, notMet: 1, toVerify: 1, notApplicable: 1, rate: 2 / 3 });
    });

    test('takes the worst of a criterion\'s split findings on one page', () => {
        const r = rgaaComplianceRate([page(rollup('3.2', 'pass'), rollup('3.2', 'fail'), rollup('1.1', 'pass'), rollup('1.1', 'cantTell'))]);
        assert.equal(r.notMet, 1);
        assert.equal(r.toVerify, 1);
        assert.equal(r.met, 0);
        assert.equal(r.rate, 0);
    });

    test('ignores rule findings, WCAG rollups and skipped scans, and gives null without RGAA', () => {
        const ruleFinding = { ruleId: 'img-alt-present', outcome: 'fail', meta: { atomic: true }, rgaa: [{ criterion: '1.1', tests: ['1.1.1'] }] };
        const wcagRollup = { ruleId: 'wcag-1.1.1', outcome: 'fail', meta: { atomic: false } };
        assert.equal(rgaaComplianceRate([page(ruleFinding, wcagRollup), { skipped: true, canonical: null }]), null);
        assert.equal(rgaaComplianceRate([]), null);
    });

    test('has no rate when the checks settled no criterion', () => {
        assert.equal(rgaaComplianceRate([page(rollup('9.1', 'cantTell'))]).rate, null);
    });
});
