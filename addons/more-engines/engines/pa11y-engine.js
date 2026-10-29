'use strict';

const path = require("path");
const fs = require("fs");
/**
 * Pa11y Accessibility Engine Adapter
 *
 * Goals:
 * - Keep the app engine-agnostic.
 * - Produce CANONICAL findings for runtime.
 * - Keep pa11y-native output only for debug/export paths.
 *
 * Runner selection:
 * - engineOptions.pa11y.runner = "axe" | "htmlcs"
 *   (default: "axe")
 *
 * Notes:
 * - This adapter is intentionally conservative: it is issue-based only.
 *   It does NOT synthesize "pass" or "notApplicable" rules that pa11y didn't report.
 * - Outcome mapping:
 *     pa11y issue.type: "error"   -> canonical outcome "fail"
 *                       "warning" -> canonical outcome "cantTell"
 *                       "notice"  -> (default) ignored (can be enabled)
 */

const { levelOnlySelection } = require('../../../src/server-side/engines/selection-scope');

const ENGINE_ID = 'pa11y';
const ENGINE_NAME = 'Pa11y (axe)';
// Read from the installed pa11y package instead of a hand-maintained constant,
// so this can't silently drift out of sync with the actual dependency.
let ENGINE_VERSION = null;
try { ENGINE_VERSION = require('pa11y/package.json').version || null; } catch {}

/* =========================
 * Pa11y configuration helpers
 * ========================= */

/**
 * Pa11y's "standard" for a scan: WCAG2A, WCAG2AA or WCAG2AAA, from the
 * scan's level (Pa11y selects by level only), or null for Pa11y's default.
 */
function pa11yStandard({ selection, runOnly, wcagLevel, engineOptions } = {}) {
    const { level } = levelOnlySelection({ selection, runOnly, wcagLevel, engineOptions });
    return level ? `WCAG2${level}` : null;
}

function normalizeSeverity(sev) {
    const v = String(sev || '').toLowerCase();
    if (v === 'critical' || v === 'serious' || v === 'moderate' || v === 'minor') return v;
    if (v === 'severe') return 'serious';
    if (v === 'low') return 'minor';
    if (v === 'medium') return 'moderate';
    return 'moderate';
}

function outcomeFromPa11yType(typeRaw) {
    const t = String(typeRaw || '').toLowerCase();
    if (t === 'error') return 'fail';
    if (t === 'warning') return 'cantTell';
    if (t === 'notice') return 'notApplicable'; // not used by default; can be enabled
    return 'cantTell';
}

function defaultSeverityFromPa11yType(typeRaw) {
    const t = String(typeRaw || '').toLowerCase();
    if (t === 'error') return 'serious';
    if (t === 'warning') return 'moderate';
    if (t === 'notice') return 'minor';
    return 'moderate';
}

function shouldIncludeNotice(engineOptions) {
    const opts = (engineOptions && typeof engineOptions === 'object') ? engineOptions : {};
    const pa = (opts.pa11y && typeof opts.pa11y === 'object') ? opts.pa11y : opts;
    return pa.includeNotices === true;
}

function shouldIncludeEngineNode(engineOptions) {
    const opts = (engineOptions && typeof engineOptions === 'object') ? engineOptions : {};
    const pa = (opts.pa11y && typeof opts.pa11y === 'object') ? opts.pa11y : opts;
    return pa.includeEngineNode !== false;
}

function severityOverrides(engineOptions) {
    // Optional: engineOptions.pa11y.severityByCode = { "<fullCode>": "critical", ... }
    const opts = (engineOptions && typeof engineOptions === 'object') ? engineOptions : {};
    const pa = (opts.pa11y && typeof opts.pa11y === 'object') ? opts.pa11y : opts;
    const map = pa && typeof pa.severityByCode === 'object' && pa.severityByCode ? pa.severityByCode : null;
    return map && typeof map === 'object' ? map : null;
}

