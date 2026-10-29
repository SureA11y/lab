'use strict';

/** URLs in plain text log messages */
export const URL_REGEX = /\bhttps?:\/\/[^\s<>\]]+/gi;

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function jsonToBrowserLink(jsonString) {
    const blob = new Blob([jsonString], { type: 'application/json' });
    return URL.createObjectURL(blob);
}

export function safeBaseName(str, fallback = 'workflow-config') {
    return (
        String(str || '')
            .replace(/https?:\/\//, '')
            .trim()
            .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '')
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9._-]+/gi, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/\.+$/g, '')
    ) || fallback;
}

export function jsonBlob(obj) {
    return new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
}

/** Parse messages like "forEachElement item 3 / 10" */
export function parseForEachIteration(message) {
    const m = /forEachElement item\s+(\d+)\s*\/\s*(\d+|\?)/i.exec(message);
    if (!m) return null;
    const oneBased = parseInt(m[1], 10);
    const totalStr = m[2];
    return { oneBased, total: totalStr === '?' ? null : parseInt(totalStr, 10) };
}

/** Parse messages like "repeat iteration 2 / 5" */
export function parseRepeatIteration(message) {
    const m = /repeat iteration\s+(\d+)\s*\/\s*(\d+)/i.exec(message);
    if (!m) return null;
    return { oneBased: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

export function indentPrefix(depth) {
    if (!depth || depth <= 0) return '';
    return '· '.repeat(depth);
}

/** Linkify URLs (returns HTML string) */
export function linkifyUrlsToHtml(text) {
    const clean = String(text ?? '');
    return clean.replace(URL_REGEX, (url) => {
        const safe = escapeHtml(url);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
    });
}

export function createEl(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
        if (k === "dataset" && v && typeof v === "object") {
            Object.entries(v).forEach(([dk, dv]) => (el.dataset[dk] = dv));
        } else if (k in el) {
            el[k] = v;
        } else {
            el.setAttribute(k, v);
        }
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
        if (child == null) return;
        el.append(child.nodeType ? child : document.createTextNode(child));
    });
    return el;
}

// Read-only chips markup for a scan's tags, shared by the summary rows and the
// scan header so both render the same pills. Empty tag lists yield no markup.
export function scanTagChipsHtml(tags) {
    const clean = (Array.isArray(tags) ? tags : []).map((t) => String(t == null ? '' : t).trim()).filter(Boolean);
    if (!clean.length) return '';
    return '<span class="scan-tags">' +
        '<span class="scan-tags__label">Tags:</span>' +
        clean.map((t) => `<span class="scan-tag">${escapeHtml(t)}</span>`).join('') +
        '</span>';
}

export function iconButton({className, ariaLabel, title, iconName, type = "button"}) {
    const btn = createEl("button", {
        type,
        className,
        title: title || ariaLabel,
        "aria-label": ariaLabel
    });
    const icons = typeof iconName === 'string' ? [iconName] : iconName;
    icons.forEach(icon => {
        btn.append(svgIcon(icon));
    });
    return btn;
}

// Every split button needs to close its own menu on an outside click, but a
// document-level listener must only ever be installed once for the whole
// page - otherwise each createSplitButton() call (e.g. one per report
// re-render) would leak another permanent listener onto document, each one
// keeping its own detached root alive and doing wasted work on every future
// click anywhere on the page.
const splitButtonInstances = new Set();
let splitButtonOutsideClickBound = false;

function ensureSplitButtonOutsideClickListener() {
    if (splitButtonOutsideClickBound) return;
    splitButtonOutsideClickBound = true;
    document.addEventListener('click', (event) => {
        for (const instance of splitButtonInstances) {
            if (!instance.root.isConnected) {
                // The button was discarded by a re-render without ever being
                // clicked outside first - prune it here instead of growing
                // this set forever.
                splitButtonInstances.delete(instance);
                continue;
            }
            if (!instance.root.contains(event.target)) instance.closeMenu();
        }
    });
}

/**
 * DS SplitButton (mode="extras"): one default action with a chevron-menu of
 * near-identical variants attached — "one action is what nearly everyone
 * wants, and the others are the same action with a setting changed" (e.g.
 * "Load config" beside "Load and run", "Download report" beside "Download
 * as a single file"). The chevron half rests one step darker than the
 * action and climbs lighter as it's engaged — the only place in the system
 * a control gets lighter under the pointer — so the two targets read apart
 * without a rule drawn between them.
 *
 * `onAction` and every `items[].onSelect` may return a promise; while one is
 * pending the control reads as unavailable and shows a spinner (busy.js),
 * keeping its label and focus: what the action is doing is shown in the
 * activity panel (activity.js). A press meanwhile calls `onBusyPress`, which
 * points to it.
 */
