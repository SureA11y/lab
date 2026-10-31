'use strict';

// How a person assesses a requirement by hand: core's test procedures
// (proceduresFor, its docs/PROCEDURES.md), for the app to show beside each
// WCAG criterion, and, read with an installed standard's pack
// (standard-packs.js), beside each of that standard's own requirements: EN
// 301 549's chapter 4, chapter 12 and the other chapters, by number, say. A
// core without them answers { available: false }, and the app shows what it
// showed before.

const MAX_IDS = 120;
// A WCAG criterion (1.4.13), a clause (4.2.1, 12.1) or a chapter (5).
const REQUIREMENT = /^\d{1,2}(\.\d{1,2}){0,3}$/;
const LOCALE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;
// A standard's version as its pack names it (V4.1.1, 4.1, 2024), and its key.
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/;
const STANDARD_KEY = /^[a-z][a-z0-9-]{0,39}$/;

function defaultPackFor(key) {
    return require('./standard-packs').packForStandard(key);
}

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
 * text): WCAG criteria, or with `standard` (an installed pack's key, such as
 * 'en301549') and its `version`, that standard's requirements, read with its
 * pack. Ids that are no requirement's are left out. A standard with no
 * installed pack has none: { available: false }.
 */
function proceduresForRequirements(ids, {
    locale = 'en', standard = 'wcag', version = '', core = load('@surea11y/core'), packFor = defaultPackFor,
} = {}) {
    if (!core || typeof core.proceduresFor !== 'function') return { available: false };
    const std = String(standard || 'wcag');
    let options = {};
    if (std !== 'wcag') {
        if (!STANDARD_KEY.test(std)) return { available: false };
        const pack = packFor(std);
        if (!pack) return { available: false };
        options = { packs: [pack], standard: std, ...(VERSION.test(String(version || '')) ? { version: String(version) } : {}) };
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
