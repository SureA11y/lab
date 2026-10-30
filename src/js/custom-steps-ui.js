// The Custom steps section: the list of custom steps as tabs, the editor of
// the one selected, copying, pasting and removing them, and keeping them in
// the form and in a saved configuration. Moved out of a11y-ui.js; what it
// shares with the rest of the app it reaches through `app`.

import {createActionsBuilder, redactMaskedFieldsDeep, withPasswordStepTypeDeep} from './actions-builder.module.js';
import {createEl} from './a11y-ui.utils.js';
import {cloneCustomStepValue, collectUsedCustomStepIds, customStepTabId, deepRemapCustomStepIds, formatCustomStepInputsText, makeUniqueImportedId, normalizeCustomStepInputs, parseCustomStepInputsText, parseCustomStepsJson} from './custom-steps-data.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (actionsBuilder, copiedCustomStep, createCustomStepActionsHistoryButtons, createCustomStepsListHistoryButtons, customStepActionsBuilder, customStepActionsBuilderEl, customStepActionsEl, customStepAddBtn, customStepCopyBtn, customStepDeleteBtn, customStepIdInput, customStepInputsTextarea, customStepNameInput, customStepPasteBtn, customStepToolbarEl, customStepsCountBadgeEl, customStepsData, customStepsInput, customStepsListActionsEl, customStepsListEl, customStepsPanelEl, pushCustomStepsHistory, resetCustomStepsHistory, rulesCatalog, scheduleCustomStepsHistoryPush, selectedCustomStepIndex, setCustomStepActionsHistoryBaselineToCurrent, setCustomStepsExpanded, setUiState, syncingCustomStepEditor).
 */
