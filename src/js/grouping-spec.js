'use strict';

/**
 * Groupings of a report's issues: a list of groups, each naming the
 * requirements its issues are about, in one standard or several:
 *
 *   { "group": "Perceivable", "WCAG": ["1.1.1", "1.2.1", ...] }
 *   { "group": "Colours", "RGAA": ["3"] }
 *   { "group": "Forms", "WCAG": ["3.3.2"], "EN 301 549": ["9.3.3.2"], "RGAA": ["11"] }
 *
 * An issue goes in every group one of its requirements is in. A WCAG
 * criterion is matched exactly; a clause of EN 301 549 or a criterion of
 * RGAA also by its number's start, so "3" takes RGAA's whole theme 3 and
 * "9.1" every clause of EN 301 549's 9.1.
 *
 * A standard's requirement also counts as the WCAG criteria it corresponds
 * to (its `wcagSc`: the criterion an EN 301 549 clause restates, those RGAA's
 * own table relates an RGAA criterion to), so a grouping by WCAG criteria
 * groups a scan of another standard too. An issue no group takes, and that
 * corresponds to no WCAG criterion at all, is "Not in WCAG"; any other one
 * goes to "Others".
 *
 * An issue row (findingToIssueRow) gives: SC (its WCAG criteria), EN
 * ([{ clause, wcagSc }]) and RGAA ([{ criterion, wcagSc }]).
 */

export const STANDARD_KEYS = Object.freeze(['WCAG', 'EN 301 549', 'RGAA']);

export const NOT_IN_WCAG_GROUP = 'Not in WCAG';
export const OTHERS_GROUP = 'Others';

const SC_RE = /\b(\d+\.\d+\.\d+)\b/;

/** "1.4.10" out of "WCAG 1.4.10", or ''. */
export function normalizeScToken(v) {
    const m = (v == null ? '' : String(v)).match(SC_RE);
    return m ? m[1] : '';
}

// A clause or criterion number, as written: "9.1.4.3", "3", "11.1".
function normalizeRequirement(v) {
    const s = v == null ? '' : String(v).trim();
    return /^\d+(\.\d+)*$/.test(s) ? s : '';
}

const NORMALIZE = {
    'WCAG': normalizeScToken,
    'EN 301 549': normalizeRequirement,
    'RGAA': normalizeRequirement,
};

function asList(v) {
    if (Array.isArray(v)) return v;
    return v == null ? [] : [v];
}

/**
 * A grouping item cleaned, or null with the reason: { item } | { error }.
 * It needs a name, and at least one requirement in a standard it names.
 */
export function cleanGroupingItem(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return { error: `Grouping item at index ${index} must be an object.` };
    const group = raw.group == null ? '' : String(raw.group).trim();
    if (!group) return { error: `Grouping item at index ${index} is missing "group" (text).` };

    const item = { group };
    for (const key of STANDARD_KEYS) {
        const list = asList(raw[key]).map(NORMALIZE[key]).filter(Boolean);
        if (list.length) item[key] = [...new Set(list)];
    }
    if (!STANDARD_KEYS.some((key) => item[key])) {
        return { error: `Grouping item "${group}" names no requirement: give "WCAG", "EN 301 549" or "RGAA" (array or string).` };
    }
    return { item };
}

/** The items of a grouping that are usable, in order; the others are left out. */
export function normalizeGroupingSpec(spec) {
    return (Array.isArray(spec) ? spec : [])
        .map((raw, i) => cleanGroupingItem(raw, i).item)
        .filter(Boolean);
}

/** Whether every item of a grouping is usable. */
export function isValidGroupingSpecShape(spec) {
    return Array.isArray(spec) && spec.length > 0 && spec.every((raw, i) => !!cleanGroupingItem(raw, i).item);
}

/**
 * What an issue is about, per standard: { WCAG, 'EN 301 549', RGAA }, each a
 * list, WCAG's with the criteria the issue's other requirements correspond to.
 */
export function requirementsOf(issue) {
    const own = asList(issue && issue.SC).map(normalizeScToken).filter(Boolean);
    const en = asList(issue && issue.EN).filter((e) => e && e.clause);
    const rgaa = asList(issue && issue.RGAA).filter((e) => e && e.criterion);
    const linked = [...en, ...rgaa].flatMap((e) => asList(e.wcagSc)).map(normalizeScToken).filter(Boolean);
    return {
        'WCAG': [...new Set([...own, ...linked])],
        'EN 301 549': en.map((e) => String(e.clause)),
        'RGAA': rgaa.map((e) => String(e.criterion)),
    };
}

function covers(listed, requirement, exact) {
    return listed === requirement || (!exact && requirement.startsWith(`${listed}.`));
}

export function issueMatchesGroup(issue, groupSpec) {
    const reqs = requirementsOf(issue);
    return STANDARD_KEYS.some((key) => {
        const listed = Array.isArray(groupSpec && groupSpec[key]) ? groupSpec[key] : [];
        return listed.some((l) => reqs[key].some((r) => covers(l, r, key === 'WCAG')));
    });
}

/**
 * The issues in each group of a grouping, an issue in every group it fits:
 * { buckets: [{ group, spec, items }], notInWcag, unmatched }.
 * notInWcag holds the issues no group took that correspond to no WCAG
 * criterion; unmatched, the rest no group took.
 */
export function groupIssuesBySpec(issues, groupingSpec) {
    const groups = normalizeGroupingSpec(groupingSpec);
    const buckets = groups.map((g) => ({ group: g.group, spec: g, items: [] }));
    const notInWcag = [];
    const unmatched = [];

    for (const issue of Array.isArray(issues) ? issues : []) {
        let matched = false;
        for (const bucket of buckets) {
            if (issueMatchesGroup(issue, bucket.spec)) {
                bucket.items.push(issue);
                matched = true;
            }
        }
        if (matched) continue;
        const reqs = requirementsOf(issue);
        const ofAnotherStandard = reqs['EN 301 549'].length > 0 || reqs.RGAA.length > 0;
        if (ofAnotherStandard && !reqs.WCAG.length) notInWcag.push(issue);
        else unmatched.push(issue);
    }

    return { buckets, notInWcag, unmatched };
}
