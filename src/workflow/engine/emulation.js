'use strict';

// How the page is shown while a workflow runs: its colour scheme and media
// features, its language, the zoom of its viewport, and CSS forced onto it.

const {setPageLanguage} = require('./page-language');

function forceImportant(css) {
    const s = String(css || '');

    // Add !important before either ';' or '}' when the declaration doesn't already have it.
    // Examples handled:
    //  - display: none;
    //  - display: none }
    //  - color: red; background: blue }
    return s.replace(/:\s*[^;}{]+(?=\s*[;}])/g, (decl) => {
        if (/!important/i.test(decl)) return decl;
        return `${decl} !important`;
    });
}

// Zoom presets are declared as strings in action-definitions, and may arrive as
// an already-interpolated "{var:...}" token, so accept anything numeric-ish.
function resolveZoomFactor(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 1;
    // The UI offers 100-400%. Allow values in between, but clamp so a stray
    // number cannot collapse the viewport down to a handful of CSS pixels.
    return Math.min(10, Math.max(1, n));
}

/**
 * Emulate real browser zoom on top of a logical (pre-zoom) viewport.
 *
 * Chrome at N% zoom keeps the window physically the same size but shrinks the
 * CSS viewport by N and renders each CSS pixel at N device pixels. That shrink
 * is what actually triggers reflow (WCAG 1.4.10) and text scaling (WCAG 1.4.4),
 * so it is the behavior worth emulating. Raising deviceScaleFactor on its own
 * would only change render density, and CDP's Emulation.setPageScaleFactor
 * pinch-zooms without reflowing - neither is a substitute.
 *
 * deviceScaleFactor is always set, including at 100%, so that a later
 * setViewport without a zoom resets a previously zoomed page instead of
 * inheriting its pixel ratio.
 */
function applyZoomToViewport(logicalViewport, zoom) {
    const vp = (logicalViewport && typeof logicalViewport === 'object') ? logicalViewport : {};
    const factor = resolveZoomFactor(zoom);

    const shrink = (value) => (Number.isFinite(value) && value > 0)
        ? Math.max(1, Math.round(value / factor))
        : value;

    return {
        width: shrink(vp.width),
        height: shrink(vp.height),
        deviceScaleFactor: factor
    };
}

// Each page's DevTools session that emulates forced colors (see
// emulateColorScheme).
const MEDIA_SESSIONS = new WeakMap();

/**
 * Shows `page` in a color scheme and, with `forcedColors: 'active'`, in
 * forced colors (high contrast), as Set color scheme and contrast asks. Puppeteer's
 * emulateMediaFeatures replaces every emulated feature at once, so each call
 * sets both conditions the workflow chose, and prefers-reduced-motion, which
 * the runner emulates on every page, rather than dropping the others. A null
 * color scheme leaves the browser's default.
 */
async function emulateColorScheme(page, colorScheme, forcedColors = null) {
    const features = [
        ...(colorScheme ? [{name: 'prefers-color-scheme', value: colorScheme}] : []),
        ...(forcedColors === 'active' ? [{name: 'forced-colors', value: 'active'}] : []),
        {name: 'prefers-reduced-motion', value: 'reduce'}
    ];
    try {
        await page.emulateMediaFeatures(features);
        // A page that was shown in forced colors keeps its own session's
        // emulation: it gets the same features, so turning them off takes.
        const open = MEDIA_SESSIONS.get(page);
        if (open) await open.send('Emulation.setEmulatedMedia', {features});
    } catch (e) {
        // Puppeteer names the features it takes, and forced-colors is not one
        // of them; Chrome emulates it through the DevTools protocol, whose
        // setEmulatedMedia replaces every emulated feature the same way.
        // The emulation lasts as long as the session that set it, so each
        // page keeps its session open.
        if (!/unsupported media feature/i.test(String(e?.message || e)) || typeof page.createCDPSession !== 'function') throw e;
        let client = MEDIA_SESSIONS.get(page);
        if (!client) {
            client = await page.createCDPSession();
            MEDIA_SESSIONS.set(page, client);
        }
        await client.send('Emulation.setEmulatedMedia', {features});
    }
}

// The page conditions a worker page takes from its workflow: the color
// scheme and forced colors (one emulateMediaFeatures call), when either is set.
async function applyMediaConditions(workerPage, ctx) {
    if (!ctx?._colorScheme && ctx?._forcedColors !== 'active') return;
    await emulateColorScheme(workerPage, ctx._colorScheme || null, ctx._forcedColors || null).catch(() => {
    });
}

// A worker page shows the language Set language chose, when one is set.
async function applyLanguage(workerPage, ctx) {
    if (!ctx?._language) return;
    await setPageLanguage(workerPage, ctx._language).catch(() => {
    });
}

/**
 * What the run started with (its configuration's color scheme, high contrast
 * and language), which the steps' Run default goes back to. Kept on the root
 * context, as a custom step or a worker has its own. Each is null for the
 * browser's own.
 */
function runConditions(ctx) {
    const root = ctx?._rootCtx || ctx || null;
    return {
        colorScheme: root?._runColorScheme ?? null,
        forcedColors: root?._runForcedColors ?? null,
        language: root?._runLanguage ?? null
    };
}

/**
 * Shows the run's page as its configuration asks, before its first
 * navigation, so the first page already loads that way: { colorScheme:
 * 'light'|'dark'|null, highContrast: boolean, language: a canonical tag or
 * null }. Remembered for Run default, and set as the workflow's conditions,
 * as the steps set them.
 */
async function applyRunConditions(page, ctx, {colorScheme = null, highContrast = false, language = null} = {}) {
    const forcedColors = highContrast ? 'active' : null;
    ctx._runColorScheme = colorScheme || null;
    ctx._runForcedColors = forcedColors;
    ctx._runLanguage = language || null;
    if (colorScheme || forcedColors) {
        await emulateColorScheme(page, colorScheme || null, forcedColors);
        ctx._colorScheme = colorScheme || null;
        ctx._forcedColors = forcedColors;
    }
    if (language) {
        await setPageLanguage(page, language);
        ctx._language = language;
    }
}

module.exports = {
    MEDIA_SESSIONS,
    emulateColorScheme,
    applyMediaConditions,
    applyLanguage,
    runConditions,
    applyRunConditions,
    resolveZoomFactor,
    applyZoomToViewport,
    forceImportant
};
