'use strict';

/**
 * `run-workflow.js --check`: everything that can be said about a spec without
 * opening a browser. normalizeRunSpec reports the top-level fields, and
 * checkWorkflowSteps the steps, custom steps and scans: both are what a run
 * checks before it starts.
 */

const runSpec = require('../shared/run-spec.js');
const { specFileNote } = require('../shared/run-spec-schema.js');
const { normalizeRunSpec } = require('./run-spec');
const { checkAgainstSchema } = require('../shared/json-schema-check.js');
const { resolveSecretRefs, describeMissing } = require('../shared/secret-refs.js');
const { runSpecSchema, appConfigSchema, checkWorkflowSteps } = require('../server-side/step-check');

// Checked as the spec, below: the config's own check leaves them out.
const CHECKED_AS_SPEC = /^\$\.(runSpec|state\["actions-workflow"\])([.[]|$)/;
// The app loads a config with a field it does not know, or a value outside a
// list, and ignores it: worth saying, not worth stopping for. Batch rows are
// the exception: the app will not queue a batch with a row it cannot read.
const CONFIG_WARNINGS = new Set(['additionalProperties', 'enum']);
const BATCH_ROW = /^\$\.batch\.rows\[/;

/**
 * A saved app configuration's own fields (its form state, batch rows and
 * sections), against schemas/app-config.v1.schema.json. -> { errors, warnings }
 */
function checkConfigFields(raw) {
    const errors = [];
    const warnings = [];
    for (const p of checkAgainstSchema(appConfigSchema(), raw)) {
        if (CHECKED_AS_SPEC.test(p.path)) continue;
        const warning = CONFIG_WARNINGS.has(p.keyword) && !BATCH_ROW.test(p.path);
        (warning ? warnings : errors).push(`${p.path} ${p.message}`);
    }
    return { errors, warnings };
}

/** The spec a file holds: itself, the one a saved config embeds, or one read from the config's form state. */
function specDocumentOf(raw) {
    let doc = raw;
    if (runSpec.isUiConfig(raw)) {
        doc = runSpec.isRunSpec(raw.runSpec) ? raw.runSpec : runSpec.runSpecFromUiConfig(raw);
    }
    if (doc && typeof doc.customSteps === 'string') {
        // Form state keeps them as JSON text; normalizeRunSpec reports it if it does not parse.
        try {
            doc = { ...doc, customSteps: JSON.parse(doc.customSteps) };
        } catch {
            doc = { ...doc, customSteps: [] };
        }
    }
    return doc;
}

/**
 * -> { ok, errors, warnings, spec }. `spec` is the normalized spec, or null
 * when there are errors.
 */
function checkSpec(raw, { validateUrl = null, env = process.env } = {}) {
    const normalized = normalizeRunSpec(raw, { validateUrl });
    const errors = normalized.errors.slice();
    const warnings = normalized.warnings.slice();

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const doc = specDocumentOf(raw);
        const note = specFileNote(doc);
        if (note) warnings.push(note);
        // The same check every run makes before it starts.
        const steps = checkWorkflowSteps({
            actions: doc && doc.actions,
            customSteps: doc && doc.customSteps,
        });
        errors.push(...steps.errors);
        warnings.push(...steps.warnings);
        // Read where it runs, which need not be here: said, not refused.
        // A run passes env: null, and refuses instead (run-workflow.js).
        const unset = doc && env ? resolveSecretRefs({ actions: doc.actions, customSteps: doc.customSteps }, env).missing : [];
        if (unset.length) warnings.push(`${describeMissing(unset)} here; a run needs ${unset.length === 1 ? 'it' : 'them'}`);
        if (runSpec.isUiConfig(raw)) {
            const own = checkConfigFields(raw);
            errors.push(...own.errors);
            warnings.push(...own.warnings);
        }
    }

    return { ok: errors.length === 0, errors, warnings, spec: errors.length ? null : normalized.spec };
}

module.exports = {
    runSpecSchema,
    appConfigSchema,
    checkConfigFields,
    specDocumentOf,
    checkSpec,
};
