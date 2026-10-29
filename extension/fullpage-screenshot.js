'use strict';

/**
 * This module expects background.js to provide:
 *   - execInTab(tabId, {func, args, world})
 *
 * We attach a single entrypoint on globalThis so background.js can call it easily.
 */
globalThis.A11YFullPageScreenshot = (function () {
    // Prefer browser (Firefox), fall back to chrome (Chrome/Edge)
    const api = globalThis.browser || globalThis.chrome;

    async function measurePage(tabId) {
        // Needs execInTab from background.js
        const execInTab = globalThis.__A11Y_EXEC_IN_TAB;
        if (typeof execInTab !== 'function') return null;

        try {
            const arr = await execInTab(tabId, {
                world: 'MAIN',
                func: () => {
                    const de = document.documentElement;
                    const b = document.body;

                    const scrollWidth = Math.max(
                        de ? de.scrollWidth : 0,
                        b ? b.scrollWidth : 0,
                        de ? de.offsetWidth : 0,
                        b ? b.offsetWidth : 0
                    );

                    const scrollHeight = Math.max(
                        de ? de.scrollHeight : 0,
                        b ? b.scrollHeight : 0,
                        de ? de.offsetHeight : 0,
                        b ? b.offsetHeight : 0
                    );

                    return {
                        width: Number(scrollWidth) || 0,
                        height: Number(scrollHeight) || 0,
                        dpr: Number(window.devicePixelRatio) || 1
                    };
                }
            });

            const m = arr && arr[0];
            if (!m || !m.width || !m.height) return null;
            return m;
        } catch {
            return null;
        }
    }

    async function captureViewportScreenshot(tabId) {
        // Resolve a windowId, avoids flakiness with null in MV3 service workers.
        let winId = null;
        try {
            if (api.tabs && typeof api.tabs.get === 'function' && typeof tabId === 'number') {
                const t = await api.tabs.get(tabId);
                if (t && typeof t.windowId === 'number') winId = t.windowId;
            }
        } catch {}

        return new Promise((resolve) => {
            try {
                const fn = api.tabs && api.tabs.captureVisibleTab;
                if (typeof fn !== 'function') return resolve(null);

                // Firefox: Promise return
                if (globalThis.browser && !globalThis.chrome) {
                    Promise.resolve(fn.call(api.tabs, winId, { format: 'png' }))
                        .then((dataUrl) => resolve(dataUrl || null))
                        .catch(() => resolve(null));
                    return;
                }

                // Chromium: callback style
                fn.call(api.tabs, winId, { format: 'png' }, (dataUrl) => resolve(dataUrl || null));
            } catch {
                resolve(null);
            }
        });
    }

    // -----------------------------
    // Firefox best path: scroll + capture + stitch
    // -----------------------------
    // Firefox's tabs.captureTab() only ever captures the visible viewport - it
    // takes just {format, quality} (see MDN), there is no "rect" or any other
    // option to capture beyond it, unlike Chrome's CDP path below. So instead
    // we scroll the page in viewport-height steps, capture each step, and draw
    // them onto one canvas. This visibly scrolls the real tab while it runs
    // (there's no way around that without CDP-equivalent access) - we restore
    // the original scroll position afterward.
    const MAX_STITCH_SLICES = 40;

    async function getViewportInfo(tabId) {
        const execInTab = globalThis.__A11Y_EXEC_IN_TAB;
        if (typeof execInTab !== 'function') return null;
        try {
            const arr = await execInTab(tabId, {
                world: 'MAIN',
                func: () => ({
                    width: Number(window.innerWidth) || 0,
                    height: Number(window.innerHeight) || 0,
                    scrollY: Number(window.scrollY) || 0
                })
            });
            const v = arr && arr[0];
            return (v && v.width && v.height) ? v : null;
        } catch {
            return null;
        }
    }

    async function scrollTabTo(tabId, y) {
        const execInTab = globalThis.__A11Y_EXEC_IN_TAB;
        if (typeof execInTab !== 'function') return null;
        try {
            const arr = await execInTab(tabId, {
                world: 'MAIN',
                args: [y],
                func: (targetY) => {
                    window.scrollTo(0, targetY);
                    return Number(window.scrollY) || 0;
                }
            });
            const v = arr && arr[0];
            return (typeof v === 'number') ? v : null;
        } catch {
            return null;
        }
    }

    function waitForRepaint() {
        // Lets scroll-linked effects (sticky headers, lazy-loaded images) settle
        // before the next capture. A fixed delay is more reliable here than
        // requestAnimationFrame, which browsers may throttle in a background page.
        return new Promise((resolve) => setTimeout(resolve, 80));
    }

    async function captureVisibleForStitch(tabId) {
        try {
            const dataUrl = await api.tabs.captureTab(tabId, { format: 'png' });
            return dataUrl || null;
        } catch {
            return null;
        }
    }

    function loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image decode failed'));
            img.src = dataUrl;
        });
    }

    async function canvasToDataUrl(canvas) {
        if (typeof canvas.convertToBlob === 'function') {
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
        }
        return canvas.toDataURL('image/png');
    }

    async function tryFirefoxStitch(tabId) {
        if (!api.tabs || typeof api.tabs.captureTab !== 'function') return null;

        const m = await measurePage(tabId);
        if (!m) return null;

        // Some pages can be huge, avoid obvious crashy sizes.
        if (m.width > 20000 || m.height > 60000) return null;

        const viewport = await getViewportInfo(tabId);
        if (!viewport) return null;

        const dpr = m.dpr || 1;
        const step = Math.max(1, viewport.height);
        const maxScrollY = Math.max(0, m.height - viewport.height);
        const slices = Math.min(MAX_STITCH_SLICES, Math.ceil(m.height / step));

        // Whole page already fits in one viewport - let the plain viewport
        // capture handle it, no need to stitch a single slice.
        if (slices <= 1 || maxScrollY <= 0) return null;

        const originalY = viewport.scrollY;
        const shots = [];

        try {
            for (let i = 0; i < slices; i++) {
                const targetY = Math.min(i * step, maxScrollY);
                const actualY = await scrollTabTo(tabId, targetY);
                if (actualY == null) break;
                await waitForRepaint();

                const dataUrl = await captureVisibleForStitch(tabId);
                if (!dataUrl) break;
                shots.push({ y: actualY, dataUrl });

                // The page couldn't scroll as far as expected (shorter than measured) - stop.
                if (actualY >= maxScrollY) break;
            }
        } finally {
            try { await scrollTabTo(tabId, originalY); } catch {}
        }

        if (!shots.length) return null;

        try {
            const canvasWidth = Math.round(m.width * dpr);
            const canvasHeight = Math.round(m.height * dpr);
            const canvas = (typeof OffscreenCanvas === 'function')
                ? new OffscreenCanvas(canvasWidth, canvasHeight)
                : Object.assign(document.createElement('canvas'), { width: canvasWidth, height: canvasHeight });
            const ctx = canvas.getContext('2d');

            for (const shot of shots) {
                const img = await loadImage(shot.dataUrl);
                ctx.drawImage(img, 0, Math.round(shot.y * dpr));
            }

            return await canvasToDataUrl(canvas);
        } catch {
            return null;
        }
    }

    // -----------------------------
    // Chrome/Edge best path: CDP Page.captureScreenshot via chrome.debugger
    // -----------------------------
    function hasChromeDebugger() {
        return !!(globalThis.chrome &&
            chrome.debugger &&
            typeof chrome.debugger.attach === 'function' &&
            typeof chrome.debugger.sendCommand === 'function' &&
            typeof chrome.debugger.detach === 'function');
    }

    function dbgAttach(tabId) {
        return new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                const err = chrome.runtime && chrome.runtime.lastError;
                if (err) reject(err);
                else resolve();
            });
        });
    }

    function dbgSend(tabId, method, params) {
        return new Promise((resolve, reject) => {
            chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
                const err = chrome.runtime && chrome.runtime.lastError;
                if (err) reject(err);
                else resolve(result);
            });
        });
    }

    function dbgDetach(tabId) {
        return new Promise((resolve) => {
            chrome.debugger.detach({ tabId }, () => resolve());
        });
    }

    async function tryChromeCDP(tabId) {
        if (!hasChromeDebugger()) return null;

        try {
            await dbgAttach(tabId);

            // Enable page domain to be safe
            try { await dbgSend(tabId, 'Page.enable'); } catch {}

            // Use layout metrics to capture the full content size
            const metrics = await dbgSend(tabId, 'Page.getLayoutMetrics');
            const cs = metrics && metrics.contentSize ? metrics.contentSize : null;
            if (!cs || !cs.width || !cs.height) return null;

            // Capture beyond viewport if supported (Chrome)
            let shot = null;

            // Attempt A: simplest, often works best when supported
            try {
                shot = await dbgSend(tabId, 'Page.captureScreenshot', {
                    format: 'png',
                    captureBeyondViewport: true,
                    fromSurface: true
                });
            } catch {}

            // Attempt B: clip-based fallback (guard extreme sizes)
            if (!shot || !shot.data) {
                // Avoid ridiculous sizes that are likely to fail.
                if (cs.width > 20000 || cs.height > 60000) return null;

                try {
                    shot = await dbgSend(tabId, 'Page.captureScreenshot', {
                        format: 'png',
                        fromSurface: true,
                        clip: { x: 0, y: 0, width: cs.width, height: cs.height, scale: 1 }
                    });
                } catch {}
            }

            const b64 = shot && shot.data ? shot.data : null;
            if (!b64) return null;

            return `data:image/png;base64,${b64}`;
        } catch {
            return null;
        } finally {
            try { await dbgDetach(tabId); } catch {}
        }
    }

    // -----------------------------
    // Public API
    // -----------------------------
    async function captureBest(tabId) {
        // 1) Chrome/Edge (MV3): CDP
        const cdp = await tryChromeCDP(tabId);
        if (cdp) return { dataUrl: cdp, mode: 'chrome-cdp-fullpage' };

        // 2) Firefox (MV2): scroll + capture + stitch
        const stitched = await tryFirefoxStitch(tabId);
        if (stitched) return { dataUrl: stitched, mode: 'firefox-stitched-fullpage' };

        // 3) Fallback: viewport
        const vp = await captureViewportScreenshot(tabId);
        if (vp) return { dataUrl: vp, mode: 'viewport-fallback' };

        return { dataUrl: null, mode: 'failed' };
    }

    return { captureBest };
})();