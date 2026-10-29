'use strict';

/**
 * Whether the page had finished loading when it was scanned.
 *
 * A scan measures layout and colour as they stand: an image that arrives a
 * moment later can move what target-size measured, and a web font that has
 * not loaded yet changes which text is cut off. The runner already lets the
 * page settle; this asks @surea11y/core's waitForPageReady, which waits for
 * the load event, web fonts and images (not lazy ones), up to a timeout, and
 * says what was still loading when it gave up. It never rejects, and works
 * for every engine, since it runs before any of them.
 */

const { waitForPageReady } = require('@surea11y/core');
const { readinessNotice } = require('../shared/scan-notes.js');

const DEFAULT_TIMEOUT_MS = 3000;

/** The step's pageReadyTimeout, in ms: 0 checks without waiting. */
function resolveReadyTimeout(value) {
    const n = Number(value);
    return value != null && value !== '' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * -> { ready, waitedMs, pending: { load, fonts, images } }, or null when
 * core has no waitForPageReady or the page could not be asked.
 */
async function checkPageReady(page, { timeoutMs } = {}) {
    if (typeof waitForPageReady !== 'function' || !page || typeof page.evaluate !== 'function') return null;
    try {
        const result = await page.evaluate(waitForPageReady, { timeoutMs: resolveReadyTimeout(timeoutMs) });
        return result && typeof result === 'object' && typeof result.ready === 'boolean' ? result : null;
    } catch {
        return null;
    }
}

module.exports = { DEFAULT_TIMEOUT_MS, resolveReadyTimeout, checkPageReady, readinessNotice };
