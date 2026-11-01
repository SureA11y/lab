'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkSpec, specDocumentOf } = require('./check-spec');
const { main } = require('./run-workflow');

const SPEC = {
    type: 'a11y-run-spec',
    specVersion: 1,
    url: 'https://example.com',
    actions: [{ type: 'a11yScan', label: 'Home' }],
};

describe('checkSpec', () => {
    test('a valid spec is ok, and comes back normalized', () => {
        const result = checkSpec(SPEC);
        assert.deepEqual({ errors: result.errors, warnings: result.warnings }, { errors: [], warnings: [] });
        assert.equal(result.ok, true);
        assert.equal(result.spec.url, 'https://example.com');
        assert.equal('profile' in result.spec, false);
    });

    test('reports the top-level fields and the steps in one pass, each once', () => {
        const result = checkSpec({ type: 'a11y-run-spec', specVersion: 1, actions: [{ type: 'navigate' }], extra: 1 });
        assert.equal(result.ok, false);
        assert.equal(result.spec, null);
        assert.deepEqual(result.errors, ['Spec must have a url', '$.actions[0] needs "url"']);
        assert.deepEqual(result.warnings, ['Unknown spec field "extra" ignored']);
    });

    test('takes a $schema field without a warning', () => {
        assert.deepEqual(checkSpec({ $schema: './schemas/run-spec.v1.schema.json', ...SPEC }).warnings, []);
    });

    test('checks the spec a saved config embeds', () => {
        const config = {
            version: 1,
            type: 'a11y-ui-src-config',
            state: { 'actions-workflow': [] },
            runSpec: { ...SPEC, actions: [{ type: 'click', selector: '#a', programmatic: 'true' }] },
        };
        const result = checkSpec(config);
        assert.deepEqual(result.errors, ['$.actions[0].programmatic must be true or false, not "true"']);
    });

    test('checks a config saved before specs, custom steps and all, from its form state', () => {
        const config = {
            version: 1,
            type: 'a11y-ui-src-config',
            state: {
                'url-input': 'https://example.com',
                'actions-workflow': [{ type: 'runCustomStep', customStepId: 'missing' }],
                'custom-steps-json': JSON.stringify([{ id: 'scan', actions: [{ type: 'a11yScan' }] }]),
            },
        };
        assert.ok(Array.isArray(specDocumentOf(config).customSteps));
        assert.deepEqual(checkSpec(config).errors, ['$.actions[0].customStepId "missing" names no custom step in this spec (it has "scan")']);
    });

    test('checks a config\'s own fields: batch rows, sections, form state', () => {
        const config = {
            version: 1,
            type: 'a11y-ui-src-config',
            state: { 'actions-workflow': SPEC.actions, 'url-input': 'https://example.com', 'scenario-name': 7 },
            runSpec: SPEC,
            batch: { rows: [{ name: 'Home', colour: 'red' }], enabled: 'yes' },
            sections: { workflow: false, notes: true },
        };
        const result = checkSpec(config);
        assert.deepEqual(result.errors.sort(), [
            '$.batch.enabled must be true or false, not "yes"',
            '$.batch.rows[0].colour "colour" is not a known field',
            '$.state["scenario-name"] must be text, not 7',
        ]);
        assert.deepEqual(result.warnings, ['$.sections.notes "notes" is not a known field']);
    });

    test('a config\'s steps are reported once, as the spec\'s', () => {
        const config = {
            version: 1,
            type: 'a11y-ui-src-config',
            state: { 'url-input': 'https://example.com', 'actions-workflow': [{ type: 'navigate' }] },
        };
        assert.deepEqual(checkSpec(config).errors, ['$.actions[0] needs "url"']);
    });

    test('custom steps that are not valid JSON are reported once', () => {
        const config = {
            version: 1,
            type: 'a11y-ui-src-config',
            state: { 'url-input': 'https://example.com', 'actions-workflow': [{ type: 'a11yScan' }], 'custom-steps-json': '[{' },
        };
        const { errors } = checkSpec(config);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /customSteps is not valid JSON/);
    });

    test('makes the check a run makes before it starts: engines and conformance targets', () => {
        const spec = {
            ...SPEC,
            actions: [
                { type: 'a11yScan', label: 'Old', profile: 'AA' },
                { type: 'a11yScan', label: 'Gone', engine: 'nope' },
            ],
        };
        const { errors, warnings } = checkSpec(spec);
        assert.deepEqual(warnings, ['$.actions[1].engine "engine" is not a known field']);
        assert.equal(errors.length, 2);
        assert.match(errors[0], /^Scan "Old": "AA" is not a profile/);
        assert.match(errors[1], /^Scan "Gone": "nope" is not an engine the lab has/);
    });

    test('a run profile is an error, and the converter is the way on', () => {
        const { errors } = checkSpec({ ...SPEC, profile: 'en301549-v3.2.1' });
        assert.match(errors[0], /^"profile" "en301549-v3\.2\.1" is not read any more: each scan step chooses its profile/);
    });

    test('takes the builder\'s folded and switched-off steps without a warning', () => {
        assert.deepEqual(checkSpec({ ...SPEC, actions: [{ type: 'a11yScan', collapsed: true, disabled: true }] }).warnings, []);
    });

    test('something that is not an object is an error, not a crash', () => {
        assert.deepEqual(checkSpec([1, 2]).errors, ['Spec must be a JSON object']);
    });
});

