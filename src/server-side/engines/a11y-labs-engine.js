'use strict';

/**
 * DOM Rules Accessibility Engine Adapter (backed by surea11y)
 *
 * Supports:
 * - contextSelector
 * - excludeSelectors (subtree exclusions)
 * - selection: { version, level, profile, bestPractices }, the scan's, sent to
 *   core as runOnly.wcag and runOnly.bestPractices, or a standard as
 *   engineOptions.profile
 * - runOnly (rules on top of the selection, or a caller's own selection):
 *   - { tags: string[] } (WCAG version/level tags make a selection)
 *   - { wcag: { version, level }, bestPractices: boolean }
 *   - { includeRuleIds: string[] }
 *   - { excludeRuleIds: string[] }
 *   - legacy: { type:'tag', values:string[] }
 */

const fs = require('fs');
const path = require('path');
const { CANON_VERSION } = require('../a11y-canonical'); // for consistency
const { REPORTS_ROOT } = require('../report-paths');
const { profileId, targetLabel, CONFORMANCE_TARGETS, selectionFromRunOnly, tagsBesideSelection, splitOutcomeCounts } = require('../conformance-targets');
const { toSafeId } = require('../shared-utils');
const { elementTarget } = require('../../shared/report-format.js');
const { renderHtmlReport } = require('@surea11y/core/report');
const { normalizeOccurrenceDetails, shadowHostsOf, contextMatchNotices, collectMargins: collectResultMargins } = require('../../shared/scan-notes.js');

// surea11y public API (modular DOM rules)
const core = require('@surea11y/core');
const { ENGINE_TAG } = core;

// The standards that are not core's own come as packs (EN 301 549's,
// @surea11y/pack-en301549, and any other installed: standard-packs.js).
// Every scan is given them, and so is every catalog call, so a rule's title
// and mappings read here are the ones the scan's results carry. A standard
// is in play only under its profile (or its tag), so a WCAG scan names
// WCAG alone, and an EN 301 549 scan reports its clauses in place of WCAG's
// criteria. A pack that is not installed is left out.
const PACKS = require('../standard-packs').installedPacks();

const withPacks = (opts) => (PACKS.length ? { ...(opts && typeof opts === 'object' ? opts : {}), packs: PACKS } : opts);
const coreGetChecksCatalog = (opts) => core.getChecksCatalog(withPacks(opts));
const coreGetChecksForRunOnly = (runOnly, opts) => core.getChecksForRunOnly(runOnly, withPacks(opts));
// @surea11y/core's "getRulesCatalog" returns the composite (rollup) rules
// catalog, distinct from its atomic "getChecksCatalog". There is no
// "getCompositeRulesCatalog" export.
const coreGetCompositeRulesCatalog = (opts) => core.getRulesCatalog(withPacks(opts));
const getCheckDefById = (ruleId, opts) => core.getCheckDefById(ruleId, withPacks(opts));
// The scan itself runs through @surea11y/puppeteer, with core's
// runa11yCoreInPage (see surea11y-scan.js).
const { scanPage, scanFrames, mergeFrameResults, captureScreenshots, coreHooksFrom, installCoreHooks } = require('./surea11y-scan');
const { getScanNotes } = require('@surea11y/puppeteer');
const { elementScreenshotOf, elementStateScreenshotsOf } = require('../element-screenshots');

const ENGINE_ID = 'surea11y';
const ENGINE_NAME = 'surea11y';
const DEFAULT_LOCALE = 'en';
// Read from the installed @surea11y/core package instead of a hand-maintained
// constant, so this can't silently drift out of sync with the actual dependency.
let ENGINE_VERSION = null;
try { ENGINE_VERSION = require('@surea11y/core/package.json').version || null; } catch {}

/**
 * Normalizes severity strings coming from @surea11y/core's rule catalog / check
 * results into the canonical set (critical/serious/moderate/minor/info), the same
 * way canonical-shared.js does. An unrecognized spelling
 * would otherwise fall through to the generic default weight and could fail
 * canonical validation.
 */
function normalizeSeverity(sev) {
    const v = String(sev || '').toLowerCase();
    if (v === 'critical' || v === 'serious' || v === 'moderate' || v === 'minor' || v === 'info') return v;
    if (v === 'severe') return 'serious';
    if (v === 'low') return 'minor';
    if (v === 'medium') return 'moderate';
    if (v === 'informational') return 'info';
    return 'moderate';
}

// Why frames were left out, one part per reason, most first: how many, and
// the addresses that say which (an about:blank says nothing, so it is not
// listed). "3 of the page's 4 iframes were left out: 2 show nothing; 1 is
// not shown on the page, or an open dialog covers it."
const FRAME_LEFT_OUT_WHY = {
    hidden: ['is not shown on the page, or an open dialog covers it', 'are not shown on the page, or an open dialog covers them'],
    excluded: ['is excluded by the scan', 'are excluded by the scan'],
    'outside-scope': ["is outside the scan's Include", "are outside the scan's Include"],
    empty: ['shows nothing', 'show nothing'],
};

function framesLeftOutMessage(skipped, total) {
    const byReason = new Map();
    for (const f of skipped) {
        if (!byReason.has(f.skipped)) byReason.set(f.skipped, []);
        byReason.get(f.skipped).push(f);
    }
    const parts = [...byReason.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([reason, frames]) => {
            const n = frames.length;
            const why = FRAME_LEFT_OUT_WHY[reason] || [`(${reason})`, `(${reason})`];
            const urls = [...new Set(frames.map((f) => f.url).filter((u) => u && !/^about:/i.test(u)))];
            const named = urls.length ? ` (${urls.slice(0, 3).join(', ')}${urls.length > 3 ? ', …' : ''})` : '';
            return `${n} ${n === 1 ? why[0] : why[1]}${named}`;
        });
    return `${skipped.length} of the page's ${total} iframes ${skipped.length === 1 ? 'was' : 'were'} left out: ${parts.join('; ')}.`;
}

function normalizeOccurrenceOutcome(outcome, fallbackOutcome) {
    const own = String(outcome || '').trim();
    if (own === 'fail' || own === 'cantTell') return own;
    // An element its own scan passed (a frame's note, or a rollup's own
    // profiles' verdict) is no failure of the rule's merged outcome.
    if (own === 'pass' || own === 'notApplicable') return null;
    const fallback = String(fallbackOutcome || '').trim();
    if (fallback === 'fail' || fallback === 'cantTell') return fallback;
    return null;
}

/**
 * The engine's own "what to do about it" line for an occurrence. Several rules
 * leave it empty, so an empty or whitespace-only hint is treated as absent.
 */
function normalizeHint(hint) {
    return typeof hint === 'string' && hint.trim() ? hint.trim() : null;
}

/**
 * Keeps the part of an occurrence's uncertainty block the UI can use: the
 * category code and, when the rule gave one, what a person needs to check to
 * settle it. The engine only attaches this to can't-tell occurrences.
 */
function normalizeUncertainty(u) {
    if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
    const code = typeof u.code === 'string' ? u.code.trim() : '';
    if (!code) return null;
    const out = { code };
    if (typeof u.needed === 'string' && u.needed.trim()) out.needed = u.needed.trim();
    return out;
}

const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Which way a can't-tell occurrence's evidence points (core 1.14): `toward`
 * 'fail' or 'pass', `why`, the `signals` it read, what could make it wrong
 * (`caution`), and, once core counted it on enough W3C ACT test cases, how
 * often a lean of its kind was right (`measured`). The outcome stays
 * cantTell; a lean only orders the review.
 */
function normalizeLean(lean) {
    if (!lean || typeof lean !== 'object' || Array.isArray(lean)) return null;
    if (lean.toward !== 'fail' && lean.toward !== 'pass') return null;
    const out = { toward: lean.toward };
    const why = textOrNull(lean.why);
    if (why) out.why = why;
    const caution = textOrNull(lean.caution);
    if (caution) out.caution = caution;
    const signals = Array.isArray(lean.signals) ? lean.signals.map(textOrNull).filter(Boolean) : [];
    if (signals.length) out.signals = signals;
    const m = lean.measured;
    if (m && Number.isInteger(m.agreed) && Number.isInteger(m.cases) && m.cases > 0) {
        out.measured = { agreed: m.agreed, cases: m.cases };
        if (textOrNull(m.corpus)) out.measured.corpus = m.corpus.trim();
        if (textOrNull(m.coreVersion)) out.measured.coreVersion = m.coreVersion.trim();
    }
    return out;
}

/**
 * The steps that answer a can't-tell occurrence (core 1.14, added in Node by
 * the binding), with what a person sees if it passes and if it fails, in the
 * scan's locale.
 */
function normalizeHowToCheck(h) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
    const steps = Array.isArray(h.steps) ? h.steps.map(textOrNull).filter(Boolean) : [];
    const passWhen = textOrNull(h.passWhen);
    const failWhen = textOrNull(h.failWhen);
    if (!steps.length && !passWhen && !failWhen) return null;
    return { steps, ...(passWhen ? { passWhen } : {}), ...(failWhen ? { failWhen } : {}) };
}

/**
 * Languages @surea11y/core has translations for. Findings, rule titles and
 * WCAG rollups come back in the chosen one; anything else falls back to
 * English.
 */
const LOCALES = Object.freeze({
    en: 'English',
    de: 'Deutsch',
    es: 'Español',
    fr: 'Français',
    ja: '日本語'
});

// Core reports the locale as { requested, resolved, reason }. Older versions
// gave a plain string.
function resolvedLocaleOf(engineOutput) {
    const loc = engineOutput && engineOutput.engine ? engineOutput.engine.locale : null;
    const v = loc && typeof loc === 'object' ? loc.resolved : loc;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/* =========================
 * Tag helpers
 * ========================= */

function normalizeTagsList(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof tags === 'string') return tags.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}

/**
 * Normalize ruleIds list (accept array or comma-separated string)
 */
function normalizeRuleIdsList(ruleIds) {
    if (!ruleIds) return [];
    if (Array.isArray(ruleIds)) return ruleIds.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof ruleIds === 'string') return ruleIds.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}

function normalizeIncludeMode(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'and' || s === 'intersection') return 'and';
    if (s === 'or' || s === 'union') return 'or';
    return null; // means "engine default"
}

function normalizeObjectArray(list) {
    return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : [];
}

/**
 * Derive WCAG SC ids (e.g. ["1.1.1","4.1.2"]) from:
 * - normativeMappings (preferred for enforced requirements)
 * - informativeReferences (useful for manual rules so UI still shows relevant SC)
 *
 * Keep it deterministic: stable order + unique.
 */
