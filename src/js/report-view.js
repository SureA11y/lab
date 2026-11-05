// A report's view: its scans in batches, the View all scans dialog, the tag
// and profile filters, the scans kept in or left out, the report's details and their
// editing, the panel of downloads, and rendering the final report. Moved out
// of a11y-ui.js; what it shares with the rest of the app it reaches through
// `app`.

import {buildLabeledSelect, createImg, escapeAttr, escapeHtml, scanTagChipsHtml, svgIcon} from './a11y-ui.utils.js';
import {renderAllScansCard} from './stream-ui.js';
import {scanToAllScansCardProps} from './all-scans-data.js';
import {enginesHTML, howTestedHTML} from './engine-brand.js';
import {openConformanceReview} from './conformance-review.js';
import {collectScanTags, isTagFilterActive, makeTagFilter} from './scan-tag-filter.js';
import {collectScanProfiles, isProfileFilterActive, makeProfileFilter} from './scan-profile-filter.js';
import {canCompareReport} from './report-comparison-controller.js';
import {pickReportNamePrefill} from './report-name.js';
import {askReportNameInDialog} from './report-name-dialog.js';
import {formatReportTimestamp} from './report-timestamp.js';
import {reportMetaField} from './report-meta-fields.js';
import {META_FIELD_ATTR, META_VALUE_CLASS, mountReportMetaEditors} from './report-meta-edit.js';
import {createClearReportBtn, createCompareReportBtn, createDownloadReportSplitButton, downloadConformanceReport, downloadConformanceReportDocx, downloadManualChecklist} from './export.js';
import {loadGuideIndex, loadStandards, proceduresAvailable, proceduresKnownAvailable} from './procedures.js';
import {afterPaint, runBusy} from './busy.js';
import {cloneJsonData, collectReportEngines, computeTotals, getAllArtifactUrls, getScreenshotsFromPayload, prepareDataForReport} from './report-data.js';
import {focusSafely} from './focus-utils.js';
import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * ($, SCANS_FIRST_BATCH, SCANS_PER_BATCH, activeProfileFilter, activeProfileSelection, activeTagFilter, activeTagSelection, applyScanPresentationMode, applyScanSort, clearActiveBucketState, clearLiveStreamDialog, clearRenderedResultsUi, clearResults, clearScreenshots, compareTab, drawScansInBatches, focusRuntimeArea, getActiveBucket, groupingUi, isScanIncludedInReport, lastPromptedScenarioByMode, lastScanPresentationValue, lastSummaryReportValue, lastWorkflowResponse, liveUi, pendingScanDraw, recomputeDerivedReportData, reportDataContainer, reportEditMode, reportMetaEditors, results, resultsCompleteWaiters, resultsContainer, resultsFileBtn, resultsState, runSummary, runSummaryUi, scanMatchesActiveFilters, scanProfileFilterEl, scanTagFilterEl, scansDialog, scenarioInput, screenshotsContainer, screenshotsDialog, screenshotsUi, setStatusReport, setStatusRun, setUiState, summaryEl, urlInput).
 */
