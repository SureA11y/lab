'use strict';

/**
 * What a dry run found (run-workflow.js --dry-run, and the app's Dry run),
 * from what any run produces: its step results and its log. A dry run takes
 * every step but the scans, screenshots and evidence, so what it can say is
 * whether the workflow still fits the site: which steps ran, which failed and
 * where, which it never reached, and which scans would have had nothing to
 * check. The command line prints it (cli/dry-run-report.js); the app shows it.
 */

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
const { assessRun, describeRunHealth } = require('../shared/run-health.js');

const DRY_RUN_SCAN = 'Dry run: scan ';

function stepTitle(result, action) {
    const type = (result && result.type) || (action && action.type) || 'step';
    const def = ACTION_DEFINITIONS[type];
    const base = (action && typeof action.alias === 'string' && action.alias.trim()) || (def && def.label) || type;
    const raw = result && typeof result.label === 'string' ? result.label : (action && typeof action.label === 'string' ? action.label : '');
    const label = raw.trim() || null;
    return label && label !== base ? `${base} "${label}"` : base;
}

const STEP_STATUS = {
    'failed': 'failed',
    'failed-optional': 'failed-optional',
    'skipped-disabled': 'off',
};

/**
 * -> {
 *   outcome: 'finished' | 'cancelled' | 'not-started', startError,
 *   url,
 *   steps: [{ number, title, status: 'done'|'failed'|'failed-optional'|'off'|'not-run',
 *             error, failedAt, notes: [string] }],
 *   loops: string or null, scansNotRun, scansWithNothing,
 *   problems, fits
 * }
 * `actions` are the spec's, to name the steps the run never reached.
 */
function summarizeDryRun({ actions = [], payload = null, status = null, error = null, logs = [] } = {}) {
    if (status === 'cancelled') return { outcome: 'cancelled', steps: [], problems: 0, fits: false };
    if (!payload) {
        return {
            outcome: 'not-started',
            startError: error && error.details ? error.details : 'the run failed',
            steps: [],
            problems: 0,
            fits: false,
        };
    }

    // The scans that would have had nothing to check, said under their step.
    const scanEntries = (Array.isArray(logs) ? logs : [])
        .filter((e) => e && typeof e.message === 'string' && e.message.startsWith(DRY_RUN_SCAN));
    const withNothing = scanEntries.filter((e) => e.extra && e.extra.dryRunProblem);
    const notesByStep = new Map();
    for (const e of withNothing) {
        const path = e.extra && typeof e.extra.actionPath === 'string' ? e.extra.actionPath : '';
        const top = path.split('.')[0];
        const text = (path.includes('.') ? `step ${path}: ` : '')
            + e.message.slice(DRY_RUN_SCAN.length).replace(/^("[^"]*"|without a label) /, '');
        if (!notesByStep.has(top)) notesByStep.set(top, []);
        notesByStep.get(top).push(text);
    }

    const results = Array.isArray(payload.actionResults) ? payload.actionResults : [];
    const steps = results.map((r) => {
        const number = String(r.actionPath || r.index + 1);
        return {
            number,
            title: stepTitle(r, actions[r.index]),
            status: STEP_STATUS[r.status] || 'done',
            error: r.error || null,
            failedAt: r.failedAt || null,
            notes: notesByStep.get(number) || [],
        };
    });

    // The steps after a failure, which the run stopped before.
    const reached = new Set(results.map((r) => r.index));
    actions.forEach((action, i) => {
        if (!reached.has(i)) steps.push({ number: String(i + 1), title: stepTitle(null, action), status: 'not-run', error: null, failedAt: null, notes: [] });
    });

    const health = assessRun(payload);
    const loops = describeRunHealth(health).find((l) => /iteration/.test(l)) || null;

    // The steps not reached follow from the failure that stopped the run.
    const failed = steps.filter((s) => s.status === 'failed').length;
    const problems = failed + (health.iterationFailures || 0) + withNothing.length;

    return {
        outcome: 'finished',
        url: payload.url || null,
        steps,
        loops,
        scansNotRun: scanEntries.length,
        scansWithNothing: withNothing.length,
        problems,
        fits: problems === 0,
    };
}

module.exports = { summarizeDryRun, DRY_RUN_SCAN };