function deriveWcagScFromMappings(metaOrDef, { includeInformative = true } = {}) {
    const nm = normalizeObjectArray(metaOrDef && metaOrDef.normativeMappings);
    const ir = normalizeObjectArray(metaOrDef && metaOrDef.informativeReferences);

    const out = [];

    for (const m of nm) {
        if (String(m.standard || '').toUpperCase() === 'WCAG' && m.requirement) {
            out.push(String(m.requirement).trim());
        }
    }

    if (includeInformative) {
        for (const r of ir) {
            if (String(r.standard || '').toUpperCase() === 'WCAG' && r.requirement) {
                out.push(String(r.requirement).trim());
            }
        }
    }

    // unique + stable
    const seen = new Set();
    const uniq = [];
    for (const sc of out) {
        const key = sc.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            uniq.push(sc);
        }
    }

    // optional: sort numerically-ish for nicer UI
    uniq.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    return uniq;
}

/**
 * `sc` keeps informative references so the UI still shows relevant criteria for
 * manual rules; `scNormative` is the subset the rule actually enforces, which is
 * what coverage and scoring must use to avoid over-attributing criteria.
 */
function deriveWcagScPair(metaOrDef) {
    return {
        sc: deriveWcagScFromMappings(metaOrDef, { includeInformative: true }),
        scNormative: deriveWcagScFromMappings(metaOrDef, { includeInformative: false })
    };
}

/* =========================
 * Rule catalog
 * ========================= */

function getRulesCatalog() {
    const rules = coreGetChecksCatalog();
    return {
        version: ENGINE_VERSION,
        rules: Array.isArray(rules) ? rules : []
    };
}

function getAllRuleIds() {
    const rules = coreGetChecksCatalog();
    const list = Array.isArray(rules) ? rules : [];
    return list.map((r) => r.ruleId).filter(Boolean);
}

/**
 * Whether core would recognise this id in runOnly: a check, a rollup (for
 * these options, so a standard's own rollups count under its profile) or a
 * custom rule, with or without the engine's tag as a prefix.
 */
function makeKnownRuleIdTest(engineOptions) {
    const ids = new Set(getAllRuleIds().map(String));
    const composites = typeof coreGetCompositeRulesCatalog === 'function' ? coreGetCompositeRulesCatalog(engineOptions) : [];
    for (const r of Array.isArray(composites) ? composites : []) if (r && r.id) ids.add(String(r.id));
    const custom = engineOptions && Array.isArray(engineOptions.customRules) ? engineOptions.customRules : [];
    for (const r of custom) if (r && typeof r.id === 'string' && r.id.trim()) ids.add(r.id.trim());
    const prefix = String(ENGINE_TAG || '') + '-';
    return (id) => {
        const v = String(id);
        return ids.has(v) || ids.has(prefix + v) || (v.startsWith(prefix) && ids.has(v.slice(prefix.length)));
    };
}

/**
 * Every rule id a scan step may name for surea11y besides its checks: the
 * rollups, and each check and rollup with the engine's prefix, which core
 * accepts too. For the step editor's check of typed ids.
 */
function getSelectableRuleIds() {
    const ids = new Set(getAllRuleIds().map(String));
    const composites = typeof coreGetCompositeRulesCatalog === 'function' ? coreGetCompositeRulesCatalog() : [];
    for (const r of Array.isArray(composites) ? composites : []) if (r && r.id) ids.add(String(r.id));
    const prefix = String(ENGINE_TAG || '') + '-';
    for (const id of Array.from(ids)) ids.add(prefix + id);
    return Array.from(ids);
}

