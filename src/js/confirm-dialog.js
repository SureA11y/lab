'use strict';

/**
 * Asks the user to confirm an action that cannot be undone, in a dialog of
 * the app's own (the .src-dialog look), in place of the browser's confirm():
 * that one can't be styled and names the page, not the action. `title` asks
 * the question ("Close this report?"), `text` says what follows, and the two
 * buttons say what they do: `confirmLabel` ("Close report") and
 * `cancelLabel` ("Keep it open"). Focus starts on the one that keeps things
 * as they are, so a stray Enter does not lose anything. Resolves true when
 * confirmed, false when cancelled or dismissed (Escape). The dialog is removed
 * once closed, and focus goes back to what had it, unless confirming moved
 * it on purpose.
 */
export function askToConfirm(doc, {title, text = '', confirmLabel = 'OK', cancelLabel = 'Cancel'} = {}) {
    return new Promise((resolve) => {
        const uid = `confirm-${Math.random().toString(36).slice(2, 9)}`;
        const returnFocus = doc.activeElement;

        const dialog = doc.createElement('dialog');
        dialog.className = 'src-dialog confirm-dialog';
        dialog.setAttribute('aria-labelledby', `${uid}-title`);

        const header = doc.createElement('div');
        header.className = 'src-dialog-header';
        const heading = doc.createElement('h2');
        heading.className = 'src-dialog-title';
        heading.id = `${uid}-title`;
        heading.textContent = String(title || '');
        header.append(heading);

        const body = doc.createElement('div');
        body.className = 'src-dialog-body';
        if (text) {
            const p = doc.createElement('p');
            p.id = `${uid}-text`;
            p.textContent = String(text);
            body.append(p);
            dialog.setAttribute('aria-describedby', p.id);
        }
        const actions = doc.createElement('div');
        actions.className = 'confirm-dialog__actions';
        const confirm = doc.createElement('button');
        confirm.type = 'button';
        confirm.textContent = String(confirmLabel);
        const cancel = doc.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary-button';
        cancel.textContent = String(cancelLabel);
        actions.append(confirm, cancel);
        body.append(actions);
        dialog.append(header, body);

        // A browser without <dialog> (and jsdom) still gets the answer.
        const close = () => {
            if (typeof dialog.close === 'function') dialog.close();
            else {
                dialog.removeAttribute('open');
                dialog.dispatchEvent(new doc.defaultView.Event('close'));
            }
        };
        let result = false;
        confirm.addEventListener('click', () => {
            result = true;
            close();
        });
        cancel.addEventListener('click', close);
        dialog.addEventListener('close', () => {
            dialog.remove();
            // Confirmed, the caller says where focus goes next (what the
            // action left behind); else back to what opened the question.
            if (!result && returnFocus && typeof returnFocus.focus === 'function') {
                try { returnFocus.focus(); } catch { /* gone meanwhile */ }
            }
            resolve(result);
        });

        doc.body.append(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        cancel.focus();
    });
}
