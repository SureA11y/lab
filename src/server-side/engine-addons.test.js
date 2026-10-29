'use strict';

// The default install: surea11y alone, every add-on left out. Set before the
// facade loads, as an install without the add-on would have it.
process.env.A11Y_ENGINE_ADDONS = 'off';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const a11yEngine = require('./a11y-engine');
const { withEngineChoices } = require('./scan-engine-field');
const { ACTION_DEFINITIONS } = require('../workflow/action-definitions');
const { checkSpec } = require('../cli/check-spec');

const SPEC = { type: 'a11y-run-spec', specVersion: 1, url: 'https://example.com/' };

test('surea11y is the only engine, and the default', () => {
    const { engines, defaultEngineId } = a11yEngine.listEngines();
    assert.deepEqual(engines.map((e) => e.id), ['surea11y']);
    assert.equal(defaultEngineId, 'surea11y');
});

test('a step naming an add-on\'s engine says which add-on, and how to install it', () => {
    const { errors } = checkSpec({ ...SPEC, actions: [{ type: 'a11yScan', label: 'Home', engine: 'axe' }] });
    assert.deepEqual(errors, ['Scan "Home": The engine "axe" comes with the more-engines add-on, which is not installed here. Install it with: npm run addon:install -- more-engines']);
});

test('an engine no add-on offers is still unknown', () => {
    const { errors } = checkSpec({ ...SPEC, actions: [{ type: 'a11yScan', label: 'Home', engine: 'nope' }] });
    assert.match(errors[0], /Failed to resolve accessibility engine "nope"/);
});

test('the step editor is offered surea11y alone', () => {
    const field = withEngineChoices(ACTION_DEFINITIONS, a11yEngine).a11yScan.fields.engine;
    assert.deepEqual(field.options.map((o) => o.value), ['surea11y']);
});
