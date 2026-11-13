// Watching a queued run: a dialog over the queue with the run's own live
// view (totals with step progress, live preview, log), fed from
// /queue/items/:id/progress. Moved out of a11y-ui.js; what it shares with the
// rest of the app it reaches through `app`.

import {createEl, escapeAttr, escapeHtml, indentPrefix, linkifyUrlsToHtml, parseForEachIteration, parseRepeatIteration} from './a11y-ui.utils.js';
import {pollWorkflowUntilDone} from './a11y-ui.workflow.js';
import {createRunDialog} from './run-dialog.js';
import {createLiveView} from './live-view.js';
import {createLogFollow} from './log-follow.js';
import {describeRunNow} from './run-queue-panel.js';
import {PROGRESS_POLL_INTERVAL_MS, STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (fetchJson, openQueuedResult, queuePanel).
 */
export function createQueueRunWatch(app) {
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
            returnFocus: () => app.queuePanel?.focusControl(`watch:${item.id}`),
        });
        dialog.setStatus('Running', '', {busy: true});

        const parts = buildWatchView(item.id);
        parts.showNow(item);
        dialog.body.append(parts.root);
        // Follow the log only while the user is at its end (see log-follow.js:
        // opening a run of hundreds of scans replays thousands of lines at once).
        const logEl = parts.logEl;
        const follow = createLogFollow(logEl);
        view = createLiveView({
            totalsMount: parts.totalsMount,
            streamEl: parts.streamEl,
            gridEl: parts.gridEl,
            logEl,
            idPrefix: `watch-${item.id}`,
            onLog: () => follow.lineAdded(),
            helpers: {escapeHtml, escapeAttr, linkifyUrlsToHtml, indentPrefix, parseForEachIteration, parseRepeatIteration},
        });

        // The run's own workflow, for the step counter and the live cards.
        let actions = [];
        let customSteps = [];
        try {
            const manifest = await app.fetchJson(session.manifestUrl);
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
                    app.openQueuedResult({fileUrl, file: last?.file || null, name: item.name});
                },
            }]);
        }
    }

    return {
        watchQueuedRun,
    };
}
