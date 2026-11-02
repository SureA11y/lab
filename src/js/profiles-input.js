'use strict';

// The scan step's Profile field: what the scan checks against. One WCAG level
// (or none), as radios, since each level includes the ones below it, and any
// of the standards the installed packs bring, as checkboxes, so a scan can
// check against several at once. Or a variable, which holds one profile or
// several separated by commas.
//
// Its value is what the step saves: one profile as a string, as a step always
// has, several as a list in the order core scans them (the WCAG level first),
// or the variable token.

import {createEl} from './a11y-ui.utils.js';

const WCAG_ID = /^wcag22-a{1,3}$/;
const NO_WCAG = "";
// EN 301 549 V4.1.1 restates WCAG 2.2 A and AA, so beside a WCAG level it
// checks the same criteria again, under its own name.
const RESTATES_WCAG = new Set(["en301549-v4.1.1", "en301549-v3.2.1"]);

export function isProfileToken(value) {
    return typeof value === "string" && /\{var:[^}]+\}/.test(value);
}

/**
 * The profiles a value names, split into a WCAG level and the standards:
 * { wcag, standards, token }. A string may name several separated by commas.
 */
export function splitProfiles(value, {wcagIds = []} = {}) {
    if (isProfileToken(value)) return {wcag: NO_WCAG, standards: [], token: value.trim(), extraLevels: []};
    const raw = Array.isArray(value) ? value : (typeof value === "string" ? value.split(",") : []);
    const items = raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
    // A list with a variable in it is one value to fill in, as the run
    // reads it: its items separated by commas.
    if (items.some(isProfileToken)) return {wcag: NO_WCAG, standards: [], token: items.join(","), extraLevels: []};
    // Each id once, matched without case; one no choice has is kept as given.
    const ids = [];
    for (const item of items) {
        if (!ids.some((id) => id.toLowerCase() === item.toLowerCase())) ids.push(item);
    }
    const isWcag = (id) => wcagIds.includes(id.toLowerCase()) || WCAG_ID.test(id.toLowerCase());
    const levels = ids.filter(isWcag).map((id) => id.toLowerCase());
    return {wcag: levels[0] || NO_WCAG, standards: ids.filter((id) => !isWcag(id)), token: "", extraLevels: levels.slice(1)};
}

/** What a step saves: nothing, one id, or the list, the WCAG level first. */
export function joinProfiles({wcag, standards, token}) {
    if (token) return token;
    const ids = [...(wcag ? [wcag] : []), ...standards];
    if (!ids.length) return "";
    return ids.length === 1 ? ids[0] : ids;
}

/**
 * choices: [{ value, label }], the field's options, the WCAG levels among
 * them by id. defaultValue: the field's default, chosen at the start.
 * -> { el, getValue, setValue, validate, focusTarget }
 */
