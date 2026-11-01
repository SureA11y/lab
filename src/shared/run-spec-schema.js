'use strict';

/**
 * run-spec-schema.js (shared)
 *
 * The run spec as a published JSON Schema, built from the action definitions
 * so the schema cannot list a step, a field or an option the engine does not
 * have. `npm run build:action-docs` writes it to schemas/run-spec.v1.schema.json
 * for whatever writes specs outside the app: an editor, a script, a generator.
 *
 * The schema is strict on purpose: no fields an action does not declare, and
 * only the values the app offers where it offers a list. That is the target a
 * generated spec should hit. `checkSpecActions` reads the same schema more
 * leniently for specs people already have: a field the action does not
 * declare, or a value outside the offered list, is a warning; a value of the
 * wrong kind is an error, because the engine reads it as if it were absent
 * (a boolean field only takes `true`, never "true").
 *
 * Browser: available as globalThis.A11Y_RUN_SPEC_SCHEMA.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_RUN_SPEC_SCHEMA = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const SCHEMA_ID = 'urn:surea11y-lab:run-spec:v1';
    const SCHEMA_FILE = 'schemas/run-spec.v1.schema.json';

    // The engine's variable tokens ({var:name}, {index}, {oneBased}, {total}),
    // as engine/numbers.js recognises them. A field that takes a token takes
    // any text holding one, since the value is only known at run time.
    const VAR_TOKEN_PATTERN = '\\{\\s*[Vv][Aa][Rr]\\s*:|\\{\\s*(?:index|oneBased|total)\\s*\\}';
    const NUMBER_TEXT_PATTERN = '^\\s*[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*$';

    const VAR_TOKEN = {
        type: 'string',
        pattern: VAR_TOKEN_PATTERN,
        description: 'text with a {var:…} token',
    };

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function optionValues(field) {
        const list = Array.isArray(field.options) ? field.options : (Array.isArray(field.enum) ? field.enum : null);
        if (!list) return null;
        return list.map((o) => (isPlainObject(o) ? o.value : o));
    }

    function actionRef(type) {
        return { $ref: `#/$defs/action.${type}` };
    }

    /** One field of an action definition as a schema. */
    function fieldSchema(field, itemOnlyTypes) {
        const out = {};
        if (field.description) out.description = field.description;
        if (field.default !== undefined) out.default = field.default;

        const values = optionValues(field);
        const tokenAllowed = field.variableToken !== false;

        switch (field.type) {
            case 'string':
                if (field.secret === true) {
                    // The value, or where to find it when the run starts (secret-refs.js).
                    out.anyOf = [{ type: 'string' }, { $ref: '#/$defs/secretRef' }];
                    return out;
                }
                out.type = 'string';
                if (values && field.otherValues === true) {
                    out.examples = values;
                } else if (values && field.packValues === true) {
                    // The values listed, or one an installed standard pack
                    // adds (a profile such as "rgaa-4.1"), which the run
                    // checks against the packs it has.
                    const pack = { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9.]+)+$', description: 'a profile of an installed standard pack' };
                    out.anyOf = tokenAllowed ? [{ enum: values }, pack, VAR_TOKEN] : [{ enum: values }, pack];
                } else if (values) {
                    out.anyOf = tokenAllowed ? [{ enum: values }, VAR_TOKEN] : [{ enum: values }];
                }
                return out;
            case 'number': {
                const literal = { type: field.integer === true ? 'integer' : 'number' };
                if (typeof field.min === 'number') literal.minimum = field.min;
                if (typeof field.max === 'number') literal.maximum = field.max;
                return {
                    ...out,
                    anyOf: [
                        literal,
                        { type: 'string', pattern: `${NUMBER_TEXT_PATTERN}|${VAR_TOKEN_PATTERN}`, description: 'a number as text, or text with a {var:…} token' },
                    ],
                };
            }
            case 'boolean':
                out.type = 'boolean';
                return out;
            case 'string[]':
            case 'array':
                out.type = 'array';
                out.items = { type: 'string' };
                return out;
            case 'string|string[]':
                out.type = ['string', 'array'];
                out.items = { type: 'string' };
                return out;
            case 'string|number':
                out.type = ['string', 'number'];
                return out;
            case 'string|object':
                out.type = ['string', 'object'];
                return out;
            case 'string|number|boolean':
                out.type = ['string', 'number', 'boolean'];
                return out;
            case 'Action[]':
                out.type = 'array';
                out.items = field.itemType && itemOnlyTypes.has(field.itemType)
                    ? actionRef(field.itemType)
                    : { $ref: '#/$defs/action' };
                return out;
            case 'any':
                return out;
            default:
                throw new Error(`run-spec-schema: no schema for field type "${field.type}"`);
        }
    }

    /** One action type as a schema: its own fields, `disabled`, `collapsed` and `alias`, and nothing else. */
    function actionSchema(type, def, itemOnlyTypes) {
        const properties = {
            type: { const: type },
            disabled: { type: 'boolean', description: 'Skip this step without removing it.' },
            collapsed: { type: 'boolean', description: 'Shown folded in the app\'s builder. No effect on the run.' },
            alias: { type: 'string', description: 'The step\'s own title in the app\'s builder and in the run\'s log, in place of its type\'s.' },
        };
        const required = ['type'];
        const anyOf = [];

        for (const [name, field] of Object.entries(def.fields || {})) {
            properties[name] = fieldSchema(field, itemOnlyTypes);
            if (field.secret === true) {
                // Saved configs leave secrets out and mark them instead.
                properties[`${name}Masked`] = {
                    type: 'boolean',
                    description: `Set by the app in place of "${name}", which is never saved. The value has to be supplied again before the step can run.`,
                };
                if (field.required) anyOf.push({ required: [name] }, { required: [`${name}Masked`] });
            } else if (field.required) {
                required.push(name);
            }
        }

        const out = {
            title: def.label || type,
            ...(def.description ? { description: def.description } : {}),
            type: 'object',
            required,
            properties,
            additionalProperties: false,
        };
        if (anyOf.length) out.anyOf = anyOf;
        return out;
    }

    /**
     * Build the run spec schema.
     *
     * actionDefinitions: ACTION_DEFINITIONS from src/workflow/action-definitions.js.
     * viewportPresets:   the preset names a spec's viewport may give.
     * varNamePattern:    the source of run-spec.js's VAR_NAME_RE.
     */
    function buildRunSpecSchema({ actionDefinitions, viewportPresets = [], varNamePattern }) {
        if (!isPlainObject(actionDefinitions)) throw new Error('buildRunSpecSchema needs actionDefinitions');

        // A type that only appears as the item of another's list (a switch's
        // case) is not a step on its own.
        const itemOnlyTypes = new Set();
        for (const def of Object.values(actionDefinitions)) {
            for (const field of Object.values(def.fields || {})) {
                if (field.type === 'Action[]' && field.itemType && actionDefinitions[field.itemType]) {
                    itemOnlyTypes.add(field.itemType);
                }
            }
        }

        const stepTypes = Object.keys(actionDefinitions).filter((t) => !itemOnlyTypes.has(t));
        const $defs = {
            action: {
                description: 'One workflow step. "type" picks the step; each type takes its own fields.',
                type: 'object',
                required: ['type'],
                properties: { type: { enum: stepTypes } },
                allOf: stepTypes.map((t) => ({
                    if: { properties: { type: { const: t } }, required: ['type'] },
                    then: actionRef(t),
                })),
            },
            secretRef: {
                description: 'A secret read from an environment variable when the run starts, so the file never holds it. The run fails before it opens a browser when the variable is not set.',
                type: 'object',
                required: ['$env'],
                properties: {
                    $env: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$', description: 'The environment variable\'s name, e.g. "SHOP_PASSWORD".' },
                },
                additionalProperties: false,
            },
            customStep: {
                description: 'A named list of steps that runCustomStep calls, with the inputs it takes as variables.',
                type: 'object',
                required: ['id', 'actions'],
                properties: {
                    id: { type: 'string', minLength: 1, description: 'What runCustomStep\'s customStepId names. Unique in the spec.' },
                    name: { type: 'string' },
                    inputs: {
                        type: 'array',
                        items: {
                            anyOf: [
                                { type: 'string', minLength: 1 },
                                {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: { type: 'string', minLength: 1 },
                                        required: { type: 'boolean' },
                                        default: {},
                                    },
                                    additionalProperties: false,
                                },
                            ],
                        },
                    },
                    actions: { type: 'array', items: { $ref: '#/$defs/action' } },
                },
                additionalProperties: false,
            },
        };
        for (const [type, def] of Object.entries(actionDefinitions)) {
            $defs[`action.${type}`] = actionSchema(type, def, itemOnlyTypes);
        }

        return {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: SCHEMA_ID,
            title: 'surea11y-lab run spec',
            description: 'A workflow run: the page to open, the steps to take there and how to scan. '
                + 'The app saves one inside every configuration (its "runSpec"), and '
                + '`node src/cli/run-workflow.js <spec.json>` runs one; add --check to validate it without running. '
                + `Generated from src/workflow/action-definitions.js by \`npm run build:action-docs\`; do not edit ${SCHEMA_FILE} by hand.`,
            type: 'object',
            required: ['type', 'specVersion', 'url', 'actions'],
            properties: {
                $schema: { type: 'string', description: 'Where an editor finds this schema, e.g. "./schemas/run-spec.v1.schema.json".' },
                type: { const: 'a11y-run-spec' },
                specVersion: { const: 1 },
                version: { const: 1, deprecated: true, description: 'Older name for specVersion.' },
                url: { type: 'string', minLength: 1, format: 'uri', description: 'The page the workflow starts on, http or https.' },
                scenarioName: { type: 'string', description: 'Names the run, and the folder the CLI keeps its runs in.' },
                actions: { type: 'array', minItems: 1, items: { $ref: '#/$defs/action' } },
                customSteps: { type: 'array', items: { $ref: '#/$defs/customStep' } },
                viewport: {
                    description: 'A preset name, or a size in CSS pixels.',
                    anyOf: [
                        viewportPresets.length ? { enum: viewportPresets.slice() } : { type: 'string' },
                        {
                            type: 'object',
                            required: ['width', 'height'],
                            properties: {
                                width: { type: 'number', minimum: 1 },
                                height: { type: 'number', minimum: 1 },
                            },
                            additionalProperties: false,
                        },
                    ],
                },
                colorScheme: {
                    enum: ['light', 'dark'],
                    description: 'The color scheme the page is shown in as the run starts (prefers-color-scheme). Left out, the browser\'s own (light). Set color scheme and contrast changes it; its Run default comes back to this.',
                },
                highContrast: {
                    enum: ['on', 'off', true, false],
                    description: 'Show the page in forced colors (high contrast) as the run starts. Left out, off. Its Run default comes back to this.',
                },
                language: {
                    type: 'string',
                    minLength: 1,
                    description: 'The language the page is shown in as the run starts, as a BCP 47 tag (es-ES, de, pt-BR), or a variable such as {var:lang}, so each batch row can set its own. Left out, the browser\'s own. Set language changes it; its Run default comes back to this.',
                },
                acceptUntrustedCerts: {
                    enum: [true, false, 'on', 'off'],
                    description: 'Open sites whose certificate the browser does not trust: a staging server\'s self-signed one, or any site through a network that inspects HTTPS. Left out, off, and such a site fails the run saying why. The browser cannot then tell a site from one pretending to be it, so a run that signs in should not use it on a network you do not trust. A run that uses it says so in its log and in runDiagnostics.untrustedCertsAccepted.',
                },
                metadata: { type: 'object' },
                groupScans: { type: 'boolean' },
                vars: {
                    description: 'Starting variables, read by the steps as {var:name}.',
                    type: 'object',
                    ...(varNamePattern ? { propertyNames: { pattern: varNamePattern, description: 'a name of letters, digits, _ and -, not starting with a digit' } } : {}),
                    additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
                },
            },
            additionalProperties: false,
            $defs,
        };
    }

    const APP_CONFIG_SCHEMA_ID = 'urn:surea11y-lab:app-config:v1';
    const APP_CONFIG_SCHEMA_FILE = 'schemas/app-config.v1.schema.json';

    /**
     * One row of a batch: a run of the workflow with its own name, starting
     * URL and variables. The app's Batch section and a batch spec hold them.
     */
    function batchRowSchema(varNamePattern) {
        return {
            description: 'One run of the workflow: its name, the URL it starts on instead of the workflow\'s, and its starting variables.',
            type: 'object',
            properties: {
                name: { type: 'string' },
                url: { type: 'string', minLength: 1, format: 'uri' },
                vars: {
                    type: 'object',
                    ...(varNamePattern ? { propertyNames: { pattern: varNamePattern, description: 'a name of letters, digits, _ and -, not starting with a digit' } } : {}),
                    additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
                },
            },
            additionalProperties: false,
        };
    }

    /**
     * The app's configuration file (*.a11y-config.json), from the run spec's
     * schema: the workflow in its form state is checked against the same step
     * definitions as the run spec it carries.
     */
    function buildAppConfigSchema(runSpecSchema, { varNamePattern } = {}) {
        const { $schema, $id, $defs, ...runSpecBody } = runSpecSchema;
        return {
            $schema,
            $id: APP_CONFIG_SCHEMA_ID,
            title: 'surea11y-lab app configuration',
            description: 'What the app\'s Save configuration writes and Load configuration reads: the form as the user left it '
                + '("state"), the run spec it comes to ("runSpec"), and the batch rows when there are any. '
                + '`node src/cli/run-workflow.js <config.json>` runs one too. '
                + `Generated from src/workflow/action-definitions.js by \`npm run build:action-docs\`; do not edit ${APP_CONFIG_SCHEMA_FILE} by hand.`,
            type: 'object',
            required: ['version', 'type', 'state'],
            properties: {
                $schema: { type: 'string' },
                version: { const: 1 },
                type: { const: 'a11y-ui-src-config' },
                url: { type: ['string', 'null'], description: 'The page the workflow starts on.' },
                state: {
                    description: 'The form, field by field, by element id: text as text, a checkbox as true or false.',
                    type: 'object',
                    required: ['actions-workflow'],
                    properties: {
                        'url-input': { type: 'string' },
                        'scenario-name': { type: 'string' },
                        'actions-workflow': {
                            description: 'The workflow, as the builder holds it. A secret field\'s value is never saved: the step carries "<field>Masked": true instead.',
                            type: 'array',
                            items: { $ref: '#/$defs/action' },
                        },
                        'custom-steps-json': {
                            type: 'string',
                            description: 'The custom steps, as JSON text: a list like the run spec\'s customSteps.',
                        },
                    },
                    additionalProperties: { type: ['string', 'boolean'] },
                },
                runSpec: { $ref: '#/$defs/runSpec' },
                batch: { $ref: '#/$defs/batch' },
                sections: {
                    description: 'Which sections were collapsed (true) when it was saved.',
                    type: 'object',
                    properties: {
                        batch: { type: 'boolean' },
                        customSteps: { type: 'boolean' },
                        workflow: { type: 'boolean' },
                    },
                    additionalProperties: false,
                },
                metadata: { type: 'object' },
            },
            additionalProperties: false,
            $defs: {
                ...$defs,
                runSpec: { ...runSpecBody, description: runSpecSchema.title + ': ' + runSpecBody.description.split(' Generated from')[0] },
                batch: {
                    description: 'The Batch section: the rows, the run name pattern, and whether it was on.',
                    type: 'object',
                    properties: {
                        rows: { type: 'array', items: { $ref: '#/$defs/batchRow' } },
                        rowsText: { type: 'string', description: 'The rows as typed, kept when they are not a valid list yet.' },
                        namePattern: { type: 'string', description: 'Names each run, e.g. "Product {var:name}".' },
                        enabled: { type: 'boolean' },
                    },
                    additionalProperties: false,
                },
                batchRow: batchRowSchema(varNamePattern),
            },
        };
    }

    const BATCH_SPEC_SCHEMA_ID = 'urn:surea11y-lab:batch-spec:v1';
    const BATCH_SPEC_SCHEMA_FILE = 'schemas/batch-spec.v1.schema.json';

    /**
     * A batch spec: one workflow (a run spec) and the rows that vary it, the
     * same rows the app's Batch section holds.
     */
    function buildBatchSpecSchema(runSpecSchema, { varNamePattern } = {}) {
        const { $schema, $id, $defs, ...runSpecBody } = runSpecSchema;
        return {
            $schema,
            $id: BATCH_SPEC_SCHEMA_ID,
            title: 'surea11y-lab batch spec',
            description: 'One workflow run once per row: each row gives the run its name, the URL it starts on and its variables. '
                + '`node src/cli/run-workflow.js <batch.json>` runs it, as the app\'s Batch section and queue do; add --check to validate it. '
                + `Generated from src/workflow/action-definitions.js by \`npm run build:action-docs\`; do not edit ${BATCH_SPEC_SCHEMA_FILE} by hand.`,
            type: 'object',
            required: ['type', 'specVersion', 'spec', 'rows'],
            properties: {
                $schema: { type: 'string' },
                type: { const: 'a11y-batch-spec' },
                specVersion: { const: 1 },
                name: { type: 'string', description: 'The batch\'s name, and the folder the CLI keeps its batches in. Defaults to the workflow\'s scenarioName.' },
                namePattern: { type: 'string', description: 'Names each run from its row, e.g. "Product {var:name}". Without one, each row needs a name.' },
                spec: { $ref: '#/$defs/runSpec' },
                rows: { type: 'array', minItems: 1, items: { $ref: '#/$defs/batchRow' } },
            },
            additionalProperties: false,
            $defs: {
                ...$defs,
                runSpec: {
                    ...runSpecBody,
                    // A workflow whose every row gives a url needs none of its own.
                    required: runSpecBody.required.filter((name) => name !== 'url'),
                    description: 'The workflow every row runs. Its url is the starting URL of a row that gives none; when every row gives one, it needs none.',
                },
                batchRow: batchRowSchema(varNamePattern),
            },
        };
    }

    const WARNING_KEYWORDS = new Set(['additionalProperties', 'enum']);

    function eachAction(list, path, visit) {
        if (!Array.isArray(list)) return;
        list.forEach((action, i) => {
            const at = `${path}[${i}]`;
            visit(action, at);
            if (!isPlainObject(action)) return;
            for (const [key, value] of Object.entries(action)) {
                if (Array.isArray(value) && value.some((v) => isPlainObject(v) && typeof v.type === 'string')) {
                    eachAction(value, `${at}.${key}`, visit);
                }
            }
        });
    }

    /**
     * Check a spec's steps and custom steps against the schema, plus what a
     * schema cannot say: that each runCustomStep names a custom step the spec
     * has, that custom step ids are unique, that argsJson is a JSON object.
     *
     * The top-level fields are left to normalizeRunSpec, which already reports
     * each of them; checking them here too would say everything twice.
     *
     * source: the spec, with customSteps already an array.
     * -> { errors: [string], warnings: [string] }
     */
    function checkSpecActions(source, { schema, checkAgainstSchema }) {
        const errors = [];
        const warnings = [];
        const sort = (problems) => {
            for (const p of problems) {
                if (p.keyword === 'enum' && /\.type$/.test(p.path)) {
                    // The engine fails a step type it does not have.
                    errors.push(`${p.path} ${JSON.stringify(p.value)} is not a step type that can go here (see ${SCHEMA_FILE} for the list)`);
                    continue;
                }
                const line = `${p.path} ${p.message}`;
                (WARNING_KEYWORDS.has(p.keyword) ? warnings : errors).push(line);
            }
        };

        const spec = isPlainObject(source) ? source : {};

        const actions = Array.isArray(spec.actions) ? spec.actions : [];
        const customSteps = Array.isArray(spec.customSteps) ? spec.customSteps : [];

        // Item by item: an empty or missing list is normalizeRunSpec's to report.
        actions.forEach((action, i) => {
            sort(checkAgainstSchema({ $ref: '#/$defs/action' }, action, { root: schema, path: `$.actions[${i}]` }));
        });
        customSteps.forEach((step, i) => {
            sort(checkAgainstSchema({ $ref: '#/$defs/customStep' }, step, { root: schema, path: `$.customSteps[${i}]` }));
        });

        const ids = new Set();
        customSteps.forEach((step, i) => {
            const id = isPlainObject(step) && typeof step.id === 'string' ? step.id.trim() : '';
            if (!id) return;
            if (ids.has(id)) errors.push(`$.customSteps[${i}].id "${id}" is used by an earlier custom step`);
            ids.add(id);
        });

        const tokenRe = new RegExp(VAR_TOKEN_PATTERN);
        const checkCalls = (action, at) => {
            if (!isPlainObject(action) || action.type !== 'runCustomStep') return;
            const id = typeof action.customStepId === 'string' ? action.customStepId.trim() : '';
            if (id && !tokenRe.test(id) && !ids.has(id)) {
                errors.push(`${at}.customStepId "${id}" names no custom step in this spec${ids.size ? ` (it has ${[...ids].map((x) => `"${x}"`).join(', ')})` : ''}`);
            }
            if (typeof action.argsJson === 'string' && action.argsJson.trim()) {
                let parsed;
                try {
                    parsed = JSON.parse(action.argsJson);
                } catch (e) {
                    errors.push(`${at}.argsJson is not valid JSON: ${e.message}`);
                    return;
                }
                if (!isPlainObject(parsed)) errors.push(`${at}.argsJson must be a JSON object of input: value pairs`);
            }
        };
        eachAction(actions, '$.actions', checkCalls);
        customSteps.forEach((step, i) => {
            if (isPlainObject(step)) eachAction(step.actions, `$.customSteps[${i}].actions`, checkCalls);
        });

        return { errors, warnings };
    }

    /**
     * The note for a spec file without its type and version, which other
     * tools use to recognise it. About the file, not its steps: a run never
     * says it. -> string or null
     */
    function specFileNote(source) {
        const spec = isPlainObject(source) ? source : {};
        return spec.type !== 'a11y-run-spec' || spec.specVersion === undefined
            ? '$ has no "type": "a11y-run-spec" and "specVersion": 1, which other tools use to recognise a spec'
            : null;
    }

    return {
        SCHEMA_ID,
        SCHEMA_FILE,
        VAR_TOKEN_PATTERN,
        APP_CONFIG_SCHEMA_ID,
        APP_CONFIG_SCHEMA_FILE,
        buildRunSpecSchema,
        buildAppConfigSchema,
        BATCH_SPEC_SCHEMA_ID,
        BATCH_SPEC_SCHEMA_FILE,
        buildBatchSpecSchema,
        batchRowSchema,
        checkSpecActions,
        specFileNote,
    };
}));
