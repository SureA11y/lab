'use strict';

/**
 * EN 301 549's own requirements, as the lab gives them beside the pack's
 * (README.md beside this file): en301549.json read for each version, in the
 * shape a pack's standard.procedures takes them (docs/PACKS.md in core), and
 * the groups that put every requirement of a version in its chapter.
 *
 * - ownRequirements(version): { [id]: { title, relatesTo?, note?, facets } },
 *   each facet { id, label, automation, tools?, steps, passWhen, failWhen }.
 * - groupsOf(procedures): { [version]: [group] }, by chapter, and chapter 9
 *   by WCAG's principles and guidelines, then its own requirements.
 *
 * In V4.1.1, a related-clauses facet names, of the clauses it lists, those
 * Table B.2 marks P for the criterion, chapter 9's first, and the criterion
 * relates to the WCAG criteria the chapter 9 clauses marked P restate. In
 * V3.2.1 it names them as listed, and relates to their criteria.
 */

const DATA = require('./en301549.json');
const ANNEX_B = require('./en301549-annex-b.json');

const V3 = 'V3.2.1';
const VERSIONS = DATA.versions;
const TOOLS = ['keyboard', 'pointer', 'screen-reader', 'zoom', 'contrast-theme', 'devtools'];
const FACET_FIELDS = ['label', 'automation', 'tools', 'steps', 'passWhen', 'failWhen'];
const TEMPLATE_FIELDS = ['column', 'need', 'clauses', 'example'];

const fail = (where, message) => {
    throw new Error(`en301549.json, ${where}: ${message}`);
};

// A value keyed by version: an object whose keys are all versions.
const isByVersion = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.keys(value).every((k) => VERSIONS.includes(k));

const inVersion = (item, v) => item.versions === undefined || item.versions.includes(v);

// A value as version v shows it: undefined where v has none. In a list, an
// item keyed by version that doesn't name v is left out.
function forVersion(value, v) {
    if (isByVersion(value)) return forVersion(value[v], v);
    if (Array.isArray(value)) return value.map((x) => forVersion(x, v)).filter((x) => x !== undefined);
    return value;
}

const isWeb = (clause) => clause.startsWith('9.');
const criterionOf = (clause) => clause.split('.').slice(1).join('.');