function getAllTags() {
    const rules = coreGetChecksCatalog();
    const list = Array.isArray(rules) ? rules : [];
    const set = new Set();
    for (const r of list) {
        const tags = Array.isArray(r.tags) ? r.tags : [];
        for (const t of tags) set.add(String(t));
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/* =========================
 * Opt-in rules
 * ========================= */

// Core keeps some rules off by default because they check a requirement only
// one standard makes, and that standard is not one this lab offers (RGAA's
// doctype, or its ban on <center>). The lab turns include tags into rule ids
// before calling core, so it applies the same gate itself, and never lifts
// it: those rules, and their rollups, never run here.

function ruleIdsOf(list) {
    return new Set((Array.isArray(list) ? list : []).map((r) => r && r.ruleId).filter(Boolean).map(String));
}

let defaultRuleIdsCache = null;
function defaultRuleIds() {
    if (!defaultRuleIdsCache) defaultRuleIdsCache = ruleIdsOf(coreGetChecksForRunOnly(null, {}));
    return defaultRuleIdsCache;
}

/** Whether core leaves this rule out of a run that does not ask for it. */
function isOptInRule(rule) {
    return !!(rule && rule.ruleId) && !defaultRuleIds().has(String(rule.ruleId));
}

let gatedRuleTagsCache = null;
/**
 * The rule tags of the rules core keeps off (['rgaa'] today): a tag that
 * would select them only, which a scan's tags must not pass on. Each
 * standard's own rollups carry its tag and nothing else, so they are read
 * from the rollups unlocking them would add to core's catalog.
 */
function gatedRuleTags() {
    if (gatedRuleTagsCache) return gatedRuleTagsCache;
    if (typeof coreGetCompositeRulesCatalog !== 'function') return [];
    const idOf = (r) => String((r && (r.id || r.ruleId)) || '');
    const base = new Set(coreGetCompositeRulesCatalog({}).map(idOf));
    const tags = new Set();
    for (const r of coreGetCompositeRulesCatalog({ optInRules: 'all' })) {
        if (base.has(idOf(r))) continue;
        for (const t of (r && r.meta && Array.isArray(r.meta.tags) ? r.meta.tags : [])) tags.add(String(t).toLowerCase());
    }
    gatedRuleTagsCache = [...tags].sort();
    return gatedRuleTagsCache;
}

/**
 * The rules a scan with this runOnly, WCAG level and engine options runs:
 * the same selection the scan hands core (its conformance target and
 * opt-in rules included), so the list recorded beside a scan matches what
 * the scan ran.
 */
async function getRulesForRunOnly(_page, runOnly, { selection, wcagLevel = null, engineOptions = null } = {}) {
    // Prefer core implementation if present; fallback to local filtering.
    if (typeof coreGetChecksForRunOnly === 'function') {
        const { cfg, requestedProfile } = normalizeScanConfig(withSelectionProfile(engineOptions, selection));
        const { runOnlyForCore, noKnownRuleIncluded, wcagVersion: targetVersion, wcagLevel: targetLevel } =
            resolveRunSelection({ selection, runOnly, wcagLevel, cfg, requestedProfile });
        if (noKnownRuleIncluded) return [];
        applyTargetToOptions(cfg, { wcagVersion: targetVersion, wcagLevel: targetLevel });
        const rules = coreGetChecksForRunOnly(runOnlyForCore, cfg);
        return Array.isArray(rules) ? rules.map(projectRule) : [];
    }

    const rules = coreGetChecksCatalog();
    const list = Array.isArray(rules) ? rules : [];
    return list.map(projectRule);

    function projectRule(r) {
        return {
            ruleId: r.ruleId,
            help: r.title,
            description: r.description,
            tags: Array.isArray(r.tags) ? r.tags : [],
            helpUrl: r.helpUrl || null,
            category: r.category || null,
            type: r.type || 'automatic',
            defaultSeverity: r.defaultSeverity || 'moderate',
            defaultConfidence: r.defaultConfidence || 'medium',

            normativeMappings: normalizeObjectArray(r.normativeMappings),
            informativeReferences: normalizeObjectArray(r.informativeReferences),

            wcag: deriveWcagScPair(r)
        };
    }
}

function projectRule(r) {
    return {
        ruleId: r.ruleId,
        help: r.title,
        description: r.description,
        tags: Array.isArray(r.tags) ? r.tags : [],
        helpUrl: r.helpUrl || null,
        category: r.category || null,
        type: r.type || 'automatic',
        defaultSeverity: r.defaultSeverity || 'moderate',
        defaultConfidence: r.defaultConfidence || 'medium'
    };
}

/* =========================
 * Confidence mapping helper
 * ========================= */

function mapConfidenceNumeric(confString, outcome) {
    const c = typeof confString === 'string' ? confString.toLowerCase() : null;
    if (c === 'high') return 0.95;
    if (c === 'medium') return 0.75;
    if (c === 'low') return 0.4;

    if (outcome === 'cantTell') return 0.6;
    if (outcome === 'notApplicable') return 0.9;
    return 0.9;
}

function deriveWcagScFromCompositeResult(cr) {
    // Prefer normativeMappings if present (consistent with atomic)
    const fromMappings = deriveWcagScPair(cr && cr.meta ? cr.meta : cr);
    if (fromMappings.sc.length) return fromMappings;

    // Fallback: some composites carry SC list in data.details.wcagSc
    const wcagSc = cr && cr.data && cr.data.details && Array.isArray(cr.data.details.wcagSc)
        ? cr.data.details.wcagSc.map(String).map(s => s.trim()).filter(Boolean)
        : [];

    const seen = new Set();
    const out = [];
    for (const sc of wcagSc) {
        const k = sc.toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push(sc); }
    }
    out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    // A composite rollup names the criterion it rolls up, so this fallback is normative.
    return { sc: out, scNormative: out.slice() };
}

function toCompositeCanonicalFinding(cr, {
    outcomeOverride = null,
    checksIdsOverride = null,
    contributorsOverride = null
} = {}) {
    const ruleId = String(cr && cr.ruleId ? cr.ruleId : '').trim();
    if (!ruleId) return null;

    const details = (cr && cr.data && cr.data.details && typeof cr.data.details === 'object')
        ? cr.data.details
        : {};

    const contributors = Array.isArray(details.contributors) ? details.contributors : [];
    const contributorTestIds = contributors
        .filter(x => x && typeof x === 'object' && x.testId)
        .map(x => String(x.testId).trim())
        .filter(Boolean);

    const outcome = outcomeOverride || cr.outcome || 'cantTell';

    const confidenceLabel = (typeof cr.confidence === 'string') ? cr.confidence : 'medium';
    const numericConfidence = mapConfidenceNumeric(confidenceLabel, outcome);

    const checksIdsFinal = Array.isArray(checksIdsOverride)
        ? checksIdsOverride.slice()
        : (Array.isArray(details.checksIds) ? details.checksIds.slice() : contributorTestIds.slice());

    const contributorsFinal = Array.isArray(contributorsOverride)
        ? contributorsOverride.slice()
        : contributors.slice();

    return {
        id: ruleId,
        uid: `${ENGINE_ID}:${outcome}:${ruleId}`,
        ruleId,

        provenance: {
            engineId: ENGINE_ID,
            engineName: ENGINE_NAME,
            engineVersion: ENGINE_VERSION
        },

        title: cr.title || ruleId,
        description: cr.description || null,
        helpUrl: cr.helpUrl || null,

        outcome,
        severity: normalizeSeverity(cr.severity),
        confidence: numericConfidence,
        confidenceLabel,
        type: cr.type || 'automatic',
        tags: Array.isArray(cr.tags) ? cr.tags.slice() : [ENGINE_TAG],

        wcag: deriveWcagScFromCompositeResult(cr),

        standards: {
            normativeMappings: normalizeObjectArray(cr && cr.meta ? cr.meta.normativeMappings : cr && cr.normativeMappings),
            informativeReferences: normalizeObjectArray(cr && cr.meta ? cr.meta.informativeReferences : cr && cr.informativeReferences)
        },

        // IMPORTANT: composites still have no DOM nodes in this action
        occurrences: [],

        evidence: {
            rollup: {
                reasonCode: details.reasonCode || null,
                // A scan of several profiles: those that gave this rollup,
                // whose verdicts on its elements are its own.
                ...(Array.isArray(cr && cr.profiles) && cr.profiles.length ? { profiles: cr.profiles.map(String) } : {}),
                checksIds: checksIdsFinal,
                contributors: contributorsFinal.map(x => ({
                    testId: String(x && x.testId ? x.testId : '').trim(),
                    outcome: String(x && x.outcome ? x.outcome : '').trim(),
                    ...(x && x.notSelected === true ? { notSelected: true } : {}),
                    // A standard's rollup that judges the rule by its
                    // findings' reason codes (core 1.15): what it made of
                    // each finding, in the rule's order.
                    ...(x && Array.isArray(x.findingOutcomes)
                        ? { findingOutcomes: x.findingOutcomes.map((o) => (o === 'fail' || o === 'cantTell' ? o : null)) }
                        : {})
                })).filter(x => x.testId)
            }
        },

        i18n: cr.i18n || null,

        // Ensure composites are always classifiable by meta.atomic === false
        meta: (() => {
            const m = (cr && cr.meta && typeof cr.meta === 'object') ? { ...cr.meta } : {};
            m.atomic = false;
            return m;
        })()
    };
}

const VERDICT_RANK = { notApplicable: 0, pass: 1, cantTell: 2, fail: 3 };

/**
 * The worst of an element's verdicts under some profiles ({ [profile]:
 * outcome }), as an occurrence's outcome (fail, cantTell or pass), or null
 * when they say nothing of it.
 */
function ownVerdict(verdicts, profiles) {
    if (!verdicts || typeof verdicts !== 'object' || !Array.isArray(profiles) || !profiles.length) return null;
    let worst = null;
    for (const p of profiles) {
        const v = verdicts[p];
        if (VERDICT_RANK[v] === undefined) continue;
        if (!worst || VERDICT_RANK[v] > VERDICT_RANK[worst]) worst = v;
    }
    return worst === 'fail' || worst === 'cantTell' || worst === 'pass' ? worst : null;
}

// What one check of a rollup said about an element: an entry of the
// occurrence's `checks` when more than one check flagged that element.
const CHECK_FIELDS = ['failureSummary', 'details', 'hint', 'uncertainty', 'lean', 'howToCheck'];

function checkEntryOf(occ, checkId) {
    const entry = { checkId };
    for (const k of CHECK_FIELDS) {
        if (occ && occ[k] !== undefined && occ[k] !== null && occ[k] !== '') entry[k] = occ[k];
    }
    return entry;
}

/**
 * A rollup's occurrences, from the occurrences of its checks: one per element
 * (page, shadow hosts, selector) and outcome. An element two checks flagged,
 * such as an option holding a link (nested-interactive-controls-absent and
 * presentational-children-focusable-absent), is one occurrence: its own fields
 * are the first check's, `sourceAtomicRules` names every check, and `checks`
 * holds what each of them said. Counting it once per check overstated the
 * rollup's occurrences and gave two occurrences the same occurrenceId.
 */
function attachCompositeOccurrencesFromAtomicFindings(compositeFindings, atomicFindings) {
    if (!Array.isArray(compositeFindings) || !compositeFindings.length) return;
    if (!Array.isArray(atomicFindings) || !atomicFindings.length) return;

    // Index atomic findings by ruleId
    const atomicByRuleId = new Map();
    for (const f of atomicFindings) {
        if (!f || !f.ruleId) continue;
        if (f.meta && f.meta.atomic === false) continue; // skip composites if any
        atomicByRuleId.set(String(f.ruleId), f);
    }

    function elementKey(occ) {
        const pageUrl = (occ && occ.pageUrl) ? String(occ.pageUrl) : '';
        // Its target after the shadow hosts and frames it is inside.
        const target = elementTarget(occ);
        // An element without a selector is told apart by its markup.
        const html = target ? '' : ((occ && occ.html) ? String(occ.html) : '');
        const tier = (occ && occ.occurrenceOutcome) ? String(occ.occurrenceOutcome) : '';
        return `${pageUrl}::${target}::${html}::${tier}`;
    }

    for (const f of compositeFindings) {
        if (!f) continue;
        if (!f.meta || f.meta.atomic !== false) continue; // composites only

        const rollup = f.evidence && f.evidence.rollup ? f.evidence.rollup : null;
        if (!rollup) continue;

        const checksIds = Array.isArray(rollup.checksIds) ? rollup.checksIds : [];
        if (!checksIds.length) continue;

        const out = [];
        const byElement = new Map();
        // Elements its checks counted and did not list (their unlisted).
        let unlisted = 0;

        for (const idRaw of checksIds) {
            const id = String(idRaw || '').trim();
            if (!id) continue;

            const atomic = atomicByRuleId.get(id);
            if (atomic && Number(atomic.unlisted) > 0) unlisted += Number(atomic.unlisted);
            if (!atomic || !Array.isArray(atomic.occurrences) || !atomic.occurrences.length) continue;
            const checkId = atomic.ruleId ? String(atomic.ruleId) : id;

            // A standard that judges the rule by its findings' reason codes
            // says what each one is under it: a WCAG question it is certain
            // of is a failure here, and one it doesn't count is left out.
            const contributor = (Array.isArray(rollup.contributors) ? rollup.contributors : [])
                .find((c) => c && c.testId === id);
            const verdicts = contributor && Array.isArray(contributor.findingOutcomes)
                && contributor.findingOutcomes.length === atomic.occurrences.length
                ? contributor.findingOutcomes
                : null;

            for (const [i, occ] of atomic.occurrences.entries()) {
                const verdict = verdicts ? verdicts[i] : undefined;
                if (verdicts && !verdict) continue;
                if (verdict && f.outcome && verdict !== f.outcome) continue;
                const occ2 = Object.assign({}, occ, {
                    outcome: f.outcome || undefined,
                    atomicCheckId: checkId,
                    sourceAtomicRules: [checkId]
                });
                // A scan of several profiles: the element is what this
                // rollup's own profiles make of it, not the worst of every
                // profile's. A WCAG criterion keeps asking about an element
                // WAI-ARIA fails.
                const own = ownVerdict(occ.verdicts, rollup.profiles);
                if (own && own !== occ2.occurrenceOutcome) occ2.occurrenceOutcome = own;
                if (verdict === 'fail' && occ2.occurrenceOutcome !== 'fail') {
                    occ2.occurrenceOutcome = 'fail';
                    delete occ2.uncertainty;
                    delete occ2.lean;
                    delete occ2.howToCheck;
                }

                // One occurrence per element (and outcome): another check
                // flagging it adds what that check said to its `checks`.
                const k = elementKey(occ2);
                const seen = byElement.get(k);
                if (!seen) {
                    byElement.set(k, { occ: occ2, first: occ2 });
                    out.push(occ2);
                    continue;
                }
                const base = seen.occ;
                if (base.sourceAtomicRules.includes(checkId)) continue;
                if (!base.checks) base.checks = [checkEntryOf(seen.first, base.atomicCheckId)];
                base.checks.push(checkEntryOf(occ2, checkId));
                base.sourceAtomicRules = base.sourceAtomicRules.concat(checkId);
                // A picture from a later check, where the first had none.
                if (!base.elementScreenshot && occ2.elementScreenshot) base.elementScreenshot = occ2.elementScreenshot;
            }
        }

        f.occurrences = out;
        if (unlisted) f.unlisted = unlisted;
        else delete f.unlisted;
    }
}

/* =========================
 * Adapter API
 * ========================= */

async function ensureInjected(_page) {
    // No script injection needed: @surea11y/puppeteer sends the scan into the page
    return;
}

function postProcessResults(nativeResults, _ctx = {}) {
    return nativeResults;
}

/**
 * Normalize incoming runOnly (accept both legacy and modern shapes).
 *
 * NOTE:
 * We always normalize to the MODERN shape expected by surea11y:
 *   { tags: string[], includeRuleIds: string[], excludeRuleIds: string[] }
 *
 * Legacy input shape supported for backwards compat:
 *   { type:'tag', values:string[] }
 */
function normalizeRunOnlyInput(runOnly) {
    if (!runOnly || typeof runOnly !== 'object') return null;

    // Legacy shape: { type:'tag', values:[...] } or values:"a,b"
    // Convert to modern shape so downstream is consistent.
    if (runOnly.type === 'tag') {
        const values = Array.isArray(runOnly.values)
            ? runOnly.values
            : typeof runOnly.values === 'string'
                ? String(runOnly.values).split(',')
                : [];

        const tags = values.map(String).map(s => s.trim()).filter(Boolean);

        return {
            tags,
            includeTags: normalizeTagsList(runOnly.includeTags),
            excludeTags: normalizeTagsList(runOnly.excludeTags),
            includeRuleIds: normalizeRuleIdsList(runOnly.includeRuleIds),
            excludeRuleIds: normalizeRuleIdsList(runOnly.excludeRuleIds),
            includeMode: normalizeIncludeMode(runOnly.includeMode)
        };
    }

    // Modern shape: { tags/includeRuleIds/excludeRuleIds + excludeTags + includeMode }
    const tags = normalizeTagsList(runOnly.tags); // standard tags (wcag/best-practice)
    const includeTags = normalizeTagsList(runOnly.includeTags);
    const excludeTags = normalizeTagsList(runOnly.excludeTags);

    const includeRuleIds = normalizeRuleIdsList(runOnly.includeRuleIds);
    const excludeRuleIds = normalizeRuleIdsList(runOnly.excludeRuleIds);

    const includeMode = normalizeIncludeMode(runOnly.includeMode);

    // Core's own conformance target and best-practice switch, passed through.
    const wcag = normalizeWcagTarget(runOnly.wcag);
    const bestPractices = runOnly.bestPractices === true;

    if (
        !wcag &&
        !bestPractices &&
        !tags.length &&
        !includeTags.length &&
        !excludeTags.length &&
        !includeRuleIds.length &&
        !excludeRuleIds.length
    ) return null;

    return { tags, includeTags, excludeTags, includeRuleIds, excludeRuleIds, includeMode, wcag, bestPractices };
}

/** { version, level } as core takes it, or null. Core validates the values. */
function normalizeWcagTarget(v) {
    if (!v || typeof v !== 'object') return null;
    const version = v.version == null ? '' : String(v.version).trim();
    const level = v.level == null ? '' : String(v.level).trim().toUpperCase();
    return (version || level) ? { version, level } : null;
}

/**
 * The scan's selection ({ version, level, profile, bestPractices }), or, from
 * a caller that gives none, the one its WCAG tags, level and standard come to.
 */
function resolveSelection({ selection, runOnly, wcagLevel, profile }) {
    if (selection !== undefined) return selection;
    // A caller's own runOnly.wcag, the scan's level setting its level.
    const own = runOnly && typeof runOnly === 'object' ? normalizeWcagTarget(runOnly.wcag) : null;
    if (own && !profile) {
        const level = typeof wcagLevel === 'string' && ['A', 'AA', 'AAA'].includes(wcagLevel.trim().toUpperCase())
            ? wcagLevel.trim().toUpperCase()
            : own.level;
        return { version: own.version, level, profile: null, bestPractices: runOnly.bestPractices === true };
    }
    return selectionFromRunOnly({ runOnly, wcagLevel, profile });
}

/**
 * The engine options with the selection's standard, as core's profile, or
 * its profiles, every one of them, for a scan of several at once.
 */
function withSelectionProfile(engineOptions, selection) {
    const several = selection && Array.isArray(selection.profiles) && selection.profiles.length > 1;
    if (!selection || (!selection.profile && !several)) return engineOptions;
    return {
        ...(engineOptions && typeof engineOptions === 'object' ? engineOptions : {}),
        profile: several ? selection.profiles.slice() : selection.profile,
    };
}

const OUTCOMES_KNOWN = new Set(['fail', 'cantTell', 'pass', 'notApplicable']);

/** A result's or element's verdict per profile, { [profile]: outcome }, or null. */
function verdictsOf(x) {
    const v = x && x.verdicts;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out = {};
    for (const [id, outcome] of Object.entries(v)) {
        if (OUTCOMES_KNOWN.has(outcome)) out[String(id)] = outcome;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * The profiles a scan of several ran, as { id, label }, in order (core's
 * engine.profiles), or null for a scan of one.
 */
function appliedProfiles(engineOutput) {
    const list = engineOutput && engineOutput.engine && Array.isArray(engineOutput.engine.profiles)
        ? engineOutput.engine.profiles.map(profileId).filter(Boolean)
        : [];
    return list.length > 1 ? list.map((id) => ({ id, label: targetLabel(id) || id })) : null;
}

/** The profiles a scan of several did not run, as { id, label, reason }. */
function profilesNotRunOf(engineOutput) {
    const raw = engineOutput && engineOutput.engine && Array.isArray(engineOutput.engine.profilesNotRun)
        ? engineOutput.engine.profilesNotRun
        : [];
    return raw
        .filter((p) => p && typeof p.profile === 'string')
        .map((p) => {
            const id = p.profile.trim().toLowerCase();
            return { id, label: targetLabel(id) || id, reason: typeof p.reason === 'string' ? p.reason : null };
        });
}

const NOT_RUN_REASONS = {
    'unknown-profile': (label) => `This surea11y release has no ${label} profile, so the scan did not check against it.`,
    'pack-skipped': (label) => `${label}'s pack did not load, so the scan did not check against it.`,
    'overridden-by-selection': (label) => `The step's own rules or tags chose what ran, so the scan did not check against ${label}.`,
};

/** A notice for each profile a scan of several did not run. */
function profilesNotRunNotices(engineOutput) {
    // A WCAG level the step's own rules overrode still judges them: only the
    // standards did not run.
    return profilesNotRunOf(engineOutput)
        .filter((p) => !(p.reason === 'overridden-by-selection' && /^wcag22-a{1,3}$/.test(p.id)))
        .map((p) => ({
            engineId: ENGINE_ID,
            code: 'profile-not-run',
            profile: p.id,
            message: (NOT_RUN_REASONS[p.reason] || ((label) => `The scan did not check against ${label}.`))(p.label),
        }));
}

/**
 * The engine options a scan runs with: the locale defaulted, the
 * conformance target and opt-in rules normalized.
 * -> { cfg, requestedProfile, requestedProfiles }: requestedProfile the one
 *    profile, or the first of several; requestedProfiles all of them when
 *    there are several, else null.
 */
function normalizeScanConfig(engineOptions) {
    const cfg = (engineOptions && typeof engineOptions === 'object') ? { ...engineOptions } : {};
    if (!cfg.locale || !String(cfg.locale).trim()) {
        cfg.locale = DEFAULT_LOCALE;
    } else {
        cfg.locale = String(cfg.locale).trim();
    }
    // A conformance target replaces the WCAG level tags: core only applies a
    // profile when nothing in runOnly includes rules, so the level-derived
    // `tags` are dropped here. Explicit rule ids or include tags still win,
    // and core then reports no profile, which is what the scan records.
    // A list of profiles is a scan of all of them at once, in that order.
    const list = [];
    for (const p of Array.isArray(cfg.profile) ? cfg.profile : [cfg.profile]) {
        const id = profileId(p);
        if (id && !list.includes(id)) list.push(id);
    }
    const requestedProfile = list[0] || null;
    const requestedProfiles = list.length > 1 ? list : null;
    if (requestedProfiles) cfg.profile = requestedProfiles;
    else if (requestedProfile) cfg.profile = requestedProfile;
    else delete cfg.profile;

    // Rules core keeps off stay off (see isOptInRule).
    delete cfg.optInRules;
    return { cfg, requestedProfile, requestedProfiles };
}

/**
 * The version and level of a target that stepped aside for the step's own
 * rules, as core's options: the scan is still judged by them (the criteria
 * core reports), without them adding the target's rules. A caller's own
 * options win.
 */
function applyTargetToOptions(cfg, { wcagVersion = null, wcagLevel = null } = {}) {
    if (wcagVersion && !cfg.wcagVersion) cfg.wcagVersion = wcagVersion;
    if (wcagLevel && !cfg.wcagLevel) cfg.wcagLevel = wcagLevel;
}

/**
 * The rule selection a scan hands core: the step's runOnly with the WCAG
 * level and conformance target applied, include and exclude
 * tags turned into rule ids, and the rule ids surea11y lacks left out.
 * Shared by the scan and by the rule list recorded for it, so the two agree.
 * -> { normalizedRunOnly, effectiveRunOnly, runOnlyForCore,
 *      unknownRuleIds: { include, exclude }, noKnownRuleIncluded,
 *      unmatchedIncludeTags: the include tags that selected no rule, or null,
 *      wcagVersion, wcagLevel: the version and level for core's options when
 *      the target stepped aside for the step's own rules, else null }
 */
function resolveRunSelection({ selection, runOnly, wcagLevel, cfg, requestedProfile }) {
    const normalizedRunOnly = normalizeRunOnlyInput(runOnly);
    const sel = resolveSelection({ selection, runOnly, wcagLevel, profile: requestedProfile });

    let effectiveRunOnly = normalizedRunOnly ? { ...normalizedRunOnly } : null;
    const unknownRuleIds = { include: [], exclude: [] };
    let noKnownRuleIncluded = false;
    let wcagVersion = null;
    let targetLevel = null;
    let unmatchedIncludeTags = null;
    // The scan's selection goes to core as its WCAG target, which leaves out
    // 4.1.1 under 2.2 and counts each criterion at its level in that version,
    // and best-practices as core's own switch. The version/level tags and
    // best-practice a caller may also give stand for the same thing.
    if (sel) {
        if (!effectiveRunOnly) effectiveRunOnly = normalizeRunOnlyInput({ wcag: sel }) || {};
        effectiveRunOnly.tags = tagsBesideSelection({ tags: effectiveRunOnly.tags });
        effectiveRunOnly.wcag = { version: sel.version, level: sel.level };
        effectiveRunOnly.bestPractices = sel.bestPractices === true;
    }
    // A standard is core's profile, which applies only when nothing in runOnly
    // includes rules of its own. Best-practices add to it, as to a target.
    if (requestedProfile && effectiveRunOnly) {
        effectiveRunOnly.tags = [];
        effectiveRunOnly.wcag = null;
    }
    if (effectiveRunOnly) {
        const catalog = Array.isArray(coreGetChecksCatalog()) ? coreGetChecksCatalog() : [];

        const includeTags = Array.isArray(effectiveRunOnly.includeTags) ? effectiveRunOnly.includeTags : [];
        const excludeTags = Array.isArray(effectiveRunOnly.excludeTags) ? effectiveRunOnly.excludeTags : [];

        const includeMode = effectiveRunOnly.includeMode || null; // 'and' | 'or' | null (default)

        // Helper: does a rule match the includeTags?
        function matchesIncludeTags(ruleTags) {
            if (!includeTags.length) return true; // no include filter
            const set = new Set((Array.isArray(ruleTags) ? ruleTags : []).map(t => String(t).toLowerCase()));
            if (includeMode === 'and') {
                return includeTags.every(t => set.has(String(t).toLowerCase()));
            }
            // default + 'or'
            return includeTags.some(t => set.has(String(t).toLowerCase()));
        }

        // Helper: should a rule be excluded by excludeTags?
        function matchesExcludeTags(ruleTags) {
            if (!excludeTags.length) return false;
            const set = new Set((Array.isArray(ruleTags) ? ruleTags : []).map(t => String(t).toLowerCase()));
            return excludeTags.some(t => set.has(String(t).toLowerCase()));
        }

        // An include tag never brings in a rule core keeps off: `forms` would
        // otherwise add the legend and radio group rules core keeps off.
        function selectableByTags(r) {
            return !isOptInRule(r);
        }

        // 1) If includeTags is present, convert it to an includeRuleIds set
        //    (intersect with any explicit includeRuleIds if user provided both)
        // A tag names rules across every WCAG level: `contrast` takes in
        // contrast-enhanced (AAA) too. Of the rules that check WCAG criteria,
        // only those within the scan's version and level are taken, the ones
        // its target would run (core decides which); rules that check none
        // (best practices, a standard's own) are taken as the tag names them.
        // Rule ids the step names are run as named.
        const inTarget = sel && sel.version && sel.level
            ? new Set((coreGetChecksForRunOnly({ wcag: { version: sel.version, level: sel.level } }, cfg) || [])
                .map((r) => String(r && (r.ruleId || r.id))))
            : null;
        const checksCriterion = (r) => (Array.isArray(r.tags) ? r.tags : []).some((t) => /^wcag\d{3,}$/i.test(String(t)));
        const withinTarget = (r) => !inTarget || inTarget.has(String(r.ruleId)) || !checksCriterion(r);

        if (includeTags.length) {
            const fromTags = new Set(
                catalog
                    .filter(r => r && r.ruleId && matchesIncludeTags(r.tags) && selectableByTags(r) && withinTarget(r))
                    .map(r => String(r.ruleId))
            );

            const explicitInc = new Set(Array.isArray(effectiveRunOnly.includeRuleIds) ? effectiveRunOnly.includeRuleIds : []);
            if (explicitInc.size) {
                if (includeMode === 'and') {
                    // intersection (narrowing)
                    const intersect = [];
                    for (const id of explicitInc) if (fromTags.has(id)) intersect.push(id);
                    effectiveRunOnly.includeRuleIds = intersect;
                } else {
                    // default + 'or' => union (broadening)
                    const union = new Set([...explicitInc, ...fromTags]);
                    effectiveRunOnly.includeRuleIds = Array.from(union);
                }
            } else {
                effectiveRunOnly.includeRuleIds = Array.from(fromTags);
            }
        }

        // 2) Exclude tags => expand to excludeRuleIds
        if (excludeTags.length) {
            const fromExcludeTags = new Set(
                catalog
                    .filter(r => r && r.ruleId && matchesExcludeTags(r.tags))
                    .map(r => String(r.ruleId))
            );

            const explicitExc = new Set(Array.isArray(effectiveRunOnly.excludeRuleIds) ? effectiveRunOnly.excludeRuleIds : []);
            for (const id of fromExcludeTags) explicitExc.add(id);
            effectiveRunOnly.excludeRuleIds = Array.from(explicitExc);

            // keep excludeTags only for metadata (optional)
            // effectiveRunOnly.excludeTags = [];
        }

        // 3) Finally: remove excluded ids from included ids if both exist (exclude wins)
        const inc2 = new Set(Array.isArray(effectiveRunOnly.includeRuleIds) ? effectiveRunOnly.includeRuleIds : []);
        const exc2 = new Set(Array.isArray(effectiveRunOnly.excludeRuleIds) ? effectiveRunOnly.excludeRuleIds : []);
        if (inc2.size && exc2.size) {
            const filtered = [];
            for (const id of inc2) if (!exc2.has(id)) filtered.push(id);
            effectiveRunOnly.includeRuleIds = filtered;
        }

        // 4) Leave out the rule ids surea11y doesn't have (a typo, or a step
        //    written for another engine): core throws when no id in an
        //    include list names one of its rules.
        const isKnownRuleId = makeKnownRuleIdTest(cfg);
        for (const key of ['includeRuleIds', 'excludeRuleIds']) {
            const list = Array.isArray(effectiveRunOnly[key]) ? effectiveRunOnly[key] : [];
            const unknown = list.filter((id) => !isKnownRuleId(id));
            if (!unknown.length) continue;
            unknownRuleIds[key === 'includeRuleIds' ? 'include' : 'exclude'] = unknown;
            effectiveRunOnly[key] = list.filter((id) => isKnownRuleId(id));
        }
        // Every rule the scan asked for belongs to another engine: run none,
        // rather than every rule as an empty list would.
        noKnownRuleIncluded = unknownRuleIds.include.length > 0 && !effectiveRunOnly.includeRuleIds.length;
        // Include tags no surea11y rule carries (or that leave no rule beside
        // the ids under "and") come to an empty list too, which would run
        // every rule: run none, and say so.
        if (!noKnownRuleIncluded && includeTags.length && !effectiveRunOnly.includeRuleIds.length) {
            noKnownRuleIncluded = true;
            unmatchedIncludeTags = includeTags.slice();
        }

        // 5) The rules a step includes are the rules it runs, as with every
        //    other engine. Beside a WCAG target, core adds them to the
        //    target's rules instead (the union), so the target steps aside,
        //    and with it the best practices and opt-in rule tags that would
        //    add to them as well. The target's version stays the one the scan
        //    is judged by, as core's wcagVersion option.
        if (effectiveRunOnly.wcag && Array.isArray(effectiveRunOnly.includeRuleIds) && effectiveRunOnly.includeRuleIds.length) {
            wcagVersion = effectiveRunOnly.wcag.version || null;
            // And its level, as core's wcagLevel: without a target core has
            // none, and would report the AAA criteria of an AA scan's checks.
            targetLevel = effectiveRunOnly.wcag.level || null;
            effectiveRunOnly.wcag = null;
            effectiveRunOnly.bestPractices = false;
            const optInTags = new Set(gatedRuleTags());
            effectiveRunOnly.tags = (Array.isArray(effectiveRunOnly.tags) ? effectiveRunOnly.tags : [])
                .filter((t) => !optInTags.has(String(t).toLowerCase()));
        }

        // 6) Clean up empty
        const hasAny =
            !!effectiveRunOnly.wcag ||
            effectiveRunOnly.bestPractices === true ||
            (Array.isArray(effectiveRunOnly.includeRuleIds) && effectiveRunOnly.includeRuleIds.length) ||
            (Array.isArray(effectiveRunOnly.excludeRuleIds) && effectiveRunOnly.excludeRuleIds.length) ||
            (Array.isArray(effectiveRunOnly.tags) && effectiveRunOnly.tags.length) ||
            (Array.isArray(effectiveRunOnly.includeTags) && effectiveRunOnly.includeTags.length) ||
            (Array.isArray(effectiveRunOnly.excludeTags) && effectiveRunOnly.excludeTags.length);

        if (!hasAny) effectiveRunOnly = null;
    }

    // Include tags are already rule ids above; core has no includeTags key and warns about it.
    const runOnlyForCore = effectiveRunOnly
        ? {
            ...(effectiveRunOnly.wcag ? { wcag: effectiveRunOnly.wcag } : null),
            ...(effectiveRunOnly.bestPractices === true ? { bestPractices: true } : null),
            includeMode: effectiveRunOnly.includeMode || undefined,
            tags: Array.isArray(effectiveRunOnly.tags) ? effectiveRunOnly.tags : [],
            excludeTags: Array.isArray(effectiveRunOnly.excludeTags) ? effectiveRunOnly.excludeTags : [],
            includeRuleIds: Array.isArray(effectiveRunOnly.includeRuleIds) ? effectiveRunOnly.includeRuleIds : [],
            excludeRuleIds: Array.isArray(effectiveRunOnly.excludeRuleIds) ? effectiveRunOnly.excludeRuleIds : []
        }
        : null;

    return { normalizedRunOnly, effectiveRunOnly, runOnlyForCore, unknownRuleIds, noKnownRuleIncluded, unmatchedIncludeTags, wcagVersion, wcagLevel: targetLevel };
}

/**
 * Main execution method expected by the a11y-engine facade.
 * Returns: { native, canonical }
 */
async function runOnPage(
    page,
    {
        selection,
        runOnly,
        wcagLevel,
        contextSelector,
        excludeSelectors,
        engineOptions,
        engineMode,
        postProcess,
        // The binding's .screenshots() options (element-screenshots.js), or
        // null for no pictures of the flagged elements.
        elementScreenshots = null,
        // Whether the page's iframes are scanned too, their findings with
        // the page's (the step's Scan iframes too, off unless it says).
        frames = false,
        // How long the iframes may take, all of them (scanFrames).
        framesBudgetMs = null
    } = {}
) {
    // Basic page metadata
    let pageUrl = null;
    let pageTitle = null;
    try { pageUrl = await page.url(); } catch {}
    try { pageTitle = await page.title(); } catch {}

    const ctxSelector =
        (typeof contextSelector === 'string' && contextSelector.trim())
            ? contextSelector.trim()
            : null;

    const excludeList = Array.isArray(excludeSelectors)
        ? excludeSelectors.map(String).map((s) => s.trim()).filter(Boolean)
        : [];

    // Merge excludeSelectors into engineOptions.excludeSelectors (engine reads it from engineOptions)
    const { cfg, requestedProfile, requestedProfiles } = normalizeScanConfig(withSelectionProfile(engineOptions, selection));

    const findingsSource = (cfg && typeof cfg.findingsSource === 'string')
        ? cfg.findingsSource.trim().toLowerCase()
        : 'both';

    const wantAtomic = (findingsSource === 'atomic' || findingsSource === 'both');
    const wantComposite = (findingsSource === 'composite' || findingsSource === 'both');

     if (engineOptions && engineOptions.engineMode) {
             cfg.contrast = { mode: engineOptions.engineMode };
         }

    if (excludeList.length) {
        const existing = Array.isArray(cfg.excludeSelectors)
            ? cfg.excludeSelectors.map(String).map((s) => s.trim()).filter(Boolean)
            : [];
        cfg.excludeSelectors = Array.from(new Set([...existing, ...excludeList]));
    }

    const {
        normalizedRunOnly, effectiveRunOnly, runOnlyForCore, unknownRuleIds, noKnownRuleIncluded, unmatchedIncludeTags,
        wcagVersion: targetVersion, wcagLevel: targetLevel
    } = resolveRunSelection({ selection, runOnly, wcagLevel, cfg, requestedProfile });
    applyTargetToOptions(cfg, { wcagVersion: targetVersion, wcagLevel: targetLevel });

    // What the scan ran with, the fallback's when it replaces the first.
    let scannedCfg = cfg;
    let scannedRunOnly = runOnlyForCore;
    let engineOutput = noKnownRuleIncluded
        ? { url: pageUrl || null, title: pageTitle || null, checksResults: [], rulesResults: [] }
        : await scanPage(page, {
            pageUrl,
            contextSelector: ctxSelector,
            engineOptions: cfg,
            runOnly: runOnlyForCore,
            packs: PACKS
        });

    // What the report should say about how this scan ran, beside its findings.
    const notices = [];

    // A core release without the requested standard ignores the profile and
    // runs every rule, AAA and best practice included. When nothing in the
    // step overrode the standard, scan again with its WCAG tags instead, as
    // other engines get it, and say so.
    const explicitInclude = !!runOnlyForCore && (
        (Array.isArray(runOnlyForCore.includeRuleIds) && runOnlyForCore.includeRuleIds.length > 0)
        || (Array.isArray(effectiveRunOnly?.includeTags) && effectiveRunOnly.includeTags.length > 0));
    const appliedProfileId = profileId(engineOutput && engineOutput.engine ? engineOutput.engine.profile : null);
    if (requestedProfile && !requestedProfiles && !noKnownRuleIncluded && !explicitInclude && appliedProfileId !== requestedProfile
        && CONFORMANCE_TARGETS[requestedProfile]) {
        const fallbackCfg = { ...cfg };
        delete fallbackCfg.profile;
        scannedCfg = fallbackCfg;
        scannedRunOnly = { ...(runOnlyForCore || {}), tags: CONFORMANCE_TARGETS[requestedProfile].tags.slice() };
        engineOutput = await scanPage(page, {
            pageUrl,
            contextSelector: ctxSelector,
            engineOptions: fallbackCfg,
            runOnly: scannedRunOnly,
            packs: PACKS
        });
        notices.push({
            engineId: ENGINE_ID,
            code: 'profile-unavailable',
            message: `This surea11y release has no ${targetLabel(requestedProfile)} profile, so it checked the standard's `
                + 'WCAG criteria only: none of the rules or criteria the standard adds were run.'
        });
    }
    // A scan of several profiles names each one that did not run, and why;
    // the others ran as asked.
    if (requestedProfiles) notices.push(...profilesNotRunNotices(engineOutput));
    // Pictures of the flagged elements, once, of the scan that stays: the
    // first scan's would be thrown away with it when the fallback replaces it.
    if (elementScreenshots && !noKnownRuleIncluded) {
        engineOutput = await captureScreenshots(page, engineOutput, elementScreenshots);
    }
    // The page's iframes, each scanned whole, their findings with the
    // page's: an iframe's content was never checked, and the report did not
    // say so. After the pictures, which are the top page's.
    const subFrames = typeof page.frames === 'function' ? page.frames().length - 1 : 0;
    if (frames && subFrames > 0 && !noKnownRuleIncluded) {
        const frameResults = await scanFrames(page, { engineOptions: scannedCfg, runOnly: scannedRunOnly, packs: PACKS, contextSelector: ctxSelector, budgetMs: framesBudgetMs });
        mergeFrameResults(engineOutput, frameResults);
        engineOutput.frames = frameResults.map((f) => ({
            url: f.url || null,
            frameSelectors: f.frameSelectors || null,
            ...(f.error ? { error: f.error } : {}),
            ...(f.skipped ? { skipped: f.skipped } : {}),
            ...(f.ariaHidden ? { ariaHidden: true } : {}),
            ...(f.inert ? { inert: true } : {}),
        }));
        // Frames left out as core's scan across frames leaves them out (not
        // shown, excluded, outside the scope) or empty: said, so their
        // content is known to be unchecked.
        const skipped = frameResults.filter((f) => f.skipped);
        if (skipped.length) {
            notices.push({
                engineId: ENGINE_ID,
                code: 'frames-left-out',
                message: framesLeftOutMessage(skipped, frameResults.length),
            });
        }
        const missed = frameResults.filter((f) => f.error);
        if (missed.length) {
            notices.push({
                engineId: ENGINE_ID,
                code: 'frames-not-scanned',
                message: `${missed.length} of the page's ${frameResults.length} iframes could not be scanned, so their content is not in these results: `
                    + missed.slice(0, 5).map((f) => `${f.url || 'an iframe'} (${f.error})`).join('; ') + (missed.length > 5 ? '; …' : '') + '.'
            });
        }
    } else if (!frames && subFrames > 0) {
        notices.push({
            engineId: ENGINE_ID,
            code: 'frames-off',
            message: `This page has ${subFrames} ${subFrames === 1 ? 'iframe' : 'iframes'}, and this scan left ${subFrames === 1 ? 'it' : 'them'} out (Scan iframes too is off): what ${subFrames === 1 ? 'it shows' : 'they show'} is not in these results.`
        });
    }
    if (noKnownRuleIncluded) {
        notices.push({
            engineId: ENGINE_ID,
            code: 'no-known-rules',
            message: unmatchedIncludeTags
                ? 'surea11y ran no rules: no surea11y rule matches the tags this scan includes ('
                    + unmatchedIncludeTags.join(', ') + ')'
                    + (Array.isArray(normalizedRunOnly && normalizedRunOnly.includeRuleIds) && normalizedRunOnly.includeRuleIds.length
                        ? ' together with its rule ids.' : '.')
                : 'surea11y ran no rules: none of the rule ids this scan includes is a surea11y rule ('
                    + unknownRuleIds.include.join(', ') + ').'
        });
    } else if (unknownRuleIds.include.length || unknownRuleIds.exclude.length) {
        notices.push({
            engineId: ENGINE_ID,
            code: 'unknown-rule-ids',
            message: 'surea11y has no rule named '
                + [...unknownRuleIds.include, ...unknownRuleIds.exclude].join(', ')
                + '; it ignored ' + (unknownRuleIds.include.length + unknownRuleIds.exclude.length === 1 ? 'it' : 'them') + '.'
        });
    }

    // How core resolved the scan's scope. A scope that matches nothing is
    // scanned as nothing, so every rule is not applicable and the scan
    // would look clean.
    const contextMatch = engineOutput && engineOutput.contextMatch && typeof engineOutput.contextMatch === 'object'
        ? engineOutput.contextMatch
        : null;
    notices.push(...contextMatchNotices(contextMatch, ctxSelector, ENGINE_ID));
    notices.push(...hookNotices(engineOutput, cfg));

    // Build native shape similar to mock engine for debug and export
    const native = {
        engineId: ENGINE_ID,
        engineName: ENGINE_NAME,
        engineVersion: ENGINE_VERSION,
        // Core's own run metadata (WCAG target, profile, locale). With it,
        // `native` is a complete core result that @surea11y/core's SARIF,
        // JUnit, EARL and HTML renderers accept as it is.
        engine: engineOutput && engineOutput.engine ? engineOutput.engine : null,
        // Core's counters and, with profileRules, each rule's time (a debug run).
        ...(engineOutput && engineOutput.perfStats ? { perfStats: engineOutput.perfStats } : {}),
        url: engineOutput && engineOutput.url ? engineOutput.url : (pageUrl || null),
        title: engineOutput && engineOutput.title ? engineOutput.title : (pageTitle || null),
        timestamp: engineOutput && engineOutput.timestamp ? engineOutput.timestamp : new Date().toISOString(),
        contextSelector: engineOutput && engineOutput.contextSelector ? engineOutput.contextSelector : (ctxSelector || null),
        contextMatch,
        excludeSelectors: excludeList.length ? excludeList : null,
        violations: [],
        incomplete: [],
        passes: [],
        inapplicable: [],
        checksResults: (engineOutput && Array.isArray(engineOutput.checksResults)) ? engineOutput.checksResults : [],
        rulesResults: (engineOutput && Array.isArray(engineOutput.rulesResults)) ? engineOutput.rulesResults : []
    };

    const findings = [];
    const atomicFindings = [];
    if (engineOutput && Array.isArray(engineOutput.checksResults)) {
        for (const ruleResult of engineOutput.checksResults) {
            if (!ruleResult || typeof ruleResult !== 'object') continue;

            const { ruleId, outcome, severity, occurrences } = ruleResult;
            const meta = getCheckDefById(ruleId, cfg) || {
                ruleId,
                title: ruleId,
                description: null,
                helpUrl: null,
                tags: [ENGINE_TAG],
                normativeMappings: [],
                informativeReferences: [],
                defaultSeverity: normalizeSeverity(severity),
                category: null,
                type: 'automatic',
                defaultConfidence: 'medium'
            };

            const occs = Array.isArray(occurrences) ? occurrences : [];

            // Build canonical occurrences
            const canonicalOccs = occs.map((occ) => {
                const selector = occ.selector || null;
                const htmlSnippet = occ.html || '';
                const failureSummary = occ.summary || meta.title || ruleId;
                const pageUrlFinal = native.url || pageUrl || null;
                const occurrenceOutcome = normalizeOccurrenceOutcome(
                    occ && occ.occurrenceOutcome ? occ.occurrenceOutcome : occ && occ.outcome,
                    outcome
                );
                const hint = normalizeHint(occ && occ.hint);
                const uncertainty = occurrenceOutcome === 'cantTell' ? normalizeUncertainty(occ && occ.uncertainty) : null;
                const lean = occurrenceOutcome === 'cantTell' ? normalizeLean(occ && occ.lean) : null;
                const howToCheck = occurrenceOutcome === 'cantTell' ? normalizeHowToCheck(occ && occ.howToCheck) : null;
                const details = normalizeOccurrenceDetails(occ && occ.data && occ.data.details);
                // The shadow hosts leading to an element in a shadow tree,
                // outermost first: its selector only holds inside its own root.
                const shadowHostSelectors = shadowHostsOf(occ);
                // The picture the binding took of the element, or why there
                // is none; the runner stores it (element-screenshots.js). It
                // moves here: core's own result, which the exports and the
                // debug output read, stays as core gave it, with no bytes.
                const elementScreenshot = elementScreenshotOf(occ && occ.screenshot, { max: elementScreenshots ? elementScreenshots.max : null });
                if (occ && typeof occ === 'object' && 'screenshot' in occ) delete occ.screenshot;
                // And, for a finding made in a state the rule put the page in
                // (the text spacing), its element pictured in that state.
                const elementStateScreenshots = elementStateScreenshotsOf(occ && occ.stateScreenshots, { max: elementScreenshots ? elementScreenshots.max : null });
                if (occ && typeof occ === 'object' && 'stateScreenshots' in occ) delete occ.stateScreenshots;
                return {
                    pageUrl: pageUrlFinal,
                    target: selector ? [selector] : [],
                    html: htmlSnippet,
                    failureSummary,
                    summary: failureSummary,
                    occurrenceOutcome,
                    ...(hint ? { hint } : {}),
                    ...(uncertainty ? { uncertainty } : {}),
                    ...(lean ? { lean } : {}),
                    ...(howToCheck ? { howToCheck } : {}),
                    ...(details ? { details } : {}),
                    ...(shadowHostSelectors ? { shadowHostSelectors } : {}),
                    // An element in one of the page's iframes: the frame's
                    // address, and the iframes that lead to it from the page.
                    ...(occ && occ.frameUrl ? { frameUrl: String(occ.frameUrl) } : {}),
                    ...(occ && Array.isArray(occ.frameSelectors) && occ.frameSelectors.length ? { frameSelectors: occ.frameSelectors.map(String) } : {}),
                    ...(elementScreenshot ? { elementScreenshot } : {}),
                    ...(elementStateScreenshots ? { elementStateScreenshots } : {}),
                    // A scan of several profiles: what each one makes of
                    // this element, { [profile]: outcome }.
                    ...(verdictsOf(occ) ? { verdicts: verdictsOf(occ) } : {}),
                    evidence: {
                        engineNode: {
                            url: pageUrlFinal ? [pageUrlFinal] : [],
                            pageUrl: pageUrlFinal,
                            target: selector ? [selector] : [],
                            html: htmlSnippet,
                            failureSummary
                        }
                    }
                };
            });

            const confidenceString =
                typeof ruleResult.confidence === 'string'
                    ? ruleResult.confidence
                    : (meta.defaultConfidence || 'medium');

            const numericConfidence = mapConfidenceNumeric(confidenceString, outcome);

            const canonicalFinding = {
                id: ruleId,
                uid: `${ENGINE_ID}:${outcome}:${ruleId}`,
                ruleId,

                provenance: {
                    engineId: ENGINE_ID,
                    engineName: ENGINE_NAME,
                    engineVersion: ENGINE_VERSION
                },

                title: meta.title,
                description: meta.description,
                helpUrl: meta.helpUrl,
                outcome,
                severity: normalizeSeverity(severity || meta.defaultSeverity),
                confidence: numericConfidence,
                confidenceLabel: confidenceString,
                type: meta.type || 'automatic',
                tags: Array.isArray(meta.tags) ? meta.tags.slice() : [ENGINE_TAG],
                wcag: deriveWcagScPair(meta),
                standards: {
                    // The result's own mappings first: they name only the
                    // standards this run asked for (EN 301 549 under its
                    // profile, for instance), which the static catalog entry
                    // cannot know.
                    normativeMappings: normalizeObjectArray(
                        ruleResult.meta && Array.isArray(ruleResult.meta.normativeMappings)
                            ? ruleResult.meta.normativeMappings
                            : meta.normativeMappings
                    ),
                    informativeReferences: normalizeObjectArray(meta.informativeReferences)
                },
                occurrences: canonicalOccs
            };
            // A scan of several profiles: what each one makes of the rule's
            // findings ({ [profile]: outcome }), the worst of which is its
            // outcome, and the rule's own outcome before a standard judged its
            // findings (checkOutcome), which its WCAG criteria read.
            const verdicts = verdictsOf(ruleResult);
            if (verdicts) {
                canonicalFinding.verdicts = verdicts;
                if (OUTCOMES_KNOWN.has(ruleResult.checkOutcome)) canonicalFinding.checkOutcome = ruleResult.checkOutcome;
            }
            // A rule that lists only some of the elements it found (core's
            // contrast rules list 50): how many it counted and did not list,
            // so the report's counts and comparisons count them all.
            const listing = ruleResult.data && ruleResult.data.details;
            if (listing && listing.truncated === true && Number.isFinite(listing.elementCount) && Number.isFinite(listing.reportedCount)) {
                const unlisted = Math.max(0, listing.elementCount - listing.reportedCount);
                if (unlisted) canonicalFinding.unlisted = unlisted;
            }
            // A best-practice rule tests no WCAG criterion.
            if (canonicalFinding.tags.includes('best-practice')) canonicalFinding.bestPractice = true;

            atomicFindings.push(canonicalFinding);

            // Populate native buckets for debug and export
            const nativeItem = {
                id: ruleId,
                impact: canonicalFinding.severity,
                help: meta.title,
                description: meta.description,
                helpUrl: meta.helpUrl,
                tags: Array.isArray(meta.tags) ? meta.tags.slice() : [ENGINE_TAG],
                nodes: occs.map((occ) => ({
                    url: native.url ? [native.url] : [],
                    pageUrl: native.url || null,
                    target: occ.selector ? [occ.selector] : [],
                    html: occ.html || '',
                    failureSummary: occ.summary || meta.title || ruleId,
                    occurrenceOutcome: normalizeOccurrenceOutcome(
                        occ && occ.occurrenceOutcome ? occ.occurrenceOutcome : occ && occ.outcome,
                        outcome
                    )
                }))
            };

            if (outcome === 'fail') native.violations.push(nativeItem);
            else if (outcome === 'cantTell') native.incomplete.push(nativeItem);
            else if (outcome === 'pass') native.passes.push(nativeItem);
            else native.inapplicable.push(nativeItem);
        }

        if (wantAtomic) {
            findings.push(...atomicFindings);
        } else if (wantComposite) {
            // No criterion rolls the best practices up, so they are listed as
            // they are, beside the criteria.
            findings.push(...atomicFindings.filter((f) => f.bestPractice));
        }

        // =====================
        // Add composite "rules" findings (rollups), split by outcome (fail vs cantTell)
        // =====================
        if (wantComposite && engineOutput && Array.isArray(engineOutput.rulesResults)) {
            // Index atomic outcomes by ruleId (atomic ruleId == contributor testId)
            const atomicOutcomeByRuleId = new Map();
            for (const f of atomicFindings) {
                if (!f || !f.ruleId) continue;
                if (f.meta && f.meta.atomic === false) continue; // skip composites
                atomicOutcomeByRuleId.set(String(f.ruleId), String(f.outcome || '').trim());
            }

            function normalizeOutcome(o) {
                const s = String(o || '').trim();
                if (s === 'fail' || s === 'cantTell' || s === 'pass' || s === 'notApplicable') return s;
                return null;
            }

            for (const cr of engineOutput.rulesResults) {
                const details = (cr && cr.data && cr.data.details && typeof cr.data.details === 'object')
                    ? cr.data.details
                    : {};

                const contributors = Array.isArray(details.contributors) ? details.contributors : [];

                // Partition contributors by outcome (prefer contributor.outcome, fallback to atomic finding outcome)
                const failContrib = [];
                const cantTellContrib = [];
                const passContrib = [];
                const notApplicableContrib = [];

                for (const c of contributors) {
                    const testId = String(c && c.testId ? c.testId : '').trim();
                    if (!testId) continue;

                    const direct = normalizeOutcome(c && c.outcome);
                    const fallback = normalizeOutcome(atomicOutcomeByRuleId.get(testId));
                    const o = direct || fallback;

                    if (o === 'fail') failContrib.push(c);
                    else if (o === 'cantTell') cantTellContrib.push(c);
                    else if (o === 'pass') passContrib.push(c);
                    else if (o === 'notApplicable') notApplicableContrib.push(c);
                }

                // checksIds should match the contributors for each split finding
                const failIds = failContrib.map(c => String(c.testId).trim()).filter(Boolean);
                const cantTellIds = cantTellContrib.map(c => String(c.testId).trim()).filter(Boolean);
                const passIds = passContrib.map(c => String(c.testId).trim()).filter(Boolean);
                const notApplicableIds = notApplicableContrib.map(c => String(c.testId).trim()).filter(Boolean);

                if (failIds.length) {
                    const cfFail = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'fail',
                        checksIdsOverride: failIds,
                        contributorsOverride: failContrib
                    });
                    if (cfFail) findings.push(cfFail);
                }

                if (cantTellIds.length) {
                    const cfCt = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'cantTell',
                        checksIdsOverride: cantTellIds,
                        contributorsOverride: cantTellContrib
                    });
                    if (cfCt) findings.push(cfCt);
                }

                // Same split as fail/cantTell above, so a composite (WCAG SC rollup) with
                // e.g. 3 passing checks and 1 notApplicable one surfaces both, instead of
                // silently vanishing whenever no contributor failed or needed review.
                if (passIds.length) {
                    const cfPass = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'pass',
                        checksIdsOverride: passIds,
                        contributorsOverride: passContrib
                    });
                    if (cfPass) findings.push(cfPass);
                }

                if (notApplicableIds.length) {
                    const cfNa = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'notApplicable',
                        checksIdsOverride: notApplicableIds,
                        contributorsOverride: notApplicableContrib
                    });
                    if (cfNa) findings.push(cfNa);
                }

                // Partly checked: the scan named some of the criterion's
                // checks, those that ran passed (or did not apply), and the
                // others were not selected. Core's verdict is cantTell; the
                // split above would only show the passes, so the checks not
                // selected are a can't-tell finding of their own, which says
                // so. When a check failed or was left undecided, that finding
                // already gives the criterion's verdict.
                if (details.reasonCode === 'composite.rollup.cantTell.notSelectedChild') {
                    const notSelected = contributors.filter((c) => c && c.notSelected === true && String(c.testId || '').trim());
                    if (notSelected.length) {
                        const cfPartly = toCompositeCanonicalFinding(cr, {
                            outcomeOverride: 'cantTell',
                            checksIdsOverride: notSelected.map((c) => String(c.testId).trim()),
                            contributorsOverride: notSelected
                        });
                        if (cfPartly) {
                            cfPartly.partlyChecked = {
                                notSelected: notSelected.length,
                                checks: contributors.filter((c) => c && String(c.testId || '').trim()).length
                            };
                            findings.push(cfPartly);
                        }
                    }
                }
            }
        }
    }

    if (wantComposite) {
        attachCompositeOccurrencesFromAtomicFindings(findings, atomicFindings);
    }

    // Optional adapter post processing hook
    if (postProcess && typeof postProcess === 'object' && typeof postProcessResults === 'function') {
        try { postProcessResults(native, postProcess); } catch {}
    }

    // Outcome counts come from atomicFindings (the complete
    // fail/cantTell/pass/notApplicable picture), not the client-facing `findings`
    // array — that array is gated by wantAtomic/wantComposite, and composite
    // rollups never carry pass/notApplicable, so counts taken from it would read
    // "pass"/"notApplicable" as zero under the default 'composite' findingsSource.
    // The requirements' counts leave the best practices out; theirs are kept
    // apart.
    const summary = splitOutcomeCounts(atomicFindings);
    // Each check's outcome, for a Merged scan to count its contexts the same
    // way (merged-scan.js). Not enumerable: it stays out of the payload.
    Object.defineProperty(summary, 'checks', {
        value: atomicFindings.map((f) => ({ ruleId: f.ruleId, outcome: f.outcome, bestPractice: f.bestPractice === true })),
        enumerable: false,
    });

    const rulesCatalog = getRulesCatalog();

    const requestedIncludeTags =
        (normalizedRunOnly && Array.isArray(normalizedRunOnly.includeTags))
            ? normalizedRunOnly.includeTags.slice()
            : [];
    const requestedExcludeTags = (normalizedRunOnly && Array.isArray(normalizedRunOnly.excludeTags)) ? normalizedRunOnly.excludeTags.slice() : [];
    const requestedIncludeMode = (normalizedRunOnly && normalizedRunOnly.includeMode) ? normalizedRunOnly.includeMode : null;
    const standardTags = (normalizedRunOnly && Array.isArray(normalizedRunOnly.tags)) ? normalizedRunOnly.tags.slice() : [];

    const includeRuleIds =
        effectiveRunOnly && Array.isArray(effectiveRunOnly.includeRuleIds)
            ? effectiveRunOnly.includeRuleIds.slice()
            : [];

    const excludeRuleIds =
        effectiveRunOnly && Array.isArray(effectiveRunOnly.excludeRuleIds)
            ? effectiveRunOnly.excludeRuleIds.slice()
            : [];

    // The language core actually wrote the findings in, which is English when
    // the requested one has no translation. Findings carry it as `lang` so a
    // report around them in another language can mark their text for screen
    // readers; English needs no mark.
    const resolvedLocale = resolvedLocaleOf(engineOutput);
    if (resolvedLocale && resolvedLocale !== DEFAULT_LOCALE) {
        for (const f of findings) {
            if (f && typeof f === 'object') f.lang = resolvedLocale;
        }
    }

    // The profile core actually used. It is absent when an explicit include
    // overrode the requested one.
    const appliedProfile = profileId(
        engineOutput && engineOutput.engine ? engineOutput.engine.profile : null
    );

    // Avoid embedding potentially large/sensitive probe payloads in exported reports.
    const cfgForReport = (() => {
        if (!cfg || typeof cfg !== 'object') return cfg;
        const copy = { ...cfg };
        if (copy.probes) delete copy.probes;
        return copy;
    })();

    // The rollups a scan with these options can produce.
    const compositeCatalog =
        (typeof coreGetCompositeRulesCatalog === 'function')
            ? coreGetCompositeRulesCatalog(cfg)
            : [];

    const compositeCatalogCount = Array.isArray(compositeCatalog) ? compositeCatalog.length : 0;

    const canonical = {
        version: CANON_VERSION || '1.0',
        engine: {
            id: ENGINE_ID,
            name: ENGINE_NAME,
            version: ENGINE_VERSION
        },
        page: {
            url: native.url || pageUrl || null,
            title: native.title || pageTitle || null,
            viewport: null,
            timestamp: native.timestamp || new Date().toISOString()
        },
        scope: {
            include: ctxSelector ? [ctxSelector] : ['html'],
            exclude: excludeList,
            // { elementCount, unmatchedSelectors } from core; null without a scope.
            match: contextMatch
        },
        runOptions: {
            standardTags,
            // The WCAG target core selected rules by ({ version, level }), or
            // null when the scan's tags named something else.
            wcagTarget: (effectiveRunOnly && effectiveRunOnly.wcag) || null,
            includeRuleIds,
            excludeRuleIds,
            requestedIncludeTags,
            requestedExcludeTags,
            requestedIncludeMode,
            includeBestPractice: !!(effectiveRunOnly && effectiveRunOnly.bestPractices),
            resultTypes: [],
            engineOptions: cfgForReport || {},
            // Kept here rather than under `engine`, which the engine facade
            // replaces with `engines`.
            wcagVersion: (engineOutput && engineOutput.engine && engineOutput.engine.wcagVersion) || null,
            locale: engineOutput && engineOutput.engine && engineOutput.engine.locale ? engineOutput.engine.locale : null,
            conformanceProfile: appliedProfile ? { id: appliedProfile, label: targetLabel(appliedProfile) } : null,
            // A scan of several profiles: those that ran, in order, and those
            // that did not, with why ('unknown-profile', 'pack-skipped',
            // 'overridden-by-selection'). Absent for a scan of one.
            ...(appliedProfiles(engineOutput) ? { conformanceProfiles: appliedProfiles(engineOutput) } : {}),
            ...(requestedProfiles ? { profilesNotRun: profilesNotRunOf(engineOutput) } : {}),
            // The rule ids the step named that surea11y has none of.
            unknownRuleIds: (unknownRuleIds.include.length || unknownRuleIds.exclude.length) ? unknownRuleIds : null
        },
        notices,
        margins: collectMargins(engineOutput, cfg),
        summary,
        findings,
        rules: rulesCatalog.rules,
        findingsByKind: {
            composite: findings.filter(f => f && f.meta && f.meta.atomic === false),
            atomic: findings.filter(f => !f || !f.meta || f.meta.atomic !== false)
        },
        diagnostics: {
            // What core recorded about the page as it scanned it: viewport,
            // colour scheme, whether fonts and images were still loading, and
            // how many animations it held still.
            environment: (engineOutput && engineOutput.engine && engineOutput.engine.environment) || null,
            // The page's iframes and whether each was scanned: { url,
            // frameSelectors, error? }; null when it has none or they were left out.
            frames: (engineOutput && Array.isArray(engineOutput.frames)) ? engineOutput.frames : null,
            engine: {
                compositeCatalogCount,
                rulesResults: (engineOutput && Array.isArray(engineOutput.rulesResults)) ? engineOutput.rulesResults : []
            }
        }
    };

    return { native, canonical };
}

