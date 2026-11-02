'use strict';

/**
 * The checks a workflow's steps pass before it runs, whether the run starts
 * from the app, the queue or the command line: every step and custom step
 * against the run spec schema (src/shared/run-spec-schema.js), and every
 * scan's engine and profile (scan-step-check.js). `--check` makes the same
 * ones, so a spec it passes is one a run accepts.
 */

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
const { VIEWPORT_PRESETS } = require('../shared/scan-inputs.js');
const runSpec = require('../shared/run-spec.js');
const { buildRunSpecSchema, buildAppConfigSchema, buildBatchSpecSchema, checkSpecActions } = require('../shared/run-spec-schema.js');
const { checkAgainstSchema } = require('../shared/json-schema-check.js');
const { checkScanSteps } = require('./scan-step-check');
const { describeEngine } = require('./a11y-engine');
const { selectorSyntaxProblem } = require('../shared/selector-syntax.js');

/**
 * Every selector field (a field its definition marks cssSelector: a scan's
 * Include and Exclude) whose text no browser could parse, and every navigate
 * step to an address a run may not open, in `list` and the steps it holds.
 * -> ["$.actions[2].context ..."]
 */
function stepFieldProblems(list, path) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((step, i) => {
        if (!step || typeof step !== 'object') return;
        const here = `${path}[${i}]`;
        const fields = (ACTION_DEFINITIONS[step.type] && ACTION_DEFINITIONS[step.type].fields) || {};
        // A navigate step's page: a web address the run may open, as the
        // run's own url (a relative one is read against the page).
        if (step.type === 'navigate' && typeof step.url === 'string' && !step.url.includes('{')) {
            const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(step.url);
            if (scheme && !/^https?$/i.test(scheme[1])) {
                out.push(`${here}.url "${step.url}" is not a web address a run may open: only http and https`);
            }
        }
        for (const [name, def] of Object.entries(fields)) {
            if (!def || !def.cssSelector) continue;
            const values = Array.isArray(step[name]) ? step[name] : [step[name]];
            for (const value of values) {
                const problem = selectorSyntaxProblem(value);
                if (problem) out.push(`${here}.${name} "${value}" is not a CSS selector a browser can read: ${problem}`);
            }
        }
        for (const [key, value] of Object.entries(step)) {
            if (Array.isArray(value) && value.some((v) => v && typeof v === 'object' && !Array.isArray(v))) {
                out.push(...stepFieldProblems(value, `${here}.${key}`));
            }
        }
    });
    return out;
}

// checkScanSteps owns a scan's profile: a value outside the list stops the run,
// so it reports it as an error, and the schema's warning would say it twice.
const OWNED_BY_SCAN_CHECK = /\.profile must be one of /;

let cachedSchema = null;

/** The run spec schema, as `npm run build:action-docs` writes it to schemas/. */
function runSpecSchema() {
    if (!cachedSchema) {
        cachedSchema = buildRunSpecSchema({
            actionDefinitions: ACTION_DEFINITIONS,
            viewportPresets: Object.keys(VIEWPORT_PRESETS),
            varNamePattern: runSpec.VAR_NAME_RE.source,
        });
    }
    return cachedSchema;
}

let cachedAppConfigSchema = null;

/** The app configuration's schema, built on the run spec's. */
function appConfigSchema() {
    if (!cachedAppConfigSchema) {
        cachedAppConfigSchema = buildAppConfigSchema(runSpecSchema(), { varNamePattern: runSpec.VAR_NAME_RE.source });
    }
    return cachedAppConfigSchema;
}

let cachedBatchSpecSchema = null;

/** The batch spec's schema, built on the run spec's. */
function batchSpecSchema() {
    if (!cachedBatchSpecSchema) {
        cachedBatchSpecSchema = buildBatchSpecSchema(runSpecSchema(), { varNamePattern: runSpec.VAR_NAME_RE.source });
    }
    return cachedBatchSpecSchema;
}

