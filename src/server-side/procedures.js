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
    const asked = LOCALE.test(String(locale || '')) ? String(locale).toLowerCase() : 'en';
    // Never part in one language and part in another: a language the
    // standard has only in part reads in the standard's own.
    const tag = completeLocale(asked, languagesOf(core, std === 'wcag' ? {} : options));
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

// The languages core says the standard can be read in, or null from a core
// that doesn't say.
function languagesOf(core, options) {
    if (!core || typeof core.procedureLanguages !== 'function') return null;
    try {
        const out = core.procedureLanguages(options);
        return Array.isArray(out) && out.length ? out : null;
    } catch {
        return null;
    }
}

// The entry of `languages` a tag is read in: the tag's, else its base
// language's ('fr-ca', then 'fr'); null for one the standard doesn't have.
function languageFor(tag, languages) {
    const t = String(tag || '').toLowerCase();
    return languages.find((l) => l.locale === t) || languages.find((l) => l.locale === t.split('-')[0]) || null;
}

/**
 * The locale to read a standard in for `tag`, with nothing left in another
 * language: `tag` where the standard has it complete, else the standard's
 * own language. `tag` itself where core doesn't say (`languages` null).
 */
function completeLocale(tag, languages) {
    if (!languages) return tag;
    const found = languageFor(tag, languages);
    return found && found.complete ? found.locale : languages[0].locale;
}

/** WCAG criteria only, as the first form of the route asked. */
function proceduresForCriteria(ids, options = {}) {
    return proceduresForRequirements(ids, { ...options, standard: 'wcag' });
}

const WCAG_VERSIONS = ['2.0', '2.1', '2.2'];
const LEVELS = ['A', 'AA', 'AAA'];
const TOOLS = ['keyboard', 'pointer', 'screen-reader', 'zoom', 'contrast-theme', 'devtools'];
const AUTOMATION = ['full', 'partial', 'manual'];

// A comma-separated choice kept to the values known: ['A', 'AA'] from "A,AA".
const pick = (v, known) => [...new Set(String(v || '').split(',').map((x) => x.trim()).filter((x) => known.includes(x)))];

/**
 * The options core's listProcedures and renderProcedures take, from what the
 * testing guide asks for: `standard` ('wcag', 'best-practice' or an
 * installed pack's key), `version`, `levels`, `tools`, `automation` and
 * `locale`; null for a standard the lab has no pack for.
 */
function listOptions({ standard = 'wcag', version = '', levels = '', tools = '', automation = '', locale = 'en' } = {}, { packFor = defaultPackFor } = {}) {
    const std = String(standard || 'wcag');
    const tag = LOCALE.test(String(locale || '')) ? String(locale).toLowerCase() : 'en';
    const out = { locale: tag };
    const t = pick(tools, TOOLS);
    const a = pick(automation, AUTOMATION);
    if (t.length) out.tools = t;
    if (a.length) out.automation = a;
    if (std === 'wcag') {
        out.standard = 'wcag';
        if (WCAG_VERSIONS.includes(String(version))) out.version = String(version);
        const l = pick(levels, LEVELS);
        if (l.length) out.levels = l;
        return out;
    }
    if (std === 'best-practice') return { ...out, standard: 'best-practice' };
    if (!STANDARD_KEY.test(std)) return null;
    const pack = packFor(std);
    if (!pack) return null;
    return { ...out, packs: [pack], standard: std, ...(VERSION.test(String(version || '')) ? { version: String(version) } : {}) };
}

/**
 * A standard's procedures for the testing guide, as core's listProcedures
 * gives them: { available, listing }. { available: false } from a core
 * without them; { available: true, listing: null } for a standard or
 * version it doesn't know.
 */
function listStandardProcedures(query = {}, { core = load('@surea11y/core'), packFor = defaultPackFor } = {}) {
    if (!core || typeof core.listProcedures !== 'function') return { available: false };
    const options = listOptions(query, { packFor });
    if (!options) return { available: true, listing: null };
    try {
        const listing = core.listProcedures(options) || null;
        if (listing) markEarlierWcagTitles(listing, options);
        return { available: true, listing };
    } catch {
        return { available: true, listing: null };
    }
}

