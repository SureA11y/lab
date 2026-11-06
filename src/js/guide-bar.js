'use strict';

/**
 * The testing guide's bar (guide.html): once the filters and the results
 * line have scrolled out of view, a slim bar at the top of the window keeps
 * the logo (a link back to the scanner), what is shown, Expand all, Collapse
 * all and Back to top in reach. On a phone it also opens the contents over
 * the page, where the guide's own contents sit far above.
 *
 * Hidden, the bar is inert, so its controls are out of the tab order and of
 * what assistive technology reads. Its copy of the status line is hidden
 * from assistive technology too: the page's own status already says it.
 */
export function installGuideBar({
    doc = document,
    bar,
    anchor,
    status,
    expand,
    collapse,
    search,
    tocList,
} = {}) {
    if (!bar || !anchor) return null;
    const win = doc.defaultView;
    const $ = (sel) => bar.querySelector(sel);
    const barStatus = $('[data-guide-bar="status"]');
    const contentsButton = $('[data-guide-bar="contents"]');
    const panel = contentsButton && doc.getElementById(contentsButton.getAttribute('aria-controls'));

    const reducedMotion = () => {
        try {
            return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    };

    // The contents, over the page: a copy of the guide's own, as they are
    // now (which part is on screen included), each time they open.
    const isOpen = () => contentsButton?.getAttribute('aria-expanded') === 'true';
    function setContents(open, { focusButton = false } = {}) {
        if (!contentsButton || !panel) return;
        if (open && tocList) panel.querySelector('[data-guide-bar="toc"]').innerHTML = tocList.innerHTML;
        contentsButton.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (focusButton) contentsButton.focus();
    }

    let shown = null;
    function setShown(next) {
        if (next === shown) return;
        shown = next;
        bar.classList.toggle('is-shown', next);
        bar.inert = !next;
        doc.documentElement.classList.toggle('guide-bar-on', next);
        if (!next && isOpen()) setContents(false);
    }

    // Shown once the results line (the last of the filters) is above the
    // bar's place: the bar never covers what it repeats.
    function update() {
        setShown(anchor.getBoundingClientRect().bottom < (bar.offsetHeight || 52));
    }

    function copyStatus() {
        if (barStatus && status) barStatus.textContent = status.textContent.replace(/\.$/, '');
    }
    copyStatus();
    if (status && win?.MutationObserver) {
        new win.MutationObserver(copyStatus).observe(status, { childList: true, characterData: true, subtree: true });
    }

    $('[data-guide-bar="expand"]')?.addEventListener('click', () => expand?.click());
    $('[data-guide-bar="collapse"]')?.addEventListener('click', () => collapse?.click());
    $('[data-guide-bar="top"]')?.addEventListener('click', () => {
        win?.scrollTo?.({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        // The search, where the guide starts: the bar hides itself at the
        // top, and focus must not be left on a hidden control.
        search?.focus({ preventScroll: true });
    });

    contentsButton?.addEventListener('click', () => setContents(!isOpen()));
    panel?.addEventListener('click', (event) => {
        if (event.target.closest('a')) setContents(false);
    });
    bar.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
            event.preventDefault();
            setContents(false, { focusButton: true });
        }
    });
    doc.addEventListener('click', (event) => {
        if (isOpen() && !bar.contains(event.target)) setContents(false);
    });

    let pending = false;
    const schedule = () => {
        if (pending) return;
        pending = true;
        (win?.requestAnimationFrame || ((f) => setTimeout(f, 0)))(() => {
            pending = false;
            update();
        });
    };
    win?.addEventListener('scroll', schedule, { passive: true });
    win?.addEventListener('resize', () => {
        if (isOpen()) setContents(false);
        schedule();
    });
    update();
    return { update, setContents };
}
