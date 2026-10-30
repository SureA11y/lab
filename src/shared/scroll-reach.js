'use strict';

// Tables in a box that scrolls sideways, reachable by keyboard while they
// scroll. On a wide screen a table fits and its box is no stop in the tab
// order; on a phone it overflows, and the box becomes a named region that
// takes focus, so the arrow keys scroll it in every browser. A box the markup
// already makes a stop (the dashboard's charts and grids) is left as it is.
// The app and the downloaded reports run it.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCROLL_REACH = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const BOXES = '.dash-table-scroll, .dsp-table-wrap, .dash-csv-text';

    // Its table's caption, else the heading of the part it is in.
    function nameFor(box) {
        const caption = box.querySelector('caption');
        const text = caption && caption.textContent.trim();
        if (text) return text;
        const part = box.closest('details, .dsp-block, section');
        const heading = part && part.querySelector('h2, h3, h4, summary');
        return (heading && heading.textContent.trim()) || 'Table';
    }

    function sync(box) {
        const ours = Object.prototype.hasOwnProperty.call(box.dataset, 'scrollReach');
        if (!ours && box.hasAttribute('tabindex')) return;
        const over = box.scrollWidth > box.clientWidth + 1;
        if (over && !ours) {
            box.dataset.scrollReach = '';
            box.tabIndex = 0;
            box.setAttribute('role', 'region');
            box.setAttribute('aria-label', nameFor(box));
        } else if (!over && ours) {
            delete box.dataset.scrollReach;
            box.removeAttribute('tabindex');
            box.removeAttribute('role');
            box.removeAttribute('aria-label');
        }
    }

    /**
     * Keeps every table box under `root` reachable while it overflows: those
     * there now, and those drawn later, as their size changes (a window made
     * narrower, a closed section opened).
     */
    function keepScrollBoxesReachable(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const seen = new WeakSet();
        const resized = typeof ResizeObserver === 'function'
            ? new ResizeObserver((entries) => entries.forEach((entry) => sync(entry.target)))
            : null;
        const scan = () => {
            root.querySelectorAll(BOXES).forEach((box) => {
                if (resized && !seen.has(box)) {
                    seen.add(box);
                    resized.observe(box);
                }
                sync(box);
            });
        };
        scan();
        if (typeof MutationObserver === 'function') {
            let queued = false;
            new MutationObserver(() => {
                if (queued) return;
                queued = true;
                const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
                later(() => { queued = false; scan(); });
            }).observe(root, { childList: true, subtree: true });
        }
    }

    return { keepScrollBoxesReachable, sync, BOXES };
});
