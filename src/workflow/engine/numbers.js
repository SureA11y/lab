'use strict';

/**
 * Number fields that accept variables.
 *
 * Variables are stored as whatever the step that set them produced: getText and
 * setVar store text, getCount stores a number. A number field (repeat's
 * `repetitions`, `timeout`, `ms`, ...) can hold either a literal number or a
 * token such as "{var:count}". By the time the engine dispatches the action the
 * token has already been interpolated into a string ("5", "", "3 items"), so the
 * text is turned into a number here, at the point of use.
 *
 * Parsing is strict on purpose: the whole trimmed text must be a number. Text
 * like "3 items" or "1,234" is rejected instead of guessed at, because a guess
 * would hide a selector or variable mistake behind a plausible-looking count.
 */

const NUMBER_TEXT_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const VAR_TOKEN_RE = /\{\s*var\s*:|\{\s*(?:index|oneBased|total)\s*\}/i;

/**
 * @param {any} value  a number, or text holding one
 * @param {{integer?: boolean}} [opts]
 * @returns {{ok: true, value: number} | {ok: false, reason: 'empty'|'not-a-number'|'not-whole'}}
 */
function parseNumberStrict(value, {integer = false} = {}) {
    let n;
    if (typeof value === 'number') {
        n = value;
    } else if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return {ok: false, reason: 'empty'};
        if (!NUMBER_TEXT_RE.test(text)) return {ok: false, reason: 'not-a-number'};
        n = Number(text);
    } else {
        return {ok: false, reason: value == null ? 'empty' : 'not-a-number'};
    }
    if (!Number.isFinite(n)) return {ok: false, reason: 'not-a-number'};
    if (integer && !Number.isInteger(n)) return {ok: false, reason: 'not-whole'};
    return {ok: true, value: n};
}

/** True when a raw (not yet interpolated) value carries a {var:...} or {index}-style token. */
function hasVarToken(value) {
    return typeof value === 'string' && VAR_TOKEN_RE.test(value);
}

const REASON_TEXT = {
    'empty': 'is empty',
    'not-a-number': 'is not a number',
    'not-whole': 'is not a whole number'
};

const SINGLE_VAR_RE = /^\s*\{\s*var\s*:\s*([a-zA-Z0-9_.-]+)\s*\}\s*$/;

/**
 * Where a value came from, for a warning. Log messages are themselves run
 * through {var:...} interpolation, so the raw token is never quoted verbatim:
 * the variable is named instead.
 */
function describeSource(rawValue, value) {
    const m = typeof rawValue === 'string' ? SINGLE_VAR_RE.exec(rawValue) : null;
    if (m) return `variable "${m[1]}" has the value "${value}", which`;
    if (hasVarToken(rawValue)) return `the value resolved to "${value}", which`;
    return `"${value}"`;
}

/**
 * Turns the text values of an action's number fields into numbers.
 *
 * Only fields declared `type: "number"` in the action definition are touched,
 * and only when their value is a string: literal numbers pass through as they
 * always have. A value that cannot be read as a number is removed, so the step
 * falls back to the same behavior it has when the field is left empty (its
 * default, or no iterations for `repetitions`). A value below the field's `min`
 * or above its `max` is kept, since the step already has a rule for it, but is
 * still reported.
 *
 * @param {object} resolved   the interpolated action (mutated in place)
 * @param {object} raw        the action as authored, used to name the token in warnings
 * @param {object} fieldDefs  ACTION_DEFINITIONS[type].fields
 * @returns {Array<{field: string, raw: any, resolved: any, message: string}>} warnings
 */
function coerceNumberFields(resolved, raw, fieldDefs) {
    const warnings = [];
    if (!resolved || typeof resolved !== 'object' || !fieldDefs || typeof fieldDefs !== 'object') return warnings;

    for (const [field, def] of Object.entries(fieldDefs)) {
        if (!def || def.type !== 'number') continue;
        if (!Object.prototype.hasOwnProperty.call(resolved, field)) continue;
        const value = resolved[field];
        if (typeof value !== 'string') continue;

        const rawValue = raw && typeof raw === 'object' ? raw[field] : undefined;
        const source = describeSource(rawValue, value);

        const parsed = parseNumberStrict(value, {integer: def.integer === true});
        if (!parsed.ok) {
            delete resolved[field];
            warnings.push({
                field,
                raw: rawValue,
                resolved: value,
                message: `"${field}": ${source} ${REASON_TEXT[parsed.reason]}`
                    + `${parsed.reason === 'empty' && hasVarToken(rawValue) ? ' (is the variable set?)' : ''}; the value was ignored.`
            });
            continue;
        }

        resolved[field] = parsed.value;
        if (typeof def.min === 'number' && parsed.value < def.min) {
            warnings.push({
                field,
                raw: rawValue,
                resolved: value,
                message: `"${field}": ${source} is below the minimum of ${def.min}.`
            });
        }
        if (typeof def.max === 'number' && parsed.value > def.max) {
            warnings.push({
                field,
                raw: rawValue,
                resolved: value,
                message: `"${field}": ${source} is above the maximum of ${def.max}.`
            });
        }
    }
    return warnings;
}

module.exports = {
    parseNumberStrict,
    hasVarToken,
    coerceNumberFields
};
