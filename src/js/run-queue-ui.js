// The queue tab's wiring: its panel, the queue's tab spinner, and opening a
// queued run's result. Moved out of a11y-ui.js; what it shares with the rest
// of the app it reaches through `app`.

import {createRunQueuePanel} from './run-queue-panel.js';
import {MAX_REPORTS as MAX_COMPARE_REPORTS} from './report-comparison-controller.js';
import {folderOf, rebaseImageRefs} from './report-package.js';
import {afterPaint} from './busy.js';
import {getActivity} from './activity.js';
import {validateReportOrThrow} from './report-data.js';
import {setQueueTabSpinner} from './tab-indicators.js';
import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * ($, afterConfigLoaded, batchPanel, cfgIO, compareTab, focusReportArea, getWorkflowWithPasswords, queueRunWatch, refreshRunButton, setReportPayload, setSectionsState, setStatusReport, setStatusRun, tabsmode, whenResultsComplete).
 */
export function createRunQueueUi(app) {
    const queueListEl = app.$('#queue-sessions');
    // A batch is running on the server (from GET /queue): Run batch waits.
    let queueBusy = false;
    const queuePanel = queueListEl ? createRunQueuePanel({
        listEl: queueListEl,
        concurrencySelect: app.$('#queue-concurrency'),
        cancelAllButton: app.$('#queue-cancel-all'),
        notifyToggle: app.$('#queue-notify'),
        statusEl: app.$('#queue-status'),
        onOpen: openQueuedResult,
        onLoadWorkflow: loadQueuedWorkflow,
        onSendToCompare: sendQueueSessionToCompare,
        activity: getActivity(),
        getFormWorkflow: app.getWorkflowWithPasswords,
        onWatch: (item, session) => app.queueRunWatch.watchQueuedRun(item, session),
        onRunningChange: (isRunning) => {
            setQueueTabSpinner(isRunning);
            queueBusy = isRunning;
            app.refreshRunButton();
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
            app.setReportPayload(payload, {fileName: item.file});
            app.tabsmode?.setActive('report');
            const message = `Loaded “${item.name}” from the queue.`;
            app.setStatusReport(message, STATUS.OK);
            app.focusReportArea();
            await app.whenResultsComplete();
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
            if (!app.cfgIO) throw new Error('the workflow editor is not ready yet');
            const problem = app.cfgIO.applyConfig(entry.config, app.afterConfigLoaded);
            if (problem) throw new Error(problem);
            app.afterConfigLoaded();
            // A batch run's vars live in its run spec, not in the form: put its
            // row back in the Batch section so running it again keeps them.
            const isRow = Number.isInteger(entry.row) || (entry.vars && Object.keys(entry.vars).length);
            if (isRow && app.batchPanel) {
                app.batchPanel.loadRows([{name: item.name, url: item.url, ...(entry.vars ? {vars: entry.vars} : {})}], {namePattern: ''});
                // Its row opened the Batch section; the config says how it was.
                app.setSectionsState(entry.config.sections);
            }
            app.tabsmode?.setActive('run');
            const notes = app.cfgIO.takeLoadNotes();
            app.setStatusRun((isRow
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
        if (!app.compareTab.comparisonController) return;
        if (app.compareTab.refuseWhileCompareLoads((message) => queuePanel?.setStatus(message, 'error'))) return;
        // Reading a batch's results takes a while: the activity panel lists
        // each, the Compare status says how it ended (quiet).
        await app.compareTab.runCompareLoad(`Send ${session.name ? `“${session.name}”` : 'the batch'} to Compare`,
            (task) => sendQueueSessionToCompareAs(session, task));
    }

    /**
     * Every run of a batch: GET /queue gives each in summary, its runs come
     * from its itemsUrl a page at a time. A batch given with its runs has them.
     */
    async function allQueuedItems(session) {
        if (!session.itemsUrl) return session.items || [];
        const out = [];
        for (let offset = 0; ; offset += 500) {
            const page = await fetchJson(`${session.itemsUrl}?offset=${offset}&limit=500`);
            out.push(...(page.items || []));
            if (!page.items || !page.items.length || out.length >= page.total) return out;
        }
    }

    async function sendQueueSessionToCompareAs(session, task) {
        const reading = task.step('Reading the batch’s runs');
        const withFiles = (await allQueuedItems(session)).filter((i) => i.fileUrl);
        reading.done();

        if (!await app.compareTab.replaceLoadedComparison(task, 'with this batch’s runs')) {
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
                const result = app.compareTab.comparisonController.addReport(await fetchQueuedResult(item), item.file, {draw: false});
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
            app.compareTab.comparisonController.arrange(keys);
            if (session.items.some((i) => Number.isInteger(i.row))) app.compareTab.comparisonController.setContext('versions');
        } else {
            app.compareTab.comparisonController.refresh();
        }

        // The comparison is the batch's now, so it goes by the batch's name;
        // a batch without one leaves it to the reports.
        const batchName = typeof session.name === 'string' ? session.name.trim() : '';
        if (batchName && keys.length) app.compareTab.comparisonController.setDocument({title: batchName});

        app.tabsmode?.setActive('compare');
        app.compareTab.renderCompareChips();
        const said = app.compareTab.describeCompareLoad({
            added: keys.length,
            failures,
            duplicates,
            lead: `${keys.length} run${keys.length === 1 ? '' : 's'} added from the queue`,
        });
        if (keys.length) task.done(said);
        else task.fail(said);
    }

    return {
        fetchJson,
        openQueuedResult,
        get queueBusy() { return queueBusy; },
        set queueBusy(value) { queueBusy = value; },
        get queuePanel() { return queuePanel; },
    };
}
