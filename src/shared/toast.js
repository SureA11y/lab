'use strict';

/**
 * toast.js (shared)
 *
 * Transient notifications rendered into a single live region, so a message is
 * both shown and announced to assistive technology. Reusable across the app and
 * exported reports.
 *
 * Browser: available as globalThis.A11Y_TOAST.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_TOAST = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const REGION_ID = 'a11y-toast-region';
    const DEFAULT_DURATION = 4000;

    function doc() {
        return (typeof document !== 'undefined') ? document : null;
    }

    function ensureRegion() {
        const d = doc();
        if (!d || !d.body) return null;
        let region = d.getElementById(REGION_ID);
        if (!region) {
            region = d.createElement('div');
            region.id = REGION_ID;
            region.className = 'toast-region';
            region.setAttribute('role', 'status');
            region.setAttribute('aria-live', 'polite');
            region.setAttribute('aria-atomic', 'false');
            d.body.appendChild(region);
        }
        return region;
    }

    // Shows a toast with the given message and returns a dismiss function.
    // `type` sets a modifier class (info | success | warning | error).
    function showToast(message, options) {
        const opts = options || {};
        const region = ensureRegion();
        if (!region) return function () {};

        const d = doc();
        const toast = d.createElement('div');
        toast.className = 'toast toast--' + (opts.type || 'info');
        toast.textContent = String(message == null ? '' : message);
        region.appendChild(toast);

        let done = false;
        function dismiss() {
            if (done) return;
            done = true;
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }

        const duration = Number.isFinite(opts.duration) ? opts.duration : DEFAULT_DURATION;
        if (duration > 0 && typeof setTimeout === 'function') {
            setTimeout(dismiss, duration);
        }
        return dismiss;
    }

    function clearToasts() {
        const region = ensureRegion();
        if (region) region.textContent = '';
    }

    return { showToast, clearToasts, ensureRegion, REGION_ID };
});