export function createCustomStepsUi(app) {
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
    function appendConfigState(state) {
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

        return {ok: true, message};
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
            app.customStepInputsTextarea,
            app.customStepCopyBtn,
            app.customStepDeleteBtn
        ];
        controls.forEach((el) => {
            if (!el) return;
            el.disabled = !enabled;
        });
        if (app.customStepActionsBuilderEl) {
            app.customStepActionsBuilderEl.classList.toggle('is-disabled', !enabled);
            app.customStepActionsBuilderEl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        }
    }

    function syncCustomStepPasteButtonState() {
        if (!app.customStepPasteBtn) return;
        const hasClipboard = !!app.copiedCustomStep;
        app.customStepPasteBtn.disabled = !hasClipboard;
        app.customStepPasteBtn.setAttribute('aria-disabled', hasClipboard ? 'false' : 'true');
        app.customStepPasteBtn.title = hasClipboard ? 'Paste custom step' : 'Copy a custom step first';
    }

    function appendCustomStepsListActions() {
        if (!app.customStepsListEl) return;
        if (!app.customStepPasteBtn && !app.customStepAddBtn) return;

        if (!app.customStepsListActionsEl) {
            app.customStepsListActionsEl = createEl('div', {
                id: 'custom-steps-list-actions',
                className: 'custom-steps-list-actions'
            });
        }

        if (app.customStepPasteBtn && app.customStepPasteBtn.parentElement !== app.customStepsListActionsEl) {
            app.customStepsListActionsEl.appendChild(app.customStepPasteBtn);
        }
        if (app.customStepAddBtn && app.customStepAddBtn.parentElement !== app.customStepsListActionsEl) {
            app.customStepsListActionsEl.appendChild(app.customStepAddBtn);
        }

        app.customStepsListEl.appendChild(app.customStepsListActionsEl);
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
            actions: Array.isArray(app.copiedCustomStep.actions) ? JSON.parse(JSON.stringify(app.copiedCustomStep.actions)) : []
        });
        app.setCustomStepsExpanded(true);
        selectCustomStep(app.customStepsData.length - 1);
        app.pushCustomStepsHistory();
    }

    function renderCustomStepsList() {
        if (!app.customStepsListEl) return;
        app.customStepsListEl.innerHTML = '';
        if (!app.customStepsData.length) {
            const empty = document.createElement('p');
            empty.className = 'custom-steps-empty';
            empty.textContent = 'No custom steps yet.';
            app.customStepsListEl.appendChild(empty);
            appendCustomStepsListActions();
            // No tab is active — the panel isn't labelled by anything.
            app.customStepsPanelEl?.removeAttribute('aria-labelledby');
            syncCustomStepPasteButtonState();
            return;
        }

        // Roving tabindex: exactly one tab is in the page tab order. Prefer the
        // selected step; if somehow none is selected, make the first tab reachable.
        const activeIndex = (app.selectedCustomStepIndex >= 0 && app.selectedCustomStepIndex < app.customStepsData.length)
            ? app.selectedCustomStepIndex
            : 0;

        app.customStepsData.forEach((step, index) => {
            const isSelected = index === app.selectedCustomStepIndex;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = customStepTabId(index);
            btn.className = `custom-steps-item${isSelected ? ' is-active' : ''}`;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            // Every tab controls the same, reused editor panel.
            btn.setAttribute('aria-controls', 'custom-steps-tabpanel');
            btn.tabIndex = index === activeIndex ? 0 : -1;
            btn.dataset.index = String(index);

            const id = document.createElement('span');
            id.className = 'custom-steps-item-id';
            id.textContent = step.id || `(step ${index + 1})`;
            btn.appendChild(id);

            const name = document.createElement('span');
            name.className = 'custom-steps-item-name';
            name.textContent = step.name || step.id || '';
            btn.appendChild(name);

            btn.addEventListener('click', () => activateCustomStepTab(index));

            // The row is presentational so the tab reads as a direct child of
            // the tablist. Copy/delete now live in the editor panel toolbar.
            const row = createEl('div', {className: 'custom-steps-item-row'}, [btn]);
            app.customStepsListEl.appendChild(row);
        });

        appendCustomStepsListActions();
        // Label the shared panel by whichever tab is currently active.
        app.customStepsPanelEl?.setAttribute('aria-labelledby', customStepTabId(activeIndex));
        syncCustomStepPasteButtonState();
    }

    // Activate a tab: select its step (loads it into the panel) and, since the
    // list is re-rendered, move focus back onto the freshly-built active tab.
    function activateCustomStepTab(index) {
        selectCustomStep(index);
        const tab = app.customStepsListEl?.querySelector(`.custom-steps-item[data-index="${index}"]`);
        tab?.focus();
    }

    // Vertical tablist keyboard model (WAI-ARIA APG): Up/Down move between tabs,
    // Home/End jump to the ends, wrapping around, with automatic activation.
    function handleCustomStepsTablistKeydown(event) {
        const target = event.target;
        if (!target || target.getAttribute?.('role') !== 'tab') return;

        const count = app.customStepsData.length;
        if (!count) return;

        const current = Number(target.dataset.index);
        if (!Number.isFinite(current)) return;

        let nextIndex;
        switch (event.key) {
            case 'ArrowDown':
                nextIndex = (current + 1) % count;
                break;
            case 'ArrowUp':
                nextIndex = (current - 1 + count) % count;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = count - 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        activateCustomStepTab(nextIndex);
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
                if (app.customStepInputsTextarea) app.customStepInputsTextarea.value = '';
                if (app.customStepActionsBuilder) app.customStepActionsBuilder.clear();
                setCustomStepEditorEnabled(false);
                return;
            }

            setCustomStepEditorEnabled(true);
            if (app.customStepIdInput) app.customStepIdInput.value = selected.id || '';
            if (app.customStepNameInput) app.customStepNameInput.value = selected.name || '';
            if (app.customStepInputsTextarea) app.customStepInputsTextarea.value = formatCustomStepInputsText(selected.inputs);
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
        selected.inputs = parseCustomStepInputsText(app.customStepInputsTextarea?.value || '');
        renderCustomStepsList();
        syncCustomStepsHiddenInput();
        refreshRunCustomStepSelectors();
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
        if (!app.customStepActionsEl || !app.customStepToolbarEl) return;
        if (!app.customStepActionsBuilder) {
            app.customStepActionsBuilder = createActionsBuilder({
                defs,
                toolbarEl: app.customStepToolbarEl,
                actionsEl: app.customStepActionsEl,
                options: {
                    openRulesCatalog: (options) => app.rulesCatalog.open(options),
                    useHorizontalStepper: false
                }
            });
            app.createCustomStepActionsHistoryButtons();
            app.createCustomStepsListHistoryButtons();
        }

        // Delegated so it survives the list being re-rendered on every change.
        if (app.customStepsListEl) {
            app.customStepsListEl.addEventListener('keydown', handleCustomStepsTablistKeydown);
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

        [app.customStepIdInput, app.customStepNameInput, app.customStepInputsTextarea].forEach((el) => {
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
        getWorkflowWithPasswords,
        initCustomStepsUi,
        loadSelectedCustomStepIntoEditor,
        readCustomStepsFromUi,
        refreshRunCustomStepSelectors,
        renderCustomStepsList,
        selectCustomStep,
        setCustomStepsFromConfigState,
        setCustomStepsInUi,
        syncCustomStepsHiddenInput,
    };
}
