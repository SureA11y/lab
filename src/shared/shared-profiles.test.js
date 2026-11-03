'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { compareOnShared, basisSentence } = require('./shared-profiles.js');
const { diffReports } = require('./report-diff.js');
const { diffReportSeries } = require('./report-multi-diff.js');

const AA = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
const AAA = { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' };
const ARIA = { id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' };
const EN = { id: 'en301549-v4.1.1', label: 'EN 301 549 V4.1.1' };

const occ = (target, outcome = 'fail', verdicts) => ({ target: [target], pageUrl: 'https://example.com/', ...(outcome ? { occurrenceOutcome: outcome } : {}), ...(verdicts ? { verdicts } : {}) });
// A requirement's row, of the profiles that gave it (a scan of several).
const row = (ruleId, sc, outcome, profiles, occs = [occ('#x', outcome)]) => ({
    ruleId, outcome, severity: 'serious', wcag: { sc: sc ? [sc] : [] }, meta: { atomic: false },
    evidence: { rollup: { checksIds: [], ...(profiles ? { profiles } : {}) } }, occurrences: occs,
});

function report(runId, profiles, findings, { level } = {}) {
    const wcag = profiles.find((p) => /^wcag22-/.test(p.id));
    return {
        runId, timestamp: `2026-11-0${runId === 'a' ? 1 : 2}T10:00:00Z`, url: 'https://example.com/',
        metrics: { a11ySummary: { scores: { avgPageAccessibility: 80, confidence: 70 } } },
        scans: [{
            id: 's1', url: 'https://example.com/',
            profile: profiles.find((p) => p !== wcag) || wcag,
            ...(profiles.length > 1 ? { profiles } : {}),
            wcag: { version: '2.2', level: level || (wcag ? wcag.label.split(' ').pop() : 'AA') },
            canonical: { findings },
        }],
    };
}

describe('compareOnShared', () => {
    test('reports of the same profiles, in any order, come back as they are', () => {
        const a = report('a', [AA, ARIA], [row('wcag-1.1.1-x', '1.1.1', 'fail', ['wcag22-aa'])]);
        const b = report('b', [ARIA, AA], []);
        const out = compareOnShared([a, b]);
        assert.equal(out.basis, null);
        assert.equal(out.reports[0], a);
    });

    test('WCAG 2.2 AA + WAI-ARIA 1.2 beside WCAG 2.2 AA alone: compared on WCAG 2.2 AA', () => {
        const a = report('a', [AA, ARIA], [
            row('wcag-4.1.2-aria-validity', '4.1.2', 'cantTell', ['wcag22-aa']),
            row('wai-aria-1.2-supported-attributes', null, 'fail', ['wai-aria-1.2']),
            // A rule's own finding: WCAG asks, WAI-ARIA fails.
            { ruleId: 'aria-allowed-attr', outcome: 'fail', meta: { atomic: true }, wcag: { sc: ['4.1.2'] },
                verdicts: { 'wcag22-aa': 'cantTell', 'wai-aria-1.2': 'fail' },
                occurrences: [occ('#g', 'fail', { 'wcag22-aa': 'cantTell', 'wai-aria-1.2': 'fail' })] },
        ]);
        const b = report('b', [AA], [row('wcag-4.1.2-aria-validity', '4.1.2', 'cantTell')]);
        const { reports, basis } = compareOnShared([a, b]);
        assert.deepEqual(basis, { comparedOn: [AA], leftOut: [ARIA] });
        const findings = reports[0].scans[0].canonical.findings;
        assert.deepEqual(findings.map((f) => f.ruleId), ['wcag-4.1.2-aria-validity', 'aria-allowed-attr']);
        const rule = findings.find((f) => f.ruleId === 'aria-allowed-attr');
        assert.equal(rule.outcome, 'cantTell', 'WCAG\'s verdict, not the merged one');
        assert.equal(rule.occurrences[0].occurrenceOutcome, 'cantTell');
        // The report now reads as checked against WCAG 2.2 AA alone.
        assert.deepEqual(reports[0].scans[0].profile, AA);
        assert.equal('profiles' in reports[0].scans[0], false);
        assert.equal(reports[0].metrics.a11ySummary.scores, undefined, 'its own score is left out');
        assert.equal(reports[1].scans[0].canonical.findings.length, 1);
        // The originals are untouched.
        assert.equal(a.scans[0].canonical.findings.length, 3);
        assert.equal(basisSentence(basis), 'Compared on WCAG 2.2 AA, which every report checked. Left out, as not every report checked it on the same pages: WAI-ARIA 1.2.');
    });

    test('WCAG levels nest: AAA beside AA is read at AA', () => {
        const a = report('a', [AAA], [
            row('wcag-1.4.3-contrast-minimum', '1.4.3', 'fail'),
            row('wcag-1.4.6-contrast-enhanced', '1.4.6', 'fail'),
        ]);
        a.scans[0].metrics = { coverageSummary: { criteria: [{ sc: '1.4.3', level: 'AA' }, { sc: '1.4.6', level: 'AAA' }] } };
        const b = report('b', [AA], [row('wcag-1.4.3-contrast-minimum', '1.4.3', 'fail')]);
        const { reports, basis } = compareOnShared([a, b]);
        assert.deepEqual(basis.comparedOn, [AA]);
        assert.deepEqual(basis.leftOut.map((p) => p.id), ['wcag22-aaa']);
        assert.deepEqual(reports[0].scans[0].canonical.findings.map((f) => f.ruleId), ['wcag-1.4.3-contrast-minimum']);
        assert.deepEqual(reports[0].scans[0].metrics.coverageSummary.criteria.map((c) => c.sc), ['1.4.3']);
        assert.equal(reports[0].scans[0].wcag.level, 'AA');
    });

    test('reports that share nothing come back as they are, and say so', () => {
        const a = report('a', [EN], [row('en301549-V4.1.1-9.1.1.1', null, 'fail')]);
        const b = report('b', [ARIA], [row('wai-aria-1.2-name-required', null, 'fail')]);
        const { reports, basis } = compareOnShared([a, b]);
        assert.deepEqual(basis.comparedOn, []);
        assert.equal(reports[0], a);
        assert.equal(basisSentence(basis), null);
    });
});

describe('the comparisons read reports on their shared profiles', () => {
    const a = report('a', [AA, ARIA], [
        row('wcag-1.1.1-non-text-content', '1.1.1', 'fail', ['wcag22-aa']),
        row('wai-aria-1.2-name-required', null, 'fail', ['wai-aria-1.2']),
    ]);
    const b = report('b', [AA], [row('wcag-1.1.1-non-text-content', '1.1.1', 'fail')]);

    test('two reports: no row for what only one checked, and no mismatch', () => {
        const d = diffReports(a, b, { mode: 'evolution' });
        assert.deepEqual(d.rows.map((r) => [r.ruleId, r.category]), [['wcag-1.1.1-non-text-content', 'persistent']]);
        assert.equal(d.document.criteriaMismatch, false);
        assert.deepEqual(d.document.profiles.comparedOn, [AA]);
        assert.equal(d.stats.scoreA, null);
    });

    test('a series: the same', () => {
        const s = diffReportSeries([a, b], { mode: 'trend' });
        assert.deepEqual(s.rows.map((r) => r.ruleId), ['wcag-1.1.1-non-text-content']);
        assert.deepEqual(s.document.profiles.leftOut, [ARIA]);
        assert.equal(s.document.criteriaMismatch, false);
        // Its score is left out for the comparison, not for having evaluated too little.
        assert.deepEqual(s.columns.map((c) => [c.stats.score, c.stats.scoreLeftOut]), [[null, true], [null, true]]);
    });
});

describe('compareOnShared, scan by scan', () => {
    test('a report whose scans check different profiles compares in full with one like it', () => {
        const two = (runId) => ({
            runId, timestamp: `2026-11-0${runId === 'a' ? 1 : 2}T10:00:00Z`, url: 'https://example.com/',
            scans: [
                { id: 'scan-1', url: 'https://example.com/', profile: ARIA, profiles: [AA, ARIA], wcag: { version: '2.2', level: 'AA' },
                    canonical: { findings: [row('wcag-1.1.1-x', '1.1.1', 'fail', ['wcag22-aa']), row('wai-aria-1.2-name-required', null, 'fail', ['wai-aria-1.2'])] } },
                { id: 'scan-2', url: 'https://example.com/', profile: ARIA, wcag: { version: '2.2', level: 'AA' },
                    canonical: { findings: [row('wai-aria-1.2-name-required', null, 'fail')] } },
            ],
        });
        const { reports, basis } = compareOnShared([two('a'), two('b')]);
        assert.equal(basis, null);
        assert.equal(reports[0].scans[0].canonical.findings.length, 2);
    });

    test('only the scans that differ are narrowed', () => {
        const a = report('a', [AA, ARIA], [row('wcag-1.1.1-x', '1.1.1', 'fail', ['wcag22-aa']), row('wai-aria-1.2-name-required', null, 'fail', ['wai-aria-1.2'])]);
        a.scans.push({ id: 's2', url: 'https://example.com/', profile: ARIA, wcag: { version: '2.2', level: 'AA' },
            canonical: { findings: [row('wai-aria-1.2-name-required', null, 'fail')] } });
        const b = report('b', [AA], [row('wcag-1.1.1-x', '1.1.1', 'fail')]);
        b.scans.push({ ...a.scans[1] });
        const { reports, basis } = compareOnShared([a, b]);
        assert.deepEqual(basis, { comparedOn: [AA], leftOut: [ARIA] });
        assert.deepEqual(reports[0].scans[0].canonical.findings.map((f) => f.ruleId), ['wcag-1.1.1-x']);
        assert.deepEqual(reports[0].scans[1].canonical.findings.map((f) => f.ruleId), ['wai-aria-1.2-name-required'], 'the WAI-ARIA scan both had, in full');
    });

    test('a coverage criterion core left without a level is read at WCAG\'s', () => {
        const a = report('a', [AAA], []);
        a.scans[0].metrics = { coverageSummary: { criteria: [{ sc: '1.4.3', level: null }, { sc: '1.4.6', level: null }, { sc: '2.1.3', level: null }] } };
        const b = report('b', [AA], []);
        const { reports } = compareOnShared([a, b]);
        assert.deepEqual(reports[0].scans[0].metrics.coverageSummary.criteria.map((c) => c.sc), ['1.4.3']);
    });
});

describe('compareOnShared, scan by scan', () => {
    const scan = (label, profiles, findings, extra = {}) => {
        const wcag = profiles.find((p) => /^wcag22-/.test(p.id));
        return {
            label, url: `https://example.com/${label.toLowerCase()}`,
            profile: profiles.find((p) => p !== wcag) || wcag,
            ...(profiles.length > 1 ? { profiles } : {}),
            wcag: { version: '2.2', level: wcag ? wcag.label.split(' ').pop() : null },
            canonical: { findings }, ...extra,
        };
    };
    const reportOf = (runId, scans) => ({ runId, timestamp: `2026-11-0${runId === 'a' ? 1 : 2}T10:00:00Z`, url: 'https://example.com/', scans });
    const ariaRow = row('wai-aria-1.2-name-required', null, 'fail', ['wai-aria-1.2']);

    test("an id the run numbered or the extension made up isn't a scan's identity: a scan added first shifts nothing", () => {
        const a = reportOf('a', [
            scan('Home', [AA], [], { id: 'scan-1' }),
            scan('Products', [AA, ARIA], [ariaRow], { id: 'scan-2' }),
        ]);
        const b = reportOf('b', [
            scan('Intro', [AA], [], { id: 'scan-1' }),
            scan('Home', [AA], [], { id: 'scan-2' }),
            scan('Products', [AA, ARIA], [ariaRow], { id: 'manual-scan-1f2e' }),
        ]);
        const out = compareOnShared([a, b]);
        assert.equal(out.basis, null);
        assert.equal(out.mismatch, false);
        assert.deepEqual(diffReports(a, b, { mode: 'evolution' }).rows.filter((r) => r.category === 'new'), []);
    });

    test('scans sharing a label and page are matched in order', () => {
        const enRow = row('en301549-V4.1.1-9.1.1.1', null, 'fail', ['en301549-v4.1.1']);
        const a = reportOf('a', [scan('P', [AA, ARIA], [ariaRow]), scan('P', [EN], [enRow])]);
        const b = reportOf('b', [scan('P', [AA], []), scan('P', [EN], [enRow])]);
        const { reports } = compareOnShared([a, b]);
        assert.equal(reports[0].scans[1].profile.id, EN.id);
        assert.equal(reports[0].scans[1].canonical.findings.length, 1);
        assert.deepEqual(reports[0].scans[0].canonical.findings, []);
    });

    test("a page only one run scanned keeps its WCAG level when only a standard was left out elsewhere", () => {
        const aaa = row('wcag-1.4.6-contrast-enhanced', '1.4.6', 'fail');
        const a = reportOf('a', [scan('Home', [AA, ARIA], [ariaRow])]);
        const b = reportOf('b', [scan('Home', [AA], []), scan('New', [AAA], [aaa])]);
        const out = compareOnShared([a, b]);
        assert.deepEqual(out.basis.leftOut.map((p) => p.id), [ARIA.id]);
        assert.equal(out.reports[1].scans[1].canonical.findings.length, 1);
        assert.equal(diffReports(a, b, { mode: 'evolution' }).rows.filter((r) => r.category === 'new' && r.ruleId === aaa.ruleId).length, 1);
    });

    test('a skipped scan keeps its place among the scans of its page', () => {
        const enRow = row('en301549-V4.1.1-9.1.1.1', null, 'fail', ['en301549-v4.1.1']);
        const a = reportOf('a', [scan('P', [AA], [], { skipped: true }), scan('P', [EN], [])]);
        const b = reportOf('b', [scan('P', [AA], []), scan('P', [EN], [enRow])]);
        const out = compareOnShared([a, b]);
        assert.equal(out.mismatch, false);
        assert.equal(out.basis, null);
        assert.equal(diffReports(a, b, { mode: 'evolution' }).rows.filter((r) => r.category === 'new').length, 1);
    });

    test('beside scans that compare, one sharing nothing is left out, and the reports are not mismatched', () => {
        const fail = row('wcag-1.4.3-contrast-minimum', '1.4.3', 'fail');
        const a = reportOf('a', [scan('Home', [AA], [fail]), scan('Products', [AA], [fail])]);
        const b = reportOf('b', [scan('Home', [AA], [fail]), scan('Products', [EN], [row('en301549-V4.1.1-9.1.4.3', null, 'fail', ['en301549-v4.1.1'])])]);
        const out = compareOnShared([a, b]);
        assert.equal(out.mismatch, false);
        assert.deepEqual(out.basis.notCompared, [{ label: 'Products' }]);
        assert.deepEqual(out.reports[1].scans[1].canonical.findings, []);
        assert.match(basisSentence(out.basis), /^Not compared, as its reports checked it against different things that share none: Products\.$/);
        const diff = diffReports(a, b, { mode: 'evolution' });
        assert.equal(diff.document.criteriaMismatch, false);
        assert.deepEqual(diff.rows.filter((r) => r.category === 'new'), []);
    });

    test('a scan not compared is named as the latest report names it', () => {
        const fail = row('wcag-1.4.3-contrast-minimum', '1.4.3', 'fail');
        const a = reportOf('a', [scan('Home', [AA], [fail]), { ...scan('Products', [AA], []), label: 'Old name' }]);
        const b = reportOf('b', [scan('Home', [AA], [fail]), scan('Products', [EN], [])]);
        assert.deepEqual(compareOnShared([a, b]).basis.notCompared, [{ label: 'Products' }]);
    });

    test('every scan in common sharing nothing is a mismatch', () => {
        const a = reportOf('a', [scan('Home', [AA], [])]);
        const b = reportOf('b', [scan('Home', [EN], [])]);
        assert.equal(compareOnShared([a, b]).mismatch, true);
    });

    test('narrowed to WCAG 2.2, coverage leaves out 4.1.1, which 2.2 removed', () => {
        const coverage = (scs) => ({ criteria: scs.map((sc) => ({ sc, level: null, status: 'supports' })) });
        const a = reportOf('a', [scan('Home', [AA, ARIA], [], { metrics: { coverageSummary: coverage(['1.1.1', '4.1.1']) } })]);
        const b = reportOf('b', [scan('Home', [AA], [], { metrics: { coverageSummary: coverage(['1.1.1']) } })]);
        const { reports } = compareOnShared([a, b]);
        assert.deepEqual(reports[0].scans[0].metrics.coverageSummary.criteria.map((c) => c.sc), ['1.1.1']);
    });

    test('scans match by page across hosts and labels: staging beside live', () => {
        const a = reportOf('a', [scan('Home', [AA], [], { url: 'https://staging.example.com/?x=1' })]);
        const b = reportOf('b', [scan('Start', [AA, ARIA], [ariaRow], { url: 'https://www.example.com/?x=1', id: 'checkout' })]);
        const out = compareOnShared([a, b]);
        assert.equal(out.mismatch, false);
        assert.deepEqual(out.basis.comparedOn, [AA]);
        assert.deepEqual(out.reports[1].scans[0].canonical.findings, []);
    });

    test('a page only one report has is read on what the others were compared on', () => {
        const fail = row('wcag-1.4.3-contrast-minimum', '1.4.3', 'fail');
        const a = reportOf('a', [scan('Home', [AA], [fail])]);
        const b = reportOf('b', [scan('Home', [AA, ARIA], [fail, ariaRow]), scan('Products', [AA, ARIA], [fail, ariaRow])]);
        const { reports, basis } = compareOnShared([a, b]);
        assert.deepEqual(basis.leftOut, [ARIA]);
        assert.deepEqual(reports[1].scans[1].canonical.findings.map((f) => f.ruleId), ['wcag-1.4.3-contrast-minimum']);
        const diff = diffReports(a, b, { mode: 'evolution' });
        assert.deepEqual(diff.rows.filter((r) => r.category === 'new').map((r) => r.ruleId), []);
    });

    test("a scan left out of the comparison keeps none of its margins", () => {
        const a = reportOf('a', [scan('Home', [AA], []), scan('Products', [AA], [])]);
        const b = reportOf('b', [scan('Home', [AA], []), scan('Products', [EN], [], { canonical: { findings: [], margins: [{ ruleId: 'target-size-minimum', value: 29 }] } })]);
        const { reports } = compareOnShared([a, b]);
        assert.deepEqual(reports[1].scans[1].canonical.margins, []);
    });

    test('a scan that names no profile (an older report) leaves the reports for their identities to say', () => {
        const a = reportOf('a', [{ label: 'Home', url: 'https://example.com/home', canonical: { findings: [] } }]);
        const b = reportOf('b', [scan('Home', [AA], [])]);
        assert.equal(compareOnShared([a, b]).mismatch, null);
    });
});