/**
 * How close each measuring rule's closest passing element came to its
 * threshold (core's `margin`), as [{ ruleId, title, measure, unit, limit,
 * threshold, value, headroom, measuredCount, selector, structuralPath,
 * shadowHostSelectors, context }]. Not a finding: it says how much room a
 * pass had, so a result a small change will flip can be seen before it flips.
 * Empty with a core release that reports none.
 */
function collectMargins(engineOutput, cfg) {
    if (!engineOutput || !Array.isArray(engineOutput.checksResults)) return [];
    return collectResultMargins(engineOutput.checksResults, (ruleId) => {
        const def = getCheckDefById(ruleId, cfg);
        return def && def.title;
    });
}

// The hooks the lab installs before the page loads (A11Y_CORE_HOOKS), by
// the kind getScanNotes() gives the note of one the scan went without:
// what the scan could not know without it, in words for anyone reading the
// report, not only for whoever runs the lab.
const HOOK_NOTES = {
    'internals-hook': { what: 'the name, role and state that custom elements (web components) set for themselves out of sight of other scripts' },
    'listener-hook': { what: 'which elements respond to clicks, keys or the mouse', example: ', as frameworks such as Angular do' },
    'live-region-hook': { what: 'what the page announced to screen readers through its live regions' },
};

/**
 * Notes on how this scan ran that its findings depend on: what it judged
 * without one of core's hooks (and, under forced colors, that it was). The
 * binding's getScanNotes() finds the findings a hook would have decided
 * (or the components it would have named), and says so here in plain
 * words, with the rules by their titles. A scan whose hooks all ran early
 * gets none.
 *
 * A hook core calls 'late' was installed, but the page's own scripts got to
 * what it watches first or replaced it afterwards (zone.js replaces
 * addEventListener), so no scan setting brings it back; one that is 'none'
 * was turned off for the run.
 */
