'use strict';

const axeCore = require('axe-core');
const axeSource = axeCore.source;
const { fromAxeResults } = require('../../../src/server-side/a11y-canonical');
const { saveAxeHtmlReport } = require('../../../src/server-side/a11y-report');
const { selectionFromRunOnly, selectionTags, tagsBesideSelection } = require('../../../src/server-side/conformance-targets');

/**
 * IMPORTANT:
 * This module should be the only place that imports axe-core.
 * It provides a stable adapter surface used by the rest of the system.
 */

const ENGINE_ID = 'axe';
const ENGINE_NAME = 'axe-core';
let ENGINE_VERSION = null;
try { ENGINE_VERSION = axeCore && axeCore.version ? String(axeCore.version) : null; } catch {}
try {
    // Some builds don't expose .version, fallback to package.json if available
    if (!ENGINE_VERSION) ENGINE_VERSION = require('axe-core/package.json').version;
} catch {}

function sortIssues(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.sort((a, b) => {
        const ai = (a && typeof a.id === 'string') ? a.id : '';
        const bi = (b && typeof b.id === 'string') ? b.id : '';
        return ai.localeCompare(bi);
    });
}

/**
 * Normalize rule id filters to the { runOnly } shape axe.run expects.
 * @param {string|string[]|null|undefined} ruleIds
 * @returns {{type:'rule', values:string[]}|null}
 */
function buildRunOnlyFromRuleIds(ruleIds) {
    if (!ruleIds) return null;
    let list = [];
    if (Array.isArray(ruleIds)) list = ruleIds;
    else if (typeof ruleIds === 'string') list = ruleIds.split(',').map((s) => s.trim());
    list = list.filter(Boolean);
    if (!list.length) return null;
    return { type: 'rule', values: list };
}

/**
 * The runOnly axe gets: the tags of the scan's selection (its WCAG version
 * and level, and best-practice), any other rule tags the caller adds, and
 * the caller's rule ids, which decide the rules when given. A caller with
 * no selection may give WCAG tags and a level instead.
 * -> { type: 'tag', values, includeRuleIds, excludeRuleIds } | null
 */
function axeRunOnly({ selection, runOnly, wcagLevel, engineOptions } = {}) {
    const sel = selection !== undefined
        ? selection
        : selectionFromRunOnly({ runOnly, wcagLevel, profile: engineOptions && engineOptions.profile });
    const ro = runOnly && typeof runOnly === 'object' ? runOnly : {};
    const values = [...new Set([...selectionTags(sel), ...tagsBesideSelection(ro)])];
    const ids = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []))
        .map((x) => String(x).trim()).filter(Boolean);
    const includeRuleIds = ids(ro.includeRuleIds);
    const excludeRuleIds = ids(ro.excludeRuleIds);
    if (!values.length && !includeRuleIds.length && !excludeRuleIds.length) return null;
    return { type: 'tag', values, includeRuleIds, excludeRuleIds };
}

async function ensureInjected(page) {
    await page.evaluate((src) => {
        if (!(window && window.axe && typeof window.axe.run === 'function')) {
            // eslint-disable-next-line no-eval
            eval(src);
        }
    }, axeSource);
}

/**
 * Runs axe in the page and returns axe-shaped results.
 * This is intentional for Action B/C so UI remains unchanged.
 */
