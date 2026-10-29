'use strict';

/**
 * A batch for `run-workflow.js`: one workflow run once per row, as the app's
 * Batch section and queue run it (docs/design/workflow-queue-batch-design.md §4).
 *
 * Two files hold one:
 * - a batch spec (schemas/batch-spec.v1.schema.json):
 *     { "type": "a11y-batch-spec", "specVersion": 1, "name": …, "namePattern": …,
 *       "spec": { …a run spec… }, "rows": [ { "name", "url", "vars" }, … ] }
 * - a configuration saved from the app with its batch on: Run there runs the
 *   batch, so the CLI does too.
 *
 * The rows are read by the same code as the app's (batch-rows.js), so a row
 * the app would refuse, the CLI refuses with the same words.
 */

const runSpec = require('../shared/run-spec.js');
const { resolveBatch, MAX_ROWS } = require('../shared/batch-rows.js');
const { checkAgainstSchema } = require('../shared/json-schema-check.js');
const { batchSpecSchema } = require('../server-side/step-check');
const { checkSpec } = require('./check-spec');

const BATCH_SPEC_TYPE = 'a11y-batch-spec';

// Checked as the spec, or as the rows, below.
const CHECKED_ELSEWHERE = /^\$\.(spec|rows)([.[]|$)/;
const WARNING_KEYWORDS = new Set(['additionalProperties', 'enum']);

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function text(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function isBatchSpec(raw) {
    return isPlainObject(raw) && raw.type === BATCH_SPEC_TYPE;
}

/** A configuration saved with its batch on, and rows in it. */
function isBatchConfig(raw) {
    return runSpec.isUiConfig(raw) && isPlainObject(raw.batch) && raw.batch.enabled === true
        && Array.isArray(raw.batch.rows) && raw.batch.rows.length > 0;
}

/** True when a file holds a batch: a batch spec, or a configuration with its batch on. */
function isBatch(raw) {
    return isBatchSpec(raw) || isBatchConfig(raw);
}

/**
 * -> { name, namePattern, workflow, rows }: `workflow` is what checkSpec
 * takes (the run spec, or the configuration itself).
 */
function batchParts(raw) {
    if (isBatchSpec(raw)) {
        return {
            name: text(raw.name) || text(raw.spec && raw.spec.scenarioName),
            namePattern: text(raw.namePattern),
            workflow: raw.spec,
            rows: raw.rows,
        };
    }
    const state = isPlainObject(raw.state) ? raw.state : {};
    return {
        name: text(state['scenario-name']) || text(raw.runSpec && raw.runSpec.scenarioName),
        namePattern: text(raw.batch.namePattern),
        workflow: raw,
        rows: raw.batch.rows,
    };
}

/** A batch spec's own fields, against its schema; the spec and rows are checked on their own. */
function checkOwnFields(raw) {
    const errors = [];
    const warnings = [];
    for (const p of checkAgainstSchema(batchSpecSchema(), raw)) {
        if (CHECKED_ELSEWHERE.test(p.path)) continue;
        (WARNING_KEYWORDS.has(p.keyword) ? warnings : errors).push(`${p.path} ${p.message}`);
    }
    return { errors, warnings };
}

/**
 * Everything that can be said about a batch without opening a browser: its
 * own fields, its workflow (as --check says it of a spec) and its rows (as
 * the app's Batch section says it). -> { ok, errors, warnings, batch } where
 * batch is { name, runs: [{ row, name, url, vars, spec }] }, or null when
 * there are errors.
 */
function checkBatch(raw, { validateUrl = null, env = process.env } = {}) {
    const errors = [];
    const warnings = [];
    if (isBatchSpec(raw)) {
        const own = checkOwnFields(raw);
        errors.push(...own.errors);
        warnings.push(...own.warnings);
    }

    const parts = batchParts(raw);
    const rows = Array.isArray(parts.rows) ? parts.rows : [];
    if (!rows.length) errors.push('The batch has no rows.');
    if (rows.length > MAX_ROWS) errors.push(`A batch holds at most ${MAX_ROWS} rows; this one has ${rows.length}.`);

    // A workflow every row gives a url to needs none of its own: check it
    // with the first row's.
    let workflow = parts.workflow;
    if (isPlainObject(workflow) && runSpec.isRunSpec(workflow) && !text(workflow.url)) {
        const firstUrl = rows.length && isPlainObject(rows[0]) ? text(rows[0].url) : '';
        if (firstUrl) workflow = { ...workflow, url: firstUrl };
    }
    const spec = isPlainObject(workflow)
        ? checkSpec(workflow, { validateUrl, env })
        : { ok: false, errors: ['"spec" must be a run spec'], warnings: [], spec: null };
    const where = isBatchSpec(raw) ? 'spec: ' : '';
    errors.push(...spec.errors.map((e) => where + e));
    warnings.push(...spec.warnings.map((w) => where + w));

    let runs = [];
    if (rows.length && rows.length <= MAX_ROWS) {
        // The rows are checked whatever the workflow's problems: both lists
        // need fixing, and saying one at a time costs a round each.
        // The workflow's own variables are every row's, under the row's own.
        const shared = spec.ok && isPlainObject(spec.spec.vars) ? spec.spec.vars : null;
        const resolved = resolveBatch({
            rows: shared
                ? rows.map((row) => (isPlainObject(row) ? { ...row, vars: { ...shared, ...(isPlainObject(row.vars) ? row.vars : {}) } } : row))
                : rows,
            namePattern: parts.namePattern,
            workflowUrl: spec.ok ? spec.spec.url : text(isPlainObject(workflow) && workflow.url),
            workflow: spec.ok ? spec.spec : null,
            ...(validateUrl ? { validateUrl } : {}),
        });
        errors.push(...resolved.errors);
        warnings.push(...resolved.warnings);
        if (spec.ok) runs = resolved.runs.map((r) => {
            const one = { ...spec.spec, url: r.url, scenarioName: r.name };
            if (Object.keys(r.vars).length) one.vars = r.vars;
            else delete one.vars;
            const own = isPlainObject(rows[r.row - 1].vars) ? rows[r.row - 1].vars : {};
            return { row: r.row, name: r.name, url: r.url, vars: own, spec: one };
        });
    }

    const ok = errors.length === 0;
    return {
        ok,
        errors,
        warnings,
        batch: ok ? { name: parts.name || 'batch', runs } : null,
    };
}

module.exports = {
    BATCH_SPEC_TYPE,
    isBatchSpec,
    isBatchConfig,
    isBatch,
    checkBatch,
};
