'use strict';

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CONFIGURATION_CONTRACT_JSON = path.join(__dirname, '..', '..', 'docs', 'configuration_contract.json');
const RUN_SPEC_SCHEMA_JSON = path.join(__dirname, '..', '..', 'schemas', 'run-spec.v1.schema.json');
const EXAMPLE_CONFIGS = path.join(__dirname, '..', '..', 'examples', 'configs');

describe('docs/configuration_contract.json', () => {
    const contract = JSON.parse(fs.readFileSync(CONFIGURATION_CONTRACT_JSON, 'utf8'));

    test('actionCatalog is in sync with action-definitions.js (run `npm run build:action-docs` if this fails)', () => {
        const {ACTION_DEFINITIONS} = require('../workflow/action-definitions.js');

        for (const type of Object.keys(ACTION_DEFINITIONS)) {
            assert.ok(contract.actionCatalog[type], `actionCatalog is missing action type "${type}" - regenerate the docs`);
        }
        for (const type of Object.keys(contract.actionCatalog)) {
            assert.ok(ACTION_DEFINITIONS[type], `actionCatalog has stale action type "${type}" that no longer exists in action-definitions.js - regenerate the docs`);
        }
    });

    test('every argsJson example is valid JSON (this exact bug shipped once already)', () => {
        function walkArgsJson(value, pathLabel) {
            if (Array.isArray(value)) {
                value.forEach((v, i) => walkArgsJson(v, `${pathLabel}[${i}]`));
                return;
            }
            if (!value || typeof value !== 'object') return;
            for (const [key, v] of Object.entries(value)) {
                if (key === 'argsJson' && typeof v === 'string') {
                    assert.doesNotThrow(
                        () => JSON.parse(v),
                        `${pathLabel}.argsJson is not valid JSON: ${v}`
                    );
                } else {
                    walkArgsJson(v, `${pathLabel}.${key}`);
                }
            }
        }
        walkArgsJson(contract, 'contract');
    });

    test('actionTypeEnum lists every step type (run `npm run build:action-docs` if this fails)', () => {
        const { runSpecSchema } = require('../cli/check-spec.js');
        const stepTypes = runSpecSchema().$defs.action.properties.type.enum;
        assert.deepEqual(contract.actionTypeEnum, stepTypes);
    });

    test('names schema files that exist', () => {
        for (const file of [contract.sourceOfTruth.runSpecSchemaFile, contract.sourceOfTruth.appConfigSchemaFile,
            contract.outputFormats.runSpec.schemaFile, contract.outputFormats.configFile.schemaFile]) {
            assert.ok(fs.existsSync(path.join(__dirname, '..', '..', file)), file);
        }
    });

    test('every example passes --check with nothing to report', () => {
        const { checkSpec } = require('../cli/check-spec.js');
        const { validateUrlOrThrow } = require('../server-side/workflow-run.js');
        for (const [name, example] of Object.entries(contract.examples)) {
            const { errors, warnings } = checkSpec(example, { validateUrl: validateUrlOrThrow });
            assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] }, `examples.${name}`);
        }
    });
});

describe('schemas/run-spec.v1.schema.json', () => {
    test('is in sync with action-definitions.js (run `npm run build:action-docs` if this fails)', () => {
        const { runSpecSchema } = require('../cli/check-spec.js');
        const onDisk = JSON.parse(fs.readFileSync(RUN_SPEC_SCHEMA_JSON, 'utf8'));
        assert.deepEqual(onDisk, runSpecSchema());
    });
});

describe('schemas/app-config.v1.schema.json', () => {
    test('is in sync with action-definitions.js (run `npm run build:action-docs` if this fails)', () => {
        const { appConfigSchema } = require('../cli/check-spec.js');
        const onDisk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'app-config.v1.schema.json'), 'utf8'));
        assert.deepEqual(onDisk, appConfigSchema());
    });

    test('every example configuration, saved by the app, fits it and can run', () => {
        const { appConfigSchema, checkSpec } = require('../cli/check-spec.js');
        const { checkAgainstSchema } = require('../shared/json-schema-check.js');
        const files = fs.readdirSync(EXAMPLE_CONFIGS).filter((f) => f.endsWith('.json'));
        assert.ok(files.length > 0);
        for (const file of files) {
            const raw = JSON.parse(fs.readFileSync(path.join(EXAMPLE_CONFIGS, file), 'utf8'));
            assert.deepEqual(checkAgainstSchema(appConfigSchema(), raw), [], file);
            const { errors, warnings } = checkSpec(raw);
            assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] }, file);
        }
    });
});

describe('schemas/http-api.openapi.json', () => {
    const { httpApiSchema } = require('../server-side/http-api-schema.js');
    const ROOT = path.join(__dirname, '..', '..');

    test('is in sync with http-api-schema.js (run `npm run build:action-docs` if this fails)', () => {
        const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'http-api.openapi.json'), 'utf8'));
        assert.deepEqual(onDisk, httpApiSchema());
    });

    test('names only routes the server has, and schema files that exist', () => {
        const routes = [path.join(ROOT, 'server.js'), path.join(ROOT, 'src', 'server-side', 'queue-routes.js')]
            .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
        const api = httpApiSchema();
        for (const [route, methods] of Object.entries(api.paths)) {
            const express = route.replace(/\{(\w+)\}/g, ':$1');
            for (const method of Object.keys(methods)) {
                const quoted = new RegExp(`app\\.${method}\\((["'])${express.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);
                assert.match(routes, quoted, `${method.toUpperCase()} ${route}`);
            }
        }
        const refs = JSON.stringify(api).match(/"\$ref":"([^"#]+)"/g).map((r) => r.slice(8, -1));
        for (const file of new Set(refs)) assert.ok(fs.existsSync(path.join(ROOT, 'schemas', file)), file);
    });
});

describe('schemas/batch-spec.v1.schema.json', () => {
    test('is in sync with action-definitions.js (run `npm run build:action-docs` if this fails)', () => {
        const { batchSpecSchema } = require('../server-side/step-check.js');
        const onDisk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'batch-spec.v1.schema.json'), 'utf8'));
        assert.deepEqual(onDisk, batchSpecSchema());
    });
});

describe('schemas/ report, comparison and diff schemas', () => {
    test('are in sync with report-schemas.js (run `npm run build:action-docs` if this fails)', () => {
        const { publishedSchemas } = require('../shared/report-schemas.js');
        for (const [name, schema] of Object.entries(publishedSchemas())) {
            const onDisk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', name), 'utf8'));
            assert.deepEqual(onDisk, schema, name);
        }
    });
});
