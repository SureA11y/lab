'use strict';

/**
 * Comparing a finished run against the payload of a previous one.
 *
 * The diff itself is the app's Compare tab engine (shared/report-diff.js), so a
 * regression reported here is the same one the app shows.
 */

const fs = require('fs');
const path = require('path');

const { diffReports } = require('../shared/report-diff.js');
const { reportIdentity, assignBaselineAndCurrent } = require('../shared/report-identity.js');

const PAYLOAD_FILE = 'payload.json';

/**
 * Read a baseline payload. A directory is accepted so a previous run's output
 * folder can be passed straight in.
 */
function loadBaselinePayload(target) {
    const resolved = path.resolve(String(target || ''));

    let filePath = resolved;
    try {
        if (fs.statSync(resolved).isDirectory()) filePath = path.join(resolved, PAYLOAD_FILE);
    } catch (e) {
        return { ok: false, error: `cannot read baseline ${target}: ${e.message}` };
    }

    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return { ok: false, error: `cannot read baseline ${filePath}: ${e.message}` };
    }

    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.scans)) {
        return { ok: false, error: `baseline ${filePath} is not a run payload` };
    }

    return { ok: true, payload, filePath };
}

function countRows(rows, category) {
    return rows.filter((row) => row.category === category).length;
}

function countOccurrences(rows, tag) {
    return rows.reduce((total, row) => (
        total + (Array.isArray(row.occ) ? row.occ.filter((o) => o.tag === tag).length : 0)
    ), 0);
}

/**
 * Reduce a diff to what decides the outcome: rules gained and lost, and the
 * occurrences behind them.
 */
function summarizeDiff(diff) {
    const rows = Array.isArray(diff && diff.rows) ? diff.rows : [];

    const newRules = rows
        .filter((row) => row.category === 'new')
        .map((row) => ({
            ruleId: row.ruleId,
            title: row.title,
            severity: row.severity,
            occurrences: row.bCount,
        }));

    return {
        rules: {
            new: newRules.length,
            resolved: countRows(rows, 'resolved'),
            persistent: countRows(rows, 'persistent'),
        },
        occurrences: {
            new: countOccurrences(rows, 'new'),
            fixed: countOccurrences(rows, 'fixed'),
            still: countOccurrences(rows, 'still'),
        },
        newRules,
        net: (diff && diff.verdict && Number.isFinite(diff.verdict.net)) ? diff.verdict.net : 0,
        headline: (diff && diff.verdict && diff.verdict.headline) || null,
    };
}

/**
 * Compare two payloads, the baseline as the earlier side whatever the
 * timestamps say: --baseline names it, and a clock or a missing timestamp
 * must not turn new findings into fixed ones. `swapped` reports that the
 * baseline is the newer of the two, for a warning.
 */
function compareToBaseline(baselinePayload, currentPayload) {
    const diff = diffReports(baselinePayload, currentPayload, { mode: 'evolution', order: 'given' });

    const optIn = (identity) => (identity && Array.isArray(identity.optInRules) ? identity.optInRules : []);

    return {
        diff,
        summary: summarizeDiff(diff),
        // The baseline is newer than this run only when both say when they
        // were made: an undated one sorts last, which says nothing of its age.
        swapped: !!(reportIdentity(baselinePayload).timestamp && reportIdentity(currentPayload).timestamp)
            && assignBaselineAndCurrent(baselinePayload, currentPayload).baseline !== baselinePayload,
        // The opt-in rules each side ran (["rgaa"]). When they differ, the
        // findings of those rules are new or resolved because of what was
        // checked, not because of the pages.
        optInRules: { baseline: optIn(reportIdentity(baselinePayload)), current: optIn(reportIdentity(currentPayload)) },
        // The engines whose release differs between the two ([{ name,
        // versions }]): a release can add rules, change what a rule finds or
        // how it names an element, so some differences come from the engine.
        engineChanges: (diff && diff.document && Array.isArray(diff.document.engineChanges)) ? diff.document.engineChanges : [],
        // What the two were checked against. `basis`: the profiles they were
        // compared on and those left out, when they checked different ones
        // and share some (shared-profiles.js). `mismatch`: they share none,
        // so their rows don't line up; `compared` names what each checked.
        profiles: {
            basis: (diff && diff.document && diff.document.profiles) || null,
            mismatch: !!(diff && diff.document && diff.document.criteriaMismatch),
            compared: (diff && diff.document && Array.isArray(diff.document.standardsCompared)) ? diff.document.standardsCompared : [],
        },
    };
}

/**
 * The comparison's summary, for an exit code or an outcome: null when the
 * two were checked against things that share nothing, whose new instances
 * are what was checked rather than the pages (the run is then judged as one
 * with no baseline).
 */
function comparableSummary(comparison) {
    if (!comparison) return null;
    return comparison.profiles && comparison.profiles.mismatch ? null : comparison.summary;
}

const EXIT = {
    OK: 0,
    RUN_FAILED: 1,
    BAD_USAGE: 2,
    NEW_INSTANCES: 3,
    DEGRADED: 4,
    LIKELY_FAILURES: 5,
    CANCELLED: 130,
};

/**
 * A failed or cancelled run outranks everything: there is nothing to trust yet.
 * A degraded run outranks a regression because it makes the comparison unsound
 * in the first place.
 */
function decideExit({ status, health, summary, likely = null, failing = null }) {
    if (status === 'error') return EXIT.RUN_FAILED;
    if (status === 'cancelled') return EXIT.CANCELLED;
    if (health && health.degraded) return EXIT.DEGRADED;
    if (summary && summary.occurrences && summary.occurrences.new > 0) return EXIT.NEW_INSTANCES;
    // --fail-on-failures with no baseline, or for scans the comparison left
    // out: every failing instance counts as new, as --fail-on-lean counts
    // likely failures.
    if (failing > 0) return EXIT.NEW_INSTANCES;
    // --fail-on-lean: questions whose evidence leans fail, new since the
    // baseline (all of them without one).
    if (likely && likely.new > 0) return EXIT.LIKELY_FAILURES;
    return EXIT.OK;
}

/**
 * diff.json: what a run compared with its baseline wrote, as
 * schemas/diff.v1.schema.json describes it.
 */
function diffDocument(comparison) {
    return { type: 'a11y-diff', version: 1, summary: comparison.summary, diff: comparison.diff };
}

module.exports = {
    PAYLOAD_FILE,
    diffDocument,
    EXIT,
    loadBaselinePayload,
    summarizeDiff,
    compareToBaseline,
    comparableSummary,
    decideExit,
};
