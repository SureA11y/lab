'use strict';
/**
 * a11y-runner (refactored + deterministic runs + disabled-action aware)
 *
 * Exports:
 *   - runA11yWorkflow(url, tags, options?): each scan step chooses its
 *     profile (WCAG 2.2 AA when it names none); `tags` is only read for a
 *     scan with no profile, by callers from before profiles.
 *   - closeBrowser()
 */

// The browser presents itself as what it is, headless Chrome, unless
// A11Y_STEALTH=1: then it presents itself as a desktop Chrome (stealth.js),
// for a site of your own whose bot filter refuses plain headless Chrome.
const puppeteer = require('puppeteer');
const { stealthOn, applyStealth, stealthPageNow } = require('./stealth');
const a11yEngine = require('./a11y-engine');
const { elementTarget } = require('../shared/report-format.js');
const {
    applyActions,
    createWorkflowContext,
    buildViewportFromPreset,
    resolveZoomFactor,
    applyZoomToViewport,
    clearHoverStateForCapture,
    applyRunConditions
} = require('../workflow/workflow-engine');
// The engine's: each wait it makes is bounded. This runner had its own copy
// that awaited document.fonts.ready with no limit, which never settles while
// the page is still loading (an image that never finishes): opening the page
// took 180 s and every scan on it waited out its stage limit.
const { waitForRenderSettle, gotoPage } = require('../workflow/engine/nav');
const {collectDomMetrics} = require('./metrics/dom-metrics');
const {collectTextMetrics} = require('./metrics/text-metrics');
const {buildA11ySummary} = require('./metrics/a11y-summary');
const {buildGlobalSummary} = require('./metrics/global-summary');
const {buildCoverageAwareSummary} = require('./metrics/coverage-summary');
const {buildAutomationCoverage} = require('./metrics/automation-coverage');
const {foldMergedScans, describeMerges} = require('./merged-scan');
const { captureScreenshotArtifact } = require('./screenshot-capture.js');
const { CAPTURE_BUDGET_MS, screenshotOptionsForStep, storeElementScreenshots } = require('./element-screenshots.js');
const { splitWcagTagToRef } = require('../shared/canonical-shared');
const { LOCALES } = require('./engines/a11y-labs-engine');
const { resolveScanSelection, selectionTags, targetLabel, DEFAULT_WCAG_VERSION } = require('./conformance-targets');
const { checkScanSteps } = require('./scan-step-check');
const { pushLog, varsForLog } = require('../workflow/engine/log');
const { scanProfileFields } = require('../shared/report-scan.js');
const { ACTION_DEFINITIONS } = require('../workflow/action-definitions');

// A scan step's stage limit when it gives none: the same default the builder
// writes into every scan it saves, so a scan built in the app and one written
// by hand get the same limit.
const DEFAULT_STAGE_TIMEOUT_MS = ACTION_DEFINITIONS.a11yScan.fields.stageTimeout.default;

const fs = require('fs');
const path = require('path');

const { REPORTS_ROOT } = require('./report-paths');
const { checkPageReady, readinessNotice } = require('./page-readiness');
const { largePageNotice, httpErrorNotice } = require('../shared/scan-notes.js');
const { languageNotice } = require('../shared/scan-notes.js');
const { pageLanguage, canonicalLanguageTag } = require('../workflow/engine/page-language');
const { interpolateVarTokensLoose } = require('../workflow/engine/vars');

const DEFAULT_SCAN_CSS = `{filter: opacity(.8) blur(5px);}`;

/**
 * The shared browsers: the one every run uses, which refuses a certificate it
 * does not trust, and the one a run that accepts untrusted certificates uses
 * (acceptUntrustedCerts), launched the first time one asks. Whether a browser
 * accepts them is set when it launches, for all its pages, so runs that differ
 * on it cannot share one.
 * @type {{strict: import('puppeteer').Browser | null, untrusted: import('puppeteer').Browser | null}}
 */
const browsers = {strict: null, untrusted: null};


// The launch under way, per browser: runs that start together, before the
// first browser is up, wait for that one rather than each launching its own.
// Twelve browsers were found running for four runs, all but one never closed.
const launching = {strict: null, untrusted: null};

