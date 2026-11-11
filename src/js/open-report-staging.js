// The Open report tab's list of staged reports: each file read and kept with
// the scans and screenshots chosen of it, the list drawn (focus kept as it
// redraws), and the reports loaded, one on its own or several merged. Moved
// out of a11y-ui.js; what it shares with the rest of the app it reaches
// through `app`.

import {escapeAttr, escapeHtml} from './a11y-ui.utils.js';
import {plainReportFileProblem} from './report-file-problem.js';
import {afterPaint} from './busy.js';
import {buildGlobalSummary, hashHex16, pickMetricDefsFromStaged, sortByOrderKey, validateReportOrThrow} from './report-data.js';
import {focusSafely, isActuallyFocusable} from './focus-utils.js';
import {STATUS} from './ui-constants.js';
import {unpackagedPicturesNote} from './report-package.js';

// The warning sign beside a file left out of the list: the same triangle the
// activity panel draws, so a warning looks alike wherever it is.
const WARNING_ICON = '<svg class="report-file-problem__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 3.5L2.5 20h19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17v.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

/**
 * app: accessors for what the rest of the app shares with this part
 * (clearResults, clearScreenshots, focusReportArea, reportFilesClearBtn, reportFilesCountEl, reportFilesListEl, reportFilesLoadBtn, reportFilesStagingEl, reportView, setReportPayload, setStatusReport, urlInput).
 */