function getRunner(engineOptions) {
    // engineOptions.pa11y.runner = "axe" | "htmlcs"
    const opts = (engineOptions && typeof engineOptions === 'object') ? engineOptions : {};
    const pa = (opts.pa11y && typeof opts.pa11y === 'object') ? opts.pa11y : opts;
    const r = String(pa.runner || '').trim().toLowerCase();
    if (r === 'axe' || r === 'htmlcs') return r;
    return 'axe';
}

/* =========================
 * WCAG extraction + nicer rule ids
 * ========================= */

function extractWcagScFromHtmlcsCode(fullCode) {
    // Example: "WCAG2AA.Principle1.Guideline1_1.1_1_1.H67.1"
    // We extract the "1_1_1" and convert to "1.1.1"
    const s = String(fullCode || '');
    const m = s.match(/Guideline\d+_\d+(?:_\d+)?\.(\d+(?:_\d+)+)(?:_[A-Z]\d+)?\./i);
    if (!m || !m[1]) return [];
    const sc = m[1].replace(/_/g, '.');
    if (!/^\d+(?:\.\d+)+$/.test(sc)) return [];
    return [sc];
}

function extractWcagScFromText(text) {
    // Find patterns like "1.1.1" or "2.4.7"
    const t = String(text || '');
    const hits = t.match(/\b\d+\.\d+\.\d+\b/g) || [];
    // de-dupe
    return Array.from(new Set(hits));
}

function extractWcagSc(issue) {
    const sc = [];
    if (issue && typeof issue === 'object') {
        sc.push(...extractWcagScFromHtmlcsCode(issue.code));
        sc.push(...extractWcagScFromText(issue.message));
        sc.push(...extractWcagScFromText(issue.description));
    }
    return Array.from(new Set(sc.filter(Boolean)));
}

function shortRuleId(issue) {
    // Prefer a readable short id for UI columns.
    // - htmlcs: use trailing technique code like "H67.1"
    // - axe: use its rule id when present (often already short)
    const full = String(issue && issue.code ? issue.code : '').trim();
    if (!full) return 'pa11y-issue';

    // htmlcs codes are dot-separated, and the technique code sits at the very end
    // (e.g. "...Guideline1_1.1_1_1.H67.1"). Match against the full string rather than
    // splitting on ".", since a sub-technique suffix like ".1" would otherwise land in
    // its own segment and fail to match on its own.
    const m = /([A-Z]{1,3}\d+(?:\.\d+)*)$/i.exec(full);
    if (m) return m[1];

    // axe rules may already be short ids (e.g., "image-alt")
    return full;
}

/* =========================
 * Adapter API
 * ========================= */

async function ensureInjected(_page) {
    // pa11y drives evaluation itself
    return;
}

async function getRulesForRunOnly(_page, _runOnly) {
    // Pa11y does not expose a stable per-run rules catalog like axe.
    // Keep surface compatible.
    return [];
}

function postProcessResults(nativeResults, _ctx = {}) {
    // For pa11y, do not mutate by default.
    return nativeResults;
}

function getRulesCatalog() {
    return { version: ENGINE_VERSION, rules: [] };
}

/**
 * Execute pa11y and return { native, canonical }.
 */
