'use strict';

const base = require('./pa11y-engine');

const ENGINE_ID = 'pa11y-htmlcs';
const ENGINE_NAME = 'Pa11y (HTML_CodeSniffer)';
const ENGINE_VERSION = base && typeof base.engineVersion === 'string' ? base.engineVersion : null;

function forceHtmlcsRunner(engineOptions) {
    const opts = (engineOptions && typeof engineOptions === 'object') ? { ...engineOptions } : {};
    // pa11y-engine.js's helpers accept either a nested `engineOptions.pa11y` namespace or
    // flattened top-level keys. Carry flattened keys into the new `.pa11y` object so they
    // aren't dropped once `.pa11y` exists.
    const pa = (opts.pa11y && typeof opts.pa11y === 'object') ? { ...opts.pa11y } : { ...opts };
    pa.runner = 'htmlcs';
    opts.pa11y = pa;
    return opts;
}

async function runOnPage(page, args = {}) {
    const input = (args && typeof args === 'object') ? { ...args } : {};
    input.engineOptions = forceHtmlcsRunner(input.engineOptions);
    const result = await base.runOnPage(page, input);
    // base.runOnPage() stamps canonical.engine with pa11y-engine.js's own identity
    // ("pa11y" / axe); restamp it with this variant's so a caller using this adapter
    // directly (bypassing a11y-engine.js's dispatcher, which overrides this anyway)
    // doesn't get mislabeled results.
    if (result && result.canonical && result.canonical.engine) {
        result.canonical.engine = { id: ENGINE_ID, name: ENGINE_NAME, version: ENGINE_VERSION };
    }
    return result;
}

function saveHtmlReport(reportModel, meta = {}) {
    const input = (meta && typeof meta === 'object') ? { ...meta } : {};
    // base.saveHtmlReport() labels the report with pa11y-engine.js's own identity
    // ("pa11y (axe)") unless told otherwise; identify this variant instead.
    if (input.engineName == null) input.engineName = ENGINE_NAME;
    if (input.engineVersion == null) input.engineVersion = ENGINE_VERSION;
    return base.saveHtmlReport(reportModel, input);
}

module.exports = {
    ...base,
    engineId: ENGINE_ID,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    runOnPage,
    saveHtmlReport
};
