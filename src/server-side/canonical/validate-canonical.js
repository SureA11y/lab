'use strict';

/**
 * Canonical model validator (strict mode)
 *
 * Goals:
 * - Catch adapter bugs early, without coupling runner/server/UI to any engine.
 * - Keep validation optional, enabled via A11Y_VALIDATE_CANONICAL=true|1|yes|on
 *
 * Strict mode:
 * - Required: canonical object, canonical.findings array
 * - For each finding: (uid OR id) is required, outcome is required
 * - Optional fields are allowed, but if present must have the right type/value
 */

const ALLOWED_OUTCOMES = new Set(['fail', 'cantTell', 'pass', 'notApplicable']);
// Includes 'info', since canonical-shared.js's normalizeSeverity() can emit it
// for an impact of "info"/"informational", which older reports may hold.
const ALLOWED_SEVERITIES = new Set(['critical', 'serious', 'moderate', 'minor', 'info', 'unknown']);

function isObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isNonEmptyString(x) {
    return typeof x === 'string' && x.trim().length > 0;
}

function pushErr(errors, path, message) {
    errors.push({ path, message });
}

function validateOccurrence(occ, i, errors, basePath) {
    const p = `${basePath}.occurrences[${i}]`;

    if (!isObject(occ)) {
        pushErr(errors, p, 'Occurrence must be an object.');
        return;
    }

    if ('pageUrl' in occ && occ.pageUrl !== null && typeof occ.pageUrl !== 'string') {
        pushErr(errors, `${p}.pageUrl`, 'pageUrl must be a string (or omitted/null).');
    }

    if ('target' in occ && occ.target !== null) {
        if (!Array.isArray(occ.target)) {
            pushErr(errors, `${p}.target`, 'target must be an array of strings (or omitted/null).');
        } else {
            for (let j = 0; j < occ.target.length; j++) {
                if (typeof occ.target[j] !== 'string') {
                    pushErr(errors, `${p}.target[${j}]`, 'target items must be strings.');
                }
            }
        }
    }

    if ('html' in occ && occ.html !== null && typeof occ.html !== 'string') {
        pushErr(errors, `${p}.html`, 'html must be a string (or omitted/null).');
    }

    if ('failureSummary' in occ && occ.failureSummary !== null && typeof occ.failureSummary !== 'string') {
        pushErr(errors, `${p}.failureSummary`, 'failureSummary must be a string (or omitted/null).');
    }

    if ('hint' in occ && occ.hint !== null && typeof occ.hint !== 'string') {
        pushErr(errors, `${p}.hint`, 'hint must be a string (or omitted/null).');
    }

    if ('uncertainty' in occ && occ.uncertainty !== null) {
        if (!isObject(occ.uncertainty)) {
            pushErr(errors, `${p}.uncertainty`, 'uncertainty must be an object (or omitted/null).');
        } else {
            if (!isNonEmptyString(occ.uncertainty.code)) {
                pushErr(errors, `${p}.uncertainty.code`, 'uncertainty.code must be a non-empty string.');
            }
            if ('needed' in occ.uncertainty && typeof occ.uncertainty.needed !== 'string') {
                pushErr(errors, `${p}.uncertainty.needed`, 'uncertainty.needed must be a string when provided.');
            }
        }
    }

    if ('lean' in occ && occ.lean !== null) {
        if (!isObject(occ.lean)) {
            pushErr(errors, `${p}.lean`, 'lean must be an object (or omitted/null).');
        } else if (occ.lean.toward !== 'fail' && occ.lean.toward !== 'pass') {
            pushErr(errors, `${p}.lean.toward`, 'lean.toward must be "fail" or "pass".');
        }
    }

    if ('howToCheck' in occ && occ.howToCheck !== null) {
        if (!isObject(occ.howToCheck)) {
            pushErr(errors, `${p}.howToCheck`, 'howToCheck must be an object (or omitted/null).');
        } else if (!Array.isArray(occ.howToCheck.steps) || occ.howToCheck.steps.some((s) => typeof s !== 'string')) {
            pushErr(errors, `${p}.howToCheck.steps`, 'howToCheck.steps must be an array of strings.');
        }
    }

    if ('evidence' in occ && occ.evidence !== null && !isObject(occ.evidence)) {
        pushErr(errors, `${p}.evidence`, 'evidence must be an object (or omitted/null).');
    }
}