export function createSplitButton({
    label,
    onAction,
    guard,
    onBusyPress = null,
    items = [],
    menuLabel = 'Other options',
    menuHeading = 'Also available'
} = {}) {
    const root = createEl('span', {className: 'split-button'});

    const actionBtn = createEl('button', {type: 'button', className: 'split-button__action'}, label);

    const chevronBtn = createEl('button', {
        type: 'button',
        className: 'split-button__chevron',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-label': menuLabel
    });
    chevronBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
        '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '</svg>';

    const menu = createEl('div', {className: 'split-button__menu', role: 'menu', 'aria-label': menuLabel});
    menu.hidden = true;

    if (menuHeading) {
        menu.append(createEl('div', {className: 'split-button__menu-heading'}, menuHeading));
    }

    const itemEls = items.map((item) => {
        const btn = createEl('button', {type: 'button', className: 'split-button__item', role: 'menuitem'});
        btn.append(createEl('span', {className: 'split-button__item-label'}, item.label));
        if (item.description) {
            btn.append(createEl('span', {className: 'split-button__item-desc'}, item.description));
        }
        menu.append(btn);
        return {btn, item};
    });

    root.append(actionBtn, chevronBtn, menu);

    let busy = false;
    function setBusy(value) {
        busy = value;
        for (const btn of [actionBtn, chevronBtn]) {
            if (busy) btn.setAttribute('aria-disabled', 'true');
            else btn.removeAttribute('aria-disabled');
        }
        if (busy) actionBtn.dataset.busy = 'true';
        else delete actionBtn.dataset.busy;
    }

    function pressedWhileBusy() {
        if (!busy) return false;
        if (typeof onBusyPress === 'function') onBusyPress();
        return true;
    }

    function openMenu(focusFirst) {
        menu.hidden = false;
        chevronBtn.setAttribute('aria-expanded', 'true');
        if (focusFirst && itemEls[0]) itemEls[0].btn.focus();
    }

    function closeMenu({restoreFocus = false} = {}) {
        if (menu.hidden) return;
        menu.hidden = true;
        chevronBtn.setAttribute('aria-expanded', 'false');
        if (restoreFocus) chevronBtn.focus();
    }

    ensureSplitButtonOutsideClickListener();
    splitButtonInstances.add({root, closeMenu});

    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) {
            event.stopPropagation();
            closeMenu({restoreFocus: true});
        }
    });

    const openOnArrowDown = (event) => {
        if (event.key === 'ArrowDown' && !busy) {
            event.preventDefault();
            openMenu(true);
        }
    };
    actionBtn.addEventListener('keydown', openOnArrowDown);
    chevronBtn.addEventListener('keydown', openOnArrowDown);

    chevronBtn.addEventListener('click', () => {
        if (pressedWhileBusy()) return;
        if (menu.hidden) openMenu(false);
        else closeMenu();
    });

    itemEls.forEach(({btn}, index) => {
        btn.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const dir = event.key === 'ArrowDown' ? 1 : -1;
            const next = itemEls[(index + dir + itemEls.length) % itemEls.length];
            if (next) next.btn.focus();
        });
    });

    actionBtn.addEventListener('click', async () => {
        if (!onAction || pressedWhileBusy()) return;
        if (guard && guard() === false) return;

        setBusy(true);
        try {
            await onAction();
        } finally {
            setBusy(false);
        }
    });

    itemEls.forEach(({btn, item}) => {
        btn.addEventListener('click', async () => {
            closeMenu();
            if (!item.onSelect) return;
            if (pressedWhileBusy()) return;
            if (item.guard && item.guard() === false) return;

            setBusy(true);
            try {
                await item.onSelect();
            } catch (error) {
                if (item.onError) item.onError(error);
                else console.error(`Could not run "${item.label}"`, error);
            } finally {
                setBusy(false);
            }
        });
    });

    return root;
}