function hookNotices(engineOutput, cfg) {
    let notes = [];
    try { notes = getScanNotes(engineOutput) || []; } catch { notes = []; }
    const titleOf = (ruleId) => {
        let def = null;
        try { def = getCheckDefById(ruleId, cfg); } catch { def = null; }
        return (def && def.title) || ruleId;
    };
    const out = [];
    for (const note of notes) {
        // A scan of a page shown in forced colors (Set color scheme and contrast, or a
        // system contrast theme): its contrast findings may differ with them
        // off. The binding's own words name no binding call.
        if (note && note.kind === 'forced-colors' && typeof note.message === 'string') {
            out.push({ engineId: ENGINE_ID, code: 'forced-colors', message: note.message });
            continue;
        }
        const hook = note && HOOK_NOTES[note.kind];
        if (!hook) continue;
        const late = note.hook === 'late';
        const count = Number.isInteger(note.findingCount) ? note.findingCount
            : Number.isInteger(note.elementCount) ? note.elementCount : null;
        const rules = Array.isArray(note.rules) ? note.rules.map(titleOf) : [];
        const fromRules = rules.length
            ? ` from ${rules.length === 1 ? 'the check' : `${rules.length} checks`} (${rules.map((t) => `“${t}”`).join(', ')})`
            : '';
        const which = count === null ? 'some of its results'
            : note.kind === 'internals-hook'
                ? `the results for ${count} custom ${count === 1 ? 'element' : 'elements'}`
                : `${count} ${count === 1 ? 'result' : 'results'}${fromRules}`;
        const why = late
            ? `The page's own scripts took over the part of the browser surea11y watches for this${hook.example || ''}. `
                + 'No scan setting changes this: check these results by hand.'
            : 'This was turned off for this run (A11Y_CORE_HOOKS); with it on, surea11y can decide more of them.';
        out.push({
            engineId: ENGINE_ID,
            code: note.kind,
            message: `surea11y could not see ${hook.what}, so it was less sure about ${which}. ${why}`
        });
    }
    return out;
}

