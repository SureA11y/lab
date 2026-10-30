// The Batch section: the workflow once per row of a list, run here or sent
// to the queue, and the Run button while a batch holds it. Moved out of
// a11y-ui.js; what it shares with the rest of the app it reaches through
// `app`.

import {createBatchPanel, runLabelFor} from './batch-panel.js';
import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * ($, actionsBuilder, cfgIO, currentRunId, customStepActionsBuilder, getCustomStepsForConfigState, prepareRunRequest, runQueueUi, scanButton, scenarioInput, setStatusRun, tabsmode, urlInput).
 */
export function createBatchUi(app) {
    /** The form's URL and workflow as they stand, for checking batch rows against. */
    function getWorkflowForBatch() {
        let url = app.urlInput.value.trim();
        if (url.length && !url.startsWith('http')) url = 'http://' + url;
        const actionsValue = app.actionsBuilder ? app.actionsBuilder.getValue({validate: false, maskValues: 'redact'}) : null;
        const customStepsResult = app.getCustomStepsForConfigState();
        return {
            url,
            workflow: {
                actions: actionsValue && actionsValue.ok ? actionsValue.value : [],
                customSteps: customStepsResult && customStepsResult.ok ? customStepsResult.value : [],
            },
        };
    }

    /**
     * One queue item per row: the form's workflow with the row's URL, name and
     * vars. Each item's saved config is that one row, so a resumed or reloaded
     * run is the row it came from.
     */
    async function onQueueBatch(runs) {
        if (!app.runQueueUi.queuePanel) return false;
        const request = app.prepareRunRequest({markMasked: true, fallbackUrl: runs[0]?.url || ''});
        if (!request) return false;

        let baseConfig = null;
        // The batch's own configuration, Batch section and all: kept beside
        // its results, so its download sets the batch up again.
        let batchConfig = null;
        try {
            baseConfig = app.cfgIO ? app.cfgIO.buildConfigFile({includeBatch: false}) : null;
            batchConfig = app.cfgIO ? app.cfgIO.buildConfigFile({includeBatch: true}) : null;
        } catch (err) {
            console.error('Could not build the config for the queue', err);
        }

        const items = runs.map((r) => {
            const vars = r.vars && Object.keys(r.vars).length ? r.vars : undefined;
            const run = {...request.payload, url: r.url, scenarioName: r.name, vars};
            const config = baseConfig && {
                ...baseConfig,
                url: r.url,
                state: {...baseConfig.state, 'url-input': r.url, 'scenario-name': r.name},
                runSpec: baseConfig.runSpec && {...baseConfig.runSpec, url: r.url, scenarioName: r.name, ...(vars ? {vars} : {})},
            };
            return {run, config, row: r.row};
        });

        try {
            await app.runQueueUi.queuePanel.add(items, {name: app.scenarioInput ? app.scenarioInput.value.trim() : '', config: batchConfig});
            app.setStatusRun(`Queued a batch of ${items.length} run${items.length === 1 ? '' : 's'}.`, STATUS.OK);
            return true;
        } catch (err) {
            app.setStatusRun(`Could not add the batch to the queue: ${String(err?.message || err)}`, STATUS.ERROR);
            return false;
        }
    }

    /** Run says what it will do: run the workflow once, or run the batch. */
    function onBatchStatus(status) {
        refreshRunButton(status);
        // While the batch is on, a step that would hide a row variable is a
        // field error in the step editors; off, those names are ordinary.
        const names = status.active ? status.varNames : [];
        app.actionsBuilder?.setReservedVariableNames?.(names);
        app.customStepActionsBuilder?.setReservedVariableNames?.(names);
    }

    const BATCH_BUSY = 'A batch is already running. Wait for it to finish, or cancel it, before running another.';

    /**
     * Run says what it will do, and with the batch on it waits while another
     * batch runs (one batch per folder). A single run from the form is never
     * blocked by the queue. While a single run is going, setUiState owns the
     * button's disabled state; this only adds or lifts the batch block.
     */
    function refreshRunButton(status = batchPanel?.getStatus()) {
        if (!app.scanButton) return;
        const blocked = !!(status && status.active && app.runQueueUi.queueBusy);
        app.scanButton.textContent = blocked ? 'Run batch (another batch is running)' : (runLabelFor(status) || 'Run');
        if (app.currentRunId) return;
        if (blocked) {
            app.scanButton.setAttribute('aria-disabled', 'true');
            app.scanButton.dataset.blockedReason = BATCH_BUSY;
        } else if (app.scanButton.dataset.blockedReason) {
            app.scanButton.setAttribute('aria-disabled', 'false');
            delete app.scanButton.dataset.blockedReason;
        }
    }

    /**
     * Run with the batch on: queue one run per row and go to the queue tab. A
     * batch cannot show N reports on this page, so it always goes through the
     * queue, where each result is saved.
     */
    async function runBatch(status) {
        if (app.runQueueUi.queueBusy) {
            app.setStatusRun(BATCH_BUSY, STATUS.ERROR);
            return;
        }
        if (status.state !== 'ready') {
            batchPanel.reveal();
            app.setStatusRun(status.state === 'empty'
                ? 'Paste the workflows in the Batch section, or disable the batch to run the workflow once.'
                : `The batch has ${status.problems.length} problem${status.problems.length === 1 ? '' : 's'}, listed under its workflows.`, STATUS.ERROR);
            return;
        }
        if (await onQueueBatch(status.runs)) {
            batchPanel.noteQueued(status.runs.length);
            app.tabsmode?.setActive('queue');
        }
    }

    const batchRowsEl = app.$('#batch-rows');
    const batchPanel = batchRowsEl ? createBatchPanel({
        toggle: app.$('#batch-toggle'),
        content: app.$('#batch-content'),
        badge: app.$('#batch-count-badge'),
        useButton: app.$('#batch-use'),
        rowsInput: batchRowsEl,
        namePatternInput: app.$('#batch-name-pattern'),
        fileButton: app.$('#batch-file-btn'),
        fileInput: app.$('#batch-file'),
        checkEl: app.$('#batch-check'),
        problemsEl: app.$('#batch-problems'),
        getWorkflow: getWorkflowForBatch,
        onChange: onBatchStatus,
    }) : null;

    return {
        get batchPanel() { return batchPanel; },
        refreshRunButton,
        runBatch,
    };
}
