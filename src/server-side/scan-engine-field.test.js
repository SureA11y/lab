'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions');
const { withEngineChoices } = require('./scan-engine-field');

const facade = {
    listEngines: () => ({
        engines: [
            { id: 'surea11y', name: 'surea11y', loadable: true },
            { id: 'axe', name: 'axe-core', loadable: true },
            { id: 'broken', name: 'Broken', loadable: true },
            { id: 'off', name: 'Off', loadable: false },
        ],
        defaultEngineId: 'surea11y',
    }),
    getCapabilities: (id) => {
        if (id === 'broken') throw new Error('cannot load');
        return {
            capabilities: { actions: { a11yScan: { locale: id === 'surea11y' } } },
            conformanceTargets: id === 'surea11y' ? ['wcag22-aa', 'en301549-v3.2.1'] : ['wcag22-aa'],
        };
    },
};

describe('withEngineChoices', () => {
    const defs = withEngineChoices(ACTION_DEFINITIONS, facade);
    const field = defs.a11yScan.fields.engine;

    test('offers the loadable engines, with the default engine as the default', () => {
        assert.deepEqual(field.options, [
            { value: 'surea11y', label: 'surea11y' },
            { value: 'axe', label: 'axe-core' },
            { value: 'broken', label: 'Broken' },
        ]);
        assert.equal(field.default, 'surea11y');
    });

    test('gives each engine\'s fields and targets, leaving out one it cannot read', () => {
        assert.deepEqual(field.engineCapabilities, {
            surea11y: { fields: { locale: true }, conformanceTargets: ['wcag22-aa', 'en301549-v3.2.1'] },
            axe: { fields: { locale: false }, conformanceTargets: ['wcag22-aa'] },
        });
    });

    test('leaves the definitions themselves as they are', () => {
        assert.equal(ACTION_DEFINITIONS.a11yScan.fields.engine.options, undefined);
        assert.equal(defs.click, ACTION_DEFINITIONS.click);
    });

    test('with no engines listed, changes nothing', () => {
        assert.equal(withEngineChoices(ACTION_DEFINITIONS, { listEngines: () => ({ engines: [] }) }), ACTION_DEFINITIONS);
    });
});
