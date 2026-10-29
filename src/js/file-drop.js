'use strict';

// Dropping files where the app loads them: the open report tab, the Compare
// tab, the run workflow tab (a configuration) and its Batch section (rows).
//
// A drop hands its files to the same file input the area's button opens, and
// fires that input's change event, so a dropped file goes through exactly what
// a picked one does. Dragging is a shortcut: every area keeps its button.
//
// While files are dragged over the page, the zone under the pointer is
// outlined and says what a drop does there; the innermost zone wins, so the
// Batch section takes rows inside the run workflow tab. Anywhere else the
// cursor says a drop is not possible, and a drop there is stopped rather than
// letting the browser navigate away to the file and lose what is on screen.
//
// A drop with files the area cannot take (a folder, another type, several
// where it takes one) loads nothing and says why in the area's status line,
// rather than loading part of it.

/** True when `file` matches an input's accept list (".json,application/json"). */
export function acceptsFile(file, accept) {
    const tokens = String(accept || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return true;
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    return tokens.some((t) => {
        if (t.startsWith('.')) return name.endsWith(t);
        if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1));
        return type === t;
    });
}

/**
 * What a drop of `files` on a zone comes to: { ok: true, files } to load, or
 * { ok: false, message } saying why nothing is loaded. `folders` names the
 * dropped items that are folders.
 */
export function checkDrop(files, { accept, multiple, kind, folders = [] }) {
    const list = Array.from(files || []);
    if (!list.length && !folders.length) return { ok: false, message: 'Nothing to load: the drop held no files.' };
    if (folders.length) {
        return { ok: false, message: `Folders cannot be loaded (${folders.join(', ')}). Drop the files inside instead.` };
    }
    const refused = list.filter((f) => !acceptsFile(f, accept)).map((f) => f.name);
    if (refused.length) {
        return { ok: false, message: `Nothing loaded: ${refused.join(', ')} ${refused.length === 1 ? 'is not' : 'are not'} ${kind}.` };
    }
    if (!multiple && list.length > 1) {
        return { ok: false, message: `Nothing loaded: drop one file here, not ${list.length}.` };
    }
    return { ok: true, files: list };
}

const zones = new Map();
let current = null;
let wired = false;
// The label that follows the pointer: a zone can be taller than the window,
// so a label inside it could be out of view.
let tag = null;

function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function zoneFor(target) {
    for (let el = target; el; el = el.parentElement) {
        if (zones.has(el)) return el;
    }
    return null;
}

function highlight(zone, event) {
    if (current !== zone) {
        current?.classList.remove('is-drop-target');
        current = zone;
        current?.classList.add('is-drop-target');
    }
    if (!tag) return;
    if (!zone || !event) {
        tag.hidden = true;
        return;
    }
    tag.textContent = zone.dataset.dropLabel || 'Drop to load';
    tag.hidden = false;
    const x = Math.min(event.clientX + 16, window.innerWidth - tag.offsetWidth - 8);
    const y = Math.min(event.clientY + 16, window.innerHeight - tag.offsetHeight - 8);
    tag.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

function folderNames(dataTransfer) {
    return Array.from(dataTransfer?.items || [])
        .map((item) => (item.kind === 'file' && typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
        .filter((entry) => entry && entry.isDirectory)
        .map((entry) => entry.name);
}

function wire(doc) {
    if (wired) return;
    wired = true;

    tag = doc.createElement('div');
    tag.className = 'drop-tag';
    tag.setAttribute('aria-hidden', 'true');
    tag.hidden = true;
    doc.body.append(tag);

    doc.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        const zone = zoneFor(event.target);
        event.dataTransfer.dropEffect = zone ? 'copy' : 'none';
        highlight(zone, event);
    });

    doc.addEventListener('dragleave', (event) => {
        // Leaving the window: nothing is under the pointer any more.
        if (!event.relatedTarget) highlight(null);
    });

    doc.addEventListener('dragend', () => highlight(null));

    doc.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        const zone = zoneFor(event.target);
        highlight(null);
        if (!zone) return;

        const { input, kind, onRefuse, isBusy } = zones.get(zone);
        if (isBusy && isBusy()) {
            onRefuse('Still loading the previous files. Drop these once that is done.');
            return;
        }
        const result = checkDrop(event.dataTransfer.files, {
            accept: input.accept,
            multiple: input.multiple,
            kind,
            folders: folderNames(event.dataTransfer),
        });
        if (!result.ok) {
            onRefuse(result.message);
            return;
        }

        const transfer = new DataTransfer();
        result.files.forEach((file) => transfer.items.add(file));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

/**
 * Makes `zone` take dropped files for `input`.
 *
 * @param {HTMLElement} zone
 * @param {object} opts
 * @param {HTMLInputElement} opts.input   The area's file input; its accept and multiple apply.
 * @param {string} opts.label             What a drop does, shown while dragging over the zone.
 * @param {string} opts.kind              What the zone takes, for a refusal ("a JSON report").
 * @param {(message: string) => void} opts.onRefuse  Says why a drop loaded nothing.
 * @param {() => boolean} [opts.isBusy]   True while the area is still loading.
 */
export function attachFileDrop(zone, { input, label, kind, onRefuse, isBusy } = {}) {
    if (!zone || !input) return;
    wire(zone.ownerDocument);
    zone.dataset.dropLabel = label;
    zones.set(zone, { input, kind, onRefuse: onRefuse || (() => {}), isBusy });
}
