'use strict';

// Dep-free tests for the pure helpers behind the "Engine" select. The module is
// ESM-with-`export`; import() it once for the whole suite (same shape as
// scan-tag-filter.test.js).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let mod;
async function load() {
    if (!mod) mod = await import('./engine-filter.js');
    return mod;
}

// A finding as the server writes it: the adapter's flat provenance with the
// facade's nested `engine` merged on top.
const serverFinding = (engineId, engineName, outcome = 'fail', occurrences = 1) => ({
    ruleId: `${engineId}-rule`,
    outcome,
    provenance: {
        engineId,
        engineName,
        engineVersion: '1.0.0',
        engine: { id: engineId, name: engineName, version: '1.0.0' },
    },
    occurrences: Array.from({ length: occurrences }, (_, i) => ({ target: [`#n${i}`] })),
});

// A finding as the extension writes it: flat provenance only, no nested engine.
const extensionFinding = (engineId, engineName, outcome = 'fail') => ({
    ruleId: `${engineId}-rule`,
    outcome,
    provenance: { engineId, engineName, engineVersion: '1.0.0' },
    occurrences: [{ target: ['#n0'] }],
});

const scanWith = (findings, engines) => ({
    id: 's1',
    summary: { failCount: 99, passesCount: 99, reviewCount: 99, occurrenceCount: 99 },
    canonical: { engines, findings },
});

describe('findingEngine', () => {
    test('reads the nested shape the facade stamps', async () => {
        const { findingEngine } = await load();
        assert.deepEqual(findingEngine(serverFinding('axe', 'axe-core')), { id: 'axe', name: 'axe-core' });
    });

    test('reads the flat shape an extension report carries', async () => {
        const { findingEngine } = await load();
        assert.deepEqual(findingEngine(extensionFinding('axe', 'axe-core')), { id: 'axe', name: 'axe-core' });
    });

    test('falls back to the id when no name is recorded', async () => {
        const { findingEngine } = await load();
        assert.deepEqual(findingEngine({ provenance: { engineId: 'qualweb-act' } }), {
            id: 'qualweb-act',
            name: 'qualweb-act',
        });
    });

    test('is null when nothing names an engine', async () => {
        const { findingEngine } = await load();
        assert.equal(findingEngine(null), null);
        assert.equal(findingEngine({}), null);
        assert.equal(findingEngine({ provenance: {} }), null);
    });
});

describe('collectEngineOptions', () => {
    test('lists the engines a report used, sorted by label', async () => {
        const { collectEngineOptions } = await load();
        const scans = [
            scanWith([serverFinding('surea11y', 'surea11y')], [{ id: 'surea11y', name: 'surea11y' }]),
            scanWith([serverFinding('axe', 'axe-core')], [{ id: 'axe', name: 'axe-core' }]),
        ];
        assert.deepEqual(collectEngineOptions(scans), [
            { key: 'axe', label: 'axe-core' },
            { key: 'surea11y', label: 'surea11y' },
        ]);
    });

    test('offers an engine that ran and reported nothing', async () => {
        // It only exists in the scan's declared engine list. Selecting it - to
        // see that it found nothing - is a legitimate thing to want.
        const { collectEngineOptions } = await load();
        const scans = [scanWith([serverFinding('axe', 'axe-core')], [
            { id: 'axe', name: 'axe-core' },
            { id: 'pa11y', name: 'Pa11y (axe)' },
        ])];
        assert.deepEqual(collectEngineOptions(scans).map((o) => o.key), ['axe', 'pa11y']);
    });

    test('finds engines in a report whose scans lost their engine list', async () => {
        const { collectEngineOptions } = await load();
        const scans = [{ id: 's', canonical: { findings: [serverFinding('axe', 'axe-core')] } }];
        assert.deepEqual(collectEngineOptions(scans), [{ key: 'axe', label: 'axe-core' }]);
    });

    test('is empty when nothing records an engine', async () => {
        const { collectEngineOptions } = await load();
        assert.deepEqual(collectEngineOptions([{ id: 's', canonical: { findings: [{ ruleId: 'r' }] } }]), []);
        assert.deepEqual(collectEngineOptions([]), []);
    });
});

describe('isEngineFilterActive', () => {
    test('only a named engine is a filter', async () => {
        const { isEngineFilterActive, ALL_ENGINES } = await load();
        assert.equal(isEngineFilterActive(ALL_ENGINES), false);
        assert.equal(isEngineFilterActive(''), false);
        assert.equal(isEngineFilterActive(null), false);
        assert.equal(isEngineFilterActive('axe'), true);
    });
});

