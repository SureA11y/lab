// A step's values: read from its line into the step's object, and written back
// into its fields (a secret's reference, a masked value), for a whole container
// too. Moved out of actions-builder.module.js's createActionsBuilder; what it
// shares with the rest of the editor it reaches through `builder`.

import {MASKED_VALUE_PLACEHOLDER, SELECT_TOKEN_SENTINEL, maskedFlagKey, parseNumberFieldText, resolveSelectValueForSerialization, resolveSelectValueForUi, secretRefName, withResolvedSetViewportPreset} from './actions-builder.module.js';

/**
 * builder: accessors for what the rest shares with this part
 * (collapseAction, defs, droppedWhileLoading, expandAction, isEffectivelyDisabled, isExplicitDisabled, listLines, makeLine, moveLine, refreshActionArraySummary, refreshReorderButtons, setLineExplicitDisabled).
 */
export function createStepValues(builder) {
    function readLineToObject(lineEl, { maskValues = "text", markMasked = false } = {}) {
        const type = lineEl.dataset.actionType;
        if (!type) {
            console.warn("Line without actionType", lineEl);
            return null;
        }

        const obj = { type };

        // Persist custom title (optional)
        const alias = String(lineEl.dataset.alias || "").trim();
        if (alias) obj.alias = alias;

        // Preserve explicit disabled state
        if (builder.isExplicitDisabled(lineEl)) obj.disabled = true;

        // Preserve UI collapsed state
        if (lineEl.classList.contains("is-collapsed")) obj.collapsed = true;

        // Only direct fields of this line
        lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
            const name = fieldEl.dataset.fieldName;
            const ftype = fieldEl.dataset.fieldType;
            const required = fieldEl.dataset.required === "true";
            const control = fieldEl.querySelector("input, select, textarea");
            if (!name || !control) return;

            if (fieldEl.dataset.widget === "tags" && fieldEl._tagsWidget) {
                const tags = fieldEl._tagsWidget.getTags();
                if (tags.length || required) obj[name] = tags;
                return;
            }

            const isSecret = !!fieldEl.querySelector(".sb-input-with-icon[data-secret='true']");

            if (ftype === "boolean") {
                const val = control.value;
                if (required) {
                    obj[name] = val === "true";
                } else {
                    if (val === "") {
                        // omit
                    } else if (val === "true" || val === "false") {
                        obj[name] = val === "true";
                    }
                }
            } else if (ftype === "number") {
                const raw = control.value.trim();
                if (raw !== "") {
                    const parsed = parseNumberFieldText(raw);
                    if (parsed) obj[name] = parsed.value;
                } else if (required) {
                    obj[name] = null;
                }
            } else {
                let raw = control.value.trim();

                const tokenUi = fieldEl._selectTokenUi || null;
                if (tokenUi && tokenUi.select === control && raw === SELECT_TOKEN_SENTINEL) {
                    raw = resolveSelectValueForSerialization({
                        selectValue: raw,
                        tokenValue: tokenUi.tokenInput?.value
                    });
                }

                if ((ftype || "").includes("[]")) {
                    const arr = raw === "" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
                    if (arr.length || required) obj[name] = arr;
                    return;
                }

                if ((ftype || "").includes("number")) {
                    const num = Number(raw);
                    if (!Number.isNaN(num) && raw !== "") {
                        obj[name] = num;
                        return;
                    }
                }

                // A reference left as it was is the reference, saved or run:
                // it holds no secret, and nothing was masked.
                if (isSecret && raw === "" && fieldEl.dataset.secretEnv) {
                    obj[name] = {$env: fieldEl.dataset.secretEnv};
                    return;
                }

                // maskValues: "redact" - a secret value never leaves the browser:
                // the step is written without it, and markMasked below records
                // that the value is missing on purpose.
                if ((raw !== "" || required) && !(isSecret && maskValues === "redact")) {
                    obj[name] = raw;
                }

                // Outside the guard above: the flag must survive even when the
                // secret field is empty and the value key is omitted entirely.
                if (isSecret && markMasked) obj[maskedFlagKey(name)] = true;
            }
        });

        // Then collect nested actions from direct action-array children
        lineEl.querySelectorAll(":scope > .action-arrays-below > .action-array, :scope > .action-array").forEach((arrWrap) => {
            const fieldName = arrWrap.dataset.fieldName;
            const sub = arrWrap.querySelector(".actions-subcontainer");
            const items = Array.from(sub.querySelectorAll(":scope > .line"));
            const children = items.map((child) => readLineToObject(child, { maskValues, markMasked }));
            if (children.length > 0 || arrWrap.dataset.required === "true") {
                obj[fieldName] = children;
            }
        });

        if (
            obj.type === "repeat" &&
            typeof obj.itemsText === "string" &&
            obj.itemsText.trim() !== ""
        ) {
            delete obj.repetitions;
            delete obj.times;
            delete obj.count;
        }

        return obj;
    }

    function readContainer(container, { maskValues = "text", markMasked = false } = {}) {
        const lines = builder.listLines(container);
        return lines.map((line) => readLineToObject(line, { maskValues, markMasked }));
    }

    function setFieldValue(fieldEl, value) {
        if (fieldEl.dataset.widget === "tags" && fieldEl._tagsWidget) {
            const arr = Array.isArray(value)
                ? value
                : (typeof value === "string" ? value.split(",") : []);
            fieldEl._tagsWidget.setTags(arr);
            return;
        }

        const control = fieldEl.querySelector("input, select, textarea");
        if (!control) return;

        if (fieldEl.querySelector(".sb-input-with-icon[data-secret='true']")) {
            const envName = secretRefName(value);
            setSecretReference(fieldEl, envName);
            if (envName) {
                control.value = "";
                return;
            }
        }

        const type = fieldEl.dataset.fieldType || "";
        const isArrayText =
            type.includes("[]") && control.tagName === "INPUT" && control.type === "text";
        const acceptsNumber = /\bnumber\b/.test(type);

        if (type === "boolean" && control.tagName === "SELECT") {
            // "false" as text is false: Boolean("false") would turn it true.
            if (value === "" || value == null) control.value = "";
            else control.value = String(value === true || value === "true");
            return;
        }

        if (type === "number" && control.tagName === "INPUT") {
            if (value == null || value === "") {
                control.value = "";
            } else {
                const parsed = parseNumberFieldText(value);
                control.value = parsed ? String(parsed.value) : "";
            }
            return;
        }

        if (control.tagName === "SELECT") {
            if (control.multiple) {
                const set = new Set((Array.isArray(value) ? value : []).map(String));
                Array.from(control.options).forEach(o => o.selected = set.has(o.value));
            } else {
                const tokenUi = fieldEl._selectTokenUi || null;
                if (tokenUi && tokenUi.select === control) {
                    const allowedValues = [...control.options]
                        .map((o) => String(o.value))
                        .filter((v) => v !== SELECT_TOKEN_SENTINEL);
                    const resolved = resolveSelectValueForUi({ value, allowedValues });
                    control.value = resolved.selectValue;
                    tokenUi.tokenInput.value = resolved.tokenValue;
                    tokenUi.syncTokenUi();
                } else {
                    const normalized = value == null ? "" : String(value);
                    // A step naming an engine that is not installed keeps it,
                    // as an option of its own, rather than quietly running
                    // with another: validation then says what is missing.
                    if (fieldEl.dataset.fieldName === "engine" && normalized
                        && ![...control.options].some((o) => o.value === normalized)) {
                        const missing = document.createElement("option");
                        missing.value = normalized;
                        missing.textContent = `${normalized} (not installed)`;
                        control.append(missing);
                    }
                    control.value = [...control.options].some((o) => o.value === normalized) ? normalized : "";
                }
            }
            return;
        }

        if (isArrayText && Array.isArray(value)) {
            control.value = value.join(", ");
            return;
        }

        if (
            acceptsNumber &&
            (typeof value === "number" || /^[+-]?\d+(\.\d+)?$/.test(String(value)))
        ) {
            control.value = value == null ? "" : String(value);
            return;
        }

        // A field that takes an object as well as text (argsJson) shows it as
        // the JSON it stands for, and saves that text.
        if (value && typeof value === "object") {
            control.value = JSON.stringify(value);
            return;
        }

        control.value = value == null ? "" : String(value);
    }

    /**
     * Shows a secret field as reading `envName` from the environment, or as
     * an ordinary secret field when `envName` is null. Typing a value replaces
     * the reference.
     */
    function setSecretReference(fieldEl, envName) {
        const input = fieldEl.querySelector("input");
        if (!input) return;
        const noteId = `${input.id || fieldEl.dataset.fieldName}-env-note`;
        const clear = () => {
            delete fieldEl.dataset.secretEnv;
            fieldEl.querySelector(".secret-env-note")?.remove();
            if (input.dataset.envPlaceholder != null) {
                input.placeholder = input.dataset.envPlaceholder;
                delete input.dataset.envPlaceholder;
            }
            const described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== noteId);
            if (described.length) input.setAttribute("aria-describedby", described.join(" "));
            else input.removeAttribute("aria-describedby");
        };
        clear();
        if (!envName) return;

        fieldEl.dataset.secretEnv = envName;
        input.dataset.envPlaceholder = input.placeholder || "";
        input.placeholder = `From the environment: ${envName}`;

        const note = document.createElement("p");
        note.className = "hint secret-env-note";
        note.id = noteId;
        note.textContent = `Read from the environment variable ${envName} where the workflow runs, and saved as that name. Type a value to use it instead.`;
        (input.closest(".sb-input-with-icon") || input).after(note);
        input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), noteId].filter(Boolean).join(" "));

        input.addEventListener("input", function replaced() {
            if (input.value === "") return;
            input.removeEventListener("input", replaced);
            clear();
        });
    }

    /** Says in the placeholder that a secret field came back empty because its
     *  value was not saved, as it does for every config with a secret value. */
    function applyMaskedFlagToField(fieldEl) {
        if (!fieldEl.querySelector(".sb-input-with-icon[data-secret='true']")) return;

        const input = fieldEl.querySelector("input");
        if (!input || input.value !== "") return;

        if (input.dataset.originalPlaceholder == null) {
            input.dataset.originalPlaceholder = input.placeholder || "";
        }
        input.placeholder = MASKED_VALUE_PLACEHOLDER;

        input.addEventListener("input", function restore() {
            input.placeholder = input.dataset.originalPlaceholder || "";
            delete input.dataset.originalPlaceholder;
            input.removeEventListener("input", restore);
        });
    }

    // indexPath: the step's place in the list being loaded ("3", "3.1"), to
    // say where a step left out was.
    function populateLineFromObject(lineEl, actionObj, indexPath = null) {
        // For setViewport, width/height (when set) silently override preset at
        // runtime - normalize preset to "custom" here so the dropdown always
        // reflects what actually applies, regardless of what was saved.
        const effectiveActionObj = withResolvedSetViewportPreset(actionObj);

        // Only direct fields of this line
        lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
            const name = fieldEl.dataset.fieldName;
            if (!name) return;
            if (Object.prototype.hasOwnProperty.call(effectiveActionObj, name)) {
                setFieldValue(fieldEl, effectiveActionObj[name]);
            }
            if (effectiveActionObj[maskedFlagKey(name)] === true) {
                applyMaskedFlagToField(fieldEl);
            }
        });

        // setFieldValue() above doesn't dispatch change events, so re-sync the
        // preset/custom-size visibility toggle explicitly after loading values.
        if (typeof lineEl._applySetViewportPresetVisibility === "function") {
            lineEl._applySetViewportPresetVisibility();
        }
        if (typeof lineEl._applyScanEngine === "function") {
            lineEl._applyScanEngine();
        }
        if (typeof lineEl._applySubjectFieldVisibility === "function") {
            lineEl._applySubjectFieldVisibility();
        }

        // Apply explicit disabled flag from JSON before children
        builder.setLineExplicitDisabled(lineEl, !!actionObj?.disabled);

        // Apply optional alias (custom title)
        if (typeof actionObj?.alias === "string" && actionObj.alias.trim() !== "") {
            lineEl.dataset.alias = actionObj.alias.trim();
        } else {
            delete lineEl.dataset.alias;
        }

        // Restore UI collapsed state (only when effectively enabled)
        if (!builder.isEffectivelyDisabled(lineEl)) {
            if (actionObj?.collapsed) builder.collapseAction(lineEl);
            else builder.expandAction(lineEl);
        }

        // Then populate direct nested action-arrays
        lineEl.querySelectorAll(":scope > .action-arrays-below > .action-array, :scope > .action-array").forEach((arrWrap) => {
            const fieldName = arrWrap.dataset.fieldName;
            const sub = arrWrap.querySelector(".actions-subcontainer");
            const summary = arrWrap.querySelector(".action-array__summary");
            if (!sub) return;

            sub.querySelectorAll(":scope > .line").forEach((n) => n.remove());

            const children = Array.isArray(actionObj[fieldName]) ? actionObj[fieldName] : [];
            children.forEach((childObj, childIndex) => {
                const def = builder.defs[childObj?.type];
                if (!def) {
                    // Not a step the builder has: left out, and said so by
                    // appendActions, which collects these while it loads.
                    builder.droppedWhileLoading?.push({
                        type: childObj?.type,
                        indexPath: indexPath ? `${indexPath}.${childIndex + 1}` : null,
                        field: fieldName,
                    });
                    return;
                }
                const childLine = builder.makeLine(
                    childObj.type,
                    def,
                    (line, dir, btnRef) => builder.moveLine(sub, line, dir, btnRef)
                );
                sub.append(childLine);
                populateLineFromObject(childLine, childObj || {}, indexPath ? `${indexPath}.${childIndex + 1}` : null);
            });

            builder.refreshReorderButtons(sub);
            if (summary) builder.refreshActionArraySummary(summary, sub);
        });
    }

    return {
        populateLineFromObject,
        readContainer,
        readLineToObject,
    };
}