async function runOnPage(page, { selection, runOnly, wcagLevel, contextSelector, excludeSelectors, engineOptions, postProcess } = {}) {
    const pa11y = require('pa11y');

    // Page metadata
    let pageUrl = null;
    let pageTitle = null;
    try { pageUrl = await page.url(); } catch {}
    try { pageTitle = await page.title(); } catch {}

    // Build pa11y options (conservative defaults)
    const paStandard = pa11yStandard({ selection, runOnly, wcagLevel, engineOptions });
    const includeNotices = shouldIncludeNotice(engineOptions);
    const runner = getRunner(engineOptions);

    const opts = (engineOptions && typeof engineOptions === 'object') ? engineOptions : {};
    const pa = (opts.pa11y && typeof opts.pa11y === 'object') ? opts.pa11y : opts;

    const pa11yOptions = {
        runner, // "axe" | "htmlcs"
        standard: paStandard || pa.standard || undefined,
        includeWarnings: true, // to get cantTell coverage
        includeNotices: includeNotices,
        timeout: Number.isFinite(Number(pa.timeout)) ? Number(pa.timeout) : undefined,
        wait: Number.isFinite(Number(pa.wait)) ? Number(pa.wait) : undefined,
        // Limit scope if provided (pa11y supports rootElement)
        rootElement: (typeof contextSelector === 'string' && contextSelector.trim()) ? contextSelector.trim() : undefined,
    };

    // excludeSelectors is not directly supported by pa11y; keep in canonical.scope for traceability
    if (Array.isArray(excludeSelectors) && excludeSelectors.length) {
        // no-op here
    }

    // Run pa11y.
    // Pa11y versions differ in how they accept Puppeteer handles.
    // We try to reuse the current page if supported, otherwise fall back to URL run.
    let native = null;
    let lastErr = null;

    // Attempt 1: pass the current page
    try {
        native = await pa11y(pageUrl || '', { ...pa11yOptions, page });
    } catch (e) {
        lastErr = e;
    }

    // Attempt 2: pass the browser instance
    if (!native) {
        try {
            const browser = (page && typeof page.browser === 'function') ? page.browser() : null;
            native = await pa11y(pageUrl || '', { ...pa11yOptions, browser: browser || undefined });
        } catch (e) {
            lastErr = e;
        }
    }

    // Attempt 3: plain URL scan
    if (!native) {
        try {
            native = await pa11y(pageUrl || '', { ...pa11yOptions });
        } catch (e) {
            lastErr = e;
        }
    }

    if (!native) {
        const msg = lastErr && lastErr.message ? lastErr.message : String(lastErr || 'Unknown pa11y error');
        throw new Error(`pa11y scan failed: ${msg}`);
    }

    // Optional adapter post-processing hook (keep pattern consistent with other engines)
    if (postProcess && typeof postProcess === 'object' && typeof postProcessResults === 'function') {
        try { postProcessResults(native, postProcess); } catch {}
    }

    const issues = Array.isArray(native.issues) ? native.issues : [];

    const sevByCode = severityOverrides(engineOptions);
    const includeEngineNode = shouldIncludeEngineNode(engineOptions);

    // Group issues by code to reduce duplicates; merge occurrences.
    const byUid = new Map();

    for (const issue of issues) {
        if (!issue || typeof issue !== 'object') continue;

        const type = String(issue.type || '').toLowerCase();
        if (type === 'notice' && !includeNotices) continue;

        const fullCode = String(issue.code || issue.runner || issue.message || 'pa11y-issue');
        const uid = fullCode; // stable identity
        const ruleId = shortRuleId(issue); // nicer for UI columns

        const outcome = (type === 'notice')
            ? 'notApplicable'
            : outcomeFromPa11yType(type);

        const severity = normalizeSeverity(
            (sevByCode && uid in sevByCode) ? sevByCode[uid] : defaultSeverityFromPa11yType(type)
        );

        const title = String(issue.message || ruleId || uid);
        const description = issue.description ? String(issue.description) : null;

        const selector = issue.selector ? String(issue.selector) : null;
        const contextHtml = issue.context ? String(issue.context) : null;

        const occ = {
            pageUrl: pageUrl || null,
            target: selector ? [selector] : [],
            html: contextHtml || '',
            failureSummary: title
        };

        if (includeEngineNode) {
            occ.evidence = {
                engineNode: {
                    url: (pageUrl ? [pageUrl] : []),
                    pageUrl: pageUrl || null,
                    target: occ.target,
                    html: occ.html,
                    failureSummary: occ.failureSummary
                }
            };
        }

        const wcagSc = extractWcagSc(issue);

        if (!byUid.has(uid)) {
            byUid.set(uid, {
                id: ruleId,
                uid,
                ruleId,
                outcome,
                severity,
                title,
                description,
                helpUrl: null,
                tags: [ENGINE_ID, runner].filter(Boolean),
                wcag: { sc: wcagSc },
                occurrences: [occ]
            });
        } else {
            const f = byUid.get(uid);
            // If the same uid yields both fail and cantTell, keep the "worst" outcome.
            // fail > cantTell > pass > notApplicable
            f.outcome = worstOutcome(f.outcome, outcome);
            f.severity = worstSeverity(f.severity, severity);
            f.occurrences.push(occ);

            // Merge WCAG SC if we learned more later
            const merged = new Set([...(f.wcag && Array.isArray(f.wcag.sc) ? f.wcag.sc : []), ...wcagSc]);
            f.wcag = { sc: Array.from(merged) };
        }
    }

    const findings = Array.from(byUid.values());

    const canonical = {
        version: '1.0',
        engine: {
            id: ENGINE_ID,
            name: ENGINE_NAME,
            version: ENGINE_VERSION
        },
        page: {
            url: pageUrl || (native && native.pageUrl) || null,
            title: pageTitle || null,
            viewport: null,
            timestamp: new Date().toISOString()
        },
        scope: {
            include: (typeof contextSelector === 'string' && contextSelector.trim()) ? [contextSelector.trim()] : ['html'],
            exclude: Array.isArray(excludeSelectors) ? excludeSelectors.map(String) : []
        },
        run: {
            runOnly: runOnly || null,
            engineOptions: engineOptions || {}
        },
        diagnostics: {
            runner,
            standard: pa11yOptions.standard || null
        },
        findings
    };

    return { native, canonical };
}

