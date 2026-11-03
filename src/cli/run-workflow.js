#!/usr/bin/env node
'use strict';

/**
 * Runs a workflow spec without the UI and writes the result to disk.
 *
 * Same engine and same payload as a run started from the browser: the shared
 * path is `executeWorkflowRun`.
 */

const fs = require('fs');
const path = require('path');

const { validateUrlOrThrow, executeWorkflowRun, isDebugMode } = require('../server-side/workflow-run');
const { closeBrowser } = require('../server-side/a11y-runner');
const { findingsByOutcome } = require('../server-side/a11y-canonical');
const { writeJsonFile } = require('../server-side/json-file-writer');
const { createBatchImages, packResultImages } = require('../server-side/batch-package');
const { REPORTS_ROOT } = require('../server-side/report-paths');
const { assessRun, describeRunHealth } = require('../shared/run-health.js');
const { parseCliArgs, applyOverrides } = require('./run-spec');
const { EXIT, loadBaselinePayload, compareToBaseline, comparableSummary, decideExit, diffDocument } = require('./baseline');
const {
    defaultOutDir, resolveBaselineTarget, promoteBaseline, pruneRuns,
    defaultBatchDir, batchRunDirName, findPreviousBatchRun, pruneBatches, baselineFilePath, BATCH_MANIFEST,
} = require('./run-store');
const { isBatch, checkBatch } = require('./batch-spec');
const { summarizePayload } = require('../server-side/run-queue');
const { buildSummaryMarkdown, engineChangesText, profilesText } = require('./summary-report');
const { createStepProgress, summaryLines: stepSummaryLines } = require('./step-progress');
const { writeExports, likelyFailures, baselineEntriesFor } = require('./export-formats');
const { readReviewFile, carryReviewOnto, writeConformanceReport } = require('./conformance-export');
const { countReviewGroups, reviewGroupsText } = require('../shared/review-groups.js');
const { checkSpec } = require('./check-spec');
const { resolveSecretRefs, describeMissing } = require('../shared/secret-refs.js');
const { buildDryRunReport } = require('./dry-run-report');
const { buildComparisonHtml } = require('./comparison-html');

const EXIT_OK = EXIT.OK;
const EXIT_RUN_FAILED = EXIT.RUN_FAILED;
const EXIT_BAD_USAGE = EXIT.BAD_USAGE;
const EXIT_CANCELLED = EXIT.CANCELLED;

const USAGE = `Usage: node src/cli/run-workflow.js <spec.json> [options]

Runs a workflow spec, or a config saved from the UI, and writes the run payload
to disk. With a baseline, reports what changed since that run.

A batch spec (schemas/batch-spec.v1.schema.json), or a config saved with its
batch on, runs the workflow once per row, as the app's queue does: each row in
its own folder under <store>/<batch>/batches/<stamp>, with batch.json listing
them. --baseline auto compares each row with its run in the previous batch,
@name with the baseline promoted for that row; --keep counts batches.

Options:
  --spec <file>      Spec file, when not given as the first argument
  --out <dir>        Output directory
                     (default: <store>/<scenario>/runs/<stamp>)
  --store <dir>      Where runs and baselines are kept (default: a11y-runs)
  --baseline <what>  auto for the previous run of this scenario, @name for a
                     promoted baseline, or a path to a payload.json
  --promote <name>   Keep this run as the named baseline, if it ran whole
  --keep <n>         Delete all but the newest n runs beside this one - every
                     directory holding a payload.json in --out's parent
                     folder, not just this scenario's, so a custom --out
                     shared with other scenarios will prune those too
  --url <url>        Override the url in the spec
  --scenario <name>  Override the scenario name in the spec
  --debug-native     Keep raw engine output in the payload
  --accept-untrusted-certs
                     Open sites whose certificate the browser does not trust
                     (a staging server's own, or any site on a network that
                     inspects HTTPS), as the spec's acceptUntrustedCerts does.
                     The browser cannot then tell a site from one pretending
                     to be it: sign in only where you trust the network.
  --format <list>    Also write surea11y's results as sarif, junit and/or
                     earl (comma-separated), into <out>/exports. Can be
                     repeated. Scans run without surea11y are left out.
                     acr writes the run's conformance report (VPAT 2.5,
                     WCAG and EN 301 549) there too, as HTML and Word.
  --review <file>    A report (its JSON, payload.json or package zip) whose
                     conformance review this run takes on, filling in only
                     what it has not decided; saved in payload.json. Without
                     it, a baseline's review is carried on.
  --no-batch         Run a config's workflow once, with its batch left off
  --dry-run          Take every step in a browser but the scans, screenshots
                     and evidence, and say how each went: which failed and
                     where, which were never reached, and which scans would
                     have had nothing to check. Writes nothing. Exit 0 when
                     the workflow fits the site, 4 when it does not.
  --check            Only check the spec, without opening a browser: its
                     fields, and every step against the run spec schema
                     (schemas/run-spec.v1.schema.json). Exit 0 when it can
                     run, 2 when it cannot.
  --fail-on-lean     Also fail on surea11y's questions whose evidence leans
                     fail (likely failures), new since the baseline: exit 5,
                     and with --format, an error in SARIF and a failure in
                     JUnit. Only those of rules in the scan's target.
  --fail-on-failures Fail a run that has no baseline to compare with when it
                     has failing instances: exit 3, as new failures against a
                     baseline do. Without it, a first run passes. With a
                     baseline it changes nothing.
  -q, --quiet        Only print the summary
  -h, --help         Show this message

On a terminal, a step-progress bar is drawn below the run's output. Piped or
redirected output never gets it - the log lines are the record there - but the
steps that ran appear in the summary either way.

Writes payload.json, run.log.jsonl, summary.md, and when compared diff.json
and comparison.html, the comparison as the app's Compare tab downloads it.
With --format, one file per scan and format in exports/: <nn>-<scan>.sarif,
<nn>-<scan>.junit.xml and <nn>-<scan>.earl.jsonld; with acr, one
conformance-report.html and conformance-report.docx for the run.

Exit codes:
  0  run finished, nothing new
  1  run failed
  2  bad usage or invalid spec
  3  new failing instances against the baseline, or with
     --fail-on-failures and no baseline, any failing instance
  4  run degraded: it covered less than the spec asked for
  5  with --fail-on-lean, new likely failures
  130 cancelled
`;

