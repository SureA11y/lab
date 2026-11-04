'use strict';

// Boxes that scroll, reachable by keyboard while they do: tables that scroll
// sideways on a narrow screen, and output that grows past its box. While its
// content fits, a box is no stop in the tab order; once it overflows, it
// becomes a named region that takes focus, so the arrow keys scroll it in
// every browser. A box the markup already makes a stop (the dashboard's
// charts and grids) is left as it is.
// The app, the downloaded reports and the extension run it.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCROLL_REACH = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const BOXES = '.dash-table-scroll, .dsp-table-wrap, .dash-csv-text';

    // The name it is given (data-scroll-name), else its table's caption,
    // else the heading of the part it is in.
    function nameFor(box) {
        const given = box.dataset.scrollName;
        if (given) return given;
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
        const over = box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
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
     * Keeps every box under `root` that `selector` names (the app's and the
     * reports' table boxes by default) reachable while it overflows: those
     * there now, and those drawn later, as their size changes (a window made
     * narrower, a closed section opened).
     */
    function keepScrollBoxesReachable(root, selector = BOXES) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const seen = new WeakSet();
        const resized = typeof ResizeObserver === 'function'
            ? new ResizeObserver((entries) => entries.forEach((entry) => sync(entry.target)))
            : null;
        const scan = () => {
            root.querySelectorAll(selector).forEach((box) => {
                if (resized && !seen.has(box)) {
                    seen.add(box);
                    resized.observe(box);
                }
                sync(box);
            });
        };
        scan();
        if (typeof MutationObserver === 'function') {
            // Only a change that adds a box, or changes what is in one, is
            // looked at again. Measuring every box at each change anywhere
            // laid the page out each time, and a long workflow changes at
            // every step it scrolls into view.
            let queued = false;
            let full = false;
            const touched = new Set();
            const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
            const flush = () => {
                queued = false;
                if (full) {
                    full = false;
                    touched.clear();
                    scan();
                    return;
                }
                touched.forEach((box) => { if (box.isConnected) sync(box); });
                touched.clear();
            };
            const holdsBox = (node) => node.nodeType === 1
                && (node.matches(selector) || !!node.querySelector(selector));
            new MutationObserver((records) => {
                for (const rec of records) {
                    const target = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
                    const box = target && target.closest(selector);
                    if (box) touched.add(box);
                    if (!full && Array.prototype.some.call(rec.addedNodes, holdsBox)) full = true;
                }
                if (queued || (!full && !touched.size)) return;
                queued = true;
                later(flush);
            }).observe(root, { childList: true, subtree: true });
        }
    }

    return { keepScrollBoxesReachable, sync, BOXES };
});
