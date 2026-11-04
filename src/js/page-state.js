'use strict';

/**
 * Keeps a class on <html> while any dialog is open (`has-open-dialog`), so the
 * page behind it does not scroll.
 *
 * It replaces `html:has(dialog[open])`: a rule on the whole page that asks
 * about every element in it was matched again at each change anywhere, and a
 * long workflow changes at every step it scrolls into view (a third of a
 * second for each screen scrolled at 1000 steps). Only the `open` attribute is
 * watched, and the page is looked at again only when one changes.
 */
export function trackOpenDialogs(doc = document) {
    const root = doc?.documentElement;
    const win = doc?.defaultView;
    if (!root || typeof win?.MutationObserver !== 'function') return null;
    const sync = () => root.classList.toggle('has-open-dialog', !!doc.querySelector('dialog[open]'));
    const observer = new win.MutationObserver((records) => {
        if (records.some((r) => r.target.nodeName === 'DIALOG')) sync();
    });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['open'] });
    // A dialog put in the page already open, or taken out while open, has
    // no attribute changed: look again when one comes or goes. Dialogs are
    // put at the end of the body; only its own children are watched.
    const isDialogIn = (n) => n.nodeType === 1 && (n.nodeName === 'DIALOG' || !!n.querySelector?.('dialog'));
    const removals = new win.MutationObserver((records) => {
        const moved = records.some((r) => Array.prototype.some.call(r.addedNodes, isDialogIn)
            || Array.prototype.some.call(r.removedNodes, isDialogIn));
        if (moved) sync();
    });
    removals.observe(doc.body || root, { childList: true });
    sync();
    return { sync, disconnect: () => { observer.disconnect(); removals.disconnect(); } };
}
