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
        assert.equal(basisSentence(basis), 'Compared on WCAG 2.2 AA, which every report checked. Left out, as not every report checked it: WAI-ARIA 1.2.');
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
    });
});
