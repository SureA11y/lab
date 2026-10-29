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

    button.addEventListener('click', () => {
        win?.scrollTo?.({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        const tab = bar.querySelector('[role="tab"][aria-selected="true"]');
        if (tab && typeof tab.focus === 'function') tab.focus({ preventScroll: true });
    });

    return { setStuck };
}
