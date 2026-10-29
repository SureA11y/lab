'use strict';

// Dep-free tests for the name the report export dialog starts with. The module
// is ESM-with-`export`; import() it once for the whole suite (same shape as
// engine-filter.test.js).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let mod;
async function load() {
    if (!mod) mod = await import('./report-name.js');
    return mod;
}

describe('pickReportNamePrefill', () => {
    test('offers the scenario name the first time', async () => {
        const { pickReportNamePrefill } = await load();

        assert.equal(
            pickReportNamePrefill({ scenarioName: 'Checkout', lastPromptedScenario: null }),
            'Checkout'
        );
    });

    test('keeps the name the user typed over it', async () => {
        const { pickReportNamePrefill } = await load();

        // Second export of the same scenario: the dialog already offered
        // "Checkout" and the user renamed it, so the rename is what stands.
        assert.equal(
            pickReportNamePrefill({
                storedName: 'Checkout - release candidate',
                scenarioName: 'Checkout',
                lastPromptedScenario: 'Checkout'
            }),
            'Checkout - release candidate'
        );
    });

    test('a renamed scenario takes the field back', async () => {
        const { pickReportNamePrefill } = await load();

        // The scenario changed between the two exports, so this is a report
        // about something else - the edit made for the previous one is stale.
        assert.equal(
            pickReportNamePrefill({
                storedName: 'Checkout - release candidate',
                scenarioName: 'Login',
                lastPromptedScenario: 'Checkout'
            }),
            'Login'
        );
    });

    test('without a scenario name, the stored name is all there is', async () => {
        const { pickReportNamePrefill } = await load();

        assert.equal(
            pickReportNamePrefill({ storedName: 'Nightly audit', scenarioName: '   ' }),
            'Nightly audit'
        );
    });

    test('offers nothing when neither is set', async () => {
        const { pickReportNamePrefill } = await load();

        assert.equal(pickReportNamePrefill(), '');
        assert.equal(pickReportNamePrefill({ storedName: '  ', scenarioName: null }), '');
    });

    test('naming a scenario for the first time wins over an earlier edit', async () => {
        const { pickReportNamePrefill } = await load();

        // The dialog was last shown with no scenario at all (offered ''), and
        // one has been typed since.
        assert.equal(
            pickReportNamePrefill({
                storedName: 'Untitled run',
                scenarioName: 'Checkout',
                lastPromptedScenario: ''
            }),
            'Checkout'
        );
    });

    test('ignores whitespace around the names', async () => {
        const { pickReportNamePrefill } = await load();

        assert.equal(
            pickReportNamePrefill({ scenarioName: '  Checkout  ', lastPromptedScenario: 'Checkout' }),
            'Checkout'
        );
    });
});
