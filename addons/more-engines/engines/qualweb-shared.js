'use strict';

/**
 * Shared helpers for QualWeb engine adapters.
 */

const { levelOnlySelection } = require('../../../src/server-side/engines/selection-scope');
const { splitOutcomeCounts } = require('../../../src/server-side/conformance-targets');

function safeRequireVersion(pkgName) {
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const pkg = require(`${pkgName}/package.json`);
        return pkg && pkg.version ? String(pkg.version) : null;
    } catch {
        return null;
    }
}

function extractWcagLevelFromMeta(meta) {
    // Try common places where a level might exist
    const direct = meta && (meta.level || meta.wcagLevel);
    if (direct) return String(direct).trim().toUpperCase();

    const sc = meta && Array.isArray(meta['success-criteria']) ? meta['success-criteria'] : [];
    for (const item of sc) {
        const lvl = item && (item.level || item.conformanceLevel);
        if (lvl) return String(lvl).trim().toUpperCase();
        // Sometimes the name contains "[Level AA]" or similar
        const name = item && item.name ? String(item.name) : '';
        const m = /\bLevel\s+(A{1,3})\b/i.exec(name);
        if (m) return m[1].toUpperCase();
    }
    return null;
}

function mapWcagLevelToSeverity(level) {
    const lvl = level ? String(level).toUpperCase() : '';
    if (lvl === 'A') return 'critical';
    if (lvl === 'AA') return 'serious';
    if (lvl === 'AAA') return 'moderate';
    return 'minor';
}

const WCAG_LEVELS = ['A', 'AA', 'AAA'];

/**
 * The scan's level as QualWeb takes it (QualWeb selects by level only):
 * { level, levels }, levels being every level up to it (AA -> ['A', 'AA']),
 * or undefined for QualWeb's default. A caller with no selection may give
 * WCAG tags, runOnly.wcagLevel or engineOptions.wcagLevel instead.
 */
function qualwebLevels({ selection, runOnly, wcagLevel, engineOptions } = {}) {
  const opts = engineOptions && typeof engineOptions === 'object' ? engineOptions : {};
  const upper = (v) => (v ? String(v).trim().toUpperCase() : null);
  const level = levelOnlySelection({ selection, runOnly, wcagLevel, engineOptions: opts }).level
    || upper(runOnly && runOnly.wcagLevel)
    || upper(opts.wcagLevel);
  if (!level) return { level: null, levels: undefined };
  const idx = WCAG_LEVELS.indexOf(level);
  return { level, levels: idx >= 0 ? WCAG_LEVELS.slice(0, idx + 1) : [level] };
}

async function ensureInjected(_page) {
    // QualWeb does not require script injection into an existing page.
}

function mapVerdictToOutcome(verdictRaw) {
    const v = String(verdictRaw || '').toLowerCase();
    if (v === 'failed' || v === 'fail') return 'fail';
    if (v === 'warning' || v === 'canttell' || v === 'cant_tell') return 'cantTell';
    if (v === 'passed' || v === 'pass') return 'pass';
    if (v === 'inapplicable' || v === 'notapplicable' || v === 'not_applicable') return 'notApplicable';
    // default to cantTell if unknown
    return 'cantTell';
}

function extractScCodesFromSuccessCriteria(scArr) {
    if (!Array.isArray(scArr)) return [];
    const out = [];
    for (const sc of scArr) {
        const name = sc && sc.name ? String(sc.name) : '';
        // Often looks like: "1.1.1 Non-text Content"
        const m = /^(\d+\.\d+\.\d+)/.exec(name.trim());
        if (m) out.push(m[1]);
    }
    // de-dupe
    return Array.from(new Set(out));
}

function pickModuleCtor(mod, preferredNames = []) {
    // 1) Prefer known names
    for (const name of preferredNames) {
        if (typeof mod?.[name] === 'function') return mod[name];
    }
    // 2) Otherwise, pick the first export that has execute() on prototype
    for (const [k, v] of Object.entries(mod || {})) {
        if (typeof v === 'function' && typeof v.prototype?.execute === 'function') return v;
    }
    return null;
}

