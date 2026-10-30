import {createActionsBuilder, redactMaskedFieldsDeep, withPasswordStepTypeDeep} from './actions-builder.module.js';
import {
    buildLabeledSelect,
    createEl,
    createImg,
    escapeAttr,
    escapeHtml,
    iconButton,
    indentPrefix,
    jsonBlob,
    jsonToBrowserLink,
    linkifyUrlsToHtml,
    parseForEachIteration,
    parseRepeatIteration,
    safeBaseName,
    scanTagChipsHtml,
    svgIcon,
    createSplitButton
} from './a11y-ui.utils.js';
import {enhanceAsLiveCarousel} from './carousel-ui.js';
import {fetchWorkflowResult, pollWorkflowUntilDone, runFailureMessage} from './a11y-ui.workflow.js';
import {createStreamCardAdder, renderAllScansCard, screenshotAlt} from './stream-ui.js';
import {scanToAllScansCardProps} from './all-scans-data.js';
import {isFailureFreeScan, failureFreeScansNote} from './scan-failures.js';
import {createProgressProcessor} from './progress-processor.js';
import {createLiveTotals} from './live-totals.js';
import {createRunDialog} from './run-dialog.js';
import {
    collectVarsDeep,
    createLiveView,
    deriveScreenshotCaption as deriveLiveScreenshotCaption,
    findUnresolvedVars,
    resolveLabelTemplate as resolveLiveLabel
} from './live-view.js';
import {createConfigIO} from './config-io.js';
import {createRenderer} from './a11y-ui.rendering.js';
import {SCAN_FIELDS, pickFindingFields, optInRulesLabel, CANONICAL_FIELDS} from './report-fields.js';
import {enginesHTML, howTestedHTML} from './engine-brand.js';
import {openConformanceReview} from './conformance-review.js';
import {createRunSummaryRenderer} from './a11y-ui.run-summary.js';
import {setupModeSwitch} from './tabs-ui.js';
import {createRunQueuePanel, describeRunNow} from './run-queue-panel.js';
import {createBatchPanel, runLabelFor} from './batch-panel.js';
import {collectScanTags, makeTagFilter, isTagFilterActive, scanMatchesTagFilter, applyScanTagsEdit} from './scan-tag-filter.js';
import {canCompareReport, createComparisonController, MAX_REPORTS as MAX_COMPARE_REPORTS} from './report-comparison-controller.js';
import {pickReportNamePrefill} from './report-name.js';
import {formatReportTimestamp} from './report-timestamp.js';
import {reportMetaField} from './report-meta-fields.js';
import {
    META_FIELD_ATTR,
    META_VALUE_CLASS,
    mountReportMetaEditors
} from './report-meta-edit.js';
import {createAdvancedDialog} from './advanced-dialog.js';
import {setupRulesCatalogDialog} from './rules-catalog-dialog.module.js';
import {installInPageLinks} from './in-page-links.js';
import {installBackToTop} from './back-to-top.js';
import {
    createClearReportBtn,
    createCompareReportBtn,
    createDownloadReportSplitButton,
    downloadConformanceReport,
    downloadConformanceReportDocx,
    setWhenReportDrawn,
    createDownloadComparisonBtn
} from './export.js';
import {readCompareZip} from './comparison-bundle.js';
import {watchForMissingPictures} from './missing-pictures.js';
import {folderOf, rebaseImageRefs} from './report-package.js';
import {afterPaint, isBusy, runBusy, setBusy} from './busy.js';
import {getActivity} from './activity.js';
import {clearLazyBodies, openLazyDialog, setLazyScope} from './lazy-dialogs.js';
import {attachFileDrop} from './file-drop.js';
import {groupings} from './config/groupings.js';
import {cleanGroupingItem, normalizeGroupingSpec} from './grouping-spec.js';
import {buildGlobalSummary, cloneJsonData, collectReportEngines, computeReportGlobals, computeTotals, ensureScanSummaryCounts, ensureScansIncludedFlag, getA11yGlobalFindings, getAllArtifactUrls, getOccurrenceOutcome, getScreenshotsFromPayload, hashHex16, keepOnlyKeys, makeGlobalFindingKey, makeHex, mergeFindingIntoMap, mergeOccurrencesWithPageUrl, normalizePayloadForUi, normalizeStringArray, parseReportText, pickMetricDefsFromPayload, pickMetricDefsFromStaged, prepareDataForReport, readReportFile, sortByOrderKey, splitFindingByOccurrenceOutcome, stripVolatileKeysDeep, sumNumericLeaves, toNumber, validateReportOrThrow} from './report-data.js';
import {buildActionTreeNodes, buildCustomStepMaps, collapseAllLinesIn, collapseLineIfExpanded, deriveActionDisplayLabel, expandAllLinesIn, expandLineIfCollapsed, extractActionPathFromMessage, findDirectNestedActionContainerByField, focusLineForNavigation, getDirectActionLines, getDirectNestedActionContainers, getLineToggleButton, getNestedActionArraysFromAction, hasVisibleExpandedLine, initSectionEndToggles, isLineVisible, parseActionPath, resolveLineByPathFromContainer, resolveStepRefForLogEntry, setupCollapseAllStepsButton} from './action-tree.js';
import {cloneCustomStepValue, collectUsedCustomStepIds, customStepTabId, deepRemapCustomStepIds, formatCustomStepInputsText, makeUniqueImportedId, normalizeCustomStepInputs, parseCustomStepInputsText, parseCustomStepsJson} from './custom-steps-data.js';
import {ensureRunTabIndicator, ensureTabIndicator, getBaseTabLabel, setQueueTabSpinner, setRunTabBadge, setRunTabSpinner, setTabA11ySuffix} from './tab-indicators.js';
import {focusSafely, getFirstFocusable, isActuallyFocusable, isEditableElement, isFocusable, shouldIgnoreGlobalUndoRedo} from './focus-utils.js';

/* ==================== Constants & enums ==================== */