function customStepsList(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

const PATH_TOKEN = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g;

function pathTokens(path) {
    const tokens = [];
    let match;
    PATH_TOKEN.lastIndex = 0;
    while ((match = PATH_TOKEN.exec(path)) !== null) {
        tokens.push(match[2] !== undefined ? Number(match[2]) : (match[1] !== undefined ? match[1] : match[3]));
    }
    return tokens;
}

function fieldLabel(type, name) {
    const field = ACTION_DEFINITIONS[type] && ACTION_DEFINITIONS[type].fields && ACTION_DEFINITIONS[type].fields[name];
    return field && field.alias ? field.alias : name;
}

/**
 * "$.actions[2].actions[0].selector" as the builder names it: "Step 3.1 -
 * Click, Element Selector". The step's number and title are the builder's
 * (its own title when it has one), the list it sits in is said when that is
 * not the plain actions (an if's else actions), and the field is its label.
 * -> { where, field } or null for a path that is not a step's.
 */
function describeStepPath(path, { actions, customSteps }) {
    const tokens = pathTokens(path);
    let list;
    let prefix = '';
    if (tokens[0] === 'actions') {
        list = actions;
        tokens.shift();
    } else if (tokens[0] === 'customSteps' && typeof tokens[1] === 'number') {
        const step = customSteps[tokens[1]];
        // Its place as well as its id: two custom steps may share one.
        const id = step && typeof step.id === 'string' && step.id.trim() ? ` "${step.id.trim()}"` : '';
        prefix = `Custom step ${tokens[1] + 1}${id}`;
        tokens.splice(0, 2);
        if (tokens[0] !== 'actions') return { where: prefix, field: typeof tokens[0] === 'string' ? tokens[0] : null };
        list = step && step.actions;
        tokens.shift();
    } else {
        return null;
    }

    const numbers = [];
    let step = null;
    let parent = null;
    let listField = 'actions';
    while (typeof tokens[0] === 'number') {
        const index = tokens.shift();
        numbers.push(index + 1);
        parent = step;
        step = Array.isArray(list) ? list[index] : null;
        // A nested list: the step's next field holding steps.
        if (typeof tokens[0] === 'string' && typeof tokens[1] === 'number' && step && Array.isArray(step[tokens[0]])) {
            listField = tokens.shift();
            list = step[listField];
        } else {
            break;
        }
    }
    if (!numbers.length) return null;

    const type = step && typeof step.type === 'string' ? step.type : null;
    const def = type ? ACTION_DEFINITIONS[type] : null;
    const title = step && typeof step.alias === 'string' && step.alias.trim() ? step.alias.trim() : (def ? def.label || type : null);
    // The list holding the step, when it is not the plain actions.
    const holder = parent && listField !== 'actions' && parent.type ? ` (${fieldLabel(parent.type, listField)})` : '';
    const numbered = `${prefix ? 'step' : 'Step'} ${numbers.join('.')}${title ? ` - ${title}` : ''}${holder}`;
    const fieldName = typeof tokens[0] === 'string' && tokens[0] !== 'type' ? tokens[0] : null;
    return {
        where: prefix ? `${prefix}, ${numbered}` : numbered,
        field: fieldName ? fieldLabel(type, fieldName) : null,
        type,
    };
}

/** A problem as the builder would name its step, for the app's log. */
function inStepWords(problem, context) {
    const match = /^(\$\S*) ([\s\S]*)$/.exec(problem);
    if (!match) return problem;
    const described = describeStepPath(match[1], context);
    if (!described) return problem;
    // "needs "url"" names the field by its label too.
    const message = match[2].replace(/^needs "([^"]+)"$/, (all, name) => `needs ${fieldLabel(described.type, name)}`);
    return `${described.where}${described.field ? `, ${described.field}` : ''}: ${message}`;
}

// How deep steps may sit inside one another. The engine runs a nested step
// by recursion: 300 groups deep overflowed its stack, once per level in the
// log, and a real workflow nests a handful.
const MAX_STEP_DEPTH = 32;

/** How deep the deepest step in `list` sits: 1 for a list of plain steps. */
function stepDepth(list, depth = 1) {
    let deepest = 0;
    for (const step of (Array.isArray(list) ? list : [])) {
        if (!step || typeof step !== 'object') continue;
        deepest = Math.max(deepest, depth);
        // Every list a step holds steps in (actions, elseActions, cases…).
        for (const value of Object.values(step)) {
            if (Array.isArray(value) && value.some((v) => v && typeof v === 'object' && !Array.isArray(v))) {
                deepest = Math.max(deepest, stepDepth(value, depth + 1));
                // Past the limit there is no need to look further.
                if (deepest > MAX_STEP_DEPTH) return deepest;
            }
        }
    }
    return deepest;
}

/**
 * Check a workflow's steps. `wording`: 'paths' names a problem by its path in
 * the spec ("$.actions[1].programmatic"), as a file's author reads it;
 * 'steps' as the builder names the step ("Step 2 - Click, Programmatic
 * click"), as the app shows it.
 * -> { errors: [string], warnings: [string] }
 */
function checkWorkflowSteps({ actions, customSteps, wording = 'paths' } = {}) {
    const doc = {
        type: runSpec.SPEC_TYPE,
        specVersion: runSpec.SPEC_VERSION,
        actions: Array.isArray(actions) ? actions : [],
        customSteps: customStepsList(customSteps),
    };
    const lists = [['The workflow', doc.actions], ...doc.customSteps.map((c, i) => [`Custom step ${i + 1}`, c && c.actions])];
    const tooDeep = lists
        .map(([name, list]) => [name, stepDepth(list)])
        .filter(([, depth]) => depth > MAX_STEP_DEPTH)
        .map(([name]) => `${name} has steps nested more than ${MAX_STEP_DEPTH} levels deep, inside groups, ifs or repeats: at most ${MAX_STEP_DEPTH}`);
    // Checked no further: the steps' own check would go as deep.
    if (tooDeep.length) return { errors: tooDeep, warnings: [] };
    const steps = checkSpecActions(doc, { schema: runSpecSchema(), checkAgainstSchema });
    const errors = steps.errors.slice();
    errors.push(...stepFieldProblems(doc.actions, '$.actions'));
    doc.customSteps.forEach((c, i) => errors.push(...stepFieldProblems(c && c.actions, `$.customSteps[${i}].actions`)));
    const warnings = steps.warnings.filter((w) => !OWNED_BY_SCAN_CHECK.test(w));
    if (wording === 'steps') {
        const context = { actions: doc.actions, customSteps: doc.customSteps };
        errors.splice(0, errors.length, ...errors.map((e) => inStepWords(e, context)));
        warnings.splice(0, warnings.length, ...warnings.map((w) => inStepWords(w, context)));
    }
    try {
        checkScanSteps(doc.actions, doc.customSteps, describeEngine);
    } catch (e) {
        errors.push(...String(e && e.message ? e.message : e).split('\n'));
    }
    return { errors, warnings };
}

module.exports = { runSpecSchema, appConfigSchema, batchSpecSchema, checkWorkflowSteps, MAX_STEP_DEPTH };
