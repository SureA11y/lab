// The Custom steps section: the list of custom steps as tabs, the editor of
// the one selected, copying, pasting and removing them, and keeping them in
// the form and in a saved configuration. Moved out of a11y-ui.js; what it
// shares with the rest of the app it reaches through `app`.

import {createActionsBuilder, redactMaskedFieldsDeep, withPasswordStepTypeDeep} from './actions-builder.module.js';
import {createEl} from './a11y-ui.utils.js';
import {cloneCustomStepValue, collectUsedCustomStepIds, deepRemapCustomStepIds, makeUniqueImportedId, normalizeCustomStepInputs, normalizeCustomStepSlots, parseCustomStepsJson, slotsOf} from './custom-steps-data.js';
import {createInputsTable} from './custom-step-inputs-table.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (actionsBuilder, copiedCustomStep, createCustomStepActionsHistoryButtons, createCustomStepsListHistoryButtons, customStepActionsBuilder, customStepActionsBuilderEl, customStepActionsEl, customStepAddBtn, customStepCopyBtn, customStepDeleteBtn, customStepIdInput, customStepInputsHost, customStepNameInput, customStepsChooserEl, customStepPasteBtn, customStepToolbarEl, customStepsCountBadgeEl, customStepsData, customStepsInput, customStepsPanelEl, onCustomStepsListChanged, pushCustomStepsHistory, resetCustomStepsHistory, rulesCatalog, scheduleCustomStepsHistoryPush, selectedCustomStepIndex, setCustomStepActionsHistoryBaselineToCurrent, setCustomStepsExpanded, setUiState, syncingCustomStepEditor).
 */
