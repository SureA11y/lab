'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('./report-identity.js');
async function load() {
    return mod;
}

describe('reportIdentity', () => {
    test('reads stamped identity verbatim', async () => {
        const { reportIdentity } = await load();
        const id = reportIdentity({
            runId: 'run_abc',
            timestamp: '2026-01-02T03:04:05.000Z',
            scenarioName: 'Checkout',
            url: 'https://shop.example/'
        });
        assert.equal(id.runId, 'run_abc');
        assert.equal(id.timestamp, '2026-01-02T03:04:05.000Z');
        assert.equal(id.scenarioName, 'Checkout');
        assert.equal(id.scopeUrl, 'https://shop.example/');
        assert.equal(id.label, 'Checkout');
    });

    test('label falls back scenario -> url -> timestamp -> Untitled', async () => {
        const { reportIdentity } = await load();
        assert.equal(reportIdentity({ url: 'https://x/' }).label, 'https://x/');
        assert.equal(reportIdentity({ timestamp: '2026-01-01T00:00:00Z' }).label, 'Run 2026-01-01T00:00:00Z');
        assert.equal(reportIdentity({}).label, 'Untitled run');
        assert.equal(reportIdentity(null).label, 'Untitled run');
    });

    test('synthesizes a runId from timestamp+url when none is stamped', async () => {
        const { reportIdentity } = await load();
        const id = reportIdentity({ timestamp: '2026-01-01T00:00:00Z', url: 'https://x/' });
        assert.equal(id.runId, 'syn:2026-01-01T00:00:00Z|https://x/');
    });

    test('blank/whitespace fields are treated as absent', async () => {
        const { reportIdentity } = await load();
        const id = reportIdentity({ runId: '   ', scenarioName: '  ', url: 'https://x/' });
        assert.equal(id.scenarioName, null);
        assert.equal(id.label, 'https://x/');
        assert.equal(id.runId, 'syn:https://x/'); // no timestamp part
    });
});

describe('scanTags (column qualifier)', () => {
    test('collects distinct scan tags, case-insensitive first-seen, sorted', async () => {
        const { reportIdentity } = await load();
        const id = reportIdentity({
            scenarioName: 'MyApp',
            scans: [
                { scanTags: ['Desktop'] },
                { scanTags: ['desktop', 'wide'] },
                { scanTags: [] },
                { scanTags: null },
            ]
        });
        assert.deepEqual(id.scanTags, ['Desktop', 'wide']);
    });

    test('reports filtered to different tags carry different qualifiers', async () => {
        const { reportIdentity } = await load();
        const desktop = reportIdentity({ scenarioName: 'MyApp', scans: [{ scanTags: ['desktop'] }] });
        const mobile = reportIdentity({ scenarioName: 'MyApp', scans: [{ scanTags: ['mobile'] }] });
        assert.deepEqual(desktop.scanTags, ['desktop']);
        assert.deepEqual(mobile.scanTags, ['mobile']);
        // same label, different qualifier — that's what tells the columns apart
        assert.equal(desktop.label, mobile.label);
        assert.notDeepEqual(desktop.scanTags, mobile.scanTags);
    });

    test('no scans -> empty tag list', async () => {
        const { reportIdentity } = await load();
        assert.deepEqual(reportIdentity({}).scanTags, []);
    });
});

describe('compareByTime / assignBaselineAndCurrent', () => {
    const older = { runId: 'a', timestamp: '2026-01-01T00:00:00Z', scenarioName: 'A' };
    const newer = { runId: 'b', timestamp: '2026-02-01T00:00:00Z', scenarioName: 'B' };

    test('orders oldest -> newest', async () => {
        const { compareByTime } = await load();
        assert.ok(compareByTime(older, newer) < 0);
        assert.ok(compareByTime(newer, older) > 0);
    });

    test('reports without a timestamp sort last', async () => {
        const { compareByTime } = await load();
        const undated = { runId: 'c', scenarioName: 'C' };
        assert.ok(compareByTime(older, undated) < 0);
        assert.ok(compareByTime(undated, older) > 0);
    });

    test('assigns older as baseline, newer as current regardless of arg order', async () => {
        const { assignBaselineAndCurrent } = await load();
        const r1 = assignBaselineAndCurrent(newer, older);
        assert.equal(r1.baseline.runId, 'a');
        assert.equal(r1.current.runId, 'b');
        const r2 = assignBaselineAndCurrent(older, newer);
        assert.equal(r2.baseline.runId, 'a');
        assert.equal(r2.current.runId, 'b');
    });

    test('preserves caller order on a timestamp tie (explicit baseline choice wins)', async () => {
        const { assignBaselineAndCurrent } = await load();
        const a = { runId: 'x', timestamp: '2026-01-01T00:00:00Z', scenarioName: 'same' };
        const b = { runId: 'y', timestamp: '2026-01-01T00:00:00Z', scenarioName: 'same' };
        const out = assignBaselineAndCurrent(a, b);
        assert.equal(out.baseline.runId, 'x');
        assert.equal(out.current.runId, 'y');
    });
});

test('reports of scans of several profiles compare when they checked the same ones, in any order', () => {
    const { describeComparison } = require('./report-identity.js');
    const aa = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
    const en = { id: 'en301549-v4.1.1', label: 'EN 301 549 V4.1.1' };
    const demo = { id: 'demo-1.0', label: 'Demo 1.0' };
    const report = (profiles, runId) => ({
        runId, timestamp: '2026-11-02T10:00:00Z', url: 'https://example.com/',
        scans: [{ id: 's1', url: 'https://example.com/', profile: profiles.find((p) => p !== aa) || aa,
            ...(profiles.length > 1 ? { profiles } : {}), wcag: { version: '2.2', level: 'AA' }, canonical: { findings: [] } }],
    });
    const same = describeComparison([report([aa, en, demo], 'a'), report([aa, demo, en], 'b')]);
    assert.equal(same.criteriaMismatch, false);
    assert.deepEqual(same.standardsCompared, ['Demo 1.0 and EN 301 549 V4.1.1']);

    const fewer = describeComparison([report([aa, en, demo], 'a'), report([aa, en], 'b')]);
    assert.equal(fewer.criteriaMismatch, true, 'a standard more is a different comparison');
    assert.equal(describeComparison([report([aa, en], 'a'), report([aa], 'b')]).criteriaMismatch, true);
});
