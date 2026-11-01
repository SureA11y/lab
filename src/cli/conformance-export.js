'use strict';

/**
 * The conformance report from the command line (docs/design/conformance-report-design.md):
 *
 *   --format acr      writes exports/conformance-report.html and .docx for
 *                     the run, the automated draft under any review it holds
 *   --review <file>   a report (its JSON, payload.json or a package's zip)
 *                     whose conformance review this run takes on, filling in
 *                     only what the run has not decided; without it, the
 *                     baseline's review, when it has one
 *
 * The review is saved in the run's payload.json, so the next run, compared
 * with this one, carries it on.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const { buildConformanceReport, carryReviewForward } = require('../shared/conformance-report');
const { conformanceReportHTML } = require('../shared/conformance-report-html');
const { conformanceReportDocx } = require('../shared/conformance-report-docx');

/**
 * The conformance review a report file holds: { review } (null when it has
 * none), or { error }.
 */
async function readReviewFile(file) {
    try {
        let text;
        if (/\.zip$/i.test(file)) {
            const zip = await JSZip.loadAsync(fs.readFileSync(file));
            const entry = Object.values(zip.files).find((e) => !e.dir && /(\.a11y-report\.json|payload\.json)$/i.test(e.name));
            if (!entry) return { error: `${file} holds no report (no .a11y-report.json or payload.json)` };
            text = await entry.async('string');
        } else {
            text = fs.readFileSync(file, 'utf8');
        }
        const json = JSON.parse(text);
        const review = json && json.conformanceReview && typeof json.conformanceReview === 'object' ? json.conformanceReview : null;
        return { review };
    } catch (e) {
        return { error: `could not read ${file}: ${e.message}` };
    }
}

/**
 * Carries `review` onto `payload`'s own (made if it has none). Returns how
 * many verdicts it copied.
 */
function carryReviewOnto(payload, review) {
    if (!payload || !review) return 0;
    if (!payload.conformanceReview || typeof payload.conformanceReview !== 'object') payload.conformanceReview = {};
    const copied = carryReviewForward(payload.conformanceReview, review);
    const kept = payload.conformanceReview;
    if (!copied && !Object.keys(kept.criteria || {}).length && !Object.keys(kept.clauses || {}).length
        && !Object.values(kept.product || {}).some(Boolean)) {
        delete payload.conformanceReview;
    }
    return copied;
}

/**
 * Writes the run's conformance report into <outDir>/exports, as HTML and as
 * Word. Returns the files written and the report's totals.
 */
async function writeConformanceReport(payload, outDir, { generatedAt } = {}) {
    const dir = path.join(outDir, 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const acr = buildConformanceReport(payload);
    const html = path.join(dir, 'conformance-report.html');
    const docx = path.join(dir, 'conformance-report.docx');
    fs.writeFileSync(html, conformanceReportHTML(acr, { generatedAt }), 'utf8');
    fs.writeFileSync(docx, await conformanceReportDocx(acr, JSZip, { type: 'nodebuffer', generatedAt }));
    return { written: [html, docx], totals: acr.totals };
}

module.exports = { readReviewFile, carryReviewOnto, writeConformanceReport };
