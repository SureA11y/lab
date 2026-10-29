'use strict';

// Dep-free tests for what each editable row of the report metadata line will
// take, and what it says once it has. The module is ESM-with-`export`;
// import() it once for the whole suite (same shape as report-name.test.js).

// The reader's zone is the machine's: pinned, so these cases read the same
// wherever they run (CET, UTC+1, in winter; CEST, UTC+2, in summer).
process.env.TZ = 'Europe/Zurich';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let mod;
async function load() {
    if (!mod) mod = await import('./report-meta-fields.js');
    return mod;
}

describe('the editable fields', () => {
    test('cover every row the metadata line offers to correct', async () => {
        const { REPORT_META_FIELDS } = await load();

        assert.deepEqual(
            Object.keys(REPORT_META_FIELDS).sort(),
            [
                'comparisonNote', 'comparisonTimestamp', 'comparisonTitle',
                'reportName', 'scenarioName', 'timestamp', 'url',
            ]
        );
    });

    test('each carries what the editor needs to build and describe itself', async () => {
        const { REPORT_META_FIELDS } = await load();

        for (const [name, field] of Object.entries(REPORT_META_FIELDS)) {
            assert.ok(field.label, `${name} has no label`);
            assert.ok(field.describe, `${name} has nothing to complete "(modify)" with`);
            assert.ok(field.inputType, `${name} has no input type`);
            assert.ok(field.invalid, `${name} has nothing to say about a value it refused`);
            assert.equal(typeof field.seed, 'function', `${name} cannot seed its field`);
            assert.equal(typeof field.parse, 'function', `${name} cannot read its field`);
            assert.equal(typeof field.saved, 'function', `${name} cannot say what it took`);
        }
    });

    test('refuse an empty value wherever the row would vanish with it', async () => {
        const { REPORT_META_FIELDS, CLEARABLE_META_FIELDS } = await load();

        // A report's row is only rendered for a value the report has, so a
        // field cleared to nothing would take its own edit control off the page
        // with it.
        for (const [name, field] of Object.entries(REPORT_META_FIELDS)) {
            if (CLEARABLE_META_FIELDS.has(name)) continue;
            assert.equal(field.parse(''), null, `${name} accepted an empty value`);
            assert.equal(field.parse('   '), null, `${name} accepted whitespace`);
        }
    });

    test('take one where the row stands whether or not the value does', async () => {
        const { REPORT_META_FIELDS, CLEARABLE_META_FIELDS } = await load();

        // The comparison line renders every row, so clearing one is a choice
        // the reader can undo: the name goes back to the reports, and a
        // description that could be added but never removed would be a trap.
        for (const name of CLEARABLE_META_FIELDS) {
            const field = REPORT_META_FIELDS[name];
            assert.equal(field.parse(''), '', `${name} refused an empty value`);
            assert.equal(field.parse('   '), '', `${name} refused whitespace`);
            assert.ok(field.saved(''), `${name} says nothing about having been cleared`);
        }
    });

    test('the comparison timestamp is corrected exactly as a report timestamp is', async () => {
        const { REPORT_META_FIELDS } = await load();
        const report = REPORT_META_FIELDS.timestamp;
        const comparison = REPORT_META_FIELDS.comparisonTimestamp;

        assert.equal(comparison.inputType, report.inputType);
        assert.equal(comparison.hint, report.hint, 'the same clock, said the same way');
        assert.equal(comparison.seed('2026-08-28T09:30:00Z'), report.seed('2026-08-28T09:30:00Z'));
        assert.equal(comparison.parse('2026-08-28T11:30'), report.parse('2026-08-28T11:30'));
        assert.equal(comparison.parse('half typed'), null);
    });

    test('are looked up by payload key, and nothing else is editable', async () => {
        const { reportMetaField, REPORT_META_FIELDS } = await load();

        assert.equal(reportMetaField('url'), REPORT_META_FIELDS.url);
        assert.equal(reportMetaField('metrics'), null);
        assert.equal(reportMetaField('toString'), null); // not inherited from Object
        assert.equal(reportMetaField(''), null);
        assert.equal(reportMetaField(undefined), null);
    });
});