const STATUS = {OK: 'ok', BUSY: 'busy', ERROR: 'error', WARNING: 'warning', DEBUG: 'debug', INFO: 'info'};
const PROGRESS_POLL_INTERVAL_MS = 800;
const TAB_MODE_STORAGE_KEY = 'a11ylab-active-mode';
const GROUPING_STATE_STORAGE_KEY = 'a11ylab-grouping-state-v1';

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
            grouping: getSelectedBuiltInGroupingId(mode),
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

        let selected = findBuiltInGroupingById(
            getSelectedBuiltInGroupingId(resultsState.activeMode),
            resultsState.activeMode
        );

        if (!selected) {
            const fallbackId = getLastResolvedGroupingSelectionId(resultsState.activeMode) || 'none';
            setSelectedBuiltInGroupingId(fallbackId, resultsState.activeMode);
            selected = findBuiltInGroupingById(fallbackId, resultsState.activeMode) || findBuiltInGroupingById('none', resultsState.activeMode);
        }

        if (!selected || selected.id === 'custom' || !selected.groups) {
            renderer.setIssueGroupingSpec(null);
        } else {
            renderer.setIssueGroupingSpec(selected.groups);
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
        refreshDerivedReportUi();
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
        const html = renderer.buildDispersionSectionHtml(scans);
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
        renderScanTagFilter(payload);
        applyScanTagFilterVisibility(payload.scans);
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

        lastPromptedScenarioByMode.run = seedPromptedScenarioFor(normalizedPayload);

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

        lastPromptedScenarioByMode.report = seedPromptedScenarioFor(normalizedPayload);

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
        renderFinalPayload(data, data.url || urlInput?.value?.trim() || '');
        resultsRenderedFor = {
            mode: resultsState.activeMode,
            payload: bucket.payload,
            grouping: getSelectedBuiltInGroupingId(resultsState.activeMode),
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
                <div style="min-width:260px; text-align: left;">
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
                    <div style="min-width:260px; flex:1; padding-right: 10px; border-right: 1px dotted;">
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

                    <div style="min-width:260px; flex:1;">
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

    let groupingLoaded = false;
    let builtInGroupingSelectEls = [];
    let groupingPickerTargetMode = null;

    const groupingStateByMode = {
        run: {
            selectedBuiltInGroupingId: 'none',
            lastResolvedGroupingSelectionId: 'none',
            loadedCustomGrouping: null
        },
        report: {
            selectedBuiltInGroupingId: 'none',
            lastResolvedGroupingSelectionId: 'none',
            loadedCustomGrouping: null
        }
    };

    function normalizeStoredGroupingEntry(raw) {
        const out = {
            selectedBuiltInGroupingId: 'none',
            lastResolvedGroupingSelectionId: 'none',
            loadedCustomGrouping: null
        };

        if (!raw || typeof raw !== 'object') return out;

        const selectedBuiltInGroupingId = String(raw.selectedBuiltInGroupingId || 'none').trim() || 'none';
        const lastResolvedGroupingSelectionId = String(raw.lastResolvedGroupingSelectionId || 'none').trim() || 'none';

        out.selectedBuiltInGroupingId = selectedBuiltInGroupingId;
        out.lastResolvedGroupingSelectionId = lastResolvedGroupingSelectionId;

        const custom = raw.loadedCustomGrouping;
        if (
            custom &&
            typeof custom === 'object' &&
            String(custom.id || '').trim() &&
            String(custom.label || '').trim() &&
            Array.isArray(custom.groups)
        ) {
            const cleanedGroups = normalizeGroupingSpec(custom.groups);

            if (cleanedGroups.length) {
                out.loadedCustomGrouping = {
                    id: String(custom.id).trim(),
                    label: String(custom.label).trim(),
                    groups: cleanedGroups
                };
            }
        }

        if (out.selectedBuiltInGroupingId === 'custom-loaded' && !out.loadedCustomGrouping) {
            out.selectedBuiltInGroupingId = out.lastResolvedGroupingSelectionId || 'none';
            if (out.selectedBuiltInGroupingId === 'custom-loaded') {
                out.selectedBuiltInGroupingId = 'none';
            }
        }

        if (out.lastResolvedGroupingSelectionId === 'custom-loaded' && !out.loadedCustomGrouping) {
            out.lastResolvedGroupingSelectionId = 'none';
        }

        return out;
    }

    function loadGroupingStateFromStorage() {
        try {
            const raw = localStorage.getItem(GROUPING_STATE_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;

            const runEntry = normalizeStoredGroupingEntry(parsed.run);
            const reportEntry = normalizeStoredGroupingEntry(parsed.report);

            groupingStateByMode.run = runEntry;
            groupingStateByMode.report = reportEntry;
        } catch {
            // ignore storage errors
        }
    }

    function saveGroupingStateToStorage() {
        try {
            const payload = {
                run: {
                    selectedBuiltInGroupingId: groupingStateByMode.run.selectedBuiltInGroupingId,
                    lastResolvedGroupingSelectionId: groupingStateByMode.run.lastResolvedGroupingSelectionId,
                    loadedCustomGrouping: groupingStateByMode.run.loadedCustomGrouping
                },
                report: {
                    selectedBuiltInGroupingId: groupingStateByMode.report.selectedBuiltInGroupingId,
                    lastResolvedGroupingSelectionId: groupingStateByMode.report.lastResolvedGroupingSelectionId,
                    loadedCustomGrouping: groupingStateByMode.report.loadedCustomGrouping
                }
            };

            localStorage.setItem(GROUPING_STATE_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // ignore storage errors
        }
    }

    function getGroupingState(mode = resultsState.activeMode) {
        return mode === 'report'
            ? groupingStateByMode.report
            : groupingStateByMode.run;
    }

    function getSelectedBuiltInGroupingId(mode = resultsState.activeMode) {
        return getGroupingState(mode).selectedBuiltInGroupingId;
    }

    function setSelectedBuiltInGroupingId(value, mode = resultsState.activeMode) {
        getGroupingState(mode).selectedBuiltInGroupingId = value;
        saveGroupingStateToStorage();
    }

    function getLastResolvedGroupingSelectionId(mode = resultsState.activeMode) {
        return getGroupingState(mode).lastResolvedGroupingSelectionId;
    }

    function setLastResolvedGroupingSelectionId(value, mode = resultsState.activeMode) {
        getGroupingState(mode).lastResolvedGroupingSelectionId = value;
        saveGroupingStateToStorage();
    }

    function getLoadedCustomGrouping(mode = resultsState.activeMode) {
        return getGroupingState(mode).loadedCustomGrouping;
    }

    function setLoadedCustomGrouping(value, mode = resultsState.activeMode) {
        getGroupingState(mode).loadedCustomGrouping = value;
        saveGroupingStateToStorage();
    }

    loadGroupingStateFromStorage();

    function normalizeGroupingPresetList(list) {
        if (!Array.isArray(list)) return [];

        return list
            .map((item) => {
                if (!item || typeof item !== 'object') return null;

                const id = String(item.id || '').trim();
                const label = String(item.label || '').trim();
                const groups = Array.isArray(item.groups) ? item.groups : [];

                if (!id || !label || !groups.length) return null;

                return {
                    id,
                    label,
                    groups
                };
            })
            .filter(Boolean);
    }

    function getAvailableBuiltInGroupings(mode = resultsState.activeMode) {
        const items = [
            {id: 'none', label: 'None', groups: null},
            ...normalizeGroupingPresetList(groupings)
        ];

        const loadedCustomGrouping = getLoadedCustomGrouping(mode);
        if (loadedCustomGrouping) {
            items.push(loadedCustomGrouping);
        }

        items.push({id: 'custom', label: 'Custom...', groups: null});

        return items;
    }

    function findBuiltInGroupingById(id, mode = resultsState.activeMode) {
        const wanted = String(id || 'none').trim() || 'none';
        return getAvailableBuiltInGroupings(mode).find((item) => item.id === wanted) || null;
    }

    function refreshBuiltInGroupingSelectOptions(mode = resultsState.activeMode) {
        if (!builtInGroupingSelectEls.length) return;

        const currentValue = getSelectedBuiltInGroupingId(mode);
        const available = getAvailableBuiltInGroupings(mode);

        builtInGroupingSelectEls.forEach((selectEl) => {
            if (!selectEl) return;

            selectEl.innerHTML = '';

            for (const item of available) {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.label;
                if (item.id === currentValue) opt.selected = true;
                selectEl.appendChild(opt);
            }

            selectEl.value = findBuiltInGroupingById(currentValue, mode) ? currentValue : 'none';
        });
    }

    function applySelectedBuiltInGrouping(mode = resultsState.activeMode) {
        const selectedBuiltInGroupingId = getSelectedBuiltInGroupingId(mode);
        const selected = findBuiltInGroupingById(selectedBuiltInGroupingId, mode);

        if (!selected || selected.id === 'custom' || !selected.groups) {
            renderer.setIssueGroupingSpec(null);
        } else {
            renderer.setIssueGroupingSpec(selected.groups);
            setLastResolvedGroupingSelectionId(selected.id, mode);
        }

        if (selected && selected.id === 'none') {
            setLastResolvedGroupingSelectionId('none', mode);
        }

        if (mode === resultsState.activeMode) {
            renderActiveBucket();
        }
    }

    function buildVisualizationGroupingSelect() {
        const wrapper = document.createElement('div');

        const selectId = 'results-grouping-select';

        const label = document.createElement('label');
        label.textContent = 'Grouping';
        label.htmlFor = selectId;
        wrapper.appendChild(label);

        const select = document.createElement('select');
        select.id = selectId;
        select.name = 'resultsGrouping';

        const mode = resultsState.activeMode;
        const available = getAvailableBuiltInGroupings(mode);
        const selectedValue = findBuiltInGroupingById(getSelectedBuiltInGroupingId(mode), mode)
            ? getSelectedBuiltInGroupingId(mode)
            : 'none';;

        for (const item of available) {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.label;
            if (item.id === selectedValue) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }

        wrapper.appendChild(select);

        select.addEventListener('change', () => {
            const value = select.value;
            const nextValue = findBuiltInGroupingById(value, mode) ? value : 'none';

            if (nextValue === 'custom') {
                groupingPickerTargetMode = mode;
                groupingFileInput?.click();

                // Restore visible selection to the current resolved one,
                // because the custom file picker has not loaded anything yet.
                select.value = findBuiltInGroupingById(getSelectedBuiltInGroupingId(mode), mode)
                    ? getSelectedBuiltInGroupingId(mode)
                    : 'none';
                return;
            }

            setSelectedBuiltInGroupingId(nextValue, mode);
            updateResults(select, () => {
                applySelectedBuiltInGrouping(mode);
                announceGrouping();
            });
        });

        function announceGrouping() {
            const selectedGrouping = findBuiltInGroupingById(
                getSelectedBuiltInGroupingId(mode),
                mode
            );
            const labelText = selectedGrouping?.label || 'None';

            if (mode === 'report') {
                setStatusReport(
                    getSelectedBuiltInGroupingId(mode) === 'none'
                        ? 'Grouping disabled.'
                        : `Grouping applied: ${labelText}`,
                    STATUS.OK
                );
            } else {
                setStatusRun(
                    getSelectedBuiltInGroupingId(mode) === 'none'
                        ? 'Grouping disabled.'
                        : `Grouping applied: ${labelText}`,
                    STATUS.OK
                );
            }
        }

        return wrapper;
    }

    function updateGroupingButtonUi() {
        // No-op for now, old custom grouping buttons are hidden.
    }

    function setGroupingLoaded(isLoaded) {
        groupingLoaded = !!isLoaded;
        updateGroupingButtonUi();
    }

    setGroupingLoaded(false);

    // track simple iteration vars for placeholder resolution
    const liveVarState = {
        index: undefined, // zero-based
        oneBased: undefined, // one-based
        total: undefined,
        vars: Object.create(null)
    };

    // The step counter for the run in flight. Rebuilt per run because it is
    // seeded from that run's actions, and cleared between runs so a stale plan
    // can never be counted against new logs.
    const liveStepState = {counter: null};

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
            markResultsComplete();
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
            await whenResultsComplete();
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

    function imgToBtn(src, alt, viewportRatio = 1) {
        if (!src) return null;
        const button = document.createElement('button');
        const img = document.createElement('img');
        // "Screenshot: Home", which names the button that opens it larger too.
        img.alt = screenshotAlt(alt);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = src;
        const btnContent = document.createElement('span');
        btnContent.style.aspectRatio = viewportRatio;
        if (viewportRatio > 1) {
            btnContent.style.width = '100%';
            btnContent.style.height = 'auto';
        } else {
            btnContent.style.width = 'auto';
            btnContent.style.height = '100%';
        }
        button.appendChild(btnContent);
        btnContent.appendChild(img);
        button.classList.add('screenshot-btn');
        return button;
    }

    function buildScreenshotElements(scan) {
        const out = [];
        const scanLabel = scan?.label?.replace("Scan: ", "");

        if (scan && Array.isArray(scan.screenshots) && scan.screenshots.length) {
            scan.screenshots.forEach((s, i) => {
                let src = null;
                // A merged scan holds one screenshot per context, each named by
                // its context and with its own proportions (mobile, desktop).
                const context = scan.mergedScan === true && s && typeof s === 'object' && s.label ? String(s.label) : '';
                let alt = scanLabel ? scanLabel : (s && s.name ? s.name : `Screenshot ${i + 1}`);
                if (context) alt = `${alt} — ${context}`;
                if (typeof s === 'string') {
                    src = s;
                } else if (s) {
                    src = s.publicUrl || s.dataUrl || null;
                }
                const ratio = (context && Number.isFinite(s.viewportRatio)) ? s.viewportRatio : scan.viewportRatio;
                const btn = imgToBtn(src, alt, ratio || 1);
                if (!btn) return;
                btn.firstChild.style.aspectRatio = ratio;
                btn.onclick = () => scansDialog.openById(src);
                if (context) {
                    // Captioned with its context: seen, not read twice, as the
                    // image's alt already names it.
                    const figure = document.createElement('figure');
                    figure.className = 'screenshot-context-figure';
                    const caption = document.createElement('figcaption');
                    caption.setAttribute('aria-hidden', 'true');
                    caption.textContent = context;
                    figure.append(btn, caption);
                    out.push(figure);
                    return;
                }
                out.push(btn);
            });
            if (out.length) return out;
        }

        const report = scan && scan.report ? scan.report : null;
        if (report && typeof report === 'object') {
            const main =
                report.screenshotPublicUrl ||
                report.screenshotDataUrl ||
                (report.publicUrl ? report.publicUrl.replace(/\.html?$/i, '') + '-screenshot.jpg' : null);

            const mainBtn = imgToBtn(main, 'Main screenshot');
            mainBtn.onclick = () => scansDialog.openById(main);
            if (mainBtn) out.push(mainBtn);
        }

        return out;
    }

    const renderer = createRenderer({
        resultsEl: results,
        screenshotsEl: screenshots,
        escapeAttr,
        escapeHtml,
        jsonToBrowserLink,
        buildScreenshotElements,
        imgToBtn,
        dialogs: {scansDialog, screenshotsDialog, liveStreamDialog},
        onToggleScanIncludedInReport: toggleScanIncludedInReport,
        onMoveScan: moveScan,
        onRenameScan: renameScan,
        onEditScanTags: updateScanTags,
        getScanTagSuggestions
    });

    function findSummaryScanNameEls(scanId) {
        const idSel = CSS.escape(scanId);
        return {
            text: summaryEl.querySelector(`.scan-name-text[data-scan-id="${idSel}"]`),
            input: summaryEl.querySelector(`.scan-name-input[data-scan-id="${idSel}"]`)
        };
    }

    function focusSummaryRenameBtn(scanId) {
        const btn = summaryEl.querySelector(`[data-scan-action="rename"][data-scan-id="${CSS.escape(scanId)}"]`);
        try {
            btn && btn.focus();
        } catch {
            // ignore
        }
    }

    function enterSummaryNameEdit(scanId) {
        const {text, input} = findSummaryScanNameEls(scanId);
        if (!text || !input) return;

        input.value = text.textContent;
        text.classList.add('visually-hidden');
        input.hidden = false;

        requestAnimationFrame(() => {
            try {
                input.focus();
                input.select();
            } catch {
                // ignore
            }
        });
    }

    function exitSummaryNameEdit(scanId) {
        const {text, input} = findSummaryScanNameEls(scanId);
        if (!input) return;

        input.hidden = true;
        if (text) text.classList.remove('visually-hidden');
    }

    function saveSummaryNameEdit(scanId) {
        const {input} = findSummaryScanNameEls(scanId);
        if (!input) return;

        const raw = String(input.value || '').trim();
        exitSummaryNameEdit(scanId);
        focusSummaryRenameBtn(scanId);
        renameScan(scanId, raw || null);
    }

    function cancelSummaryNameEdit(scanId) {
        exitSummaryNameEdit(scanId);
        focusSummaryRenameBtn(scanId);
    }

    summaryEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-scan-action]');
        if (!btn) return;

        const {scanAction, scanId} = btn.dataset;
        if (!scanId) return;

        if (scanAction === 'toggle') updateResults(btn, () => toggleScanIncludedInReport(scanId));
        else if (scanAction === 'move-up') moveScan(scanId, -1);
        else if (scanAction === 'move-down') moveScan(scanId, 1);
        else if (scanAction === 'rename') {
            e.preventDefault();
            enterSummaryNameEdit(scanId);
        }
    });

    summaryEl.addEventListener('keydown', (e) => {
        const input = e.target.closest('.scan-name-input');
        if (!input) return;

        const scanId = input.dataset.scanId;
        if (!scanId) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            saveSummaryNameEdit(scanId);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelSummaryNameEdit(scanId);
        }
    });

    summaryEl.addEventListener('focusout', (e) => {
        const input = e.target.closest('.scan-name-input');
        if (!input || input.hidden) return;

        const scanId = input.dataset.scanId;
        if (!scanId) return;

        saveSummaryNameEdit(scanId);
    });

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

    // ---- Compare tab: many reports, one view (wired once) ----
    // Every side is a report loaded explicitly in the Compare tab; the diff is
    // rule-level (robust) with occurrence detail at two reports, and a dashboard
    // over the whole series at three or more. Nothing here touches the live
    // run/report view.
    let comparisonController = null;

    // One load into Compare at a time. A load (files, a dropped zip, a queue
    // batch) adds its reports over many frames, so anything else that changed
    // the comparison meanwhile would mix into it or cut it short: another
    // load, a report sent from Run or Report, Clear, removing or moving a
    // report, changing what the reports are (a batch sets it as it ends), or
    // downloading what has arrived so far. While one is under way
    // those are held, aria-disabled and saying why when pressed.
    let compareLoad = null; // { task } while one is under way
    let compareState = null; // the controller's last state, for Download
    let syncCompareDownload = () => {};
    const COMPARE_LOADING = 'Reports are still loading into Compare. Try again once they have.';

    /** True, having said why where the reader is, when a load holds Compare. */
    function refuseWhileCompareLoads(say) {
        if (!compareLoad) return false;
        say(COMPARE_LOADING, STATUS.ERROR);
        compareLoad.task?.reveal();
        return true;
    }

    /**
     * Runs `work(task)`, a load into Compare, as the activity panel's `title`
     * with the Load button busy, holding everything else that changes the
     * comparison until it ends. The caller checks refuseWhileCompareLoads first.
     */
    async function runCompareLoad(title, work) {
        compareLoad = {task: null};
        reflectCompareLoad();
        try {
            return await runBusy(compareLoadBtn, () => getActivity().run(title, (task) => {
                compareLoad.task = task;
                return work(task);
            }, {rethrow: false, quiet: true}));
        } finally {
            compareLoad = null;
            reflectCompareLoad();
        }
    }

    function reflectCompareLoad() {
        const held = compareLoad ? 'true' : null;
        const hold = (control) => {
            if (!control) return;
            if (held) control.setAttribute('aria-disabled', held);
            else control.removeAttribute('aria-disabled');
        };
        hold(compareClearBtn);
        compareContextSeg?.querySelectorAll('.ctx-opt').forEach(hold);
        document.querySelectorAll('[data-compare-report]').forEach(hold);
        compareReportsEl?.querySelectorAll('[data-remove-key], [data-move-key]').forEach((control) => {
            // A move at the end of the list stays disabled, as it was drawn.
            if (!control.disabled) hold(control);
        });
        syncCompareDownload();
        queuePanel?.setCompareBlocked(compareLoad ? COMPARE_LOADING : null);
    }

    // ---- what the comparison calls itself ----
    //
    // The same metadata line a report carries, corrected the same way: rows
    // carry data-meta-field, report-meta-edit.js mounts "(modify)" on each, and
    // the fields are defined beside the report's in report-meta-fields.js. One
    // pattern, learned once.
    //
    // Two things differ, and both come from the subject rather than the pattern.
    // Every row is rendered whether or not its value is set, because a
    // comparison always has a name to fall back on and a description has to be
    // removable once added. And the values live on the controller rather than a
    // payload, because a comparison is assembled from several reports and
    // belongs to none of them.
    let comparisonMetaEditors = null;

    const COMPARISON_META_KEYS = {
        comparisonTitle: 'title',
        comparisonNote: 'note',
        comparisonTimestamp: 'generatedAt'
    };

    function comparisonMetaValues() {
        const stored = comparisonController.getDocument();

        return {
            comparisonTitle: stored.title || '',
            comparisonNote: stored.note || '',
            comparisonTimestamp: stored.generatedAt || ''
        };
    }

    /**
     * The name the rendered document settled on.
     *
     * Read back from the masthead rather than recomputed, because that is the
     * value the exporter reads too: the line, the page and the downloaded file
     * cannot disagree about what this comparison is called.
     */
    function resolvedComparisonTitle() {
        const head = runComparisonEl?.querySelector('.cmp2 .doc-head');
        return head ? (head.dataset.docTitle || '') : '';
    }

    // The engines the compared reports ran, as a report's own line names its
    // engine: surea11y as its tag. Not editable, as on a report.
    function comparisonEnginesRow() {
        const engines = comparisonController.engines();
        if (!engines.length) return '';
        const label = engines.length > 1 ? 'Engines' : 'Engine';
        return `<li><strong>${label}:</strong> <span>${enginesHTML(engines)}${howTestedHTML(engines)}</span></li>`;
    }

    function writeComparisonData() {
        if (!compareDocEl || !comparisonController) return;

        // Nothing to name until there is a comparison to name.
        if (comparisonController.count() < 2) {
            compareDocEl.replaceChildren();
            comparisonMetaEditors = null;
            return;
        }

        const values = comparisonMetaValues();
        const derived = !values.comparisonTitle;

        const rows = [
            reportMetaRow({
                label: 'Name',
                // Said once, quietly: a name nobody typed came from somewhere,
                // and it will follow the reports rather than stay put.
                valueHtml: escapeHtml(resolvedComparisonTitle())
                    + (derived ? ' <span class="meta-note">taken from the reports</span>' : ''),
                field: 'comparisonTitle'
            }),
            reportMetaRow({
                label: 'Description',
                valueHtml: values.comparisonNote
                    ? escapeHtml(values.comparisonNote)
                    : '<span class="meta-unset">Not set</span>',
                field: 'comparisonNote'
            }),
            reportMetaRow({
                label: 'Compiled',
                valueHtml: escapeHtml(formatReportTimestamp(values.comparisonTimestamp)),
                field: 'comparisonTimestamp'
            })
        ].join('') + comparisonEnginesRow();

        compareDocEl.innerHTML = `<ul class="report-meta">${rows}</ul>`;

        // Live chrome. It sits outside the .cmp2 subtree the export copies, so
        // the values it sets travel and the means of changing them does not.
        comparisonMetaEditors = mountReportMetaEditors(compareDocEl, {
            read: (field) => comparisonMetaValues()[field],
            onSave: applyComparisonMetaEdit
        });
    }

    /**
     * Store a corrected value from the comparison metadata line.
     *
     * The controller holds it and re-renders the view, which is what resolves
     * the name; the line is then repainted from that, so a name handed back to
     * the reports shows the name the reports give it.
     */
    function applyComparisonMetaEdit(field, value) {
        const key = COMPARISON_META_KEYS[field];
        if (!key) return;

        comparisonController.setDocument({ [key]: value });

        writeComparisonData();
        comparisonMetaEditors?.focusEditButton(field);

        setCompareStatus(reportMetaField(field)?.saved(value) || '', STATUS.OK);
    }

    function setCompareStatus(message, tone) {
        if (!compareStatusEl) return;
        compareStatusEl.textContent = message;
        compareStatusEl.className = 'status';
        if (tone) compareStatusEl.classList.add(tone);
    }

    function fmtCompareDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime())
            ? iso
            : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // One chip per loaded report, in the order its column will appear: position,
    // the file it came from, what the report calls itself, and controls to move
    // or remove it. The chips must agree with the view; a list in load order
    // beside a chart in date order is a bug.
    function renderCompareChips() {
        if (!compareReportsEl || !comparisonController) return;

        const list = comparisonController.list();
        compareReportsEl.replaceChildren();

        for (const entry of list) {
            const item = document.createElement('li');
            item.className = 'compare-report';

            const position = document.createElement('span');
            position.className = 'compare-report-n';
            position.textContent = String(entry.position);
            position.setAttribute('aria-hidden', 'true');

            const meta = document.createElement('span');
            meta.className = 'compare-report-meta';
            meta.textContent = [
                entry.label,
                entry.dated ? fmtCompareDate(entry.timestamp) : 'no date',
            ].filter(Boolean).join(' · ');
            if (!entry.dated) item.classList.add('compare-report--undated');

            // Per-report and keyboard-operable, which drag-and-drop would not be.
            const moves = document.createElement('span');
            moves.className = 'compare-report-move';
            for (const [delta, glyph, word] of [[-1, '←', 'earlier'], [1, '→', 'later']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'compare-report-arrow';
                button.dataset.moveKey = String(entry.key);
                button.dataset.moveDelta = String(delta);
                button.setAttribute('aria-label', `Move ${entry.columnName} ${word}`);
                button.textContent = glyph;
                button.disabled = delta < 0 ? entry.position === 1 : entry.position === list.length;
                moves.append(button);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'compare-report-x';
            remove.dataset.removeKey = String(entry.key);
            remove.setAttribute('aria-label', `Remove ${entry.columnName}`);
            remove.textContent = '×';

            item.append(position, meta, moves, remove);
            compareReportsEl.append(item);
        }

        if (compareClearBtn) compareClearBtn.hidden = list.length === 0;
        // Nothing to name until there is a comparison: an empty tab asking for a
        // title is a form to fill in before anything has happened.
        // Written after the view, because the name the line reads is the one
        // the rendered document settled on.
        writeComparisonData();
        renderCompareContext();
    }

    // The context sets the default order; this line says how it came out and how
    // to change it. Only meaningful once there are columns.
    function renderCompareOrderNote() {
        if (!comparisonController || !compareOrderNote) return;

        const shown = comparisonController.count() >= 2;

        compareOrderNote.hidden = !shown;
        if (!shown) return;

        const byDate = comparisonController.getOrder() === 'time';
        const undated = comparisonController.undatedCount();
        // Stated outright: a timestamp records when a scan ran, not which
        // version it covered.
        const parts = byDate
            ? ['Columns run oldest scan first.',
                'A timestamp says when a report was produced, not which version it covers —'
                + ' use the arrows to arrange them yourself.']
            : ['Columns run in the order below.',
                'Use the arrows on a report to move it.'];

        if (undated) {
            parts.push(`${undated} report${undated === 1 ? ' has' : 's have'} no date`
                + `${byDate ? `, so ${undated === 1 ? 'it sits' : 'they sit'} at the end` : ''}.`);
        }

        compareOrderNote.textContent = parts.join(' ');
    }

    // What these reports are: the choice that fixes the framing, the default
    // column order, how columns are labelled and the noun sentences count in.
    function renderCompareContext() {
        if (!comparisonController || !compareContextSeg) return;

        const current = comparisonController.getContext();

        compareContextSeg.querySelectorAll('.ctx-opt').forEach((opt) => {
            opt.setAttribute('aria-pressed', String(opt.dataset.context === current));
        });

        if (compareContextDesc) {
            const context = comparisonController.contexts().find((c) => c.id === current);

            if (context) compareContextDesc.textContent = context.description;
        }

        renderCompareOrderNote();
    }

    // What the tab says after a load: how many are in, and which view that gives.
    // `lead` replaces the count for a caller that can say something better — the
    // in-app shortcut names the one report it sent and where it came from, since
    // that arrival also moved the reader to another tab.
    function describeCompareLoad({ added, failures, duplicates, lead = null }) {
        if (!comparisonController) return;

        const count = comparisonController.count();
        const parts = [];

        if (lead) parts.push(lead);
        else if (added) parts.push(`${added} report${added === 1 ? '' : 's'} loaded`);
        if (count < 2) parts.push('load one more to compare');
        else if (comparisonController.shape() === 'pair') parts.push('showing the side-by-side diff');
        else parts.push(`showing the dashboard over ${count} reports`);
        if (duplicates) {
            parts.push((added === 1
                ? 'it matches a report already loaded'
                : `${duplicates} of them ${duplicates === 1 ? 'matches' : 'match'} a report already loaded`)
                + ' — fine if they are one run exported per tag');
        }

        const tone = failures.length ? STATUS.ERROR : STATUS.OK;
        const message = failures.length
            ? `${parts.join(' · ')}. Could not load ${failures.join('; ')}`
            : `${parts.join(' · ')}.`;

        setCompareStatus(message, tone);
        return message;
    }

    // The conformance review another report holds: its JSON, or the report's
    // JSON inside a downloaded package; null when it has none.
    async function readConformanceReviewFile(file) {
        let text;
        if (/\.zip$/i.test(file.name)) {
            const zip = await globalThis.JSZip.loadAsync(file);
            const entry = Object.values(zip.files).find((e) => !e.dir && /(\.a11y-report\.json|payload\.json)$/i.test(e.name));
            if (!entry) return null;
            text = await entry.async('string');
        } else {
            text = await file.text();
        }
        const json = JSON.parse(text);
        return json && json.conformanceReview && typeof json.conformanceReview === 'object' ? json.conformanceReview : null;
    }

    // A shared tooltip for the dashboard's chart marks, under the pointer. The
    // values are also in each chart's name and in the tables, for keyboard and
    // screen reader users. As WCAG 1.4.13 asks, Escape dismisses it, and it
    // stays while the pointer moves onto it.
    function wireDashboardTooltip(scope) {
        let tip = null;
        let hideTimer = null;

        const keep = () => clearTimeout(hideTimer);
        const hide = () => { keep(); if (tip) tip.classList.remove('on'); };
        // A moment's grace, to cross from the mark to the tooltip.
        const hideSoon = () => { keep(); hideTimer = setTimeout(hide, 300); };

        const show = (el) => {
            keep();
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'cmp2-tip';
                tip.addEventListener('mouseenter', keep);
                tip.addEventListener('mouseleave', hideSoon);
                document.body.append(tip);
            }
            tip.textContent = '';
            const value = document.createElement('b');
            value.textContent = el.dataset.tipValue;
            tip.append(value, ` · ${el.dataset.tipLabel}`);
            tip.classList.add('on');

            const box = el.getBoundingClientRect();
            tip.style.left = `${Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2)}px`;
            tip.style.top = `${box.top - tip.offsetHeight - 10}px`;
        };

        scope.addEventListener('mouseover', (event) => {
            const mark = event.target.closest && event.target.closest('[data-tip-value]');
            if (mark && scope.contains(mark)) show(mark);
        });
        scope.addEventListener('mouseout', hideSoon);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && tip && tip.classList.contains('on')) hide();
        });
    }

    // The loader takes any number of files at once, and one bad file never
    // costs the good ones: each is reported by name and the rest still load.
    function wireCompareLoader() {
        if (!compareLoadBtn || !compareInput) return;

        // The load under way, in the activity panel: a press meanwhile shows it.
        compareLoadBtn.addEventListener('click', () => {
            if (compareLoad) compareLoad.task?.reveal();
            else compareInput.click();
        });

        compareInput.addEventListener('change', async (event) => {
            const files = Array.from((event.target.files) || []);
            event.target.value = ''; // allow re-selecting the same file
            if (!files.length) return;
            if (refuseWhileCompareLoads(setCompareStatus)) return;

            setCompareStatus(files.length === 1 ? `Reading ${files[0].name}…` : `Reading ${files.length} files…`, STATUS.BUSY);
            const title = files.length === 1 ? `Compare: load ${files[0].name}` : `Compare: load ${files.length} files`;
            await runCompareLoad(title, (task) => loadCompareFiles(files, task));
        });
    }

    /**
     * Before a batch's runs load as a comparison of their own: asks in the
     * activity panel's `task` whether to replace the reports already loaded,
     * and clears them if so. False when the reader keeps them.
     */
    async function replaceLoadedComparison(task, withWhat) {
        const loaded = comparisonController.count();
        if (!loaded) return true;
        const choice = await task.ask(
            `Replace the ${loaded} report${loaded === 1 ? '' : 's'} loaded ${withWhat}?`,
            [{label: 'Replace them', value: 'replace'}, {label: 'Keep them', value: null}],
        );
        if (choice !== 'replace') return false;
        comparisonController.clear();
        // The name belonged to the comparison that just went away.
        comparisonController.setDocument({ title: '', note: '' });
        return true;
    }

    /**
     * Adds `files` to the comparison, listing each step in the activity
     * panel's `task`, which ends with what the Compare status says.
     */
    /**
     * The reports the address asks to open: { mode: 'report', urls } for
     * ?report=, { mode: 'compare', urls } for ?compare= (one or more), or null.
     */
    function readOpenQuery() {
        const params = new URLSearchParams(window.location.search);
        const compare = params.getAll('compare').filter(Boolean);
        if (compare.length) return {mode: 'compare', urls: compare};
        const report = params.getAll('report').filter(Boolean);
        if (report.length) return {mode: 'report', urls: report};
        return null;
    }

    /**
     * A report (JSON, or a package's zip) at `url`, as a file the loaders take.
     * A JSON report's pictures in images/ beside it (a runner's run folder,
     * a package unpacked) are linked where they are.
     */
    async function fileFromUrl(url) {
        const address = new URL(url, window.location.href);
        const res = await fetch(address);
        if (!res.ok) throw new Error(`${address.href}: ${res.status} ${res.statusText}`);
        const blob = await res.blob();
        const name = decodeURIComponent(address.pathname.split('/').pop() || '') || 'report.json';
        if (/\.json$/i.test(name)) {
            // On the lab's own server, by path, as the queue's batches are,
            // so a download packs them.
            const where = address.origin === window.location.origin ? address.pathname : address.href;
            const text = rebaseImageRefs(await blob.text(), folderOf(where));
            return new File([text], name, {type: 'application/json'});
        }
        return new File([blob], name, {type: blob.type});
    }

    async function openFromQuery({mode, urls}) {
        let files;
        const say = mode === 'compare' ? setCompareStatus : setStatusReport;
        try {
            say(urls.length === 1 ? 'Fetching the report…' : `Fetching ${urls.length} reports…`, STATUS.BUSY);
            files = await Promise.all(urls.map(fileFromUrl));
        } catch (err) {
            say(`Could not fetch the report: ${String(err?.message || err)}`, STATUS.ERROR);
            return;
        }
        if (mode === 'compare') {
            const title = files.length === 1 ? `Compare: load ${files[0].name}` : `Compare: load ${files.length} files`;
            await runCompareLoad(title, (task) => loadCompareFiles(files, task));
            return;
        }
        // As if picked and then loaded: staged, checked, and loaded when every
        // file is a report.
        if (await stageReportFiles(files)) reportFilesLoadBtn?.click();
    }

    async function loadCompareFiles(files, task) {
        // Each report to add, from a JSON file or from inside a zip of
        // reports. A downloaded comparison is not added to: it replaces
        // what is loaded, so it comes on its own.
        const sources = [];
        const failures = [];
        let batch = null;

        for (const file of files) {
            if (!isZipFile(file)) {
                sources.push({name: file.name, label: file.name, read: () => readReportFile(file)});
                continue;
            }
            let zip;
            const reading = task.step(`Reading ${file.name}`);
            await afterPaint();
            try {
                zip = await readCompareZip(window.JSZip, file);
            } catch (err) {
                const why = err && err.message ? err.message : String(err);
                failures.push(`${file.name} (${why})`);
                reading.warn(why);
                continue;
            }
            if (zip.kind === 'comparison') {
                if (files.length > 1) {
                    const message = `${file.name} is a downloaded comparison, which replaces what is loaded: load it on its own.`;
                    setCompareStatus(message, STATUS.ERROR);
                    task.fail(message);
                    return;
                }
                await restoreComparisonZip(file, zip, task);
                return;
            }
            reading.done(`${zip.files.length} report${zip.files.length === 1 ? '' : 's'}`);
            for (const entry of zip.files) {
                sources.push({
                    name: entry.name,
                    label: `${file.name} › ${entry.path}`,
                    read: async () => parseReportText(entry.text, entry.name),
                });
            }
            // A queue's zip on its own keeps its runs in the order they
            // were queued, as "Send to Compare" from the queue tab does.
            if (zip.ordered && files.length === 1) batch = {rows: zip.rows};
        }

        // A queue's batch is a comparison of its own, so like Send to Compare
        // it replaces what is loaded rather than mixing into it.
        if (batch && !await replaceLoadedComparison(task, `with the runs in ${files[0].name}`)) {
            const message = `${files[0].name} not loaded; the reports already loaded stay.`;
            setCompareStatus(message);
            if (!task.ended) task.done(message);
            return;
        }

        const room = Math.max(0, MAX_COMPARE_REPORTS - comparisonController.count());
        const extra = sources.length - room;

        let added = 0;
        let duplicates = 0;
        const keys = [];

        for (const source of sources.slice(0, room)) {
            const adding = task.step(`Adding ${source.label}`);
            await afterPaint();
            try {
                const json = await source.read();
                // Drawn once they are all in: drawn after each, 24 reports
                // drew the dashboard 24 times.
                const result = comparisonController.addReport(json, source.name, {draw: false});
                if (!result.ok) {
                    failures.push(`${source.label} (${result.error})`);
                    adding.warn(result.error);
                    continue;
                }
                added += 1;
                keys.push(result.key);
                if (result.duplicate) duplicates += 1;
                adding.done(result.duplicate ? 'matches a report already loaded' : undefined);
            } catch (err) {
                const why = err && err.message ? err.message : String(err);
                failures.push(`${source.label} (${why})`);
                adding.warn(why);
            }
        }
        if (extra > 0) {
            const more = `${extra} more report${extra === 1 ? '' : 's'} (the dashboard holds ${MAX_COMPARE_REPORTS} reports at once)`;
            failures.push(more);
            task.step('Some reports were left out').warn(more);
        }

        task.step('Drawing the comparison');
        await afterPaint();
        if (batch && keys.length > 1) {
            comparisonController.arrange(keys);
            if (batch.rows) comparisonController.setContext('versions');
        } else {
            comparisonController.refresh();
        }
        renderCompareChips();
        const said = describeCompareLoad({ added, failures, duplicates });
        if (added) task.done(said);
        else task.fail(said);
    }

    function isZipFile(file) {
        return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    }

    /**
     * A zip from "Download with the reports": replaces what is loaded with the
     * comparison it holds, arranged and named as it was downloaded.
     */
    async function restoreComparisonZip(file, bundle, task) {
        const loaded = comparisonController.count();
        if (loaded) {
            const choice = await task.ask(
                `Replace the ${loaded} report${loaded === 1 ? '' : 's'} loaded with the comparison in ${file.name}?`,
                [{label: 'Replace them', value: 'replace'}, {label: 'Keep them', value: null}],
            );
            if (choice !== 'replace') {
                const message = `${file.name} not loaded; the reports already loaded stay.`;
                setCompareStatus(message);
                if (!task.ended) task.done(message);
                return;
            }
        }

        const reports = [];
        const failures = [];
        for (const {file: path, name, json} of bundle.reports) {
            const checking = task.step(`Checking ${name || path}`);
            await afterPaint();
            try {
                validateReportOrThrow(json, path);
                computeReportGlobals(json);
                reports.push({name, report: json});
                checking.done();
            } catch (err) {
                const why = err && err.message ? err.message : String(err);
                failures.push(`${path} (${why})`);
                checking.warn(why);
            }
        }

        task.step('Drawing the comparison');
        await afterPaint();
        const result = comparisonController.restore({...bundle, reports});
        for (const f of result.failures) failures.push(`${f.name} (${f.error})`);
        if (result.failures.length) task.step('Some reports could not be compared').warn(result.failures.map((f) => `${f.name} (${f.error})`).join('; '));

        renderCompareChips();
        const said = describeCompareLoad({
            added: result.count,
            failures,
            duplicates: 0,
            lead: `Comparison loaded from ${file.name}: ${result.count} report${result.count === 1 ? '' : 's'}`,
        });
        if (result.count) task.done(said);
        else task.fail(said);
    }

    /**
     * Hand the report on screen — the run that just finished, or the file opened
     * in the Report tab — straight to the Compare tab as one of its columns.
     *
     * The comparison is normally fed by files, so the shortcut sends exactly what
     * a file would have carried: buildExportPayload gives the same deep clone that
     * "Download as JSON" writes, through the same include and engine filters, with
     * its globals already recomputed over what survived. Because it is a clone, the
     * column keeps standing after the report behind it is refiltered or cleared —
     * a copy on the clipboard, not a live view — which is what saves the export,
     * save, re-open round trip that comparing against the open report used to need.
     */
    function sendReportToCompare(data) {
        if (!comparisonController) return false;
        if (refuseWhileCompareLoads(resultsState.activeMode === 'report' ? setStatusReport : setStatusRun)) return false;

        const bucket = getActiveBucket();
        const payload = bucket?.payload || data;
        const snapshot = buildExportPayload(payload, {includedOnly: true});

        // No name of its own means no name: the controller then falls back to what
        // the report calls itself, which is what a file with a generic name gets too.
        const result = comparisonController.addReport(snapshot, getCurrentReportName(payload) || undefined);

        // The button is only offered for a report that can be compared, so this is
        // the narrower case — every scan holding findings sits outside the filter,
        // or the dashboard is full. Say so where the reader still is, rather than
        // moving them to a tab to show them an error.
        if (!result.ok) {
            const isReport = resultsState.activeMode === 'report';
            const setStatus = isReport ? setStatusReport : setStatusRun;

            setStatus(
                `${isReport ? 'This report' : 'These run results'} cannot be added`
                + ` to the comparison — ${result.error}.`,
                STATUS.ERROR
            );
            return false;
        }

        if (tabsmode && typeof tabsmode.setActive === 'function') tabsmode.setActive('compare');

        renderCompareChips();
        describeCompareLoad({
            added: 1,
            failures: [],
            duplicates: result.duplicate ? 1 : 0,
            // Pressing the button moved the reader to another tab, so the tab
            // says what arrived and where from rather than only counting.
            lead: `${result.name} added from the `
                + `${resultsState.activeMode === 'report' ? 'open report' : 'run results'}`
        });

        return true;
    }

    if (runComparisonEl) {
        const downloadComparison = createDownloadComparisonBtn({
            getSnapshot: () => comparisonController.snapshot(),
            onError: (error) => {
                if (compareStatusEl) {
                    compareStatusEl.textContent = error && error.message
                        ? error.message
                        : 'Could not generate the comparison file.';
                    compareStatusEl.classList.add(STATUS.ERROR);
                }
            }
        });

        if (compareActionsEl) compareActionsEl.append(downloadComparison.element);
        // Not while a load is under way: it would hold only what has arrived.
        syncCompareDownload = () => downloadComparison.setEnabled(compareState === 'ready' && !compareLoad);

        comparisonController = createComparisonController({
            setHTML: (html) => { runComparisonEl.innerHTML = html; },
            onState: (state) => { compareState = state; syncCompareDownload(); }
        });

        // What these reports are. One choice, because framing and column order
        // are not independent decisions from the reader's side.
        if (compareContextSeg) {
            compareContextSeg.querySelectorAll('.ctx-opt').forEach((opt) => {
                opt.addEventListener('click', () => {
                    if (refuseWhileCompareLoads(setCompareStatus)) return;
                    comparisonController.setContext(opt.dataset.context);
                    renderCompareChips();
                });
            });
        }

        wireCompareLoader();

        if (compareClearBtn) {
            compareClearBtn.addEventListener('click', () => {
                if (refuseWhileCompareLoads(setCompareStatus)) return;
                comparisonController.clear();
                // The name belonged to the comparison that just went away.
                comparisonController.setDocument({ title: '', note: '' });
                renderCompareChips();
                setCompareStatus('All reports removed.', STATUS.OK);
                if (compareLoadBtn) compareLoadBtn.focus();
            });
        }

        // Chip controls are delegated: the list is rebuilt on every change.
        if (compareReportsEl) {
            compareReportsEl.addEventListener('click', (event) => {
                const target = event.target.closest && event.target.closest('button');
                if (!target) return;
                if ((target.dataset.removeKey || target.dataset.moveKey) && refuseWhileCompareLoads(setCompareStatus)) return;

                if (target.dataset.removeKey) {
                    comparisonController.removeReport(target.dataset.removeKey);
                    renderCompareChips();
                    describeCompareLoad({ added: 0, failures: [], duplicates: 0 });
                    return;
                }

                if (target.dataset.moveKey) {
                    const key = target.dataset.moveKey;
                    const delta = Number(target.dataset.moveDelta);
                    if (!comparisonController.moveReport(key, delta)) return;

                    renderCompareChips();

                    // Follow the moved report, so a second press moves the same
                    // one rather than whatever landed under the cursor.
                    const again = compareReportsEl.querySelector(
                        `[data-move-key="${key}"][data-move-delta="${delta}"]`
                    );
                    if (again && !again.disabled) again.focus();
                    else if (again) again.parentElement.querySelector('button:not([disabled])')?.focus();
                }
            });
        }

        // The dashboard's category filters over the rule grid, and the chart
        // tooltips — both event-delegated so they survive a re-render.
        runComparisonEl.addEventListener('click', (event) => {
            const chip = event.target.closest && event.target.closest('[data-dash-filter]');
            if (!chip || !runComparisonEl.contains(chip)) return;

            const bar = chip.parentElement;
            bar.querySelectorAll('[data-dash-filter]').forEach((c) => {
                c.setAttribute('aria-pressed', String(c === chip));
            });

            const wanted = chip.dataset.dashFilter;
            const table = bar.parentElement.querySelector('table.dash-grid');
            if (!table) return;
            table.querySelectorAll('tbody tr').forEach((row) => {
                row.hidden = wanted !== 'all' && row.dataset.dashCat !== wanted;
            });
        });

        wireDashboardTooltip(runComparisonEl);

        // Finding-diff segmented panes (event-delegated, survives re-render).
        const selectComparisonTab = (scope, seg) => {
            const k = seg.dataset.k;
            scope.querySelectorAll('.seg').forEach((s) => {
                const on = s === seg;
                s.setAttribute('aria-selected', String(on));
                s.tabIndex = on ? 0 : -1;
            });
            scope.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === k));
        };

        runComparisonEl.addEventListener('click', (event) => {
            const seg = event.target.closest && event.target.closest('.seg');
            if (!seg || !runComparisonEl.contains(seg)) return;
            selectComparisonTab(seg.closest('.cmp2') || runComparisonEl, seg);
        });

        // Arrow/Home/End move between tabs, per the tablist role the markup declares.
        runComparisonEl.addEventListener('keydown', (event) => {
            const seg = event.target.closest && event.target.closest('.seg');
            if (!seg || !runComparisonEl.contains(seg)) return;

            const scope = seg.closest('.cmp2') || runComparisonEl;
            const segs = Array.from(scope.querySelectorAll('.seg'));
            const from = segs.indexOf(seg);
            let to = -1;

            if (event.key === 'ArrowRight') to = (from + 1) % segs.length;
            else if (event.key === 'ArrowLeft') to = (from - 1 + segs.length) % segs.length;
            else if (event.key === 'Home') to = 0;
            else if (event.key === 'End') to = segs.length - 1;

            if (to < 0) return;

            event.preventDefault();
            selectComparisonTab(scope, segs[to]);
            segs[to].focus();
        });

        comparisonController.refresh();
    }

    // Tables that scroll sideways on a narrow screen take focus while they
    // do, wherever the app draws them (shared/scroll-reach.js).
    globalThis.A11Y_SCROLL_REACH?.keepScrollBoxesReachable(document.body);

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

    dryRunButton?.addEventListener('click', (event) => {
        if (event.currentTarget.getAttribute('aria-disabled') === 'true') return;
        onDryRun().catch((e) => console.error('Dry run failed', e));
    });

    scanButton?.addEventListener('click', (event) => {
        if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            // Disabled but focusable: say why when it says so.
            const why = event.currentTarget.dataset.blockedReason;
            if (why) setStatusRun(why, STATUS.ERROR);
            return;
        }
        onRunScan(event).then(() => {
        });
    });

    // Only the URL field should trigger a run on Enter (implicit submission).
    // Without this, pressing Enter in any other text input/select nested in
    // the Workflow or Custom Steps panels (which live inside the same <form>)
    // accidentally submits the whole scan form. Textareas are left alone:
    // Enter there just inserts a newline and never submits the form natively.
    form?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.target === urlInput) return;
        if (!(event.target instanceof HTMLElement)) return;

        const target = event.target;
        const tag = target.tagName;
        if (tag === 'TEXTAREA') return;

        // Keep native Enter activation for interactive controls.
        if (target.closest('button, [role="button"], a[href], summary')) return;

        // Prevent only implicit form submission from text-like fields.
        if (tag === 'SELECT') {
            event.preventDefault();
            return;
        }
        if (tag === 'INPUT') {
            const type = String(target.getAttribute('type') || 'text').toLowerCase();
            const textLikeInputTypes = new Set([
                'text', 'search', 'email', 'url', 'tel', 'number', 'password',
                'date', 'datetime-local', 'month', 'week', 'time'
            ]);
            if (textLikeInputTypes.has(type)) event.preventDefault();
        }
    });

    cancelButton?.addEventListener('click', async (event) => {
        if (!currentRunId || event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            return;
        }
        try {
            cancelButton.setAttribute('aria-disabled', 'true');
            setUiState('cancelling', 'Cancellation requested...');
            await fetch('/workflow-cancel', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({runId: currentRunId})
            });
        } catch {
            setUiState('error', 'Could not send cancellation request.');
            cancelButton.setAttribute('aria-disabled', 'false');
        }
    });

    if (configFileSplitBtnSlot && configFileEl) {
        const configFileSplitBtn = createSplitButton({
            label: 'Load config',
            menuLabel: 'Other load options',
            onAction: () => {
                loadAndRun = false;
                configFileEl.click();
            },
            items: [
                {
                    id: 'run',
                    label: 'Load and run',
                    description: 'Load the file and start the scan immediately',
                    onSelect: () => {
                        loadAndRun = true;
                        configFileEl.click();
                    }
                },
                {
                    id: 'append',
                    label: 'Append config',
                    description: 'Add another config’s custom steps and workflow to the current one',
                    onSelect: () => {
                        if (appendConfigFileEl) appendConfigFileEl.click();
                    }
                }
            ]
        });
        configFileSplitBtn.querySelector('.split-button__action')?.setAttribute('aria-controls', 'config-file');
        configFileSplitBtnSlot.replaceWith(configFileSplitBtn);
    }

    // Unified delegated clicks for dialogs and copy selector
    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('.src-dialog-trigger');
        if (trigger) {
            const localDlg = trigger.closest('td')?.querySelector('dialog') || trigger.closest('tr')?.querySelector('dialog');

            const dlg =
                localDlg ||
                (() => {
                    const id = trigger.getAttribute('data-dialog-id');
                    return id ? document.getElementById(id) : null;
                })();

            // Its occurrences may not be drawn yet (lazy-dialogs.js): a long
            // list opens on a skeleton and is drawn a frame later.
            if (dlg && typeof dlg.showModal === 'function') openLazyDialog(dlg, {afterPaint});
            dlg?.addEventListener('click', (e) => {
                if (e.target === dlg) dlg.close();
            });
            dlg?.querySelector('.src-dialog-body')?.scrollTo({top: 0});
            return;
        }

        const closeBtn = event.target.closest('.src-dialog-close');
        if (closeBtn) {
            closeBtn.closest('dialog')?.close();
            return;
        }

        const copyBtn = event.target.closest('.copy-selector-btn');
        if (copyBtn) {
            // A selector, or what the button holds (Copy URLs).
            const selector = copyBtn.getAttribute('data-copy') || copyBtn.getAttribute('data-selector') || '';
            if (selector && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(selector).catch(() => {
                });
            }
        }
    });

    // A picture a report names that cannot be shown says why, in its place.
    watchForMissingPictures(document);

    /* ==================== Run queue ==================== */

    const queueListEl = $('#queue-sessions');
    // A batch is running on the server (from GET /queue): Run batch waits.
    let queueBusy = false;
    const queuePanel = queueListEl ? createRunQueuePanel({
        listEl: queueListEl,
        concurrencySelect: $('#queue-concurrency'),
        cancelAllButton: $('#queue-cancel-all'),
        notifyToggle: $('#queue-notify'),
        statusEl: $('#queue-status'),
        onOpen: openQueuedResult,
        onLoadWorkflow: loadQueuedWorkflow,
        onSendToCompare: sendQueueSessionToCompare,
        activity: getActivity(),
        getFormWorkflow: getWorkflowWithPasswords,
        onWatch: (item, session) => watchQueuedRun(item, session),
        onRunningChange: (isRunning) => {
            setQueueTabSpinner(isRunning);
            queueBusy = isRunning;
            refreshRunButton();
        },
    }) : null;
    // A batch still running from before a reload shows its spinner straight away.
    queuePanel?.refresh();

    async function fetchJson(url) {
        const res = await fetch(url, {method: 'GET'});
        if (!res.ok) throw new Error(`the server answered ${res.status}`);
        return res.json();
    }

    /**
     * A queued run's result: its batch's folder is a report package, and
     * the result names its pictures by their path there, which the lab
     * serves (report-package.js).
     */
    async function fetchQueuedResult(item) {
        const res = await fetch(item.fileUrl, {method: 'GET'});
        if (!res.ok) throw new Error(`the server answered ${res.status}`);
        return JSON.parse(rebaseImageRefs(await res.text(), folderOf(item.fileUrl)));
    }

    /** Opens a result the queue saved in the report view, as if loaded from a file. */
    async function openQueuedResult(item) {
        // A long run's result takes a while: the activity panel shows it, the
        // status lines say how it ended (quiet).
        const task = getActivity().start(`Open “${item.name}” from the queue`, {quiet: true});
        try {
            task.step('Downloading the result');
            const payload = await fetchQueuedResult(item);
            task.step('Checking it');
            await afterPaint();
            validateReportOrThrow(payload, item.file);
            task.step('Drawing the report');
            await afterPaint();
            setReportPayload(payload, {fileName: item.file});
            tabsmode?.setActive('report');
            const message = `Loaded “${item.name}” from the queue.`;
            setStatusReport(message, STATUS.OK);
            focusReportArea();
            await whenResultsComplete();
            task.done(message);
        } catch (err) {
            const message = `Could not open “${item.name}”: ${String(err?.message || err)}`;
            queuePanel?.setStatus(message, 'error');
            task.fail(message);
        }
    }

    /**
     * Puts an interrupted run's workflow back in the form. Used for runs whose
     * masked values were never saved: the user types them again and re-adds it.
     */
    async function loadQueuedWorkflow(item, session) {
        try {
            const manifest = await fetchJson(session.manifestUrl);
            const entry = (manifest.items || []).find((i) => i.id === item.id);
            if (!entry || !entry.config) throw new Error('its workflow is missing from batch.json');
            if (!cfgIO) throw new Error('the workflow editor is not ready yet');
            const problem = cfgIO.applyConfig(entry.config, afterConfigLoaded);
            if (problem) throw new Error(problem);
            afterConfigLoaded();
            // A batch run's vars live in its run spec, not in the form: put its
            // row back in the Batch section so running it again keeps them.
            const isRow = Number.isInteger(entry.row) || (entry.vars && Object.keys(entry.vars).length);
            if (isRow && batchPanel) {
                batchPanel.loadRows([{name: item.name, url: item.url, ...(entry.vars ? {vars: entry.vars} : {})}], {namePattern: ''});
                // Its row opened the Batch section; the config says how it was.
                setSectionsState(entry.config.sections);
            }
            tabsmode?.setActive('run');
            const notes = cfgIO.takeLoadNotes();
            setStatusRun((isRow
                ? `Loaded “${item.name}” from the queue, with its workflow in the Batch section. Enter its passwords again, then Run.`
                : `Loaded “${item.name}” from the queue. Enter its passwords again, then Run.`)
                + (notes.length ? ' ' + notes.join(' ') : ''), notes.length ? STATUS.WARNING : STATUS.INFO);
        } catch (err) {
            queuePanel?.setStatus(`Could not load “${item.name}”: ${String(err?.message || err)}`, 'error');
        }
    }

    /**
     * Loads a queue session's saved results into the Compare tab, in queue
     * order. A batch's runs are versions in row order, so they arrive arranged
     * that way and under "Versions"; scan times need not follow the rows.
     * A batch is a comparison of its own, so it replaces what is loaded, as a
     * downloaded comparison does, rather than mixing into it.
     */
    async function sendQueueSessionToCompare(session) {
        if (!comparisonController) return;
        if (refuseWhileCompareLoads((message) => queuePanel?.setStatus(message, 'error'))) return;
        // Reading a batch's results takes a while: the activity panel lists
        // each, the Compare status says how it ended (quiet).
        await runCompareLoad(`Send ${session.name ? `“${session.name}”` : 'the batch'} to Compare`,
            (task) => sendQueueSessionToCompareAs(session, task));
    }

    async function sendQueueSessionToCompareAs(session, task) {
        const withFiles = session.items.filter((i) => i.fileUrl);

        if (!await replaceLoadedComparison(task, 'with this batch’s runs')) {
            const message = 'Not sent; the reports already in Compare stay.';
            queuePanel?.setStatus(message);
            if (!task.ended) task.done(message);
            return;
        }

        const items = withFiles.slice(0, MAX_COMPARE_REPORTS);

        const keys = [];
        const failures = [];
        let duplicates = 0;
        for (const item of items) {
            const adding = task.step(`Adding ${item.name}`);
            await afterPaint();
            try {
                const result = comparisonController.addReport(await fetchQueuedResult(item), item.file, {draw: false});
                if (!result.ok) {
                    failures.push(`${item.file} (${result.error})`);
                    adding.warn(result.error);
                    continue;
                }
                keys.push(result.key);
                if (result.duplicate) duplicates += 1;
                adding.done();
            } catch (err) {
                failures.push(`${item.file} (${String(err?.message || err)})`);
                adding.warn(String(err?.message || err));
            }
        }
        if (withFiles.length > items.length) {
            const more = `${withFiles.length - items.length} more run${withFiles.length - items.length === 1 ? '' : 's'} (the dashboard holds ${MAX_COMPARE_REPORTS} reports at once)`;
            failures.push(more);
            task.step('Some runs were left out').warn(more);
        }
        task.step('Drawing the comparison');
        await afterPaint();

        if (keys.length > 1) {
            comparisonController.arrange(keys);
            if (session.items.some((i) => Number.isInteger(i.row))) comparisonController.setContext('versions');
        } else {
            comparisonController.refresh();
        }

        // The comparison is the batch's now, so it goes by the batch's name;
        // a batch without one leaves it to the reports.
        const batchName = typeof session.name === 'string' ? session.name.trim() : '';
        if (batchName && keys.length) comparisonController.setDocument({title: batchName});

        tabsmode?.setActive('compare');
        renderCompareChips();
        const said = describeCompareLoad({
            added: keys.length,
            failures,
            duplicates,
            lead: `${keys.length} run${keys.length === 1 ? '' : 's'} added from the queue`,
        });
        if (keys.length) task.done(said);
        else task.fail(said);
    }


    /* ==================== Watching a queued run ==================== */

    // A queued run is watched in a dialog over the queue: its own live view
    // (totals with step progress, live preview, log) fed from
    // /queue/items/:id/progress. The run tab is left as it was, so a run from
    // the form can go on meanwhile. Closing the dialog stops watching, not the
    // run.
    let runDialog = null;
    let watching = null; // { itemId, stopped }

    function getRunDialog() {
        if (!runDialog) runDialog = createRunDialog({className: 'watch-dialog'});
        return runDialog;
    }

    /** The body of the watch dialog: where each piece of the live view goes. */
    function buildWatchView(itemId) {
        const root = createEl('div', {className: 'watch-view'});
        const totalsMount = createEl('div', {className: 'watch-totals'});
        const streamEl = createEl('div', {className: 'live-stream watch-stream'});
        streamEl.style.display = 'none';
        const gridEl = createEl('div', {className: 'live-stream-grid'});
        streamEl.append(gridEl);

        const logId = `watch-log-${itemId}`;
        const log = createEl('details', {className: 'watch-log'});
        log.open = true;
        const summary = createEl('summary', {className: 'watch-log-summary'}, 'Log');
        const logEl = createEl('div', {className: 'log-panel watch-log-panel', id: logId, tabindex: '0', role: 'region', 'aria-label': 'Run log'});
        const copyBtn = createEl('button', {type: 'button', className: 'secondary-button log-copy-btn'}, 'Copy log');
        copyBtn.addEventListener('click', async () => {
            const text = Array.from(logEl.children).map((e) => (e.textContent || '').trim()).join('\n');
            try {
                await navigator.clipboard.writeText(text);
                globalThis.A11Y_TOAST?.showToast('Log copied.', {type: 'success'});
            } catch {
                globalThis.A11Y_TOAST?.showToast('Could not copy the log.', {type: 'warning'});
            }
        });
        const logTools = createEl('div', {className: 'log-panel-toolbar is-visible'}, [copyBtn]);
        log.append(summary, logEl, logTools);

        // What the run is on and how lively it is, refreshed with each poll
        // (queue design §8.1): the queue's rows leave it out, as text that
        // changes every second resized the table. Not a live region: the log
        // below already reports each step.
        const nowStep = createEl('p', {className: 'watch-now-step'});
        const nowLiveness = createEl('p', {className: 'watch-now-liveness'});
        const nowStall = createEl('p', {className: 'watch-now-stall', hidden: true});
        const nowEl = createEl('div', {className: 'watch-now'}, [nowStep, nowLiveness, nowStall]);
        const showNow = (details) => {
            const now = describeRunNow(details);
            nowStep.textContent = now.step;
            nowLiveness.textContent = now.liveness;
            nowStall.textContent = now.stall;
            nowStall.hidden = !now.stall;
        };

        // What it is on, then the live preview across the top, then the log
        // and the totals side by side (stacked when the dialog is narrow); the
        // page order is the same.
        const row = createEl('div', {className: 'watch-row'}, [log, totalsMount]);
        root.append(nowEl, streamEl, row);
        return {root, totalsMount, streamEl, gridEl, logEl, nowEl, showNow};
    }

    function stopWatching() {
        if (watching) watching.stopped = true;
        watching = null;
    }

    async function watchQueuedRun(item, session) {
        stopWatching();
        const me = {itemId: item.id, stopped: false};
        watching = me;

        const total = session.counts?.total || session.items.length;
        const where = Number.isInteger(item.row) ? ` (workflow ${item.row} of ${total})` : '';
        const dialog = getRunDialog();
        let view = null;
        dialog.open({
            title: `Watching “${item.name}”${where}`,
            onClose: () => {
                me.stopped = true;
                if (watching === me) watching = null;
                view?.destroy();
                view = null;
            },
            returnFocus: () => queuePanel?.focusControl(`watch:${item.id}`),
        });
        dialog.setStatus('Running', '', {busy: true});

        const parts = buildWatchView(item.id);
        parts.showNow(item);
        dialog.body.append(parts.root);
        // Follow the log only while the user is at its end. Whether they are
        // is read when the log scrolls, never as a line is added: measuring
        // it then laid out the whole log once per line, and opening a run of
        // hundreds of scans replays thousands of lines at once (41 s frozen
        // at 570 scans). Scrolling to the end waits for the next frame, so a
        // batch of lines scrolls once.
        const logEl = parts.logEl;
        let following = true;
        let followFrame = 0;
        logEl.addEventListener('scroll', () => {
            if (!followFrame) following = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
        }, {passive: true});
        view = createLiveView({
            totalsMount: parts.totalsMount,
            streamEl: parts.streamEl,
            gridEl: parts.gridEl,
            logEl,
            idPrefix: `watch-${item.id}`,
            onLog: () => {
                if (!following || followFrame) return;
                followFrame = requestAnimationFrame(() => {
                    logEl.scrollTop = logEl.scrollHeight;
                    // The scroll this causes is ours, not the user's leaving the end.
                    requestAnimationFrame(() => { followFrame = 0; });
                });
            },
            helpers: {escapeHtml, escapeAttr, linkifyUrlsToHtml, indentPrefix, parseForEachIteration, parseRepeatIteration},
        });

        // The run's own workflow, for the step counter and the live cards.
        let actions = [];
        let customSteps = [];
        try {
            const manifest = await fetchJson(session.manifestUrl);
            const entry = (manifest.items || []).find((i) => i.id === item.id);
            const spec = entry && entry.config && entry.config.runSpec;
            if (spec) {
                actions = Array.isArray(spec.actions) ? spec.actions : [];
                customSteps = Array.isArray(spec.customSteps) ? spec.customSteps : [];
            }
        } catch {
            // Watch without a step counter rather than not at all.
        }
        if (me.stopped) return;
        view.start({actions, customSteps});
        view.appendLog(`Watching “${item.name}” from the queue: its log so far, then live.`, STATUS.INFO);

        let last = null;
        let outcome;
        try {
            outcome = await pollWorkflowUntilDone(item.id, {
                pollIntervalMs: PROGRESS_POLL_INTERVAL_MS,
                progressUrl: (since) => `/queue/items/${encodeURIComponent(item.id)}/progress?since=${since}`,
                shouldStop: () => me.stopped,
                onProgress: (prog) => {
                    last = prog;
                    if (!me.stopped && prog.status === 'running') parts.showNow(prog);
                    if (!me.stopped && view && Array.isArray(prog.logs) && prog.logs.length) view.processMany(prog.logs);
                },
            });
        } catch {
            outcome = {status: 'gone'};
        }
        if (me.stopped || watching !== me || !view) return;

        watching = null;
        view.finish();
        // Over: the status line says how it ended.
        parts.nowEl.hidden = true;
        const status = last?.status || outcome.status;
        const fileUrl = last?.fileUrl || null;
        if (status === 'done') {
            dialog.setStatus(fileUrl ? 'Finished. Its report is saved.' : 'Finished.', 'ok');
        } else if (status === 'error') {
            dialog.setStatus(`Failed${last?.error ? `: ${last.error}` : '.'}`, 'error');
        } else if (status === 'cancelled') {
            dialog.setStatus('Cancelled.', 'error');
        } else {
            dialog.setStatus('No longer running. Find its result in the queue.');
        }
        if (fileUrl) {
            dialog.setActions([{
                label: 'Open report',
                primary: true,
                onClick: () => {
                    dialog.close({returnFocus: false});
                    openQueuedResult({fileUrl, file: last?.file || null, name: item.name});
                },
            }]);
        }
    }

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
        if (!queuePanel) return false;
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
            await queuePanel.add(items, {name: scenarioInput ? scenarioInput.value.trim() : '', config: batchConfig});
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
        const blocked = !!(status && status.active && queueBusy);
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
        if (queueBusy) {
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
        onRefuse: (message) => setCompareStatus(message, STATUS.ERROR),
        isBusy: () => !!compareLoad,
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
        liveTotals.setHidden(mode !== 'run');
        // The Compare tab owns its own pane and doesn't use the run/report
        // results area — hide the shared results while it's active.
        document.body.classList.toggle('compare-mode-active', mode === 'compare');
        // The queue tab, like Compare, owns its pane and has no results bucket.
        document.body.classList.toggle('queue-mode-active', mode === 'queue');
        queuePanel?.setVisible(mode === 'queue');
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
            // One report on its own opens at once, as one given by address
            // does, and the next one picked the same way takes its place;
            // several, or one added to a list, wait in the list to be
            // reviewed, chosen from and merged with Load selected.
            if (reportOpenedAlone && stagedReportFiles.length === 1 && stagedReportFiles[0] === reportOpenedAlone) {
                stagedReportFiles = [];
            }
            reportOpenedAlone = null;
            const listedBefore = stagedReportFiles.length;
            const allReports = await stageReportFiles(files);
            if (allReports && listedBefore === 0 && stagedReportFiles.length === 1) {
                reportOpenedAlone = stagedReportFiles[0];
                reportFilesLoadBtn?.click();
            }
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

            const mode = groupingPickerTargetMode || resultsState.activeMode;
            groupingPickerTargetMode = null;

            // Always reset so picking the same file again triggers change
            input.value = '';

            if (!file) {
                setSelectedBuiltInGroupingId(getLastResolvedGroupingSelectionId(mode), mode);
                refreshBuiltInGroupingSelectOptions(mode);
                applySelectedBuiltInGrouping(mode);
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
                    setSelectedBuiltInGroupingId(getLastResolvedGroupingSelectionId(mode), mode);
                    refreshBuiltInGroupingSelectOptions(mode);
                    applySelectedBuiltInGrouping(mode);

                    setStatusRun(`Invalid grouping file: ${res.message} Grouping disabled.`, STATUS.ERROR);
                    setStatusReport(`Invalid grouping file: ${res.message} Grouping disabled.`, STATUS.ERROR);
                    return;
                }

                setLoadedCustomGrouping({
                    id: 'custom-loaded',
                    label: `Custom: ${file.name}`,
                    groups: res.cleaned
                }, mode);

                setSelectedBuiltInGroupingId('custom-loaded', mode);

                refreshBuiltInGroupingSelectOptions(mode);
                applySelectedBuiltInGrouping(mode);

                setStatusRun(`Grouping loaded: ${file.name}`, STATUS.OK);
                setStatusReport(`Grouping loaded: ${file.name}`, STATUS.OK);
            } catch (err) {
                console.error('Could not load grouping JSON', err);

                setSelectedBuiltInGroupingId(getLastResolvedGroupingSelectionId(mode), mode);
                refreshBuiltInGroupingSelectOptions(mode);
                applySelectedBuiltInGrouping(mode);

                setStatusRun(`Could not load grouping JSON: ${String(err?.message || err)} Grouping disabled.`, STATUS.ERROR);
                setStatusReport(`Could not load grouping JSON: ${String(err?.message || err)} Grouping disabled.`, STATUS.ERROR);
            }
        });
    }

    /* ==================== Live UI helpers ==================== */

    /** Reset live stream section and variable state */
    function resetLivePanels() {
        if (liveStreamEl) liveStreamEl.style.display = 'none';
        const grid = $('#live-stream-grid');
        if (grid) grid.innerHTML = '';
        liveVarState.index = undefined;
        liveVarState.oneBased = undefined;
        liveVarState.total = undefined;
        liveVarState.vars = Object.create(null);

        carousel?.clear?.();
        liveTotals?.reset?.();
        liveStepState.counter = null;
    }

    /**
     * Start counting steps for the run about to go out.
     *
     * The plan is built from the same actions and custom steps the payload
     * carries, so what the panel counts down is exactly what the server was
     * asked to run. The shared module arrives as a global (see the script tags
     * in index.html); if it is missing the run proceeds without a step counter
     * rather than failing.
     */
    function startStepCounter(actions, customSteps) {
        const api = globalThis.A11Y_WORKFLOW_STEP_COUNTER;
        if (!api || typeof api.createStepCounter !== 'function') {
            liveStepState.counter = null;
            return;
        }

        try {
            liveStepState.counter = api.createStepCounter({actions, customSteps});
            liveTotals.setSteps(liveStepState.counter.snapshot());
        } catch {
            // A workflow the planner cannot walk still deserves to run.
            liveStepState.counter = null;
        }
    }

    // The label helpers are shared with the watch dialog's live view
    // (src/js/live-view.js); the run tab's resolve against its own vars.
    const resolveLabelTemplate = (raw, localVars) => resolveLiveLabel(raw, localVars, liveVarState);
    const deriveScreenshotCaption = (extra) => deriveLiveScreenshotCaption(extra, liveVarState);

    const carouselContainer = $('#live-stream-grid');
    const carousel = carouselContainer && enhanceAsLiveCarousel(carouselContainer, {
        title: "Live preview",
        visibleCount: 4,
        announceNewItems: false
    });

    const addStreamCard = createStreamCardAdder({
        getUseLiveStream: () => useLiveStream,
        getGrid: () => document.getElementById('live-stream-grid'),
        getStream: () => document.getElementById('live-stream'),
        carousel,
        dialogs: {liveStreamDialog, scansDialog, screenshotsDialog},
        escapeHtml,
        escapeAttr,
        resolveLabelTemplate,
        findUnresolvedVars,
        isDebug: () => !!window.__A11YLAB_DEBUG
    });

    // Floating, non-dismissable "scan totals" counter shown while a run streams
    // scans into the live preview. It accumulates fail / can't tell / pass and
    // total DOM elements across scans, and is removed when the run finishes.
    const liveTotals = createLiveTotals({getMount: () => document.body});

    // when iteration vars change, re-resolve pending live titles and captions
    function tryUpdateLiveScanTitles() {
        const cards = $$('#live-stream-grid .stream-card[data-kind="scan"] h3');
        cards.forEach((h3) => {
            const raw = h3.dataset.rawLabel || '';
            if (raw && raw.includes('{var:')) {
                const resolved = resolveLabelTemplate(raw) || 'a11y scan';
                const desired = 'Scan: ' + resolved;
                if (desired !== h3.textContent) h3.textContent = desired;
            }
        });
    }

    function tryUpdateLiveScreenshotCaptions() {
        const caps = $$('#live-stream-grid .stream-card[data-kind="screenshot"] .stream-caption');
        caps.forEach((el) => {
            const raw = el.dataset.rawCaption || '';
            if (!raw || !raw.includes('{var:')) return;

            let localVars = {};
            try {
                localVars = JSON.parse(el.dataset.localVars || '{}');
            } catch {
            }

            const resolved = resolveLabelTemplate(raw, localVars) || 'Screenshot';
            const desired = 'Screenshot' + (resolved !== 'Screenshot' ? ': ' + resolved : '');
            if (desired !== el.textContent) {
                el.textContent = desired;
                const img = el.nextElementSibling?.querySelector('img') || el.previousElementSibling?.querySelector('img');
                if (img) img.alt = resolved;
            }

            if (window.__A11YLAB_DEBUG) {
                const unresolved = findUnresolvedVars(resolveLabelTemplate(raw, localVars));
                const card = el.closest('.stream-card');
                if (card) {
                    const dbg = card.querySelector('.stream-caption-debug');
                    if (unresolved.length) {
                        const box = dbg || document.createElement('div');
                        box.className = 'stream-caption-debug';
                        box.textContent = `Unresolved vars: ${unresolved.join(', ')}`;
                        box.style.fontSize = '12px';
                        box.style.opacity = '0.7';
                        box.style.marginTop = '4px';
                        if (!dbg) card.appendChild(box);
                    } else if (dbg) {
                        dbg.remove();
                    }
                }
            }
        });
    }

    /** Apply iteration vars from a parsed iteration object */
    function applyIterationVars(m) {
        if (!m) return;
        const {oneBased, total} = m;

        liveVarState.oneBased = Number.isFinite(oneBased) ? oneBased : undefined;
        liveVarState.index = Number.isFinite(oneBased) ? oneBased - 1 : undefined;

        // allow "unknown total" represented as null
        if (total === null) {
            liveVarState.total = undefined;
        } else {
            liveVarState.total = Number.isFinite(total) ? total : undefined;
        }

        tryUpdateLiveScanTitles();
        tryUpdateLiveScreenshotCaptions();
    }

    /** Handle a single progress log entry (exact same behavior, just extracted) */
    const progressProcessor = createProgressProcessor({
        liveVarState,
        liveStepState,
        appendLog,
        resolveStepRefForLogEntry,
        parseForEachIteration,
        parseRepeatIteration,
        tryUpdateLiveScanTitles,
        tryUpdateLiveScreenshotCaptions,
        collectVarsDeep,
        deriveScreenshotCaption,
        addStreamCard,
        addScanTotals: (payload) => liveTotals.add(payload),
        mergeScanTotals: (payload) => liveTotals.merge(payload),
        setStepTotals: (snapshot) => liveTotals.setSteps(snapshot),
        getUseLiveStream: () => useLiveStream
    });

    const THEME_KEY = 'a11y-lab-theme';

    // Colour-theme toggle. A single icon button in the header that cycles
    // Auto → Light → Dark, persisting the choice to localStorage and reflecting
    // it on <html data-theme>. Same control the report and extension use; the
    // CSS drives dark styling from :root[data-theme="dark"] and, in Auto mode,
    // from the OS via prefers-color-scheme. The no-FOUC head script in
    // index.html applies the saved choice before first paint.
    const THEME_ORDER = ['auto', 'light', 'dark'];
    const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

    function applyTheme(theme, btn) {
        const root = document.documentElement;

        if (theme === 'auto') {
            delete root.dataset.theme;
        } else {
            root.dataset.theme = theme;
        }

        if (btn) {
            btn.setAttribute('data-choice', theme);
            const label = 'Colour theme: ' + THEME_LABELS[theme];
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    }

    function initTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        // Default to Light on a fresh view (nothing stored); an explicit
        // Auto/Light/Dark choice the user made previously always wins.
        let current = (stored === 'auto' || stored === 'light' || stored === 'dark') ? stored : 'light';

        const btn = document.querySelector('[data-theme-toggle]');
        applyTheme(current, btn);

        btn?.addEventListener('click', () => {
            current = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
            try {
                localStorage.setItem(THEME_KEY, current);
            } catch (e) {
                /* ignore — the choice still applies for this view */
            }
            applyTheme(current, btn);
        });

        document.documentElement.classList.remove('no-theme-transition');
    }

    function clearCustomStepsOnFreshBoot() {
        if (!customStepsInput) return;
        customStepsInput.value = '';
    }

    /* ==================== Boot ==================== */

    document.addEventListener('DOMContentLoaded', initTheme);

    setWhenReportDrawn(whenResultsComplete);
    // Downloads and the loading of reports and zips, as they go (activity.js).
    getActivity().installButton(document.querySelector('body > header'));

    // ?report=<url> opens a report, ?compare=<url>&compare=<url> compares
    // reports, so the app can be linked to, or embedded, given a report.
    const openQuery = readOpenQuery();
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

    clearCustomStepsOnFreshBoot();
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
                'run-language': '',
                'run-language-other': '',
            },
            onStateApplied: syncRunLanguageOther,
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
            resetLivePanels();
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
        if (openQuery) openFromQuery(openQuery).catch((e) => console.error('Could not open from the address', e));
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
                resetLivePanels();
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
            elementToFocus = isFocusable(elementToFocus) ? elementToFocus : getFirstFocusable(elementToFocus);
            if (elementToFocus) elementToFocus.focus();
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
                    progressProcessor.processMany(prog.logs);
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

        resetLivePanels();
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

        startStepCounter(actions, customSteps);

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
            liveTotals?.finish?.();

            // always return to idle buttons, regardless of outcome
            scanButton.setAttribute('aria-disabled', 'false');
            cancelButton.setAttribute('aria-disabled', 'true');
            currentRunId = null;
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
        resetLivePanels();
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
        startStepCounter(actions, customSteps);
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
            liveTotals.remove();
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

    /** Normalize scans list from final payload */
    function getScansFromPayload(data, { includedOnly = false } = {}) {
        const scans = Array.isArray(data?.scans) ? data.scans : [];
        return includedOnly ? scans.filter(isScanIncludedInReport) : scans;
    }

    /** Build one <li> row for the scans summary list (same behavior, extracted) */
    function buildScanSummaryListItem(scan, index, total) {
        const isSkipped = !!scan.skipped || !!scan.skipInfo;
        const s = scan.summary || {};
        const count = isSkipped ? 0 : typeof s.failCount === 'number' ? s.failCount : 0;
        const isIncluded = scan.includedInReport !== false;

        const label = scan.label || scan.id || 'Scan ' + (index + 1);

        const perScanNodes = isSkipped
            ? 0
            : (() => {
                const findings = scan?.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [];
                return findings.reduce((acc2, f) => {
                    if (f?.outcome !== 'fail') return acc2;
                    const occs = Array.isArray(f.occurrences) ? f.occurrences : [];
                    return acc2 + occs.length;
                }, 0);
            })();

        const scanIdAttr = escapeAttr(scan.id || '');
        const isFirst = index === 0;
        const isLast = index === (total - 1);

        const controlsHtml =
            '<span class="scan-summary-controls">' +
            `<button type="button" class="secondary-button icon-button scan-summary-rename" data-scan-action="rename" data-scan-id="${scanIdAttr}" aria-label="Rename scan" title="Rename scan">${svgIcon('edit').outerHTML}</button>` +
            `<button type="button" class="secondary-button icon-button scan-summary-move-up" data-scan-action="move-up" data-scan-id="${scanIdAttr}" aria-label="Move scan up"${isFirst ? ' disabled aria-disabled="true"' : ''}>▲</button>` +
            `<button type="button" class="secondary-button icon-button scan-summary-move-down" data-scan-action="move-down" data-scan-id="${scanIdAttr}" aria-label="Move scan down"${isLast ? ' disabled aria-disabled="true"' : ''}>▼</button>` +
            `<button type="button" class="secondary-button scan-summary-toggle" data-scan-action="toggle" data-scan-id="${scanIdAttr}" aria-pressed="${isIncluded ? 'true' : 'false'}">${isIncluded ? 'Exclude' : 'Include'}</button>` +
            '</span>';

        const nameWrapperHtml =
            '<span class="scan-name-wrapper">' +
            `<strong class="scan-name-text" data-scan-id="${scanIdAttr}">${escapeHtml(label)}</strong>` +
            `<input type="text" class="scan-name-input" data-scan-id="${scanIdAttr}" aria-label="Edit scan name" hidden>` +
            '</span>';

        const excludedBadgeHtml = isIncluded
            ? ''
            : '<span class="scan-excluded-badge">Excluded</span> ';

        const liClasses = [
            isIncluded ? '' : 'scan-summary-excluded',
            scanMatchesActiveTagFilter(scan) ? '' : 'scan-filtered-out',
            isFailureFreeScan(scan) ? 'scan-no-failures' : '',
        ].filter(Boolean).join(' ');

        const sortAttrs = globalThis.A11Y_SCAN_SORT
            ? ' ' + globalThis.A11Y_SCAN_SORT.scanSortAttrs(scan, index)
            : '';
        let item = `<li class="${liClasses}" data-scan-id="${scanIdAttr}"${sortAttrs}>`;
        item +=
            nameWrapperHtml +
            excludedBadgeHtml +
            (isSkipped
                ? `: <a href="#sc-${scan.id}" title="go to the report">skipped, ` +
                escapeHtml(scan.skipInfo?.reason || 'reason not provided') +
                (scan.skipInfo?.estimatedNodes != null && scan.skipInfo?.threshold != null
                    ? ' · ' +
                    escapeHtml(`estimated nodes: ${scan.skipInfo.estimatedNodes} (threshold: ${scan.skipInfo.threshold})`)
                    : '')
                : `: <a href="#sc-${scan.id}" title="go to the report">` +
                count +
                ' failure' +
                (count === 1 ? '' : 's') +
                (perScanNodes > 0 ? ' in ' + perScanNodes + ' element' + (perScanNodes === 1 ? '' : 's') : '')) +
            '</a>' +
            (isSkipped ? ''
                : globalThis.A11Y_REPORT_SCAN?.scanProfile(scan)?.label
                    ? ' <small>(' + escapeHtml(globalThis.A11Y_REPORT_SCAN.scanProfile(scan).label) + ')</small>' : '') +
            (!isSkipped && optInRulesLabel(scan) ? ' <small>(plus ' + escapeHtml(optInRulesLabel(scan)) + ')</small>' : '') +
            // A note can explain a count, such as no failures on a scope
            // that matched nothing, so the list points to it.
            (!isSkipped && Array.isArray(scan?.canonical?.notices) && scan.canonical.notices.length
                ? ' <small class="scan-has-notes">· <a href="#sc-' + escapeAttr(scan.id || '') + '">' +
                    (scan.canonical.notices.length === 1 ? 'see the note' : 'see the notes') + '</a></small>'
                : '') +
            buildScanTagChipsHtml(scan) +
            controlsHtml;

        item += '</li>';
        return item;
    }

    /** Build the <ul> summary list HTML */
    function buildScansListHtml(scans) {
        if (!Array.isArray(scans) || !scans.length) return '';
        const total = scans.length;
        const items = scans.map((scan, index) => buildScanSummaryListItem(scan, index, total)).join('');
        if (!items) return '';

        // Only shown in "Failures only", so the scans that mode hides are
        // accounted for instead of silently missing.
        const note = failureFreeScansNote(scans);
        const noteHtml = note ? '<p class="failure-free-scans-note">' + escapeHtml(note) + '</p>' : '';
        return noteHtml + '<ol>' + items + '</ol>';
    }

    /**
     * RGAA's compliance rate over the included scans that targeted it, as one
     * line under the summary header; empty without RGAA scans. Only the
     * criteria the automated checks settled count, which the line says.
     */
    function rgaaRateHtml(scans) {
        const api = globalThis.A11Y_REPORT_CONFORMANCE;
        const r = api && typeof api.rgaaComplianceRate === 'function' ? api.rgaaComplianceRate(scans) : null;
        if (!r) return '';
        const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
        const rate = r.rate == null
            ? 'no rate yet: the automated checks settled no criterion'
            : `<strong>${Math.round(r.rate * 100)}%</strong> (${r.met} of ${r.met + r.notMet} criteria met)`;
        return '<p class="rgaa-rate"><span lang="fr">RGAA</span> 4.1.2 compliance rate, from automated checks only: ' + rate +
            ' · ' + escapeHtml(plural(r.toVerify, 'criterion', 'criteria')) + ' to verify by hand' +
            ' · ' + escapeHtml(plural(r.notApplicable, 'criterion', 'criteria')) + ' not applicable' +
            ' · across ' + escapeHtml(plural(r.pages, 'page', 'pages')) + '. ' +
            '<span class="rgaa-rate-note">An audit judges every criterion; this rate counts only those the checks could settle, and a criterion met here still needs a person to confirm it.</span></p>';
    }

    /** Write the main summary panel HTML */
    function writeSummaryHtml({data, fallbackUrl, totals, scansListHtml, scansCount, headerText, allScansButtonHtml = ''}) {
        const header = headerText != null
            ? headerText
            : 'Workflow scan - ' +
            totals.totalViolations +
            ' failure' +
            (totals.totalViolations === 1 ? '' : 's') +
            (totals.totalNodes > 0
                ? ' in ' + totals.totalNodes + ' element' + (totals.totalNodes === 1 ? '' : 's')
                : '') +
            ', across ' +
            scansCount +
            ' scan' +
            (scansCount === 1 ? '' : 's') +
            '.';

        // Sort, hide-excluded and the "View all scans" trigger cluster at the end
        // of the header line.
        summaryEl.innerHTML =
            '<div class="summary-header-line">' +
                '<span class="summary-header-text">' + header + '</span>' +
                '<span class="summary-controls">' + buildSummaryControlsHtml() + allScansButtonHtml + '</span>' +
            '</div>' +
            rgaaRateHtml(getScansFromPayload(data, {includedOnly: true})) +
            (scansListHtml || '');

        if (runResultToStatus && resultsState.activeMode === 'run' && headerText == null) {
            runResultToStatus = false;
            runResultText = 'Finished: ' + header.replace(/^Workflow scan - /, '');
        }
    }

    /* ==================== "View all scans" grid dialog ==================== */

    // Rebuilds the (hidden) all-scans dialog inside #results-container so the
    // report exporter, which clones that container, carries it into the exported
    // HTML. Returns the number of scans visible in the current view (tag filter
    // applied), used for the trigger button's count.
    function renderAllScansDialog(allScans) {
        const existing = document.getElementById('all-scans-dialog');
        if (existing) existing.remove();

        if (!Array.isArray(allScans) || !allScans.length || !resultsContainer) return 0;

        const cardDeps = {resolveLabelTemplate, escapeHtml, escapeAttr};

        const dialog = document.createElement('dialog');
        dialog.id = 'all-scans-dialog';
        dialog.className = 'all-scans-dialog';
        dialog.setAttribute('aria-label', 'All scans');

        const head = document.createElement('div');
        head.className = 'all-scans-dialog-head';
        const title = document.createElement('h2');
        title.className = 'all-scans-dialog-title';
        title.textContent = 'All scans';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'all-scans-close secondary-button icon-button';
        closeBtn.setAttribute('data-all-scans-close', '');
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '✕';
        head.append(title, closeBtn);
        dialog.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'all-scans-grid';
        allScans.forEach((scan, index) => {
            const props = scanToAllScansCardProps(scan, index, {matchesTagFilter: scanMatchesActiveTagFilter});
            grid.appendChild(renderAllScansCard(props, cardDeps));
        });
        dialog.appendChild(grid);

        resultsContainer.appendChild(dialog);

        return allScans.filter((scan) => scanMatchesActiveTagFilter(scan)).length;
    }

    // Rebuilds the all-scans dialog for `allScans` and returns the inline
    // trigger-button HTML for the summary header (empty when nothing is
    // visible). Used by both the initial finish render and every later refresh.
    function buildAllScansButtonHtml(allScans) {
        const visibleScanCount = renderAllScansDialog(allScans);
        if (!visibleScanCount) return '';
        const label = `View all scans (${visibleScanCount})`;
        return `<button type="button" class="all-scans-open-btn secondary-button icon-button" data-all-scans-open aria-haspopup="dialog" aria-controls="all-scans-dialog" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${svgIcon('grid').outerHTML}</button>`;
    }

    function refreshDerivedReportUi() {
        const previousScrollY = window.scrollY;

        const bucket = getActiveBucket();
        if (!bucket?.payload) return;

        const data = prepareDataForReport(bucket.payload);
        const fallbackUrl = data.url || urlInput?.value?.trim() || '';

        const allScans = getScansFromPayload(data);
        const includedScans = getScansFromPayload(data, {includedOnly: true});

        if (!allScans.length && !getScreenshotsFromPayload(data).length) {
            summaryEl.textContent = 'No scans or screenshot returned for this workflow.';
            const staleDialog = document.getElementById('all-scans-dialog');
            if (staleDialog) staleDialog.remove();
        } else {
            const scansCount = includedScans.length;
            const totals = computeTotals(includedScans);
            const scansListHtml = buildScansListHtml(allScans);

            writeSummaryHtml({
                data,
                fallbackUrl,
                totals,
                scansListHtml,
                scansCount,
                allScansButtonHtml: buildAllScansButtonHtml(allScans),
                headerText: includedScans.length
                    ? undefined
                    : 'No scans are currently included in the summary report.'
            });
        }

        const existingGroupedResults = results.querySelector('.grouped-results');
        const nextSibling = existingGroupedResults ? existingGroupedResults.nextSibling : null;

        if (existingGroupedResults) {
            existingGroupedResults.remove();
        }

        if (includedScans.length > 1) {
            const newGroupedResults = renderer.renderScansReport(data, {
                scanPresentationMode: 'analysis',
                dispersionScans: includedScans
            });

            if (newGroupedResults) {
                newGroupedResults.style.visibility = 'hidden';

                if (nextSibling && nextSibling.parentNode === results) {
                    results.insertBefore(newGroupedResults, nextSibling);
                } else {
                    const artifactsPanel = results.querySelector('.inline-actions');
                    if (artifactsPanel) {
                        results.insertBefore(newGroupedResults, artifactsPanel.nextSibling);
                    } else {
                        results.prepend(newGroupedResults);
                    }
                }

                requestAnimationFrame(() => {
                    newGroupedResults.style.visibility = '';
                });
            }
        }

        syncScanIncludeUi(data.scans);
        syncSummaryReportSelector(data);
        renderScanTagFilter(data);
        applyScanTagFilterVisibility(data.scans);
        applyScanSort();

        requestAnimationFrame(() => {
            window.scrollTo({ top: previousScrollY });
        });
    }

    function buildScanTagChipsHtml(scan) {
        const html = scanTagChipsHtml(scan?.scanTags);
        return html ? ' ' + html : '';
    }

    function buildTagFilterChip({ label, kind, value, pressed }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'scan-tag-filter__chip' + (kind === 'untagged' ? ' scan-tag--none' : '');
        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        btn.dataset.tagFilterKind = kind;
        if (kind === 'tag') btn.dataset.tagValue = value;
        btn.textContent = label;
        return btn;
    }

    // Segmented Any/All control for the tag combinator. "Any" = OR (a scan needs
    // one selected tag), "All" = AND (a scan needs every selected tag). Two
    // radio-style buttons so the choice is visible without opening a menu.
    function buildTagFilterModeToggle() {
        const group = document.createElement('span');
        group.className = 'scan-tag-filter__mode';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Match any or all selected tags');

        const lead = document.createElement('span');
        lead.className = 'scan-tag-filter__mode-label';
        lead.textContent = 'Match:';
        group.appendChild(lead);

        const switchWrapper = document.createElement('span');

        [
            { mode: 'or', label: 'Any' },
            { mode: 'and', label: 'All' },
        ].forEach(({ mode, label }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'scan-tag-filter__mode-btn';
            btn.dataset.tagFilterMode = mode;
            btn.textContent = label;
            const on = activeTagSelection.mode === mode;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.addEventListener('click', () => {
                if (activeTagSelection.mode === mode) return;
                activeTagSelection.mode = mode;
                activeTagFilter = makeTagFilter(activeTagSelection);
                onTagFilterChanged();
            });
            switchWrapper.appendChild(btn);
        });
        group.appendChild(switchWrapper);

        return group;
    }

    function onTagFilterChanged() {
        const bucket = getActiveBucket();
        const payload = bucket?.payload;
        if (!payload) return;

        // Remember which control had focus - the bar is rebuilt below, so a
        // keyboard user would otherwise be dumped to the top of the document.
        // Covers both the tag chips and the Any/All mode buttons.
        const active = document.activeElement;
        let focusKey = null;
        if (active && active.classList) {
            if (active.classList.contains('scan-tag-filter__chip')) {
                focusKey = { type: 'chip', kind: active.dataset.tagFilterKind, value: active.dataset.tagValue || null };
            } else if (active.classList.contains('scan-tag-filter__mode-btn')) {
                focusKey = { type: 'mode', mode: active.dataset.tagFilterMode };
            }
        }

        recomputeDerivedReportData(payload);
        refreshDerivedReportUi();

        if (focusKey && scanTagFilterEl) {
            let target = null;
            if (focusKey.type === 'chip') {
                target = Array.from(scanTagFilterEl.querySelectorAll('.scan-tag-filter__chip')).find(
                    (c) => c.dataset.tagFilterKind === focusKey.kind &&
                        (focusKey.kind !== 'tag' || c.dataset.tagValue === focusKey.value)
                );
            } else if (focusKey.type === 'mode') {
                target = scanTagFilterEl.querySelector(
                    `.scan-tag-filter__mode-btn[data-tag-filter-mode="${focusKey.mode}"]`
                );
            }
            if (target) target.focus();
        }
    }

    // Build the multi-select tag filter bar above the results. Only shown when
    // the report actually carries tags; selection is pruned to the tags that
    // still exist so a stale pick can't silently hide everything.
    function renderScanTagFilter(data) {
        if (!scanTagFilterEl) return;

        const scans = Array.isArray(data?.scans) ? data.scans : [];
        const { tags, hasUntagged } = collectScanTags(scans);

        if (!tags.length) {
            // Nothing taggable to filter on - hide the bar and drop any selection
            // (the mode preference is kept so it survives a report reload).
            activeTagSelection = { tags: [], untagged: false, mode: activeTagSelection.mode };
            activeTagFilter = makeTagFilter(activeTagSelection);
            scanTagFilterEl.hidden = true;
            scanTagFilterEl.replaceChildren();
            return;
        }

        // Prune the selection to what's still available before rendering.
        const availableLc = new Set(tags.map((t) => t.toLowerCase()));
        activeTagSelection = {
            tags: activeTagSelection.tags.filter((t) => availableLc.has(t.toLowerCase())),
            untagged: hasUntagged ? activeTagSelection.untagged : false,
            mode: activeTagSelection.mode,
        };
        activeTagFilter = makeTagFilter(activeTagSelection);

        scanTagFilterEl.hidden = false;
        scanTagFilterEl.replaceChildren();

        const labelEl = document.createElement('span');
        labelEl.className = 'scan-tag-filter__label';
        labelEl.textContent = 'Filter by tag:';
        scanTagFilterEl.appendChild(labelEl);

        const selectedLc = new Set(activeTagSelection.tags.map((t) => t.toLowerCase()));
        tags.forEach((tag) => {
            scanTagFilterEl.appendChild(buildTagFilterChip({
                label: tag, kind: 'tag', value: tag, pressed: selectedLc.has(tag.toLowerCase()),
            }));
        });
        if (hasUntagged) {
            scanTagFilterEl.appendChild(buildTagFilterChip({
                label: 'Untagged', kind: 'untagged', pressed: activeTagSelection.untagged,
            }));
        }

        // Any/All combinator, shown only once 2+ constraints are selected - the
        // point at which OR and AND actually diverge. Below that it would be a
        // no-op control, so we keep the bar quiet.
        const selectedCount = activeTagSelection.tags.length + (activeTagSelection.untagged ? 1 : 0);
        if (selectedCount >= 2) {
            scanTagFilterEl.appendChild(buildTagFilterModeToggle());
        }

        if (isTagFilterActive(activeTagFilter)) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'scan-tag-filter__clear secondary-button';
            clear.textContent = 'Clear';
            clear.addEventListener('click', () => {
                // Keep the mode preference; only the selection is cleared.
                activeTagSelection = { tags: [], untagged: false, mode: activeTagSelection.mode };
                activeTagFilter = makeTagFilter(activeTagSelection);
                onTagFilterChanged();
            });
            scanTagFilterEl.appendChild(clear);
        }

        const total = scans.length;
        const shown = scans.filter(scanMatchesActiveTagFilter).length;
        const count = document.createElement('span');
        count.className = 'scan-tag-filter__count';
        count.setAttribute('role', 'status');
        count.textContent = isTagFilterActive(activeTagFilter)
            ? `Showing ${shown} of ${total} scan${total === 1 ? '' : 's'}`
            : `${total} scan${total === 1 ? '' : 's'}`;
        scanTagFilterEl.appendChild(count);

        scanTagFilterEl.querySelectorAll('.scan-tag-filter__chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.tagFilterKind;
                if (kind === 'untagged') {
                    activeTagSelection.untagged = !activeTagSelection.untagged;
                } else {
                    const value = btn.dataset.tagValue;
                    const lc = String(value).toLowerCase();
                    const has = activeTagSelection.tags.some((t) => t.toLowerCase() === lc);
                    activeTagSelection.tags = has
                        ? activeTagSelection.tags.filter((t) => t.toLowerCase() !== lc)
                        : [...activeTagSelection.tags, value];
                }
                activeTagFilter = makeTagFilter(activeTagSelection);
                onTagFilterChanged();
            });
        });
    }

    // Hide the scan cards that don't match the active tag filter. This is the
    // view lens; it never touches includedInReport (manual exclude), which only
    // dims a card and drops it from the aggregate.
    // One pass over the page: a search per scan is a search of the whole
    // report per scan, which takes seconds once there are hundreds of them.
    function applyScanTagFilterVisibility(scans) {
        if (!results) return;
        const hiddenById = new Map();
        (Array.isArray(scans) ? scans : []).forEach((scan) => {
            if (!scan || !scan.id) return;
            hiddenById.set(String(scan.id), !scanMatchesActiveTagFilter(scan));
        });
        if (!hiddenById.size) return;
        results.querySelectorAll('[data-scan-id]').forEach((el) => {
            const hidden = hiddenById.get(el.getAttribute('data-scan-id'));
            if (hidden !== undefined) el.classList.toggle('scan-filtered-out', hidden);
        });
    }

    /** The first element in the results carrying each scan id, found in one pass. */
    function firstElementByScanId() {
        const map = new Map();
        results.querySelectorAll('[data-scan-id]').forEach((el) => {
            const id = el.getAttribute('data-scan-id');
            if (!map.has(id)) map.set(id, el);
        });
        return map;
    }

    function syncScanIncludeUi(scans) {
        if (!Array.isArray(scans) || !results) return;

        const wrappers = firstElementByScanId();
        scans.forEach((scan) => {
            if (!scan || !scan.id) return;

            const wrapper = wrappers.get(String(scan.id));
            if (!wrapper) return;

            const isIncluded = scan.includedInReport !== false;

            wrapper.classList.toggle('scan-excluded-from-report', !isIncluded);

            const btn = wrapper.querySelector('.scan-include-toggle');
            if (btn) {
                btn.textContent = isIncluded ? 'Exclude from report' : 'Include in report';
                btn.setAttribute('aria-pressed', isIncluded ? 'true' : 'false');
            }

            const badge = wrapper.querySelector('.scan-excluded-badge');
            if (badge) badge.hidden = isIncluded;
        });
    }

    function syncSummaryReportSelector(data) {
        const tools = results.querySelector('.results-tools');
        if (!tools) return;

        const summaryReportSelect = tools.querySelector('#group-scans');
        if (!summaryReportSelect) return;

        const includedScansCount = getScansFromPayload(data, {includedOnly: true}).length;
        const canUseSummaryReport = includedScansCount > 1;

        summaryReportSelect.disabled = !canUseSummaryReport;
        summaryReportSelect.setAttribute('aria-disabled', !canUseSummaryReport ? 'true' : 'false');
        const summaryReportField = summaryReportSelect.closest('.results-visualization > *');
        if (summaryReportField) summaryReportField.hidden = !canUseSummaryReport;

        if (!canUseSummaryReport) {
            summaryReportSelect.value = 'false';
            document.body.classList.add('per-scan-report-mode');
            return;
        }

        summaryReportSelect.value = lastSummaryReportValue;

        if (lastSummaryReportValue === 'true') {
            document.body.classList.remove('per-scan-report-mode');
        } else {
            document.body.classList.add('per-scan-report-mode');
        }
    }

    function makeLinkButton({ href, text, ariaLabel }) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = text;
        if (ariaLabel) a.setAttribute('aria-label', ariaLabel);
        a.className = 'secondary-button';
        return a;
    }

    function getActiveMode() {
        return resultsState.activeMode;
    }

    function buildExportPayload(data, options = {}) {
        const {includedOnly = false, ignoreTagFilter = false} = options;

        const source = data && typeof data === 'object' ? data : {};

        // "Included" means the effective view: manually included AND matching
        // the active tag filter, mirroring what the on-screen aggregate shows;
        // with ignoreTagFilter, as "Download all scans", only the manual choice.
        // The scans left out are dropped before copying: copying them only to
        // drop them costs seconds on a large report.
        const keep = ignoreTagFilter
            ? (scan) => !!scan && scan.includedInReport !== false
            : (scan) => isScanIncludedInReport(scan);
        const picked = includedOnly && Array.isArray(source.scans)
            ? {...source, scans: source.scans.filter(keep)}
            : source;
        const cloned = cloneJsonData(picked);

        recomputeDerivedReportData(cloned);

        return prepareDataForReport(cloned);
    }

    function createVisualizationPanel(data) {
        const containerEl = document.createElement('div');
        containerEl.className = 'inline-actions results-visualization';

        const includedScansCount = getScansFromPayload(data, {includedOnly: true}).length;
        const canUseSummaryReport = includedScansCount > 1;

        const scanPresentationSelect = buildLabeledSelect({
            id: 'scan-presentation-mode',
            name: 'scanPresentationMode',
            labelText: 'Show',
            options: {
                analysis: 'Findings and analysis',
                evidence: 'Findings',
                failures: 'Failures only'
            },
            selected: lastScanPresentationValue,
            onChange: (e, value) => {
                applyScanPresentationMode(value);
            }
        });
        containerEl.appendChild(scanPresentationSelect);

        // A summary of every scan's findings in one table, above the scans:
        // there is nothing to sum up with one scan, so it is offered from two.
        const summaryReport = buildLabeledSelect({
            id: 'group-scans',
            labelText: 'Summary of all scans',
            options: {
                true: 'Show',
                false: 'Hide'
            },
            selected: canUseSummaryReport ? lastSummaryReportValue : 'false',
            onChange: (e, value) => {
                lastSummaryReportValue = value === 'false' ? 'false' : 'true';

                if (value === 'true') {
                    document.body.classList.remove('per-scan-report-mode');
                } else {
                    document.body.classList.add('per-scan-report-mode');
                }
            }
        });

        const summaryReportSelect = summaryReport?.querySelector('select');
        if (summaryReportSelect) {
            summaryReportSelect.disabled = !canUseSummaryReport;
            summaryReportSelect.setAttribute('aria-disabled', !canUseSummaryReport ? 'true' : 'false');
        }
        if (summaryReport) summaryReport.hidden = !canUseSummaryReport;

        if (!canUseSummaryReport) {
            document.body.classList.add('per-scan-report-mode');
        } else if (lastSummaryReportValue === 'true') {
            document.body.classList.remove('per-scan-report-mode');
        } else {
            document.body.classList.add('per-scan-report-mode');
        }

        containerEl.appendChild(summaryReport);

        const groupingSelect = buildVisualizationGroupingSelect();
        if (groupingSelect) {
            containerEl.appendChild(groupingSelect);
        }

        return containerEl;
    }

    function getCurrentReportName(data) {
        return data && typeof data.reportName === 'string' ? data.reportName.trim() : '';
    }

    /**
     * The scenario name to offer as this report's name.
     *
     * The form field comes first - it is the one the user can change between
     * two exports, which is what makes the dialog follow a rename. A report
     * loaded from a file falls back to the scenario it was run under, so the
     * dialog still has something to offer when the form is empty or has since
     * moved on to another scenario.
     */
    function getScenarioNameForReport(data) {
        const fromForm = typeof scenarioInput?.value === 'string' ? scenarioInput.value.trim() : '';
        if (fromForm) return fromForm;

        return data && typeof data.scenarioName === 'string' ? data.scenarioName.trim() : '';
    }

    /**
     * A payload that arrives already named - a report loaded back from a file -
     * carries a name the user chose in this dialog once. Count it as offered,
     * so re-exporting keeps it instead of overwriting it with the scenario
     * name. Anything else (a fresh run) starts unoffered.
     */
    function seedPromptedScenarioFor(payload) {
        return getCurrentReportName(payload) ? getScenarioNameForReport(payload) : null;
    }

    function askForReportName(data) {
        const mode = resultsState.activeMode === 'report' ? 'report' : 'run';
        const stored = getCurrentReportName(data);
        const scenarioName = getScenarioNameForReport(data);

        const current = pickReportNamePrefill({
            storedName: stored,
            scenarioName,
            lastPromptedScenario: lastPromptedScenarioByMode[mode]
        });

        const value = window.prompt(
            'Enter a name for this report.',
            current
        );

        if (value === null) return null;

        // Only a confirmed dialog counts as offered: a cancelled one has to show
        // the new scenario name again next time.
        lastPromptedScenarioByMode[mode] = scenarioName;

        const reportName = String(value).trim();

        // Update the rendered object
        if (data && typeof data === 'object') {
            data.reportName = reportName;
        }

        // Always sync the active bucket payload too
        const bucket = getActiveBucket();
        if (bucket && bucket.payload && typeof bucket.payload === 'object') {
            bucket.payload.reportName = reportName;
        }

        writeReportData(
            bucket && bucket.payload ? bucket.payload : data,
            reportDataContainer
        );

        return reportName;
    }

    function createArtifactsPanel(data) {
        const containerEl = document.createElement('div');
        containerEl.className = 'inline-actions results-tools';

        containerEl.appendChild(createVisualizationPanel(data));

        const downloadReportSplitBtn = createDownloadReportSplitButton({
            // The zip carries the report as JSON too, with the same scans as
            // its HTML, so it loads back into the app with its pictures.
            getReportPayload: ({includeFilteredOut}) => buildExportPayload(getActiveBucket()?.payload || data, {
                includedOnly: true,
                ignoreTagFilter: includeFilteredOut,
            }),
            onBeforeAction: () => {
                const bucket = getActiveBucket();
                const payloadForExport = bucket?.payload || data;

                recomputeDerivedReportData(payloadForExport);

                const reportName = askForReportName(payloadForExport);
                return reportName !== null;
            },
            // After a run the Configuration panel is collapsed, Export config
            // inside it; a run that worked is when its workflow is worth
            // keeping, so it is offered here too. Not for a report opened from
            // a file: the configuration on screen is not the one it ran with.
            extraItems: [
                {
                    id: 'conformance',
                    label: 'Conformance report',
                    description: 'A VPAT 2.5 report (WCAG and EN 301 549), drafted from these results',
                    onSelect: () => downloadConformanceReport(buildExportPayload(getActiveBucket()?.payload || data, {includedOnly: true})),
                },
                {
                    id: 'conformance-docx',
                    label: 'Conformance report (Word)',
                    description: 'The same report as a .docx, to edit and sign in Word',
                    onSelect: () => downloadConformanceReportDocx(buildExportPayload(getActiveBucket()?.payload || data, {includedOnly: true})),
                },
                ...(resultsState.activeMode === 'run' ? [{
                    id: 'config',
                    label: 'Export config',
                    description: 'The workflow and its settings, to load or run again',
                    onSelect: () => $('#save-config-button')?.click(),
                }] : []),
            ],
        });
        containerEl.appendChild(downloadReportSplitBtn);

        // The Conformance view: a reviewer's verdicts, criterion by criterion,
        // over the automated draft, saved in the report (conformance-review.js).
        if (globalThis.A11Y_CONFORMANCE_REPORT) {
            const reviewBtn = document.createElement('button');
            reviewBtn.type = 'button';
            reviewBtn.className = 'secondary-button';
            reviewBtn.textContent = 'Review conformance';
            reviewBtn.addEventListener('click', () => {
                const dialog = openConformanceReview({
                    payload: getActiveBucket()?.payload || data,
                    readOtherReview: readConformanceReviewFile,
                });
                // Back to the button that opened it.
                dialog?.addEventListener('close', () => reviewBtn.focus(), {once: true});
            });
            containerEl.appendChild(reviewBtn);
        }

        // "Compare" sits before "Clear" so the row reads download / compare /
        // discard: the two things you can still do with this report, then the one
        // that ends it. It is offered only when there is something to diff — a
        // report with no rule-level findings would be refused on arrival.
        const activePayload = getActiveBucket()?.payload || data;

        if (comparisonController && canCompareReport(activePayload)) {
            const compareReportBtn = createCompareReportBtn({
                accessibleName: resultsState.activeMode === 'run'
                    ? 'Compare these run results with another report'
                    : 'Compare this report with another'
            });

            // Held, like everything that changes the comparison, while
            // reports are loading into it.
            compareReportBtn.dataset.compareReport = '';
            if (compareLoad) compareReportBtn.setAttribute('aria-disabled', 'true');

            compareReportBtn.addEventListener('click', () => {
                const say = resultsState.activeMode === 'report' ? setStatusReport : setStatusRun;
                if (refuseWhileCompareLoads(say)) return;
                // Copying a large report takes a while: say so where the
                // reader is, and replace the line once the copy is made.
                const setStatus = resultsState.activeMode === 'report' ? setStatusReport : setStatusRun;
                runBusy(compareReportBtn, async () => {
                    setStatus('Adding this report to Compare…', STATUS.BUSY);
                    await afterPaint();
                    if (sendReportToCompare(data)) setStatus('Added to Compare.', STATUS.OK);
                });
            });

            containerEl.appendChild(compareReportBtn);
        }

        const clearReportBtn = createClearReportBtn({
            accessibleName: resultsState.activeMode === 'run' ? 'Clear run results' : 'Clear report'
        });

        if (clearReportBtn) {
            clearReportBtn.addEventListener('click', () => {
                clearActiveBucketState();
                clearRenderedResultsUi();

                if (resultsState.activeMode === 'run') {
                    resetLivePanels();
                    clearLiveStreamDialog();
                    setStatusRun('Run results cleared.', STATUS.OK);
                    focusRuntimeArea();
                } else {
                    setStatusReport('Report cleared.', STATUS.OK);
                    focusSafely(resultsFileBtn);
                }
            }, true);
        }

        containerEl.appendChild(clearReportBtn);

        const { htmlReports, screenshots } = getAllArtifactUrls(data);

        // If there is exactly one HTML report, show a single button.
        // If there are multiple, open the first and let users use per-scan links in the report tables (optional).
        if (htmlReports.length === 1) {
            containerEl.appendChild(
                makeLinkButton({
                    href: htmlReports[0].url,
                    text: 'Open HTML report',
                    ariaLabel: 'Open HTML report (opens in new tab)'
                })
            );
        } else if (htmlReports.length > 1) {
            containerEl.appendChild(
                makeLinkButton({
                    href: htmlReports[0].url,
                    text: 'Open HTML reports',
                    ariaLabel: 'Open HTML report (opens in new tab)'
                })
            );
        }

        return containerEl;
    }

    function finalizeAndRenderAll(data) {
        const {activeMode} = resultsState;

        // Read both arrays through the coercing helpers rather than off the
        // payload: neither is required by the report schema, and everything this
        // function hands them to already tolerates a missing one.
        const scans = getScansFromPayload(data);
        const screenshots = getScreenshotsFromPayload(data);

        if (activeMode === 'run') {
            runSummary.renderActionLog(data.actionResults);
            runSummary.showOptionalActionWarnings(data.actionResults);
            // setStatusRun('Workflow scan completed.', STATUS.OK);

            lastWorkflowResponse = data;
        }

        // Register scan screenshots in the scans dialog for both modes
        scans.forEach((scan) => {
            const shots = scan && Array.isArray(scan.screenshots) ? scan.screenshots : [];

            shots.forEach((shot) => {
                if (!shot) return;

                // In the order buildScreenshotElements() opens them by.
                const src = shot.publicUrl || shot.dataUrl || null;
                const alt = scan.label || shot.name || 'Screenshot';

                if (src) {
                    createImg({src, alt}, [scansDialog]);
                }
            });
        });

        // Register workflow screenshots in the screenshots dialog for both modes
        screenshots.forEach((screenshot) => {
            if (!screenshot) return;

            // In the order renderScreenshot() opens them by.
            const src = screenshot.publicUrl || screenshot.dataUrl || null;
            const alt = screenshot.name || 'Screenshot';

            if (src) {
                createImg({src, alt}, [screenshotsDialog]);
            }
        });

        const diagPanel = runSummary.renderRunDiagnostics(data.runDiagnostics);
        if (diagPanel) summaryEl.parentElement.prepend(diagPanel);

        const collectedMetadataPanel = runSummary.renderCollectedMetadata(data.collectedOutputs, data.actionResults);
        if (collectedMetadataPanel) {
            if (diagPanel) diagPanel.after(collectedMetadataPanel);
            else summaryEl.parentElement.prepend(collectedMetadataPanel);
        }

        clearResults();
        clearScreenshots();
        results.innerHTML = '';

        results.classList.toggle('report-edit-mode', reportEditMode);
        // The Engine column shows only for a report more than one engine ran
        // (with the engine lens on, the one engine it shows).
        renderer.setReportEngines(getScansFromPayload(data));

        results.appendChild(createArtifactsPanel(data));

        if (scans.length || screenshots.length) resultsContainer.style.display = '';
        if (getScansFromPayload(data, {includedOnly: true}).length > 1) {
            const groupedResultsEl = renderer.renderScansReport(data, {
                scanPresentationMode: 'analysis',
                dispersionScans: getScansFromPayload(data, {includedOnly: true})
            });
            if (groupedResultsEl) {
                results.appendChild(groupedResultsEl);
            }
        }

        // The first scans are drawn with the rest of the page, the others a
        // few at a time with a paint between: drawn at once, a long report
        // froze the page for seconds before anything of it showed. Not when
        // the page was scrolled down, as a redraw there (grouping, engine)
        // goes back to where it was, which needs every scan in place.
        const scanOptions = {scanPresentationMode: 'analysis', reportEditMode};
        const firstBatch = drawScansInBatches ? Math.min(scans.length, SCANS_FIRST_BATCH) : scans.length;
        renderer.renderAllScans(scans, {...scanOptions, range: [0, firstBatch]});

        if (screenshots.length) screenshotsContainer.style.display = '';
        renderer.renderAllScreenshots(screenshots);

        renderScanTagFilter(data);
        applyScanTagFilterVisibility(scans);
        applyScanSort();

        writeReportData(data, reportDataContainer)

        if (firstBatch < scans.length) drawRemainingScans(scans, firstBatch, scanOptions);
        else markResultsComplete();
    }

    function markResultsComplete() {
        pendingScanDraw = null;
        const waiters = resultsCompleteWaiters;
        resultsCompleteWaiters = [];
        waiters.forEach((resolve) => resolve());
    }

    /** Null when every scan of the results on screen is drawn, or a promise of it. */
    function whenResultsComplete() {
        if (!pendingScanDraw) return null;
        return new Promise((resolve) => resultsCompleteWaiters.push(resolve));
    }

    async function drawRemainingScans(scans, from, scanOptions) {
        const draw = {};
        pendingScanDraw = draw;
        resultsContainer.setAttribute('aria-busy', 'true');
        for (let start = from; start < scans.length; start += SCANS_PER_BATCH) {
            await afterPaint();
            // The area was cleared or drawn again meanwhile.
            if (pendingScanDraw !== draw) return;
            renderer.renderAllScans(scans, {...scanOptions, range: [start, start + SCANS_PER_BATCH]});
            // Each batch joins the filter and the order the earlier ones are in.
            applyScanTagFilterVisibility(scans);
            applyScanSort();
        }
        resultsContainer.removeAttribute('aria-busy');
        markResultsComplete();
    }

    /**
     * One row of the report metadata line.
     *
     * The value gets a wrapper of its own because the row is a two-column grid
     * (label | value): an edit control appended to the row itself would become
     * a third column. `field` names the payload key the row shows, which is
     * what makes it editable - see report-meta-edit.js.
     */
    function reportMetaRow({label, valueHtml, field = ''}) {
        const fieldAttr = field ? ` ${META_FIELD_ATTR}="${escapeAttr(field)}"` : '';

        return (
            `<li${fieldAttr}><strong>${escapeHtml(label)}:</strong>` +
            `<span class="meta-value">` +
                `<span class="${META_VALUE_CLASS}">${valueHtml}</span>` +
            `</span></li>`
        );
    }

    function writeReportData(data, container) {
        let reportData = '';
        const {reportName, scenarioName, url, timestamp} = data;
        // Whichever name the report goes by is the one the row offers to edit:
        // a report that has been named is renamed, one that has not still
        // answers to the scenario it was run under.
        if(reportName) {
            reportData += reportMetaRow({
                label: 'Report name',
                valueHtml: escapeHtml(reportName),
                field: 'reportName'
            });
        } else if(scenarioName)  {
            reportData += reportMetaRow({
                label: 'Scenario',
                valueHtml: escapeHtml(scenarioName),
                field: 'scenarioName'
            });
        }
        if(url) {
            reportData += reportMetaRow({
                label: 'URL',
                valueHtml: `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeAttr(url)}</a>`,
                field: 'url'
            });
        }
        if(timestamp) {
            reportData += reportMetaRow({
                label: 'Timestamp',
                valueHtml: escapeHtml(formatReportTimestamp(timestamp)),
                field: 'timestamp'
            });
        }
        const engines = collectReportEngines(data);
        if (engines.length) {
            const label = engines.length > 1 ? 'Engines' : 'Engine';
            const value = enginesHTML(engines) + howTestedHTML(engines);
            // Not editable: what ran is the one thing on this line the report
            // cannot be talked out of.
            reportData += `<li><strong>${label}:</strong> <span>${value}</span></li>`;
        }

        container.innerHTML = reportData.length ? `<ul class="report-meta">${reportData}</ul>` : '';

        // Live chrome, added after the markup and stripped from the export:
        // see report-meta-edit.js.
        reportMetaEditors = mountReportMetaEditors(container, {
            read: (field) => data?.[field],
            onSave: (field, value) => applyReportMetaEdit(field, value, data)
        });
    }

    /**
     * Store a corrected value from the report metadata line.
     *
     * It goes on the bucket payload, which is what every export is built from,
     * and on the object this render was made from - a clone taken by
     * prepareDataForReport - so that repainting the line from either shows the
     * same thing. The line is repainted rather than patched in place because
     * a row can change with its value (a URL is a link, a named report stops
     * showing its scenario) and the editors have to be re-mounted anyway.
     */
    function applyReportMetaEdit(field, value, renderedData) {
        const payload = getActiveBucket()?.payload;

        if (payload && typeof payload === 'object') payload[field] = value;
        if (renderedData && typeof renderedData === 'object') renderedData[field] = value;

        // A name set here is one the user has settled on, so the export dialog
        // has to keep it rather than offer the scenario name over the top of
        // it - which is exactly what confirming that dialog records.
        if (field === 'reportName') {
            const mode = resultsState.activeMode === 'report' ? 'report' : 'run';
            lastPromptedScenarioByMode[mode] = getScenarioNameForReport(payload || renderedData);
        }

        writeReportData(renderedData || payload, reportDataContainer);
        reportMetaEditors?.focusEditButton(field);

        const message = reportMetaField(field)?.saved(value) || '';

        if (resultsState.activeMode === 'report') setStatusReport(message, STATUS.OK);
        else setStatusRun(message, STATUS.OK);
    }

    /** Render final payload using existing paths */
    async function renderFinalPayload(data, fallbackUrl) {
        const allScans = getScansFromPayload(data);
        const includedScans = getScansFromPayload(data, {includedOnly: true});

        if (!allScans.length && !getScreenshotsFromPayload(data).length) {
            setUiState('error', 'Workflow executed without output.');
            summaryEl.textContent = 'No scans or screenshot returned for this workflow.';
            const staleDialog = document.getElementById('all-scans-dialog');
            if (staleDialog) staleDialog.remove();
            return;
        }

        const scansCount = includedScans.length;

        const totals = computeTotals(includedScans);
        const scansListHtml = buildScansListHtml(allScans);
        writeSummaryHtml({
            data,
            fallbackUrl,
            totals,
            scansListHtml,
            scansCount,
            allScansButtonHtml: buildAllScansButtonHtml(allScans),
            headerText: includedScans.length
                ? undefined
                : 'No scans are currently included in the summary report.'
        });

        finalizeAndRenderAll(data);
    }

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
