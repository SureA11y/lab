'use strict';

const { isNonEmptyString, toNumber, sleep } = require('./utils');
const { pushLog } = require('./log');

function safePageUrl(page) {
    try { return page.url(); } catch { return ''; }
}

async function stopLoading(page) {
    try { await page.evaluate(() => { try { window.stop(); } catch {} }); } catch {}
    try { await page._client().send('Page.stopLoading'); } catch {}
}

/** Normalize problematic waitUntil values for real-world sites. */
function normalizeWaitUntil(v) {
    const s = (typeof v === 'string' ? v.trim() : '');
    if (!s) return 'load';
    if (s === 'networkidle0') return 'networkidle2';
    return s;
}

async function waitForRenderSettle(page, timeoutMs = 2000) {
    const start = Date.now();
    const timeLeft = () => Math.max(0, timeoutMs - (Date.now() - start));

    const withTimeout = async (promiseFactory, ms) => {
        if (ms <= 0) return;
        try {
            await Promise.race([
                Promise.resolve().then(promiseFactory),
                new Promise((resolve) => setTimeout(resolve, ms))
            ]);
        } catch {}
    };

    await withTimeout(() => page.evaluate(() => {
        const rs = document.readyState;
        if (rs === 'interactive' || rs === 'complete') return true;
        return new Promise((resolve) => {
            document.addEventListener('DOMContentLoaded', () => resolve(true), { once: true });
        });
    }), Math.min(600, timeLeft()));

    await withTimeout(() => page.evaluate(() => {
        if (document.fonts && document.fonts.ready) return document.fonts.ready;
        return null;
    }), Math.min(800, timeLeft()));

    await withTimeout(() => page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    })), Math.min(400, timeLeft()));

    await withTimeout(() => page.evaluate(() => new Promise((resolve) => {
        if (typeof requestIdleCallback !== 'function') return setTimeout(resolve, 50);
        requestIdleCallback(() => resolve(true), { timeout: 500 });
    })), Math.min(700, timeLeft()));

    const remaining = timeLeft();
    if (remaining > 0 && typeof page.waitForNetworkIdle === 'function') {
        try {
            await page.waitForNetworkIdle({ idleTime: 250, timeout: Math.min(1000, remaining) });
        } catch {}
    } else if (remaining > 0) {
        try { await page.waitForTimeout(Math.min(250, remaining)); } catch {}
    }
}

// How long frames get to catch up once the page itself has loaded.
const FRAME_GRACE_MS = 3000;

/**
 * page.goto, done once the page's own document is: Puppeteer's goto also
 * waits for every frame in it, so one frame that never answered held the
 * navigation until it timed out (60 s, and the run failed). Once the page
 * fires its own `domcontentloaded` (or `load`, for waitUntil 'load'), frames
 * get FRAME_GRACE_MS more, then the step goes on. The network-idle waits are
 * left to goto. Rejects as goto does: a page that cannot be opened, or a
 * timeout before the page's own document loaded.
 */
async function gotoPage(page, url, { waitUntil = 'load', timeout } = {}) {
    const event = waitUntil === 'domcontentloaded' || waitUntil === 'load' ? waitUntil : null;
    const navigation = page.goto(url, { waitUntil, timeout });
    if (!event || typeof page.once !== 'function') return navigation;
    // Settles later, or never; its outcome is the race's, or nobody's.
    navigation.catch(() => {});
    let onEvent = null;
    let graceTimer = null;
    const ownDocument = new Promise((resolve) => {
        onEvent = () => { graceTimer = setTimeout(() => resolve(null), FRAME_GRACE_MS); };
        page.once(event, onEvent);
    });
    try {
        return await Promise.race([navigation, ownDocument]);
    } finally {
        clearTimeout(graceTimer);
        try { page.off(event, onEvent); } catch {}
    }
}

function isContextDestroyedError(err) {
    const msg = String(err && (err.message || err) || '');
    return /Execution context was destroyed|Cannot find context with specified id|Most likely because of a navigation/i.test(msg);
}

