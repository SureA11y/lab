'use strict';

/**
 * Regenerates the docs that mirror ACTION_DEFINITIONS, directly from
 * src/workflow/action-definitions.js — the single source of truth — so they
 * can't drift out of sync.
 *
 * schemas/run-spec.v1.schema.json, app-config.v1.schema.json and
 * batch-spec.v1.schema.json are
 * generated whole, by src/shared/run-spec-schema.js; the report, comparison
 * and diff schemas by src/shared/report-schemas.js.
 *
 * Only the generated portions are touched:
 *  - docs/step-definitions.html: just the `const ACTION_DEFINITIONS = {...}`
 *    data block inside its <script>. The page shell, CSS, and rendering JS
 *    are hand-authored and left alone.
 *  - docs/configuration_contract.json: the "actionCatalog" key and the list
 *    of step types (actionTypeEnum). Every
 *    other key (purpose, hardRules, examples, notes, ...) is hand-authored
 *    and left alone. No file is written at all (not even generatedAt)
 *    unless the generated content actually differs from what's on disk, so
 *    running the build with no source changes leaves a clean git diff.
 */

const fs = require('fs');
const path = require('path');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
const { runSpecSchema, appConfigSchema } = require('../cli/check-spec.js');
const { batchSpecSchema } = require('../server-side/step-check.js');
const { SCHEMA_FILE, APP_CONFIG_SCHEMA_FILE, BATCH_SPEC_SCHEMA_FILE } = require('../shared/run-spec-schema.js');
const { publishedSchemas } = require('../shared/report-schemas.js');
const { httpApiSchema } = require('../server-side/http-api-schema.js');

const STEP_DEFINITIONS_HTML = path.join(__dirname, '..', '..', 'docs', 'step-definitions.html');
const CONFIGURATION_CONTRACT_JSON = path.join(__dirname, '..', '..', 'docs', 'configuration_contract.json');
const RUN_SPEC_SCHEMA_JSON = path.join(__dirname, '..', '..', SCHEMA_FILE);

function normalizeOptions(options) {
    if (!Array.isArray(options)) return undefined;
    return options.map((opt) =>
        (opt && typeof opt === 'object') ? opt : {value: opt, label: String(opt)}
    );
}

/** Field order for a type: fieldOrder.primary first, then every other
 *  field in its natural declaration order (covers fields fieldOrder omits). */
function orderedFieldNames(def) {
    const allNames = Object.keys(def.fields || {});
    const primary = Array.isArray(def.fieldOrder?.primary) ? def.fieldOrder.primary : [];
    const rest = allNames.filter((n) => !primary.includes(n));
    return [...primary.filter((n) => allNames.includes(n)), ...rest];
}

/** Shape used by docs/step-definitions.html's card renderer: adds a 2-tier
 *  `importance` tag (primary/secondary) derived directly from fieldOrder —
 *  no invented "common vs advanced" distinction that source doesn't have. */
function buildHtmlDocDefinitions() {
    const out = {};
    for (const [type, def] of Object.entries(ACTION_DEFINITIONS)) {
        const primarySet = new Set(Array.isArray(def.fieldOrder?.primary) ? def.fieldOrder.primary : []);
        const fields = {};
        for (const name of orderedFieldNames(def)) {
            const f = def.fields[name];
            fields[name] = {
                type: f.type,
                required: !!f.required,
                importance: primarySet.has(name) ? 'primary' : 'secondary',
                alias: f.alias,
                description: f.description,
                ...(f.default !== undefined ? {default: f.default} : {}),
                ...(f.placeholder !== undefined ? {placeholder: f.placeholder} : {}),
                ...(f.example !== undefined ? {example: f.example} : {}),
                ...(normalizeOptions(f.options) ? {options: normalizeOptions(f.options)} : {})
            };
        }
        out[type] = {
            label: def.label,
            category: def.category,
            description: def.description,
            fields,
            ...(Array.isArray(def.examples) ? {examples: def.examples} : {})
        };
    }
    return out;
}

/** Shape used by docs/configuration_contract.json's actionCatalog: no
 *  importance tiering, field "label" is source's "alias". */
function buildContractCatalog() {
    const out = {};
    for (const [type, def] of Object.entries(ACTION_DEFINITIONS)) {
        const fields = {};
        const requiredFields = [];
        for (const name of orderedFieldNames(def)) {
            const f = def.fields[name];
            if (f.required) requiredFields.push(name);
            fields[name] = {
                type: f.type,
                required: !!f.required,
                label: f.alias,
                ...(f.description !== undefined ? {description: f.description} : {}),
                ...(f.default !== undefined ? {default: f.default} : {}),
                ...(f.integer === true ? {integer: true} : {}),
                ...(typeof f.min === 'number' ? {min: f.min} : {}),
                ...(typeof f.max === 'number' ? {max: f.max} : {}),
                ...(normalizeOptions(f.options) ? {options: normalizeOptions(f.options)} : {})
            };
        }
        out[type] = {
            label: def.label,
            category: def.category,
            description: def.description,
            requiredFields,
            fields,
            ...(Array.isArray(def.examples) ? {examples: def.examples} : {})
        };
    }
    return out;
}

