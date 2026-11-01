// A step's line in the editor: its title and controls (info, disable, move,
// copy, remove, collapse), its fields split into primary and advanced, and
// the steps nested in it. Moved out of actions-builder.module.js's
// createActionsBuilder; what it shares with the rest of the editor it reaches
// through `builder`.

import {createEl, iconButton} from './a11y-ui.utils.js';
import {setClipboardAction} from './actions-builder.module.js';

/**
 * builder: accessors for what the rest shares with this part
 * (actionsEl, applyDisabledState, applyEngineToLine, buildActionInfoContent, createResponsiveActionsMenu, fieldActionArray, fieldInputFor, isActionArrayField, isExplicitDisabled, isNestedLine, opts, pushHistory, randomId, refreshActionArraySummary, refreshReorderButtons, rootRemoveLine, rootStepper, setLineExplicitDisabled, splitFieldsForAction, stepValues, toggleAction, updateLineTitles).
 */
export function createStepLine(builder) {
    function createActionControls(actionKey, actionDef, line, onMove) {
        function isRootScopeNow() {
            return (line && !builder.isNestedLine(line) && !!builder.rootStepper);
        }
        const upBtn = iconButton({
            className: "move-up secondary-button",
            ariaLabel: `${isRootScopeNow() ? builder.opts.labels.moveLeft : builder.opts.labels.moveUp}`,
            title: isRootScopeNow() ? builder.opts.labels.moveLeft : builder.opts.labels.moveUp,
            iconName: "up"
        });
        upBtn.addEventListener("click", () => onMove(line, -1, upBtn));

        const downBtn = iconButton({
            className: "move-down secondary-button",
            ariaLabel: `${isRootScopeNow() ? builder.opts.labels.moveRight : builder.opts.labels.moveDown}`,
            title: isRootScopeNow() ? builder.opts.labels.moveRight : builder.opts.labels.moveDown,
            iconName: "down"
        });
        downBtn.addEventListener("click", () => onMove(line, +1, downBtn));

        const removeBtn = iconButton({
            className: "remove secondary-button",
            ariaLabel: `${builder.opts.labels.remove}`,
            title: builder.opts.labels.remove,
            iconName: "trash"
        });
        removeBtn.addEventListener("click", () => {
            if (isRootScopeNow()) {
                builder.rootRemoveLine(line);
                builder.refreshReorderButtons(builder.actionsEl);
                builder.pushHistory("remove");
                return;
            }

            const parent = line.parentElement;
            line.remove();
            if (parent) {
                builder.refreshReorderButtons(parent);
                const actionArrayWrapper = parent.closest(".action-array");
                if (actionArrayWrapper) {
                    const summary = actionArrayWrapper.querySelector(".action-array__summary");
                    if (summary) builder.refreshActionArraySummary(summary, parent);
                }
            }
            builder.pushHistory("remove");
        });

        const infoDialogId = `actioninfo-${line._uid}`;
        const infoTitleId = `actioninfo-title-${line._uid}`;
        // The info dialog's body (a table of every field, examples) is built
        // when it is first opened: built for every step up front, it was most
        // of the editor's DOM, 1000 steps 520,000 nodes and a 23 s freeze.
        const infoBody = createEl("div", {className: "src-dialog-body"});
        const fillInfoBody = () => {
            if (!infoBody.firstChild) infoBody.appendChild(builder.buildActionInfoContent(actionKey, actionDef));
        };
        const infoBtn = iconButton({
            className: "info-button secondary-button src-dialog-trigger",
            ariaLabel: `Show info`,
            title: "Action info",
            iconName: "info"
        });
        infoBtn.setAttribute("data-dialog-id", infoDialogId);

        const infoDialog = createEl(
            "dialog",
            {
                id: infoDialogId,
                className: "src-dialog",
                "aria-labelledby": infoTitleId
            },
            [
                createEl("div", {className: "src-dialog-header"}, [
                    createEl("p", {id: infoTitleId, className: "src-dialog-title"}, actionDef.label || actionKey),
                    createEl("p", {className: "src-dialog-meta"}, `Category: ${actionDef.category || "general"}`)
                ]),
                infoBody,
                createEl("div", {className: "src-dialog-footer"}, [
                    createEl("span", {}),
                    createEl("button", {type: "button", className: "src-dialog-close"}, "Close")
                ])
            ]
        );

        infoBtn.addEventListener("click", () => {
            fillInfoBody();
            if (typeof infoDialog.showModal === "function") infoDialog.showModal();
        });
        infoDialog.addEventListener("click", (e) => {
            if (e.target === infoDialog) infoDialog.close();
        });
        infoDialog.querySelector(".sb-action-info__close")?.addEventListener("click", () => infoDialog.close());

        const copyBtn = iconButton({
            className: "copy-button secondary-button",
            ariaLabel: `Copy action`,
            title: "Copy action",
            iconName: "copy"
        });
        // Copy handler: store a deep copy in the in-memory clipboard
        copyBtn.addEventListener("click", () => {
            const actionObj = builder.stepValues.readLineToObject(line);
            if (!actionObj || !actionObj.type) return;
            setClipboardAction(actionObj);
        });

        const toggleDisableActionBtn = iconButton({
            className: "toggle-disabled secondary-button",
            ariaLabel: `Disable this action`,
            title: `Disable`,
            iconName: "disable"
        });
        // Toggle handler: explicit disabled on this line, cascade to descendants
        toggleDisableActionBtn.addEventListener("click", () => {
            const nowDisabled = !builder.isExplicitDisabled(line);
            builder.setLineExplicitDisabled(line, nowDisabled);
            builder.pushHistory("toggleDisabled");
        });

        const toggleActionBtn = iconButton({
            className: "toggle-action secondary-button",
            ariaLabel: "Collapse action panel",
            title: "Collapse",
            iconName: ["collapse"]
        });
        toggleActionBtn.setAttribute("aria-expanded", "true");
        toggleActionBtn.ariaExpanded = "true";
        // Toggle handler: explicit disabled on this line, cascade to descendants
        toggleActionBtn.addEventListener("click", () => {
            builder.toggleAction(line);
            builder.pushHistory("toggleCollapse");
        });

        const controls = createEl("div", {className: "line-controls"}, [infoBtn, toggleDisableActionBtn, upBtn, downBtn, copyBtn, removeBtn, toggleActionBtn]);

        return {controls, infoDialog}
    }

    function makeLine(actionKey, actionDef, onMove) {
        const line = createEl("div", {className: "line", role: "group"});
        line._uid = builder.randomId("ln");
        line.dataset.actionType = actionKey;
        const baseTitle = `${actionDef.label || actionKey}`;
        line.dataset.baseTitle = baseTitle;

        const titleId = `line-title-${line._uid}`;
        const action = createEl("action", {className: "visually-hidden"}, "Action ");
        const titleText = createEl("div", {className: "line-title", id: titleId}, baseTitle);

        // Inline title editor (hidden by default)
        const titleInput = createEl("input", {
            type: "text",
            className: "line-title-input",
            hidden: true,
            "aria-label": "Edit action title"
        });

        // Edit title button (icon)
        const editTitleBtn = iconButton({
            className: "edit-title secondary-button icon-button",
            ariaLabel: "Edit action title",
            title: "Edit action title",
            iconName: "edit"
        });

        const titleActionTypeText = createEl("div", {className: "line-title-action-type", id: titleId}, `- "${baseTitle}"`);
        titleActionTypeText.hidden = true;

        // helpers
        function getBaseTitleForLine() {
            return String(line.dataset.baseTitle || "").trim();
        }

        function getAliasForLine() {
            return String(line.dataset.alias || "").trim();
        }

        function enterTitleEdit() {
            // Edit only the custom part, not the numbering prefix
            const current = getAliasForLine() || getBaseTitleForLine();

            titleInput.value = current;

            // Keep the line label stable for AT, but hide visually
            titleText.classList.add("visually-hidden");

            titleInput.hidden = false;

            requestAnimationFrame(() => {
                try {
                    titleInput.focus();
                    titleInput.select();
                } catch {
                    // ignore
                }
            });
        }

        function exitTitleEdit({ restoreText = true } = {}) {
            titleInput.hidden = true;
            titleText.classList.remove("visually-hidden");
            if (restoreText) {
                // Ensure numbering/title refresh happens (includes alias if present)
                builder.updateLineTitles(builder.actionsEl);
            }
        }

        function saveTitleEdit() {
            const raw = String(titleInput.value || "").trim();
            const base = getBaseTitleForLine();

            if (!raw || raw === base) {
                delete line.dataset.alias;
            } else {
                line.dataset.alias = raw;
            }

            titleActionTypeText.hidden = !getAliasForLine();

            exitTitleEdit({ restoreText: true });

            builder.pushHistory("titleEdit");

            try {
                editTitleBtn.focus();
            } catch {
                // ignore
            }
        }

        function cancelTitleEdit() {
            exitTitleEdit({ restoreText: true });

            try {
                editTitleBtn.focus();
            } catch {
                // ignore
            }
        }

        editTitleBtn.addEventListener("click", (e) => {
            e.preventDefault();
            enterTitleEdit();
        });

        titleInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                saveTitleEdit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelTitleEdit();
            }
        });

        // Save on blur
        titleInput.addEventListener("blur", () => {
            if (titleInput.hidden) return;
            saveTitleEdit();
        });

        const titleLine = createEl("div", {className: "line-title-wrapper"}, [
            action,
            titleText,
            titleInput,
            editTitleBtn,
            titleActionTypeText
        ]);

        line.setAttribute("aria-labelledby", titleId);

        const {controls, infoDialog} = createActionControls(actionKey, actionDef, line, onMove);
        const header = createEl("div", {className: "line-header"}, [titleLine, controls]);

        builder.createResponsiveActionsMenu({
            containerEl: controls,
            collapseAtPx: 480,
            measureEl: header,
            triggerAriaLabel: "Actions",
            triggerClassName: "secondary-button"
        });

        const fieldsWrap = createEl("div", {className: "fields"});

        const toggleMoreBtn = createEl(
            "button",
            {
                type: "button",
                className: "fields-toggle secondary-button",
                "aria-expanded": "false"
            },
            [
                createEl("span", {className: "fields-toggle-label"}, builder.opts.labels.showMore),
                createEl("span", {className: "fields-toggle-icon", "aria-hidden": "true"}, "▾")
            ]
        );

        const advancedBlocks = [];

        function setAdvancedExpanded(on, {moveFocus = true} = {}) {
            toggleMoreBtn.setAttribute("aria-expanded", on ? "true" : "false");
            toggleMoreBtn.textContent = on ? builder.opts.labels.showLess : builder.opts.labels.showMore;

            fieldsWrap.classList.toggle("is-collapsed", !on);

            advancedBlocks.forEach((el) => {
                el.hidden = !on;
            });

            if (on && moveFocus) {
                // Move focus after the DOM updates
                requestAnimationFrame(() => {
                    focusFirstAdvancedField();
                });
            }
        }

        function focusFirstAdvancedField() {
            for (const block of advancedBlocks) {
                if (block.hidden) continue;

                const focusable = block.querySelector(
                    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
                );

                if (focusable && typeof focusable.focus === "function") {
                    focusable.focus();
                    return;
                }
            }
        }

        toggleMoreBtn.addEventListener("click", () => {
            const expanded = toggleMoreBtn.getAttribute("aria-expanded") === "true";
            setAdvancedExpanded(!expanded);
            builder.pushHistory("toggleAdvanced");
        });
        setAdvancedExpanded(false);

        let visibleIndex = 0;

        const {primary, advanced} = builder.splitFieldsForAction(actionDef);

        const actionArrayBlocks = [];

        function renderFieldEntry(fname, fdef, isAdvanced) {
            if (builder.isActionArrayField(fdef)) {
                const block = builder.fieldActionArray(fname, fdef, actionKey, visibleIndex++);
                if (isAdvanced) {
                    block.classList.add("is-advanced");
                    block.hidden = true;
                    advancedBlocks.push(block);
                }
                actionArrayBlocks.push(block);
                return true;
            } else {
                const fieldEl = builder.fieldInputFor(fname, fdef, actionKey, visibleIndex++);
                if (isAdvanced) {
                    fieldEl.classList.add("is-advanced");
                    fieldEl.hidden = true;
                    advancedBlocks.push(fieldEl);
                }
                fieldsWrap.append(fieldEl);
                return true;
            }
        }

        let advancedRenderedCount = 0;

        function wireRepeatDatasetOverridesCount(lineEl) {
            // Only applies to repeat actions
            if (!lineEl || lineEl.dataset.actionType !== "repeat") return;

            // Find the fields by their wrapper dataset name
            const itemsField = lineEl.querySelector(':scope > .fields > .field[data-field-name="itemsText"] textarea');
            if (!itemsField) return;

            // Adjust this list to match your repeat definition field name(s)
            const countSelectors = [
                ':scope > .fields > .field[data-field-name="repetitions"] input',
                ':scope > .fields > .field[data-field-name="times"] input',
                ':scope > .fields > .field[data-field-name="count"] input'
            ];

            const countInput = countSelectors
                .map((sel) => lineEl.querySelector(sel))
                .find(Boolean);

            if (!countInput) return;

            const countFieldWrap = countInput.closest(".field");

            const apply = () => {
                const hasText = String(itemsField.value || "").trim() !== "";
                // Disable count when dataset is present
                countInput.disabled = hasText;
                if (countFieldWrap) countFieldWrap.classList.toggle("is-ignored", hasText);

                // Optional: make it obvious why it’s disabled
                if (hasText) {
                    countInput.setAttribute("aria-disabled", "true");
                    countInput.title = "Ignored because itemsText has values";
                } else {
                    countInput.removeAttribute("aria-disabled");
                    countInput.title = "";
                }
            };

            // React to edits
            itemsField.addEventListener("input", apply);
            itemsField.addEventListener("change", apply);

            // Apply once on initial render (important for loaded workflows)
            apply();
        }

        function wireRunCustomStepDynamicInputs(lineEl) {
            // Only applies to runCustomStep actions
            if (!lineEl || lineEl.dataset.actionType !== "runCustomStep") return;

            const getSchema = actionDef && actionDef.getStepInputsSchema;
            if (typeof getSchema !== "function") return;

            const customStepSelect = lineEl.querySelector(':scope > .fields > .field[data-field-name="customStepId"] select');
            const argsField = lineEl.querySelector(':scope > .fields > .field[data-field-name="argsJson"]');
            const argsTextarea = argsField ? argsField.querySelector("textarea") : null;
            if (!customStepSelect || !argsField || !argsTextarea) return;

            const dynamicWrap = createEl("div", {className: "field runcustomstep-dynamic-inputs", hidden: true});
            argsField.insertAdjacentElement("afterend", dynamicWrap);

            let dynamicInputEls = [];

            function readCurrentArgs() {
                try {
                    const parsed = JSON.parse(argsTextarea.value || "{}");
                    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
                } catch (e) {
                    return {};
                }
            }

            function writeArgsFromDynamicInputs() {
                const out = {};
                dynamicInputEls.forEach(({name, input}) => {
                    if (input.value !== "") out[name] = input.value;
                });
                argsTextarea.value = Object.keys(out).length ? JSON.stringify(out) : "";
                argsTextarea.dispatchEvent(new Event("input", {bubbles: true}));
                argsTextarea.dispatchEvent(new Event("change", {bubbles: true}));
            }

            function rebuild() {
                const schema = getSchema(customStepSelect.value);
                dynamicInputEls = [];
                dynamicWrap.innerHTML = "";

                if (!Array.isArray(schema) || !schema.length) {
                    dynamicWrap.classList.add("is-advanced");
                    dynamicWrap.hidden = true;
                    argsField.classList.remove("is-advanced");
                    argsField.hidden = false;
                    return;
                }

                const currentArgs = readCurrentArgs();
                argsField.classList.add("is-advanced");
                argsField.hidden = true;
                dynamicWrap.classList.remove("is-advanced");
                dynamicWrap.hidden = false;

                dynamicWrap.append(createEl("label", {}, "Inputs"));

                schema.forEach((def) => {
                    const name = String((def && def.name) || "").trim();
                    if (!name) return;
                    const required = !!(def && def.required);

                    const row = createEl("div", {className: "runcustomstep-dynamic-input-row"});
                    row.append(createEl("label", {}, required ? `${name} *` : name));

                    const input = createEl("input", {
                        type: "text",
                        value: currentArgs[name] != null ? String(currentArgs[name]) : "",
                        placeholder: required ? "Required" : ""
                    });
                    input.addEventListener("input", writeArgsFromDynamicInputs);
                    row.append(input);

                    dynamicWrap.append(row);
                    dynamicInputEls.push({name, input});
                });
            }

            customStepSelect.addEventListener("change", rebuild);
            rebuild();
        }

        function wireScanEngine(lineEl) {
            // Only applies to a11yScan actions
            if (!lineEl || lineEl.dataset.actionType !== "a11yScan") return;
            // Exposed so populateLineFromObject can ready a loaded step.
            lineEl._applyScanEngine = () => builder.applyEngineToLine(lineEl);
            builder.applyEngineToLine(lineEl);
        }

        function wireSetViewportPresetToggle(lineEl) {
            // Only applies to setViewport actions
            if (!lineEl || lineEl.dataset.actionType !== "setViewport") return;

            const presetField = lineEl.querySelector(':scope > .fields > .field[data-field-name="preset"]');
            const widthField = lineEl.querySelector(':scope > .fields > .field[data-field-name="width"]');
            const heightField = lineEl.querySelector(':scope > .fields > .field[data-field-name="height"]');
            const presetSelect = presetField ? presetField.querySelector("select") : null;
            if (!presetSelect || !widthField || !heightField) return;

            const widthInput = widthField.querySelector("input");
            const heightInput = heightField.querySelector("input");

            function applyVisibility() {
                const isCustom = presetSelect.value === "custom";

                widthField.hidden = !isCustom;
                heightField.hidden = !isCustom;
                widthField.classList.toggle("is-conditionally-hidden", !isCustom);
                heightField.classList.toggle("is-conditionally-hidden", !isCustom);

                if (!isCustom) {
                    // A named preset is the single source of truth for size once chosen -
                    // clear any leftover custom values so they can't silently keep
                    // overriding it (width/height always win over preset at runtime).
                    if (widthInput) widthInput.value = "";
                    if (heightInput) heightInput.value = "";
                }
            }

            presetSelect.addEventListener("change", () => {
                applyVisibility();
                builder.pushHistory("field:change");
            });

            // Exposed so populateLineFromObject can re-sync visibility after loading
            // saved/pasted values: setFieldValue() sets .value directly and does not
            // dispatch a "change" event, so this listener alone would miss loaded data.
            lineEl._applySetViewportPresetVisibility = applyVisibility;

            applyVisibility();
        }

        // Switch and URL condition: show only the fields the chosen subject and
        // URL part use. A hidden field keeps its value (the engine ignores it),
        // so switching back does not lose what was typed.
        function wireSubjectFields(lineEl) {
            const type = lineEl ? lineEl.dataset.actionType : "";
            if (type !== "switch" && type !== "ifUrl") return;

            const fieldOf = (name) => lineEl.querySelector(`:scope > .fields > .field[data-field-name="${name}"]`);
            const subjectSelect = fieldOf("subject")?.querySelector("select") || null;
            const partSelect = fieldOf("urlPart")?.querySelector("select") || null;
            const show = (name, on) => {
                const el = fieldOf(name);
                if (!el) return;
                el.hidden = !on;
                el.classList.toggle("is-conditionally-hidden", !on);
            };

            function applyVisibility() {
                const byUrl = !subjectSelect || subjectSelect.value !== "var";
                show("urlPart", byUrl);
                show("paramName", byUrl && !!partSelect && partSelect.value === "param");
                if (subjectSelect) show("var", !byUrl);
            }

            subjectSelect?.addEventListener("change", applyVisibility);
            partSelect?.addEventListener("change", applyVisibility);
            // populateLineFromObject sets values without "change" events.
            lineEl._applySubjectFieldVisibility = applyVisibility;
            applyVisibility();
        }

        // primary first
        primary.forEach(([fname, fdef]) => {
            renderFieldEntry(fname, fdef, false);
        });

        // advanced after (hidden initially)
        advanced.forEach(([fname, fdef]) => {
            if (renderFieldEntry(fname, fdef, true)) advancedRenderedCount++;
        });

        // insert toggle after primary only if there are advanced fields (and at least one was rendered)
        const hasAdvanced = advancedRenderedCount > 0;
        if (hasAdvanced) {
            const toggleRow = createEl("div", {className: "fields-toggle-row"}, [toggleMoreBtn]);
            fieldsWrap.append(toggleRow);
            // Validation opens this section when the field it flagged sits in
            // there; it must not take the caret away from that field, hence
            // the opt-out from the toggle's usual focus jump.
            line._expandAdvancedFields = () => setAdvancedExpanded(true, {moveFocus: false});
        }

        line.append(header, fieldsWrap, infoDialog);

        if (actionArrayBlocks.length > 0) {
            const below = createEl("div", {className: "action-arrays-below"});
            actionArrayBlocks.forEach((block) => below.append(block));
            line.append(below);
        }

        // Initialize visuals
        builder.applyDisabledState(line);

        if (actionKey === "case") {
            const refreshTitle = () => builder.updateLineTitles(line.parentElement || builder.actionsEl);
            fieldsWrap.addEventListener("input", refreshTitle);
            fieldsWrap.addEventListener("change", refreshTitle);
        }

        wireRepeatDatasetOverridesCount(line);
        wireRunCustomStepDynamicInputs(line);
        wireSetViewportPresetToggle(line);
        wireSubjectFields(line);
        wireScanEngine(line);

        return line;
    }

    return {
        makeLine,
    };
}