describe('scansForEngine', () => {
    const mixedScan = () => scanWith(
        [
            serverFinding('axe', 'axe-core', 'fail', 3),
            serverFinding('axe', 'axe-core', 'pass'),
            serverFinding('surea11y', 'surea11y', 'fail', 2),
            serverFinding('surea11y', 'surea11y', 'cantTell'),
        ],
        [{ id: 'axe', name: 'axe-core' }, { id: 'surea11y', name: 'surea11y' }]
    );

    test('keeps only the selected engine\'s findings', async () => {
        const { scansForEngine } = await load();
        const [out] = scansForEngine([mixedScan()], 'axe');
        assert.deepEqual(
            out.canonical.findings.map((f) => f.provenance.engineId),
            ['axe', 'axe']
        );
    });

    test('recomputes the counts the summary rows and the sort read', async () => {
        const { scansForEngine } = await load();
        const [out] = scansForEngine([mixedScan()], 'axe');
        assert.equal(out.summary.failCount, 1);
        assert.equal(out.summary.passesCount, 1);
        assert.equal(out.summary.reviewCount, 0);
        assert.equal(out.summary.occurrenceCount, 3, 'occurrences of the kept fail finding');

        const [sure] = scansForEngine([mixedScan()], 'surea11y');
        assert.equal(sure.summary.failCount, 1);
        assert.equal(sure.summary.reviewCount, 1);
        assert.equal(sure.summary.occurrenceCount, 2);
    });

    test('narrows the engine list the report meta line reads, versions intact', async () => {
        // The meta line renders "name version", so a narrowed entry has to keep
        // everything it came with - not just the id and name the filter matches on.
        const { scansForEngine } = await load();
        const scan = scanWith(
            [serverFinding('axe', 'axe-core')],
            [{ id: 'axe', name: 'axe-core', version: '4.13.0' }, { id: 'surea11y', name: 'surea11y', version: '1.4.0' }]
        );
        const [out] = scansForEngine([scan], 'axe');
        assert.deepEqual(out.canonical.engines, [{ id: 'axe', name: 'axe-core', version: '4.13.0' }]);
    });

    test('returns the scans untouched for "All engines"', async () => {
        const { scansForEngine, ALL_ENGINES } = await load();
        const scans = [mixedScan()];
        assert.equal(scansForEngine(scans, ALL_ENGINES), scans, 'same array, no copying');
        assert.equal(scansForEngine(scans, ALL_ENGINES)[0].canonical.findings.length, 4);
    });

    test('never mutates the payload it reads from', async () => {
        // Switching back to "All engines" is just another read of the source, so
        // the source has to survive the filtered read intact.
        const { scansForEngine } = await load();
        const scans = [mixedScan()];
        scansForEngine(scans, 'axe');
        assert.equal(scans[0].canonical.findings.length, 4);
        assert.equal(scans[0].summary.failCount, 99, 'original counts left alone');
        assert.equal(scans[0].canonical.engines.length, 2);
    });

    test('an engine that found nothing yields an empty scan, not a missing one', async () => {
        const { scansForEngine } = await load();
        const out = scansForEngine([mixedScan()], 'pa11y');
        assert.equal(out.length, 1, 'the scan stays in the report');
        assert.deepEqual(out[0].canonical.findings, []);
        assert.equal(out[0].summary.failCount, 0);
    });

    test('leaves a skipped scan, which has no canonical, alone', async () => {
        const { scansForEngine } = await load();
        const skipped = { id: 'k', skipped: true, skipInfo: { reason: 'DOM too large' }, canonical: null };
        assert.deepEqual(scansForEngine([skipped], 'axe'), [skipped]);
    });

    test('matches case-insensitively across the two provenance shapes', async () => {
        const { scansForEngine } = await load();
        const scan = scanWith(
            [serverFinding('AXE', 'axe-core'), extensionFinding('axe', 'axe-core')],
            [{ id: 'axe', name: 'axe-core' }]
        );
        const [out] = scansForEngine([scan], 'axe');
        assert.equal(out.canonical.findings.length, 2);
    });
});

describe('engineLabelFor', () => {
    test('names the selected engine, and nothing for "All engines"', async () => {
        const { engineLabelFor, ALL_ENGINES } = await load();
        const scans = [scanWith([serverFinding('axe', 'axe-core')], [{ id: 'axe', name: 'axe-core' }])];
        assert.equal(engineLabelFor(scans, 'axe'), 'axe-core');
        assert.equal(engineLabelFor(scans, ALL_ENGINES), null);
        assert.equal(engineLabelFor(scans, 'gone'), 'gone', 'falls back to the key');
    });
});

// --------------------------- Per-engine metrics ---------------------------

const summary = (evidence) => ({ scores: { evidence, adjusted: evidence, confidence: 100 } });

