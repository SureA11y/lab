'use strict';

// Pictures of the elements a scan flags, taken by the extension right after
// the scan, as the lab's scans take them (src/server-side/element-screenshots.js):
// each element framed with 16 CSS px of the page around it and the binding's
// highlight around it.
//
// Without touching the page. The binding's own step scrolls each element
// into view and draws its highlight on the page, as a browser it drives is
// nobody's to look at; on a page a person is using, every scroll moved what
// they were looking at, a page that loads more as it is scrolled kept
// loading, and the highlight flashed on it. Here the page only answers
// where the element is: nothing is scrolled, nothing is drawn on it. The
// picture is taken of that part of the document wherever it is, and the
// binding's highlight is drawn on the picture:
// - Firefox: tabs.captureTab with a rect, in the document's CSS pixels;
// - Chrome: the DevTools protocol, a clip of the document;
// - elsewhere: only an element in the visible part of the page, cut from a
//   capture of it.
// An element scrolled out of sight inside a scrolling box is not drawn
// where it is in the document: it is not pictured ("hidden-in-container"),
// and one partly shown is pictured as far as it shows ("cropped").
//
// The binding is still what chooses the elements (planScreenshots, from
// engines/vendor/surea11y-screenshots.min.js): the occurrences of the chosen
// outcomes, one picture for an element flagged twice. That reads the result
// and does nothing in the page.
//
// Each occurrence considered gets `screenshot`: { dataUrl, box, cropped? }
// (box: where the element shows in the picture, CSS px), or { skipped } and
// why. The panel's canonicalize moves it to the occurrence's
// elementScreenshot, { url, box }, its url the data URL, as the lab's engine
// does with a stored picture's link, so the lab reads it as its own.
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
    // The space the highlight takes around the element, as the binding's.
    const RING = 4;
    // The time the pictures of one scan may take, as the lab's: past it, no
    // further picture is started.
    const BUDGET_MS = 30000;
    // Chrome takes at most two captures of the visible tab a second.
    const VISIBLE_CAPTURE_GAP_MS = 550;

    /**
     * The options for the panel's choices, or null for none. `max`: a whole
     * number of 1 or more, else DEFAULT_MAX.
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
     * Runs in the page and only reads it: where the element is. It neither
     * scrolls the page nor changes anything in it. Self-contained: it is
     * sent to the tab as its source. Given { selector, hosts, margin },
     * returns { clip, box, element, cropped, view }: clip, the part of the
     * document to picture, in its CSS pixels; box, where the element shows
     * in it; element, where the whole element is in it (the highlight goes
     * around it); or { skipped } and why.
     */
    function pictureStepInPage(request) {
        // The element, through the shadow roots its hosts lead into.
        let node = null;
        try {
            let root = document;
            for (const host of request.hosts || []) {
                const h = root.querySelector(host);
                root = h && h.shadowRoot;
                if (!root) return { skipped: 'no-element' };
            }
            node = root.querySelector(request.selector);
        } catch (e) {
            return { skipped: 'no-element' };
        }
        if (!node) return { skipped: 'no-element' };
        if (node === document.documentElement || node === document.head || node === document.body) return { skipped: 'page-level' };
        if (!node.getClientRects().length) return { skipped: 'not-rendered' };
        const b = node.getBoundingClientRect();
        if (!(b.width > 0) || !(b.height > 0)) return { skipped: 'zero-size' };

        // What of it shows: a box that clips or scrolls its content hides
        // what is outside its padding box, wherever the page is scrolled.
        const parentOf = (el) => el.assignedSlot || el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
        let vis = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        for (let el = parentOf(node); el && el !== document.documentElement && el !== document.body; el = parentOf(el)) {
            const s = getComputedStyle(el);
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
            const r = el.getBoundingClientRect();
            const left = r.left + el.clientLeft;
            const top = r.top + el.clientTop;
            vis = {
                left: Math.max(vis.left, left),
                top: Math.max(vis.top, top),
                right: Math.min(vis.right, left + el.clientWidth),
                bottom: Math.min(vis.bottom, top + el.clientHeight)
            };
            if (vis.right <= vis.left || vis.bottom <= vis.top) return { skipped: 'hidden-in-container' };
        }

        // In the document's CSS pixels, within the document.
        const sx = window.scrollX || 0;
        const sy = window.scrollY || 0;
        const de = document.documentElement;
        const docW = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth);
        const docH = Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight);
        const pad = request.margin || 0;
        const x0 = Math.max(0, Math.floor(vis.left + sx - pad));
        const y0 = Math.max(0, Math.floor(vis.top + sy - pad));
        const x1 = Math.min(docW, Math.ceil(vis.right + sx + pad));
        const y1 = Math.min(docH, Math.ceil(vis.bottom + sy + pad));
        if (x1 <= x0 || y1 <= y0) return { skipped: 'off-screen' };
        const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        const round2 = (n) => Math.round(n * 100) / 100;
        const inClip = (left, top, right, bottom) => ({
            x: round2(left + sx - clip.x),
            y: round2(top + sy - clip.y),
            width: round2(right - left),
            height: round2(bottom - top)
        });
        return {
            clip,
            box: inClip(vis.left, vis.top, vis.right, vis.bottom),
            element: inClip(b.left, b.top, b.right, b.bottom),
            cropped: (vis.right - vis.left) * (vis.bottom - vis.top) < b.width * b.height - 0.01,
            view: {
                devicePixelRatio: window.devicePixelRatio || 1,
                scroll: { x: sx, y: sy },
                viewport: { width: window.innerWidth, height: window.innerHeight }
            }
        };
    }

    /**
     * The binding's highlight, drawn on a picture rather than on the page:
     * around `element` (CSS px in the picture's clip, the picture `clipWidth`
     * CSS px wide), a white line, two of #e5007d and a white line, outside
     * the element so none of its own pixels change. Resolves to a PNG data URL.
     */
    async function drawRing(dataUrl, element, clipWidth) {
        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        try {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const s = clipWidth ? bitmap.width / clipWidth : 1;
            ctx.scale(s, s);
            const { x, y, width: w, height: h } = element;
            const stroke = (colour, line, out) => {
                ctx.strokeStyle = colour;
                ctx.lineWidth = line;
                ctx.strokeRect(x - out + line / 2, y - out + line / 2, w + 2 * out - line, h + 2 * out - line);
            };
            stroke('#ffffff', 1, RING);
            stroke('#e5007d', 2, RING - 1);
            stroke('#ffffff', 1, 1);
            const png = await canvas.convertToBlob({ type: 'image/png' });
            return await blobToDataUrl(png);
        } finally {
            if (typeof bitmap.close === 'function') bitmap.close();
        }
    }

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
     *   ring?: (dataUrl, element, clipWidth) => Promise<string>,
     *   steps?: { planScreenshots: Function }, now?: () => number }} driver how
     *   to ask the page where an element is, how to take a picture of a
     *   clip, and how to draw the highlight on it
     */
    async function pictureFlaggedElements(result, choices, driver) {
        const steps = driver.steps || global.SUREA11Y_SCREENSHOTS;
        const options = optionsFor(choices && choices.choice, choices && choices.max);
        if (!options || !steps || !result || !Array.isArray(result.checksResults)) {
            await closeQuietly(driver.capturer);
            return result;
        }
        const now = driver.now || (() => Date.now());
        const ring = driver.ring || drawRing;
        const started = now();
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
            let ready;
            try {
                ready = await driver.evaluate(pictureStepInPage, [{
                    selector: element.selector,
                    hosts: element.shadowHostSelectors || [],
                    margin: options.padding + (options.highlight ? RING : 0)
                }]);
            } catch (e) {
                return { skipped: 'capture-failed', error: errorMessage(e) };
            }
            if (!ready || typeof ready !== 'object') return { skipped: 'capture-failed', error: 'the page gave nothing to picture' };
            if (ready.skipped) return { skipped: ready.skipped };
            try {
                let dataUrl = await driver.capturer.box(ready.clip, ready.view);
                if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('the capture gave no PNG');
                if (options.highlight) dataUrl = await ring(dataUrl, ready.element, ready.clip.width);
                taken += 1;
                return { dataUrl, box: ready.box, ...(ready.cropped ? { cropped: true } : {}) };
            } catch (e) {
                if (e && e.skipped) return { skipped: e.skipped };
                return { skipped: 'capture-failed', error: errorMessage(e) };
            }
        }
    }

    async function closeQuietly(capturer) {
        try { if (capturer && typeof capturer.close === 'function') await capturer.close(); } catch {}
    }

    // An element the capture can't reach without scrolling.
    function outOfView() {
        const e = new Error('the element is outside the visible part of the page');
        e.skipped = 'outside-view';
        return e;
    }

    const inViewport = (clip, view) => clip.x >= view.scroll.x - 0.5 && clip.y >= view.scroll.y - 0.5 &&
        clip.x + clip.width <= view.scroll.x + view.viewport.width + 0.5 &&
        clip.y + clip.height <= view.scroll.y + view.viewport.height + 0.5;

    // --- Capturers, for the background ----------------------------------

    /**
     * Firefox: tabs.captureTab with a rect, a part of the document in its CSS
     * pixels, rendered where it is: nothing scrolls. At the screen's scale.
     * Null where captureTab is missing (Chrome).
     */
    function firefoxCapturer(tabId, api) {
        if (!api || !api.tabs || typeof api.tabs.captureTab !== 'function') return null;
        return {
            mode: 'firefox-rect',
            async box(clip, view) {
                const dataUrl = await api.tabs.captureTab(tabId, {
                    format: 'png',
                    rect: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
                    scale: (view && view.devicePixelRatio) || 1
                });
                if (!dataUrl) throw new Error('Firefox gave no picture');
                return dataUrl;
            },
            async close() {}
        };
    }

    /**
     * Chrome: a clip of the document through the DevTools protocol, attached
     * once for the scan's pictures. An element in view is taken as the page
     * shows it; one out of view with captureBeyondViewport, which renders it
     * where it is, as the scan's picture of the whole page does: neither
     * scrolls. Null when the debugger can't attach.
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
                    captureBeyondViewport: !inViewport(clip, view),
                    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
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
     * Anywhere else: the visible tab, captured and cut to the clip, for an
     * element in view only. Captures are spaced as Chrome requires.
     */
    function visibleCapturer(captureVisible) {
        let last = 0;
        return {
            mode: 'visible',
            async box(clip, view) {
                if (!inViewport(clip, view)) throw outOfView();
                const wait = last + VISIBLE_CAPTURE_GAP_MS - Date.now();
                if (wait > 0) await sleep(wait);
                last = Date.now();
                const dataUrl = await captureVisible();
                if (!dataUrl) throw new Error('the visible tab could not be captured');
                const inView = { x: clip.x - view.scroll.x, y: clip.y - view.scroll.y, width: clip.width, height: clip.height };
                return cropDataUrl(dataUrl, inView, view);
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
     * `tabId`. `exec` runs a function in the tab (background.js's execInTab);
     * `captureVisible` captures the visible tab; `api` is the browser's
     * extension API (captureTab in Firefox).
     */
    async function pictureInTab(tabId, result, choices, { exec, captureVisible, api = global.browser || global.chrome }) {
        if (!optionsFor(choices && choices.choice, choices && choices.max)) return result;
        const capturer = firefoxCapturer(tabId, api) || (await cdpCapturer(tabId)) || visibleCapturer(captureVisible);
        return pictureFlaggedElements(result, choices, {
            evaluate: async (fn, args) => {
                // The extension's own world, out of the page's reach.
                const out = await exec(tabId, { func: fn, args, world: 'ISOLATED' });
                return Array.isArray(out) ? out[0] : out;
            },
            capturer
        });
    }

    const api = {
        OUTCOMES, DEFAULT_CHOICE, DEFAULT_MAX, PADDING, RING, BUDGET_MS,
        optionsFor, pictureStepInPage, drawRing, pictureFlaggedElements, pictureInTab, visibleCapturer, firefoxCapturer
    };
    global.A11YElementScreenshots = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
