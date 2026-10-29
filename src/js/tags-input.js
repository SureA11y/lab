'use strict';

// The tag / token-entry control and its pure helpers, shared by the workflow
// builder's `scanTags` field and the per-scan tag editor in the results view so
// both offer the same chips, suggestions and keyboard model.

import {createEl} from './a11y-ui.utils.js';

// Normalize a scanTags value (array, or comma-separated string) into an ordered
// array: trimmed, empties dropped, de-duplicated case-insensitively while
// keeping the first-seen casing/order. Pure; backs the tag-input widget and is
// unit-tested directly.
export function normalizeTagList(value) {
    const arr = Array.isArray(value)
        ? value
        : (typeof value === "string" ? value.split(",") : []);
    const out = [];
    const seen = new Set();
    for (const raw of arr) {
        const tag = String(raw == null ? "" : raw).trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
    }
    return out;
}

// Filter a suggestion pool for the tag input: drop already-taken tags, match the
// typed substring (case-insensitive), de-dupe, and cap at `limit`. Pure.
export function filterTagSuggestions(pool, { typed = "", taken = [], limit = 8 } = {}) {
    const takenSet = new Set((taken || []).map((t) => String(t).toLowerCase()));
    const typedLc = String(typed || "").trim().toLowerCase();
    const seen = new Set();
    const out = [];
    for (const raw of (pool || [])) {
        const val = String(raw);
        const key = val.toLowerCase();
        if (takenSet.has(key) || seen.has(key)) continue;
        if (typedLc && !key.includes(typedLc)) continue;
        seen.add(key);
        out.push(val);
        if (out.length >= limit) break;
    }
    return out;
}

