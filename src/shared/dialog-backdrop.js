'use strict';

// A modal dialog closes when its backdrop is clicked, as it does with Escape:
// one listener for the whole page, for every dialog opened with showModal().
//
// A click closes it only when both the press and the release fell outside
// the dialog's box: a press inside it (selecting text in it, dragging its
// scrollbar) released outside is no click on the backdrop. A click in the
// dialog's own padding is inside its box, so it stays open too.
//
// It closes the way Escape does: the dialog's cancel event first, which its
// own code may listen to (to return focus, to answer a question it asked
// "no") or prevent; then close(). A dialog that must not close this way says
// so with data-no-backdrop-close.
//
// Browser: globalThis.A11Y_DIALOG_BACKDROP. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_DIALOG_BACKDROP = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    /** Whether the pointer event `e` fell on the backdrop of an open modal dialog: that dialog, or null. */
    function backdropOf(e) {
        const dialog = e.target;
        if (!dialog || dialog.tagName !== 'DIALOG' || !dialog.open) return null;
        if (dialog.hasAttribute('data-no-backdrop-close')) return null;
        // Only a modal one has a backdrop; open(), not showModal(), has none.
        if (typeof dialog.matches === 'function') {
            try {
                if (!dialog.matches(':modal')) return null;
            } catch {
                // a browser without :modal: treat it as modal
            }
        }
        const box = dialog.getBoundingClientRect();
        const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
        return outside ? dialog : null;
    }

    /** Closes `dialog` as Escape would: its cancel event, then close() unless it was prevented. */
    function cancel(dialog) {
        const event = new dialog.ownerDocument.defaultView.Event('cancel', { cancelable: true });
        if (!dialog.dispatchEvent(event)) return;
        if (dialog.open) dialog.close();
    }

    /** Installs the listener on `doc`, once. -> the document. */
    function installBackdropClose(doc) {
        if (!doc || doc.__backdropCloseInstalled) return doc;
        doc.__backdropCloseInstalled = true;
        let pressed = null;
        doc.addEventListener('pointerdown', (e) => { pressed = backdropOf(e); }, true);
        doc.addEventListener('click', (e) => {
            const dialog = backdropOf(e);
            const was = pressed;
            pressed = null;
            if (dialog && dialog === was) cancel(dialog);
        }, true);
        return doc;
    }

    return { installBackdropClose, backdropOf };
});
