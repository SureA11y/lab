'use strict';

// Dep-free tests for the report timestamp conversions. The module is
// ESM-with-`export`; import() it once for the whole suite (same shape as
// report-name.test.js).
//
// Every case passes Europe/Zurich (CET, UTC+1, in winter; CEST, UTC+2, in
// summer) rather than relying on the reader's zone, which is the machine's.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ZONE = 'Europe/Zurich';

let mod;
async function load() {
    if (!mod) mod = await import('./report-timestamp.js');
    return mod;
}

describe('formatReportTimestamp', () => {
    test('reads an instant in the zone, and names the zone', async () => {
        const { formatReportTimestamp } = await load();

        // 12:30 UTC in August is 14:30 in Zurich.
        assert.equal(
            formatReportTimestamp('2026-08-27T12:30:00.000Z', ZONE),
            'Thursday, 27 August 2026 at 14:30 CEST'
        );
    });

    test('reads it in the reader\'s zone by default', async () => {
        const { formatReportTimestamp, REPORT_TIME_ZONE } = await load();

        assert.equal(REPORT_TIME_ZONE, Intl.DateTimeFormat().resolvedOptions().timeZone);
        assert.equal(
            formatReportTimestamp('2026-08-27T12:30:00.000Z'),
            formatReportTimestamp('2026-08-27T12:30:00.000Z', REPORT_TIME_ZONE)
        );
    });

    test('hands back a value it cannot read rather than "Invalid Date"', async () => {
        const { formatReportTimestamp } = await load();

        assert.equal(formatReportTimestamp('some day in March'), 'some day in March');
        assert.equal(formatReportTimestamp(null), '');
    });
});

describe('isoToDateTimeLocal', () => {
    test('seeds the field with the zone wall-clock time, to the minute', async () => {
        const { isoToDateTimeLocal } = await load();

        assert.equal(isoToDateTimeLocal('2026-08-27T12:30:45.123Z', ZONE), '2026-08-27T14:30');
        assert.equal(isoToDateTimeLocal('2026-01-15T08:00:00.000Z', ZONE), '2026-01-15T09:00');
    });

    test('is empty for a timestamp that is not an instant', async () => {
        const { isoToDateTimeLocal } = await load();

        assert.equal(isoToDateTimeLocal('', ZONE), '');
        assert.equal(isoToDateTimeLocal('yesterday', ZONE), '');
        assert.equal(isoToDateTimeLocal(undefined, ZONE), '');
    });
});

