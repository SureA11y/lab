'use strict';

// The steps that set up the page itself: go to an address, reload, go back,
// the viewport, the colour scheme, a vision deficiency, the language, and CSS
// injected into it.

const {
    applyZoomToViewport,
    emulateColorScheme,
    forceImportant,
    resolveZoomFactor,
    runConditions
} = require('../engine/emulation');
const {buildViewportFromPreset} = require('../../shared/scan-inputs.js');
const {canonicalLanguageTag, setPageLanguage} = require('../engine/page-language');
const {gotoPage, normalizeWaitUntil, stopLoading, waitForRenderSettle} = require('../engine/nav');
const {interpolateVarTokensLoose} = require('../engine/vars');
const {isNonEmptyString, toNumber} = require('../engine/utils');
const {isWebUrl} = require('../engine/url-list');
const {pushLog} = require('../engine/log');
const {safeDoubleRAF} = require('../engine/deep-query');

async function stepSetViewport(page, action, ctx) {
    // Resolve fallbacks against the logical (pre-zoom) size rather than
    // the shrunken size the page is actually running at - otherwise a
    // second setViewport that only changes zoom would divide an
    // already-divided width again.
    const current = (ctx && ctx.viewportLogical)
        ? ctx.viewportLogical
        : ((ctx && ctx.viewport) ? ctx.viewport : { width: undefined, height: undefined });

    // Action values win if valid
    const w = Number(action.width);
    const h = Number(action.height);
    const actionWidth = Number.isFinite(w) && w > 0 ? w : undefined;
    const actionHeight = Number.isFinite(h) && h > 0 ? h : undefined;

    // Preset is fallback. "default" means "restore this run's actual
    // configured viewport", not a fixed size - fall back to the run's
    // base viewport (captured before any setViewport actions ran) when
    // available, since hardcoding 1280x720 here would silently shrink
    // wider runs (e.g. 1440/1972) below the target app's own breakpoints.
    const presetViewport = (action.preset === 'default' && ctx && ctx.baseViewport)
        ? ctx.baseViewport
        : (buildViewportFromPreset(action.preset) || {});
    const presetWidth = Number.isFinite(presetViewport.width) && presetViewport.width > 0
        ? presetViewport.width
        : undefined;
    const presetHeight = Number.isFinite(presetViewport.height) && presetViewport.height > 0
        ? presetViewport.height
        : undefined;

    const logicalViewport = {
        width: actionWidth ?? presetWidth ?? current.width,
        height: actionHeight ?? presetHeight ?? current.height
    };

    // An omitted zoom means 100%, matching the field's declared default.
    // Inheriting the previous zoom instead would make a preset-only
    // action (e.g. one inside a reused custom step) silently render at
    // whatever zoom an earlier, unrelated action happened to leave set.
    const zoom = resolveZoomFactor(action.zoom);
    const newViewport = applyZoomToViewport(logicalViewport, zoom);

    await page.setViewport(newViewport);
    if (ctx) {
        ctx.viewport = newViewport;
        ctx.viewportLogical = logicalViewport;
        ctx.viewportZoom = zoom;
    }

    // The page gets its resize event at its next frame: give it two,
    // so the step after this one sees the page at its new size.
    await safeDoubleRAF(page, 500);
}

