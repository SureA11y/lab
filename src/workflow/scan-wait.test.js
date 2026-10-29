'use strict';

// The scan step's "Wait for" (waitForSelector, waitVisible, waitTimeout): the
// workflow engine waits for the selector before it hands the scan to the
// runner. A stub page stands in for the browser: it answers page.$ for one
// selector once that element has "appeared", with the visibility it is given.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyActions, createWorkflowContext } = require('./workflow-engine');

/** A page where `selector` appears after `appearAfterMs`, visible or not. */
function stubPage({ selector = '#late', appearAfterMs = 0, visible = true } = {}) {
    const start = Date.now();
    const handle = {
        async evaluate() { return visible; },
        async dispose() {},
    };
    return {
        async $(sel) { return sel === selector && Date.now() - start >= appearAfterMs ? handle : null; },
        async $$() { return []; },
        async evaluateHandle() { return { asElement: () => null, async dispose() {} }; },
        url() { return 'about:blank'; },
    };
}

async function runScan(action, page) {
    const ctx = createWorkflowContext({});
    const scanned = [];
    ctx.handleA11yScanAction = async ({ action: a }) => { scanned.push({ label: a.label, at: Date.now() }); };
    const started = Date.now();
    await applyActions(page, [{ type: 'a11yScan', label: 'Home', ...action }], null, 0, ctx, Object.create(null), 0, null);
    return { scanned, started };
}

describe('a11yScan "Wait for"', () => {
    test('scans once the selector appears, not before', async () => {
        const { scanned, started } = await runScan({ waitForSelector: '#late' }, stubPage({ appearAfterMs: 300 }));
        assert.equal(scanned.length, 1);
        assert.ok(scanned[0].at - started >= 300, `scanned after ${scanned[0].at - started} ms`);
    });

    test('a selector that never appears fails the step instead of scanning', async () => {
        const ctx = createWorkflowContext({});
        let scanned = false;
        ctx.handleA11yScanAction = async () => { scanned = true; };
        await assert.rejects(
            applyActions(stubPage(), [{ type: 'a11yScan', waitForSelector: '#never', waitTimeout: 200 }], null, 0, ctx, Object.create(null), 0, null),
            /"#never" did not appear within 200 ms/
        );
        assert.equal(scanned, false);
    });

    test('waits for visibility unless the step says not to', async () => {
        const hidden = stubPage({ visible: false });
        await assert.rejects(runScan({ waitForSelector: '#late', waitTimeout: 200 }, hidden), /did not appear/);

        const { scanned } = await runScan({ waitForSelector: '#late', waitVisible: false }, hidden);
        assert.equal(scanned.length, 1);
    });

    test('takes a {var:...} token in the selector', async () => {
        const ctx = createWorkflowContext({ vars: { panel: 'late' } });
        let scanned = false;
        ctx.handleA11yScanAction = async () => { scanned = true; };
        await applyActions(stubPage(), [{ type: 'a11yScan', waitForSelector: '#{var:panel}' }], null, 0, ctx, Object.create(null), 0, null);
        assert.equal(scanned, true);
    });

    test('without it, scans straight away', async () => {
        const { scanned } = await runScan({}, stubPage({ appearAfterMs: 10_000 }));
        assert.equal(scanned.length, 1);
    });
});
