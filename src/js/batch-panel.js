'use strict';

/**
 * The Batch section of the run workflow tab: rows pasted (or loaded from a file)
 * as JSON and checked as they are typed with shared/batch-rows.js. While the
 * batch is enabled (the "Enable batch" / "Disable batch" button), the Run
 * button runs the batch - one queued run per row - and says so on its label.
 * The batch enables itself when rows arrive, and the rows stay in the box after
 * a run, to change one and run the batch again. An exported config always
 * carries the rows and whether the batch is enabled.
 *
 * The status line announces a one-line verdict; the list of problems under it
 * is not a live region, so a long list is read only when the user goes to it.
 */

const MAX_LISTED = 5;

function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the Run button should say for a batch status, or null for a plain Run.
 * Shared with the app so the label and the action never disagree.
 */
export function runLabelFor(status) {
    if (!status || !status.active) return null;
    if (status.state === 'ready') return `Run batch (${plural(status.runs.length, 'run')})`;
    if (status.state === 'invalid') return `Run batch (fix ${plural(status.problems.length, 'problem')})`;
    return 'Run batch (no workflows yet)';
}

/**
 * @param {object} opts
 * @param {() => { url: string, workflow: object }} opts.getWorkflow
 *        The form's starting URL and its actions and custom steps.
 * @param {(status) => void} opts.onChange
 *        Called whenever the batch status changes: { active, state, runs,
 *        problems, warnings, varNames }.
 */
