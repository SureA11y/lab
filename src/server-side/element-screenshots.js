'use strict';

/**
 * Pictures of the elements a scan flags, taken by @surea11y/puppeteer's
 * .screenshots() right after the scan (see engines/surea11y-scan.js).
 *
 * The a11yScan step's "Element screenshots" option says which occurrences to
 * picture; the surea11y engine puts what the binding gave on each canonical
 * occurrence as `elementScreenshot`, the PNG still as a Buffer; and the
 * runner stores each picture as an evidence file before the scan's result
 * goes anywhere, leaving `{ url, box }` in its place, so no image bytes
 * reach a payload. An occurrence the binding could not picture keeps
 * `{ skipped }`, its reason.
 *
 * A finding made in a state the rule put the page in, and took it out of
 * before the browser painted (surea11y's text spacing), shows only in that
 * state: the binding pictures its element in it as well, and the engine
 * puts that on the occurrence as `elementStateScreenshots`, a list of
 * `{ state, ... }` shaped as `elementScreenshot` is, stored the same way.
 */

const crypto = require('crypto');

// The step option's values, and the outcomes each pictures.
const STEP_OUTCOMES = {
    off: null,
    fail: ['fail'],
    failCantTell: ['fail', 'cantTell'],
};

// Context around the element in each picture, in CSS pixels.
const PADDING = 16;

// The time the pictures of one scan may take, from when they start, apart
// from the scan's own timeout: past it, no further picture is started (see
// engines/surea11y-scan.js).
const CAPTURE_BUDGET_MS = 30000;

// The error the scan wrapper stops the binding's steps with once the pictures
// are out of time: the occurrences it reaches get `{ skipped: 'time-limit' }`.
const TIME_LIMIT_ERROR = 'surea11y-lab: element screenshots out of time';

// The most pictures one scan takes, unless the step says otherwise.
const DEFAULT_MAX = 50;

// What the binding is given for a step that sets no limit (0): it takes a
// whole number, and the time limit (CAPTURE_BUDGET_MS) still bounds a scan.
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

// A step field as a whole number, or null: the step editor saves numbers
// as text, and a {var:...} resolves to text too.
function wholeNumber(value) {
    const n = typeof value === 'string' && value.trim() ? Number(value) : value;
    return Number.isInteger(n) ? n : null;
}

/**
 * The binding's .screenshots() options for the step's values, or null for
 * none: which outcomes to picture; at most how many pictures in all
 * (`max`: a whole number of 1 or more, 0 for no limit, else DEFAULT_MAX);
 * and, when the step sets one, at most how many elements of each rule
 * (`perRule`, the lab's own, see engines/surea11y-scan.js; 0 or none for
 * no limit).
 */
function screenshotOptionsForStep(value, max = null, perRule = null) {
    const outcomes = Object.prototype.hasOwnProperty.call(STEP_OUTCOMES, value) ? STEP_OUTCOMES[value] : null;
    if (!outcomes) return null;
    const total = wholeNumber(max);
    const each = wholeNumber(perRule);
    return {
        outcomes: outcomes.slice(),
        padding: PADDING,
        max: total === 0 ? NO_LIMIT : (total !== null && total >= 1 ? total : DEFAULT_MAX),
        ...(each !== null && each >= 1 ? { perRule: each } : {}),
    };
}

/**
 * What a canonical occurrence keeps of the binding's `screenshot` field, or
 * null when it has none: the PNG and where the element is in it, or why
 * there is no picture.
 */
function elementScreenshotOf(screenshot, { max = null } = {}) {
    if (!screenshot || typeof screenshot !== 'object') return null;
    if (Buffer.isBuffer(screenshot.buffer) || screenshot.buffer instanceof Uint8Array) {
        return {
            buffer: Buffer.isBuffer(screenshot.buffer) ? screenshot.buffer : Buffer.from(screenshot.buffer),
            box: screenshot.box || null,
            ...(screenshot.cropped ? { cropped: true } : {}),
        };
    }
    if (typeof screenshot.skipped === 'string') {
        if (screenshot.skipped === 'capture-failed' && screenshot.error === TIME_LIMIT_ERROR) return { skipped: 'time-limit' };
        if (screenshot.skipped === 'max-reached' && Number.isInteger(max)) return { skipped: 'max-reached', max };
        return {
            skipped: screenshot.skipped,
            // A rule's own limit (rule-limit) says what it was.
            ...(Number.isInteger(screenshot.max) ? { max: screenshot.max } : {}),
            ...(screenshot.error ? { error: String(screenshot.error) } : {}),
        };
    }
    return null;
}

