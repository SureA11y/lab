// A step's buttons on a narrow line: moved into an Actions menu, a menu
// button that opens them, and back when the line is wide again. Moved out of
// actions-builder.module.js's createActionsBuilder; what it shares with the
// rest of the editor it reaches through `builder`.

import {iconButton} from './a11y-ui.utils.js';

/**
 * builder: accessors for what the rest shares with this part
 * (isExplicitDisabled, isInheritedDisabled).
 */
export function createStepActionsMenu(builder) {
    function isEffectivelyDisabled(lineEl) {
        return builder.isExplicitDisabled(lineEl) || builder.isInheritedDisabled(lineEl);
    }

    function ensureId(el, prefix = "id") {
        if (el.id) return el.id;
        el.id = `${prefix}-${Math.random().toString(16).slice(2)}`;
        return el.id;
    }

    function ensureMenuLabel(btn) {
        // Add visible label in menu mode if not present
        let label = btn.querySelector(".flyout-btn-label");
        if (!label) {
            label = document.createElement("span");
            label.className = "flyout-btn-label";
            label.textContent = btn.getAttribute("aria-label") || btn.title || "Action";
            btn.appendChild(label);
        } else {
            // keep it current if aria-label changes
            const txt = btn.getAttribute("aria-label") || btn.title || "Action";
            if (label.textContent !== txt) label.textContent = txt;
        }
    }

    function removeMenuLabel(btn) {
        const label = btn.querySelector(".flyout-btn-label");
        if (label) label.remove();
    }

    /**
     * Turns an existing controls container into a responsive “inline actions or menu actions”
     * WITHOUT cloning buttons. It moves the same buttons between two places.
     *
     * @param {Object} opts
     * @param {HTMLElement} opts.containerEl
     * @param {number} opts.collapseAtPx
     * @param {string} [opts.triggerAriaLabel]
     * @param {string} [opts.triggerClassName]
     * @param {string} [opts.menuClassName]
     * @param {string} [opts.menuIconName]
     * @returns {{ destroy(): void, update(): void, setCollapsed(v:boolean): void }}
     */
    function createResponsiveActionsMenu({
                                             containerEl,
                                             collapseAtPx,
                                             collapseIfFn,
                                             measureEl = containerEl,
                                             triggerAriaLabel = "Open actions menu",
                                             triggerClassName = "secondary-button",
                                             menuClassName = "flyout-menu",
                                             menuIconName = "menu"
                                         } = {}) {
        if (!containerEl) throw new Error("createResponsiveActionsMenu: containerEl is required");
        if (!Number.isFinite(collapseAtPx) || collapseAtPx <= 0) {
            throw new Error("createResponsiveActionsMenu: collapseAtPx must be a positive number");
        }
        if (!measureEl || !(measureEl instanceof Element)) {
            throw new Error("createResponsiveActionsMenu: measureEl must be a DOM Element");
        }
        if (collapseIfFn && typeof collapseIfFn !== 'function') {
            throw new Error("createResponsiveActionsMenu: collapseIfFn is optional but must be a function");
        }

        // Collect source buttons once (these are the ones we will move around)
        // Important: only the direct children that are buttons, avoid picking up future flyout elements.
        const actionButtons = Array.from(containerEl.children).filter(
            (n) => n instanceof HTMLButtonElement
        );

        if (!actionButtons.length) throw new Error("createResponsiveActionsMenu: no action buttons found");

        // Build flyout structure inside the same container
        const flyoutRoot = document.createElement("div");
        flyoutRoot.className = "flyout-root";

        const trigger = iconButton({
            className: triggerClassName,
            ariaLabel: triggerAriaLabel,
            title: triggerAriaLabel,
            iconName: menuIconName,
            type: "button"
        });

        ensureId(trigger, "flyout-trigger");

        const menu = document.createElement("div");
        menu.className = menuClassName;
        menu.setAttribute("role", "menu");
        menu.setAttribute("tabindex", "-1");
        menu.setAttribute("aria-labelledby", trigger.id);
        menu.hidden = true;

        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");

        flyoutRoot.append(trigger, menu);

        containerEl.appendChild(flyoutRoot);

        let isOpen = false;
        let isCollapsed = false;

        function openMenu() {
            if (isOpen) return;
            isOpen = true;
            trigger.setAttribute("aria-expanded", "true");
            menu.hidden = false;

            // focus first enabled action button (now inside menu)
            const firstEnabled = actionButtons.find((b) => !isEffectivelyDisabled(b));
            (firstEnabled || menu).focus();
        }

        function closeMenu({restoreFocus = false} = {}) {
            if (!isOpen) return;
            isOpen = false;
            trigger.setAttribute("aria-expanded", "false");
            menu.hidden = true;
            if (restoreFocus) trigger.focus();
        }

        trigger.addEventListener("click", (e) => {
            e.preventDefault();
            if (isOpen) closeMenu({restoreFocus: true});
            else openMenu();
        });

        trigger.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openMenu();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                openMenu();
                // focus last enabled
                const enabled = [...actionButtons].reverse().find((b) => !isEffectivelyDisabled(b));
                if (enabled) enabled.focus();
            }
        });

        menu.addEventListener("keydown", (e) => {
            const enabled = actionButtons.filter((b) => !isEffectivelyDisabled(b));
            if (!enabled.length) {
                if (e.key === "Escape") closeMenu({restoreFocus: true});
                return;
            }

            const active = document.activeElement;
            const idx = enabled.indexOf(active);

            switch (e.key) {
                case "Escape":
                    e.preventDefault();
                    closeMenu({restoreFocus: true});
                    break;
                case "Tab":
                    closeMenu({restoreFocus: false});
                    break;
                case "ArrowDown": {
                    e.preventDefault();
                    const next = enabled[(Math.max(idx, -1) + 1) % enabled.length];
                    next.focus();
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    const prev = enabled[(idx <= 0 ? enabled.length : idx) - 1];
                    prev.focus();
                    break;
                }
                case "Home":
                    e.preventDefault();
                    enabled[0].focus();
                    break;
                case "End":
                    e.preventDefault();
                    enabled[enabled.length - 1].focus();
                    break;
            }
        });

        function onDocPointerDown(e) {
            if (!isOpen) return;
            if (flyoutRoot.contains(e.target)) return;
            closeMenu({restoreFocus: false});
        }

        document.addEventListener("pointerdown", onDocPointerDown, true);

        flyoutRoot.addEventListener("focusout", (e) => {
            if (!isOpen) return;
            const next = e.relatedTarget;
            if (next && flyoutRoot.contains(next)) return;
            closeMenu({restoreFocus: false});
        });

        function setCollapsed(nextCollapsed) {
            if (nextCollapsed === isCollapsed) return;
            isCollapsed = nextCollapsed;

            if (isCollapsed) {
                // Move buttons into menu
                for (const b of actionButtons) {
                    ensureMenuLabel(b);
                    b.classList.add("flyout-menu__item");
                    b.setAttribute("role", "menuitem");
                    // In menu mode, you usually want them full-width visually
                    menu.appendChild(b);
                }
                flyoutRoot.style.display = '';
            } else {
                // Close menu if open before moving buttons out
                closeMenu({restoreFocus: false});

                // Move buttons back inline
                for (const b of actionButtons) {
                    removeMenuLabel(b);
                    b.classList.remove("flyout-menu__item");
                    b.removeAttribute("role");
                    flyoutRoot.parentNode.insertBefore(b, flyoutRoot);
                }
                flyoutRoot.style.display = 'none';
            }
        }

        // Start: default to expanded UI, menu hidden
        flyoutRoot.style.display = 'none';
        setCollapsed(false);

        const ro = new ResizeObserver(() => {
            const w = measureEl.getBoundingClientRect().width;
            setCollapsed(w < collapseAtPx || (!!collapseIfFn && collapseIfFn(w)));
        });
        ro.observe(measureEl);

        function update() {
            const w = measureEl.getBoundingClientRect().width;
            setCollapsed(w < collapseAtPx || (!!collapseIfFn && collapseIfFn(w)));
        }

        function destroy() {
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            ro.disconnect();
            closeMenu({restoreFocus: false});

            // Ensure buttons end up inline again
            setCollapsed(false);

            // Remove flyout root and inline slot wrapper, keep buttons in containerEl
            flyoutRoot.remove();
        }

        return {destroy, update, setCollapsed};
    }

    return {
        createResponsiveActionsMenu,
        isEffectivelyDisabled,
    };
}