/** Launches (once) or reuses the shared browser a run asks for. */
async function getBrowser({acceptUntrustedCerts = false} = {}) {
    const key = acceptUntrustedCerts ? 'untrusted' : 'strict';
    const existing = browsers[key];
    if (existing && existing.connected) return existing;
    if (launching[key]) return launching[key];
    launching[key] = (async () => {
        const browser = await puppeteer.launch({
            headless: 'new',
            acceptInsecureCerts: !!acceptUntrustedCerts,
            args: [
                // Drop the "navigator.webdriver = true" / automation banner that
                // WAFs fingerprint on.
                '--disable-blink-features=AutomationControlled',
                // Sandbox is unavailable in most CI/container runtimes; without
                // these the launch itself fails there.
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        answerDialogs(browser);
        keepOpenersShown(browser);
        if (stealthOn()) await applyStealth(browser);

        browsers[key] = browser;
        return browser;
    })();
    try {
        return await launching[key];
    } finally {
        launching[key] = null;
    }
}

/**
 * Answers every alert, confirm, prompt and leave-page dialog a page of the
 * browser opens, as a person clicking OK would (a prompt with its default
 * text). Left open, a dialog blocked its page: an alert on load stopped the
 * run's first page for two minutes and lost its scan, a confirm hung the
 * run. Every page the browser opens gets it, the run's, a forEachElement
 * worker's and a popup's.
 */
function answerDialogs(browserRef) {
    const watch = async (target) => {
        if (!target || target.type() !== 'page') return;
        let page = null;
        try {
            page = await target.page();
        } catch {
        }
        if (!page) return;
        page.on('dialog', (dialog) => {
            dialog.accept(dialog.type() === 'prompt' ? dialog.defaultValue() : undefined).catch(() => {});
        });
    };
    browserRef.on('targetcreated', (target) => { watch(target); });
    for (const target of browserRef.targets()) watch(target);
}

/**
 * Shows again the page that opened a popup (window.open, a link with
 * target=_blank). The popup came to the front and hid it, and a hidden page
 * runs no animation frame, mouse event or screenshot: the steps after it
 * waited out their time limits.
 */
function keepOpenersShown(browserRef) {
    browserRef.on('targetcreated', async (target) => {
        try {
            const opener = target.type() === 'page' ? target.opener() : null;
            const page = opener ? await opener.page() : null;
            if (page) await page.bringToFront();
        } catch {
        }
    });
}

/** The shared browser's process id (the one every run uses), or null while none runs. */
function getBrowserPid() {
    const browser = browsers.strict;
    if (!browser || !browser.connected) return null;
    const proc = typeof browser.process === 'function' ? browser.process() : null;
    return proc && Number.isInteger(proc.pid) ? proc.pid : null;
}

/** Closes the shared browsers, ignoring transient errors. */
async function closeBrowser() {
    for (const key of Object.keys(browsers)) {
        const browser = browsers[key];
        browsers[key] = null;
        if (!browser) continue;
        try {
            await browser.close();
        } catch {
        }
    }
}

/** Creates a fresh diagnostics accumulator for a run. */
function createRunDiagnostics() {
    return {
        consoleErrors: [],
        requestFailures: [],
        badResponses: []
    };
}

function safeUrl(pageRef) {
    try {
        return (pageRef && typeof pageRef.url === 'function') ? pageRef.url() : null;
    } catch {
        return null;
    }
}

// The least time worth a second try at the start page.
const MIN_RETRY_MS = 1000;

/**
 * Opens the start page, trying once more on a failure worth it (a request
 * aborted, a timeout), both tries within one `timeoutMs`: a page that never
 * answered took two full timeouts (121 s) to fail.
 */
async function gotoWithFallback(page, url, timeoutMs, waitUntilPrimary) {
    const primary = waitUntilPrimary;
    const fallback = 'domcontentloaded';
    const deadline = Date.now() + timeoutMs;

    try {
        await gotoPage(page, url, {waitUntil: primary, timeout: timeoutMs});
        await waitForRenderSettle(page, 2000);
        return;
    } catch (e1) {
        const msg = String(e1?.message || e1);
        const retryable =
            msg.includes('net::ERR_TIMED_OUT') ||
            msg.includes('Navigation timeout') ||
            msg.includes('net::ERR_ABORTED') ||
            msg.includes('net::ERR_HTTP2_PROTOCOL_ERROR');

        const left = deadline - Date.now() - 750;
        if (!retryable || left < MIN_RETRY_MS) throw e1;

        await new Promise(r => setTimeout(r, 750));
        await gotoPage(page, url, {waitUntil: fallback, timeout: left});
        await waitForRenderSettle(page, 2000);
    }
}

function attachDiagnostics(page, diag, progress) {
    const NOISY_HOST_SUBSTRINGS = [
        'google-analytics.com',
        'googlesyndication.com',
        'doubleclick.net',
        'googletagmanager.com',
        'pagead2.googlesyndication.com',
        'adtrafficquality.google',
        'google.com/cse/',
        'www.google.com/cse/'
    ];

    function isNoisyUrl(u) {
        const url = String(u || '');
        return NOISY_HOST_SUBSTRINGS.some((h) => url.includes(h));
    }

    function sameOrigin(urlA, urlB) {
        try {
            const a = new URL(String(urlA || ''));
            const b = new URL(String(urlB || ''));
            return a.origin === b.origin;
        } catch {
            return false;
        }
    }

    function shouldEchoRequestFailure(req) {
        const url = req.url();
        const type = req.resourceType();
        const pageUrl = page.url();

        if (type === 'document') return true;
        if (sameOrigin(url, pageUrl)) return true;

        if (type === 'beacon') return false;
        if (isNoisyUrl(url)) return false;

        return true;
    }

    function shouldEchoBadResponse(res) {
        const url = res.url();
        const req = res.request();
        const type = req ? req.resourceType() : '';
        const pageUrl = page.url();

        if (type === 'document') return true;
        if (sameOrigin(url, pageUrl)) return true;

        if (type === 'beacon') return false;
        if (isNoisyUrl(url)) return false;

        return true;
    }

    // Answered for every page (answerDialogs); the run's log says so.
    page.on('dialog', (dialog) => {
        if (typeof progress !== 'function') return;
        try {
            progress({
                time: new Date().toISOString(),
                type: 'warning',
                message: `The page opened a dialog (${dialog.type()}), answered OK: ${String(dialog.message() || '').slice(0, 200)}`
            });
        } catch {
        }
    });

    page.on('console', (msg) => {
        const type = (msg.type && msg.type()) || '';
        const text = msg.text ? msg.text() : '';

        // Keep collecting only errors in diagnostics
        if (type === 'error') {
            diag.consoleErrors.push({type: 'console', level: 'error', text});
        }

        // Echo logs to Node console only when DEBUG is enabled
        if (process.env.A11Y_ECHO_BROWSER_CONSOLE === '1') {
            // You can also include msg.location() if you want
            console.log(`[browser:${type}] ${text}`);
        }
    });

    page.on('requestfailed', (req) => {
        try {
            const failure = req.failure() ? req.failure().errorText : 'failed';
            const url = req.url();
            const method = req.method();
            const resourceType = req.resourceType();

            diag.requestFailures.push({
                type: 'requestfailed',
                url,
                method,
                resourceType,
                failure
            });

            if (typeof progress === 'function' && shouldEchoRequestFailure(req)) {
                progress({
                    time: new Date().toISOString(),
                    type: 'info',
                    message: `REQ FAIL ${failure} ${url}`
                });
            }
        } catch {
        }
    });

    page.on('response', (res) => {
        try {
            const status = res.status();
            if (status < 400) return;

            const req = res.request();
            const url = res.url();
            const method = req ? req.method() : 'GET';
            const resourceType = req ? req.resourceType() : '';

            diag.badResponses.push({
                type: 'response',
                url,
                method,
                resourceType,
                status,
                statusText: res.statusText ? res.statusText() : ''
            });

            if (typeof progress === 'function' && shouldEchoBadResponse(res)) {
                progress({
                    time: new Date().toISOString(),
                    type: 'info',
                    message: `HTTP ${status} ${method} ${url}`
                });
            }
        } catch {
        }
    });
}

function attachDocResponseProbe(page, diag, progress) {
    page.on('response', (res) => {
        try {
            const req = res.request();
            if (!req || req.resourceType() !== 'document') return;

            const url = res.url();
            const status = res.status();
            const h = res.headers ? res.headers() : {};

            const contentType = h['content-type'] || '';
            const contentDisposition = h['content-disposition'] || '';
            const contentLength = h['content-length'] || '';

            // The page's own document, as its server answered it: a scan
            // says when that was an error (httpErrorNotice).
            try {
                if (req.frame && req.frame() === page.mainFrame() && req.isNavigationRequest()) {
                    page.__a11yDocumentResponse = { url, status, statusText: res.statusText ? res.statusText() : '' };
                }
            } catch {
            }

            // Flag "not HTML" or "download-like" documents (even if 200)
            const looksHtml = /text\/html/i.test(String(contentType));
            const looksDownload = /attachment/i.test(String(contentDisposition)) || /octet-stream/i.test(String(contentType));

            if (!looksHtml || looksDownload) {
                diag.badResponses.push({
                    type: 'doc-probe',
                    url,
                    method: req.method(),
                    resourceType: 'document',
                    status,
                    statusText: res.statusText ? res.statusText() : '',
                    contentType: contentType || null,
                    contentDisposition: contentDisposition || null,
                    contentLength: contentLength || null
                });

                if (typeof progress === 'function') {
                    progress({
                        time: new Date().toISOString(),
                        type: 'info',
                        message: `DOC ${status} ${url} (${contentType || 'no content-type'})`,
                        extra: {
                            contentType: contentType || null,
                            contentDisposition: contentDisposition || null,
                            contentLength: contentLength || null
                        }
                    });
                }
            }
        } catch {
        }
    });
}

const DEFAULT_VIEWPORT = {width: 1280, height: 720};

function computeEffectiveViewport(viewportFromBody, actions) {
    const normalizeVp = (vp) => {
        if (!vp || typeof vp !== 'object') return {};
        const w = Number(vp.width);
        const h = Number(vp.height);
        return {
            width: Number.isFinite(w) && w > 0 ? w : undefined,
            height: Number.isFinite(h) && h > 0 ? h : undefined
        };
    };
    const dropdownVp = normalizeVp(viewportFromBody);

    // If the workflow's very first step is an explicit setViewport action,
    // honor it for the initial navigation too. Navigation always happens
    // before any workflow actions run, so without this the page would
    // bootstrap once at the dropdown size and only get resized afterward -
    // which can leave SPA frameworks (e.g. Angular CDK BreakpointObserver)
    // latched onto whatever breakpoint matched at that first, wrong size.
    let actionVpRaw = null;
    const firstAction = Array.isArray(actions) && actions.length ? actions[0] : null;
    if (firstAction && firstAction.type === 'setViewport' && firstAction.disabled !== true) {
        const presetVp = buildViewportFromPreset(firstAction.preset) || {};
        actionVpRaw = {
            width: firstAction.width ?? presetVp.width,
            height: firstAction.height ?? presetVp.height
        };
    }
    const actionVp = normalizeVp(actionVpRaw);

    const hasDropdown = dropdownVp.width || dropdownVp.height;
    const hasAction = actionVp.width || actionVp.height;
    if (!hasDropdown && !hasAction) return {...DEFAULT_VIEWPORT};

    const width = actionVp.width || dropdownVp.width || DEFAULT_VIEWPORT.width;
    const height = actionVp.height || dropdownVp.height || DEFAULT_VIEWPORT.height;
    return {width, height};
}

/**
 * Zoom for the initial navigation, for the same reason computeEffectiveViewport
 * honors a leading setViewport: zoom changes the CSS viewport, so bootstrapping
 * at 100% and only zooming afterwards can leave an SPA latched onto the wrong
 * breakpoint. Only a leading setViewport counts - later ones apply in order.
 */
function computeInitialZoom(actions) {
    const firstAction = Array.isArray(actions) && actions.length ? actions[0] : null;
    if (!firstAction || firstAction.type !== 'setViewport' || firstAction.disabled === true) return 1;
    return resolveZoomFactor(firstAction.zoom);
}

async function applyReducedMotion(page) {
    // 1) Tell the page we prefer reduced motion (applies across navigations)
    try {
        await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}]);
    } catch {
    }

    // 2) Ensure CSS kill-switch is present on every document (including after goto)
    try {
        await page.evaluateOnNewDocument(() => {
            const STYLE_ID = '__a11y_runner_reduce_motion__';
            const css = `
        *,
        *::before,
        *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          transition-delay: 0ms !important;
          scroll-behavior: auto !important;
        }
      `;

            const inject = () => {
                if (document.getElementById(STYLE_ID)) return;
                const style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = css;
                document.documentElement.appendChild(style);
            };

            // Run as early as possible and also on DOM ready (belt and suspenders)
            inject();
            document.addEventListener('DOMContentLoaded', inject, {once: true});
        });
    } catch {
    }

    // 3) Optional: also apply to the current document (useful if you call it after navigation too)
    try {
        await page.addStyleTag({
            content: `
      *,
      *::before,
      *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        transition-delay: 0ms !important;
        scroll-behavior: auto !important;
      }
    `
        });
    } catch {
    }
}

// -------- Automation coverage (scan-independent, resolved once per run) --------

// The rule catalog does not change between scans, so it is resolved lazily and
// memoized. Both caches are keyed by engine because a workflow can select its own
// engine, and only some adapters expose WCAG mappings at all. An engine with no
// catalog yields null rather than an empty coverage object, since an empty catalog
// would report every criterion as unreachable by automation.
const ruleCatalogCache = new Map();
const automationCoverageCache = new Map();

async function getRuleCatalogOnce(engineIdOverride) {
    const key = engineIdOverride || '__default__';
    if (ruleCatalogCache.has(key)) return ruleCatalogCache.get(key);

    let rules = null;
    try {
        const out = await a11yEngine.getRulesForRunOnly(null, null, engineIdOverride);
        rules = (Array.isArray(out) && out.length) ? out : null;
    } catch {
        rules = null;
    }

    ruleCatalogCache.set(key, rules);
    return rules;
}

async function getAutomationCoverage(wcagLevel, engineIdOverride, version = DEFAULT_WCAG_VERSION) {
    const level = (typeof wcagLevel === 'string' && wcagLevel.trim()) ? wcagLevel.trim().toUpperCase() : 'AA';
    const key = `${engineIdOverride || '__default__'}::${version}::${level}`;
    if (automationCoverageCache.has(key)) return automationCoverageCache.get(key);

    const rules = await getRuleCatalogOnce(engineIdOverride);
    const coverage = rules ? buildAutomationCoverage({rules, level, version}) : null;

    automationCoverageCache.set(key, coverage);
    return coverage;
}

/**
 * What a set of engines can reach between them: one coverage model built from
 * their catalogs put together, for a Merged scan whose contexts ran different
 * engines. Synchronous, as merging is: it reads the catalogs each context's
 * scan already loaded (getRuleCatalogOnce), and an engine whose catalog was
 * not loaded counts as one without a catalog.
 */