// A multi-engine scan as the runner writes it now: one set of metrics per engine
// beside the merged one.
const scoredMultiEngineScan = () => ({
    id: 's1',
    canonical: {
        engines: [{ id: 'axe', name: 'axe-core' }, { id: 'surea11y', name: 'surea11y' }],
        findings: [serverFinding('axe', 'axe-core'), serverFinding('surea11y', 'surea11y')],
    },
    metrics: {
        domMetrics: { totalElements: 500 },
        a11ySummary: summary(1),
        coverageSummary: { criteria: ['merged'] },
        byEngine: {
            axe: { a11ySummary: summary(20), coverageSummary: { criteria: ['axe'] } },
            surea11y: { a11ySummary: summary(4), coverageSummary: { criteria: ['surea11y'] } },
        },
    },
});

// The same scan as written before per-engine metrics existed.
const unscoredMultiEngineScan = () => {
    const scan = scoredMultiEngineScan();
    delete scan.metrics.byEngine;
    return scan;
};

const singleEngineScan = (engineId, engineName, evidence) => ({
    id: `s-${engineId}`,
    canonical: { engines: [{ id: engineId, name: engineName }], findings: [serverFinding(engineId, engineName)] },
    metrics: { domMetrics: { totalElements: 500 }, a11ySummary: summary(evidence) },
});

describe('metrics under the engine filter', () => {
    test('swaps in the engine\'s own scores for a multi-engine scan', async () => {
        const { scansForEngine } = await load();

        const [axe] = scansForEngine([scoredMultiEngineScan()], 'axe');
        assert.equal(axe.metrics.a11ySummary.scores.evidence, 20);
        assert.deepEqual(axe.metrics.coverageSummary, { criteria: ['axe'] });

        const [sure] = scansForEngine([scoredMultiEngineScan()], 'surea11y');
        assert.equal(sure.metrics.a11ySummary.scores.evidence, 4);
        assert.deepEqual(sure.metrics.coverageSummary, { criteria: ['surea11y'] });
    });

    test('keeps the merged scores under "All engines"', async () => {
        const { scansForEngine, ALL_ENGINES } = await load();
        const [out] = scansForEngine([scoredMultiEngineScan()], ALL_ENGINES);
        assert.equal(out.metrics.a11ySummary.scores.evidence, 1);
    });

    test('leaves the domMetrics alone - they are measured off the page, not the findings', async () => {
        const { scansForEngine } = await load();
        const [out] = scansForEngine([scoredMultiEngineScan()], 'axe');
        assert.deepEqual(out.metrics.domMetrics, { totalElements: 500 });
    });

    test('a single-engine scan already carries that engine\'s metrics', async () => {
        // The merged-reports case: two single-engine runs loaded together. Each
        // scan was scored by the one engine that ran it, so nothing to swap.
        const { scansForEngine } = await load();
        const scans = [singleEngineScan('axe', 'axe-core', 20), singleEngineScan('surea11y', 'surea11y', 4)];

        const filtered = scansForEngine(scans, 'axe');
        assert.equal(filtered[0].metrics.a11ySummary.scores.evidence, 20);
    });

    test('does not mutate the payload it reads from', async () => {
        const { scansForEngine } = await load();
        const scans = [scoredMultiEngineScan()];
        scansForEngine(scans, 'axe');
        assert.equal(scans[0].metrics.a11ySummary.scores.evidence, 1);
    });

    test('an older multi-engine report keeps its merged scores rather than blanking them', async () => {
        const { scansForEngine } = await load();
        const [out] = scansForEngine([unscoredMultiEngineScan()], 'axe');
        assert.equal(out.metrics.a11ySummary.scores.evidence, 1);
        assert.equal(out.canonical.findings.length, 1, 'the findings still filter');
    });
});

describe('engineScoresFollow', () => {
    test('is true for "All engines"', async () => {
        const { engineScoresFollow, ALL_ENGINES } = await load();
        assert.equal(engineScoresFollow([unscoredMultiEngineScan()], ALL_ENGINES), true);
    });

    test('is true when every scan can supply the engine\'s own scores', async () => {
        const { engineScoresFollow } = await load();
        assert.equal(engineScoresFollow([scoredMultiEngineScan()], 'axe'), true);
        assert.equal(
            engineScoresFollow([singleEngineScan('axe', 'axe-core', 20), singleEngineScan('surea11y', 'surea11y', 4)], 'axe'),
            true
        );
    });

    test('is false when a multi-engine scan was scored only once', async () => {
        const { engineScoresFollow } = await load();
        assert.equal(engineScoresFollow([unscoredMultiEngineScan()], 'axe'), false);
    });

    test('ignores scans the selection leaves out entirely', async () => {
        // A surea11y-only scan carries no axe score, and should not: it has no
        // axe findings on screen to disagree with.
        const { engineScoresFollow } = await load();
        assert.equal(engineScoresFollow([singleEngineScan('surea11y', 'surea11y', 4)], 'axe'), true);
    });

    test('ignores a scan with no metrics at all', async () => {
        const { engineScoresFollow } = await load();
        const skipped = { id: 'k', skipped: true, canonical: null };
        assert.equal(engineScoresFollow([skipped], 'axe'), true);
    });
});
