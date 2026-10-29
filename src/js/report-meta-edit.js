'use strict';

import {reportMetaField} from './report-meta-fields.js';

/**
 * The "(modify)" affordance on the report metadata line, and the small editor
 * it opens.
 *
 * The metadata line describes a report, and what it says is not always what the
 * report should say: runs get re-imported, a merged report inherits whichever
 * file was read first, a scan is pointed at a staging host, and a report written
 * up after the fact should carry the date of the work rather than of the
 * paperwork. So each of those rows is correctable in place.
 *
 * A row opts in by carrying `data-meta-field` naming the payload key it shows;
 * what that key is worth editing as, this module does not know - it asks
 * report-meta-fields.js. Rows without the attribute (the engine list) get
 * nothing.
 *
 * The editor is built here rather than in the metadata markup because it is
 * live chrome: everything this mounts is stripped from the exported HTML (see
 * the removed selectors in export.js), which is a static document where a
 * control that edits nothing would be a lie. The values it set travel; the
 * means of changing them does not.
 */

export const META_FIELD_ATTR = 'data-meta-field';
export const META_VALUE_CLASS = 'report-meta-value';
export const META_EDIT_CLASS = 'report-meta-edit';
export const META_EDITOR_CLASS = 'report-meta-editor';

let instanceCount = 0;

/**
 * Add an edit control to every editable row of an already-rendered metadata
 * block.
 *
 * @param {Element} container - The element holding the `.report-meta` list.
 * @param {Object} options
 * @param {function(string): *} options.read - The value a field stands at now,
 *   read at open time so a field never seeds from a stale render.
 * @param {function(string, *): void} options.onSave - Handed the field name and
 *   its new value. The host owns what happens next: storing it, repainting the
 *   line, saying so.
 * @returns {{focusEditButton: function(string): void}} Focuses the control for
 *   one field, for a host that repainted the line under an editor.
 */
export function mountReportMetaEditors(container, {read, onSave} = {}) {
    const rows = container?.querySelectorAll?.(`[${META_FIELD_ATTR}]`) || [];
    const byField = new Map();

    for (const row of rows) {
        const name = row.getAttribute(META_FIELD_ATTR);
        const field = reportMetaField(name);
        if (!field) continue;

        const editor = mountOne(row, name, field, {read, onSave});
        if (editor) byField.set(name, editor);
    }

    return {
        focusEditButton(name) {
            byField.get(name)?.focusEditButton();
        }
    };
}

function mountOne(row, name, field, {read, onSave}) {
    const value = row.querySelector(`.${META_VALUE_CLASS}`);
    const host = value?.parentElement;

    if (!host) return null;

    const uid = `report-meta-${name}-${++instanceCount}`;
    const inputId = `${uid}-input`;
    const errorId = `${uid}-error`;
    const hintId = `${uid}-hint`;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = `link-button ${META_EDIT_CLASS}`;
    editBtn.setAttribute('aria-expanded', 'false');
    // The accessible name has to contain the visible label (WCAG 2.5.3), so the
    // wording that says which row this is appended to it rather than replacing
    // it through aria-label: speech users say what they see.
    editBtn.append('(modify)');
    editBtn.appendChild(hiddenText(` ${field.describe}`));

    const editor = document.createElement('span');
    editor.className = META_EDITOR_CLASS;
    editor.hidden = true;

    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.setAttribute('for', inputId);
    label.textContent = field.label;

    const input = document.createElement('input');
    input.type = field.inputType;
    input.id = inputId;
    input.className = 'report-meta-editor__input';
    if (field.size) input.size = field.size;
    // A value the field could not be read from is described here rather than
    // only announced, so it is read again to anyone who comes back to fix it.
    input.setAttribute('aria-describedby', field.hint ? `${hintId} ${errorId}` : errorId);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'secondary-button report-meta-editor__save';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary-button report-meta-editor__cancel';
    cancelBtn.textContent = 'Cancel';

    const error = document.createElement('span');
    error.className = 'report-meta-editor__error';
    error.id = errorId;
    // Announced when it fills, so a rejected value is not a silent no-op for
    // anyone who cannot see the field turn red.
    error.setAttribute('role', 'alert');

    editor.append(label, input, saveBtn, cancelBtn);

    if (field.hint) {
        const hint = document.createElement('span');
        hint.className = 'report-meta-editor__hint';
        hint.id = hintId;
        hint.textContent = field.hint;
        editor.append(hint);
    }

    editor.append(error);
    host.append(' ', editBtn, editor);

    function open() {
        input.value = field.seed(typeof read === 'function' ? read(name) : '');
        clearError();

        value.hidden = true;
        editBtn.hidden = true;
        editor.hidden = false;
        editBtn.setAttribute('aria-expanded', 'true');

        focus(input, {select: field.inputType === 'text' || field.inputType === 'url'});
    }

    function close() {
        editor.hidden = true;
        value.hidden = false;
        editBtn.hidden = false;
        editBtn.setAttribute('aria-expanded', 'false');
        clearError();
    }

    function cancel() {
        close();
        focus(editBtn);
    }

    function save() {
        const parsed = field.parse(input.value);

        if (parsed === null || parsed === undefined) {
            showError(field.invalid);
            focus(input);
            return;
        }

        close();

        if (typeof onSave === 'function') onSave(name, parsed);

        // Focus comes back here only if the host left the line alone. A host
        // that repaints it re-mounts this editor, and the button it built takes
        // the focus instead - this one is no longer in the document.
        focus(editBtn);
    }

    function showError(message) {
        error.textContent = message;
        input.setAttribute('aria-invalid', 'true');
    }

    function clearError() {
        error.textContent = '';
        input.removeAttribute('aria-invalid');
    }

    editBtn.addEventListener('click', (event) => {
        event.preventDefault();
        open();
    });

    saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        save();
    });

    cancelBtn.addEventListener('click', (event) => {
        event.preventDefault();
        cancel();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            save();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        }
    });

    // A value the field itself refuses (an impossible day, a half-typed date)
    // clears the standing complaint as soon as it is being fixed.
    input.addEventListener('input', clearError);

    return {
        focusEditButton() {
            focus(editBtn);
        }
    };
}

function hiddenText(text) {
    const span = document.createElement('span');
    span.className = 'visually-hidden';
    span.textContent = text;
    return span;
}

function focus(element, {select = false} = {}) {
    const run = () => {
        // A repaint between the request and the frame leaves this element
        // orphaned, and its replacement has already claimed the focus.
        if (element.isConnected === false) return;

        try {
            element.focus();
            // Correcting a name usually means replacing it, and a date field
            // has no selection to make - so this only applies to the text ones.
            if (select && typeof element.select === 'function') element.select();
        } catch {
            // An element the browser will not focus is not worth failing an
            // edit over.
        }
    };

    // The editor is revealed in the same tick, and Safari in particular will
    // not focus an element that was hidden when the call was made.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
}
