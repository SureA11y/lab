import {createActionsBuilder, redactMaskedFieldsDeep, withPasswordStepTypeDeep} from './actions-builder.module.js';
import {createEl, escapeAttr, escapeHtml, iconButton, indentPrefix, jsonBlob, linkifyUrlsToHtml, safeBaseName, scanTagChipsHtml, svgIcon} from './a11y-ui.utils.js';
import {fetchWorkflowResult, pollWorkflowUntilDone, runFailureMessage} from './a11y-ui.workflow.js';
import {setupRunSettings} from './run-settings.js';
import {createConfigIO} from './config-io.js';
import {createRunSummaryRenderer} from './a11y-ui.run-summary.js';
import {setupModeSwitch} from './tabs-ui.js';
import {createBatchPanel, runLabelFor} from './batch-panel.js';
import {collectScanTags, makeTagFilter, scanMatchesTagFilter, applyScanTagsEdit} from './scan-tag-filter.js';
import {createAdvancedDialog} from './advanced-dialog.js';
import {setupRulesCatalogDialog} from './rules-catalog-dialog.module.js';
import {installInPageLinks} from './in-page-links.js';
import {installBackToTop} from './back-to-top.js';
import {setWhenReportDrawn} from './export.js';
import {readCompareZip} from './comparison-bundle.js';
import {afterPaint, isBusy, runBusy, setBusy} from './busy.js';
import {getActivity} from './activity.js';
import {clearLazyBodies, setLazyScope} from './lazy-dialogs.js';
import {attachFileDrop} from './file-drop.js';
import {cleanGroupingItem} from './grouping-spec.js';
import {buildGlobalSummary, ensureScanSummaryCounts, ensureScansIncludedFlag, getA11yGlobalFindings, hashHex16, normalizePayloadForUi, pickMetricDefsFromPayload, pickMetricDefsFromStaged, prepareDataForReport, sortByOrderKey, stripVolatileKeysDeep, validateReportOrThrow} from './report-data.js';
import {buildActionTreeNodes, buildCustomStepMaps, collapseLineIfExpanded, expandLineIfCollapsed, focusLineForNavigation, initSectionEndToggles, resolveLineByPathFromContainer, setupCollapseAllStepsButton} from './action-tree.js';
import {cloneCustomStepValue, collectUsedCustomStepIds, customStepTabId, deepRemapCustomStepIds, formatCustomStepInputsText, makeUniqueImportedId, normalizeCustomStepInputs, parseCustomStepInputsText, parseCustomStepsJson} from './custom-steps-data.js';
import {setRunTabBadge, setRunTabSpinner} from './tab-indicators.js';
import {focusSafely, getFirstFocusable, isActuallyFocusable, isFocusable, shouldIgnoreGlobalUndoRedo} from './focus-utils.js';
import {STATUS, PROGRESS_POLL_INTERVAL_MS, TAB_MODE_STORAGE_KEY} from './ui-constants.js';
import {createQueueRunWatch} from './queue-run-watch.js';
import {createCompareTab} from './compare-tab.js';
import {createGroupingUi} from './grouping-ui.js';
import {createScreenshotsUi} from './screenshots-ui.js';
import {createRunQueueUi} from './run-queue-ui.js';
import {createLiveUi} from './live-ui.js';
import {createRunSummaryUi} from './run-summary-ui.js';
import {createPageEvents} from './page-events.js';
import {createReportView} from './report-view.js';

function getStoredActiveMode() {
    try {
        const value = localStorage.getItem(TAB_MODE_STORAGE_KEY);
        return (value === 'report' || value === 'compare' || value === 'queue') ? value : 'run';
    } catch {
        return 'run';
    }
}

function storeActiveMode(mode) {
    try {
        const m = (mode === 'report' || mode === 'compare' || mode === 'queue') ? mode : 'run';
        localStorage.setItem(TAB_MODE_STORAGE_KEY, m);
    } catch {
        // ignore storage errors
    }
}
/* ==================== Module scope ==================== */

