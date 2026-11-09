'use strict';

/**
 * What /workflow-start and the queue check of a run before taking it, so that
 * a run that cannot work is refused (400) with every reason, instead of being
 * accepted and failing a moment later: the same check as `run-workflow.js
 * --check` (check-spec.js: the run's fields, every step against the run spec
 * schema, every scan's engine, profile and selectors), and every secret the
 * steps read from the server's environment, which a run here needs set.
 */

const { checkSpec } = require('../cli/check-spec');
const { resolveSecretRefs, describeMissing } = require('../shared/secret-refs.js');
const { problemsInStepWords } = require('./step-check');

// Fields of the request that are not the run's: said nothing about.
const REQUEST_ONLY = ['dryRun'];

/**
 * -> { ok, errors, warnings }. `body` is the request: a run spec's fields,
 * with type and specVersion optional, and dryRun.
 */
function checkRunRequest(body, { validateUrl = null, env = process.env } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, errors: ['The request must be a JSON object: a run spec\'s fields'], warnings: [] };
    }
    // type and specVersion may be left out of a request (http-api.md): the
    // request is a run spec's fields, so it is read as one.
    const spec = { type: 'a11y-run-spec', specVersion: 1, ...body };
    for (const key of REQUEST_ONLY) delete spec[key];
    const checked = checkSpec(spec, { validateUrl, env: null });
    const errors = checked.errors.slice();
    if (env) {
        const missing = resolveSecretRefs({ actions: spec.actions, customSteps: spec.customSteps }, env).missing;
        if (missing.length) errors.push(`${describeMissing(missing)} of the server`);
    }
    return { ok: errors.length === 0, errors, warnings: checked.warnings };
}

/**
 * The 400 body for a refused run: { error, details, problems }, plus
 * `steps` when the request's steps are given: the same problems as the
 * builder names the steps ("Step 3.1 - ..."), which the app shows.
 */
function refusal(errors, request = null) {
    const body = {
        error: 'The workflow cannot run',
        details: errors.length === 1 ? errors[0] : `${errors.length} problems: ${errors.join('; ')}`,
        problems: errors,
    };
    if (request && typeof request === 'object') {
        body.steps = problemsInStepWords(errors, { actions: request.actions, customSteps: request.customSteps });
    }
    return body;
}

module.exports = { checkRunRequest, refusal };
