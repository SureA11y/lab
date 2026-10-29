'use strict';

/**
 * QualWeb engine adapter (core + modules)
 *
 * Design goals:
 * - Conform to the a11y-engine facade adapter contract.
 * - Return the canonical model (engine-agnostic).
 * - Work with both QualWeb "execute config" style and newer "modules array" style,
 *   by attempting execute-style first, then falling back when needed.
 *
 * Notes:
 * - QualWeb runs its own Puppeteer instance internally (cluster). This adapter
 *   evaluates by URL, it does not reuse the Puppeteer Page instance that the runner uses.
 * - Because the facade does not expose a lifecycle hook to stop engines, this adapter
 *   starts and stops QualWeb per run by default. You can opt into keeping it warm by
 *   setting engineOptions.keepAlive=true.
 */

const ENGINE_ID = 'qualweb';
const ENGINE_NAME = 'QualWeb (WCAG + ACT)';
let ENGINE_VERSION = null;

const {
  safeRequireVersion,
  qualwebLevels,
  ensureInjected,
  mapVerdictToOutcome,
  extractScCodesFromSuccessCriteria,
  extractWcagLevelFromMeta,
  mapWcagLevelToSeverity,
  buildCanonicalFromQualwebReport,
  evaluateWithBestEffort
} = require('./qualweb-shared');

ENGINE_VERSION = safeRequireVersion('@qualweb/core');

async function runOnPage(page, { selection, runOnly, wcagLevel, contextSelector, excludeSelectors, engineOptions, postProcess } = {}) {
  // Capture page metadata outside the page context
  let pageUrl = null;
  let pageTitle = null;
  try { pageUrl = await page.url(); } catch {}
  try { pageTitle = await page.title(); } catch {}

  const opts = engineOptions && typeof engineOptions === 'object' ? engineOptions : {};

  // Engine behavior toggles
  const mode = 'all';

  // The scan's level, as QualWeb takes it: every level up to it.
  const { level: lvl, levels } = qualwebLevels({ selection, runOnly, wcagLevel, engineOptions: opts });

  const execute = {
    wappalyzer: false,
    counter: false,
    act: true,
    wcag: true,
    bp: false
  };

  const qualwebOptions = {
    url: pageUrl || '',
    log: opts.log || { file: false, console: false },
    viewport: opts.viewport,
    waitUntil: opts.waitUntil,
    validator: opts.validator,
    translate: opts.translate,

    execute,

    'act-rules': {
      ...(opts['act-rules'] || {}),
      ...(levels ? { levels } : null)
    },

    'wcag-techniques': {
      ...(opts['wcag-techniques'] || {}),
      ...(levels ? { levels } : null)
    },

    'best-practices': {
      ...(opts['best-practices'] || {})
    }
  };

  // Remove undefined keys that QualWeb might not like
  for (const k of Object.keys(qualwebOptions)) {
    if (qualwebOptions[k] === undefined) delete qualwebOptions[k];
  }

  // Run QualWeb and get the report for this URL
  const report = await evaluateWithBestEffort(pageUrl || '', qualwebOptions, {
    plugins: opts.plugins,
    clusterOptions: opts.clusterOptions,
    launchOptions: opts.launchOptions
  });

  const reportDebug = report && report.__qualweb ? report.__qualweb : null;

  // If evaluateWithBestEffort returned the debug wrapper, select the best candidate report
  // so canonical mapping can proceed.
  let reportResolved = report;
  if (report && report.__allReports && typeof report.__allReports === 'object') {
    const reports = report.__allReports;
    const keys = Object.keys(reports);
    const inputUrl = (report.__qualweb && report.__qualweb.inputUrl) ? String(report.__qualweb.inputUrl) : '';
    const inputNoSlash = inputUrl.endsWith('/') ? inputUrl.slice(0, -1) : inputUrl;

    // Prefer a report whose system.url.completeUrl matches input (with/without slash)
    let picked = null;
    for (const k of keys) {
      const r = reports[k];
      const complete = r && r.system && r.system.url && r.system.url.completeUrl ? String(r.system.url.completeUrl).trim() : '';
      const completeNoSlash = complete.endsWith('/') ? complete.slice(0, -1) : complete;
      if (complete && (complete === inputUrl || completeNoSlash === inputNoSlash)) { picked = r; break; }
    }

    // Fallback: if only one report exists, pick it
    if (!picked && keys.length === 1) picked = reports[keys[0]];

    // Last resort: pick the first key
    if (!picked && keys.length) picked = reports[keys[0]];

    if (picked) reportResolved = picked;
  }

  const canonical = buildCanonicalFromQualwebReport(reportResolved || {}, {
    engineId: ENGINE_ID,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    pageUrl,
    pageTitle,
    contextSelector,
    excludeSelectors,
    selectedWcagLevel: lvl
  });

  if (reportDebug) {
    canonical.diagnostics.push({ type: 'qualweb-report-key-mismatch', ...reportDebug });
  }

  // Fill runOptions for traceability
  canonical.runOptions = {
    wcagLevel: lvl ? String(lvl).toLowerCase() : null,
    includeBestPractice: !!execute.bp,
    runOnly: runOnly || null
  };

  const out = {
    canonical,
    native: (report && report.__allReports ? report : (reportResolved || {})),
    meta: { engine: ENGINE_ID, mode, executed: execute }
  };

  // Optional post-processing hook, consistent with other adapters
  const final = postProcess ? postProcessResults(out, postProcess) : out;
  return final;
}

function postProcessResults(nativeResults, _ctx = {}) {
  // By default, do not mutate.
  return nativeResults;
}

module.exports = {
  engineId: ENGINE_ID,
  engineName: ENGINE_NAME,
  engineVersion: ENGINE_VERSION,

  ensureInjected,
  runOnPage,
  postProcessResults,

  // QualWeb does not currently expose a simple rules catalog through this adapter
  getRulesCatalog: null,

  capabilities: {
    // The conformance targets it can check (conformance-targets.js):
    // QualWeb selects a WCAG level only.
    selectsBy: 'level',
    actions: {
      a11yScan: {
        label: true,
        context: false,
        exclude: false,
        includeBestPractice: false,
        wcagLevel: true,
        timeout: true,
        heavyNodeThreshold: false,
        disableRules: false,
        waitForSelector: false,
        waitVisible: false,
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
  }
};