(function () {
    /* ---------- DOM helpers ---------- */
    // What the parts of the app moved into modules of their own reach of
    // the rest: accessors, so they read and set the values as they are.
    const app = {
        get fetchJson() { return runQueueUi.fetchJson; },
        get openQueuedResult() { return runQueueUi.openQueuedResult; },
        get queuePanel() { return runQueueUi.queuePanel; },
        get buildExportPayload() { return reportView.buildExportPayload; },
        get compareActionsEl() { return compareActionsEl; },
        get compareClearBtn() { return compareClearBtn; },
        get compareContextDesc() { return compareContextDesc; },
        get compareContextSeg() { return compareContextSeg; },
        get compareDocEl() { return compareDocEl; },
        get compareInput() { return compareInput; },
        get compareLoadBtn() { return compareLoadBtn; },
        get compareOrderNote() { return compareOrderNote; },
        get compareReportsEl() { return compareReportsEl; },
        get compareStatusEl() { return compareStatusEl; },
        get getActiveBucket() { return getActiveBucket; },
        get getCurrentReportName() { return reportView.getCurrentReportName; },
        get isZipFile() { return isZipFile; },
        get reportFilesLoadBtn() { return reportFilesLoadBtn; },
        get reportMetaRow() { return reportView.reportMetaRow; },
        get resultsState() { return resultsState; },
        get runComparisonEl() { return runComparisonEl; },
        get setStatusReport() { return setStatusReport; },
        get setStatusRun() { return setStatusRun; },
        get stageReportFiles() { return stageReportFiles; },
        get tabsmode() { return tabsmode; },
        get groupingFileInput() { return groupingFileInput; },
        get renderActiveBucket() { return renderActiveBucket; },
        get renderer() { return screenshotsUi.renderer; },
        get updateResults() { return updateResults; },
        get getScanTagSuggestions() { return getScanTagSuggestions; },
        get liveStreamDialog() { return liveStreamDialog; },
        get moveScan() { return moveScan; },
        get renameScan() { return renameScan; },
        get results() { return results; },
        get scansDialog() { return scansDialog; },
        get screenshots() { return screenshots; },
        get screenshotsDialog() { return screenshotsDialog; },
        get summaryEl() { return summaryEl; },
        get toggleScanIncludedInReport() { return toggleScanIncludedInReport; },
        get updateScanTags() { return updateScanTags; },
        get $() { return $; },
        get afterConfigLoaded() { return afterConfigLoaded; },
        set afterConfigLoaded(value) { afterConfigLoaded = value; },
        get batchPanel() { return batchPanel; },
        get cfgIO() { return cfgIO; },
        set cfgIO(value) { cfgIO = value; },
        get compareTab() { return compareTab; },
        get focusReportArea() { return focusReportArea; },
        get getWorkflowWithPasswords() { return getWorkflowWithPasswords; },
        get queueRunWatch() { return queueRunWatch; },
        get refreshRunButton() { return refreshRunButton; },
        get setReportPayload() { return setReportPayload; },
        get setSectionsState() { return setSectionsState; },
        get whenResultsComplete() { return reportView.whenResultsComplete; },
        get $$() { return $$; },
        get appendLog() { return appendLog; },
        get customStepsInput() { return customStepsInput; },
        get groupingUi() { return groupingUi; },
        get liveStreamEl() { return liveStreamEl; },
        get useLiveStream() { return useLiveStream; },
        set useLiveStream(value) { useLiveStream = value; },
        get buildScanTagChipsHtml() { return reportView.buildScanTagChipsHtml; },
        get buildSummaryControlsHtml() { return buildSummaryControlsHtml; },
        get isScanIncludedInReport() { return isScanIncludedInReport; },
        get runResultText() { return runResultText; },
        set runResultText(value) { runResultText = value; },
        get runResultToStatus() { return runResultToStatus; },
        set runResultToStatus(value) { runResultToStatus = value; },
        get scanMatchesActiveTagFilter() { return scanMatchesActiveTagFilter; },
        get appendConfigFileEl() { return appendConfigFileEl; },
        get cancelButton() { return cancelButton; },
        get configFileEl() { return configFileEl; },
        get configFileSplitBtnSlot() { return configFileSplitBtnSlot; },
        get currentRunId() { return currentRunId; },
        set currentRunId(value) { currentRunId = value; },
        get dryRunButton() { return dryRunButton; },
        get form() { return form; },
        get loadAndRun() { return loadAndRun; },
        set loadAndRun(value) { loadAndRun = value; },
        get onDryRun() { return onDryRun; },
        get onRunScan() { return onRunScan; },
        get scanButton() { return scanButton; },
        get setUiState() { return setUiState; },
        get urlInput() { return urlInput; },
        get SCANS_FIRST_BATCH() { return SCANS_FIRST_BATCH; },
        get SCANS_PER_BATCH() { return SCANS_PER_BATCH; },
        get activeTagFilter() { return activeTagFilter; },
        set activeTagFilter(value) { activeTagFilter = value; },
        get activeTagSelection() { return activeTagSelection; },
        set activeTagSelection(value) { activeTagSelection = value; },
        get applyScanPresentationMode() { return applyScanPresentationMode; },
        get applyScanSort() { return applyScanSort; },
        get clearActiveBucketState() { return clearActiveBucketState; },
        get clearLiveStreamDialog() { return clearLiveStreamDialog; },
        get clearRenderedResultsUi() { return clearRenderedResultsUi; },
        get clearResults() { return clearResults; },
        get clearScreenshots() { return clearScreenshots; },
        get drawScansInBatches() { return drawScansInBatches; },
        set drawScansInBatches(value) { drawScansInBatches = value; },
        get focusRuntimeArea() { return focusRuntimeArea; },
        get lastPromptedScenarioByMode() { return lastPromptedScenarioByMode; },
        get lastScanPresentationValue() { return lastScanPresentationValue; },
        set lastScanPresentationValue(value) { lastScanPresentationValue = value; },
        get lastSummaryReportValue() { return lastSummaryReportValue; },
        set lastSummaryReportValue(value) { lastSummaryReportValue = value; },
        get lastWorkflowResponse() { return lastWorkflowResponse; },
        set lastWorkflowResponse(value) { lastWorkflowResponse = value; },
        get liveUi() { return liveUi; },
        get pendingScanDraw() { return pendingScanDraw; },
        set pendingScanDraw(value) { pendingScanDraw = value; },
        get recomputeDerivedReportData() { return recomputeDerivedReportData; },
        get reportDataContainer() { return reportDataContainer; },
        get reportEditMode() { return reportEditMode; },
        set reportEditMode(value) { reportEditMode = value; },
        get reportMetaEditors() { return reportMetaEditors; },
        set reportMetaEditors(value) { reportMetaEditors = value; },
        get resultsCompleteWaiters() { return resultsCompleteWaiters; },
        set resultsCompleteWaiters(value) { resultsCompleteWaiters = value; },
        get resultsContainer() { return resultsContainer; },
        get resultsFileBtn() { return resultsFileBtn; },
        get runSummary() { return runSummary; },
        get runSummaryUi() { return runSummaryUi; },
        get scanTagFilterEl() { return scanTagFilterEl; },
        get scenarioInput() { return scenarioInput; },
        get screenshotsContainer() { return screenshotsContainer; },
        get screenshotsUi() { return screenshotsUi; },
    };

    // The report's view (report-view.js): only functions, made first, as the
    // boot below already draws with them.
    const reportView = createReportView(app);

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /* ---------- DOM refs ---------- */
    const form = $('#scan-form');
    const urlInput = $('#url-input');
    const urlInputHint = $('#url-error-hint');
    const rulesCatalog = setupRulesCatalogDialog({STATUS});
    const viewportSelect = $('#viewport-preset');
    // How the page is shown as the run starts, beside the viewport.
    const colorSchemeSelect = $('#run-color-scheme');
    const highContrastSelect = $('#run-high-contrast');
    const untrustedCertsSelect = $('#run-untrusted-certs');
    // The run settings' dialog, and a chip beside the URL for each one changed.
    const runSettings = setupRunSettings();
    const retryUntrustedButton = $('#retry-untrusted-certs');
    const languageSelect = $('#run-language');
    const languageOtherField = $('#run-language-other-field');
    const languageOtherInput = $('#run-language-other');
    const languageOtherError = $('#run-language-other-error');
    const scanButton = $('#scan-button');
    const cancelButton = $('#cancel-button');
    const dryRunButton = $('#dry-run-button');
    const dryRunReportEl = $('#dry-run-report');
    // Set once the actions builder is ready (see setupActionsBuilder below); the
    // queue reloads saved workflows through them.
    let cfgIO = null;
    let afterConfigLoaded = () => {};
    const statusRunEl = $('#statusRun');
    const statusReportEl = $('#statusReport');
    const summaryEl = $('#summary');
    const logsPanelEl = $('#log-panel');
    const logToolbarEl = $('#log-panel-toolbar');
    const logCopyLastBtn = $('#log-copy-last-btn');
    const logCopyAllBtn = $('#log-copy-all-btn');
    const scenarioInput = $('#scenario-name');
    const customStepsInput = $('#custom-steps-json');
    const customStepsCountBadgeEl = $('#custom-steps-count-badge');
    const customStepsListEl = $('#custom-steps-list');
    const customStepsPanelEl = $('#custom-steps-tabpanel');
    let customStepsListActionsEl = $('#custom-steps-list-actions');
    const customStepPasteBtn = $('#custom-step-paste-btn');
    const customStepAddBtn = $('#custom-step-add-btn');
    const customStepCopyBtn = $('#custom-step-copy-btn');
    const customStepDeleteBtn = $('#custom-step-delete-btn');
    const customStepIdInput = $('#custom-step-id');
    const customStepNameInput = $('#custom-step-name');
    const customStepInputsTextarea = $('#custom-step-inputs');
    const customStepToolbarEl = $('#custom-step-toolbar');
    const customStepActionsEl = $('#custom-step-actions-container');
    const customStepActionsBuilderEl = $('#custom-step-actions-builder');
    const results = $('#results');
    const resultsContainer = $('#results-container');
    const scanTagFilterEl = $('#scan-tag-filter');
    const runComparisonEl = $('#run-comparison');
    const compareContextSeg = $('#compare-context-seg');
    const compareContextDesc = $('#compare-context-desc');
    const compareLoadBtn = $('#compare-load');
    const compareInput = $('#compare-input');
    const compareReportsEl = $('#compare-reports');
    const compareClearBtn = $('#compare-clear');
    const compareOrderNote = $('#compare-order-note');
    const compareStatusEl = $('#compare-status');
    const compareDocEl = $('#compare-doc');
    const compareActionsEl = $('#compare-actions');

    // Live selection for the per-scan tag filter (a view lens over the report).
    // Kept as a raw {tags:[], untagged, mode} selection plus a derived matcher;
    // empty selection means "no filter" so everything shows. `mode` is the
    // combinator across selected tags - 'or' (default, widen) or 'and' (narrow).
    let activeTagSelection = { tags: [], untagged: false, mode: 'or' };
    let activeTagFilter = makeTagFilter(activeTagSelection);

    function scanMatchesActiveTagFilter(scan) {
        return scanMatchesTagFilter(scan, activeTagFilter);
    }
    const screenshots = $('#screenshots');
    const screenshotsContainer = $('#screenshots-container');
    const actionsToolbarBottom = $('#toolbar');
    const actionsBar = $('#actionsContainer');
    const configFileSplitBtnSlot = $('#config-file-split-btn-slot');
    const configFileEl = $('#config-file');
    const appendConfigFileEl = $('#append-config-file');
    const resultsFileInput = $('#resultsFiles');
    const resultsFileBtn = $('#results-file-btn');
    const reportFilesStagingEl = $('#report-files-staging');
    const reportFilesListEl = $('#report-files-list');
    const reportFilesCountEl = $('#report-files-count');
    const reportFilesLoadBtn = $('#report-files-load-btn');
    const reportFilesClearBtn = $('#report-files-clear-btn');
    const groupingFileBtn = $('#grouping-file-btn');
    const groupingFileInput = $('#groupingFile');
    const groupingScanFileBtn = $('#grouping-scan-file-btn');
    // Config collapse UI refs
    const configToggleDisableActionBtn = $('#config-toggle');
    const configContentEl = $('#config-content');
    const customStepsToggleBtn = $('#custom-steps-toggle');
    const customStepsContentEl = $('#custom-steps-content');
    const customStepActionsCollapseAllBtn = $('#custom-step-actions-collapse-all-toggle');
    const workflowToggleBtn = $('#workflow-toggle');
    const workflowContentEl = $('#workflow-content');
    const workflowCollapseAllBtn = $('#workflow-collapse-all-toggle');
    const stepTreeOpenBtn = $('#step-tree-open-btn');
    const stepTreeDialogEl = $('#step-tree-dialog');
    const stepTreeCloseBtn = $('#step-tree-close-btn');
    const stepTreeContainerEl = $('#step-tree-container');
    const liveStreamEl = $('#live-stream');
    const reportDataContainer = $('#report-data');
    const historyManagementButtonsContainer = $('#history-management');
    const customStepActionsHistoryContainer = $('#custom-step-actions-history-management');
    const customStepsListHistoryContainer = $('#custom-steps-history-management');

    const liveStreamDialog = createAdvancedDialog({
        initialItems: [],
        initialIndex: 0,
        labels: {
            // optional overrides
            // prevLabel: 'Previous screenshot',
            // nextLabel: 'Next screenshot',
            // noPrev: 'No previous screenshots',
            // noNext: 'No next screenshots',
            // positionLabel: (i, n) => `Screenshot ${i} of ${n}`
        },
        options: {
            paged: true
        }
    });
    const scansDialog = createAdvancedDialog({
        initialItems: [],
        initialIndex: 0,
        labels: {},
        options: {
            paged: true
        }
    });
    const screenshotsDialog = createAdvancedDialog({
        initialItems: [],
        initialIndex: 0,
        labels: {},
        options: {
            paged: true
        }
    });

    /* ---------- State ---------- */
    let lastFocused = null;
    let gallery = [];
    let currentIndex = -1;
    let currentRunId = null;
    let runStartedAtMs = null;

    // Results buckets + active mode
    // What the results area shows: which tab's results, which payload and
    // grouping, so returning to a tab need not draw them again. Forgotten
    // whenever the area is cleared (clearResults).
    let resultsRenderedFor = null;

    const resultsState = {
        activeMode: 'run', // 'run' | 'report'
        run: {payload: null, meta: {}},
        report: {payload: null, meta: {}}
    };
    let reportEditMode = false;

    // The editors mounted onto the current report metadata line, kept so a
    // repaint can hand focus back to the control the user came from.
    let reportMetaEditors = null;
    let lastSummaryReportValue = 'true';

    // The results toolbar is rebuilt from scratch on every render - an engine
    // change, a scan edit, a tab switch - so the presentation mode has to be
    // remembered out here. Left on the select alone it snapped back to
    // "Findings" under the user whenever anything else in the bar was touched.
    let lastScanPresentationValue = 'evidence';

    const SCAN_PRESENTATION_MODES = ['analysis', 'evidence', 'failures'];

    // Per results bucket, the scenario name the report-name dialog was last
    // seeded with. The dialog offers the scenario name, but a name the user
    // typed over it has to survive the next export - so the scenario only takes
    // the field back once it is itself a different name. `null` means "never
    // offered here", which is what a fresh run starts from.
    const lastPromptedScenarioByMode = { run: null, report: null };

    function applyScanPresentationMode(value) {
        const mode = SCAN_PRESENTATION_MODES.includes(value) ? value : 'evidence';

        lastScanPresentationValue = mode;

        // "Failures only" is "Findings" narrowed further, so it keeps the
        // evidence class and adds its own on top.
        document.body.classList.toggle('evidence-mode', mode !== 'analysis');
        document.body.classList.toggle('failures-mode', mode === 'failures');
        document.body.classList.toggle('analysis-mode', mode === 'analysis');

        return mode;
    }

    // Set when a run finishes: the next summary written for it gives its
    // result (runResultText) to the run status's last message ("Finished: 6
    // failures in 7 elements, across 1 scan. Total time: 3 seconds"), which a
    // screen reader announces. The summary itself is not a live region: it
    // arrives with its controls inside a container that was hidden.
    let runResultToStatus = false;
    let runResultText = '';

    function getActiveBucket() {
        return resultsState.activeMode === 'report' ? resultsState.report : resultsState.run;
    }

    // Bumped by every draw of the results area, so a draw a tab click put off
    // until after a paint is dropped once another one has happened.
    let resultsRenderSeq = 0;

    // A long report's scans are drawn a few at a time (drawRemainingScans).
    const SCANS_FIRST_BATCH = 4;
    const SCANS_PER_BATCH = 4;

    // The draw whose scans are still being added (null once they all are, or
    // once the area is cleared); and who waits for them to be (the export).
    let pendingScanDraw = null;
    let resultsCompleteWaiters = [];
    // Whether the draw under way may add its scans in batches: read before
    // the area is cleared, which scrolls a page that was down back up.
    let drawScansInBatches = true;

    /**
     * Until a put-off draw starts: the results the area holds belong to the
     * other tab, so they make way for a busy note. Hiding them is cheap next
     * to drawing, and lets the click be seen at once.
     */
    function showResultsPending() {
        resultsContainer.classList.add('results-pending');
        let note = resultsContainer.querySelector(':scope > .results-pending-note');
        if (!note) {
            note = document.createElement('p');
            note.className = 'results-pending-note status busy';
            resultsContainer.prepend(note);
        }
        note.textContent = resultsState.activeMode === 'report' ? 'Loading the report…' : 'Loading the run results…';
        resultsContainer.setAttribute('aria-busy', 'true');
        resultsContainer.style.display = '';
    }

    function clearResultsPending() {
        resultsContainer.classList.remove('results-pending');
        resultsContainer.removeAttribute('aria-busy');
        resultsContainer.querySelector(':scope > .results-pending-note')?.remove();
    }

    /**
     * Runs a change that redraws part of the results (grouping, engine, a
     * scan in or out of the summary) with the results marked as updating and
     * `control` busy, after a frame to show it: for a large report the redraw
     * takes seconds, and the control that started it used to just look stuck.
     */
    async function updateResults(control, work) {
        resultsContainer.classList.add('results-updating');
        resultsContainer.setAttribute('aria-busy', 'true');
        try {
            if (control) return await runBusy(control, work);
            await afterPaint();
            return await work();
        } finally {
            resultsContainer.classList.remove('results-updating');
            resultsContainer.removeAttribute('aria-busy');
        }
    }

    // The results a tab left, set aside so coming back puts them back instead
    // of drawing them again: one per tab, used only if what they were drawn
    // from is unchanged (resultsViewKey).
    const parkedResults = {run: null, report: null};

    function bucketFor(mode) {
        return mode === 'report' ? resultsState.report : resultsState.run;
    }

    /** Everything a tab's drawn results depend on. */
    function resultsViewKey(mode) {
        return {
            mode,
            payload: bucketFor(mode).payload,
            grouping: groupingUi.getSelectedBuiltInGroupingId(mode),
            tags: JSON.stringify(activeTagSelection),
            sort: activeScanSort,
            summary: lastSummaryReportValue,
        };
    }

    function sameResultsView(a, b) {
        return Object.keys(a).every((k) => a[k] === b[k]);
    }

    function resultsSlots() {
        return new Set([reportDataContainer, scanTagFilterEl, summaryEl, results,
            resultsContainer.querySelector(':scope > .results-header-row')]);
    }

    /** Moves the results on screen aside for their tab, if they are still current. */
    function parkRenderedResults() {
        const owner = resultsRenderedFor;
        if (!owner || owner.payload !== bucketFor(owner.mode).payload) return;
        // Not all drawn yet: set aside, it would come back without its last scans.
        if (pendingScanDraw) return;
        resultsRenderedFor = null;

        const take = (el) => {
            const fragment = document.createDocumentFragment();
            while (el.firstChild) fragment.append(el.firstChild);
            return fragment;
        };
        const slots = resultsSlots();
        const isExtra = (node) => node.nodeType === Node.ELEMENT_NODE && !slots.has(node)
            && !node.classList.contains('results-pending-note');
        const order = [...resultsContainer.childNodes].filter((node) => !node.classList?.contains('results-pending-note'));
        parkedResults[owner.mode] = {
            key: resultsViewKey(owner.mode),
            order,
            reportData: take(reportDataContainer),
            tagFilter: take(scanTagFilterEl),
            tagFilterHidden: scanTagFilterEl.hidden,
            summary: take(summaryEl),
            results: take(results),
            screenshots: take(screenshots),
            containerClass: resultsContainer.className,
            containerDisplay: resultsContainer.style.display,
            screenshotsDisplay: screenshotsContainer.style.display,
            scanItems: scansDialog.getItems().slice(),
            screenshotItems: screenshotsDialog.getItems().slice(),
            lastWorkflowResponse,
            reportMetaEditors,
        };
        // Panels beside the slots (run diagnostics, collected metadata) are
        // this tab's too.
        order.filter(isExtra).forEach((el) => el.remove());
    }

    /** Puts a tab's set-aside results back, if they are still current. */
    function restoreParkedResults(mode) {
        const parked = parkedResults[mode];
        parkedResults[mode] = null;
        if (!parked || !sameResultsView(parked.key, resultsViewKey(mode))) return false;

        clearRenderedResultsUi();
        const slots = resultsSlots();
        [...resultsContainer.children]
            .filter((el) => !slots.has(el) && !el.classList.contains('results-pending-note'))
            .forEach((el) => el.remove());
        parked.order.forEach((el) => resultsContainer.append(el));

        reportDataContainer.append(parked.reportData);
        scanTagFilterEl.append(parked.tagFilter);
        scanTagFilterEl.hidden = parked.tagFilterHidden;
        summaryEl.append(parked.summary);
        results.append(parked.results);
        screenshots.append(parked.screenshots);
        resultsContainer.className = parked.containerClass;
        resultsContainer.style.display = parked.containerDisplay;
        screenshotsContainer.style.display = parked.screenshotsDisplay;
        parked.scanItems.forEach((item) => scansDialog.addItem(item));
        parked.screenshotItems.forEach((item) => screenshotsDialog.addItem(item));
        lastWorkflowResponse = parked.lastWorkflowResponse;
        reportMetaEditors = parked.reportMetaEditors;
        resultsRenderedFor = {mode, payload: parked.key.payload, grouping: parked.key.grouping};
        setLazyScope(mode);
        return true;
    }

    function setActiveMode(mode, {deferRender = false} = {}) {
        resultsState.activeMode = mode === 'report' ? 'report' : 'run';

        storeActiveMode(resultsState.activeMode);

        if (resultsState.activeMode === 'run') {
            setRunTabBadge(false);
        }

        let selected = groupingUi.findBuiltInGroupingById(
            groupingUi.getSelectedBuiltInGroupingId(resultsState.activeMode),
            resultsState.activeMode
        );

        if (!selected) {
            const fallbackId = groupingUi.getLastResolvedGroupingSelectionId(resultsState.activeMode) || 'none';
            groupingUi.setSelectedBuiltInGroupingId(fallbackId, resultsState.activeMode);
            selected = groupingUi.findBuiltInGroupingById(fallbackId, resultsState.activeMode) || groupingUi.findBuiltInGroupingById('none', resultsState.activeMode);
        }

        if (!selected || selected.id === 'custom' || !selected.groups) {
            screenshotsUi.renderer.setIssueGroupingSpec(null);
        } else {
            screenshotsUi.renderer.setIssueGroupingSpec(selected.groups);
        }

        // Coming back to a tab whose results are already on screen: drawing
        // them again takes seconds for a large report and changes nothing.
        if (resultsRenderedFor
            && resultsRenderedFor.mode === resultsState.activeMode
            && resultsRenderedFor.payload === getActiveBucket().payload
            && resultsRenderedFor.grouping === selected?.id) {
            resultsRenderSeq += 1;
            clearResultsPending();
            return;
        }

        // The area holds the other tab's results: set them aside for the way
        // back, and put this tab's back if they are still current.
        if (resultsRenderedFor && resultsRenderedFor.mode !== resultsState.activeMode) parkRenderedResults();
        if (restoreParkedResults(resultsState.activeMode)) {
            resultsRenderSeq += 1;
            clearResultsPending();
            return;
        }

        // Nothing to draw is quick: the other tab's results are only taken
        // away, which costs less than hiding them would.
        if (!deferRender || !getActiveBucket().payload) {
            renderActiveBucket();
            return;
        }

        // A tab click: show that it took before the seconds a large report
        // takes to draw. A later click, or any other draw, supersedes this one.
        const seq = ++resultsRenderSeq;
        showResultsPending();
        afterPaint().then(() => {
            if (seq === resultsRenderSeq) renderActiveBucket();
        });
    }

    /** Remembers which scan control (if any) currently has focus, so it can be restored after a re-render. */
    function captureScanControlFocus() {
        const active = document.activeElement;
        if (!active || typeof active.closest !== 'function') return null;

        const btn = active.closest('[data-scan-action][data-scan-id]');
        if (!btn) return null;

        return {
            scanAction: btn.dataset.scanAction,
            scanId: btn.dataset.scanId,
            inSummary: !!summaryEl && summaryEl.contains(btn)
        };
    }

    /** Restores focus to the equivalent control after a re-render, falling back to any other enabled control for the same scan. */
    function restoreScanControlFocus(info) {
        if (!info || !info.scanId) return;

        const root = info.inSummary ? summaryEl : results;
        if (!root) return;

        const idSel = CSS.escape(info.scanId);
        const preferred = root.querySelector(`[data-scan-action="${info.scanAction}"][data-scan-id="${idSel}"]`);
        const others = Array.from(root.querySelectorAll(`[data-scan-action][data-scan-id="${idSel}"]`));
        const candidates = preferred ? [preferred, ...others] : others;

        const target = candidates.find((el) => el && !el.disabled);
        if (target && typeof target.focus === 'function') target.focus();
    }

    function toggleScanIncludedInReport(scanId) {
        const bucket = getActiveBucket();
        const payload = bucket?.payload;

        if (!payload || !Array.isArray(payload.scans)) return;

        const scan = payload.scans.find((s) => s && s.id === scanId);
        if (!scan) return;

        const focusInfo = captureScanControlFocus();

        scan.includedInReport = scan.includedInReport === false;

        recomputeDerivedReportData(payload);
        reportView.refreshDerivedReportUi();
        restoreScanControlFocus(focusInfo);

        const label = scan.label || scan.id || 'Scan';
        const message = scan.includedInReport === false
            ? `${label} excluded from summary report.`
            : `${label} included in summary report.`;

        if (resultsState.activeMode === 'report') {
            setStatusReport(message, STATUS.OK);
        } else {
            setStatusRun(message, STATUS.OK);
        }
    }

    // Which move buttons are dead ends changes whenever the order does, and the
    // cards are not rebuilt, so the states are refreshed in place. One sweep of
    // the document: a query per scan would be hundreds of full-tree searches.
    function syncScanMoveButtons(scans) {
        const lastIndex = scans.length - 1;
        const positionById = new Map();
        scans.forEach((scan, index) => {
            if (scan && scan.id) positionById.set(scan.id, index);
        });

        document.querySelectorAll('[data-scan-action^="move-"][data-scan-id]').forEach((btn) => {
            const index = positionById.get(btn.dataset.scanId);
            if (index == null) return;

            const atEnd = btn.dataset.scanAction === 'move-up' ? index === 0 : index === lastIndex;
            btn.disabled = atEnd;
            if (atEnd) btn.setAttribute('aria-disabled', 'true');
            else btn.removeAttribute('aria-disabled');
        });
    }

    // Swaps two cards wherever both are rendered as siblings (the results list,
    // the summary rows, the all-scans grid), leaving every other card untouched.
    function swapRenderedScanCards(idA, idB) {
        const selector = (id) => `[data-sort-order][data-scan-id="${CSS.escape(id)}"]`;
        const partners = new Map();
        document.querySelectorAll(selector(idB)).forEach((el) => partners.set(el.parentNode, el));

        document.querySelectorAll(selector(idA)).forEach((a) => {
            const b = partners.get(a.parentNode);
            if (!b || b === a) return;

            const afterA = a.nextSibling === b ? a : a.nextSibling;
            a.parentNode.insertBefore(a, b);
            b.parentNode.insertBefore(b, afterA);
        });
    }

    /**
     * Reordering is a pure permutation: no count, metric or finding changes, so
     * the rendered cards are re-sequenced in place instead of rebuilt. A full
     * re-render of a large report costs seconds and drops the scroll position;
     * restamping the sort keys and re-appending the existing elements costs
     * milliseconds and leaves the viewport alone.
     *
     * `a11yGlobalFindings` is the one derived value whose order follows the
     * scans, and it is never displayed - export and compare both rebuild it.
     */
    function applyAdjacentScanSwapToDom(scans, idA, idB, indexA, indexB) {
        document.querySelectorAll(`[data-sort-order][data-scan-id="${CSS.escape(idA)}"]`)
            .forEach((el) => el.setAttribute('data-sort-order', String(indexA)));
        document.querySelectorAll(`[data-sort-order][data-scan-id="${CSS.escape(idB)}"]`)
            .forEach((el) => el.setAttribute('data-sort-order', String(indexB)));

        // Moving a card takes its subtree out of the document briefly, so the
        // pressed button has to be focused again to stay repeatable.
        const focusInfo = captureScanControlFocus();

        if (activeScanSort === 'default') {
            swapRenderedScanCards(idA, idB);
        } else {
            // Another key drives the visible order, and the workflow position is
            // only its tie-breaker, so let the sort decide where the pair lands.
            applyScanSort();
        }

        syncScanMoveButtons(scans);
        restoreScanControlFocus(focusInfo);
    }

    /*
     * "Where the failures are" is the one derived view whose answer depends on
     * scan order (docs/design/issue-dispersion-design.md §8.1). A move or a rename
     * rebuilds only that section, once per frame however many moves arrive,
     * and keeps a keyboard user's place in the strip.
     */
    let dispersionRefreshFrame = 0;

    function scheduleDispersionRefresh() {
        if (dispersionRefreshFrame) cancelAnimationFrame(dispersionRefreshFrame);
        dispersionRefreshFrame = requestAnimationFrame(() => {
            dispersionRefreshFrame = 0;
            refreshDispersionSection();
        });
    }

    function refreshDispersionSection() {
        const current = results?.querySelector('[data-dsp-section]');
        const payload = getActiveBucket()?.payload;
        if (!current || !payload) return;

        const scans = getIncludedScans(payload);
        const html = screenshotsUi.renderer.buildDispersionSectionHtml(scans);
        // Nothing fails in view any more: nothing to place.
        if (!html) {
            current.remove();
            return;
        }

        const view = globalThis.A11Y_ISSUE_DISPERSION_VIEW;
        const focusedStrip = document.activeElement?.closest?.('[data-dsp-strip]');
        const hadFocus = !!focusedStrip && current.contains(focusedStrip);
        const focusedScanId = hadFocus && view ? view.stripScanId(focusedStrip) : null;
        const openTables = Array.from(current.querySelectorAll('details.dsp-table'), (d) => d.open);
        // The strip's rule filter and height switch survive a refresh.
        const stripsView = view?.stripsView ? view.stripsView(current) : null;

        const holder = document.createElement('div');
        holder.innerHTML = html;
        const next = holder.firstElementChild;
        next.open = current.open;
        next.querySelectorAll('details.dsp-table').forEach((d, i) => { d.open = !!openTables[i]; });
        current.replaceWith(next);
        if (stripsView) view.setStripsView(next, stripsView);

        if (hadFocus) {
            const strip = next.querySelector('[data-dsp-strip]');
            if (strip) {
                strip.focus({preventScroll: true});
                if (focusedScanId && view) view.selectStripScan(strip, focusedScanId);
            }
        }
    }

    function moveScan(scanId, direction) {
        const bucket = getActiveBucket();
        const payload = bucket?.payload;

        if (!payload || !Array.isArray(payload.scans)) return;

        const scans = payload.scans;
        const idx = scans.findIndex((s) => s && s.id === scanId);
        if (idx === -1) return;

        const targetIdx = idx + (direction < 0 ? -1 : 1);
        if (targetIdx < 0 || targetIdx >= scans.length) return;

        const movedId = scans[idx].id;
        const displacedId = scans[targetIdx] && scans[targetIdx].id;

        [scans[idx], scans[targetIdx]] = [scans[targetIdx], scans[idx]];

        if (movedId && displacedId) {
            applyAdjacentScanSwapToDom(scans, movedId, displacedId, targetIdx, idx);
        }

        // The one derived view that follows scan order.
        scheduleDispersionRefresh();

        const movedScan = scans[targetIdx];
        const label = movedScan?.label || movedScan?.id || 'Scan';
        const message = direction < 0 ? `${label} moved up.` : `${label} moved down.`;

        if (resultsState.activeMode === 'report') {
            setStatusReport(message, STATUS.OK);
        } else {
            setStatusRun(message, STATUS.OK);
        }
    }

    function renameScan(scanId, newLabelRaw) {
        const bucket = getActiveBucket();
        const payload = bucket?.payload;

        if (!payload || !Array.isArray(payload.scans)) return;

        const scan = payload.scans.find((s) => s && s.id === scanId);
        if (!scan) return;

        const previousLabel = scan.label || scan.id || 'Scan';
        const nextLabel = newLabelRaw ? String(newLabelRaw).trim() : '';

        scan.label = nextLabel || null;

        const displayLabel = scan.label || scan.id || 'Scan';
        const idSel = CSS.escape(scanId);

        const summaryText = summaryEl?.querySelector(`.scan-name-text[data-scan-id="${idSel}"]`);
        if (summaryText) summaryText.textContent = displayLabel;

        const detailText = results?.querySelector(`[data-scan-id="${idSel}"] .scan-name-text`);
        if (detailText) detailText.textContent = displayLabel;

        // Hotspots and the strip's tooltips name scans by label.
        scheduleDispersionRefresh();

        const message = `Scan renamed from "${previousLabel}" to "${displayLabel}".`;

        if (resultsState.activeMode === 'report') {
            setStatusReport(message, STATUS.OK);
        } else {
            setStatusRun(message, STATUS.OK);
        }
    }

    // Tags already in use across the open report, offered while editing a scan.
    // The edited scan is included: the widget drops whatever it currently holds
    // as chips, so a tag removed mid-edit is offered straight back.
    function getScanTagSuggestions() {
        const scans = getActiveBucket()?.payload?.scans;
        if (!Array.isArray(scans)) return [];
        return collectScanTags(scans).tags;
    }

    // Repaint the read-only chips for one scan in both places they appear: the
    // scan header in the results list and the compact summary row.
    function repaintScanTagChips(scanId, scan) {
        const idSel = CSS.escape(scanId);

        const headerChips = results?.querySelector(`.scan-tags-region[data-scan-id="${idSel}"] .scan-tags-display`);
        if (headerChips) headerChips.innerHTML = scanTagChipsHtml(scan.scanTags);

        const summaryRow = summaryEl?.querySelector(`li[data-scan-id="${idSel}"]`);
        if (!summaryRow) return;

        summaryRow.querySelector('.scan-tags')?.remove();

        const html = scanTagChipsHtml(scan.scanTags);
        if (!html) return;

        const holder = document.createElement('span');
        holder.innerHTML = html;
        // The chips sit between the row's metadata and its controls.
        summaryRow.insertBefore(holder.firstElementChild, summaryRow.querySelector('.scan-summary-controls'));
    }

    function updateScanTags(scanId, rawTags) {
        const payload = getActiveBucket()?.payload;

        const edit = applyScanTagsEdit(payload, scanId, rawTags);
        if (!edit) return;

        const {scan, previous, next} = edit;

        repaintScanTagChips(scanId, scan);

        // The filter bar re-derives its chips from the scans and prunes any
        // selection that no longer exists, so an edited-away tag drops out.
        reportView.renderScanTagFilter(payload);
        reportView.applyScanTagFilterVisibility(payload.scans);
        applyScanSort();

        const label = scan.label || scan.id || 'Scan';
        const message = next.length
            ? `${label} tagged ${next.join(', ')}.`
            : (previous.length ? `Tags removed from ${label}.` : `${label} has no tags.`);

        if (resultsState.activeMode === 'report') {
            setStatusReport(message, STATUS.OK);
        } else {
            setStatusRun(message, STATUS.OK);
        }
    }

    function formatElapsedHuman(ms) {
        const totalSeconds = Math.max(0, Math.round(ms / 1000));

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts = [];

        if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

        // If there are no minutes (and no hours), show only seconds.
        // Otherwise, include seconds as well (so “3 minutes and 25 seconds” works).
        if ((hours === 0 && minutes === 0) || seconds > 0) {
            parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
        }

        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
        return `${parts[0]}, ${parts[1]} and ${parts[2]}`;
    }

    function setRunPayload(payload, meta = {}) {
        const normalizedPayload = normalizePayloadForUi(payload) || null;

        lastPromptedScenarioByMode.run = reportView.seedPromptedScenarioFor(normalizedPayload);

        if (normalizedPayload) {
            ensureScansIncludedFlag(normalizedPayload);
            recomputeDerivedReportData(normalizedPayload);
        }

        resultsState.run.payload = normalizedPayload;
        resultsState.run.meta = meta || {};

        // run ended, spinner off always
        setRunTabSpinner(false);

        if (resultsState.activeMode === 'run') {
            setRunTabBadge(false);
            renderActiveBucket();
        } else {
            // only show badge if user is on report when run finishes
            setRunTabBadge(true);

            if (resultsState.activeMode !== 'run' && statusReportEl.textContent === '') {
                setStatusReport('Run finished in background. Switch to Run workflow to view results.', STATUS.INFO);
            }
        }
    }

    function setReportPayload(payload, meta = {}) {
        const normalizedPayload = normalizePayloadForUi(payload) || null;

        lastPromptedScenarioByMode.report = reportView.seedPromptedScenarioFor(normalizedPayload);

        if (normalizedPayload) {
            ensureScansIncludedFlag(normalizedPayload);
            recomputeDerivedReportData(normalizedPayload);
        }

        resultsState.report.payload = normalizedPayload;
        resultsState.report.meta = meta || {};
        if (resultsState.activeMode === 'report') renderActiveBucket();
    }

    function clearActiveBucketState() {
        if (resultsState.activeMode === 'report') {
            resultsState.report.payload = null;
            resultsState.report.meta = {};
            return;
        }

        resultsState.run.payload = null;
        resultsState.run.meta = {};
        setRunTabBadge(false);
        setRunTabSpinner(false);
    }

    function clearRenderedResultsUi() {
        clearResults();
        clearScreenshots();
        clearResultDialogs();
        summaryEl.textContent = '';
        lastWorkflowResponse = null;
    }

    function renderActiveBucket() {
        resultsRenderSeq += 1;
        drawScansInBatches = window.scrollY < window.innerHeight;
        clearResultsPending();
        clearRenderedResultsUi();
        // Drawn afresh: what was set aside for this tab, and the dialog bodies
        // its last draw left waiting, are stale now.
        parkedResults[resultsState.activeMode] = null;
        setLazyScope(resultsState.activeMode);
        clearLazyBodies(resultsState.activeMode);

        const bucket = getActiveBucket();

        if (!bucket.payload) {
            // optional placeholder, or leave empty
            // summaryEl.textContent = resultsState.activeMode === 'report'
            //   ? 'No report loaded.'
            //   : 'No run results yet.';
            return;
        }
        const data = prepareDataForReport(bucket.payload);

        // Important: use the same shape you expect from final payload.
        // If the stored object is exactly the final payload, call renderFinalPayload directly:
        reportView.renderFinalPayload(data, data.url || urlInput?.value?.trim() || '');
        resultsRenderedFor = {
            mode: resultsState.activeMode,
            payload: bucket.payload,
            grouping: groupingUi.getSelectedBuiltInGroupingId(resultsState.activeMode),
        };
    }

    let lastWorkflowResponse = null;
    let actionsBuilder = null;
    let customStepActionsBuilder = null;
    let customStepsData = [];
    let copiedCustomStep = null;
    let selectedCustomStepIndex = -1;
    let syncingCustomStepEditor = false;
    let undoBtnEl = null;
    let redoBtnEl = null;
    let historyObserver = null;
    let refreshWorkflowCollapseAllBtn = null;

    let historyBaselineSig = null;

    // Undo/redo for actions *within* the currently-selected custom step
    // (its own action list) — a separate stack from the main workflow's,
    // scoped to whichever custom step is loaded into the editor.
    let customStepUndoBtnEl = null;
    let customStepRedoBtnEl = null;
    let customStepHistoryObserver = null;
    let customStepHistoryBaselineSig = null;
    let refreshCustomStepCollapseAllBtn = null;

    // Undo/redo for the custom-steps *list* itself (create/remove/rename a
    // custom step) — a different concern from the action-list history above:
    // this tracks structural changes to customStepsData, not edits within one
    // step's own actions.
    const CUSTOM_STEPS_HISTORY_MAX = 60;
    let customStepsUndoStack = [];
    let customStepsRedoStack = [];
    let isRestoringCustomStepsHistory = false;
    let lastCustomStepsHistorySig = null;
    let customStepsListUndoBtnEl = null;
    let customStepsListRedoBtnEl = null;
    let customStepsHistoryDebounceT = null;

    function getActionsSig() {
        if (!actionsBuilder) return null;
        try {
            const v = actionsBuilder.getValue({validate: false, maskValues: 'text'});
            const actions = Array.isArray(v?.value) ? v.value : [];

            // Normalize away volatile keys so baseline comparisons are stable
            const stable = stripVolatileKeysDeep(actions);
            return JSON.stringify(stable);
        } catch {
            return null;
        }
    }

    function setHistoryBaselineToCurrent() {
        historyBaselineSig = getActionsSig();
        syncHistoryButtons();
    }

    /* ---- Custom step action-list history (mirrors the main workflow's above) ---- */

    function getCustomStepActionsSig() {
        if (!customStepActionsBuilder) return null;
        try {
            const v = customStepActionsBuilder.getValue({validate: false, maskValues: 'text'});
            const actions = Array.isArray(v?.value) ? v.value : [];
            const stable = stripVolatileKeysDeep(actions);
            return JSON.stringify(stable);
        } catch {
            return null;
        }
    }

    // Called whenever a different custom step is loaded into the editor, so
    // undo can't reach across into whatever the previously-selected step's
    // actions were.
    function setCustomStepActionsHistoryBaselineToCurrent() {
        customStepHistoryBaselineSig = getCustomStepActionsSig();
        syncCustomStepActionsHistoryButtons();
    }

    function getCustomStepActionsHistoryState() {
        if (customStepActionsBuilder && typeof customStepActionsBuilder.getHistoryState === 'function') {
            try {
                const st = customStepActionsBuilder.getHistoryState();
                if (st && typeof st === 'object') {
                    let canUndo = !!st.canUndo;
                    const canRedo = !!st.canRedo;
                    if (customStepHistoryBaselineSig && getCustomStepActionsSig() === customStepHistoryBaselineSig) {
                        canUndo = false;
                    }
                    return {canUndo, canRedo};
                }
            } catch {}
        }
        return {canUndo: false, canRedo: false};
    }

    function syncCustomStepActionsHistoryButtons() {
        if (!customStepActionsBuilder) return;
        const {canUndo, canRedo} = getCustomStepActionsHistoryState();
        setHistoryButtonEnabled(customStepUndoBtnEl, canUndo, 'Nothing to undo');
        setHistoryButtonEnabled(customStepRedoBtnEl, canRedo, 'Nothing to redo');
        refreshCustomStepCollapseAllBtn?.();
    }

    function setupCustomStepActionsHistorySync() {
        if (customStepHistoryObserver) {
            try { customStepHistoryObserver.disconnect(); } catch {}
            customStepHistoryObserver = null;
        }

        if (customStepActionsEl) {
            const onAny = (e) => {
                const t = e.target;
                if (!(t instanceof Element)) return;
                if (!customStepActionsEl.contains(t)) return;
                syncCustomStepActionsHistoryButtons();
            };

            customStepActionsEl.addEventListener('input', onAny, true);
            customStepActionsEl.addEventListener('change', onAny, true);
            customStepActionsEl.addEventListener('click', onAny, true);

            customStepHistoryObserver = new MutationObserver(() => syncCustomStepActionsHistoryButtons());
            customStepHistoryObserver.observe(customStepActionsEl, {childList: true, subtree: true});
        }

        syncCustomStepActionsHistoryButtons();
    }

    function createCustomStepActionsHistoryButtons() {
        if (!customStepActionsBuilder || !customStepActionsHistoryContainer) return;

        customStepActionsHistoryContainer.innerHTML = '';

        const canCreateUndo = typeof customStepActionsBuilder.createUndoButton === 'function';
        const canCreateRedo = typeof customStepActionsBuilder.createRedoButton === 'function';

        if (!canCreateUndo || !canCreateRedo) {
            console.warn('Custom step actions builder does not expose createUndoButton/createRedoButton.');
            return;
        }

        customStepUndoBtnEl = customStepActionsBuilder.createUndoButton({
            className: 'secondary-button undo-button icon-button',
            ariaLabel: 'Undo custom step edit',
            title: 'Undo'
        }) || null;

        if (customStepUndoBtnEl) {
            customStepUndoBtnEl.addEventListener('click', (e) => {
                const atBaseline = customStepHistoryBaselineSig && getCustomStepActionsSig() === customStepHistoryBaselineSig;
                if (atBaseline) {
                    e.preventDefault();
                    e.stopPropagation();
                    syncCustomStepActionsHistoryButtons();
                }
            }, true);
        }

        customStepRedoBtnEl = customStepActionsBuilder.createRedoButton({
            className: 'secondary-button redo-button icon-button',
            ariaLabel: 'Redo custom step edit',
            title: 'Redo'
        }) || null;

        // The builder rebuilds the step DOM on undo/redo, which destroys
        // whatever had focus. Land focus back in the container so a second
        // keyboard shortcut still targets this editor instead of leaking to
        // a different undo domain (main workflow / custom-steps list).
        if (customStepUndoBtnEl) customStepUndoBtnEl.addEventListener('click', focusCustomStepActionsRegion);
        if (customStepRedoBtnEl) customStepRedoBtnEl.addEventListener('click', focusCustomStepActionsRegion);

        if (customStepUndoBtnEl) customStepActionsHistoryContainer.appendChild(customStepUndoBtnEl);
        if (customStepRedoBtnEl) customStepActionsHistoryContainer.appendChild(customStepRedoBtnEl);

        setupCustomStepActionsHistorySync();
    }

    function focusCustomStepActionsRegion() {
        customStepActionsEl?.focus();
    }

    /* ---- Custom steps *list* history: create/remove/rename a custom step ---- */

    function snapshotCustomStepsForHistory() {
        return {
            steps: customStepsData.map((s) => ({
                id: s.id,
                name: s.name,
                inputs: Array.isArray(s.inputs) ? s.inputs.map((i) => ({...i})) : [],
                actions: Array.isArray(s.actions) ? JSON.parse(JSON.stringify(s.actions)) : []
            })),
            selectedIndex: selectedCustomStepIndex
        };
    }

    function getCustomStepsListSig(steps) {
        try {
            return JSON.stringify(steps);
        } catch {
            return null;
        }
    }

    function syncCustomStepsListHistoryButtons() {
        setHistoryButtonEnabled(customStepsListUndoBtnEl, customStepsUndoStack.length > 1, 'Nothing to undo');
        setHistoryButtonEnabled(customStepsListRedoBtnEl, customStepsRedoStack.length > 0, 'Nothing to redo');
    }

    function pushCustomStepsHistory({force = false} = {}) {
        if (isRestoringCustomStepsHistory) return;

        const snap = snapshotCustomStepsForHistory();
        const sig = getCustomStepsListSig(snap.steps);

        if (!force && sig && lastCustomStepsHistorySig === sig) return;

        customStepsUndoStack.push(snap);
        if (customStepsUndoStack.length > CUSTOM_STEPS_HISTORY_MAX) {
            customStepsUndoStack.splice(0, customStepsUndoStack.length - CUSTOM_STEPS_HISTORY_MAX);
        }
        customStepsRedoStack.length = 0;

        if (sig) lastCustomStepsHistorySig = sig;
        syncCustomStepsListHistoryButtons();
    }

    // Debounced push for free-text edits (id/name/inputs), same spirit as the
    // actions builder's own scheduleHistoryPush for typing.
    function scheduleCustomStepsHistoryPush() {
        if (isRestoringCustomStepsHistory) return;
        if (customStepsHistoryDebounceT) clearTimeout(customStepsHistoryDebounceT);
        customStepsHistoryDebounceT = setTimeout(() => {
            customStepsHistoryDebounceT = null;
            pushCustomStepsHistory();
        }, 250);
    }

    function resetCustomStepsHistory() {
        customStepsUndoStack = [];
        customStepsRedoStack = [];
        lastCustomStepsHistorySig = null;
        pushCustomStepsHistory({force: true});
    }

    function restoreCustomStepsSnapshot(snap) {
        isRestoringCustomStepsHistory = true;
        try {
            customStepsData = snap.steps.map((s) => ({
                id: s.id,
                name: s.name,
                inputs: Array.isArray(s.inputs) ? s.inputs.map((i) => ({...i})) : [],
                actions: Array.isArray(s.actions) ? s.actions : []
            }));
            selectedCustomStepIndex = customStepsData.length
                ? Math.min(Math.max(snap.selectedIndex, 0), customStepsData.length - 1)
                : -1;

            renderCustomStepsList();
            loadSelectedCustomStepIntoEditor();
            syncCustomStepsHiddenInput();
            refreshRunCustomStepSelectors();

            lastCustomStepsHistorySig = getCustomStepsListSig(snap.steps);

            // renderCustomStepsList() rebuilds the list buttons from scratch,
            // destroying whatever had focus — land back on the active step
            // (or the add button if the list is now empty) so a repeated
            // keyboard shortcut still targets this list, not another domain.
            const activeItem = customStepsListEl?.querySelector('.custom-steps-item.is-active');
            (activeItem || customStepPasteBtn || customStepAddBtn)?.focus();
        } finally {
            isRestoringCustomStepsHistory = false;
            syncCustomStepsListHistoryButtons();
        }
    }

    function undoCustomSteps() {
        if (customStepsUndoStack.length <= 1) return false;

        const current = customStepsUndoStack.pop();
        customStepsRedoStack.push(current);

        const prev = customStepsUndoStack[customStepsUndoStack.length - 1];
        restoreCustomStepsSnapshot(prev);
        return true;
    }

    function redoCustomSteps() {
        if (!customStepsRedoStack.length) return false;

        const next = customStepsRedoStack.pop();
        customStepsUndoStack.push(next);
        restoreCustomStepsSnapshot(next);
        return true;
    }

    function createCustomStepsListHistoryButtons() {
        if (!customStepsListHistoryContainer) return;

        customStepsListHistoryContainer.innerHTML = '';

        customStepsListUndoBtnEl = iconButton({
            className: 'secondary-button undo-button icon-button',
            ariaLabel: 'Undo custom steps change',
            title: 'Undo',
            iconName: 'undo'
        });
        customStepsListUndoBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            undoCustomSteps();
        });

        customStepsListRedoBtnEl = iconButton({
            className: 'secondary-button redo-button icon-button',
            ariaLabel: 'Redo custom steps change',
            title: 'Redo',
            iconName: 'redo'
        });
        customStepsListRedoBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            redoCustomSteps();
        });

        customStepsListHistoryContainer.append(customStepsListUndoBtnEl, customStepsListRedoBtnEl);
        syncCustomStepsListHistoryButtons();
    }

    // live stream gating, computed per run
    let useLiveStream = true;

    let loadAndRun = false;

