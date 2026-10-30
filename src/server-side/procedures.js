'use strict';

// How a person assesses a criterion by hand: core's test procedures
// (proceduresFor, its docs/PROCEDURES.md), for the app to show beside each
// criterion. A core without them answers { available: false }, and the app
// shows what it showed before.

const MAX_IDS = 120;
const CRITERION = /^\d{1,2}\.\d{1,2}\.\d{1,2}$/;
const LOCALE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;

function defaultCore() {
    try {
        return require('@surea11y/core');
    } catch {
        return null;
    }
}

/**
 * { available, locale, procedures: { [criterion]: procedure | null } } for
 * the WCAG criteria in `ids` (a list, or a comma-separated string), in
 * `locale` (English where it lacks a text). Ids that are not criteria are
 * left out.
 */
function proceduresForCriteria(ids, { locale = 'en', core = defaultCore() } = {}) {
    if (!core || typeof core.proceduresFor !== 'function') return { available: false };
    const list = (Array.isArray(ids) ? ids : String(ids || '').split(','))
        .map((id) => String(id).trim())
        .filter((id) => CRITERION.test(id));
    const wanted = [...new Set(list)].slice(0, MAX_IDS);
    const tag = LOCALE.test(String(locale || '')) ? String(locale).toLowerCase() : 'en';
    const procedures = {};
    for (const id of wanted) {
        try {
            procedures[id] = core.proceduresFor(id, { locale: tag }) || null;
        } catch {
            procedures[id] = null;
        }
    }
    return { available: true, locale: tag, procedures };
}

module.exports = { proceduresForCriteria, MAX_IDS };
