'use strict';

/**
 * report-schemas.js (shared)
 *
 * What the lab writes, as published JSON Schemas, for whatever reads it
 * outside the app: a dashboard, a script, a CI step, a tool that files
 * tickets. `npm run build:action-docs` writes them to schemas/:
 *
 *   report.v4.schema.json      a report (payload.json, *.a11y-report.json)
 *   report.v3.schema.json      a report saved before version 4
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

    /**
     * The report schema, of `version` 4 (the current one) or 3. Version 4
     * keeps the rule catalogue once, in ruleCatalogs, each scan naming its
     * own by index; it also lists a finding's unlisted elements and where an
     * occurrence is (its shadow hosts and iframes).
     */
    function reportSchema(version = 4) {
        const v4 = version >= 4;
        const schema = {
            $schema: SCHEMA,
            $id: `urn:surea11y-lab:report:v${v4 ? 4 : 3}`,
            title: 'surea11y-lab report',
            description: v4
                ? 'A run\'s results: what was scanned, against what, and what was found. The CLI writes one as payload.json, and the app saves one as *.a11y-report.json. Each finding is in its scan only: the findings by outcome across scans are built from the scans. The rule catalogue each scan ran with is kept once, in ruleCatalogs, and named by index from each scan (canonical.rulesCatalog). Reports of versions 1 to 3 still open, read as this version: version 3 kept each scan\'s catalogue in it (canonical.rules), version 2 also kept the findings by outcome (findings), and version 1 has no reportVersion. ' + GENERATED
                : 'A run\'s results: what was scanned, against what, and what was found. The CLI writes one as payload.json, and the app saves one as *.a11y-report.json. Each finding is in its scan only: the findings by outcome across scans are built from the scans. Reports with no reportVersion are version 1, and version 2 also kept those findings by outcome (findings): the app still opens both, reading them as this version. ' + GENERATED,
            type: 'object',
            required: ['reportVersion', 'url', 'runId', 'timestamp', 'scans'],
            properties: {
                reportVersion: { const: v4 ? 4 : 3, description: 'The format version.' },
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
                conformanceReview: {
                    type: 'object',
                    description: 'A reviewer\'s conformance verdicts over the automated draft (docs/design/conformance-report-design.md): '
                        + '`product` (name, version, description, contact, notes), `reviewer`, `methods`, and per WCAG criterion '
                        + '(`criteria`, by number) or EN 301 549 clause (`clauses`) a `conformance` (supports, partiallySupports, '
                        + 'doesNotSupport, notApplicable, notEvaluated) and `remarks`; another installed standard\'s requirements under '
                        + '`standards`, by the standard\'s key and version. With `facets`, the checks a person answered by hand: by '
                        + 'check, its `result` (pass, fail, na) and `label`, its words.',
                    properties: {
                        product: { type: 'object' },
                        reviewer: { type: 'string' },
                        methods: { type: 'string' },
                        criteria: { type: 'object', additionalProperties: { $ref: '#/$defs/conformanceEntry' } },
                        clauses: { type: 'object', additionalProperties: { $ref: '#/$defs/conformanceEntry' } },
                        standards: {
                            type: 'object',
                            additionalProperties: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { $ref: '#/$defs/conformanceEntry' } } },
                        },
                        updatedAt: { type: 'string' },
                    },
                },
            },
            $defs: {
                conformanceEntry: {
                    type: 'object',
                    properties: {
                        conformance: { enum: ['supports', 'partiallySupports', 'doesNotSupport', 'notApplicable', 'notEvaluated', ''] },
                        remarks: { type: 'string' },
                        facets: {
                            type: 'object',
                            additionalProperties: {
                                anyOf: [
                                    { type: 'object', properties: { result: { enum: ['pass', 'fail', 'na'] }, label: { type: 'string' } } },
                                    { enum: ['pass', 'fail', 'na'] },
                                ],
                            },
                        },
                    },
                },
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
                        exclude: {
                            anyOf: [text, { type: 'array', items: text }, { type: 'null' }],
                            description: 'The parts of the page the scan left out: CSS selectors, as a list or as text separated by commas.',
                        },
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
                        profiles: {
                            type: 'array',
                            items: open({ id: text, label: text }, ['id', 'label']),
                            description: 'A scan of several profiles at once: every one it checked against, in the order they ran, the WCAG level first. `profile` is then the first standard among them. Absent for a scan of one.',
                        },
                        profilesNotRun: {
                            type: 'array',
                            items: open({ id: text, label: text, reason: textOrNull }, ['id', 'label']),
                            description: 'A scan of several profiles: those asked for that did not run, and why ("unknown-profile", "pack-skipped", "overridden-by-selection").',
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
                        verdicts: {
                            type: 'object',
                            additionalProperties: { enum: OUTCOMES },
                            description: 'A scan of several profiles: what each one makes of the finding, by profile id. Its outcome is the worst of them.',
                        },
                        checkOutcome: {
                            enum: OUTCOMES,
                            description: 'A scan of several profiles: the rule\'s own outcome, before a standard judged its findings by reason code. Its WCAG criteria read this one.',
                        },
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
                        checks: {
                            type: 'array',
                            items: open({ checkId: text, failureSummary: text }, ['checkId']),
                            description: 'On a rollup\'s occurrence, when more than one of its checks flagged the element: what each check said, the first being the occurrence\'s own fields. The element is one occurrence whatever the number of checks.',
                        },
                        contextTargets: {
                            type: 'object',
                            additionalProperties: { type: 'array' },
                            description: 'On a merged scan\'s occurrence, by context: the element\'s target in a context where the page gave it other ids (a framework numbering the ids it makes as it goes), and so another selector. The occurrence\'s own target is its first context\'s.',
                        },
                    }, ['occurrenceId']),
                    description: 'One element a finding concluded on.',
                },
            },
        };
        if (v4) {
            schema.properties.ruleCatalogs = {
                type: 'array',
                items: { type: 'array', items: { type: 'object' } },
                description: 'The rule catalogues the scans ran with, each once: a scan names its own by index (canonical.rulesCatalog).',
            };
            schema.$defs.canonical.properties.rulesCatalog = { ...count, description: 'The index in ruleCatalogs of the rule catalogue this scan ran with.' };
            schema.$defs.finding.properties.unlisted = { ...count, description: 'Elements the rule found and counted, past those it lists in occurrences (surea11y\'s contrast rules list 50).' };
            Object.assign(schema.$defs.occurrence.properties, {
                shadowHostSelectors: { type: 'array', items: text, description: 'For an element in a shadow tree: the selectors of the hosts that lead to it from the document, outermost first; its target holds only inside the last one\'s shadow root.' },
                frameUrl: { ...text, description: 'For an element in one of the page\'s iframes: the iframe\'s address.' },
                frameSelectors: { type: 'array', items: text, description: 'For an element in an iframe: the selectors of the iframe elements that lead to it from the page, outermost first.' },
            });
        }
        return schema;
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
                profilesOff: { type: 'array', items: text, description: 'The profiles turned off, so the comparison is read on the others: "wcag" for WCAG at any level, else a profile\'s id. Absent when every profile the reports share is compared.' },
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
                        newRules: {
                            type: 'array',
                            description: 'Each rule failing now that did not before, with its failing instances in this run.',
                            items: open({
                                ruleId: text,
                                title: textOrNull,
                                severity: { enum: [...SEVERITIES, null] },
                                occurrences: count,
                            }, ['ruleId', 'occurrences']),
                        },
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
                        profiles: {
                            ...open({
                                profiles: { type: 'array', items: open({ key: text, label: text }, ['key', 'label']) },
                                rows: {
                                    type: 'array',
                                    items: open({
                                        key: text,
                                        label: text,
                                        kind: { enum: ['profile', 'shared', 'total'] },
                                        columns: {
                                            type: 'array',
                                            items: open({
                                                elements: count,
                                                problems: { type: ['integer', 'null'], minimum: 0 },
                                                failures: { type: ['integer', 'null'], minimum: 0 },
                                                score: { type: ['number', 'null'] },
                                            }, ['elements']),
                                        },
                                        change: { type: ['object', 'null'], description: 'The broken elements by what became of them: fixed, new and still (or aonly, bonly and both).' },
                                    }, ['key', 'kind', 'columns']),
                                },
                            }, ['profiles', 'rows']),
                            description: 'Present when the runs are compared on two profiles or more: each broken element put down to the one profile that flags it, or to "shared" when several do (as WCAG 2.5.8 and EN 301 549\'s 9.2.5.8 flag the same small target), so the rows\' elements add up to the "total" row\'s. Each profile\'s problems, failures and score are the run read on that profile alone, and do not add up.',
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
            'report.v4.schema.json': reportSchema(4),
            'report.v3.schema.json': reportSchema(3),
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
