// A custom step's inputs as a table: a row each, with its name (the
// variable the custom step's steps read, {var:name}), the label a call to it
// shows, and whether a call must give it; a button to add a row and one to
// remove each. It replaced a textarea of one name a line, with "*" for
// required, that nobody could guess. What it reads and writes is the format
// custom steps are saved in, [{name, required?, label?, default?}]: a
// default, which the table does not show, is kept with its input.

import {createEl, svgIcon} from './a11y-ui.utils.js';

/**
 * The words a call shows for an input with no label of its own: its name
 * split into words, "elementScreenshots" and "element-screenshots" as
 * "Element screenshots".
 */
export function inputLabelOf(input) {
    const own = String(input?.label || '').trim();
    if (own) return own;
    const words = String(input?.name || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .trim()
        .toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** The names given more than once, which only their first row keeps. */
export function duplicateInputNames(rows) {
    const seen = new Set();
    const dup = new Set();
    for (const r of rows || []) {
        const name = String(r?.name || '').trim();
        if (!name) continue;
        if (seen.has(name)) dup.add(name);
        seen.add(name);
    }
    return dup;
}

/**
 * The table, in `host`. onChange() is told after each edit (a row added,
 * removed, or a field typed in). -> { setInputs(list), getInputs(), setDisabled(on) }
 */
export function createInputsTable({host, onChange = () => {}}) {
    const doc = host.ownerDocument;
    host.classList.add('custom-step-inputs');
    host.textContent = '';
    let uid = 0;
    const ids = (what) => `custom-step-inputs-${what}`;

    const titleId = ids('title');
    const title = createEl('div', {className: 'custom-step-inputs__title', id: titleId}, 'Inputs');
    const help = createEl('p', {className: 'custom-step-inputs__help', id: ids('help')},
        'What a call to this custom step gives it. Its steps read each as {var:name}. The label is what the call shows; left empty, the name in words.');
    const head = createEl('tr', {}, [
        createEl('th', {scope: 'col', id: ids('name')}, 'Name'),
        createEl('th', {scope: 'col', id: ids('label')}, 'Label'),
        createEl('th', {scope: 'col', id: ids('required')}, 'Required'),
        createEl('th', {scope: 'col'}, createEl('span', {className: 'visually-hidden'}, 'Remove'))
    ]);
    const body = createEl('tbody');
    const table = createEl('table', {className: 'custom-step-inputs__table', 'aria-labelledby': titleId, 'aria-describedby': help.id}, [
        createEl('thead', {}, head),
        body
    ]);
    const empty = createEl('p', {className: 'custom-step-inputs__empty'}, 'No inputs: a call gives it nothing.');
    const error = createEl('p', {className: 'custom-step-inputs__error', id: ids('error'), role: 'status'});
    const addBtn = createEl('button', {type: 'button', className: 'secondary-button custom-step-inputs__add'}, [
        svgIcon('add'), createEl('span', {}, 'Add input')
    ]);
    host.append(title, help, table, empty, error, addBtn);

    let disabled = false;

    function rowsNow() {
        return Array.from(body.rows);
    }

    function readRow(tr) {
        const name = tr.querySelector('.custom-step-inputs__name').value.trim();
        const label = tr.querySelector('.custom-step-inputs__label').value.trim();
        const required = tr.querySelector('.custom-step-inputs__required').checked;
        const out = {name};
        if (required) out.required = true;
        if (label) out.label = label;
        if (tr._hasDefault) out.default = tr._default;
        return out;
    }

    /** The inputs as saved: rows with a name, each name once. */
    function getInputs() {
        const seen = new Set();
        const out = [];
        for (const tr of rowsNow()) {
            const input = readRow(tr);
            if (!input.name || seen.has(input.name)) continue;
            seen.add(input.name);
            out.push(input);
        }
        return out;
    }

    // Each row is numbered in its fields' names ("Input 2 name"), so a
    // screen reader knows which row a field is in when it lands there.
    function renumber() {
        rowsNow().forEach((tr, i) => {
            const n = i + 1;
            tr.querySelector('.custom-step-inputs__name').setAttribute('aria-label', `Input ${n} name`);
            tr.querySelector('.custom-step-inputs__label').setAttribute('aria-label', `Input ${n} label`);
            tr.querySelector('.custom-step-inputs__required').setAttribute('aria-label', `Input ${n} required`);
            const name = tr.querySelector('.custom-step-inputs__name').value.trim();
            const remove = tr.querySelector('.custom-step-inputs__remove');
            remove.setAttribute('aria-label', `Remove input ${n}${name ? `, ${name}` : ''}`);
            remove.title = 'Remove this input';
        });
        empty.hidden = rowsNow().length > 0;
        table.hidden = rowsNow().length === 0;
    }

    function showDuplicates() {
        const rows = rowsNow();
        const dup = duplicateInputNames(rows.map(readRow));
        const firsts = new Set();
        rows.forEach((tr) => {
            const field = tr.querySelector('.custom-step-inputs__name');
            const name = field.value.trim();
            const repeated = dup.has(name) && firsts.has(name);
            firsts.add(name);
            if (repeated) {
                field.setAttribute('aria-invalid', 'true');
                field.setAttribute('aria-describedby', error.id);
            } else {
                field.removeAttribute('aria-invalid');
                field.removeAttribute('aria-describedby');
            }
        });
        error.textContent = dup.size
            ? `${Array.from(dup).map((n) => `“${n}”`).join(', ')} ${dup.size === 1 ? 'is' : 'are'} the name of more than one input: only the first is kept. Give the others another name.`
            : '';
        error.hidden = !dup.size;
    }

    function changed() {
        renumber();
        showDuplicates();
        onChange();
    }

    function makeRow(input = {}) {
        uid += 1;
        const name = createEl('input', {type: 'text', className: 'custom-step-inputs__name', value: String(input.name || ''), spellcheck: false, autocomplete: 'off', placeholder: 'e.g. viewLabel'});
        const label = createEl('input', {type: 'text', className: 'custom-step-inputs__label', value: String(input.label || ''), autocomplete: 'off', placeholder: inputLabelOf({name: input.name}) || 'e.g. View label'});
        const required = createEl('input', {type: 'checkbox', className: 'custom-step-inputs__required', checked: input.required === true});
        const remove = createEl('button', {type: 'button', className: 'secondary-button icon-button custom-step-inputs__remove'}, svgIcon('trash'));
        const tr = createEl('tr', {}, [
            createEl('td', {}, name),
            createEl('td', {}, label),
            createEl('td', {className: 'custom-step-inputs__check'}, required),
            createEl('td', {}, remove)
        ]);
        tr._hasDefault = Object.prototype.hasOwnProperty.call(input, 'default');
        tr._default = input.default;
        // The label's example is the words a call shows without one.
        name.addEventListener('input', () => {
            label.placeholder = inputLabelOf({name: name.value}) || 'e.g. View label';
            changed();
        });
        label.addEventListener('input', changed);
        required.addEventListener('change', changed);
        remove.addEventListener('click', () => {
            const rows = rowsNow();
            const at = rows.indexOf(tr);
            tr.remove();
            changed();
            // Focus stays in the table: on the row that took its place, or Add.
            const next = rowsNow()[Math.min(at, rowsNow().length - 1)];
            (next ? next.querySelector('.custom-step-inputs__name') : addBtn).focus();
        });
        [name, label, required, remove].forEach((el) => { el.disabled = disabled; });
        return tr;
    }

    addBtn.addEventListener('click', () => {
        const tr = makeRow();
        body.append(tr);
        changed();
        tr.querySelector('.custom-step-inputs__name').focus();
    });

    /** Shows a custom step's inputs, as saved, without telling onChange. */
    function setInputs(list) {
        body.textContent = '';
        (Array.isArray(list) ? list : []).forEach((item) => {
            const input = typeof item === 'string' ? {name: item} : item;
            if (input && typeof input === 'object') body.append(makeRow(input));
        });
        renumber();
        showDuplicates();
    }

    function setDisabled(on) {
        disabled = !!on;
        host.querySelectorAll('input, button').forEach((el) => { el.disabled = disabled; });
    }

    setInputs([]);
    return {setInputs, getInputs, setDisabled, el: host};
}
