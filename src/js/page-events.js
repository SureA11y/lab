// The page's own events: the run and dry-run buttons, cancelling, the keys
// the app answers to. Moved out of a11y-ui.js; what it shares with the rest of
// the app it reaches through `app`.

import {createSplitButton} from './a11y-ui.utils.js';
import {watchForMissingPictures} from './missing-pictures.js';
import {afterPaint} from './busy.js';
import {openLazyDialog} from './lazy-dialogs.js';
import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (appendConfigFileEl, cancelButton, configFileEl, configFileSplitBtnSlot, currentRunId, dryRunButton, form, loadAndRun, onDryRun, onRunScan, scanButton, setStatusRun, setUiState, urlInput).
 */
export function createPageEvents(app) {
    app.dryRunButton?.addEventListener('click', (event) => {
        if (event.currentTarget.getAttribute('aria-disabled') === 'true') return;
        app.onDryRun().catch((e) => console.error('Dry run failed', e));
    });

    app.scanButton?.addEventListener('click', (event) => {
        if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            // Disabled but focusable: say why when it says so.
            const why = event.currentTarget.dataset.blockedReason;
            if (why) app.setStatusRun(why, STATUS.ERROR);
            return;
        }
        app.onRunScan(event).then(() => {
        });
    });

    // Only the URL field should trigger a run on Enter (implicit submission).
    // Without this, pressing Enter in any other text input/select nested in
    // the Workflow or Custom Steps panels (which live inside the same <form>)
    // accidentally submits the whole scan form. Textareas are left alone:
    // Enter there just inserts a newline and never submits the form natively.
    app.form?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.target === app.urlInput) return;
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

    app.cancelButton?.addEventListener('click', async (event) => {
        if (!app.currentRunId || event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            return;
        }
        try {
            app.cancelButton.setAttribute('aria-disabled', 'true');
            app.setUiState('cancelling', 'Cancellation requested...');
            await fetch('/workflow-cancel', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({runId: app.currentRunId})
            });
        } catch {
            app.setUiState('error', 'Could not send cancellation request.');
            app.cancelButton.setAttribute('aria-disabled', 'false');
        }
    });

    if (app.configFileSplitBtnSlot && app.configFileEl) {
        const configFileSplitBtn = createSplitButton({
            label: 'Load config',
            menuLabel: 'Other load options',
            onAction: () => {
                app.loadAndRun = false;
                app.configFileEl.click();
            },
            items: [
                {
                    id: 'run',
                    label: 'Load and run',
                    description: 'Load the file and start the scan immediately',
                    onSelect: () => {
                        app.loadAndRun = true;
                        app.configFileEl.click();
                    }
                },
                {
                    id: 'append',
                    label: 'Append config',
                    description: 'Add another config’s custom steps and workflow to the current one',
                    onSelect: () => {
                        if (app.appendConfigFileEl) app.appendConfigFileEl.click();
                    }
                }
            ]
        });
        configFileSplitBtn.querySelector('.split-button__action')?.setAttribute('aria-controls', 'config-file');
        app.configFileSplitBtnSlot.replaceWith(configFileSplitBtn);
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

    return {

    };
}
