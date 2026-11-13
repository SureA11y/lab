// Checking a step's fields as the editor shows them: each line's errors, the
// steps inside it, and revealing an invalid step and its advanced fields. Moved
// out of actions-builder.module.js's createActionsBuilder; what it shares with
// the rest of the editor it reaches through `builder`.

import {SELECT_TOKEN_SENTINEL, isTokenizedSelectValue, parseNumberFieldText, resolveSelectValueForSerialization} from './actions-builder.module.js';

/**
 * builder: accessors for what the rest shares with this part
 * (RESERVED_ERROR_ATTR, collapseAction, engineOfLine, expandAction, invalidCssSelector, isEffectivelyDisabled, listLines, reservedVariableConflict, secretsOptional, setError, unknownRuleIds).
 */
export function createStepValidation(builder) {
    function validateLine(lineEl, report = null) {
        // Skip validation entirely if disabled
        if (builder.isEffectivelyDisabled(lineEl)) return true;

        let ok = true;

        // `missing` marks "you left a required field empty", the error the run
        // button most often stops on and the one worth the caret.
        const note = (el, {missing = false} = {}) => {
            if (!report || !el) return;
            if (!report.firstError) report.firstError = el;
            if (missing && !report.firstMissingRequired) report.firstMissingRequired = el;
        };

        // Only direct fields of this line
        lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
            const type = fieldEl.dataset.fieldType;
            const required = fieldEl.dataset.required === "true";
            const enumJson = fieldEl.dataset.enum || null;
            const allowed = enumJson ? JSON.parse(enumJson) : null;
            if (fieldEl.dataset.widget === "profiles" && fieldEl._profilesWidget) {
                const widget = fieldEl._profilesWidget;
                builder.setError(widget.el, null);
                widget.el.removeAttribute("aria-invalid");
                const problem = widget.validate({required});
                if (problem) {
                    builder.setError(widget.el, problem.message);
                    // On the group itself, which its error describes.
                    widget.el.setAttribute("aria-invalid", "true");
                    note(problem.el || widget.el);
                    ok = false;
                }
                return;
            }

            const control = fieldEl.querySelector("input, select, textarea");
            if (!control) return;

            builder.setError(control, null);
            control.removeAttribute(builder.RESERVED_ERROR_ATTR);
            if (fieldEl._selectTokenUi && fieldEl._selectTokenUi.tokenInput) {
                builder.setError(fieldEl._selectTokenUi.tokenInput, null);
            }

            let raw = control.value;
            let val = typeof raw === "string" ? raw.trim() : raw;

            const tokenUi = fieldEl._selectTokenUi || null;
            if (tokenUi && tokenUi.select === control && control.value === SELECT_TOKEN_SENTINEL) {
                const tokenVal = resolveSelectValueForSerialization({
                    selectValue: control.value,
                    tokenValue: tokenUi.tokenInput?.value
                });
                if (!tokenVal) {
                    builder.setError(tokenUi.tokenInput || control, "This field is required");
                    note(tokenUi.tokenInput || control, {missing: required});
                    ok = false;
                    return;
                }
                if (!isTokenizedSelectValue(tokenVal)) {
                    builder.setError(
                        tokenUi.tokenInput || control,
                        "Use a variable token like {var:preset}"
                    );
                    note(tokenUi.tokenInput || control);
                    ok = false;
                    return;
                }
                // A variable token is resolved at runtime from custom-step inputs,
                // so its value can't be checked against the fixed enum options here.
                return;
            }

            // Before the empty-field skip: an empty argsJson is exactly when a
            // custom step input's default would hide a row variable.
            const reservedMsg = builder.reservedVariableConflict(lineEl, fieldEl.dataset.fieldName, val);
            if (reservedMsg) {
                builder.setError(control, reservedMsg);
                control.setAttribute(builder.RESERVED_ERROR_ATTR, "true");
                // A call's inputs hide their JSON text: the error leads to
                // the first of their fields.
                note(control.hidden
                    ? (fieldEl.querySelector(".runcustomstep-dynamic-inputs input, .runcustomstep-dynamic-inputs textarea, .runcustomstep-dynamic-inputs button") || control)
                    : control);
                ok = false;
                return;
            }

            if (!required && !val) return;

            if (type === "boolean") {
                if (val !== "true" && val !== "false") {
                    builder.setError(control, "Choose true or false");
                    note(control, {missing: required && String(val) === ""});
                    ok = false;
                }
                return;
            }

            if (allowed && allowed.length) {
                if (!allowed.map(String).includes(String(val))) {
                    builder.setError(control, `Choose one of: ${allowed.join(", ")}`);
                    note(control, {missing: required && String(val) === ""});
                    ok = false;
                    return;
                }
                return;
            }

            if (type === "number") {
                const integer = fieldEl.dataset.integer === "true";
                if (val === "" || !parseNumberFieldText(val, {integer})) {
                    builder.setError(control, val === "" && required
                        ? "This number is required"
                        : (integer
                            ? "Provide a whole number or a variable such as {var:count}"
                            : "Provide a number or a variable such as {var:count}"));
                    note(control, {missing: required && val === ""});
                    ok = false;
                }
                return;
            }

            // Read from the environment where it runs: nothing to type.
            if (required && String(val) === "" && fieldEl.dataset.secretEnv) return;

            // A secret (a password) is never saved, so a config loaded back
            // has it empty: when the value read leaves secrets out anyway,
            // an empty one is not a reason to refuse the rest.
            if (required && String(val) === "" && builder.secretsOptional
                && fieldEl.querySelector(".sb-input-with-icon[data-secret='true']")) {
                return;
            }

            if (required && String(val) === "") {
                builder.setError(control, "This field is required");
                note(control, {missing: true});
                ok = false;
                return;
            }

            // A selector the browser can't parse fails the scan, so it is
            // caught here, before a run. One with a {var:...} token is only
            // known at runtime.
            // An id the engine does not have would run nothing, or every
            // rule: a typo is caught here, before a run.
            if (fieldEl.dataset.ruleIds === "true" && val) {
                const unknown = builder.unknownRuleIds(val);
                if (unknown.length) {
                    const name = builder.engineOfLine(lineEl) || "The engine";
                    builder.setError(control, unknown.length === 1
                        ? `${name} has no rule named "${unknown[0]}"`
                        : `${name} has no rules named ${unknown.map((id) => `"${id}"`).join(", ")}`);
                    note(control);
                    ok = false;
                    return;
                }
            }

            if (fieldEl.dataset.cssSelector === "true" && val && !String(val).includes("{")) {
                const bad = builder.invalidCssSelector(String(val));
                if (bad !== null) {
                    builder.setError(control, `"${bad}" is not a valid CSS selector`);
                    note(control);
                    ok = false;
                }
            }
        });

        // Set color scheme and contrast keeps an empty field as it is, so with
        // both empty it would change nothing: the run refuses it, so it is
        // caught here.
        if (ok && lineEl.dataset.actionType === "setColorScheme") {
            const scheme = lineEl.querySelector(':scope > .fields > .field[data-field-name="colorScheme"] select');
            const contrast = lineEl.querySelector(':scope > .fields > .field[data-field-name="highContrast"] select');
            if (scheme && contrast && scheme.value === "" && contrast.value === "") {
                builder.setError(scheme, "Choose a color scheme, high contrast, or both");
                note(scheme, {missing: true});
                ok = false;
            }
        }

        // Set language needs a language: from the list, typed in Other
        // language, or Run default. A typed one is checked here, unless a
        // variable gives it, which is only known at runtime.
        if (ok && lineEl.dataset.actionType === "setLanguage") {
            const listed = lineEl.querySelector(':scope > .fields > .field[data-field-name="language"] select');
            const typed = lineEl.querySelector(':scope > .fields > .field[data-field-name="customLanguage"] input');
            const typedVal = typed ? typed.value.trim() : "";
            if (listed && typed && listed.value === "" && typedVal === "") {
                builder.setError(listed, "Choose a language, or type one in Other language");
                note(listed, {missing: true});
                ok = false;
            } else if (typed && typedVal && !typedVal.includes("{") && typedVal.toLowerCase() !== "default") {
                let valid = false;
                try { valid = Intl.getCanonicalLocales(typedVal).length === 1; } catch { valid = false; }
                if (!valid) {
                    builder.setError(typed, `"${typedVal}" is not a language tag: use one such as es-MX, fr-CA or zh-Hant-HK`);
                    note(typed);
                    ok = false;
                }
            }
        }

        // Then validate nested arrays and their child lines recursively
        lineEl.querySelectorAll(":scope .action-array").forEach((arrWrap) => {
            const isRequired = arrWrap.dataset.required === "true";
            const sub = arrWrap.querySelector(".actions-subcontainer");
            const items = Array.from(sub.querySelectorAll(":scope > .line"));

            builder.setError(arrWrap, null);

            if (isRequired && items.length === 0) {
                builder.setError(arrWrap, "At least one action is required");
                note(arrWrap, {missing: true});
                ok = false;
                return;
            }

            for (const child of items) {
                const childOk = validateLine(child, report);
                if (!childOk) {
                    ok = false;
                    builder.setError(arrWrap, "Some nested actions have errors");
                    break;
                }
            }
        });

        if (!ok && report) report.invalidLines.add(lineEl);

        return ok;
    }

    /**
     * A collapsed step hides its fields, so the error message validation just
     * wrote would sit off screen and its control could not even take focus.
     * Clear the way to it the same way the step tree does when you pick a step
     * in it: everything collapses except the steps that failed and the steps
     * nesting them, which are expanded.
     */
    function revealInvalidLines(container, invalidLines) {
        const keepOpen = new Set();
        invalidLines.forEach((lineEl) => {
            let node = lineEl;
            while (node && container.contains(node)) {
                keepOpen.add(node);
                node = node.parentElement ? node.parentElement.closest(".line") : null;
            }
        });

        container.querySelectorAll(".line").forEach((lineEl) => {
            if (!keepOpen.has(lineEl)) builder.collapseAction(lineEl);
        });

        keepOpen.forEach((lineEl) => {
            builder.expandAction(lineEl);
            revealAdvancedFieldsWithErrors(lineEl);
        });
    }

    /** Same for a flagged field parked behind the step's "show more" toggle. */
    function revealAdvancedFieldsWithErrors(lineEl) {
        if (typeof lineEl._expandAdvancedFields !== "function") return;
        const flagged = lineEl.querySelector(
            ':scope > .fields > .field.is-advanced[aria-invalid="true"],' +
            ':scope > .action-arrays-below > .action-array.is-advanced[aria-invalid="true"]'
        );
        if (flagged) lineEl._expandAdvancedFields();
    }

    function validateContainer(container, {reveal = true} = {}) {
        let allOk = true;
        let firstInvalidLine = null;
        const report = {invalidLines: new Set(), firstMissingRequired: null, firstError: null};
        const lines = builder.listLines(container);
        for (const line of lines) {
            const ok = validateLine(line, report);
            if (!ok) {
                allOk = false;
                if (!firstInvalidLine) firstInvalidLine = line;
            }
        }
        if (allOk) return {allOk, firstFocusTarget: null};

        if (reveal) revealInvalidLines(container, report.invalidLines);
        // The caret goes to the first empty required field - the thing the user
        // has to type into - and only falls back to another kind of error, or to
        // the step itself, when there is no such field.
        const firstFocusTarget =
            report.firstMissingRequired || report.firstError || firstInvalidLine;
        return {allOk, firstFocusTarget};
    }

    return {
        validateContainer,
    };
}
