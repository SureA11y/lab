'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { assessRun, describeRunHealth } = require('./run-health.js');

function payloadWith(extra = {}) {
    return {
        url: 'https://example.com/',
        scans: [{ id: 'scan-1', label: 'Home', url: 'https://example.com/' }],
        actionResults: [{ index: 0, type: 'a11yScan', label: 'Home', status: 'ok', actionPath: '1' }],
        ...extra,
    };
}

describe('assessRun', () => {
    test('a scan whose iframes could not be scanned covered less, and the run says so', () => {
        const health = assessRun({ scans: [
            { label: 'Home', canonical: { notices: [{ code: 'frames-not-scanned', message: "1 of the page's 1 iframes could not be scanned" }] } },
            { label: 'Cart', canonical: { notices: [{ code: 'frames-off', message: 'left out' }] } },
        ] });
        assert.equal(health.degraded, true);
        assert.deepEqual(health.reasons, [{ kind: 'frames-not-scanned', count: 1, detail: 'Home' }]);
        assert.match(describeRunHealth(health)[0], /could not scan some of the page's iframes.*Home/);
    });

    test('a whole run is ok and gives nothing to report', () => {
        const health = assessRun(payloadWith());

        assert.equal(health.ok, true);
        assert.equal(health.degraded, false);
        assert.deepEqual(health.reasons, []);
        assert.deepEqual(describeRunHealth(health), []);
    });

    test('reads a payload that is missing everything without throwing', () => {
        for (const raw of [null, undefined, {}, 'not a payload']) {
            const health = assessRun(raw);
            assert.equal(health.degraded, false);
            assert.equal(health.iterationFailures, 0);
            assert.deepEqual(health.skippedScans, []);
        }
    });

    describe('skipped scans', () => {
        test('counts a scan the runner skipped', () => {
            const health = assessRun(payloadWith({
                scans: [
                    { id: 'scan-1', label: 'Home' },
                    { id: 'scan-2', label: 'Heavy page', skipped: true, skipInfo: { reason: 'too many nodes' } },
                ],
            }));

            assert.equal(health.degraded, true);
            assert.equal(health.ok, false);
            assert.deepEqual(health.skippedScans, [
                { label: 'Heavy page', url: null, reason: 'too many nodes' },
            ]);
            assert.deepEqual(describeRunHealth(health), ['1 scan skipped: Heavy page']);
        });

        test('treats skipInfo without the flag as skipped too', () => {
            const health = assessRun(payloadWith({
                scans: [{ id: 'scan-1', skipInfo: { message: 'nothing to scan' } }],
            }));

            assert.equal(health.degraded, true);
            assert.equal(health.skippedScans[0].reason, 'nothing to scan');
        });

        test('names a scan with no label by its id, then by position', () => {
            const health = assessRun(payloadWith({
                scans: [
                    { id: 'scan-a', skipped: true },
                    { skipped: true },
                ],
            }));

            assert.deepEqual(health.skippedScans.map((s) => s.label), ['scan-a', 'scan 2']);
        });
    });

    describe('iteration failures', () => {
        test('counts them and quotes the most common error', () => {
            const health = assessRun(payloadWith({
                iterationFailureSummary: {
                    total: 12,
                    byType: { forEachElement: 12 },
                    topErrors: [{ count: 9, error: 'element detached' }],
                    topLabels: [],
                },
            }));

            assert.equal(health.degraded, true);
            assert.equal(health.iterationFailures, 12);
            assert.deepEqual(describeRunHealth(health), ['12 iterations failed: element detached']);
        });

        test('a summary with no failures leaves the run whole', () => {
            const health = assessRun(payloadWith({
                iterationFailureSummary: { total: 0, byType: {}, topErrors: [], topLabels: [] },
            }));

            assert.equal(health.degraded, false);
            assert.equal(health.iterationFailures, 0);
        });

        test('describes them without an error when none was recorded', () => {
            const health = assessRun(payloadWith({
                iterationFailureSummary: { total: 1, byType: {}, topErrors: [], topLabels: [] },
            }));

            assert.deepEqual(describeRunHealth(health), ['1 iteration failed']);
        });
    });

    describe('actions', () => {
        test('a failed action degrades the run', () => {
            const health = assessRun(payloadWith({
                actionResults: [
                    { index: 0, type: 'click', label: 'Accept', status: 'failed', error: 'no such element', actionPath: '2' },
                ],
            }));

            assert.equal(health.degraded, true);
            assert.deepEqual(health.failedActions, [{ label: '2 Accept', error: 'no such element' }]);
            assert.deepEqual(describeRunHealth(health), ['1 action failed: 2 Accept']);
        });

        test('a failure the spec allowed is reported but is not degradation', () => {
            const health = assessRun(payloadWith({
                actionResults: [
                    { index: 0, type: 'click', status: 'failed-optional', error: 'not found', actionPath: '2' },
                ],
            }));

            assert.equal(health.degraded, false);
            assert.equal(health.ok, true);
            assert.deepEqual(health.optionalFailures, [{ label: '2 click', error: 'not found' }]);
        });

        test('a disabled action is neither failure nor degradation', () => {
            const health = assessRun(payloadWith({
                actionResults: [{ index: 0, type: 'click', status: 'skipped-disabled', actionPath: '2' }],
            }));

            assert.equal(health.degraded, false);
            assert.deepEqual(health.failedActions, []);
            assert.deepEqual(health.optionalFailures, []);
        });
    });

    describe('run status', () => {
        test('carries cancelled and failed without calling them degradation', () => {
            const cancelled = assessRun(payloadWith({ cancelled: true }));
            assert.equal(cancelled.cancelled, true);
            assert.equal(cancelled.degraded, false);
            assert.equal(cancelled.ok, false);

            const failed = assessRun(payloadWith({ failed: true }));
            assert.equal(failed.failed, true);
            assert.equal(failed.degraded, false);
            assert.equal(failed.ok, false);
        });

        test('reports every reason at once', () => {
            const health = assessRun(payloadWith({
                scans: [{ id: 'scan-1', label: 'Heavy', skipped: true }],
                actionResults: [
                    { index: 0, type: 'click', label: 'Menu', status: 'failed', actionPath: '1' },
                    { index: 1, type: 'click', label: 'Banner', status: 'failed-optional', actionPath: '2' },
                ],
                iterationFailureSummary: { total: 3, byType: {}, topErrors: [], topLabels: [] },
                failed: true,
            }));

            assert.deepEqual(health.reasons.map((r) => r.kind), [
                'skipped-scans',
                'iteration-failures',
                'failed-actions',
            ]);
            assert.equal(health.optionalFailures.length, 1);
            assert.equal(health.failed, true);
        });
    });
});