function buildModulesArray({
                               act = true,
                               wcag = true,
                               bp = true,
                               actOptions = {},
                               wcagOptions = {},
                               bpOptions = {}
                           } = {}) {
    const modules = [];

    if (act) {
        // eslint-disable-next-line global-require
        const actPkg = require('@qualweb/act-rules');
        const ActCtor = pickModuleCtor(actPkg, ['ACTRules', 'ActRules', 'ACTRulesModule']);
        if (!ActCtor) throw new Error('QualWeb adapter: could not find ACT module constructor in @qualweb/act-rules exports.');
        modules.push(new ActCtor(actOptions));
    }

    if (wcag) {
        // eslint-disable-next-line global-require
        const wcagPkg = require('@qualweb/wcag-techniques');
        const WcagCtor = pickModuleCtor(wcagPkg, ['WCAGTechniques', 'WcagTechniques', 'WCAGTechniquesModule']);
        if (!WcagCtor) throw new Error('QualWeb adapter: could not find WCAG Techniques module constructor in @qualweb/wcag-techniques exports.');
        modules.push(new WcagCtor(wcagOptions));
    }

    if (bp) {
        // eslint-disable-next-line global-require
        const bpPkg = require('@qualweb/best-practices');
        const BpCtor = pickModuleCtor(bpPkg, ['BestPractices', 'BestPracticesModule']);
        if (!BpCtor) throw new Error('QualWeb adapter: could not find Best Practices module constructor in @qualweb/best-practices exports.');
        modules.push(new BpCtor(bpOptions));
    }

    return modules;
}