async function stepNavigate(page, action, ctx, localVars) {
    // Prefer preserved raw URL template if present, otherwise use action.url.
    // If url is empty but repeat/iter locals provide "value", fall back to that.
    let urlTemplate = isNonEmptyString(action?.__rawUrl)
        ? String(action.__rawUrl).trim()
        : (isNonEmptyString(action?.url) ? String(action.url).trim() : '');

    // Robust fallback for repeat itemsText: when the UI stored url as empty,
    // use the current iteration value as the URL.
    if (!isNonEmptyString(urlTemplate) && isNonEmptyString(localVars?.value)) {
        urlTemplate = String(localVars.value).trim();
    }

    const url = isNonEmptyString(urlTemplate)
        ? interpolateVarTokensLoose(urlTemplate, { localVars, ctx }).trim()
        : '';

    if (!isNonEmptyString(urlTemplate)) {
        throw new Error('navigate action missing required "url"');
    }
    if (!isNonEmptyString(url)) {
        throw new Error(`navigate url resolved to empty: template=${urlTemplate}`);
    }
    if (/\{var:[^}]+\}/.test(url)) {
        throw new Error(`navigate url was not interpolated: template=${urlTemplate}, resolved=${url}`);
    }
    // A web page only: a file: url opened the server's own files, which a
    // scan's picture or Get text then carried into the report.
    if (!isWebUrl(url)) {
        throw new Error(`navigate url must be http or https: ${url}`);
    }

    const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');
    const navTimeout = toNumber(action.timeout, 30000);

    // If we're already at the same URL (ignoring hash and trailing slash), do not reload.
    // Reloading SPAs can hang depending on timing.
    try {
        const current = await page.url();
        const norm = (u) => {
            const s = String(u || '').trim();
            return s.endsWith('/') ? s.slice(0, -1) : s;
        };
        if (norm(current) === norm(url)) {
            pushLog(ctx, 'info', `already at ${url}, skipping navigate`);
            await waitForRenderSettle(page, 2000);
            try {
                pushLog(ctx, 'info', `URL loaded: ${await page.url()}`);
            } catch {
            }
            return;
        }
    } catch {
    }

    pushLog(ctx, 'info', `browsing to ${url}`);
    try {
        await ctx.race(gotoPage(page, url, {waitUntil, timeout: navTimeout}), `navigate goto ${url}`);
    } catch (e) {
        const msg = String(e?.message || e);

        // If cancellation/teardown happened mid-navigation, treat it as cancelled, not a crash.
        // This commonly occurs when user presses "Cancel" and worker pages/contexts are closed.
        if (
            (e && e._wfCancelled) ||
            /Navigating frame was detached/i.test(msg) ||
            /LifecycleWatcher terminated/i.test(msg) ||
            /Execution context was destroyed/i.test(msg) ||
            /Target closed/i.test(msg) ||
            /Session closed/i.test(msg)
        ) {
            pushLog(ctx, 'info', `navigate cancelled: ${msg}`);
            const err = new Error('Workflow cancelled during navigation');
            err._wfCancelled = true;
            throw err;
        }

        // If navigation timed out, retry once with domcontentloaded (more robust)
        if (/Navigation timeout/i.test(msg) && waitUntil !== 'domcontentloaded') {
            pushLog(ctx, 'warning', `navigate timed out with waitUntil=${waitUntil}, retrying with domcontentloaded`);

            await ctx.race(stopLoading(page), 'navigate stopLoading');

            await ctx.race(
                gotoPage(page, url, {waitUntil: 'domcontentloaded', timeout: navTimeout}),
                `navigate goto retry ${url}`
            );
        } else {
            throw e;
        }
    }

    try {
        await ctx.race(waitForRenderSettle(page, 2000), 'navigate waitForRenderSettle');
    } catch (e) {
        const msg = String(e?.message || e);
        if (
            (e && e._wfCancelled) ||
            /Execution context was destroyed/i.test(msg) ||
            /Target closed/i.test(msg) ||
            /Session closed/i.test(msg)
        ) {
            // cancelled mid-settle, just stop
            const err = new Error('Workflow cancelled during navigation settle');
            err._wfCancelled = true;
            throw err;
        }
        throw e;
    }
    try {
        pushLog(ctx, 'info', `URL loaded: ${await ctx.race(page.url(), 'navigate page.url')}`);
    } catch {
    }
}

async function stepRefresh(page, action, ctx) {
    const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');
    const navTimeout = toNumber(action.timeout, 30000);
    const bypassCache = !!action.bypassCache; // optional flag

    pushLog(ctx, 'info', `refreshing page${bypassCache ? ' (bypass cache)' : ''}`);

    try {
        if (bypassCache) await page.setCacheEnabled(false);

        await page.reload({waitUntil, timeout: navTimeout});
    } catch (e) {
        const msg = String(e?.message || e);

        // Optional: mimic your navigate retry logic
        if (/Navigation timeout/i.test(msg) && waitUntil !== 'domcontentloaded') {
            pushLog(ctx, 'warning', `refresh timed out with waitUntil=${waitUntil}, retrying with domcontentloaded`);
            await stopLoading(page);
            await page.reload({waitUntil: 'domcontentloaded', timeout: navTimeout});
        } else {
            throw e;
        }
    } finally {
        if (bypassCache) await page.setCacheEnabled(true).catch(() => {
        });
    }

    await waitForRenderSettle(page, 2000);
    try {
        pushLog(ctx, 'info', `URL after refresh: ${await page.url()}`);
    } catch {
    }
}