// A WCAG title core has no translation of, such as an earlier version's
// own ("Parsing" for 4.1.1 in WCAG 2.1), stays English in every locale.
// Core's list doesn't mark it, so it is marked here as core's page marks
// it: a title that isn't the locale's text for it is English.
function markEarlierWcagTitles(listing, options) {
    const locale = String(listing.locale || options.locale || 'en');
    if (options.standard !== 'wcag' || locale === 'en' || !LOCALE.test(locale)) return;
    const dict = load(`@surea11y/core/procedures/${locale}`);
    if (!dict || typeof dict !== 'object') return;
    const mark = (item, key) => {
        if (item && item.title && !item.titleLang && dict[key] !== item.title) item.titleLang = 'en';
    };
    for (const r of listing.requirements || []) mark(r, `wcag_${r.id}_title`);
    const walk = (groups) => {
        for (const g of groups || []) {
            mark(g, `wcag_${String(g.id).includes('.') ? 'guideline' : 'principle'}_${g.id}`);
            walk(g.groups);
        }
    };
    walk(listing.groups);
}

/**
 * The languages a standard's procedures can be read in, as core's
 * procedureLanguages gives them, its own first: { available, languages:
 * [{ locale, complete, missing }] }; languages null for a standard or
 * version it doesn't know. { available: false } from a core that doesn't
 * say, which reads the procedures in the locale asked for.
 */
function standardLanguages(query = {}, { core = load('@surea11y/core'), packFor = defaultPackFor } = {}) {
    if (!core || typeof core.procedureLanguages !== 'function') return { available: false };
    const options = listOptions(query, { packFor });
    if (!options) return { available: true, languages: null };
    const { standard, version, packs } = options;
    return { available: true, languages: languagesOf(core, { standard, ...(version ? { version } : {}), ...(packs ? { packs } : {}) }) };
}

/**
 * The same procedures as one page to keep or print, core's renderProcedures'
 * reference (not its worksheet): { html, name } or null.
 */
function renderStandardProcedures(query = {}, { core = load('@surea11y/core'), packFor = defaultPackFor } = {}) {
    if (!core || typeof core.listProcedures !== 'function' || typeof core.renderProcedures !== 'function') return null;
    const options = listOptions(query, { packFor });
    if (!options) return null;
    try {
        const listing = core.listProcedures(options);
        if (!listing) return null;
        const html = core.renderProcedures(listing, { locale: options.locale, ...(options.packs ? { packs: options.packs } : {}) });
        const name = `${String(listing.standard || options.standard)}${listing.version ? ` ${listing.version}` : ''} testing guide`
            .replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'testing guide';
        return { html, name: `${name}.html` };
    } catch {
        return null;
    }
}

/**
 * What the testing guide has, for links into it to be sure to land:
 * { available, wcag: { [version]: [criterion] }, standards: [{ key, name,
 * versions: { [version]: [requirement] } }] }, every level; the installed
 * packs' standards from `standards` (standard-packs.js installedStandards).
 */
function guideIndex({ core = load('@surea11y/core'), standards = null } = {}) {
    if (!core || typeof core.listProcedures !== 'function') return { available: false };
    const ids = (listing) => (listing && Array.isArray(listing.requirements) ? listing.requirements.map((r) => String(r.id)) : []);
    const wcag = {};
    for (const version of WCAG_VERSIONS) {
        try {
            wcag[version] = ids(core.listProcedures({ standard: 'wcag', version, levels: LEVELS }));
        } catch {
            wcag[version] = [];
        }
    }
    const list = standards || require('./standard-packs').installedStandards({ core });
    return {
        available: true,
        wcag,
        standards: list.map((std) => ({
            key: std.key,
            name: std.name,
            versions: Object.fromEntries(Object.entries(std.listings || {}).map(([v, l]) => [v, ids(l)])),
        })),
    };
}

module.exports = { proceduresForRequirements, proceduresForCriteria, listStandardProcedures, standardLanguages, completeLocale, renderStandardProcedures, listOptions, guideIndex, MAX_IDS };
