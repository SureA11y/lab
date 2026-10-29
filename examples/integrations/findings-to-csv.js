#!/usr/bin/env node
'use strict';

/**
 * A report's failures as CSV, one row per element, for a spreadsheet or a
 * dashboard: what was checked against, where, what failed, and its id.
 *
 *   node examples/integrations/findings-to-csv.js <payload.json> [--outcome fail|cantTell|pass] > failures.csv
 *
 * Reads a report (schemas/report.v3.schema.json) and nothing else.
 */

const fs = require('fs');

const COLUMNS = ['run', 'timestamp', 'scan', 'profile', 'page', 'rule', 'title', 'severity', 'wcag', 'element', 'occurrenceId'];

function csvCell(value) {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rows(report, outcome = 'fail') {
    const out = [];
    for (const scan of report.scans) {
        const findings = scan.canonical ? scan.canonical.findings : [];
        for (const f of findings) {
            if (f.outcome !== outcome) continue;
            const wcag = f.wcag && Array.isArray(f.wcag.sc) ? f.wcag.sc.map((sc) => (sc && sc.ref) || sc).join(' ') : '';
            for (const o of f.occurrences || []) {
                out.push({
                    run: report.runId,
                    timestamp: report.timestamp,
                    scan: scan.label || scan.id,
                    profile: scan.profile ? scan.profile.label : '',
                    page: o.pageUrl || scan.url,
                    rule: f.ruleId || f.id,
                    title: f.title,
                    severity: f.severity,
                    wcag,
                    element: Array.isArray(o.target) ? o.target.join(' ') : '',
                    occurrenceId: o.occurrenceId,
                });
            }
        }
    }
    return out;
}

function toCsv(list) {
    return [COLUMNS.join(','), ...list.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--'));
    const i = args.indexOf('--outcome');
    if (!file) {
        console.error('Usage: node examples/integrations/findings-to-csv.js <payload.json> [--outcome fail|cantTell|pass]');
        process.exit(2);
    }
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(toCsv(rows(report, i >= 0 ? args[i + 1] : 'fail')));
}

module.exports = { rows, toCsv };
