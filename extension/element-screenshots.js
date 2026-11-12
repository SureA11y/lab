'use strict';

// Pictures of the elements a scan flags, taken by the extension right after
// the scan, as the lab's scans take them (src/server-side/element-screenshots.js):
// each element framed with 16 CSS px of the page around it and the binding's
// highlight drawn around it.
//
// The binding's own steps do the work in the page (engines/vendor/
// surea11y-screenshots.min.js, from @surea11y/binding-base): which elements to
// picture, each one found, scrolled into view and highlighted and its clip
// worked out, then the page put back. This file takes the picture between
// the two, as the binding's Cypress driver does: in Chrome through the
// DevTools protocol, a clip of the page, and elsewhere a capture of the
// visible tab cut to the clip (Chrome allows two of those a second).
//
// Each occurrence considered gets `screenshot`: { dataUrl, box, cropped? }
// (box: where the element shows in the picture, CSS px), or { skipped } and
// why. The panel's canonicalize moves it to the occurrence's
// elementScreenshot, as the lab's engine does.
//
// Loaded by the background (importScripts in Chrome, manifest.json's
// background scripts in Firefox) and, for its tests, by Node.

(function (global) {
    // The panel's choices, as the lab's scan step's "Element screenshots".
    const OUTCOMES = {
        off: null,
        fail: ['fail'],
        failCantTell: ['fail', 'cantTell']
    };
    const DEFAULT_CHOICE = 'fail';
    const DEFAULT_MAX = 50;
    // Context around the element in each picture, in CSS pixels, as the lab's.
    const PADDING = 16;
    // The time the pictures of one scan may take, as the lab's: past it, no
    // further picture is started.
    const BUDGET_MS = 30000;
    // Chrome takes at most two captures of the visible tab a second.
    const VISIBLE_CAPTURE_GAP_MS = 550;

    /**
     * The binding's options for the panel's choices, or null for none.
     * `max`: a whole number of 1 or more, else DEFAULT_MAX.
     */
    function optionsFor(choice, max) {
        const outcomes = Object.prototype.hasOwnProperty.call(OUTCOMES, choice) ? OUTCOMES[choice] : OUTCOMES[DEFAULT_CHOICE];
        if (!outcomes) return null;
        const n = typeof max === 'string' && max.trim() ? Number(max) : max;
        return { outcomes, padding: PADDING, highlight: true, max: Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX };
    }

    function errorMessage(e) {
        return (e && e.message) || String(e);
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * Pictures the elements `result` (the engine's own result, its
     * checksResults) flags with the chosen outcomes, putting `screenshot` on
     * each occurrence considered. Changes `result` in place and resolves to
     * it; never throws: a picture that fails says why on its occurrences.
     *
     * @param {object} result
     * @param {{ choice?: string, max?: number }} choices the panel's
     * @param {{ evaluate: (fn: Function, args: Array) => Promise<*>,
     *   capturer: { box: (clip, view) => Promise<string>, close: () => Promise<void> },
     *   steps?: object, now?: () => number }} driver how to run the binding's
     *   step in the page, and how to take a picture of a clip
     */
    async function pictureFlaggedElements(result, choices, driver) {
        const steps = driver.steps || global.SUREA11Y_SCREENSHOTS;
        const options = optionsFor(choices && choices.choice, choices && choices.max);
        if (!options || !steps || !result || !Array.isArray(result.checksResults)) {
            await closeQuietly(driver.capturer);
            return result;
        }
        const now = driver.now || (() => Date.now());
        const started = now();
        const evaluateInFrame = (_frame, fn, args) => driver.evaluate(fn, args);
        let taken = 0;
        try {
            const { elements, unlocated } = steps.planScreenshots(result, { outcomes: options.outcomes });
            for (const occurrence of unlocated) occurrence.screenshot = { skipped: 'no-element' };
            for (const element of elements) {
                let shot;
                if (taken >= options.max) shot = { skipped: 'max-reached', max: options.max };
                else if (now() - started > BUDGET_MS) shot = { skipped: 'time-limit' };
                else shot = await pictureOne(element);
                for (const occurrence of element.occurrences) occurrence.screenshot = shot;
            }
        } catch (e) {
            // The plan itself failed: nothing pictured, said on none.
            console.warn('[A11Y] element pictures failed:', errorMessage(e));
        } finally {
            await closeQuietly(driver.capturer);
        }
        return result;

        async function pictureOne(element) {
            const token = steps.screenshotToken();
            const ready = await steps.prepareElementScreenshot({ evaluateInFrame, frame: null, framePath: [], element, options, token });
            if (ready.skipped) return { skipped: ready.skipped, ...(ready.error ? { error: String(ready.error) } : {}) };
            try {
                const dataUrl = await driver.capturer.box(ready.clip, ready.view);
                if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('the capture gave no PNG');
                taken += 1;
                return { dataUrl, box: ready.box, ...(ready.cropped ? { cropped: true } : {}) };
            } catch (e) {
                return { skipped: 'capture-failed', error: errorMessage(e) };
            } finally {
                await steps.releaseElementScreenshot({ evaluateInFrame, frame: null, framePath: [], token });
            }
        }
    }

    async function closeQuietly(capturer) {
        try { if (capturer && typeof capturer.close === 'function') await capturer.close(); } catch {}
    }

    // --- Capturers, for the background ----------------------------------

    /**
     * Chrome: a clip of the page through the DevTools protocol, attached once
     * for the scan's pictures. The clip is the viewport's, moved by the
     * page's scroll, as the binding's Puppeteer driver gives it;
     * captureBeyondViewport: false keeps Chrome from laying the page out
     * again. Null when the debugger can't attach (no permission: Firefox).
     */
    async function cdpCapturer(tabId) {
        const dbg = global.chrome && global.chrome.debugger;
        if (!dbg || typeof dbg.attach !== 'function') return null;
        const call = (fn, ...args) => new Promise((resolve, reject) => {
            fn.call(dbg, ...args, (value) => {
                const err = global.chrome.runtime && global.chrome.runtime.lastError;
                if (err) reject(new Error(err.message || String(err)));
                else resolve(value);
            });
        });
        try {
            await call(dbg.attach, { tabId }, '1.3');
        } catch {
            return null;
        }
        return {
            mode: 'cdp',
            async box(clip, view) {
                const shot = await call(dbg.sendCommand, { tabId }, 'Page.captureScreenshot', {
                    format: 'png',
                    fromSurface: true,
                    captureBeyondViewport: false,
                    clip: { x: clip.x + view.scroll.x, y: clip.y + view.scroll.y, width: clip.width, height: clip.height, scale: 1 }
                });
                if (!shot || !shot.data) throw new Error('no picture from the DevTools protocol');
                return 'data:image/png;base64,' + shot.data;
            },
            async close() {
                await call(dbg.detach, { tabId }).catch(() => {});
            }
        };
    }

    /**
     * Anywhere: the visible tab, captured and cut to the clip. The capture
     * holds the window's viewport at the screen's scale, read from the
     * image itself. Captures are spaced as Chrome requires.
     */
    function visibleCapturer(captureVisible) {
        let last = 0;
        return {
            mode: 'visible',
            async box(clip, view) {
                const wait = last + VISIBLE_CAPTURE_GAP_MS - Date.now();
                if (wait > 0) await sleep(wait);
                last = Date.now();
                const dataUrl = await captureVisible();
                if (!dataUrl) throw new Error('the visible tab could not be captured');
                return cropDataUrl(dataUrl, clip, view);
            },
            async close() {}
        };
    }

    async function cropDataUrl(dataUrl, clip, view) {
        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        try {
            const width = view && view.viewport && view.viewport.width;
            const scale = width ? bitmap.width / width : ((view && view.devicePixelRatio) || 1);
            const sx = Math.round(clip.x * scale);
            const sy = Math.round(clip.y * scale);
            const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(clip.width * scale)));
            const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(clip.height * scale)));
            const canvas = new OffscreenCanvas(sw, sh);
            canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
            const png = await canvas.convertToBlob({ type: 'image/png' });
            return await blobToDataUrl(png);
        } finally {
            if (typeof bitmap.close === 'function') bitmap.close();
        }
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error || new Error('could not read the picture'));
            reader.readAsDataURL(blob);
        });
    }

    /**
     * The background's entry: pictures `result`'s flagged elements in
     * `tabId`. `exec` runs a function in the tab (background.js's
     * execInTab); `captureVisible` captures the visible tab.
     */
    async function pictureInTab(tabId, result, choices, { exec, captureVisible }) {
        if (!optionsFor(choices && choices.choice, choices && choices.max)) return result;
        const capturer = (await cdpCapturer(tabId)) || visibleCapturer(captureVisible);
        return pictureFlaggedElements(result, choices, {
            evaluate: async (fn, args) => {
                // The extension's own world, where the step keeps what it
                // must undo between calls, out of the page's reach.
                const out = await exec(tabId, { func: fn, args, world: 'ISOLATED' });
                return Array.isArray(out) ? out[0] : out;
            },
            capturer
        });
    }

    const api = { OUTCOMES, DEFAULT_CHOICE, DEFAULT_MAX, PADDING, BUDGET_MS, optionsFor, pictureFlaggedElements, pictureInTab, visibleCapturer };
    global.A11YElementScreenshots = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
