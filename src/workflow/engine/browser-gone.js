'use strict';

// When the browser itself goes away mid-run (it crashed, ran out of memory,
// or was killed), Puppeteer reports whatever it was doing at that moment:
// "Attempted to use detached Frame …", "Target closed", "Session closed".
// None of that says what happened, so the step's error is replaced with a
// sentence that does, keeping Puppeteer's words after it for whoever debugs.

/** Whether `page`'s browser is no longer connected. */
function browserGone(page) {
    try {
        const browser = page && typeof page.browser === 'function' ? page.browser() : null;
        return !!browser && browser.connected === false;
    } catch {
        return false;
    }
}

/**
 * The error to report for `err`, thrown by a step on `page`: the same one,
 * unless the browser has gone, in which case its message says so.
 */
function explainBrowserGone(err, page) {
    if (!browserGone(page) || (err && err.browserGone)) return err;
    const msg = err && err.message ? String(err.message) : String(err);
    const explained = 'The browser closed unexpectedly (it crashed, ran out of memory or was stopped), '
        + 'so the run stopped at this step and keeps what it found before it. The next run starts a new browser. '
        + `(${msg})`;
    if (err && typeof err === 'object') {
        try {
            err.message = explained;
            err.browserGone = true;
            return err;
        } catch {
            // A frozen error: report a new one.
        }
    }
    const out = new Error(explained);
    out.browserGone = true;
    return out;
}

module.exports = { explainBrowserGone, browserGone };
