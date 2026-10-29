'use strict';

// Dep-free tests for the per-scan `scanTags` feature at the workflow-engine
// layer: the a11yScan handler interpolates each tag with the same token
// vocabulary as `label`, then trims, drops empties, and de-duplicates while
// preserving first-seen order. These require only the engine module (no sharp/
// puppeteer), so they run in any environment.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');
const { createWorkflowPayloadBuilder } = require('../shared/workflow-payload-builder');

// Runs a single a11yScan action through the real engine dispatch and returns
// the `action` object the runner would have received (with scanTags already
// interpolated/normalized by the engine).
async function runScan(action, { vars = {} } = {}) {
    const ctx = createWorkflowContext({ vars });
    let captured = null;
    ctx.handleA11yScanAction = async ({ action: a }) => {
        captured = { label: a.label, scanTags: a.scanTags };
    };
    await applyActions({}, [action], null, 0, ctx, Object.create(null), 0, null);
    return captured;
}

describe('a11yScan scanTags', () => {
    test('interpolates {var:...} tokens like the label does', async () => {
        const out = await runScan(
            { type: 'a11yScan', label: 'Home {var:viewport}', scanTags: ['{var:viewport}', 'checkout'] },
            { vars: { viewport: 'mobile' } }
        );
        assert.equal(out.label, 'Home mobile');
        assert.deepEqual(out.scanTags, ['mobile', 'checkout']);
    });

    test('trims whitespace, drops empties, and de-dupes preserving order', async () => {
        const out = await runScan({
            type: 'a11yScan',
            scanTags: ['  desktop  ', 'checkout', '', '   ', 'checkout', 'desktop'],
        });
        assert.deepEqual(out.scanTags, ['desktop', 'checkout']);
    });

    test('accepts a comma-separated string and splits it', async () => {
        const out = await runScan({
            type: 'a11yScan',
            scanTags: 'desktop, checkout , desktop',
        });
        assert.deepEqual(out.scanTags, ['desktop', 'checkout']);
    });

    test('normalizes to null when input is present but yields no tags', async () => {
        const emptyArray = await runScan({ type: 'a11yScan', scanTags: ['', '   '] });
        assert.equal(emptyArray.scanTags, null);

        const emptyString = await runScan({ type: 'a11yScan', scanTags: '  ,  ' });
        assert.equal(emptyString.scanTags, null);
    });

    test('leaves scanTags untouched when the field is absent (runner coerces to null)', async () => {
        const absent = await runScan({ type: 'a11yScan' });
        // The engine does not fabricate the field; buildScanPayload/runner turn
        // a missing value into null. Loose check covers undefined and null.
        assert.ok(absent.scanTags == null);
    });

    test('a token that resolves to empty is dropped', async () => {
        const out = await runScan(
            { type: 'a11yScan', scanTags: ['{var:missing}', 'kept'] },
            { vars: {} }
        );
        assert.deepEqual(out.scanTags, ['kept']);
    });
});

describe('buildScanPayload scanTags emission', () => {
    // Minimal fake deps: buildScanPayload only needs these to construct the
    // payload skeleton; scanTags handling is pure passthrough/normalization.
    const builder = createWorkflowPayloadBuilder({
        METRIC_DEFS: {},
        sortByOrderKey: (arr) => arr,
        findingsByOutcome: () => ({}),
        getA11yGlobalFindings: () => [],
        buildGlobalSummary: () => ({}),
        cryptoSha1Hex16: (t) => String(t).slice(0, 16),
    });

    function scanOut(scan) {
        const base = builder.buildWorkflowPayloadBase({
            url: 'http://x',
            scans: [{ id: 's', canonical: { findings: [] }, ...scan }],
        });
        return base.scans.find((s) => s.id === 's');
    }

    test('passes a non-empty tag array through to the payload', () => {
        assert.deepEqual(scanOut({ scanTags: ['desktop', 'checkout'] }).scanTags, ['desktop', 'checkout']);
    });

    test('emits null for an empty array', () => {
        assert.equal(scanOut({ scanTags: [] }).scanTags, null);
    });

    test('emits null when the field is absent', () => {
        assert.equal(scanOut({}).scanTags, null);
    });
});