function readJsonFile(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
}

function formatLogLine(entry) {
    const depth = Number.isFinite(entry?.depth) ? Math.max(0, entry.depth) : 0;
    const indent = '  '.repeat(depth);
    const type = entry?.type === 'error' ? 'ERROR ' : '';
    return `${indent}${type}${entry?.message ?? ''}`;
}

// Canonical findings are merged by uid, so the rule count hides how much of the
// page is affected. Occurrences carry that.
function countInstances(findings) {
    if (!Array.isArray(findings)) return 0;
    return findings.reduce((total, finding) => (
        total + (Array.isArray(finding?.occurrences) ? finding.occurrences.length : 0)
    ), 0);
}

function diagnosticsCounts(payload) {
    const diagnostics = payload?.runDiagnostics || {};
    return {
        consoleErrors: Array.isArray(diagnostics.consoleErrors) ? diagnostics.consoleErrors.length : 0,
        requestFailures: Array.isArray(diagnostics.requestFailures) ? diagnostics.requestFailures.length : 0,
        badResponses: Array.isArray(diagnostics.badResponses) ? diagnostics.badResponses.length : 0,
    };
}

function printSummary(payload, status, outDir, bytes, health, steps) {
    // By outcome, one rule merged across scans: a report keeps them in its
    // scans only.
    const findings = findingsByOutcome(payload?.scans);
    const diagnostics = diagnosticsCounts(payload);
    const skipped = (health?.skippedScans || []).length;

    const lines = [
        '',
        `Status      ${status}${health?.degraded ? ' (degraded)' : ''}`,
        `Scenario    ${payload?.scenarioName || '(none)'}`,
        `Url         ${payload?.url || '(none)'}`,
        `Run id      ${payload?.runId || '(none)'}`,
        `Scans       ${(payload?.scans || []).length}${skipped ? ` (${skipped} skipped)` : ''}`,
        `Failing     ${(findings.fail || []).length} rules, ${countInstances(findings.fail)} instances`,
        `Can't tell  ${(findings.cantTell || []).length} rules, ${countInstances(findings.cantTell)} instances`
            + (reviewGroupsText(countReviewGroups(findings.cantTell, { outcome: 'cantTell' })) ? ` (${reviewGroupsText(countReviewGroups(findings.cantTell, { outcome: 'cantTell' }))})` : ''),
        `Diagnostics ${diagnostics.consoleErrors} console, ${diagnostics.requestFailures} request failures, ${diagnostics.badResponses} bad responses`,
        `Payload     ${outDir}${path.sep}payload.json (${Math.round(bytes / 1024)} KB)`,
        '',
    ];

    // Above the findings: how much of the workflow ran is the first thing that
    // decides whether the numbers below it mean anything.
    const stepLines = stepSummaryLines(steps);
    if (stepLines.length) {
        lines.splice(lines.indexOf(`Scans       ${(payload?.scans || []).length}${skipped ? ` (${skipped} skipped)` : ''}`), 0, ...stepLines);
    }

    if (payload?.errorDetails?.message) {
        lines.splice(1, 0, `Error       ${payload.errorDetails.message}`);
    }

    for (const line of describeRunHealth(health)) {
        lines.splice(lines.length - 1, 0, `Degraded    ${line}`);
    }

    const optional = (health?.optionalFailures || []).length;
    if (optional) {
        lines.splice(lines.length - 1, 0, `Optional    ${optional} optional action${optional === 1 ? '' : 's'} failed`);
    }

    console.log(lines.join('\n'));
}