function validateFinding(f, i, errors) {
    const p = `canonical.findings[${i}]`;

    if (!isObject(f)) {
        pushErr(errors, p, 'Finding must be an object.');
        return;
    }

    const hasUid = isNonEmptyString(f.uid);
    const hasId = isNonEmptyString(f.id);
    if (!hasUid && !hasId) {
        pushErr(errors, p, 'Finding must include a non-empty "uid" or "id".');
    }

    if (!isNonEmptyString(f.outcome) || !ALLOWED_OUTCOMES.has(f.outcome)) {
        pushErr(errors, `${p}.outcome`, `outcome must be one of: ${Array.from(ALLOWED_OUTCOMES).join(', ')}`);
    }

    if ('severity' in f) {
        if (!isNonEmptyString(f.severity)) {
            pushErr(errors, `${p}.severity`, 'severity must be a non-empty string when provided.');
        } else {
            const sev = String(f.severity).trim();
            if (!ALLOWED_SEVERITIES.has(sev)) {
                pushErr(errors, `${p}.severity`, `severity must be one of: ${Array.from(ALLOWED_SEVERITIES).join(', ')}`);
            }
        }
    }

    if ('wcag' in f && f.wcag !== null) {
        if (!isObject(f.wcag)) {
            pushErr(errors, `${p}.wcag`, 'wcag must be an object when provided.');
        } else {
            for (const key of ['sc', 'scNormative']) {
                if (!(key in f.wcag) || f.wcag[key] === null) continue;

                if (!Array.isArray(f.wcag[key])) {
                    pushErr(errors, `${p}.wcag.${key}`, `wcag.${key} must be an array of strings when provided.`);
                    continue;
                }

                for (let j = 0; j < f.wcag[key].length; j++) {
                    if (typeof f.wcag[key][j] !== 'string') {
                        pushErr(errors, `${p}.wcag.${key}[${j}]`, `wcag.${key} items must be strings.`);
                    }
                }
            }
        }
    }

    if ('tags' in f && f.tags !== null) {
        if (!Array.isArray(f.tags)) {
            pushErr(errors, `${p}.tags`, 'tags must be an array of strings when provided.');
        } else {
            for (let j = 0; j < f.tags.length; j++) {
                if (typeof f.tags[j] !== 'string') {
                    pushErr(errors, `${p}.tags[${j}]`, 'tags items must be strings.');
                }
            }
        }
    }

    if ('occurrences' in f && f.occurrences !== null) {
        if (!Array.isArray(f.occurrences)) {
            pushErr(errors, `${p}.occurrences`, 'occurrences must be an array when provided.');
        } else {
            for (let j = 0; j < f.occurrences.length; j++) {
                validateOccurrence(f.occurrences[j], j, errors, p);
            }
        }
    }
}

function validateCanonical(canonical) {
    const errors = [];

    if (!isObject(canonical)) {
        pushErr(errors, 'canonical', 'Canonical result must be an object.');
        return { ok: false, errors };
    }

    if (!('findings' in canonical)) {
        pushErr(errors, 'canonical.findings', 'canonical.findings is required.');
        return { ok: false, errors };
    }

    if (!Array.isArray(canonical.findings)) {
        pushErr(errors, 'canonical.findings', 'canonical.findings must be an array.');
        return { ok: false, errors };
    }

    for (let i = 0; i < canonical.findings.length; i++) {
        validateFinding(canonical.findings[i], i, errors);
    }

    return { ok: errors.length === 0, errors };
}

function formatErrors(errors, limit = 20) {
    const list = Array.isArray(errors) ? errors : [];
    const head = list.slice(0, Math.max(1, limit));
    const lines = head.map((e) => `- ${e.path}: ${e.message}`);
    const more = list.length > head.length ? `\n...and ${list.length - head.length} more.` : '';
    return lines.join('\n') + more;
}

function validateCanonicalOrThrow(canonical, meta = {}) {
    const res = validateCanonical(canonical);
    if (res.ok) return true;

    const bits = [];
    if (meta && meta.engineId) bits.push(`engine=${meta.engineId}`);
    if (meta && meta.engineVersion) bits.push(`version=${meta.engineVersion}`);
    const prefix = bits.length ? `[canonical validation failed, ${bits.join(', ')}]` : '[canonical validation failed]';

    const msg = `${prefix}\n${formatErrors(res.errors)}`;
    const err = new Error(msg);
    err.name = 'CanonicalValidationError';
    err.details = res.errors;
    throw err;
}

module.exports = {
    validateCanonical,
    validateCanonicalOrThrow
};
