'use strict';

/**
 * Config IO for a11y-ui:
 * - Copy shareable link (url + state)
 * - Apply state (form fields + actions)
 * - Load/save config JSON (the workflow travels inside the config's state)
 * - Auto-apply state from query params
 */
import {describeUnusedStepKeys} from './actions-builder.module.js';

export function createConfigIO(deps) {
    if (!deps) throw new Error('createConfigIO: deps is required');

    const {
        // DOM
        form,
        urlInput,
        configFileEl,
        appendConfigFileEl,
        // APIs
        actionsBuilder,
        getCustomSteps,
        setCustomSteps,
        getRunSpec,
        getBatch,
        setBatch,
        getSections,
        setSections,
        loadBatchRows,
        appendConfigState,
        planBatchAppend,
        // helpers
        setStatusRun,
        STATUS,
        escapeHtml,
        safeBaseName,
        jsonBlob,
        saveBlobAsJSON,
        // The activity panel (activity.js), where reading a large zip shows.
        activity = null,
        // Fields a config saved before they existed has no value for: each
        // gets this one rather than keeping what the form held ({ id: value }).
        stateDefaults = {},
        // Called once a state is in the form, for what follows the values
        // (a field shown only for one choice).
        onStateApplied = null,
        // The languages the Language field lists, to open a run spec's there.
        getLanguages = null
    } = deps;

    if (!urlInput) throw new Error('createConfigIO: urlInput is required');
    if (!actionsBuilder) throw new Error('createConfigIO: actionsBuilder is required');
    if (typeof setStatusRun !== 'function') throw new Error('createConfigIO: setStatusRun is required');

    // Why the last state collected holds a workflow its builder found invalid,
    // or null: such a workflow is still saved, as it stands, and said so.
    let workflowProblem = null;

    // "Step 3 Navigate: URL is required", from the field the builder marked.
    function describeInvalidStep(el) {
        const wrapper = el && el.closest ? el.closest('.field, .action-array') : null;
        const err = wrapper
            ? (wrapper.classList.contains('action-array')
                ? wrapper.querySelector(':scope > .action-array__error')
                : wrapper.querySelector('.error, .action-array__error'))
            : null;
        const line = el && el.closest ? el.closest('.line') : null;
        const title = line ? (line.querySelector('.line-title')?.textContent || '').trim() : '';
        const message = err ? (err.textContent || '').trim() : '';
        return [title, message].filter(Boolean).join(': ') || 'a step has a field that is not valid';
    }

    function collectShareableState() {
        workflowProblem = null;
        if (!form) return {};
        const state = {};

        const fields = form.querySelectorAll('.config-data input, .config-data select, .config-data textarea');
        fields.forEach((el) => {
            if (!el.id) return;
            // Saved only on request (the batch rows), never as plain form state.
            if (el.closest('[data-config-exclude]')) return;
            const type = (el.type || '').toLowerCase();
            if (type === 'button' || type === 'submit' || type === 'reset') return;

            if (type === 'checkbox' || type === 'radio') {
                state[el.id] = el.checked;
                return;
            }

            const val = el.value;
            if (val != null && String(val).trim() !== '') {
                state[el.id] = val;
            }
        });

        // maskValues: 'redact' - a password (a secret field) is never written
        // to a config file or a shareable link; only the `<field>Masked` flag is.
        // Checked without revealing: the steps are saved open or collapsed as
        // the user left them, not as the check would leave them.
        let actionsValue = actionsBuilder.getValue({ maskValues: 'redact', markMasked: true, reveal: false });
        if (!actionsValue.ok) {
            // A config is the user's working copy: an invalid workflow is
            // saved as it stands rather than dropped, and the save says why.
            workflowProblem = describeInvalidStep(actionsValue.firstErrorEl);
            actionsValue = actionsBuilder.getValue({ validate: false, maskValues: 'redact', markMasked: true });
        }
        if (actionsValue.ok) {
            state['actions-workflow'] = actionsValue.value;
        }

        if (typeof getCustomSteps === 'function') {
            try {
                const result = getCustomSteps();
                if (result && result.ok && Array.isArray(result.value)) {
                    state['custom-steps-json'] = result.value.length ? JSON.stringify(result.value) : '';
                }
            } catch (e) {
                console.error('Failed to collect custom steps', e);
            }
        }

        return state;
    }

    // What the last config applied could not take in whole, for the message
    // that says it loaded (takeLoadNotes).
    let loadNotes = [];

    /** The notes on the config applied last, once: the loader says them. */
    function takeLoadNotes() {
        const notes = loadNotes;
        loadNotes = [];
        return notes;
    }

    /**
     * The steps the builder left out because it does not have them, as a
     * note, or null. Numbered by their place in the file ("3.2" is the second
     * step nested in the third), since that is where they have to be fixed.
     */
    function droppedStepsNote(result) {
        const dropped = (result && Array.isArray(result.errors) ? result.errors : [])
            .filter((e) => e && e.indexPath);
        if (!dropped.length) return null;
        const list = dropped.map((e) => `"${e.type ?? '(no type)'}" (step ${e.indexPath} in the file)`).join(', ');
        return `It has ${dropped.length === 1 ? 'a step' : 'steps'} the app does not have, left out: ${list}. Saving now would drop ${dropped.length === 1 ? 'it' : 'them'} for good.`;
    }

    // Steps listed in a note before the rest are left to the console: a note
    // is read in the status line, and a long one is not read.
    const UNUSED_SHOWN = 6;

    /**
     * What steps held that the editor does not use (unusedStepKeys), as a
     * note, or null: "Step 8 (Switch): 'actions' was not used, so 6 nested
     * steps were left out". `lists` is [{unused, where}], the workflow's and
     * each custom step's.
     */
    function unusedKeysNote(lists) {
        const lines = lists.flatMap(({unused, where}) => describeUnusedStepKeys(unused, where));
        if (!lines.length) return null;
        if (lines.length > UNUSED_SHOWN) console.info('Not used from the file:\n' + lines.join('\n'));
        const shown = lines.slice(0, UNUSED_SHOWN).join('. ')
            + (lines.length > UNUSED_SHOWN ? `. And ${lines.length - UNUSED_SHOWN} more steps (listed in the console)` : '');
        return `Some of what its steps hold is not something the app knows, and was left out: ${shown}. Saving now would drop it for good.`;
    }

    /** The custom steps of a config's state, as saved, or [] when they cannot be read. */
    function savedCustomSteps(raw) {
        try {
            const parsed = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : []) : raw;
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([id, v]) => ({id, ...(v || {})}));
        } catch {
            // Said where the custom steps are read.
        }
        return [];
    }

    function applyShareableState(state) {
        if (!state || typeof state !== 'object') return;

        Object.keys(stateDefaults).forEach((id) => {
            if (Object.prototype.hasOwnProperty.call(state, id)) return;
            const el = document.getElementById(id);
            if (el) el.value = String(stateDefaults[id]);
        });

        Object.keys(state).forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;

            const type = (el.type || '').toLowerCase();
            const stored = state[id];

            if (type === 'checkbox' || type === 'radio') {
                el.checked = !!stored;
            } else {
                el.value = String(stored);
            }
        });

        if (typeof setCustomSteps === 'function') {
            const raw = state['custom-steps-json'] || state['custom-steps-definitions'] || '';
            setCustomSteps(raw);
        }

        const unused = [];
        if (state['actions-workflow']) {
            const result = actionsBuilder.loadActions(state['actions-workflow'], {});
            const note = droppedStepsNote(result);
            if (note) loadNotes.push(note);
            if (result && Array.isArray(result.unused)) unused.push({unused: result.unused, where: 'Step'});
            // A required field the config left empty shows as one at once.
            actionsBuilder.showFieldErrors?.();
        }
        if (typeof actionsBuilder.unusedKeys === 'function') {
            const raw = state['custom-steps-json'] || state['custom-steps-definitions'] || '';
            savedCustomSteps(raw).forEach((step) => {
                if (!step || !Array.isArray(step.actions)) return;
                unused.push({unused: actionsBuilder.unusedKeys(step.actions), where: `Custom step “${step.name || step.id}”, step`});
            });
        }
        const unusedNote = unusedKeysNote(unused);
        if (unusedNote) loadNotes.push(unusedNote);

        if (typeof onStateApplied === 'function') onStateApplied();
    }

    function autoApplyFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const targetUrl = params.get('url');
        const stateParam = params.get('state');

        if (stateParam) {
            try {
                // A link made before the format changed is brought up to date
                // as a saved config is (its run's selectors onto its scans).
                const stateObj = JSON.parse(stateParam);
                const {doc} = upgradeSaved({version: 1, type: globalThis.A11Y_RUN_SPEC?.UI_CONFIG_TYPE, state: stateObj});
                applyShareableState(doc && doc.state ? doc.state : stateObj);
            } catch (e) {
                console.error('Failed to parse state param', e);
            }
        }

        if (targetUrl) urlInput.value = targetUrl;
    }

    /**
     * Applies a saved config object to the form: its URL and its state, in the
     * current format whatever format it was saved in. Returns
     * an error message, or null once applied. Shared by the file loader and the
     * queue, which keeps each workflow's config in batch.json.
     */
    function applyConfig(saved, callback = () => {}) {
        if (!saved || typeof saved !== 'object') return 'Config JSON is not a valid object.';
        if (!saved.state || typeof saved.state !== 'object') return 'Config JSON must contain a "state" object.';

        // One saved in the older format (from a file, or kept by the queue)
        // is brought up to date before the form and the workflow get it.
        const {doc: cfg, note} = upgradeSaved(saved);
        const state = cfg.state;
        loadNotes = note ? [note] : [];

        if (cfg.url && typeof cfg.url === 'string') {
            urlInput.value = cfg.url;
        } else if (state['url-input']) {
            urlInput.value = String(state['url-input']);
        }

        applyShareableState(state, callback);
        // Loading replaces the batch too: one saved without a batch empties
        // the section rather than leaving the previous rows in place.
        if (typeof setBatch === 'function') setBatch(cfg.batch || null);
        // Last, so the sections end as they were saved whatever opened them
        // on the way (rows in the batch, for one).
        if (cfg.sections && typeof setSections === 'function') setSections(cfg.sections);
        return null;
    }

    /**
     * A configuration or run spec saved in the older format, brought up to
     * the current one (src/shared/config-upgrade.js), and a note saying so,
     * or null when it was current. -> { doc, note }. Export config then saves
     * it in the current format.
     */
    function upgradeSaved(doc) {
        const upgrade = globalThis.A11Y_CONFIG_UPGRADE;
        if (!upgrade || !doc || typeof doc !== 'object') return {doc, note: null};
        const {kind, doc: out, changes, notes} = upgrade.convertDocument(doc);
        if (!kind || (!changes.length && !notes.length)) return {doc, note: null};
        if (changes.length) console.info('Brought up to the current format:\n' + changes.join('\n'));
        const shown = changes.slice(0, 3).join('; ') + (changes.length > 3 ? `; and ${changes.length - 3} more (listed in the console)` : '');
        const parts = [];
        if (changes.length) {
            parts.push(`It was saved in the older format and is now brought up to date, ${changes.length} change${changes.length === 1 ? '' : 's'}: ${shown}. Export config saves it in the current format.`);
        }
        for (const n of notes) parts.push(`Note: ${n}.`);
        return {doc: out, note: parts.join(' ')};
    }

    /**
     * A run spec (docs/scheduled-scans-guide.md) as a configuration the form
     * can take, with what the form has no place for as notes, and its vars
     * as a Batch row. -> { config, rows, notes }
     */
    function configFromRunSpec(spec) {
        const specTools = globalThis.A11Y_RUN_SPEC;
        const {config, batchRows, notes} = specTools.uiConfigFromRunSpec(spec, {
            viewportPresets: globalThis.A11Y_SCAN_INPUTS?.VIEWPORT_PRESETS || {},
            languages: typeof getLanguages === 'function' ? getLanguages() : null,
        });
        return {config, rows: batchRows, notes, fromSpec: true};
    }

    /**
     * The configuration a picked file holds: a configuration itself, a run
     * spec, a report that carries the one it ran (docs/report-package.md), or
     * a zip of them - a report's package, or a batch's, whose configuration
     * is beside its results or, for one saved before, rebuilt from
     * batch.json. `{ config }` (with `rows` and `notes` for a run spec),
     * `{ rows }` for a batch rows file, or `{ problem }`.
     */
    async function configFromFile(file) {
        const batchConfig = globalThis.A11Y_BATCH_CONFIG;
        const fromJson = (parsed) => {
            if (Array.isArray(parsed)) return {rows: parsed};
            if (globalThis.A11Y_RUN_SPEC?.isRunSpec(parsed)) {
                const {doc, note} = upgradeSaved(parsed);
                const fromSpec = configFromRunSpec(doc);
                return note ? {...fromSpec, notes: [note, ...(fromSpec.notes || [])]} : fromSpec;
            }
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.scans)) {
                return parsed.config && typeof parsed.config === 'object'
                    ? {config: parsed.config, fromReport: true}
                    : {problem: 'That report does not carry the configuration it ran: it was saved before reports kept it.'};
            }
            return {config: parsed};
        };

        if (/\.zip$/i.test(file.name || '') || /zip/i.test(file.type || '')) {
            if (typeof globalThis.JSZip !== 'function') return {problem: 'Zips cannot be read here.'};
            let zip;
            try {
                zip = await globalThis.JSZip.loadAsync(file);
            } catch {
                return {problem: 'That zip could not be read.'};
            }
            const entries = Object.values(zip.files).filter((e) => !e.dir && !e.name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'));
            const configs = entries.filter((e) => /\.a11y-config\.json$/i.test(e.name));
            // The batch's, at the top of its zip, before any other.
            configs.sort((a, b) => a.name.split('/').length - b.name.split('/').length);
            if (configs.length) return {config: JSON.parse(await configs[0].async('string'))};
            const manifest = entries.find((e) => e.name === 'batch.json');
            if (manifest && batchConfig) {
                const rebuilt = batchConfig.configForBatch(JSON.parse(await manifest.async('string')));
                if (rebuilt) return {config: rebuilt};
            }
            for (const entry of entries.filter((e) => /\.json$/i.test(e.name) && e.name !== 'batch.json' && e.name !== 'comparison.json')) {
                const found = fromJson(JSON.parse(await entry.async('string')));
                if (found.config) return found;
            }
            return {problem: 'That zip holds no configuration.'};
        }
        return fromJson(JSON.parse(await file.text()));
    }

    function setupConfigLoader(callback = () => {}) {
        if (!configFileEl) return;

        configFileEl.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            configFileEl.value = '';
            if (!file) return;

            // A zip can take a while to read: the activity panel shows it, its
            // end said by the status line below (quiet).
            const task = activity ? activity.start(`Load configuration from ${file.name}`, {quiet: true}) : null;
            const say = (message, tone) => {
                setStatusRun(message, tone);
                if (!task) return;
                if (tone === STATUS.ERROR) task.fail(message);
                else task.done(message);
            };

            let found;
            task?.step(`Reading ${file.name}`);
            try {
                found = await configFromFile(file);
            } catch (err) {
                console.error('Could not parse config JSON file', err);
                say('Could not parse config JSON file.', STATUS.ERROR);
                return;
            }

            // A bare list is a batch rows file, opened here by mistake:
            // hand it to the Batch section and leave the workflow alone.
            if (found.rows && !found.config) {
                if (typeof loadBatchRows === 'function') {
                    loadBatchRows(found.rows);
                    say('That file is a list of batch workflows, not a configuration. Its workflows are now in the Batch section; the workflow is unchanged.', STATUS.OK);
                } else {
                    task?.done();
                }
                return;
            }
            if (found.problem) {
                say(found.problem, STATUS.ERROR);
                return;
            }

            task?.step('Setting up the workflow');
            const problem = applyConfig(found.config, callback);
            if (problem) {
                say(problem, STATUS.ERROR);
                return;
            }
            // A run spec's starting variables live in a Batch row in the app.
            if (found.rows && typeof loadBatchRows === 'function') loadBatchRows(found.rows);
            const notes = [...takeLoadNotes(), ...(found.notes || [])];
            const hidden = JSON.stringify(found.config).includes('Masked":true');
            const loaded = found.fromSpec ? 'Run spec loaded from file. '
                : found.fromReport ? 'Configuration loaded from the report. ' : 'Configuration loaded from file. ';
            say(loaded
                + (found.rows && found.fromSpec ? 'Its variables are in the Batch section. ' : '')
                + (notes.length ? notes.join(' ') + ' ' : '')
                + (hidden ? 'Type its hidden values again, such as passwords: they are never saved. ' : '')
                + 'Review the parameters and run the scan when ready.',
                // Something did not come in whole: worth reading, not just a confirmation.
                notes.length && STATUS.WARNING ? STATUS.WARNING : STATUS.OK);
            callback();
        });
    }

    function setupConfigAppender(callback = () => {}) {
        if (!appendConfigFileEl) return;
        if (typeof appendConfigState !== 'function') return;

        appendConfigFileEl.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const {doc: parsed, note} = upgradeSaved(JSON.parse(String(reader.result || '')));

                    if (!parsed || typeof parsed !== 'object') {
                        setStatusRun('Config JSON is not a valid object.', STATUS.ERROR);
                        return;
                    }

                    if (!parsed.state || typeof parsed.state !== 'object') {
                        setStatusRun('Config JSON must contain a "state" object.', STATUS.ERROR);
                        return;
                    }

                    // Append adds the custom steps, the workflow steps and the
                    // batch rows; scalar fields (url, viewport, engines, …) are
                    // intentionally ignored so the current configuration's
                    // settings are preserved. The batch is checked first, so a
                    // file whose rows cannot be added changes nothing.
                    const batchPlan = typeof planBatchAppend === 'function' ? planBatchAppend(parsed.batch) : null;
                    if (batchPlan && !batchPlan.ok) {
                        setStatusRun('Could not append config. ' + batchPlan.message, STATUS.ERROR);
                        return;
                    }
                    const batchCount = batchPlan ? batchPlan.count : 0;
                    const result = appendConfigState(parsed.state, {allowNothing: batchCount > 0}) || {ok: false, message: 'Could not append config.'};
                    if (result.ok && batchCount) batchPlan.apply();
                    const batchMessage = batchCount ? `Appended ${batchCount} batch workflow${batchCount === 1 ? '' : 's'}.` : '';
                    // A step-less file says only what it added to the batch.
                    const stepsMessage = result.added === 0 ? '' : result.message;
                    const message = result.ok
                        ? [stepsMessage, batchMessage].filter(Boolean).join(' ') || 'Config appended.'
                        : (result.message || 'Could not append config.');
                    setStatusRun(
                        message + (result.ok && note ? ' ' + note : ''),
                        result.ok ? (note ? STATUS.WARNING || STATUS.OK : STATUS.OK) : STATUS.ERROR
                    );
                    if (result.ok) callback();
                } catch (err) {
                    console.error('Could not parse config JSON file', err);
                    setStatusRun('Could not parse config JSON file.', STATUS.ERROR);
                } finally {
                    appendConfigFileEl.value = '';
                }
            };

            reader.onerror = () => {
                console.error('Could not read config file', reader.error);
                setStatusRun('Could not read config file.', STATUS.ERROR);
            };

            reader.readAsText(file);
            appendConfigFileEl.value = '';
        });
    }

    /**
     * The saved file carries both the form state, which restores the UI, and
     * the run spec, which is what a headless run needs; plus the batch rows when
     * there are any. `includeBatch: false` leaves them
     * out regardless: the queue stores one config per run, and each is one row.
     */
    function buildConfigFile({ includeBatch = true } = {}) {
        const urlValue = urlInput?.value?.trim() || '';

        const config = {
            version: 1,
            type: 'a11y-ui-src-config',
            url: urlValue || null,
            state: collectShareableState() || {},
            metadata: { createdAt: new Date().toISOString() }
        };

        if (typeof getRunSpec === 'function') {
            let runSpec = null;
            try {
                runSpec = getRunSpec();
            } catch (err) {
                console.error('Could not build the run spec for this config', err);
            }
            if (runSpec) config.runSpec = runSpec;
        }

        // Batch, Custom steps and Workflow, open or collapsed.
        if (typeof getSections === 'function') {
            const sections = getSections();
            if (sections) config.sections = sections;
        }

        if (includeBatch && typeof getBatch === 'function') {
            const batch = getBatch();
            if (batch) config.batch = batch;
        }

        return config;
    }

    function setupConfigSaver(saveButtonEl) {
        if (!saveButtonEl) return;

        saveButtonEl.addEventListener('click', async () => {
            try {
                const config = buildConfigFile();
                const urlValue = config.url || '';
                const scenarioName = typeof config.state?.['scenario-name'] === 'string'
                    ? config.state['scenario-name'].trim()
                    : '';

                const problem = workflowProblem;
                await saveBlobAsJSON(jsonBlob(config), {
                    // The scenario name is what the user already calls this
                    // configuration, so it is the file name they expect to be
                    // offered. Unnamed scenarios keep falling back to the URL.
                    suggestedBase: scenarioName || urlValue || 'a11y-ui-src-config',
                    fileDesc: 'a11y-ui-src configuration',
                    kind: 'a11y-config',
                    promptMsg: 'File name for this configuration (without extension).',
                    okMsg: problem
                        ? `Configuration saved, but its workflow has an error to fix before it can run (${problem}). The workflow was saved as it stands.`
                        : 'Configuration saved successfully.',
                    okStatus: problem ? STATUS.WARNING : STATUS.OK,
                    callback: setStatusRun
                });
            } catch (err) {
                console.error('Could not export config file', err);
                setStatusRun('Could not export config file.', STATUS.ERROR);
            }
        });
    }

    return {
        collectShareableState,
        buildConfigFile,
        applyShareableState,
        applyConfig,
        takeLoadNotes,
        autoApplyFromQuery,
        setupConfigLoader,
        setupConfigAppender,
        setupConfigSaver
    };
}