describe('the name fields', () => {
    test('take a trimmed name and say what it became', async () => {
        const { REPORT_META_FIELDS } = await load();

        assert.equal(REPORT_META_FIELDS.reportName.parse('  Q3 audit  '), 'Q3 audit');
        assert.equal(REPORT_META_FIELDS.reportName.saved('Q3 audit'), 'Report renamed to "Q3 audit".');

        assert.equal(REPORT_META_FIELDS.scenarioName.parse('  Checkout  '), 'Checkout');
        assert.equal(REPORT_META_FIELDS.scenarioName.saved('Checkout'), 'Scenario renamed to "Checkout".');
    });

    test('seed the field with the name as it stands, missing or not', async () => {
        const { REPORT_META_FIELDS } = await load();

        assert.equal(REPORT_META_FIELDS.reportName.seed('Q3 audit'), 'Q3 audit');
        assert.equal(REPORT_META_FIELDS.reportName.seed(null), '');
        assert.equal(REPORT_META_FIELDS.reportName.seed(undefined), '');
    });
});

describe('normaliseReportUrl', () => {
    test('takes http and https', async () => {
        const { normaliseReportUrl } = await load();

        assert.equal(normaliseReportUrl('https://example.com/a'), 'https://example.com/a');
        assert.equal(normaliseReportUrl('  http://example.com/a  '), 'http://example.com/a');
    });

    test('settles the spelling, so what is stored is what was checked', async () => {
        const { normaliseReportUrl } = await load();

        assert.equal(normaliseReportUrl('http://EXAMPLE.com'), 'http://example.com/');
        assert.equal(normaliseReportUrl('https://example.com:443/a'), 'https://example.com/a');
        assert.equal(normaliseReportUrl('https://example.com/a b'), 'https://example.com/a%20b');
    });

    test('refuses a scheme that would be live in an exported report', async () => {
        const { normaliseReportUrl } = await load();

        // The metadata line renders this value as a link, in a document that
        // gets sent on to other people.
        assert.equal(normaliseReportUrl('javascript:alert(1)'), null);
        assert.equal(normaliseReportUrl('JavaScript:alert(1)'), null);
        assert.equal(normaliseReportUrl('data:text/html,<script>alert(1)</script>'), null);
        assert.equal(normaliseReportUrl('file:///etc/passwd'), null);
        assert.equal(normaliseReportUrl('ftp://example.com'), null);
    });

    test('refuses anything that is not a whole URL', async () => {
        const { normaliseReportUrl } = await load();

        assert.equal(normaliseReportUrl('example.com'), null);
        assert.equal(normaliseReportUrl('/reports/latest'), null);
        assert.equal(normaliseReportUrl('not a url'), null);
        assert.equal(normaliseReportUrl(''), null);
        assert.equal(normaliseReportUrl(null), null);
        assert.equal(normaliseReportUrl(undefined), null);
    });

    test('is what the URL row uses, and says what it took', async () => {
        const { REPORT_META_FIELDS } = await load();

        assert.equal(REPORT_META_FIELDS.url.parse('https://example.com/a'), 'https://example.com/a');
        assert.equal(REPORT_META_FIELDS.url.parse('javascript:alert(1)'), null);
        assert.equal(
            REPORT_META_FIELDS.url.saved('https://example.com/a'),
            'Report URL set to https://example.com/a.'
        );
    });
});

describe('the timestamp field', () => {
    test('seeds and reads its field in the report zone', async () => {
        const { REPORT_META_FIELDS } = await load();

        assert.equal(REPORT_META_FIELDS.timestamp.seed('2026-08-27T12:30:00.000Z'), '2026-08-27T14:30');
        assert.equal(REPORT_META_FIELDS.timestamp.parse('2026-08-27T14:30'), '2026-08-27T12:30:00.000Z');
    });

    test('names the clock it is setting', async () => {
        const { REPORT_META_FIELDS } = await load();

        // The only field whose value depends on something the field cannot show.
        assert.equal(REPORT_META_FIELDS.timestamp.hint, 'Europe/Zurich time');
    });

    test('says what it took, as the line reads it', async () => {
        const { REPORT_META_FIELDS } = await load();

        assert.equal(
            REPORT_META_FIELDS.timestamp.saved('2026-03-04T08:45:00.000Z'),
            'Report timestamp set to Wednesday, 4 March 2026 at 09:45 CET.'
        );
    });
});