export function buildProfilesControl({fieldId, labelText, choices = [], defaultValue = "", errorId, onChange} = {}) {
    const emit = () => { if (typeof onChange === "function") onChange(); };
    const wcagChoices = choices.filter((c) => WCAG_ID.test(c.value));
    const standardChoices = choices.filter((c) => !WCAG_ID.test(c.value));
    const labelOf = (id) => (choices.find((c) => c.value === id) || {}).label || id;
    const radioName = `${fieldId}__wcag`;

    const root = createEl("fieldset", {className: "profiles-input", id: fieldId});
    if (errorId) root.setAttribute("aria-describedby", errorId);
    root.append(createEl("legend", {className: "profiles-input__legend"}, labelText));

    const groups = createEl("div", {className: "profiles-input__groups"});

    const wcagSet = createEl("fieldset", {className: "profiles-input__group"});
    wcagSet.append(createEl("legend", {}, "WCAG 2.2"));
    const radios = [];
    for (const c of [...wcagChoices, {value: NO_WCAG, label: "Don’t check WCAG"}]) {
        const input = createEl("input", {type: "radio", name: radioName, value: c.value});
        radios.push(input);
        // "WCAG 2.2 AA" under the WCAG 2.2 legend reads as "Level AA".
        const text = c.value ? c.label.replace(/^WCAG 2\.2\s+/, "Level ") : c.label;
        wcagSet.append(createEl("label", {className: "profiles-input__option"}, [input, " ", text]));
    }

    const standardSet = createEl("fieldset", {className: "profiles-input__group"});
    standardSet.append(createEl("legend", {}, "Standards"));
    const boxes = [];
    for (const c of standardChoices) {
        const input = createEl("input", {type: "checkbox", value: c.value});
        boxes.push(input);
        standardSet.append(createEl("label", {className: "profiles-input__option"}, [input, " ", c.label]));
    }
    // A saved step may name a standard whose pack is not installed here: it
    // is a checkbox of its own, ticked, so it can be kept or taken off.
    const missingNote = createEl("small", {className: "profiles-input__help"}, "");
    missingNote.hidden = true;
    const packsNote = createEl("small", {className: "profiles-input__help"}, "From the installed packs.");
    standardSet.append(packsNote, missingNote);
    groups.append(wcagSet, standardSet);
    const unknownBoxes = [];
    function unknownBox(id) {
        const input = createEl("input", {type: "checkbox", value: id});
        input.checked = true;
        const label = createEl("label", {className: "profiles-input__option"}, [input, " ", `${id} (no installed pack has it)`]);
        standardSet.insertBefore(label, packsNote);
        unknownBoxes.push(input);
        return input;
    }
    // A step saved with two WCAG levels keeps the first; this says so.
    const levelsNote = createEl("p", {className: "profiles-input__note"}, "");
    levelsNote.hidden = true;

    const tokenToggle = createEl("input", {type: "checkbox", className: "profiles-input__token-toggle"});
    const tokenInput = createEl("input", {type: "text", className: "select-token-input", placeholder: "e.g. {var:profile}"});
    tokenInput.setAttribute("aria-label", `${labelText} variable token`);
    const tokenHelp = createEl("small", {className: "field-help"},
        "A variable token like {var:profile}. Its value is one profile, or several separated by commas, such as wcag22-aa,wai-aria-1.2.");
    const tokenRow = createEl("div", {className: "profiles-input__token"}, [
        createEl("label", {className: "profiles-input__option"}, [tokenToggle, " From a variable…"]),
        tokenInput,
        tokenHelp,
    ]);

    const overlap = createEl("p", {className: "profiles-input__note"}, "");
    overlap.hidden = true;
    const summary = createEl("p", {className: "profiles-input__summary"}, "");
    summary.setAttribute("aria-live", "polite");

    root.append(levelsNote, groups, tokenRow, overlap, summary);

    function current() {
        if (tokenToggle.checked) return {wcag: NO_WCAG, standards: [], token: tokenInput.value.trim() || ""};
        const radio = radios.find((r) => r.checked);
        return {
            wcag: radio ? radio.value : NO_WCAG,
            standards: [...boxes, ...unknownBoxes].filter((b) => b.checked).map((b) => b.value),
            token: "",
        };
    }

    function sync() {
        const tokenMode = tokenToggle.checked;
        tokenInput.hidden = !tokenMode;
        tokenHelp.hidden = !tokenMode;
        groups.hidden = tokenMode;
        const value = current();
        const ids = [...(value.wcag ? [value.wcag] : []), ...value.standards];
        if (tokenMode) {
            summary.textContent = "This scan checks the profiles the variable names.";
        } else {
            summary.textContent = ids.length
                ? `This scan checks: ${ids.map(labelOf).join(" + ")}`
                : "Choose a WCAG level or a standard.";
        }
        const restated = value.wcag ? value.standards.filter((id) => RESTATES_WCAG.has(id)) : [];
        overlap.hidden = tokenMode || !restated.length;
        overlap.textContent = restated.length
            ? `${restated.map(labelOf).join(" and ")} restate${restated.length === 1 ? "s" : ""} WCAG Level A and AA: beside ${labelOf(value.wcag)} the scan checks those criteria again, under the standard’s name.`
            : "";
        const missing = unknownBoxes.filter((b) => b.checked).map((b) => b.value);
        missingNote.hidden = !missing.length;
        missingNote.textContent = missing.length
            ? `No installed pack has ${missing.join(", ")}: the run stops, saying so, unless its pack is installed or it is taken off.`
            : "";
    }

    function setValue(value) {
        let parts = splitProfiles(value, {wcagIds: wcagChoices.map((c) => c.value)});
        // Nothing named is what a step without a profile checks: the default.
        if (!parts.token && !parts.wcag && !parts.standards.length) {
            parts = splitProfiles(defaultValue, {wcagIds: wcagChoices.map((c) => c.value)});
        }
        tokenToggle.checked = !!parts.token;
        tokenInput.value = parts.token;
        radios.forEach((r) => { r.checked = r.value === parts.wcag; });
        if (!radios.some((r) => r.checked)) radios.find((r) => r.value === NO_WCAG).checked = true;
        const named = (b) => parts.standards.some((id) => id.toLowerCase() === b.value);
        boxes.forEach((b) => { b.checked = named(b); });
        for (const box of unknownBoxes.splice(0)) box.closest("label").remove();
        for (const id of parts.standards) {
            if (!boxes.some((b) => b.value === id.toLowerCase())) unknownBox(id);
        }
        // Two WCAG levels: each includes the ones below it, so the step keeps
        // the first, and says which it left out.
        const extra = (parts.extraLevels || []).filter((id) => id !== parts.wcag);
        levelsNote.hidden = !extra.length;
        levelsNote.textContent = extra.length
            ? `This step named more than one WCAG level (${[parts.wcag, ...extra].map(labelOf).join(", ")}). A scan checks one, since each includes the ones below it: ${labelOf(parts.wcag)} is chosen, as the first. Choose the one you want.`
            : "";
        sync();
    }

    function getValue() {
        return joinProfiles(current());
    }

    /** An error message for what is chosen, or null. */
    function validate({required = false} = {}) {
        const value = current();
        if (tokenToggle.checked) {
            if (!value.token) return {message: "Give the variable token, like {var:profile}", el: tokenInput};
            if (!isProfileToken(value.token)) return {message: "Use a variable token like {var:profile}", el: tokenInput};
            return null;
        }
        const chosen = radios.find((r) => r.checked) || radios[0];
        const levels = [value.wcag, ...value.standards.filter((id) => WCAG_ID.test(id))].filter(Boolean);
        if (levels.length > 1) return {message: "Choose one WCAG level: each includes the ones below it", el: chosen};
        // "Don't check WCAG" with no standard would save no profile, and the
        // scan would check WCAG 2.2 AA after all.
        if (!value.wcag && !value.standards.length) {
            return {message: required ? "Choose a WCAG level or a standard" : "Choose a standard, or a WCAG level: with neither, the scan checks WCAG 2.2 AA", el: chosen};
        }
        return null;
    }

    root.addEventListener("change", (e) => {
        if (e.target === tokenToggle && tokenToggle.checked) tokenInput.focus();
        // A level chosen settles which of several the step named.
        if (e.target && e.target.name === radioName) levelsNote.hidden = true;
        sync();
        emit();
    });
    tokenInput.addEventListener("input", () => { sync(); emit(); });

    setValue(defaultValue);

    return {el: root, getValue, setValue, validate, focusTarget: () => radios.find((r) => r.checked) || radios[0]};
}