async function withNavResilience(page, work, { retries = 1, afterNavWait = 'load', timeout = 15000 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await work();
        } catch (err) {
            if (!isContextDestroyedError(err) || attempt === retries) throw err;
            await page.waitForNavigation({ waitUntil: afterNavWait, timeout }).catch(() => {});
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

// How long a click has to start a navigation before it is taken not to have
// started one. A link or a submit asks for its new document at once, and a
// client-side router changes the address at once; a click that does neither in
// this time (a toggle, a menu, a theme switch) is not navigating. It was a
// second: every click that did not navigate took that second.
const NAV_START_GRACE_MS = 500;

/**
 * After a click: if it navigates, wait until that navigation is done; if it
 * does not, return as soon as that is clear.
 *
 * Three ways it ends:
 *  - a new document was requested: wait for `waitUntil` on it, up to `timeout`;
 *  - only the address changed (a client-side route): done at once;
 *  - neither within the grace period: no navigation, done.
 *
 * It used to wait the whole timeout (8 s by default) for a navigation that a
 * non-navigating click never makes, and to return when the address changed even
 * when a new document was still loading.
 *
 * Pass the click as `trigger` so the watches are listening before it happens: a
 * new document is asked for the moment the click lands, and one missed would
 * leave only the address to go by, which a slow server changes late. The grace
 * period counts from the end of the trigger.
 *
 * Resolves true when a navigation happened (and, for a new document, finished),
 * false otherwise. A trigger that throws rejects, after the watches are stopped.
 */
async function waitForPossibleNavigation(page, startUrl, {
    waitUntil = 'domcontentloaded',
    timeout = 8000,
    startWithinMs = NAV_START_GRACE_MS,
    trigger = null
} = {}) {
    const t = Math.max(0, Number(timeout) || 0);
    if (!t) {
        if (trigger) await trigger();
        return false;
    }
    const grace = Math.min(t, Math.max(0, Number(startWithinMs) || 0));

    // A request for a new document in the main frame is the sign a real
    // navigation began. Pages that cannot report requests fall back to the
    // address and the navigation watch alone.
    let documentRequested = false;
    let mainFrame = null;
    try { mainFrame = typeof page.mainFrame === 'function' ? page.mainFrame() : null; } catch {}
    const onRequest = (req) => {
        try {
            if (!req.isNavigationRequest()) return;
            if (mainFrame && typeof req.frame === 'function' && req.frame() !== mainFrame) return;
            documentRequested = true;
        } catch {}
    };
    const canListen = typeof page.on === 'function' && typeof page.off === 'function';
    if (canListen) page.on('request', onRequest);

    // Both watches are cancelled once the answer is known, rather than left
    // polling the page until their own timeout after every click.
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const signal = abort ? abort.signal : undefined;

    const urlChanged = page.waitForFunction(
        (u) => location.href !== u,
        { timeout: t, signal },
        String(startUrl || '')
    ).then((ok) => (ok ? 'url' : 'none'), () => 'none');

    const nav = page.waitForNavigation({ waitUntil, timeout: t, signal })
        .then(() => true)
        .catch(() => false);

    let graceTimer = null;
    try {
        if (trigger) await trigger();

        const quiet = new Promise((resolve) => {
            graceTimer = setTimeout(() => { if (!documentRequested) resolve('quiet'); }, grace);
        });
        const first = await Promise.race([urlChanged, nav.then((ok) => (ok ? 'loaded' : 'none')), quiet]);
        if (first === 'loaded') return true;
        // The address moves before a new document has loaded, so only a route
        // with no document behind it is finished here.
        if (first === 'url') return documentRequested ? await nav : true;
        return false;
    } finally {
        if (graceTimer) clearTimeout(graceTimer);
        if (canListen) { try { page.off('request', onRequest); } catch {} }
        if (abort) abort.abort();
    }
}

function startPossibleNavigationWatch(page, startUrl, { waitUntil = 'domcontentloaded', timeout = 8000 } = {}) {
    const t = Math.max(0, Number(timeout) || 0);
    if (!t) return Promise.resolve(false);

    const url0 = String(startUrl || '');

    const urlChanged = page.waitForFunction(
        (u) => location.href !== u,
        { timeout: t },
        url0
    ).then(() => true).catch((e) => {
        const msg = String(e?.message || e || '');
        if (/Execution context was destroyed|Cannot find context with specified id/i.test(msg)) return true;
        return false;
    });

    const nav = page.waitForNavigation({ waitUntil, timeout: t })
        .then(() => true)
        .catch(() => false);

    return Promise.race([urlChanged, nav]);
}

/** Wrap page.waitForSelector with consistent defaults */
async function waitForSel(page, selector, { visible = true, timeout = 10000 } = {}) {
    if (!isNonEmptyString(selector)) return;
    return withNavResilience(page, () => page.waitForSelector(selector, { visible, timeout }), {
        retries: 1,
        afterNavWait: 'domcontentloaded',
        timeout: Math.max(timeout, 15000)
    });
}

/**
 * When goBack lands on about:blank (SPA/history quirks), try to restore the loop home URL.
 * Returns true if we are no longer on about:blank, otherwise false.
 */
async function restoreLoopHomeIfBlank(page, ctx, loopHomeUrl, { waitUntil = 'domcontentloaded', timeout = 60000 } = {}) {
    if (!loopHomeUrl) return true;

    let current = '';
    try { current = await page.url(); } catch {}

    const isBlank = !current || current === 'about:blank';
    if (!isBlank) return true;

    pushLog(ctx, 'warning', 'goBack landed on about:blank, attempting to restore loop home URL');

    const waitUntilRestore = normalizeWaitUntil(waitUntil || 'domcontentloaded');
    const navTimeout = Math.max(5000, Number(timeout) || 60000);

    await page.waitForNavigation({ timeout: 1000 }).catch(() => {});

    await page.goto(loopHomeUrl, { waitUntil: waitUntilRestore, timeout: navTimeout }).catch((e) => {
        pushLog(ctx, 'warning', `loop-home restore goto failed: ${e?.message || e}`);
    });
    await waitForRenderSettle(page, 2000);

    let after = '';
    try { after = await page.url(); } catch {}
    if (after && after !== 'about:blank') {
        pushLog(ctx, 'info', `Loop home restored: ${after}`);
        return true;
    }

    pushLog(ctx, 'warning', 'Still on about:blank after restore, retrying once');

    await page.waitForNavigation({ timeout: 1000 }).catch(() => {});
    await page.goto(loopHomeUrl, { waitUntil: waitUntilRestore, timeout: navTimeout }).catch((e) => {
        pushLog(ctx, 'error', `loop-home restore retry failed: ${e?.message || e}`);
    });
    await waitForRenderSettle(page, 2000);

    try { after = await page.url(); } catch {}
    const ok = !!after && after !== 'about:blank';
    if (!ok) pushLog(ctx, 'error', 'Unable to restore loop home URL, aborting forEachElement loop');
    return ok;
}

module.exports = {
    safePageUrl,
    stopLoading,
    normalizeWaitUntil,
    waitForRenderSettle,
    gotoPage,
    FRAME_GRACE_MS,
    isContextDestroyedError,
    withNavResilience,
    waitForPossibleNavigation,
    startPossibleNavigationWatch,
    waitForSel,
    restoreLoopHomeIfBlank,
    sleep,
    toNumber,
    isNonEmptyString
};
