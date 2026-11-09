// Running a workflow: the run's language field, checking the form, building
// the run's request, running it and following its progress, its result, the
// dry run and its report, and the offer to run again accepting a
// certificate. Moved out of a11y-ui.js; what it shares with the rest of the
// app it reaches through `app`.

import {fetchWorkflowResult, pollWorkflowUntilDone, runFailureMessage} from './a11y-ui.workflow.js';
import {parseCustomStepsJson} from './custom-steps-data.js';
import {setRunTabBadge, setRunTabSpinner} from './tab-indicators.js';
import {PROGRESS_POLL_INTERVAL_MS, STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (actionsBuilder, appendLog, batchUi, cancelButton, cfgIO, clearLogsPanel, clearResults, clearScreenshots, colorSchemeSelect, currentRunId, customStepActionsBuilder, customStepsInput, customStepsUi, dryRunButton, dryRunReportEl, formatElapsedHuman, getPlannedLiveStreamMode, highContrastSelect, languageOtherError, languageOtherField, languageOtherInput, languageSelect, lastWorkflowResponse, liveStreamDialog, liveUi, loadAndRun, resultsState, retryUntrustedButton, revealCustomStepError, runResultText, runSettings, runStartedAtMs, scanButton, scansDialog, scenarioInput, screenshotsDialog, setConfigExpanded, setRunPayload, setStatusRun, setUiState, summaryEl, untrustedCertsSelect, urlInput, useLiveStream, validateRunInputs, viewportSelect).
 */
export function createRunWorkflowUi(app) {
    /** The languages Set language lists, as the Language field's choices. */
    function fillRunLanguages(defs) {
        if (!app.languageSelect) return;
        const options = defs?.setLanguage?.fields?.language?.options;
        if (!Array.isArray(options)) return;
        const other = app.languageSelect.querySelector('option[value="other"]');
        for (const o of options) {
            if (!o || o.value === 'default') continue;
            app.languageSelect.insertBefore(new Option(String(o.label ?? o.value), String(o.value)), other);
        }
    }

    function runLanguageTags() {
        return app.languageSelect
            ? Array.from(app.languageSelect.options).map((o) => o.value).filter((v) => v && v !== 'other')
            : [];
    }

    // "Other language" shows only while "Other…" is chosen.
    function syncRunLanguageOther() {
        if (!app.languageSelect || !app.languageOtherField) return;
        const other = app.languageSelect.value === 'other';
        app.languageOtherField.hidden = !other;
        if (!other && app.languageOtherError) {
            app.languageOtherError.hidden = true;
            app.languageOtherInput?.removeAttribute('aria-invalid');
        }
    }

    /** The language the run starts in, '' for the browser's own. */
    function runLanguageValue() {
        if (!app.languageSelect) return '';
        if (app.languageSelect.value === 'other') return app.languageOtherInput ? app.languageOtherInput.value.trim() : '';
        return app.languageSelect.value;
    }

    /** Why the typed language cannot run, or ''. */
    function runLanguageProblem() {
        if (!app.languageSelect || app.languageSelect.value !== 'other') return '';
        const typed = app.languageOtherInput ? app.languageOtherInput.value.trim() : '';
        if (!typed) return 'Type a language, such as es-MX, or choose one from the list';
        if (typed.includes('{')) return '';
        try {
            if (Intl.getCanonicalLocales(typed).length === 1) return '';
        } catch {
            // not a tag
        }
        return `"${typed}" is not a language tag: use one such as es-MX, fr-CA or zh-Hant-HK`;
    }

    app.languageSelect?.addEventListener('change', () => {
        syncRunLanguageOther();
        if (app.languageSelect.value === 'other') app.languageOtherInput?.focus();
    });

    function buildRunSpecFromUi({url, actions, customSteps}) {
        const specTools = globalThis.A11Y_RUN_SPEC;
        if (!specTools) throw new Error('shared/run-spec.js must be loaded before a11y-ui.js');

        const {buildViewportFromPreset} = globalThis.A11Y_SCAN_INPUTS;

        return specTools.buildRunSpec({
            url,
            actions,
            customSteps,
            viewport: app.viewportSelect ? buildViewportFromPreset(app.viewportSelect.value) : null,
            colorScheme: app.colorSchemeSelect ? app.colorSchemeSelect.value : '',
            highContrast: app.highContrastSelect ? app.highContrastSelect.value : '',
            acceptUntrustedCerts: app.untrustedCertsSelect ? app.untrustedCertsSelect.value : '',
            language: runLanguageValue(),
            scenarioName: app.scenarioInput ? app.scenarioInput.value.trim() : '',
        });
    }

    // The run request is the spec plus grouping, which only the report uses.
    function buildWorkflowPayload({url, actions, customSteps}) {
        const spec = buildRunSpecFromUi({url, actions, customSteps});
        return {
            payload: {...spec, groupScans: true},
            viewport: spec.viewport || null
        };
    }

    /** The spec for the workflow as the form currently stands, for saving it. */
    function collectRunSpec() {
        // The spec is only built to be written into a saved config, so masked
        // values are redacted here too (and the default "object" shape, which
        // the runner cannot consume, is avoided).
        const actionsValue = app.actionsBuilder
            ? app.actionsBuilder.getValue({ maskValues: 'redact', markMasked: true, reveal: false })
            : null;
        if (!actionsValue || !actionsValue.ok) return null;

        const customStepsResult = app.customStepsUi.getCustomStepsForConfigState();

        return buildRunSpecFromUi({
            url: app.urlInput ? app.urlInput.value.trim() : '',
            actions: actionsValue.value,
            customSteps: customStepsResult && customStepsResult.ok ? customStepsResult.value : []
        });
    }

    function buildRunningMessage(actions) {
        const totalActions = Array.isArray(actions) ? actions.length : 0;
        const a11yScanCount = totalActions ? actions.filter((st) => st?.type === 'a11yScan').length : 0;

        return totalActions > 0
            ? `Running workflow scan with ${totalActions} action${totalActions === 1 ? '' : 's'}${
                a11yScanCount ? ` (${a11yScanCount} a11yScan${a11yScanCount === 1 ? '' : 's'})` : ''
            }, please wait...`
            : 'Running, please wait...';
    }

    async function runWorkflow(payload) {
        const startRes = await fetch('/workflow-start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (!startRes.ok) {
            await handleScanHttpError(startRes);
            return {ok: false, final: null};
        }

        const {runId} = await startRes.json();
        if (!runId) throw new Error('No runId returned by /workflow-start');

        app.currentRunId = runId;
        app.cancelButton.setAttribute('aria-disabled', 'false');

        app.appendLog('Live logging started...', STATUS.INFO);

        // Poll progress until terminal state
        await pollWorkflowUntilDone(runId, {
            pollIntervalMs: PROGRESS_POLL_INTERVAL_MS,
            onStatus: (s) => {
                if (s === 'cancelling') {
                    app.setUiState('cancelling', 'Cancelling... finishing current action');
                } else if (s === 'cancelled') {
                    app.setUiState('cancelled', 'Cancelled');
                } else if (s === 'done') {
                    app.setUiState('done', 'Finished');
                }
                // A failed run is said once, with its reason, when its
                // result is read (handleTerminalResult).
            },
            onProgress: (prog) => {
                if (prog && Array.isArray(prog.logs) && prog.logs.length) {
                    app.liveUi.progressProcessor.processMany(prog.logs);
                }
            }
        });

        // Get final result payload
        const final = await fetchWorkflowResult(runId);
        const finalStatus = final && typeof final.status === 'string' ? final.status : 'error';
        if (finalStatus === 'error') {
            // The log already ends with the failure and its reason (the
            // server's last lines): the status line says it, the log not again.
            const why = final?.error?.details || final?.payload?.errorDetails?.message || '';
            app.setUiState('error', why ? `Workflow failed: ${why}` : 'Workflow failed', {log: false});
        }
        return {ok: finalStatus === 'done' || finalStatus === 'cancelled', final};
    }

    async function handleTerminalResult(final, url) {
        if (final.status === 'done' && final.payload) {
            app.setRunPayload(final.payload, {url, status: 'done'});
            return;
        }

        if (final.status === 'error') {
            app.setUiState('error', 'Workflow failed: ' + (final.payload?.details || 'Unknown error'));
            return;
        }

        if (final.status === 'cancelled') {
            app.setUiState('error', 'Run cancelled.');
            app.summaryEl.textContent = 'The workflow was cancelled by the user.';
            app.setRunPayload(final.payload, {url, status: 'cancelled'});
            return;
        }

        app.setUiState('error', 'Unexpected workflow status: ' + final.status);
    }

    // A run the browser refused for a certificate it does not trust: the
    // status says so, and offers to run again accepting such certificates.
    function offerUntrustedRetry(final) {
        const details = final?.payload?.errorDetails || final?.error || null;
        const message = String((details && (details.message || details.details)) || details || '');
        if (!/net::ERR_CERT_/.test(message) || !app.untrustedCertsSelect || app.untrustedCertsSelect.value === 'on') return;
        app.setUiState('error', 'Workflow failed: the browser does not trust this site\'s certificate');
        if (app.retryUntrustedButton) app.retryUntrustedButton.hidden = false;
    }

    app.retryUntrustedButton?.addEventListener('click', () => {
        app.retryUntrustedButton.hidden = true;
        app.untrustedCertsSelect.value = 'on';
        app.untrustedCertsSelect.dispatchEvent(new Event('change', {bubbles: true}));
        app.runSettings.sync();
        app.scanButton.click();
    });

    function clearResultDialogs() {
        app.scansDialog.clearItems();
        app.screenshotsDialog.clearItems();
    }

    function clearLiveStreamDialog() {
        app.liveStreamDialog.clearItems();
    }

    /**
     * The form read and validated as one run request: what Run sends to
     * /workflow-start and Add to queue sends to /queue/items. Problems are shown
     * on the form; null means there is nothing to send.
     */
    function prepareRunRequest({markMasked = false, fallbackUrl = ''} = {}) {
        // A batch whose rows all carry a URL can leave the form's empty.
        let url = app.urlInput.value.trim() || fallbackUrl;
        if (url.length && !url.startsWith('http')) url = 'http://' + url;
        const actionsValue = app.actionsBuilder.getValue({validate: true, maskValues: 'text', markMasked});

        // Validate URL + action builder fields
        const valid = app.validateRunInputs({url, actionsValue});
        if (!valid.ok) return null;

        const actions = actionsValue.value || [];

        let customSteps = [];
        if (app.customStepActionsBuilder) {
            const customStepsResult = app.customStepsUi.readCustomStepsFromUi({validate: true});
            if (!customStepsResult.ok) {
                app.revealCustomStepError(customStepsResult.firstErrorEl);
                app.setUiState('error', customStepsResult.message || 'Custom steps are invalid.');
                return null;
            }
            customSteps = customStepsResult.value || [];
        } else {
            try {
                customSteps = parseCustomStepsJson(app.customStepsInput ? app.customStepsInput.value : '');
            } catch (e) {
                app.setUiState('error', String(e?.message || e));
                return null;
            }
        }

        const {payload} = buildWorkflowPayload({url, actions, customSteps});
        return {url, actions, customSteps, payload};
    }

    async function onRunScan(event) {
        event?.preventDefault();

        // Re-checked now: the workflow may have changed since the rows were.
        const batch = app.batchUi.batchPanel ? app.batchUi.batchPanel.check() : null;
        if (batch && batch.active) {
            await app.batchUi.runBatch(batch);
            return;
        }

        app.clearLogsPanel();
        clearResultDialogs();
        clearLiveStreamDialog();

        app.resultsState.run.payload = null;
        app.resultsState.run.meta = {};
        app.lastWorkflowResponse = null;
        setRunTabBadge(false);

        if (app.resultsState.activeMode === 'run') {
            app.clearResults();
            app.clearScreenshots();
            app.summaryEl.textContent = '';
        }

        app.liveUi.resetLivePanels();
        app.loadAndRun = false;

        const request = prepareRunRequest();
        if (!request) return;
        const {url, actions, customSteps, payload} = request;

        // The configuration as it is now, before the form can change while
        // the run goes: the report carries it, so it can be set up again
        // (docs/report-package.md).
        let runConfig = null;
        try {
            runConfig = app.cfgIO ? app.cfgIO.buildConfigFile({includeBatch: false}) : null;
        } catch (err) {
            console.error('Could not keep the configuration with the report', err);
        }

        // Decide live stream mode based on actions array
        const plan = app.getPlannedLiveStreamMode(actions);
        app.useLiveStream = !!plan.shouldStream;

        app.liveUi.startStepCounter(actions, customSteps);

        // Running UI state
        app.runStartedAtMs = performance.now();
        const runningMessage = buildRunningMessage(actions);
        app.setUiState('running', runningMessage);

        // Whether the run ended in an error, whose message the status keeps.
        let failed = false;
        try {
            const {ok, final} = await runWorkflow(payload);
            if (!ok) {
                failed = true; // handleScanHttpError already set UI message
                offerUntrustedRetry(final);
                return;
            }

            failed = !final || final.status === 'error';
            if (runConfig && final?.payload && typeof final.payload === 'object' && Array.isArray(final.payload.scans)) {
                final.payload.config = runConfig;
            }
            await handleTerminalResult(final, url);
        } catch (e) {
            // The server could not be reached, or stopped answering: the run
            // is over here, and the log says why.
            failed = true;
            app.setUiState('error', runFailureMessage(e, {started: !!app.currentRunId}));
        } finally {
            // total time log, last message
            if (typeof app.runStartedAtMs === 'number') {
                const elapsed = performance.now() - app.runStartedAtMs;
                const t = app.formatElapsedHuman(elapsed);

                // After an error the status keeps saying what went wrong.
                if (failed) app.appendLog(`Total time: ${t}`, STATUS.INFO);
                else app.setStatusRun(`${app.runResultText ? app.runResultText + ' ' : ''}Total time: ${t}`, STATUS.OK);
                app.runResultText = '';
            }

            app.runStartedAtMs = null;

            // The workflow has finished (done / cancelled / error) — hand the
            // floating scan-totals counter over to the user: its dismiss button
            // becomes active so they can close it after reviewing the totals.
            // A fresh run resets it again on start.
            app.liveUi.liveTotals?.finish?.();

            // always return to idle buttons, regardless of outcome
            app.scanButton.setAttribute('aria-disabled', 'false');
            app.cancelButton.setAttribute('aria-disabled', 'true');
            app.currentRunId = null;
            // A failed run is over too: the error state leaves the page as if
            // one were still going (the configuration pinned, its actions hidden).
            document.body.classList.remove('is-running');
            // ...unless the batch rule still holds.
            app.batchUi.refreshRunButton();
        }
    }

    /** Shows a dry run's summary (dry-run-summary.js): how each step went. */
    function renderDryRunReport(summary) {
        if (!app.dryRunReportEl) return;
        const verdictEl = app.dryRunReportEl.querySelector('.dry-run-verdict');
        const stepsEl = app.dryRunReportEl.querySelector('.dry-run-steps');
        const scansEl = app.dryRunReportEl.querySelector('.dry-run-scans');
        stepsEl.replaceChildren();
        scansEl.textContent = '';
        verdictEl.className = 'dry-run-verdict';

        if (!summary || summary.outcome !== 'finished') {
            app.dryRunReportEl.hidden = true;
            return;
        }

        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        verdictEl.textContent = summary.fits
            ? 'Every step ran: the workflow fits the site.'
            : `The workflow does not fit the site as it stands: ${plural(summary.problems, 'problem')}.`;
        verdictEl.classList.add(summary.fits ? 'fits' : 'does-not-fit');

        const STATUS_TEXT = {
            'done': 'Done',
            'failed': 'Failed',
            'failed-optional': 'Failed, optional',
            'off': 'Switched off',
            'not-run': 'Not reached',
        };
        for (const step of summary.steps) {
            const li = document.createElement('li');
            const status = document.createElement('span');
            status.className = `dry-run-status dry-run-status-${step.status}`;
            status.textContent = STATUS_TEXT[step.status] || step.status;
            const number = document.createElement('span');
            number.className = 'dry-run-number';
            number.textContent = step.number;
            li.append(status, number, document.createTextNode(step.title));
            if (step.error || step.failedAt) {
                const reason = document.createElement('span');
                reason.className = 'dry-run-reason';
                reason.textContent = `${step.failedAt ? ` (at step ${step.failedAt})` : ''}${step.error ? `: ${step.error}` : ''}`;
                li.append(reason);
            }
            if (step.notes && step.notes.length) {
                const notes = document.createElement('ul');
                notes.className = 'dry-run-notes';
                for (const note of step.notes) {
                    const item = document.createElement('li');
                    item.textContent = note;
                    notes.append(item);
                }
                li.append(notes);
            }
            stepsEl.append(li);
        }

        scansEl.textContent = `${plural(summary.scansNotRun, 'scan')} not run`
            + (summary.scansWithNothing ? `, ${summary.scansWithNothing} of them would check nothing (said under its step).` : '.')
            + (summary.loops ? ` Loops: ${summary.loops}.` : '');
        app.dryRunReportEl.hidden = false;
    }

    /**
     * Dry run: the workflow as the form stands, every step but the scans,
     * screenshots and evidence, to see that it still fits the site. With the
     * batch on, with its first workflow's URL and variables: a dry run checks
     * the steps, which every workflow of the batch shares. Leaves the report
     * of the last run as it was.
     */
    async function onDryRun() {
        const batch = app.batchUi.batchPanel ? app.batchUi.batchPanel.check() : null;
        const row = batch && batch.active && batch.state === 'ready' && Array.isArray(batch.runs) ? batch.runs[0] : null;

        app.clearLogsPanel();
        clearLiveStreamDialog();
        app.liveUi.resetLivePanels();
        if (app.dryRunReportEl) app.dryRunReportEl.hidden = true;

        const request = prepareRunRequest({fallbackUrl: row ? row.url : ''});
        if (!request) return;
        const {actions, customSteps} = request;
        const payload = {...request.payload, dryRun: true};
        if (row) {
            payload.url = row.url || payload.url;
            if (row.vars && Object.keys(row.vars).length) payload.vars = row.vars;
        }

        app.useLiveStream = false;
        app.liveUi.startStepCounter(actions, customSteps);
        app.runStartedAtMs = performance.now();
        app.setUiState('running', row
            ? `Dry run with the batch's first workflow, ${row.name}: every step but the scans, screenshots and evidence...`
            : 'Dry run: every step but the scans, screenshots and evidence...');

        try {
            const {final} = await runWorkflow(payload);
            if (!final) return; // handleScanHttpError has said why
            const summary = final.dryRun || null;
            renderDryRunReport(summary);
            document.body.classList.remove('is-running');
            if (!summary) {
                app.setUiState('error', 'Dry run failed: ' + (final.error?.details || final.status || 'no result'));
            } else if (summary.outcome === 'cancelled') {
                app.setUiState('cancelled', 'Dry run cancelled.');
            } else if (summary.outcome === 'not-started') {
                app.setUiState('error', `Dry run could not start: ${summary.startError}`);
            } else {
                app.setUiState('done', summary.fits ? 'Dry run: every step ran, the workflow fits the site.' : 'Dry run: the workflow does not fit the site as it stands.');
                if (!summary.fits) {
                    app.setStatusRun('Dry run: the workflow does not fit the site as it stands. See the dry run below.', STATUS.WARNING);
                    // The steps are what needs fixing: show them again.
                    app.setConfigExpanded(true);
                }
                app.dryRunReportEl?.scrollIntoView({block: 'nearest'});
            }
        } catch (e) {
            app.setUiState('error', runFailureMessage(e, {started: !!app.currentRunId}));
        } finally {
            if (typeof app.runStartedAtMs === 'number') {
                app.appendLog(`Total time: ${app.formatElapsedHuman(performance.now() - app.runStartedAtMs)}`, STATUS.INFO);
            }
            app.runStartedAtMs = null;
            // Its step count helped while the steps ran; its scan totals are
            // all zero in a dry run, and it would cover the dry run's report.
            app.liveUi.liveTotals.remove();
            setRunTabSpinner(false);
            app.scanButton.setAttribute('aria-disabled', 'false');
            app.dryRunButton?.setAttribute('aria-disabled', 'false');
            app.cancelButton.setAttribute('aria-disabled', 'true');
            app.currentRunId = null;
            app.batchUi.refreshRunButton();
        }
    }

    async function handleScanHttpError(response) {
        const text = await response.text();
        let statusMessage = 'Scan failed. Server responded with status ' + response.status + '.';
        try {
            const json = JSON.parse(text);
            // A refused run's problems as the builder names the steps, when given.
            const steps = json && Array.isArray(json.steps) && json.steps.length ? json.steps : null;
            if (steps || (json && (json.details || json.error))) {
                const detail = steps
                    ? (steps.length === 1 ? steps[0] : `${steps.length} problems: ${steps.join('; ')}`)
                    : (json.details || json.error);
                statusMessage = 'Scan failed (HTTP ' + response.status + '): ' + detail;
            }
        } catch {
        }

        app.setUiState('error', statusMessage);
        app.summaryEl.textContent = '';

        if (text) {
            const errorBlob = new Blob([text], {type: 'application/json'});
            const errorUrl = URL.createObjectURL(errorBlob);
            const errorLink = document.createElement('a');
            errorLink.href = errorUrl;
            errorLink.target = '_blank';
            errorLink.rel = 'noopener noreferrer';
            errorLink.textContent = 'Open error details (JSON)';
            errorLink.style.display = 'inline-block';
            errorLink.style.marginTop = '0.5rem';
            app.summaryEl.appendChild(errorLink);
        }
    }

    return {
        clearLiveStreamDialog,
        clearResultDialogs,
        collectRunSpec,
        fillRunLanguages,
        onDryRun,
        onRunScan,
        prepareRunRequest,
        runLanguageProblem,
        runLanguageTags,
        syncRunLanguageOther,
    };
}
