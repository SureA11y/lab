// A step's line in the editor: its title and controls (info, disable, move,
// copy, remove, collapse), its fields split into primary and advanced, and
// the steps nested in it. Moved out of actions-builder.module.js's
// createActionsBuilder; what it shares with the rest of the editor it reaches
// through `builder`.

import {createEl, iconButton, svgIcon} from './a11y-ui.utils.js';
import {setClipboardAction, SELECT_TOKEN_SENTINEL} from './actions-builder.module.js';
import {inputLabelOf} from './custom-step-inputs-table.js';

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

        // A call's place for steps (slotSteps) is there for as long as the
        // custom step has the place: it is not moved, copied or removed on its
        // own.
        const fixedInList = actionDef.fixedInList === true;
        const controls = createEl("div", {className: "line-controls"}, fixedInList
            ? [infoBtn, toggleDisableActionBtn, toggleActionBtn]
            : [infoBtn, toggleDisableActionBtn, upBtn, downBtn, copyBtn, removeBtn, toggleActionBtn]);

        return {controls, infoDialog, collapseBtn: toggleActionBtn}
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

        // What kind of step it is, as a small line above its title ("Set
        // variable", above "1 - The start locale"), on every card, so every
        // title starts at the same place. A step titled by its kind has it
        // too, unsaid to a screen reader, as the title says it
        // (updateLineTitles).
        const titleActionTypeText = createEl("span", {className: "line-title-action-type", "aria-hidden": "true"}, baseTitle);

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
            titleActionTypeText,
            titleText,
            titleInput,
            editTitleBtn
        ]);

        line.setAttribute("aria-labelledby", titleId);

        const {controls, infoDialog, collapseBtn} = createActionControls(actionKey, actionDef, line, onMove);
        const header = createEl("div", {className: "line-header"}, [titleLine, controls]);

        // A card shows Collapse and a menu of the rest, as on a phone, so
        // forty steps are not 280 buttons. With a mouse, the rest show in
        // place of the menu while the pointer is on the card, and for the
        // keyboard while focus is in it (steps-builder.css): they stay in
        // the tab order and are named all the while. Without a mouse (a
        // touch screen), or with no room for them, they are in the menu.
        const noHover = typeof window !== "undefined" && window.matchMedia
            ? window.matchMedia("(hover: none)")
            : null;
        builder.createResponsiveActionsMenu({
            containerEl: controls,
            collapseAtPx: 480,
            collapseIfFn: () => !!noHover?.matches,
            measureEl: header,
            triggerAriaLabel: "Actions",
            triggerClassName: "secondary-button",
            keepInline: [collapseBtn]
        });
        // Where the buttons show on hover, a sign that there is more, in the
        // menu button's place: drawn only, as the buttons themselves are
        // what the keyboard and a screen reader reach.
        const moreSign = createEl("span", {className: "line-controls__more", "aria-hidden": "true"}, svgIcon("menu"));
        controls.insertBefore(moreSign, collapseBtn);

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

        // A call to a custom step leads to it: "Open this custom step" beside
        // the choice of which one (under it when the card has no room), when
        // the app says how to open one. The field takes the card's whole row,
        // so the custom step's name keeps room beside the button.
        function wireRunCustomStepOpenLink(lineEl) {
            if (!lineEl || lineEl.dataset.actionType !== "runCustomStep") return;
            const open = actionDef && actionDef.openCustomStep;
            if (typeof open !== "function") return;
            const field = lineEl.querySelector(':scope > .fields > .field[data-field-name="customStepId"]');
            const select = field ? field.querySelector("select") : null;
            if (!field || !select) return;
            const link = createEl("button", {type: "button", className: "runcustomstep-open"}, "Open this custom step →");
            // A variable token names no custom step to open.
            const sync = () => { link.hidden = !select.value || select.value === SELECT_TOKEN_SENTINEL; };
            link.addEventListener("click", () => open(select.value));
            select.addEventListener("change", sync);
            const row = createEl("div", {className: "runcustomstep-pick"});
            select.replaceWith(row);
            row.append(select, link);
            field.dataset.wide = "row";
            // A loaded step's value is set without a change event
            // (step-values.js), which calls this after.
            lineEl._applyRunCustomStepOpen = sync;
            sync();
        }

        // A call's inputs, one field each: one for each input the custom
        // step declares (labelled with its label), and one for each other
        // input the call gives (labelled with its name; all of them when the
        // custom step declares none, is a variable token, or is not one the
        // app has), each with a button to remove it, and a name to type to
        // add one. The JSON text the step saves (argsJson) stays the field's
        // value, hidden: the fields write it. Only text that is not a JSON
        // object, written by hand, shows it, to be put right.
        function wireRunCustomStepDynamicInputs(lineEl) {
            if (!lineEl || lineEl.dataset.actionType !== "runCustomStep") return;

            const getSchema = actionDef && actionDef.getStepInputsSchema;
            const customStepSelect = lineEl.querySelector(':scope > .fields > .field[data-field-name="customStepId"] select');
            const argsField = lineEl.querySelector(':scope > .fields > .field[data-field-name="argsJson"]');
            const argsTextarea = argsField ? argsField.querySelector("textarea") : null;
            if (!argsField || !argsTextarea) return;
            const argsLabel = argsField.querySelector(":scope > label");
            const argsError = argsField.querySelector(":scope > .error");

            argsField.dataset.wide = "row";
            const dynamicWrap = createEl("div", {className: "runcustomstep-dynamic-inputs"});
            argsField.insertBefore(dynamicWrap, argsError || null);

            // Each input: {name: () => string, text: () => string, kept, value}.
            // A value that is not text (a number, an object from a file
            // written by hand) is kept as it came until its field is edited.
            let rows = [];

            function parseArgs() {
                const text = String(argsTextarea.value || "").trim();
                if (!text) return {};
                try {
                    const parsed = JSON.parse(text);
                    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
                } catch (e) {
                    return null;
                }
            }

            const shownText = (v) => (v == null ? "" : (typeof v === "string" ? v : JSON.stringify(v)));

            function writeArgs() {
                const out = {};
                rows.forEach((row) => {
                    const name = row.name().trim();
                    if (!name || Object.prototype.hasOwnProperty.call(out, name)) return;
                    if (row.kept) { out[name] = row.value; return; }
                    const text = row.text();
                    // A declared input left empty takes its default; a name
                    // given by hand is given, empty or not.
                    if (text === "" && row.declared) return;
                    out[name] = text;
                });
                argsTextarea.value = Object.keys(out).length ? JSON.stringify(out) : "";
                // The page's own Event: the editor and history listen there.
                const PageEvent = argsTextarea.ownerDocument.defaultView?.Event || Event;
                argsTextarea.dispatchEvent(new PageEvent("input", {bubbles: true}));
                argsTextarea.dispatchEvent(new PageEvent("change", {bubbles: true}));
            }

            // A value of several lines (a list of viewports, one a line) is a
            // textarea that grows with it: a one-line field drops its line
            // breaks, "desktop-lgtabletmobile".
            function valueControl(id, text, placeholder) {
                if (!text.includes("\n")) {
                    return createEl("input", {type: "text", id, value: text, placeholder, spellcheck: false, autocomplete: "off"});
                }
                const area = createEl("textarea", {id, rows: Math.min(text.split("\n").length, 12), spellcheck: false});
                area.value = text;
                area.addEventListener("input", () => {
                    area.rows = Math.min(Math.max(area.value.split("\n").length, 1), 12);
                });
                return area;
            }

            function declaredRow(def, args) {
                const name = String((def && def.name) || "").trim();
                const required = !!(def && def.required);
                const has = Object.prototype.hasOwnProperty.call(args, name);
                const inputId = builder.randomId("custom-step-input");
                const row = createEl("div", {className: "runcustomstep-dynamic-input-row"});
                // Its label, or its name in words ("Element screenshots"
                // for elementScreenshots): what it is, not the variable.
                const label = createEl("label", {htmlFor: inputId}, inputLabelOf(def));
                if (required) label.append(" ", createEl("span", {className: "req-badge", title: "Required"}, "*"));
                const input = valueControl(inputId, has ? shownText(args[name]) : "", inputPlaceholder(def, required));
                if (required) input.setAttribute("aria-required", "true");
                row.append(label, input);
                const state = {declared: true, name: () => name, text: () => input.value, kept: has && typeof args[name] !== "string", value: args[name]};
                input.addEventListener("input", () => { state.kept = false; writeArgs(); });
                rows.push(state);
                return row;
            }

            // An input the custom step does not declare: one field, labelled
            // with the input's name, and a button to remove it.
            function namedRow(name, value, given) {
                const inputId = builder.randomId("custom-step-arg");
                const input = valueControl(inputId, given ? shownText(value) : "", "");
                const remove = iconButton({className: "secondary-button runcustomstep-dynamic-input__remove", ariaLabel: `Remove input ${name}`, iconName: "trash"});
                const row = createEl("div", {className: "runcustomstep-dynamic-input-row runcustomstep-dynamic-input-row--given"}, [
                    createEl("label", {htmlFor: inputId}, name),
                    createEl("div", {className: "runcustomstep-dynamic-input__control"}, [input, remove])
                ]);
                const state = {declared: false, input, name: () => name, text: () => input.value, kept: given && typeof value !== "string", value};
                input.addEventListener("input", () => { state.kept = false; writeArgs(); });
                remove.addEventListener("click", () => {
                    const given = rows.filter((r) => !r.declared);
                    const at = given.indexOf(state);
                    rows = rows.filter((r) => r !== state);
                    row.remove();
                    writeArgs();
                    empty.hidden = rows.length > 0;
                    // Focus stays here: on the input that took its place, or
                    // the new input's name.
                    const left = rows.filter((r) => !r.declared);
                    const next = left[Math.min(at, left.length - 1)];
                    (next ? next.input : newName).focus();
                });
                rows.push(state);
                return row;
            }

            const titleId = builder.randomId("custom-step-inputs");
            const empty = createEl("p", {className: "runcustomstep-dynamic-inputs__empty"}, "No inputs: the call gives the custom step nothing.");
            // Adding an input: its name, then Add input makes its field.
            const newNameId = builder.randomId("custom-step-new-input");
            const addErrorId = builder.randomId("custom-step-new-input-error");
            const newName = createEl("input", {type: "text", id: newNameId, placeholder: "e.g. viewLabel", spellcheck: false, autocomplete: "off"});
            const addBtn = createEl("button", {type: "button", className: "secondary-button runcustomstep-dynamic-inputs__add"}, [
                svgIcon("add"), createEl("span", {}, "Add input")
            ]);
            const addError = createEl("p", {className: "runcustomstep-dynamic-inputs__error", id: addErrorId, role: "status", hidden: true});
            const addArea = createEl("div", {className: "runcustomstep-dynamic-inputs__new"}, [
                createEl("div", {className: "runcustomstep-dynamic-input-row"}, [
                    createEl("label", {htmlFor: newNameId}, "New input’s name"),
                    createEl("div", {className: "runcustomstep-dynamic-input__control"}, [newName, addBtn])
                ]),
                addError
            ]);

            function showAddError(msg) {
                addError.textContent = msg || "";
                addError.hidden = !msg;
                if (msg) {
                    newName.setAttribute("aria-invalid", "true");
                    newName.setAttribute("aria-describedby", addErrorId);
                } else {
                    newName.removeAttribute("aria-invalid");
                    newName.removeAttribute("aria-describedby");
                }
            }

            function addInput() {
                const name = newName.value.trim();
                if (!name) {
                    showAddError("Type the input’s name, then add it.");
                    newName.focus();
                    return;
                }
                if (rows.some((r) => r.name() === name)) {
                    showAddError(`“${name}” is already an input: type its value in its field.`);
                    newName.focus();
                    return;
                }
                showAddError(null);
                const row = namedRow(name, "", false);
                applyDisabled(row);
                dynamicWrap.insertBefore(row, empty);
                empty.hidden = true;
                newName.value = "";
                writeArgs();
                row.querySelector("input, textarea").focus();
            }
            addBtn.addEventListener("click", addInput);
            newName.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { e.preventDefault(); addInput(); }
            });
            newName.addEventListener("input", () => { if (!addError.hidden) showAddError(null); });

            // New fields follow the step: none can be typed in on a disabled one.
            function applyDisabled(root) {
                root.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = argsTextarea.disabled; });
            }

            function showRawText(on) {
                argsTextarea.hidden = !on;
                // The fields' label sets its display: hidden alone keeps it.
                if (argsLabel) { argsLabel.hidden = !on; argsLabel.style.display = on ? "" : "none"; }
                dynamicWrap.hidden = on;
            }

            function rebuild() {
                rows = [];
                dynamicWrap.textContent = "";
                newName.value = "";
                showAddError(null);

                const args = parseArgs();
                if (!args) {
                    // Not an object: shown as written, to be put right; it
                    // turns into fields once it is one.
                    showRawText(true);
                    return;
                }
                showRawText(false);

                const schema = (typeof getSchema === "function" && customStepSelect) ? getSchema(customStepSelect.value) : null;
                const declared = (Array.isArray(schema) ? schema : [])
                    .filter((def) => def && String(def.name || "").trim());
                const declaredNames = new Set(declared.map((def) => String(def.name).trim()));

                // The inputs are a group named by its title; each input has
                // its own label, tied to it.
                dynamicWrap.setAttribute("role", "group");
                dynamicWrap.setAttribute("aria-labelledby", titleId);
                dynamicWrap.append(createEl("div", {className: "runcustomstep-dynamic-inputs__title", id: titleId}, "Inputs"));
                declared.forEach((def) => dynamicWrap.append(declaredRow(def, args)));
                Object.keys(args)
                    .filter((name) => !declaredNames.has(name))
                    .forEach((name) => dynamicWrap.append(namedRow(name, args[name], true)));
                empty.hidden = rows.length > 0;
                dynamicWrap.append(empty, addArea);
                applyDisabled(dynamicWrap);
            }

            argsTextarea.addEventListener("change", (e) => {
                // Only the raw text's own edits: the fields' writes are
                // already shown.
                if (e.target === argsTextarea && !argsTextarea.hidden && parseArgs()) rebuild();
            });
            if (customStepSelect) customStepSelect.addEventListener("change", rebuild);
            // A loaded step's values are set without a change event
            // (step-values.js), which calls this after.
            lineEl._applyRunCustomStepInputs = rebuild;
            rebuild();
        }

        // A call's places for steps of its own: one list for each place its
        // custom step has (getStepSlotsSchema), in the custom step's order,
        // titled with the place's label. They are kept, not added or removed
        // by hand: the list of places has no buttons of its own. One for a
        // place the custom step no longer has stays, said so, with its steps,
        // until it is emptied: no step is lost to a renamed place.
        function wireRunCustomStepSlots(lineEl) {
            if (!lineEl || lineEl.dataset.actionType !== "runCustomStep") return;
            const arrWrap = lineEl.querySelector(':scope > .action-arrays-below > .action-array[data-field-name="slots"], :scope > .action-array[data-field-name="slots"]');
            const slotStepsDef = builder.defs.slotSteps;
            if (!arrWrap || !slotStepsDef) return;
            const sub = arrWrap.querySelector(":scope > .actions-subcontainer");
            const summary = arrWrap.querySelector(":scope > .action-array__header .action-array__summary");
            if (!sub) return;
            arrWrap.classList.add("runcustomstep-slots");
            arrWrap.querySelector(":scope > .action-array__footer")?.setAttribute("hidden", "");
            const getSchema = actionDef && actionDef.getStepSlotsSchema;
            const customStepSelect = lineEl.querySelector(':scope > .fields > .field[data-field-name="customStepId"] select');

            const slotOf = (line) => {
                const input = line.querySelector(':scope > .fields > .field[data-field-name="slot"] input');
                return input ? String(input.value || "").trim() : "";
            };
            const hasSteps = (line) => !!line.querySelector(":scope > .action-arrays-below .actions-subcontainer > .line, :scope > .action-array .actions-subcontainer > .line");

            function sync() {
                const schema = typeof getSchema === "function" && customStepSelect ? getSchema(customStepSelect.value) : null;
                const declared = (Array.isArray(schema) ? schema : [])
                    .map((def) => (typeof def === "string" ? {name: def} : def))
                    .filter((def) => def && String(def.name || "").trim());
                const byName = new Map();
                Array.from(sub.querySelectorAll(":scope > .line")).forEach((line) => {
                    const name = slotOf(line);
                    if (!byName.has(name)) byName.set(name, line);
                });

                let changed = false;
                const created = [];
                const ordered = [];
                const setTitle = (line, title) => {
                    if (line.dataset.baseTitle !== title) { line.dataset.baseTitle = title; changed = true; }
                };
                declared.forEach((def) => {
                    const name = String(def.name).trim();
                    let line = byName.get(name);
                    byName.delete(name);
                    if (!line) {
                        line = builder.stepLine.makeLine("slotSteps", slotStepsDef, (l, dir, btnRef) => builder.moveLine(sub, l, dir, btnRef));
                        const input = line.querySelector(':scope > .fields > .field[data-field-name="slot"] input');
                        if (input) input.value = name;
                        created.push(line);
                    }
                    setTitle(line, `${inputLabelOf(def)}${def.required ? " (required)" : ""}`);
                    if (def.required) line.dataset.slotRequired = "true";
                    else delete line.dataset.slotRequired;
                    delete line.dataset.slotUnknown;
                    ordered.push(line);
                });
                // Steps for a place the custom step does not have: kept while
                // they hold steps, said so; an empty one goes.
                byName.forEach((line, name) => {
                    if (!hasSteps(line)) { line.remove(); changed = true; return; }
                    setTitle(line, `${name || "(no name)"}: the custom step has no such place`);
                    line.dataset.slotUnknown = "true";
                    delete line.dataset.slotRequired;
                    ordered.push(line);
                });
                ordered.forEach((line) => {
                    // Its place is its title: the name is not typed in.
                    const field = line.querySelector(':scope > .fields > .field[data-field-name="slot"]');
                    if (field) field.hidden = true;
                });
                const lines = Array.from(sub.querySelectorAll(":scope > .line"));
                if (lines.length !== ordered.length || ordered.some((line, i) => lines[i] !== line)) {
                    ordered.forEach((line) => sub.append(line));
                    changed = true;
                }
                // A new one follows the call: disabled with it.
                created.forEach((line) => builder.applyDisabledState(line));

                arrWrap.hidden = ordered.length === 0;
                if (!changed && !created.length) return;
                builder.refreshReorderButtons(sub);
                if (summary) builder.refreshActionArraySummary(summary, sub);
                if (lineEl.isConnected) builder.updateLineTitles(builder.actionsEl);
            }

            if (customStepSelect) customStepSelect.addEventListener("change", sync);
            // A loaded step's places are synced once its steps for them are in
            // (step-values.js).
            lineEl._applyRunCustomStepSlots = sync;
            sync();
        }

        // What an empty input gets: its custom step's default, said as such,
        // or that it must be given.
        function inputPlaceholder(def, required) {
            if (def && Object.prototype.hasOwnProperty.call(def, "default")) {
                const d = def.default;
                return `Default: ${typeof d === "string" ? d : JSON.stringify(d)}`;
            }
            return required ? "Required" : "";
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

        if (actionKey === "case" || actionKey === "slot") {
            const refreshTitle = () => builder.updateLineTitles(line.parentElement || builder.actionsEl);
            fieldsWrap.addEventListener("input", refreshTitle);
            fieldsWrap.addEventListener("change", refreshTitle);
        }

        wireRepeatDatasetOverridesCount(line);
        wireRunCustomStepDynamicInputs(line);
        wireRunCustomStepSlots(line);
        wireRunCustomStepOpenLink(line);
        wireSetViewportPresetToggle(line);
        wireSubjectFields(line);
        wireScanEngine(line);

        return line;
    }

    return {
        makeLine,
    };
}