function automationCoverageForEngines(wcagLevel, engineIds, version = DEFAULT_WCAG_VERSION) {
    const ids = Array.from(new Set(
        (Array.isArray(engineIds) ? engineIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    )).sort();
    if (!ids.length) return null;

    const level = (typeof wcagLevel === 'string' && wcagLevel.trim()) ? wcagLevel.trim().toUpperCase() : 'AA';
    const key = `${ids.length > 1 ? `union:${ids.join('+')}` : ids[0]}::${version}::${level}`;
    if (automationCoverageCache.has(key)) return automationCoverageCache.get(key);

    const catalogs = ids.map((id) => ruleCatalogCache.get(id) || null);
    const rules = catalogs.filter(Boolean).flat();

    // A rule id shared by two engines collapses to one entry, which is what the
    // question here needs: whether ANY rule can reach a criterion, not how many.
    const coverage = rules.length ? buildAutomationCoverage({rules, level, version}) : null;

    // An adapter that exposes no catalog would make a union silently come down
    // to a subset of the engines that ran. The criteria those
    // engines evaluate still land in the numerator, so leaving this unsaid reports
    // their work against a scope that never included their reach.
    if (coverage && ids.length > 1) {
        coverage.engines = {
            withCatalog: ids.filter((id, i) => !!catalogs[i]),
            withoutCatalog: ids.filter((id, i) => !catalogs[i])
        };
    }

    automationCoverageCache.set(key, coverage);
    return coverage;
}

// -------- Large pages --------
// A page this large is scanned in full, and its report says it is large: it
// was skipped, with no result at all, though core scans 80,000 elements in
// about 15 s.

const HEAVY_NODE_THRESHOLD = Number(process.env.HEAVY_NODE_THRESHOLD) > 0
    ? Number(process.env.HEAVY_NODE_THRESHOLD)
    : 25000;

function resolveThreshold(localCandidate) {
    const n = Number(localCandidate);
    return Number.isFinite(n) && n > 0 ? n : HEAVY_NODE_THRESHOLD;
}

// The elements of the scope, open shadow roots included: counted from the
// document alone, a page built of web components (two hundred nested shadow
// roots) came to 8.
async function estimateNodeCount(pageRef, ctxSelector) {
    try {
        return await pageRef.evaluate((sel) => {
            const root = sel && typeof sel === 'string'
                ? document.querySelector(sel)
                : document.documentElement;
            if (!root) return 0;
            let count = 0;
            const pending = [root];
            while (pending.length) {
                const node = pending.pop();
                const all = node.querySelectorAll('*');
                count += all.length + (node === root ? 1 : 0);
                for (const el of all) if (el.shadowRoot) pending.push(el.shadowRoot);
                if (node.shadowRoot && node === root) pending.push(node.shadowRoot);
            }
            return count;
        }, ctxSelector || null);
    } catch {
        return 0;
    }
}


/**
 * The standard a scan was checked against, as { id, label }, or null.
 *
 * When an engine that applies a standard in full ran (surea11y), its own
 * report of the profile it applied decides: it leaves one out when the
 * step's included rules or tags took precedence. In a
 * multi-engine scan the merged canonical keeps only the first engine's
 * runOptions, so each engine's own canonical is checked as well. Other engines
 * only get the standard's tags, which explicit includes also replace, so the
 * same rule applies to them.
 */
function appliedConformanceProfile(engineResult, { requested = null, overridden = false } = {}) {
    const candidates = [engineResult && engineResult.canonical];
    if (engineResult && Array.isArray(engineResult.perEngine)) {
        for (const p of engineResult.perEngine) candidates.push(p && p.canonical);
    }
    let standardApplier = false;
    for (const c of candidates) {
        const engines = c && Array.isArray(c.engines) ? c.engines : [];
        if (engines.some((e) => e && a11yEngine.appliesStandard(e.id))) standardApplier = true;
        const cp = c && c.runOptions ? c.runOptions.conformanceProfile : null;
        if (cp && typeof cp === 'object' && cp.id) return { id: String(cp.id), label: String(cp.label || cp.id) };
    }
    if (!requested || standardApplier || overridden) return null;
    return { id: requested, label: targetLabel(requested) };
}

function getSuccessCriteria(tags) {
    const successCriteria = [];
    tags.forEach((tag) => {
        const ref = splitWcagTagToRef(tag);
        if (ref) successCriteria.push(`WCAG ${ref}`);
    });

    const updatedTags = tags.filter((tag) => !tag.includes('wcag'));
    return {successCriteria, updatedTags};
}

/**
 * Open a page according to determinism hints.
 */
async function openContextAndPage(determinism, {acceptUntrustedCerts = false} = {}) {
    const browserInstance = await getBrowser({acceptUntrustedCerts});

    let context = null;
    let usedIsolated = false;

    if (determinism?.isolateContext) {
        if (typeof browserInstance.createIncognitoBrowserContext === 'function') {
            context = await browserInstance.createIncognitoBrowserContext();
            usedIsolated = true;
        } else if (typeof browserInstance.createBrowserContext === 'function') {
            context = await browserInstance.createBrowserContext();
            usedIsolated = true;
        } else {
            context = browserInstance.defaultBrowserContext();
            usedIsolated = false;
        }
    } else {
        context = browserInstance.defaultBrowserContext();
    }

    const page = await context.newPage();
    // Its identity before its first request (the browser's own hook for
    // new pages runs alongside, and a first navigation could beat it).
    if (stealthOn()) await stealthPageNow(page);

    await page.evaluateOnNewDocument(() => {
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        } catch {}
    });

    // The engine readies the page before the first navigation (surea11y
    // installs core's hooks, which run before the page's own scripts).
    // Without determinism.coreHooks, every one.
    await a11yEngine.preparePage(page, { hooks: Array.isArray(determinism?.coreHooks) ? determinism.coreHooks : undefined });

    // User-Agent: an explicit determinism.userAgent wins; otherwise the
    // browser's own, which A11Y_STEALTH, when on, de-headlesses and keeps
    // consistent with its Sec-CH-UA client hints (stealth.js).
    const effectiveUserAgent =
        (determinism?.userAgent && String(determinism.userAgent).trim())
            ? String(determinism.userAgent).trim()
            : null;

    if (effectiveUserAgent) {
        try {
            await page.setUserAgent(effectiveUserAgent);
        } catch {}
    }

    await applyReducedMotion(page);

    // Only Accept-Language is safe to force globally - it's identical for every
    // request. Do NOT set Accept / Sec-Fetch-* here: setExtraHTTPHeaders applies
    // to *every* request the page makes, so forcing navigation-shaped values
    // would corrupt sub-resource requests (a stylesheet would go out as
    // Sec-Fetch-Dest: document, Accept: text/html) and the server would refuse
    // or mis-serve them - CSS/JS never load. Headless Chrome already emits the
    // correct per-resource Sec-Fetch/Accept headers on its own, and A11Y_STEALTH
    // keeps the Sec-CH-UA client hints consistent with the real browser.
    try {
        await page.setExtraHTTPHeaders({
            'Accept-Language': (determinism?.acceptLanguage ? String(determinism.acceptLanguage) : 'en-US,en;q=0.9,es;q=0.8')
        });
    } catch {
    }

    if (determinism?.disableCache) {
        try {
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            await client.send('Network.setCacheDisabled', {cacheDisabled: true});
        } catch {
        }
    }
    if (determinism?.timezone) {
        try {
            await page.emulateTimezone(String(determinism.timezone));
        } catch {
        }
    }

    return {context, page, usedIsolated};
}

async function closeContextAndPage(context, page, usedIsolated) {
    try {
        if (page && !page.isClosed?.()) await page.close();
    } catch {
    }
    if (usedIsolated && context && typeof context.close === 'function') {
        try {
            await context.close();
        } catch {
        }
    }
}

/**
 * Whether a run that threw `err` ended by being cancelled: a cancel the
 * engine raised, or any error once a cancel was asked for. Cancelling closes
 * the run's pages under the step running, which then fails with whatever the
 * browser says ("Attempted to use detached Frame", "Target closed"): read as
 * a failure, a run cancelled during a Repeat ended in error.
 */
function endedByCancel(err, {cancelRequested = false} = {}) {
    return !!(err && err._wfCancelled) || cancelRequested === true;
}

/**
 * Hard-cancel: if isCancelled() becomes true, close page (and isolated context) to abort in-flight awaits.
 */
function startHardCancelWatch({context, page, usedIsolated, isCancelled, progress}) {
    if (typeof isCancelled !== 'function') return {
        stop() {
        }
    };

    let stopped = false;
    let triggered = false;

    const tick = async () => {
        if (stopped || triggered) return;
        let cancel = false;
        try {
            cancel = !!isCancelled();
        } catch {
            cancel = false;
        }
        if (!cancel) return;

        triggered = true;

        try {
            if (typeof progress === 'function') {
                progress({
                    time: new Date().toISOString(),
                    type: 'info',
                    message: 'Hard-cancel triggered, closing page'
                });
            }
        } catch {
        }

        // Close page first, then isolated context.
        try {
            if (page && !page.isClosed?.()) await page.close();
        } catch {
        }

        try {
            if (usedIsolated && context && typeof context.close === 'function') await context.close();
        } catch {
        }
    };

    const timer = setInterval(() => {
        tick();
    }, 100);
    try {
        timer.unref?.();
    } catch {
    }

    return {
        stop() {
            stopped = true;
            try {
                clearInterval(timer);
            } catch {
            }
        },
        get triggered() {
            return triggered;
        }
    };
}

/** Small helper for consistent disabled logging */
function logDisabled(progress, indexOrMsg) {
    try {
        if (typeof progress === 'function') {
            const message = typeof indexOrMsg === 'string'
                ? indexOrMsg
                : `action ${indexOrMsg} disabled, skipped`;
            progress({time: new Date().toISOString(), type: 'info', message});
        }
    } catch {
    }
}

function normalizeWaitUntil(v) {
    const s = (typeof v === 'string' ? v.trim() : '');
    if (!s) return 'load';
    if (s === 'networkidle0' || s === 'networkidle2') return 'domcontentloaded';
    return s;
}

function coerceBool(v) {
    if (v === true || v === false) return v;
    if (v == null) return null;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return null;
}

function stripOuterBraces(styleBlock) {
    const s = String(styleBlock || '').trim();
    if (!s) return '';

    // allow "{ ... }" or "..."
    if (s.startsWith('{') && s.endsWith('}')) {
        return s.slice(1, -1).trim();
    }
    return s;
}

function buildSelectorRules(selectors, styleBlock, isContext = false) {
    const list = Array.isArray(selectors) ? selectors : [];
    const decl = stripOuterBraces(styleBlock);
    if (!decl) return '';

    const out = [];
    for (const raw of list) {
        const sel = String(raw || '').trim();
        if (!sel) continue;
        const updatedSel = !isContext ? sel : `*:not(${sel}):not(${sel} *):not(:has(${sel}))`
        out.push(`${updatedSel} { ${decl} }`);
    }
    return out.join('\n');
}

