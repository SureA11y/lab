// A step's fields as inputs: one per field type (text, number, select, tags,
// a list of steps), with the rules catalog button and the password toggle.
// Moved out of actions-builder.module.js's createActionsBuilder; what it
// shares with the rest of the editor it reaches through `builder`.

import {createEl, iconButton, svgIcon} from './a11y-ui.utils.js';
import {buildTagsInputControl} from './tags-input.js';
import {buildProfilesControl} from './profiles-input.js';
import {SELECT_TOKEN_SENTINEL, SHORTCUTS, clipboardAction, registerPasteButton} from './actions-builder.module.js';

/**
 * builder: accessors for what the rest shares with this part
 * (actionsEl, addShortcuts, branchChipFor, defs, engineOfLine, focusFirstInput, isListedType, moveLine, options, pushHistory, randomId, refreshActionArraySummary, refreshReorderButtons, scheduleHistoryPush, stepLine, stepPalette, stepValues).
 */
// What a branch is called, by its chip (branchChipFor).
const BRANCH_TITLES = {then: "Then", else: "Otherwise", default: "Otherwise"};

export function createStepFields(builder) {
    // Gather tags already used by every OTHER scanTags widget currently in this
    // builder, so the tag input can suggest "pick existing" values alongside
    // free-text entry. Reads live widget state (not serialized JSON) so it
    // reflects edits the user just made in sibling steps.
    function collectExistingTagSuggestions(selfWrapper) {
        const seen = new Set();
        const out = [];
        builder.actionsEl.querySelectorAll('.field[data-widget="tags"]').forEach((fieldEl) => {
            if (fieldEl === selfWrapper) return;
            const widget = fieldEl._tagsWidget;
            if (!widget || typeof widget.getTags !== "function") return;
            widget.getTags().forEach((tag) => {
                const key = tag.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push(tag);
            });
        });
        return out.sort((a, b) => a.localeCompare(b));
    }

    // ---- Field renderers ----
    function fieldInputFor(fieldName, fieldDef, actionKey, indexInLine) {
        const typeStr = String(fieldDef.type || "").toLowerCase();
        const fieldId = `${actionKey}__${fieldName}__${indexInLine}__${Math.random().toString(36).slice(2, 7)}`;
        const isRequired = !!fieldDef.required;

        const wrapper = createEl("div", {
            className: "field",
            dataset: {fieldName, fieldType: typeStr, required: String(isRequired)}
        });
        if (fieldDef.cssSelector === true) wrapper.dataset.cssSelector = "true";
        if (fieldDef.ruleIds === true) wrapper.dataset.ruleIds = "true";

        const labelText = fieldDef.alias ? String(fieldDef.alias) : fieldName;
        const labelEl = createEl("label", {htmlFor: fieldId}, labelText);
        if (isRequired) {
            const badge = createEl("span", {className: "req-badge", title: "Required"}, "*");
            labelEl.append(" ", badge);
        }

        const errorEl = createEl("div", {
            className: "error",
            id: `${fieldId}__err`,
            hidden: true
        });

        const dynamicOptions = (typeof fieldDef.optionsProvider === "function")
            ? fieldDef.optionsProvider({ fieldName, actionKey })
            : null;

        const rawChoices = Array.isArray(dynamicOptions)
            ? dynamicOptions
            : Array.isArray(fieldDef.options)
                ? fieldDef.options
                : Array.isArray(fieldDef.enum)
                    ? fieldDef.enum
                    : null;

        const choices = rawChoices
            ? rawChoices.map((c) =>
                typeof c === "object" && c !== null
                    ? {value: String(c.value), label: String(c.label ?? c.value)}
                    : {value: String(c), label: String(c)}
            )
            : null;

        let controlEl;

        if (fieldDef.widget === "profiles") {
            // A fieldset of its own, named by its legend: no label above it.
            wrapper.dataset.widget = "profiles";
            const widget = buildProfilesControl({
                fieldId,
                labelText,
                choices: choices || [],
                defaultValue: fieldDef.default,
                errorId: errorEl.id,
                onChange: () => builder.scheduleHistoryPush("field:profiles"),
            });
            wrapper._profilesWidget = widget;
            wrapper.append(widget.el, errorEl);
            return wrapper;
        } else if (fieldDef.widget === "tags") {
            wrapper.dataset.widget = "tags";
            const widget = buildTagsInputControl({
                fieldId,
                labelText,
                isRequired,
                placeholder: fieldDef.placeholder,
                getSuggestions: () => collectExistingTagSuggestions(wrapper),
                onChange: () => builder.scheduleHistoryPush("field:tags"),
            });
            wrapper._tagsWidget = widget;
            controlEl = widget.el;
        } else if (typeStr === "boolean") {
            const select = document.createElement("select");
            select.id = fieldId;
            select.append(
                createEl("option", {value: "true"}, "Yes"),
                createEl("option", {value: "false"}, "No")
            );

            if (typeof fieldDef.default === "boolean") select.value = String(fieldDef.default);

            if (isRequired) {
                select.required = true;
                select.setAttribute("aria-required", "true");
            }

            controlEl = select;
        } else if (choices) {
            const select = document.createElement("select");
            if (typeStr === "string[]") {
                select.setAttribute("multiple", "");
                if (typeof fieldDef.size === "number" && fieldDef.size > 0) {
                    select.size = fieldDef.size;
                }
            }
            select.id = fieldId;
            choices.forEach(({value, label}) => {
                select.append(createEl("option", {value}, label));
            });
            if (fieldDef.default !== undefined) {
                if (select.multiple && Array.isArray(fieldDef.default)) {
                    const set = new Set(fieldDef.default.map(String));
                    Array.from(select.options).forEach(o => o.selected = set.has(o.value));
                } else {
                    select.value = String(fieldDef.default);
                }
            } else if (isRequired && !select.multiple) {
                // A required choice with no default is the person's to make
                // (Set color scheme): it starts on a prompt, not on whichever
                // option happens to come first, and stays invalid until chosen.
                select.prepend(createEl("option", {value: "", disabled: true}, "Choose…"));
                select.value = "";
            } else if (!isRequired && !select.multiple && fieldDef.emptyLabel) {
                // An optional choice whose empty value means something (Set color
                // scheme: keep it as it is) starts on that, as a choice of its
                // own, so it can be chosen again.
                select.prepend(createEl("option", {value: ""}, String(fieldDef.emptyLabel)));
                select.value = "";
            } else if (!isRequired && !select.multiple) {
                select.value = "";
            }
            if (isRequired) {
                select.required = true;
                select.setAttribute("aria-required", "true");
            }
            if (choices) {
                wrapper.dataset.enum = JSON.stringify(choices.map((c) => c.value));
            }
            // A field may refuse a variable token (variableToken: false): one
            // whose value the step editor has to know.
            if (!select.multiple && fieldDef.variableToken !== false) {
                select.append(createEl("option", { value: SELECT_TOKEN_SENTINEL }, "From a variable…"));

                const tokenInput = createEl("input", {
                    type: "text",
                    placeholder: "e.g. {var:preset}"
                });
                tokenInput.className = "select-token-input";
                tokenInput.hidden = true;
                tokenInput.setAttribute("aria-label", `${labelText} variable token`);

                const tokenHelp = createEl(
                    "small",
                    { className: "field-help" },
                    'Use a variable token like {var:preset} when this value should come from custom-step inputs.'
                );
                tokenHelp.hidden = true;

                const syncTokenUi = () => {
                    const tokenMode = select.value === SELECT_TOKEN_SENTINEL;
                    tokenInput.hidden = !tokenMode;
                    tokenHelp.hidden = !tokenMode;
                    if (tokenMode) {
                        tokenInput.setAttribute("aria-required", isRequired ? "true" : "false");
                    } else {
                        tokenInput.removeAttribute("aria-invalid");
                    }
                };
                select.addEventListener("change", syncTokenUi);

                wrapper._selectTokenUi = { select, tokenInput, tokenHelp, syncTokenUi };
                syncTokenUi();

                controlEl = createEl("div", { className: "sb-select-with-token" }, [select, tokenInput, tokenHelp]);
            } else {
                controlEl = select;
            }
        } else if (typeStr === "number") {
            // A text input, not type="number": the field also takes {var:name}.
            const input = document.createElement("input");
            input.type = "text";
            input.spellcheck = false;
            input.autocomplete = "off";
            input.id = fieldId;
            if (fieldDef.integer === true) wrapper.dataset.integer = "true";
            const ph = fieldDef.placeholder;
            input.placeholder =
                ph != null ? (typeof ph === "number" ? String(ph) : "e.g. " + ph) : "";
            if (typeof fieldDef.default === "number") input.value = String(fieldDef.default);
            if (isRequired) {
                input.required = true;
                input.setAttribute("aria-required", "true");
            }
            controlEl = input;
        } else {
            // Special case: multi-line text input
            if (fieldDef.multiline === true || fieldName === "itemsText" || fieldName === "css") {
                const ta = document.createElement("textarea");
                ta.id = fieldId;

                // Optional but useful defaults
                ta.rows = 8;
                ta.spellcheck = false;

                const ph = fieldDef.placeholder;
                ta.placeholder =
                    ph != null ? (typeof ph === "number" ? String(ph) : "e.g. " + ph) : "";

                if (typeof fieldDef.default === "string" || typeof fieldDef.default === "number") {
                    ta.value = String(fieldDef.default);
                }

                if (isRequired) {
                    ta.required = true;
                    ta.setAttribute("aria-required", "true");
                }

                controlEl = ta;
            } else {
                const input = document.createElement("input");
                input.type = "text";
                input.id = fieldId;

                const ph = fieldDef.placeholder;
                input.placeholder =
                    ph != null ? (typeof ph === "number" ? String(ph) : "e.g. " + ph) : "";
                if (typeStr.includes("[]")) input.placeholder = "comma separated";

                if (typeof fieldDef.default === "string" || typeof fieldDef.default === "number") {
                    input.value = String(fieldDef.default);
                }

                if (isRequired) {
                    input.required = true;
                    input.setAttribute("aria-required", "true");
                }

                let rendered = input;

                // 1) Optional password toggle (wraps input)
                if (shouldShowPasswordToggle(fieldName, fieldDef)) {
                    rendered = attachPasswordToggleToInput({ input: rendered, fieldId });
                }

                // 2) Optional catalog button. attachCatalogButtonToInput assumes it receives
                // the raw <input>, so it and the password toggle are mutually exclusive per field.
                if (shouldShowCatalogButton(fieldName)) {
                    rendered = attachCatalogButtonToInput({ input, options: builder.options, fieldLabel: labelEl.textContent });
                }

                controlEl = rendered;
            }
        }

        // The error describes the field itself, also when the rules catalog's
        // wrapper holds it with its button.
        const describedEl = controlEl.classList.contains("sb-inline-field-with-btn")
            ? controlEl.querySelector("input")
            : controlEl;
        describedEl.setAttribute("aria-describedby", errorEl.id);
        // A URL, a selector, a text or a value is long by nature: it takes
        // the whole row of the step's fields (steps-builder.css), where a
        // column of its own cut it short. Not a choice or a number.
        if (!choices && typeStr !== "boolean" && typeStr !== "number"
            && (fieldDef.cssSelector === true || /url|selector/i.test(fieldName) || fieldName === "text" || fieldName === "value")) {
            wrapper.dataset.wide = "true";
        }
        wrapper.append(labelEl, controlEl, errorEl);

        // ---- History: track edits on this field (debounced) ----
        const editables = wrapper.querySelectorAll("input, select, textarea");
        editables.forEach((editable) => {
            editable.addEventListener("input", () => builder.scheduleHistoryPush("field:input"));
            editable.addEventListener("change", () => builder.pushHistory("field:change"));
        });

        return wrapper;
    }

    function shouldShowCatalogButton(fieldKey) {
        return fieldKey === 'includeRuleIds'
            || fieldKey === 'excludeRuleIds'
            || fieldKey === 'includeTagIds'
            || fieldKey === 'excludeTagIds';
    }

    function attachCatalogButtonToInput({input, options, fieldLabel = ''}) {
        const open = options && typeof options.openRulesCatalog === 'function'
            ? options.openRulesCatalog
            : null;

        if (!open) return input;

        // Wrap input + button (laid out by .sb-inline-field-with-btn)
        const wrap = document.createElement('div');
        wrap.className = 'sb-inline-field-with-btn';

        const btn = document.createElement('button');
        btn.type = 'button'; // important, avoid form submit
        btn.className = 'secondary-button sb-catalog-btn';
        btn.textContent = 'Catalog';
        // Two fields carry one, so the name says which; it starts with the
        // visible text, for speech input.
        const label = String(fieldLabel || '').trim();
        if (label) btn.setAttribute('aria-label', `Catalog for ${label}`);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentSelected = input.value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
            open({
                select: true,
                // The catalog of the step's engine.
                engineId: builder.engineOfLine(input.closest(".line")),
                preselectedIds: currentSelected,
                fieldLabel: label,
                onAccept: (ids) => {
                    input.value = ids.join(', ');
                    builder.pushHistory("catalog:accept");
                }
            });
        });

        wrap.appendChild(input);
        wrap.appendChild(btn);

        return wrap;
    }

    function shouldShowPasswordToggle(fieldName, fieldDef) {
        return !!fieldDef?.secret;
    }

    function attachPasswordToggleToInput({ input, fieldId }) {
        const wrap = document.createElement("div");
        wrap.className = "sb-input-with-icon";
        wrap.style.position = "relative";

        // Marks the field as secret for readLineToObject(): its value is never
        // saved, whether or not it is revealed on screen.
        wrap.dataset.secret = "true";

        input.classList.add("sb-input-with-icon__input");
        // Keeps password managers from offering to save a test account's value.
        input.autocomplete = "new-password";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sb-input-with-icon__btn";
        btn.setAttribute("aria-pressed", "false");

        // A toggle with a fixed name: aria-pressed carries the state, and the
        // title matches the accessible name.
        const label = "Show value";
        btn.title = label;
        btn.setAttribute("aria-label", label);

        function apply(revealed) {
            input.type = revealed ? "text" : "password";
            btn.setAttribute("aria-pressed", revealed ? "true" : "false");

            const oldSvg = btn.querySelector("svg");
            if (oldSvg) oldSvg.remove();
            btn.append(svgIcon(revealed ? "hide" : "show"));
        }

        let revealed = false;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            revealed = !revealed;
            apply(revealed);

            // Focus stays on the toggle, which says its new state through
            // aria-pressed; moving it to the field would leave a keyboard user
            // who wants to toggle again having to come back. Safari does not
            // focus a clicked button by itself.
            btn.focus();
        });

        // initial state
        apply(false);

        wrap.append(input, btn);
        return wrap;
    }

    function fieldActionArray(fieldName, fieldDef, actionKey, indexInLine) {
        const isRequired = !!fieldDef.required;
        const titleId = builder.randomId("actions");
        const errorId = builder.randomId("actions-error");

        const wrapper = createEl("div", {
            className: "action-array",
            dataset: {fieldName, fieldType: "action[]", required: String(isRequired)},
            role: "group",
            "aria-labelledby": titleId,
            "aria-describedby": errorId
        });

        const titleText = (fieldDef && fieldDef.alias) ? String(fieldDef.alias) : fieldName;
        const branchName = builder.branchChipFor(actionKey, fieldName);
        // A branch is named by when it runs, "Then" or "Otherwise", in its
        // chip; "Otherwise" says it can stay empty. The field's own name
        // ("If actions") said the same again.
        const branchTitle = BRANCH_TITLES[branchName] || null;
        const title = createEl("div", {className: "action-array__title", id: titleId}, branchTitle ? [
            createEl("span", {className: `branch-chip branch-chip--${branchName}`}, branchTitle),
            branchName === "then" ? null : createEl("span", {className: "action-array__optional"}, "(optional)")
        ] : [
            titleText,
            isRequired ? createEl("span", {className: "req-badge", title: "Required"}, "*") : null
        ]);

        const summary = createEl("span", {className: "action-array__summary"}, "(0)");
        const headerRight = createEl("div", {className: "action-array__controls"}, [summary]);
        const header = createEl("div", {className: "action-array__header"}, [title, headerRight]);

        const subContainer = createEl("div", {className: "actions-subcontainer", dataset: {fieldName}});
        const errorEl = createEl("div", {className: "action-array__error", hidden: true, id: errorId});

        const controlsBox = createEl("div", {className: "inline-actions"});

        const shortcutCallback = (shortcut) => {
            return () => {
                const def = builder.defs[shortcut];
                const line = builder.stepLine.makeLine(shortcut, def, (lineEl, dir, btnRef) =>
                    builder.moveLine(subContainer, lineEl, dir, btnRef)
                );
                subContainer.append(line);
                builder.stepPalette.pushRecent(shortcut);
                builder.focusFirstInput(line);
                builder.refreshReorderButtons(subContainer);
                builder.refreshActionArraySummary(summary, subContainer);
                builder.pushHistory("nested:add");
            }
        }
        // A list that holds one kind of step (a switch's cases) offers just
        // that step; the palette and shortcuts are for every other list.
        const itemType = fieldDef && fieldDef.itemType && builder.defs[fieldDef.itemType] ? fieldDef.itemType : null;
        const accepts = itemType ? (type) => type === itemType : builder.isListedType;
        if (itemType) {
            const addItemBtn = createEl(
                "button",
                {type: "button", className: "secondary-button"},
                `Add ${String(builder.defs[itemType].label || itemType).toLowerCase()}`
            );
            addItemBtn.addEventListener("click", shortcutCallback(itemType));
            controlsBox.append(addItemBtn);
        } else {
            builder.addShortcuts(SHORTCUTS, shortcutCallback, controlsBox);
        }

        // Existing generic "Add nested action" (palette)
        const addBtn = createEl(
            "button",
            {
                type: "button",
                className: "secondary-button icon-button action-array__add",
                "aria-label": "Add nested action"
            },
            // Its word shows only where the shortcuts beside it do not.
            [svgIcon("add"), createEl("span", {className: "action-array__add-word", "aria-hidden": "true"}, "Add step")]
        );

        addBtn.addEventListener("click", () => {
            builder.stepPalette.showCommandPalette({
                onPick: (key) => {
                    const def = builder.defs[key];
                    if (!def) return;
                    const line = builder.stepLine.makeLine(key, def, (lineEl, dir, btnRef) =>
                        builder.moveLine(subContainer, lineEl, dir, btnRef)
                    );
                    subContainer.append(line);
                    builder.stepPalette.pushRecent(key);
                    builder.focusFirstInput(line);
                    builder.refreshReorderButtons(subContainer);
                    builder.refreshActionArraySummary(summary, subContainer);
                    builder.pushHistory("nested:addAny");
                }
            });
        });

        if (!itemType) controlsBox.append(addBtn);
        const pasteBtn = iconButton({
            className: "secondary-button icon-button paste-button",
            ariaLabel: "Paste action",
            title: "Paste action",
            iconName: "paste"
        });
        registerPasteButton(pasteBtn, accepts);

        pasteBtn.addEventListener("click", () => {
            if (!clipboardAction || !accepts(clipboardAction.type)) return;
            const def = builder.defs[clipboardAction.type];
            if (!def) return;

            const line = builder.stepLine.makeLine(clipboardAction.type, def, (lineEl, dir, btnRef) =>
                builder.moveLine(subContainer, lineEl, dir, btnRef)
            );
            subContainer.append(line);
            builder.stepValues.populateLineFromObject(line, clipboardAction);
            builder.focusFirstInput(line);
            builder.refreshReorderButtons(subContainer);
            builder.refreshActionArraySummary(summary, subContainer);
            builder.pushHistory("nested:paste");
        });

        controlsBox.append(pasteBtn);


        const footer = createEl("div", {className: "action-array__footer"}, [controlsBox]);

        // An empty list says so, with one button to add its first step (and
        // Paste, when there is a step to paste), rather than the whole row
        // of shortcuts: a workflow's empty branches were rows of buttons.
        // The row comes back with the first step (is-empty, set where the
        // list's count is).
        let emptyRow = null;
        if (!itemType) {
            const addFirstBtn = createEl("button", {type: "button", className: "secondary-button action-array__add-first"}, [
                svgIcon("add"), createEl("span", {}, "Add step")
            ]);
            addFirstBtn.addEventListener("click", () => addBtn.click());
            const pasteFirstBtn = iconButton({
                className: "secondary-button icon-button paste-button",
                ariaLabel: "Paste action",
                title: "Paste action",
                iconName: "paste"
            });
            registerPasteButton(pasteFirstBtn, accepts);
            pasteFirstBtn.addEventListener("click", () => pasteBtn.click());
            emptyRow = createEl("div", {className: "action-array__empty"}, [
                createEl("p", {className: "action-array__empty-note"}, "Nothing runs here."),
                addFirstBtn,
                pasteFirstBtn
            ]);
            wrapper.classList.add("is-empty");
        }

        wrapper.append(...[header, subContainer, emptyRow, footer, errorEl].filter(Boolean));
        builder.refreshReorderButtons(subContainer);
        return wrapper;
    }

    return {
        fieldActionArray,
        fieldInputFor,
    };
}
