'use strict';

// The procedures the lab adds to core's and the packs' (src/procedures/):
// how to assess by hand what no rule evaluates, which core and the packs
// leave out. withLabProcedures(core) gives the calls the testing guide makes
// of core (proceduresFor, listProcedures, procedureLanguages,
// renderProcedures) with them in:
//
// - WCAG criteria no core rule evaluates: their steps join core's English
//   dictionary, so core reads them as its own, for the criterion and for a
//   pack's clause that restates it, names the requirement they fail, marks
//   them English where the locale has no translation, and counts them where
//   it says which languages a standard is complete in. Core takes a facet's
//   tools from its own registry, so the lab adds those, and filters by
//   tools, automation and rules itself, as core does.
// - A pack's standard's own requirements no rule evaluates (EN 301 549's
//   chapter 4, 9.6, 9.7, the other chapters and chapter 12): the pack is
//   given to core with them in its standard.procedures, in the groups of the
//   standard's chapters. What core or the pack gives wins.
//
// A core without its procedures entry (@surea11y/core/procedures, 1.15) is
// given back as it is, and the guide shows what it showed before.

const fs = require('fs');
const path = require('path');

const WCAG = require('../procedures/wcag.json');
const EN301549 = require('../procedures/en301549.js');

const TOOLS = ['keyboard', 'pointer', 'screen-reader', 'zoom', 'contrast-theme', 'devtools'];

// The lab's standards besides WCAG, by key: each one's own requirements for a
// version, and its groups.
const STANDARDS = {
    en301549: { ownRequirements: EN301549.ownRequirements, groupsOf: EN301549.groupsOf },
};

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const stemOf = (criterion, facet) => `wcag_${criterion}_${facet}_`;

/** The lab's WCAG steps as core's dictionaries key them: { key: text }, in English. */
function wcagDictionary() {
    const out = {};
    for (const c of WCAG.criteria) {
        for (const f of c.facets) {
            const stem = stemOf(c.id, f.id);
            f.steps.forEach((s, i) => { out[`${stem}step${i + 1}`] = s; });
            out[`${stem}pass`] = f.passWhen;
            out[`${stem}fail`] = f.failWhen;
        }
    }
    return out;
}

// The tools of each of the lab's WCAG facets, by stem.
const WCAG_TOOLS = new Map(WCAG.criteria.flatMap((c) => c.facets.map((f) => [stemOf(c.id, f.id), (f.tools || []).filter((t) => TOOLS.includes(t))])));

/**
 * Core's procedures dictionaries, every locale it ships, with the lab's WCAG
 * steps in English where core's English has none: { locale: { key: text } },
 * and `added`, the stems the lab's text is under. null where core ships none.
 */
function dictionariesOf(dir) {
    let files;
    try {
        files = fs.readdirSync(dir).filter((f) => /^[a-z]{2,3}(-[a-z0-9]+)*\.json$/.test(f));
    } catch {
        return null;
    }
    const dictionaries = {};
    for (const f of files) dictionaries[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!dictionaries.en) return null;
    const added = new Set();
    const en = { ...dictionaries.en };
    const lab = wcagDictionary();
    for (const [stem] of WCAG_TOOLS) {
        // A facet core has steps for is core's.
        if (typeof en[`${stem}step1`] === 'string') continue;
        for (const [k, v] of Object.entries(lab)) if (k.startsWith(stem)) en[k] = v;
        added.add(stem);
    }
    dictionaries.en = en;
    return { dictionaries, added };
}

// A tool as core gives one: its label in the locale read, and the label's
// language where it isn't that locale.
function toolOf(id, dictionaries, locale) {
    const own = dictionaries[locale] && dictionaries[locale][`tool_${id}`];
    const label = own || (dictionaries.en && dictionaries.en[`tool_${id}`]) || id;
    return own || locale === 'en' ? { id, label } : { id, label, lang: 'en' };
}

// A requirement with the tools of the facets the lab gives the steps of: a
// WCAG criterion's, or a pack's clause that restates one.
function withTools(requirement, lab) {
    if (!isObject(requirement) || !Array.isArray(requirement.facets)) return requirement;
    const criterion = requirement.standard === 'wcag' ? requirement.id : requirement.wcag;
    if (!criterion) return requirement;
    const locale = String(requirement.locale || 'en').toLowerCase();
    const facets = requirement.facets.map((f) => {
        const stem = stemOf(criterion, f.id);
        if (!f.procedure || f.procedureFrom || !lab.added.has(stem)) return f;
        return { ...f, tools: WCAG_TOOLS.get(stem).map((id) => toolOf(id, lab.dictionaries, locale)) };
    });
    return { ...requirement, facets };
}

const listOf = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).filter((x) => typeof x === 'string' && x);

// The filters a list takes, as core reads them: null where not given.
function filtersOf(opts) {
    const f = {};
    for (const key of ['tools', 'automation', 'rules']) f[key] = opts[key] === undefined ? null : listOf(opts[key]);
    return f;
}

