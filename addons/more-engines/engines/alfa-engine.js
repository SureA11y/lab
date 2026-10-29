'use strict';

/**
 * Alfa (Siteimprove) engine adapter.
 *
 * Alfa ships as pure ESM (@siteimprove/alfa-*), so unlike the other adapters
 * in this directory it cannot be required at module load time. Everything
 * beyond reading package.json for the version is loaded lazily via dynamic
 * import() inside the async execution functions.
 *
 * Alfa runs against a snapshot of the live DOM (via @siteimprove/alfa-puppeteer,
 * which serializes document/window state out of the existing Puppeteer page),
 * not by re-navigating to a URL, so it observes the same page state axe/surea11y do.
 */

const ENGINE_ID = 'alfa';
const ENGINE_NAME = 'Alfa (Siteimprove)';

let ENGINE_VERSION = null;
try {
    ENGINE_VERSION = require('@siteimprove/alfa-rules/package.json').version || null;
} catch {}

const WCAG_LEVELS = ['A', 'AA', 'AAA'];

const { levelOnlySelection } = require('../../../src/server-side/engines/selection-scope');
const { splitOutcomeCounts } = require('../../../src/server-side/conformance-targets');

async function ensureInjected(_page) {
    // Alfa audits a serialized DOM snapshot in Node; nothing to inject into the page.
}

let _modulesPromise = null;
function loadAlfaModules() {
    if (!_modulesPromise) {
        _modulesPromise = Promise.all([
            import('@siteimprove/alfa-act'),
            import('@siteimprove/alfa-rules'),
            import('@siteimprove/alfa-wcag'),
            import('@siteimprove/alfa-puppeteer'),
            import('@siteimprove/alfa-dom'),
        ]).then(([act, rulesModule, wcag, puppeteerBridge, dom]) => ({
            Audit: act.Audit,
            allRules: Array.from(rulesModule.default),
            Conformance: wcag.Conformance,
            Puppeteer: puppeteerBridge.Puppeteer,
            Element: dom.Element,
        }));
    }
    return _modulesPromise;
}

function hasCriterionRequirement(rule) {
    for (const req of rule.requirements) {
        if (req.type === 'criterion') return true;
    }
    return false;
}

/**
 * Alfa rules aren't tagged by WCAG level directly; each rule carries WCAG
 * success-criterion requirements, and Conformance.isA/isAA/isAAA tests those.
 * Rules with no criterion requirement are Alfa's "best practice" rules.
 */
function resolveRules(allRules, Conformance, { wcagLevel, includeBestPractice } = {}) {
    let list = includeBestPractice ? allRules : allRules.filter(hasCriterionRequirement);

    const level = wcagLevel ? String(wcagLevel).toUpperCase() : null;
    if (!level || !WCAG_LEVELS.includes(level)) return list;

    try {
        const isLevel = level === 'A' ? Conformance.isA() : level === 'AA' ? Conformance.isAA() : Conformance.isAAA();
        return list.filter((rule) => {
            for (const req of rule.requirements) {
                if (req.type === 'criterion' && isLevel(req)) return true;
            }
            return includeBestPractice && !hasCriterionRequirement(rule);
        });
    } catch {
        // If conformance filtering breaks for any reason, run the unfiltered set rather than nothing.
        return list;
    }
}

/**
 * Alfa's Element#path() returns an XPath like /html[1]/body[1]/div[2]/button[1],
 * where each index counts same-tag siblings — exactly nth-of-type semantics.
 */
function xpathToCssSelector(xpath) {
    if (typeof xpath !== 'string' || !xpath) return null;
    const segments = xpath.split('/').filter(Boolean);
    const parts = [];
    for (const seg of segments) {
        const m = /^([a-zA-Z][a-zA-Z0-9:_-]*)\[(\d+)\]$/.exec(seg);
        if (!m) return null;
        parts.push(`${m[1]}:nth-of-type(${m[2]})`);
    }
    return parts.length ? parts.join(' > ') : null;
}

const OUTCOME_MAP = {
    passed: 'pass',
    failed: 'fail',
    cantTell: 'cantTell',
    inapplicable: 'notApplicable',
};

const LEVEL_RANK = { A: 1, AA: 2, AAA: 3 };

function mapWcagLevelToSeverity(level) {
    if (level === 'A') return 'critical';
    if (level === 'AA') return 'serious';
    if (level === 'AAA') return 'moderate';
    return 'minor';
}

/**
 * A rule can carry several criterion requirements (e.g. both the AA and AAA
 * contrast criteria). Severity is driven by the strictest (lowest) level among them;
 * a rule with no criterion requirement at all is a "best practice" rule.
 */
function levelForRule(rule, { isA, isAA, isAAA }) {
    let best = null;
    for (const req of rule.requirements) {
        if (req.type !== 'criterion') continue;
        let level = null;
        try {
            if (isA(req)) level = 'A';
            else if (isAA(req)) level = 'AA';
            else if (isAAA(req)) level = 'AAA';
        } catch {}
        if (!level) continue;
        if (!best || LEVEL_RANK[level] < LEVEL_RANK[best]) best = level;
    }
    return best;
}

function collectFailureMessages(expectations) {
    const messages = [];
    for (const [, result] of expectations) {
        try {
            if (typeof result.isErr === 'function' && result.isErr()) {
                messages.push(result.getErr().message);
            }
        } catch {}
    }
    return messages.join(' ');
}

