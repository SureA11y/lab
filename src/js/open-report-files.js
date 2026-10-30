// The Open report tab's files: picked or dropped, read and checked, listed
// with the scans and screenshots to keep of each, and loaded, one on its own
// or several merged; and the grouping file a report can take. Moved out of
// a11y-ui.js; what it shares with the rest of the app it reaches through
// `app`.

import {readCompareZip} from './comparison-bundle.js';
import {afterPaint, isBusy, runBusy, setBusy} from './busy.js';
import {getActivity} from './activity.js';
import {cleanGroupingItem} from './grouping-spec.js';
import {validateReportOrThrow} from './report-data.js';
import {focusSafely} from './focus-utils.js';
import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (captureStagingFocusToken, groupingFileBtn, groupingFileInput, groupingScanFileBtn, groupingUi, initEntrySelectionsFromParsed, isZipFile, loadStagedReportsIntoOpenReport, makeFileKey, moveStagedReportFile, prepareSpareReport, renderStagedReportFilesList, reportFilesClearBtn, reportFilesListEl, reportFilesLoadBtn, reportInZip, reportOpenedAlone, restoreStagingFocus, resultsFileBtn, resultsFileInput, resultsState, setStatusReport, setStatusRun, stagedReportFiles, updateStagedFileSummaryInPlace).
 */
