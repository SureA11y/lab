'use strict';

// buildGlobalSummary's own caller (workflow-payload-builder.js) has always called it
// as buildGlobalSummary({ scans, options }) - that's the documented contract at
// createWorkflowPayloadBuilder's deps.buildGlobalSummary jsdoc. This local, browser-safe
// implementation only ever accepted a bare array, so every real call site silently
// collapsed `scans` to [] and every extension-recorded run came back with domMetrics:
// null and an empty a11ySummary, even when the scans had real findings.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

require('./workflow-payload-deps.js');
const { buildGlobalSummary } = globalThis.A11Y_WORKFLOW_DEPS;

const SCAN_WITH_DOM = {
    domMetrics: { totalElements: 120, depthMax: 6, counts: {}, timings: { totalMs: 5 } },
    canonical: { findings: [] }
};

describe('workflow-payload-deps: buildGlobalSummary call shapes', () => {
    test('accepts the { scans, options } object shape its only real caller uses', () => {
        const out = buildGlobalSummary({ scans: [SCAN_WITH_DOM], options: { domP90: 90, useMinConfidence: false } });
        assert.ok(out.domMetrics, 'domMetrics should not be null when a scan carries real DOM metrics');
        assert.equal(out.domMetrics.totalElements, 120);
    });

    test('still accepts a bare array', () => {
        const out = buildGlobalSummary([SCAN_WITH_DOM]);
        assert.ok(out.domMetrics);
        assert.equal(out.domMetrics.totalElements, 120);
    });

    test('an object without a scans array degrades to empty rather than throwing', () => {
        const out = buildGlobalSummary({ options: {} });
        assert.equal(out.domMetrics, null);
    });
});
