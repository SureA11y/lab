import {createActionsBuilder} from './actions-builder.module.js';
import {createEl, escapeAttr, escapeHtml, iconButton, indentPrefix, jsonBlob, linkifyUrlsToHtml, safeBaseName, scanTagChipsHtml, svgIcon} from './a11y-ui.utils.js';
import {setupRunSettings} from './run-settings.js';
import {createConfigIO} from './config-io.js';
import {createRunSummaryRenderer} from './a11y-ui.run-summary.js';
import {setupModeSwitch} from './tabs-ui.js';
import {collectScanTags, makeTagFilter, scanMatchesTagFilter, applyScanTagsEdit} from './scan-tag-filter.js';
import {makeProfileFilter, scanMatchesProfileFilter, keptProfileKeys, isProfileFilterActive} from './scan-profile-filter.js';
import {createAdvancedDialog} from './advanced-dialog.js';
import {setupRulesCatalogDialog} from './rules-catalog-dialog.module.js';
import {installInPageLinks} from './in-page-links.js';
import {installBackToTop} from './back-to-top.js';
import {trackOpenDialogs} from './page-state.js';
import {setWhenReportDrawn} from './export.js';
import {afterPaint, isBusy, runBusy} from './busy.js';
import {getActivity} from './activity.js';
import {clearLazyBodies, setLazyScope} from './lazy-dialogs.js';
import {attachFileDrop} from './file-drop.js';
import {buildGlobalSummary, ensureScanSummaryCounts, ensureScansIncludedFlag, getA11yGlobalFindings, normalizePayloadForUi, pickMetricDefsFromPayload, prepareDataForReport, stripVolatileKeysDeep} from './report-data.js';
import {collapseLineIfExpanded, deriveActionDisplayLabel, expandLineIfCollapsed, focusLineForNavigation, initSectionEndToggles, resolveLineByPathFromContainer, setupCollapseAllStepsButton} from './action-tree.js';
import {parseCustomStepsJson} from './custom-steps-data.js';
import {createStepsPanel, readActionNodes, readStepNodes} from './steps-panel.js';
import {setRunTabBadge, setRunTabSpinner} from './tab-indicators.js';
import {focusSafely, getFirstFocusable, isFocusable, shouldIgnoreGlobalUndoRedo} from './focus-utils.js';
import {STATUS, TAB_MODE_STORAGE_KEY} from './ui-constants.js';
import {createQueueRunWatch} from './queue-run-watch.js';
import {createCompareTab} from './compare-tab.js';
import {createGroupingUi} from './grouping-ui.js';
import {createScreenshotsUi} from './screenshots-ui.js';
import {createScanGroupsUi} from './scan-groups-ui.js';
import {createRunQueueUi} from './run-queue-ui.js';
import {createLiveUi} from './live-ui.js';
import {createRunSummaryUi} from './run-summary-ui.js';
import {createPageEvents} from './page-events.js';
import {createReportView} from './report-view.js';
import {createOpenReportFiles} from './open-report-files.js';
import {createBatchUi} from './batch-ui.js';
import {createCustomStepsUi} from './custom-steps-ui.js';
import {createRunWorkflowUi} from './run-workflow-ui.js';
import {createOpenReportStaging} from './open-report-staging.js';

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
        get compareProfilesEl() { return compareProfilesEl; },
        get comparePathsEl() { return comparePathsEl; },
        get compareReportsEl() { return compareReportsEl; },
        get compareStatusEl() { return compareStatusEl; },
        get getActiveBucket() { return getActiveBucket; },
        get getCurrentReportName() { return reportView.getCurrentReportName; },
        get isZipFile() { return openReportStaging.isZipFile; },
        get reportFilesLoadBtn() { return reportFilesLoadBtn; },
        get reportMetaRow() { return reportView.reportMetaRow; },
        get resultsState() { return resultsState; },
        get runComparisonEl() { return runComparisonEl; },
        get setStatusReport() { return setStatusReport; },
        get setStatusRun() { return setStatusRun; },
        get stageReportFiles() { return openReportFiles.stageReportFiles; },
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
        get applyScanInclusion() { return applyScanInclusion; },
        get updateScanTags() { return updateScanTags; },
        get $() { return $; },
        get afterConfigLoaded() { return afterConfigLoaded; },
        set afterConfigLoaded(value) { afterConfigLoaded = value; },
        get batchPanel() { return batchUi.batchPanel; },
        get cfgIO() { return cfgIO; },
        set cfgIO(value) { cfgIO = value; },
        get compareTab() { return compareTab; },
        get focusReportArea() { return focusReportArea; },
        get getWorkflowWithPasswords() { return customStepsUi.getWorkflowWithPasswords; },
        get queueRunWatch() { return queueRunWatch; },
        get refreshRunButton() { return batchUi.refreshRunButton; },
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
        get scanMatchesActiveFilters() { return scanMatchesActiveFilters; },
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
        get onDryRun() { return runWorkflowUi.onDryRun; },
        get onRunScan() { return runWorkflowUi.onRunScan; },
        get scanButton() { return scanButton; },
        get setUiState() { return setUiState; },
        get urlInput() { return urlInput; },
        get SCANS_FIRST_BATCH() { return SCANS_FIRST_BATCH; },
        get SCANS_PER_BATCH() { return SCANS_PER_BATCH; },
        get activeTagFilter() { return activeTagFilter; },
        set activeTagFilter(value) { activeTagFilter = value; },
        get activeTagSelection() { return activeTagSelection; },
        set activeTagSelection(value) { activeTagSelection = value; },
        get activeProfileFilter() { return activeProfileFilter; },
        set activeProfileFilter(value) { activeProfileFilter = value; },
        get activeProfileSelection() { return activeProfileSelection; },
        set activeProfileSelection(value) { activeProfileSelection = value; },
        get viewScan() { return viewScan; },
        get applyScanPresentationMode() { return applyScanPresentationMode; },
        get applyScanSort() { return applyScanSort; },
        get clearActiveBucketState() { return clearActiveBucketState; },
        get clearLiveStreamDialog() { return runWorkflowUi.clearLiveStreamDialog; },
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
        get scanProfileFilterEl() { return scanProfileFilterEl; },
        get scenarioInput() { return scenarioInput; },
        get screenshotsContainer() { return screenshotsContainer; },
        get screenshotsUi() { return screenshotsUi; },
        get captureStagingFocusToken() { return openReportStaging.captureStagingFocusToken; },
        get groupingFileBtn() { return groupingFileBtn; },
        get groupingScanFileBtn() { return groupingScanFileBtn; },
        get initEntrySelectionsFromParsed() { return openReportStaging.initEntrySelectionsFromParsed; },
        get loadStagedReportsIntoOpenReport() { return openReportStaging.loadStagedReportsIntoOpenReport; },
        get makeFileKey() { return openReportStaging.makeFileKey; },
        get moveStagedReportFile() { return openReportStaging.moveStagedReportFile; },
        get prepareSpareReport() { return openReportStaging.prepareSpareReport; },
        get renderStagedReportFilesList() { return openReportStaging.renderStagedReportFilesList; },
        get reportFilesClearBtn() { return reportFilesClearBtn; },
        get reportFilesListEl() { return reportFilesListEl; },
        get reportInZip() { return openReportStaging.reportInZip; },
        get reportOpenedAlone() { return openReportStaging.reportOpenedAlone; },
        set reportOpenedAlone(value) { openReportStaging.reportOpenedAlone = value; },
        get restoreStagingFocus() { return openReportStaging.restoreStagingFocus; },
        get resultsFileInput() { return resultsFileInput; },
        get stagedReportFiles() { return openReportStaging.stagedReportFiles; },
        set stagedReportFiles(value) { openReportStaging.stagedReportFiles = value; },
        get updateStagedFileSummaryInPlace() { return openReportStaging.updateStagedFileSummaryInPlace; },
        get actionsBuilder() { return actionsBuilder; },
        set actionsBuilder(value) { actionsBuilder = value; },
        get customStepActionsBuilder() { return customStepActionsBuilder; },
        set customStepActionsBuilder(value) { customStepActionsBuilder = value; },
        get getCustomStepsForConfigState() { return customStepsUi.getCustomStepsForConfigState; },
        get prepareRunRequest() { return runWorkflowUi.prepareRunRequest; },
        get runQueueUi() { return runQueueUi; },
        get copiedCustomStep() { return copiedCustomStep; },
        set copiedCustomStep(value) { copiedCustomStep = value; },
        get createCustomStepActionsHistoryButtons() { return createCustomStepActionsHistoryButtons; },
        get createCustomStepsListHistoryButtons() { return createCustomStepsListHistoryButtons; },
        get customStepActionsBuilderEl() { return customStepActionsBuilderEl; },
        get customStepActionsEl() { return customStepActionsEl; },
        get customStepAddBtn() { return customStepAddBtn; },
        get customStepCopyBtn() { return customStepCopyBtn; },
        get customStepDeleteBtn() { return customStepDeleteBtn; },
        get customStepIdInput() { return customStepIdInput; },
        get customStepInputsTextarea() { return customStepInputsTextarea; },
        get customStepNameInput() { return customStepNameInput; },
        get customStepPasteBtn() { return customStepPasteBtn; },
        get customStepToolbarEl() { return customStepToolbarEl; },
        get customStepsCountBadgeEl() { return customStepsCountBadgeEl; },
        get customStepsData() { return customStepsData; },
        set customStepsData(value) { customStepsData = value; },
        get customStepsPanelEl() { return customStepsPanelEl; },
        get onCustomStepsListChanged() { return onCustomStepsListChanged; },
        get pushCustomStepsHistory() { return pushCustomStepsHistory; },
        get resetCustomStepsHistory() { return resetCustomStepsHistory; },
        get rulesCatalog() { return rulesCatalog; },
        get scheduleCustomStepsHistoryPush() { return scheduleCustomStepsHistoryPush; },
        get selectedCustomStepIndex() { return selectedCustomStepIndex; },
        set selectedCustomStepIndex(value) { selectedCustomStepIndex = value; },
        get setCustomStepActionsHistoryBaselineToCurrent() { return setCustomStepActionsHistoryBaselineToCurrent; },
        get setCustomStepsExpanded() { return setCustomStepsExpanded; },
        get syncingCustomStepEditor() { return syncingCustomStepEditor; },
        set syncingCustomStepEditor(value) { syncingCustomStepEditor = value; },
        get batchUi() { return batchUi; },
        get clearLogsPanel() { return clearLogsPanel; },
        get colorSchemeSelect() { return colorSchemeSelect; },
        get customStepsUi() { return customStepsUi; },
        get dryRunReportEl() { return dryRunReportEl; },
        get formatElapsedHuman() { return formatElapsedHuman; },
        get getPlannedLiveStreamMode() { return getPlannedLiveStreamMode; },
        get highContrastSelect() { return highContrastSelect; },
        get languageOtherError() { return languageOtherError; },
        get languageOtherField() { return languageOtherField; },
        get languageOtherInput() { return languageOtherInput; },
        get languageSelect() { return languageSelect; },
        get retryUntrustedButton() { return retryUntrustedButton; },
        get revealCustomStepError() { return revealCustomStepError; },
        get runSettings() { return runSettings; },
        get runStartedAtMs() { return runStartedAtMs; },
        set runStartedAtMs(value) { runStartedAtMs = value; },
        get setConfigExpanded() { return setConfigExpanded; },
        get setRunPayload() { return setRunPayload; },
        get untrustedCertsSelect() { return untrustedCertsSelect; },
        get validateRunInputs() { return validateRunInputs; },
        get viewportSelect() { return viewportSelect; },
        get reportFilesCountEl() { return reportFilesCountEl; },
        get reportFilesStagingEl() { return reportFilesStagingEl; },
        get reportView() { return reportView; },
    };

    // The report's view (report-view.js): only functions, made first, as the
    // boot below already draws with them.
    const reportView = createReportView(app);
    // The custom steps editor (custom-steps-ui.js): only functions too.
    const customStepsUi = createCustomStepsUi(app);

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
    // Running a workflow (run-workflow-ui.js): made once the fields its
    // listeners take are found, before the boot uses it.
    const runWorkflowUi = createRunWorkflowUi(app);
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
    const customStepsPanelEl = $('#custom-steps-tabpanel');
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
    const scanProfileFilterEl = $('#scan-profile-filter');
    const runComparisonEl = $('#run-comparison');
    const compareContextSeg = $('#compare-context-seg');
    const compareContextDesc = $('#compare-context-desc');
    const compareLoadBtn = $('#compare-load');
    const compareInput = $('#compare-input');
    const compareReportsEl = $('#compare-reports');
    const compareClearBtn = $('#compare-clear');
    const compareOrderNote = $('#compare-order-note');
    const compareProfilesEl = $('#compare-profiles');
    const comparePathsEl = $('#compare-paths');
    const compareStatusEl = $('#compare-status');
    const compareDocEl = $('#compare-doc');
    const compareActionsEl = $('#compare-actions');

    // Live selection for the per-scan tag filter (a view lens over the report).
    // Kept as a raw {tags:[], untagged, mode} selection plus a derived matcher;
    // empty selection means "no filter" so everything shows. `mode` is the
    // combinator across selected tags - 'or' (default, widen) or 'and' (narrow).
    let activeTagSelection = { tags: [], untagged: false, mode: 'or' };
    let activeTagFilter = makeTagFilter(activeTagSelection);

    // The profile filter beside it: the keys of the profiles picked (any of
    // them matches). A scan is shown when it matches both filters.
    let activeProfileSelection = [];
    let activeProfileFilter = makeProfileFilter(activeProfileSelection);

    function scanMatchesActiveFilters(scan) {
        return scanMatchesTagFilter(scan, activeTagFilter) && scanMatchesProfileFilter(scan, activeProfileFilter);
    }

    // A scan as the Profiles selector shows it: read on the profiles of it
    // still on (shared/shared-profiles.js narrowScanToProfiles), and scored
    // again on them (rescoreScan) where the report kept the page measurements
    // to; the same object while they all are. The view, its counts and every export read
    // scans through it. Made once per selection; whether the scan is included
    // in the report is read from the scan itself, which the Exclude toggle
    // changes.
    let viewScanCache = new WeakMap();
    let viewScanCacheKey = '';
    function viewScan(scan) {
        if (!scan || typeof scan !== 'object') return scan;
        const filtering = isProfileFilterActive(activeProfileFilter);
        const key = filtering ? [...activeProfileFilter.off].sort().join('\u0001') : '';
        if (key !== viewScanCacheKey) {
            viewScanCache = new WeakMap();
            viewScanCacheKey = key;
        }
        let out = viewScanCache.get(scan);
        if (!out) {
            const api = globalThis.A11Y_SHARED_PROFILES;
            const kept = filtering ? keptProfileKeys(scan, activeProfileFilter) : [];
            out = filtering && api && typeof api.narrowScanToProfiles === 'function' && kept.length
                ? api.narrowScanToProfiles(scan, kept)
                : scan;
            // Scored again where it must be: read on fewer profiles than it
            // checked, or a scan of several saved before it took its worst
            // profile's score (shared/a11y-summary.js).
            if (api && typeof api.rescoreScan === 'function') out = api.rescoreScan(out);
            viewScanCache.set(scan, out);
        }
        // What the reader edits on the scan itself (Exclude, rename, tags)
        // is read from it, not from the copy made before the edit.
        if (out !== scan) {
            out.includedInReport = scan.includedInReport;
            out.label = scan.label;
            out.scanTags = scan.scanTags;
        }
        return out;
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
            profiles: JSON.stringify(activeProfileSelection),
            sort: activeScanSort,
            summary: lastSummaryReportValue,
        };
    }

    function sameResultsView(a, b) {
        return Object.keys(a).every((k) => a[k] === b[k]);
    }

    function resultsSlots() {
        return new Set([reportDataContainer, scanTagFilterEl, scanProfileFilterEl, summaryEl, results,
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
            profileFilter: take(scanProfileFilterEl),
            profileFilterHidden: scanProfileFilterEl.hidden,
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
        scanProfileFilterEl.append(parked.profileFilter);
        scanProfileFilterEl.hidden = parked.profileFilterHidden;
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

    /**
     * Puts scans in and out of the summary report at once: what a scan
     * group's Include all, Exclude all and Keep one do (scan-groups-ui.js).
     * `plan` is { include: [ids], exclude: [ids] }; the report is worked out
     * and drawn again once, and focus goes back to the control that had it.
     */
    function applyScanInclusion(plan, message) {
        const payload = getActiveBucket()?.payload;
        if (!payload || !Array.isArray(payload.scans)) return;

        const include = new Set(plan?.include || []);
        const exclude = new Set(plan?.exclude || []);
        const focusToken = runSummaryUi.captureGroupsFocus();
        for (const scan of payload.scans) {
            if (!scan || !scan.id) continue;
            if (include.has(scan.id)) scan.includedInReport = true;
            else if (exclude.has(scan.id)) scan.includedInReport = false;
        }

        recomputeDerivedReportData(payload);
        reportView.refreshDerivedReportUi();
        runSummaryUi.restoreGroupsFocus(focusToken);

        if (message) {
            if (resultsState.activeMode === 'report') setStatusReport(message, STATUS.OK);
            else setStatusRun(message, STATUS.OK);
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

        // The derived views that follow scan order: dispersion, and the scans
        // listed in each scan group (and which one Keep one keeps).
        scheduleDispersionRefresh();
        runSummaryUi.refreshScanGroups(payload);

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
        // Scan groups list scans by label.
        runSummaryUi.refreshScanGroups(payload);

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
        reportView.renderScanFilters(payload);
        reportView.applyScanFilterVisibility(payload.scans);
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
        runWorkflowUi.clearResultDialogs();
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

            customStepsUi.renderCustomStepsList();
            customStepsUi.loadSelectedCustomStepIntoEditor();
            customStepsUi.syncCustomStepsHiddenInput();
            customStepsUi.refreshRunCustomStepSelectors();

            lastCustomStepsHistorySig = getCustomStepsListSig(snap.steps);

            // Restoring may replace what had focus: land on the custom step
            // now open, in the panel (or the add button if there are none),
            // so a repeated keyboard shortcut still targets this list.
            customStepsPanel?.refresh();
            if (customStepsData.length && customStepsPanel) customStepsPanel.focusTree(`d${selectedCustomStepIndex}`);
            else (customStepPasteBtn || customStepAddBtn)?.focus();
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

    // In open-report-staging.js.
    const openReportStaging = createOpenReportStaging(app);

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
    // totals) when it is BOTH manually included AND matches the active tag and
    // profile filters. The two are independent: the manual Exclude toggle
    // never hides a scan from the view, while the filters never change a
    // scan's manual include state - it only narrows which scans the view and
    // the aggregate consider.
    function isScanIncludedInReport(scan) {
        return !!scan && scan.includedInReport !== false && scanMatchesActiveFilters(scan);
    }

    function getIncludedScans(payload) {
        const scans = Array.isArray(payload?.scans) ? payload.scans : [];
        return scans.filter(isScanIncludedInReport).map(viewScan);
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
        // Read on some of its profiles, its scans' scores were counted again
        // on them: said beside the score, which is not the one saved.
        const recounted = includedScans.some((scan) => scan?.metrics?.a11ySummary?.scoreRecounted);
        if (recounted && payload.metrics?.a11ySummary) payload.metrics.a11ySummary.scoreRecounted = true;

        return payload;
    }

    /* ==================== Config collapse UI ==================== */

    function setConfigExpanded(expanded) {
        if (!configToggleDisableActionBtn || !configContentEl) return;

        configToggleDisableActionBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        configContentEl.hidden = !expanded;
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
        if (typeof sections.batch === 'boolean') batchUi.batchPanel?.setExpanded(!sections.batch);
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
        if (idx !== selectedCustomStepIndex) customStepsUi.selectCustomStep(idx);
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

    /**
     * Opens a step for a steps panel: the containers it is in and its card,
     * then scrolls to it and, with `focus`, moves focus to it. Other cards
     * stay as they are.
     */
    function revealLine(line, {focus = false} = {}) {
        const ancestors = [];
        for (let p = line.parentElement?.closest('.line'); p; p = p.parentElement?.closest('.line')) ancestors.unshift(p);
        ancestors.forEach(expandLineIfCollapsed);
        expandLineIfCollapsed(line);
        // A near step glides into view; a far one jumps, as a long glide
        // through a thousand steps is still going when you want to read it.
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const far = Math.abs(line.getBoundingClientRect().top) > 2 * window.innerHeight;
        line.scrollIntoView({block: 'center', behavior: reduce || far ? 'auto' : 'smooth'});
        if (!focus) return;
        // The step itself takes focus: it is a named group ("3.2.1 - Click"),
        // so a screen reader says where focus went, and Tab goes on into it.
        if (!line.hasAttribute('tabindex')) line.setAttribute('tabindex', '-1');
        line.focus({preventScroll: true});
    }

    function goToWorkflowLine(line, {focus = false} = {}) {
        if (!line) return;
        setConfigExpanded(true);
        setWorkflowExpanded(true);
        revealLine(line, {focus});
    }

    // ---- The Custom steps panel ----
    // Its top rows are the custom steps; under each, its steps. The one open
    // in the editor is read from its lines, the others from their saved steps.
    let stepDefs = null;
    let customStepsPanel = null;

    const defIndexOf = (nodeId) => Number((/^d(\d+)/.exec(String(nodeId || '')) || [])[1] ?? -1);

    function typeTitleOf(type) {
        return String(stepDefs?.[type]?.label || type || '');
    }

    function listsOf(type) {
        const fields = stepDefs?.[type]?.fields || {};
        return Object.keys(fields).filter((k) => String(fields[k]?.type || '') === 'Action[]');
    }

    // What a saved step is called, as the editor would title it.
    function nameOfAction(action) {
        // A call with no title of its own is named by the panel (callName).
        if (action.type === 'runCustomStep') return String(action.label || action.alias || '').trim();
        const own = deriveActionDisplayLabel(action);
        if (own) return own;
        if (action.type === 'case') {
            const options = stepDefs?.case?.fields?.comparison?.options || [];
            const opt = options.find((x) => String(x?.value ?? x) === String(action.comparison ?? ''));
            const how = opt ? String(opt.label ?? opt.value ?? opt) : '';
            if (how) return `${typeTitleOf('case')} · ${how} "${action.value ?? ''}"`;
        }
        return '';
    }

    function callsIn(actions, id) {
        return (Array.isArray(actions) ? actions : []).some((a) => a && typeof a === 'object' && (
            (a.type === 'runCustomStep' && String(a.customStepId || '').trim() === id)
            || Object.values(a).some((v) => Array.isArray(v) && callsIn(v, id))));
    }

    function customStepName(id) {
        const def = customStepsData.find((d) => String(d?.id || '').trim() === id);
        return def ? String(def.name || def.id) : '';
    }

    function openCustomStepCalls() {
        const ids = new Set();
        customStepActionsEl?.querySelectorAll('.line[data-action-type="runCustomStep"] .field[data-field-name="customStepId"] select')
            .forEach((sel) => { if (sel.value) ids.add(sel.value.trim()); });
        return ids;
    }

    /** Where a custom step runs: the workflow's calls to it, and the custom steps that call it. */
    function customStepUsage(id) {
        const key = String(id || '').trim();
        const inWorkflow = key ? (workflowStepsPanel?.nodes || []).filter((n) => n.calls === key) : [];
        const inCustomSteps = key ? customStepsData
            .map((d, i) => ({d, i}))
            .filter(({d, i}) => i !== customStepsData.findIndex((x) => x.id === key) && (
                // The one open in the editor may have changed since it was saved: read its lines.
                i === selectedCustomStepIndex ? openCustomStepCalls().has(key) : callsIn(d.actions, key)))
            : [];
        return {inWorkflow, inCustomSteps};
    }

    function usageNote({inWorkflow, inCustomSteps}) {
        const parts = [];
        if (inWorkflow.length) parts.push(`runs at ${inWorkflow.map((n) => n.path).join(', ')}`);
        if (inCustomSteps.length) parts.push(`in ${inCustomSteps.map(({d}) => d.name || d.id).join(', ')}`);
        return parts.length ? parts.join(' · ') : 'not used';
    }

    function readCustomStepNodes() {
        const nodes = [];
        const lineById = new Map();
        customStepsData.forEach((def, i) => {
            const defId = `d${i}`;
            const name = String(def?.name || def?.id || `Custom step ${i + 1}`);
            const head = {
                id: defId, foldKey: `def:${def?.id || name}`, key: '', path: '', depth: 0, parentId: null, root: true, container: true, disabled: false,
                type: 'customStep', typeTitle: 'Custom step', name,
                note: usageNote(customStepUsage(def?.id)),
                searchText: `${name} ${def?.id || ''}`.toLowerCase()
            };
            nodes.push(head);
            if (i === selectedCustomStepIndex && customStepActionsEl) {
                const got = readStepNodes(customStepActionsEl, (line, key) => `${defId}/${key}`, {depth: 1, parentId: defId});
                nodes.push(...got.nodes);
                got.lineById.forEach((line, id) => lineById.set(id, line));
            } else {
                nodes.push(...readActionNodes(def?.actions, {
                    idOf: (key) => `${defId}/${key}`, typeTitleOf, nameOf: nameOfAction, listsOf, depth: 1, parentId: defId
                }));
            }
        });
        return {nodes, lineById};
    }

    function openCustomStepOf(node) {
        const index = defIndexOf(node?.id);
        if (index < 0 || index >= customStepsData.length) return;
        if (index !== selectedCustomStepIndex) customStepsUi.selectCustomStep(index);
    }

    function goToCustomStepLine(line, {focus = false, node = null} = {}) {
        setConfigExpanded(true);
        setCustomStepsExpanded(true);
        if (line) {
            revealLine(line, {focus});
            return;
        }
        // A custom step's own row: open it, and its name field is where to start.
        openCustomStepOf(node);
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        customStepsPanelEl?.scrollIntoView({block: 'start', behavior: reduce ? 'auto' : 'smooth'});
        if (focus) customStepIdInput?.focus({preventScroll: true});
    }

    /** Goes to a custom step by its id, from a call to it. */
    function openCustomStepById(id) {
        const index = customStepsData.findIndex((d) => String(d?.id || '').trim() === String(id || '').trim());
        if (index < 0 || !customStepsPanel) return;
        customStepsPanel.refresh();
        customStepsPanel.goTo(`d${index}`, {focus: true});
    }

    // Under the custom step open in the editor: where it is called from.
    const customStepUsageEl = $('#custom-step-usage');
    function drawCustomStepUsage() {
        if (!customStepUsageEl) return;
        const def = customStepsData[selectedCustomStepIndex];
        customStepUsageEl.textContent = '';
        customStepUsageEl.hidden = !def;
        if (!def) return;
        const {inWorkflow, inCustomSteps} = customStepUsage(def.id);
        customStepUsageEl.append(createEl('span', {}, 'Used in:'));
        if (!inWorkflow.length && !inCustomSteps.length) {
            customStepUsageEl.append(createEl('span', {}, 'nothing yet: no step runs it.'));
            return;
        }
        inWorkflow.forEach((n) => {
            const btn = createEl('button', {type: 'button', className: 'link-button custom-step-usage__link'}, `Workflow step ${n.path} →`);
            btn.addEventListener('click', () => workflowStepsPanel?.goTo(n.id, {focus: true}));
            customStepUsageEl.append(btn);
        });
        inCustomSteps.forEach(({d, i}) => {
            const btn = createEl('button', {type: 'button', className: 'link-button custom-step-usage__link'}, `Custom step ${d.name || d.id} →`);
            btn.addEventListener('click', () => customStepsPanel?.goTo(`d${i}`, {focus: true}));
            customStepUsageEl.append(btn);
        });
    }

    /**
     * A step of a custom step, as saved: found by its panel id ("d1/3.2|actions"),
     * its number and the lists it is in, as the editor numbers them.
     */
    function savedCustomStepAction(nodeId, data = customStepsData) {
        const m = /^d(\d+)\/([^|]*)\|(.*)$/.exec(String(nodeId || ''));
        if (!m) return null;
        const def = data[Number(m[1])];
        const path = m[2].split('.').map((x) => Number(x) - 1);
        const trail = m[3] ? m[3].split('.') : [];
        let list = def?.actions;
        let action = null;
        for (let i = 0; i < path.length; i += 1) {
            action = Array.isArray(list) ? list[path[i]] : null;
            if (!action) return null;
            if (i < path.length - 1) list = action[trail[i]];
        }
        return action;
    }

    /**
     * Changes steps of custom steps where they are kept, open in the editor
     * or not, as one change of the Custom steps: the panel's Undo puts it
     * back. The one open is first saved as the editor has it, and that is
     * kept as a change of its own, so Undo takes back this change only.
     */
    function changeSavedCustomSteps(entries, change) {
        const saved = customStepsUi.readCustomStepsFromUi({validate: false});
        if (!saved?.ok) return 0;
        pushCustomStepsHistory();
        let changed = 0;
        entries.forEach((entry) => {
            const action = savedCustomStepAction(entry.node?.id);
            if (action && change(action, entry)) changed += 1;
        });
        if (!changed) return 0;
        customStepsUi.loadSelectedCustomStepIntoEditor();
        customStepsUi.syncCustomStepsHiddenInput();
        pushCustomStepsHistory();
        customStepsPanel?.refresh();
        return changed;
    }

    function onCustomStepsListChanged() {
        customStepsPanel?.refresh();
    }

    // "3 more matches in Custom steps →": the other panel, filtered alike.
    function showFilteredIn(panel, expand, kind, query) {
        if (!panel) return;
        setConfigExpanded(true);
        expand(true);
        panel.setFilter(kind, query);
        panel.focusTree();
    }

    let workflowStepsPanel = null;
    function initWorkflowStepsPanel() {
        const host = $('#workflow-steps-panel');
        if (!host || !actionsBar || workflowStepsPanel) return;
        workflowStepsPanel = createStepsPanel({
            host,
            editorEl: actionsBar,
            sectionKey: 'workflow',
            title: 'Workflow steps',
            // Folded each time the app loads, whatever it was before.
            startHidden: true,
            goToLine: goToWorkflowLine,
            callName: customStepName,
            barHost: $('#workflow-selection-bar'),
            setDisabled: (entries, on) => actionsBuilder?.setStepsDisabled(entries.map((e) => e.line).filter(Boolean), on) || 0,
            edit: {
                get defs() { return stepDefs; },
                read: (node, line) => actionsBuilder?.readStep(line),
                apply: (entries) => actionsBuilder?.setStepsFieldValues(entries.filter((e) => e.line)) || 0,
                makeField: (type, name) => actionsBuilder?.createEditField(type, name) || null,
                warn: (nodes) => {
                    const off = nodes.filter((n) => n.disabled).length;
                    return off ? `${off} of these ${off === 1 ? 'is' : 'are'} turned off: changed like the others, ${off === 1 ? 'it stays' : 'they stay'} off.` : '';
                }
            },
            elsewhere: {
                label: 'Custom steps',
                count: (kind, query) => customStepsPanel?.countMatches(kind, query) || 0,
                go: (kind, query) => showFilteredIn(customStepsPanel, setCustomStepsExpanded, kind, query)
            },
            // Where each custom step runs comes from the workflow's calls.
            onRead: () => customStepsPanel?.refresh()
        });
    }

    function initCustomStepsPanel(defs) {
        stepDefs = defs;
        const host = $('#custom-steps-steps-panel');
        if (!host || !customStepActionsEl || customStepsPanel) return;
        customStepsPanel = createStepsPanel({
            host,
            editorEl: customStepActionsEl,
            sectionKey: 'custom-steps',
            title: 'Custom steps',
            startHidden: true,
            read: readCustomStepNodes,
            open: openCustomStepOf,
            goToLine: goToCustomStepLine,
            callName: customStepName,
            barHost: $('#custom-steps-selection-bar'),
            // Steps of every custom step can be selected, open in the editor
            // or not: they are changed in the custom steps' saved steps.
            selectAnywhere: true,
            foldNewRoots: true,
            outsideLabel: 'other custom steps',
            setDisabled: (entries, on) => changeSavedCustomSteps(entries, (action) => {
                if (!!action.disabled === !!on) return false;
                if (on) action.disabled = true;
                else delete action.disabled;
                return true;
            }),
            edit: {
                get defs() { return stepDefs; },
                read: (node, line) => (line ? customStepActionsBuilder?.readStep(line) : savedCustomStepAction(node.id)) || {},
                apply: (entries) => changeSavedCustomSteps(entries, (action, entry) => {
                    Object.assign(action, JSON.parse(JSON.stringify(entry.values)));
                    return true;
                }),
                makeField: (type, name) => customStepActionsBuilder?.createEditField(type, name) || null,
                // Steps of a custom step are changed for every call to it.
                warn: (nodes) => {
                    const defs = Array.from(new Set(nodes.map((n) => defIndexOf(n.id)))).filter((i) => i >= 0).map((i) => customStepsData[i]).filter(Boolean);
                    if (!defs.length) return '';
                    const parts = defs.map((def) => {
                        const {inWorkflow, inCustomSteps} = customStepUsage(def.id);
                        const where = [
                            inWorkflow.length ? `workflow ${inWorkflow.length === 1 ? 'step' : 'steps'} ${inWorkflow.map((n) => n.path).join(', ')}` : '',
                            inCustomSteps.length ? inCustomSteps.map(({d}) => `“${d.name || d.id}”`).join(', ') : ''
                        ].filter(Boolean).join(' and ');
                        return `“${def.name || def.id}” ${where ? `runs at ${where}` : 'is not run yet'}`;
                    });
                    return `These steps are in custom steps, so every place that runs them gets the change: ${parts.join('; ')}.`;
                }
            },
            elsewhere: {
                label: 'the Workflow',
                count: (kind, query) => workflowStepsPanel?.countMatches(kind, query) || 0,
                go: (kind, query) => showFilteredIn(workflowStepsPanel, setWorkflowExpanded, kind, query)
            },
            onRead: () => {
                drawCustomStepUsage();
                workflowStepsPanel?.recountElsewhere();
            }
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

    // log: false when the log has said it already (a failed run's reason,
    // which the server's log ends with).
    function setStatusRun(message, type, {log = true} = {}) {
        if (!statusRunEl) return;
        statusRunEl.textContent = message || '';
        statusRunEl.className = 'status';
        if (type) statusRunEl.classList.add(type);
        if (log) appendLog(message, type);
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
    function setUiState(state, message = '', {log = true} = {}) {
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
            if (message) setStatusRun(message, STATUS.ERROR, {log});
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
    createScanGroupsUi(app);

    // ---- Scan sorting ----
    // Sort is a stable ordering of every scan card, applied by the shared module
    // that reads the data-sort-* baked onto each card. It is independent of the
    // tag and profile filters and the include state, which only change visibility. The same
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

    // In batch-ui.js.
    const batchUi = createBatchUi(app);

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

        openReportStaging.stageReportObject(payload, name);

        // Optional: focus the staging area
        focusSafely(resultsFileBtn);

        // For auto-load, uncomment:
        // await loadStagedReportsIntoOpenReport();
    });

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
            keepFocusThroughRebuild(() => {
                if (e.shiftKey) actionsBuilder.redo();
                else if (!atBaseline) actionsBuilder.undo();
            });
            syncHistoryButtons();
        }
    });

    // Undo and redo rebuild every step, so the control that had focus is
    // gone: focus goes to the control in its place in the rebuilt steps (the
    // nearest shown one before it, as a closed panel's checkbox gives its
    // Change button), else to the Undo button, else to the list.
    function keepFocusThroughRebuild(rebuild) {
        const active = document.activeElement;
        const focusables = () => (actionsBar
            ? [...actionsBar.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
            : []);
        const at = focusables().indexOf(active);
        rebuild();
        if (active && active !== document.body && active.isConnected) return;
        const after = focusables();
        const shown = (el) => !el.disabled && el.getClientRects().length > 0;
        let target = null;
        for (let i = Math.min(at, after.length - 1); i >= 0 && !target; i -= 1) {
            if (shown(after[i])) target = after[i];
        }
        if (!target && undoBtnEl && shown(undoBtnEl)) target = undoBtnEl;
        if (!target && actionsBar) {
            if (!actionsBar.hasAttribute('tabindex')) actionsBar.setAttribute('tabindex', '-1');
            target = actionsBar;
        }
        target?.focus();
    }

    // In open-report-files.js.
    const openReportFiles = createOpenReportFiles(app);

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
    trackOpenDialogs(document);
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
                runWorkflowUi.syncRunLanguageOther();
                runSettings.sync();
            },
            getLanguages: runWorkflowUi.runLanguageTags,
            getCustomSteps: customStepsUi.getCustomStepsForConfigState,
            setCustomSteps: customStepsUi.setCustomStepsFromConfigState,
            getRunSpec: runWorkflowUi.collectRunSpec,
            getBatch: () => batchUi.batchPanel?.getBatchForConfig() ?? null,
            setBatch: (batch) => batchUi.batchPanel?.setBatchFromConfig(batch),
            getSections: getSectionsState,
            setSections: setSectionsState,
            loadBatchRows: (rows) => batchUi.batchPanel?.loadRows(rows),
            appendConfigState: customStepsUi.appendConfigState,
            planBatchAppend: (batch) => batchUi.batchPanel?.planAppendFromConfig(batch) ?? null,
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

        // A filter typed for the steps before belongs to them, not to the
        // ones a loaded or appended config brings: both steps panels list
        // every step again.
        const resetStepsPanelFilters = () => {
            workflowStepsPanel?.setFilter('all', '');
            customStepsPanel?.setFilter('all', '');
        };
        afterConfigLoaded = () => {
            if (customStepActionsBuilder) {
                try {
                    customStepsUi.setCustomStepsInUi(parseCustomStepsJson(customStepsInput?.value || ''), {selectFirst: true});
                } catch (e) {
                    setUiState('error', String(e?.message || e));
                }
            }
            resetStepsPanelFilters();
            clearLogsPanel();
            clearResults();
            clearScreenshots();
            summaryEl.textContent = '';
            liveUi.resetLivePanels();
            if (loadAndRun) {
                runWorkflowUi.onRunScan();
            }
            setHistoryBaselineToCurrent();
        };
        cfgIO.setupConfigLoader(afterConfigLoaded);
        // The step editor exists now: give it the batch's row variable names.
        batchUi.batchPanel?.check();
        // Append is an additive edit on top of the current config, so — unlike
        // load — it must stay undoable (the actions builder and custom-steps
        // list each pushed their own history entry). Don't reset the baseline.
        cfgIO.setupConfigAppender(resetStepsPanelFilters);
        cfgIO.setupConfigSaver($('#save-config-button'));

        cfgIO.autoApplyFromQuery();
        if (openQuery) compareTab.openFromQuery(openQuery).catch((e) => console.error('Could not open from the address', e));
        if (customStepActionsBuilder) {
            try {
                customStepsUi.setCustomStepsInUi(parseCustomStepsJson(customStepsInput?.value || ''), {selectFirst: true});
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
            // A step's buttons moving into its menu, or out, as it comes into
            // view changes no step: Undo and Redo are left alone for it.
            const onlyChrome = (rec) => {
                const t = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
                return !!t && !!t.closest('.line-controls, .flyout-menu, .flyout-root');
            };
            historyObserver = new MutationObserver((records) => {
                if (records.every(onlyChrome)) return;
                scheduleHistorySync();
            });
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
                    defs.runCustomStep.fields.customStepId.optionsProvider = () => customStepsUi.getCustomStepSelectChoices();
                }
                if (defs?.runCustomStep) {
                    defs.runCustomStep.openCustomStep = (customStepId) => openCustomStepById(customStepId);
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
                initWorkflowStepsPanel();
                customStepsUi.initCustomStepsUi(defs);
                initCustomStepsPanel(defs);
                runWorkflowUi.fillRunLanguages(defs);
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
        const customSteps = customStepsUi.getCustomStepsForConfigState()?.value || [];
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
        const languageProblem = runWorkflowUi.runLanguageProblem();
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

    // ---- The run's language: Set language's list, or any tag with "Other…" ----


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
