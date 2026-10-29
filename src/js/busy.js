'use strict';

// Feedback for actions that take a while: opening or comparing a large
// report, reading a batch's results. Most of that work runs on the page's
// only thread, so a change made just before it would not be drawn until it
// was over and the click would seem to do nothing. The control is marked
// busy, the browser is given a frame to show it, and only then does the work
// start. The spinner turns on the compositor, so it keeps turning meanwhile.

/** Resolves once the browser has had a frame to paint what just changed. */
export function afterPaint() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
            setTimeout(resolve, 0);
            return;
        }
        requestAnimationFrame(() => setTimeout(resolve, 0));
    });
}

/**
 * Marks a control busy (or not): it shows a spinner, reads as unavailable
 * (aria-disabled, so it keeps its place in the tab order and focus) and
 * cannot be pressed again. Leaves a control that was already unavailable so.
 */
export function setBusy(control, busy) {
    if (!control) return;
    if (busy) {
        if (control.dataset.busy === 'true') return;
        control.dataset.busy = 'true';
        control.dataset.busyAriaDisabled = control.getAttribute('aria-disabled') ?? '';
        control.setAttribute('aria-disabled', 'true');
        return;
    }
    if (control.dataset.busy !== 'true') return;
    const before = control.dataset.busyAriaDisabled;
    if (before) control.setAttribute('aria-disabled', before);
    else control.removeAttribute('aria-disabled');
    delete control.dataset.busy;
    delete control.dataset.busyAriaDisabled;
}

export function isBusy(control) {
    return !!control && control.dataset.busy === 'true';
}

/**
 * Runs `work` with `control` busy, after a frame to show it. A press while it
 * is busy does nothing and resolves undefined. Returns what `work` returns.
 */
export async function runBusy(control, work) {
    if (isBusy(control)) return undefined;
    setBusy(control, true);
    try {
        await afterPaint();
        return await work();
    } finally {
        setBusy(control, false);
    }
}