function buildCanonicalFromQualwebReport(
    report,
    {
        engineId,
        engineName,
        engineVersion,
        pageUrl = null,
        pageTitle = null,
        contextSelector = null,
        excludeSelectors = [],
        selectedWcagLevel = null
    } = {}
) {
    const findings = [];

    const modules = report && report.modules && typeof report.modules === 'object' ? report.modules : {};

    const LEVEL_RANK = { A: 1, AA: 2, AAA: 3 };
    const selectedLvl = selectedWcagLevel
        ? String(selectedWcagLevel).trim().toUpperCase()
        : null;
    const selectedRank = selectedLvl ? LEVEL_RANK[selectedLvl] || null : null;

    for (const [moduleKey, moduleVal] of Object.entries(modules)) {
        if (!moduleVal || typeof moduleVal !== 'object') continue;

        const assertions = moduleVal.assertions && typeof moduleVal.assertions === 'object' ? moduleVal.assertions : null;
        if (!assertions) continue;

        for (const [assertionId, assertion] of Object.entries(assertions)) {
            if (!assertion || typeof assertion !== 'object') continue;

            const code = assertion.code || assertionId || null;
            const mapping = assertion.mapping || null;

            const meta = assertion.metadata && typeof assertion.metadata === 'object' ? assertion.metadata : {};
            const outcome = mapVerdictToOutcome(meta.outcome);

            const wcagLevel = extractWcagLevelFromMeta(meta);
            // If a WCAG level was selected for the scan, drop findings above that level
            if (selectedRank && wcagLevel) {
                const wcRank = LEVEL_RANK[String(wcagLevel).toUpperCase()] || null;
                if (wcRank && wcRank > selectedRank) {
                    continue; // skip this assertion, it is AAA when only AA or A was selected
                }
            }

            const severity =
                (outcome === 'fail' || outcome === 'cantTell')
                    ? mapWcagLevelToSeverity(wcagLevel)
                    : undefined;

            const scCodes = extractScCodesFromSuccessCriteria(meta['success-criteria']);

            const occ = [];
            const results = Array.isArray(assertion.results) ? assertion.results : [];
            for (const r of results) {
                if (!r || typeof r !== 'object') continue;

                // Try to extract selector in a robust way
                let target;
                if (r.pointer) {
                    if (Array.isArray(r.pointer)) {
                        const arr = r.pointer.map((p) => String(p || '').trim()).filter(Boolean);
                        if (arr.length) target = arr;
                    } else {
                        const p = String(r.pointer).trim();
                        if (p) target = [p];
                    }
                }

                // Try to extract HTML code in a robust way
                let html;
                if (typeof r.htmlCode === 'string' && r.htmlCode.trim()) {
                    html = r.htmlCode;
                } else if (Array.isArray(r.elements) && r.elements.length) {
                    // Fallback if QualWeb ever nests per element details here
                    const e = r.elements[0];
                    if (e && typeof e.htmlCode === 'string' && e.htmlCode.trim()) {
                        html = e.htmlCode;
                    }
                    if (!target && e && e.pointer) {
                        const p = String(e.pointer).trim();
                        if (p) target = [p];
                    }
                }

                const occurrence = {
                    pageUrl: pageUrl || (report?.system?.url?.completeUrl) || null,
                    target,
                    html,
                    failureSummary: r.description ? String(r.description) : undefined,
                    evidence: {
                        module: moduleKey,
                        verdict: r.verdict,
                        resultCode: r.resultCode,
                        attributes: r.attributes,
                        accessibleName: r.accessibleName
                    }
                };

                // Remove undefined keys to keep output tidy
                for (const k of Object.keys(occurrence)) {
                    if (occurrence[k] === undefined) delete occurrence[k];
                }

                occ.push(occurrence);
            }

            const finding = {
                uid: mapping || code || String(assertionId),
                id: code || mapping || String(assertionId),
                outcome,
                severity,
                tags: [
                    `qualweb:${moduleKey}`,
                    code ? `qualweb:${code}` : null,
                    mapping ? `qualweb:mapping:${mapping}` : null
                ].filter(Boolean),
                wcag: scCodes.length ? { sc: scCodes } : undefined,
                occurrences: occ,
                // QualWeb's best-practices module tests no WCAG criterion.
                bestPractice: /best-?practices|^bp$/i.test(String(moduleKey)) ? true : undefined
            };

            // Keep a few useful strings if available
            if (assertion.name) finding.title = String(assertion.name);
            if (assertion.description) finding.description = String(assertion.description);

            // Cleanup undefined
            for (const k of Object.keys(finding)) {
                if (finding[k] === undefined) delete finding[k];
            }

            findings.push(finding);
        }
    }

    // Build summary counts
    const { outcomes, bestPractices } = splitOutcomeCounts(findings);

    const canonical = {
        version: '1.0',
        engine: { id: engineId, name: engineName, version: engineVersion },
        page: {
            url: pageUrl || (report?.system?.url?.completeUrl) || (report?.system?.url?.inputUrl) || null,
            title: pageTitle || (report?.system?.page?.dom?.title) || null,
            viewport: report?.system?.page?.viewport || null,
            timestamp: new Date().toISOString()
        },
        scope: {
            include: (typeof contextSelector === 'string' && contextSelector.trim()) ? [contextSelector.trim()] : ['html'],
            exclude: Array.isArray(excludeSelectors) ? excludeSelectors : []
        },
        runOptions: {
            wcagLevel: null,
            includeBestPractice: true,
            runOnly: null
        },
        summary: { outcomes, bestPractices },
        findings,
        rules: [],
        diagnostics: []
    };

    // Put the raw module metadata in diagnostics for now, useful for debugging
    canonical.diagnostics.push({
        type: 'qualweb-report-metadata',
        metadata: report?.metadata || null,
        moduleMetadata: Object.fromEntries(
            Object.entries(modules || {}).map(([k, v]) => [k, (v && v.metadata) ? v.metadata : null])
        )
    });

    return canonical;
}

