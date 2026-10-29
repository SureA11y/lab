'use strict';

// Dep-free tests for the engines a saved report's findings came from. The module is
// ESM-with-`export`; import() it once for the whole suite (same shape as
// scan-tag-filter.test.js).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let mod;
async function load() {
    if (!mod) mod = await import('./report-engines.js');
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