async function stepGoBack(page, action, ctx) {
    const waitUntil = normalizeWaitUntil(action.waitUntil || 'load');
    const navTimeout = toNumber(action.timeout, 30000);
    const label = isNonEmptyString(action.label) ? action.label.trim() : null;

    pushLog(ctx, 'info', label ? `going back (${label})` : 'going back');

    try {
        try {
            await ctx.race(page.goBack({waitUntil, timeout: navTimeout}), 'goBack');
        } catch (e) {
            const msg = String(e?.message || e);

            // Same retry-on-timeout fallback as navigate/refresh.
            if (/Navigation timeout/i.test(msg) && waitUntil !== 'domcontentloaded') {
                pushLog(ctx, 'warning', `goBack timed out with waitUntil=${waitUntil}, retrying with domcontentloaded`);
                await ctx.race(stopLoading(page), 'goBack stopLoading');
                await ctx.race(page.goBack({waitUntil: 'domcontentloaded', timeout: navTimeout}), 'goBack retry');
            } else {
                throw e;
            }
        }
    } catch (e) {
        const msg = String(e?.message || e);
        if (action.optional) {
            pushLog(ctx, 'warning', `goBack failed, continuing: ${msg}`);
            return;
        }
        throw new Error(`goBack failed: ${msg}`);
    }

    await ctx.race(waitForRenderSettle(page, 2000), 'goBack waitForRenderSettle');
    try {
        pushLog(ctx, 'info', `URL after goBack: ${await ctx.race(page.url(), 'goBack page.url')}`);
    } catch {
    }
}

async function stepEmulateVisionDeficiency(page, action, ctx) {
    const deficiency = String(action.deficiency || 'none');
    pushLog(ctx, 'info', `emulate vision deficiency: ${deficiency}`);

    try {
        await page.emulateVisionDeficiency(deficiency);

        // persist for workers/new pages
        if (ctx) ctx._visionDeficiency = deficiency;

        // give it a frame to apply
        await waitForRenderSettle(page, 150);
        await safeDoubleRAF(page, 500);

    } catch (e) {
        const msg = String(e?.message || e);
        if (action.optional) {
            pushLog(ctx, 'warning', `emulateVisionDeficiency failed (${deficiency}), continuing: ${msg}`);
            return;
        }
        throw new Error(`emulateVisionDeficiency failed (${deficiency}): ${msg}`);
    }
}

