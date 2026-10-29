'use strict';

/**
 * In-page links (href="#sc-scan-144") that go to their target without putting
 * it in the address bar: the page scrolls to the target and focus moves to it,
 * as following the link would, and the URL stays as it was.
 *
 * One delegated listener for the whole document, so it covers every such link
 * whenever it is rendered (the run summary, the live stream's thumbnails, the
 * notes links). A click that asks for something else (a modifier key, another
 * button, a target window) is left to the browser, as is a link whose target
 * is not on the page.
 */
export function installInPageLinks(doc = document) {
    const reducedMotion = () => {
        try {
            return !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    };

    doc.addEventListener('click', (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = e.target && typeof e.target.closest === 'function' ? e.target.closest('a[href^="#"]') : null;
        if (!link || link.hasAttribute('download')) return;
        const win = link.getAttribute('target');
        if (win && win !== '_self') return;

        let id = link.getAttribute('href').slice(1);
        try {
            id = decodeURIComponent(id);
        } catch {
            // Keep it as written.
        }
        const target = id ? doc.getElementById(id) : null;
        if (!target) return;

        e.preventDefault();
        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
        // Focus goes to the target, as following the link moves the reading
        // position there; one that is not focusable is made focusable by script.
        if (!target.hasAttribute('tabindex') && target.tabIndex < 0) target.setAttribute('tabindex', '-1');
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    });
}