export function createReportView(app) {
    // Asked once, as the app starts, so a report's Download menu knows
    // whether to offer the manual review checklist.
    // The installed standards too, so the conformance review and its
    // downloads build their rows from the packs.
    if (typeof fetch === 'function' && typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
        // The header's link to the testing guide, once there is a guide to show.
        proceduresAvailable().then((ok) => {
            if (ok) document.getElementById('guide-link')?.removeAttribute('hidden');
        });
        // What the guide has, for the links from findings into it.
        loadGuideIndex();
        loadStandards();
    }

    // Rebuilds the (hidden) all-scans dialog inside #results-container so the
    // report exporter, which clones that container, carries it into the exported
    // HTML. Returns the number of scans visible in the current view (tag and
    // profile filters applied), used for the trigger button's count.
    function renderAllScansDialog(allScans) {
        const existing = document.getElementById('all-scans-dialog');
        if (existing) existing.remove();

        if (!Array.isArray(allScans) || !allScans.length || !app.resultsContainer) return 0;

        const cardDeps = {resolveLabelTemplate: app.liveUi.resolveLabelTemplate, escapeHtml, escapeAttr};

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
            const props = scanToAllScansCardProps(scan, index, {matchesTagFilter: app.scanMatchesActiveFilters});
            grid.appendChild(renderAllScansCard(props, cardDeps));
        });
        dialog.appendChild(grid);

        app.resultsContainer.appendChild(dialog);

        return allScans.filter((scan) => app.scanMatchesActiveFilters(scan)).length;
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

        const bucket = app.getActiveBucket();
        if (!bucket?.payload) return;

        const data = prepareDataForReport(bucket.payload);
        const fallbackUrl = data.url || app.urlInput?.value?.trim() || '';

        const allScans = app.runSummaryUi.getScansFromPayload(data);
        const includedScans = app.runSummaryUi.getScansFromPayload(data, {includedOnly: true});

        if (!allScans.length && !getScreenshotsFromPayload(data).length) {
            app.summaryEl.textContent = 'No scans or screenshot returned for this workflow.';
            const staleDialog = document.getElementById('all-scans-dialog');
            if (staleDialog) staleDialog.remove();
        } else {
            const scansCount = includedScans.length;
            const totals = computeTotals(includedScans);
            const scansListHtml = app.runSummaryUi.buildScansListHtml(allScans);

            app.runSummaryUi.writeSummaryHtml({
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

        const existingGroupedResults = app.results.querySelector('.grouped-results');
        const nextSibling = existingGroupedResults ? existingGroupedResults.nextSibling : null;

        if (existingGroupedResults) {
            existingGroupedResults.remove();
        }

        if (includedScans.length > 1) {
            const newGroupedResults = app.screenshotsUi.renderer.renderScansReport(data, {
                scanPresentationMode: 'analysis',
                dispersionScans: includedScans
            });

            if (newGroupedResults) {
                newGroupedResults.style.visibility = 'hidden';

                if (nextSibling && nextSibling.parentNode === app.results) {
                    app.results.insertBefore(newGroupedResults, nextSibling);
                } else {
                    const artifactsPanel = app.results.querySelector('.inline-actions');
                    if (artifactsPanel) {
                        app.results.insertBefore(newGroupedResults, artifactsPanel.nextSibling);
                    } else {
                        app.results.prepend(newGroupedResults);
                    }
                }

                requestAnimationFrame(() => {
                    newGroupedResults.style.visibility = '';
                });
            }
        }

        syncScanIncludeUi(data.scans);
        syncSummaryReportSelector(data);
        renderScanFilters(data);
        applyScanFilterVisibility(data.scans);
        app.applyScanSort();

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
            const on = app.activeTagSelection.mode === mode;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.addEventListener('click', () => {
                if (app.activeTagSelection.mode === mode) return;
                app.activeTagSelection.mode = mode;
                app.activeTagFilter = makeTagFilter(app.activeTagSelection);
                onTagFilterChanged();
            });
            switchWrapper.appendChild(btn);
        });
        group.appendChild(switchWrapper);

        return group;
    }

    function onTagFilterChanged() {
        const bucket = app.getActiveBucket();
        const payload = bucket?.payload;
        if (!payload) return;

        // Remember which control had focus - the bars are rebuilt below, so a
        // keyboard user would otherwise be dumped to the top of the document.
        // Covers the tag and profile chips, the Any/All mode buttons, and a
        // bar's Clear, which goes away: focus goes to that bar's first chip.
        const active = document.activeElement;
        const bars = [app.scanTagFilterEl, app.scanProfileFilterEl].filter(Boolean);
        const bar = active && bars.find((b) => b.contains(active));
        let focusKey = null;
        if (bar && active.classList) {
            if (active.classList.contains('scan-tag-filter__chip')) {
                focusKey = {
                    type: 'chip',
                    kind: active.dataset.tagFilterKind,
                    value: active.dataset.tagValue ?? active.dataset.profileKey ?? null
                };
            } else if (active.classList.contains('scan-tag-filter__mode-btn')) {
                focusKey = { type: 'mode', mode: active.dataset.tagFilterMode };
            } else if (active.classList.contains('scan-tag-filter__clear')) {
                focusKey = { type: 'clear' };
            }
        }

        app.recomputeDerivedReportData(payload);
        refreshDerivedReportUi();

        if (focusKey) {
            let target = null;
            const chips = Array.from(bar.querySelectorAll('.scan-tag-filter__chip'));
            if (focusKey.type === 'chip') {
                target = chips.find(
                    (c) => c.dataset.tagFilterKind === focusKey.kind &&
                        (focusKey.kind === 'untagged' || (c.dataset.tagValue ?? c.dataset.profileKey) === focusKey.value)
                );
            } else if (focusKey.type === 'mode') {
                target = bar.querySelector(
                    `.scan-tag-filter__mode-btn[data-tag-filter-mode="${focusKey.mode}"]`
                );
            } else if (focusKey.type === 'clear') {
                target = chips[0] || null;
            }
            if (target) target.focus();
        }
    }

    // The tag and profile filter bars over the results, and the count of the
    // scans they show, on the last bar shown.
    function renderScanFilters(data) {
        const scans = Array.isArray(data?.scans) ? data.scans : [];
        renderScanTagFilter(scans);
        renderScanProfileFilter(scans);

        const last = [app.scanProfileFilterEl, app.scanTagFilterEl].find((el) => el && !el.hidden);
        if (!last) return;
        const total = scans.length;
        const filtering = isTagFilterActive(app.activeTagFilter) || isProfileFilterActive(app.activeProfileFilter);
        const shown = scans.filter(app.scanMatchesActiveFilters).length;
        const count = document.createElement('span');
        count.className = 'scan-tag-filter__count';
        count.setAttribute('role', 'status');
        count.textContent = filtering
            ? `Showing ${shown} of ${total} scan${total === 1 ? '' : 's'}`
            : `${total} scan${total === 1 ? '' : 's'}`;
        last.appendChild(count);
    }

    function buildFilterClearButton(onClear) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'scan-tag-filter__clear secondary-button';
        clear.textContent = 'Clear';
        clear.addEventListener('click', onClear);
        return clear;
    }

    // The Profiles selector: one switch per profile the report's scans were
    // checked against, every one on until it is turned off, several at once
    // if wanted. Shown when the report has more than one profile. A scan whose
    // profiles are all off is hidden; one with a profile still on shows only
    // the results of those (app.viewScan), and so does every export. The last
    // profile on stays on, so something is always shown.
    function renderScanProfileFilter(scans) {
        const el = app.scanProfileFilterEl;
        if (!el) return;

        const { profiles, useful } = collectScanProfiles(scans);

        if (!useful) {
            app.activeProfileSelection = [];
            app.activeProfileFilter = makeProfileFilter(app.activeProfileSelection);
            el.hidden = true;
            el.replaceChildren();
            return;
        }

        const available = new Set(profiles.map((p) => p.key));
        app.activeProfileSelection = app.activeProfileSelection.filter((key) => available.has(key));
        if (app.activeProfileSelection.length >= profiles.length) app.activeProfileSelection = [];
        app.activeProfileFilter = makeProfileFilter(app.activeProfileSelection);

        el.hidden = false;
        el.replaceChildren();
        el.setAttribute('role', 'group');

        const labelEl = document.createElement('span');
        labelEl.className = 'scan-tag-filter__label';
        labelEl.id = 'scan-profile-filter-label';
        labelEl.textContent = 'Profiles shown:';
        el.setAttribute('aria-labelledby', labelEl.id);
        el.appendChild(labelEl);

        const off = new Set(app.activeProfileSelection);
        const onCount = profiles.length - off.size;
        profiles.forEach(({ key, label }) => {
            const on = !off.has(key);
            const btn = buildTagFilterChip({ label, kind: 'profile', pressed: on });
            btn.dataset.profileKey = key;
            const last = on && onCount === 1;
            if (last) {
                btn.setAttribute('aria-disabled', 'true');
                btn.title = 'At least one profile stays shown';
            }
            btn.addEventListener('click', () => {
                if (btn.getAttribute('aria-disabled') === 'true') return;
                app.activeProfileSelection = on
                    ? [...app.activeProfileSelection, key]
                    : app.activeProfileSelection.filter((k) => k !== key);
                onProfileFilterChanged({ focusKey: key });
            });
            el.appendChild(btn);
        });

        if (isProfileFilterActive(app.activeProfileFilter)) {
            const all = buildFilterClearButton(() => {
                app.activeProfileSelection = [];
                onProfileFilterChanged({ focusKey: profiles[0].key });
            });
            all.textContent = 'Show all';
            el.appendChild(all);
        }
    }

    // A profile turned on or off changes what each scan shows, not only which
    // scans show: the report is drawn again from the scans as the selector
    // reads them, and focus goes back to the switch pressed.
    function onProfileFilterChanged({ focusKey = null } = {}) {
        app.activeProfileFilter = makeProfileFilter(app.activeProfileSelection);
        const bucket = app.getActiveBucket();
        const payload = bucket?.payload;
        if (!payload) return;
        app.recomputeDerivedReportData(payload);
        app.renderActiveBucket();
        if (focusKey !== null) {
            const target = Array.from(app.scanProfileFilterEl?.querySelectorAll('.scan-tag-filter__chip') || [])
                .find((c) => c.dataset.profileKey === focusKey);
            if (target) target.focus();
        }
    }

    // Build the multi-select tag filter bar above the results. Only shown when
    // the report actually carries tags; selection is pruned to the tags that
    // still exist so a stale pick can't silently hide everything.
    function renderScanTagFilter(scans) {
        if (!app.scanTagFilterEl) return;

        const { tags, hasUntagged } = collectScanTags(scans);

        if (!tags.length) {
            // Nothing taggable to filter on - hide the bar and drop any selection
            // (the mode preference is kept so it survives a report reload).
            app.activeTagSelection = { tags: [], untagged: false, mode: app.activeTagSelection.mode };
            app.activeTagFilter = makeTagFilter(app.activeTagSelection);
            app.scanTagFilterEl.hidden = true;
            app.scanTagFilterEl.replaceChildren();
            return;
        }

        // Prune the selection to what's still available before rendering.
        const availableLc = new Set(tags.map((t) => t.toLowerCase()));
        app.activeTagSelection = {
            tags: app.activeTagSelection.tags.filter((t) => availableLc.has(t.toLowerCase())),
            untagged: hasUntagged ? app.activeTagSelection.untagged : false,
            mode: app.activeTagSelection.mode,
        };
        app.activeTagFilter = makeTagFilter(app.activeTagSelection);

        app.scanTagFilterEl.hidden = false;
        app.scanTagFilterEl.replaceChildren();

        const labelEl = document.createElement('span');
        labelEl.className = 'scan-tag-filter__label';
        labelEl.textContent = 'Filter by tag:';
        app.scanTagFilterEl.appendChild(labelEl);

        const selectedLc = new Set(app.activeTagSelection.tags.map((t) => t.toLowerCase()));
        tags.forEach((tag) => {
            app.scanTagFilterEl.appendChild(buildTagFilterChip({
                label: tag, kind: 'tag', value: tag, pressed: selectedLc.has(tag.toLowerCase()),
            }));
        });
        if (hasUntagged) {
            app.scanTagFilterEl.appendChild(buildTagFilterChip({
                label: 'Untagged', kind: 'untagged', pressed: app.activeTagSelection.untagged,
            }));
        }

        // Any/All combinator, shown only once 2+ constraints are selected - the
        // point at which OR and AND actually diverge. Below that it would be a
        // no-op control, so we keep the bar quiet.
        const selectedCount = app.activeTagSelection.tags.length + (app.activeTagSelection.untagged ? 1 : 0);
        if (selectedCount >= 2) {
            app.scanTagFilterEl.appendChild(buildTagFilterModeToggle());
        }

        if (isTagFilterActive(app.activeTagFilter)) {
            app.scanTagFilterEl.appendChild(buildFilterClearButton(() => {
                // Keep the mode preference; only the selection is cleared.
                app.activeTagSelection = { tags: [], untagged: false, mode: app.activeTagSelection.mode };
                app.activeTagFilter = makeTagFilter(app.activeTagSelection);
                onTagFilterChanged();
            }));
        }

        app.scanTagFilterEl.querySelectorAll('.scan-tag-filter__chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.tagFilterKind;
                if (kind === 'untagged') {
                    app.activeTagSelection.untagged = !app.activeTagSelection.untagged;
                } else {
                    const value = btn.dataset.tagValue;
                    const lc = String(value).toLowerCase();
                    const has = app.activeTagSelection.tags.some((t) => t.toLowerCase() === lc);
                    app.activeTagSelection.tags = has
                        ? app.activeTagSelection.tags.filter((t) => t.toLowerCase() !== lc)
                        : [...app.activeTagSelection.tags, value];
                }
                app.activeTagFilter = makeTagFilter(app.activeTagSelection);
                onTagFilterChanged();
            });
        });
    }

    // Hide the scan cards that don't match the active tag and profile filters. This is the
    // view lens; it never touches includedInReport (manual exclude), which only
    // dims a card and drops it from the aggregate.
    // One pass over the page: a search per scan is a search of the whole
    // report per scan, which takes seconds once there are hundreds of them.
    function applyScanFilterVisibility(scans) {
        if (!app.results) return;
        const hiddenById = new Map();
        (Array.isArray(scans) ? scans : []).forEach((scan) => {
            if (!scan || !scan.id) return;
            hiddenById.set(String(scan.id), !app.scanMatchesActiveFilters(scan));
        });
        if (!hiddenById.size) return;
        app.results.querySelectorAll('[data-scan-id]').forEach((el) => {
            const hidden = hiddenById.get(el.getAttribute('data-scan-id'));
            if (hidden !== undefined) el.classList.toggle('scan-filtered-out', hidden);
        });
    }

    /** The first element in the results carrying each scan id, found in one pass. */
    function firstElementByScanId() {
        const map = new Map();
        app.results.querySelectorAll('[data-scan-id]').forEach((el) => {
            const id = el.getAttribute('data-scan-id');
            if (!map.has(id)) map.set(id, el);
        });
        return map;
    }

    function syncScanIncludeUi(scans) {
        if (!Array.isArray(scans) || !app.results) return;

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
        const tools = app.results.querySelector('.results-tools');
        if (!tools) return;

        const summaryReportSelect = tools.querySelector('#group-scans');
        if (!summaryReportSelect) return;

        const includedScansCount = app.runSummaryUi.getScansFromPayload(data, {includedOnly: true}).length;
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

        summaryReportSelect.value = app.lastSummaryReportValue;

        if (app.lastSummaryReportValue === 'true') {
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
        return app.resultsState.activeMode;
    }

    function buildExportPayload(data, options = {}) {
        const {includedOnly = false, ignoreTagFilter = false} = options;

        const source = data && typeof data === 'object' ? data : {};

        // "Included" means the effective view: manually included AND matching
        // the active tag and profile filters, mirroring what the on-screen
        // aggregate shows;
        // with ignoreTagFilter, as "Download all scans", only the manual choice.
        // The scans left out are dropped before copying: copying them only to
        // drop them costs seconds on a large report.
        const keep = ignoreTagFilter
            ? (scan) => !!scan && scan.includedInReport !== false
            : (scan) => app.isScanIncludedInReport(scan);
        // Each scan as the Profiles selector shows it: a profile turned off
        // is left out of every export, whatever its format.
        const view = typeof app.viewScan === 'function' ? app.viewScan : (scan) => scan;
        const picked = Array.isArray(source.scans)
            ? {...source, scans: (includedOnly ? source.scans.filter(keep) : source.scans).map(view)}
            : source;
        const cloned = cloneJsonData(picked);

        app.recomputeDerivedReportData(cloned);
        // Saved as they are shown, the scores counted again on the profiles
        // shown are the file's own: it does not say they were counted again.
        for (const scan of Array.isArray(cloned.scans) ? cloned.scans : []) {
            if (scan?.metrics?.a11ySummary) delete scan.metrics.a11ySummary.scoreRecounted;
        }
        if (cloned.metrics?.a11ySummary) delete cloned.metrics.a11ySummary.scoreRecounted;

        // As version 4 keeps it: one rule catalogue for the scans sharing it.
        globalThis.A11Y_REPORT_FORMAT?.compactReport(cloned);

        return prepareDataForReport(cloned);
    }

    function createVisualizationPanel(data) {
        const containerEl = document.createElement('div');
        containerEl.className = 'inline-actions results-visualization';

        const includedScansCount = app.runSummaryUi.getScansFromPayload(data, {includedOnly: true}).length;
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
            selected: app.lastScanPresentationValue,
            onChange: (e, value) => {
                app.applyScanPresentationMode(value);
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
            selected: canUseSummaryReport ? app.lastSummaryReportValue : 'false',
            onChange: (e, value) => {
                app.lastSummaryReportValue = value === 'false' ? 'false' : 'true';

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
        } else if (app.lastSummaryReportValue === 'true') {
            document.body.classList.remove('per-scan-report-mode');
        } else {
            document.body.classList.add('per-scan-report-mode');
        }

        containerEl.appendChild(summaryReport);

        const groupingSelect = app.groupingUi.buildVisualizationGroupingSelect();
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
        const fromForm = typeof app.scenarioInput?.value === 'string' ? app.scenarioInput.value.trim() : '';
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

    async function askForReportName(data) {
        const mode = app.resultsState.activeMode === 'report' ? 'report' : 'run';
        const stored = getCurrentReportName(data);
        const scenarioName = getScenarioNameForReport(data);

        const current = pickReportNamePrefill({
            storedName: stored,
            scenarioName,
            lastPromptedScenario: app.lastPromptedScenarioByMode[mode]
        });

        const value = await askReportNameInDialog(document, current);

        if (value === null) {
            const say = mode === 'report' ? app.setStatusReport : app.setStatusRun;
            say('Download cancelled.', STATUS.OK);
            return null;
        }

        // Only a confirmed dialog counts as offered: a cancelled one has to show
        // the new scenario name again next time.
        app.lastPromptedScenarioByMode[mode] = scenarioName;

        const reportName = String(value).trim();

        // Update the rendered object
        if (data && typeof data === 'object') {
            data.reportName = reportName;
        }

        // Always sync the active bucket payload too
        const bucket = app.getActiveBucket();
        if (bucket && bucket.payload && typeof bucket.payload === 'object') {
            bucket.payload.reportName = reportName;
        }

        writeReportData(
            bucket && bucket.payload ? bucket.payload : data,
            app.reportDataContainer
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
            getReportPayload: ({includeFilteredOut}) => buildExportPayload(app.getActiveBucket()?.payload || data, {
                includedOnly: true,
                ignoreTagFilter: includeFilteredOut,
            }),
            onBeforeAction: async () => {
                const bucket = app.getActiveBucket();
                const payloadForExport = bucket?.payload || data;

                app.recomputeDerivedReportData(payloadForExport);

                const reportName = await askForReportName(payloadForExport);
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
                    onSelect: () => downloadConformanceReport(buildExportPayload(app.getActiveBucket()?.payload || data, {includedOnly: true})),
                },
                {
                    id: 'conformance-docx',
                    label: 'Conformance report (Word)',
                    description: 'The same report as a .docx, to edit and sign in Word',
                    onSelect: () => downloadConformanceReportDocx(buildExportPayload(app.getActiveBucket()?.payload || data, {includedOnly: true})),
                },
                // Only where the server's core has the procedures it lists.
                ...(proceduresKnownAvailable() ? [{
                    id: 'manual-checklist',
                    label: 'Manual review checklist',
                    description: 'What a person still has to check, criterion by criterion, with the steps',
                    onSelect: () => downloadManualChecklist(buildExportPayload(app.getActiveBucket()?.payload || data, {includedOnly: true})),
                }] : []),
                ...(app.resultsState.activeMode === 'run' ? [{
                    id: 'config',
                    label: 'Export config',
                    description: 'The workflow and its settings, to load or run again',
                    onSelect: () => app.$('#save-config-button')?.click(),
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
            reviewBtn.addEventListener('click', async () => {
                await loadStandards();
                const dialog = openConformanceReview({
                    payload: app.getActiveBucket()?.payload || data,
                    readOtherReview: app.compareTab.readConformanceReviewFile,
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
        const activePayload = app.getActiveBucket()?.payload || data;

        if (app.compareTab.comparisonController && canCompareReport(activePayload)) {
            const compareReportBtn = createCompareReportBtn({
                accessibleName: app.resultsState.activeMode === 'run'
                    ? 'Compare these run results with another report'
                    : 'Compare this report with another'
            });

            // Held, like everything that changes the comparison, while
            // reports are loading into it.
            compareReportBtn.dataset.compareReport = '';
            if (app.compareTab.compareLoad) compareReportBtn.setAttribute('aria-disabled', 'true');

            compareReportBtn.addEventListener('click', () => {
                const say = app.resultsState.activeMode === 'report' ? app.setStatusReport : app.setStatusRun;
                if (app.compareTab.refuseWhileCompareLoads(say)) return;
                // Copying a large report takes a while: say so where the
                // reader is, and replace the line once the copy is made.
                const setStatus = app.resultsState.activeMode === 'report' ? app.setStatusReport : app.setStatusRun;
                runBusy(compareReportBtn, async () => {
                    setStatus('Adding this report to Compare…', STATUS.BUSY);
                    await afterPaint();
                    if (app.compareTab.sendReportToCompare(data)) setStatus('Added to Compare.', STATUS.OK);
                });
            });

            containerEl.appendChild(compareReportBtn);
        }

        const clearReportBtn = createClearReportBtn({
            accessibleName: app.resultsState.activeMode === 'run' ? 'Clear run results' : 'Clear report'
        });

        if (clearReportBtn) {
            clearReportBtn.addEventListener('click', () => {
                app.clearActiveBucketState();
                app.clearRenderedResultsUi();

                if (app.resultsState.activeMode === 'run') {
                    app.liveUi.resetLivePanels();
                    app.clearLiveStreamDialog();
                    app.setStatusRun('Run results cleared.', STATUS.OK);
                    app.focusRuntimeArea();
                } else {
                    app.setStatusReport('Report cleared.', STATUS.OK);
                    focusSafely(app.resultsFileBtn);
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
        const {activeMode} = app.resultsState;

        // Read both arrays through the coercing helpers rather than off the
        // payload: neither is required by the report schema, and everything this
        // function hands them to already tolerates a missing one.
        const scans = app.runSummaryUi.getScansFromPayload(data);
        const screenshots = getScreenshotsFromPayload(data);

        if (activeMode === 'run') {
            app.runSummary.renderActionLog(data.actionResults);
            app.runSummary.showOptionalActionWarnings(data.actionResults);
            // setStatusRun('Workflow scan completed.', STATUS.OK);

            app.lastWorkflowResponse = data;
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
                    createImg({src, alt}, [app.scansDialog]);
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
                createImg({src, alt}, [app.screenshotsDialog]);
            }
        });

        const diagPanel = app.runSummary.renderRunDiagnostics(data.runDiagnostics);
        if (diagPanel) app.summaryEl.parentElement.prepend(diagPanel);

        const collectedMetadataPanel = app.runSummary.renderCollectedMetadata(data.collectedOutputs, data.actionResults);
        if (collectedMetadataPanel) {
            if (diagPanel) diagPanel.after(collectedMetadataPanel);
            else app.summaryEl.parentElement.prepend(collectedMetadataPanel);
        }

        app.clearResults();
        app.clearScreenshots();
        app.results.innerHTML = '';

        app.results.classList.toggle('report-edit-mode', app.reportEditMode);
        // The Engine column shows only for a report more than one engine ran
        // (with the engine lens on, the one engine it shows).
        app.screenshotsUi.renderer.setReportEngines(app.runSummaryUi.getScansFromPayload(data));

        app.results.appendChild(createArtifactsPanel(data));

        if (scans.length || screenshots.length) app.resultsContainer.style.display = '';
        if (app.runSummaryUi.getScansFromPayload(data, {includedOnly: true}).length > 1) {
            const groupedResultsEl = app.screenshotsUi.renderer.renderScansReport(data, {
                scanPresentationMode: 'analysis',
                dispersionScans: app.runSummaryUi.getScansFromPayload(data, {includedOnly: true})
            });
            if (groupedResultsEl) {
                app.results.appendChild(groupedResultsEl);
            }
        }

        // The first scans are drawn with the rest of the page, the others a
        // few at a time with a paint between: drawn at once, a long report
        // froze the page for seconds before anything of it showed. Not when
        // the page was scrolled down, as a redraw there (grouping, engine)
        // goes back to where it was, which needs every scan in place.
        const scanOptions = {scanPresentationMode: 'analysis', reportEditMode: app.reportEditMode};
        const firstBatch = app.drawScansInBatches ? Math.min(scans.length, app.SCANS_FIRST_BATCH) : scans.length;
        app.screenshotsUi.renderer.renderAllScans(scans, {...scanOptions, range: [0, firstBatch]});

        if (screenshots.length) app.screenshotsContainer.style.display = '';
        app.screenshotsUi.renderer.renderAllScreenshots(screenshots);

        renderScanFilters(data);
        applyScanFilterVisibility(scans);
        app.applyScanSort();

        writeReportData(data, app.reportDataContainer)

        if (firstBatch < scans.length) drawRemainingScans(scans, firstBatch, scanOptions);
        else markResultsComplete();
    }

    function markResultsComplete() {
        app.pendingScanDraw = null;
        const waiters = app.resultsCompleteWaiters;
        app.resultsCompleteWaiters = [];
        waiters.forEach((resolve) => resolve());
    }

    /** Null when every scan of the results on screen is drawn, or a promise of it. */
    function whenResultsComplete() {
        if (!app.pendingScanDraw) return null;
        return new Promise((resolve) => app.resultsCompleteWaiters.push(resolve));
    }

    async function drawRemainingScans(scans, from, scanOptions) {
        const draw = {};
        app.pendingScanDraw = draw;
        app.resultsContainer.setAttribute('aria-busy', 'true');
        for (let start = from; start < scans.length; start += app.SCANS_PER_BATCH) {
            await afterPaint();
            // The area was cleared or drawn again meanwhile.
            if (app.pendingScanDraw !== draw) return;
            app.screenshotsUi.renderer.renderAllScans(scans, {...scanOptions, range: [start, start + app.SCANS_PER_BATCH]});
            // Each batch joins the filter and the order the earlier ones are in.
            applyScanFilterVisibility(scans);
            app.applyScanSort();
        }
        app.resultsContainer.removeAttribute('aria-busy');
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
        // A run that accepted untrusted certificates says so to whoever reads
        // its report: it could not tell a site from one pretending to be it.
        if (data?.runDiagnostics?.untrustedCertsAccepted === true) {
            reportData += '<li><strong>Certificates:</strong> <span>Untrusted accepted: the run did not require '
                + 'the sites\' certificates to be trusted</span></li>';
        }

        container.innerHTML = reportData.length ? `<ul class="report-meta">${reportData}</ul>` : '';

        // Live chrome, added after the markup and stripped from the export:
        // see report-meta-edit.js.
        app.reportMetaEditors = mountReportMetaEditors(container, {
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
        const payload = app.getActiveBucket()?.payload;

        if (payload && typeof payload === 'object') payload[field] = value;
        if (renderedData && typeof renderedData === 'object') renderedData[field] = value;

        // A name set here is one the user has settled on, so the export dialog
        // has to keep it rather than offer the scenario name over the top of
        // it - which is exactly what confirming that dialog records.
        if (field === 'reportName') {
            const mode = app.resultsState.activeMode === 'report' ? 'report' : 'run';
            app.lastPromptedScenarioByMode[mode] = getScenarioNameForReport(payload || renderedData);
        }

        writeReportData(renderedData || payload, app.reportDataContainer);
        app.reportMetaEditors?.focusEditButton(field);

        const message = reportMetaField(field)?.saved(value) || '';

        if (app.resultsState.activeMode === 'report') app.setStatusReport(message, STATUS.OK);
        else app.setStatusRun(message, STATUS.OK);
    }

    /** Render final payload using existing paths */
    async function renderFinalPayload(data, fallbackUrl) {
        const allScans = app.runSummaryUi.getScansFromPayload(data);
        const includedScans = app.runSummaryUi.getScansFromPayload(data, {includedOnly: true});

        if (!allScans.length && !getScreenshotsFromPayload(data).length) {
            app.setUiState('error', 'Workflow executed without output.');
            app.summaryEl.textContent = 'No scans or screenshot returned for this workflow.';
            const staleDialog = document.getElementById('all-scans-dialog');
            if (staleDialog) staleDialog.remove();
            return;
        }

        const scansCount = includedScans.length;

        const totals = computeTotals(includedScans);
        const scansListHtml = app.runSummaryUi.buildScansListHtml(allScans);
        app.runSummaryUi.writeSummaryHtml({
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

    return {
        applyScanFilterVisibility,
        buildExportPayload,
        buildScanTagChipsHtml,
        getCurrentReportName,
        markResultsComplete,
        refreshDerivedReportUi,
        renderFinalPayload,
        renderScanFilters,
        reportMetaRow,
        seedPromptedScenarioFor,
        whenResultsComplete,
    };
}
