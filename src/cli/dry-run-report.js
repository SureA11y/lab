'use strict';

/**
 * `run-workflow.js --dry-run`'s report: the dry run's summary
 * (server-side/dry-run-summary.js) as lines, and its exit code.
 */

const { summarizeDryRun } = require('../server-side/dry-run-summary');
const { EXIT } = require('./baseline');

const STATUS_WORD = {
    'done': 'done    ',
    'failed': 'FAILED  ',
    'failed-optional': 'optional',
    'off': 'off     ',
    'not-run': 'not run ',
};

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** -> { lines, exitCode }. Takes what summarizeDryRun takes. */
function buildDryRunReport(run = {}) {
    const summary = summarizeDryRun(run);
    const lines = [''];

    if (summary.outcome === 'cancelled') {
        lines.push('Dry run    cancelled');
        return { lines, exitCode: EXIT.CANCELLED };
    }
    if (summary.outcome === 'not-started') {
        lines.push(`Dry run    could not start: ${summary.startError}`);
        return { lines, exitCode: EXIT.RUN_FAILED };
    }

    lines.push(`Dry run    ${summary.url || ''}`);
    for (const step of summary.steps) {
        const where = step.failedAt ? ` (at step ${step.failedAt})` : '';
        const why = step.error ? `: ${step.error}` : '';
        lines.push(`  ${STATUS_WORD[step.status]} ${step.number.padEnd(4)} ${step.title}${where}${why}`);
        for (const note of step.notes) lines.push(`                ${note}`);
    }
    if (summary.loops) lines.push(`Loops      ${summary.loops}`);
    lines.push(`Scans      ${plural(summary.scansNotRun, 'scan')} not run`
        + (summary.scansWithNothing ? `, ${summary.scansWithNothing} of them would check nothing (said under its step)` : ''));
    lines.push(summary.fits
        ? 'Result     every step ran: the workflow fits the site'
        : `Result     the workflow does not fit the site as it stands: ${plural(summary.problems, 'problem')} above`);

    return { lines, exitCode: summary.fits ? EXIT.OK : EXIT.DEGRADED };
}

module.exports = { buildDryRunReport };