function printComparison(comparison, baselinePayload, baselineLabel) {
    const { summary, swapped } = comparison;
    const label = baselineLabel || baselinePayload?.timestamp || baselinePayload?.runId || 'baseline';

    const lines = [
        `Compared to ${label}`,
        `Rules       ${summary.rules.new} new, ${summary.rules.resolved} resolved, ${summary.rules.persistent} persistent`,
        `Instances   ${summary.occurrences.new} new, ${summary.occurrences.fixed} fixed, ${summary.occurrences.still} still failing`,
    ];

    if (swapped) {
        lines.push('Warning     the baseline is newer than this run; it is still read as the baseline');
    }
    const engines = engineChangesText(comparison.engineChanges);
    if (engines) lines.push(`Warning     ${engines}`);
    const profiles = profilesText(comparison.profiles);
    if (profiles) lines.push(`${profiles.warning ? 'Warning' : 'Note'}${profiles.warning ? '    ' : '       '} ${profiles.text}`);

    for (const rule of summary.newRules) {
        lines.push(`  new       ${rule.ruleId} (${rule.severity}) ${rule.occurrences} instance${rule.occurrences === 1 ? '' : 's'}`);
    }

    console.log(lines.join('\n') + '\n');
}

/**
 * --dry-run: the workflow's steps in a browser, without its scans,
 * screenshots or evidence, then how each went (dry-run-report.js). Nothing is
 * written, so a dry run never becomes the run a baseline compares with.
 */
// What the command line sets on every run, a batch's rows too.
function withCliSettings(spec, options) {
    return options.acceptUntrustedCerts ? { ...spec, acceptUntrustedCerts: true } : spec;
}

async function runDry(spec, options) {
    const cancel = watchCancel('Cancelling the dry run. Press Ctrl+C again to force exit.');

    const stepProgress = createStepProgress({ actions: spec.actions, customSteps: spec.customSteps, quiet: options.quiet });
    if (!options.quiet) {
        console.log(`Dry run of ${spec.scenarioName || spec.url}: every step but the scans, screenshots and evidence`);
    }

    const logs = [];
    let result;
    try {
        result = await executeWorkflowRun(withCliSettings(spec, options), {
            dryRun: true,
            stepsChecked: true,
            isCancelled: cancel.isCancelled,
            progress: (entry) => {
                logs.push(entry);
                stepProgress.accept(entry);
                if (!options.quiet) stepProgress.writeLine(formatLogLine(entry));
            },
        });
    } finally {
        stepProgress.finish();
        cancel.stop();
    }

    const { lines, exitCode } = buildDryRunReport({
        actions: spec.actions,
        payload: result.payload,
        status: result.status,
        error: result.error,
        logs,
    });
    console.log(lines.join('\n'));
    return exitCode;
}

/**
 * --check: every problem in one pass. Warnings are fields the steps do not
 * declare and values outside the ones the app offers, which run but are
 * likely mistakes; errors are what would stop the run or be read as absent.
 */
