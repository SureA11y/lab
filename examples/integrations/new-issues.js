#!/usr/bin/env node
'use strict';

/**
 * The failures a run found that its baseline did not have, as issues to file:
 * one per element, keyed by its occurrenceId, so the same failure found again
 * tomorrow is recognised as the issue already filed rather than a new one.
 * With --fixed, the failures the baseline had and this run no longer does:
 * the issues to close.
 *
 *   node examples/integrations/new-issues.js <run folder or diff.json> [--fixed] [--json]
 *
 * Prints Markdown, one issue per section; --json prints the issues as a JSON
 * list for a script that files or closes them (a tracker's API, a chat
 * webhook). It only reads diff.json (schemas/diff.v1.schema.json): nothing
 * here depends on the lab's code.
 */

const fs = require('fs');
const path = require('path');

function readDiff(where) {
    const file = fs.existsSync(where) && fs.statSync(where).isDirectory() ? path.join(where, 'diff.json') : where;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc.type !== 'a11y-diff') throw new Error(`${file} is not a diff.json (no "type": "a11y-diff")`);
    return doc;
}

/** One issue per element newly failing a rule; with tag 'fixed', per element no longer failing it. */
function newIssues(doc, { tag = 'new' } = {}) {
    const issues = [];
    for (const row of doc.diff.rows) {
        for (const occ of row.occ) {
            if (occ.tag !== tag) continue;
            issues.push({
                id: occ.occurrenceId,
                title: `${row.title}: ${occ.target}`,
                rule: row.ruleId,
                wcag: row.wcag || null,
                severity: row.severity,
                page: occ.pageUrl,
                element: occ.target,
            });
        }
    }
    return issues;
}

function markdown(issues, doc, { tag = 'new' } = {}) {
    if (!issues.length) {
        return tag === 'fixed'
            ? 'Nothing the baseline had is fixed.\n'
            : `No new failures since the baseline (${doc.summary.headline}).\n`;
    }
    return issues.map((i) => [
        `## ${i.title}`,
        '',
        `- **Severity:** ${i.severity}`,
        `- **Rule:** ${i.rule}${i.wcag ? ` (WCAG ${i.wcag})` : ''}`,
        `- **Page:** ${i.page}`,
        `- **Element:** \`${i.element}\``,
        `- **Id:** \`${i.id}\` (the same in every run while it fails)`,
        '',
    ].join('\n')).join('\n');
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const where = args.find((a) => !a.startsWith('--'));
    if (!where) {
        console.error('Usage: node examples/integrations/new-issues.js <run folder or diff.json> [--fixed] [--json]');
        process.exit(2);
    }
    const tag = args.includes('--fixed') ? 'fixed' : 'new';
    const doc = readDiff(where);
    const issues = newIssues(doc, { tag });
    process.stdout.write(args.includes('--json') ? JSON.stringify(issues, null, 2) + '\n' : markdown(issues, doc, { tag }));
}

module.exports = { readDiff, newIssues, markdown };