async function runOnPage(page, { selection, runOnly: requestedRunOnly, wcagLevel, contextSelector, excludeSelectors, engineOptions, postProcess } = {}) {
    await ensureInjected(page);
    const runOnly = axeRunOnly({ selection, runOnly: requestedRunOnly, wcagLevel, engineOptions });

    // Capture page metadata outside the page context
    let pageUrl = null;
    let pageTitle = null;
    try { pageUrl = await page.url(); } catch {}
    try { pageTitle = await page.title(); } catch {}

// Run axe in the page
    const native = await page.evaluate(
        async (runOnlyArg, ctxSelector, excludeSelectorsArg, engineOptionsArg) => {
            function normalizeIdList(v) {
                if (!v) return [];
                if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
                if (typeof v === 'string') return v.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
                return [];
            }

            function getKnownRuleIds() {
                const allRules = (typeof axe.getRules === 'function') ? axe.getRules() : [];
                const set = new Set();
                for (const r of allRules) {
                    const id = (r && (r.ruleId || r.id)) ? String(r.ruleId || r.id).trim() : '';
                    if (id) set.add(id);
                }
                return set;
            }

            // Build axe context
            const includeSel = (ctxSelector && typeof ctxSelector === 'string' && ctxSelector.trim())
                ? ctxSelector.trim()
                : 'html';

            const exclude = Array.isArray(excludeSelectorsArg)
                ? excludeSelectorsArg
                    .filter((s) => typeof s === 'string' && s.trim())
                    .map((s) => [s.trim()])
                : [];

            // Axe expects context like: { include: [['html']], exclude: [['.skip']] }
            const context = {
                include: [[includeSel]],
                exclude
            };

            // Build options
            const options = (engineOptionsArg && typeof engineOptionsArg === 'object')
                ? { ...engineOptionsArg }
                : {};

            // Support:
            // 1) native axe runOnly: { type:'tag'|'rule', values:[...] }
            // 2) our facade runOnly: { includeRuleIds?: string[], excludeRuleIds?: string[] }
            if (runOnlyArg && typeof runOnlyArg === 'object') {
                const isLegacy = (typeof runOnlyArg.type === 'string' && Array.isArray(runOnlyArg.values));

                // Support:
                // 1) native axe runOnly: { type:'tag'|'rule', values:[...] }
                // 2) our facade runOnly: { includeRuleIds?: string[], excludeRuleIds?: string[] }
                if (runOnlyArg && typeof runOnlyArg === 'object') {
                    const isLegacy = (typeof runOnlyArg.type === 'string' && Array.isArray(runOnlyArg.values));

                    // our facade shape (allow arrays or comma/newline separated strings)
                    const includeRuleIds = normalizeIdList(runOnlyArg.includeRuleIds);
                    const excludeRuleIds = normalizeIdList(runOnlyArg.excludeRuleIds);

                    // Validation mode (default: warn). Put this in engineOptions if you want:
                    // engineOptions.validateRuleIds = 'strict' | 'warn' | 'off'
                    const validateModeRaw =
                        (engineOptionsArg && typeof engineOptionsArg === 'object')
                            ? engineOptionsArg.validateRuleIds
                            : null;

                    const validateMode =
                        (typeof validateModeRaw === 'string')
                            ? validateModeRaw.toLowerCase()
                            : 'warn';

                    // Validate only if we actually got rule ids
                    if (validateMode !== 'off' && (includeRuleIds.length || excludeRuleIds.length)) {
                        const known = getKnownRuleIds();

                        const unknownInclude = includeRuleIds.filter(id => !known.has(id));
                        const unknownExclude = excludeRuleIds.filter(id => !known.has(id));

                        if (unknownInclude.length || unknownExclude.length) {
                            const msg =
                                `[axe-engine] Unknown rule ids. ` +
                                `include: ${unknownInclude.join(', ') || '(none)'}; ` +
                                `exclude: ${unknownExclude.join(', ') || '(none)'}`;

                            if (validateMode === 'strict') {
                                throw new Error(msg);
                            } else {
                                console.warn(msg);

                                // Filter unknown out so axe config stays valid
                                for (const id of unknownInclude) {
                                    const idx = includeRuleIds.indexOf(id);
                                    if (idx >= 0) includeRuleIds.splice(idx, 1);
                                }
                                for (const id of unknownExclude) {
                                    const idx = excludeRuleIds.indexOf(id);
                                    if (idx >= 0) excludeRuleIds.splice(idx, 1);
                                }
                            }
                        }
                    }

                    const blocked = new Set(excludeRuleIds);

                    // surea11y semantics: includeRuleIds decides execution set
                    if (includeRuleIds.length) {
                        const selected = includeRuleIds.filter((id) => !blocked.has(id));

                        if (selected.length) {
                            options.runOnly = { type: 'rule', values: selected };
                        } else {
                            // Nothing left to run after excludes. Avoid invalid axe config.
                            console.log('[axe-engine] no rules selected after include/exclude, skipping axe.run');
                            return {
                                __a11yEngineNoop: true,
                                reason: 'no-rules-selected',
                                url: (typeof window !== 'undefined' && window.location) ? window.location.href : null,
                                results: {
                                    passes: [],
                                    violations: [],
                                    incomplete: [],
                                    inapplicable: []
                                }
                            };
                        }
                    } else {
                        if (excludeRuleIds.length) {
                            if (!options.rules || typeof options.rules !== 'object') options.rules = {};
                            for (const id of excludeRuleIds) options.rules[id] = { enabled: false };
                        }
                        // The selection's tags, or a caller's own { type, values }.
                        if (isLegacy && runOnlyArg.values.length) {
                            options.runOnly = { type: runOnlyArg.type, values: runOnlyArg.values };
                        }
                    }
                }
            }

            // Ensure sane defaults if not provided
            if (!Array.isArray(options.resultTypes)) {
                // Keep default axe behavior if you prefer, otherwise choose:
                // options.resultTypes = ['violations', 'incomplete', 'passes', 'inapplicable'];
            }

            const collectedScans = await axe.run(context, options);

            ['violations', 'incomplete'].forEach((category) => {
                if (Array.isArray(collectedScans[category])) {
                    collectedScans[category] = collectedScans[category].slice().sort((a, b) => {
                        const ai = (a && typeof a.id === 'string') ? a.id : '';
                        const bi = (b && typeof b.id === 'string') ? b.id : '';
                        return ai.localeCompare(bi);
                    });
                }
            });

            return collectedScans;
        },
        runOnly || null,
        contextSelector || null,
        excludeSelectors || null,
        engineOptions || null
    );

    // Attach URL so postProcessResults and downstream logic can use it
    try {
        if (native && typeof native === 'object') {
            native.url = native.url || pageUrl || null;
            native.pageTitle = native.pageTitle || pageTitle || null;
        }
    } catch {}

// Optional enrichment BEFORE canonical conversion
    try {
        if (postProcess && typeof postProcess === 'object') {
            if (typeof postProcessResults === 'function' && typeof postProcess.getSuccessCriteria === 'function') {
                postProcessResults(native, { getSuccessCriteria: postProcess.getSuccessCriteria });
            }
        }
    } catch {}

// Convert to canonical here (engine owns conversion)
    const canonical = fromAxeResults(native, {
        engine: { id: ENGINE_ID, name: ENGINE_NAME, version: ENGINE_VERSION },
        page: {
            url: pageUrl || (native && native.url) || null,
            title: pageTitle || null,
            viewport: null,
            timestamp: new Date().toISOString()
        },
        scope: {
            include: contextSelector ? [String(contextSelector)] : ['html'],
            exclude: Array.isArray(excludeSelectors) ? excludeSelectors.map(String) : []
        },
        run: {
            runOnly: runOnly || null,
            engineOptions: engineOptions || {}
        },
        diagnostics: {}
    });

    return { native, canonical };
}