function getA11yGlobalFindings(scans) {
    const out = {
        fail: [],
        cantTell: [],
        pass: [],
        notApplicable: []
    };

    const byOutcome = {
        fail: new Map(),
        cantTell: new Map(),
        pass: new Map(),
        notApplicable: new Map()
    };
    // Each merged finding's occurrence keys, kept rather than rebuilt on every
    // merge: a finding met on every scan of a long run made that quadratic.
    const seenOf = new Map();

    function occKey(occ) {
        const url = occ && occ.pageUrl ? String(occ.pageUrl) : '';
        const target = elementTarget(occ);
        const html = occ && occ.html ? String(occ.html) : '';
        const failure = occ && occ.failureSummary ? String(occ.failureSummary) : '';
        return url + '##' + target + '##' + html + '##' + failure;
    }

    for (const scan of (Array.isArray(scans) ? scans : [])) {
        const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings)
            ? scan.canonical.findings
            : [];

        for (const f of findings) {
            const outcome = (f && f.outcome) ? String(f.outcome) : '';
            if (!byOutcome[outcome]) continue;

            const uid = (f && f.uid) ? String(f.uid) : '';
            if (!uid) continue;

            const map = byOutcome[outcome];
            const existing = map.get(uid);

            if (!existing) {
                const clone = {
                    ...f,
                    wcag: {
                        ...(f.wcag || {}),
                        sc: Array.isArray(f?.wcag?.sc) ? [...new Set(f.wcag.sc.map(String).filter(Boolean))] : []
                    },
                    occurrences: Array.isArray(f?.occurrences) ? [...f.occurrences] : []
                };

                // Deduplicate occurrences inside the clone
                const seen = new Set();
                clone.occurrences = clone.occurrences.filter((o) => {
                    const k = occKey(o);
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                });

                map.set(uid, clone);
                seenOf.set(clone, seen);
                continue;
            }

            // Merge WCAG SC
            const scA = Array.isArray(existing?.wcag?.sc) ? existing.wcag.sc : [];
            const scB = Array.isArray(f?.wcag?.sc) ? f.wcag.sc : [];
            existing.wcag = existing.wcag || {};
            existing.wcag.sc = [...new Set([...scA, ...scB].map(String).filter(Boolean))];

            // Elements a rule counted and did not list, scan by scan.
            if (Number(f.unlisted) > 0) existing.unlisted = (Number(existing.unlisted) || 0) + Number(f.unlisted);

            // Merge occurrences by union
            const seen = seenOf.get(existing);
            const incoming = Array.isArray(f?.occurrences) ? f.occurrences : [];
            existing.occurrences = Array.isArray(existing.occurrences) ? existing.occurrences : [];

            for (const occ of incoming) {
                const k = occKey(occ);
                if (seen.has(k)) continue;
                seen.add(k);
                existing.occurrences.push(occ);
            }
        }
    }

    out.fail = Array.from(byOutcome.fail.values());
    out.cantTell = Array.from(byOutcome.cantTell.values());
    out.pass = Array.from(byOutcome.pass.values());
    out.notApplicable = Array.from(byOutcome.notApplicable.values());

    return out;
}

function ensureDirSync(dirPath) {
    try {
        fs.mkdirSync(dirPath, {recursive: true});
    } catch {
    }
}

