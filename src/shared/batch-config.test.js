'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { configForBatch, isConfigFileName, isConfig } = require('./batch-config.js');

const config = (state = {}) => ({ version: 1, type: 'a11y-ui-src-config', url: 'https://shop.test/v1', state: { 'url-input': 'https://shop.test/v1', 'scenario-name': 'v1', ...state }, runSpec: { url: 'https://shop.test/v1', scenarioName: 'v1', vars: { lang: 'en' }, actions: [] } });

describe('batch config', () => {
    test("rebuilds a batch's configuration from batch.json: its workflow, and every run's row", () => {
        const rebuilt = configForBatch({
            name: 'Shop',
            items: [
                { name: 'v1', url: 'https://shop.test/v1', vars: { lang: 'en' }, config: config() },
                { name: 'v2', url: 'https://shop.test/v2', vars: {}, config: null },
            ],
        });
        assert.equal(rebuilt.type, 'a11y-ui-src-config');
        assert.deepEqual(rebuilt.batch, { rows: [{ name: 'v1', url: 'https://shop.test/v1', vars: { lang: 'en' } }, { name: 'v2', url: 'https://shop.test/v2' }], enabled: true });
        assert.equal(rebuilt.state['scenario-name'], 'Shop', 'the workflow is named as the batch; the rows name the runs');
        assert.equal(rebuilt.runSpec.scenarioName, 'Shop');
        assert.equal('vars' in rebuilt.runSpec, false, "a row's variables are in its row");
        assert.equal(rebuilt.metadata.rebuiltFrom, 'batch.json');
    });

    test('nothing to rebuild from', () => {
        assert.equal(configForBatch({ items: [{ name: 'v1', config: null }] }), null);
        assert.equal(configForBatch(null), null);
    });

    test('names and shapes', () => {
        assert.equal(isConfigFileName('Shop.a11y-config.json'), true);
        assert.equal(isConfigFileName('Shop.json'), false);
        assert.equal(isConfig(config()), true);
        assert.equal(isConfig({ scans: [] }), false);
    });
});