export function createCustomStepsUi(app) {
    // The open custom step's inputs, as a table (custom-step-inputs-table.js),
    // made when the section is set up.
    let inputsTable = null;
    // Its places for steps from the call, a table of the same kind.
    let slotsTable = null;

    function getCustomStepSelectChoices() {
        const out = [{ value: '', label: 'Select custom step...' }];
        app.customStepsData.forEach((step) => {
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

    /** The places of the custom step open in the editor, as a Slot step offers them. */
    function getSlotSelectChoices() {
        const selected = app.customStepsData[app.selectedCustomStepIndex];
        return normalizeCustomStepSlots(selected && selected.slots)
            .map((slot) => ({value: slot.name, label: slot.label ? `${slot.label} (${slot.name})` : slot.name}));
    }

    /**
     * The Slot steps of the open custom step offer its places as they are
     * now; one naming a place it no longer has keeps it, marked missing, so
     * its check says so.
     */
    function refreshSlotStepSelectors() {
        const root = app.customStepActionsEl;
        if (!root) return;
        const choices = getSlotSelectChoices();
        const known = new Set(choices.map((c) => c.value));
        root.querySelectorAll('.line[data-action-type="slot"] > .fields > .field[data-field-name="slot"]').forEach((field) => {
            const sel = field.querySelector('select');
            if (!sel) return;
            const previous = String(sel.value || '');
            sel.textContent = '';
            sel.append(Object.assign(document.createElement('option'), {value: '', disabled: true, textContent: 'Choose…'}));
            choices.forEach((c) => sel.append(Object.assign(document.createElement('option'), {value: c.value, textContent: c.label})));
            if (previous && !known.has(previous)) {
                sel.append(Object.assign(document.createElement('option'), {value: previous, textContent: `${previous} (missing)`}));
            }
            sel.value = previous;
            field.dataset.enum = JSON.stringify(choices.map((c) => c.value));
        });
    }

    function getCustomStepUsageInfo(stepId, excludeCustomStepIndex = -1) {
        const id = String(stepId || '').trim();
        if (!id) return { inWorkflow: false, usedByCustomSteps: [] };

        const workflowUsed = new Set();
        const currentWorkflow = app.actionsBuilder?.getValue({ validate: false, maskValues: 'text' });
        collectUsedCustomStepIds(currentWorkflow?.value || [], workflowUsed);

        const usedByCustomSteps = [];
        app.customStepsData.forEach((step, idx) => {
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
    function appendConfigState(state, {allowNothing = false} = {}) {
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
            // The caller adds something else from the file (its batch rows).
            if (allowNothing) return {ok: true, message: '', added: 0};
            return {ok: false, message: 'This config has no custom steps or workflow steps to append.'};
        }

        // Flush any in-progress edits in the custom-step editor into customStepsData
        // so the merge sees the true current set.
        if (app.customStepActionsBuilder) {
            const persisted = persistSelectedCustomStepActions({validate: false});
            if (!persisted.ok) {
                return {ok: false, message: 'Resolve the current custom step errors before appending.'};
            }
        }

        const taken = new Set(
            app.customStepsData.map((s) => String(s.id || '').trim()).filter(Boolean)
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
            ...slotsOf(step),
            actions: deepRemapCustomStepIds(step.actions, remap)
        }));
        const remappedWorkflow = deepRemapCustomStepIds(importedWorkflow, remap);

        if (addedSteps.length) {
            app.customStepsData = app.customStepsData.concat(addedSteps);
        }

        let workflowAppended = 0;
        if (remappedWorkflow.length && app.actionsBuilder && typeof app.actionsBuilder.appendActions === 'function') {
            const res = app.actionsBuilder.appendActions(remappedWorkflow, {focusFirst: false});
            workflowAppended = (res && Array.isArray(res.added)) ? res.added.length : 0;
        }

        // Refresh the custom-steps panel + selectors and record one undo entry.
        if (addedSteps.length) {
            app.setCustomStepsExpanded(true);
            selectCustomStep(app.customStepsData.length - 1);
            app.pushCustomStepsHistory();
        }
        refreshRunCustomStepSelectors();

        const parts = [];
        if (workflowAppended) parts.push(`${workflowAppended} workflow step${workflowAppended === 1 ? '' : 's'}`);
        if (addedSteps.length) parts.push(`${addedSteps.length} custom step${addedSteps.length === 1 ? '' : 's'}`);

        let message = parts.length ? `Appended ${parts.join(' and ')}.` : 'Nothing new to append.';
        if (renamedCount) {
            message += ` (${renamedCount} custom step${renamedCount === 1 ? '' : 's'} renamed to avoid id conflicts.)`;
        }

        return {ok: true, message, added: workflowAppended + addedSteps.length};
    }

    function syncCustomStepsHiddenInput() {
        if (app.customStepsInput) {
            app.customStepsInput.value = app.customStepsData.length ? JSON.stringify(app.customStepsData) : '';
        }
        syncCustomStepsCountBadge();
    }

    function syncCustomStepsCountBadge() {
        if (!app.customStepsCountBadgeEl) return;
        const count = Array.isArray(app.customStepsData) ? app.customStepsData.length : 0;
        if (!count) {
            app.customStepsCountBadgeEl.hidden = true;
            app.customStepsCountBadgeEl.textContent = '0';
            app.customStepsCountBadgeEl.setAttribute('aria-label', 'No custom steps defined');
            app.customStepsCountBadgeEl.title = 'No custom steps defined';
            return;
        }
        const label = `${count} custom step${count === 1 ? '' : 's'} defined`;
        app.customStepsCountBadgeEl.hidden = false;
        app.customStepsCountBadgeEl.textContent = String(count);
        app.customStepsCountBadgeEl.setAttribute('aria-label', label);
        app.customStepsCountBadgeEl.title = label;
    }

    function setCustomStepEditorEnabled(enabled) {
        const controls = [
            app.customStepIdInput,
            app.customStepNameInput,
            app.customStepCopyBtn,
            app.customStepDeleteBtn
        ];
        controls.forEach((el) => {
            if (!el) return;
            el.disabled = !enabled;
        });
        inputsTable?.setDisabled(!enabled);
        slotsTable?.setDisabled(!enabled);
        if (app.customStepActionsBuilderEl) {
            app.customStepActionsBuilderEl.classList.toggle('is-disabled', !enabled);
            app.customStepActionsBuilderEl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
            // With no custom step chosen, its steps and toolbar take neither a
            // click nor focus: a step added then would belong to none.
            for (const id of ['custom-step-toolbar', 'custom-step-actions-container']) {
                const part = app.customStepActionsBuilderEl.querySelector('#' + id);
                if (part) part.inert = !enabled;
            }
        }
    }

    function syncCustomStepPasteButtonState() {
        if (!app.customStepPasteBtn) return;
        const hasClipboard = !!app.copiedCustomStep;
        app.customStepPasteBtn.disabled = !hasClipboard;
        app.customStepPasteBtn.setAttribute('aria-disabled', hasClipboard ? 'false' : 'true');
        app.customStepPasteBtn.title = hasClipboard ? 'Paste custom step' : 'Copy a custom step first';
    }

    function copyCustomStepAt(index) {
        if (index < 0 || index >= app.customStepsData.length) return;
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;
        app.copiedCustomStep = cloneCustomStepValue(app.customStepsData[index]);
        syncCustomStepPasteButtonState();
    }

    function makeUniqueCustomStepId(baseIdRaw) {
        const baseId = String(baseIdRaw || '').trim() || 'custom-step';
        const used = new Set(app.customStepsData.map((step) => String(step?.id || '').trim()).filter(Boolean));
        if (!used.has(baseId)) return baseId;

        let candidate = `${baseId}-copy`;
        if (!used.has(candidate)) return candidate;

        let n = 2;
        while (used.has(`${baseId}-copy-${n}`)) n += 1;
        return `${baseId}-copy-${n}`;
    }

    function pasteCopiedCustomStep() {
        if (!app.copiedCustomStep) return;
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;

        const nextId = makeUniqueCustomStepId(app.copiedCustomStep.id || 'custom-step');
        const sourceName = String(app.copiedCustomStep.name || app.copiedCustomStep.id || '').trim();
        const nextName = sourceName
            ? (sourceName.endsWith(' (copy)') ? sourceName : `${sourceName} (copy)`)
            : nextId;

        app.customStepsData.push({
            id: nextId,
            name: nextName,
            inputs: Array.isArray(app.copiedCustomStep.inputs) ? app.copiedCustomStep.inputs.map((i) => ({ ...i })) : [],
            ...slotsOf(app.copiedCustomStep),
            actions: Array.isArray(app.copiedCustomStep.actions) ? JSON.parse(JSON.stringify(app.copiedCustomStep.actions)) : []
        });
        app.setCustomStepsExpanded(true);
        selectCustomStep(app.customStepsData.length - 1);
        app.pushCustomStepsHistory();
    }

    // The custom steps are listed by the Custom steps panel (steps-panel.js),
    // which a11y-ui.js sets up: this labels the editor by the custom step open
    // in it and tells the panel to read the custom steps again.
    function renderCustomStepsList() {
        const selected = app.customStepsData[app.selectedCustomStepIndex];
        app.customStepsPanelEl?.setAttribute('aria-label', selected
            ? `Custom step: ${selected.name || selected.id}`
            : 'Custom step');
        renderCustomStepsChooser();
        syncCustomStepPasteButtonState();
        app.onCustomStepsListChanged?.();
    }

    // Above the editor, every custom step as a button, the one open in it
    // marked (aria-current): which one is being edited, and the way to
    // another, whatever the steps panel shows.
    let chooserDrawn = '';
    function renderCustomStepsChooser() {
        const host = app.customStepsChooserEl;
        if (!host) return;
        const names = app.customStepsData.map((step, i) => String(step?.name || step?.id || `Custom step ${i + 1}`));
        const want = JSON.stringify([names, app.selectedCustomStepIndex]);
        if (want === chooserDrawn) return;
        chooserDrawn = want;
        // Drawn again: focus goes back to the same custom step's button.
        const focused = host.contains(document.activeElement) ? Number(document.activeElement.dataset.index) : -1;
        host.textContent = '';
        host.hidden = names.length === 0;
        if (!names.length) return;
        const list = createEl('ul', {className: 'custom-steps-chooser__list'});
        names.forEach((name, i) => {
            const current = i === app.selectedCustomStepIndex;
            const btn = createEl('button', {
                type: 'button',
                className: `secondary-button custom-steps-chooser__item${current ? ' is-current' : ''}`,
                dataset: {index: String(i)}
            }, name);
            if (current) btn.setAttribute('aria-current', 'true');
            btn.addEventListener('click', () => {
                if (i !== app.selectedCustomStepIndex) selectCustomStep(i);
            });
            list.append(createEl('li', {}, btn));
        });
        host.append(createEl('span', {className: 'custom-steps-chooser__title', id: 'custom-steps-chooser-title'}, 'Custom step to edit:'), list);
        host.setAttribute('aria-labelledby', 'custom-steps-chooser-title');
        if (focused >= 0) host.querySelector(`[data-index="${focused}"]`)?.focus();
    }

    function removeCustomStepAt(index) {
        if (index < 0 || index >= app.customStepsData.length) return;
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;

        const toRemove = app.customStepsData[index];
        const removeId = String(toRemove?.id || '').trim();
        const usage = getCustomStepUsageInfo(removeId, index);
        if (usage.inWorkflow || usage.usedByCustomSteps.length) {
            const parts = [];
            if (usage.inWorkflow) parts.push('it is used in the current workflow');
            if (usage.usedByCustomSteps.length) parts.push(`it is referenced by custom step(s): ${usage.usedByCustomSteps.join(', ')}`);
            const msg = `Cannot delete custom step "${removeId}" because ${parts.join(' and ')}. Remove those references first.`;
            window.alert(msg);
            app.setUiState('error', msg);
            return;
        }

        app.customStepsData.splice(index, 1);
        if (!app.customStepsData.length) {
            app.selectedCustomStepIndex = -1;
        } else if (index === app.selectedCustomStepIndex) {
            app.selectedCustomStepIndex = Math.min(index, app.customStepsData.length - 1);
        } else if (index < app.selectedCustomStepIndex) {
            app.selectedCustomStepIndex -= 1;
        }
        renderCustomStepsList();
        loadSelectedCustomStepIntoEditor();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
        app.pushCustomStepsHistory();
    }

    function persistSelectedCustomStepActions({validate = false} = {}) {
        if (app.selectedCustomStepIndex < 0) return {ok: true};
        const selected = app.customStepsData[app.selectedCustomStepIndex];
        if (!selected || !app.customStepActionsBuilder) return {ok: true};
        // The value stays in memory so runs started from the app still work;
        // markMasked records which fields must be dropped when a config is saved.
        const result = app.customStepActionsBuilder.getValue({validate, maskValues: 'text', markMasked: true});
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
        const selected = app.customStepsData[app.selectedCustomStepIndex];
        app.syncingCustomStepEditor = true;
        try {
            if (!selected) {
                if (app.customStepIdInput) app.customStepIdInput.value = '';
                if (app.customStepNameInput) app.customStepNameInput.value = '';
                inputsTable?.setInputs([]);
                slotsTable?.setInputs([]);
                if (app.customStepActionsBuilder) app.customStepActionsBuilder.clear();
                setCustomStepEditorEnabled(false);
                return;
            }

            setCustomStepEditorEnabled(true);
            if (app.customStepIdInput) app.customStepIdInput.value = selected.id || '';
            if (app.customStepNameInput) app.customStepNameInput.value = selected.name || '';
            inputsTable?.setInputs(normalizeCustomStepInputs(selected.inputs));
            // Before its steps: a Slot step offers the places it has.
            slotsTable?.setInputs(normalizeCustomStepSlots(selected.slots));
            if (app.customStepActionsBuilder) {
                app.customStepActionsBuilder.loadActions(Array.isArray(selected.actions) ? selected.actions : [], {
                    clearFirst: true,
                    focusFirst: false,
                    injectDefaultWhenEmpty: false
                });
            }
        } finally {
            app.syncingCustomStepEditor = false;
            // A different step's (or no step's) actions are now loaded — undo
            // must not be able to reach across into whatever was here before.
            app.setCustomStepActionsHistoryBaselineToCurrent();
        }
    }

    function syncSelectedCustomStepMetaFromEditor() {
        if (app.syncingCustomStepEditor || app.selectedCustomStepIndex < 0) return;
        const selected = app.customStepsData[app.selectedCustomStepIndex];
        if (!selected) return;
        selected.id = String(app.customStepIdInput?.value || '').trim();
        selected.name = String(app.customStepNameInput?.value || '').trim() || selected.id;
        if (inputsTable) selected.inputs = inputsTable.getInputs();
        if (slotsTable) {
            const slots = slotsTable.getInputs();
            if (slots.length) selected.slots = slots;
            else delete selected.slots;
        }
        renderCustomStepsList();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
        refreshSlotStepSelectors();
        app.scheduleCustomStepsHistoryPush();
    }

    function selectCustomStep(index) {
        const persist = persistSelectedCustomStepActions({validate: false});
        if (!persist.ok) return;
        app.selectedCustomStepIndex = Number.isFinite(index) ? index : -1;
        renderCustomStepsList();
        loadSelectedCustomStepIntoEditor();
        syncCustomStepsHiddenInput();
    }

    function normalizeCustomStepsFromState(steps) {
        return steps.map((item, index) => ({
            id: String(item.id || `custom-step-${index + 1}`).trim() || `custom-step-${index + 1}`,
            name: String(item.name || '').trim() || String(item.id || `custom-step-${index + 1}`),
            inputs: normalizeCustomStepInputs(item.inputs),
            ...slotsOf(item),
            actions: Array.isArray(item.actions) ? withPasswordStepTypeDeep(item.actions) : []
        }));
    }

    function setCustomStepsInUi(steps, {selectFirst = true} = {}) {
        app.customStepsData = normalizeCustomStepsFromState(Array.isArray(steps) ? steps : []);
        app.selectedCustomStepIndex = app.customStepsData.length && selectFirst ? 0 : -1;
        renderCustomStepsList();
        loadSelectedCustomStepIntoEditor();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
        // Whole set just got replaced (initial load, or a new config loaded
        // over it) — undo shouldn't be able to reach past this baseline.
        app.resetCustomStepsHistory();
    }

    function initCustomStepsUi(defs) {
        if (app.customStepInputsHost && !inputsTable) {
            inputsTable = createInputsTable({host: app.customStepInputsHost, onChange: syncSelectedCustomStepMetaFromEditor});
        }
        if (app.customStepSlotsHost && !slotsTable) {
            slotsTable = createInputsTable({host: app.customStepSlotsHost, onChange: syncSelectedCustomStepMetaFromEditor, kind: 'slots'});
        }
        if (!app.customStepActionsEl || !app.customStepToolbarEl) return;
        if (!app.customStepActionsBuilder) {
            app.customStepActionsBuilder = createActionsBuilder({
                defs,
                toolbarEl: app.customStepToolbarEl,
                actionsEl: app.customStepActionsEl,
                options: {
                    openRulesCatalog: (options) => app.rulesCatalog.open(options),
                    useHorizontalStepper: false,
                    onPasswordsChange: () => app.onPasswordsChange?.(),
                    // A Slot step is only for a custom step's own steps.
                    inCustomStep: true
                }
            });
            app.createCustomStepActionsHistoryButtons();
            app.createCustomStepsListHistoryButtons();
        }

        if (app.customStepAddBtn) {
            app.customStepAddBtn.addEventListener('click', () => {
                const persist = persistSelectedCustomStepActions({validate: false});
                if (!persist.ok) return;
                const nextIndex = app.customStepsData.length + 1;
                app.customStepsData.push({
                    id: `custom-step-${nextIndex}`,
                    name: `Custom step ${nextIndex}`,
                    inputs: [],
                    actions: []
                });
                app.setCustomStepsExpanded(true);
                selectCustomStep(app.customStepsData.length - 1);
                app.pushCustomStepsHistory();
            });
        }

        if (app.customStepPasteBtn) {
            app.customStepPasteBtn.addEventListener('click', () => {
                pasteCopiedCustomStep();
            });
        }

        if (app.customStepCopyBtn) {
            app.customStepCopyBtn.addEventListener('click', () => {
                if (app.selectedCustomStepIndex >= 0) copyCustomStepAt(app.selectedCustomStepIndex);
            });
        }

        if (app.customStepDeleteBtn) {
            app.customStepDeleteBtn.addEventListener('click', () => {
                if (app.selectedCustomStepIndex >= 0) removeCustomStepAt(app.selectedCustomStepIndex);
            });
        }

        [app.customStepIdInput, app.customStepNameInput].forEach((el) => {
            if (!el) return;
            el.addEventListener('input', syncSelectedCustomStepMetaFromEditor);
            el.addEventListener('change', syncSelectedCustomStepMetaFromEditor);
        });

        setCustomStepEditorEnabled(false);
        syncCustomStepPasteButtonState();
        setCustomStepsInUi(parseCustomStepsJson(app.customStepsInput?.value || ''), {selectFirst: true});
    }

    function readCustomStepsFromUi({validate = false} = {}) {
        const persist = persistSelectedCustomStepActions({validate});
        if (!persist.ok) return persist;

        if (validate) {
            const seen = new Set();
            for (let i = 0; i < app.customStepsData.length; i += 1) {
                const step = app.customStepsData[i];
                const id = String(step.id || '').trim();
                if (!id) return {ok: false, message: `Custom step #${i + 1} is missing id.`};
                if (seen.has(id)) return {ok: false, message: `Custom step name "${id}" is duplicated.`};
                seen.add(id);
            }
        }
        syncCustomStepsHiddenInput();
        return {ok: true, value: app.customStepsData};
    }

    /** The workflow as the editor holds it, passwords included, for Resume to reuse them. */
    function getWorkflowWithPasswords() {
        try {
            const actionsValue = app.actionsBuilder?.getValue({validate: false, maskValues: 'text', markMasked: true});
            const customSteps = app.customStepActionsBuilder
                ? readCustomStepsFromUi({validate: false})
                : {ok: true, value: parseCustomStepsJson(app.customStepsInput?.value || '')};
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
        if (app.customStepActionsBuilder) {
            const read = readCustomStepsFromUi({validate: false});
            if (!read.ok) return read;
            return {ok: true, value: redactMaskedFieldsDeep(read.value || [])};
        }
        try {
            return {ok: true, value: redactMaskedFieldsDeep(parseCustomStepsJson(app.customStepsInput?.value || ''))};
        } catch (e) {
            return {ok: false, message: String(e?.message || e), value: []};
        }
    }

    function setCustomStepsFromConfigState(rawValue) {
        if (!app.customStepActionsBuilder) {
            if (app.customStepsInput) app.customStepsInput.value = String(rawValue || '');
            return;
        }
        try {
            const parsed = parseCustomStepsJson(String(rawValue || ''));
            setCustomStepsInUi(parsed, {selectFirst: true});
        } catch (e) {
            app.setUiState('error', String(e?.message || e));
        }
    }

    return {
        appendConfigState,
        getCustomStepSelectChoices,
        getCustomStepsForConfigState,
        getSlotSelectChoices,
        getWorkflowWithPasswords,
        initCustomStepsUi,
        loadSelectedCustomStepIntoEditor,
        readCustomStepsFromUi,
        refreshRunCustomStepSelectors,
        refreshSlotStepSelectors,
        renderCustomStepsList,
        selectCustomStep,
        setCustomStepsFromConfigState,
        setCustomStepsInUi,
        syncCustomStepsHiddenInput,
    };
}