// -------------------- Report file staging (Open report) --------------------

    /** @type {{ key: string, file: File, name: string, size: number, lastModified: number, ok: boolean, error: string|null, parsed: any|null }[]} */
    let stagedReportFiles = [];
    // The staged report a single pick opened at once, which the next single
    // pick replaces while the list holds nothing else.
    let reportOpenedAlone = null;

    function makeFileKey(file) {
        // stable-enough dedupe key for user-selected files
        return `${file.name}::${file.size}::${file.lastModified}`;
    }

    function isZipFile(file) {
        return /\.zip$/i.test(file?.name || '') || /zip/i.test(file?.type || '');
    }

    /**
     * A report read from a zip, as a file the staging and loading read like a
     * picked one: its text has its pictures as links to the zip's own
     * (report-package.js), and Load selected parses it again from that text.
     */
    function reportInZip(zipFile, {name, text}) {
        return {
            name: `${zipFile.name} › ${name}`,
            size: text.length,
            lastModified: zipFile.lastModified,
            text: async () => text,
        };
    }

    function makeObjectKey(name) {
        // stable-enough dedupe key for non-file imports (extension, clipboard, etc.)
        return `obj::${String(name || 'import')}`.trim() + `::${Date.now()}`;
    }

    /**
     * Parses a second copy of a staged report while the page is idle, for
     * Load selected to take (freshReportObject): parsed when Load is pressed,
     * it added a third of a second to the wait for a large report. Used once;
     * a second load parses its own.
     */
    function prepareSpareReport(entry, text) {
        const whenIdle = typeof requestIdleCallback === 'function'
            ? requestIdleCallback
            : (fn) => setTimeout(fn, 200);
        whenIdle(() => {
            if (entry.spare || !stagedReportFiles.includes(entry)) return;
            try {
                entry.spare = JSON.parse(text);
            } catch {
                // Load selected parses its own.
            }
        });
    }

    function stageReportObject(json, name = 'extension-report.json') {
        const key = makeObjectKey(name);

        // Deduplicate only by name is risky, because repeated imports should be allowed.
        // We instead allow duplicates, but still avoid exact same key collisions.
        if (stagedReportFiles.some(x => x.key === key)) return;

        const entry = {
            key,
            file: null, // important: not a File
            name,
            size: null,
            lastModified: Date.now(),
            ok: false,
            error: null,
            parsed: null,
            expanded: false,
            includeScans: null,
            includeActionScreenshots: null
        };

        try {
            validateReportOrThrow(json, name);

            entry.ok = true;
            entry.parsed = json;
            initEntrySelectionsFromParsed(entry);
        } catch (err) {
            entry.ok = false;
            entry.parsed = null;
            entry.error = String(err?.message || err);
        }

        stagedReportFiles.push(entry);

        renderStagedReportFilesList();

        const total = stagedReportFiles.length;
        const okCount = stagedReportFiles.filter(x => x.ok).length;
        const badCount = total - okCount;

        if (badCount) {
            setStatusReport(`Files staged. ${okCount} valid, ${badCount} invalid. Remove or fix invalid files before loading.`, STATUS.WARNING);
        } else {
            setStatusReport(`Files staged. ${okCount} ready to load.`, STATUS.OK);
        }
    }

    function normalizeMaybeString(v) {
        const s = (v === null || v === undefined) ? '' : String(v);
        return s.trim();
    }

    function getScanLabel(scan, index) {
        if (!scan || typeof scan !== 'object') return `Scan ${index + 1}`;

        const candidates = [
            scan.label,
            scan.actionLabel,
            scan.title,
            scan.name,
            scan.displayLabel,
            scan.url,
            scan.pageUrl
        ];

        for (const c of candidates) {
            const s = normalizeMaybeString(c);
            if (s) return s;
        }

        return `Scan ${index + 1}`;
    }

    function getActionScreenshotLabel(shot, index) {
        if (!shot || typeof shot !== 'object') return `Action screenshot ${index + 1}`;

        const candidates = [
            shot.label,
            shot.actionLabel,
            shot.title,
            shot.name,
            shot.displayLabel,
            shot.url,
            shot.pageUrl,
            shot.src
        ];

        for (const c of candidates) {
            const s = normalizeMaybeString(c);
            if (s) return s;
        }

        return `Action screenshot ${index + 1}`;
    }

    function initEntrySelectionsFromParsed(entry) {
        if (!entry || !entry.parsed) return;

        const scans = Array.isArray(entry.parsed.scans) ? entry.parsed.scans : [];
        const shots = Array.isArray(entry.parsed.screenshots) ? entry.parsed.screenshots : [];

        entry.includeScans = scans.map(() => true);
        entry.includeActionScreenshots = shots.map(() => true);
    }

    function countSelected(arr) {
        if (!Array.isArray(arr)) return 0;
        return arr.reduce((n, v) => n + (v ? 1 : 0), 0);
    }

    function moveStagedReportFile(key, dir) {
        const i = stagedReportFiles.findIndex(x => x.key === key);
        if (i < 0) return;

        const j = i + dir;
        if (j < 0 || j >= stagedReportFiles.length) return;

        const tmp = stagedReportFiles[i];
        stagedReportFiles[i] = stagedReportFiles[j];
        stagedReportFiles[j] = tmp;

        const token = captureStagingFocusToken();
        renderStagedReportFilesList();
        restoreStagingFocus(token);
    }

    function setStagingUiVisible(isVisible) {
        if (!reportFilesStagingEl) return;
        reportFilesStagingEl.hidden = !isVisible;
    }

    function setStagingButtonsEnabled({canLoad, canClear}) {
        if (reportFilesLoadBtn) {
            reportFilesLoadBtn.setAttribute('aria-disabled', canLoad ? 'false' : 'true');
            reportFilesLoadBtn.disabled = !canLoad;
        }
        if (reportFilesClearBtn) {
            reportFilesClearBtn.setAttribute('aria-disabled', canClear ? 'false' : 'true');
            reportFilesClearBtn.disabled = !canClear;
        }
    }

    function renderStagedReportFilesList() {
        if (!reportFilesListEl || !reportFilesCountEl) return;

        // Clear list
        reportFilesListEl.innerHTML = '';

        const total = stagedReportFiles.length;
        const okCount = stagedReportFiles.filter(x => x.ok).length;
        const badCount = total - okCount;

        reportFilesCountEl.textContent =
            total === 0
                ? ''
                : `${total} file${total === 1 ? '' : 's'} selected, ${okCount} valid${badCount ? `, ${badCount} invalid` : ''}.`;

        if (total === 0) {
            setStagingUiVisible(false);
            setStagingButtonsEnabled({canLoad: false, canClear: false});
            return;
        }

        setStagingUiVisible(true);

        // Build list items
        for (const item of stagedReportFiles) {
            const li = document.createElement('li');
            li.className = 'hint'; // reuse existing styling class, minimal CSS changes

            const statusText = item.ok ? 'Ready' : `Invalid: ${item.error || 'Unknown error'}`;

            const scans = (item.ok && item.parsed && Array.isArray(item.parsed.scans)) ? item.parsed.scans : [];
            const actionShots = (item.ok && item.parsed && Array.isArray(item.parsed.screenshots)) ? item.parsed.screenshots : [];

            const scanTotal = scans.length;
            const scanSelected = countSelected(item.includeScans);

            const shotTotal = actionShots.length;
            const shotSelected = countSelected(item.includeActionScreenshots);

            const panelId = `report-file-panel-${encodeURIComponent(item.key).replace(/%/g, '_')}`;
            const expanded = !!item.expanded;

            const summaryBits = [];
            if (scanTotal) summaryBits.push(`Scans: ${scanSelected} selected of ${scanTotal}`);
            if (shotTotal) summaryBits.push(`Action screenshots: ${shotSelected} selected of ${shotTotal}`);
            const summaryText = summaryBits.length ? summaryBits.join(', ') : '';

            // NOTE: no em dashes
            li.innerHTML = `
            <div style="display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap;">
                <div style="min-width:min(260px, 100%); text-align: left;">
                    <strong>${escapeHtml(item.name)}</strong>
                    <small style="opacity:.85;"> - ${escapeHtml(statusText)}</small>
                    <div>
                      <small style="opacity:.85;"
                             data-report-file-summary="1"
                             data-report-file-key="${escapeAttr(item.key)}">${escapeHtml(summaryText)}</small>
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <button type="button"
                            class="secondary-button"
                            data-report-file-toggle="1"
                            data-report-file-key="${escapeAttr(item.key)}"
                            aria-expanded="${expanded ? 'true' : 'false'}"
                            aria-controls="${escapeAttr(panelId)}"
                            ${item.ok ? '' : 'disabled aria-disabled="true"'}>
                        ${expanded ? 'Hide' : 'Select items'}
                    </button>

                    <button type="button"
                            class="secondary-button"
                            data-report-file-move="-1"
                            data-report-file-key="${escapeAttr(item.key)}"
                            aria-label="Move ${escapeAttr(item.name)} up"
                            ${item === stagedReportFiles[0] ? 'disabled aria-disabled="true"' : ''}>
                        ▲
                    </button>

                    <button type="button"
                            class="secondary-button"
                            data-report-file-move="1"
                            data-report-file-key="${escapeAttr(item.key)}"
                            aria-label="Move ${escapeAttr(item.name)} down"
                            ${item === stagedReportFiles[stagedReportFiles.length - 1] ? 'disabled aria-disabled="true"' : ''}>
                        ▼
                    </button>

                    <button type="button"
                            class="secondary-button"
                            data-report-file-remove="1"
                            data-report-file-key="${escapeAttr(item.key)}"
                            aria-label="Remove ${escapeAttr(item.name)}">
                        Remove
                    </button>
                </div>
            </div>

            <div id="${escapeAttr(panelId)}" style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,.12);" ${expanded ? '' : 'hidden'}>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <div style="min-width:min(260px, 100%); flex:1; padding-right: 10px; border-right: 1px dotted;">
                        <div style="display:flex; gap:8px; align-items:center; justify-content:space-between;">
                            <strong>Scans (${scanTotal})</strong>
                            <span style="display:flex; gap:8px; align-items:center;">
                                <button type="button"
                                        class="secondary-button"
                                        data-report-section-select="all"
                                        data-report-section="scans"
                                        data-report-file-key="${escapeAttr(item.key)}"
                                        ${scanTotal ? '' : 'disabled aria-disabled="true"'}>
                                    Select all
                                </button>
                                <button type="button"
                                        class="secondary-button"
                                        data-report-section-select="none"
                                        data-report-section="scans"
                                        data-report-file-key="${escapeAttr(item.key)}"
                                        ${scanTotal ? '' : 'disabled aria-disabled="true"'}>
                                    Select none
                                </button>
                            </span>
                        </div>

                        ${scanTotal ? `
                        <ul style="margin:8px 0 0 0; padding-left:18px; max-height:260px; overflow:auto;">
                            ${scans.map((scan, idx) => {
                const label = getScanLabel(scan, idx);
                const checked = Array.isArray(item.includeScans) ? !!item.includeScans[idx] : true;
                return `
                                <li style="margin:4px 0;">
                                    <label style="display:flex; gap:8px; align-items:flex-start; text-align: left;">
                                        <input type="checkbox"
                                               data-report-file-key="${escapeAttr(item.key)}"
                                               data-report-scan-idx="${idx}"
                                               ${checked ? 'checked' : ''}>
                                        <span>${escapeHtml(label)}</span>
                                    </label>
                                </li>`;
            }).join('')}
                        </ul>` : `<p style="margin:8px 0 0 0; opacity:.85;">No scans in this file.</p>`}
                    </div>

                    <div style="min-width:min(260px, 100%); flex:1;">
                        <div style="display:flex; gap:8px; align-items:center; justify-content:space-between;">
                            <strong>Action screenshots (${shotTotal})</strong>
                            <span style="display:flex; gap:8px; align-items:center;">
                                <button type="button"
                                        class="secondary-button"
                                        data-report-section-select="all"
                                        data-report-section="shots"
                                        data-report-file-key="${escapeAttr(item.key)}"
                                        ${shotTotal ? '' : 'disabled aria-disabled="true"'}>
                                    Select all
                                </button>
                                <button type="button"
                                        class="secondary-button"
                                        data-report-section-select="none"
                                        data-report-section="shots"
                                        data-report-file-key="${escapeAttr(item.key)}"
                                        ${shotTotal ? '' : 'disabled aria-disabled="true"'}>
                                    Select none
                                </button>
                            </span>
                        </div>

                        ${shotTotal ? `
                        <ul style="margin:8px 0 0 0; padding-left:18px; max-height:260px; overflow:auto;">
                            ${actionShots.map((shot, idx) => {
                const label = getActionScreenshotLabel(shot, idx);
                const checked = Array.isArray(item.includeActionScreenshots) ? !!item.includeActionScreenshots[idx] : true;
                return `
                                <li style="margin:4px 0;">
                                    <label style="display:flex; gap:8px; align-items:flex-start; text-align: left;">
                                        <input type="checkbox"
                                               data-report-file-key="${escapeAttr(item.key)}"
                                               data-report-shot-idx="${idx}"
                                               ${checked ? 'checked' : ''}>
                                        <span>${escapeHtml(label)}</span>
                                    </label>
                                </li>`;
            }).join('')}
                        </ul>` : `<p style="margin:8px 0 0 0; opacity:.85;">No action screenshots in this file.</p>`}
                    </div>
                </div>
            </div>
        `;
            reportFilesListEl.appendChild(li);
        }

        const anySelected = stagedReportFiles.some(it =>
            it.ok &&
            ((countSelected(it.includeScans) > 0) || (countSelected(it.includeActionScreenshots) > 0))
        );

        const canLoad = okCount > 0 && badCount === 0 && anySelected;
        const canClear = total > 0;

        setStagingButtonsEnabled({canLoad, canClear});
    }

    function recomputeStagingButtonsEnabled() {
        const total = stagedReportFiles.length;
        const okCount = stagedReportFiles.filter(x => x.ok).length;
        const badCount = total - okCount;

        const anySelected = stagedReportFiles.some(it =>
            it.ok &&
            ((countSelected(it.includeScans) > 0) || (countSelected(it.includeActionScreenshots) > 0))
        );

        const canLoad = okCount > 0 && badCount === 0 && anySelected;
        const canClear = total > 0;

        setStagingButtonsEnabled({canLoad, canClear});
    }

    function updateStagedFileSummaryInPlace(key) {
        if (!reportFilesListEl) return;

        const item = stagedReportFiles.find(x => x.key === key);
        if (!item || !item.ok || !item.parsed) return;

        const scans = Array.isArray(item.parsed.scans) ? item.parsed.scans : [];
        const shots = Array.isArray(item.parsed.screenshots) ? item.parsed.screenshots : [];

        const scanTotal = scans.length;
        const scanSelected = countSelected(item.includeScans);

        const shotTotal = shots.length;
        const shotSelected = countSelected(item.includeActionScreenshots);

        const summaryBits = [];
        if (scanTotal) summaryBits.push(`Scans: ${scanSelected} selected of ${scanTotal}`);
        if (shotTotal) summaryBits.push(`Action screenshots: ${shotSelected} selected of ${shotTotal}`);
        const summaryText = summaryBits.length ? summaryBits.join(', ') : '';

        const el = reportFilesListEl.querySelector(
            `[data-report-file-summary="1"][data-report-file-key="${CSS.escape(key)}"]`
        );

        if (el) el.textContent = summaryText;

        recomputeStagingButtonsEnabled();
    }

    function captureStagingFocusToken() {
        if (!reportFilesListEl) return null;

        const ae = document.activeElement;
        if (!ae || !(ae instanceof Element)) return null;
        if (!reportFilesListEl.contains(ae)) return null;

        const key = ae.getAttribute('data-report-file-key') || '';

        // Checkbox: scan
        const scanIdx = ae.getAttribute('data-report-scan-idx');
        if (scanIdx !== null) {
            return {
                kind: 'scan-checkbox',
                key,
                scanIdx: String(scanIdx),
                selector: `input[type="checkbox"][data-report-file-key="${CSS.escape(key)}"][data-report-scan-idx="${CSS.escape(String(scanIdx))}"]`
            };
        }

        // Checkbox: action screenshot
        const shotIdx = ae.getAttribute('data-report-shot-idx');
        if (shotIdx !== null) {
            return {
                kind: 'shot-checkbox',
                key,
                shotIdx: String(shotIdx),
                selector: `input[type="checkbox"][data-report-file-key="${CSS.escape(key)}"][data-report-shot-idx="${CSS.escape(String(shotIdx))}"]`
            };
        }

        // File toggle button
        if (ae.getAttribute('data-report-file-toggle') === '1') {
            return {
                kind: 'toggle',
                key,
                selector: `button[data-report-file-toggle="1"][data-report-file-key="${CSS.escape(key)}"]`
            };
        }

        // Move buttons
        const move = ae.getAttribute('data-report-file-move');
        if (move === '-1' || move === '1') {
            return {
                kind: 'move',
                key,
                move,
                selector: `button[data-report-file-move="${CSS.escape(move)}"][data-report-file-key="${CSS.escape(key)}"]`
            };
        }

        // Remove button
        if (ae.getAttribute('data-report-file-remove') === '1') {
            return {
                kind: 'remove',
                key,
                selector: `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(key)}"]`
            };
        }

        // Section select buttons (all/none)
        const sectionSelect = ae.getAttribute('data-report-section-select');
        const section = ae.getAttribute('data-report-section');
        if ((sectionSelect === 'all' || sectionSelect === 'none') && (section === 'scans' || section === 'shots')) {
            return {
                kind: 'section-select',
                key,
                sectionSelect,
                section,
                selector: `button[data-report-section-select="${CSS.escape(sectionSelect)}"][data-report-section="${CSS.escape(section)}"][data-report-file-key="${CSS.escape(key)}"]`
            };
        }

        // Generic fallback: try to refocus the same element if it survives (rare), else first control in same file
        return {
            kind: 'generic',
            key,
            selector: key ? `[data-report-file-key="${CSS.escape(key)}"]` : null
        };
    }

    function restoreStagingFocus(token, fallbackSelector = null) {
        if (!token || !reportFilesListEl) return false;

        // 1) Try exact selector
        if (token.selector) {
            const el = reportFilesListEl.querySelector(token.selector);
            if (isActuallyFocusable(el)) return focusSafely(el);
        }

        // 2) Special fallback for move buttons that may become disabled after move
        if (token.kind === 'move' && token.key) {
            const otherMove = token.move === '-1' ? '1' : '-1';
            const alt = reportFilesListEl.querySelector(
                `button[data-report-file-move="${CSS.escape(otherMove)}"][data-report-file-key="${CSS.escape(token.key)}"]`
            );
            if (isActuallyFocusable(alt)) return focusSafely(alt);

            const toggle = reportFilesListEl.querySelector(
                `button[data-report-file-toggle="1"][data-report-file-key="${CSS.escape(token.key)}"]`
            );
            if (isActuallyFocusable(toggle)) return focusSafely(toggle);

            const remove = reportFilesListEl.querySelector(
                `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(token.key)}"]`
            );
            if (isActuallyFocusable(remove)) return focusSafely(remove);
        }

        // 3) If caller provided a fallback selector, try it
        if (fallbackSelector) {
            const fb = reportFilesListEl.querySelector(fallbackSelector);
            if (isActuallyFocusable(fb)) return focusSafely(fb);
        }

        // 4) Generic fallback inside staging list: first enabled button
        const any = reportFilesListEl.querySelector('button:not([disabled]), input[type="checkbox"]:not([disabled])');
        if (isActuallyFocusable(any)) return focusSafely(any);

        return false;
    }

    function focusReportArea() {
        // Prefer summary for reading, fall back to status.
        const target = summaryEl || statusReportEl;
        if (!target) return;

        const hadTabindex = target.hasAttribute('tabindex');
        if (!hadTabindex) target.setAttribute('tabindex', '-1');

        focusSafely(target);

        if (!hadTabindex) {
            setTimeout(() => {
                try { target.removeAttribute('tabindex'); } catch { /* ignore */ }
            }, 0);
        }
    }

    // -------------------- Grouping (UI state) --------------------

    // In grouping-ui.js.
    const groupingUi = createGroupingUi(app);

    /* ==================== UI helpers ==================== */

    function clearLogsPanel() {
        if (!logsPanelEl) return;
        logsPanelEl.innerHTML = '';
        logToolbarEl?.classList.remove('is-visible');
    }

    function clearResults() {
        resultsRenderedFor = null;
        resultsContainer.style.display = 'none';
        while (results.firstChild) results.removeChild(results.firstChild);
        // Scans still to be drawn into what was here are not drawn now.
        if (pendingScanDraw) {
            resultsContainer.removeAttribute('aria-busy');
            reportView.markResultsComplete();
        }
    }

    function clearScreenshots() {
        screenshotsContainer.style.display = 'none';
        while (screenshots.firstChild) screenshots.removeChild(screenshots.firstChild);
    }

    // A scan counts toward the aggregate (global findings, metrics, summary
    // totals) when it is BOTH manually included AND matches the active tag
    // filter. The two dimensions are independent: the manual Exclude toggle
    // never hides a scan from the view, while the tag filter never changes a
    // scan's manual include state - it only narrows which scans the view and
    // the aggregate consider.
    function isScanIncludedInReport(scan) {
        return !!scan && scan.includedInReport !== false && scanMatchesActiveTagFilter(scan);
    }

    function getIncludedScans(payload) {
        const scans = Array.isArray(payload?.scans) ? payload.scans : [];
        return scans.filter(isScanIncludedInReport);
    }

    function recomputeDerivedReportData(payload) {
        if (!payload || typeof payload !== 'object') return payload;

        ensureScansIncludedFlag(payload);
        ensureScanSummaryCounts(payload);

        const includedScans = getIncludedScans(payload);
        const metricDefs = pickMetricDefsFromPayload(payload);

        payload.a11yGlobalFindings = getA11yGlobalFindings(includedScans);
        payload.metrics = buildGlobalSummary({
            scans: includedScans,
            metricDefs
        });

        return payload;
    }

    /**
     * Loads the staged files into the open report tab, listing its steps in
     * the activity panel's `task`.
     */
    async function loadStagedReportsIntoOpenReport(task) {
        const okItems = stagedReportFiles.filter(x => x.ok && x.parsed);
        const refuse = (message) => {
            setStatusReport(message, STATUS.ERROR);
            task.fail(message);
        };
        const step = async (label) => {
            task.step(label);
            await afterPaint();
        };
        // The report is drawn a few scans at a time: the task ends once all are.
        const shown = async (message) => {
            setStatusReport(message, STATUS.OK);
            focusReportArea();
            await reportView.whenResultsComplete();
            task.done(message);
        };

        if (!okItems.length) {
            refuse('No valid staged files to load.');
            return;
        }

        const invalid = stagedReportFiles.filter(x => !x.ok);
        if (invalid.length) {
            refuse('Remove invalid files before loading.');
            return;
        }

        const anySelected = stagedReportFiles.some(it =>
            it.ok &&
            ((countSelected(it.includeScans) > 0) || (countSelected(it.includeActionScreenshots) > 0))
        );

        if (!anySelected) {
            refuse('Nothing selected to load. Select at least one scan or action screenshot.');
            return;
        }

        // A copy the view can change, keeping the staged report intact so
        // users can adjust selections and reload. Parsed again from the staged
        // file when there is one: for a large report that is several times
        // faster than copying the parsed object.
        async function freshReportObject(item) {
            if (item.spare) {
                const spare = item.spare;
                item.spare = null;
                return spare;
            }
            if (item.file && typeof item.file.text === 'function') {
                try {
                    return JSON.parse(await item.file.text());
                } catch {
                    // fall through to a copy of what was staged
                }
            }
            const obj = item.parsed;
            try {
                if (typeof structuredClone === 'function') return structuredClone(obj);
            } catch {
                // fall through
            }
            return JSON.parse(JSON.stringify(obj || {}));
        }

        function applySelectionToReport(reportObj, item) {
            if (!reportObj || !item) return;

            if (Array.isArray(reportObj.scans) && Array.isArray(item.includeScans)) {
                reportObj.scans = reportObj.scans.filter((_, idx) => !!item.includeScans[idx]);
            }

            if (Array.isArray(reportObj.screenshots) && Array.isArray(item.includeActionScreenshots)) {
                reportObj.screenshots = reportObj.screenshots.filter((_, idx) => !!item.includeActionScreenshots[idx]);
            }
        }


        // helper: screenshots dedupe
        function dedupeScreenshots(list) {
            const seen = new Set();
            const out = [];
            for (const s of list || []) {
                const key =
                    (s && (s.id || s.key || s.hash || s.src || s.dataUrl || s.url)) ??
                    JSON.stringify(s);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(s);
            }
            return out;
        }

        // helper: tokenize/restore scan screenshot dataUrls (scan.screenshots[].dataUrl)
        const B64_TOKEN_PREFIX = '__B64REF__:';

        function looksLikeDataUrl(v) {
            const s = String(v || '');
            return s.startsWith('data:image/') || s.startsWith('data:');
        }

        function makeB64Token(fileName, counter) {
            if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
                return `${B64_TOKEN_PREFIX}${globalThis.crypto.randomUUID()}`;
            }
            return `${B64_TOKEN_PREFIX}${encodeURIComponent(String(fileName || 'file'))}:${counter}`;
        }

        function tokenizeScanDataUrls(reportObj, fileName, map, counterRef) {
            if (!reportObj || !Array.isArray(reportObj.scans)) return;

            for (const scan of reportObj.scans) {
                if (!scan || !Array.isArray(scan.screenshots) || !scan.screenshots.length) continue;

                for (const shot of scan.screenshots) {
                    if (!shot || typeof shot !== 'object') continue;

                    const v = shot.dataUrl;
                    if (!v || typeof v !== 'string' || !looksLikeDataUrl(v)) continue;

                    const token = makeB64Token(fileName, counterRef.value++);
                    map.set(token, v);
                    shot.dataUrl = token;
                }
            }
        }

        function restoreScanDataUrls(reportObj, map) {
            if (!reportObj || !Array.isArray(reportObj.scans)) return;

            for (const scan of reportObj.scans) {
                if (!scan || !Array.isArray(scan.screenshots) || !scan.screenshots.length) continue;

                for (const shot of scan.screenshots) {
                    if (!shot || typeof shot !== 'object') continue;

                    const v = shot.dataUrl;
                    if (!v || typeof v !== 'string' || !v.startsWith(B64_TOKEN_PREFIX)) continue;

                    const restored = map.get(v);
                    if (restored) shot.dataUrl = restored;
                }
            }
        }

        try {
            // Single-file shortcut (no server merge needed)
            if (okItems.length === 1) {
                const only = okItems[0];

                await step(`Reading ${only.name}`);
                const payload = await freshReportObject(only);
                applySelectionToReport(payload, only);

                validateReportOrThrow(payload, only.name);

                await step('Drawing the report');
                setReportPayload(payload, {fileName: only.name});
                await shown('Report loaded from staged file.');
                return;
            }

            // Multi-file merge
            const parsedObjects = [];
            const screenshots = [];

            const scanDataUrlMap = new Map();
            const scanTokenCounter = {value: 1};

            for (const item of okItems) {
                await step(`Reading ${item.name}`);
                const json = await freshReportObject(item);
                applySelectionToReport(json, item);

                if (json && Array.isArray(json.screenshots) && json.screenshots.length) {
                    screenshots.push(...json.screenshots);
                }

                if (json && Object.prototype.hasOwnProperty.call(json, 'screenshots')) {
                    delete json.screenshots;
                }

                // Ignore per-file precomputed globals, they will be recalculated
                if (json && Object.prototype.hasOwnProperty.call(json, 'a11yGlobalFindings')) {
                    delete json.a11yGlobalFindings;
                }

                // Ignore per-file top-level metrics, they will be recalculated
                if (json && Object.prototype.hasOwnProperty.call(json, 'metrics')) {
                    delete json.metrics;
                }

                tokenizeScanDataUrls(json, item.name, scanDataUrlMap, scanTokenCounter);

                parsedObjects.push(json);
            }

            await step(`Merging ${okItems.length} reports`);
            clearResults();
            clearScreenshots();
            setStatusReport('Processing and loading reports from staged files.', STATUS.OK);

            // ---------- Prefer local merge (no server) if shared builder is present ----------
            const BUILDER_API = globalThis.A11Y_WORKFLOW_PAYLOAD_BUILDER;

            const restoredWorkflowShots = dedupeScreenshots(screenshots);

            if (BUILDER_API && typeof BUILDER_API.createWorkflowPayloadBuilder === 'function') {
                const METRIC_DEFS_LOCAL = pickMetricDefsFromStaged(okItems);

                const PAYLOAD = BUILDER_API.createWorkflowPayloadBuilder({
                    METRIC_DEFS: METRIC_DEFS_LOCAL,
                    sortByOrderKey,
                    buildGlobalSummary,
                    cryptoSha1Hex16: hashHex16
                });

                // Rebuild import objects INCLUDING scans, but no need to include workflow screenshots here
                // because we pass them explicitly as workflowScreenshots.
                const importObjs = parsedObjects.map((o) => {
                    const out = o && typeof o === 'object' ? o : {};
                    // ensure expected shape for the merge helper
                    if (!Array.isArray(out.scans)) out.scans = [];
                    if (!Array.isArray(out.screenshots)) out.screenshots = [];
                    return out;
                });

                const merged = PAYLOAD.mergeImportedScansAndScreenshots(importObjs);

                const mergedScans = PAYLOAD.ensureUniqueImportedScanIds(
                    PAYLOAD.ensureFindingUidsOnImportedScans(merged.scans)
                );

                // Build final merged payload (matching what the server returns, enough for your UI)
                const baseUrl = (okItems[0]?.parsed?.url) || (urlInput?.value?.trim() || '');
                const scenarioName = '';

                const payload = PAYLOAD.buildWorkflowPayloadBase({
                    url: baseUrl,
                    scenarioName,
                    scans: mergedScans,
                    workflowScreenshots: restoredWorkflowShots,
                    includeScanScreenshots: true,
                    timestamp: new Date().toISOString()
                });

                PAYLOAD.finalizeWorkflowPayload(payload);

                // Restore tokenized scan screenshot dataUrls
                restoreScanDataUrls(payload, scanDataUrlMap);

                // Validate merged payload too
                validateReportOrThrow(payload, 'merged');

                await step('Drawing the report');
                setReportPayload(payload, {fileName: okItems.map(x => x.name).join(', ')});
                await shown('Merged report loaded from staged files.');
                return;
            }

            // ---------- Fallback to server import (current behavior) ----------
            const response = await fetch('/workflow-import?includeScreenshots=true', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({items: parsedObjects})
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.details || 'Import failed');
            }

            const data = await response.json();

            if (!data || !data.ok || !data.payload) {
                throw new Error('Unexpected server response');
            }

            const payload = data.payload;

            restoreScanDataUrls(payload, scanDataUrlMap);

            // Validate merged payload too
            validateReportOrThrow(payload, 'merged');

            // Restore workflow screenshots for UI rendering
            const restored = dedupeScreenshots(screenshots);

            if (restored.length) {
                payload.screenshots = restored;
            } else if (!Array.isArray(payload.screenshots)) {
                payload.screenshots = [];
            }

            await step('Drawing the report');
            setReportPayload(payload, {fileName: okItems.map(x => x.name).join(', ')});
            await shown('Merged report loaded from staged files.');
        } catch (err) {
            console.error('Import error:', err);
            refuse(`Import error: ${String(err?.message || err)}`);
        }
    }

    /* ==================== Config collapse UI ==================== */

    function setConfigExpanded(expanded) {
        if (!configToggleDisableActionBtn || !configContentEl) return;

        configToggleDisableActionBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        configContentEl.hidden = !expanded;

        // The whole header row is the button; only the affordance word changes.
        const word = configToggleDisableActionBtn.querySelector('.config-toggle-word');
        if (word) word.textContent = expanded ? 'Collapse' : 'Expand';
    }

    function setCustomStepsExpanded(expanded) {
        if (!customStepsToggleBtn || !customStepsContentEl) return;
        customStepsToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        customStepsContentEl.hidden = !expanded;
        customStepsToggleBtn.setAttribute('aria-label', expanded ? 'Collapse custom steps' : 'Expand custom steps');
        if (customStepActionsCollapseAllBtn) {
            customStepActionsCollapseAllBtn.hidden = !expanded;
            if (expanded) refreshCustomStepCollapseAllBtn?.();
        }
    }

    function setWorkflowExpanded(expanded) {
        if (!workflowToggleBtn || !workflowContentEl) return;
        workflowToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        workflowContentEl.hidden = !expanded;
        workflowToggleBtn.setAttribute('aria-label', expanded ? 'Collapse workflow' : 'Expand workflow');
        if (stepTreeOpenBtn) stepTreeOpenBtn.hidden = !expanded;
        if (workflowCollapseAllBtn) {
            workflowCollapseAllBtn.hidden = !expanded;
            if (expanded) refreshWorkflowCollapseAllBtn?.();
        }
    }

    /**
     * Which of the Batch, Custom steps and Workflow sections are collapsed,
     * as a saved config keeps it: { batch, customSteps, workflow }, each
     * true when collapsed.
     */
    function getSectionsState() {
        const collapsed = (btn) => (btn ? btn.getAttribute('aria-expanded') !== 'true' : undefined);
        return {
            batch: collapsed($('#batch-toggle')),
            customSteps: collapsed(customStepsToggleBtn),
            workflow: collapsed(workflowToggleBtn),
        };
    }

    /** Puts the sections back as a config saved them; one it does not name stays as it is. */
    function setSectionsState(sections) {
        if (!sections || typeof sections !== 'object') return;
        if (typeof sections.batch === 'boolean') batchPanel?.setExpanded(!sections.batch);
        if (typeof sections.customSteps === 'boolean') setCustomStepsExpanded(!sections.customSteps);
        if (typeof sections.workflow === 'boolean') setWorkflowExpanded(!sections.workflow);
    }

    function focusRuntimeArea() {
        const target = liveStreamEl || logsPanelEl;
        if (!target) return;

        const hadTabindex = target.hasAttribute('tabindex');
        if (!hadTabindex) target.setAttribute('tabindex', '-1');

        target.focus({preventScroll: false});

        if (!hadTabindex) {
            setTimeout(() => target.removeAttribute('tabindex'), 0);
        }
    }

    function initConfigCollapseUi() {
        if (!configToggleDisableActionBtn) return;

        // Ensure initial default (expanded)
        setConfigExpanded(true);

        configToggleDisableActionBtn.addEventListener('click', () => {
            const expanded = configToggleDisableActionBtn.getAttribute('aria-expanded') === 'true';
            setConfigExpanded(!expanded);
        });
    }

    function initCustomStepsCollapseUi() {
        if (!customStepsToggleBtn) return;
        refreshCustomStepCollapseAllBtn = setupCollapseAllStepsButton(customStepActionsCollapseAllBtn, customStepActionsEl);
        setCustomStepsExpanded(false);
        customStepsToggleBtn.addEventListener('click', () => {
            const expanded = customStepsToggleBtn.getAttribute('aria-expanded') === 'true';
            setCustomStepsExpanded(!expanded);
        });
    }

    function initWorkflowCollapseUi() {
        if (!workflowToggleBtn) return;
        refreshWorkflowCollapseAllBtn = setupCollapseAllStepsButton(workflowCollapseAllBtn, actionsBar);
        setWorkflowExpanded(true);
        workflowToggleBtn.addEventListener('click', () => {
            const expanded = workflowToggleBtn.getAttribute('aria-expanded') === 'true';
            setWorkflowExpanded(!expanded);
        });
    }

    function collapseAllCollapsibleGroups(keepOpen = null) {
        const keep = keepOpen instanceof Set ? keepOpen : new Set();
        const roots = [actionsBar, customStepActionsEl];
        roots.forEach((root) => {
            if (!root) return;
            root.querySelectorAll('.line').forEach((line) => {
                if (keep.has(line)) return;
                collapseLineIfExpanded(line);
            });
        });
    }

    function selectCustomStepById(customStepId) {
        const id = String(customStepId || '').trim();
        if (!id) return false;
        const idx = customStepsData.findIndex((step) => String(step?.id || '').trim() === id);
        if (idx < 0) return false;
        if (idx !== selectedCustomStepIndex) selectCustomStep(idx);
        return true;
    }

    function resolveLineByStepRef(stepRef) {
        if (!stepRef || typeof stepRef !== 'object') return null;
        const path = Array.isArray(stepRef.path)
            ? stepRef.path.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
            : [];
        if (!path.length) return null;

        const rootContainer = stepRef.scope === 'custom-step' ? customStepActionsEl : actionsBar;
        const arrayTrail = Array.isArray(stepRef.arrayTrail) ? stepRef.arrayTrail : [];
        return resolveLineByPathFromContainer(rootContainer, path, arrayTrail, 0);
    }

    function goToStep(stepRef) {
        if (!stepRef || typeof stepRef !== 'object') return false;
        setConfigExpanded(true);
        setWorkflowExpanded(false);
        setCustomStepsExpanded(false);

        if (stepRef.scope === 'custom-step') {
            setCustomStepsExpanded(true);
            const ok = selectCustomStepById(stepRef.customStepId);
            if (!ok) return false;
        } else {
            setWorkflowExpanded(true);
        }

        const resolved = resolveLineByStepRef(stepRef);
        if (!resolved || !resolved.line) return false;

        const keepOpen = new Set([resolved.line, ...resolved.ancestors]);
        collapseAllCollapsibleGroups(keepOpen);
        resolved.ancestors.forEach(expandLineIfCollapsed);
        expandLineIfCollapsed(resolved.line);
        focusLineForNavigation(resolved.line);
        return true;
    }

    function buildCurrentStepTreeModel() {
        const workflowActions = actionsBuilder?.getValue({ validate: false, maskValues: 'text' })?.value || [];
        const customStepsState = readCustomStepsFromUi({ validate: false });
        const customSteps = customStepsState?.ok && Array.isArray(customStepsState.value) ? customStepsState.value : [];
        const { byId: customStepsById, nameById: customStepNamesById } = buildCustomStepMaps(customSteps);

        return {
            workflow: buildActionTreeNodes(workflowActions, { scope: 'workflow' }, [], [], {
                inlineCustomSteps: true,
                customStepsById,
                customStepNamesById
            }),
            customSteps: customSteps.map((step) => ({
                id: String(step?.id || '').trim(),
                name: String(step?.name || '').trim(),
                nodes: buildActionTreeNodes(step?.actions || [], {
                    scope: 'custom-step',
                    customStepId: String(step?.id || '').trim()
                }, [], [], {
                    inlineCustomSteps: false,
                    customStepsById,
                    customStepNamesById
                })
            }))
        };
    }

    function renderStepTreeList(nodes, rootClass = 'step-tree-list') {
        const ul = createEl('ul', { className: rootClass });
        nodes.forEach((node) => {
            const btn = createEl('button', {
                type: 'button',
                className: 'step-tree-node',
                title: node.label
            }, node.label);

            btn.addEventListener('click', () => {
                const ok = goToStep(node.ref);
                if (ok) closeStepTreeDialog();
            });

            const liChildren = [btn];
            if (Array.isArray(node.children) && node.children.length) {
                liChildren.push(renderStepTreeList(node.children, 'step-tree-list'));
            }
            ul.appendChild(createEl('li', {}, liChildren));
        });
        return ul;
    }

    function renderStepTreeDialog() {
        if (!stepTreeContainerEl) return;
        stepTreeContainerEl.innerHTML = '';

        const model = buildCurrentStepTreeModel();
        const hasWorkflow = Array.isArray(model.workflow) && model.workflow.length > 0;
        const hasCustom = Array.isArray(model.customSteps) && model.customSteps.some((s) => Array.isArray(s.nodes) && s.nodes.length > 0);

        if (!hasWorkflow && !hasCustom) {
            stepTreeContainerEl.appendChild(createEl('p', { className: 'step-tree-empty' }, 'No steps configured yet.'));
            return;
        }

        if (hasWorkflow) {
            const section = createEl('section', {}, [
                createEl('h4', { className: 'step-tree-section-title' }, 'Workflow'),
                renderStepTreeList(model.workflow, 'step-tree-list step-tree-list--root')
            ]);
            stepTreeContainerEl.appendChild(section);
        }

        if (hasCustom) {
            const section = createEl('section', {}, [
                createEl('h4', { className: 'step-tree-section-title' }, 'Custom steps')
            ]);

            stepTreeContainerEl.appendChild(section);
            model.customSteps.forEach((step) => {
                if (!Array.isArray(step.nodes) || !step.nodes.length) return;
                const title = step.name && step.name !== step.id
                    ? `Custom step: ${step.id} — ${step.name}`
                    : `Custom step: ${step.id}`;
                const customStepHeading = createEl('h5', { className: 'step-tree-section-title' }, title);
                const customStepConfig = renderStepTreeList(step.nodes, 'step-tree-list step-tree-list--root');
                stepTreeContainerEl.appendChild(customStepHeading);
                stepTreeContainerEl.appendChild(customStepConfig);
            });
        }
    }

    function closeStepTreeDialog() {
        if (!stepTreeDialogEl) return;
        if (typeof stepTreeDialogEl.close === 'function' && stepTreeDialogEl.open) {
            stepTreeDialogEl.close();
            return;
        }
        stepTreeDialogEl.removeAttribute('open');
    }

    function openStepTreeDialog() {
        if (!stepTreeDialogEl) return;
        renderStepTreeDialog();
        if (typeof stepTreeDialogEl.showModal === 'function') {
            stepTreeDialogEl.showModal();
            return;
        }
        stepTreeDialogEl.setAttribute('open', 'open');
    }

    function setupStepTreeDialog() {
        if (!stepTreeOpenBtn || !stepTreeDialogEl || !stepTreeCloseBtn) return;
        stepTreeOpenBtn.append(svgIcon('step-tree'));
        stepTreeOpenBtn.addEventListener('click', openStepTreeDialog);
        stepTreeCloseBtn.addEventListener('click', closeStepTreeDialog);
        stepTreeDialogEl.addEventListener('click', (event) => {
            if (event.target === stepTreeDialogEl) closeStepTreeDialog();
        });
    }

    /** Linkify URLs and write to log area */
    function appendLog(message, type, opts) {
        if (!logsPanelEl || !message) return;

        logToolbarEl?.classList.add('is-visible');

        const entry = document.createElement('div');
        entry.className = 'log-panel-entry';
        if (type) entry.classList.add('log-panel-entry-' + String(type));

        const time = new Date();
        let timeLabel;
        try {
            timeLabel = time.toLocaleTimeString([], {hour12: false});
        } catch {
            timeLabel = time.toTimeString().slice(0, 8);
        }

        let depthPrefix = '';
        const depthMatch = /\#d(\d+)/.exec(message);
        if (depthMatch) depthPrefix = indentPrefix(Number(depthMatch[1]));
        const cleanMessage = message.replace(/\s*\#d\d+/, '');

        const htmlMessage = linkifyUrlsToHtml(cleanMessage);

        entry.innerHTML = `[${timeLabel}] ${depthPrefix}${htmlMessage}`;

        // "Go to config" button, live action-start lines only (stepRef comes from
        // progress-processor.js's resolveStepRefForLogEntry).
        const stepRef = opts && opts.stepRef;
        if (type === 'action-start' && stepRef) {
            entry.appendChild(document.createTextNode(' '));
            const goBtn = createEl('button', {
                type: 'button',
                className: 'log-step-link',
                title: 'Go to step in configuration'
            }, 'Go to config');
            goBtn.addEventListener('click', () => {
                goToStep(stepRef);
            });
            entry.appendChild(goBtn);
        }

        // Stamped through from renderActionLog so the "Collected metadata" panel can jump to
        // the matching log line for a collectOutput step (shared actionPath cross-link, see
        // docs/design/workflow-collected-metadata-design.md §6.4).
        if (opts && typeof opts.actionPath === 'string' && opts.actionPath) {
            entry.dataset.actionPath = opts.actionPath;
        }

        logsPanelEl.appendChild(entry);
        scrollLogsToEnd();
        return entry;
    }

    // Once a frame, not once a line: reading scrollHeight lays out the whole
    // log, and a long run's log arrives thousands of lines at a time.
    let logsScrollFrame = 0;
    function scrollLogsToEnd() {
        if (logsScrollFrame) return;
        logsScrollFrame = requestAnimationFrame(() => {
            logsScrollFrame = 0;
            logsPanelEl.scrollTop = logsPanelEl.scrollHeight;
        });
    }

    // Plain-text rendering of a log entry, stripped of the "Go to config" button
    // and any other interactive controls appended alongside the message.
    function logEntryText(entry) {
        const clone = entry.cloneNode(true);
        clone.querySelectorAll('button').forEach((btn) => btn.remove());
        return (clone.textContent || '').trim();
    }

    async function copyLogLines(count) {
        if (!logsPanelEl) return;
        const entries = Array.from(logsPanelEl.querySelectorAll('.log-panel-entry'));
        const wanted = Number.isFinite(count) ? entries.slice(-count) : entries;
        const toast = globalThis.A11Y_TOAST;

        if (!wanted.length) {
            toast?.showToast('No log lines to copy.', {type: 'warning'});
            return;
        }

        const text = wanted.map(logEntryText).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            toast?.showToast(`Copied ${wanted.length} log line${wanted.length === 1 ? '' : 's'}.`, {type: 'success'});
        } catch {
            toast?.showToast('Could not copy logs to clipboard.', {type: 'error'});
        }
    }

    logCopyLastBtn?.addEventListener('click', () => copyLogLines(30));
    logCopyAllBtn?.addEventListener('click', () => copyLogLines());

    function setStatusRun(message, type) {
        if (!statusRunEl) return;
        statusRunEl.textContent = message || '';
        statusRunEl.className = 'status';
        if (type) statusRunEl.classList.add(type);
        appendLog(message, type);
    }

    function setStatusReport(message, type) {
        if (!statusReportEl) return;
        statusReportEl.textContent = message || '';
        statusReportEl.className = 'status';
        if (type) statusReportEl.classList.add(type);
    }

    /**
     * Unified UI state setter.
     * Keeps behavior, centralizes button states and status messaging.
     */
    function setUiState(state, message = '') {
        const st = String(state || '').toLowerCase();

        if (st === 'running') {
            setStatusRun(message || 'Running, please wait...', STATUS.BUSY);
            if (retryUntrustedButton) retryUntrustedButton.hidden = true;
            runResultToStatus = false;
            runResultText = '';
            document.body.classList.add('is-running');
            document.body.classList.remove('is-done');

            setConfigExpanded(false);

            focusRuntimeArea();

            scanButton.setAttribute('aria-disabled', 'true');
            dryRunButton?.setAttribute('aria-disabled', 'true');
            cancelButton.setAttribute('aria-disabled', 'true'); // enabled once runId exists
            summaryEl.textContent = '';
            lastWorkflowResponse = null;
            setRunTabBadge(false);
            setRunTabSpinner(true);
            return;
        }

        if (st === 'done') {
            setStatusRun(message || 'Finished', STATUS.OK);
            runResultToStatus = !/^Dry run/.test(message || '');
            document.body.classList.remove('is-running');
            document.body.classList.add('is-done');


            scanButton.setAttribute('aria-disabled', 'false');
            dryRunButton?.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            setRunTabSpinner(false);
            return;
        }

        if (st === 'cancelled') {
            setStatusRun(message || 'Cancelled', STATUS.WARNING);
            document.body.classList.remove('is-running');
            document.body.classList.remove('is-done');

            scanButton.setAttribute('aria-disabled', 'false');
            dryRunButton?.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            setRunTabSpinner(false);
            return;
        }

        if (st === 'cancelling') {
            setStatusRun(message || 'Cancelling... finishing current action', STATUS.WARNING);

            scanButton.setAttribute('aria-disabled', 'true');
            dryRunButton?.setAttribute('aria-disabled', 'true');
            cancelButton.setAttribute('aria-disabled', 'true');
            return;
        }

        if (st === 'idle') {
            if (message) setStatusRun(message, STATUS.OK);
            document.body.classList.remove('is-running');
            document.body.classList.remove('is-done');


            scanButton.setAttribute('aria-disabled', 'false');
            dryRunButton?.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            document.body.classList.remove('is-running', 'is-done');
            setConfigExpanded(true);

            return;
        }

        if (st === 'error') {
            if (message) setStatusRun(message, STATUS.ERROR);
            scanButton.setAttribute('aria-disabled', 'false');
            dryRunButton?.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            setRunTabSpinner(false);
            return;
        }

        // default fallback, safe
        if (message) setStatusRun(message, STATUS.INFO);
    }

    /* ==================== Screenshots ==================== */

    // In screenshots-ui.js.
    const screenshotsUi = createScreenshotsUi(app);

    // ---- Scan sorting ----
    // Sort is a stable ordering of every scan card, applied by the shared module
    // that reads the data-sort-* baked onto each card. It is independent of the
    // tag filter and include state, which only change visibility. The same
    // module runs in exported reports.
    let activeScanSort = 'default';

    function scanSortContainers() {
        const containers = new Set();
        document.querySelectorAll('[data-sort-order]').forEach((card) => {
            if (card.parentElement) containers.add(card.parentElement);
        });
        return [...containers];
    }

    function applyScanSort() {
        const sort = globalThis.A11Y_SCAN_SORT;
        if (!sort) return 0;
        const containers = scanSortContainers();
        containers.forEach((c) => sort.sortContainer(c, activeScanSort));
        return containers.length;
    }

    // The sort select and the hide-excluded button live in the summary panel,
    // which is rebuilt on every render, so their handlers are delegated.
    function buildSummaryControlsHtml() {
        const sort = globalThis.A11Y_SCAN_SORT;
        const hiding = resultsContainer.classList.contains('hide-excluded-scans');
        const hideBtn =
            `<button type="button" id="hide-excluded-scans-btn" class="secondary-button" ` +
            `data-hide-excluded aria-pressed="${hiding}">${hiding ? 'Show excluded' : 'Hide excluded'}</button>`;

        if (!sort) return hideBtn;

        const options = sort.SORT_KEYS
            .map((k) => `<option value="${k.id}"${k.id === activeScanSort ? ' selected' : ''}>${escapeHtml(k.label)}</option>`)
            .join('');
        const sortCtl =
            `<label class="scan-sort"><span class="scan-sort__label">Sort</span>` +
            `<select id="scan-sort-select" data-scan-sort aria-label="Sort scans">${options}</select></label>`;

        return sortCtl + hideBtn;
    }

    document.addEventListener('change', (e) => {
        const select = e.target.closest?.('[data-scan-sort]');
        if (!select) return;
        activeScanSort = select.value || 'default';
        const sorted = applyScanSort();
        const sort = globalThis.A11Y_SCAN_SORT;
        const label = sort ? sort.keyById(activeScanSort).label : activeScanSort;
        const toast = globalThis.A11Y_TOAST;
        if (toast) {
            toast.showToast(
                sorted > 0 ? `Sorted by: ${label}` : 'Sorting applies to the per-scan view; nothing to reorder here.',
                { type: sorted > 0 ? 'info' : 'warning' }
            );
        }
    });

    document.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-hide-excluded]');
        if (!btn) return;
        const isHiding = !resultsContainer.classList.contains('hide-excluded-scans');
        resultsContainer.classList.toggle('hide-excluded-scans', isHiding);
        btn.textContent = isHiding ? 'Show excluded' : 'Hide excluded';
        btn.setAttribute('aria-pressed', String(isHiding));

        const message = isHiding
            ? 'Excluded scans are now hidden from the summary and results.'
            : 'Excluded scans are now shown in the summary and results.';
        if (resultsState.activeMode === 'report') setStatusReport(message, STATUS.OK);
        else setStatusRun(message, STATUS.OK);
    });

    // The Compare tab (compare-tab.js).
    const compareTab = createCompareTab(app);

    // ---- "View all scans" dialog interactions (wired once) ----
    // The dialog + trigger button are rebuilt on every report refresh, so these
    // listeners are delegated on the document and keyed by data-attribute. The
    // exported report reproduces the same behaviour in report/report.js.
    function getAllScansDialog() {
        return document.getElementById('all-scans-dialog');
    }
    document.addEventListener('click', (e) => {
        const opener = e.target.closest?.('[data-all-scans-open]');
        if (opener) {
            const dlg = getAllScansDialog();
            if (dlg && typeof dlg.showModal === 'function') {
                e.preventDefault();
                try { dlg.showModal(); } catch { /* already open */ }
            }
            return;
        }

        const closer = e.target.closest?.('[data-all-scans-close]');
        if (closer) {
            const dlg = getAllScansDialog();
            if (dlg?.open) dlg.close();
            return;
        }

        // Click on a card's screenshot link: close the dialog, then let the
        // anchor's #sc-<id> navigation carry the view to the result section.
        // (The scanned-page URL link is a normal external link and is left
        // alone.)
        const thumb = e.target.closest?.('.all-scans-thumb');
        if (thumb) {
            const dlg = getAllScansDialog();
            if (dlg?.open) dlg.close();
            return;
        }

        // Click on the dialog backdrop (the <dialog> itself) closes it.
        if (e.target instanceof HTMLDialogElement && e.target.id === 'all-scans-dialog') {
            e.target.close();
        }
    });

    const runSummary = createRunSummaryRenderer({
        appendLog,
        escapeHtml,
        escapeAttr,
        summaryEl,
        STATUS
    });

    /* ==================== Events ==================== */

    // In page-events.js.
    createPageEvents(app);

    /* ==================== Run queue ==================== */

    // In run-queue-ui.js.
    const runQueueUi = createRunQueueUi(app);


    /* ==================== Watching a queued run ==================== */

    // In queue-run-watch.js.
    const queueRunWatch = createQueueRunWatch(app);

    /* ==================== Batch ==================== */

    /** The form's URL and workflow as they stand, for checking batch rows against. */
    function getWorkflowForBatch() {
        let url = urlInput.value.trim();
        if (url.length && !url.startsWith('http')) url = 'http://' + url;
        const actionsValue = actionsBuilder ? actionsBuilder.getValue({validate: false, maskValues: 'redact'}) : null;
        const customStepsResult = getCustomStepsForConfigState();
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
        if (!runQueueUi.queuePanel) return false;
        const request = prepareRunRequest({markMasked: true, fallbackUrl: runs[0]?.url || ''});
        if (!request) return false;

        let baseConfig = null;
        // The batch's own configuration, Batch section and all: kept beside
        // its results, so its download sets the batch up again.
        let batchConfig = null;
        try {
            baseConfig = cfgIO ? cfgIO.buildConfigFile({includeBatch: false}) : null;
            batchConfig = cfgIO ? cfgIO.buildConfigFile({includeBatch: true}) : null;
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
            await runQueueUi.queuePanel.add(items, {name: scenarioInput ? scenarioInput.value.trim() : '', config: batchConfig});
            setStatusRun(`Queued a batch of ${items.length} run${items.length === 1 ? '' : 's'}.`, STATUS.OK);
            return true;
        } catch (err) {
            setStatusRun(`Could not add the batch to the queue: ${String(err?.message || err)}`, STATUS.ERROR);
            return false;
        }
    }

    /** Run says what it will do: run the workflow once, or run the batch. */
    function onBatchStatus(status) {
        refreshRunButton(status);
        // While the batch is on, a step that would hide a row variable is a
        // field error in the step editors; off, those names are ordinary.
        const names = status.active ? status.varNames : [];
        actionsBuilder?.setReservedVariableNames?.(names);
        customStepActionsBuilder?.setReservedVariableNames?.(names);
    }

    const BATCH_BUSY = 'A batch is already running. Wait for it to finish, or cancel it, before running another.';

    /**
     * Run says what it will do, and with the batch on it waits while another
     * batch runs (one batch per folder). A single run from the form is never
     * blocked by the queue. While a single run is going, setUiState owns the
     * button's disabled state; this only adds or lifts the batch block.
     */
    function refreshRunButton(status = batchPanel?.getStatus()) {
        if (!scanButton) return;
        const blocked = !!(status && status.active && runQueueUi.queueBusy);
        scanButton.textContent = blocked ? 'Run batch (another batch is running)' : (runLabelFor(status) || 'Run');
        if (currentRunId) return;
        if (blocked) {
            scanButton.setAttribute('aria-disabled', 'true');
            scanButton.dataset.blockedReason = BATCH_BUSY;
        } else if (scanButton.dataset.blockedReason) {
            scanButton.setAttribute('aria-disabled', 'false');
            delete scanButton.dataset.blockedReason;
        }
    }

    /**
     * Run with the batch on: queue one run per row and go to the queue tab. A
     * batch cannot show N reports on this page, so it always goes through the
     * queue, where each result is saved.
     */
    async function runBatch(status) {
        if (runQueueUi.queueBusy) {
            setStatusRun(BATCH_BUSY, STATUS.ERROR);
            return;
        }
        if (status.state !== 'ready') {
            batchPanel.reveal();
            setStatusRun(status.state === 'empty'
                ? 'Paste the workflows in the Batch section, or disable the batch to run the workflow once.'
                : `The batch has ${status.problems.length} problem${status.problems.length === 1 ? '' : 's'}, listed under its workflows.`, STATUS.ERROR);
            return;
        }
        if (await onQueueBatch(status.runs)) {
            batchPanel.noteQueued(status.runs.length);
            tabsmode?.setActive('queue');
        }
    }

    const batchRowsEl = $('#batch-rows');
    const batchPanel = batchRowsEl ? createBatchPanel({
        toggle: $('#batch-toggle'),
        content: $('#batch-content'),
        badge: $('#batch-count-badge'),
        useButton: $('#batch-use'),
        rowsInput: batchRowsEl,
        namePatternInput: $('#batch-name-pattern'),
        fileButton: $('#batch-file-btn'),
        fileInput: $('#batch-file'),
        checkEl: $('#batch-check'),
        problemsEl: $('#batch-problems'),
        getWorkflow: getWorkflowForBatch,
        onChange: onBatchStatus,
    }) : null;

    // Files can be dropped where the app loads them, as well as picked with
    // the button there (src/js/file-drop.js). Inside the run workflow tab,
    // the Batch section takes rows; anywhere else in it, a configuration (which
    // itself recognises a rows file and passes it to the Batch section).
    attachFileDrop($('#pane-open .open-results-panel'), {
        input: resultsFileInput,
        label: 'Drop to add these reports',
        kind: 'a JSON report or a report zip',
        onRefuse: (message) => setStatusReport(message, STATUS.ERROR),
        isBusy: () => isBusy(resultsFileBtn) || isBusy(reportFilesLoadBtn),
    });
    attachFileDrop($('#pane-compare'), {
        input: compareInput,
        label: 'Drop to compare these reports',
        kind: 'a JSON report or a zip of reports',
        onRefuse: (message) => compareTab.setCompareStatus(message, STATUS.ERROR),
        isBusy: () => !!compareTab.compareLoad,
    });
    attachFileDrop($('#pane-run'), {
        input: configFileEl,
        label: 'Drop to load this configuration',
        kind: 'a JSON configuration',
        onRefuse: (message) => setStatusRun(message, STATUS.ERROR),
    });
    attachFileDrop($('#batch-content'), {
        input: $('#batch-file'),
        label: 'Drop to load these workflows',
        kind: 'a JSON file of workflows',
        onRefuse: (message) => setStatusRun(message, STATUS.ERROR),
    });

    document.addEventListener('a11ylab:modechange', (e) => {
        const mode = e?.detail?.mode;
        // The live-totals counter belongs to the Run workflow tab. Hide it (without
        // discarding the tally) whenever another top-level tab is active, and
        // bring it back on return. Dispatched on initial load too, so this also
        // sets the correct starting visibility.
        liveUi.liveTotals.setHidden(mode !== 'run');
        // The Compare tab owns its own pane and doesn't use the run/report
        // results area — hide the shared results while it's active.
        document.body.classList.toggle('compare-mode-active', mode === 'compare');
        // The queue tab, like Compare, owns its pane and has no results bucket.
        document.body.classList.toggle('queue-mode-active', mode === 'queue');
        runQueueUi.queuePanel?.setVisible(mode === 'queue');
        if (mode === 'queue') {
            storeActiveMode('queue');
            return;
        }
        if (mode === 'compare') {
            // Compare has no results bucket, so setActiveMode (which persists the
            // tab) is skipped — persist the choice here so it restores on reload.
            storeActiveMode('compare');
            return;
        }
        setActiveMode(mode, {deferRender: !!e?.detail?.fromClick});
    });

    window.addEventListener('message', async (ev) => {
        // Security: only accept same-origin
        if (ev.origin !== window.location.origin) return;

        const msg = ev.data;
        if (!msg || msg.type !== 'A11Y_IMPORT_PAYLOAD') return;

        const payload = msg.payload;

        tabsmode.setActive('report');

        // Optional: switch to report tab automatically so user sees the staging area
        setActiveMode('report');

        // Stage it like a file
        const name =
            (msg && typeof msg.fileName === 'string' && msg.fileName.trim())
                ? msg.fileName.trim()
                : 'extension-report.json';

        stageReportObject(payload, name);

        // Optional: focus the staging area
        focusSafely(resultsFileBtn);

        // For auto-load, uncomment:
        // await loadStagedReportsIntoOpenReport();
    });

    if (reportFilesListEl) {
        reportFilesListEl.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-report-file-key]');
            if (!btn) return;

            const key = btn.getAttribute('data-report-file-key') || '';
            if (!key) return;

            // Expand/collapse per file
            if (btn.getAttribute('data-report-file-toggle') === '1') {
                const item = stagedReportFiles.find(x => x.key === key);
                if (!item || !item.ok) return;

                const token = captureStagingFocusToken();
                item.expanded = !item.expanded;
                renderStagedReportFilesList();
                restoreStagingFocus(token);
                return;
            }

            // Section select all/none
            const sectionSelect = btn.getAttribute('data-report-section-select');
            const section = btn.getAttribute('data-report-section');

            if ((sectionSelect === 'all' || sectionSelect === 'none') && (section === 'scans' || section === 'shots')) {
                const item = stagedReportFiles.find(x => x.key === key);
                if (!item || !item.ok || !item.parsed) return;

                const want = sectionSelect === 'all';

                if (section === 'scans') {
                    const scans = Array.isArray(item.parsed.scans) ? item.parsed.scans : [];
                    item.includeScans = scans.map(() => want);
                } else {
                    const shots = Array.isArray(item.parsed.screenshots) ? item.parsed.screenshots : [];
                    item.includeActionScreenshots = shots.map(() => want);
                }

                const token = captureStagingFocusToken();
                renderStagedReportFilesList();
                restoreStagingFocus(token);
                return;
            }

            const move = btn.getAttribute('data-report-file-move');
            if (move === '-1' || move === '1') {
                const token = captureStagingFocusToken();
                moveStagedReportFile(key, Number(move)); // this already re-renders
                // moveStagedReportFile will restore focus if you applied (A). If you did not, keep next 2 lines:
                // renderStagedReportFilesList();
                restoreStagingFocus(token);
                setStatusReport(move === '-1' ? 'Moved file up.' : 'Moved file down.', STATUS.OK);
                return;
            }

            if (btn.getAttribute('data-report-file-remove') === '1') {
                const token = captureStagingFocusToken();

                // Compute fallback: next file remove button, else previous
                const beforeIndex = stagedReportFiles.findIndex(x => x.key === key);
                const nextItem = stagedReportFiles[beforeIndex + 1] || null;
                const prevItem = stagedReportFiles[beforeIndex - 1] || null;

                const fallbackSelector =
                    nextItem
                        ? `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(nextItem.key)}"]`
                        : prevItem
                            ? `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(prevItem.key)}"]`
                            : null;

                stagedReportFiles = stagedReportFiles.filter(x => x.key !== key);
                renderStagedReportFilesList();

                // If list became empty, focus Add report(s)
                if (stagedReportFiles.length === 0) {
                    focusSafely(resultsFileBtn);
                } else {
                    restoreStagingFocus(token, fallbackSelector);
                }

                setStatusReport('File removed from staged list.', STATUS.OK);
            }
        });

        reportFilesListEl.addEventListener('change', (event) => {
            const input = event.target;
            if (!input || input.tagName !== 'INPUT' || input.type !== 'checkbox') return;

            const key = input.getAttribute('data-report-file-key') || '';
            if (!key) return;

            const item = stagedReportFiles.find(x => x.key === key);
            if (!item || !item.ok || !item.parsed) return;

            const scanIdxRaw = input.getAttribute('data-report-scan-idx');
            const shotIdxRaw = input.getAttribute('data-report-shot-idx');

            if (scanIdxRaw !== null) {
                const idx = Number(scanIdxRaw);
                if (!Number.isFinite(idx) || idx < 0) return;

                if (!Array.isArray(item.includeScans)) {
                    const scans = Array.isArray(item.parsed.scans) ? item.parsed.scans : [];
                    item.includeScans = scans.map(() => true);
                }

                if (idx >= item.includeScans.length) return;
                item.includeScans[idx] = !!input.checked;

                updateStagedFileSummaryInPlace(key);
                return;
            }

            if (shotIdxRaw !== null) {
                const idx = Number(shotIdxRaw);
                if (!Number.isFinite(idx) || idx < 0) return;

                if (!Array.isArray(item.includeActionScreenshots)) {
                    const shots = Array.isArray(item.parsed.screenshots) ? item.parsed.screenshots : [];
                    item.includeActionScreenshots = shots.map(() => true);
                }

                if (idx >= item.includeActionScreenshots.length) return;
                item.includeActionScreenshots[idx] = !!input.checked;

                updateStagedFileSummaryInPlace(key);
            }
        });
    }

    if (reportFilesClearBtn) {
        reportFilesClearBtn.addEventListener('click', () => {
            stagedReportFiles = [];
            renderStagedReportFilesList();
            focusSafely(resultsFileBtn); // next logical action
            setStatusReport('Staged file list cleared.', STATUS.OK);
        });
    }

    if (reportFilesLoadBtn) {
        // The load under way, in the activity panel: a press meanwhile shows it.
        let loading = null;
        reportFilesLoadBtn.addEventListener('click', () => {
            if (isBusy(reportFilesLoadBtn)) {
                loading?.reveal();
                return;
            }
            runBusy(reportFilesLoadBtn, async () => {
                setStatusReport('Loading the report…', STATUS.BUSY);
                await getActivity().run('Open report: load', (task) => {
                    loading = task;
                    return loadStagedReportsIntoOpenReport(task);
                }, {rethrow: false, quiet: true});
                loading = null;
            });
        });
    }

    // The files being read, in the activity panel: a press meanwhile shows it.
    let readingReportFiles = null;
    if (resultsFileBtn && resultsFileInput) {
        resultsFileBtn.addEventListener('click', () => {
            if (isBusy(resultsFileBtn)) readingReportFiles?.reveal();
            else resultsFileInput.click();
        });
    }

    if (groupingFileBtn) {
        groupingFileBtn.hidden = true;
        groupingFileBtn.setAttribute('aria-hidden', 'true');
    }

    if (groupingScanFileBtn) {
        groupingScanFileBtn.hidden = true;
        groupingScanFileBtn.setAttribute('aria-hidden', 'true');
    }

    document.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().includes('MAC');
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
        if (!ctrlOrCmd) return;

        // Let native undo/redo work in text fields, textareas, contenteditable, etc.
        if (shouldIgnoreGlobalUndoRedo(e)) return;

        if (e.key.toLowerCase() !== 'z') return;

        // Route Ctrl/Cmd+Z to whichever undo domain focus is currently in:
        // the custom step's own action list, the custom-steps list itself
        // (create/remove/rename), or the main workflow — each has its own
        // independent history. Order matters: the action-list check must run
        // before the broader custom-steps-panel one, since it's nested inside it.
        const active = document.activeElement;
        const inCustomStepActions = !!(customStepActionsEl && active && customStepActionsEl.contains(active));
        const inCustomStepsPanel = !!(customStepsContentEl && active && customStepsContentEl.contains(active));

        e.preventDefault();

        if (inCustomStepActions && customStepActionsBuilder) {
            const atBaseline = customStepHistoryBaselineSig && getCustomStepActionsSig() === customStepHistoryBaselineSig;
            if (e.shiftKey) customStepActionsBuilder.redo();
            else if (!atBaseline) customStepActionsBuilder.undo();
            syncCustomStepActionsHistoryButtons();
            focusCustomStepActionsRegion();
        } else if (inCustomStepsPanel) {
            if (e.shiftKey) redoCustomSteps();
            else undoCustomSteps();
        } else if (actionsBuilder) {
            const atBaseline = historyBaselineSig && getActionsSig() === historyBaselineSig;
            if (e.shiftKey) actionsBuilder.redo();
            else if (!atBaseline) actionsBuilder.undo();
            syncHistoryButtons();
        }
    });

    if (resultsFileInput) {
        resultsFileInput.addEventListener('change', async (event) => {
            const input = event.target;
            const files = Array.from(input.files || []);
            input.value = ''; // always reset so same file selection triggers change again

            if (!files.length) return;
            // What is picked opens at once: one report on its own, as one
            // given by address does (and the next one picked the same way
            // takes its place), several merged with all their scans. The list
            // stays, to leave scans or files out and Load selected again.
            if (reportOpenedAlone && stagedReportFiles.length === 1 && stagedReportFiles[0] === reportOpenedAlone) {
                stagedReportFiles = [];
            }
            reportOpenedAlone = null;
            const listedBefore = stagedReportFiles.length;
            const allReports = await stageReportFiles(files);
            if (!allReports) return;
            if (listedBefore === 0 && stagedReportFiles.length === 1) reportOpenedAlone = stagedReportFiles[0];
            reportFilesLoadBtn?.click();
        });
    }

    // Stages report files in the open report tab: reads and checks each now,
    // and loads none yet. The file picker and a report given by URL
    // (openFromQuery) both come through here. -> true when every file is a
    // report.
    async function stageReportFiles(files) {
        {
            // Stage: parse + validate now, do not import yet. A large file
            // takes a while to read, so say so before starting.
            setStatusReport(files.length === 1 ? `Reading ${files[0].name}…` : `Reading ${files.length} files…`, STATUS.BUSY);
            setBusy(resultsFileBtn, true);
            const task = getActivity().start(files.length === 1 ? `Open report: read ${files[0].name}` : `Open report: read ${files.length} files`, {quiet: true});
            readingReportFiles = task;
            await afterPaint();
            // A report package or any zip of reports (report-package.js) gives
            // each report it holds, with its pictures, as a file of its own.
            const sources = [];
            for (const file of files) {
                if (!isZipFile(file)) {
                    sources.push(file);
                    continue;
                }
                const reading = task.step(`Reading ${file.name}`);
                await afterPaint();
                try {
                    const read = await readCompareZip(window.JSZip, file);
                    // A comparison saved with its reports gives its reports.
                    const found = read.kind === 'comparison'
                        ? read.reports.map((r) => ({name: r.name, text: JSON.stringify(r.json)}))
                        : read.files;
                    for (const f of found) sources.push(reportInZip(file, f));
                    reading.done(`${found.length} report${found.length === 1 ? '' : 's'}`);
                } catch (err) {
                    reading.warn(String(err?.message || err));
                    stagedReportFiles.push({
                        key: makeFileKey(file), file, name: file.name, size: file.size, lastModified: file.lastModified,
                        ok: false, error: String(err?.message || err), parsed: null, expanded: false,
                        includeScans: null, includeActionScreenshots: null
                    });
                }
            }
            for (const file of sources) {
                const key = makeFileKey(file);

                // Deduplicate exact same file selection
                if (stagedReportFiles.some(x => x.key === key)) continue;

                const checking = task.step(`Checking ${file.name}`);
                await afterPaint();
                try {
                    const text = await file.text();

                    let json;
                    try {
                        json = JSON.parse(String(text || ''));
                    } catch {
                        throw new Error('Invalid JSON');
                    }

                    // Keep your existing file-based key, but stage using the same shape
                    const entry = {
                        key,
                        file,
                        name: file.name,
                        size: file.size,
                        lastModified: file.lastModified,
                        ok: false,
                        error: null,
                        parsed: null,
                        expanded: false,
                        includeScans: null,
                        includeActionScreenshots: null
                    };

                    validateReportOrThrow(json, file.name);

                    entry.ok = true;
                    entry.parsed = json;
                    initEntrySelectionsFromParsed(entry);

                    stagedReportFiles.push(entry);
                    prepareSpareReport(entry, text);
                    checking.done();
                } catch (err) {
                    checking.warn(String(err?.message || err));
                    stagedReportFiles.push({
                        key,
                        file,
                        name: file.name,
                        size: file.size,
                        lastModified: file.lastModified,
                        ok: false,
                        error: String(err?.message || err),
                        parsed: null,
                        expanded: false,
                        includeScans: null,
                        includeActionScreenshots: null
                    });
                }
            }
            setBusy(resultsFileBtn, false);

            renderStagedReportFilesList();

            const total = stagedReportFiles.length;
            const okCount = stagedReportFiles.filter(x => x.ok).length;
            const badCount = total - okCount;

            const staged = badCount
                ? `Files staged. ${okCount} valid, ${badCount} invalid. Remove or fix invalid files before loading.`
                : `Files staged. ${okCount} ready to load.`;
            setStatusReport(staged, badCount ? STATUS.WARNING : STATUS.OK);
            task.done(staged);
            readingReportFiles = null;
            return badCount === 0;
        }
    }

    if (groupingFileInput) {
        groupingFileInput.addEventListener('change', async (event) => {
            const input = event.target;
            const file = input?.files?.[0] || null;

            const mode = groupingUi.groupingPickerTargetMode || resultsState.activeMode;
            groupingUi.groupingPickerTargetMode = null;

            // Always reset so picking the same file again triggers change
            input.value = '';

            if (!file) {
                groupingUi.setSelectedBuiltInGroupingId(groupingUi.getLastResolvedGroupingSelectionId(mode), mode);
                groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                groupingUi.applySelectedBuiltInGrouping(mode);
                return;
            }

            function validateGroupingForUi(obj) {
                if (!Array.isArray(obj)) return {ok: false, message: 'Grouping JSON must be an array.'};

                const cleaned = [];

                for (let i = 0; i < obj.length; i++) {
                    const {item, error} = cleanGroupingItem(obj[i], i);
                    if (error) return {ok: false, message: error};
                    cleaned.push(item);
                }

                return {ok: true, cleaned};
            }

            try {
                const text = await file.text();
                const parsed = JSON.parse(String(text || ''));

                const res = validateGroupingForUi(parsed);
                if (!res.ok) {
                    groupingUi.setSelectedBuiltInGroupingId(groupingUi.getLastResolvedGroupingSelectionId(mode), mode);
                    groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                    groupingUi.applySelectedBuiltInGrouping(mode);

                    setStatusRun(`Invalid grouping file: ${res.message} Grouping disabled.`, STATUS.ERROR);
                    setStatusReport(`Invalid grouping file: ${res.message} Grouping disabled.`, STATUS.ERROR);
                    return;
                }

                groupingUi.setLoadedCustomGrouping({
                    id: 'custom-loaded',
                    label: `Custom: ${file.name}`,
                    groups: res.cleaned
                }, mode);

                groupingUi.setSelectedBuiltInGroupingId('custom-loaded', mode);

                groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                groupingUi.applySelectedBuiltInGrouping(mode);

                setStatusRun(`Grouping loaded: ${file.name}`, STATUS.OK);
                setStatusReport(`Grouping loaded: ${file.name}`, STATUS.OK);
            } catch (err) {
                console.error('Could not load grouping JSON', err);

                groupingUi.setSelectedBuiltInGroupingId(groupingUi.getLastResolvedGroupingSelectionId(mode), mode);
                groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                groupingUi.applySelectedBuiltInGrouping(mode);

                setStatusRun(`Could not load grouping JSON: ${String(err?.message || err)} Grouping disabled.`, STATUS.ERROR);
                setStatusReport(`Could not load grouping JSON: ${String(err?.message || err)} Grouping disabled.`, STATUS.ERROR);
            }
        });
    }

    /* ==================== Live UI helpers ==================== */

    // In live-ui.js.
    const liveUi = createLiveUi(app);

    /* ==================== Boot ==================== */

    document.addEventListener('DOMContentLoaded', liveUi.initTheme);

    setWhenReportDrawn(reportView.whenResultsComplete);
    // Downloads and the loading of reports and zips, as they go (activity.js).
    getActivity().installButton(document.querySelector('body > header'));

    // ?report=<url> opens a report, ?compare=<url>&compare=<url> compares
    // reports, so the app can be linked to, or embedded, given a report.
    const openQuery = compareTab.readOpenQuery();
    const initialMode = openQuery ? openQuery.mode : getStoredActiveMode();
    const tabsmode = setupModeSwitch({initialMode});
    installBackToTop({
        bar: document.querySelector('.mode-bar'),
        button: document.getElementById('back-to-top'),
        header: document.querySelector('body > header'),
    });

    if (tabsmode && typeof tabsmode.setActive === 'function') {
        tabsmode.setActive(initialMode);
    } else {
        setActiveMode(initialMode);
    }

    liveUi.clearCustomStepsOnFreshBoot();
    // Tooltips and the keyboard-readable scan strips of "Where the failures
    // are", in the report view and the Compare tab alike: one delegated layer.
    globalThis.A11Y_ISSUE_DISPERSION_VIEW?.installDispersionInteractions(document);
    // Links to a scan on the page go there without putting it in the URL.
    installInPageLinks(document);
    initConfigCollapseUi();
    initCustomStepsCollapseUi();
    initWorkflowCollapseUi();
    initSectionEndToggles();
    setupStepTreeDialog();
    setupActionsBuilder(actionsToolbarBottom, actionsBar, () => {
        cfgIO = createConfigIO({
            form,
            urlInput,
            viewportSelect,
            scenarioInput,
            stateDefaults: {
                'run-color-scheme': '',
                'run-high-contrast': 'off',
                'run-untrusted-certs': 'off',
                'run-language': '',
                'run-language-other': '',
            },
            onStateApplied: () => {
                syncRunLanguageOther();
                runSettings.sync();
            },
            getLanguages: runLanguageTags,
            getCustomSteps: getCustomStepsForConfigState,
            setCustomSteps: setCustomStepsFromConfigState,
            getRunSpec: collectRunSpec,
            getBatch: () => batchPanel?.getBatchForConfig() ?? null,
            setBatch: (batch) => batchPanel?.setBatchFromConfig(batch),
            getSections: getSectionsState,
            setSections: setSectionsState,
            loadBatchRows: (rows) => batchPanel?.loadRows(rows),
            appendConfigState,
            activity: getActivity(),

            configFileEl,
            appendConfigFileEl,
            actionsBuilder,
            setStatusRun,
            STATUS,
            escapeHtml,
            safeBaseName,
            jsonBlob,
            saveBlobAsJSON
        });

        afterConfigLoaded = () => {
            if (customStepActionsBuilder) {
                try {
                    setCustomStepsInUi(parseCustomStepsJson(customStepsInput?.value || ''), {selectFirst: true});
                } catch (e) {
                    setUiState('error', String(e?.message || e));
                }
            }
            clearLogsPanel();
            clearResults();
            clearScreenshots();
            summaryEl.textContent = '';
            liveUi.resetLivePanels();
            if (loadAndRun) {
                onRunScan();
            }
            setHistoryBaselineToCurrent();
        };
        cfgIO.setupConfigLoader(afterConfigLoaded);
        // The step editor exists now: give it the batch's row variable names.
        batchPanel?.check();
        // Append is an additive edit on top of the current config, so — unlike
        // load — it must stay undoable (the actions builder and custom-steps
        // list each pushed their own history entry). Don't reset the baseline.
        cfgIO.setupConfigAppender();
        cfgIO.setupConfigSaver($('#save-config-button'));

        cfgIO.autoApplyFromQuery();
        if (openQuery) compareTab.openFromQuery(openQuery).catch((e) => console.error('Could not open from the address', e));
        if (customStepActionsBuilder) {
            try {
                setCustomStepsInUi(parseCustomStepsJson(customStepsInput?.value || ''), {selectFirst: true});
            } catch (e) {
                setUiState('error', String(e?.message || e));
            }
        }
        ensureDefaultA11yActionOnFreshLoad();
    });

    /** Add a default a11yScan action only if the workflow is empty */
    function ensureDefaultA11yActionOnFreshLoad() {
        if (!actionsBuilder) return;
        const current = actionsBuilder.getValue({validate: false, maskValues: 'text'});
        const hasActions = current && Array.isArray(current.value) && current.value.length > 0;
        if (hasActions) return;

        const defaultActions = [{type: 'a11yScan', label: 'Full page'}];
        actionsBuilder.loadActions(defaultActions, {
            focusFirst: false,
            callback: () => {
                clearLogsPanel();
                clearResults();
                clearScreenshots();
                summaryEl.textContent = '';
                liveUi.resetLivePanels();
                setTimeout(setHistoryBaselineToCurrent, 50);
            }
        });
    }

    function setHistoryButtonEnabled(btn, enabled, labelWhenDisabled) {
        if (!btn) return;
        const on = !!enabled;

        // Real disable (keyboard and mouse)
        btn.disabled = !on;

        // Keep your aria-disabled pattern consistent with the rest of the UI
        btn.setAttribute('aria-disabled', on ? 'false' : 'true');

        // Optional hint for SR and mouse users
        if (!on && labelWhenDisabled) btn.title = labelWhenDisabled;
    }

    function getBuilderHistoryState() {
        // Prefer explicit API if it exists
        if (actionsBuilder && typeof actionsBuilder.getHistoryState === 'function') {
            try {
                const st = actionsBuilder.getHistoryState();
                if (st && typeof st === 'object') {
                    let canUndo = !!st.canUndo;
                    const canRedo = !!st.canRedo;

                    // Baseline: cannot undo past it
                    if (historyBaselineSig && getActionsSig() === historyBaselineSig) {
                        canUndo = false;
                    }

                    return { canUndo, canRedo };
                }
            } catch {}
        }

        // Fallbacks if the builder exposes canUndo/canRedo
        let canUndo =
            actionsBuilder && typeof actionsBuilder.canUndo === 'function'
                ? !!actionsBuilder.canUndo()
                : true;

        const canRedo =
            actionsBuilder && typeof actionsBuilder.canRedo === 'function'
                ? !!actionsBuilder.canRedo()
                : true;

        // Baseline: cannot undo past it
        if (historyBaselineSig && getActionsSig() === historyBaselineSig) {
            canUndo = false;
        }

        return { canUndo, canRedo };
    }

    function syncHistoryButtons() {
        if (!actionsBuilder) return;

        const { canUndo, canRedo } = getBuilderHistoryState();

        setHistoryButtonEnabled(undoBtnEl, canUndo, 'Nothing to undo');
        setHistoryButtonEnabled(redoBtnEl, canRedo, 'Nothing to redo');
        refreshWorkflowCollapseAllBtn?.();
    }

    // Undo and Redo are brought up to date once the editing pauses: reading
    // whether the workflow is back at its baseline reads every step from the
    // form, 180 ms a time at 1000 steps, which on every key typed made typing
    // lag and on every step drawn made loading one freeze.
    const HISTORY_SYNC_DELAY_MS = 200;
    let historySyncTimer = null;
    function scheduleHistorySync() {
        clearTimeout(historySyncTimer);
        historySyncTimer = setTimeout(() => {
            historySyncTimer = null;
            syncHistoryButtons();
        }, HISTORY_SYNC_DELAY_MS);
    }

    function setupHistorySync() {
        // Avoid duplicates
        if (historyObserver) {
            try { historyObserver.disconnect(); } catch {}
            historyObserver = null;
        }

        // 1) Sync on any input changes inside the actions UI
        if (actionsBar) {
            const onAny = (e) => {
                const t = e.target;
                if (!(t instanceof Element)) return;
                if (!actionsBar.contains(t)) return;
                scheduleHistorySync();
            };

            actionsBar.addEventListener('input', onAny, true);
            actionsBar.addEventListener('change', onAny, true);
            actionsBar.addEventListener('click', onAny, true);

            // 2) Sync on DOM changes in actions UI (covers add, remove, reorder, nested edits)
            historyObserver = new MutationObserver(() => scheduleHistorySync());
            historyObserver.observe(actionsBar, { childList: true, subtree: true });
        }

        // Initial state
        syncHistoryButtons();
    }

    /* ==================== Actions builder ==================== */

    function createHistoryButtons() {
        if (!actionsBuilder || !historyManagementButtonsContainer) return;

        historyManagementButtonsContainer.innerHTML = '';

        const canCreateUndo = typeof actionsBuilder.createUndoButton === 'function';
        const canCreateRedo = typeof actionsBuilder.createRedoButton === 'function';

        if (!canCreateUndo || !canCreateRedo) {
            console.warn('Actions builder does not expose createUndoButton/createRedoButton.');
            return;
        }

        undoBtnEl = actionsBuilder.createUndoButton({
            className: "secondary-button undo-button icon-button",
            ariaLabel: "Undo",
            title: "Undo"
        }) || null;

        if (undoBtnEl) {
            undoBtnEl.addEventListener('click', (e) => {
                // If we are at baseline, block undo entirely
                const atBaseline = historyBaselineSig && getActionsSig() === historyBaselineSig;
                if (atBaseline) {
                    e.preventDefault();
                    e.stopPropagation();
                    syncHistoryButtons(); // keep UI consistent
                }
            }, true); // capture to intercept builder handler
        }

        redoBtnEl = actionsBuilder.createRedoButton({
            className: "secondary-button redo-button icon-button",
            ariaLabel: "Redo",
            title: "Redo"
        }) || null;

        if (undoBtnEl) historyManagementButtonsContainer.appendChild(undoBtnEl);
        if (redoBtnEl) historyManagementButtonsContainer.appendChild(redoBtnEl);

        setupHistorySync();
    }

    function setupActionsBuilder(toolbarEl, actionsEl, callback = () => {
    }) {
        loadDefinitions()
            .then((defs) => {
                if (defs?.runCustomStep?.fields?.customStepId) {
                    defs.runCustomStep.fields.customStepId.optionsProvider = () => getCustomStepSelectChoices();
                }
                if (defs?.runCustomStep) {
                    defs.runCustomStep.getStepInputsSchema = (customStepId) => {
                        const id = String(customStepId || '').trim();
                        if (!id) return null;
                        const step = customStepsData.find((s) => String(s?.id || '').trim() === id);
                        return step ? (step.inputs || []) : null;
                    };
                }
                actionsBuilder = createActionsBuilder ({
                    defs,
                    toolbarEl,
                    actionsEl,
                    options: {
                        openRulesCatalog: (options) => rulesCatalog.open(options),
                        useHorizontalStepper: false
                    }
                });
                createHistoryButtons();
                initCustomStepsUi(defs);
                fillRunLanguages(defs);
                runSettings.sync();
                callback();
            })
            .catch(() => {
            });

        async function loadDefinitions() {
            try {
                const response = await fetch('/workflows/actions', {method: 'GET'});
                if (!response.ok) return null;
                const json = await response.json();
                if (json && typeof json === 'object') return json;
            } catch (e) {
                console.error('Failed to load /workflows/actions', e);
            }
            return null;
        }
    }

    /** Estimate artifacts to decide live stream gating */
    function countPlannedArtifacts(actions, customSteps = []) {
        if (!Array.isArray(actions)) return {a11yScans: 0, screenshots: 0, totalArtifacts: 0};

        const add = (a, b) => ({a11yScans: a.a11yScans + b.a11yScans, screenshots: a.screenshots + b.screenshots});
        const mul = (a, n) => ({a11yScans: a.a11yScans * n, screenshots: a.screenshots * n});
        const customStepMap = Object.create(null);
        (Array.isArray(customSteps) ? customSteps : []).forEach((s) => {
            const id = String(s?.id || '').trim();
            if (!id) return;
            customStepMap[id] = s;
        });

        const countList = (list, stack = []) =>
            list.reduce(
                (acc, action) => {
                    if (!action || typeof action !== 'object') return acc;
                    const t = action.type;

                    if (t === 'a11yScan') return add(acc, {a11yScans: 1, screenshots: 0});
                    if (t === 'screenshot') return add(acc, {a11yScans: 0, screenshots: 1});

                    // A Merged scan's scans each run and stream in as a scan.
                    if ((t === 'group' || t === 'mergedScan') && Array.isArray(action.actions)) {
                        const inner = countList(action.actions, stack);
                        return add(acc, inner);
                    }

                    if (t === 'repeat' && Array.isArray(action.actions)) {
                        // repetitions may be text: "3", or "{var:count}" known only at runtime (estimate one pass).
                        const repsText = typeof action.repetitions === 'string' ? action.repetitions.trim() : '';
                        const repsFromText = /\{\s*var\s*:/i.test(repsText) ? 1 : (/^\d+$/.test(repsText) ? Number(repsText) : 0);
                        const reps =
                            Number.isFinite(action.repetitions) && action.repetitions > 0
                                ? action.repetitions
                                : repsFromText > 0
                                    ? repsFromText
                                    : Number.isFinite(action.times) && action.times > 0
                                        ? action.times
                                        : 0;
                        if (!reps) return acc;
                        const inner = countList(action.actions, stack);
                        return add(acc, mul(inner, reps));
                    }

                    if (t === 'switch') {
                        const branches = (Array.isArray(action.cases) ? action.cases : [])
                            .filter((c) => c && c.disabled !== true)
                            .map((c) => countList(Array.isArray(c.actions) ? c.actions : [], stack))
                            .concat([countList(Array.isArray(action.defaultActions) ? action.defaultActions : [], stack)]);
                        return add(acc, branches.reduce((w, b) => ({
                            a11yScans: Math.max(w.a11yScans, b.a11yScans),
                            screenshots: Math.max(w.screenshots, b.screenshots)
                        })));
                    }

                    if (t === 'if' || t === 'ifUrl') {
                        const thenCnt = countList(Array.isArray(action.actions) ? action.actions : [], stack);
                        const elseCnt = countList(Array.isArray(action.elseActions) ? action.elseActions : [], stack);
                        return add(acc, {
                            a11yScans: Math.max(thenCnt.a11yScans, elseCnt.a11yScans),
                            screenshots: Math.max(thenCnt.screenshots, elseCnt.screenshots)
                        });
                    }

                    if (t === 'forEachElement') {
                        const pre = countList(Array.isArray(action.preActions) ? action.preActions : [], stack);
                        const inner = countList(Array.isArray(action.actions) ? action.actions : [], stack);
                        const inside = add(pre, inner);
                        const rawLimit = action.iterLimit ?? action.limit; // allow older configs too
                        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 2;
                        return add(acc, mul(inside, limit));
                    }

                    if (t === 'runCustomStep') {
                        const customStepId = String(action.customStepId || action.id || '').trim();
                        const customStep = customStepMap[customStepId];
                        if (!customStep || !Array.isArray(customStep.actions) || stack.includes(customStepId)) return acc;
                        const inner = countList(customStep.actions, stack.concat([customStepId]));
                        return add(acc, inner);
                    }

                    if (Array.isArray(action.actions)) {
                        const inner = countList(action.actions, stack);
                        return add(acc, inner);
                    }

                    return acc;
                },
                {a11yScans: 0, screenshots: 0}
            );

        const {a11yScans, screenshots} = countList(actions);
        return {a11yScans, screenshots, totalArtifacts: a11yScans + screenshots};
    }

    /* ==================== Actions ==================== */

    function getPlannedLiveStreamMode(actions) {
        const customSteps = getCustomStepsForConfigState()?.value || [];
        const planned = countPlannedArtifacts(actions, customSteps);

        // Always stream for workflows, even if there's only 1 scan and no screenshots.
        const hasActions = Array.isArray(actions) && actions.length > 0;
        const shouldStream = hasActions;

        return {planned, shouldStream};
    }

    // Same idea as the workflow builder: a custom step whose field failed
    // validation is worth nothing to the user while its panel stays closed.
    function revealCustomStepError(firstErrorEl) {
        setConfigExpanded(true);
        setCustomStepsExpanded(true);
        if (!firstErrorEl) return;
        const target = isFocusable(firstErrorEl) ? firstErrorEl : getFirstFocusable(firstErrorEl);
        if (target && typeof target.focus === 'function') target.focus();
        const line = firstErrorEl.closest?.('.line') || firstErrorEl;
        if (line.scrollIntoView) line.scrollIntoView({block: 'center', behavior: 'smooth'});
    }

    function validateRunInputs({url, actionsValue}) {
        let errorMessage = '';
        let elementToFocus = undefined;
        let elementToShow = undefined;

        if (!url) {
            urlInput.setAttribute('aria-invalid', 'true');
            errorMessage += 'Please enter a URL to scan';
            urlInputHint.textContent = 'This field is required';
            elementToFocus = urlInput;
        } else {
            urlInput.removeAttribute('aria-invalid');
            urlInputHint.textContent = '';
        }

        // The run's language, when typed with "Other…": a tag, or a variable
        // only known once the run starts.
        const languageProblem = runLanguageProblem();
        if (languageProblem) languageOtherInput?.setAttribute('aria-invalid', 'true');
        else languageOtherInput?.removeAttribute('aria-invalid');
        if (languageOtherError) {
            languageOtherError.textContent = languageProblem || '';
            languageOtherError.hidden = !languageProblem;
        }
        if (languageProblem) {
            errorMessage += errorMessage ? ' and ' : 'Please ';
            errorMessage += 'fix the run\'s language';
            if (!elementToFocus) elementToFocus = languageOtherInput;
        }

        if (!actionsValue.ok) {
            errorMessage += errorMessage ? ' and ' : 'Please ';
            errorMessage += 'fix the highlighted fields';
            elementToFocus = actionsValue.firstErrorEl;
            elementToShow = elementToFocus?.closest?.('.line') || elementToFocus;
            // The builder already opened the offending steps; a collapsed
            // config or workflow panel would still keep them out of sight.
            setConfigExpanded(true);
            setWorkflowExpanded(true);
        }

        if (errorMessage) {
            if (elementToFocus?.closest?.('#run-settings-dialog')) {
                // A run setting: its dialog opens at it.
                runSettings.open(elementToFocus.id);
                elementToShow = null;
            } else {
                elementToFocus = isFocusable(elementToFocus) ? elementToFocus : getFirstFocusable(elementToFocus);
                if (elementToFocus) elementToFocus.focus();
            }
            // Same landing as the step tree: the step sits in the middle of the
            // viewport rather than wherever focus() happened to scroll it.
            if (elementToShow?.scrollIntoView) {
                elementToShow.scrollIntoView({block: 'center', behavior: 'smooth'});
            }
            setUiState('error', errorMessage);
            return {ok: false};
        }

        return {ok: true};
    }

    function getCustomStepSelectChoices() {
        const out = [{ value: '', label: 'Select custom step...' }];
        customStepsData.forEach((step) => {
            const id = String(step?.id || '').trim();
            if (!id) return;
            const name = String(step?.name || '').trim();
            out.push({
                value: id,
                label: name && name !== id ? `${id} - ${name}` : id
            });
        });
        return out;
    }

    function refreshRunCustomStepSelectors() {
        const choices = getCustomStepSelectChoices();
        const setOfKnown = new Set(choices.map((x) => String(x.value)));
        const selector = '.line[data-action-type="runCustomStep"] .field[data-field-name="customStepId"] select';
        const selects = Array.from(document.querySelectorAll(selector));
        selects.forEach((sel) => {
            const previousValue = String(sel.value || '');
            sel.innerHTML = '';
            choices.forEach((entry) => {
                const opt = document.createElement('option');
                opt.value = String(entry.value);
                opt.textContent = String(entry.label);
                sel.appendChild(opt);
            });
            if (previousValue && !setOfKnown.has(previousValue)) {
                const missing = document.createElement('option');
                missing.value = previousValue;
                missing.textContent = `${previousValue} (missing)`;
                sel.appendChild(missing);
            }
            sel.value = previousValue;
            if (!sel.value) sel.value = '';
            sel.dispatchEvent(new Event('change', {bubbles: true}));
        });
    }

    function getCustomStepUsageInfo(stepId, excludeCustomStepIndex = -1) {
        const id = String(stepId || '').trim();
        if (!id) return { inWorkflow: false, usedByCustomSteps: [] };

        const workflowUsed = new Set();
        const currentWorkflow = actionsBuilder?.getValue({ validate: false, maskValues: 'text' });
        collectUsedCustomStepIds(currentWorkflow?.value || [], workflowUsed);

        const usedByCustomSteps = [];
        customStepsData.forEach((step, idx) => {
            if (!step || idx === excludeCustomStepIndex) return;
            const refs = new Set();
            collectUsedCustomStepIds(step.actions || [], refs);
            if (refs.has(id)) usedByCustomSteps.push(String(step.id || `custom-step-${idx + 1}`));
        });

        return { inWorkflow: workflowUsed.has(id), usedByCustomSteps };
    }

    // Append the custom steps and workflow from a loaded config's `state` onto
    // the current configuration, without replacing it. Custom steps whose id
    // collides with an existing one are given a fresh unique id, and every
    // reference to them — in the imported workflow and in the imported steps
    // themselves — is remapped to match, so nothing that the current config
    // already relies on is altered.
    function appendConfigState(state) {
        if (!state || typeof state !== 'object') {
            return {ok: false, message: 'Config JSON must contain a "state" object.'};
        }

        let importedSteps;
        try {
            const rawSteps = state['custom-steps-json'] || state['custom-steps-definitions'] || '';
            importedSteps = parseCustomStepsJson(rawSteps);
        } catch (e) {
            return {ok: false, message: 'Could not append config: ' + String(e?.message || e)};
        }

        const importedWorkflow = Array.isArray(state['actions-workflow']) ? state['actions-workflow'] : [];

        if (!importedSteps.length && !importedWorkflow.length) {
            return {ok: false, message: 'This config has no custom steps or workflow steps to append.'};
        }

        // Flush any in-progress edits in the custom-step editor into customStepsData
        // so the merge sees the true current set.
        if (customStepActionsBuilder) {
            const persisted = persistSelectedCustomStepActions({validate: false});
            if (!persisted.ok) {
                return {ok: false, message: 'Resolve the current custom step errors before appending.'};
            }
        }

        const taken = new Set(
            customStepsData.map((s) => String(s.id || '').trim()).filter(Boolean)
        );
        const remap = {};
        const toAdd = [];
        let renamedCount = 0;

        importedSteps.forEach((imp) => {
            const impId = String(imp.id || '').trim();

            if (taken.has(impId)) {
                const newId = makeUniqueImportedId(impId, taken);
                remap[impId] = newId;
                taken.add(newId);
                toAdd.push({...imp, id: newId});
                renamedCount += 1;
                return;
            }

            taken.add(impId);
            toAdd.push({...imp});
        });

        // Rewrite references now that the full remap is known. Every added step's
        // actions are remapped (a non-renamed step may still reference a renamed one).
        const addedSteps = toAdd.map((step) => ({
            id: step.id,
            name: String(step.name || '').trim() || step.id,
            inputs: normalizeCustomStepInputs(step.inputs),
            actions: deepRemapCustomStepIds(step.actions, remap)
        }));
        const remappedWorkflow = deepRemapCustomStepIds(importedWorkflow, remap);

        if (addedSteps.length) {
            customStepsData = customStepsData.concat(addedSteps);
        }

        let workflowAppended = 0;
        if (remappedWorkflow.length && actionsBuilder && typeof actionsBuilder.appendActions === 'function') {
            const res = actionsBuilder.appendActions(remappedWorkflow, {focusFirst: false});
            workflowAppended = (res && Array.isArray(res.added)) ? res.added.length : 0;
        }

        // Refresh the custom-steps panel + selectors and record one undo entry.
        if (addedSteps.length) {
            setCustomStepsExpanded(true);
            selectCustomStep(customStepsData.length - 1);
            pushCustomStepsHistory();
        }
        refreshRunCustomStepSelectors();

        const parts = [];
        if (workflowAppended) parts.push(`${workflowAppended} workflow step${workflowAppended === 1 ? '' : 's'}`);
        if (addedSteps.length) parts.push(`${addedSteps.length} custom step${addedSteps.length === 1 ? '' : 's'}`);

        let message = parts.length ? `Appended ${parts.join(' and ')}.` : 'Nothing new to append.';
        if (renamedCount) {
            message += ` (${renamedCount} custom step${renamedCount === 1 ? '' : 's'} renamed to avoid id conflicts.)`;
        }

        return {ok: true, message};
    }

    function syncCustomStepsHiddenInput() {
        if (customStepsInput) {
            customStepsInput.value = customStepsData.length ? JSON.stringify(customStepsData) : '';
        }
        syncCustomStepsCountBadge();
    }

    function syncCustomStepsCountBadge() {
        if (!customStepsCountBadgeEl) return;
        const count = Array.isArray(customStepsData) ? customStepsData.length : 0;
        if (!count) {
            customStepsCountBadgeEl.hidden = true;
            customStepsCountBadgeEl.textContent = '0';
            customStepsCountBadgeEl.setAttribute('aria-label', 'No custom steps defined');
            customStepsCountBadgeEl.title = 'No custom steps defined';
            return;
        }
        const label = `${count} custom step${count === 1 ? '' : 's'} defined`;
        customStepsCountBadgeEl.hidden = false;
        customStepsCountBadgeEl.textContent = String(count);
        customStepsCountBadgeEl.setAttribute('aria-label', label);
        customStepsCountBadgeEl.title = label;
    }

    function setCustomStepEditorEnabled(enabled) {
        const controls = [
            customStepIdInput,
            customStepNameInput,
            customStepInputsTextarea,
            customStepCopyBtn,
            customStepDeleteBtn
        ];
        controls.forEach((el) => {
            if (!el) return;
            el.disabled = !enabled;
        });
        if (customStepActionsBuilderEl) {
            customStepActionsBuilderEl.classList.toggle('is-disabled', !enabled);
            customStepActionsBuilderEl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        }
    }

    function syncCustomStepPasteButtonState() {
        if (!customStepPasteBtn) return;
        const hasClipboard = !!copiedCustomStep;
        customStepPasteBtn.disabled = !hasClipboard;
        customStepPasteBtn.setAttribute('aria-disabled', hasClipboard ? 'false' : 'true');
        customStepPasteBtn.title = hasClipboard ? 'Paste custom step' : 'Copy a custom step first';
    }

    function appendCustomStepsListActions() {
        if (!customStepsListEl) return;
        if (!customStepPasteBtn && !customStepAddBtn) return;

        if (!customStepsListActionsEl) {
            customStepsListActionsEl = createEl('div', {
                id: 'custom-steps-list-actions',
                className: 'custom-steps-list-actions'
            });
        }

        if (customStepPasteBtn && customStepPasteBtn.parentElement !== customStepsListActionsEl) {
            customStepsListActionsEl.appendChild(customStepPasteBtn);
        }
        if (customStepAddBtn && customStepAddBtn.parentElement !== customStepsListActionsEl) {
            customStepsListActionsEl.appendChild(customStepAddBtn);
        }

        customStepsListEl.appendChild(customStepsListActionsEl);
    }

    function copyCustomStepAt(index) {
        if (index < 0 || index >= customStepsData.length) return;
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;
        copiedCustomStep = cloneCustomStepValue(customStepsData[index]);
        syncCustomStepPasteButtonState();
    }

    function makeUniqueCustomStepId(baseIdRaw) {
        const baseId = String(baseIdRaw || '').trim() || 'custom-step';
        const used = new Set(customStepsData.map((step) => String(step?.id || '').trim()).filter(Boolean));
        if (!used.has(baseId)) return baseId;

        let candidate = `${baseId}-copy`;
        if (!used.has(candidate)) return candidate;

        let n = 2;
        while (used.has(`${baseId}-copy-${n}`)) n += 1;
        return `${baseId}-copy-${n}`;
    }

    function pasteCopiedCustomStep() {
        if (!copiedCustomStep) return;
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;

        const nextId = makeUniqueCustomStepId(copiedCustomStep.id || 'custom-step');
        const sourceName = String(copiedCustomStep.name || copiedCustomStep.id || '').trim();
        const nextName = sourceName
            ? (sourceName.endsWith(' (copy)') ? sourceName : `${sourceName} (copy)`)
            : nextId;

        customStepsData.push({
            id: nextId,
            name: nextName,
            inputs: Array.isArray(copiedCustomStep.inputs) ? copiedCustomStep.inputs.map((i) => ({ ...i })) : [],
            actions: Array.isArray(copiedCustomStep.actions) ? JSON.parse(JSON.stringify(copiedCustomStep.actions)) : []
        });
        setCustomStepsExpanded(true);
        selectCustomStep(customStepsData.length - 1);
        pushCustomStepsHistory();
    }

    function renderCustomStepsList() {
        if (!customStepsListEl) return;
        customStepsListEl.innerHTML = '';
        if (!customStepsData.length) {
            const empty = document.createElement('p');
            empty.className = 'custom-steps-empty';
            empty.textContent = 'No custom steps yet.';
            customStepsListEl.appendChild(empty);
            appendCustomStepsListActions();
            // No tab is active — the panel isn't labelled by anything.
            customStepsPanelEl?.removeAttribute('aria-labelledby');
            syncCustomStepPasteButtonState();
            return;
        }

        // Roving tabindex: exactly one tab is in the page tab order. Prefer the
        // selected step; if somehow none is selected, make the first tab reachable.
        const activeIndex = (selectedCustomStepIndex >= 0 && selectedCustomStepIndex < customStepsData.length)
            ? selectedCustomStepIndex
            : 0;

        customStepsData.forEach((step, index) => {
            const isSelected = index === selectedCustomStepIndex;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = customStepTabId(index);
            btn.className = `custom-steps-item${isSelected ? ' is-active' : ''}`;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            // Every tab controls the same, reused editor panel.
            btn.setAttribute('aria-controls', 'custom-steps-tabpanel');
            btn.tabIndex = index === activeIndex ? 0 : -1;
            btn.dataset.index = String(index);

            const id = document.createElement('span');
            id.className = 'custom-steps-item-id';
            id.textContent = step.id || `(step ${index + 1})`;
            btn.appendChild(id);

            const name = document.createElement('span');
            name.className = 'custom-steps-item-name';
            name.textContent = step.name || step.id || '';
            btn.appendChild(name);

            btn.addEventListener('click', () => activateCustomStepTab(index));

            // The row is presentational so the tab reads as a direct child of
            // the tablist. Copy/delete now live in the editor panel toolbar.
            const row = createEl('div', {className: 'custom-steps-item-row'}, [btn]);
            customStepsListEl.appendChild(row);
        });

        appendCustomStepsListActions();
        // Label the shared panel by whichever tab is currently active.
        customStepsPanelEl?.setAttribute('aria-labelledby', customStepTabId(activeIndex));
        syncCustomStepPasteButtonState();
    }

    // Activate a tab: select its step (loads it into the panel) and, since the
    // list is re-rendered, move focus back onto the freshly-built active tab.
    function activateCustomStepTab(index) {
        selectCustomStep(index);
        const tab = customStepsListEl?.querySelector(`.custom-steps-item[data-index="${index}"]`);
        tab?.focus();
    }

    // Vertical tablist keyboard model (WAI-ARIA APG): Up/Down move between tabs,
    // Home/End jump to the ends, wrapping around, with automatic activation.
    function handleCustomStepsTablistKeydown(event) {
        const target = event.target;
        if (!target || target.getAttribute?.('role') !== 'tab') return;

        const count = customStepsData.length;
        if (!count) return;

        const current = Number(target.dataset.index);
        if (!Number.isFinite(current)) return;

        let nextIndex;
        switch (event.key) {
            case 'ArrowDown':
                nextIndex = (current + 1) % count;
                break;
            case 'ArrowUp':
                nextIndex = (current - 1 + count) % count;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = count - 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        activateCustomStepTab(nextIndex);
    }

    function removeCustomStepAt(index) {
        if (index < 0 || index >= customStepsData.length) return;
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;

        const toRemove = customStepsData[index];
        const removeId = String(toRemove?.id || '').trim();
        const usage = getCustomStepUsageInfo(removeId, index);
        if (usage.inWorkflow || usage.usedByCustomSteps.length) {
            const parts = [];
            if (usage.inWorkflow) parts.push('it is used in the current workflow');
            if (usage.usedByCustomSteps.length) parts.push(`it is referenced by custom step(s): ${usage.usedByCustomSteps.join(', ')}`);
            const msg = `Cannot delete custom step "${removeId}" because ${parts.join(' and ')}. Remove those references first.`;
            window.alert(msg);
            setUiState('error', msg);
            return;
        }

        customStepsData.splice(index, 1);
        if (!customStepsData.length) {
            selectedCustomStepIndex = -1;
        } else if (index === selectedCustomStepIndex) {
            selectedCustomStepIndex = Math.min(index, customStepsData.length - 1);
        } else if (index < selectedCustomStepIndex) {
            selectedCustomStepIndex -= 1;
        }
        renderCustomStepsList();
        loadSelectedCustomStepIntoEditor();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
        pushCustomStepsHistory();
    }

    function persistSelectedCustomStepActions({validate = false} = {}) {
        if (selectedCustomStepIndex < 0) return {ok: true};
        const selected = customStepsData[selectedCustomStepIndex];
        if (!selected || !customStepActionsBuilder) return {ok: true};
        // The value stays in memory so runs started from the app still work;
        // markMasked records which fields must be dropped when a config is saved.
        const result = customStepActionsBuilder.getValue({validate, maskValues: 'text', markMasked: true});
        if (!result.ok) {
            return {
                ok: false,
                message: 'Please fix validation errors in custom step actions.',
                firstErrorEl: result.firstErrorEl || null
            };
        }
        selected.actions = Array.isArray(result.value) ? result.value : [];
        return {ok: true};
    }

    function loadSelectedCustomStepIntoEditor() {
        const selected = customStepsData[selectedCustomStepIndex];
        syncingCustomStepEditor = true;
        try {
            if (!selected) {
                if (customStepIdInput) customStepIdInput.value = '';
                if (customStepNameInput) customStepNameInput.value = '';
                if (customStepInputsTextarea) customStepInputsTextarea.value = '';
                if (customStepActionsBuilder) customStepActionsBuilder.clear();
                setCustomStepEditorEnabled(false);
                return;
            }

            setCustomStepEditorEnabled(true);
            if (customStepIdInput) customStepIdInput.value = selected.id || '';
            if (customStepNameInput) customStepNameInput.value = selected.name || '';
            if (customStepInputsTextarea) customStepInputsTextarea.value = formatCustomStepInputsText(selected.inputs);
            if (customStepActionsBuilder) {
                customStepActionsBuilder.loadActions(Array.isArray(selected.actions) ? selected.actions : [], {
                    clearFirst: true,
                    focusFirst: false,
                    injectDefaultWhenEmpty: false
                });
            }
        } finally {
            syncingCustomStepEditor = false;
            // A different step's (or no step's) actions are now loaded — undo
            // must not be able to reach across into whatever was here before.
            setCustomStepActionsHistoryBaselineToCurrent();
        }
    }

    function syncSelectedCustomStepMetaFromEditor() {
        if (syncingCustomStepEditor || selectedCustomStepIndex < 0) return;
        const selected = customStepsData[selectedCustomStepIndex];
        if (!selected) return;
        selected.id = String(customStepIdInput?.value || '').trim();
        selected.name = String(customStepNameInput?.value || '').trim() || selected.id;
        selected.inputs = parseCustomStepInputsText(customStepInputsTextarea?.value || '');
        renderCustomStepsList();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
        scheduleCustomStepsHistoryPush();
    }

    function selectCustomStep(index) {
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;
        selectedCustomStepIndex = Number.isFinite(index) ? index : -1;
        renderCustomStepsList();
        loadSelectedCustomStepIntoEditor();
        syncCustomStepsHiddenInput();
    }

    function normalizeCustomStepsFromState(steps) {
        return steps.map((item, index) => ({
            id: String(item.id || `custom-step-${index + 1}`).trim() || `custom-step-${index + 1}`,
            name: String(item.name || '').trim() || String(item.id || `custom-step-${index + 1}`),
            inputs: normalizeCustomStepInputs(item.inputs),
            actions: Array.isArray(item.actions) ? withPasswordStepTypeDeep(item.actions) : []
        }));
    }

    function setCustomStepsInUi(steps, {selectFirst = true} = {}) {
        customStepsData = normalizeCustomStepsFromState(Array.isArray(steps) ? steps : []);
        selectedCustomStepIndex = customStepsData.length && selectFirst ? 0 : -1;
        renderCustomStepsList();
        loadSelectedCustomStepIntoEditor();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
        // Whole set just got replaced (initial load, or a new config loaded
        // over it) — undo shouldn't be able to reach past this baseline.
        resetCustomStepsHistory();
    }

    function initCustomStepsUi(defs) {
        if (!customStepActionsEl || !customStepToolbarEl) return;
        if (!customStepActionsBuilder) {
            customStepActionsBuilder = createActionsBuilder({
                defs,
                toolbarEl: customStepToolbarEl,
                actionsEl: customStepActionsEl,
                options: {
                    openRulesCatalog: (options) => rulesCatalog.open(options),
                    useHorizontalStepper: false
                }
            });
            createCustomStepActionsHistoryButtons();
            createCustomStepsListHistoryButtons();
        }

        // Delegated so it survives the list being re-rendered on every change.
        if (customStepsListEl) {
            customStepsListEl.addEventListener('keydown', handleCustomStepsTablistKeydown);
        }

        if (customStepAddBtn) {
            customStepAddBtn.addEventListener('click', () => {
                const persist = persistSelectedCustomStepActions({validate: false});
                if (!persist.ok) return;
                const nextIndex = customStepsData.length + 1;
                customStepsData.push({
                    id: `custom-step-${nextIndex}`,
                    name: `Custom step ${nextIndex}`,
                    inputs: [],
                    actions: []
                });
                setCustomStepsExpanded(true);
                selectCustomStep(customStepsData.length - 1);
                pushCustomStepsHistory();
            });
        }

        if (customStepPasteBtn) {
            customStepPasteBtn.addEventListener('click', () => {
                pasteCopiedCustomStep();
            });
        }

        if (customStepCopyBtn) {
            customStepCopyBtn.addEventListener('click', () => {
                if (selectedCustomStepIndex >= 0) copyCustomStepAt(selectedCustomStepIndex);
            });
        }

        if (customStepDeleteBtn) {
            customStepDeleteBtn.addEventListener('click', () => {
                if (selectedCustomStepIndex >= 0) removeCustomStepAt(selectedCustomStepIndex);
            });
        }

        [customStepIdInput, customStepNameInput, customStepInputsTextarea].forEach((el) => {
            if (!el) return;
            el.addEventListener('input', syncSelectedCustomStepMetaFromEditor);
            el.addEventListener('change', syncSelectedCustomStepMetaFromEditor);
        });

        setCustomStepEditorEnabled(false);
        syncCustomStepPasteButtonState();
        setCustomStepsInUi(parseCustomStepsJson(customStepsInput?.value || ''), {selectFirst: true});
    }

    function readCustomStepsFromUi({validate = false} = {}) {
        const persist = persistSelectedCustomStepActions({validate});
        if (!persist.ok) return persist;

        if (validate) {
            const seen = new Set();
            for (let i = 0; i < customStepsData.length; i += 1) {
                const step = customStepsData[i];
                const id = String(step.id || '').trim();
                if (!id) return {ok: false, message: `Custom step #${i + 1} is missing id.`};
                if (seen.has(id)) return {ok: false, message: `Custom step name "${id}" is duplicated.`};
                seen.add(id);
            }
        }
        syncCustomStepsHiddenInput();
        return {ok: true, value: customStepsData};
    }

    /** The workflow as the editor holds it, passwords included, for Resume to reuse them. */
    function getWorkflowWithPasswords() {
        try {
            const actionsValue = actionsBuilder?.getValue({validate: false, maskValues: 'text', markMasked: true});
            const customSteps = customStepActionsBuilder
                ? readCustomStepsFromUi({validate: false})
                : {ok: true, value: parseCustomStepsJson(customStepsInput?.value || '')};
            return {
                actions: actionsValue?.ok ? actionsValue.value : [],
                customSteps: customSteps.ok ? customSteps.value : [],
            };
        } catch {
            return null;
        }
    }

    function getCustomStepsForConfigState() {
        // Masked values live in customStepsData so the app can run the step, but
        // they must not reach a saved config - redact on the way out.
        if (customStepActionsBuilder) {
            const read = readCustomStepsFromUi({validate: false});
            if (!read.ok) return read;
            return {ok: true, value: redactMaskedFieldsDeep(read.value || [])};
        }
        try {
            return {ok: true, value: redactMaskedFieldsDeep(parseCustomStepsJson(customStepsInput?.value || ''))};
        } catch (e) {
            return {ok: false, message: String(e?.message || e), value: []};
        }
    }

    function setCustomStepsFromConfigState(rawValue) {
        if (!customStepActionsBuilder) {
            if (customStepsInput) customStepsInput.value = String(rawValue || '');
            return;
        }
        try {
            const parsed = parseCustomStepsJson(String(rawValue || ''));
            setCustomStepsInUi(parsed, {selectFirst: true});
        } catch (e) {
            setUiState('error', String(e?.message || e));
        }
    }

    // ---- The run's language: Set language's list, or any tag with "Other…" ----

    /** The languages Set language lists, as the Language field's choices. */
    function fillRunLanguages(defs) {
        if (!languageSelect) return;
        const options = defs?.setLanguage?.fields?.language?.options;
        if (!Array.isArray(options)) return;
        const other = languageSelect.querySelector('option[value="other"]');
        for (const o of options) {
            if (!o || o.value === 'default') continue;
            languageSelect.insertBefore(new Option(String(o.label ?? o.value), String(o.value)), other);
        }
    }

    function runLanguageTags() {
        return languageSelect
            ? Array.from(languageSelect.options).map((o) => o.value).filter((v) => v && v !== 'other')
            : [];
    }

    // "Other language" shows only while "Other…" is chosen.
    function syncRunLanguageOther() {
        if (!languageSelect || !languageOtherField) return;
        const other = languageSelect.value === 'other';
        languageOtherField.hidden = !other;
        if (!other && languageOtherError) {
            languageOtherError.hidden = true;
            languageOtherInput?.removeAttribute('aria-invalid');
        }
    }

    /** The language the run starts in, '' for the browser's own. */
    function runLanguageValue() {
        if (!languageSelect) return '';
        if (languageSelect.value === 'other') return languageOtherInput ? languageOtherInput.value.trim() : '';
        return languageSelect.value;
    }

    /** Why the typed language cannot run, or ''. */
    function runLanguageProblem() {
        if (!languageSelect || languageSelect.value !== 'other') return '';
        const typed = languageOtherInput ? languageOtherInput.value.trim() : '';
        if (!typed) return 'Type a language, such as es-MX, or choose one from the list';
        if (typed.includes('{')) return '';
        try {
            if (Intl.getCanonicalLocales(typed).length === 1) return '';
        } catch {
            // not a tag
        }
        return `"${typed}" is not a language tag: use one such as es-MX, fr-CA or zh-Hant-HK`;
    }

    languageSelect?.addEventListener('change', () => {
        syncRunLanguageOther();
        if (languageSelect.value === 'other') languageOtherInput?.focus();
    });

    function buildRunSpecFromUi({url, actions, customSteps}) {
        const specTools = globalThis.A11Y_RUN_SPEC;
        if (!specTools) throw new Error('shared/run-spec.js must be loaded before a11y-ui.js');

        const {buildViewportFromPreset} = globalThis.A11Y_SCAN_INPUTS;

        return specTools.buildRunSpec({
            url,
            actions,
            customSteps,
            viewport: viewportSelect ? buildViewportFromPreset(viewportSelect.value) : null,
            colorScheme: colorSchemeSelect ? colorSchemeSelect.value : '',
            highContrast: highContrastSelect ? highContrastSelect.value : '',
            acceptUntrustedCerts: untrustedCertsSelect ? untrustedCertsSelect.value : '',
            language: runLanguageValue(),
            scenarioName: scenarioInput ? scenarioInput.value.trim() : '',
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
        const actionsValue = actionsBuilder
            ? actionsBuilder.getValue({ maskValues: 'redact', markMasked: true, reveal: false })
            : null;
        if (!actionsValue || !actionsValue.ok) return null;

        const customStepsResult = getCustomStepsForConfigState();

        return buildRunSpecFromUi({
            url: urlInput ? urlInput.value.trim() : '',
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

        currentRunId = runId;
        cancelButton.setAttribute('aria-disabled', 'false');

        appendLog('Live logging started...', STATUS.INFO);

        // Poll progress until terminal state
        await pollWorkflowUntilDone(runId, {
            pollIntervalMs: PROGRESS_POLL_INTERVAL_MS,
            onStatus: (s) => {
                if (s === 'cancelling') {
                    setUiState('cancelling', 'Cancelling... finishing current action');
                } else if (s === 'cancelled') {
                    setUiState('cancelled', 'Cancelled');
                } else if (s === 'done') {
                    setUiState('done', 'Finished');
                } else if (s === 'error') {
                    setUiState('error', 'Workflow failed');
                }
            },
            onProgress: (prog) => {
                if (prog && Array.isArray(prog.logs) && prog.logs.length) {
                    liveUi.progressProcessor.processMany(prog.logs);
                }
            }
        });

        // Get final result payload
        const final = await fetchWorkflowResult(runId);
        const finalStatus = final && typeof final.status === 'string' ? final.status : 'error';
        return {ok: finalStatus === 'done' || finalStatus === 'cancelled', final};
    }

    async function handleTerminalResult(final, url) {
        if (final.status === 'done' && final.payload) {
            setRunPayload(final.payload, {url, status: 'done'});
            return;
        }

        if (final.status === 'error') {
            setUiState('error', 'Workflow failed: ' + (final.payload?.details || 'Unknown error'));
            return;
        }

        if (final.status === 'cancelled') {
            setUiState('error', 'Run cancelled.');
            summaryEl.textContent = 'The workflow was cancelled by the user.';
            setRunPayload(final.payload, {url, status: 'cancelled'});
            return;
        }

        setUiState('error', 'Unexpected workflow status: ' + final.status);
    }

    // A run the browser refused for a certificate it does not trust: the
    // status says so, and offers to run again accepting such certificates.
    function offerUntrustedRetry(final) {
        const details = final?.payload?.errorDetails || final?.error || null;
        const message = String((details && (details.message || details.details)) || details || '');
        if (!/net::ERR_CERT_/.test(message) || !untrustedCertsSelect || untrustedCertsSelect.value === 'on') return;
        setUiState('error', 'Workflow failed: the browser does not trust this site\'s certificate');
        if (retryUntrustedButton) retryUntrustedButton.hidden = false;
    }

    retryUntrustedButton?.addEventListener('click', () => {
        retryUntrustedButton.hidden = true;
        untrustedCertsSelect.value = 'on';
        untrustedCertsSelect.dispatchEvent(new Event('change', {bubbles: true}));
        runSettings.sync();
        scanButton.click();
    });

    function clearResultDialogs() {
        scansDialog.clearItems();
        screenshotsDialog.clearItems();
    }

    function clearLiveStreamDialog() {
        liveStreamDialog.clearItems();
    }

    /**
     * The form read and validated as one run request: what Run sends to
     * /workflow-start and Add to queue sends to /queue/items. Problems are shown
     * on the form; null means there is nothing to send.
     */
    function prepareRunRequest({markMasked = false, fallbackUrl = ''} = {}) {
        // A batch whose rows all carry a URL can leave the form's empty.
        let url = urlInput.value.trim() || fallbackUrl;
        if (url.length && !url.startsWith('http')) url = 'http://' + url;
        const actionsValue = actionsBuilder.getValue({validate: true, maskValues: 'text', markMasked});

        // Validate URL + action builder fields
        const valid = validateRunInputs({url, actionsValue});
        if (!valid.ok) return null;

        const actions = actionsValue.value || [];

        let customSteps = [];
        if (customStepActionsBuilder) {
            const customStepsResult = readCustomStepsFromUi({validate: true});
            if (!customStepsResult.ok) {
                revealCustomStepError(customStepsResult.firstErrorEl);
                setUiState('error', customStepsResult.message || 'Custom steps are invalid.');
                return null;
            }
            customSteps = customStepsResult.value || [];
        } else {
            try {
                customSteps = parseCustomStepsJson(customStepsInput ? customStepsInput.value : '');
            } catch (e) {
                setUiState('error', String(e?.message || e));
                return null;
            }
        }

        const {payload} = buildWorkflowPayload({url, actions, customSteps});
        return {url, actions, customSteps, payload};
    }

    async function onRunScan(event) {
        event?.preventDefault();

        // Re-checked now: the workflow may have changed since the rows were.
        const batch = batchPanel ? batchPanel.check() : null;
        if (batch && batch.active) {
            await runBatch(batch);
            return;
        }

        clearLogsPanel();
        clearResultDialogs();
        clearLiveStreamDialog();

        resultsState.run.payload = null;
        resultsState.run.meta = {};
        lastWorkflowResponse = null;
        setRunTabBadge(false);

        if (resultsState.activeMode === 'run') {
            clearResults();
            clearScreenshots();
            summaryEl.textContent = '';
        }

        liveUi.resetLivePanels();
        loadAndRun = false;

        const request = prepareRunRequest();
        if (!request) return;
        const {url, actions, customSteps, payload} = request;

        // The configuration as it is now, before the form can change while
        // the run goes: the report carries it, so it can be set up again
        // (docs/report-package.md).
        let runConfig = null;
        try {
            runConfig = cfgIO ? cfgIO.buildConfigFile({includeBatch: false}) : null;
        } catch (err) {
            console.error('Could not keep the configuration with the report', err);
        }

        // Decide live stream mode based on actions array
        const plan = getPlannedLiveStreamMode(actions);
        useLiveStream = !!plan.shouldStream;

        liveUi.startStepCounter(actions, customSteps);

        // Running UI state
        runStartedAtMs = performance.now();
        const runningMessage = buildRunningMessage(actions);
        setUiState('running', runningMessage);

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
            setUiState('error', runFailureMessage(e, {started: !!currentRunId}));
        } finally {
            // total time log, last message
            if (typeof runStartedAtMs === 'number') {
                const elapsed = performance.now() - runStartedAtMs;
                const t = formatElapsedHuman(elapsed);

                // After an error the status keeps saying what went wrong.
                if (failed) appendLog(`Total time: ${t}`, STATUS.INFO);
                else setStatusRun(`${runResultText ? runResultText + ' ' : ''}Total time: ${t}`, STATUS.OK);
                runResultText = '';
            }

            runStartedAtMs = null;

            // The workflow has finished (done / cancelled / error) — hand the
            // floating scan-totals counter over to the user: its dismiss button
            // becomes active so they can close it after reviewing the totals.
            // A fresh run resets it again on start.
            liveUi.liveTotals?.finish?.();

            // always return to idle buttons, regardless of outcome
            scanButton.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            currentRunId = null;
            // A failed run is over too: the error state leaves the page as if
            // one were still going (the configuration pinned, its actions hidden).
            document.body.classList.remove('is-running');
            // ...unless the batch rule still holds.
            refreshRunButton();
        }
    }

    /** Shows a dry run's summary (dry-run-summary.js): how each step went. */
    function renderDryRunReport(summary) {
        if (!dryRunReportEl) return;
        const verdictEl = dryRunReportEl.querySelector('.dry-run-verdict');
        const stepsEl = dryRunReportEl.querySelector('.dry-run-steps');
        const scansEl = dryRunReportEl.querySelector('.dry-run-scans');
        stepsEl.replaceChildren();
        scansEl.textContent = '';
        verdictEl.className = 'dry-run-verdict';

        if (!summary || summary.outcome !== 'finished') {
            dryRunReportEl.hidden = true;
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
        dryRunReportEl.hidden = false;
    }

    /**
     * Dry run: the workflow as the form stands, every step but the scans,
     * screenshots and evidence, to see that it still fits the site. With the
     * batch on, with its first workflow's URL and variables: a dry run checks
     * the steps, which every workflow of the batch shares. Leaves the report
     * of the last run as it was.
     */
    async function onDryRun() {
        const batch = batchPanel ? batchPanel.check() : null;
        const row = batch && batch.active && batch.state === 'ready' && Array.isArray(batch.runs) ? batch.runs[0] : null;

        clearLogsPanel();
        clearLiveStreamDialog();
        liveUi.resetLivePanels();
        if (dryRunReportEl) dryRunReportEl.hidden = true;

        const request = prepareRunRequest({fallbackUrl: row ? row.url : ''});
        if (!request) return;
        const {actions, customSteps} = request;
        const payload = {...request.payload, dryRun: true};
        if (row) {
            payload.url = row.url || payload.url;
            if (row.vars && Object.keys(row.vars).length) payload.vars = row.vars;
        }

        useLiveStream = false;
        liveUi.startStepCounter(actions, customSteps);
        runStartedAtMs = performance.now();
        setUiState('running', row
            ? `Dry run with the batch's first workflow, ${row.name}: every step but the scans, screenshots and evidence...`
            : 'Dry run: every step but the scans, screenshots and evidence...');

        try {
            const {final} = await runWorkflow(payload);
            if (!final) return; // handleScanHttpError has said why
            const summary = final.dryRun || null;
            renderDryRunReport(summary);
            document.body.classList.remove('is-running');
            if (!summary) {
                setUiState('error', 'Dry run failed: ' + (final.error?.details || final.status || 'no result'));
            } else if (summary.outcome === 'cancelled') {
                setUiState('cancelled', 'Dry run cancelled.');
            } else if (summary.outcome === 'not-started') {
                setUiState('error', `Dry run could not start: ${summary.startError}`);
            } else {
                setUiState('done', summary.fits ? 'Dry run: every step ran, the workflow fits the site.' : 'Dry run: the workflow does not fit the site as it stands.');
                if (!summary.fits) {
                    setStatusRun('Dry run: the workflow does not fit the site as it stands. See the dry run below.', STATUS.WARNING);
                    // The steps are what needs fixing: show them again.
                    setConfigExpanded(true);
                }
                dryRunReportEl?.scrollIntoView({block: 'nearest'});
            }
        } catch (e) {
            setUiState('error', runFailureMessage(e, {started: !!currentRunId}));
        } finally {
            if (typeof runStartedAtMs === 'number') {
                appendLog(`Total time: ${formatElapsedHuman(performance.now() - runStartedAtMs)}`, STATUS.INFO);
            }
            runStartedAtMs = null;
            // Its step count helped while the steps ran; its scan totals are
            // all zero in a dry run, and it would cover the dry run's report.
            liveUi.liveTotals.remove();
            setRunTabSpinner(false);
            scanButton.setAttribute('aria-disabled', 'false');
            dryRunButton?.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            currentRunId = null;
            refreshRunButton();
        }
    }

    async function handleScanHttpError(response) {
        const text = await response.text();
        let statusMessage = 'Scan failed. Server responded with status ' + response.status + '.';
        try {
            const json = JSON.parse(text);
            if (json && (json.details || json.error)) {
                const detail = json.details || json.error;
                statusMessage = 'Scan failed (HTTP ' + response.status + '): ' + detail;
            }
        } catch {
        }

        setUiState('error', statusMessage);
        summaryEl.textContent = '';

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
            summaryEl.appendChild(errorLink);
        }
    }

    /* ==================== Final payload summary ==================== */

    // In run-summary-ui.js.
    const runSummaryUi = createRunSummaryUi(app);

    /* ==================== "View all scans" grid dialog ==================== */


    async function saveBlobAsJSON(
        blob,
        {
            suggestedBase,
            fileDesc = 'JSON file',
            okMsg = 'Saved successfully.',
            // A save that went through with something to say (a warning).
            okStatus = STATUS.OK,
            // Optional artifact type, e.g. 'a11y-config' -> base.a11y-config.json.
            // Purely a naming infix so the file self-identifies; the real extension
            // stays .json so editors and JSON.parse keep treating it as JSON.
            kind = ''
        }
    ) {
        const kindInfix = kind ? `.${kind}` : '';
        const suggestedFileName = `${safeBaseName(suggestedBase)}${kindInfix}.json`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: suggestedFileName,
                    types: [{ description: fileDesc, accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                setStatusRun(okMsg, okStatus);
                return;
            } catch (err) {
                // If user cancels, do not fall back to download, just stop quietly (or show a cancelled message).
                if (err && (err.name === 'AbortError' || /aborted|cancel/i.test(String(err.message || '')))) {
                    setUiState('error', 'Save cancelled.');
                    return;
                }
                console.warn('showSaveFilePicker failed, using fallback.', err);
            }
        }

        // Fallback: download with suggested name, no prompt
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = suggestedFileName;
        document.body.appendChild(link);
        link.click();
        URL.revokeObjectURL(link.href);
        document.body.removeChild(link);

        setStatusRun(okMsg + ' The browser handled location and confirmation.', okStatus);
    }
})();
