'use strict';

// How a person assesses a requirement by hand: core's test procedures
// (proceduresFor, its docs/PROCEDURES.md), for the app to show beside each
// WCAG criterion, and, read with the EN 301 549 pack, beside each of that
// standard's own requirements (chapter 4, chapter 12 and the other chapters,
// by number). A core without them answers { available: false }, and the app
// shows what it showed before.

const MAX_IDS = 120;
// A WCAG criterion (1.4.13), a clause (4.2.1, 12.1) or a chapter (5).
const REQUIREMENT = /^\d{1,2}(\.\d{1,2}){0,3}$/;
const LOCALE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;
const EN_VERSION = /^V\d{1,2}\.\d{1,2}\.\d{1,2}$/;

function load(name) {
    try {
        return require(name);
    } catch {
        return null;
    }
}

/**
 * { available, locale, procedures: { [id]: procedure | null } } for `ids` (a
 * list, or a comma-separated string), in `locale` (English where it lacks a
 * text): WCAG criteria, or with `standard: 'en301549'` and its `version`,
 * that standard's requirements, read with its pack. Ids that are no
 * requirement's are left out. A standard other than these two, or EN 301 549
 * without its pack, has none: { available: false }.
 */
function proceduresForRequirements(ids, {
    locale = 'en', standard = 'wcag', version = '', core = load('@surea11y/core'), en301549 = load('@surea11y/pack-en301549'),
} = {}) {
    if (!core || typeof core.proceduresFor !== 'function') return { available: false };
    const std = String(standard || 'wcag');
    let options = {};
    if (std === 'en301549') {
        if (!en301549) return { available: false };
        options = { packs: [en301549], standard: 'en301549', ...(EN_VERSION.test(String(version || '')) ? { version: String(version) } : {}) };
    } else if (std !== 'wcag') {
        return { available: false };
    }
    const list = (Array.isArray(ids) ? ids : String(ids || '').split(','))
        .map((id) => String(id).trim())
        .filter((id) => REQUIREMENT.test(id));
    const wanted = [...new Set(list)].slice(0, MAX_IDS);
    const tag = LOCALE.test(String(locale || '')) ? String(locale).toLowerCase() : 'en';
    const procedures = {};
    for (const id of wanted) {
        try {
            procedures[id] = core.proceduresFor(id, { locale: tag, ...options }) || null;
        } catch {
            procedures[id] = null;
        }
    }
    return { available: true, locale: tag, procedures };
}

/** WCAG criteria only, as the first form of the route asked. */
function proceduresForCriteria(ids, options = {}) {
    return proceduresForRequirements(ids, { ...options, standard: 'wcag' });
}

module.exports = { proceduresForRequirements, proceduresForCriteria, MAX_IDS };