function byNumber(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

// The clauses a V4.1.1 related-clauses facet names: those of `picks` Table
// B.2 marks P for the criterion, chapter 9's first, in the table's order.
function primaryExamples(v, id, picks) {
    const { primary } = ANNEX_B[v][id];
    const missing = picks.filter((c) => !primary.includes(c));
    if (missing.length) fail(`${id} related-clauses`, `Table B.2 does not mark ${missing.join(', ')} P in ${v}`);
    const named = primary.filter((c) => picks.includes(c));
    return named.filter(isWeb).concat(named.filter((c) => !isWeb(c)));
}

const primaryWeb = (v, id) => ANNEX_B[v][id].primary.filter((c) => isWeb(c) && c !== '9.6' && c !== '9.7');

// A facet as version v gives it, and the clauses it names, if any.
function facetFor(entry, id, v) {
    const where = `${id} ${entry.id}`;
    let source = entry;
    let clauses = null;
    if (entry.template !== undefined) {
        const template = DATA.templates[entry.template];
        if (!template) fail(where, `unknown template ${entry.template}`);
        const picks = forVersion(entry.clauses, v);
        clauses = v === V3 ? picks : primaryExamples(v, id, picks);
        const fields = { id };
        for (const k of TEMPLATE_FIELDS) {
            const value = forVersion(entry[k], v);
            if (value === undefined) fail(where, `the template needs ${k}`);
            fields[k] = k === 'clauses' ? clauses.join(', ') : value;
        }
        const fill = (text) => text.replace(/\{(\w+)\}/g, (_, name) => {
            if (!(name in fields)) fail(where, `unknown template field {${name}}`);
            return fields[name];
        });
        const filled = (value) => (Array.isArray(value) ? value.map(filled) : typeof value === 'string' ? fill(value) : value);
        source = Object.fromEntries(Object.keys(template).map((k) => [k, filled(forVersion(template[k], v))]));
    }
    const facet = { id: entry.id };
    for (const k of FACET_FIELDS) {
        const value = forVersion(source[k], v);
        if (value !== undefined) facet[k] = value;
    }
    for (const t of facet.tools || []) if (!TOOLS.includes(t)) fail(where, `unknown tool ${t}`);
    return { facet, clauses };
}

function requirementFor(entry, v) {
    const title = forVersion(entry.title, v);
    if (entry.note !== undefined) return { title, note: forVersion(entry.note, v) };
    const named = [];
    const facets = [];
    for (const f of entry.facets || []) {
        if (!inVersion(f, v)) continue;
        const { facet, clauses } = facetFor(f, entry.id, v);
        facets.push(facet);
        if (clauses) named.push(...clauses);
    }
    if (named.length) {
        const clauses = v === V3 ? named : primaryWeb(v, entry.id);
        return { title, relatesTo: [...new Set(clauses.map(criterionOf))].sort(byNumber), facets };
    }
    if (entry.relatesTo !== undefined) return { title, relatesTo: entry.relatesTo.slice(), facets };
    return { title, facets };
}

const built = new Map();

/** EN 301 549's own requirements in `version`, by id; {} for a version the lab doesn't have. */
function ownRequirements(version) {
    if (!VERSIONS.includes(version)) return {};
    if (!built.has(version)) {
        const out = {};
        for (const entry of DATA.requirements) {
            if (inVersion(entry, version)) out[entry.id] = requirementFor(entry, version);
        }
        built.set(version, out);
    }
    return built.get(version);
}

// The chapters that hold several requirements, by version where it differs.
const CHAPTERS = {
    4: (v) => (v === V3 ? 'Functional performance' : 'Functional performance criteria'),
    9: () => 'Web',
    12: (v) => (v === V3 ? 'Documentation and support services' : 'Information about products and services'),
};

// Chapter 9's headings: WCAG's principles and guidelines, as the standard
// titles them.
const WEB = {
    9.1: 'Perceivable',
    '9.1.1': 'Text alternatives',
    '9.1.2': 'Time-based media',
    '9.1.3': 'Adaptable',
    '9.1.4': 'Distinguishable',
    9.2: 'Operable',
    '9.2.1': 'Keyboard accessible',
    '9.2.2': 'Enough time',
    '9.2.3': 'Seizures and physical reactions',
    '9.2.4': 'Navigable',
    '9.2.5': 'Input modalities',
    9.3: 'Understandable',
    '9.3.1': 'Readable',
    '9.3.2': 'Predictable',
    '9.3.3': 'Input assistance',
    9.4: 'Robust',
    '9.4.1': 'Compatible',
};

const head = (id, parts) => id.split('.').slice(0, parts).join('.');

function webTitle(id) {
    if (!Object.prototype.hasOwnProperty.call(WEB, id)) throw new Error(`en301549.js: no heading for ${id}`);
    return WEB[id];
}

// Chapter 9's clauses under their principle and guideline, then its own
// requirements (9.6, 9.7), each a group of that one.
function webGroups(ids, requirements) {
    const clauses = ids.filter((id) => id.split('.').length === 4);
    const own = ids.filter((id) => id.split('.').length === 2)
        .map((id) => ({ id, title: requirements[id].title, requirements: [id] }));
    const principles = [...new Set(clauses.map((id) => head(id, 2)))].sort(byNumber);
    return principles.map((p) => ({
        id: p,
        title: webTitle(p),
        groups: [...new Set(clauses.filter((id) => head(id, 2) === p).map((id) => head(id, 3)))]
            .sort(byNumber)
            .map((g) => ({ id: g, title: webTitle(g), requirements: clauses.filter((id) => head(id, 3) === g) })),
    })).concat(own);
}

function versionGroups(version, requirements) {
    const ids = Object.keys(requirements).sort(byNumber);
    const chapters = [...new Set(ids.map((id) => head(id, 1)))].sort(byNumber);
    return chapters.map((chapter) => {
        const own = ids.filter((id) => head(id, 1) === chapter);
        if (chapter === '9') return { id: chapter, title: CHAPTERS[9](version), groups: webGroups(own, requirements) };
        if (Object.prototype.hasOwnProperty.call(CHAPTERS, chapter)) {
            return { id: chapter, title: CHAPTERS[chapter](version), requirements: own };
        }
        if (own.length !== 1 || own[0] !== chapter) throw new Error(`en301549.js: chapter ${chapter} of ${version} needs a title`);
        return { id: chapter, title: requirements[chapter].title, requirements: own };
    });
}

/** The groups of every version `procedures` gives: { version: [group] }. */
const groupsOf = (procedures) => Object.fromEntries(
    Object.entries(procedures).map(([version, requirements]) => [version, versionGroups(version, requirements)]),
);

module.exports = { ownRequirements, groupsOf, VERSIONS, byNumber };
