// The Compare tab: many reports in one view, a diff of two or a dashboard of
// three or more, with what the comparison calls itself and its downloads.
// Moved out of a11y-ui.js; what it shares with the rest of the app it
// reaches through `app`.

import {escapeHtml} from './a11y-ui.utils.js';
import {enginesHTML, howTestedHTML} from './engine-brand.js';
import {MAX_REPORTS as MAX_COMPARE_REPORTS, createComparisonController} from './report-comparison-controller.js';
import {formatReportTimestamp} from './report-timestamp.js';
import {reportMetaField} from './report-meta-fields.js';
import {mountReportMetaEditors} from './report-meta-edit.js';
import {createDownloadComparisonBtn} from './export.js';
import {readCompareZip} from './comparison-bundle.js';
import {folderOf, rebaseImageRefs} from './report-package.js';
import {afterPaint, runBusy} from './busy.js';
import {getActivity} from './activity.js';
import {computeReportGlobals, parseReportText, readReportFile, validateReportOrThrow} from './report-data.js';
import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (buildExportPayload, compareActionsEl, compareClearBtn, compareContextDesc, compareContextSeg, compareDocEl, compareInput, compareLoadBtn, compareOrderNote, compareProfilesEl, compareReportsEl, compareStatusEl, getActiveBucket, getCurrentReportName, isZipFile, queuePanel, reportFilesLoadBtn, reportMetaRow, resultsState, runComparisonEl, setStatusReport, setStatusRun, stageReportFiles, tabsmode).
 */