/**
 * Returns axe rule metadata for the current runOnly filter.
 */
async function getRulesForRunOnly(page, requestedRunOnly, { selection, wcagLevel, engineOptions } = {}) {
    await ensureInjected(page);
    const runOnly = axeRunOnly({ selection, runOnly: requestedRunOnly, wcagLevel, engineOptions }) || {};

    return await page.evaluate((runOnlyArg) => {
        const tags = runOnlyArg.type === 'tag' && Array.isArray(runOnlyArg.values) ? runOnlyArg.values : [];
        const everyRule = axe.getRules();
        const allRules = tags.length ? axe.getRules(tags) : everyRule;

        const include = Array.isArray(runOnlyArg.includeRuleIds)
            ? runOnlyArg.includeRuleIds.map(String).map((s) => s.trim()).filter(Boolean)
            : [];

        const exclude = Array.isArray(runOnlyArg.excludeRuleIds)
            ? runOnlyArg.excludeRuleIds.map(String).map((s) => s.trim()).filter(Boolean)
            : [];

        if (include.length) {
            const blocked = new Set(exclude);
            return everyRule.filter((r) => {
                const id = r.ruleId || r.id;
                return include.includes(id) && !blocked.has(id);
            });
        }

        if (exclude.length) {
            const blocked = new Set(exclude);
            return allRules.filter((r) => !blocked.has(r.ruleId || r.id));
        }

        return allRules;
    }, runOnly);
}