// A requirement with only the facets that match every filter given, as core
// keeps them: a technology facet by its coveredBy facet's tools, keeping that
// facet too. null where none match.
function filtered(requirement, f) {
    if (f.tools === null && f.automation === null && f.rules === null) return requirement;
    const facets = new Map(requirement.facets.map((x) => [x.id, x]));
    const toolsOf = (x) => (x.coveredBy && facets.has(x.coveredBy) ? facets.get(x.coveredBy) : x).tools.map((t) => t.id);
    const matches = (x) => (f.tools === null || toolsOf(x).some((t) => f.tools.includes(t)))
        && (f.automation === null || f.automation.includes(x.automation))
        && (f.rules === null || x.rules.some((r) => f.rules.includes(r)));
    const keep = new Set();
    for (const x of requirement.facets) {
        if (!matches(x)) continue;
        keep.add(x.id);
        if (x.coveredBy) keep.add(x.coveredBy);
    }
    if (!keep.size) return null;
    return { ...requirement, facets: requirement.facets.filter((x) => keep.has(x.id)) };
}

// Groups with only the requirements of `ids`; a group left with none, and no
// group under it with any, is left out.
function pruned(groups, ids) {
    const out = [];
    for (const g of groups || []) {
        const requirements = (g.requirements || []).filter((id) => ids.has(id));
        const inner = pruned(g.groups, ids);
        if (requirements.length || inner.length) out.push({ ...g, requirements, groups: inner });
    }
    return out;
}

const wrapped = new WeakMap();

/**
 * A pack as the lab gives it to core: its standard with the lab's own
 * requirements for it in standard.procedures, where the pack gives none of
 * that id, and groups for all of them. The pack as it is where the lab has
 * nothing for its standard, or it gives no procedures.
 */
function withLabRequirements(pack) {
    const st = isObject(pack) && isObject(pack.standard) ? pack.standard : null;
    const lab = st && STANDARDS[st.key];
    if (!lab || !isObject(st.procedures)) return pack;
    if (!wrapped.has(pack)) {
        const procedures = {};
        for (const [version, given] of Object.entries(st.procedures)) {
            const own = lab.ownRequirements(version);
            procedures[version] = { ...given };
            for (const [id, entry] of Object.entries(own)) if (!Object.prototype.hasOwnProperty.call(given, id)) procedures[version][id] = entry;
        }
        wrapped.set(pack, { ...pack, standard: { ...st, procedures, groups: lab.groupsOf(procedures) } });
    }
    return wrapped.get(pack);
}

function loadFrom() {
    try {
        const from = require('@surea11y/core/procedures');
        return from && typeof from.proceduresFrom === 'function' && typeof from.listProceduresFrom === 'function' ? from : null;
    } catch {
        return null;
    }
}

function coreDictionaryDir() {
    try {
        return path.join(path.dirname(require.resolve('@surea11y/core/package.json')), 'src', 'i18n', 'procedures');
    } catch {
        return null;
    }
}

/**
 * `core` with the lab's procedures in its proceduresFor, listProcedures,
 * procedureLanguages and renderProcedures; `core` as it is where it has no
 * procedures entry to read them with.
 */
function withLabProcedures(core, { from = loadFrom(), dir = coreDictionaryDir() } = {}) {
    if (!core || !from || !dir) return core;
    const lab = dictionariesOf(dir);
    if (!lab) return core;
    const { dictionaries } = lab;
    const packed = (opts) => {
        const o = isObject(opts) ? { ...opts } : {};
        if (Array.isArray(o.packs)) o.packs = o.packs.map(withLabRequirements);
        return o;
    };
    function listProcedures(options) {
        const opts = packed(options);
        const f = filtersOf(opts);
        // Listed whole, with the tools in, then kept to the filters.
        const { tools: _t, automation: _a, rules: _r, ...whole } = opts;
        const listing = from.listProceduresFrom(dictionaries, whole);
        if (!listing) return null;
        const requirements = listing.requirements.map((r) => withTools(r, lab)).map((r) => filtered(r, f)).filter(Boolean);
        const ids = new Set(requirements.map((r) => r.id));
        return {
            ...listing,
            ...(listing.scope ? { scope: { ...listing.scope, tools: f.tools, automation: f.automation, rules: f.rules } } : {}),
            requirements,
            groups: pruned(listing.groups, ids),
        };
    }
    return {
        ...core,
        proceduresFor: (requirement, options) => withTools(from.proceduresFrom(dictionaries, requirement, packed(options)), lab),
        listProcedures,
        ...(typeof from.procedureLanguagesFrom === 'function'
            ? { procedureLanguages: (options) => from.procedureLanguagesFrom(dictionaries, packed(options)) }
            : {}),
        ...(typeof from.renderProceduresFrom === 'function'
            ? { renderProcedures: (input, options) => from.renderProceduresFrom(dictionaries, input, packed(options)) }
            : {}),
    };
}

module.exports = { withLabProcedures, withLabRequirements, wcagDictionary, dictionariesOf, filtered, pruned };