function updateStepDefinitionsHtml() {
    const html = fs.readFileSync(STEP_DEFINITIONS_HTML, 'utf8');
    const marker = 'const ACTION_DEFINITIONS = ';
    const start = html.indexOf(marker);
    if (start === -1) throw new Error(`Could not find "${marker}" in ${STEP_DEFINITIONS_HTML}`);

    const afterMarker = start + marker.length;
    const closing = html.indexOf('\n    };', afterMarker);
    if (closing === -1) throw new Error(`Could not find the closing "};" for ACTION_DEFINITIONS in ${STEP_DEFINITIONS_HTML}`);
    const end = closing + '\n    };'.length;

    const generated = JSON.stringify(buildHtmlDocDefinitions(), null, 4)
        // re-indent the generated block onto the surrounding <script>'s 4-space base
        .split('\n').join('\n    ');

    const updated = html.slice(0, afterMarker) + generated + ';' + html.slice(end);
    if (updated === html) {
        console.log(`${path.relative(process.cwd(), STEP_DEFINITIONS_HTML)} unchanged, skipping write`);
        return;
    }
    fs.writeFileSync(STEP_DEFINITIONS_HTML, updated);
    console.log(`Updated ${path.relative(process.cwd(), STEP_DEFINITIONS_HTML)}`);
}

function updateConfigurationContract() {
    const raw = fs.readFileSync(CONFIGURATION_CONTRACT_JSON, 'utf8');
    const contract = JSON.parse(raw);
    const newCatalog = buildContractCatalog();
    const stepTypes = runSpecSchema().$defs.action.properties.type.enum;
    if (JSON.stringify(contract.actionCatalog) === JSON.stringify(newCatalog)
        && JSON.stringify(contract.actionTypeEnum) === JSON.stringify(stepTypes)) {
        console.log(`${path.relative(process.cwd(), CONFIGURATION_CONTRACT_JSON)} unchanged, skipping write`);
        return;
    }
    contract.actionCatalog = newCatalog;
    contract.actionTypeEnum = stepTypes.slice();
    contract.generatedAt = new Date().toISOString();
    fs.writeFileSync(CONFIGURATION_CONTRACT_JSON, JSON.stringify(contract, null, 2) + '\n');
    console.log(`Updated ${path.relative(process.cwd(), CONFIGURATION_CONTRACT_JSON)}`);
}

// The app configuration's schema, built on the run spec's.
function updateAppConfigSchema() {
    writeIfChanged(path.join(__dirname, '..', '..', APP_CONFIG_SCHEMA_FILE), JSON.stringify(appConfigSchema(), null, 2) + '\n');
    writeIfChanged(path.join(__dirname, '..', '..', BATCH_SPEC_SCHEMA_FILE), JSON.stringify(batchSpecSchema(), null, 2) + '\n');
}

function updateRunSpecSchema() {
    const generated = JSON.stringify(runSpecSchema(), null, 2) + '\n';
    const current = fs.existsSync(RUN_SPEC_SCHEMA_JSON) ? fs.readFileSync(RUN_SPEC_SCHEMA_JSON, 'utf8') : null;
    if (current === generated) {
        console.log(`${path.relative(process.cwd(), RUN_SPEC_SCHEMA_JSON)} unchanged, skipping write`);
        return;
    }
    fs.mkdirSync(path.dirname(RUN_SPEC_SCHEMA_JSON), { recursive: true });
    fs.writeFileSync(RUN_SPEC_SCHEMA_JSON, generated);
    console.log(`Updated ${path.relative(process.cwd(), RUN_SPEC_SCHEMA_JSON)}`);
}

function writeIfChanged(file, generated) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === generated) {
        console.log(`${path.relative(process.cwd(), file)} unchanged, skipping write`);
        return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated);
    console.log(`Updated ${path.relative(process.cwd(), file)}`);
}

// The report, comparison and diff schemas (src/shared/report-schemas.js).
function updateReportSchemas() {
    for (const [name, schema] of Object.entries(publishedSchemas())) {
        writeIfChanged(path.join(__dirname, '..', '..', 'schemas', name), JSON.stringify(schema, null, 2) + '\n');
    }
    writeIfChanged(path.join(__dirname, '..', '..', 'schemas', 'http-api.openapi.json'), JSON.stringify(httpApiSchema(), null, 2) + '\n');
}

function main() {
    updateStepDefinitionsHtml();
    updateConfigurationContract();
    updateRunSpecSchema();
    updateAppConfigSchema();
    updateReportSchemas();
}

main();
