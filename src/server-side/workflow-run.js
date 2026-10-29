'use strict';

/**
 * One workflow run, from spec to finished payload.
 *
 * The HTTP route and the CLI both go through here, so a headless run and a run
 * started from the UI produce the same payload from the same inputs.
 */

const crypto = require('crypto');

const {
    runA11yWorkflow,
    buildGlobalSummary,
    sortByOrderKey
} = require('./a11y-runner');
const { METRIC_DEFS } = require('./metrics/a11y-metric-defs.cjs');
const { createWorkflowPayloadBuilder } = require('../shared/workflow-payload-builder');
const { buildBaselineEntries } = require('@surea11y/core/baseline');
const { coreHooksFrom } = require('./engines/surea11y-scan');
const { checkWorkflowSteps } = require('./step-check');
const { resolveSecretRefs, describeMissing } = require('../shared/secret-refs.js');

function cryptoSha1Hex16(text) {
    // Node-side digest, the browser build uses WebCrypto for the same field.
    return crypto.createHash('sha1').update(String(text), 'utf8').digest('hex').slice(0, 16);
}

const PAYLOAD = createWorkflowPayloadBuilder({
    METRIC_DEFS,
    sortByOrderKey,
    buildGlobalSummary,
    cryptoSha1Hex16
});

/**
 * Normalize a boolean-like environment flag.
 * Returns the default when env var is missing.
 */
function envFlag(name, def = null) {
    const v = process.env[name];
    if (v == null) return def;
    const s = String(v).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(s);
}

/** The machine's time zone, or UTC where the runtime can't say. */
function machineTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

function resolveDeterminism() {
    return {
        isolateContext: envFlag('A11Y_ISOLATE_RUNS', true),
        disableCache: envFlag('A11Y_DISABLE_CACHE', true),
        // The machine's own zone unless A11Y_TZ names one: set it for results
        // that don't change with where the run happens.
        timezone: process.env.A11Y_TZ || machineTimeZone(),
        acceptLanguage: process.env.A11Y_ACCEPT_LANGUAGE || 'en-US,en;q=0.8',
        // Core's opt-in hooks, installed before the page loads: all by
        // default, A11Y_CORE_HOOKS=none for none, or a list
        // (internals,listener,liveRegion).
        coreHooks: coreHooksFrom(process.env.A11Y_CORE_HOOKS),
    };
}

function isDebugMode() {
    return envFlag('A11Y_DEBUG_MODE', false);
}

function hasEvidenceCaptureAction(actions) {
    const list = Array.isArray(actions) ? actions : [];
    let found = false;

    (function walk(arr) {
        for (const st of arr) {
            if (!st || typeof st !== 'object') continue;

            if (st.disabled === true) continue;

            if (st.type === 'evidenceCapture') {
                found = true;
                return;
            }

            // common nesting patterns
            if (Array.isArray(st.actions)) walk(st.actions);
            if (Array.isArray(st.preActions)) walk(st.preActions);
            if (Array.isArray(st.elseActions)) walk(st.elseActions);
            if (Array.isArray(st.cases)) walk(st.cases);
            if (Array.isArray(st.defaultActions)) walk(st.defaultActions);

            if (found) return;
        }
    })(list);

    return found;
}

/**
 * Validates a URL and only allows http or https.
 * Returns the parsed URL instance, or throws.
 */
