// The run's settings, how the page is shown and how the browser connects, kept
// in a dialog opened from the Configuration's first line. Under that line a
// chip says what each one is, its default too, so what a run will use is seen
// at a glance; the ones changed stand out, and accepting untrusted
// certificates reads as a warning. A chip opens the dialog at its field.
//
// The fields stay in the form (the dialog is inside .config-data), so a saved
// configuration, undo and the run spec read them as before.

// Each setting: its field, its name, what its chip says ({ value, text } are
// the field's value and its option's text) and whether that is its default.
// A chip says a setting in the dialog's own words, its label and the option
// chosen ("Colors: Browser default"): two wordings for one setting read as two
// settings.
const optionText = ({ text }) => text;
const SETTINGS = [
    { id: 'viewport-preset', name: 'Viewport', say: optionText, isDefault: ({ value }) => !value || value === 'default' },
    { id: 'run-color-scheme', name: 'Colors', say: optionText, isDefault: ({ value }) => !value },
    { id: 'run-high-contrast', name: 'High contrast', say: optionText, isDefault: ({ value }) => value !== 'on' },
    {
        id: 'run-language',
        name: 'Language',
        say: ({ value, text }, values) => {
            if (value !== 'other') return text;
            return String((values['run-language-other'] || {}).value || '').trim() || 'Other, not typed yet';
        },
        isDefault: ({ value }) => !value,
    },
    {
        id: 'run-untrusted-certs',
        name: 'Certificates',
        say: optionText,
        isDefault: ({ value }) => value !== 'on',
        warn: true,
    },
];

/**
 * Every setting, in the dialog's order, as its chip says it.
 * values: { [field id]: { value, text } }.
 * -> [{ id, name, label, changed, warn }]; warn only when changed.
 */
export function runSettingsSummary(values) {
    const all = values || {};
    return SETTINGS.map((setting) => {
        const field = all[setting.id] || {};
        const changed = !setting.isDefault(field);
        return {
            id: setting.id,
            name: setting.name,
            label: String(setting.say(field, all) || ''),
            changed,
            warn: changed && !!setting.warn,
        };
    });
}

function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The chips' markup: a button each, "Name: value", the changed ones marked. */
export function runSettingsChipsHtml(summary) {
    return summary.map((s) => {
        const cls = ['run-setting-chip', s.changed ? 'is-changed' : '', s.warn ? 'is-warn' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-field="${esc(s.id)}">`
            + `<span class="run-setting-name">${esc(s.name)}:</span> ${esc(s.label)}</button>`;
    }).join('');
}

function readValues(doc) {
    const values = {};
    for (const id of [...SETTINGS.map((s) => s.id), 'run-language-other']) {
        const el = doc.getElementById(id);
        if (!el) continue;
        const option = el.tagName === 'SELECT' ? el.options[el.selectedIndex] : null;
        values[id] = { value: el.value, text: option ? option.textContent.trim() : el.value };
    }
    return values;
}

/**
 * Wires the dialog, its button and the chips. -> { sync, open }: sync after
 * the fields change from elsewhere (a configuration loaded, undo).
 */
export function setupRunSettings(doc = document) {
    const dialog = doc.getElementById('run-settings-dialog');
    const button = doc.getElementById('run-settings-button');
    const closeButton = doc.getElementById('run-settings-close');
    const summaryEl = doc.getElementById('run-settings-summary');
    if (!dialog || !button || !summaryEl) return { sync() {}, open() {} };

    let opener = null;
    let lastHtml = null;

    function sync() {
        const html = runSettingsChipsHtml(runSettingsSummary(readValues(doc)));
        if (html === lastHtml) return;
        lastHtml = html;
        summaryEl.innerHTML = html;
    }

    function open(fieldId = null) {
        if (dialog.open) return;
        opener = doc.activeElement;
        dialog.showModal();
        const field = fieldId ? doc.getElementById(fieldId) : null;
        (field || dialog.querySelector('select, input'))?.focus();
    }

    button.addEventListener('click', () => open());
    summaryEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.run-setting-chip');
        if (chip) open(chip.dataset.field);
    });
    closeButton?.addEventListener('click', () => dialog.close());
    // Done says the settings are set: they were kept as they changed.
    doc.getElementById('run-settings-done')?.addEventListener('click', () => dialog.close());
    // A click on the backdrop (the dialog element itself, outside its box) closes it.
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('change', sync);
    dialog.addEventListener('input', sync);
    dialog.addEventListener('close', () => {
        sync();
        // Back where it was opened from; a chip redrawn meanwhile, to its new self.
        const field = opener && opener.dataset ? opener.dataset.field : null;
        const redrawn = field && !opener.isConnected ? summaryEl.querySelector(`[data-field="${field}"]`) : null;
        const back = redrawn || (opener && opener.isConnected && !opener.closest('[hidden]') ? opener : button);
        opener = null;
        back.focus();
    });

    sync();
    return { sync, open };
}