export function createOpenReportStaging(app) {
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
            entry.error = plainReportFileProblem(err);
        }

        stagedReportFiles.push(entry);

        renderStagedReportFilesList();

        const staged = stagedFilesMessage();
        app.setStatusReport(staged.text, staged.skipped ? STATUS.WARNING : STATUS.OK);
    }

    // The reports listed that load, with the selection made of each.
    function loadableFiles() {
        return stagedReportFiles.filter(it =>
            it.ok && it.parsed &&
            ((countSelected(it.includeScans) > 0) || (countSelected(it.includeActionScreenshots) > 0))
        );
    }

    /**
     * What the list holds, said once the files are read: how many reports
     * are ready, and which files are left out. Why each is left out is said
     * in its own row only, not again here. -> { text, ready, skipped }.
     */
    function stagedFilesMessage() {
        const ready = stagedReportFiles.filter(x => x.ok).length;
        const skipped = stagedReportFiles.filter(x => !x.ok);
        const readyText = ready
            ? `${ready} report${ready === 1 ? '' : 's'} ready to load.`
            : 'No report to load.';
        const text = skipped.length
            ? `${readyText} ${skippedText(skipped)}`
            : readyText;
        return {text, ready, skipped: skipped.length};
    }

    function skippedText(skipped) {
        const names = skipped.map(x => x.name).join(', ');
        return `Skipped ${skipped.length === 1 ? 'a file that is' : `${skipped.length} files that are`} not a report (${names}): the list says why.`;
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
        if (!app.reportFilesStagingEl) return;
        app.reportFilesStagingEl.hidden = !isVisible;
    }

    function setStagingButtonsEnabled({canLoad, canClear}) {
        if (app.reportFilesLoadBtn) {
            app.reportFilesLoadBtn.setAttribute('aria-disabled', canLoad ? 'false' : 'true');
            app.reportFilesLoadBtn.disabled = !canLoad;
        }
        if (app.reportFilesClearBtn) {
            app.reportFilesClearBtn.setAttribute('aria-disabled', canClear ? 'false' : 'true');
            app.reportFilesClearBtn.disabled = !canClear;
        }
    }

    function renderStagedReportFilesList() {
        if (!app.reportFilesListEl || !app.reportFilesCountEl) return;

        // Clear list
        app.reportFilesListEl.innerHTML = '';

        const total = stagedReportFiles.length;
        const okCount = stagedReportFiles.filter(x => x.ok).length;
        const badCount = total - okCount;

        app.reportFilesCountEl.textContent =
            total === 0
                ? ''
                : `${okCount} report${okCount === 1 ? '' : 's'}${badCount ? `, ${badCount} file${badCount === 1 ? '' : 's'} skipped` : ''}.`;

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

            // A file left out says why once, here, with a warning sign: the
            // status line and the activity panel only say that it was. A
            // report's JSON without its zip says where its pictures are.
            const statusHtml = item.ok
                ? `<small style="opacity:.85;"> - Ready${item.missingPictures ? `. ${escapeHtml(unpackagedPicturesNote(item.missingPictures))}` : ''}</small>`
                : `<span class="report-file-problem">${WARNING_ICON}<span><strong>Skipped.</strong> ${escapeHtml(item.error || plainReportFileProblem(null))}</span></span>`;

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
                    ${statusHtml}
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
            app.reportFilesListEl.appendChild(li);
        }

        recomputeStagingButtonsEnabled();
    }

    // Load says how many reports it loads; a file that is not a report is
    // left out, and does not hold the others back.
    function recomputeStagingButtonsEnabled() {
        const loadable = loadableFiles().length;
        if (app.reportFilesLoadBtn) {
            app.reportFilesLoadBtn.textContent = loadable
                ? `Load ${loadable} report${loadable === 1 ? '' : 's'}`
                : 'Load reports';
        }
        setStagingButtonsEnabled({canLoad: loadable > 0, canClear: stagedReportFiles.length > 0});
    }

    function updateStagedFileSummaryInPlace(key) {
        if (!app.reportFilesListEl) return;

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

        const el = app.reportFilesListEl.querySelector(
            `[data-report-file-summary="1"][data-report-file-key="${CSS.escape(key)}"]`
        );

        if (el) el.textContent = summaryText;

        recomputeStagingButtonsEnabled();
    }

    function captureStagingFocusToken() {
        if (!app.reportFilesListEl) return null;

        const ae = document.activeElement;
        if (!ae || !(ae instanceof Element)) return null;
        if (!app.reportFilesListEl.contains(ae)) return null;

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
        if (!token || !app.reportFilesListEl) return false;

        // 1) Try exact selector
        if (token.selector) {
            const el = app.reportFilesListEl.querySelector(token.selector);
            if (isActuallyFocusable(el)) return focusSafely(el);
        }

        // 2) Special fallback for move buttons that may become disabled after move
        if (token.kind === 'move' && token.key) {
            const otherMove = token.move === '-1' ? '1' : '-1';
            const alt = app.reportFilesListEl.querySelector(
                `button[data-report-file-move="${CSS.escape(otherMove)}"][data-report-file-key="${CSS.escape(token.key)}"]`
            );
            if (isActuallyFocusable(alt)) return focusSafely(alt);

            const toggle = app.reportFilesListEl.querySelector(
                `button[data-report-file-toggle="1"][data-report-file-key="${CSS.escape(token.key)}"]`
            );
            if (isActuallyFocusable(toggle)) return focusSafely(toggle);

            const remove = app.reportFilesListEl.querySelector(
                `button[data-report-file-remove="1"][data-report-file-key="${CSS.escape(token.key)}"]`
            );
            if (isActuallyFocusable(remove)) return focusSafely(remove);
        }

        // 3) If caller provided a fallback selector, try it
        if (fallbackSelector) {
            const fb = app.reportFilesListEl.querySelector(fallbackSelector);
            if (isActuallyFocusable(fb)) return focusSafely(fb);
        }

        // 4) Generic fallback inside staging list: first enabled button
        const any = app.reportFilesListEl.querySelector('button:not([disabled]), input[type="checkbox"]:not([disabled])');
        if (isActuallyFocusable(any)) return focusSafely(any);

        return false;
    }

    /**
     * Loads the staged files into the open report tab, listing its steps in
     * the activity panel's `task`.
     */
    // The scan groups each report chose, carried into the report they are
    // merged into (docs/design/scan-grouping-design.md §7): every group any
    // of them chose, the first name given to it kept. A group that matches
    // none of the merged scans is not shown. A scan renamed because another
    // report has its id is renamed in its report's choice too, so what was
    // added, taken out or grouped by hand still names it (§11).
    function carryScanGrouping(payload, reports, scans = payload?.scans) {
        const api = globalThis.A11Y_SCAN_GROUP_CHOICE;
        if (!api || !payload) return;
        const renames = new Map();
        for (const scan of Array.isArray(scans) ? scans : []) {
            if (!scan || scan._originalId == null || !Number.isFinite(Number(scan._importSourceIndex))) continue;
            const source = Number(scan._importSourceIndex);
            if (!renames.has(source)) renames.set(source, new Map());
            renames.get(source).set(String(scan._originalId), scan.id);
        }
        const renamed = reports.map((report, i) => {
            const map = renames.get(i);
            if (!map || !report) return report;
            return {scanGrouping: {patterns: api.renameScanIds(api.readChoice(report), (id) => map.get(id) || id)}};
        });
        api.writeChoice(payload, api.mergeChoices(renamed));
    }

    async function loadStagedReportsIntoOpenReport(task) {
        const okItems = stagedReportFiles.filter(x => x.ok && x.parsed);
        const refuse = (message) => {
            app.setStatusReport(message, STATUS.ERROR);
            task.fail(message);
        };
        const step = async (label) => {
            task.step(label);
            await afterPaint();
        };
        // The report is drawn a few scans at a time: the task ends once all are.
        // A report whose pictures stayed in its zip says so once it shows.
        const shown = async (message) => {
            const without = okItems.filter((x) => x.missingPictures);
            if (without.length) {
                message += without.length === 1 && okItems.length === 1
                    ? ` ${unpackagedPicturesNote(without[0].missingPictures)}`
                    : ` ${without.map((x) => x.name).join(', ')}: ${without.length === 1 ? 'its pictures came' : 'their pictures came'} in the zip ${without.length === 1 ? 'it was' : 'they were'} saved in: open ${without.length === 1 ? 'that zip' : 'those zips'}, from Download report, to see them.`;
            }
            app.setStatusReport(message, skipped.length || without.length ? STATUS.WARNING : STATUS.OK);
            app.focusReportArea();
            await app.reportView.whenResultsComplete();
            task.done(message);
        };

        if (!okItems.length) {
            refuse('No report to load: the files listed are not reports.');
            return;
        }

        // A file that is not a report is left out, and the message says so.
        const skipped = stagedReportFiles.filter(x => !x.ok);
        const skippedNote = skipped.length ? ` ${skippedText(skipped)}` : '';

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
                app.setReportPayload(payload, {fileName: only.name});
                await shown(`Report loaded from ${only.name}.${skippedNote}`);
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
            app.clearResults();
            app.clearScreenshots();
            app.setStatusReport('Processing and loading reports from staged files.', STATUS.OK);

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
                const baseUrl = (okItems[0]?.parsed?.url) || (app.urlInput?.value?.trim() || '');
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
                carryScanGrouping(payload, parsedObjects, mergedScans);

                // Restore tokenized scan screenshot dataUrls
                restoreScanDataUrls(payload, scanDataUrlMap);

                // Validate merged payload too
                validateReportOrThrow(payload, 'merged');

                await step('Drawing the report');
                app.setReportPayload(payload, {fileName: okItems.map(x => x.name).join(', ')});
                await shown(`${okItems.length} reports loaded, merged into one.${skippedNote}`);
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
            carryScanGrouping(payload, parsedObjects);

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
            app.setReportPayload(payload, {fileName: okItems.map(x => x.name).join(', ')});
            await shown(`${okItems.length} reports loaded, merged into one.${skippedNote}`);
        } catch (err) {
            console.error('Import error:', err);
            refuse(`Import error: ${String(err?.message || err)}`);
        }
    }

    return {
        captureStagingFocusToken,
        initEntrySelectionsFromParsed,
        isZipFile,
        loadStagedReportsIntoOpenReport,
        stagedFilesMessage,
        makeFileKey,
        moveStagedReportFile,
        prepareSpareReport,
        renderStagedReportFilesList,
        reportInZip,
        get reportOpenedAlone() { return reportOpenedAlone; },
        set reportOpenedAlone(value) { reportOpenedAlone = value; },
        restoreStagingFocus,
        stageReportObject,
        get stagedReportFiles() { return stagedReportFiles; },
        set stagedReportFiles(value) { stagedReportFiles = value; },
        updateStagedFileSummaryInPlace,
    };
}
