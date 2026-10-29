'use strict';

/**
 * Reading and rewriting a report's timestamp.
 *
 * A report stores its timestamp as an ISO instant. The report metadata line
 * reads it in the reader's own time zone and names the zone ("14:30 CEST"), so
 * the time is never ambiguous, whoever opens the report. Editing works in that
 * same zone: the wall-clock time typed into the field is the one the line
 * reads back, or an edit would appear to move the report by the difference
 * between two zones.
 *
 * The conversions live here, away from the DOM, because they are the part worth
 * testing: a zone offset is not a constant, and the two hours a year where it
 * changes are exactly where a naive conversion silently lands a report on the
 * wrong side of a scan run.
 */

// The reader's time zone, which the metadata line reads a report's time in;
// UTC where the runtime can't say.
export const REPORT_TIME_ZONE = (() => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
})();

// What the field offers and what the line shows: minutes. Seconds are dropped
// rather than preserved, so that saving a timestamp untouched leaves exactly
// the value the user was looking at - a hidden ":37" surviving an edit would
// make two reports the user set to the same minute sort in an order neither
// the field nor the line can explain.
const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * The report timestamp as the metadata line shows it.
 *
 * An unparseable value is handed back as it came: a report carrying something
 * this cannot read is better shown verbatim than as "Invalid Date".
 *
 * @param {string} iso
 * @param {string} [timeZone]
 * @returns {string}
 */
export function formatReportTimestamp(iso, timeZone = REPORT_TIME_ZONE) {
    const date = toDate(iso);
    if (!date) return typeof iso === 'string' ? iso : '';

    return date.toLocaleString('en-GB', {
        timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short'
    });
}

/**
 * The value to seed an `<input type="datetime-local">` with, i.e. the instant
 * as wall-clock time in the report zone.
 *
 * @param {string} iso
 * @param {string} [timeZone]
 * @returns {string} `YYYY-MM-DDTHH:mm`, or '' when the instant cannot be read.
 */
export function isoToDateTimeLocal(iso, timeZone = REPORT_TIME_ZONE) {
    const date = toDate(iso);
    if (!date) return '';

    const parts = zonedParts(date.getTime(), timeZone);

    return (
        `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}` +
        `T${pad(parts.hour)}:${pad(parts.minute)}`
    );
}

/**
 * The instant a wall-clock time in the report zone stands for.
 *
 * @param {string} value - `YYYY-MM-DDTHH:mm`, as the field produces it.
 * @param {string} [timeZone]
 * @returns {?string} ISO instant, or null when the value is not a real date.
 */
export function dateTimeLocalToIso(value, timeZone = REPORT_TIME_ZONE) {
    const match = DATE_TIME_LOCAL.exec(String(value ?? '').trim());
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59) return null;

    // Read the components as if they were UTC. That is not the answer - it is
    // the answer shifted by the zone's offset - but it is a fixed point to
    // measure that offset from, and it catches a day that does not exist
    // (31 February rolls over into March rather than staying put).
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const rollover = new Date(wallAsUtc);
    if (rollover.getUTCMonth() !== month - 1 || rollover.getUTCDate() !== day) return null;

    // Two passes, because the offset to subtract is the one in effect at the
    // instant we are solving for, not at the instant we guessed from. They
    // differ only around a daylight-saving change, which is precisely when a
    // single pass is off by an hour.
    const firstGuess = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
    const utcMs = wallAsUtc - zoneOffsetMs(firstGuess, timeZone);

    if (!Number.isFinite(utcMs)) return null;

    return new Date(utcMs).toISOString();
}

/** Whether a value can be read as an instant at all. */
export function isReadableTimestamp(iso) {
    return toDate(iso) !== null;
}

function toDate(iso) {
    if (typeof iso !== 'string' && !(iso instanceof Date) && typeof iso !== 'number') return null;

    const date = iso instanceof Date ? iso : new Date(iso);

    return Number.isFinite(date.getTime()) ? date : null;
}

// The zone's own calendar reading of an instant. Intl is the only thing in the
// platform that knows the rules, so the parts are read back out of a formatter
// rather than computed.
function zonedParts(utcMs, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const parts = {};
    for (const {type, value} of formatter.formatToParts(new Date(utcMs))) {
        if (type !== 'literal') parts[type] = Number(value);
    }

    return parts;
}

// How far ahead of UTC the zone is at a given instant, in milliseconds.
function zoneOffsetMs(utcMs, timeZone) {
    const parts = zonedParts(utcMs, timeZone);

    const asIfUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second || 0
    );

    return asIfUtc - utcMs;
}

function pad(value, length = 2) {
    return String(value).padStart(length, '0');
}
