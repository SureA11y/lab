'use strict';

/**
 * The "Back to top" button at the end of the sticky mode bar. It shows once
 * the page header has scrolled out of view (the colour-theme and Activity
 * buttons go with it, so the corner is free), and the bar gets `is-stuck`
 * then, for its shadow. Pressing it scrolls to the top and puts focus on the
 * selected mode tab: the button hides itself at the top, and focus must not
 * be left on a hidden control.
 */
export function installBackToTop({ bar, button, header, doc = document } = {}) {
    if (!bar || !button || !header) return null;
    const win = doc.defaultView;

    const reducedMotion = () => {
        try {
            return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    };

    function setStuck(stuck) {
        bar.classList.toggle('is-stuck', stuck);
        button.classList.toggle('is-shown', stuck);
        button.inert = !stuck;
    }

    setStuck(false);

    if (win && typeof win.IntersectionObserver === 'function') {
        const observer = new win.IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
        observer.observe(header);
    }

    // The tabs share the bar's line with the button: they shrink, their names
    // wrapping, and when even that does not fit beside it (a narrow screen
    // with text spacing) they go on two rows (is-wrapped) rather than run
    // under it. Measured again whenever the bar or a tab changes size.
    const tabs = bar.querySelector('.mode-switch');
    let pending = false;
    function fitTabs() {
        pending = false;
        if (!tabs) return;
        tabs.classList.remove('is-wrapped');
        tabs.classList.toggle('is-wrapped', tabs.scrollWidth > tabs.clientWidth + 1);
    }
    if (tabs && win && typeof win.ResizeObserver === 'function') {
        const schedule = () => {
            if (pending) return;
            pending = true;
            (win.requestAnimationFrame || win.setTimeout)(fitTabs);
        };
        const resized = new win.ResizeObserver(schedule);
        resized.observe(bar);
        // The list itself narrows when the button appears beside it, while
        // its tabs, whose names never wrap, keep their size.
        resized.observe(tabs);
        tabs.querySelectorAll('[role="tab"]').forEach((tab) => resized.observe(tab));
    }
    fitTabs();

    button.addEventListener('click', () => {
        win?.scrollTo?.({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        const tab = bar.querySelector('[role="tab"][aria-selected="true"]');
        if (tab && typeof tab.focus === 'function') tab.focus({ preventScroll: true });
    });

    return { setStuck };
}
