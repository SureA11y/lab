'use strict';

/**
 * The testing guide's bar (guide.html): once the page's title has scrolled
 * out of view, a slim bar at the top of the window keeps the logo (a link
 * back to the scanner), Expand all, Collapse all and Back to top in reach.
 * Once the filters have scrolled out of view too, it also says what is shown,
 * on a Filters button that opens the filters under the bar. On a phone it
 * opens the contents over the page as well, with Expand all and Collapse all
 * in them, where there is no room for them in the bar.
 *
 * Filters opens the page's own filters, not a copy: the form moves into the
 * bar's panel, and an empty box of its size keeps its place in the page, so
 * nothing below it moves. It goes back when the panel closes: on Escape (focus
 * back on Filters), Filters again, a click outside the bar, or when the page
 * scrolls back to where it sits. A change of filter redraws the guide as
 * always, and the panel stays open for the next.
 *
 * Hidden, the bar is inert, so its controls are out of the tab order and of
 * what assistive technology reads.
 */
export function installGuideBar({
    doc = document,
    bar,
    hero,
    filters,
    status,
    expand,
    collapse,
    search,
    tocList,
} = {}) {
    if (!bar || !hero) return null;
    const win = doc.defaultView;
    const $ = (sel) => bar.querySelector(sel);
    const summary = $('[data-guide-bar="summary"]');
    const contentsButton = $('[data-guide-bar="contents"]');
    const contentsPanel = contentsButton && doc.getElementById(contentsButton.getAttribute('aria-controls'));
    const filtersButton = $('[data-guide-bar="filters"]');
    const filtersPanel = filtersButton && doc.getElementById(filtersButton.getAttribute('aria-controls'));

    const reducedMotion = () => {
        try {
            return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    };
    const expanded = (button) => button?.getAttribute('aria-expanded') === 'true';

    // The contents, over the page: a copy of the guide's own, as they are
    // now (which part is on screen included), each time they open.
    function setContents(open, { focusButton = false } = {}) {
        if (!contentsButton || !contentsPanel) return;
        if (open) {
            setFilters(false);
            if (tocList) contentsPanel.querySelector('[data-guide-bar="toc"]').innerHTML = tocList.innerHTML;
        }
        contentsButton.setAttribute('aria-expanded', String(open));
        contentsPanel.hidden = !open;
        if (focusButton) contentsButton.focus();
    }

    // The filters, moved under the bar and back. `focus` on closing: 'button'
    // (Escape), 'keep' (the control that had it keeps it, back in the page)
    // or 'none' (a click elsewhere took it).
    let placeholder = null;
    function setFilters(open, { focus = 'keep' } = {}) {
        if (!filtersButton || !filtersPanel || !filters) return;
        if (open === expanded(filtersButton)) return;
        if (open) {
            setContents(false);
            const style = win?.getComputedStyle?.(filters);
            placeholder = doc.createElement('div');
            placeholder.className = 'guide-filters-placeholder';
            placeholder.setAttribute('aria-hidden', 'true');
            placeholder.style.height = `${filters.offsetHeight}px`;
            if (style) placeholder.style.margin = style.margin;
            filters.replaceWith(placeholder);
            filtersPanel.append(filters);
            filtersButton.setAttribute('aria-expanded', 'true');
            filtersPanel.hidden = false;
            filters.querySelector('select, input, button, summary')?.focus({ preventScroll: true });
            return;
        }
        const active = filters.contains(doc.activeElement) ? doc.activeElement : null;
        placeholder.replaceWith(filters);
        placeholder = null;
        filtersButton.setAttribute('aria-expanded', 'false');
        filtersPanel.hidden = true;
        if (focus === 'button') filtersButton.focus();
        else if (focus === 'keep' && active) active.focus({ preventScroll: true });
    }

    let state = null;
    function setState(shown, filtersGone) {
        const next = `${shown}:${filtersGone}`;
        if (next === state) return;
        state = next;
        bar.classList.toggle('is-shown', shown);
        bar.classList.toggle('has-filters', filtersGone);
        bar.inert = !shown;
        doc.documentElement.classList.toggle('guide-bar-on', shown);
        if (filtersButton) filtersButton.hidden = !filtersGone;
        if (!shown) setContents(false);
        if (!filtersGone) setFilters(false);
    }

    // Shown once the title is above the bar's place; the filters in it once
    // the filters (or, while they are in the bar, their place) are too.
    function update() {
        const height = bar.offsetHeight || 52;
        const shown = hero.getBoundingClientRect().bottom < height;
        const filtersAt = placeholder || filters;
        const filtersGone = shown && !!filtersAt && filtersAt.getBoundingClientRect().bottom < height;
        setState(shown, filtersGone);
    }

    // What is shown, as the page's status says it, shorter: "WCAG 2.2 · A
    // and AA · 55 criteria, 78 checks".
    function copyStatus() {
        if (!summary || !status) return;
        summary.textContent = status.textContent.trim()
            .replace(/\.$/, '')
            .replace(/, Level /, ' · ')
            .replace(/: /, ' · ');
    }
    copyStatus();
    if (status && win?.MutationObserver) {
        new win.MutationObserver(copyStatus).observe(status, { childList: true, characterData: true, subtree: true });
    }

    // Expand all and Collapse all press the page's own; that press is not a
    // click outside the bar, so what is open in it stays open.
    let relaying = false;
    const relay = (target) => {
        relaying = true;
        try {
            target?.click();
        } finally {
            relaying = false;
        }
    };
    for (const button of bar.querySelectorAll('[data-guide-bar="expand"]')) button.addEventListener('click', () => relay(expand));
    for (const button of bar.querySelectorAll('[data-guide-bar="collapse"]')) button.addEventListener('click', () => relay(collapse));
    $('[data-guide-bar="top"]')?.addEventListener('click', () => {
        setFilters(false, { focus: 'none' });
        win?.scrollTo?.({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        // The search, where the guide starts: the bar hides itself at the
        // top, and focus must not be left on a hidden control.
        search?.focus({ preventScroll: true });
    });

    contentsButton?.addEventListener('click', () => setContents(!expanded(contentsButton)));
    contentsPanel?.addEventListener('click', (event) => {
        if (event.target.closest('a')) setContents(false);
    });
    filtersButton?.addEventListener('click', () => setFilters(!expanded(filtersButton), { focus: 'none' }));

    bar.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        // Escape in a search with text in it clears the text first.
        if (event.target.matches?.('input[type="search"]') && event.target.value) return;
        if (expanded(filtersButton)) {
            event.preventDefault();
            setFilters(false, { focus: 'button' });
        } else if (expanded(contentsButton)) {
            event.preventDefault();
            setContents(false, { focusButton: true });
        }
    });
    doc.addEventListener('click', (event) => {
        if (relaying || bar.contains(event.target)) return;
        if (expanded(contentsButton)) setContents(false);
        if (expanded(filtersButton)) setFilters(false, { focus: 'none' });
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
        setContents(false);
        schedule();
    });
    update();
    return { update, setContents, setFilters };
}