/**
 * surea11y's own result inside a report model's native output, or null. A
 * multi-engine scan keeps native output per engine under `byEngine`.
 */
function coreResultFromNative(native) {
    if (!native || typeof native !== 'object') return null;
    const own = native.byEngine && typeof native.byEngine === 'object' ? native.byEngine[ENGINE_ID] : native;
    return own && Array.isArray(own.checksResults) ? own : null;
}

// Where the scan's main screenshot can be found, in the fields the UI reads
// from a report. Without them it guesses a file next to the report, which
// this exporter does not write.
function screenshotFieldsFor(shot) {
    if (!shot) return {};
    if (typeof shot === 'string') {
        if (shot.startsWith('data:')) return { screenshotDataUrl: shot };
        if (/^https?:\/\//i.test(shot) || shot.startsWith('/')) return { screenshotPublicUrl: shot };
        return {};
    }
    if (typeof shot === 'object') {
        if (typeof shot.publicUrl === 'string' && shot.publicUrl) return { screenshotPublicUrl: shot.publicUrl };
        if (typeof shot.dataUrl === 'string' && shot.dataUrl) return { screenshotDataUrl: shot.dataUrl };
    }
    return {};
}

/**
 * Writes @surea11y/core's HTML report for one scan: findings with filters,
 * WCAG rollup and EN 301 549 clauses, in the scan's language. It goes under
 * reports/surea11y/, which the server serves at /reports, unless meta.outDir
 * says otherwise.
 *
 * Returns { path, publicUrl, ...screenshot } or null when the model holds no
 * surea11y result to render.
 */
function saveHtmlReport(reportModel, meta = {}) {
    const result = coreResultFromNative(reportModel && reportModel.native);
    if (!result) return null;

    const label = meta && typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim() : null;
    let pageId = '';
    try {
        const u = new URL(String((meta && meta.url) || result.url || ''));
        pageId = u.hostname + u.pathname;
    } catch {}

    const outDir = meta && meta.outDir
        ? String(meta.outDir)
        : path.join(REPORTS_ROOT, 'surea11y', toSafeId(meta && meta.scenarioName) || 'runs');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = meta && meta.filename
        ? String(meta.filename)
        : `${toSafeId(label || pageId) || 'scan'}-${stamp}.html`;
    const outPath = path.join(outDir, filename);

    const title = (meta && meta.title) ? String(meta.title) : label;
    // Without core's "What's left for a person" (manualChecks): it lists
    // only what core's rules evaluate, where the lab's testing guide and
    // Review conformance give every requirement, with the lab's procedures
    // for the rest (lab-procedures.js). A core before 1.15 ignores it.
    const html = renderHtmlReport(result, { ...(title ? { title } : {}), manualChecks: false });

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');

    const rel = path.relative(REPORTS_ROOT, outPath);
    const publicUrl = rel && !rel.startsWith('..') && !path.isAbsolute(rel)
        ? '/reports/' + rel.split(path.sep).map(encodeURIComponent).join('/')
        : null;

    return {
        path: outPath,
        publicUrl,
        ...screenshotFieldsFor(meta && meta.screenshot)
    };
}

/* =========================
 * Exports
 * ========================= */

module.exports = {
    // engine metadata
    engineId: ENGINE_ID,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,

    // the packs (standards) every scan registers, for core's reporters
    PACKS,

    // helpers
    framesLeftOutMessage,
    normalizeTagsList,
    normalizeRuleIdsList,
    normalizeSeverity,
    normalizeOccurrenceDetails,

    // execution
    ensureInjected,
    runOnPage,
    getRulesForRunOnly,

    // enrichment
    postProcessResults,

    // metadata and catalog
    getRulesCatalog,
    getAllTags,
    LOCALES,
    getAllRuleIds,
    getSelectableRuleIds,

    // report export
    saveHtmlReport,

    // page readiness: core's hooks, before the page's own scripts run
    preparePage: (page, { hooks } = {}) => installCoreHooks(page, Array.isArray(hooks) ? hooks : undefined),
    pageHooksFrom: coreHooksFrom,

    // core's own result, for the CI exports and baselines
    ownResult: coreResultFromNative,

    // capability metadata (used by UI to hide unsupported fields)
    capabilities: {
        // The conformance targets it can check (conformance-targets.js):
        // surea11y applies a standard in full (its profile).
        selectsBy: 'standard',
        // It names EN 301 549's clauses itself (canonical/en301549.js).
        namesEn301549Clauses: true,
        actions: {
            a11yScan: {
                label: true,
                context: true,
                exclude: true, // excludeSelectors supported
                includeBestPractice: true,
                wcagLevel: true,
                timeout: true,
                heavyNodeThreshold: true,
                disableRules: false,
                waitForSelector: true,
                waitVisible: true,
                includeRuleIds: true,
                excludeRuleIds: true,
                includeTags: true,
                excludeTags: true,
                includeMode: true,
                tags: true,
                engineMode: true,
                locale: true,
                findingsSource: true,
            }
        }
    }
};
