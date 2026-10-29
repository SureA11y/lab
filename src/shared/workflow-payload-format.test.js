'use strict';

// A finished payload is in the current report format, also when its scans
// came from an older report opened or merged into it.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createWorkflowPayloadBuilder } = require('./workflow-payload-builder');
const { REPORT_VERSION, occurrenceId } = require('./report-format');

function builder() {
    return createWorkflowPayloadBuilder({
        METRIC_DEFS: {},
        sortByOrderKey: (arr) => arr,
        buildGlobalSummary: () => ({ domMetrics: null, a11ySummary: null }),
    });
}

test('a finished payload has the report version, current scan fields and occurrence ids', () => {
    const payload = builder().finalizeWorkflowPayload({
        url: 'https://example.com/',
        scans: [{
            scanId: 's1',
            url: 'https://example.com/a',
            wcagLevel: 'AA',
            wcagVersion: '2.2',
            conformanceProfile: null,
            canonical: { findings: [{ ruleId: 'image-alt', outcome: 'fail', occurrences: [{ target: ['img'] }] }] },
        }],
    });

    assert.equal(payload.reportVersion, REPORT_VERSION);
    const [scan] = payload.scans;
    assert.deepEqual(scan.profile, { id: 'wcag22-aa', label: 'WCAG 2.2 AA' });
    assert.deepEqual(scan.wcag, { version: '2.2', level: 'AA' });
    assert.equal('wcagLevel' in scan, false);
    const id = occurrenceId('image-alt', { target: ['img'] }, 'https://example.com/a');
    assert.equal(scan.canonical.findings[0].occurrences[0].occurrenceId, id);
});

test('a finished payload holds each finding once, in its scan, and occurrences without their repeats', () => {
    const occurrence = {
        pageUrl: 'https://example.com/a',
        target: ['img'],
        html: '<img>',
        failureSummary: 'This <img> has no alt attribute.',
        summary: 'This <img> has no alt attribute.',
        evidence: { engineNode: { url: ['https://example.com/a'], pageUrl: 'https://example.com/a', target: ['img'], html: '<img>', failureSummary: 'This <img> has no alt attribute.' } },
    };
    const payload = builder().finalizeWorkflowPayload({
        url: 'https://example.com/',
        scans: [{ scanId: 's1', url: 'https://example.com/a', canonical: { findings: [{ ruleId: 'image-alt', outcome: 'fail', occurrences: [occurrence] }] } }],
        // As a version 2 report merged into this one saved them.
        findings: { fail: [{ ruleId: 'image-alt', outcome: 'fail', occurrences: [{ target: ['img'] }] }] },
        a11yGlobalFindings: { fail: [], cantTell: [], pass: [], notApplicable: [] },
    });

    assert.equal('findings' in payload, false);
    assert.equal('a11yGlobalFindings' in payload, false);
    const [occ] = payload.scans[0].canonical.findings[0].occurrences;
    assert.deepEqual(Object.keys(occ).sort(), ['failureSummary', 'html', 'occurrenceId', 'pageUrl', 'target']);
});

test('a scan from an older report keeps what it checked against when built into a new payload', () => {
    const b = builder();
    const payload = b.buildWorkflowPayloadBase({
        url: 'https://example.com/',
        scans: [{ id: 's1', url: 'https://example.com/', wcagLevel: 'AAA', wcagVersion: '2.2', canonical: { findings: [] } }],
    });
    const [scan] = b.finalizeWorkflowPayload(payload).scans;
    assert.deepEqual(scan.profile, { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' });
    assert.deepEqual(scan.wcag, { version: '2.2', level: 'AAA' });
});

test('a scan\'s picture that was clipped says so in the payload', () => {
    const b = builder();
    const payload = b.buildWorkflowPayloadBase({
        url: 'https://example.com/',
        includeScanScreenshots: true,
        scans: [
            { id: 's1', url: 'https://example.com/', canonical: { findings: [] }, screenshot: { dataUrl: 'data:image/jpeg;base64,AA==', clipped: true } },
            { id: 's2', url: 'https://example.com/', canonical: { findings: [] }, screenshot: { dataUrl: 'data:image/jpeg;base64,AA==', clipped: false } },
        ],
    });
    assert.equal(payload.scans[0].screenshots[0].clipped, true);
    assert.equal('clipped' in payload.scans[1].screenshots[0], false);
});
