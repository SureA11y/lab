'use strict';

/**
 * comparison.html for a run compared with its baseline: the same document
 * the app's Compare tab downloads, drawn without a browser. The comparison
 * renderer is pure (it builds the view as text), and so is the document
 * around it (js/viewer-documents.js), so the command line draws exactly what
 * the app would for these two reports, in their order: baseline, then run.
 *
 * Its styles and script are the report's built assets (`npm run build:report`);
 * where they have not been built, there is no file, and the run says so.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { diffReports } = require('../shared/report-diff.js');
const dispersion = require('../shared/issue-dispersion.js');

const REPORT_DIR = path.join(__dirname, '..', 'report');
const ASSETS = ['comparison-template.html', 'report.min.css', 'comparison.min.css', 'report.min.js'];

// The app's modules are ES modules in a folder Node reads as CommonJS: Node
// loads them, and warns that it had to look twice. Said to whoever runs the
// command line, that is noise, so that one warning is left out.
async function esm(file) {
    const emitWarning = process.emitWarning;
    process.emitWarning = function quiet(warning, ...rest) {
        const code = rest[0] && typeof rest[0] === 'object' ? rest[0].code : rest[1];
        if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
        return emitWarning.call(process, warning, ...rest);
    };
    try {
        return await import(pathToFileURL(path.join(__dirname, '..', 'js', file)).href);
    } finally {
        process.emitWarning = emitWarning;
    }
}

/** The built assets the document needs, or null when one is missing. */
function readAssets() {
    const files = ASSETS.map((name) => path.join(REPORT_DIR, name));
    if (!files.every((file) => fs.existsSync(file))) return null;
    const [template, css, comparisonCss, js] = files.map((file) => fs.readFileSync(file, 'utf8'));
    return { template, css, comparisonCss, js };
}

/**
 * -> { html } or { missing: 'why' }. `generatedAt` dates the document;
 * `title` names it, as the app's comparison name does; `assets` are the
 * built ones unless given.
 */
async function buildComparisonHtml(baselinePayload, currentPayload, { title = '', generatedAt = new Date().toISOString(), assets = readAssets() } = {}) {
    if (!assets) return { missing: 'the report assets are not built (npm run build:report)' };

    const [{ comparisonDiffHTML }, { documentTitle, documentSummary }, documents] = await Promise.all([
        esm('report-comparison-renderer.js'),
        esm('comparison-document.js'),
        esm('viewer-documents.js'),
    ]);

    const d = diffReports(baselinePayload, currentPayload, {
        mode: 'evolution',
        order: 'given',
        document: { title, note: '', generatedAt },
    });
    const [first, second] = d.swapped ? [currentPayload, baselinePayload] : [baselinePayload, currentPayload];
    const analyses = [first, second].map((r) => dispersion.analyseDispersion(Array.isArray(r && r.scans) ? r.scans : []));
    const spread = analyses.some((a) => a.rulesFailing > 0) ? dispersion.compareDispersion(analyses[0], analyses[1]) : null;

    const html = documents.comparisonDocumentHtml({
        ...assets,
        title: documentTitle(d.document),
        description: documents.comparisonDescription(documentSummary(d.document)),
        comparison: comparisonDiffHTML(d, { dispersion: spread }),
    });
    return { html };
}

module.exports = { buildComparisonHtml };