async function buildOccurrence(outcome, { page, pageUrl, Element }) {
    const occurrence = { pageUrl: pageUrl || null };
    const target = outcome.target;

    if (target && Element.isElement(target)) {
        let alfaPath = null;
        try { alfaPath = target.path(); } catch {}
        const selector = xpathToCssSelector(alfaPath);

        if (selector) {
            occurrence.target = [selector];
            try {
                occurrence.html = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.outerHTML : undefined;
                }, selector);
            } catch {}
        } else if (alfaPath) {
            occurrence.target = [alfaPath];
        }
    }

    if (outcome.outcome === 'failed') {
        const summary = collectFailureMessages(outcome.expectations);
        if (summary) occurrence.failureSummary = summary;
    } else if (outcome.outcome === 'cantTell') {
        try { occurrence.failureSummary = outcome.diagnostic.message; } catch {}
    }

    occurrence.evidence = { mode: outcome.mode };

    for (const key of Object.keys(occurrence)) {
        if (occurrence[key] === undefined) delete occurrence[key];
    }
    return occurrence;
}

async function mapOutcomesToFindings(outcomes, { page, pageUrl, Element, levelPredicates }) {
    const findings = [];

    for (const outcome of outcomes) {
        const canonicalOutcome = OUTCOME_MAP[outcome.outcome] || 'cantTell';

        const rule = outcome.rule;
        const ruleUri = String(rule.uri);
        const ruleId = ruleUri.split('/').filter(Boolean).pop() || ruleUri;

        const scCodes = [];
        for (const req of rule.requirements) {
            if (req.type === 'criterion' && req.chapter) scCodes.push(req.chapter);
        }

        const occurrences = canonicalOutcome === 'notApplicable'
            ? []
            : [await buildOccurrence(outcome, { page, pageUrl, Element })];

        const severity = (canonicalOutcome === 'fail' || canonicalOutcome === 'cantTell')
            ? mapWcagLevelToSeverity(levelForRule(rule, levelPredicates))
            : undefined;

        const finding = {
            uid: ruleId,
            id: ruleId,
            outcome: canonicalOutcome,
            severity,
            wcag: scCodes.length ? { sc: scCodes } : undefined,
            tags: [`alfa:${ruleId}`],
            occurrences,
            title: ruleUri,
            // A rule that tests no WCAG criterion is one of Alfa's best practices.
            bestPractice: hasCriterionRequirement(rule) ? undefined : true,
        };
        for (const key of Object.keys(finding)) {
            if (finding[key] === undefined) delete finding[key];
        }
        findings.push(finding);
    }

    return { findings, ...splitOutcomeCounts(findings) };
}

async function runOnPage(page, { selection, runOnly, wcagLevel: requestedLevel, contextSelector, excludeSelectors, engineOptions, postProcess } = {}) {
    const { Audit, allRules, Conformance, Puppeteer, Element } = await loadAlfaModules();

    let pageUrl = null;
    let pageTitle = null;
    try { pageUrl = await page.url(); } catch {}
    try { pageTitle = await page.title(); } catch {}

    const opts = (engineOptions && typeof engineOptions === 'object') ? engineOptions : {};
    // Alfa filters by level: the scan's, and its best-practice switch.
    const scan = levelOnlySelection({ selection, runOnly, wcagLevel: requestedLevel || opts.wcagLevel, engineOptions: opts });
    // A direct caller's own hint ({ wcagLevel, includeBestPractice }) still works.
    const hint = runOnly && typeof runOnly === 'object' ? runOnly : {};
    const wcagLevel = scan.level || hint.wcagLevel || null;
    const includeBestPractice = scan.bestPractices || hint.includeBestPractice === true || opts.includeBestPractice === true;

    const rules = resolveRules(allRules, Conformance, { wcagLevel, includeBestPractice });

    const documentHandle = await page.evaluateHandle(() => document);
    const alfaPage = await Puppeteer.toPage(documentHandle);

    const outcomes = await Audit.of(alfaPage, rules).evaluate();

    const levelPredicates = { isA: Conformance.isA(), isAA: Conformance.isAA(), isAAA: Conformance.isAAA() };
    const { findings, outcomes: summary, bestPractices } = await mapOutcomesToFindings(outcomes, { page, pageUrl, Element, levelPredicates });

    const canonical = {
        version: '1.0',
        engine: { id: ENGINE_ID, name: ENGINE_NAME, version: ENGINE_VERSION },
        page: {
            url: pageUrl,
            title: pageTitle,
            viewport: null,
            timestamp: new Date().toISOString(),
        },
        scope: {
            include: contextSelector ? [String(contextSelector)] : ['html'],
            exclude: Array.isArray(excludeSelectors) ? excludeSelectors.map(String) : [],
        },
        runOptions: {
            wcagLevel: wcagLevel ? String(wcagLevel).toLowerCase() : null,
            includeBestPractice,
            runOnly: runOnly || null,
        },
        summary: { outcomes: summary, bestPractices },
        findings,
        rules: [],
        diagnostics: [],
    };

    const out = { canonical, native: { ruleCount: rules.length, findingCount: findings.length } };
    return postProcess ? postProcessResults(out, postProcess) : out;
}

function postProcessResults(nativeResults, _ctx = {}) {
    return nativeResults;
}

module.exports = {
    engineId: ENGINE_ID,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,


    ensureInjected,
    runOnPage,
    postProcessResults,

    getRulesCatalog: null,

    capabilities: {
        // The conformance targets it can check (conformance-targets.js):
        // Alfa selects a WCAG level only.
        selectsBy: 'level',
        actions: {
            a11yScan: {
                label: true,
                context: false,
                exclude: false,
                includeBestPractice: true,
                wcagLevel: true,
                timeout: false,
                heavyNodeThreshold: false,
                disableRules: false,
                waitForSelector: true,
                waitVisible: true,
                includeRuleIds: false,
                excludeRuleIds: false,
                includeTags: false,
                excludeTags: false,
                includeMode: false,
                engineMode: false,
                locale: false,
                optInRules: false,
                findingsSource: false,
            },
        },
    },
};