export function createBatchPanel({
    toggle,
    content,
    badge,
    useButton,
    rowsInput,
    namePatternInput,
    fileButton,
    fileInput,
    checkEl,
    problemsEl,
    getWorkflow = () => ({ url: '', workflow: null }),
    onChange = () => {},
    batchApi = globalThis.A11Y_BATCH_ROWS,
    debounceMs = 250,
} = {}) {
    if (!rowsInput || !useButton) throw new Error('createBatchPanel: rowsInput and useButton are required');
    if (!batchApi) throw new Error('createBatchPanel: load shared/batch-rows.js first');
    const doc = rowsInput.ownerDocument;

    let status = { active: false, state: 'empty', runs: [], problems: [], warnings: [], varNames: [] };
    let timer = null;
    let hadRows = !!rowsInput.value.trim();
    let enabled = false;

    // The label names what a press does; the badge and status line say the
    // state, and rows kept while the batch is off are shown dimmed.
    function setEnabled(on) {
        enabled = !!on;
        useButton.textContent = enabled ? 'Disable batch' : 'Enable batch';
        showOff();
    }

    function showOff() {
        content?.classList.toggle('is-off', !enabled && !!rowsInput.value.trim());
    }
    setEnabled(false);

    function setExpanded(expanded) {
        if (!toggle || !content) return;
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        content.hidden = !expanded;
    }

    function setCheck(text, tone = '') {
        if (!checkEl) return;
        checkEl.textContent = text;
        checkEl.className = tone ? `status batch-check ${tone}` : 'status batch-check';
    }

    function listProblems(items, kind) {
        if (!problemsEl) return;
        problemsEl.replaceChildren();
        problemsEl.className = `batch-problems batch-problems--${kind}`;
        const shown = items.slice(0, MAX_LISTED);
        for (const text of shown) {
            const li = doc.createElement('li');
            li.textContent = text;
            problemsEl.append(li);
        }
        if (items.length > shown.length) {
            const li = doc.createElement('li');
            li.textContent = `…and ${plural(items.length - shown.length, 'more problem')}.`;
            problemsEl.append(li);
        }
        problemsEl.hidden = !shown.length;
    }

    function setBadge(text) {
        if (!badge) return;
        badge.hidden = !text;
        badge.textContent = text || '';
    }

    function publish(next) {
        status = { ...next, active: enabled };
        // "12 workflows" (or "12 workflows, off"), not a bare number: the badge is part
        // of the toggle's name.
        if (status.state === 'ready') {
            setBadge(status.active ? plural(status.runs.length, 'workflow') : `${plural(status.runs.length, 'workflow')}, off`);
        } else {
            setBadge('');
        }
        onChange(status);
        return status;
    }

    /** Re-reads the rows and shows the verdict. Returns the batch status. */
    function check() {
        clearTimeout(timer);
        timer = null;

        const parsed = batchApi.parseRows(rowsInput.value);
        if (!parsed.ok) {
            listProblems([], 'error');
            rowsInput.setAttribute('aria-invalid', parsed.empty ? 'false' : 'true');
            if (parsed.empty) {
                setCheck('');
                return publish({ state: 'empty', runs: [], problems: [], warnings: [], varNames: [] });
            }
            setCheck(parsed.error, 'error');
            return publish({ state: 'invalid', runs: [], problems: [parsed.error], warnings: [], varNames: [] });
        }

        const { url, workflow } = getWorkflow() || {};
        const result = batchApi.resolveBatch({
            rows: parsed.rows,
            namePattern: namePatternInput ? namePatternInput.value : '',
            workflowUrl: url || '',
            workflow,
        });
        // Names any row sets, for flagging steps that would hide them.
        const varNames = [...new Set(parsed.rows.flatMap((r) => (
            r && typeof r === 'object' && r.vars && typeof r.vars === 'object' && !Array.isArray(r.vars)
                ? Object.keys(r.vars)
                : []
        )))];

        if (!result.ok) {
            rowsInput.setAttribute('aria-invalid', 'true');
            setCheck(`${plural(result.errors.length, 'problem')} to fix before the batch can run.`, 'error');
            listProblems(result.errors, 'error');
            return publish({ state: 'invalid', runs: [], problems: result.errors, warnings: [], varNames });
        }

        rowsInput.setAttribute('aria-invalid', 'false');
        setCheck(enabled
            ? `${plural(result.runs.length, 'workflow')}, ready: Run will run the batch.`
            : `${plural(result.runs.length, 'workflow')}, ready. Enable the batch to run them.`, 'ok');
        listProblems(result.warnings, 'warning');
        return publish({ state: 'ready', runs: result.runs, problems: [], warnings: result.warnings, varNames });
    }

    function scheduleCheck() {
        clearTimeout(timer);
        timer = setTimeout(check, debounceMs);
    }

    /** Rows arriving in an empty box enable the batch. */
    function noticeRows() {
        const hasRows = !!rowsInput.value.trim();
        if (hasRows && !hadRows) setEnabled(true);
        hadRows = hasRows;
    }

    toggle?.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        setExpanded(!expanded);
    });

    useButton.addEventListener('click', () => {
        setEnabled(!enabled);
        check();
    });
    rowsInput.addEventListener('input', () => {
        noticeRows();
        showOff();
        scheduleCheck();
    });
    namePatternInput?.addEventListener('input', scheduleCheck);

    function fill(rowsText) {
        rowsInput.value = rowsText;
        hadRows = false;
        noticeRows();
        showOff();
        setExpanded(true);
        return check();
    }

    function clear() {
        rowsInput.value = '';
        if (namePatternInput) namePatternInput.value = '';
        hadRows = false;
        setEnabled(false);
        return check();
    }

    fileButton?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        try {
            fill(await file.text());
            rowsInput.focus();
        } catch (err) {
            setCheck(`Could not read ${file.name}: ${err && err.message ? err.message : err}`, 'error');
        }
    });

    return {
        check,
        setExpanded,
        getStatus: () => status,
        /** Opens the section and puts focus on the rows, to show their problems. */
        reveal() {
            setExpanded(true);
            rowsInput.focus();
        },
        /** After a batch has been queued. The rows stay. */
        noteQueued(count) {
            setCheck(`${plural(count, 'run')} added to the queue. The workflows stay here to change and run again.`, 'ok');
        },
        /** What an exported config carries: the rows, whenever there are any, and the on/off state. */
        getBatchForConfig() {
            const text = rowsInput.value.trim();
            if (!text) return null;
            const namePattern = namePatternInput ? namePatternInput.value.trim() : '';
            const parsed = batchApi.parseRows(text);
            // A draft that does not parse yet is kept as typed; rows that do are
            // saved as data, plus the text as typed when it is laid out
            // differently, so loading shows them as the user left them.
            const batch = parsed.ok ? { rows: parsed.rows } : { rowsText: text };
            if (parsed.ok && text !== JSON.stringify(parsed.rows, null, 2)) batch.rowsText = text;
            if (namePattern) batch.namePattern = namePattern;
            batch.enabled = enabled;
            return batch;
        },
        /**
         * Puts rows in the box (a rows file, or one run's row back from the
         * queue). The run name stays as it is unless a namePattern is given.
         */
        loadRows(rows, { namePattern } = {}) {
            if (namePatternInput && typeof namePattern === 'string') namePatternInput.value = namePattern;
            fill(JSON.stringify(rows, null, 2));
        },
        /**
         * Empties the box and the run name pattern and switches the batch off.
         * The section stays open or collapsed as it was.
         */
        clear,
        /**
         * Restores the rows from a loaded config, and whether the batch is
         * enabled (on, for a config saved before that was recorded). A config
         * without a batch empties the section: loading replaces the batch, it
         * does not add to it.
         */
        setBatchFromConfig(batch) {
            let text;
            if (batch && typeof batch === 'object') {
                if (typeof batch.rowsText === 'string') text = batch.rowsText;
                else if (Array.isArray(batch.rows)) text = JSON.stringify(batch.rows, null, 2);
            }
            if (text === undefined) return clear();
            if (namePatternInput) namePatternInput.value = typeof batch.namePattern === 'string' ? batch.namePattern : '';
            fill(text);
            if (batch.enabled === false) {
                setEnabled(false);
                return check();
            }
            return status;
        },
    };
}