function worstOutcome(a, b) {
    const rank = { fail: 4, cantTell: 3, pass: 2, notApplicable: 1 };
    const ra = rank[a] || 0;
    const rb = rank[b] || 0;
    return (rb > ra) ? b : a;
}

function worstSeverity(a, b) {
    const rank = { critical: 4, serious: 3, moderate: 2, minor: 1 };
    const ra = rank[a] || 0;
    const rb = rank[b] || 0;
    return (rb > ra) ? b : a;
}

/**
 * Optional HTML report exporter behind adapter boundary.
 * (Keeps export flows consistent with other engines.)
 */
function saveHtmlReport(reportModel, meta = {}) {
    const fs = require('fs');
    const path = require('path');

    const outDir = meta && meta.outDir ? String(meta.outDir) : process.cwd();
    const filename = meta && meta.filename ? String(meta.filename) : `pa11y-report-${Date.now()}.html`;
    const outPath = path.join(outDir, filename);

    const title = (meta && meta.title) ? String(meta.title) : 'Pa11y Accessibility Report';
    const payload = (reportModel && typeof reportModel === 'object') ? reportModel : {};
    // Allow a wrapping variant (e.g. pa11y-htmlcs-engine.js) to identify itself here
    // instead of this module's own identity, since it delegates to this function.
    const engineName = (meta && meta.engineName) ? String(meta.engineName) : ENGINE_NAME;
    const engineVersion = (meta && meta.engineVersion) ? String(meta.engineVersion) : ENGINE_VERSION;

    const html = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        `  <title>${escapeHtml(title)}</title>`,
        '  <style>',
        '    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px;}',
        '    pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto;}',
        '    .meta{color:#374151;font-size:14px;margin-bottom:12px;}',
        '  </style>',
        '</head>',
        '<body>',
        `  <h1>${escapeHtml(title)}</h1>`,
        `  <div class="meta">Engine: ${escapeHtml(engineName)} (${escapeHtml(engineVersion)}), generated: ${escapeHtml(new Date().toISOString())}</div>`,
        '  <h2>Payload</h2>',
        `  <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`,
        '</body>',
        '</html>'
    ].join('\n');

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');

    return outPath;
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = {
    // engine metadata (useful for canonical results)
    engineId: ENGINE_ID,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,

    // helpers
    pa11yStandard,

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
        // Pa11y selects a WCAG level only.
        selectsBy: 'level',
        actions: {
            a11yScan: {
                label: true,
                context: true,
                exclude: false,
                includeBestPractice: false,
                wcagLevel: true,
                timeout: true,
                heavyNodeThreshold: true,
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
                findingsSource: false
            }
        }
    },
};