async function stepSetColorScheme(page, action, ctx, localVars) {
    // Each of the two is optional: an empty one keeps what the
    // workflow set before (Set color scheme and contrast). "default"
    // goes back to what the run started with (Run default).
    const read = (v) => (typeof v === 'string'
        ? interpolateVarTokensLoose(v.trim(), {localVars, ctx}).trim().toLowerCase()
        : '');
    const scheme = read(action.colorScheme);
    const contrast = read(action.highContrast);

    try {
        if (!scheme && !contrast) {
            throw new Error('set "colorScheme" (light, dark or default), "highContrast" (on, off or default), or both');
        }
        if (scheme && scheme !== 'light' && scheme !== 'dark' && scheme !== 'default') {
            throw new Error(`"${scheme}" is not a color scheme: use light, dark or default`);
        }
        if (contrast && contrast !== 'on' && contrast !== 'off' && contrast !== 'default') {
            throw new Error(`"${contrast}" is not a high contrast setting: use on, off or default`);
        }
        const run = runConditions(ctx);
        const colorScheme = scheme === 'default' ? run.colorScheme : (scheme || ctx?._colorScheme || null);
        const forcedColors = contrast === 'default'
            ? (run.forcedColors || 'none')
            : contrast ? (contrast === 'on' ? 'active' : 'none') : (ctx?._forcedColors || null);
        pushLog(ctx, 'info', `set color scheme and contrast: ${[
            scheme ? (scheme === 'default' ? 'color scheme back to the run default' : `color scheme ${scheme}`) : '',
            contrast ? (contrast === 'default' ? 'high contrast back to the run default' : `high contrast ${contrast}`) : ''
        ].filter(Boolean).join(', ')}`);
        await emulateColorScheme(page, colorScheme, forcedColors);

        // persist for workers/new pages
        if (ctx) {
            if (scheme) ctx._colorScheme = colorScheme;
            if (contrast) ctx._forcedColors = forcedColors;
        }

        // give the page's styles a frame to follow
        await waitForRenderSettle(page, 150);
        await safeDoubleRAF(page, 500);
    } catch (e) {
        const msg = String(e?.message || e);
        if (action.optional) {
            pushLog(ctx, 'warning', `setColorScheme failed, continuing: ${msg}`);
            return;
        }
        throw new Error(`setColorScheme failed: ${msg}`);
    }
}

async function stepSetLanguage(page, action, ctx, localVars) {
    // A language typed in Other language wins over the one chosen
    // from the list; "default" goes back to the one the run started
    // with (Run default).
    const read = (v) => (typeof v === 'string'
        ? interpolateVarTokensLoose(v.trim(), {localVars, ctx}).trim()
        : '');
    const raw = read(action.customLanguage) || read(action.language);

    try {
        if (!raw) {
            throw new Error('choose a language, type one in "Other language", or choose "Run default"');
        }
        const toDefault = raw.toLowerCase() === 'default';
        const tag = toDefault ? runConditions(ctx).language : canonicalLanguageTag(raw);
        if (!toDefault && !tag) {
            throw new Error(`"${raw}" is not a language tag: use one such as es-ES, de or pt-BR`);
        }
        pushLog(ctx, 'info', toDefault ? 'set language: back to the run default' : `set language: ${tag}`);
        await setPageLanguage(page, tag);
        if (ctx) ctx._language = tag;

        // A page picks its language as it loads: the open one loads
        // again, so it shows the new one now, as a color scheme does.
        if (action.reload !== false && /^(https?|file):/i.test(page.url())) {
            await page.reload({waitUntil: 'domcontentloaded', timeout: 30000});
            await waitForRenderSettle(page, 150);
        }
    } catch (e) {
        const msg = String(e?.message || e);
        if (action.optional) {
            pushLog(ctx, 'warning', `setLanguage failed, continuing: ${msg}`);
            return;
        }
        throw new Error(`setLanguage failed: ${msg}`);
    }
}

async function stepInjectCss(page, action, ctx, localVars, depth) {
    let rawCss = isNonEmptyString(action.css)
        ? interpolateVarTokensLoose(String(action.css), { localVars, ctx })
        : '';

    rawCss = forceImportant(rawCss);

    if (!rawCss) {
        if (action.optional) return;
        throw new Error('injectCss failed: css is empty');
    }

    const logLabel = isNonEmptyString(action.label) ? action.label : null;

    try {
        await ctx.race(
            page.addStyleTag({ content: rawCss }),
            `injectCss ${logLabel || ''}`.trim()
        );

        pushLog?.(ctx, 'info', `injectCss applied`, {
            depth,
            bytes: rawCss.length,
            label: logLabel || undefined
        });

    } catch (err) {
        if (action.optional) {
            pushLog?.(ctx, 'warn', `injectCss optional failure: ${String(err?.message || err)}`, { depth });
            return;
        }
        throw err;
    }
}

const STEPS = {
    'setViewport': stepSetViewport,
    'navigate': stepNavigate,
    'refresh': stepRefresh,
    'goBack': stepGoBack,
    'emulateVisionDeficiency': stepEmulateVisionDeficiency,
    'setColorScheme': stepSetColorScheme,
    'setLanguage': stepSetLanguage,
    'injectCss': stepInjectCss
};

module.exports = {STEPS};