export function svgIcon(name) {
    const common = {viewBox: "0 0 24 24", width: "18", height: "18", "aria-hidden": "true", focusable: "false"};

    const icons = {
        info: `<path d="M12 10v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path> 
                <circle cx="12" cy="6.5" r="1" fill="currentColor"></circle>`,
        copy: `<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
                <rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" opacity="0.6"></rect>`,
        paste: `<path d=\"M8 4h8v2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"></path>
                <path d=\"M9 3h6v3H9z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"></path>
                <path d=\"M7 6h10v14H7z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"></path>
                <path d=\"M10 12h4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"></path>
                <path d=\"M10 16h4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"></path>`,
        up: `<path d="M12 5l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
             <path d="M12 5l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
             <path d="M12 5v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>`,
        down: `<path d="M12 19l-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
               <path d="M12 19l6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
               <path d="M12 5v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>`,
        trash: `<path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                <path d="M10 11v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                <path d="M14 11v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                <path d="M6 7l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
                <path d="M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>`,
        disable: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
                  <path d="M7.5 16.5l9-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>`,
        enable: `<path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`,
        add: `<path d="M12 5v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
<path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>`,
        menu: `<circle cx="12" cy="6" r="1.6" fill="currentColor"></circle>
           <circle cx="12" cy="12" r="1.6" fill="currentColor"></circle>
           <circle cx="12" cy="18" r="1.6" fill="currentColor"></circle>`,
        collapse: `
  <path d="M6 14l6-6 6 6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
`,

        expand: `
  <path d="M6 10l6 6 6-6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
`,
        // Two chevrons pointing away from each other (collapse-all/expand-all
        // "unfold more" glyph) — distinct from the single-chevron collapse/
        // expand above, which toggles one item rather than every item.
        "expand-all": `
  <path d="M7 9l5-4 5 4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
  <path d="M7 15l5 4 5-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
`,
        // A root with two branches below it: the workflow's step tree.
        "step-tree": `
  <rect x="3" y="3" width="7" height="5" rx="1"
        fill="none" stroke="currentColor" stroke-width="2"></rect>
  <rect x="14" y="10" width="7" height="5" rx="1"
        fill="none" stroke="currentColor" stroke-width="2"></rect>
  <rect x="14" y="17" width="7" height="5" rx="1"
        fill="none" stroke="currentColor" stroke-width="2"></rect>
  <path d="M6.5 8v11.5H14M6.5 12.5H14"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"></path>
`,
        // Two chevrons pointing toward each other ("unfold less" glyph).
        "collapse-all": `
  <path d="M7 5l5 4 5-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
  <path d="M7 19l5-4 5 4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
`,
        show: `
    <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"></path>
    <circle cx="12" cy="12" r="3"
            fill="none" stroke="currentColor" stroke-width="2"></circle>
  `,

        hide: `
    <path d="M3 12s3.5-7 9-7c2.2 0 4.1.7 5.7 1.7"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M21 12s-3.5 7-9 7-9-7-9-7c.7-1.4 1.9-3.2 3.7-4.6"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M4 4l16 16"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round"></path>
    <path d="M10.2 10.2a3 3 0 0 0 3.6 3.6"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"></path>
  `,
        edit: `
  <path d="M4 20l4.5-1 10-10-3.5-3.5-10 10L4 20z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"></path>
  <path d="M13 6l3.5 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"></path>
`,
        undo: `
  <path d="M9 10H5V6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
  <path d="M5 10c1.6-3 4.4-5 7.8-5H15c3.3 0 6 2.7 6 6s-2.7 6-6 6H9"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
`,
        redo: `
  <path d="M15 10h4V6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
  <path d="M19 10c-1.6-3-4.4-5-7.8-5H9c-3.3 0-6 2.7-6 6s2.7 6 6 6h6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"></path>
`,
        grid: `
  <rect x="4" y="4" width="7" height="7" rx="1.5"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linejoin="round"></rect>
  <rect x="13" y="4" width="7" height="7" rx="1.5"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linejoin="round"></rect>
  <rect x="4" y="13" width="7" height="7" rx="1.5"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linejoin="round"></rect>
  <rect x="13" y="13" width="7" height="7" rx="1.5"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linejoin="round"></rect>
`,
        tag: `<path d="M4 4h7l9 9-7 7-9-9V4z"
                    fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linejoin="round"></path>
              <circle cx="8" cy="8" r="1.5" fill="currentColor"></circle>`,
    };

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.entries(common).forEach(([k, v]) => svg.setAttribute(k, v));
    svg.innerHTML = icons[name] || "";
    if (name === "info") {
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
    }
    svg.classList.add(name);
    return svg;
}

