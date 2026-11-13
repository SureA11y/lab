'use strict';

/**
 * The configuration's run bar (its status line, Cancel, Dry run and Run)
 * stays in sight: CSS keeps it on the window's bottom edge while its place
 * at the configuration's end is below the window, and lets it scroll up with
 * the configuration once that end comes into view.
 *
 * This adds what CSS cannot say alone:
 * - `is-stuck` while it floats over the configuration, for its shadow;
 * - its height as `--run-bar-h` on the page, so a control that takes focus
 *   scrolls clear of it;
 * - `--run-bar-lift` on the page: how far a run's floating totals card
 *   (live.css) moves up so it sits above the bar where they would meet,
 *   rather than over its buttons. The bar itself never moves for it.
 */

// Between the bar and the card moved up above it.
const CARD_GAP_PX = 8;
// The card's gap to the bottom edge when not moved (live.css), if unset.
const CARD_EDGE_PX = 16;
// How long the card slides onto the bar or back to its corner (live.css).
const SETTLE_MS = 200;
const FLOATING_CARD = '.live-totals:not(.live-totals--inline):not(.is-tab-hidden)';

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

    const resized = win && typeof win.ResizeObserver === 'function'
        ? new win.ResizeObserver(() => { measure(); schedule(); })
        : null;

    function measure() {
        root.style.setProperty('--run-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    }

    // The card is made for a run and taken away after it; it is watched for
    // its size (its ledger opens above it) while it is there.
    let watchedCard = null;
    let lift = 0;
    let settleTimer = 0;
    // Read where things are now. Not with an IntersectionObserver: a jump
    // from below the configuration's end to above it (Back to top) crosses
    // the window without its place ever being in it, and tells it nothing.
    function update() {
        const viewBottom = win?.innerHeight || root.clientHeight;
        setStuck(!!bar.getBoundingClientRect().height && sentinel.getBoundingClientRect().top >= viewBottom);
        placeCard();
    }

    function placeCard() {
        const card = doc.querySelector(FLOATING_CARD);
        const sameCard = !!card && card === watchedCard;
        if (card !== watchedCard) {
            if (watchedCard) resized?.unobserve(watchedCard);
            if (card) resized?.observe(card);
            watchedCard = card;
        }
        let next = 0;
        const viewBottom = win?.innerHeight || root.clientHeight;
        const barBox = bar.getBoundingClientRect();
        if (card && barBox.height && barBox.top < viewBottom && barBox.bottom > 0) {
            // Where the card sits when not moved: its own gap to the bottom
            // edge, read from its style, as mid-slide its box is on the way.
            const cardBox = card.getBoundingClientRect();
            const edge = cardEdge(card);
            const cardTop = viewBottom - edge - cardBox.height;
            if (barBox.bottom > cardTop) {
                next = Math.max(0, Math.ceil(viewBottom - barBox.top + CARD_GAP_PX - edge));
            }
        }
        if (next !== lift) {
            // Onto the bar from its corner, or back: it slides. A card that
            // has just come takes its place at once.
            if (sameCard && (lift === 0) !== (next === 0)) settle(card);
            lift = next;
            root.style.setProperty('--run-bar-lift', `${lift}px`);
        }
    }

    function cardEdge(card) {
        const px = parseFloat(win?.getComputedStyle?.(card).getPropertyValue('--live-totals-edge'));
        return Number.isFinite(px) ? px : CARD_EDGE_PX;
    }

    function settle(card) {
        card.classList.add('is-settling');
        if (settleTimer) win.clearTimeout(settleTimer);
        settleTimer = win.setTimeout(() => {
            settleTimer = 0;
            card.classList.remove('is-settling');
        }, SETTLE_MS + 50);
    }

    // Once a frame at most, as the page scrolls or changes size.
    let frame = 0;
    function schedule() {
        if (frame || !win) return;
        const later = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (fn) => win.setTimeout(fn, 16);
        frame = later(() => {
            frame = 0;
            update();
        });
    }

    if (win) {
        win.addEventListener('scroll', schedule, { passive: true });
        win.addEventListener('resize', schedule, { passive: true });
    }
    // A run's card comes and goes with `has-floating-totals` on the page.
    if (win && typeof win.MutationObserver === 'function') {
        new win.MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['class'] });
    }
    // The bar moves without a scroll too: the configuration, or the page
    // around it, changes size (a step opens; a run marks its steps).
    resized?.observe(bar);
    resized?.observe(bar.parentNode);
    if (doc.body) resized?.observe(doc.body);
    measure();
    update();

    return { update };
}