function safeDirPart(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    return s
        .replace(/[\/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 120);
}

function resolveReportsRootWithSubdir(reportsSubdir) {
    // The one reports folder (report-paths.js): the server serves it.
    const baseRoot = REPORTS_ROOT;

    const sub = safeDirPart(reportsSubdir);
    return sub ? path.join(baseRoot, sub) : baseRoot;
}



function filePathToPublicUrl(absPath) {
    if (!absPath) return null;
    try {
        const rel = path.relative(REPORTS_ROOT, absPath);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
        return '/reports/' + rel.split(path.sep).join('/');
    } catch {
        return null;
    }
}
function makeRunStamp(determinism) {
    // Prefer determinism hint if present, otherwise stable-ish timestamp folder.
    const hint = determinism && (determinism.runId || determinism.seed || determinism.label);
    const base = hint ? safeDirPart(hint) : null;

    if (base) return base;

    // ISO but filesystem-safe
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Runs a workflow (navigation + multiple scans) defined by actions.
 */
async function runA11yWorkflow(url, tags, options = {}) {
    const {
        timeoutMs = 60000,
        waitUntil = 'networkidle0',
        actions,
        customSteps,
        viewport,
        // How the page is shown as the run starts (the run's configuration).
        colorScheme = null,
        highContrast = false,
        language = null,
        // Open sites whose certificate the browser does not trust (a staging
        // server's own, or any site through a network that inspects HTTPS).
        acceptUntrustedCerts = false,
        vars,
        progress,
        isCancelled,
        abortSignal,
        determinism,
        debugNative = false,
        exportReport = false,
        keepCoreResults = false,
        hardCancel = false,
        applyDefaultStyle = true,
        // scan-spool.js: when given, each scan's page screenshot goes to a
        // file as the scan finishes instead of staying in memory.
        spool = null,
        // Every step but the scans, screenshots and evidence (see workflowCtx).
        dryRun = false,
    } = options;

    const effectiveWaitUntil = normalizeWaitUntil(waitUntil);

    const workflowActions = Array.isArray(actions) ? [...actions] : [];

    // Fail fast on a scan step whose engine is not installed, or whose
    // profile its engine cannot check.
    checkScanSteps(workflowActions, customSteps, a11yEngine.describeEngine);

    if (workflowActions.length === 0) {
        return {
            url,
            scans: [],
            actionResults: [],
            runDiagnostics: {consoleErrors: [], requestFailures: [], badResponses: []},
            runLogs: [],
            screenshots: [],
            evidence: []
        };
    }

    const {context: ctx, page, usedIsolated} = await openContextAndPage(determinism, {acceptUntrustedCerts});

    const hardCancelWatch = hardCancel
        ? startHardCancelWatch({context: ctx, page, usedIsolated, isCancelled, progress})
        : {
            stop() {
            }, triggered: false
        };

    const runDiagnostics = createRunDiagnostics();
    const actionResults = [];
    const scans = [];
    const workflowCtx = createWorkflowContext({
        viewport: DEFAULT_VIEWPORT,
        progress,
        isCancelled,
        abortSignal: abortSignal || null,
        customSteps,
        // Starting variables (a batch row's), read by the workflow as {var:name}.
        vars: vars && typeof vars === 'object' ? { ...vars } : {},
        // run-workflow.js --dry-run: every step but the scans, screenshots and
        // evidence, to see that the workflow still fits the site.
        dryRun: dryRun === true
    });

    // Run identifier used for deterministic artifact paths
    const runId = makeRunStamp(determinism);
    try {
        if (determinism && typeof determinism === 'object' && !determinism.runId) determinism.runId = runId;
    } catch {}
    workflowCtx.runId = runId;
    // A worker page the workflow opens itself (crawl or forEachElement
    // concurrency) is readied the same way, before it navigates.
    workflowCtx.preparePage = (workerPage) => a11yEngine.preparePage(
        workerPage, { hooks: Array.isArray(determinism?.coreHooks) ? determinism.coreHooks : undefined });

    // Screenshot writer (PNG/JPEG/WEBP) - saves to disk under REPORTS_ROOT/runs/<runId>/...
    // IMPORTANT: opt-in only. By default we do NOT persist non-evidence screenshots.
    // Enable by passing determinism.saveScreenshots === true.
    // workflow-engine must not write to disk directly, it calls ctx.saveScreenshotFile.
    const saveScreenshots = !!(determinism && typeof determinism === 'object' && determinism.saveScreenshots === true);
    if (saveScreenshots) {
        const screenshotsBaseDir = path.join(REPORTS_ROOT, 'runs', runId);
        workflowCtx.saveScreenshotFile = async ({ data, filename, dir, url, meta } = {}) => {
            const sub = safeDirPart(dir);
            const outDir = sub ? path.join(screenshotsBaseDir, sub) : screenshotsBaseDir;

            // Create dir lazily, only when we actually write something
            ensureDirSync(outDir);

            const file = safeDirPart(filename) || `screenshot-${Date.now()}.png`;
            const outPath = path.join(outDir, file);

            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
            await fs.promises.writeFile(outPath, buf);

            return {
                filePath: outPath,
                publicUrl: filePathToPublicUrl(outPath),
                bytes: buf.length,
                url: url || null,
                meta: meta || null
            };
        };
    }



    // Evidence writer (PNG/MHTML) under REPORTS_ROOT, so /reports serves it: for
    // the Save evidence step and a scan's element screenshots. Always installed;
    // it writes nothing unless called.
    const baseDir = path.join(REPORTS_ROOT, 'evidence', runId);

    workflowCtx.saveEvidenceFile = async ({variant, data, filename, dir, url, meta} = {}) => {
        const v = String(variant || '').trim().toLowerCase();
        const sub = safeDirPart(dir);
        const outDir = sub ? path.join(baseDir, sub) : baseDir;

        // Create dir lazily, only when we actually write something
        ensureDirSync(outDir);

        const file = safeDirPart(filename) || `evidence-${Date.now()}.${v === 'mhtml' ? 'mhtml' : 'png'}`;
        const outPath = path.join(outDir, file);

        if (v === 'mhtml') {
            const text = (data == null) ? '' : String(data);
            await fs.promises.writeFile(outPath, text, 'utf8');
            return {
                path: outPath,
                publicUrl: filePathToPublicUrl(outPath),
                bytes: Buffer.byteLength(text, 'utf8'),
                url: url || null,
                meta: meta || null
            };
        }

        // default png
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
        await fs.promises.writeFile(outPath, buf);
        return {
            path: outPath,
            publicUrl: filePathToPublicUrl(outPath),
            bytes: buf.length,
            url: url || null,
            meta: meta || null
        };
    };

    function throwCancelled(where) {
        try {
            collectScansFromCtx(scans);
        } catch {
        }
        try {
            if (typeof progress === 'function') {
                progress({time: new Date().toISOString(), type: 'info', message: `Cancelled: ${where}`});
            }
        } catch {
        }

        const err = new Error('_WF_CANCELLED_');
        err._wfCancelled = true;
        err._wfPartialOut = {
            url,
            scans: Array.isArray(scans) ? scans.slice() : [],
            actionResults: Array.isArray(actionResults) ? actionResults.slice() : [],
            runDiagnostics,
            runLogs: workflowCtx && workflowCtx.runLogs ? workflowCtx.runLogs : []
        };
        throw err;
    }

    function checkCancel(where) {
        if (typeof isCancelled === 'function' && isCancelled()) throwCancelled(where);
    }

    attachDiagnostics(page, runDiagnostics, progress);
    attachDocResponseProbe(page, runDiagnostics, progress);

    async function withTemporaryStyle(pageRef, cssText, fn) {
        const css = (typeof cssText === 'string') ? cssText.trim() : '';
        if (!css) return await fn();

        const STYLE_ID = '__a11y_scan_tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2);

        try {
            await pageRef.evaluate((css, id) => {
                const style = document.createElement('style');
                style.id = id;
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
            }, css, STYLE_ID);

            return await fn();

        } finally {
            try {
                await pageRef.evaluate((id) => {
                    const el = document.getElementById(id);
                    if (el) el.remove();
                }, STYLE_ID);
            } catch {
                // ignore, page may have navigated or been closed
            }
        }
    }

    async function settlePageForScan(pageRef, timeoutMs = 2000, viewportOverride = null, options = null) {
        // Re-apply the active viewport defensively in case the page/session
        // temporarily drifted (SPA overlays/transitions can leave unstable states).
        // Prefer the viewport of the context that actually triggered this scan
        // (e.g. a forEachElement/crawlQueue worker that ran its own setViewport
        // action) over the root workflow viewport, since isolated worker
        // contexts never write back into workflowCtx.viewport.
        try {
            const vp = (viewportOverride && Number.isFinite(viewportOverride.width) && viewportOverride.width > 0
                && Number.isFinite(viewportOverride.height) && viewportOverride.height > 0)
                ? viewportOverride
                : (workflowCtx && workflowCtx.viewport);
            if (vp && Number.isFinite(vp.width) && vp.width > 0 && Number.isFinite(vp.height) && vp.height > 0) {
                // deviceScaleFactor carries the active zoom, and Puppeteer resets
                // it to 1 when it is omitted - so leaving it out here would strip
                // the zoom off every scan right before the scan ran.
                const zoom = resolveZoomFactor(vp.deviceScaleFactor);
                await pageRef.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: zoom });
            }
        } catch {}

        // The page scanned is the one shown: a popup the page opened
        // (window.open, a link with target=_blank) hides it, and a hidden page
        // runs no animation frame, mouse event or screenshot, so the scan
        // waited out its stage limit.
        try { await pageRef.bringToFront(); } catch {}

        const preserveHover = !!(options && options.preserveHover === true);
        if (!preserveHover) {
            try { await clearHoverStateForCapture(pageRef); } catch {}
        }
        try { await waitForRenderSettle(pageRef, timeoutMs); } catch {}
        try {
            await pageRef.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));
        } catch {}
    }

    // Nested uniform scan runner
    workflowCtx.performA11yScan = async (pageRef, meta = {}) => {
        // The step's stage limit: the most each stage below may take, the
        // engine's check included.
        const rawTimeout = (meta && meta.stageTimeout != null) ? Number(meta.stageTimeout) : NaN;
        const scanTimeoutMs = Math.max(1000, Number.isFinite(rawTimeout) ? rawTimeout : DEFAULT_STAGE_TIMEOUT_MS);

        // The timer is cleared once `p` settles: left running, each one kept
        // the whole run, every scan it had finished, in memory for a minute
        // after the run ended.
        const withTimeout = async (p, label) => {
            let timer = null;
            try {
                return await Promise.race([
                    p,
                    new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            reject(new Error(`a11yScan timeout (${scanTimeoutMs}ms) at ${label}`));
                        }, scanTimeoutMs);
                    })
                ]);
            } finally {
                clearTimeout(timer);
            }
        };
        await withTimeout(a11yEngine.ensureInjected(pageRef), 'ensureInjected');

        let domMetrics = null;
        let textMetrics = null;
        let a11ySummary = null;
        let coverageSummary = null;
        let byEngineMetrics = null;

        const currentUrl = safeUrl(pageRef || page);

        // What the scan checks is its own: its Include and Exclude selectors.
        const contextSelector =
            (typeof meta.context === 'string' && meta.context.trim()) ? meta.context.trim() : null;

        const perActionExcludeSelectors = Array.isArray(meta.exclude)
            ? meta.exclude.map((s) => String(s).trim()).filter(Boolean)
            : (typeof meta.exclude === 'string' && meta.exclude.trim()
                ? meta.exclude.split(',').map((s) => s.trim()).filter(Boolean)
                : []);

        const excludeSelectorsForScan = Array.from(new Set(
            perActionExcludeSelectors.map(s => String(s).trim()).filter(Boolean)
        ));

        const hasExclusions = excludeSelectorsForScan.length > 0;

        // 1) explicit per-action css wins
        const explicitCss =
            (typeof meta.beforeScanCss === 'string' && meta.beforeScanCss.trim())
                ? meta.beforeScanCss.trim()
                : null;

        // 2) otherwise resolve from toggle inheritance
        let beforeScanCss = explicitCss;

        let enabled = null;

        if (!beforeScanCss) {
            // Accept boolean OR string/number-like values coming from UI/json
            const perScan = coerceBool(meta && meta.applyDefaultStyle);
            enabled = (perScan != null) ? perScan : coerceBool(applyDefaultStyle);

            // Default if still unknown
            if (enabled == null) enabled = true;

            beforeScanCss = (enabled && hasExclusions) ? DEFAULT_SCAN_CSS : null;
        } else {
            // If explicit CSS is provided, we don’t care about enabled for base style,
            // but we still want to know whether to append exclude rules below.
            enabled = coerceBool(meta && meta.applyDefaultStyle);
            if (enabled == null) enabled = coerceBool(applyDefaultStyle);
            if (enabled == null) enabled = true;
        }

        // 3) Apply DEFAULT_SCAN_CSS to excluded selectors only when default styling is enabled
        if (enabled && contextSelector?.length) {
            const excludeRuleCss = buildSelectorRules([contextSelector], DEFAULT_SCAN_CSS, true);
            if (excludeRuleCss) {
                beforeScanCss = (beforeScanCss ? (beforeScanCss + '\n') : '') + excludeRuleCss;
            }
        }
        if (enabled && hasExclusions) {
            const excludeRuleCss = buildSelectorRules(excludeSelectorsForScan, DEFAULT_SCAN_CSS);
            if (excludeRuleCss) {
                beforeScanCss = (beforeScanCss ? (beforeScanCss + '\n') : '') + excludeRuleCss;
            }
        }

        const shotsStart = Array.isArray(workflowCtx.screenshots) ? workflowCtx.screenshots.length : 0;

        await withTimeout(settlePageForScan(pageRef, 2000, meta.viewport, { preserveHover: meta.preserveHover === true }), 'preScan settle');
        // What was still loading once the page had its time to settle.
        const pageReadiness = await withTimeout(checkPageReady(pageRef, { timeoutMs: meta.pageReadyTimeout }), 'page ready');

        // The step's engine; without one, the default engine.
        const scanEngineId = (typeof meta.engine === 'string' && meta.engine.trim()) ? meta.engine.trim() : null;
        const engineOptions = {engineMode: meta.engineMode};
        // Engine options a step or spec gives pass through to surea11y.
        if (meta.engineOptions && typeof meta.engineOptions === 'object' && !Array.isArray(meta.engineOptions)) {
            Object.assign(engineOptions, meta.engineOptions);
        }
        // What the scan checks against: { version, level, profile, bestPractices },
        // from the step's profile (WCAG 2.2 AA without one) and its
        // best-practice option.
        // Every engine's adapter maps it to its own terms; surea11y takes a
        // standard as it is.
        const selection = resolveScanSelection({
            profile: meta.profile || null,
            includeBestPractice: meta.includeBestPractice === true,
            tags: meta.tags != null ? meta.tags : tags
        });
        if (selection.profile) engineOptions.profile = selection.profile;
        // Also surea11y only: the language its findings are written in.
        const requestedLocale = typeof meta.locale === 'string' ? meta.locale.trim().toLowerCase() : '';
        if (requestedLocale && Object.prototype.hasOwnProperty.call(LOCALES, requestedLocale)) {
            engineOptions.locale = requestedLocale;
        }

        engineOptions.findingsSource = meta.findingsSource || 'composite';
        // A debug run (A11Y_DEBUG_MODE) times each rule: surea11y's perfStats,
        // with the time each rule took (profileRules), kept with its native
        // output, to find what makes a scan slow.
        if (['1', 'true', 'yes', 'on'].includes(String(process.env.A11Y_DEBUG_MODE || '').trim().toLowerCase())
            && engineOptions.perfStats === undefined) {
            engineOptions.perfStats = true;
            engineOptions.profileRules = true;
        }
        if (Array.isArray(meta.resultTypes) && meta.resultTypes.length) engineOptions.resultTypes = meta.resultTypes;

        function normalizeList(v) {
            if (!v) return [];
            if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
            if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
            return [];
        }

        const includeRuleIdsArr = normalizeList(meta.includeRuleIds);
        const excludeRuleIdsArr = normalizeList(meta.excludeRuleIds);
        const includeTagsArr = normalizeList(meta.includeTags);
        const excludeTagsArr = normalizeList(meta.excludeTags);
        const scanTagsArr = normalizeList(meta.scanTags);

        const includeModeRaw = String(meta.includeMode || '').trim().toLowerCase();
        const includeModeNorm =
            includeModeRaw === 'and' || includeModeRaw === 'intersection' ? 'and'
                : includeModeRaw === 'or' || includeModeRaw === 'union' ? 'or'
                    : null;

        const disableRulesArr = Array.isArray(meta.disableRules) ? meta.disableRules : [];
        const singleDisableRule = (typeof meta.disableRule === 'string' && meta.disableRule.trim()) ? meta.disableRule.trim() : null;
        const disableMerged = {};
        if (singleDisableRule) disableMerged[singleDisableRule] = {enabled: false};
        for (const id of disableRulesArr) {
            const ruleId = String(id).trim();
            if (ruleId) disableMerged[ruleId] = {enabled: false};
        }
        if (Object.keys(disableMerged).length) engineOptions.rules = disableMerged;

        // The selection's tags, recorded on the scan as before; surea11y
        // selects by its profile, not by them.
        const tagsForScan = selectionTags(selection);
        const wcagLevel = selection.level;
        // What the scan checks against, as its report records it: the
        // standard asked for until the engine says which it applied.
        const requestedFields = scanProfileFields({
            standard: selection.profile ? { id: selection.profile, label: targetLabel(selection.profile) } : null,
            version: selection.version,
            level: selection.level,
        });
        // The step's own rule ids and rule tags, on top of the selection.
        const runOnly = {includeRuleIds: [], excludeRuleIds: []};

        if (includeTagsArr.length) {
            runOnly.includeTags = [...new Set([...(runOnly.includeTags || []), ...includeTagsArr])];
        }

        if (excludeTagsArr.length) {
            runOnly.excludeTags = [...new Set([...(runOnly.excludeTags || []), ...excludeTagsArr])];
        }

        if (includeModeNorm) {
            runOnly.includeMode = includeModeNorm;
        }

        // Rule id filters (explicit)
        if (includeRuleIdsArr.length) {
            runOnly.includeRuleIds = [...new Set([...(runOnly.includeRuleIds || []), ...includeRuleIdsArr])];
        }

        if (excludeRuleIdsArr.length) {
            runOnly.excludeRuleIds = [...new Set([...(runOnly.excludeRuleIds || []), ...excludeRuleIdsArr])];
        }

        // What the address gave: a PDF, JSON or an image is not a web page,
        // and was scanned as the browser's own viewer of it, with findings
        // about that viewer. It is skipped, and the report says why.
        const documentType = await withTimeout(
            pageRef.evaluate(() => document.contentType || ''),
            'documentType'
        ).catch(() => '');
        if (documentType && !/^(text\/html|application\/xhtml\+xml)$/i.test(documentType)) {
            const skipInfo = {
                reason: `Not a web page: the address gave ${documentType}, which the browser shows in a viewer of its own`,
                contentType: documentType,
            };
            if (typeof progress === 'function') {
                progress({
                    time: new Date().toISOString(),
                    type: 'scan',
                    message: `a11yScan skipped: ${skipInfo.reason}`,
                    depth: (workflowCtx && workflowCtx._logCtx && typeof workflowCtx._logCtx.depth === 'number')
                        ? workflowCtx._logCtx.depth
                        : 0,
                    vars: varsForLog(workflowCtx),
                    extra: {
                        actionPath: (workflowCtx && workflowCtx._logCtx && typeof workflowCtx._logCtx.actionPath === 'string')
                            ? workflowCtx._logCtx.actionPath
                            : undefined,
                        scanId: (typeof meta.scanId === 'string' && meta.scanId) ? meta.scanId : null,
                        orderKey: (typeof meta.orderKey === 'string' && meta.orderKey) ? meta.orderKey : null,
                        label: meta.label || null,
                        url: currentUrl || null,
                        ...skipInfo,
                    }
                });
            }
            if (!Array.isArray(workflowCtx.collectedScans)) workflowCtx.collectedScans = [];
            workflowCtx.collectedScans.push({
                scanId: (typeof meta.scanId === 'string' && meta.scanId) ? meta.scanId : null,
                orderKey: (typeof meta.orderKey === 'string' && meta.orderKey) ? meta.orderKey : null,
                id: (typeof meta.id === 'string' && meta.id.trim()) ? meta.id.trim() : null,
                label: (typeof meta.label === 'string' && meta.label.trim()) ? meta.label.trim() : null,
                scanTags: scanTagsArr.length ? scanTagsArr : null,
                context: contextSelector || null,
                exclude: excludeSelectorsForScan.length ? excludeSelectorsForScan : null,
                tags: tagsForScan || null,
                ...requestedFields,
                runOnly,
                url: currentUrl || safeUrl(pageRef) || null,
                skipped: true,
                skipInfo,
                results: null,
                canonical: null,
                domMetrics: null,
                a11ySummary: null,
                coverageSummary: null,
                screenshot: null,
                extraScreenshots: [],
                mergedScan: meta.mergedScan || null
            });
            return;
        }

        const estimatedNodes = await withTimeout(
            estimateNodeCount(pageRef, contextSelector),
            'estimateNodeCount'
        );
        // A page past it is scanned in full all the same: its report notes
        // that it is large, and how long the scan took (largePageNotice).
        const threshold = resolveThreshold(meta.heavyNodeThreshold);

        const scanStartedAt = Date.now();

        const metricsCfg = {
            maxNodes: 20000,
            includeComputedVisibility: true
        };

        // Independent read-only page.evaluate() calls - run concurrently. Each
        // keeps its own catch, so a failure defaults only itself to null.
        [domMetrics, textMetrics] = await Promise.all([
            collectDomMetrics(pageRef, metricsCfg).catch(() => null),
            collectTextMetrics(pageRef, metricsCfg).catch(() => null)
        ]);

        if (domMetrics && textMetrics) domMetrics.textMetrics = textMetrics;
        else if (!domMetrics && textMetrics) domMetrics = {textMetrics};

        // The language Set language chose, if any, and the page's html lang.
        let languageAtScan = null;
        const requestedLanguage = pageLanguage(pageRef);
        if (requestedLanguage) {
            const declared = await pageRef.evaluate(() => document.documentElement.getAttribute('lang')).catch(() => null);
            languageAtScan = { requested: requestedLanguage, declared: (typeof declared === 'string' && declared.trim()) ? declared.trim() : null };
        }
        let pageTitleAtScan = null;
        try {
            pageTitleAtScan = await pageRef.title();
        } catch {
        }

        const doScan = async () => {
            // Pictures of flagged elements get their own time after the
            // scan's, and stop when the scan is given up on, so the binding
            // does not go on scrolling a page the workflow has moved on with.
            const shotOptions = screenshotOptionsForStep(meta.elementScreenshots, meta.elementScreenshotsMax, meta.elementScreenshotsPerRule);
            const shotAbort = shotOptions ? new AbortController() : null;
            const engineTimeoutMs = scanTimeoutMs + (shotOptions ? CAPTURE_BUDGET_MS : 0);
            let engineTimer = null;
            let engineResult;
            try {
                engineResult = await Promise.race([
                    a11yEngine.runOnPage(pageRef, {
                        selection,
                        runOnly,
                        wcagLevel,
                        contextSelector,
                        excludeSelectors: excludeSelectorsForScan,
                        engineOptions,
                        postProcess: {getSuccessCriteria},
                        elementScreenshots: shotOptions
                            ? { ...shotOptions, budgetMs: CAPTURE_BUDGET_MS, signal: shotAbort.signal }
                            : null,
                        frames: meta.frames !== false
                    }, scanEngineId),
                    new Promise((_, reject) => {
                        engineTimer = setTimeout(() => {
                            if (shotAbort) shotAbort.abort();
                            reject(new Error(`a11yScan timeout (${engineTimeoutMs}ms) at engine.runOnPage`));
                        }, engineTimeoutMs);
                    })
                ]);
            } finally {
                clearTimeout(engineTimer);
            }
            const canonical = engineResult && engineResult.canonical ? engineResult.canonical : null;
            // Pictures of the flagged elements, as evidence files: what
            // reaches the payload is each one's URL, not its bytes.
            if (canonical && typeof canonical === 'object' && meta.elementScreenshots && meta.elementScreenshots !== 'off') {
                const scanKey = (typeof meta.scanId === 'string' && meta.scanId.trim())
                    ? meta.scanId.trim()
                    : ((typeof meta.id === 'string' && meta.id.trim()) ? meta.id.trim() : 'scan');
                await storeElementScreenshots(canonical, {
                    save: typeof workflowCtx.saveEvidenceFile === 'function'
                        ? ({ data, filename, dir }) => workflowCtx.saveEvidenceFile({ variant: 'png', data, filename, dir })
                        : null,
                    dir: `elements-${scanKey}`
                });
            }
            const collectedScans = engineResult && engineResult.native ? engineResult.native : null;

            const finalUrl = safeUrl(pageRef) || currentUrl || null;
            try {
                if (collectedScans && runOnly && typeof a11yEngine.getRulesForRunOnly === 'function') {
                    const rules = await a11yEngine.getRulesForRunOnly(pageRef, runOnly, scanEngineId, {selection, wcagLevel, engineOptions});
                    if (rules) collectedScans.rules = rules;
                }
            } catch {
            }

            if (collectedScans && !collectedScans.url) collectedScans.url = finalUrl;
            // canonical model is produced by the engine adapter (Phase 1).
            // Enrich it with per-scan metadata for later UI migration.
            try {
                if (canonical && typeof canonical === 'object') {
                    canonical.page = canonical.page || {};
                    if (!canonical.page.url) canonical.page.url = (collectedScans && collectedScans.url) ? collectedScans.url : finalUrl;
                    if (!canonical.page.title) canonical.page.title = pageTitleAtScan || null;
                    if (!canonical.page.timestamp) canonical.page.timestamp = new Date().toISOString();

                    canonical.scope = canonical.scope || {};
                    if (!canonical.scope.include) canonical.scope.include = contextSelector ? [contextSelector] : ['html'];
                    if (!canonical.scope.exclude) canonical.scope.exclude = excludeSelectorsForScan;

                    canonical.runOptions = canonical.runOptions || {};
                    if (!canonical.runOptions.standardTags) canonical.runOptions.standardTags = Array.isArray(tagsForScan) ? tagsForScan : (typeof tagsForScan === 'string' ? tagsForScan.split(',').map(s => s.trim()).filter(Boolean) : []);
                    if (canonical.runOptions.includeBestPractice == null) canonical.runOptions.includeBestPractice = selection.bestPractices;
                    if (!canonical.runOptions.resultTypes) canonical.runOptions.resultTypes = Array.isArray(meta.resultTypes) ? meta.resultTypes : [];
                    if (!canonical.runOptions.engineOptions) canonical.runOptions.engineOptions = engineOptions;

                    canonical.diagnostics = canonical.diagnostics || {};
                    canonical.diagnostics.durationMs = Date.now() - scanStartedAt;
                    canonical.diagnostics.estimatedNodes = estimatedNodes;
                    canonical.diagnostics.pageReadiness = pageReadiness;
                    const httpError = httpErrorNotice(pageRef.__a11yDocumentResponse, currentUrl || safeUrl(pageRef));
                    if (httpError) canonical.notices = [httpError, ...(Array.isArray(canonical.notices) ? canonical.notices : [])];
                    const large = largePageNotice(estimatedNodes, threshold, canonical.diagnostics.durationMs);
                    if (large) canonical.notices = [...(Array.isArray(canonical.notices) ? canonical.notices : []), large];
                    const notReady = readinessNotice(pageReadiness);
                    if (notReady) canonical.notices = [notReady, ...(Array.isArray(canonical.notices) ? canonical.notices : [])];

                    // The language Set language chose, and the one the page
                    // says it is in: a site may not follow the step.
                    if (languageAtScan) {
                        canonical.page.language = languageAtScan;
                        const mismatch = languageNotice(languageAtScan);
                        if (mismatch) canonical.notices = [mismatch, ...(Array.isArray(canonical.notices) ? canonical.notices : [])];
                    }
                }
            } catch {
            }

            // Coverage first: the summary is gated on it, so that a page where nothing
            // was evaluated reports no score instead of a perfect one. The engine
            // the scan actually ran, as the canonical names it.
            const engineMetaForScan = Array.isArray(canonical?.engines) && canonical.engines[0] && canonical.engines[0].id
                ? canonical.engines[0]
                : null;
            const engineIdForScan = engineMetaForScan ? String(engineMetaForScan.id).trim() : scanEngineId;

            // Kept for a Merged scan, which scores its contexts' findings again
            // once they are merged (merged-scan.js), against the same coverage,
            // and, when its contexts ran different engines, scores each
            // engine's findings on their own.
            let scanAutomationCoverage = null;
            const perEngineMetricInputs = [];
            try {
                if (canonical) {
                    scanAutomationCoverage = await getAutomationCoverage(wcagLevel, engineIdForScan, selection.version);
                    coverageSummary = buildCoverageAwareSummary({
                        canonical,
                        automationCoverage: scanAutomationCoverage
                    });
                    if (engineMetaForScan) {
                        perEngineMetricInputs.push({
                            engineId: engineIdForScan.toLowerCase(),
                            engine: engineMetaForScan,
                            canonical,
                            automationCoverage: scanAutomationCoverage
                        });
                    }
                } else {
                    coverageSummary = null;
                }
            } catch {
                coverageSummary = null;
            }

            try {
                if (canonical && domMetrics && typeof domMetrics.totalElements === 'number') {
                    a11ySummary = buildA11ySummary({canonical, domMetrics, coverageSummary});
                } else {
                    a11ySummary = null;
                }
            } catch {
                a11ySummary = null;
            }

            // A scan runs one engine, so its own summary is that engine's.
            byEngineMetrics = null;

            let mainScreenshot = null;
            let viewportRatio = 4 / 3;
            // The step's Screenshot view: without it, the scan takes no
            // picture of the page.
            if (meta.screenshotView !== false) try {
                await withTimeout(settlePageForScan(pageRef, 1500, meta.viewport, { preserveHover: meta.preserveHover === true }), 'preScreenshot settle');
                const viewport = await pageRef.evaluate(() => ({
                    width: window.innerWidth,
                    height: window.innerHeight
                }));
                viewportRatio = viewport.width / viewport.height;
                const wantFile = !!workflowCtx.saveScreenshotFile;

                const scanIdForShot =
                    (typeof meta.scanId === 'string' && meta.scanId.trim())
                        ? meta.scanId.trim()
                        : ((typeof meta.id === 'string' && meta.id.trim()) ? meta.id.trim() : 'scan');

                const orderKeyForShot =
                    (typeof meta.orderKey === 'string' && meta.orderKey.trim())
                        ? meta.orderKey.trim()
                        : 'main:0000';

                const safeOrderKey = String(orderKeyForShot).replace(/[:]/g, '-');

                const mainShot = await withTimeout(
                    captureScreenshotArtifact(pageRef, {
                        strategy: 'cdp',
                        type: 'jpeg',
                        quality: 80,
                        output: {
                            buffer: true,
                            file: wantFile
                        },
                        file: wantFile ? {
                            dir: `scans/${scanIdForShot}`,
                            filename: `scan-main__${safeOrderKey}__${safeDirPart(scanIdForShot)}__00.jpg`
                        } : null,
                        saveFile: wantFile ? async ({ buffer, bytes, type, mimeType, dir, filename, ext }) => {
                            return workflowCtx.saveScreenshotFile({
                                data: buffer,
                                filename,
                                dir,
                                meta: { bytes, type, mimeType, ext, kind: 'scan-main', orderKey: orderKeyForShot, scanId: scanIdForShot }
                            });
                        } : null
                    }),
                    'screenshot'
                );

                mainScreenshot = mainShot && mainShot.buffer ? mainShot.buffer : null;
                // Store full artifact object too, so downstream normalizers can prefer publicUrl when present.
                var mainScreenshotArtifact = mainShot;
            } catch {
            }

            const extras = Array.isArray(workflowCtx.screenshots) ? workflowCtx.screenshots.slice(shotsStart) : [];

            let keptScreenshot = (typeof mainScreenshotArtifact !== 'undefined' && mainScreenshotArtifact) ? mainScreenshotArtifact : mainScreenshot;
            if (spool && keptScreenshot) {
                try {
                    keptScreenshot = await spool.spillScreenshot(keptScreenshot);
                } catch {
                    // Not written (a full disk): it stays in memory, as without a spool.
                }
            }

            if (!Array.isArray(workflowCtx.collectedScans)) workflowCtx.collectedScans = [];
            workflowCtx.collectedScans.push({
                id: (typeof meta.id === 'string' && meta.id.trim()) ? meta.id.trim() : null,
                scanId: (typeof meta.scanId === 'string' && meta.scanId.trim()) ? meta.scanId.trim() : ((typeof meta.id === 'string' && meta.id.trim()) ? meta.id.trim() : null),
                orderKey: (typeof meta.orderKey === 'string' && meta.orderKey.trim()) ? meta.orderKey.trim() : null,
                iterationIndex: (typeof meta.iterationIndex === 'number') ? meta.iterationIndex : null,
                scanIndex: (typeof meta.scanIndex === 'number') ? meta.scanIndex : null,
                label: (typeof meta.label === 'string' && meta.label.trim()) ? meta.label.trim() : null,
                scanTags: scanTagsArr.length ? scanTagsArr : null,
                context: contextSelector || null,
                exclude: excludeSelectorsForScan.length ? excludeSelectorsForScan : null,
                tags: tagsForScan || null,
                // The standard the engine applied, if any; else its WCAG level.
                ...scanProfileFields({
                    standard: appliedConformanceProfile(engineResult, {
                        requested: selection.profile,
                        overridden: includeRuleIdsArr.length > 0 || includeTagsArr.length > 0
                    }),
                    version: selection.version,
                    level: selection.level,
                }),
                runOnly,
                url: finalUrl,
                results: debugNative ? collectedScans : null,
                // Internal only, used for explicit report export without leaking native to normal payloads
                nativeForReport: exportReport ? collectedScans : null,
                // Internal only: surea11y's raw result, for SARIF/JUnit/EARL export
                coreResult: keepCoreResults ? a11yEngine.ownResult(collectedScans) : null,
                canonical,
                domMetrics,
                a11ySummary,
                coverageSummary,
                byEngineMetrics,
                screenshot: keptScreenshot,
                viewportRatio,
                extraScreenshots: extras,
                // Inside a Merged scan step: folded with the step's other scans
                // when the run's scans are collected (merged-scan.js).
                mergedScan: meta.mergedScan || null,
                _metricInputs: meta.mergedScan
                    ? {automationCoverage: scanAutomationCoverage, perEngine: perEngineMetricInputs}
                    : undefined
            });

            try {
                const findings = Array.isArray(canonical?.findings) ? canonical.findings : [];

                const summary = {
                    failCount: findings.filter(f => f?.outcome === 'fail').length,
                    passesCount: findings.filter(f => f?.outcome === 'pass').length,
                    reviewCount: findings.filter(f => f?.outcome === 'cantTell').length,
                };

                const dataUrl = mainScreenshot ? 'data:image/jpeg;base64,' + Buffer.from(mainScreenshot).toString('base64') : null;
                if (typeof progress === 'function') {
                    progress({
                        time: new Date().toISOString(),
                        type: 'scan',
                        message: 'a11yScan ready',
                        depth: (workflowCtx && workflowCtx._logCtx && typeof workflowCtx._logCtx.depth === 'number')
                            ? workflowCtx._logCtx.depth
                            : 0,
                        vars: varsForLog(workflowCtx),
                        extra: {
                            actionPath: (workflowCtx && workflowCtx._logCtx && typeof workflowCtx._logCtx.actionPath === 'string')
                                ? workflowCtx._logCtx.actionPath
                                : undefined,
                            scanId: (typeof meta.scanId === 'string' && meta.scanId) ? meta.scanId : null,
                            orderKey: (typeof meta.orderKey === 'string' && meta.orderKey) ? meta.orderKey : null,
                            label: meta.label || null,
                            context: contextSelector || null,
                            exclude: excludeSelectorsForScan.length ? excludeSelectorsForScan : null,
                            tags: tagsForScan || null,
                            scanTags: scanTagsArr.length ? scanTagsArr : null,
                            profile: requestedFields.profile,
                            summary,
                            // The Merged scan it is a context of: the live counts
                            // count that scan once, from its first context.
                            mergedScanKey: (meta.mergedScan && meta.mergedScan.key) || null,
                            dataUrl,
                            viewportRatio,
                            url: currentUrl || null,
                            meta: {
                                durationMs: Date.now() - scanStartedAt,
                                estimatedNodes,
                                title: pageTitleAtScan
                            }
                        }
                    });
                }
            } catch {
            }
        };
        await withTemporaryStyle(pageRef, beforeScanCss, doScan);
    };

    // Provide a single handler that workflow-engine can call for nested a11yScan actions.
    // workflow-engine will pass { page, action, ctx, localVars, depth, actionPathPrefix }.
    workflowCtx.handleA11yScanAction = async ({page: pageRef, action, ctx, localVars} = {}) => {
        const s = action || {};

        // A dry run does not scan. What it can still say is whether the scan
        // would have had something to check: its context on the page.
        if (dryRun) {
            const name = (typeof s.label === 'string' && s.label.trim()) ? `"${s.label.trim()}"` : 'without a label';
            const contextSel = (typeof s.context === 'string' && s.context.trim()) ? s.context.trim() : null;
            if (contextSel) {
                const found = await pageRef.evaluate((sel) => {
                    try { return document.querySelectorAll(sel).length; } catch { return -1; }
                }, contextSel).catch(() => -1);
                if (found === 0) {
                    pushLog(ctx || workflowCtx, 'warning', `Dry run: scan ${name} would check nothing: its context "${contextSel}" matches nothing on the page`, { dryRunProblem: 'context' });
                    return;
                }
                if (found < 0) {
                    pushLog(ctx || workflowCtx, 'warning', `Dry run: scan ${name} could not look for its context "${contextSel}"`, { dryRunProblem: 'context' });
                    return;
                }
            }
            pushLog(ctx || workflowCtx, 'info', `Dry run: scan ${name} not run`);
            return;
        }

        // ctx is the execution context that actually issued this action - for
        // scans running inside an isolated forEachElement/crawlQueue worker,
        // this differs from workflowCtx and reflects any setViewport actions
        // that ran within that worker (see settlePageForScan above).
        const callerViewport = (ctx && ctx.viewport) ? ctx.viewport : null;

        await workflowCtx.performA11yScan(pageRef, {
            // deterministic ids provided by workflow-engine when nested
            id: s.id || null,
            viewport: callerViewport,
            // The Merged scan step this scan runs inside, if any.
            mergedScan: (ctx && ctx._mergedScan && ctx._mergedScan.key)
                ? {key: ctx._mergedScan.key, label: ctx._mergedScan.label || null, scanTags: ctx._mergedScan.scanTags || null}
                : null,
            scanId: s.scanId || null,
            orderKey: s.orderKey || null,
            iterationIndex: (typeof s.iterationIndex === 'number') ? s.iterationIndex : null,
            scanIndex: (typeof s.scanIndex === 'number') ? s.scanIndex : null,

            // same fields as top-level a11yScan interception
            label: s.label || null,
            engine: s.engine || null,
            screenshotView: s.screenshotView !== false,
            scanTags: s.scanTags || null,
            context: s.context || null,
            preserveHover: s.preserveHover === true,
            beforeScanCss: s.beforeScanCss || null,
            exclude: s.exclude || null,
            applyDefaultStyle: s.applyDefaultStyle ?? null,
            tags: s.tags || null,
            profile: s.profile || null,
            includeBestPractice: s.includeBestPractice === true,
            resultTypes: s.resultTypes || null,
            // Scan iframes too: on unless the step turns it off (the older
            // iframes field, which only ever turned it on, reads the same).
            frames: s.frames !== false && s.iframes !== false,
            disableRule: s.disableRule || null,
            disableRules: s.disableRules || null,
            heavyNodeThreshold: s.heavyNodeThreshold || null,
            pageReadyTimeout: s.pageReadyTimeout ?? null,
            includeRuleIds: s.includeRuleIds || null,
            excludeRuleIds: s.excludeRuleIds || null,
            includeTags: s.includeTags || null,
            excludeTags: s.excludeTags || null,
            includeMode: s.includeMode || null,
            engineMode: s.engineMode || null,
            // Failures unless the step says otherwise, as the step editor has it.
            elementScreenshots: s.elementScreenshots || 'fail',
            elementScreenshotsMax: s.elementScreenshotsMax ?? null,
            elementScreenshotsPerRule: s.elementScreenshotsPerRule ?? null,
            locale: s.locale || null,
            findingsSource: s.findingsSource || null,

            // allow engine-specific options through
            engineOptions:
                (s.engineOptions && typeof s.engineOptions === 'object' && !Array.isArray(s.engineOptions))
                    ? s.engineOptions
                    : null,

            // the step's stage limit
            stageTimeout: s.stageTimeout ?? null
        });
    };

    // Each Merged scan step's scans become the one scan they are: one step's
    // as soon as it ends (onlyKey), and at the end any a cancelled or failed
    // run left. Synchronous, as the cancel and error paths do not wait:
    // everything the merge scores against was kept on each scan.
    function foldCollectedScans(onlyKey = null) {
        const collected = Array.isArray(workflowCtx.collectedScans) ? workflowCtx.collectedScans : [];
        const nested = foldMergedScans(collected, {buildCoverageAwareSummary, buildA11ySummary, automationCoverageForEngines}, {onlyKey});
        if (nested !== collected && typeof progress === 'function') {
            // The live totals added each context as it finished; this tells
            // them which scans became one, so they count the merged scan from
            // here on.
            const folded = onlyKey ? collected.filter((e) => e && e.mergedScan && e.mergedScan.key === onlyKey) : collected;
            for (const merge of describeMerges(folded, nested)) {
                try {
                    progress({
                        time: new Date().toISOString(),
                        type: 'scan',
                        message: 'a11yScan merged',
                        extra: merge
                    });
                } catch {
                }
            }
        }
        return nested;
    }

    workflowCtx.onMergedScanEnd = (key) => {
        if (key) workflowCtx.collectedScans = foldCollectedScans(key);
    };

    async function collectScansFromCtx(scansArr) {
        const collected = Array.isArray(workflowCtx.collectedScans) ? workflowCtx.collectedScans : [];
        if (!collected.length) return;
        const nested = foldCollectedScans();

        for (const ax of nested) {
            const runOnly = ax.runOnly || null;

            const resolvedId = (typeof ax.id === 'string' && ax.id.trim()) ? ax.id.trim() : `scan-${scansArr.length + 1}`;

            scansArr.push({
                id: resolvedId,
                scanId: (typeof ax.scanId === 'string' && ax.scanId.trim()) ? ax.scanId.trim() : resolvedId,
                orderKey: (typeof ax.orderKey === 'string' && ax.orderKey.trim()) ? ax.orderKey.trim() : null,
                iterationIndex: (typeof ax.iterationIndex === 'number') ? ax.iterationIndex : null,
                scanIndex: (typeof ax.scanIndex === 'number') ? ax.scanIndex : null,
                label: ax.label || null,
                scanTags: Array.isArray(ax.scanTags) && ax.scanTags.length ? ax.scanTags : null,
                context: ax.context || null,
                exclude: ax.exclude || null,
                tags: ax.tags || null,
                profile: ax.profile || null,
                wcag: ax.wcag || null,
                runOnly,
                url: ax.url || null,
                skipped: !!ax.skipped,
                skipInfo: ax.skipInfo || null,

                canonical: ax.canonical || null,

                // keep native output when debugNative enabled
                results: ax.results || null,

                // keep internal native copy for report export
                nativeForReport: ax.nativeForReport || null,
                coreResult: ax.coreResult || null,

                domMetrics: ax.domMetrics || null,
                a11ySummary: ax.a11ySummary || null,
                coverageSummary: ax.coverageSummary || null,
                byEngineMetrics: ax.byEngineMetrics || null,
                screenshot: ax.screenshot || null,
                viewportRatio: ax.viewportRatio || null,
                extraScreenshots: Array.isArray(ax.extraScreenshots) ? ax.extraScreenshots : [],
                // A Merged scan: its contexts, and a screenshot from each.
                ...(ax.mergedScan === true ? {
                    mergedScan: true,
                    contexts: Array.isArray(ax.contexts) ? ax.contexts : [],
                    screenshots: Array.isArray(ax.screenshots) ? ax.screenshots : []
                } : {})
            });
        }

        workflowCtx.collectedScans = [];
    }

    try {
        const logicalViewport = computeEffectiveViewport(viewport, workflowActions);
        const initialZoom = computeInitialZoom(workflowActions);
        const effectiveViewport = applyZoomToViewport(logicalViewport, initialZoom);
        await page.setViewport(effectiveViewport);
        workflowCtx.viewport = effectiveViewport;
        workflowCtx.viewportLogical = {...logicalViewport};
        workflowCtx.viewportZoom = initialZoom;
        // baseViewport backs the setViewport "default" preset, which restores the
        // run's configured size - so it holds the logical size, not the zoomed one.
        workflowCtx.baseViewport = {...logicalViewport};
        page.setDefaultNavigationTimeout(timeoutMs);
        page.setDefaultTimeout(timeoutMs);

        // The run's color scheme, high contrast and language, before the
        // first navigation, so the first page already loads that way. A
        // language may come from a variable (a batch row's).
        let runLanguage = null;
        if (typeof language === 'string' && language.trim()) {
            const resolved = interpolateVarTokensLoose(language.trim(), {localVars: Object.create(null), ctx: workflowCtx}).trim();
            runLanguage = (resolved && resolved.toLowerCase() !== 'default') ? canonicalLanguageTag(resolved) : null;
            if (resolved && resolved.toLowerCase() !== 'default' && !runLanguage) {
                throw new Error(`The run's language "${resolved}" is not a language tag: use one such as es-ES, de or pt-BR`);
            }
        }
        await applyRunConditions(page, workflowCtx, {
            colorScheme: (colorScheme === 'light' || colorScheme === 'dark') ? colorScheme : null,
            highContrast: highContrast === true || highContrast === 'on',
            language: runLanguage
        });

        if (typeof progress === 'function') {
            try {
                if (acceptUntrustedCerts) {
                    progress({time: new Date().toISOString(), type: 'warn', message: 'This run accepts certificates the browser does not trust: it cannot tell a site from one pretending to be it, so type no password you would not give away'});
                }
                progress({time: new Date().toISOString(), type: 'info', message: `browsing to ${url}`});
            } catch {
            }
        }

        // Cancelling ends the wait for the start page: it took both tries of
        // a page that never answers, two minutes, before.
        await workflowCtx.race(gotoWithFallback(page, url, timeoutMs, effectiveWaitUntil), 'start page');
        checkCancel('after goto');

        if (workflowActions.length) {
            checkCancel('before applyActions');
            await applyActions(page, workflowActions, actionResults, 0, workflowCtx);
            checkCancel('after applyActions');
            await collectScansFromCtx(scans);
        }

        checkCancel('finalize');

        return {
            url,
            scans,
            actionResults,
            runDiagnostics,
            runLogs: workflowCtx.runLogs || [],
            screenshots: (Array.isArray(workflowCtx.screenshots) ? workflowCtx.screenshots : []),
            evidence: (Array.isArray(workflowCtx.evidence) ? workflowCtx.evidence : []),
            collectedOutputs: (Array.isArray(workflowCtx.collectedOutputs) ? workflowCtx.collectedOutputs : []),
            iterationFailureSummary: workflowCtx.iterationFailureSummary || null
        };
    } catch (err) {
        const hardCancelled =
            hardCancel && (hardCancelWatch?.triggered || (typeof isCancelled === 'function' && isCancelled()));

        // Always try to harvest anything already produced
        try {
            collectScansFromCtx(scans);
        } catch {
        }

        // A run asked to cancel ends cancelled, whatever its teardown threw.
        const cancelRequested = hardCancelled || (typeof isCancelled === 'function' && !!isCancelled());
        if (endedByCancel(err, {cancelRequested})) {
            return {
                url,
                cancelled: true,
                scans,
                actionResults,
                runDiagnostics,
                runLogs: workflowCtx.runLogs || [],
                screenshots: (Array.isArray(workflowCtx.screenshots) ? workflowCtx.screenshots : []),
                evidence: (Array.isArray(workflowCtx.evidence) ? workflowCtx.evidence : []),
                collectedOutputs: (Array.isArray(workflowCtx.collectedOutputs) ? workflowCtx.collectedOutputs : []),
                iterationFailureSummary: workflowCtx.iterationFailureSummary || null
            };
        }

        return {
            url,
            failed: true,
            error: {
                message: String(err?.message || err || 'Workflow failed'),
                name: err?.name ? String(err.name) : null,

                actionPath: err?.actionPath || null,
                actionType: err?.actionType || null,
                actionLabel: err?.actionLabel || null,
                actionIndex: Number.isFinite(err?.actionIndex) ? err.actionIndex : null
            },
            scans,
            actionResults,
            runDiagnostics,
            runLogs: workflowCtx.runLogs || [],
            screenshots: (Array.isArray(workflowCtx.screenshots) ? workflowCtx.screenshots : []),
            evidence: (Array.isArray(workflowCtx.evidence) ? workflowCtx.evidence : []),
            collectedOutputs: (Array.isArray(workflowCtx.collectedOutputs) ? workflowCtx.collectedOutputs : []),
            iterationFailureSummary: workflowCtx.iterationFailureSummary || null
        };
    } finally {
        try {
            hardCancelWatch.stop();
        } catch {
        }
        await closeContextAndPage(ctx, page, usedIsolated);
    }
}

function sortByOrderKey(items) {
    if (!items) return [];
    if (!Array.isArray(items)) return [];

    return items.slice().sort((a, b) => {
        if (!a?.orderKey && !b?.orderKey) return 0;
        if (!a?.orderKey) return 1;
        if (!b?.orderKey) return -1;
        return String(a.orderKey).localeCompare(String(b.orderKey));
    });
}

module.exports = {
    appliedConformanceProfile,
    runA11yWorkflow,
    closeBrowser,
    getBrowserPid,
    getBrowser,
    answerDialogs,
    endedByCancel,
    gotoWithFallback,
    getA11yGlobalFindings,
    buildGlobalSummary,
    sortByOrderKey,
    getAutomationCoverage
};