/**
 * Axe-specific enrichment:
 * - sort categories
 * - map SC tags
 * - add node.url and node.issueCategory
 */
function postProcessResults(collectedScans, { getSuccessCriteria } = {}) {
    if (!collectedScans || typeof collectedScans !== 'object') return collectedScans;

    ['violations', 'incomplete', 'passes'].forEach((category) => {
        if (!Array.isArray(collectedScans[category])) return;

        collectedScans[category] = sortIssues(collectedScans[category]);

        collectedScans[category].forEach((v) => {
            const currentTags = Array.isArray(v.tags) ? [...v.tags] : [];

            if (typeof getSuccessCriteria === 'function') {
                const { successCriteria, updatedTags } = getSuccessCriteria(currentTags);
                v.SC = successCriteria;
                v.tags = updatedTags;
            }

            const nodes = Array.isArray(v?.nodes) ? v.nodes : [];
            nodes.forEach((node) => {
                if (node && typeof node === 'object') {
                    node.url = collectedScans.url || null;
                    node.issueCategory = category;
                }
            });
        });
    });

    return collectedScans;

}

function getRulesCatalog() {
    const axe = require('axe-core');
    const rules =
        typeof axe.getRules === 'function'
            ? axe.getRules()
            : Array.isArray(axe.rules)
                ? axe.rules
                : [];

    const version = axe.version || null;

    const catalog = (Array.isArray(rules) ? rules : []).map((r) => ({
        ruleId: r.ruleId || r.id,
        help: r.help || '',
        description: r.description || '',
        tags: Array.isArray(r.tags) ? r.tags : [],
        helpUrl: r.helpUrl || '',
    }));

    return { version, rules: catalog };
}

function saveHtmlReport(reportModel, meta) {
    // Engine-specific report exporter, kept behind the adapter boundary.
    return saveAxeHtmlReport(reportModel, meta);
}

module.exports = {
    // engine metadata (useful for canonical results)
    engineId: ENGINE_ID,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,

    // helpers
    buildRunOnlyFromRuleIds,
    axeRunOnly,

    // execution
    ensureInjected,
    runOnPage,
    getRulesForRunOnly,

    // enrichment
    postProcessResults,

    // metadata/catalog
    getRulesCatalog,

    // report export
    saveHtmlReport,


    // capability metadata (used by UI to hide unsupported fields)
    capabilities: {
        // The conformance targets it can check (conformance-targets.js):
        // axe-core selects a WCAG version and level (its tags).
        selectsBy: 'version',
        actions: {
            a11yScan: {
                label: true,
                context: true,
                exclude: true,
                includeBestPractice: true,
                wcagLevel: true,
                timeout: true,
                heavyNodeThreshold: true,
                disableRules: false,
                waitForSelector: true,
                waitVisible: true,
                includeRuleIds: true,
                excludeRuleIds: true,
                includeTags: false,
                excludeTags: false,
                includeMode: false,
                engineMode: false,
                locale: false,
                optInRules: false,
                findingsSource: false
            }
        }
    },
};