/**
 * What a canonical occurrence keeps of the binding's `stateScreenshots`, or
 * null when it has none: each picture in a state, as elementScreenshotOf()
 * keeps a picture, with its `state`.
 */
function elementStateScreenshotsOf(list, { max = null } = {}) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object' || typeof entry.state !== 'string' || !entry.state) continue;
        const kept = elementScreenshotOf(entry, { max });
        if (kept) out.push({ state: entry.state, ...kept });
    }
    return out.length ? out : null;
}

/**
 * Stores every picture in a scan's canonical result, its pictures in a
 * state too, and puts its URL in place of its bytes, in place. Occurrences
 * of one element share one picture, which is stored once; so are criteria
 * that copy a check's occurrences.
 *
 * @param {object} canonical the scan's canonical result
 * @param {{ save?: (file: { data: Buffer, filename: string, dir: string }) => Promise<{ publicUrl?: string|null }>,
 *   dir?: string }} [opts] `save` writes a file and says where it is
 *   served; without it, or when it gives no URL, the picture is kept as a
 *   data URL.
 * @returns {Promise<number>} how many pictures were stored
 */
async function storeElementScreenshots(canonical, { save = null, dir = 'elements' } = {}) {
    const stored = new Map();
    const pending = [];
    const pendingStates = [];
    const seen = new Set();

    const visit = (node) => {
        if (!node || typeof node !== 'object' || seen.has(node) || Buffer.isBuffer(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) visit(item);
            return;
        }
        const shot = node.elementScreenshot;
        if (shot && typeof shot === 'object' && Buffer.isBuffer(shot.buffer)) {
            pending.push(node);
        }
        if (Array.isArray(node.elementStateScreenshots)
            && node.elementStateScreenshots.some((e) => e && typeof e === 'object' && Buffer.isBuffer(e.buffer))) {
            pendingStates.push(node);
        }
        for (const key of Object.keys(node)) {
            if (key !== 'elementScreenshot' && key !== 'elementStateScreenshots') visit(node[key]);
        }
    };
    visit(canonical);

    const storeShared = (shot) => {
        if (!stored.has(shot.buffer)) stored.set(shot.buffer, storeOne(shot, { save, dir }));
        return stored.get(shot.buffer);
    };
    for (const occurrence of pending) {
        occurrence.elementScreenshot = await storeShared(occurrence.elementScreenshot);
    }
    // Occurrences of one element share its entries: each is replaced once.
    const replaced = new Map();
    for (const occurrence of pendingStates) {
        occurrence.elementStateScreenshots = await Promise.all(occurrence.elementStateScreenshots.map(async (entry) => {
            if (!entry || typeof entry !== 'object' || !Buffer.isBuffer(entry.buffer)) return replaced.get(entry) || entry;
            if (!replaced.has(entry)) replaced.set(entry, { state: entry.state, ...(await storeShared(entry)) });
            return replaced.get(entry);
        }));
    }
    return stored.size;
}

async function storeOne(shot, { save, dir }) {
    const kept = { box: shot.box || null, ...(shot.cropped ? { cropped: true } : {}) };
    // Named by its content: the same picture is the same file.
    const filename = `element-${crypto.createHash('sha1').update(shot.buffer).digest('hex').slice(0, 12)}.png`;
    if (typeof save === 'function') {
        try {
            const saved = await save({ data: shot.buffer, filename, dir });
            if (saved && saved.publicUrl) return { url: saved.publicUrl, ...kept };
        } catch (e) {
            return { skipped: 'store-failed', error: String((e && e.message) || e) };
        }
    }
    return { url: `data:image/png;base64,${shot.buffer.toString('base64')}`, ...kept };
}

module.exports = { STEP_OUTCOMES, DEFAULT_MAX, NO_LIMIT, CAPTURE_BUDGET_MS, TIME_LIMIT_ERROR, screenshotOptionsForStep, elementScreenshotOf, elementStateScreenshotsOf, storeElementScreenshots };