export function createCompareTab(app) {
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
            return await runBusy(app.compareLoadBtn, () => getActivity().run(title, (task) => {
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
        hold(app.compareClearBtn);
        // Drawn again when a load ends, so a switch held now gets back its
        // own state (the last one on stays disabled).
        if (held) app.compareProfilesEl?.querySelectorAll('button').forEach(hold);
        app.compareContextSeg?.querySelectorAll('.ctx-opt').forEach(hold);
        document.querySelectorAll('[data-compare-report]').forEach(hold);
        app.compareReportsEl?.querySelectorAll('[data-remove-key], [data-move-key]').forEach((control) => {
            // A move at the end of the list stays disabled, as it was drawn.
            if (!control.disabled) hold(control);
        });
        syncCompareDownload();
        app.queuePanel?.setCompareBlocked(compareLoad ? COMPARE_LOADING : null);
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
        const head = app.runComparisonEl?.querySelector('.cmp2 .doc-head');
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
        if (!app.compareDocEl || !comparisonController) return;

        // Nothing to name until there is a comparison to name.
        if (comparisonController.count() < 2) {
            app.compareDocEl.replaceChildren();
            comparisonMetaEditors = null;
            return;
        }

        const values = comparisonMetaValues();
        const derived = !values.comparisonTitle;

        const rows = [
            app.reportMetaRow({
                label: 'Name',
                // Said once, quietly: a name nobody typed came from somewhere,
                // and it will follow the reports rather than stay put.
                valueHtml: escapeHtml(resolvedComparisonTitle())
                    + (derived ? ' <span class="meta-note">taken from the reports</span>' : ''),
                field: 'comparisonTitle'
            }),
            app.reportMetaRow({
                label: 'Description',
                valueHtml: values.comparisonNote
                    ? escapeHtml(values.comparisonNote)
                    : '<span class="meta-unset">Not set</span>',
                field: 'comparisonNote'
            }),
            app.reportMetaRow({
                label: 'Compiled',
                valueHtml: escapeHtml(formatReportTimestamp(values.comparisonTimestamp)),
                field: 'comparisonTimestamp'
            })
        ].join('') + comparisonEnginesRow();

        app.compareDocEl.innerHTML = `<ul class="report-meta">${rows}</ul>`;

        // Live chrome. It sits outside the .cmp2 subtree the export copies, so
        // the values it sets travel and the means of changing them does not.
        comparisonMetaEditors = mountReportMetaEditors(app.compareDocEl, {
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
        if (!app.compareStatusEl) return;
        app.compareStatusEl.textContent = message;
        app.compareStatusEl.className = 'status';
        if (tone) app.compareStatusEl.classList.add(tone);
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
        if (!app.compareReportsEl || !comparisonController) return;

        const list = comparisonController.list();
        app.compareReportsEl.replaceChildren();

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
            app.compareReportsEl.append(item);
        }

        if (app.compareClearBtn) app.compareClearBtn.hidden = list.length === 0;
        // Nothing to name until there is a comparison: an empty tab asking for a
        // title is a form to fill in before anything has happened.
        // Written after the view, because the name the line reads is the one
        // the rendered document settled on.
        writeComparisonData();
        renderCompareContext();
        renderCompareProfiles();
    }

    // Which profiles the comparison is read on: a switch per profile every
    // loaded report checked, all on until turned off, the last one on staying
    // on. Shown when there are two or more to choose between. The view reads
    // the reports without the profiles turned off and scores them again on
    // the rest; its "By profile" section says how much each one accounts for.
    function renderCompareProfiles({ focusKey = null } = {}) {
        const el = app.compareProfilesEl;
        if (!el || !comparisonController) return;
        const profiles = comparisonController.profiles();
        if (profiles.length < 2) {
            el.hidden = true;
            el.replaceChildren();
            return;
        }
        el.hidden = false;
        el.replaceChildren();
        el.setAttribute('role', 'group');

        const label = document.createElement('span');
        label.className = 'scan-tag-filter__label';
        label.id = 'compare-profiles-label';
        label.textContent = 'Profiles compared:';
        el.setAttribute('aria-labelledby', label.id);
        el.append(label);

        const onCount = profiles.filter((p) => p.on).length;
        for (const {key, label: name, on} of profiles) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'scan-tag-filter__chip';
            btn.dataset.compareProfile = key;
            btn.setAttribute('aria-pressed', String(on));
            btn.textContent = name;
            if (on && onCount === 1) {
                btn.setAttribute('aria-disabled', 'true');
                btn.title = 'At least one profile stays compared';
            }
            el.append(btn);
        }
        if (onCount < profiles.length) {
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'scan-tag-filter__clear secondary-button';
            all.dataset.compareProfilesAll = 'true';
            all.textContent = 'Compare on all';
            el.append(all);
        }
        if (focusKey !== null) {
            const target = [...el.querySelectorAll('[data-compare-profile]')].find((b) => b.dataset.compareProfile === focusKey);
            target?.focus();
        }
    }

    // The context sets the default order; this line says how it came out and how
    // to change it. Only meaningful once there are columns.
    function renderCompareOrderNote() {
        if (!comparisonController || !app.compareOrderNote) return;

        const shown = comparisonController.count() >= 2;

        app.compareOrderNote.hidden = !shown;
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

        app.compareOrderNote.textContent = parts.join(' ');
    }

    // What these reports are: the choice that fixes the framing, the default
    // column order, how columns are labelled and the noun sentences count in.
    function renderCompareContext() {
        if (!comparisonController || !app.compareContextSeg) return;

        const current = comparisonController.getContext();

        app.compareContextSeg.querySelectorAll('.ctx-opt').forEach((opt) => {
            opt.setAttribute('aria-pressed', String(opt.dataset.context === current));
        });

        if (app.compareContextDesc) {
            const context = comparisonController.contexts().find((c) => c.id === current);

            if (context) app.compareContextDesc.textContent = context.description;
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
        if (!app.compareLoadBtn || !app.compareInput) return;

        // The load under way, in the activity panel: a press meanwhile shows it.
        app.compareLoadBtn.addEventListener('click', () => {
            if (compareLoad) compareLoad.task?.reveal();
            else app.compareInput.click();
        });

        app.compareInput.addEventListener('change', async (event) => {
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
        const say = mode === 'compare' ? setCompareStatus : app.setStatusReport;
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
        if (await app.stageReportFiles(files)) app.reportFilesLoadBtn?.click();
    }

    async function loadCompareFiles(files, task) {
        // Each report to add, from a JSON file or from inside a zip of
        // reports. A downloaded comparison is not added to: it replaces
        // what is loaded, so it comes on its own.
        const sources = [];
        const failures = [];
        let batch = null;

        for (const file of files) {
            if (!app.isZipFile(file)) {
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
        if (refuseWhileCompareLoads(app.resultsState.activeMode === 'report' ? app.setStatusReport : app.setStatusRun)) return false;

        const bucket = app.getActiveBucket();
        const payload = bucket?.payload || data;
        const snapshot = app.buildExportPayload(payload, {includedOnly: true});

        // No name of its own means no name: the controller then falls back to what
        // the report calls itself, which is what a file with a generic name gets too.
        const result = comparisonController.addReport(snapshot, app.getCurrentReportName(payload) || undefined);

        // The button is only offered for a report that can be compared, so this is
        // the narrower case — every scan holding findings sits outside the filter,
        // or the dashboard is full. Say so where the reader still is, rather than
        // moving them to a tab to show them an error.
        if (!result.ok) {
            const isReport = app.resultsState.activeMode === 'report';
            const setStatus = isReport ? app.setStatusReport : app.setStatusRun;

            setStatus(
                `${isReport ? 'This report' : 'These run results'} cannot be added`
                + ` to the comparison — ${result.error}.`,
                STATUS.ERROR
            );
            return false;
        }

        if (app.tabsmode && typeof app.tabsmode.setActive === 'function') app.tabsmode.setActive('compare');

        renderCompareChips();
        describeCompareLoad({
            added: 1,
            failures: [],
            duplicates: result.duplicate ? 1 : 0,
            // Pressing the button moved the reader to another tab, so the tab
            // says what arrived and where from rather than only counting.
            lead: `${result.name} added from the `
                + `${app.resultsState.activeMode === 'report' ? 'open report' : 'run results'}`
        });

        return true;
    }

    if (app.runComparisonEl) {
        const downloadComparison = createDownloadComparisonBtn({
            getSnapshot: () => comparisonController.snapshot(),
            onError: (error) => {
                if (app.compareStatusEl) {
                    app.compareStatusEl.textContent = error && error.message
                        ? error.message
                        : 'Could not generate the comparison file.';
                    app.compareStatusEl.classList.add(STATUS.ERROR);
                }
            }
        });

        if (app.compareActionsEl) app.compareActionsEl.append(downloadComparison.element);
        // Not while a load is under way: it would hold only what has arrived.
        syncCompareDownload = () => downloadComparison.setEnabled(compareState === 'ready' && !compareLoad);

        comparisonController = createComparisonController({
            setHTML: (html) => { app.runComparisonEl.innerHTML = html; },
            onState: (state) => { compareState = state; syncCompareDownload(); }
        });

        // What these reports are. One choice, because framing and column order
        // are not independent decisions from the reader's side.
        if (app.compareContextSeg) {
            app.compareContextSeg.querySelectorAll('.ctx-opt').forEach((opt) => {
                opt.addEventListener('click', () => {
                    if (refuseWhileCompareLoads(setCompareStatus)) return;
                    comparisonController.setContext(opt.dataset.context);
                    renderCompareChips();
                });
            });
        }

        wireCompareLoader();

        // The profiles compared: delegated, as the row is drawn again on
        // every change.
        if (app.compareProfilesEl) {
            app.compareProfilesEl.addEventListener('click', (event) => {
                const target = event.target.closest && event.target.closest('button');
                if (!target || target.getAttribute('aria-disabled') === 'true') return;
                if (refuseWhileCompareLoads(setCompareStatus)) return;
                if (target.dataset.compareProfilesAll) {
                    comparisonController.showAllProfiles();
                    renderCompareChips();
                    const first = app.compareProfilesEl.querySelector('[data-compare-profile]');
                    first?.focus();
                    setCompareStatus('Compared on every profile the reports share.', STATUS.OK);
                    return;
                }
                const key = target.dataset.compareProfile;
                if (!key) return;
                const on = target.getAttribute('aria-pressed') !== 'true';
                comparisonController.setProfile(key, on);
                renderCompareChips();
                renderCompareProfiles({ focusKey: key });
                const shown = comparisonController.profiles().filter((p) => p.on).map((p) => p.label);
                setCompareStatus(`Compared on ${shown.join(' + ')}.`, STATUS.OK);
            });
        }

        if (app.compareClearBtn) {
            app.compareClearBtn.addEventListener('click', () => {
                if (refuseWhileCompareLoads(setCompareStatus)) return;
                comparisonController.clear();
                // The name belonged to the comparison that just went away.
                comparisonController.setDocument({ title: '', note: '' });
                renderCompareChips();
                setCompareStatus('All reports removed.', STATUS.OK);
                if (app.compareLoadBtn) app.compareLoadBtn.focus();
            });
        }

        // Chip controls are delegated: the list is rebuilt on every change.
        if (app.compareReportsEl) {
            app.compareReportsEl.addEventListener('click', (event) => {
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
                    const again = app.compareReportsEl.querySelector(
                        `[data-move-key="${key}"][data-move-delta="${delta}"]`
                    );
                    if (again && !again.disabled) again.focus();
                    else if (again) again.parentElement.querySelector('button:not([disabled])')?.focus();
                }
            });
        }

        // The dashboard's category filters over the rule grid, and the chart
        // tooltips — both event-delegated so they survive a re-render.
        app.runComparisonEl.addEventListener('click', (event) => {
            const chip = event.target.closest && event.target.closest('[data-dash-filter]');
            if (!chip || !app.runComparisonEl.contains(chip)) return;

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

        wireDashboardTooltip(app.runComparisonEl);

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

        app.runComparisonEl.addEventListener('click', (event) => {
            const seg = event.target.closest && event.target.closest('.seg');
            if (!seg || !app.runComparisonEl.contains(seg)) return;
            selectComparisonTab(seg.closest('.cmp2') || app.runComparisonEl, seg);
        });

        // Arrow/Home/End move between tabs, per the tablist role the markup declares.
        app.runComparisonEl.addEventListener('keydown', (event) => {
            const seg = event.target.closest && event.target.closest('.seg');
            if (!seg || !app.runComparisonEl.contains(seg)) return;

            const scope = seg.closest('.cmp2') || app.runComparisonEl;
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

    return {
        get compareLoad() { return compareLoad; },
        set compareLoad(value) { compareLoad = value; },
        get comparisonController() { return comparisonController; },
        set comparisonController(value) { comparisonController = value; },
        describeCompareLoad,
        openFromQuery,
        readConformanceReviewFile,
        readOpenQuery,
        refuseWhileCompareLoads,
        renderCompareChips,
        replaceLoadedComparison,
        runCompareLoad,
        sendReportToCompare,
        setCompareStatus,
    };
}