function validateUrlOrThrow(rawUrl) {
    if (!rawUrl) throw new Error('Missing url');
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid url: ${rawUrl}`);
    }
    const allowed = ['http:', 'https:'];
    if (!allowed.includes(parsed.protocol)) {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return parsed;
}

/**
 * Run a workflow spec to completion.
 *
 * Returns {status, payload} where status is done | cancelled | error. A
 * cancelled or failed run still carries a payload built from the partial
 * output, so scans that finished before the failure are not lost. Only a
 * failure with no partial output at all returns a null payload and `error`.
 */
/**
 * surea11y's raw result for each scan that has one, in scan order, with
 * enough of the scan to name the file it ends up in. These stay out of the
 * payload: they repeat what the canonical findings already hold.
 */
function collectCoreResults(scans) {
    return (Array.isArray(scans) ? scans : [])
        .filter((scan) => scan && scan.coreResult)
        .map((scan) => ({
            scanId: scan.scanId || scan.id || null,
            label: scan.label || null,
            url: scan.url || null,
            result: scan.coreResult
        }));
}

/**
 * Stores surea11y's baseline entries (one per failing occurrence, matched on
 * rule, reason and markup) on each scan in the payload. A later run given
 * this payload as its baseline uses them to leave known failures (and, with
 * --fail-on-lean, known likely failures) out of its SARIF and JUnit exports. They are kept in the payload, not beside it, so a
 * promoted baseline, which is a copy of the payload, carries them too.
 * payload.scans follows the order of the scans it was built from.
 */
function attachCoreBaselines(payload, scans) {
    const list = Array.isArray(scans) ? scans : [];
    const out = payload && Array.isArray(payload.scans) ? payload.scans : [];
    for (let i = 0; i < list.length && i < out.length; i += 1) {
        if (list[i] && list[i].coreResult && out[i]) {
            // With the questions that lean fail as entries of their own
            // (lean: 'fail'), which a later --fail-on-lean run matches; a
            // run without it reads only the failures' entries.
            out[i].coreBaseline = buildBaselineEntries(list[i].coreResult, { leanFail: true });
        }
    }
}

/**
 * Says the run is building its result from its scans, which on a long run
 * takes a while and holds the event loop: the queue tab shows "Saving
 * result" from here. A turn of the event loop first, so a poll can see it.
 */
async function announceResultBuild(progress) {
    if (typeof progress !== 'function') return;
    try {
        progress({ time: new Date().toISOString(), type: 'info', message: 'Building the result', extra: { stepEvent: 'result-build' } });
    } catch {
    }
    await new Promise((resolve) => setImmediate(resolve));
}

async function executeWorkflowRun(spec, hooks = {}) {
    const {
        url,
        actions,
        customSteps,
        viewport,
        colorScheme,
        highContrast,
        language,
        scenarioName,
        vars
    } = spec || {};

    const {
        progress = null,
        isCancelled = null,
        abortSignal = null,
        debugNative = false,
        keepCoreResults = false,
        spool = null,
        // The command line has checked the steps already, and said so.
        stepsChecked = false,
        // Every step but the scans, screenshots and evidence (--dry-run).
        dryRun = false,
        // Where secret references ({"$env": "NAME"}) are read from.
        env = process.env
    } = hooks;

    // The steps' check (step-check.js), before a browser opens: a workflow
    // that cannot run as written stops here, every problem listed, rather
    // than partway through. Warnings go to the log and the run goes on.
    if (!stepsChecked) {
        const say = (type, message) => {
            if (typeof progress !== 'function') return;
            try {
                progress({ time: new Date().toISOString(), type, message, depth: 0 });
            } catch {
            }
        };
        const { errors, warnings } = checkWorkflowSteps({ actions, customSteps, wording: 'steps' });
        for (const warning of warnings) say('warning', `Check: ${warning}`);
        if (errors.length) {
            // One problem is said by the result itself; several, one per line.
            if (errors.length > 1) for (const problem of errors) say('error', `Check: ${problem}`);
            return {
                status: 'error',
                payload: null,
                error: {
                    error: 'The workflow cannot run',
                    details: errors.length === 1
                        ? `The workflow cannot run: ${errors[0]}`
                        : `The workflow cannot run: ${errors.length} problems, each in the log above.`,
                },
            };
        }
    }

    // Steps to run and a web page to start on. The server and the CLI check
    // them before they get here; a caller that did not had a file: url
    // opened and scanned, or no steps run and called done.
    if (!Array.isArray(actions) || actions.length === 0) {
        return { status: 'error', payload: null, error: { error: 'The workflow cannot run', details: 'The workflow cannot run: it has no actions; define at least one (e.g. a11yScan).' } };
    }
    try {
        validateUrlOrThrow(url);
    } catch (err) {
        return { status: 'error', payload: null, error: { error: 'The workflow cannot run', details: `The workflow cannot run: ${err.message}.` } };
    }

    // Secrets named by reference ({"$env": "NAME"}) are read from this
    // process's environment now, and given to the browser only: the report
    // records the workflow as it was written, references and all.
    const secrets = resolveSecretRefs({ actions, customSteps }, env);
    if (secrets.missing.length) {
        const details = `The workflow cannot run: ${describeMissing(secrets.missing)}.`;
        return { status: 'error', payload: null, error: { error: 'The workflow cannot run', details } };
    }
    const engineActions = secrets.value.actions;
    const engineCustomSteps = secrets.value.customSteps;

    const wantReport = hasEvidenceCaptureAction(actions);

    try {
        const out = await runA11yWorkflow(url, null, {
            dryRun,
            actions: engineActions,
            customSteps: engineCustomSteps,
            viewport,
            colorScheme,
            highContrast,
            language,
            vars,
            progress,
            debugNative,
            determinism: resolveDeterminism(),
            exportReport: wantReport,
            keepCoreResults,
            spool,
            reportsSubdir: wantReport ? scenarioName : null,
            isCancelled,
            abortSignal,
        });

        const cancelled = !!out.cancelled;
        // The runner returns a failed run (a page it could not open, a step
        // that failed and was not optional) rather than throwing it. Read as
        // done, an unreachable site gave an empty report and the CLI exit 0.
        const failed = !cancelled && !!out.failed;

        await announceResultBuild(progress);
        const payload = PAYLOAD.buildWorkflowPayloadBase({
            url,
            scenarioName,
            actions,
            actionResults: out.actionResults,
            scans: out.scans,
            workflowScreenshots: out.screenshots,
            runDiagnostics: out.runDiagnostics,
            collectedOutputs: out.collectedOutputs,
            iterationFailureSummary: out.iterationFailureSummary,
            cancelled,
            failed,
            errorDetails: failed ? { message: 'Workflow failed', ...(out.error && typeof out.error === 'object' ? out.error : null) } : null,
            debugNative,
            includeScanScreenshots: true,
        });

        if (keepCoreResults) attachCoreBaselines(payload, out.scans);
        PAYLOAD.finalizeWorkflowPayload(payload);

        return {
            status: cancelled ? 'cancelled' : (failed ? 'error' : 'done'),
            payload,
            ...(keepCoreResults ? { coreResults: collectCoreResults(out.scans) } : {})
        };
    } catch (err) {
        if (err && err._wfPartialOut) {
            const partial = err._wfPartialOut;
            await announceResultBuild(progress);
            const cancelled = !!err._wfCancelled;

            const errorDetails = cancelled
                ? null
                : {
                    message: err && err.message ? err.message : String(err),
                    ...(partial.errorDetails && typeof partial.errorDetails === 'object' ? partial.errorDetails : null)
                };

            const payload = PAYLOAD.buildWorkflowPayloadBase({
                url,
                scenarioName,
                actions,
                actionResults: partial.actionResults,
                scans: partial.scans,
                workflowScreenshots: partial.screenshots,
                runDiagnostics: partial.runDiagnostics,
                collectedOutputs: partial.collectedOutputs,
                iterationFailureSummary: partial.iterationFailureSummary,
                cancelled,
                failed: !cancelled,
                errorDetails,
                debugNative,
                includeScanScreenshots: true,
            });

            if (keepCoreResults) attachCoreBaselines(payload, partial.scans);
            PAYLOAD.finalizeWorkflowPayload(payload);

            return {
                status: cancelled ? 'cancelled' : 'error',
                payload,
                ...(keepCoreResults ? { coreResults: collectCoreResults(partial.scans) } : {})
            };
        }

        return {
            status: 'error',
            payload: null,
            error: {
                error: 'Workflow scan failed',
                details: err && err.message ? err.message : String(err),
            },
        };
    }
}

module.exports = {
    PAYLOAD,
    envFlag,
    isDebugMode,
    resolveDeterminism,
    hasEvidenceCaptureAction,
    validateUrlOrThrow,
    executeWorkflowRun,
};
