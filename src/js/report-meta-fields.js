'use strict';

import {
    REPORT_TIME_ZONE,
    dateTimeLocalToIso,
    formatReportTimestamp,
    isoToDateTimeLocal
} from './report-timestamp.js';

/**
 * What each editable row of the report metadata line is: how its value is read
 * into a field, what a typed value has to be to count, and what to say once it
 * has been taken.
 *
 * Kept apart from the DOM so the rules can be tested as rules. The editor that
 * mounts them (report-meta-edit.js) knows nothing about any particular field.
 *
 * A report's fields refuse an empty value. That is not fussiness: the metadata
 * line only renders a row for a value the report has, so a field cleared to
 * nothing would take its own edit control off the page with it, and the value
 * could never be put back.
 *
 * The comparison's fields take one, because that reason does not hold there:
 * its line renders every row whether or not the value is set, so clearing a
 * field is a choice the reader can make and undo. The name falls back to what
 * the reports call themselves, and a description that could be added but never
 * removed would be a trap.
 */

/**
 * @typedef {Object} ReportMetaField
 * @property {string} label - The field's own label, read to anyone who cannot
 *   see which row it opened from.
 * @property {string} describe - Completes the "(modify)" control's accessible
 *   name, which has to start with the visible text (WCAG 2.5.3).
 * @property {string} inputType - `type` of the input to build.
 * @property {number} [size] - `size` of the input, where its content has a
 *   natural width; the date field sizes itself.
 * @property {string} [hint] - Shown beside the field, for what the field cannot
 *   say by itself.
 * @property {function(*): string} seed - The stored value, as the field holds it.
 * @property {function(string): *} parse - What the typed value stores, or null
 *   when it is not something this field can take.
 * @property {string} invalid - Said when parse returns null.
 * @property {function(*): string} saved - Said once the value has been taken.
 */

/** @type {Object<string, ReportMetaField>} */
export const REPORT_META_FIELDS = {
    reportName: {
        label: 'Report name',
        describe: 'the report name',
        inputType: 'text',
        size: 32,
        seed: (value) => text(value),
        parse: (raw) => text(raw).trim() || null,
        invalid: 'Enter a name for the report.',
        saved: (value) => `Report renamed to "${value}".`
    },

    scenarioName: {
        label: 'Scenario name',
        describe: 'the scenario name',
        inputType: 'text',
        size: 32,
        seed: (value) => text(value),
        parse: (raw) => text(raw).trim() || null,
        invalid: 'Enter a name for the scenario.',
        saved: (value) => `Scenario renamed to "${value}".`
    },

    url: {
        label: 'URL',
        describe: 'the report URL',
        inputType: 'url',
        size: 44,
        seed: (value) => text(value),
        parse: (raw) => normaliseReportUrl(raw),
        invalid: 'Enter a URL that starts with http:// or https://.',
        saved: (value) => `Report URL set to ${value}.`
    },

    timestamp: {
        label: 'Report date and time',
        describe: 'the report date and time',
        inputType: 'datetime-local',
        // The field is a wall clock in the reader's zone, which the value
        // alone does not show, so it says which clock it is setting.
        hint: `${REPORT_TIME_ZONE} time`,
        seed: (value) => isoToDateTimeLocal(value),
        parse: (raw) => dateTimeLocalToIso(raw),
        // The field enforces its own format, so the only value that reaches
        // this is an empty or half-typed one. Saying so without an example
        // keeps the message true whatever order the browser puts the parts in.
        invalid: 'Enter a complete date and time.',
        saved: (value) => `Report timestamp set to ${formatReportTimestamp(value)}.`
    },

    // ---- the Compare tab ----
    //
    // A comparison is a document too, and the line describing it is corrected
    // the same way: same control, same editor, same keys. Only the wording and
    // the empty-value rule differ, which is what these definitions are for.

    comparisonTitle: {
        label: 'Comparison name',
        describe: 'the comparison name',
        inputType: 'text',
        size: 32,
        hint: 'Leave it empty to use the name taken from the reports.',
        seed: (value) => text(value),
        // Empty is a value here: it hands the name back to the reports.
        parse: (raw) => text(raw).trim(),
        invalid: 'Enter a name for the comparison.',
        saved: (value) => (value
            ? `Comparison renamed to "${value}".`
            : 'Comparison named from the reports again.')
    },

    comparisonNote: {
        label: 'Comparison description',
        describe: 'the comparison description',
        inputType: 'text',
        size: 44,
        seed: (value) => text(value),
        parse: (raw) => text(raw).trim(),
        invalid: 'Enter a description for the comparison.',
        saved: (value) => (value
            ? 'Comparison description updated.'
            : 'Comparison description removed.')
    },

    comparisonTimestamp: {
        label: 'Comparison date and time',
        describe: 'the comparison date and time',
        inputType: 'datetime-local',
        // Same zone as a report's timestamp, for the same reason: the field
        // sets the clock the line reads.
        hint: `${REPORT_TIME_ZONE} time`,
        seed: (value) => isoToDateTimeLocal(value),
        parse: (raw) => dateTimeLocalToIso(raw),
        invalid: 'Enter a complete date and time.',
        saved: (value) => `Comparison timestamp set to ${formatReportTimestamp(value)}.`
    }
};

/** Keys whose row is always rendered, so clearing one is a choice, not a trap. */
export const CLEARABLE_META_FIELDS = new Set(['comparisonTitle', 'comparisonNote']);

/** The field definition for a payload key, or null when it is not editable. */
export function reportMetaField(name) {
    return Object.prototype.hasOwnProperty.call(REPORT_META_FIELDS, name)
        ? REPORT_META_FIELDS[name]
        : null;
}

/**
 * A typed URL, as the report should store it.
 *
 * Only http and https, matching what the runner itself accepts - and what the
 * metadata line does with the value: it renders it as a link, in a document
 * that gets exported and sent on, so a `javascript:` or `data:` URL typed here
 * would be a live one for whoever opens the report. `new URL` also settles the
 * spelling (host case, default port, percent-encoding), so what is stored is
 * exactly what was checked.
 *
 * @param {string} raw
 * @returns {?string}
 */
export function normaliseReportUrl(raw) {
    const value = text(raw).trim();
    if (!value) return null;

    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    return parsed.href;
}

function text(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
}
