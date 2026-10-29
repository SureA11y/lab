'use strict';

/**
 * The choice behind the switch step: read one subject (a URL part or a
 * variable), then find the first case whose comparison holds for it. Running
 * the chosen branch is the engine's (runBranch in workflow-engine.js), so the
 * branch gets the same variable scope as an if's.
 *
 * See docs/design/switch-step-design.md.
 */

const {
    readUrlPart,
    normalizeExpected,
    validateComparison,
    validateUrlPart,
    compareText
} = require('./url-condition');
const {isDisabled, isNonEmptyString} = require('./utils');

const SWITCH_SUBJECTS = Object.freeze(['url', 'var']);

/**
 * A variable's value the way {var:name} finds it: the caller's local variables
 * first, then the variable scopes. Undefined when neither has it.
 */
function lookupVar(name, {localVars = null, ctx = null} = {}) {
    if (localVars && Object.prototype.hasOwnProperty.call(localVars, name)) return localVars[name];
    if (ctx && ctx.vars && Object.prototype.hasOwnProperty.call(ctx.vars, name)) return ctx.vars[name];
    return undefined;
}

/**
 * Reads the switch's subject. Throws on a switch that can't be evaluated, so a
 * typo fails the step instead of silently running the default.
 *
 * @returns {{actual: ?string, describe: string, normalize: function, decode: boolean}}
 *          `actual` is null when the subject isn't there (a missing query
 *          parameter, an unset variable).
 */
function readSwitchSubject(action, {href = '', localVars = null, ctx = null} = {}) {
    // Like the comparison, the subject has a default: a part of the URL.
    const subject = (action && action.subject) || 'url';
    if (!SWITCH_SUBJECTS.includes(subject)) {
        throw new Error(`switch: subject must be one of ${SWITCH_SUBJECTS.join(', ')} (got ${JSON.stringify(subject)})`);
    }

    if (subject === 'url') {
        const part = validateUrlPart(action, 'switch');
        const paramName = isNonEmptyString(action.paramName) ? action.paramName.trim() : '';
        return {
            actual: readUrlPart(href, part, paramName),
            describe: part === 'param' ? `URL param "${paramName}"` : `URL ${part}`,
            normalize: (value) => normalizeExpected(part, value),
            decode: true
        };
    }

    const name = isNonEmptyString(action.var) ? action.var.trim() : '';
    if (!name) throw new Error('switch: var is required when subject is "var"');
    const value = lookupVar(name, {localVars, ctx});
    return {
        actual: (value === undefined || value === null) ? null : String(value),
        describe: `variable "${name}"`,
        normalize: (v) => ((v === undefined || v === null) ? '' : String(v).trim()),
        decode: false
    };
}

/**
 * The first enabled case that matches, as {index, kase} with a 1-based index
 * (its position in `cases`, disabled cases included), or null for the default.
 * Every case's comparison is checked up front, so a typo in a later case fails
 * the step even when an earlier case matches.
 */
function pickSwitchCase(action, subject) {
    const cases = Array.isArray(action && action.cases) ? action.cases : [];
    const live = [];
    cases.forEach((kase, i) => {
        if (!kase || typeof kase !== 'object' || isDisabled(kase)) return;
        if (kase.type !== 'case') {
            throw new Error(`switch: case ${i + 1} is a "${kase.type}" step; the cases list only holds case steps`);
        }
        live.push({index: i + 1, kase, comparison: validateComparison(kase.comparison, 'switch')});
    });

    for (const {index, kase, comparison} of live) {
        const expected = subject.normalize(kase.value);
        if (compareText(subject.actual, comparison, expected, {decode: subject.decode})) return {index, kase};
    }
    return null;
}

module.exports = {
    SWITCH_SUBJECTS,
    lookupVar,
    readSwitchSubject,
    pickSwitchCase
};
