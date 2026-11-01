// The step editor's toolbar and command palette: the steps offered, grouped
// and in order, the recently used, and the palette that finds a step by name.
// Moved out of actions-builder.module.js's createActionsBuilder; what it
// shares with the rest of the editor it reaches through `builder`.

import {createEl, iconButton, svgIcon} from './a11y-ui.utils.js';
import {SHORTCUTS, clipboardAction, registerPasteButton} from './actions-builder.module.js';

/**
 * builder: accessors for what the rest shares with this part
 * (actionsEl, addShortcuts, defs, focusFirstInput, isListedType, listedDefs, makeLine, moveLine, populateLineFromObject, pushHistory, randomId, refreshReorderButtons, rootAddLine, toolbarTargets).
 */
export function createStepPalette(builder) {
    // ---- Catalog helpers: categories, sorting, toolbar order ----
    function getActionLabel([key, def]) {
        return String(def?.label || key);
    }

    function normalizeCategory(def) {
        const raw = String(def?.category || "").trim();
        return raw ? raw : "general";
    }

    function groupAndSortDefs(defsObj) {
        const entries = Object.entries(defsObj);
        const byCategory = new Map();
        for (const e of entries) {
            const def = e[1];
            const cat = normalizeCategory(def);
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat).push(e);
        }
        for (const [cat, list] of byCategory) {
            list.sort((a, b) => getActionLabel(a).localeCompare(getActionLabel(b)));
        }
        const categoryOrder = Array.from(byCategory.keys()).sort((a, b) =>
            a.localeCompare(b)
        );
        return {byCategory, categoryOrder};
    }

    function getToolbarOrderedEntries(defsObj) {
        const entries = Object.entries(defsObj);
        const primaryKey = "a11yScan";
        const primary = entries.find(([k]) => k === primaryKey);
        const rest = entries
            .filter(([k]) => k !== primaryKey)
            .sort((a, b) => getActionLabel(a).localeCompare(getActionLabel(b)));
        return primary ? [primary, ...rest] : rest;
    }

    // ---- Palette catalog and recent memory ----
    const RECENT_MAX = 6;
    const recentKeys = [];

    function pushRecent(key) {
        const i = recentKeys.indexOf(key);
        if (i !== -1) recentKeys.splice(i, 1);
        recentKeys.unshift(key);
        if (recentKeys.length > RECENT_MAX) recentKeys.pop();
    }

    // ---- Command palette ----
    function showCommandPalette({onPick}) {
        const {byCategory, categoryOrder} = groupAndSortDefs(builder.listedDefs());

        const dialogId = builder.randomId("sb-palette");
        const titleId = builder.randomId("sb-palette-title");

        const dlg = createEl("dialog", {
            id: dialogId,
            className: "src-dialog sb-palette",
            role: "dialog",
            "aria-labelledby": titleId,
            "aria-modal": "true"
        });

        const header = createEl("div", {className: "src-dialog-header"}, [
            createEl("p", {id: titleId, className: "src-dialog-title"}, "Add an action to the workflow"),
            createEl("p", {className: "src-dialog-meta"}, "Type to filter, use arrows to navigate, Enter to add")
        ]);

        const search = createEl("input", {
            type: "text",
            className: "sb-palette-search",
            placeholder: "Search actions by name, category, or description",
            "aria-autocomplete": "list",
            "aria-haspopup": "listbox"
        });

        const live = createEl("div", {
            className: "visually-hidden",
            role: "status"
        });

        const listboxId = `${dialogId}-listbox`;
        const resultsWrap = createEl("div", {className: "sb-palette-results"});
        const listbox = createEl("ul", {
            role: "listbox",
            id: listboxId,
            className: "sb-palette-listbox"
        });
        resultsWrap.append(listbox);

        const footer = createEl("div", {className: "src-dialog-footer"}, [
            createEl("span", {}),
            createEl("button", {type: "button", className: "src-dialog-close"}, "Close")
        ]);

        search.setAttribute("aria-controls", listboxId);

        dlg.append(
            header,
            createEl("div", {className: "src-dialog-body"}, [search, live, resultsWrap]),
            footer
        );

        let options = [];
        let activeIndex = -1;

        function makeOption(key, def) {
            const id = builder.randomId("sbopt");

            const btn = createEl(
                "button",
                {
                    type: "button",
                    className: "sb-palette-btn",
                    tabindex: "-1", // we keep focus on the search input
                    "data-key": key
                },
                [
                    createEl("div", {className: "sb-palette-btn-title"}, def.label || key),
                ]
            );

            const li = createEl(
                "li",
                {
                    role: "option",
                    id,
                    className: "sb-palette-item",
                    tabindex: "-1",
                    "data-key": key,
                    "aria-selected": "false"
                },
                [btn]
            );

            // Hover moves the active highlight
            li.addEventListener("mousemove", () => {
                const idx = options.indexOf(li);
                if (idx !== -1 && idx !== activeIndex) setActive(idx);
            });

            // Click chooses
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const idx = options.indexOf(li);
                if (idx !== -1) setActive(idx);
                chooseActive();
            });

            return li;
        }

        function itemMatches(key, def, q) {
            if (!q) return true;
            const hay = [key, def?.label || "", def?.category || "", def?.description || ""]
                .join(" ")
                .toLowerCase();
            return hay.includes(q.toLowerCase());
        }

        function renderList(filterText = "") {
            listbox.innerHTML = "";
            options = [];
            activeIndex = -1;

            let count = 0;

            const appendHeader = (text) => {
                const header = createEl(
                    "li",
                    {role: "presentation", className: "sb-palette-group-title"},
                    text
                );
                listbox.append(header);
            };

            const appendOption = (k, d) => {
                const li = makeOption(k, d);
                listbox.append(li);
                options.push(li);
                count++;
            };

            for (const cat of categoryOrder) {
                const entries = (byCategory.get(cat) || []).filter(([k, d]) =>
                    itemMatches(k, d, filterText)
                );
                if (!entries.length) continue;

                appendHeader(cat);
                for (const [k, d] of entries) appendOption(k, d);
            }

            live.textContent = `${count} result${count === 1 ? "" : "s"}`;

            if (options.length) setActive(0);
            else {
                activeIndex = -1;
                search.removeAttribute("aria-activedescendant");
            }
        }

        function setActive(newIndex) {
            if (!options.length) {
                activeIndex = -1;
                search.removeAttribute("aria-activedescendant");
                return;
            }

            newIndex = Math.max(0, Math.min(newIndex, options.length - 1));

            // Clear previous active option
            if (activeIndex >= 0 && options[activeIndex]) {
                const prev = options[activeIndex];
                prev.setAttribute("aria-selected", "false");
                prev.classList.remove("is-active");

                // Also clear visual state on the inner button (if present)
                const prevBtn = prev.querySelector(".sb-palette-btn");
                if (prevBtn) prevBtn.classList.remove("is-active");
            }

            // Set new active option
            activeIndex = newIndex;
            const opt = options[activeIndex];

            opt.setAttribute("aria-selected", "true");
            opt.classList.add("is-active");

            // Also mark the inner button as active
            const btn = opt.querySelector(".sb-palette-btn");
            if (btn) btn.classList.add("is-active");

            search.setAttribute("aria-activedescendant", opt.id);
            opt.scrollIntoView({block: "nearest"});
        }

        function moveActive(delta) {
            if (!options.length) return;
            const target = activeIndex < 0 ? 0 : activeIndex + delta;
            setActive(target);
        }

        function pageMove(count) {
            if (!options.length) return;
            const target = activeIndex < 0 ? 0 : activeIndex + count;
            setActive(target);
        }

        function chooseActive() {
            if (activeIndex < 0 || !options[activeIndex]) return;
            const key = options[activeIndex].getAttribute("data-key");
            pushRecent(key);
            try {
                dlg.close("pick");
            } catch {
            }
            dlg.remove();
            onPick?.(key);
        }

        dlg.addEventListener("close", () => dlg.remove());
        dlg.querySelector(".src-dialog-close").addEventListener("click", () => dlg.close("cancel"));
        dlg.addEventListener("click", (e) => {
            if (e.target === dlg) dlg.close("cancel");
        });

        search.addEventListener("input", () => renderList(search.value));

        search.addEventListener("keydown", (e) => {
            const key = e.key;
            if (key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                return dlg.close("cancel");
            }
            if (key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                return chooseActive();
            }
            if (key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                return moveActive(+1);
            }
            if (key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                return moveActive(-1);
            }
            if (key === "Home") {
                e.preventDefault();
                e.stopPropagation();
                return setActive(0);
            }
            if (key === "End") {
                e.preventDefault();
                e.stopPropagation();
                return setActive(options.length - 1);
            }
            if (key === "PageDown") {
                e.preventDefault();
                e.stopPropagation();
                return pageMove(+10);
            }
            if (key === "PageUp") {
                e.preventDefault();
                e.stopPropagation();
                return pageMove(-10);
            }
        });

        document.body.appendChild(dlg);
        if (typeof dlg.showModal === "function") dlg.showModal();
        renderList("");
        search.focus();
    }

    // ---- Mount UI ----
    function mountToolbar(targetEl) {
        targetEl.innerHTML = "";

        const toolbarWrap = createEl("div", {className: "toolbar-favorites"});

        const shortcutCallback = (shortcut) => {
            return () => {
                const line = builder.makeLine(shortcut, builder.defs[shortcut], (lineEl, dir, btnRef) =>
                    builder.moveLine(builder.actionsEl, lineEl, dir, btnRef)
                );
                builder.rootAddLine(line);
                pushRecent(shortcut);
                builder.focusFirstInput(line);
                builder.refreshReorderButtons(builder.actionsEl);
                builder.pushHistory("toolbar:addShortcut");
            }
        }
        builder.addShortcuts(SHORTCUTS, shortcutCallback, toolbarWrap);

        const addAnyBtn = createEl(
            "button",
            {
                type: "button",
                className: "secondary-button icon-button",
                title: "Add any action (Ctrl/⌘+K)",
                ariaLabel: "Add any action (Ctrl/⌘+K)"
            },
            svgIcon('add')
        );

        addAnyBtn.addEventListener("click", () => {
            showCommandPalette({
                onPick: (key) => {
                    const def = builder.defs[key];
                    if (!def) return;
                    const line = builder.makeLine(key, def, (lineEl, dir, btnRef) =>
                        builder.moveLine(builder.actionsEl, lineEl, dir, btnRef)
                    );
                    builder.rootAddLine(line);
                    pushRecent(key);
                    builder.focusFirstInput(line);
                    builder.refreshReorderButtons(builder.actionsEl);
                    builder.pushHistory("toolbar:addAny");
                }
            });
        });
        toolbarWrap.append(addAnyBtn);

        const pasteBtn = iconButton({
            className: "secondary-button icon-button paste-button",
            ariaLabel: "Paste action",
            title: "Paste action",
            iconName: "paste"
        });
        registerPasteButton(pasteBtn, builder.isListedType);

        pasteBtn.addEventListener("click", () => {
            if (!clipboardAction || !builder.isListedType(clipboardAction.type)) return;
            const def = builder.defs[clipboardAction.type];
            if (!def) return;

            const line = builder.makeLine(clipboardAction.type, def, (lineEl, dir, btnRef) =>
                builder.moveLine(builder.actionsEl, lineEl, dir, btnRef)
            );
            builder.rootAddLine(line);
            builder.populateLineFromObject(line, clipboardAction);
            builder.focusFirstInput(line);
            builder.refreshReorderButtons(builder.actionsEl);
            builder.pushHistory("toolbar:paste");
        });

        toolbarWrap.append(pasteBtn);

        targetEl.append(toolbarWrap);

        return {addAnyBtn, pasteBtn};
    }

    // render into all toolbars
    const toolbarMounts = builder.toolbarTargets.map(mountToolbar);

    // only bind Ctrl/⌘+K once, but trigger the first mounted Add action button
    if (!window.__A11YLAB_PALETTE_HOTKEY_BOUND) {
        window.__A11YLAB_PALETTE_HOTKEY_BOUND = true;
        window.addEventListener("keydown", (e) => {
            const isMod = e.ctrlKey || e.metaKey;
            if (isMod && (e.key === "k" || e.key === "K")) {
                e.preventDefault();
                toolbarMounts[0]?.addAnyBtn?.click();
            }
        });
    }

    return {
        pushRecent,
        showCommandPalette,
    };
}