describe('dateTimeLocalToIso', () => {
    test('resolves a typed wall-clock time against the summer offset', async () => {
        const { dateTimeLocalToIso } = await load();

        assert.equal(dateTimeLocalToIso('2026-08-27T14:30', ZONE), '2026-08-27T12:30:00.000Z');
    });

    test('resolves it against the winter offset', async () => {
        const { dateTimeLocalToIso } = await load();

        assert.equal(dateTimeLocalToIso('2026-01-15T09:00', ZONE), '2026-01-15T08:00:00.000Z');
    });

    test('zeroes the seconds', async () => {
        const { dateTimeLocalToIso } = await load();

        // The field and the metadata line both stop at minutes, so a saved
        // timestamp cannot carry a second the user was never shown.
        assert.match(dateTimeLocalToIso('2026-08-27T14:30', ZONE), /:00\.000Z$/);
        assert.equal(dateTimeLocalToIso('2026-08-27T14:30:45', ZONE), '2026-08-27T12:30:00.000Z');
    });

    test('round-trips through the field', async () => {
        const { dateTimeLocalToIso, isoToDateTimeLocal } = await load();

        for (const value of ['2026-01-15T09:00', '2026-08-27T14:30', '2026-12-31T23:59']) {
            assert.equal(isoToDateTimeLocal(dateTimeLocalToIso(value, ZONE), ZONE), value);
        }
    });

    test('uses the offset in effect at the resolved instant, not at the guess', async () => {
        const { dateTimeLocalToIso } = await load();

        // 03:00 on 29 March 2026 is the first minute of CEST. Measuring the
        // offset from the components read as UTC would find +02:00 (the change
        // has already happened at 02:30 UTC) and land an hour early; the
        // correction pass reads +01:00, the offset actually in force a moment
        // before the change.
        assert.equal(dateTimeLocalToIso('2026-03-29T03:00', ZONE), '2026-03-29T01:00:00.000Z');
        assert.equal(dateTimeLocalToIso('2026-03-29T01:30', ZONE), '2026-03-29T00:30:00.000Z');
    });

    test('shifts a wall-clock time the spring-forward hour skipped', async () => {
        const { dateTimeLocalToIso, isoToDateTimeLocal } = await load();

        // 02:30 never happens on that date - the clocks go 02:00 -> 03:00. It
        // resolves to a real instant an hour on rather than to nothing, which
        // is what every other date library does with a gap.
        const iso = dateTimeLocalToIso('2026-03-29T02:30', ZONE);

        assert.equal(iso, '2026-03-29T01:30:00.000Z');
        assert.equal(isoToDateTimeLocal(iso, ZONE), '2026-03-29T03:30');
    });

    test('settles an autumn hour that happens twice on the second pass', async () => {
        const { dateTimeLocalToIso, isoToDateTimeLocal } = await load();

        // 02:30 on 25 October 2026 comes round twice, at 00:30 UTC (CEST) and
        // again at 01:30 UTC (CET). Ambiguity has to resolve the same way every
        // time or a report would drift by an hour each time it was saved.
        const iso = dateTimeLocalToIso('2026-10-25T02:30', ZONE);

        assert.equal(iso, '2026-10-25T01:30:00.000Z');
        assert.equal(isoToDateTimeLocal(iso, ZONE), '2026-10-25T02:30');
        assert.equal(dateTimeLocalToIso(isoToDateTimeLocal(iso, ZONE), ZONE), iso);
    });

    test('refuses anything that is not a date the field could produce', async () => {
        const { dateTimeLocalToIso } = await load();

        assert.equal(dateTimeLocalToIso('', ZONE), null);
        assert.equal(dateTimeLocalToIso('   ', ZONE), null);
        assert.equal(dateTimeLocalToIso(null, ZONE), null);
        assert.equal(dateTimeLocalToIso('27/08/2026 14:30', ZONE), null);
        assert.equal(dateTimeLocalToIso('2026-08-27', ZONE), null);
        assert.equal(dateTimeLocalToIso('2026-13-01T10:00', ZONE), null);
        assert.equal(dateTimeLocalToIso('2026-08-27T25:00', ZONE), null);
        assert.equal(dateTimeLocalToIso('2026-08-27T10:75', ZONE), null);
    });

    test('refuses a day the month does not have, instead of rolling it over', async () => {
        const { dateTimeLocalToIso } = await load();

        // Date.UTC would happily turn 31 February into 3 March.
        assert.equal(dateTimeLocalToIso('2026-02-31T09:00', ZONE), null);
        assert.equal(dateTimeLocalToIso('2026-04-31T09:00', ZONE), null);
        assert.equal(dateTimeLocalToIso('2026-02-29T09:00', ZONE), null); // 2026 is not a leap year
        assert.equal(dateTimeLocalToIso('2024-02-29T09:00', ZONE), '2024-02-29T08:00:00.000Z');
    });

    test('honours a zone passed in, so the fixed one is not baked into callers', async () => {
        const { dateTimeLocalToIso } = await load();

        assert.equal(dateTimeLocalToIso('2026-08-27T14:30', 'UTC'), '2026-08-27T14:30:00.000Z');
        assert.equal(dateTimeLocalToIso('2026-08-27T14:30', 'America/New_York'), '2026-08-27T18:30:00.000Z');
    });
});

describe('isReadableTimestamp', () => {
    test('separates an instant from anything else', async () => {
        const { isReadableTimestamp } = await load();

        assert.equal(isReadableTimestamp('2026-08-27T12:30:00.000Z'), true);
        assert.equal(isReadableTimestamp('nope'), false);
        assert.equal(isReadableTimestamp(null), false);
        assert.equal(isReadableTimestamp(undefined), false);
    });
});
