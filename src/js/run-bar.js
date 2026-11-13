'use strict';

/**
 * The configuration's run bar (its status line, Cancel, Dry run and Run)
 * stays in sight: CSS keeps it on the window's bottom edge while its place
 * at the configuration's end is below the window, and lets it scroll up with
 * the configuration once that end comes into view.
 *
 * This adds what CSS cannot say alone: `is-stuck` while it floats over the
 * configuration, for its shadow, and its height as `--run-bar-h` on the
 * page, so a control that takes focus scrolls clear of it.
 */
export function installRunBar({ bar, doc = globalThis.document } = {}) {
    if (!bar || !bar.parentNode || !doc) return null;
    const win = doc.defaultView;
    const root = doc.documentElement;

    // Its place at the configuration's end, which it leaves while it floats.
    const sentinel = doc.createElement('div');
    sentinel.className = 'run-bar-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    bar.after(sentinel);

    function setStuck(stuck) {
        bar.classList.toggle('is-stuck', stuck);
    }

    if (win && typeof win.IntersectionObserver === 'function') {
        new win.IntersectionObserver(([entry]) => {
            const below = !entry.isIntersecting && entry.rootBounds
                && entry.boundingClientRect.top >= entry.rootBounds.bottom;
            setStuck(!!below);
        }).observe(sentinel);
    }

    function measure() {
        root.style.setProperty('--run-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    }
    if (win && typeof win.ResizeObserver === 'function') {
        new win.ResizeObserver(measure).observe(bar);
    }
    measure();

    return { setStuck };
}
