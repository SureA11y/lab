'use strict';

/**
 * Writes a run's surea11y results in the formats CI tools read, using the
 * renderers @surea11y/core ships:
 *
 *   sarif  one SARIF 2.1.0 log per scan (GitHub code scanning and others)
 *   junit  one JUnit XML file per scan (GitLab, Azure DevOps, Jenkins,
 *          CircleCI): a test suite per WCAG criterion, a test case per rule
 *   earl   one EARL JSON-LD file per scan. Core merges results for the same
 *          URL into one subject, and a workflow often scans one URL in
 *          several states, so a single file for the run would lose results.
 *
 * These come from surea11y's own result, not the canonical findings, so scans
 * run only with other engines have nothing to export.
 */

const fs = require('fs');
const path = require('path');

const { renderSarifReport } = require('@surea11y/core/sarif');
const { renderJunitReport } = require('@surea11y/core/junit');
const { renderEarlReport } = require('@surea11y/core/earl');
const { matchBaseline } = require('@surea11y/core/baseline');
const { leaningFailures } = require('@surea11y/core');
const { PACKS } = require('../server-side/engines/a11y-labs-engine');

const FORMATS = ['sarif', 'junit', 'earl'];

let CORE_VERSION = null;
try { CORE_VERSION = require('@surea11y/core/package.json').version || null; } catch {}

/**
 * "sarif,junit" -> { formats: ['sarif', 'junit'], errors: [] }. Order and
 * repeats in the input do not matter.
 */
function parseFormats(value) {
    const requested = String(value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const errors = [];
    if (!requested.length) errors.push('--format needs at least one of: ' + FORMATS.join(', '));
    for (const f of requested) {
        if (!FORMATS.includes(f)) errors.push(`Unknown format "${f}", expected one of: ${FORMATS.join(', ')}`);
    }
    return { formats: FORMATS.filter((f) => requested.includes(f)), errors };
}

function slugify(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

// "01-checkout-page": numbered so the files sort in scan order, and named so
// a CI tab listing them is readable.
function scanFileStem(entry, index, total) {
    const width = String(total).length < 2 ? 2 : String(total).length;
    const number = String(index + 1).padStart(width, '0');
    const name = slugify(entry && (entry.label || entry.scanId || entry.url));
    return name ? `${number}-${name}` : number;
}

// Path and query, as the lab's own run comparison matches pages: a run
// against staging can then be compared with a baseline taken elsewhere.
function pagePath(url) {
    try { const u = new URL(url); return u.pathname + u.search; }
    catch { return String(url || ''); }
}

/**
 * The failures a baseline run already had for this scan: those of the
 * baseline scan with the same page and label, or, when the label changed, of
 * every baseline scan of that page. Null when the baseline has none stored
 * (it was not run with --format), so nothing is filtered.
 */
function baselineEntriesFor(entry, baselinePayload) {
    const scans = (baselinePayload && Array.isArray(baselinePayload.scans) ? baselinePayload.scans : [])
        .filter((s) => s && Array.isArray(s.coreBaseline));
    if (!scans.length) return null;

    const samePage = scans.filter((s) => pagePath(s.url) === pagePath(entry.url));
    const sameLabel = samePage.filter((s) => (s.label || '') === (entry.label || ''));
    return (sameLabel.length ? sameLabel : samePage).flatMap((s) => s.coreBaseline);
}

/**
 * How many questions (cantTell) of a scan lean fail, as core
 * gates on them (leaningFailures): only those of rules whose criteria are in
 * the scan's target. With baseline entries, the ones the baseline already
 * had are counted apart.
 */
function likelyFailures(result, baselineEntries) {
    const total = leaningFailures(result).length;
    if (!baselineEntries) return { total, known: 0, new: total };
    const lean = matchBaseline(result, baselineEntries, { leanFail: true }).leanFail;
    return { total, known: lean.knownCount, new: lean.newCount };
}

/**
 * Renders and writes the requested formats into <outDir>/exports. With a
 * baseline payload, failures it already had are left out of SARIF and shown
 * as skipped in JUnit, the way core's own CLI treats a baseline. EARL is a
 * record of results, not a gate, so it always lists everything. Every
 * question carries its steps (How to check), the packs' rules' too.
 *
 * With `failOnLean`, the questions whose evidence leans fail gate as the
 * failures do: an error in SARIF, a failure in JUnit, unless the baseline
 * already had them.
 *
 * Returns { written, known, likely }: the paths written, in order, how many
 * failing occurrences were recognised from the baseline, and the likely
 * failures ({ total, known, new }) when `failOnLean`, else null.
 */
function writeExports(coreResults, formats, outDir, { baselinePayload = null, failOnLean = false } = {}) {
    const list = (Array.isArray(coreResults) ? coreResults : []).filter((e) => e && e.result);
    const wanted = Array.isArray(formats) ? formats : [];
    if (!list.length || !wanted.length) return { written: [], known: 0, likely: null };

    const dir = path.join(outDir, 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const written = [];
    let known = 0;
    const likely = failOnLean ? { total: 0, known: 0, new: 0 } : null;
    const packs = PACKS.length ? { packs: PACKS } : {};

    const write = (name, text) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, text, 'utf8');
        written.push(file);
    };

    list.forEach((entry, i) => {
        const stem = scanFileStem(entry, i, list.length);
        const baselineEntries = baselinePayload ? baselineEntriesFor(entry, baselinePayload) : null;
        if (baselineEntries) known += matchBaseline(entry.result, baselineEntries).knownCount;
        if (likely) {
            const scan = likelyFailures(entry.result, baselineEntries);
            likely.total += scan.total;
            likely.known += scan.known;
            likely.new += scan.new;
        }

        if (wanted.includes('sarif')) {
            write(`${stem}.sarif`, renderSarifReport(entry.result, {
                toolVersion: CORE_VERSION || undefined,
                informationUri: 'https://surea11y.dev',
                ...packs,
                ...(failOnLean ? { leanFailAs: 'error' } : {}),
                ...(baselineEntries ? { baselineEntries } : {})
            }));
        }
        if (wanted.includes('junit')) {
            write(`${stem}.junit.xml`, renderJunitReport(entry.result, {
                ...packs,
                ...(failOnLean ? { leanFailAs: 'failure' } : {}),
                ...(baselineEntries ? { baselineEntries } : {})
            }));
        }
        if (wanted.includes('earl')) {
            const earl = renderEarlReport(entry.result, {
                assertor: { name: 'surea11y', version: CORE_VERSION || undefined },
                mode: 'earl:automatic'
            });
            write(`${stem}.earl.jsonld`, JSON.stringify(earl, null, 2) + '\n');
        }
    });

    return { written, known, likely };
}

module.exports = { FORMATS, parseFormats, scanFileStem, baselineEntriesFor, likelyFailures, writeExports };
