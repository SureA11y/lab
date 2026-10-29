'use strict';

/**
 * A modal dialog about one queued run, opened from its row in the queue: a
 * title, a status line, a body the caller fills, and footer buttons. Watching
 * a running run uses it with a live view in the body; the same frame can hold
 * a finished run's report.
 *
 * Closing it (its Close button, Escape, or a click on the backdrop) calls the
 * onClose given to open(), then puts focus back where returnFocus says, since
 * the control that opened it may have been re-rendered meanwhile.
 *
 * Built on the app's .src-dialog look (the Step tree dialog's), not on
 * advanced-dialog.js: that one pages through items and takes the arrow keys,
 * Home and End for it, which a body of live controls needs for itself.
 */
export function createRunDialog({document: doc = globalThis.document, className = ''} = {}) {
    const uid = `run-dialog-${Math.random().toString(36).slice(2, 9)}`;

    const dialog = doc.createElement('dialog');
    dialog.className = `src-dialog run-dialog ${className}`.trim();
    dialog.setAttribute('aria-labelledby', `${uid}-title`);
    dialog.setAttribute('aria-describedby', `${uid}-status`);

    const header = doc.createElement('div');
    header.className = 'src-dialog-header';
    const title = doc.createElement('h2');
    title.className = 'src-dialog-title';
    title.id = `${uid}-title`;
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'src-dialog-close';
    closeBtn.textContent = 'Close';
    header.append(title, closeBtn);

    const status = doc.createElement('p');
    status.className = 'run-dialog-status';
    status.id = `${uid}-status`;
    status.setAttribute('role', 'status');

    const body = doc.createElement('div');
    body.className = 'src-dialog-body run-dialog-body';

    const footer = doc.createElement('div');
    footer.className = 'src-dialog-footer run-dialog-footer';
    footer.hidden = true;

    dialog.append(header, status, body, footer);
    doc.body.appendChild(dialog);

    let current = null; // { onClose, returnFocus }

    function setTitle(text) {
        title.textContent = text || '';
    }

    /** `busy` adds the app's spinner after the text: decorative, the words say it. */
    function setStatus(text, tone = '', {busy = false} = {}) {
        status.textContent = text || '';
        if (busy && text) {
            const spin = doc.createElement('span');
            spin.className = 'tab-spinner run-dialog-spinner';
            spin.setAttribute('aria-hidden', 'true');
            status.append(' ', spin);
        }
        status.className = tone ? `run-dialog-status run-dialog-status--${tone}` : 'run-dialog-status';
    }

    /** Footer buttons: [{ label, onClick, primary }]; an empty list hides the footer. */
    function setActions(actions = []) {
        footer.replaceChildren();
        for (const a of actions) {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = a.primary ? 'run-dialog-action' : 'secondary-button run-dialog-action';
            btn.textContent = a.label;
            btn.addEventListener('click', () => a.onClick?.());
            footer.append(btn);
        }
        footer.hidden = !actions.length;
    }

    /**
     * Shows the dialog, emptied, with this title. `onClose` runs once it
     * closes, however it closes; `returnFocus` is called after that unless the
     * close was asked with { returnFocus: false }.
     */
    function open({title: text = '', onClose = null, returnFocus = null} = {}) {
        if (dialog.open) close({returnFocus: false});
        body.replaceChildren();
        setTitle(text);
        setStatus('');
        setActions([]);
        current = {onClose, returnFocus, restore: true};
        dialog.showModal();
        closeBtn.focus();
    }

    function close({returnFocus = true} = {}) {
        if (!dialog.open) return;
        if (current) current.restore = returnFocus;
        dialog.close();
    }

    dialog.addEventListener('close', () => {
        const was = current;
        current = null;
        body.replaceChildren();
        if (!was) return;
        try {
            was.onClose?.();
        } finally {
            if (was.restore) was.returnFocus?.();
        }
    });
    closeBtn.addEventListener('click', () => close());
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) close();
    });

    return {
        dialog,
        body,
        open,
        close,
        setTitle,
        setStatus,
        setActions,
        isOpen: () => dialog.open,
    };
}
