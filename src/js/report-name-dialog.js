'use strict';

/**
 * Asks for a report's name before it is downloaded, in a dialog of the app's
 * own (the .src-dialog look), in place of the browser's prompt(): that one
 * can't be styled, blocks the page, and a cancel in it looked like nothing
 * happening at all. Resolves with the name typed (trimmed, possibly empty),
 * or null when the dialog is cancelled or dismissed. The dialog is removed
 * once closed, and focus goes back to what had it.
 */
export function askReportNameInDialog(doc, current = '') {
    return new Promise((resolve) => {
        const uid = `report-name-${Math.random().toString(36).slice(2, 9)}`;
        const returnFocus = doc.activeElement;

        const dialog = doc.createElement('dialog');
        dialog.className = 'src-dialog report-name-dialog';
        dialog.setAttribute('aria-labelledby', `${uid}-title`);

        const header = doc.createElement('div');
        header.className = 'src-dialog-header';
        const title = doc.createElement('h2');
        title.className = 'src-dialog-title';
        title.id = `${uid}-title`;
        title.textContent = 'Name this report';
        header.append(title);

        const form = doc.createElement('form');
        form.method = 'dialog';
        form.className = 'src-dialog-body report-name-form';

        const label = doc.createElement('label');
        label.htmlFor = `${uid}-input`;
        label.textContent = 'Report name';
        const hint = doc.createElement('p');
        hint.className = 'src-dialog-meta';
        hint.id = `${uid}-hint`;
        hint.textContent = 'It heads the report and names the downloaded file. Leave it empty for none.';
        const input = doc.createElement('input');
        input.type = 'text';
        input.id = `${uid}-input`;
        input.autocomplete = 'off';
        input.value = current || '';
        input.setAttribute('aria-describedby', `${uid}-hint`);

        const actions = doc.createElement('div');
        actions.className = 'report-name-actions';
        const ok = doc.createElement('button');
        ok.type = 'submit';
        ok.value = 'download';
        ok.textContent = 'Download';
        const cancel = doc.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary-button';
        cancel.textContent = 'Cancel';
        actions.append(ok, cancel);

        form.append(label, input, hint, actions);
        dialog.append(header, form);

        let result = null;
        form.addEventListener('submit', () => { result = String(input.value).trim(); });
        cancel.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => {
            dialog.remove();
            if (returnFocus && typeof returnFocus.focus === 'function') {
                try { returnFocus.focus(); } catch { /* gone meanwhile */ }
            }
            resolve(result);
        });

        doc.body.append(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        input.focus();
        input.select();
    });
}
