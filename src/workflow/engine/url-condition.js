'use strict';

/**
 * The comparison behind the ifUrl step: pick one part of the page URL and
 * compare it with a value.
 *
 * Parts are read the way a person writes them, not the way URL serializes
 * them: the query string and the fragment come without their leading "?" and
 * "#" (and a leading "?" or "#" typed into the value is ignored), and a port
 * left out of the URL is the protocol's default one, so https://example.com/
 * is on port 443. A part is compared both as it appears in the URL and
 * percent-decoded, so "/búsqueda" matches /b%C3%BAsqueda.
 */

const URL_PARTS = Object.freeze(['host', 'port', 'path', 'query', 'param', 'hash']);
const URL_COMPARISONS = Object.freeze(['equals', 'notEquals', 'contains', 'notContains']);

const DEFAULT_PORTS = Object.freeze({'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21'});

function parseUrl(href) {
    try {
        return new URL(String(href || ''));
    } catch {
        return null;
    }
}

function decodeSafe(text) {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/**
 * The part of `href` that `part` names, as text, or null when it isn't there:
 * a query parameter the URL doesn't carry, or a URL that can't be read.
 */
function readUrlPart(href, part, paramName) {
    const url = parseUrl(href);
    if (!url) return null;
    switch (part) {
        case 'host': return url.hostname;
        case 'port': return url.port || DEFAULT_PORTS[url.protocol] || '';
        case 'path': return url.pathname;
        case 'query': return url.search.replace(/^\?/, '');
        case 'param': return url.searchParams.get(String(paramName || '').trim());
        case 'hash': return url.hash.replace(/^#/, '');
        default: return null;
    }
}

/** The expected value of a comparison, as text the URL part is compared with. */
function normalizeExpected(part, value) {
    let text = (value === undefined || value === null) ? '' : String(value).trim();
    if (part === 'query') text = text.replace(/^\?/, '');
    if (part === 'hash') text = text.replace(/^#/, '');
    if (part === 'host') text = text.toLowerCase();
    return text;
}

function validateComparison(comparison, stepType = 'ifUrl') {
    const value = comparison || 'equals';
    if (!URL_COMPARISONS.includes(value)) {
        throw new Error(`${stepType}: comparison must be one of ${URL_COMPARISONS.join(', ')} (got ${JSON.stringify(comparison)})`);
    }
    return value;
}

function validateUrlPart(action, stepType = 'ifUrl') {
    const part = action && action.urlPart;
    if (!URL_PARTS.includes(part)) {
        throw new Error(`${stepType}: urlPart must be one of ${URL_PARTS.join(', ')} (got ${JSON.stringify(part)})`);
    }
    if (part === 'param' && !(typeof action.paramName === 'string' && action.paramName.trim())) {
        throw new Error(`${stepType}: paramName is required when urlPart is "param"`);
    }
    return part;
}

/**
 * Throws on a step that can't be evaluated (an unknown part or comparison, or
 * "param" without a parameter name), so a typo fails the step instead of
 * silently taking the else branch.
 */
function validateUrlCondition(action) {
    const part = validateUrlPart(action);
    const comparison = validateComparison(action && action.comparison);
    return {part, comparison};
}

/**
 * Compares `actual` (null when the subject isn't there) with `expected`.
 * `decode` also tries the percent-decoded text, for URL parts. A subject that
 * isn't there equals nothing and contains nothing, so the negated comparisons
 * are true for it.
 */
function compareText(actual, comparison, expected, {decode = false} = {}) {
    let matched = false;
    if (actual !== null && actual !== undefined) {
        const text = String(actual);
        const candidates = decode ? [...new Set([text, decodeSafe(text)])] : [text];
        matched = (comparison === 'equals' || comparison === 'notEquals')
            ? candidates.some((c) => c === expected)
            : candidates.some((c) => c.includes(expected));
    }
    return (comparison === 'notEquals' || comparison === 'notContains') ? !matched : matched;
}

/**
 * Evaluates an ifUrl step against `href`. `value` is the expected text, already
 * expanded by the caller. Returns the outcome and the part that was read, for
 * the log.
 */
function evaluateUrlCondition(href, action, value) {
    const {part, comparison} = validateUrlCondition(action);
    const actual = readUrlPart(href, part, action.paramName);
    const expected = normalizeExpected(part, value);
    const result = compareText(actual, comparison, expected, {decode: true});
    return {result, actual, expected, part, comparison};
}

module.exports = {
    URL_PARTS,
    URL_COMPARISONS,
    readUrlPart,
    normalizeExpected,
    validateComparison,
    validateUrlPart,
    validateUrlCondition,
    compareText,
    evaluateUrlCondition
};
