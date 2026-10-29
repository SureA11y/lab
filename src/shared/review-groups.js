'use strict';

/**
 * review-groups.js (shared)
 *
 * The questions a scan leaves for a person (cantTell occurrences), in the
 * three groups core's own report shows them in (core 1.14):
 *
 *  - leanFail: the page's evidence points to a failure ("Likely fails:
 *    confirm"), which a reviewer should look at first;
 *  - leanPass: it points to a pass ("Likely passes: confirm");
 *  - open: nothing points either way ("Needs a person").
 *
 * A lean never changes the outcome: the occurrence stays cantTell. The group
 * comes from its `lean.toward`, which the lab keeps on its canonical
 * occurrences.
 *
 * Browser: available as globalThis.A11Y_REVIEW_GROUPS.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_REVIEW_GROUPS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const REVIEW_GROUPS = Object.freeze(['leanFail', 'leanPass', 'open']);

    const LABELS = Object.freeze({
        leanFail: 'Likely fails',
        leanPass: 'Likely passes',
        open: 'Needs a person',
    });

    /** 'leanFail', 'leanPass' or 'open', from an occurrence's lean. */
    function reviewGroupOf(occ) {
        const toward = occ && occ.lean && occ.lean.toward;
        if (toward === 'fail') return 'leanFail';
        if (toward === 'pass') return 'leanPass';
        return 'open';
    }

    function occurrenceTier(occ, fallback) {
        const own = String((occ && (occ.occurrenceOutcome || occ.outcome)) || '').trim();
        return own === 'fail' || own === 'cantTell' ? own : fallback;
    }

    /**
     * How many of the findings' cantTell occurrences fall in each group:
     * { leanFail, leanPass, open, total }. A failing finding's question
     * counts too, by the occurrence's own outcome. `outcome` stands in for a
     * finding that names none (a list already split by outcome).
     */
    function countReviewGroups(findings, { outcome = null } = {}) {
        const out = { leanFail: 0, leanPass: 0, open: 0, total: 0 };
        for (const f of Array.isArray(findings) ? findings : []) {
            if (!f || !Array.isArray(f.occurrences)) continue;
            for (const occ of f.occurrences) {
                if (occurrenceTier(occ, f.outcome || outcome) !== 'cantTell') continue;
                out[reviewGroupOf(occ)] += 1;
                out.total += 1;
            }
        }
        return out;
    }

    /**
     * "right in 9 of 10 known cases", from a lean's `measured` (how often a
     * lean of its kind agreed with the W3C ACT test cases), or null.
     */
    function measuredText(lean) {
        const m = lean && lean.measured;
        if (!m || !Number.isInteger(m.agreed) || !Number.isInteger(m.cases) || m.cases <= 0) return null;
        return `right in ${m.agreed} of ${m.cases} known cases`;
    }

    /** "3 likely fail, 1 likely passes, 4 need a person", or '' with none. */
    function reviewGroupsText(counts) {
        if (!counts || !counts.total) return '';
        const parts = [];
        if (counts.leanFail) parts.push(`${counts.leanFail} likely ${counts.leanFail === 1 ? 'fails' : 'fail'}`);
        if (counts.leanPass) parts.push(`${counts.leanPass} likely ${counts.leanPass === 1 ? 'passes' : 'pass'}`);
        if (counts.open) parts.push(`${counts.open} ${counts.open === 1 ? 'needs' : 'need'} a person`);
        return parts.join(', ');
    }

    return {
        REVIEW_GROUPS,
        LABELS,
        reviewGroupOf,
        countReviewGroups,
        measuredText,
        reviewGroupsText,
    };
}));
