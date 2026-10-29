'use strict';

/**
 * report-schemas.js (shared)
 *
 * What the lab writes, as published JSON Schemas, for whatever reads it
 * outside the app: a dashboard, a script, a CI step, a tool that files
 * tickets. `npm run build:action-docs` writes them to schemas/:
 *
 *   report.v3.schema.json      a report (payload.json, *.a11y-report.json)
 *   comparison.v1.schema.json  comparison.json, in a downloaded comparison
 *   diff.v1.schema.json        diff.json, from a run with a baseline
 *
 * They are strict on what a reader can rely on (the identity of a run, what
 * each scan checked against, findings and their occurrences, the comparison's
 * classification) and open everywhere else: a report also carries metrics,
 * diagnostics and engine detail that grow with the lab, and holding those to
 * a schema would break readers each time they do. A field a schema does not
 * list may be there; a field it lists means what it says.
 *
 * The app checks a report it opens against the report schema too
 * (openableReportSchema). A report saved before version 3 is checked as it
 * reads: in the current format, which report-format.js brings it to.
 *
 * Browser: available as globalThis.A11Y_REPORT_SCHEMAS.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_REPORT_SCHEMAS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
    const GENERATED = 'Generated from src/shared/report-schemas.js by `npm run build:action-docs`; do not edit the file in schemas/ by hand.';

    const OUTCOMES = ['fail', 'cantTell', 'pass', 'notApplicable'];
    const SEVERITIES = ['critical', 'serious', 'moderate', 'minor', 'info', 'unknown'];
    const LEVELS = ['A', 'AA', 'AAA'];

    const text = { type: 'string' };
    const textOrNull = { type: ['string', 'null'] };
    const count = { type: 'integer', minimum: 0 };
    const open = (properties, required = []) => ({ type: 'object', required, properties });

    function reportSchema() {
        return {
            $schema: SCHEMA,
            $id: 'urn:surea11y-lab:report:v3',
            title: 'surea11y-lab report',
            description: 'A run\'s results: what was scanned, against what, and what was found. The CLI writes one as payload.json, and the app saves one as *.a11y-report.json. Each finding is in its scan only: the findings by outcome across scans are built from the scans. Reports with no reportVersion are version 1, and version 2 also kept those findings by outcome (findings): the app still opens both, reading them as this version. ' + GENERATED,
            type: 'object',
            required: ['reportVersion', 'url', 'runId', 'timestamp', 'scans'],
            properties: {
                reportVersion: { const: 3, description: 'The format version.' },
                url: { ...text, description: 'The page the run started on.' },
                runId: { ...text, minLength: 1, description: 'The run\'s id: the same in every copy of this report.' },
                timestamp: { ...text, description: 'When the run started (ISO 8601).' },
                scenarioName: textOrNull,
                cancelled: { type: 'boolean' },
                failed: { type: 'boolean' },
                actionResults: { type: 'array', items: { $ref: '#/$defs/actionResult' } },
                scans: { type: 'array', items: { $ref: '#/$defs/scan' } },
                screenshots: { type: 'array', items: { type: 'object' } },
                metrics: { type: 'object', description: 'Scores and page metrics. Open: it grows with the lab.' },
                runDiagnostics: { type: 'object' },
            },
            $defs: {
                actionResult: open({
                    index: count,
                    type: text,
                    label: textOrNull,
                    status: text,
                    optional: { type: 'boolean' },
                    durationMs: { type: 'number' },
                }, ['type', 'status']),
                scan: {
                    ...open({
                        id: { ...text, minLength: 1 },
                        label: textOrNull,
                        url: text,
                        skipped: { type: 'boolean' },
                        context: textOrNull,
                        exclude: textOrNull,
                        profile: {
                            anyOf: [
                                open({ id: textOrNull, label: text }, ['id', 'label']),
                                { type: 'null' },
                            ],
                            description: 'What the scan checked against: a standard when one was applied ("en301549-v4.1.1"), else its WCAG 2.2 level as a profile ("wcag22-aa"). The id is null for a WCAG version no profile names. Null when the report does not say.',
                        },
                        wcag: {
                            ...open({
                                version: textOrNull,
                                level: { anyOf: [{ enum: LEVELS }, { type: 'null' }] },
                            }, ['version', 'level']),
                            description: 'The WCAG version and level the profile came to.',
                        },
                        canonical: { $ref: '#/$defs/canonical' },
                        summary: { type: 'object' },
                        metrics: { type: 'object' },
                    }, ['id', 'url', 'profile', 'wcag']),
                    description: 'One scan: a page, or a part of it, as it stood at one step of the run. A skipped scan has no canonical results.',
                },
                canonical: open({
                    version: textOrNull,
                    findings: { type: 'array', items: { $ref: '#/$defs/finding' } },
                }, ['findings']),
                finding: {
                    ...open({
                        id: text,
                        uid: text,
                        ruleId: text,
                        title: text,
                        outcome: { enum: OUTCOMES },
                        severity: { anyOf: [{ enum: SEVERITIES }, { type: 'null' }] },
                        engineId: text,
                        helpUrl: textOrNull,
                        wcag: { type: ['object', 'null'] },
                        standards: { type: ['object', 'null'] },
                        occurrences: { type: 'array', items: { $ref: '#/$defs/occurrence' } },
                    }, ['outcome']),
                    anyOf: [{ required: ['uid'] }, { required: ['id'] }],
                    description: 'What one check concluded on a scan, and the elements it concluded it on.',
                },
                occurrence: {
                    ...open({
                        occurrenceId: {
                            ...text,
                            pattern: '^occ_[0-9a-f]{14}$',
                            description: 'The occurrence\'s id: the same issue on the same element of the same page has the same id in every report, whatever the site\'s origin. It is a hash of the rule, the page\'s path and query, and the element\'s selector, so an element whose selector changes gets a new id.',
                        },
                        pageUrl: text,
                        target: { type: 'array' },
                        html: text,
                    }, ['occurrenceId']),
                    description: 'One element a finding concluded on.',
                },
            },
        };
    }

    function comparisonSchema() {
        return {
            $schema: SCHEMA,
            $id: 'urn:surea11y-lab:comparison:v1',
            title: 'surea11y-lab comparison',
            description: 'comparison.json in a downloaded comparison zip: how the reports beside it, in reports/, are arranged. ' + GENERATED,
            type: 'object',
            required: ['type', 'version', 'reports'],
            properties: {
                type: { const: 'a11y-comparison' },
                version: { const: 1 },
                context: { enum: ['time', 'versions', 'variants'], description: 'What the reports are: runs over time, versions of a site, or variants of a page.' },
                order: { anyOf: [{ enum: ['time', 'given'] }, { type: 'null' }], description: 'Whether the columns follow the runs\' time, or the order given here.' },
                document: open({ title: text, note: text, generatedAt: textOrNull }),
                reports: {
                    type: 'array',
                    minItems: 1,
                    items: open({ file: { ...text, minLength: 1 }, name: textOrNull }, ['file']),
                    description: 'The reports in column order, each a file in the zip.',
                },
            },
        };
    }

    function diffSchema() {
        const rowTags = ['still', 'fixed', 'new', 'both', 'aonly', 'bonly'];
        return {
            $schema: SCHEMA,
            $id: 'urn:surea11y-lab:diff:v1',
            title: 'surea11y-lab diff',
            description: 'diff.json, which `node src/cli/run-workflow.js` writes beside payload.json when a run is compared with a baseline: what changed since that run. ' + GENERATED,
            type: 'object',
            required: ['type', 'version', 'summary', 'diff'],
            properties: {
                type: { const: 'a11y-diff' },
                version: { const: 1 },
                summary: {
                    ...open({
                        rules: open({ new: count, resolved: count, persistent: count }, ['new', 'resolved', 'persistent']),
                        occurrences: open({ new: count, fixed: count, still: count }, ['new', 'fixed', 'still']),
                        newRules: { type: 'array', items: text },
                        net: { type: 'integer' },
                        headline: text,
                    }, ['rules', 'occurrences', 'newRules', 'net']),
                    description: 'The counts a pipeline reads.',
                },
                diff: {
                    ...open({
                        mode: { enum: ['evolution', 'ab'] },
                        identityA: { type: 'object', description: 'The baseline run.' },
                        identityB: { type: 'object', description: 'This run.' },
                        stats: { type: 'object' },
                        rows: {
                            type: 'array',
                            items: open({
                                ruleId: text,
                                title: text,
                                severity: { enum: SEVERITIES },
                                category: { enum: ['new', 'resolved', 'persistent', 'aonly', 'bonly', 'both'] },
                                aCount: count,
                                bCount: count,
                                occ: {
                                    type: 'array',
                                    items: open({
                                        occurrenceId: { ...text, pattern: '^occ_[0-9a-f]{14}$' },
                                        tag: { enum: rowTags },
                                        pageUrl: text,
                                        target: text,
                                    }, ['occurrenceId', 'tag']),
                                },
                            }, ['ruleId', 'category', 'occ']),
                            description: 'One row per failing rule in either run, with its occurrences.',
                        },
                    }, ['mode', 'rows']),
                    description: 'The comparison in full, as the app shows it.',
                },
            },
        };
    }

    /**
     * What the app checks a report it opens against, once report-format.js
     * has read it as the current format: the report schema, with the run's
     * id and time optional, since reports saved before the lab stamped them
     * still open.
     */
    function openableReportSchema() {
        const schema = reportSchema();
        schema.required = schema.required.filter((name) => name !== 'runId' && name !== 'timestamp');
        return schema;
    }

    /** The published schemas, by the file each is written to in schemas/. */
    function publishedSchemas() {
        return {
            'report.v3.schema.json': reportSchema(),
            'comparison.v1.schema.json': comparisonSchema(),
            'diff.v1.schema.json': diffSchema(),
        };
    }

    return {
        reportSchema,
        openableReportSchema,
        comparisonSchema,
        diffSchema,
        publishedSchemas,
    };
}));
