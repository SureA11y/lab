'use strict';

// The published schemas against what the lab really writes: a finished
// payload, an older report as the app reads it, a run's diff.json and a
// comparison's comparison.json.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { checkAgainstSchema } = require('./json-schema-check');
const { reportSchema, diffSchema, comparisonSchema } = require('./report-schemas');
const { upgradeReport } = require('./report-format');
const { createWorkflowPayloadBuilder } = require('./workflow-payload-builder');
const { findingsByOutcome } = require('../server-side/a11y-canonical');
const { compareToBaseline, diffDocument } = require('../cli/baseline');

const PAGE = 'https://example.com/shop';

function finding(ruleId, outcome, targets) {
    return {
        id: ruleId,
        uid: `surea11y:${outcome}:${ruleId}`,
        ruleId,
        title: `${ruleId} title`,
        outcome,
        severity: 'serious',
        helpUrl: null,
        wcag: { sc: [{ ref: '1.1.1', level: 'A' }] },
        occurrences: targets.map((t) => ({ pageUrl: PAGE, target: [t], html: `<img class="${t}">` })),
    };
}

function finished(runId, timestamp, targets) {
    const builder = createWorkflowPayloadBuilder({
        METRIC_DEFS: {},
        sortByOrderKey: (arr) => arr,
        findingsByOutcome,
        getA11yGlobalFindings: () => [],
        buildGlobalSummary: () => ({ domMetrics: null, a11ySummary: null }),
    });
    const payload = builder.buildWorkflowPayloadBase({
        url: PAGE,
        runId,
        timestamp,
        scenarioName: 'Shop',
        actionResults: [{ index: 0, type: 'a11yScan', label: 'Shop', status: 'ok', durationMs: 900 }],
    });
    payload.scans.push({
        id: 's1',
        url: PAGE,
        label: 'Shop',
        profile: { id: 'wcag22-aa', label: 'WCAG 2.2 AA' },
        wcag: { version: '2.2', level: 'AA' },
        canonical: { version: '1', findings: [finding('image-alt', 'fail', targets), finding('html-lang', 'pass', ['html'])] },
    });
    return builder.finalizeWorkflowPayload(payload);
}

describe('report.v2.schema.json', () => {
    test('a finished payload passes', () => {
        assert.deepEqual(checkAgainstSchema(reportSchema(), finished('run_a', '2026-10-01T09:00:00.000Z', ['.a', '.b'])), []);
    });

    test('an older report passes once read as the current format, and not before', () => {
        const old = {
            url: PAGE,
            runId: 'run_old',
            timestamp: '2025-03-01T09:00:00.000Z',
            scans: [{ id: 's1', url: PAGE, wcagLevel: 'AA', wcagVersion: '2.2', conformanceProfile: null, canonical: { findings: [finding('image-alt', 'fail', ['.a'])] } }],
            findings: { fail: [{ ...finding('image-alt', 'fail', ['.a']), url: PAGE }], pass: [], cantTell: [], notApplicable: [] },
        };
        const before = checkAgainstSchema(reportSchema(), old).map((p) => `${p.path} ${p.message}`);
        assert.ok(before.includes('$ needs "reportVersion"'));
        assert.ok(before.includes('$.scans[0] needs "profile"'));
        assert.deepEqual(checkAgainstSchema(reportSchema(), upgradeReport(old)), []);
    });

    test('says what is wrong with a report that is not one', () => {
        const payload = finished('run_a', '2026-10-01T09:00:00.000Z', ['.a']);
        payload.scans[0].canonical.findings[0].outcome = 'failed';
        payload.scans[0].canonical.findings[0].occurrences[0].occurrenceId = 'a1';
        const paths = checkAgainstSchema(reportSchema(), payload).map((p) => p.path);
        assert.ok(paths.includes('$.scans[0].canonical.findings[0].outcome'));
        assert.ok(paths.includes('$.scans[0].canonical.findings[0].occurrences[0].occurrenceId'));
    });
});

describe('diff.v1.schema.json', () => {
    test('a run\'s diff.json passes, and names its occurrences by id', () => {
        const baseline = finished('run_a', '2026-10-01T09:00:00.000Z', ['.a', '.b']);
        const current = finished('run_b', '2026-10-02T09:00:00.000Z', ['.b', '.c']);
        const doc = JSON.parse(JSON.stringify(diffDocument(compareToBaseline(baseline, current))));
        assert.deepEqual(checkAgainstSchema(diffSchema(), doc), []);
        const ids = doc.diff.rows[0].occ.map((o) => o.occurrenceId);
        const saved = current.scans[0].canonical.findings[0].occurrences.map((o) => o.occurrenceId);
        assert.ok(saved.every((id) => ids.includes(id)));
    });
});

describe('comparison.v1.schema.json', () => {
    test('a downloaded comparison\'s comparison.json passes', async () => {
        const { buildManifest, reportFileNames } = await import('../js/comparison-bundle.js');
        const snapshot = {
            context: 'versions',
            order: 'given',
            document: { title: 'Checkout', note: '', generatedAt: '2026-10-01T09:00:00.000Z' },
            reports: [{ name: 'v1.3.a11y-report.json' }, { name: null }],
        };
        const manifest = buildManifest(snapshot, reportFileNames(snapshot.reports.map((r) => r.name)));
        assert.deepEqual(checkAgainstSchema(comparisonSchema(), manifest), []);
        assert.ok(checkAgainstSchema(comparisonSchema(), { ...manifest, reports: [] }).length);
    });
});