describe('run-workflow.js --check', () => {
    function withSpecFile(spec, fn) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-spec-'));
        const file = path.join(dir, 'spec.json');
        fs.writeFileSync(file, JSON.stringify(spec));
        const out = [];
        const log = console.log;
        const error = console.error;
        console.log = (...args) => out.push(args.join(' '));
        console.error = (...args) => out.push(args.join(' '));
        return Promise.resolve()
            .then(() => fn(file))
            .then((code) => ({ code, out }))
            .finally(() => {
                console.log = log;
                console.error = error;
                fs.rmSync(dir, { recursive: true, force: true });
            });
    }

    test('exits 0 on a spec that can run', async () => {
        const { code, out } = await withSpecFile(SPEC, (file) => main([file, '--check']));
        assert.equal(code, 0);
        assert.match(out.join('\n'), /spec\.json: ok, 1 step$/);
    });

    test('exits 2 with every error listed', async () => {
        const spec = { ...SPEC, url: 'ftp://example.com', actions: [{ type: 'save' }, { type: 'wait', ms: 'soon' }] };
        const { code, out } = await withSpecFile(spec, (file) => main([file, '--check']));
        assert.equal(code, 2);
        const text = out.join('\n');
        assert.match(text, /Error: Unsupported protocol: ftp:/);
        assert.match(text, /Error: \$\.actions\[0\]\.type "save" is not a step type/);
        assert.match(text, /Error: \$\.actions\[1\]\.ms must be a number/);
        assert.match(text, /3 errors, 0 warnings/);
    });

    test('warnings alone still exit 0', async () => {
        const spec = { ...SPEC, actions: [{ type: 'screenshot', name: 'home' }] };
        const { code, out } = await withSpecFile(spec, (file) => main([file, '--check']));
        assert.equal(code, 0);
        assert.match(out.join('\n'), /Warning: \$\.actions\[0\]\.name/);
        assert.match(out.join('\n'), /ok, 1 step, 1 warning$/);
    });
});

describe('run-workflow.js without --check', () => {
    test('a spec that cannot run exits 2 before a browser opens', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-spec-'));
        const file = path.join(dir, 'spec.json');
        fs.writeFileSync(file, JSON.stringify({ ...SPEC, actions: [{ type: 'save' }] }));
        const out = [];
        const { log, error } = console;
        console.log = (...a) => out.push(a.join(' '));
        console.error = (...a) => out.push(a.join(' '));
        try {
            assert.equal(await main([file, '--out', path.join(dir, 'out')]), 2);
        } finally {
            console.log = log;
            console.error = error;
        }
        assert.match(out.join('\n'), /Error: \$\.actions\[0\]\.type "save" is not a step type/);
        assert.equal(fs.existsSync(path.join(dir, 'out')), false);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
