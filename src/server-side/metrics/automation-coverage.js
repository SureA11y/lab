'use strict';

/**
 * How much of WCAG the rule catalog can reach at all. A run says which criteria were
 * evaluated; this says which could ever have been.
 */

const { criteriaForScope, criterionBySc } = require('./wcag-criteria');

/** How far automation can take a criterion, before any page is scanned. */
const AUTOMATION = {
    AUTOMATIC: 'automatic',
    MANUAL_ONLY: 'manualOnly',
    NOT_AUTOMATABLE: 'notAutomatable'
};

function asArray(x) {
    return Array.isArray(x) ? x : [];
}

/**
 * `scNormative` only - informative references describe criteria a rule is
 * related to, not ones it tests, and counting them would inflate coverage.
 */
function normativeScOf(rule) {
    const wcag = rule && rule.wcag ? rule.wcag : null;
    if (!wcag) return [];
    const list = Array.isArray(wcag.scNormative) ? wcag.scNormative : asArray(wcag.sc);
    return list.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * @param {object} input
 * @param {Array} input.rules - projected rule catalog (needs wcag.scNormative and type)
 * @param {string} [input.level='AA'] - conformance target
 * @param {string} [input.version='2.2'] - WCAG version in scope
 */
function buildAutomationCoverage({ rules, level = 'AA', version = '2.2' } = {}) {
    const inScope = criteriaForScope({ level, version });

    const automaticBySc = new Map();
    const manualBySc = new Map();

    for (const rule of asArray(rules)) {
        if (!rule) continue;
        const isManual = String(rule.type || 'automatic') === 'manual';
        const target = isManual ? manualBySc : automaticBySc;
        const ruleId = String(rule.ruleId || rule.id || '').trim();

        for (const sc of normativeScOf(rule)) {
            if (!target.has(sc)) target.set(sc, []);
            if (ruleId) target.get(sc).push(ruleId);
        }
    }

    const criteria = inScope.map((c) => {
        const automatic = automaticBySc.get(c.sc) || [];
        const manual = manualBySc.get(c.sc) || [];

        let automation = AUTOMATION.NOT_AUTOMATABLE;
        if (automatic.length) automation = AUTOMATION.AUTOMATIC;
        else if (manual.length) automation = AUTOMATION.MANUAL_ONLY;

        return {
            sc: c.sc,
            level: c.level,
            title: c.title,
            automation,
            automaticRuleIds: [...new Set(automatic)].sort(),
            manualRuleIds: [...new Set(manual)].sort()
        };
    });

    const countBy = (kind) => criteria.filter((c) => c.automation === kind).length;
    const automatable = countBy(AUTOMATION.AUTOMATIC);

    const byLevel = {};
    for (const c of criteria) {
        if (!byLevel[c.level]) byLevel[c.level] = { inScope: 0, automatic: 0, manualOnly: 0, notAutomatable: 0 };
        byLevel[c.level].inScope += 1;
        if (c.automation === AUTOMATION.AUTOMATIC) byLevel[c.level].automatic += 1;
        else if (c.automation === AUTOMATION.MANUAL_ONLY) byLevel[c.level].manualOnly += 1;
        else byLevel[c.level].notAutomatable += 1;
    }

    // Rules can map to criteria outside the requested scope (a AAA criterion under
    // an AA target); surfacing them keeps the totals reconcilable.
    const scopeScs = new Set(inScope.map((c) => c.sc));
    const outOfScope = [...new Set([...automaticBySc.keys(), ...manualBySc.keys()])]
        .filter((sc) => !scopeScs.has(sc))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return {
        scope: { level, version },
        criteria,
        byLevel,
        totals: {
            inScope: criteria.length,
            automatic: automatable,
            manualOnly: countBy(AUTOMATION.MANUAL_ONLY),
            notAutomatable: countBy(AUTOMATION.NOT_AUTOMATABLE),
            automatableRatio: criteria.length ? Math.round((automatable / criteria.length) * 1000) / 1000 : 0
        },
        outOfScopeCriteria: outOfScope.map((sc) => {
            const known = criterionBySc(sc);
            return { sc, level: known ? known.level : null };
        })
    };
}

module.exports = {
    buildAutomationCoverage,
    AUTOMATION
};