export function createOpenReportFiles(app) {
    if (app.reportFilesListEl) {
        app.reportFilesListEl.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-report-file-key]');
            if (!btn) return;

            const key = btn.getAttribute('data-report-file-key') || '';
            if (!key) return;

            // Expand/collapse per file
            if (btn.getAttribute('data-report-file-toggle') === '1') {
                const item = app.stagedReportFiles.find(x => x.key === key);
                if (!item || !item.ok) return;

                const token = app.captureStagingFocusToken();
                item.expanded = !item.expanded;
                app.renderStagedReportFilesList();
                app.restoreStagingFocus(token);
                return;
            }

            // Section select all/none
            const sectionSelect = btn.getAttribute('data-report-section-select');
            const section = btn.getAttribute('data-report-section');

            if ((sectionSelect === 'all' || sectionSelect === 'none') && (section === 'scans' || section === 'shots')) {
                const item = app.stagedReportFiles.find(x => x.key === key);
                if (!item || !item.ok || !item.parsed) return;

                const want = sectionSelect === 'all';

                if (section === 'scans') {
                    const scans = Array.isArray(item.parsed.scans) ? item.parsed.scans : [];
                    item.includeScans = scans.map(() => want);
                } else {
                    const shots = Array.isArray(item.parsed.screenshots) ? item.parsed.screenshots : [];
                    item.includeActionScreenshots = shots.map(() => want);
                }

                const token = app.captureStagingFocusToken();
                app.renderStagedReportFilesList();
                app.restoreStagingFocus(token);
                return;
            }

            const move = btn.getAttribute('data-report-file-move');
            if (move === '-1' || move === '1') {
                const token = app.captureStagingFocusToken();
                app.moveStagedReportFile(key, Number(move)); // this already re-renders
                // moveStagedReportFile will restore focus if you applied (A). If you did not, keep next 2 lines:
                // renderStagedReportFilesList();
                app.restoreStagingFocus(token);
                app.setStatusReport(move === '-1' ? 'Moved file up.' : 'Moved file down.', STATUS.OK);
                return;
            }

            if (btn.getAttribute('data-report-file-remove') === '1') {
                const token = app.captureStagingFocusToken();

                // Compute fallback: next file remove button, else previous
                const beforeIndex = app.stagedReportFiles.findIndex(x => x.key === key);
                const nextItem = app.stagedReportFiles[beforeIndex + 1] || null;
                const prevItem = app.stagedReportFiles[beforeIndex - 1] || null;

                const fallbackSelector =
                    nextItem
                        ? `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(nextItem.key)}"]`
                        : prevItem
                            ? `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(prevItem.key)}"]`
                            : null;

                app.stagedReportFiles = app.stagedReportFiles.filter(x => x.key !== key);
                app.renderStagedReportFilesList();

                // If list became empty, focus Add report(s)
                if (app.stagedReportFiles.length === 0) {
                    focusSafely(app.resultsFileBtn);
                } else {
                    app.restoreStagingFocus(token, fallbackSelector);
                }

                app.setStatusReport('File removed from staged list.', STATUS.OK);
            }
        });

        app.reportFilesListEl.addEventListener('change', (event) => {
            const input = event.target;
            if (!input || input.tagName !== 'INPUT' || input.type !== 'checkbox') return;

            const key = input.getAttribute('data-report-file-key') || '';
            if (!key) return;

            const item = app.stagedReportFiles.find(x => x.key === key);
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

                app.updateStagedFileSummaryInPlace(key);
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

                app.updateStagedFileSummaryInPlace(key);
            }
        });
    }

    if (app.reportFilesClearBtn) {
        app.reportFilesClearBtn.addEventListener('click', () => {
            app.stagedReportFiles = [];
            app.renderStagedReportFilesList();
            focusSafely(app.resultsFileBtn); // next logical action
            app.setStatusReport('Staged file list cleared.', STATUS.OK);
        });
    }

    if (app.reportFilesLoadBtn) {
        // The load under way, in the activity panel: a press meanwhile shows it.
        let loading = null;
        app.reportFilesLoadBtn.addEventListener('click', () => {
            if (isBusy(app.reportFilesLoadBtn)) {
                loading?.reveal();
                return;
            }
            runBusy(app.reportFilesLoadBtn, async () => {
                app.setStatusReport('Loading the report…', STATUS.BUSY);
                await getActivity().run('Open report: load', (task) => {
                    loading = task;
                    return app.loadStagedReportsIntoOpenReport(task);
                }, {rethrow: false, quiet: true});
                loading = null;
            });
        });
    }

    // The files being read, in the activity panel: a press meanwhile shows it.
    let readingReportFiles = null;
    if (app.resultsFileBtn && app.resultsFileInput) {
        app.resultsFileBtn.addEventListener('click', () => {
            if (isBusy(app.resultsFileBtn)) readingReportFiles?.reveal();
            else app.resultsFileInput.click();
        });
    }

    if (app.groupingFileBtn) {
        app.groupingFileBtn.hidden = true;
        app.groupingFileBtn.setAttribute('aria-hidden', 'true');
    }

    if (app.groupingScanFileBtn) {
        app.groupingScanFileBtn.hidden = true;
        app.groupingScanFileBtn.setAttribute('aria-hidden', 'true');
    }

    if (app.resultsFileInput) {
        app.resultsFileInput.addEventListener('change', async (event) => {
            const input = event.target;
            const files = Array.from(input.files || []);
            input.value = ''; // always reset so same file selection triggers change again

            if (!files.length) return;
            // What is picked opens at once: one report on its own, as one
            // given by address does (and the next one picked the same way
            // takes its place), several merged with all their scans. The list
            // stays, to leave scans or files out and Load selected again.
            if (app.reportOpenedAlone && app.stagedReportFiles.length === 1 && app.stagedReportFiles[0] === app.reportOpenedAlone) {
                app.stagedReportFiles = [];
            }
            app.reportOpenedAlone = null;
            const listedBefore = app.stagedReportFiles.length;
            const allReports = await stageReportFiles(files);
            if (!allReports) return;
            if (listedBefore === 0 && app.stagedReportFiles.length === 1) app.reportOpenedAlone = app.stagedReportFiles[0];
            app.reportFilesLoadBtn?.click();
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
            app.setStatusReport(files.length === 1 ? `Reading ${files[0].name}…` : `Reading ${files.length} files…`, STATUS.BUSY);
            setBusy(app.resultsFileBtn, true);
            const task = getActivity().start(files.length === 1 ? `Open report: read ${files[0].name}` : `Open report: read ${files.length} files`, {quiet: true});
            readingReportFiles = task;
            await afterPaint();
            // A report package or any zip of reports (report-package.js) gives
            // each report it holds, with its pictures, as a file of its own.
            const sources = [];
            for (const file of files) {
                if (!app.isZipFile(file)) {
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
                    for (const f of found) sources.push(app.reportInZip(file, f));
                    reading.done(`${found.length} report${found.length === 1 ? '' : 's'}`);
                } catch (err) {
                    reading.warn(String(err?.message || err));
                    app.stagedReportFiles.push({
                        key: app.makeFileKey(file), file, name: file.name, size: file.size, lastModified: file.lastModified,
                        ok: false, error: String(err?.message || err), parsed: null, expanded: false,
                        includeScans: null, includeActionScreenshots: null
                    });
                }
            }
            for (const file of sources) {
                const key = app.makeFileKey(file);

                // Deduplicate exact same file selection
                if (app.stagedReportFiles.some(x => x.key === key)) continue;

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
                    app.initEntrySelectionsFromParsed(entry);

                    app.stagedReportFiles.push(entry);
                    app.prepareSpareReport(entry, text);
                    checking.done();
                } catch (err) {
                    checking.warn(String(err?.message || err));
                    app.stagedReportFiles.push({
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
            setBusy(app.resultsFileBtn, false);

            app.renderStagedReportFilesList();

            const total = app.stagedReportFiles.length;
            const okCount = app.stagedReportFiles.filter(x => x.ok).length;
            const badCount = total - okCount;

            const staged = badCount
                ? `Files staged. ${okCount} valid, ${badCount} invalid. Remove or fix invalid files before loading.`
                : `Files staged. ${okCount} ready to load.`;
            app.setStatusReport(staged, badCount ? STATUS.WARNING : STATUS.OK);
            task.done(staged);
            readingReportFiles = null;
            return badCount === 0;
        }
    }

    if (app.groupingFileInput) {
        app.groupingFileInput.addEventListener('change', async (event) => {
            const input = event.target;
            const file = input?.files?.[0] || null;

            const mode = app.groupingUi.groupingPickerTargetMode || app.resultsState.activeMode;
            app.groupingUi.groupingPickerTargetMode = null;

            // Always reset so picking the same file again triggers change
            input.value = '';

            if (!file) {
                app.groupingUi.setSelectedBuiltInGroupingId(app.groupingUi.getLastResolvedGroupingSelectionId(mode), mode);
                app.groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                app.groupingUi.applySelectedBuiltInGrouping(mode);
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
                    app.groupingUi.setSelectedBuiltInGroupingId(app.groupingUi.getLastResolvedGroupingSelectionId(mode), mode);
                    app.groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                    app.groupingUi.applySelectedBuiltInGrouping(mode);

                    app.setStatusRun(`Invalid grouping file: ${res.message} Grouping disabled.`, STATUS.ERROR);
                    app.setStatusReport(`Invalid grouping file: ${res.message} Grouping disabled.`, STATUS.ERROR);
                    return;
                }

                app.groupingUi.setLoadedCustomGrouping({
                    id: 'custom-loaded',
                    label: `Custom: ${file.name}`,
                    groups: res.cleaned
                }, mode);

                app.groupingUi.setSelectedBuiltInGroupingId('custom-loaded', mode);

                app.groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                app.groupingUi.applySelectedBuiltInGrouping(mode);

                app.setStatusRun(`Grouping loaded: ${file.name}`, STATUS.OK);
                app.setStatusReport(`Grouping loaded: ${file.name}`, STATUS.OK);
            } catch (err) {
                console.error('Could not load grouping JSON', err);

                app.groupingUi.setSelectedBuiltInGroupingId(app.groupingUi.getLastResolvedGroupingSelectionId(mode), mode);
                app.groupingUi.refreshBuiltInGroupingSelectOptions(mode);
                app.groupingUi.applySelectedBuiltInGrouping(mode);

                app.setStatusRun(`Could not load grouping JSON: ${String(err?.message || err)} Grouping disabled.`, STATUS.ERROR);
                app.setStatusReport(`Could not load grouping JSON: ${String(err?.message || err)} Grouping disabled.`, STATUS.ERROR);
            }
        });
    }

    return {
        stageReportFiles,
    };
}