// A tag / token-entry control: removable chips + free-text add + a suggestion
// listbox fed from `getSuggestions`. The canonical value is the ordered `tags`
// array, exposed via getTags/setTags.
export function buildTagsInputControl({ fieldId, labelText, isRequired, placeholder, getSuggestions, onChange } = {}) {
    let tags = [];
    let activeIndex = -1;

    const norm = (v) => String(v == null ? "" : v).trim();
    const emitChange = () => { if (typeof onChange === "function") onChange(); };

    const chipList = createEl("span", { className: "tag-input__chips" });
    const entry = createEl("input", {
        type: "text",
        id: fieldId,
        className: "tag-input__entry",
        placeholder: placeholder != null ? String(placeholder) : "Add a tag…",
        autocomplete: "off",
    });
    entry.setAttribute("role", "combobox");
    entry.setAttribute("aria-autocomplete", "list");
    entry.setAttribute("aria-expanded", "false");
    entry.setAttribute("aria-label", `${labelText}: type to add a tag`);
    if (isRequired) entry.setAttribute("aria-required", "true");

    // Inline "add" affordance: hidden until the user types something, then
    // acts exactly like pressing Enter. More discoverable than Enter alone.
    const addBtn = createEl("button", { type: "button", className: "tag-input__add", hidden: true }, "+");
    addBtn.setAttribute("aria-label", "Add tag");

    const listId = `${fieldId}__suggest`;
    const listbox = createEl("ul", { className: "tag-input__listbox", id: listId, hidden: true });
    listbox.setAttribute("role", "listbox");
    entry.setAttribute("aria-controls", listId);

    const el = createEl("div", { className: "tag-input" }, [chipList, entry, addBtn, listbox]);

    // Show the add button only when there is text to commit.
    function syncAddBtn() { addBtn.hidden = norm(entry.value) === ""; }

    // Commit the free-typed text as a tag (shared by Enter and the + button).
    function commitTyped() {
        if (norm(entry.value)) addTag(entry.value);
        entry.value = "";
        syncAddBtn();
        openList();
    }

    function renderChips() {
        chipList.textContent = "";
        tags.forEach((tag, i) => {
            const remove = createEl(
                "button",
                { type: "button", className: "scan-tag__remove" },
                "×"
            );
            remove.setAttribute("aria-label", `Remove tag ${tag}`);
            remove.addEventListener("click", () => { removeTag(i); entry.focus(); });
            const chip = createEl(
                "span",
                { className: "scan-tag scan-tag--removable" },
                [document.createTextNode(tag), remove]
            );
            chipList.append(chip);
        });
    }

    function addTag(value) {
        const v = norm(value);
        if (!v) return false;
        if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) return false;
        tags.push(v);
        renderChips();
        emitChange();
        return true;
    }

    function removeTag(idx) {
        if (idx < 0 || idx >= tags.length) return;
        tags.splice(idx, 1);
        renderChips();
        emitChange();
    }

    function closeList() {
        listbox.hidden = true;
        listbox.textContent = "";
        entry.setAttribute("aria-expanded", "false");
        entry.removeAttribute("aria-activedescendant");
        activeIndex = -1;
    }

    function currentSuggestions() {
        const pool = (typeof getSuggestions === "function" ? getSuggestions() : []) || [];
        return filterTagSuggestions(pool, { typed: entry.value, taken: tags, limit: 8 });
    }

    function openList() {
        const items = currentSuggestions();
        listbox.textContent = "";
        if (!items.length) { closeList(); return; }
        items.forEach((val, i) => {
            const opt = createEl("li", { className: "tag-input__option", id: `${listId}__${i}` }, val);
            opt.setAttribute("role", "option");
            // mousedown (not click) so it fires before the entry's blur.
            opt.addEventListener("mousedown", (e) => {
                e.preventDefault();
                addTag(val);
                entry.value = "";
                syncAddBtn();
                openList();
            });
            listbox.append(opt);
        });
        listbox.hidden = false;
        entry.setAttribute("aria-expanded", "true");
        activeIndex = -1;
    }

    function setActive(nextIndex) {
        const opts = Array.from(listbox.querySelectorAll(".tag-input__option"));
        if (!opts.length) return;
        activeIndex = (nextIndex + opts.length) % opts.length;
        opts.forEach((o, idx) => o.classList.toggle("is-active", idx === activeIndex));
        entry.setAttribute("aria-activedescendant", opts[activeIndex].id);
        opts[activeIndex].scrollIntoView({ block: "nearest" });
    }

    // The + button lives inside .tag-input, so clicking it would blur the
    // entry first; preventDefault on mousedown keeps focus, then click
    // commits and returns focus (the button hides itself once empty).
    addBtn.addEventListener("mousedown", (e) => e.preventDefault());
    addBtn.addEventListener("click", () => { commitTyped(); entry.focus(); });

    entry.addEventListener("input", () => { openList(); syncAddBtn(); });
    entry.addEventListener("focus", openList);
    entry.addEventListener("blur", () => { setTimeout(closeList, 120); });
    entry.addEventListener("keydown", (e) => {
        const opts = Array.from(listbox.querySelectorAll(".tag-input__option"));
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (activeIndex >= 0 && opts[activeIndex]) {
                addTag(opts[activeIndex].textContent);
                entry.value = "";
                syncAddBtn();
                openList();
            } else {
                commitTyped();
            }
        } else if (e.key === "Backspace" && entry.value === "" && tags.length) {
            removeTag(tags.length - 1);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (listbox.hidden) openList(); else setActive(activeIndex + 1);
        } else if (e.key === "ArrowUp") {
            // With nothing active yet, ArrowUp enters the list from the bottom.
            if (!listbox.hidden) { e.preventDefault(); setActive(activeIndex < 0 ? opts.length - 1 : activeIndex - 1); }
        } else if (e.key === "Escape") {
            if (!listbox.hidden) { e.preventDefault(); closeList(); }
        }
    });
    entry.addEventListener("paste", (e) => {
        const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
        if (text.includes(",")) {
            e.preventDefault();
            text.split(",").forEach(addTag);
            entry.value = "";
            syncAddBtn();
            openList();
        }
    });

    renderChips();

    return {
        el,
        entry,
        getTags: () => tags.slice(),
        setTags: (arr) => {
            tags = normalizeTagList(arr);
            renderChips();
        },
    };
}