function reportCheck(raw, specPath) {
    const { ok, spec, errors, warnings } = checkSpec(raw, { validateUrl: validateUrlOrThrow });

    for (const warning of warnings) console.error(`Warning: ${warning}`);
    for (const error of errors) console.error(`Error: ${error}`);

    if (!ok) {
        console.error(`\n${specPath}: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
        return EXIT_BAD_USAGE;
    }

    const steps = spec.actions.length;
    const custom = spec.customSteps.length;
    console.log(`${specPath}: ok, ${steps} step${steps === 1 ? '' : 's'}`
        + (custom ? `, ${custom} custom step${custom === 1 ? '' : 's'}` : '')
        + (warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''));
    return EXIT_OK;
}

/**
 * The secrets a workflow reads from the environment that it does not set,
 * as a message, or null: a run stops on it before a browser opens.
 */
function unsetSecrets(spec) {
    const { missing } = resolveSecretRefs({ actions: spec.actions, customSteps: spec.customSteps }, process.env);
    return missing.length ? `the workflow cannot run: ${describeMissing(missing)}` : null;
}

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** --check on a batch: its own fields, its workflow and its rows. */
function reportBatchCheck(raw, specPath) {
    const { ok, batch, errors, warnings } = checkBatch(raw, { validateUrl: validateUrlOrThrow });
    for (const warning of warnings) console.error(`Warning: ${warning}`);
    for (const error of errors) console.error(`Error: ${error}`);
    if (!ok) {
        console.error(`\n${specPath}: ${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`);
        return EXIT_BAD_USAGE;
    }
    const steps = batch.runs[0].spec.actions.length;
    console.log(`${specPath}: ok, a batch of ${plural(batch.runs.length, 'run')}, ${plural(steps, 'step')}`
        + (warnings.length ? `, ${plural(warnings.length, 'warning')}` : ''));
    return EXIT_OK;
}

// The batch's exit code is its worst run's, in this order: a cancelled
// batch, a run that failed, one that covered less than asked, new failing
// instances, new likely failures.
const EXIT_RANK = [EXIT.CANCELLED, EXIT.RUN_FAILED, EXIT.DEGRADED, EXIT.NEW_INSTANCES, EXIT.LIKELY_FAILURES, EXIT.OK];

function worstExit(codes) {
    return EXIT_RANK.find((code) => codes.includes(code)) ?? EXIT.OK;
}

/** A row's baseline: its run in the previous batch, or its own promoted one. */
function rowBaseline(request, { batchDir, run, options }) {
    if (!request) return { payload: null, label: null };
    if (request === 'auto') {
        const previous = findPreviousBatchRun(batchDir, run.name);
        if (!previous) {
            console.error(`Note: no previous batch run of ${run.name} to compare with yet`);
            return { payload: null, label: null };
        }
        const loaded = loadBaselinePayload(previous.filePath);
        return loaded.ok ? { payload: loaded.payload, label: previous.label } : { error: loaded.error };
    }
    const name = request.slice(1);
    const target = baselineFilePath(name, run.spec, options);
    if (!fs.existsSync(target)) {
        console.error(`Note: ${run.name} has no baseline @${name} yet`);
        return { payload: null, label: null };
    }
    const loaded = loadBaselinePayload(target);
    return loaded.ok ? { payload: loaded.payload, label: name } : { error: loaded.error };
}

/**
 * A batch: the same checks first, for every row, then each row's run in turn,
 * as the queue runs them. batch.json is written after each, so a batch cut
 * short still says what ran.
 */
async function runBatchFile(raw, options) {
    const { ok, batch, errors, warnings } = checkBatch(raw, { validateUrl: validateUrlOrThrow, env: null });
    for (const warning of warnings) console.error(`Warning: ${warning}`);
    if (!ok) {
        console.error(errors.map((e) => `Error: ${e}`).join('\n'));
        return EXIT_BAD_USAGE;
    }
    if (options.url) {
        console.error('Error: --url does not apply to a batch: each row sets its own url');
        return EXIT_BAD_USAGE;
    }
    const request = options.baselinePath ? String(options.baselinePath).trim() : '';
    if (request && request !== 'auto' && !/^@./.test(request)) {
        console.error('Error: a batch compares each row with its own baseline: use --baseline auto or @name');
        return EXIT_BAD_USAGE;
    }
    const name = options.scenarioName ? String(options.scenarioName).trim() : batch.name;
    const unset = unsetSecrets(batch.runs[0].spec);
    if (unset) {
        console.error(`Error: ${unset}`);
        return EXIT_BAD_USAGE;
    }

    if (options.dryRun) {
        // As the app does: the first row's workflow stands for the batch.
        console.log(`Dry run of the batch's first row, ${batch.runs[0].name}`);
        return runDry(batch.runs[0].spec, options);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchDir = path.resolve(options.outDir || defaultBatchDir(name, stamp, options));
    fs.mkdirSync(batchDir, { recursive: true });

    // The queue's batch.json, item for item, so whatever reads a queue's
    // batch reads this one; `file` is relative to this folder, and each item
    // adds its exit code and, when compared, what changed.
    const manifest = {
        type: 'a11y-queue-session',
        version: 1,
        source: 'cli',
        name,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        items: batch.runs.map((run, i) => ({
            id: i + 1,
            name: run.name,
            url: run.url,
            status: 'waiting',
            row: run.row,
            vars: run.vars,
            file: null,
            exitCode: null,
        })),
    };
    const writeManifest = () => fs.writeFileSync(path.join(batchDir, BATCH_MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');
    writeManifest();

    const cancel = watchCancel('Cancelling the batch after this run; its result will still be written. Press Ctrl+C again to force exit.');
    const codes = [];
    try {
        for (let i = 0; i < batch.runs.length; i += 1) {
            const run = batch.runs[i];
            const item = manifest.items[i];
            if (cancel.isCancelled()) {
                item.status = 'cancelled';
                codes.push(EXIT_CANCELLED);
                continue;
            }
            if (!options.quiet) console.log(`\n[${i + 1}/${batch.runs.length}] ${run.name}`);

            const runDirName = batchRunDirName(i + 1, batch.runs.length, run.name);
            const baseline = rowBaseline(request, { batchDir, run, options });
            if (baseline.error) console.error(`Warning: ${run.name}: ${baseline.error}; not compared`);

            item.status = 'running';
            item.startedAt = new Date().toISOString();
            writeManifest();
            const started = Date.now();
            let result;
            try {
                result = await runOne(run.spec, { ...options, keep: null }, {
                    outDir: path.join(batchDir, runDirName),
                    baselinePayload: baseline.error ? null : baseline.payload,
                    baselineLabel: baseline.error ? null : baseline.label,
                    isCancelled: cancel.isCancelled,
                });
            } catch (err) {
                console.error(`Error: ${run.name}: ${err && err.message ? err.message : err}`);
                result = { exitCode: EXIT_RUN_FAILED, status: 'error', payload: null };
            }

            item.finishedAt = new Date().toISOString();
            item.durationMs = Date.now() - started;
            item.status = result.status || 'error';
            item.exitCode = result.exitCode;
            if (result.payload) {
                const summary = summarizePayload(result.payload);
                item.file = `${runDirName}/payload.json`;
                item.scans = summary.scans;
                item.scansRun = summary.scansRun;
                item.findings = summary.findings;
                if (result.comparison) item.compared = result.comparison.summary;
            }
            codes.push(result.exitCode);
            writeManifest();
        }
    } finally {
        cancel.stop();
        manifest.finishedAt = new Date().toISOString();
        writeManifest();
    }

    printBatchSummary(manifest, batchDir);

    if (options.keep) {
        const pruned = pruneBatches(batchDir, options.keep);
        if (pruned.error) console.error(`Warning: ${pruned.error}`);
        for (const dir of pruned.removed) console.log(`Removed    ${dir}`);
    }

    return worstExit(codes);
}

const EXIT_WORDS = {
    [EXIT.OK]: 'ok',
    [EXIT.RUN_FAILED]: 'FAILED',
    [EXIT.DEGRADED]: 'degraded',
    [EXIT.NEW_INSTANCES]: 'new failures',
    [EXIT.LIKELY_FAILURES]: 'new likely failures',
    [EXIT.CANCELLED]: 'cancelled',
};

function printBatchSummary(manifest, batchDir) {
    const width = Math.max(...manifest.items.map((i) => i.name.length));
    console.log(`\nBatch      ${manifest.name}: ${plural(manifest.items.length, 'run')}`);
    for (const item of manifest.items) {
        const outcome = item.exitCode === null ? item.status : (EXIT_WORDS[item.exitCode] || `exit ${item.exitCode}`);
        const fails = item.findings ? `, ${item.findings.fail} failing` : '';
        const changed = item.compared ? `, ${item.compared.occurrences.new} new, ${item.compared.occurrences.fixed} fixed` : '';
        console.log(`  ${item.name.padEnd(width)}  ${outcome}${fails}${changed}`);
    }
    console.log(`Folder     ${batchDir}`);
}

// A forced (second-Ctrl+C) exit still tries to close the browser so it does not
// leak a process, but caps the wait - a hung browser is often exactly why the
// user is force-exiting in the first place. Cleanup deps are injectable so this
// can be tested without touching the real process/browser.
function forceExit(exitCode, { closeBrowserFn = closeBrowser, exitFn = process.exit, timeoutMs = 2000 } = {}) {
    return Promise.race([
        Promise.resolve().then(closeBrowserFn).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]).finally(() => exitFn(exitCode));
}

async function main(argv) {
    const { options, errors: argErrors } = parseCliArgs(argv);

    if (options.help) {
        console.log(USAGE);
        return EXIT_OK;
    }

    if (argErrors.length) {
        console.error(argErrors.map((e) => `Error: ${e}`).join('\n'));
        console.error(`\n${USAGE}`);
        return EXIT_BAD_USAGE;
    }

    let raw;
    try {
        raw = readJsonFile(path.resolve(options.specPath));
    } catch (e) {
        console.error(`Error: cannot read spec ${options.specPath}: ${e.message}`);
        return EXIT_BAD_USAGE;
    }

    // Read once, for every run a batch makes too.
    if (options.reviewPath && !options.check) {
        const read = await readReviewFile(path.resolve(options.reviewPath));
        if (read.error) {
            console.error(`Error: --review: ${read.error}`);
            return EXIT_BAD_USAGE;
        }
        if (!read.review) console.error(`Note: ${options.reviewPath} has no conformance review to carry on.`);
        options.review = read.review;
    }

    if (isBatch(raw) && !options.noBatch) {
        return options.check ? reportBatchCheck(raw, options.specPath) : runBatchFile(raw, options);
    }

    if (options.check) return reportCheck(raw, options.specPath);

    // The same checks as --check: a spec that cannot run stops here, with
    // exit 2, before any browser opens.
    const { ok, spec, errors, warnings } = checkSpec(raw, { validateUrl: validateUrlOrThrow, env: null });

    for (const warning of warnings) console.error(`Warning: ${warning}`);

    if (!ok) {
        console.error(errors.map((e) => `Error: ${e}`).join('\n'));
        return EXIT_BAD_USAGE;
    }

    const { spec: finalSpec, errors: overrideErrors } = applyOverrides(spec, options, {
        validateUrl: validateUrlOrThrow,
    });

    if (overrideErrors.length) {
        console.error(overrideErrors.map((e) => `Error: ${e}`).join('\n'));
        return EXIT_BAD_USAGE;
    }

    const unset = unsetSecrets(finalSpec);
    if (unset) {
        console.error(`Error: ${unset}`);
        return EXIT_BAD_USAGE;
    }

    if (options.dryRun) return runDry(finalSpec, options);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.resolve(options.outDir || defaultOutDir(finalSpec, stamp, options));

    // Resolve and read the baseline before running, so a wrong one costs nothing.
    const baseline = readBaseline(options.baselinePath, { outDir, spec: finalSpec, options });
    if (baseline.error) {
        console.error(`Error: ${baseline.error}`);
        return EXIT_BAD_USAGE;
    }

    const cancel = watchCancel('Cancelling, the partial result will still be written. Press Ctrl+C again to force exit.');
    try {
        const result = await runOne(finalSpec, options, {
            outDir,
            baselinePayload: baseline.payload,
            baselineLabel: baseline.label,
            isCancelled: cancel.isCancelled,
        });
        return result.exitCode;
    } finally {
        cancel.stop();
    }
}

/**
 * This run's scans that the comparison left out (sharing no profile with
 * the baseline's), as the payload has them: the comparison's own copies
 * of the two reports keep the scans in order, those left out marked.
 */
function notComparedScansOf(comparison, payload) {
    const compared = comparison && comparison.diff && comparison.diff.compared;
    if (!Array.isArray(compared)) return [];
    const current = compared[1];
    const scans = Array.isArray(payload && payload.scans) ? payload.scans : [];
    return (current && Array.isArray(current.scans) ? current.scans : [])
        .map((s, i) => (s && s.notCompared ? scans[i] : null)).filter(Boolean);
}

/**
 * The baseline a run is compared with: { payload, label }, both null when
 * there is none (a first run with `auto` is not a failure), or { error }.
 */
function readBaseline(request, { outDir, spec, options }) {
    if (!request) return { payload: null, label: null };
    const target = resolveBaselineTarget(request, { outDir, spec, options });
    if (target.error) return { error: target.error };
    if (target.missing) {
        console.error(`Note: ${target.message}`);
        return { payload: null, label: null };
    }
    const loaded = loadBaselinePayload(target.target);
    if (!loaded.ok) return { error: loaded.error };
    return { payload: loaded.payload, label: target.label };
}

/** Ctrl+C asks the run to stop; a second one forces the exit. */
function watchCancel(message) {
    let cancelled = false;
    const onSigint = () => {
        if (cancelled) {
            console.error('\nForcing exit.');
            forceExit(EXIT_CANCELLED);
            return;
        }
        cancelled = true;
        console.error(`\n${message}`);
    };
    process.on('SIGINT', onSigint);
    return { isCancelled: () => cancelled, stop: () => process.off('SIGINT', onSigint) };
}

/**
 * One run, written to `outDir`: payload.json, run.log.jsonl, summary.md,
 * and diff.json against a baseline. -> { exitCode, status, payload, health,
 * comparison } (payload null when the run produced none).
 */
async function runOne(finalSpec, options, { outDir, baselinePayload = null, baselineLabel = null, isCancelled }) {
    fs.mkdirSync(outDir, { recursive: true });

    const logs = [];

    // Counts the run as it goes, and - on a terminal - draws the bar under it.
    // Built from the same spec the engine is about to be handed, so what it
    // counts down is exactly what was asked for.
    const stepProgress = createStepProgress({
        actions: finalSpec.actions,
        customSteps: finalSpec.customSteps,
        quiet: options.quiet
    });

    if (!options.quiet) {
        const planned = stepProgress.snapshot();
        const stepNote = planned
            ? `, ${planned.unsized > 0 ? '~' : ''}${planned.remaining} steps`
            : '';
        console.log(`Running ${finalSpec.scenarioName || finalSpec.url} (${finalSpec.actions.length} actions${stepNote})`);
    }

    const { status, payload, error, coreResults } = await executeWorkflowRun(withCliSettings(finalSpec, options), {
        debugNative: options.debugNative || isDebugMode(),
        keepCoreResults: options.formats.length > 0 || options.failOnLean,
        isCancelled,
        stepsChecked: true,
        progress: (entry) => {
            logs.push(entry);
            stepProgress.accept(entry);
            if (!options.quiet) stepProgress.writeLine(formatLogLine(entry));
        },
    });

    // Whatever happens next - a summary, an error, an early return - the bar
    // must not still be sitting on the last line of the output.
    stepProgress.finish();
    const steps = stepProgress.snapshot();

    fs.writeFileSync(
        path.join(outDir, 'run.log.jsonl'),
        logs.map((entry) => JSON.stringify(entry)).join('\n') + (logs.length ? '\n' : ''),
        'utf8'
    );

    // An error.json an earlier run left in this folder is not this run's.
    if (payload) fs.rmSync(path.join(outDir, 'error.json'), { force: true });

    if (!payload) {
        fs.writeFileSync(path.join(outDir, 'error.json'), JSON.stringify(error, null, 2), 'utf8');
        console.error(`\nError: ${error.details}`);
        console.error(`Logs written to ${path.join(outDir, 'run.log.jsonl')}`);
        return { exitCode: EXIT_RUN_FAILED, status, payload: null, health: null, comparison: null };
    }

    // Its pictures as files in images/, the payload naming each by its path:
    // the run's folder is a report package, as a queue batch is, and the
    // payload is its findings, not mostly its pictures (a 50-scan run: 47 MB
    // inline). A picture that could not be had keeps its link.
    const packed = await packResultImages(payload, createBatchImages(outDir), { reportsRoot: REPORTS_ROOT });
    if (packed.missing.length) console.error(`Warning: ${packed.missing.length} picture(s) could not be written to images/: ${packed.missing[0].error}`);

    // A piece at a time, as the queue writes its results: a payload past
    // V8's ~512 MB string limit cannot be one string, and a large one
    // pretty-printed was a third larger again.
    // The conformance review this run takes on, saved in its payload so the
    // next run carries it on: --review's, else the baseline's.
    const carried = carryReviewOnto(payload, options.review || (baselinePayload && baselinePayload.conformanceReview) || null);

    const payloadPath = path.join(outDir, 'payload.json');
    const bytes = await writeJsonFile(payloadPath, payload);

    const health = assessRun(payload);
    printSummary(payload, status, outDir, bytes, health, steps);

    // --fail-on-lean: the likely failures of every surea11y scan, and how
    // many of them the baseline already had.
    let likely = null;
    if (options.failOnLean) {
        likely = { total: 0, known: 0, new: 0 };
        for (const entry of (coreResults || []).filter((e) => e && e.result)) {
            const scan = likelyFailures(entry.result, baselinePayload ? baselineEntriesFor(entry, baselinePayload) : null);
            likely.total += scan.total;
            likely.known += scan.known;
            likely.new += scan.new;
        }
        console.log(`Likely     ${likely.total} likely failure${likely.total === 1 ? '' : 's'} (questions whose evidence leans fail)`
            + (baselinePayload ? `, ${likely.new} new since the baseline` : ''));
    }

    if (carried) console.log(`Review     ${carried} conformance verdict${carried === 1 ? '' : 's'} carried on from ${options.review ? options.reviewPath : 'the baseline'}`);

    const perScan = options.formats.filter((f) => f !== 'acr');
    if (perScan.length) {
        try {
            const { written, known } = writeExports(coreResults, perScan, outDir, { baselinePayload, failOnLean: options.failOnLean });
            if (!written.length) console.error('Note: no scan ran with surea11y, so there was nothing to export.');
            else console.log(`Exports    ${written.length} file${written.length === 1 ? '' : 's'} in ${path.join(outDir, 'exports')}`);
            if (known) console.log(`           ${known} failing instance${known === 1 ? '' : 's'} already in the baseline, not reported as failures in SARIF or JUnit`);
        } catch (e) {
            console.error(`Warning: could not write exports: ${e.message}`);
        }
    }

    if (options.formats.includes('acr')) {
        try {
            const { written, totals } = await writeConformanceReport(payload, outDir);
            console.log(`Conformance ${written.length} files in ${path.join(outDir, 'exports')}: ${totals.reviewed} of ${totals.criteria} WCAG criteria reviewed, the rest the automated draft`);
        } catch (e) {
            console.error(`Warning: could not write the conformance report: ${e.message}`);
        }
    }

    let comparison = null;
    if (baselinePayload) {
        comparison = compareToBaseline(baselinePayload, payload);
        fs.writeFileSync(
            path.join(outDir, 'diff.json'),
            JSON.stringify(diffDocument(comparison), null, 2),
            'utf8'
        );
        printComparison(comparison, baselinePayload, baselineLabel);
        // The same comparison as a page to read, as the app's Compare tab
        // downloads it.
        try {
            const page = await buildComparisonHtml(baselinePayload, payload, { title: finalSpec.scenarioName || '' });
            if (page.html) {
                fs.writeFileSync(path.join(outDir, 'comparison.html'), page.html, 'utf8');
                console.log(`Comparison ${path.join(outDir, 'comparison.html')}`);
            } else {
                console.error(`Note: no comparison.html: ${page.missing}`);
            }
        } catch (e) {
            console.error(`Warning: could not write comparison.html: ${e.message}`);
        }
    }

    // --fail-on-failures with nothing to compare with: every failing
    // instance counts. So with a baseline that shares no profile with the
    // run, whose new instances are what was checked rather than the pages.
    const uncompared = !!comparison && !comparableSummary(comparison);
    // Beside scans that compare, those left out of the comparison (sharing
    // no profile with the baseline's) count as with no baseline too.
    const notComparedScans = comparison && !uncompared ? notComparedScansOf(comparison, payload) : [];
    const failing = !options.failOnFailures ? null
        : (!baselinePayload || uncompared) ? countInstances(findingsByOutcome(payload.scans).fail)
            : notComparedScans.length ? countInstances(findingsByOutcome(notComparedScans).fail)
                : null;
    if (failing) {
        console.log(`${baselinePayload ? 'Not compared' : 'No baseline'} ${failing} failing instance${failing === 1 ? '' : 's'} fail${failing === 1 ? 's' : ''} the run (--fail-on-failures)`);
    }

    fs.writeFileSync(
        path.join(outDir, 'summary.md'),
        buildSummaryMarkdown({ payload, status, health, comparison, baselineLabel, outDir, steps, likely, failing }),
        'utf8'
    );

    if (options.promote) {
        const promoted = promoteBaseline(options.promote, {
            payloadPath,
            spec: finalSpec,
            options,
            health,
            status,
        });
        if (promoted.ok) console.log(`Promoted   ${options.promote} -> ${promoted.target}`);
        else console.error(`Warning: ${promoted.error}`);
    }

    if (options.keep) {
        const pruned = pruneRuns(outDir, options.keep);
        if (pruned.error) console.error(`Warning: ${pruned.error}`);
        for (const dir of pruned.removed) console.log(`Removed    ${dir}`);
    }

    return {
        exitCode: decideExit({ status, health, summary: comparableSummary(comparison), likely, failing }),
        status,
        payload,
        health,
        comparison,
    };
}


if (require.main === module) {
    main(process.argv.slice(2))
        .then(async (code) => {
            await closeBrowser();
            process.exit(code);
        })
        .catch(async (err) => {
            console.error(`Error: ${err && err.message ? err.message : err}`);
            await closeBrowser();
            process.exit(EXIT_RUN_FAILED);
        });
}

module.exports = { main, formatLogLine, countInstances, printComparison, USAGE, forceExit, worstExit };