async function runQualwebOnce(url, qualwebOptions, { plugins, clusterOptions, launchOptions } = {}) {
    // eslint-disable-next-line global-require
    const { QualWeb } = require('@qualweb/core');

    const qualweb = new QualWeb(plugins || {});
    await qualweb.start(clusterOptions || {}, launchOptions);
    try {
        const reports = await qualweb.evaluate(qualwebOptions);

        // QualWeb returns an object keyed by URL. The key may differ from the input URL
        // (normalized, redirected, "completeUrl", trailing slash differences, etc.).
        if (!reports || typeof reports !== 'object') return null;

        const u = url ? String(url).trim() : '';

        // 1) exact match
        if (u && reports[u]) return reports[u];

        // 2) common alternates
        const uNoSlash = (u && u.endsWith('/')) ? u.slice(0, -1) : u;
        if (uNoSlash && reports[uNoSlash]) return reports[uNoSlash];

        // 3) if only one report exists, return it
        const keys = Object.keys(reports);
        if (keys.length === 1) return reports[keys[0]];

        // 4) try match against system.url.completeUrl
        for (const k of keys) {
            const r = reports[k];
            const complete = r && r.system && r.system.url && r.system.url.completeUrl ? String(r.system.url.completeUrl).trim() : '';
            const completeNoSlash = (complete && complete.endsWith('/')) ? complete.slice(0, -1) : complete;
            if (complete && (complete === u || completeNoSlash === uNoSlash)) return r;
        }

        // Not found, return the full set for debugging.
        return {
            __qualweb: {
                note: keys.length
                    ? 'Could not resolve per-URL report key, returning all reports for debugging.'
                    : 'QualWeb returned an empty reports map, returning debug wrapper.',
                inputUrl: u,
                reportKeys: keys,
                optionsHint: {
                    hasModules: Array.isArray(qualwebOptions && qualwebOptions.modules),
                    hasExecute: !!(qualwebOptions && qualwebOptions.execute),
                    execute: (qualwebOptions && qualwebOptions.execute) ? qualwebOptions.execute : null
                }
            },
            __allReports: reports
        };
    } finally {
        await qualweb.stop();
    }
}

function needsModulesArrayFallback(err) {
    const msg = err && err.message ? String(err.message) : '';
    return /modules\s+is\s+not\s+iterable/i.test(msg) || /options\.modules/i.test(msg);
}

async function evaluateWithBestEffort(url, options, engineOptions) {
    // Prefer modules-array mode first (current QualWeb core versions expect this shape).
    // Fall back to execute-style config only if modules construction fails or evaluate throws.
    let lastErr = null;

    // Build modules from either explicit modulesConfig or the execute-style flags/options we already computed.
    try {
        const modulesConfig = engineOptions && engineOptions.modulesConfig ? engineOptions.modulesConfig : null;

        const modules = buildModulesArray(modulesConfig || {
            act: !!options?.execute?.act,
            wcag: !!options?.execute?.wcag,
            bp: !!options?.execute?.bp,
            actOptions: options?.['act-rules'] || {},
            wcagOptions: options?.['wcag-techniques'] || {},
            bpOptions: options?.['best-practices'] || {}
        });

        const optionsModules = { ...options, modules };
        // Remove execute-style config to avoid confusing the newer API
        delete optionsModules.execute;

        return await runQualwebOnce(url, optionsModules, engineOptions);
    } catch (e) {
        lastErr = e;
    }

    // Fallback, try execute-style config (older API shape).
    try {
        return await runQualwebOnce(url, options, engineOptions);
    } catch (e2) {
        // If both fail, throw the most useful error.
        throw lastErr || e2;
    }
}

module.exports = {
    safeRequireVersion,
    qualwebLevels,
    extractWcagLevelFromMeta,
    mapWcagLevelToSeverity,
    ensureInjected,
    mapVerdictToOutcome,
    extractScCodesFromSuccessCriteria,
    pickModuleCtor,
    buildModulesArray,
    buildCanonicalFromQualwebReport,
    runQualwebOnce,
    needsModulesArrayFallback,
    evaluateWithBestEffort
};