export function setImgWidthWhenReady(img) {
    if (!img || !(img instanceof HTMLImageElement)) return;

    const apply = () => {
        const w = Number(img.naturalWidth || 0);
        if (!w) return;

        const h = Number(img.naturalHeight || 0);
        if (!h) return;

        img.style.width = String(w) + 'px';
        // img.style.height = String(h) + 'px';
    };

    if (img.complete && img.naturalWidth > 0) {
        apply();
        return;
    }

    img.addEventListener('load', apply, {once: true});
}

export function createImg(data = {}, appendToDialogs = []) {
    if(!data?.src) return null;
    const img = document.createElement('img');
    img.id = 'imgDialogImg';
    img.src = data?.src;
    img.alt = data.alt || 'Screenshot';
    setImgWidthWhenReady(img);

    appendToDialogs.forEach(dialog => appendImgToDialog(img, dialog));
}

export function appendImgToDialog(img, dialog) {
    setImgWidthWhenReady(img);

    dialog.addItem({
        // The address as given, which is what openById() is called with:
        // img.src would be it made absolute, so a relative one (a batch's
        // "images/…" pictures) would never be found.
        id: img.getAttribute('src'),
        title: img.alt,
        contentEl: img,
        onOpen: (dialog) => {
            centerDialogImageView(dialog, img);
        },
        onClose: (dialog) => {
            cleanupCenterDialogImageView(dialog);
        }
    });
}

function centerDialogImageView(dialogEl, imgEl, opts = {}) {
    const bodySel = opts.bodySelector || '.axd-body';
    const bodyEl = dialogEl?.querySelector(bodySel);
    if (!dialogEl || !bodyEl || !imgEl) return;

    const horiz = opts.horizontal || 'center'; // start|center|end
    const vert  = opts.vertical   || 'start';  // start|center|end

    const pick = (max, mode) => {
        if (!(max > 0)) return 0;
        if (mode === 'end') return max;
        if (mode === 'center') return Math.floor(max / 2);
        return 0; // start
    };

    const doCenter = () => {
        const maxScrollLeft = bodyEl.scrollWidth - bodyEl.clientWidth;
        const maxScrollTop = bodyEl.scrollHeight - bodyEl.clientHeight;

        bodyEl.scrollLeft = pick(maxScrollLeft, horiz);
        bodyEl.scrollTop  = pick(maxScrollTop,  vert);
    };

    const runAfterLayout = () => requestAnimationFrame(() => requestAnimationFrame(doCenter));

    if (imgEl.complete && imgEl.naturalWidth > 0) runAfterLayout();
    else imgEl.addEventListener('load', runAfterLayout, { once: true });

    if (!dialogEl._axdCenterOnResize) {
        dialogEl._axdCenterOnResize = () => runAfterLayout();
        window.addEventListener('resize', dialogEl._axdCenterOnResize, { passive: true });
    }
}

// Optional cleanup for when the dialog closes
function cleanupCenterDialogImageView(dialogEl) {
    if (!dialogEl?._axdCenterOnResize) return;
    window.removeEventListener('resize', dialogEl._axdCenterOnResize);
    delete dialogEl._axdCenterOnResize;
}

/**
 * Builds a labeled <select> wrapped in a <div>
 *
 * @param {Object} config
 * @param {string} config.id - The id for the select (also used by label for=)
 * @param {string} config.labelText - Text content for the label
 * @param {Object} config.options - Object of value: label pairs
 * @param {string} [config.selected] - Value to be selected by default
 * @param {Function} [config.onChange] - Callback(event, value) on change
 * @param {string} [config.name] - Optional name attribute for select
 * @returns {HTMLDivElement}
 */
export function buildLabeledSelect({
                                id,
                                labelText,
                                options,
                                selected,
                                onChange,
                                name
                            }) {
    const wrapper = document.createElement('div');

    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;

    const select = document.createElement('select');
    select.id = id;
    if (name) select.name = name;

    Object.entries(options).forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    });

    if (typeof onChange === 'function') {
        select.addEventListener('change', (event) => {
            onChange(event, event.target.value);
        });
    }

    if (selected !== undefined && selected !== null) {
        select.value = selected;

        if (typeof onChange === 'function') {
            onChange({ target: select }, select.value);
        }
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);

    return wrapper;
}