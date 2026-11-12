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
    // Firefox best path: one capture of the whole document
    // -----------------------------
    // tabs.captureTab takes a rect, an area of the document in its CSS
    // pixels, and a scale (Firefox 82): the whole page in one picture, drawn
    // where it is, with nothing scrolled. It replaces scrolling the page a
    // viewport at a time and stitching the captures, which moved the page in
    // front of the person using it. A page larger than an image may be is
    // pictured at a smaller scale; one that can't be, or a Firefox without
    // rect, gets the visible part (captureBest's fallback), never a scroll.
    const MAX_IMAGE_SIDE = 32000;
    const MAX_IMAGE_PIXELS = 120 * 1000 * 1000;

    async function tryFirefoxRect(tabId) {
        if (!api.tabs || typeof api.tabs.captureTab !== 'function') return null;

        const m = await measurePage(tabId);
        if (!m) return null;

        const dpr = m.dpr || 1;
        const scale = Math.min(
            dpr,
            MAX_IMAGE_SIDE / m.width,
            MAX_IMAGE_SIDE / m.height,
            Math.sqrt(MAX_IMAGE_PIXELS / (m.width * m.height))
        );
        // Too large to be legible, even scaled.
        if (!(scale > 0.1)) return null;

        try {
            const dataUrl = await api.tabs.captureTab(tabId, {
                format: 'png',
                rect: { x: 0, y: 0, width: m.width, height: m.height },
                scale
            });
            return dataUrl || null;
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

        // 2) Firefox: the whole document in one capture, nothing scrolled
        const whole = await tryFirefoxRect(tabId);
        if (whole) return { dataUrl: whole, mode: 'firefox-fullpage' };

        // 3) Fallback: viewport
        const vp = await captureViewportScreenshot(tabId);
        if (vp) return { dataUrl: vp, mode: 'viewport-fallback' };

        return { dataUrl: null, mode: 'failed' };
    }

    return { captureBest };
})();