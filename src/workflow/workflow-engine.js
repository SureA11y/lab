'use strict';

/**
 * Workflow engine to execute declarative actions on a Puppeteer page.
 * Exposes: ACTION_DEFINITIONS, createWorkflowContext, applyActions, countPlannedArtifacts
 */

const {ACTION_DEFINITIONS} = require('./action-definitions');

const {isDisabled, isNonEmptyString, toNumber, toBool, sleep, cloneDeep} = require('./engine/utils');
const {
    createVarScopes,
    rewriteSelectorsWithCtx,
    interpolateIndexVars,
    interpolateTemplate,
    interpolateVarTokensLoose,
    interpolateAll,
    resolveDisplayLabel
} = require('./engine/vars');
const {pushLog} = require('./engine/log');
const {evaluateUrlCondition} = require('./engine/url-condition');
const {lookupVar, readSwitchSubject, pickSwitchCase} = require('./engine/switch-step');
const {parseNumberStrict, hasVarToken, coerceNumberFields} = require('./engine/numbers');
const {
    safePageUrl,
    stopLoading,
    normalizeWaitUntil,
    waitForRenderSettle,
    gotoPage,
    isContextDestroyedError,
    withNavResilience,
    waitForPossibleNavigation,
    startPossibleNavigationWatch,
    waitForSel,
    restoreLoopHomeIfBlank
} = require('./engine/nav');
const { activateClickHandle } = require('./click-utils');
const { resolveByTextDeepHandle } = require('./deep-by-text');
const { captureScreenshotArtifact } = require('../server-side/screenshot-capture.js');
const { buildViewportFromPreset } = require('../shared/scan-inputs.js');
const { canonicalLanguageTag, setPageLanguage } = require('./engine/page-language');

// Interaction steps accept an optional `scrollIntoView` flag (boolean, or the "true"/"false"
// strings older configs may carry). Unset means true: scroll the target into view first.
function wantsScrollIntoView(action) {
    const v = action ? action.scrollIntoView : undefined;
    if (v === undefined || v === null || v === '') return true;
    return !(v === false || v === 'false');
}

/** ------------------------------- constants ------------------------------- */

const POST_STEP_DELAY = 500; // ms
const DEFAULT_HEAVY_NODE_THRESHOLD = 25000;

// node --test sets NODE_TEST_CONTEXT in the process that runs test files (undocumented but
// stable internal plumbing). Real/production runs never have it set, so they keep the full
// delay unless they opt out.
const IS_TEST_RUN = !!process.env.NODE_TEST_CONTEXT;
const DEFAULT_POST_STEP_DELAY = IS_TEST_RUN ? 0 : POST_STEP_DELAY;

// Pause between workflow steps, letting a real page settle before the next action.
// Defaults to 0 automatically under `node --test`; production keeps the real 500ms.
// Still overridable per-run via createWorkflowContext({ postStepDelayMs: N }).
function postStepDelay(ctxLike) {
    const ms = (ctxLike && typeof ctxLike.postStepDelayMs === 'number')
        ? ctxLike.postStepDelayMs
        : DEFAULT_POST_STEP_DELAY;
    if (ms <= 0) return Promise.resolve();
    return (ctxLike && typeof ctxLike.race === 'function')
        ? ctxLike.race(sleep(ms), 'post-action delay')
        : sleep(ms);
}

// Steps that never act on the page themselves: branching, grouping, calling a
// custom step, setting variables, and waiting, and the steps that only read it
// (Get text, Get count, Collect output, Skip iteration), after which there is
// nothing to settle. The steps inside them pause after acting, so pausing
// again once such a step ends only adds time, and a wait step is already the
// pause its author asked for. Loops (forEachElement, repeat, crawlQueue) and
// merged scans keep the pause.
const NO_PAUSE_AFTER_TYPES = new Set([
    'if', 'ifUrl', 'switch', 'group', 'runCustomStep', 'setVar', 'clearVar', 'wait',
    'getText', 'getCount', 'collectOutput', 'skipIteration'
]);

function createWfCancelledError(partialOut) {
    const err = new Error('Workflow cancelled');
    err._wfCancelled = true;
    if (partialOut) err._wfPartialOut = partialOut;
    return err;
}

function snapshotPartialOut(ctx, actionResults, extra = null) {
    return {
        ok: false,
        error: extra || null,
        actionResults: Array.isArray(actionResults) ? actionResults : [],
        collectedScans: Array.isArray(ctx?.collectedScans) ? ctx.collectedScans : [],
        collectedOutputs: Array.isArray(ctx?.collectedOutputs) ? ctx.collectedOutputs : [],
        screenshots: Array.isArray(ctx?.screenshots) ? ctx.screenshots : [],
        evidence: Array.isArray(ctx?.evidence) ? ctx.evidence : [],
        runLogs: Array.isArray(ctx?.runLogs) ? ctx.runLogs : [],
        iterationFailures: Array.isArray(ctx?.iterationFailures) ? ctx.iterationFailures : [],
        iterationFailureSummary: ctx?.iterationFailureSummary || null
    };
}

function throwIfAborted(ctx) {
    if (ctx && ctx.abortSignal && ctx.abortSignal.aborted) {
        throw createWfCancelledError(ctx._partialOut || null);
    }
}

function formatActionPrefix(actionPathPrefix) {
    if (!Array.isArray(actionPathPrefix) || !actionPathPrefix.length) return '';
    const parts = actionPathPrefix.filter((n) => Number.isFinite(n) && n > 0);
    if (!parts.length) return '';
    return 'Action ' + parts.join('.') + ' ';
}

/**
 * Race a promise against ctx.abortSignal.
 * If aborted, throws a workflow-cancel error that your server already knows how to serialize.
 */
async function abortable(promise, ctx) {
    if (!ctx || !ctx.abortSignal) return promise;
    throwIfAborted(ctx);

    let onAbort;
    const abortPromise = new Promise((_, reject) => {
        onAbort = () => reject(createWfCancelledError(ctx._partialOut || null));
        ctx.abortSignal.addEventListener('abort', onAbort, {once: true});
    });

    try {
        return await Promise.race([promise, abortPromise]);
    } finally {
        try {
            ctx.abortSignal.removeEventListener('abort', onAbort);
        } catch {
        }
    }
}

/** ---------------------------- scope helpers ----------------------------- */

async function setScopeAttr(page, handle) {
    const scopeId = `scope_${Math.random().toString(36).slice(2, 9)}`;

    // Verify we actually managed to mark the element, otherwise scopeSel will never match.
    const ok = await handle.evaluate((el, id) => {
        try {
            el.setAttribute('data-wf-scope', id);
            return el.getAttribute('data-wf-scope') === id;
        } catch {
            return false;
        }
    }, scopeId).catch(() => false);

    if (!ok) {
        const err = new Error('forEachElement: failed to set scope attribute (element likely detached)');
        err._wfSkipIteration = true; // so your outer logic can recover cleanly
        throw err;
    }

    return { scopeId, scopeSel: `[data-wf-scope="${scopeId}"]` };
}

async function clearScopeAttr(page, scopeId) {
    try {
        await page.evaluate((id) => {
            const el = document.querySelector(`[data-wf-scope="${id}"]`);
            if (el) el.removeAttribute('data-wf-scope');
        }, scopeId);
    } catch {
    }
}

function rewriteCtxTokenShallow(action, scopeSel) {
    // shallow clone so we never rewrite nested action trees here
    const out = Object.assign({}, action);

    const rewrite = (v) => (typeof v === 'string' && v.includes(':ctx'))
        ? v.split(':ctx').join(scopeSel)
        : v;

    // common selector-bearing fields in your actions
    out.selector = rewrite(out.selector);
    out.targetSelector = rewrite(out.targetSelector);
    out.context = rewrite(out.context);
    out.selectorExists = rewrite(out.selectorExists);

    // If you have other selector fields in your action types, add them here
    // out.containerSelector = rewrite(out.containerSelector);
    // out.rootSelector = rewrite(out.rootSelector);

    return out;
}

async function resolveActiveScopeSelector(page) {
    try {
        const scopeId = await page.evaluate(() => {
            const nodes = document.querySelectorAll('[data-wf-scope]');
            if (!nodes || !nodes.length) return null;
            const el = nodes[nodes.length - 1];
            return el && typeof el.getAttribute === 'function' ? el.getAttribute('data-wf-scope') : null;
        });
        if (!scopeId) return null;
        return `[data-wf-scope="${String(scopeId).replace(/"/g, '\\"')}"]`;
    } catch {
        return null;
    }
}

function normalizeCustomStepInputDefs(inputsRaw) {
    const list = Array.isArray(inputsRaw) ? inputsRaw : [];
    const out = [];
    const seen = new Set();
    for (const entry of list) {
        const def = (typeof entry === 'string')
            ? { name: entry }
            : (entry && typeof entry === 'object' ? entry : null);
        if (!def) continue;
        const name = String(def.name || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
            name,
            required: def.required === true,
            hasDefault: Object.prototype.hasOwnProperty.call(def, 'default'),
            defaultValue: def.default
        });
    }
    return out;
}

function normalizeCustomStepsById(raw) {
    const byId = Object.create(null);
    const list = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object')
            ? Object.entries(raw).map(([id, value]) => ({ id, ...(value || {}) }))
            : [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id || '').trim();
        if (!id) continue;
        if (Object.prototype.hasOwnProperty.call(byId, id)) {
            throw new Error(`customSteps: duplicate id "${id}"`);
        }
        byId[id] = {
            id,
            name: String(item.name || '').trim() || id,
            actions: Array.isArray(item.actions) ? cloneDeep(item.actions) : [],
            inputs: normalizeCustomStepInputDefs(item.inputs)
        };
    }
    return byId;
}

function parseJsonObjectInput(raw, fieldName) {
    if (raw == null) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
    const text = String(raw || '').trim();
    if (!text) return {};
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error(`${fieldName}: invalid JSON (${String(e?.message || e)})`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${fieldName}: expected a JSON object`);
    }
    return parsed;
}

function normalizeExportVarNames(raw) {
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x || '').trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
        return raw.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return [];
}

function normalizeEvidenceVariants(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return 'both';
    if (s === 'png' || s === 'mhtml' || s === 'both') return s;
    return 'both';
}

function safeFilenamePart(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    // keep it filesystem friendly
    return s
        .replace(/[\/\\?%*:|"<>]/g, '-')   // reserved
        .replace(/\s+/g, ' ')              // collapse spaces
        .trim()
        .slice(0, 210);
}

function recordIterationFailure(ctx, payload) {
    try {
        if (!ctx) return;
        if (!Array.isArray(ctx.iterationFailures)) ctx.iterationFailures = [];
        ctx.iterationFailures.push({
            time: new Date().toISOString(),
            ...payload
        });
    } catch {
    }
}

function summarizeIterationFailures(ctx) {
    const list = (ctx && Array.isArray(ctx.iterationFailures)) ? ctx.iterationFailures : [];
    const total = list.length;

    const byType = Object.create(null);
    const byLabel = Object.create(null);
    const byError = Object.create(null);

    for (const f of list) {
        const t = String(f.iteratorType || 'unknown');
        byType[t] = (byType[t] || 0) + 1;

        const label = String(f.iteratorLabel || '');
        if (label) byLabel[label] = (byLabel[label] || 0) + 1;

        const err = String(f.error || '');
        if (err) byError[err] = (byError[err] || 0) + 1;
    }

    const topErrors = Object.entries(byError)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([error, count]) => ({count, error}));

    const topLabels = Object.entries(byLabel)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({count, label}));

    return {
        total,
        byType,
        topLabels,
        topErrors
    };
}

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

/**
 * Compute the heavy node threshold, honoring action, ctx and env, then default.
 * @param {object} ctx
 * @param {object} action
 */
function getHeavyNodeThreshold(ctx, action) {
    const fromAction = toNumber(action?.heavyNodeThreshold, 0);
    if (fromAction > 0) return fromAction;

    const fromCtx = toNumber(ctx?.a11yConfig?.heavyNodeThreshold ?? ctx?.heavyNodeThreshold, 0);
    if (fromCtx > 0) return fromCtx;

    const fromEnv = toNumber(process.env.HEAVY_NODE_THRESHOLD, 0);
    if (fromEnv > 0) return fromEnv;

    return DEFAULT_HEAVY_NODE_THRESHOLD;
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

/** ------------- artifacts estimator (a11y scans + screenshots) -------- */

function countPlannedArtifacts(actions, customStepsRaw = null) {
    // Backward compatible return keys:
    // - a11yScans is the engine-agnostic name
    // - axe is kept as an alias for older callers (same number as a11yScans)
    if (!Array.isArray(actions)) return {a11yScans: 0, screenshots: 0, evidence: 0, totalArtifacts: 0, axe: 0};

    const add = (a, b) => ({
        a11yScans: a.a11yScans + b.a11yScans,
        screenshots: a.screenshots + b.screenshots,
        evidence: a.evidence + (b.evidence || 0)
    });
    const mul = (a, n) => ({
        a11yScans: a.a11yScans * n,
        screenshots: a.screenshots * n,
        evidence: (a.evidence || 0) * n
    });

    const customSteps = normalizeCustomStepsById(customStepsRaw);
    const countList = (list, recursionStack = []) => {
        return list.reduce((acc, action) => {
            if (!action || typeof action !== 'object') return acc;
            if (isDisabled(action)) return acc;

            const t = action.type;

            if (t === 'a11yScan') return add(acc, {a11yScans: 1, screenshots: 0});
            if (t === 'screenshot') return add(acc, {a11yScans: 0, screenshots: 1});

            if (t === 'evidenceCapture') {
                const variants = normalizeEvidenceVariants(action?.variants);
                const n = (variants === 'both') ? 2 : 1;
                return add(acc, {a11yScans: 0, screenshots: 0, evidence: n});
            }

            if (t === 'group') {
                const inner = countList(Array.isArray(action.actions) ? action.actions : [], recursionStack);
                return add(acc, inner);
            }

            if (t === 'repeat') {
                const raw =
                    (typeof action.itemsText === 'string') ? action.itemsText :
                        (typeof action.items === 'string') ? action.items :
                            (typeof action.datasetText === 'string') ? action.datasetText :
                                (typeof action.dataset === 'string') ? action.dataset :
                                    '';

                const itemsCount = isNonEmptyString(raw)
                    ? parseRepeatItemsText(raw).length
                    : 0;

                // A count held in a variable is only known at runtime: estimate one pass.
                const plannedCount = (v) => {
                    if (hasVarToken(v)) return 1;
                    const parsed = parseNumberStrict(v, {integer: true});
                    return (parsed.ok && parsed.value > 0) ? parsed.value : 0;
                };
                const timesFromTimes = (Number.isFinite(action.times) && action.times > 0) ? action.times : 0;
                const timesFromReps = plannedCount(action.repetitions);
                const timesFromItems = itemsCount;

                // Precedence matches the real "repeat" action's runtime behavior: itemsText (when
                // present) always wins, then times, then repetitions - see the "repeat" case below.
                const reps = timesFromItems || timesFromTimes || timesFromReps;

                if (!reps) return acc;
                const inner = countList(Array.isArray(action.actions) ? action.actions : [], recursionStack);
                return add(acc, mul(inner, reps));
            }

            if (t === 'switch') {
                const branches = (Array.isArray(action.cases) ? action.cases : [])
                    .filter((c) => c && !isDisabled(c))
                    .map((c) => countList(Array.isArray(c.actions) ? c.actions : [], recursionStack))
                    .concat([countList(Array.isArray(action.defaultActions) ? action.defaultActions : [], recursionStack)]);
                return add(acc, branches.reduce((w, b) => ({
                    a11yScans: Math.max(w.a11yScans, b.a11yScans),
                    screenshots: Math.max(w.screenshots, b.screenshots),
                    evidence: Math.max(w.evidence || 0, b.evidence || 0)
                })));
            }

            if (t === 'if' || t === 'ifUrl') {
                const thenCnt = countList(Array.isArray(action.actions) ? action.actions : [], recursionStack);
                const elseCnt = countList(Array.isArray(action.elseActions) ? action.elseActions : [], recursionStack);
                const worst = (a, b) => ({
                    a11yScans: Math.max(a.a11yScans, b.a11yScans),
                    screenshots: Math.max(a.screenshots, b.screenshots),
                    evidence: Math.max(a.evidence || 0, b.evidence || 0)
                });
                return add(acc, worst(thenCnt, elseCnt));
            }

            if (t === 'forEachElement') {
                const pre = countList(Array.isArray(action.preActions) ? action.preActions : [], recursionStack);
                const inner = countList(Array.isArray(action.actions) ? action.actions : [], recursionStack);
                const inside = add(pre, inner);
                const limit = (Number.isFinite(action.limit) && action.limit > 0) ? action.limit : 2;
                return add(acc, mul(inside, limit));
            }

            if (t === 'runCustomStep') {
                const customStepId = String(action.customStepId || action.id || '').trim();
                const customStep = customSteps[customStepId];
                if (!customStep || !Array.isArray(customStep.actions) || !customStep.actions.length) return acc;
                if (recursionStack.includes(customStepId)) return acc;
                const inner = countList(customStep.actions, recursionStack.concat([customStepId]));
                return add(acc, inner);
            }

            if (Array.isArray(action.actions)) {
                const inner = countList(action.actions, recursionStack);
                return add(acc, inner);
            }

            return acc;
        }, {a11yScans: 0, screenshots: 0, evidence: 0});
    };

    const {a11yScans, screenshots, evidence} = countList(actions);
    return {
        a11yScans,
        screenshots,
        evidence,
        totalArtifacts: a11yScans + screenshots + evidence,
        axe: a11yScans
    };
}


/** ------------------------------ context --------------------------------- */
/**
 * A step's scan tags with their tokens filled in ({var:...}, {index}, ...),
 * trimmed and without repeats; null when none is left. Takes a list or a
 * comma-separated string.
 */
function interpolateScanTags(raw, {localVars, ctx} = {}) {
    if (!Array.isArray(raw) && !isNonEmptyString(raw)) return null;
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const seen = new Set();
    const out = [];
    for (const tag of list) {
        if (!isNonEmptyString(tag)) continue;
        const value = interpolateVarTokensLoose(String(tag).trim(), {localVars, ctx}).trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out.length ? out : null;
}

function createChildContext(parentCtx) {
    // Child context shares logs/results arrays with parent, but has isolated var scopes.
    const parentVarsFlat = (parentCtx && typeof parentCtx.getVarsFlat === 'function')
        ? parentCtx.getVarsFlat()
        : (parentCtx && parentCtx.vars ? {...(parentCtx.vars || {})} : {});

    const child = createWorkflowContext({
        // inherit most runtime config
        a11yConfig: parentCtx?.a11yConfig,
        heavyNodeThreshold: parentCtx?.heavyNodeThreshold,
        progress: parentCtx?.progress,
        isCancelled: parentCtx?.isCancelled,
        abortSignal: parentCtx?.abortSignal,
        vars: parentVarsFlat,
        viewport: parentCtx?.viewport,
        baseViewport: parentCtx?.baseViewport,
        viewportLogical: parentCtx?.viewportLogical,
        viewportZoom: parentCtx?.viewportZoom,
        customSteps: parentCtx?.customSteps
    });

    // share collections so output stays unified
    child.screenshots = parentCtx?.screenshots || child.screenshots;
    child.collectedScans = parentCtx?.collectedScans || child.collectedScans;
    child.collectedOutputs = parentCtx?.collectedOutputs || child.collectedOutputs;
    child.runLogs = parentCtx?.runLogs || child.runLogs;
    child.iterationFailures = parentCtx?.iterationFailures || child.iterationFailures;
    child.evidence = parentCtx?.evidence || child.evidence;
    child._visionDeficiency = parentCtx?._visionDeficiency ?? null;
    child._colorScheme = parentCtx?._colorScheme ?? null;
    child._forcedColors = parentCtx?._forcedColors ?? null;
    child._language = parentCtx?._language ?? null;
    // A worker's or custom step's scans still belong to the Merged scan it runs in.
    child._mergedScan = parentCtx?._mergedScan ?? null;
    // A dry run (run-workflow.js --dry-run) all the way down.
    child.dryRun = parentCtx?.dryRun === true;
    // Keep a stable reference to the root context (for late-bound helpers)
    child._rootCtx = parentCtx?._rootCtx || parentCtx || child._rootCtx || child;

    // inherit current log context (depth, actionPath) if present
    if (parentCtx?._logCtx) child._logCtx = parentCtx._logCtx;

    // inherit optional helpers used by a11yScan fast-path
    if (typeof parentCtx?.performA11yScan === 'function') child.performA11yScan = parentCtx.performA11yScan;

    // Inherit a11yScan handler for nested actions
    if (typeof parentCtx?.handleA11yScanAction === 'function') child.handleA11yScanAction = parentCtx.handleA11yScanAction;

    // The runner's set-up of a page before it loads (core's hooks).
    if (typeof parentCtx?.preparePage === 'function') child.preparePage = parentCtx.preparePage;

    // inherit cancel semantics (if overridden by runner/coordinator)
    if (typeof parentCtx?.checkCancel === 'function') child.checkCancel = parentCtx.checkCancel.bind(parentCtx);

    if (parentCtx?._partialOut) child._partialOut = parentCtx._partialOut;
    child._customStepStack = Array.isArray(parentCtx?._customStepStack)
        ? [...parentCtx._customStepStack]
        : [];

    // Backward/alternate naming, if you used it anywhere
    if (typeof parentCtx?._handleA11yScanAction === 'function' && typeof child.handleA11yScanAction !== 'function') {
        child.handleA11yScanAction = parentCtx._handleA11yScanAction;
    }

    // Ensure abort tracking is shared across parent + children
    if (parentCtx?._abortPages && child._abortPages !== parentCtx._abortPages) {
        child._abortPages = parentCtx._abortPages;
    }
    if (typeof parentCtx?.trackPage === 'function') child.trackPage = parentCtx.trackPage;
    if (typeof parentCtx?.untrackPage === 'function') child.untrackPage = parentCtx.untrackPage;

    // Share abort binding state too, so we don't register multiple global handlers
    child._abortBound = parentCtx?._abortBound ?? child._abortBound;

    // inherit runner-provided writers (workflow-engine must not write to disk directly)
    if (typeof parentCtx?.saveEvidenceFile === 'function') child.saveEvidenceFile = parentCtx.saveEvidenceFile;
    if (typeof parentCtx?.saveScreenshotFile === 'function') child.saveScreenshotFile = parentCtx.saveScreenshotFile;

    return child;
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

// What the runner sets up on every page before it loads (ctx.preparePage:
// core's hooks), for a page the workflow opens itself. Never fails the step.
async function prepareWorkerPage(ctx, workerPage) {
    if (typeof ctx?.preparePage !== 'function') return;
    try {
        await ctx.preparePage(workerPage);
    } catch {
    }
}

/**
 * How many workers forEachElement or a crawl runs: a whole number within
 * forEachElement's Concurrency field (1 to 8). Each worker is a page of its
 * own; 500 asked for opened 500.
 */
function clampConcurrency(value) {
    const {min, max} = ACTION_DEFINITIONS.forEachElement.fields.concurrency;
    return Math.min(max, Math.max(min, Math.floor(toNumber(value, 1)) || 1));
}

/** A new page in the context, in a window of its own where the browser can open one. */
async function newVisiblePage(context) {
    try {
        return await context.newPage({ type: 'window' });
    } catch {
        return context.newPage();
    }
}

async function createCrawlWorkerTarget(page, ctx, {isolation, inheritViewport} = {}) {
    const iso = (isolation === 'context') ? 'context' : 'page';
    const baseViewport = inheritViewport ? page.viewport?.() : null;

    if (iso === 'context') {
        const browser = page.browser();
        const workerContext = await browser.createBrowserContext();
        const workerPage = await workerContext.newPage();
        await prepareWorkerPage(ctx, workerPage);

        if (ctx?._visionDeficiency) {
            await workerPage.emulateVisionDeficiency(ctx._visionDeficiency).catch(() => {
            });
        }
        await applyMediaConditions(workerPage, ctx);
        await applyLanguage(workerPage, ctx);
        if (baseViewport?.width && baseViewport?.height) {
            await workerPage.setViewport(baseViewport).catch(() => {
            });
        }
        return {workerPage, workerContext, isolation: 'context'};
    }

    // In a window of its own, not a tab beside the run's: a background tab is
    // hidden, and Chrome runs no animation frame, mouse event or screenshot in
    // it, so every scan on it waited out its stage limit.
    const workerPage = await newVisiblePage(page.browserContext());
    await prepareWorkerPage(ctx, workerPage);
    if (ctx?._visionDeficiency) {
        await workerPage.emulateVisionDeficiency(ctx._visionDeficiency).catch(() => {
        });
    }
    await applyMediaConditions(workerPage, ctx);
    await applyLanguage(workerPage, ctx);
    if (baseViewport?.width && baseViewport?.height) {
        await workerPage.setViewport(baseViewport).catch(() => {
        });
    }
    return {workerPage, workerContext: null, isolation: 'page'};
}


/**
 * forEachElement concurrency helpers
 * - Build a stable ordered plan (main page only)
 * - Resolve the corresponding element on each worker page
 * - Run one iteration using the same semantics as sequential mode
 */

async function _forEachGetKey(handle, dedupeBy) {
    try {
        if (dedupeBy === 'text') {
            return await handle.evaluate(el => (el.textContent || '').replace(/\s+/g, ' ').trim());
        }
        return await handle.evaluate(el => {
            const href = (el.getAttribute && el.getAttribute('href')) || el.href || '';
            const hrefText = String(href || '').trim();
            if (hrefText) return hrefText;
            // Fallback for non-link targets (e.g. menu options in SPAs) so
            // dedupe remains stable even when href is absent.
            return (el.textContent || '').replace(/\s+/g, ' ').trim();
        });
    } catch {
        return '';
    }
}

async function _isVisible(handle, opts = {}) {
    const {
        requireInViewport = true,
        viewportPadding = 0 // allow a small margin, e.g. 8 or 16
    } = opts;

    try {
        return await handle.evaluate((el, {requireInViewport, viewportPadding}) => {
            if (!el) return false;

            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;

            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;

            if (!requireInViewport) return true;

            // Viewport intersection (with optional padding)
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;

            const pad = Math.max(0, Number(viewportPadding) || 0);

            return (r.bottom > -pad) &&
                (r.right > -pad) &&
                (r.top < vh + pad) &&
                (r.left < vw + pad);
        }, {requireInViewport, viewportPadding});
    } catch {
        return false;
    }
}

async function buildForEachElementPlan(page, sel, {reverse, limit, dedupeBy, timeout, onlyVisible}) {
    const handles = await page.$$(sel);
    if (!handles.length) return [];

    const ordered = reverse ? handles.slice().reverse() : handles;
    const plan = [];
    const visited = new Set();

    try {
        for (let i = 0; i < ordered.length; i++) {
            if (limit && plan.length >= limit) break;

            const h = ordered[i];

            if (onlyVisible) {
                const visible = await _isVisible(h);
                if (!visible) continue;
            }

            const key = await _forEachGetKey(h, dedupeBy);


            if (key) {
                if (visited.has(key)) continue;
                visited.add(key);
            }

            // Store a fallback index for when key is empty or unstable.
            plan.push({index: i, key: key || ''});
        }
    } finally {
        for (const h of handles) {
            try {
                await h.dispose();
            } catch {
            }
        }
    }

    return plan;
}

async function _forEachFindHandleForPlanItem(page, sel, planItem, { reverse, dedupeBy, onlyVisible }) {
    let handles = await page.$$(sel);
    if (!handles.length) return null;

    // IMPORTANT:
    // The plan indices are already based on the order used in buildForEachElementPlan.
    // Do NOT reverse here, or you will reverse twice.
    // Keep "reverse" in the signature for API compatibility, but ignore it.

    let chosen = null;

    try {
        // 1) Prefer stable key match when available
        if (planItem && planItem.key) {
            for (const h of handles) {
                if (onlyVisible) {
                    const visible = await _isVisible(h);
                    if (!visible) continue;
                }

                const key = await _forEachGetKey(h, dedupeBy);
                if (key && key === planItem.key) {
                    chosen = h;
                    break;
                }
            }
        }

        // 2) Fallback: resolve by index, but if onlyVisible, index must be among visible elements
        if (!chosen) {
            if (onlyVisible) {
                let visibleIndex = -1;
                for (const h of handles) {
                    const visible = await _isVisible(h);
                    if (!visible) continue;
                    visibleIndex += 1;
                    if (visibleIndex === planItem.index) {
                        chosen = h;
                        break;
                    }
                }
            } else {
                chosen = handles[planItem.index] || null;
            }
        }

        // Dispose all non-chosen handles to avoid leaks
        for (const h of handles) {
            if (chosen && h === chosen) continue;
            try { await h.dispose(); } catch {}
        }

        return chosen;
    } catch {
        for (const h of handles) {
            try { await h.dispose(); } catch {}
        }
        return null;
    }
}

async function runForEachElementIterationOnPage({
                                                    page,
                                                    ctx,
                                                    action,
                                                    candidateHandle,
                                                    iterationIndex,
                                                    iterationTotal,
                                                    timeout,
                                                    depth,
                                                    actionPathPrefix
                                                }) {
    const nested = Array.isArray(action.actions) ? action.actions : [];

    const waitForSelectorSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    const waitVisible = action.waitVisible !== false; // default true
    const waitTimeout = toNumber(action.waitTimeout, timeout);

    const {scopeId, scopeSel} = await setScopeAttr(page, candidateHandle);

    // Deterministic ordering metadata for scans/screenshots within this iteration
    const _prevIterationIndex = ctx._iterationIndex;
    const _prevScanCounter = ctx._scanCounter;
    const _prevArtifactCounter = ctx._artifactCounter;
    const _prevScanStride = ctx._scanStride;

    ctx._iterationIndex = iterationIndex;
    ctx._scanCounter = 0;
    ctx._artifactCounter = 0;
    // scanStride is only meaningful in crawlQueue, reset it for forEachElement iterations
    ctx._scanStride = null;


    const loopVars = Object.create(null);
    const nestedFiltered = nested.filter(s => !isDisabled(s));
    const prepared = nestedFiltered.map(s => rewriteSelectorsWithCtx(s, scopeSel));

    const previousIter = ctx._iterVars;
    ctx._iterVars = {index: iterationIndex, total: iterationTotal};

    ctx.pushVarScope({
        index: iterationIndex,
        oneBased: iterationIndex + 1,
        total: iterationTotal
    });

    const actionPrefix = formatActionPrefix(actionPathPrefix);
    pushLog(ctx, 'info', `${actionPrefix}forEachElement item ${iterationIndex + 1}/${iterationTotal ?? '?'}`, {
        depth,
        actionPath: actionPrefix.trim().replace(/^Action\s+/, ''),
        stepEvent: 'loop-iteration',
        loopType: 'forEachElement',
        index: iterationIndex,
        total: (iterationTotal == null ? null : iterationTotal)
    });

    const preActions = Array.isArray(action.preActions) ? action.preActions.filter(s => !isDisabled(s)) : null;
    const preparedPre = preActions ? preActions.map(s => rewriteSelectorsWithCtx(s, scopeSel)) : null;

    let loopHomeUrl = null;

    // Candidate wrapper to preserve existing semantics (candidate.h usage)
    const candidate = {h: candidateHandle};

    try {
        if (preparedPre && preparedPre.length) {
            try {
                await applyActions(page, preparedPre, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
            } catch (err) {
                if (err && err._wfSkipIteration) {
                    await clearScopeAttr(page, scopeId);
                    pushLog(ctx, 'info', `Iteration skipped (preActions) (${iterationIndex + 1}/${iterationTotal ?? '?'})`);
                    await postStepDelay(ctx);
                    return {skipped: true};
                }
                throw err;
            }
        }

        const navMode = action.navigateBy === 'click' ? 'click' : 'none';
        const clickWithin = isNonEmptyString(action.clickWithin) ? action.clickWithin.trim() : null;
        const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');

        // IMPORTANT: keep navigation timeouts separate from action timeout.
        const navTimeout = toNumber(action.timeout, 60000);
        const restoreTimeout = toNumber(action.restoreTimeout, navTimeout); // optional config field
        const shouldGoBack = action.goBack !== false;

        try {
            loopHomeUrl = await page.url();
        } catch {
        }

        if (waitForSelectorSel) {
            try {
                await waitForSel(page, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout});
            } catch {
            }
        }

        let navigated = false;

        try {
            if (navMode === 'click') {
                const startUrl = safePageUrl(page);

                let fallbackHref = '';

                // An item that navigates is waited for to its load; one whose
                // click starts no navigation is known after a second, rather
                // than after the whole navigation timeout, and falls back below.
                const didNavigate = await waitForPossibleNavigation(page, startUrl, {
                    waitUntil,
                    timeout: navTimeout,
                    trigger: async () => {
                        try {
                            await candidate.h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'center'}));
                        } catch {
                        }

                        try {
                            fallbackHref = await candidate.h.evaluate(el => (el.getAttribute && el.getAttribute('href')) || el.href || '');
                        } catch {
                        }

                        if (clickWithin) {
                            const targetSel = clickWithin.split(':ctx').join(scopeSel);
                            await waitForSel(page, targetSel, {visible: true, timeout});
                            await page.$eval(targetSel, el => el.click()).catch(() => {
                            });
                        } else {
                            await candidate.h.evaluate(el => el.click()).catch(() => {
                            });
                        }
                    }
                });

                await waitForRenderSettle(page, 2000);

                try {
                    await candidate.h.dispose();
                } catch {
                }
                candidate.h = null;

                navigated = !!didNavigate;

                if (navigated) {
                    pushLog(ctx, 'info', 'Navigated into item');
                    try {
                        pushLog(ctx, 'info', `URL loaded: ${await page.url()}`);
                    } catch {
                    }
                } else {
                    const href = String(fallbackHref || '').trim();
                    const isNavHref = href
                        && !href.startsWith('#')
                        && !href.toLowerCase().startsWith('javascript:');

                    if (isNavHref) {
                        pushLog(ctx, 'info', `No navigation detected, falling back to goto(${href})`);
                        try {
                            await page.goto(href, {waitUntil, timeout: navTimeout});
                            navigated = true;
                        } catch (e) {
                            pushLog(ctx, 'warning', `Fallback goto failed: ${String(e && e.message || e)}`);
                        }
                    }
                    pushLog(ctx, 'warning', 'Click did not trigger navigation, continuing in-place');
                }
            }

            if (waitForSelectorSel) {
                try {
                    await waitForSel(page, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout});
                } catch {
                }
            }

            try {
                await applyActions(page, prepared, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
            } catch (err) {
                if (err && err._wfSkipIteration) {
                    if (navigated && navMode === 'click' && shouldGoBack) {
                        try {
                            const backQuickTimeout = Math.min(navTimeout, toNumber(action.backTimeout, 8000));
                            const beforeBackUrl = safePageUrl(page);

                            const backWatch = startPossibleNavigationWatch(page, beforeBackUrl, {
                                waitUntil,
                                timeout: backQuickTimeout
                            });

                            await page.goBack({waitUntil, timeout: backQuickTimeout}).catch(() => {});
                            await backWatch.catch(() => {});
                            await waitForRenderSettle(page, 1500);
                        } catch {
                        }

                        // restore if about:blank
                        try {
                            const urlNow = safePageUrl(page);
                            if (urlNow === 'about:blank' && loopHomeUrl) {
                                await page.goto(loopHomeUrl, {waitUntil, timeout: restoreTimeout}).catch(() => {});
                                await waitForRenderSettle(page, 1500);
                            }
                        } catch {
                        }
                    }
                    await clearScopeAttr(page, scopeId);
                    pushLog(ctx, 'info', `Iteration skipped (actions) (${iterationIndex + 1}/${iterationTotal ?? '?'})`);
                    await postStepDelay(ctx);
                    return {skipped: true};
                }
                throw err;
            }
        } finally {
        }

        if (navigated && navMode === 'click' && shouldGoBack) {
            try {
                const backQuickTimeout = Math.min(navTimeout, toNumber(action.backTimeout, 8000));
                const beforeBackUrl = safePageUrl(page);

                const backWatch = startPossibleNavigationWatch(page, beforeBackUrl, {
                    waitUntil,
                    timeout: backQuickTimeout
                });

                await page.goBack({waitUntil, timeout: backQuickTimeout}).catch(() => {});
                await backWatch.catch(() => {});
                await waitForRenderSettle(page, 1500);
            } catch {
            }

            // If goBack lands on about:blank, restore the home URL
            try {
                const urlNow = safePageUrl(page);
                if (urlNow === 'about:blank' && loopHomeUrl) {
                    await page.goto(loopHomeUrl, {waitUntil, timeout: restoreTimeout}).catch(() => {});
                    await waitForRenderSettle(page, 1500);
                }
            } catch {
            }
        }

        await clearScopeAttr(page, scopeId);
        await postStepDelay(ctx);

        return {skipped: false};
    } catch (err) {
        // Ensure scope is cleared even on failure
        try {
            await clearScopeAttr(page, scopeId);
        } catch {
        }
        throw err;
    } finally {
        try {
            if (candidate && candidate.h) await candidate.h.dispose();
        } catch {
        }
        if (candidate) candidate.h = null;

        // always restore per-iteration scope
        try {
            ctx._iterVars = previousIter;
        } catch {
        }

        // restore ordering metadata
        ctx._iterationIndex = _prevIterationIndex;
        ctx._scanCounter = _prevScanCounter;
        ctx._artifactCounter = _prevArtifactCounter;
        ctx._scanStride = _prevScanStride;

        try {
            ctx.popVarScope?.();
        } catch {
        }
    }
}

async function runForEachElementConcurrent({
                                               action,
                                               parentCtx,
                                               mainPage,
                                               sel,
                                               plan,
                                               concurrency,
                                               isolation,
                                               closeWorkerPages,
                                               maxSeconds,
                                               perPageDelayMs,
                                               timeout,
                                               depth,
                                               actionPathPrefix
                                           }) {
    const startMs = Date.now();

    const homeUrl = safePageUrl(mainPage);
    if (!homeUrl) {
        throw new Error('forEachElement: mainPage has no URL (cannot seed workers).');
    }

    const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');
    const navTimeout = toNumber(action.timeout, 60000);

    const waitForSelectorSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    const waitVisible = action.waitVisible !== false; // default true
    const waitTimeout = toNumber(action.waitTimeout, timeout);

    const iterSetupActions = Array.isArray(action.iterSetupActions)
        ? action.iterSetupActions.filter(s => !isDisabled(s))
        : null;

    // No more workers than items: each one opens a page and loads the list
    // first, so a concurrency of 500 over 20 links opened 500 pages (330 s).
    const workerCount = Math.max(1, Math.min(concurrency, plan.length));
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        const {workerPage, workerContext} = await createCrawlWorkerTarget(mainPage, parentCtx, {
            isolation,
            inheritViewport: true
        });

        const workerCtx = createChildContext(parentCtx);
        workerCtx.bindAbortToPage?.(workerPage);

        // Ensure worker is on the same page as the main thread before doing anything else
        await runActionAction(workerPage, {
            type: 'navigate',
            url: homeUrl,
            waitUntil,
            timeout: navTimeout
        }, workerCtx, null, depth + 1, actionPathPrefix);

        // Optional readiness selector (if configured on the action)
        if (waitForSelectorSel) {
            await workerCtx.race(
                waitForSel(workerPage, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout}),
                `forEachElement worker waitForSel ${waitForSelectorSel}`
            ).catch(() => {});
        }

        // Always ensure the target list exists before building/resolving plan items
        await workerCtx.race(
            waitForSel(workerPage, sel, {visible: false, timeout: waitTimeout}),
            `forEachElement worker waitForSel target ${sel}`
        ).catch(() => {});

        workers.push({page: workerPage, ctx: workerCtx, browserContext: workerContext});
    }

    const total = plan.length;
    let nextJob = 0;

    const continueOnIterationError = action.continueOnIterationError === true;
    const maxIterationErrors = Number.isFinite(action.maxIterationErrors) ? action.maxIterationErrors : Infinity;
    let iterationErrors = 0;

    async function runWorkerLoop(w) {
        while (true) {
            const myIndex = nextJob++;
            if (myIndex >= total) return;

            if (maxSeconds != null) {
                const elapsedSec = (Date.now() - startMs) / 1000;
                if (elapsedSec > maxSeconds) {
                    throw new Error("forEachElement: maxSeconds exceeded.");
                }
            }

            const planItem = plan[myIndex];

            // Ensure we are back on the list page before resolving the next element
            const current = safePageUrl(w.page);
            if (!current || current !== homeUrl) {
                await runActionAction(w.page, {
                    type: 'navigate',
                    url: homeUrl,
                    waitUntil,
                    timeout: navTimeout
                }, w.ctx, null, depth + 1, actionPathPrefix);

                if (waitForSelectorSel) {
                    await w.ctx.race(
                        waitForSel(w.page, waitForSelectorSel, {visible: waitVisible, timeout: waitTimeout}),
                        `forEachElement worker waitForSel ${waitForSelectorSel}`
                    ).catch(() => {});
                }

                await w.ctx.race(
                    waitForSel(w.page, sel, {visible: false, timeout: waitTimeout}),
                    `forEachElement worker waitForSel target ${sel}`
                ).catch(() => {});
            }

            // Iteration setup actions (match sequential semantics, run before selecting the element)
            if (iterSetupActions && iterSetupActions.length) {
                try {
                    await applyActions(w.page, iterSetupActions, null, 0, w.ctx, Object.create(null), depth + 1, actionPathPrefix);
                } catch (err) {
                    if (err && err._wfSkipIteration) {
                        pushLog(parentCtx, 'info', `Iteration skipped (iterSetupActions) (${myIndex + 1}/${total})`, {depth});
                        await postStepDelay(parentCtx);
                        continue;
                    }
                    throw err;
                }
            }

            let h = null;
            try {
                h = await _forEachFindHandleForPlanItem(w.page, sel, planItem, {
                    reverse: action.reverse === true,
                    dedupeBy: (action.dedupeBy === 'text') ? 'text' : 'href',
                    onlyVisible: action.onlyVisible === true
                });

                if (!h) {
                    throw new Error("forEachElement: could not resolve element on worker page.");
                }

                await runForEachElementIterationOnPage({
                    page: w.page,
                    ctx: w.ctx,
                    action,
                    candidateHandle: h,
                    iterationIndex: myIndex,
                    iterationTotal: total,
                    timeout,
                    depth,
                    actionPathPrefix
                });

                if (perPageDelayMs) {
                    await sleep(perPageDelayMs);
                }
            } catch (err) {
                iterationErrors += 1;

                const msg = String(err && err.message ? err.message : err);

                recordIterationFailure(parentCtx, {
                    iteratorType: 'forEachElement',
                    iteratorLabel: action.label || null,
                    iterationIndex: myIndex,
                    iterationOneBased: myIndex + 1,
                    iterationTotal: total,
                    error: msg,
                    url: safePageUrl(w.page) || null
                });

                pushLog(parentCtx, 'error', `forEachElement iteration ${myIndex + 1}/${total} failed${continueOnIterationError ? ", continuing" : ""}: ${msg}`, {depth});

                try {
                    if (h) await h.dispose();
                } catch {
                }

                if (!continueOnIterationError) throw err;
                if (iterationErrors >= maxIterationErrors) {
                    throw new Error(`forEachElement stopped after ${iterationErrors} iteration errors`);
                }
            } finally {
                try {
                    if (h) await h.dispose();
                } catch {
                }
            }
        }
    }

    try {
        await Promise.all(workers.map(runWorkerLoop));
    } finally {
        if (closeWorkerPages) {
            for (const w of workers) {
                try {
                    await w.page.close();
                } catch {
                }
                if (w.browserContext) {
                    try {
                        await w.browserContext.close();
                    } catch {
                    }
                }
            }
        }
    }
}

function createWorkflowContext(ctxParams = {}) {
    const normalizedCustomSteps = normalizeCustomStepsById(ctxParams.customSteps);
    const base = Object.assign({}, ctxParams, {
        screenshots: [],
        evidence: [],
        collectedScans: [],
        collectedOutputs: [],
        runLogs: [],
        iterationFailures: [],
        customSteps: normalizedCustomSteps,
        _customStepStack: [],
        progress: ctxParams.progress,
        isCancelled: typeof ctxParams.isCancelled === 'function' ? ctxParams.isCancelled : null,
        checkCancel(where = '') {
            if (base.isCancelled && base.isCancelled()) {
                const err = new Error('_WF_CANCELLED_');
                err._wfCancelled = true;
                err._wfWhere = where;
                if (base._partialOut) err._wfPartialOut = base._partialOut;
                throw err;
            }
        },
        // Optional AbortSignal support for hard cancellation.
        abortSignal: ctxParams && ctxParams.abortSignal ? ctxParams.abortSignal : null,
        _abortBound: false,
        _abortPages: new Set(),

        trackPage(page) {
            try {
                if (page) base._abortPages.add(page);
            } catch {
            }
        },
        untrackPage(page) {
            try {
                if (page) base._abortPages.delete(page);
            } catch {
            }
        },

        race(promise, label = 'operation') {
            if (!base.abortSignal) return promise;

            if (base.abortSignal.aborted) {
                const err = new Error('_WF_CANCELLED_');
                err._wfCancelled = true;
                err._wfWhere = label;
                if (base._partialOut) err._wfPartialOut = base._partialOut;
                throw err;
            }

            let onAbort = null;

            const abortPromise = new Promise((_, reject) => {
                onAbort = () => {
                    const err = new Error('_WF_CANCELLED_');
                    err._wfCancelled = true;
                    err._wfWhere = label;
                    if (base._partialOut) err._wfPartialOut = base._partialOut;
                    reject(err);
                };
                base.abortSignal.addEventListener('abort', onAbort, {once: true});
            });

            return Promise.race([promise, abortPromise]).finally(() => {
                try {
                    if (onAbort) base.abortSignal.removeEventListener('abort', onAbort);
                } catch {
                }
            });
        },

        bindAbortToPage(page) {
            if (!base.abortSignal) return;

            // track every page that uses this ctx
            base.trackPage(page);

            if (base._abortBound) return;
            base._abortBound = true;

            base.abortSignal.addEventListener('abort', async () => {
                // Close everything we know about
                const pages = Array.from(base._abortPages || []);
                for (const p of pages) {
                    try {
                        await stopLoading(p);
                    } catch {
                    }
                    try {
                        await p.close();
                    } catch {
                    }
                }
            }, {once: true});
        }
    });

    const varApi = createVarScopes(ctxParams && ctxParams.vars ? ctxParams.vars : {});
    base.pushVarScope = varApi.pushVarScope;
    base.popVarScope = varApi.popVarScope;
    base.setVar = varApi.setVar;
    base.clearVar = varApi.clearVar;
    base.getVar = varApi.getVar;
    base.getVarsFlat = varApi.getVarsFlat;
    base.vars = varApi.makeVarsProxy();

    // root ctx tracking (helps child contexts access late-bound helpers)
    base._rootCtx = (ctxParams && ctxParams._rootCtx) ? ctxParams._rootCtx : base;

    // Normalize injected a11yScan handler onto ctx
    base.handleA11yScanAction =
        (typeof base.handleA11yScanAction === 'function')
            ? base.handleA11yScanAction
            : (typeof ctxParams?.handleA11yScanAction === 'function')
                ? ctxParams.handleA11yScanAction
                : (typeof ctxParams?._handleA11yScanAction === 'function')
                    ? ctxParams._handleA11yScanAction
                    : null;

    return base;
}

// Resolves a single element by its visible text via the shared deep-text resolver
// (the same one clickByText/hoverByText/focusByText use). Backs click's labelText targeting.
async function findOneByTextDeepHandle(page, {
    containerSel,
    needle,
    exact,
    caseSensitive,
    timeoutMs,
    allowPointerFallback,
    pointerFallbackMaxMatches
}, ctx) {
    return resolveByTextDeepHandle(page, {
        containerSel,
        needle,
        exact,
        caseSensitive,
        timeoutMs,
        allowPointerFallback,
        pointerFallbackMaxMatches
    }, ctx, needle);
}

async function runEvidenceCaptureShared({
                                            page,
                                            ctx,
                                            localVars,
                                            action,
                                            nameTemplateOverride = null,   // if provided, used for resolvedName
                                            labelOverride = undefined      // if provided, used for label (can be null)
                                        }) {
    const variants = normalizeEvidenceVariants(action?.evidenceVariant);
    const onError = (action && action.onError === 'fail') ? 'fail' : 'continue';
    const preserveHover = toBool(action && action.preserveHover);

    // Ensure persisted emulation is active for evidence capture (PNG screenshot + MHTML snapshot).
    // This keeps behavior consistent with screenshot/a11yScan after emulateVisionDeficiency.
    if (ctx?._visionDeficiency) {
        try {
            await page.emulateVisionDeficiency(ctx._visionDeficiency);
            // give it a frame to apply
            await waitForRenderSettle(page, 150);
            try {
                await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            } catch {}
        } catch (e) {
            // evidence capture should not become flaky if emulation fails
            pushLog(ctx, 'warning', `evidenceCapture: failed to apply vision deficiency (${ctx._visionDeficiency}): ${String(e?.message || e)}`);
        }
    }

    // Runner must provide a writer, workflow-engine should not touch REPORTS_ROOT directly.
    const saveEvidenceFile =
        (ctx && typeof ctx.saveEvidenceFile === 'function')
            ? ctx.saveEvidenceFile
            : (ctx && ctx._rootCtx && typeof ctx._rootCtx.saveEvidenceFile === 'function')
                ? ctx._rootCtx.saveEvidenceFile
                : null;

    if (!saveEvidenceFile) {
        throw new Error('evidenceCapture requires ctx.saveEvidenceFile({ variant, data, filename, dir, url, meta })');
    }

    const dir = isNonEmptyString(action.dir)
        ? interpolateVarTokensLoose(action.dir.trim(), {localVars, ctx})
        : null;

    // label can be overridden by caller (a11yScan will do that)
    const label = (labelOverride !== undefined)
        ? labelOverride
        : (isNonEmptyString(action.label)
            ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
            : null);

    // The file is named after the step's label: `name` and `title`, which
    // older steps carried, are not declared and not read.
    const nameTemplate =
        isNonEmptyString(nameTemplateOverride) ? nameTemplateOverride :
            isNonEmptyString(action?.label) ? action.label :
                'Evidence';

    const resolvedName = safeFilenamePart(
        interpolateVarTokensLoose(String(nameTemplate), {localVars, ctx})
    ) || 'Evidence';

    // Optional readiness wait (same pattern as a11yScan)
    const wSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
    if (wSel) {
        const wVisible = action.waitVisible !== false;
        const wTimeout = toNumber(action.waitTimeout, toNumber(action.timeout, 15000));
        const __h = await ctx.race(
            waitForOneDeep(page, wSel, {visible: wVisible, timeout: wTimeout}),
            `evidenceCapture waitForSel ${wSel}`
        ).catch(() => null);
        try { if (__h) await __h.dispose(); } catch {}
    }

    if (!preserveHover) await clearHoverStateForCapture(page);
    await waitForRenderSettle(page, 300);
    await safeDoubleRAF(page, 500);

    let currentUrl = null;
    try {
        currentUrl = await ctx.race(page.url(), 'evidenceCapture page.url');
    } catch {}

    // ordering metadata, reuse the same artifact counter concept as screenshot/a11yScan
    if (typeof ctx._artifactCounter !== 'number') ctx._artifactCounter = 0;
    const _iterIdx =
        (typeof ctx._iterationIndex === 'number')
            ? ctx._iterationIndex
            : (ctx && ctx._iterVars && typeof ctx._iterVars.index === 'number')
                ? ctx._iterVars.index
                : null;

    // capture environment once (useful to reproduce evidence conditions)
    let env = {
        viewportWidth: null,
        viewportHeight: null,
        devicePixelRatio: null,
        userAgent: null
    };

    try {
        const v = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio || 1
        }));
        if (v && v.width && v.height) {
            env.viewportWidth = v.width;
            env.viewportHeight = v.height;
            env.devicePixelRatio = v.dpr;
        }
    } catch {}

    try {
        env.userAgent = await ctx.race(page.userAgent(), 'evidenceCapture page.userAgent');
    } catch {}

    let viewportRatio = null;
    if (env.viewportWidth && env.viewportHeight) {
        viewportRatio = env.viewportWidth / env.viewportHeight;
    }

    const fullPage = action.fullPage !== false; // default true
    const visionDeficiency = (ctx && ctx._visionDeficiency) ? ctx._visionDeficiency : null;

    const emitOne = async (variant) => {
        const _artifactIdx = ctx._artifactCounter++;
        const orderKey = `${_iterIdx !== null ? String(_iterIdx).padStart(6, '0') : 'main'}:${String(_artifactIdx).padStart(4, '0')}`;
        const scanId = (_iterIdx !== null)
            ? `ev-${_iterIdx + 1}-${_artifactIdx + 1}`
            : `ev-main-${_artifactIdx + 1}`;

        const ext = (variant === 'mhtml') ? 'mhtml' : 'png';
        const filename = `${resolvedName}__${scanId}.${ext}`;

        try {
            if (variant === 'png') {
                const shot = await captureScreenshotArtifact(page, {
                    strategy: 'chunked',
                    type: 'png',
                    maxChunkHeight: 15000,
                    overlap: 0
                });
                const buffer = shot.buffer;
                const bytes = shot.bytes;

                const saved = await saveEvidenceFile({
                    variant: 'png',
                    data: buffer,
                    filename,
                    dir,
                    url: currentUrl,
                    meta: {label, scanId, orderKey, iterationIndex: _iterIdx, artifactIndex: _artifactIdx, env, fullPage, visionDeficiency}
                });

                if (!Array.isArray(ctx.evidence)) ctx.evidence = [];
                ctx.evidence.push({
                    kind: 'evidence',
                    variant: 'png',
                    path: saved?.path ?? null,
                    publicUrl: saved?.publicUrl ?? null,
                    bytes: saved?.bytes ?? bytes,
                    url: currentUrl,
                    viewportRatio,
                    env,
                    fullPage,
                    visionDeficiency,
                    label,
                    name: resolvedName,
                    scanId,
                    orderKey,
                    iterationIndex: _iterIdx,
                    artifactIndex: _artifactIdx
                });

                pushLog(ctx, 'evidence', 'evidence saved (png)', {
                    variant: 'png',
                    path: saved?.path ?? null,
                    publicUrl: saved?.publicUrl ?? null,
                    bytes: saved?.bytes ?? bytes,
                    url: currentUrl,
                    viewportRatio,
                    env,
                    fullPage,
                    visionDeficiency,
                    label,
                    name: resolvedName,
                    scanId,
                    orderKey,
                    iterationIndex: _iterIdx,
                    artifactIndex: _artifactIdx
                });

                return;
            }

            // mhtml
            const session = await page.target().createCDPSession();
            let data = null;
            try {
                const res = await session.send('Page.captureSnapshot', {format: 'mhtml'});
                data = res && res.data ? String(res.data) : '';
            } finally {
                try { await session.detach(); } catch {}
            }

            const bytes = Buffer.byteLength(data || '', 'utf8');

            const saved = await saveEvidenceFile({
                variant: 'mhtml',
                data,
                filename,
                dir,
                url: currentUrl,
                meta: {label, scanId, orderKey, iterationIndex: _iterIdx, artifactIndex: _artifactIdx, env, fullPage, visionDeficiency}
            });

            if (!Array.isArray(ctx.evidence)) ctx.evidence = [];
            ctx.evidence.push({
                kind: 'evidence',
                variant: 'mhtml',
                path: saved?.path ?? null,
                publicUrl: saved?.publicUrl ?? null,
                bytes: saved?.bytes ?? bytes,
                url: currentUrl,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx
            });

            pushLog(ctx, 'evidence', 'evidence saved (mhtml)', {
                variant: 'mhtml',
                path: saved?.path ?? null,
                publicUrl: saved?.publicUrl ?? null,
                bytes: saved?.bytes ?? bytes,
                url: currentUrl,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx
            });
        } catch (e) {
            const errMsg = String(e?.message || e);

            // If strict, fail the workflow
            if (onError === 'fail') {
                throw e;
            }

            // Otherwise record an error artifact and continue
            if (!Array.isArray(ctx.evidence)) ctx.evidence = [];
            ctx.evidence.push({
                kind: 'evidence',
                variant,                 // 'png' or 'mhtml' requested
                path: null,
                bytes: null,
                url: currentUrl,
                viewportRatio: (variant === 'png') ? viewportRatio : undefined,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx,
                error: errMsg
            });

            pushLog(ctx, 'warning', `evidenceCapture: failed to save (${variant})`, {
                variant,
                filename,
                url: currentUrl,
                env,
                fullPage,
                visionDeficiency,
                label,
                name: resolvedName,
                scanId,
                orderKey,
                iterationIndex: _iterIdx,
                artifactIndex: _artifactIdx,
                error: errMsg
            });

            return;
        }
    };

    if (variants === 'both') {
        await emitOne('png');
        await emitOne('mhtml');
    } else {
        await emitOne(variants);
    }
}

/**
 * Shared predicate model used by `skipIteration` and `collectOutput`'s `when`.
 * `source` carries the top-level predicate fields (skipIteration itself, or a
 * `when` sub-object) plus a legacy `config` alias.
 */
function buildConditionConfig(source, ctx) {
    if (!source || typeof source !== 'object') return null;

    const legacyCfg = (source.config && typeof source.config === 'object') ? source.config : {};
    const cfg = {};
    const put = (k, v) => { if (v !== undefined) cfg[k] = v; };
    put('selector', source.selector);
    put('selectorTextEquals', source.selectorTextEquals);
    put('selectorTextContains', source.selectorTextContains);
    put('selectorAttr', source.selectorAttr);
    put('attrEquals', source.attrEquals);
    put('attrContains', source.attrContains);
    put('selectorExists', source.selectorExists);
    put('urlIncludes', source.urlIncludes);
    put('var', source.var);
    put('varEquals', source.varEquals);
    put('or', source.or);
    Object.assign(cfg, legacyCfg);

    // varEquals compares a workflow variable, which only exists in the Node
    // context, so resolve it here before handing cfg to page.evaluate.
    if (isNonEmptyString(cfg.var)) {
        cfg._varValue = ctx.getVar(cfg.var.trim());
    }

    return cfg;
}

/**
 * Variable comparisons are made as text: a value from a batch row or a JSON
 * dataset may be a number or a boolean, while the value typed into a step is
 * text, and "2310" should equal 2310. An unset variable equals nothing.
 */
function sameAsText(value, expected) {
    if (value === undefined || value === null) return false;
    return String(value) === String(expected);
}

async function evaluateConditionPredicate(page, ctx, source) {
    const cfg = buildConditionConfig(source, ctx);
    if (!cfg) return false;

    return ctx.race(
        page.evaluate((cfg2) => {
            if (!cfg2 || typeof cfg2 !== 'object') return false;

            const queryOneDeep = (root, selector) => {
                if (!root || !selector) return null;

                const stack = [];
                stack.push(document.documentElement || document.body);

                while (stack.length) {
                    const node = stack.pop();
                    if (!node) continue;

                    try {
                        if (node.matches && node.matches(selector)) return node;
                    } catch {
                    }

                    const kids = node.children;
                    if (kids && kids.length) {
                        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
                    }

                    const sr = node.shadowRoot;
                    if (sr) {
                        try {
                            const hit = sr.querySelector(selector);
                            if (hit) return hit;
                        } catch {
                        }
                        const srKids = sr.children;
                        if (srKids && srKids.length) {
                            for (let i = srKids.length - 1; i >= 0; i--) stack.push(srKids[i]);
                        }
                    }
                }

                return null;
            };

            const elMatchesNeedle = (el, needle, exact, caseSensitive) => {
                if (!el) return false;
                const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                const n = String(needle || '').replace(/\s+/g, ' ').trim();
                if (!n) return false;
                const a = caseSensitive ? raw : raw.toLowerCase();
                const b = caseSensitive ? n : n.toLowerCase();
                return exact ? a === b : a.includes(b);
            };

            const results = [];

            if (cfg2.selectorExists) {
                results.push(!!queryOneDeep(document, cfg2.selectorExists));
            }

            if (cfg2.selector) {
                // Each check set on the element is a condition of its own,
                // combined with the others as the step says (and, or or): text
                // equals, text contains, the attribute's value, the legacy
                // labelText. With none, the element being there is the condition.
                const el = queryOneDeep(document, cfg2.selector);
                const text = () => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                const checks = [];
                if (cfg2.selectorTextEquals != null) checks.push(() => text() === String(cfg2.selectorTextEquals).trim());
                if (cfg2.selectorTextContains != null) checks.push(() => text().includes(String(cfg2.selectorTextContains).trim()));
                if (cfg2.selectorAttr) {
                    const attr = () => el.getAttribute(cfg2.selectorAttr);
                    if (cfg2.attrEquals != null) checks.push(() => attr() === String(cfg2.attrEquals));
                    if (cfg2.attrContains != null) checks.push(() => { const v = attr(); return v != null && v.includes(String(cfg2.attrContains)); });
                    // An attribute with no value to compare is there or not.
                    if (cfg2.attrEquals == null && cfg2.attrContains == null) checks.push(() => attr() != null);
                }
                // Legacy alias, kept for backward compatibility.
                if (cfg2.labelText) checks.push(() => elMatchesNeedle(el, cfg2.labelText, !!cfg2.exact, !!cfg2.caseSensitive));
                if (!checks.length) checks.push(() => true);
                // No element: every check on it fails.
                for (const check of checks) results.push(el ? check() : false);
            }

            if (cfg2.urlIncludes) {
                results.push(String(location.href || '').includes(cfg2.urlIncludes));
            }

            if (cfg2.varEquals !== undefined && Object.prototype.hasOwnProperty.call(cfg2, '_varValue')) {
                // Compared as text, like the if step: a batch row's build 2310
                // (a number) must equal the "2310" typed into the step.
                const v = cfg2._varValue;
                results.push(v !== undefined && v !== null && String(v) === String(cfg2.varEquals));
            }

            if (!results.length) return false;
            return cfg2.or === true ? results.some(Boolean) : results.every(Boolean);
        }, cfg),
        'condition evaluate'
    );
}

/**
 * Runs the steps of the branch a branching step chose (if, ifUrl, switch),
 * numbered under `childPathPrefix`.
 */
async function runBranchActions(page, branchActions, ctx, localVars, depth, childPathPrefix) {
    if (!Array.isArray(branchActions) || !branchActions.length) return;
    const activeScopeSel = await resolveActiveScopeSelector(page);
    if (activeScopeSel) {
        branchActions = branchActions.map(s => rewriteCtxTokenShallow(s, activeScopeSel));
    }
    ctx.pushVarScope(); // isolate chosen branch
    // Same as group: the branch works on a copy of the caller's local vars,
    // so nothing it sets outlives the branching step, wherever it is nested.
    const branchLocalVars = Object.assign(Object.create(null), localVars || {});
    try {
        await applyActions(page, branchActions, null, 0, ctx, branchLocalVars, depth + 1, childPathPrefix);
    } finally {
        ctx.popVarScope();
    }
}

/**
 * Logs which branch a branching step took. Logged whether or not the chosen
 * branch has anything in it: an empty else is still a decision, and it is the
 * decision - not the work that follows - that tells a step counter the other
 * branches' cost will never be spent.
 */
function logBranchTaken(ctx, message, depth, actionPathPrefix, extra) {
    const prefix = formatActionPrefix(actionPathPrefix);
    pushLog(ctx, 'info', message, {
        depth,
        actionPath: prefix.trim().replace(/^Action\s+/, ''),
        stepEvent: 'branch',
        ...extra
    });
}

/**
 * Runs the branch a condition step chose (if, ifUrl): actions when the
 * condition held, elseActions otherwise.
 */
async function runConditionBranch(page, action, conditionOk, ctx, localVars, depth, actionPathPrefix) {
    logBranchTaken(ctx, `if branch: ${conditionOk ? 'true' : 'false'}`, depth, actionPathPrefix,
        {taken: conditionOk ? 'then' : 'else'});
    await runBranchActions(page, conditionOk ? action.actions : action.elseActions, ctx, localVars, depth, actionPathPrefix);
}

/** ------------------------------- runner --------------------------------- */
async function runActionAction(page, action, ctx, localVars = null, depth = 0, actionPathPrefix = null) {
    if (!action || !action.type) return;

    // Global guard: disabled actions do nothing, including containers like group, if, repeat, forEachElement, a11yScan.
    if (isDisabled(action)) {
        pushLog(ctx, 'info', `action "${action.type}" is disabled, skipped`, {depth});
        return;
    }

    const selector = action.selector;
    const timeout = toNumber(action.timeout, 10000);

    switch (action.type) {

        case 'click': {
            const selector = isNonEmptyString(action.selector) ? action.selector.trim() : null;

            const needle = isNonEmptyString(action.labelText)
                ? interpolateVarTokensLoose(action.labelText.trim(), { localVars, ctx })
                : '';

            const exact = !!action.exact;
            const caseSensitive = !!action.caseSensitive;

            const retries = Math.max(0, toNumber(action.retries, 0));
            const retryDelay = Math.max(0, toNumber(action.retryDelay, 500));
            const waitUntil = action.waitUntil || null;

            const mouseButton = (action.mouseButton || action.button || 'left'); // 'left' | 'right' | 'middle'
            const programmatic = action.programmatic === true;
            const clickKind = (action.clickKind || 'click'); // 'click' | 'doubleClick'
            const scrollIntoView = wantsScrollIntoView(action);

            // Prefer action.timeout when provided, else fall back to the outer action timeout
            const t = Math.max(0, toNumber(action.timeout, timeout));

            // clickByText options (only meaningful when needle is used)
            const allowPointerFallback = !!action.allowPointerFallback;
            const pointerFallbackMaxMatches = Math.max(1, toNumber(action.pointerFallbackMaxMatches, 1));

            // If neither selector nor labelText, nothing to do
            if (!selector && !needle) break;

            let attempt = 0;
            while (true) {
                let h = null;
                try {
                    // ---- Target resolution ----
                    if (needle) {
                        // labelText is the target, selector (if present) is the container scope
                        h = await ctx.race(
                            findOneByTextDeepHandle(page, {
                                containerSel: selector,
                                needle,
                                exact,
                                caseSensitive,
                                timeoutMs: t,
                                allowPointerFallback,
                                pointerFallbackMaxMatches
                            }, ctx),
                            `click findOneByTextDeepHandle ${needle}`
                        );

                        if (!h) throw new Error(`click failed: "${needle}" not found within ${t}ms`);
                    } else {
                        // selector-only click (existing behavior)
                        h = await ctx.race(
                            waitForOneDeep(page, selector, { timeout: t, visible: true }),
                            `click waitForOneDeep ${selector}`
                        );
                        if (!h) throw new Error(`click failed: "${selector}" not found`);
                    }

                    const clickLabel = needle ? `labelText=${needle}` : selector;

                    const doActivate = async () => {
                        await activateClickHandle({
                            page,
                            handle: h,
                            label: clickLabel,
                            timeoutMs: t,
                            ctx,
                            mouseButton,
                            programmatic,
                            clickKind,
                            scrollIntoView
                        });
                    };

                    // The click runs inside the navigation watch, so a new
                    // document asked for the moment it lands is not missed; a
                    // click that starts no navigation is done after a second.
                    const startUrl = safePageUrl(page);
                    if (waitUntil) {
                        await ctx.race(
                            waitForPossibleNavigation(page, startUrl, {
                                waitUntil: normalizeWaitUntil(waitUntil),
                                timeout: Math.min(8000, t),
                                trigger: doActivate
                            }),
                            `click waitForPossibleNavigation ${clickLabel}`
                        );
                    } else {
                        // Even without explicit waitUntil, give SPA routers a short chance
                        // to update URL/history before the next action. Only the
                        // click's own failure stops the step; the wait's does not.
                        let clickError = null;
                        await ctx.race(
                            waitForPossibleNavigation(page, startUrl, {
                                waitUntil: 'domcontentloaded',
                                timeout: Math.min(1500, t),
                                trigger: () => doActivate().catch((err) => { clickError = err; throw err; })
                            }),
                            `click implicit waitForPossibleNavigation ${clickLabel}`
                        ).catch(() => {});
                        if (clickError) throw clickError;
                    }

                    // Let layout settle before subsequent actions (e.g., scan/screenshot).
                    await waitForRenderSettle(page, 1000).catch(() => {});

                    break;
                } catch (err) {
                    if (attempt >= retries) throw err;
                    attempt += 1;
                    await ctx.race(sleep(retryDelay), 'click retryDelay');
                } finally {
                    try { if (h) await h.dispose(); } catch {}
                }
            }

            break;
        }

        case 'type': {
            if (!selector) break;
            const text = isNonEmptyString(action.text)
                ? interpolateVarTokensLoose(action.text.trim(), {localVars, ctx})
                : '';
            const delay = Math.max(0, toNumber(action.delay, 0));

            const h = await ctx.race(
                waitForOneDeep(page, selector, {timeout, visible: true}),
                `type waitForOneDeep ${selector}`
            );
            if (!h) throw new Error(`type failed: "${selector}" not found`);
            try {
                if (wantsScrollIntoView(action)) {
                    await ctx.race(
                        h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                        `type scrollIntoView ${selector}`
                    ).catch(() => {});
                }

                if (action.clear) {
                    // Best effort clear: focus, select all, backspace
                    await ctx.race(h.focus().catch(() => {}), `type focus ${selector}`);
                    await ctx.race(page.keyboard.down('Control').catch(() => {}), 'type ctrl down');
                    await ctx.race(page.keyboard.press('KeyA').catch(() => {}), 'type ctrl+a');
                    await ctx.race(page.keyboard.up('Control').catch(() => {}), 'type ctrl up');
                    await ctx.race(page.keyboard.press('Backspace').catch(() => {}), 'type backspace');
                }

                await ctx.race(h.focus(), `type focus ${selector}`);
                await ctx.race(page.keyboard.type(text, {delay}), `type keyboard.type ${selector}`);

                if (action.pressEnter) await ctx.race(page.keyboard.press('Enter'), 'type press Enter');
            } finally {
                try { await h.dispose(); } catch {}
            }
            break;
        }

        case 'setValue':
        case 'setPassword': {
            const selector = action.selector && action.selector.trim();
            const needle = isNonEmptyString(action.labelText)
                ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
                : '';
            const exact = !!action.exact;
            const caseSensitive = !!action.caseSensitive;

            const hasSelector = !!selector;
            const hasNeedle = !!needle;

            // nothing to search by → skip
            if (!hasSelector && !hasNeedle) break;

            // A config saved from the app never carries a password, only the flag
            // saying one was there. Failing loudly beats silently typing an empty
            // string into a login form and reporting a green run. setValue with
            // the flag is a step saved before setPassword existed.
            const isPassword = action.type === 'setPassword' || action.valueMasked === true;
            if (isPassword && !isNonEmptyString(action.value)) {
                throw new Error(
                    `${action.type} failed: passwords are not saved with the configuration. ` +
                    'Load the config in the app and type the password again before running it.'
                );
            }

            const value = action.value ?? '';

            const effectiveSelector = hasSelector
                ? selector
                : 'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="searchbox"], [contenteditable="true"]';

            // Wait until at least one candidate exists, including open shadow DOM
            const any = await ctx.race(
                waitForOneDeep(page, effectiveSelector, {timeout, visible: false}),
                `setValue waitForOneDeep ${effectiveSelector}`
            );
            if (!any) throw new Error(`setValue failed: no matching controls found for selector: ${effectiveSelector}`);
            try { await any.dispose(); } catch {}

            const scrollIntoView = wantsScrollIntoView(action);

            const didSet = await ctx.race(
                page.evaluate(
                    (effectiveSelector, val, needle, exact, caseSensitive, scrollIntoView) => {
                        const cssEscape = (s) => {
                            try {
                                return (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function')
                                    ? CSS.escape(String(s))
                                    : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
                            } catch {
                                return String(s);
                            }
                        };

                        const getRoot = (el) => {
                            try {
                                const r = el && typeof el.getRootNode === 'function' ? el.getRootNode() : document;
                                return r || document;
                            } catch {
                                return document;
                            }
                        };

                        const queryByIdInRoot = (root, id) => {
                            if (!id) return null;

                            // Document: fast path
                            if (root && root.nodeType === 9 && typeof root.getElementById === 'function') {
                                const hit = root.getElementById(id);
                                if (hit) return hit;
                            }

                            // ShadowRoot or fallback
                            try {
                                return root.querySelector(`#${cssEscape(id)}`);
                            } catch {
                                return null;
                            }
                        };

                        const pushClean = (set, v) => {
                            if (typeof v !== 'string') return;
                            const raw = v.trim();
                            if (!raw) return;
                            set.add(raw);
                            const cleaned = raw.replace(/[\s*:+]+$/, '').trim();
                            if (cleaned && cleaned !== raw) set.add(cleaned);
                        };

                        const extractFromLabellingElement = (root) => {
                            if (!root) return [];
                            const texts = new Set();
                            pushClean(texts, root.innerText || root.textContent);
                            root.querySelectorAll?.('[aria-label],[title]')?.forEach(el => {
                                pushClean(texts, el.getAttribute('aria-label'));
                                pushClean(texts, el.getAttribute('title'));
                            });
                            return Array.from(texts);
                        };

                        const getAllInputLabels = (el) => {
                            if (!el || !(el instanceof HTMLElement)) return [];
                            const labels = new Set();

                            pushClean(labels, el.getAttribute('aria-label'));

                            const ariaLabelledby = el.getAttribute('aria-labelledby');
                            if (ariaLabelledby) {
                                const root = getRoot(el);

                                ariaLabelledby.split(/\s+/).forEach(idref => {
                                    if (!idref) return;

                                    // Try same root first (shadow-safe)
                                    const inRoot = queryByIdInRoot(root, idref);
                                    if (inRoot) {
                                        extractFromLabellingElement(inRoot).forEach(t => labels.add(t));
                                        return;
                                    }

                                    // Fallback to document
                                    const inDoc = queryByIdInRoot(document, idref);
                                    if (inDoc) {
                                        extractFromLabellingElement(inDoc).forEach(t => labels.add(t));
                                    }
                                });
                            }

                            const id = el.getAttribute('id');
                            if (id) {
                                const root = getRoot(el);

                                // Same root (shadow-safe)
                                try {
                                    root.querySelectorAll(`label[for="${cssEscape(id)}"]`).forEach(l => {
                                        extractFromLabellingElement(l).forEach(t => labels.add(t));
                                    });
                                } catch {}

                                // Fallback to document
                                try {
                                    document.querySelectorAll(`label[for="${cssEscape(id)}"]`).forEach(l => {
                                        extractFromLabellingElement(l).forEach(t => labels.add(t));
                                    });
                                } catch {}
                            }

                            const implicit = el.closest('label');
                            if (implicit) {
                                let texts = extractFromLabellingElement(implicit);
                                if (el.value) {
                                    texts = texts.map(t => t.replace(el.value, '').trim()).filter(Boolean);
                                }
                                texts.forEach(t => labels.add(t));
                            }

                            pushClean(labels, el.getAttribute('title'));
                            pushClean(labels, el.getAttribute('placeholder'));

                            return Array.from(labels);
                        };

                        const normalize = (s) => caseSensitive ? s : s.toLowerCase();

                        const matchesNeedle = (labels, needle2, exact2) => {
                            if (!needle2) return true;
                            const target = normalize(needle2);
                            return labels.some(lbl => {
                                const l = normalize(lbl);
                                return exact2 ? l === target : l.includes(target);
                            });
                        };

                        const setElementValue = (el, val2) => {
                            const proto = Object.getPrototypeOf(el) &&
                                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');

                            if (proto && typeof proto.set === 'function') {
                                proto.set.call(el, val2);
                            } else if (el.isContentEditable) {
                                el.textContent = val2;
                            } else {
                                el.value = val2;
                            }

                            el.dispatchEvent(new Event('input', {bubbles: true}));
                            el.dispatchEvent(new Event('change', {bubbles: true}));
                        };

                        // Collect candidates from document + all open shadow roots
                        const roots = [];
                        roots.push(document);

                        const stack = [document.documentElement || document.body];
                        while (stack.length) {
                            const node = stack.pop();
                            if (!node) continue;

                            if (node.shadowRoot) {
                                roots.push(node.shadowRoot);
                                // traverse inside shadow too
                                const sr = node.shadowRoot;
                                if (sr && sr.children) {
                                    for (let i = sr.children.length - 1; i >= 0; i--) stack.push(sr.children[i]);
                                }
                            }

                            if (node.children && node.children.length) {
                                for (let i = node.children.length - 1; i >= 0; i--) {
                                    stack.push(node.children[i]);
                                }
                            }
                        }

                        const elements = [];
                        const seen = new Set();

                        for (const root of roots) {
                            let found = [];
                            try {
                                found = Array.from(root.querySelectorAll(effectiveSelector));
                            } catch {
                                found = [];
                            }
                            for (const el of found) {
                                if (!el) continue;
                                if (seen.has(el)) continue;
                                seen.add(el);
                                elements.push(el);
                            }
                        }

                        for (const el of elements) {
                            if (el.disabled) continue;
                            if (el.readOnly) continue;
                            if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') continue;

                            // If the caller provided an explicit selector, and we are iterating elements that already match it,
                            // do not require labelText match.
                            if (needle) {
                                const labels = getAllInputLabels(el);
                                if (!matchesNeedle(labels, needle, exact)) continue;
                            }

                            if (scrollIntoView) {
                                try { el.scrollIntoView({block: 'center', inline: 'nearest'}); } catch {}
                            }
                            setElementValue(el, val);
                            return true;
                        }

                        return false;
                    },
                    effectiveSelector,
                    String(value),
                    needle,
                    exact,
                    caseSensitive,
                    scrollIntoView
                ),
                `setValue evaluate ${effectiveSelector}`
            );

            if (!didSet) {
                throw new Error(
                    `setValue failed: no eligible element matched selector=${effectiveSelector} labelText=${needle ? JSON.stringify(needle) : '(none)'}`
                );
            }

            break;
        }

        case 'clickByText': {
            const needle = isNonEmptyString(action.labelText)
                ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
                : '';
            if (!needle) {
                if (action.optional) break;
                throw new Error(`clickByText failed: labelText resolved to empty string`);
            }

            const containerSel = isNonEmptyString(action.selector) ? action.selector.trim() : null;
            const exact = !!action.exact;
            const caseSensitive = !!action.caseSensitive;
            const waitUntil = action.waitUntil || null; // e.g. 'load' | 'domcontentloaded' | 'networkidle0'
            const t = Math.max(0, toNumber(action.timeout, 10000));

            const mouseButton = (action.mouseButton || action.button || 'left'); // 'left' | 'right' | 'middle'
            const programmatic = action.programmatic === true;
            const clickKind = (action.clickKind || 'click'); // 'click' | 'doubleClick'
            const scrollIntoView = wantsScrollIntoView(action);

            // New options
            const allowPointerFallback = !!action.allowPointerFallback; // default false
            const pointerFallbackMaxMatches = Math.max(1, toNumber(action.pointerFallbackMaxMatches, 1)); // default 1

            // Find an element by its visible text (or common label sources) within document + open shadow DOM.
            // Optionally, fall back to a "pointer-like" click by using elementFromPoint at the matching text location.
            const interactiveSelector =
                'button, a, label,' +
                ' [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"],' +
                ' [role="treeitem"], [role="menuitem"], [role="tab"], [role="option"],' +
                ' input[type="button"], input[type="submit"], input[type="reset"],' +
                ' input[type="checkbox"], input[type="radio"],' +
                ' [tabindex]:not([tabindex="-1"])';

            const elHandle = await resolveByTextDeepHandle(page, {
                containerSel,
                needle,
                exact,
                caseSensitive,
                timeoutMs: t,
                interactiveSelector,
                allowPointerFallback,
                pointerFallbackMaxMatches,
                preferLabelForCheckables: true
            }, ctx, needle);

            if (!elHandle) throw new Error(`clickByText failed: "${needle}" not found within ${t}ms`);

            try {
                const doActivate = async () => {
                    await activateClickHandle({
                        page,
                        handle: elHandle,
                        label: `labelText="${needle}"`,
                        timeoutMs: t,
                        ctx,
                        mouseButton,
                        programmatic,
                        clickKind,
                        scrollIntoView
                    });
                };

                if (waitUntil) {
                    const startUrl = safePageUrl(page);

                    await waitForPossibleNavigation(page, startUrl, {
                        waitUntil: normalizeWaitUntil(waitUntil),
                        timeout: Math.min(8000, t),
                        trigger: doActivate
                    });
                } else {
                    await doActivate();
                }
            } finally {
                try {
                    await elHandle.dispose();
                } catch {}
            }

            break;
        }

        case 'hover': {
            if (!selector) break;
            const h = await ctx.race(
                waitForOneDeep(page, selector, {timeout, visible: true}),
                `hover waitForOneDeep ${selector}`
            );
            if (!h) throw new Error(`hover failed: "${selector}" not found`);
            try {
                if (wantsScrollIntoView(action)) {
                    await ctx.race(
                        h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                        `hover scrollIntoView ${selector}`
                    ).catch(() => {});
                }
                await ctx.race(h.hover(), `hover handle.hover ${selector}`);
            } finally {
                try { await h.dispose(); } catch {}
            }
            break;
        }

        case 'hoverByText': {
            const needle = isNonEmptyString(action.labelText)
                ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
                : '';

            if (!needle) {
                if (action.optional) break;
                throw new Error('hoverByText failed: missing labelText');
            }

            const containerSel = isNonEmptyString(action.selector) ? action.selector.trim() : null;
            const exact = !!action.exact;
            const caseSensitive = !!action.caseSensitive;
            const t = Math.max(0, toNumber(action.timeout, 10000));

            // Optional: wait for a selector AFTER hover, e.g., a menu opens
            const postWaitSel = isNonEmptyString(action.postWaitForSelector) ? action.postWaitForSelector.trim() : null;
            const postWaitVisible = action.postWaitVisible !== false; // default true
            const postWaitTimeout = toNumber(action.postWaitTimeout, t);

            // Resolve the element via shared deep text resolver
            const interactiveSelector =
                'button, a, label,' +
                ' [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"],' +
                ' input[type="button"], input[type="submit"], input[type="reset"],' +
                ' [tabindex]:not([tabindex="-1"])';

            const elHandle = await resolveByTextDeepHandle(page, {
                containerSel,
                needle,
                exact,
                caseSensitive,
                timeoutMs: t,
                interactiveSelector,
                allowPointerFallback: false,
                pointerFallbackMaxMatches: 1,
                preferLabelForCheckables: false
            }, ctx, needle);

            if (!elHandle) {
                throw new Error(`hoverByText failed: "${needle}" not found within ${t}ms`);
            }

            try {
                // Ensure on-screen before hovering
                if (wantsScrollIntoView(action)) {
                    await elHandle.evaluate((el) => el.scrollIntoView({block: 'center', inline: 'nearest'}));
                }

                try {
                    await elHandle.hover();
                } catch {
                    // Fallback: move mouse to the element's center
                    const box = await elHandle.boundingBox();
                    if (box) {
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    } else {
                        // Final fallback: trigger a mouseover in DOM
                        await elHandle.evaluate((el) => {
                            el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window}));
                            el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false, cancelable: true, view: window}));
                        });
                    }
                }

                if (postWaitSel) {
                    // NOTE: this still does NOT pierce shadow roots; if you need that, switch to waitForOneDeep.
                    await ctx.race(
                        waitForSel(page, postWaitSel, {visible: postWaitVisible, timeout: postWaitTimeout}),
                        `hoverByText postWaitForSel ${postWaitSel}`
                    ).catch(() => {});
                }
            } finally {
                try { await elHandle.dispose(); } catch {}
            }
            break;
        }

        case 'hoverOut': {
            const sel = isNonEmptyString(action.selector) ? action.selector.trim() : null;

            try {
                if (sel) {
                    // Prefer deep hover target (open shadow DOM)
                    const h = await ctx.race(
                        waitForOneDeep(page, sel, {timeout: toNumber(action.timeout, 10000), visible: true}),
                        `hoverOut waitForOneDeep ${sel}`
                    );

                    if (h) {
                        try {
                            if (wantsScrollIntoView(action)) {
                                await h.evaluate((el) => el.scrollIntoView({block: 'center', inline: 'nearest'}));
                            }
                            // Try puppeteer hover using a bounding box (works across shadow targets)
                            const box = await h.boundingBox();
                            if (box) {
                                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                            } else {
                                // Fallback: DOM event
                                await h.evaluate((el) => {
                                    el.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, cancelable: true, view: window}));
                                });
                            }
                        } finally {
                            try { await h.dispose(); } catch {}
                        }
                    } else {
                        // As last resort, old behavior
                        await page.hover(sel);
                    }
                } else {
                    // Move to a neutral spot to reliably cancel :hover
                    await page.mouse.move(5, 5);
                }
            } catch (e) {
                pushLog(ctx, 'warning', `hoverOut failed: ${String(e && e.message || e)}`);
            }

            await postStepDelay(ctx);
            break;
        }

        case 'focus': {
            if (!selector) break;

            let h = null;
            try {
                h = await waitForOneDeepOrThrow(page, selector, {visible: true, timeout});
                if (wantsScrollIntoView(action)) {
                    await h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'}));
                }
                await h.focus();
            } finally {
                try { if (h) await h.dispose(); } catch {}
            }

            break;
        }

        case 'focusByText': {
            const needle = isNonEmptyString(action.labelText)
                ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
                : '';

            if (!needle) {
                if (action.optional) break;
                throw new Error('hoverByText failed: missing labelText');
            }

            const containerSel = isNonEmptyString(action.selector) ? action.selector.trim() : null;
            const exact = !!action.exact;
            const caseSensitive = !!action.caseSensitive;
            const t = Math.max(0, toNumber(action.timeout, 10000));

            // Optional: wait for a selector AFTER hover, e.g., a menu opens
            const postWaitSel = isNonEmptyString(action.postWaitForSelector) ? action.postWaitForSelector.trim() : null;
            const postWaitVisible = action.postWaitVisible !== false; // default true
            const postWaitTimeout = toNumber(action.postWaitTimeout, t);

            // Resolve the element via shared deep text resolver
            const interactiveSelector =
                'button, a, label,' +
                ' [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"],' +
                ' input[type="button"], input[type="submit"], input[type="reset"],' +
                ' [tabindex]:not([tabindex="-1"])';

            const elHandle = await resolveByTextDeepHandle(page, {
                containerSel,
                needle,
                exact,
                caseSensitive,
                timeoutMs: t,
                interactiveSelector,
                allowPointerFallback: false,
                pointerFallbackMaxMatches: 1,
                preferLabelForCheckables: false
            }, ctx, needle);

            if (!elHandle) {
                throw new Error(`focusByText failed: "${needle}" not found within ${t}ms`);
            }

            // try/finally so elHandle is disposed on both the success and failure paths
            // (matches the "focus"/"hover" cases above).
            try {
                if (wantsScrollIntoView(action)) {
                    await elHandle.evaluate((el) => el.scrollIntoView({block: 'center', inline: 'nearest'}));
                }
                await elHandle.focus();
            } finally {
                try { await elHandle.dispose(); } catch {}
            }
            break;
        }

        case 'waitForSelector': {
            if (!selector) break;
            const visible = action.visible !== false;
            const hidden = action.hidden === true;

            if (hidden) {
                // Hidden checks across shadow DOM are tricky, keep existing behavior for now.
                await ctx.race(page.waitForSelector(selector, {hidden: true, timeout}), `waitForSelector hidden ${selector}`);
                break;
            }

            const h = await ctx.race(
                waitForOneDeep(page, selector, {timeout, visible}),
                `waitForSelector waitForOneDeep ${selector}`
            );

            if (!h) {
                throw new Error(`waitForSelector timed out: ${selector}`);
            }

            try { await h.dispose(); } catch {}
            break;
        }

        case 'wait': {
            // Within the field's 0 to 1 hour, for a value only known now (a
            // {var:…}): past 2^31 - 1 ms a timer fires at once, so a wait of
            // a month waited 1 ms.
            const {min, max} = ACTION_DEFINITIONS.wait.fields.ms;
            const ms = Math.min(max, Math.max(min, toNumber(action.ms, 1000)));
            await ctx.race(sleep(ms), 'wait action');
            break;
        }

        case 'scrollIntoView': {
            if (!selector) break;
            const h = await ctx.race(
                waitForOneDeep(page, selector, {timeout, visible: false}),
                `scrollIntoView waitForOneDeep ${selector}`
            );
            if (!h) throw new Error(`scrollIntoView failed: "${selector}" not found`);
            try {
                await ctx.race(
                    h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                    `scrollIntoView scroll ${selector}`
                );
            } finally {
                try { await h.dispose(); } catch {}
            }
            break;
        }

        case 'scroll': {
            if (action.to === 'top') {
                await page.evaluate(() => {
                    window.scrollTo(0, 0);
                });
            } else if (action.to === 'bottom') {
                await page.evaluate(() => {
                    const height =
                        document.body && document.body.scrollHeight
                            ? document.body.scrollHeight
                            : document.documentElement.scrollHeight || 0;
                    window.scrollTo(0, height);
                });
            } else if (typeof action.y === 'number') {
                await page.evaluate((deltaY) => {
                    window.scrollBy(0, deltaY);
                }, action.y);
            }
            break;
        }

        case 'setViewport': {
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
            break;
        }

        case 'navigate': {
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
                    break;
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
            break;
        }

        case 'refresh': {
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
            break;
        }

        case 'goBack': {
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
                    break;
                }
                throw new Error(`goBack failed: ${msg}`);
            }

            await ctx.race(waitForRenderSettle(page, 2000), 'goBack waitForRenderSettle');
            try {
                pushLog(ctx, 'info', `URL after goBack: ${await ctx.race(page.url(), 'goBack page.url')}`);
            } catch {
            }
            break;
        }

        case 'emulateVisionDeficiency': {
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
                    break;
                }
                throw new Error(`emulateVisionDeficiency failed (${deficiency}): ${msg}`);
            }
            break;
        }

        case 'setColorScheme': {
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
                    break;
                }
                throw new Error(`setColorScheme failed: ${msg}`);
            }
            break;
        }

        case 'setLanguage': {
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
                    break;
                }
                throw new Error(`setLanguage failed: ${msg}`);
            }
            break;
        }

        case 'keyboard': {
            if (Array.isArray(action.keys)) {
                for (const key of action.keys) {
                    await pressKey(page, key);
                }
            }

            if (isNonEmptyString(action.text)) {
                await page.keyboard.type(action.text);
            }

            break;
        }

        case 'select': {
            if (!selector) break;
            const value = isNonEmptyString(action.value)
                ? interpolateVarTokensLoose(action.value.trim(), {localVars, ctx})
                : null;
            if (value == null) break;

            const h = await ctx.race(
                waitForOneDeep(page, selector, {timeout, visible: false}),
                `select waitForOneDeep ${selector}`
            );
            if (!h) throw new Error(`select failed: "${selector}" not found`);

            try {
                const hasOption = await h.evaluate((el, val) => {
                    if (!el || !el.querySelector) return false;
                    try {
                        return !!el.querySelector(`option[value="${CSS.escape(String(val))}"]`);
                    } catch {
                        return false;
                    }
                }, String(value)).catch(() => false);

                if (!hasOption) throw new Error(`select failed: option "${value}" not found`);

                if (wantsScrollIntoView(action)) {
                    await ctx.race(
                        h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                        `select scrollIntoView ${selector}`
                    ).catch(() => {});
                }

                // ElementHandle.select exists for <select>
                await ctx.race(h.select(String(value)), `select handle.select ${selector}`);
            } finally {
                try { await h.dispose(); } catch {}
            }
            break;
        }

        case 'getText': {
            const selector = isNonEmptyString(action.selector) ? action.selector.trim() : '';
            const varName = isNonEmptyString(action.var) ? action.var.trim() : '';
            const doTrim = action.trim !== false;
            const attr = isNonEmptyString(action.attr) ? action.attr.trim() : null;
            const rawAttr = action.rawAttr === true;
            const useInnerText = action.useInnerText === true;

            if (!selector || !varName) break;

            const h = await page.waitForFunction(
                async (sel) => {
                    // minimal deep exists check
                    const roots = [document];
                    const stack = [document.documentElement || document.body];
                    while (stack.length) {
                        const n = stack.pop();
                        if (!n) continue;
                        if (n.shadowRoot) {
                            roots.push(n.shadowRoot);
                            const sr = n.shadowRoot;
                            if (sr && sr.children) {
                                for (let i = sr.children.length - 1; i >= 0; i--) stack.push(sr.children[i]);
                            }
                        }
                        if (n.children && n.children.length) {
                            for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
                        }
                    }
                    for (const r of roots) {
                        try {
                            const el = r.querySelector(sel);
                            if (el) return el;
                        } catch {}
                    }
                    return null;
                },
                {timeout: toNumber(action.timeout, 10000)},
                selector
            ).catch(() => null);

            const elHandle = h?.asElement?.() || null;
            if (!elHandle) break;

            try {
                const value = await elHandle.evaluate((el, cfg) => {
                    if (!el) return '';
                    if (cfg.attr) {
                        const v = (cfg.attr === 'href' && !cfg.rawAttr && el.href) ? el.href : el.getAttribute(cfg.attr);
                        return v == null ? '' : String(v);
                    }
                    const raw = cfg.useInnerText ? (el.innerText || '') : (el.textContent || '');
                    return cfg.collapse ? raw.replace(/\s+/g, ' ').trim() : raw;
                }, {attr, rawAttr, collapse: doTrim, useInnerText});

                if (localVars && typeof localVars === 'object') localVars[varName] = value;
                if (ctx && ctx.vars) ctx.vars[varName] = value;
            } finally {
                try { await elHandle.dispose(); } catch {}
            }
            break;
        }

        case 'getCount': {
            const selector = isNonEmptyString(action.selector) ? action.selector.trim() : '';
            const varName = isNonEmptyString(action.var) ? action.var.trim() : '';
            if (!selector || !varName) break;

            // Counts across the document and every open shadow root. Each root's
            // querySelectorAll only sees its own tree, so no element is counted twice.
            // Nothing matching is a valid answer (0), not a failure.
            let count;
            try {
                count = await ctx.race(page.evaluate((sel) => {
                    const roots = [document];
                    const stack = [document.documentElement || document.body];
                    while (stack.length) {
                        const n = stack.pop();
                        if (!n) continue;
                        if (n.shadowRoot) {
                            roots.push(n.shadowRoot);
                            const sr = n.shadowRoot;
                            if (sr.children) {
                                for (let i = sr.children.length - 1; i >= 0; i--) stack.push(sr.children[i]);
                            }
                        }
                        if (n.children && n.children.length) {
                            for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
                        }
                    }
                    let total = 0;
                    for (const r of roots) total += r.querySelectorAll(sel).length;
                    return total;
                }, selector), `getCount ${selector}`);
            } catch (err) {
                if (err && err._wfCancelled) throw err;
                const msg = String(err && err.message ? err.message : err);
                throw new Error(`getCount: could not count "${selector}": ${msg}`);
            }

            const value = Number.isFinite(count) ? count : 0;
            if (localVars && typeof localVars === 'object') localVars[varName] = value;
            if (ctx && ctx.vars) ctx.vars[varName] = value;

            if (action.logValue === true) {
                pushLog(ctx, 'info', `getCount: ${varName} = ${value} (${selector})`, {
                    var: varName,
                    value,
                    selector
                });
            }
            break;
        }

        case 'setVar': {
            const key = isNonEmptyString(action.key) ? action.key.trim() : '';
            if (!key) break;
            const source = isNonEmptyString(action.from) ? action.from.trim().toLowerCase() : '';
            const value = (source === 'url')
                ? await page.url()
                : (
                    (typeof action.value === 'string')
                        ? interpolateVarTokensLoose(action.value, {localVars, ctx})
                        : action.value
                );
            if (localVars && typeof localVars === 'object') localVars[key] = value;
            if (ctx && ctx.vars) ctx.vars[key] = value;
            break;
        }

        case 'clearVar': {
            const key = isNonEmptyString(action.key) ? action.key.trim() : '';
            if (!key) break;
            if (localVars && typeof localVars === 'object') delete localVars[key];
            if (ctx && ctx.vars) delete ctx.vars[key];
            break;
        }

        case 'collectOutput': {
            const key = isNonEmptyString(action.key) ? action.key.trim() : '';
            if (!key) break;

            // Optional gate, shared evaluator with skipIteration (see evaluateConditionPredicate above).
            // `when` is authored as a JSON string (same convention as runCustomStep's argsJson) -
            // the step-config UI has no editor for a raw nested object, only string/array/boolean
            // primitives. An already-parsed object is also accepted for programmatic callers.
            // Malformed JSON is a present-but-broken condition, not an absent one: fail closed
            // (don't record) rather than silently recording as if unconditioned, mirroring
            // getText's "unresolved selector is a no-op" convention elsewhere in this file.
            let whenPresent = false;
            let whenCfg = null;
            if (typeof action.when === 'string' && action.when.trim()) {
                whenPresent = true;
                try {
                    whenCfg = JSON.parse(action.when);
                } catch {
                    whenCfg = null;
                }
            } else if (action.when && typeof action.when === 'object') {
                whenPresent = true;
                whenCfg = action.when;
            }
            if (whenPresent) {
                const whenOk = (whenCfg && typeof whenCfg === 'object')
                    && await evaluateConditionPredicate(page, ctx, whenCfg);
                if (!whenOk) break;
            }

            const fromVar = isNonEmptyString(action.fromVar) ? action.fromVar.trim() : '';
            const from = isNonEmptyString(action.from) ? action.from.trim().toLowerCase() : '';
            const doTrim = action.trim !== false;
            const currentUrl = await page.url();

            let value = null;

            if (typeof action.value === 'string') {
                value = interpolateVarTokensLoose(action.value, {localVars, ctx});
            } else if (fromVar) {
                // An unset variable is a no-op (leave value===null), the same contract
                // getText uses for an unresolved selector - don't pollute the collection
                // with an empty-string entry for what's likely a typo'd var name.
                const hasLocal = localVars && typeof localVars === 'object'
                    && Object.prototype.hasOwnProperty.call(localVars, fromVar);
                if (hasLocal) {
                    const v = localVars[fromVar];
                    value = v == null ? '' : String(v);
                } else {
                    const v = ctx.getVar(fromVar);
                    if (v !== undefined) value = v == null ? '' : String(v);
                }
            } else if (from === 'url') {
                value = currentUrl;
            } else if (from === 'selectortext' || from === 'selectorattr') {
                const selector = isNonEmptyString(action.selector) ? action.selector.trim() : '';
                if (selector) {
                    const elHandle = await queryOneDeep(page, selector);
                    if (elHandle) {
                        try {
                            const attr = (from === 'selectorattr' && isNonEmptyString(action.attr))
                                ? action.attr.trim()
                                : null;
                            value = await elHandle.evaluate((el, cfg) => {
                                if (!el) return '';
                                if (cfg.attr) {
                                    const v = (cfg.attr === 'href' && el.href) ? el.href : el.getAttribute(cfg.attr);
                                    return v == null ? '' : String(v);
                                }
                                const raw = el.textContent || '';
                                return cfg.trim ? raw.replace(/\s+/g, ' ').trim() : raw;
                            }, {attr, trim: doTrim});
                        } finally {
                            try { await elHandle.dispose(); } catch {}
                        }
                    }
                }
            }

            if (value === null) break;

            // Mistake-guard against a selector matching something much larger than
            // intended (e.g. a container instead of a single label). Not a volume
            // control - see docs/design/workflow-collected-metadata-design.md §4.3.
            const MAX_COLLECT_VALUE_LENGTH = 5000;
            let truncated = false;
            if (typeof value === 'string' && value.length > MAX_COLLECT_VALUE_LENGTH) {
                value = value.slice(0, MAX_COLLECT_VALUE_LENGTH);
                truncated = true;
            }

            const label = isNonEmptyString(action.label)
                ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
                : key;

            const tags = Array.isArray(action.tags)
                ? action.tags.filter((t) => isNonEmptyString(t)).map((t) => String(t).trim())
                : [];

            const iterVars = ctx && ctx._iterVars;
            const iteration = (iterVars && typeof iterVars.index === 'number')
                ? {
                    index: iterVars.index,
                    oneBased: iterVars.index + 1,
                    total: (typeof iterVars.total === 'number') ? iterVars.total : null
                }
                : null;

            const actionPath = (ctx && ctx._logCtx && typeof ctx._logCtx.actionPath === 'string')
                ? ctx._logCtx.actionPath
                : null;

            if (!Array.isArray(ctx.collectedOutputs)) ctx.collectedOutputs = [];
            ctx.collectedOutputs.push({
                key,
                label,
                value,
                url: currentUrl,
                time: new Date().toISOString(),
                iteration,
                actionPath,
                tags,
                truncated
            });

            break;
        }

        case 'skipIteration': {
            // Top-level fields are the documented contract (and what forEachElement's
            // :ctx rewriting targets - see rewriteCtxTokenShallow, which only rewrites
            // action.selector/selectorExists, not anything nested under config).
            // action.config is kept as a legacy alias so existing callers still work.
            // Predicate evaluation is shared with collectOutput's `when` clause via
            // evaluateConditionPredicate/buildConditionConfig (defined above runActionAction).
            const shouldSkip = await evaluateConditionPredicate(page, ctx, action);

            // When true, mark iteration as skipped and stop the current loop body.
            if (shouldSkip) {
                // A Crawl runs its steps without local variables of their own.
                if (localVars) localVars.__skipIteration = true;
                // Actually stop the rest of this iteration: throw the same _wfSkipIteration
                // signal that forEachElement/repeat already catch (e.g. "scoped element
                // disappeared"), so remaining actions in this iteration don't run and the
                // enclosing loop advances to the next item instead of treating this as a failure.
                const err = new Error('skipIteration: predicate matched, skipping remainder of iteration');
                err._wfSkipIteration = true;
                throw err;
            }

            break;
        }

        case 'forEachElement': {
            // Prefer action.targetSelector, fallback to old action.context for backward compatibility.
            const sel = isNonEmptyString(action.targetSelector)
                ? action.targetSelector.trim()
                : (isNonEmptyString(action.context) ? action.context.trim() : '');
            if (!sel) break;

            const reverse = action.reverse === true;
            const limit = (typeof action.limit === 'number' && action.limit > 0) ? action.limit : 0;
            const nested = Array.isArray(action.actions) ? action.actions : [];
            const iterSetupActions = Array.isArray(action.iterSetupActions)
                ? action.iterSetupActions.filter(s => !isDisabled(s))
                : null;
            const continueOnIterationError = action.continueOnIterationError === true;
            const maxIterationErrors = Number.isFinite(action.maxIterationErrors) ? action.maxIterationErrors : Infinity;
            let iterationErrors = 0;

            const preparedIterSetup = iterSetupActions && iterSetupActions.length
                ? iterSetupActions
                : null;
            const dynamic = action.dynamic === true;
            const dedupeBy = (action.dedupeBy === 'text') ? 'text' : 'href';
            const onlyVisible = action.onlyVisible === true;

            let staticTotal = null;
            if (!dynamic) {
                try {
                    const initial = await page.$$(sel);
                    staticTotal = initial.length;
                    for (const h of initial) await h.dispose().catch(() => {});
                } catch {}
            }

            // Optional concurrency (crawlQueue-style)
            // Within the field's 1 to 8, for a value only known now (a {var:…}).
            const concurrency = clampConcurrency(action.concurrency);
            const isolation = (action.isolation === 'context') ? 'context' : 'page';
            const closeWorkerPages = action.closeWorkerPages !== false; // default true
            const maxSeconds = Number.isFinite(action.maxSeconds) ? action.maxSeconds : null;
            const perPageDelayMs = Math.max(0, Math.floor(toNumber(action.perPageDelayMs, 0)));

            if (concurrency > 1) {
                // v1 safety: concurrent mode requires a stable target list
                if (dynamic) {
                    throw new Error("forEachElement: concurrency > 1 does not support dynamic=true yet.");
                }

                const plan = await buildForEachElementPlan(page, sel, {
                    reverse,
                    limit,
                    dedupeBy,
                    timeout,
                    onlyVisible
                });

                await runForEachElementConcurrent({
                    action,
                    parentCtx: ctx,
                    mainPage: page,
                    sel,
                    plan,
                    concurrency,
                    isolation,
                    closeWorkerPages,
                    maxSeconds,
                    perPageDelayMs,
                    timeout,
                    depth,
                    actionPathPrefix
                });

                break;
            }

            // staticTotal counts every match; `limit` is what actually caps the
            // iterations, so the total we report - and that a step counter sizes
            // the loop from - is the smaller of the two.
            const effectiveTotal = (staticTotal == null)
                ? null
                : (limit ? Math.min(staticTotal, limit) : staticTotal);

            const visited = new Set();
            let processed = 0;
            let loopStarted = false;

            const getKey = async (handle) => {
                return _forEachGetKey(handle, dedupeBy);
            };

            while (true) {
                // 1) Iteration setup actions (not element-scoped)
                if (preparedIterSetup && preparedIterSetup.length) {
                    try {
                        await applyActions(page, preparedIterSetup, null, 0, ctx, Object.create(null), depth + 1, actionPathPrefix);
                    } catch (err) {
                        if (err && err._wfSkipIteration) {
                            // Important: do not advance processed here, iterSetupActions happens before selecting an element
                            pushLog(ctx, 'info', `Iteration skipped (iterSetupActions) (${processed}/${staticTotal ?? '?'})`);
                            await postStepDelay(ctx);
                            continue;
                        }
                        throw err;
                    }
                }

                // Stop if nothing matches anymore. Before the first item the
                // targets may still be rendering, so that check gets the whole
                // timeout; once the loop has run, a selector that matches
                // nothing (say, "panels not yet open" after opening them all)
                // means the work is done, and waiting the timeout out again
                // would only add it to every loop's end.
                const hasHandle = await waitForOneDeep(page, sel, {
                    timeout: loopStarted ? Math.min(timeout, LOOP_END_CHECK_MS) : timeout,
                    visible: false
                }).catch(() => null);
                loopStarted = true;
                const has = !!hasHandle;
                try { if (hasHandle) await hasHandle.dispose(); } catch {}
                if (!has) break;

                let handles = await page.$$(sel);
                if (!handles.length) break;
                if (reverse) handles = handles.slice().reverse();

                let candidate = null;

                if (dynamic) {
                    for (const h of handles) {
                        if (onlyVisible) {
                            const visible = await _isVisible(h);
                            if (!visible) {
                                await h.dispose().catch(() => {});
                                continue;
                            }
                        }

                        const key = await getKey(h);
                        if (key && !visited.has(key)) {
                            candidate = {h, key};
                            break;
                        }

                        await h.dispose().catch(() => {});
                    }
                    if (!candidate) break;
                } else {
                    const h = handles[processed] || null;
                    if (!h) break;

                    if (onlyVisible) {
                        const visible = await _isVisible(h);
                        if (!visible) {
                            await h.dispose().catch(() => {});
                            processed += 1;
                            if (limit && processed >= limit) break;
                            continue;
                        }
                    }

                    const key = await getKey(h);
                    candidate = {h, key};

                    // Static lists in SPAs can reorder after each interaction.
                    // If the index now points to an already-visited item, pick
                    // the next unvisited candidate from the current snapshot.
                    if (candidate.key && visited.has(candidate.key)) {
                        let replacement = null;
                        for (let i = 0; i < handles.length; i++) {
                            const hh = handles[i];
                            if (hh === h) continue;
                            if (onlyVisible) {
                                const visible = await _isVisible(hh);
                                if (!visible) continue;
                            }
                            const kk = await getKey(hh);
                            if (!kk || visited.has(kk)) continue;
                            replacement = {h: hh, key: kk};
                            break;
                        }
                        if (replacement) {
                            await h.dispose().catch(() => {});
                            candidate = replacement;
                        }
                    }
                }

                const keepHandle = candidate?.h || null;

                // Dispose any remaining handles we didn't pick to avoid leaks
                try {
                    for (const h of handles) {
                        if (keepHandle && h === keepHandle) continue;
                        await h.dispose().catch(() => {});
                    }
                } catch {}

                if (candidate.key) visited.add(candidate.key);

                // 2) Scope the chosen element
                let {scopeId, scopeSel} = await setScopeAttr(page, candidate.h);

                // Ensure the scoped element still exists in DOM (SPA rerenders can detach it
                // right after scoping) - if it's gone, the reacquire-or-skip logic below handles
                // it gracefully, so there's no separate hard-fail check here.
                let scopePresent = await page.$(scopeSel).catch(() => null);
                if (scopePresent) {
                    await scopePresent.dispose().catch(() => {});
                } else {
                    // Try to reacquire the candidate and re-scope once
                    // We use the already-computed candidate.key (href/text) to match the right element.
                    pushLog(ctx, 'warning', `Scoped element disappeared, reacquiring once: ${scopeSel}`, { depth });

                    // Refresh handles and pick the one matching candidate.key (or fallback to same index)
                    let fresh = await page.$$(sel);
                    if (reverse) fresh = fresh.slice().reverse();

                    let replacement = null;

                    if (candidate.key) {
                        for (const h of fresh) {
                            if (onlyVisible) {
                                const visible = await _isVisible(h);
                                if (!visible) { await h.dispose().catch(() => {}); continue; }
                            }
                            const k = await getKey(h);
                            if (k && k === candidate.key) { replacement = h; break; }
                            await h.dispose().catch(() => {});
                        }
                    } else {
                        // No key available, fallback to index
                        replacement = fresh[processed] || null;
                        // Dispose others to avoid leaks
                        for (let i = 0; i < fresh.length; i++) {
                            if (fresh[i] !== replacement) await fresh[i].dispose().catch(() => {});
                        }
                    }

                    if (!replacement) {
                        // Nothing to scope anymore, treat as "skip iteration"
                        await clearScopeAttr(page, scopeId).catch(() => {});
                        processed += 1;
                        if (limit && processed >= limit) break;
                        await postStepDelay(ctx);
                        continue;
                    }

                    // Replace candidate handle, re-scope
                    try { if (candidate.h) await candidate.h.dispose().catch(() => {}); } catch {}
                    candidate.h = replacement;

                    const rescoped = await setScopeAttr(page, candidate.h);
                    // IMPORTANT: use the new scopeId/scopeSel from now on
                    await clearScopeAttr(page, scopeId).catch(() => {}); // clear the old (best effort)
                    scopeId = rescoped.scopeId;
                    scopeSel = rescoped.scopeSel;
                }

                const loopVars = Object.create(null);

                // 3) PreActions are element-scoped (run before main nested actions)
                const preActions = Array.isArray(action.preActions) ? action.preActions.filter(s => !isDisabled(s)) : null;
                const preparedPre = (preActions && preActions.length)
                    ? preActions.map(s => rewriteCtxTokenShallow(s, scopeSel))
                    : null;

                // 4) Main nested actions are element-scoped
                const nestedFiltered = nested.filter(s => !isDisabled(s));
                const prepared = nestedFiltered.map(s => rewriteCtxTokenShallow(s, scopeSel));

                const previousIter = ctx._iterVars;
                ctx._iterVars = {index: processed, total: staticTotal};

                // per-iteration lexical scope
                ctx.pushVarScope({
                    index: processed,
                    oneBased: processed + 1,
                    total: staticTotal
                });

                const actionPrefix = formatActionPrefix(actionPathPrefix);
                pushLog(ctx, 'info', `${actionPrefix}forEachElement item ${processed + 1}/${effectiveTotal ?? '?'}`, {
                    depth,
                    actionPath: actionPrefix.trim().replace(/^Action\s+/, ''),
                    stepEvent: 'loop-iteration',
                    loopType: 'forEachElement',
                    index: processed,
                    total: effectiveTotal
                });

                try {
                    if (preparedPre && preparedPre.length) {
                        try {
                            await applyActions(page, preparedPre, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
                        } catch (err) {
                            if (err && err._wfSkipIteration) {
                                await clearScopeAttr(page, scopeId);

                                processed += 1;
                                if (limit && processed >= limit) break;

                                pushLog(ctx, 'info', `Iteration skipped (preActions) (${processed}/${staticTotal ?? '?'})`);
                                await postStepDelay(ctx);
                                continue;
                            }
                            throw err;
                        }
                    }

                    try {
                        await applyActions(page, prepared, null, 0, ctx, loopVars, depth + 1, actionPathPrefix);
                    } catch (err) {
                        if (err && err._wfSkipIteration) {
                            await clearScopeAttr(page, scopeId);

                            processed += 1;
                            if (limit && processed >= limit) break;

                            pushLog(ctx, 'info', `Iteration skipped (${processed}/${staticTotal ?? '?'})`);
                            await postStepDelay(ctx);
                            continue;
                        }

                        // retry once if the SPA swapped context during nested actions
                        if (isContextDestroyedError(err)) {
                            pushLog(ctx, 'warning', 'Context swapped during iteration, retrying nested actions once');
                            await withNavResilience(
                                page,
                                () => applyActions(page, prepared, null, 0, ctx, loopVars, depth + 1, actionPathPrefix),
                                {retries: 1, afterNavWait: 'domcontentloaded', timeout}
                            );
                        } else {
                            throw err;
                        }
                    } finally {
                        ctx._iterVars = previousIter;
                    }

                    await clearScopeAttr(page, scopeId);

                    processed += 1;
                    if (limit && processed >= limit) break;
                    await postStepDelay(ctx);

                } catch (err) {
                    if (err && err._wfCancelled) throw err;

                    if (err && err._wfSkipIteration) {
                        processed += 1;
                        if (limit && processed >= limit) break;
                        await postStepDelay(ctx);
                        continue;
                    }

                    iterationErrors += 1;

                    const msg = String(err && err.message ? err.message : err);

                    recordIterationFailure(ctx, {
                        iteratorType: 'forEachElement',
                        iteratorLabel: action.label || null,
                        iterationIndex: processed,
                        iterationOneBased: processed + 1,
                        iterationTotal: staticTotal ?? null,
                        error: msg,
                        url: safePageUrl(page) || null
                    });

                    pushLog(ctx, 'error', `forEachElement iteration ${processed + 1}/${staticTotal ?? '?'} failed, continuing: ${msg}`, {depth});

                    // Best effort cleanup and recovery for next iteration
                    try {
                        await clearScopeAttr(page, scopeId);
                    } catch {}

                    if (!continueOnIterationError) {
                        err.action = action;
                        throw err;
                    }

                    if (iterationErrors >= maxIterationErrors) {
                        throw new Error(`forEachElement stopped after ${iterationErrors} iteration errors`);
                    }

                    processed += 1;
                    if (limit && processed >= limit) break;
                    await postStepDelay(ctx);
                    continue;

                } finally {
                    // Ensure we don't leak the element handle for this iteration
                    try {
                        if (candidate && candidate.h) await candidate.h.dispose();
                    } catch {}
                    if (candidate) candidate.h = null;

                    // Always restore per-iteration scope
                    ctx.popVarScope();
                }
            }

            break;
        }

        case 'group': {
            if (!Array.isArray(action.actions) || !action.actions.length) break;
            ctx.pushVarScope(); // isolate block vars
            // Children get their own copy of the caller's local vars: they can read
            // them, but whatever they set (getText, getCount, setVar, exportVars) is
            // dropped with the group, the same as the ctx scope above. Passing the
            // caller's object through made a group inside a repeat/forEachElement leak
            // its variables to later siblings, while a top-level group did not.
            const groupLocalVars = Object.assign(Object.create(null), localVars || {});
            try {
                // applyActions will skip disabled children automatically
                await applyActions(page, action.actions, null, 0, ctx, groupLocalVars, depth + 1, actionPathPrefix);
            } finally {
                ctx.popVarScope();
            }
            break;
        }

        case 'mergedScan': {
            if (!Array.isArray(action.actions) || !action.actions.length) break;
            if (ctx._mergedScan) {
                throw new Error(`A Merged scan cannot run inside another Merged scan${ctx._mergedScan.label ? ` ("${ctx._mergedScan.label}")` : ''}`);
            }
            // One key per execution, counted on the root context so workers
            // share it: each iteration of a Repeat is a merged scan of its own.
            const root = ctx._rootCtx || ctx;
            root._mergedScanSeq = (root._mergedScanSeq || 0) + 1;
            const label = typeof action.label === 'string' && action.label.trim()
                ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx}).trim()
                : '';
            pushLog(ctx, 'info', `merged scan${label ? `: ${label}` : ''}`);
            const key = `merged-${root._mergedScanSeq}`;
            ctx._mergedScan = {key, label: label || null, scanTags: interpolateScanTags(action.scanTags, {localVars, ctx})};
            try {
                // Unlike a group, its variables are not scoped: it only says
                // which scans are one.
                await applyActions(page, action.actions, null, 0, ctx, localVars, depth + 1, actionPathPrefix);
            } finally {
                ctx._mergedScan = null;
                // The runner folds its scans now, so the live counts show one
                // scan from here on rather than at the end of the run.
                if (typeof root.onMergedScanEnd === 'function') {
                    try { root.onMergedScanEnd(key); } catch {}
                }
            }
            break;
        }

        case 'runCustomStep': {
            const customStepId = String(action.customStepId || action.id || '').trim();
            if (!customStepId) throw new Error('runCustomStep requires customStepId');

            const customStepDef = ctx?.customSteps?.[customStepId];
            if (!customStepDef) throw new Error(`runCustomStep "${customStepId}" was not found`);
            if (!Array.isArray(customStepDef.actions) || !customStepDef.actions.length) break;

            const stack = Array.isArray(ctx._customStepStack) ? ctx._customStepStack : [];
            const alreadyInStack = stack.includes(customStepId);
            const isDirectSelfRecursion = stack.length > 0 && stack[stack.length - 1] === customStepId;
            const allowRecursion = action.allowRecursion === true;
            if (alreadyInStack && !(allowRecursion && isDirectSelfRecursion)) {
                throw new Error(`runCustomStep cycle detected: ${[...stack, customStepId].join(' -> ')}`);
            }

            const maxCustomStepDepth = Math.max(1, toNumber(action.maxDepth, 15));
            if (stack.length >= maxCustomStepDepth) {
                throw new Error(`runCustomStep exceeded max depth (${maxCustomStepDepth})`);
            }

            const providedArgs = parseJsonObjectInput(action.argsJson ?? action.args, 'runCustomStep.argsJson');
            const callScopeVars = Object.create(null);
            for (const [key, value] of Object.entries(providedArgs)) {
                if (typeof value === 'string') {
                    callScopeVars[key] = interpolateTemplate(value, { ctx, localVars, page });
                } else {
                    callScopeVars[key] = cloneDeep(value);
                }
            }

            const inputDefs = Array.isArray(customStepDef.inputs) ? customStepDef.inputs : [];
            for (const def of inputDefs) {
                if (!def || !def.name) continue;
                const hasValue = Object.prototype.hasOwnProperty.call(callScopeVars, def.name);
                if (!hasValue && def.hasDefault) {
                    const dv = cloneDeep(def.defaultValue);
                    callScopeVars[def.name] = (typeof dv === 'string')
                        ? interpolateTemplate(dv, { ctx, localVars, page })
                        : dv;
                }
                if (def.required === true && !Object.prototype.hasOwnProperty.call(callScopeVars, def.name)) {
                    throw new Error(`runCustomStep "${customStepId}" missing required input "${def.name}"`);
                }
            }

            const exportVars = normalizeExportVarNames(action.exportVars);
            const customStepPathPrefix = actionPathPrefix ? `${actionPathPrefix}::customStep(${customStepId})` : `customStep(${customStepId})`;
            const previousStack = ctx._customStepStack;
            ctx.pushVarScope(callScopeVars);
            ctx._customStepStack = [...stack, customStepId];
            try {
                await applyActions(page, customStepDef.actions, null, 0, ctx, localVars, depth + 1, customStepPathPrefix);
                for (const varName of exportVars) {
                    localVars[varName] = ctx.getVar(varName);
                }
            } finally {
                ctx.popVarScope();
                ctx._customStepStack = previousStack;
            }
            break;
        }

        case 'if': {
            let conditionOk = false;

            if (isNonEmptyString(action.selectorExists)) {
                let selectorExists = action.selectorExists;
                if (selectorExists.includes(':ctx')) {
                    const activeScopeSel = await resolveActiveScopeSelector(page);
                    if (activeScopeSel) {
                        selectorExists = selectorExists.split(':ctx').join(activeScopeSel);
                    }
                }

                const handle = await page.$(selectorExists);
                const onlyVisible = action.onlyVisible === true;

                try {
                    if (!handle) {
                        conditionOk = false;
                    } else if (!onlyVisible) {
                        conditionOk = true;
                    } else {
                        conditionOk = await _isVisible(handle, { requireInViewport: true });
                    }
                } finally {
                    if (handle) await handle.dispose();
                }

            } else if (action.var && typeof action.equals !== 'undefined') {
                // Found the way {var:name} finds it, so a variable a custom step
                // exported (held in localVars only) is seen here too.
                conditionOk = sameAsText(lookupVar(String(action.var).trim(), {localVars, ctx}), action.equals);

            } else if (isNonEmptyString(action.urlIncludes)) {
                const u = await page.url();
                conditionOk = u.includes(action.urlIncludes);
            }

            await runConditionBranch(page, action, conditionOk, ctx, localVars, depth, actionPathPrefix);
            break;
        }

        case 'ifUrl': {
            // action.value has had its {var:name} tokens filled in already, like
            // every step's fields, when the step was dispatched.
            const outcome = evaluateUrlCondition(await page.url(), action, action.value);
            const part = outcome.part === 'param' ? `param "${String(action.paramName).trim()}"` : outcome.part;
            const actualText = outcome.actual === null ? '(not present)' : JSON.stringify(outcome.actual);
            pushLog(ctx, 'info', `ifUrl: ${part} ${actualText} ${outcome.comparison} ${JSON.stringify(outcome.expected)} -> ${outcome.result}`, {depth});
            await runConditionBranch(page, action, outcome.result, ctx, localVars, depth, actionPathPrefix);
            break;
        }

        case 'switch': {
            const href = (action.subject || 'url') === 'url' ? await page.url() : '';
            const subject = readSwitchSubject(action, {href, localVars, ctx});
            const picked = pickSwitchCase(action, subject);
            const actualText = subject.actual === null ? '(not present)' : JSON.stringify(subject.actual);
            const takenText = picked ? `case ${picked.index}` : 'default';
            pushLog(ctx, 'info', `switch: ${subject.describe} ${actualText} -> ${takenText}`, {depth});
            logBranchTaken(ctx, `switch: ${takenText} taken`, depth, actionPathPrefix,
                picked ? {taken: 'case', caseIndex: picked.index} : {taken: 'default'});

            // A case's steps are numbered under the case (S.k.j), the default's
            // under the switch (S.j), as the step editor numbers them.
            const switchPath = Array.isArray(actionPathPrefix) ? actionPathPrefix : [];
            if (picked) {
                await runBranchActions(page, picked.kase.actions, ctx, localVars, depth, switchPath.concat([picked.index]));
            } else {
                await runBranchActions(page, action.defaultActions, ctx, localVars, depth, switchPath);
            }
            break;
        }

        case 'case':
            throw new Error('A case step only runs inside a switch, as one of its cases');

        case 'repeat': {
            const continueOnIterationError = action.continueOnIterationError === true;
            let iterationErrors = 0;

            // Accept aliases to be resilient to UI/schema differences
            let rawItemsText =
                (typeof action.itemsText === 'string') ? action.itemsText :
                    (typeof action.items === 'string') ? action.items :
                        (typeof action.datasetText === 'string') ? action.datasetText :
                            (typeof action.dataset === 'string') ? action.dataset :
                                (typeof action.datasetItemsText === 'string') ? action.datasetItemsText :
                                    (typeof action.datasetOnePerLine === 'string') ? action.datasetOnePerLine :
                                        '';

            // If UI stores dataset as array of lines/items, support that too
            if (!rawItemsText && Array.isArray(action.datasetLines)) {
                rawItemsText = action.datasetLines.map(x => String(x ?? '')).join('\n');
            }
            if (!rawItemsText && Array.isArray(action.dataset)) {
                rawItemsText = action.dataset.map(x => String(x ?? '')).join('\n');
            }
            if (!rawItemsText && Array.isArray(action.items)) {
                rawItemsText = action.items.map(x => String(x ?? '')).join('\n');
            }

            const resolvedItemsText = interpolateTemplate(String(rawItemsText || ''), {
                localVars,
                ctx,
                keepUnresolved: true
            });

            const items = isNonEmptyString(resolvedItemsText)
                ? parseRepeatItemsText(resolvedItemsText)
                : null;

            const times =
                (items && items.length > 0)
                    ? items.length
                    : (Number.isFinite(action.times) && action.times > 0
                        ? action.times
                        : (Number.isFinite(action.repetitions) && action.repetitions > 0 ? action.repetitions : 0));

            if (!times || !Array.isArray(action.actions) || !action.actions.length) break;

            for (let i = 0; i < times; i += 1) {
                const actionPrefix = formatActionPrefix(actionPathPrefix);
                pushLog(ctx, 'info', `${actionPrefix}repeat iteration ${i + 1}/${times}`, {
                    depth,
                    actionPath: actionPrefix.trim().replace(/^Action\s+/, ''),
                    stepEvent: 'loop-iteration',
                    loopType: 'repeat',
                    index: i,
                    total: times
                });

                // if dataset exists, cycle through it
                let item = (items && items.length)
                    ? items[i % items.length]
                    : {value: String(i + 1)};

                // Normalize string items so {var:value} works
                if (typeof item === 'string') {
                    item = {value: item};
                }

                // Now compute value reliably for both object + string inputs
                const value =
                    (item && typeof item === 'object' && isNonEmptyString(item.value))
                        ? String(item.value)
                        : '';

                const prepared = action.actions
                    .filter(s => !isDisabled(s));

                // Per-iteration scope (includes dataset item variables)
                ctx.pushVarScope({index: i, oneBased: i + 1, total: times, item, value});

                // make per-iteration locals so {var:value} works even if localVars already has "value"
                const iterLocalVars = Object.assign(Object.create(null), localVars || {}, {
                    index: i,
                    oneBased: i + 1,
                    total: times,
                    item,
                    value
                });

                // OrderKey scoping (repeat iteration)
                const _prevIterationIndex = ctx._iterationIndex;
                const _prevScanCounter = ctx._scanCounter;
                const _prevArtifactCounter = ctx._artifactCounter;
                const _prevScanStride = ctx._scanStride;
                const _prevIterVars = ctx._iterVars;

                ctx._iterationIndex = i;
                ctx._scanCounter = 0;
                ctx._artifactCounter = 0;
                ctx._scanStride = null;
                ctx._iterVars = {index: i, total: times};

                try {
                    await applyActions(page, prepared, null, 0, ctx, iterLocalVars, depth + 1, actionPathPrefix);
                } catch (err) {
                    if (err && err._wfCancelled) throw err;

                    const actionPrefix = formatActionPrefix(actionPathPrefix);

                    if (err && err._wfSkipIteration) {
                        pushLog(ctx, 'info', `${actionPrefix}repeat iteration ${i + 1}/${times} skipped`, {
                            depth,
                            actionPath: actionPrefix.trim().replace(/^Action\s+/, '')
                        });
                        continue;
                    }

                    iterationErrors += 1;
                    const msg = String(err && err.message ? err.message : err);

                    recordIterationFailure(ctx, {
                        iteratorType: 'repeat',
                        iteratorLabel: action.label || null,
                        iterationIndex: i,
                        iterationOneBased: i + 1,
                        iterationTotal: times,
                        error: msg,
                        url: safePageUrl(page) || null
                    });

                    pushLog(ctx, 'error', `${actionPrefix}repeat iteration ${i + 1}/${times} failed, continuing: ${msg}`, {
                        depth,
                        actionPath: actionPrefix.trim().replace(/^Action\s+/, '')
                    });

                    if (!continueOnIterationError) throw err;
                    continue;
                } finally {
                    // restore orderKey context
                    ctx._iterationIndex = _prevIterationIndex;
                    ctx._scanCounter = _prevScanCounter;
                    ctx._artifactCounter = _prevArtifactCounter;
                    ctx._scanStride = _prevScanStride;
                    ctx._iterVars = _prevIterVars;

                    ctx.popVarScope();
                }
            }
            break;
        }

        case 'screenshot': {
            if (ctx?.dryRun) {
                pushLog(ctx, 'info', 'Dry run: screenshot not taken');
                break;
            }
            const label = isNonEmptyString(action.label)
                ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
                : null;
            const preserveHover = toBool(action && action.preserveHover);

            // Deterministic ordering metadata for screenshot actions.
            // This uses the same per-iteration ordered counter as scans, so the UI can
            // interleave screenshots and scans in the "as-if concurrency = 1" order.
            if (typeof ctx._artifactCounter !== 'number') ctx._artifactCounter = 0;
            const _iterIdx =
                (typeof ctx._iterationIndex === 'number') ? ctx._iterationIndex :
                    (ctx && ctx._iterVars && typeof ctx._iterVars.index === 'number') ? ctx._iterVars.index :
                        null;
            const _artifactIdx = ctx._artifactCounter++;
            const _orderKey = `${_iterIdx !== null ? String(_iterIdx).padStart(6, '0') : 'main'}:${String(_artifactIdx).padStart(4, '0')}`;
            const _scanId = (_iterIdx !== null) ? `shot-${_iterIdx + 1}-${_artifactIdx + 1}` : `shot-main-${_artifactIdx + 1}`;


            const viewport = await page.evaluate(() => ({
                width: window.innerWidth,
                height: window.innerHeight
            }));
            const viewportRatio = viewport.width / viewport.height;

            if (!preserveHover) await clearHoverStateForCapture(page);
            await waitForRenderSettle(page, 300);
            await safeDoubleRAF(page, 500);

            const wantFile = !!ctx?.saveScreenshotFile;

            // Timeout for screenshot capture, avoids rare hangs (especially under concurrency)
            const shotTimeoutMs = Math.max(
                1000,
                Number.isFinite(Number(action?.timeout)) ? Number(action.timeout) : 30000
            );

            const withShotTimeout = async (p, label) => {
                return await Promise.race([
                    p,
                    sleep(shotTimeoutMs).then(() => {
                        throw new Error(`screenshot timeout (${shotTimeoutMs}ms) at ${label}`);
                    })
                ]);
            };

            const shot = await withShotTimeout(
                captureScreenshotArtifact(page, {
                    strategy: 'cdp',
                    type: 'jpeg',
                    quality: 80,
                    output: {
                        buffer: true,
                        file: wantFile
                    },
                    // IMPORTANT: your captureScreenshotArtifact module expects saveFile({buffer, type, mimeType, bytes, suggestedName, meta})
                    saveFile: wantFile ? async ({ buffer, bytes, type, mimeType, suggestedName, meta }) => {
                        // ctx.saveScreenshotFile returns { filePath, publicUrl, bytes }
                        return ctx.saveScreenshotFile({
                            data: buffer,
                            filename: suggestedName || `workflow-shot__${String(_orderKey).replace(/[:]/g, '-') }__${String(_scanId)}__${String(_artifactIdx).padStart(2, '0')}.jpg`,
                            dir: 'workflow',
                            meta: meta || { bytes, type, mimeType, kind: 'workflow-shot', orderKey: _orderKey, scanId: _scanId, iterationIndex: _iterIdx, artifactIndex: _artifactIdx }
                        });
                    } : null,
                    suggestedName: `workflow-shot__${String(_orderKey).replace(/[:]/g, '-') }__${String(_scanId)}__${String(_artifactIdx).padStart(2, '0')}.jpg`,
                    meta: { kind: 'workflow-shot', orderKey: _orderKey, scanId: _scanId, iterationIndex: _iterIdx, artifactIndex: _artifactIdx }
                }),
                'captureScreenshotArtifact'
            );
            const buffer = shot.buffer;
            let currentUrl = null;
            try {
                currentUrl = await ctx.race(page.url(), 'screenshot page.url');
            } catch {
            }
            if (ctx) {
                if (!Array.isArray(ctx.screenshots)) ctx.screenshots = [];
                ctx.screenshots.push({
                    name: label,
                    buffer,
                    // expose normalized artifact metadata for mixed-mode (buffer/file/dataUrl)
                    bytes: shot.bytes,
                    type: shot.type,
                    mimeType: shot.mimeType,
                    dataUrl: shot.dataUrl || null,
                    publicUrl: shot.publicUrl || null,
                    filePath: shot.filePath || null,
                    url: currentUrl,
                    viewportRatio: shot.viewportRatio != null ? shot.viewportRatio : viewportRatio,
                    // ordering metadata
                    scanId: _scanId,
                    orderKey: _orderKey,
                    iterationIndex: _iterIdx,
                    artifactIndex: _artifactIdx,
                    // Only the page's top left: it was larger than a picture can be.
                    ...(shot.clipped === true ? {clipped: true} : {})
                });
            }

            try {
                const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(buffer).toString('base64');

                // Named after the step's label, as evidence captures are.
                const nameTemplate = isNonEmptyString(action?.label) ? action.label : 'Screenshot';

                const iter = (ctx && ctx._iterVars) ? ctx._iterVars : {};

                pushLog(ctx, 'screenshot', 'screenshot taken', {
                    dataUrl,
                    viewportRatio,
                    url: currentUrl,
                    nameTemplate,
                    labelTemplate: label ?? null,

                    // ordering metadata
                    scanId: _scanId,
                    orderKey: _orderKey,
                    iterationIndex: _iterIdx,
                    artifactIndex: _artifactIdx,

                    name: action?.name ?? label,
                    label: label ?? null,
                    title: action?.title ?? null,

                    action: {type: action?.type || 'screenshot', id: action?.id ?? null},

                    index: (typeof iter.index === 'number') ? iter.index : null,
                    oneBased: (typeof iter.index === 'number') ? (iter.index + 1) : null,
                    total: (typeof iter.total === 'number') ? iter.total : null,

                    varsGlobal: {...(ctx.vars || {})}
                });

            } catch {
            }

            break;
        }

        case 'evidenceCapture': {
            if (ctx?.dryRun) {
                pushLog(ctx, 'info', 'Dry run: evidence not captured');
                break;
            }
            await runEvidenceCaptureShared({ page, ctx, localVars, action });
            break;
        }

        case 'a11yScan': {
            const fn = ctx && typeof ctx.handleA11yScanAction === 'function' ? ctx.handleA11yScanAction : null;
            const label = isNonEmptyString(action.label)
                ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx})
                : null;

            if (!fn) {
                // Keep a clear error, because silently ignoring hides bugs and differs by platform/run path.
                const msg = 'a11yScan action encountered but no ctx.handleA11yScanAction handler was provided by the runner';
                pushLog(ctx, 'error', msg, { actionType: action?.type ?? null, label: label });
                throw new Error(msg);
            }


            if(label) action.label = label;

            // "Wait for": the scan starts once this selector is on the page,
            // and visible unless the step says otherwise. Like the Wait for
            // selector step, one that never comes fails the step, rather than
            // scanning the page in a state the step did not ask for.
            const waitSel = isNonEmptyString(action.waitForSelector) ? action.waitForSelector.trim() : null;
            if (waitSel) {
                const waitTimeout = toNumber(action.waitTimeout, 10000);
                const h = await ctx.race(
                    waitForOneDeep(page, waitSel, {visible: action.waitVisible !== false, timeout: waitTimeout}),
                    `a11yScan waitForOneDeep ${waitSel}`
                );
                if (!h) throw new Error(`a11yScan: "${waitSel}" did not appear within ${waitTimeout} ms`);
                try { await h.dispose(); } catch {}
            }

            // Tags support the same token vocabulary as the label, so a single
            // templated tag (e.g. "{var:viewport}") fills in per iteration.
            if (Array.isArray(action.scanTags) || isNonEmptyString(action.scanTags)) {
                action.scanTags = interpolateScanTags(action.scanTags, {localVars, ctx});
            }

            await fn({ page, action, ctx, localVars, depth, actionPathPrefix });
            break;
        }

        case 'crawlQueue': {
            const strategy = isNonEmptyString(action.strategy) ? action.strategy.trim() : 'bfs';
            const maxDepth = Math.max(0, toNumber(action.maxDepth, 2));
            const maxPages = Math.max(1, toNumber(action.maxPages, 30));
            const maxSeconds = Math.max(1, toNumber(action.maxSeconds, 120));
            const perPageDelayMs = Math.max(0, toNumber(action.perPageDelayMs, 200));

            const sameOriginOnly = (action.sameOriginOnly !== false);
            const maxLinksPerPage = Math.max(0, toNumber(action.maxLinksPerPage, 200));

            const queueVar = isNonEmptyString(action.queueVar) ? action.queueVar.trim() : 'crawl.queue';
            const visitedVar = isNonEmptyString(action.visitedVar) ? action.visitedVar.trim() : 'crawl.visited';
            const ns = isNonEmptyString(action.varNs) ? action.varNs.trim() : 'crawl';

            const includePatterns = parsePatternLines(action.include);
            const excludePatterns = parsePatternLines(action.exclude);

            let seeds = null;
            const k = isNonEmptyString(action.seedsVar) ? action.seedsVar.trim() : '';
            const v = k ? ctx.getVar(k) : null;
            if (Array.isArray(v)) seeds = v.map(x => String(x || '').trim()).filter(Boolean);

            const currentUrl = safePageUrl(page);
            if (!seeds || !seeds.length) seeds = currentUrl ? [currentUrl] : [];
            if (!seeds.length) break;

            const baseUrl = currentUrl || seeds[0];
            const baseOrigin = baseUrl ? safeGetOrigin(baseUrl) : null;

            // visited
            const visitedArr = Array.isArray(ctx.getVar(visitedVar)) ? ctx.getVar(visitedVar).slice() : [];
            const visitedSet = new Set(normalizeAndFilterUrls(visitedArr, {
                baseUrl,
                sameOriginOnly: false,
                baseOrigin: null,
                dedupe: true
            }));

            // initial queue
            const seedUrls = normalizeAndFilterUrls(seeds, {baseUrl, sameOriginOnly, baseOrigin, dedupe: true});
            let q = seedUrls.map((u, i) => ({url: u, depth: 0, orderIndex: i}));

            // existing queue merge (strings)
            const existingQ = Array.isArray(ctx.getVar(queueVar)) ? ctx.getVar(queueVar).slice() : [];
            for (const u0 of existingQ) {
                const u = normalizeUrlCandidate(String(u0 || ''), baseUrl);
                if (!u) continue;
                if (sameOriginOnly && baseOrigin && safeGetOrigin(u) !== baseOrigin) continue;
                if (visitedSet.has(u)) continue;
                if (q.some(x => x.url === u)) continue;
                q.push({url: u, depth: 0, orderIndex: q.length});
            }

            ctx.setVar(queueVar, q.map(x => x.url));
            ctx.setVar(visitedVar, Array.from(visitedSet));

            const pageActions = Array.isArray(action.actions) ? action.actions : [];
            const prevIter = ctx._iterVars || null;

            // Number of a11yScan actions per crawl iteration.
            // Used to derive a stable global scan id in the form scan-1..scan-N,
            // matching the order the scans would have with concurrency = 1.
            const scanStride = Array.isArray(pageActions)
                ? pageActions.filter((s) => s && s.type === 'a11yScan').length
                : 0;

            // Number of "ordered artifacts" per crawl iteration (a11yScan + screenshot).
            // Used to assign deterministic ordering metadata across scans and screenshots,
            // matching the order the actions would have with concurrency = 1.
            const artifactStride = Array.isArray(pageActions)
                ? pageActions.filter((s) => s && (s.type === 'a11yScan' || s.type === 'screenshot')).length
                : 0;

            const t0 = Date.now();
            let index = 0;

            const concurrency = clampConcurrency(action.concurrency);
            const isolation = (action.isolation === 'context') ? 'context' : 'page';
            const closeWorkerPages = (action.closeWorkerPages !== false); // default true

            // Track active workers
            const active = new Set();

            // Allow coordinator to force-stop active workers (used on cancel)
            const activeCleanup = new Map(); // entry -> async () => void
            const mergeDiscoveredIntoQueue = (res) => {
                if (!res) return;

                if (res.ok && Array.isArray(res.discovered) && res.discovered.length) {
                    for (const u of res.discovered) {
                        if (visitedSet.has(u)) continue;
                        if (q.some(x => x.url === u)) continue;
                        q.push({url: u, depth: res.item.depth + 1});
                    }
                    ctx.setVar(queueVar, q.map(x => x.url));
                }
            };

            const scheduleOne = async (item, workerIndex, entry) => {
                const worker = await createCrawlWorkerTarget(page, ctx, {
                    isolation,
                    inheritViewport: true
                });

                const workerPage = worker.workerPage;
                const workerCtx = createChildContext(ctx);
                workerCtx.bindAbortToPage?.(workerPage);

                // Register cleanup so coordinator can stop this worker on cancel/timeout
                if (entry) {
                    activeCleanup.set(entry, async () => {
                        try {
                            if (workerPage && !workerPage.isClosed()) await workerPage.close().catch(() => {});
                        } catch {}
                        try {
                            if (worker.workerContext) await worker.workerContext.close().catch(() => {});
                        } catch {}
                    });
                }

                // Ensure worker sees the same cancellation state as the parent
                workerCtx.checkCancel = ctx.checkCancel ? ctx.checkCancel.bind(ctx) : workerCtx.checkCancel;
                workerCtx.isCancelled = ctx.isCancelled ? ctx.isCancelled.bind(ctx) : workerCtx.isCancelled;
                workerCtx.abortSignal = ctx.abortSignal || workerCtx.abortSignal || null;

                // Deterministic scan ordering metadata for this queue item.
                // Use the deterministic scheduling index (workerIndex), not completion order.
                workerCtx._iterationIndex = (typeof workerIndex === 'number' ? workerIndex : null);
                workerCtx._scanCounter = 0;
                workerCtx._scanStride = (scanStride > 0 ? scanStride : null);
                workerCtx._artifactCounter = 0;
                workerCtx._artifactStride = (artifactStride > 0 ? artifactStride : null);

                // Each worker has its own var scope and iteration vars
                const prevIter = workerCtx._iterVars || null;
                workerCtx.pushVarScope();
                workerCtx._iterVars = {index: workerIndex, total: maxPages};

                try {
                    workerCtx.checkCancel?.('crawlQueue worker start');
                    workerCtx.setVar(ns + '_url', item.url);
                    workerCtx.setVar(ns + '_depth', item.depth);
                    workerCtx.setVar(ns + '_index', workerIndex);
                    workerCtx.setVar(ns + '_total', maxPages);

                    // --- Navigate to the crawl target URL ---
                    const navTimeout = toNumber(action.timeout, 60000);
                    const waitUntil = normalizeWaitUntil(action.waitUntil || 'domcontentloaded');

                    workerCtx.checkCancel?.('crawlQueue before navigate');
                    await runActionAction(workerPage, {
                        type: 'navigate',
                        url: item.url,
                        waitUntil,
                        timeout: navTimeout
                    }, workerCtx, null, depth + 1, actionPathPrefix);

                    // Optional readiness selector
                    if (isNonEmptyString(action.waitForSelector)) {
                        const wSel = action.waitForSelector.trim();
                        const wVisible = action.waitVisible !== false;
                        const wTimeout = toNumber(action.waitTimeout, 15000);
                        await workerCtx.race(
                            waitForSel(workerPage, wSel, {visible: wVisible, timeout: wTimeout}),
                            `crawlQueue waitForSel ${wSel}`
                        ).catch(() => {
                        });
                    }

                    // Enforce origin + include/exclude on the final URL after redirects
                    let finalUrl = safePageUrl(workerPage) || item.url;

                    // 1) Enforce sameOriginOnly against the baseOrigin (seed origin)
                    if (sameOriginOnly && baseOrigin && safeGetOrigin(finalUrl) !== baseOrigin) {
                        pushLog(ctx, 'info', `crawlQueue: skipping page outside origin: ${finalUrl}`, {depth});
                        // Do not run actions, do not discover links
                        return {ok: true, item, discovered: []};
                    }

                    // 2) Re-apply include/exclude patterns on the final URL
                    if (includePatterns.length || excludePatterns.length) {
                        let ok = true;
                        if (includePatterns.length) ok = includePatterns.some(p => testPattern(p, finalUrl));
                        if (ok && excludePatterns.length) ok = !excludePatterns.some(p => testPattern(p, finalUrl));

                        if (!ok) {
                            pushLog(ctx, 'info', `crawlQueue: skipping page outside include/exclude scope: ${finalUrl}`, {depth});
                            return {ok: true, item, discovered: []};
                        }
                    }

                    // Run per-page actions on the worker page
                    const workerPageActions = Array.isArray(action.actions) ? action.actions : [];
                    await applyActions(workerPage, workerPageActions, null, 0, workerCtx, null, depth + 1, actionPathPrefix);

                    // Discover links (returned to main thread for queue merge)
                    let discovered = [];
                    if (item.depth < maxDepth && maxLinksPerPage > 0) {
                        const hrefs = await collectHrefsFromPage(workerPage, {
                            containerSelector: null,
                            linkSelector: 'a[href]',
                            maxLinks: maxLinksPerPage
                        });

                        let found = hrefs.map(h => normalizeUrlCandidate(h, item.url)).filter(Boolean);
                        found = applyIncludeExclude(found, includePatterns, excludePatterns);

                        if (sameOriginOnly && baseOrigin) found = found.filter(u => safeGetOrigin(u) === baseOrigin);

                        found = normalizeAndFilterUrls(found, {
                            baseUrl: item.url,
                            sameOriginOnly: false,
                            baseOrigin: null,
                            dedupe: true
                        });

                        discovered = found;
                    }

                    return {ok: true, item, discovered};
                } catch (e) {
                    const msg = String(e && e.message ? e.message : e);

                    // Treat cancellation / teardown as non-fatal
                    const isCancelish =
                        (e && e._wfCancelled) ||
                        /Navigating frame was detached/i.test(msg) ||
                        /Execution context was destroyed/i.test(msg) ||
                        /Target closed/i.test(msg) ||
                        /Session closed/i.test(msg) ||
                        /LifecycleWatcher terminated/i.test(msg);

                    if (isCancelish) {
                        pushLog(ctx, 'info', `crawl page cancelled: ${msg}`, {depth});
                        return {ok: false, item, discovered: [], error: msg, cancelled: true};
                    }

                    // A Skip iteration step matched: the page is done, not
                    // failed, and its links are not followed.
                    if (e && e._wfSkipIteration) {
                        pushLog(ctx, 'info', 'crawl page skipped (Skip iteration)', {depth, url: item && item.url ? item.url : null});
                        return {ok: true, item, discovered: [], skipped: true};
                    }

                    pushLog(ctx, 'error', `crawl page failed: ${msg}`, {depth});
                    recordIterationFailure(ctx, {
                        iteratorType: 'crawlQueue',
                        iteratorLabel: action.label || null,
                        iterationIndex: workerIndex,
                        iterationOneBased: workerIndex + 1,
                        iterationTotal: maxPages,
                        error: msg,
                        url: item && item.url ? item.url : null,
                        crawlDepth: item && typeof item.depth === 'number' ? item.depth : null
                    });

                    return {ok: false, item, discovered: [], error: msg};
                } finally {
                    if (entry) activeCleanup.delete(entry);

                    workerCtx._iterVars = prevIter;
                    workerCtx.popVarScope();

                    // Cleanup worker targets. Both gated by closeWorkerPages (matching
                    // runForEachElementConcurrent's equivalent cleanup): a context whose page is
                    // kept open must itself stay open too, or the "kept open" page is useless.
                    if (closeWorkerPages) {
                        try {
                            if (workerPage) await workerPage.close().catch(() => {
                            });
                        } catch {
                        }

                        try {
                            if (worker.workerContext) await worker.workerContext.close().catch(() => {
                            });
                        } catch {
                        }
                    }
                }
            };

            while (q.length || active.size) {
                try {
                    ctx.checkCancel?.('crawlQueue loop');
                } catch (e) {
                    // Force-stop all active workers immediately
                    const cleanups = Array.from(activeCleanup.values());
                    for (const fn of cleanups) {
                        try { await fn(); } catch {}
                    }

                    active.clear();
                    activeCleanup.clear();

                    throw e;
                }

                const elapsedSec = (Date.now() - t0) / 1000;
                if (elapsedSec > maxSeconds) {
                    pushLog(ctx, 'warn', `crawl stopped, time budget exceeded (${maxSeconds}s)`, {depth});
                    break;
                }

                // Fill worker slots
                while (q.length && active.size < concurrency && visitedSet.size < maxPages) {
                    const item = (strategy === 'dfs') ? q.pop() : q.shift();
                    if (!item) break;

                    if (visitedSet.has(item.url)) continue;
                    if (item.depth > maxDepth) continue;

                    // include/exclude gate
                    let ok = true;
                    if (includePatterns.length) ok = includePatterns.some(p => testPattern(p, item.url));
                    if (ok && excludePatterns.length) ok = !excludePatterns.some(p => testPattern(p, item.url));
                    if (!ok) {
                        pushLog(ctx, 'info', `crawlQueue: skipping by include/exclude: ${item.url}`, {depth});
                        continue;
                    }

                    // Mark visited at scheduling time to avoid duplicates across workers
                    visitedSet.add(item.url);
                    ctx.setVar(visitedVar, Array.from(visitedSet));

                    const thisIndex = index++;
                    ctx.setVar(queueVar, q.map(x => x.url));

                    // Start worker
                    const entry = {};

                    // Hard watchdog so one stuck worker cannot stall the crawl
                    const perItemTimeoutMs = Math.max(
                        1000,
                        toNumber(action.perItemTimeoutMs, (toNumber(action.timeout, 60000) + 60000))
                    );

                    const workerPromise = scheduleOne(item, thisIndex, entry);

                    // Both racers below must be stopped once the worker itself settles - otherwise
                    // (the common case: the worker finishes normally, well before perItemTimeoutMs)
                    // they leak: the poll loop spins forever (one per scheduled item, for the life
                    // of the process) and the raw setTimeout behind timeoutPromise keeps a handle
                    // alive for up to perItemTimeoutMs (2 minutes by default) for no reason.
                    // workerSettled/clearTimeout are what let them notice and stop.
                    let workerSettled = false;
                    let timeoutHandle = null;
                    const timeoutPromise = new Promise((resolve) => {
                        timeoutHandle = setTimeout(resolve, perItemTimeoutMs);
                    });
                    workerPromise.then(
                        () => { workerSettled = true; clearTimeout(timeoutHandle); },
                        () => { workerSettled = true; clearTimeout(timeoutHandle); }
                    );

                    const watchdog = Promise.race([
                        timeoutPromise,
                        // if your ctx.race supports abort, this will resolve quickly on cancel:
                        (async () => {
                            while (!workerSettled) {
                                try { ctx.checkCancel?.('crawlQueue watchdog'); } catch { return; }
                                await sleep(250);
                            }
                        })()
                    ]).then(async () => {
                        // If worker is still active, force-stop it before failing
                        const stop = activeCleanup.get(entry);
                        if (stop) {
                            try { await stop(); } catch {}
                        }
                        throw new Error(`crawlQueue: per-item timeout exceeded (${perItemTimeoutMs}ms) for ${item.url}`);
                    });

                    entry.p = Promise.race([workerPromise, watchdog])
                        .then((res) => ({res, thisIndex, entry}))
                        .catch((err) => ({
                            res: {
                                ok: false,
                                item,
                                discovered: [],
                                error: String(err && err.message ? err.message : err),
                                cancelled: !!(err && err._wfCancelled)
                            },
                            thisIndex,
                            entry
                        }));

                    active.add(entry);

                    // Small delay between scheduling bursts if configured
                    if (perPageDelayMs) await sleep(perPageDelayMs);
                }

                if (!active.size) break;

                // Wait for the next worker to finish
                const finished = await Promise.race(Array.from(active).map(x => x.p));
                if (finished && finished.entry) active.delete(finished.entry);
                const {res} = finished || {};

                if (!res) continue;

                mergeDiscoveredIntoQueue(res);
            }

            // Drain remaining workers if we broke due to time budget or max pages
            if (active.size) {
                const remaining = Array.from(active);
                for (const entry of remaining) {
                    try {
                        const finished = await entry.p;
                        if (finished && finished.res) mergeDiscoveredIntoQueue(finished.res);
                    } catch {
                    }
                }
                active.clear();
            }

            ctx._iterVars = prevIter;

            ctx.setVar(queueVar, q.map(x => x.url));
            ctx.setVar(visitedVar, Array.from(visitedSet));
            pushLog(ctx, 'info', `crawl finished: visited ${visitedSet.size}, remaining queue ${q.length}`, {depth});
            break;
        }

        case 'injectCss': {
            let rawCss = isNonEmptyString(action.css)
                ? interpolateVarTokensLoose(String(action.css), { localVars, ctx })
                : '';

            rawCss = forceImportant(rawCss);

            if (!rawCss) {
                if (action.optional) break;
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
                    break;
                }
                throw err;
            }

            break;
        }

        default:
            // A step the engine does not have used to be skipped without a
            // word, so a typo in a hand-written or generated workflow went
            // unnoticed and the run reported less than it was asked for.
            throw new Error(`Unknown step type "${action.type}": the engine has no such step`);
    }
}

/**
 * Execute a list of actions sequentially.
 * Disabled actions are skipped early with a log entry and a actionResults row.
 * @param {import('puppeteer').Page} page
 * @param {Array<object>} actions
 * @param {Array<object>|undefined} actionResults
 * @param {number} startIndex
 * @param {object} ctx
 * @param {object|null} localVars
 * @param {number} depth
 */

async function applyActions(
    page,
    actions = [],
    actionResults,
    startIndex = 0,
    ctx,
    localVars = null,
    depth = 0,
    actionPathPrefix = null
) {
    const safeActions = cloneDeep(actions);
    return _applyActionsImpl(page, safeActions, actionResults, startIndex, ctx, localVars, depth, actionPathPrefix);
}

async function _applyActionsImpl(page, actions = [], actionResults, startIndex = 0, ctx, localVars = null, depth = 0, actionPathPrefix = null) {
    if (!Array.isArray(actions) || !actions.length) return;
    const context = ctx || createWorkflowContext();
    context.bindAbortToPage?.(page);

    const normalizedPrefix = Array.isArray(actionPathPrefix)
        ? actionPathPrefix.filter((n) => Number.isFinite(n) && n > 0)
        : [];

    const computeActionResultsLabel = (actionObj) => {
        const template =
            isNonEmptyString(actionObj?.__rawLabel) ? actionObj.__rawLabel :
                isNonEmptyString(actionObj?.label) ? actionObj.label :
                    null;

        if (template) {
            // IMPORTANT: interpolate {var:...} using the *current* ctx/vars for this iteration
            const interpolated = interpolateVarTokensLoose(template, {localVars, ctx: context});
            if (isNonEmptyString(interpolated)) return interpolated;
        }

        // Fallback to the existing display logic
        return resolveDisplayLabel(actionObj?.__rawLabel, actionObj?.label, localVars, context);
    };

    for (let localIndex = 0; localIndex < actions.length; localIndex += 1) {
        const action = actions[localIndex];
        context?.checkCancel?.(`before action ${localIndex} (${action.type})`);
        if (!action || !action.type) continue;

        const index = startIndex + localIndex;
        const actionPathArr = normalizedPrefix.concat([localIndex + 1]);
        const actionPath = actionPathArr.join('.');
        const isOptional = !!action.optional;

        // If disabled, record and continue, never descend into nested items
        if (isDisabled(action)) {
            const baseLabel = isNonEmptyString(action.label) ? action.label : (action.type || 'action');
            pushLog(context, 'info', `Action ${actionPath} (${baseLabel}) is disabled, skipped`, {
                depth,
                actionPath,
                actionType: action.type,
                stepEvent: 'action-skipped'
            });
            if (Array.isArray(actionResults)) {
                const rawTemplate = isNonEmptyString(action?.__rawLabel) ? action.__rawLabel : (isNonEmptyString(action?.label) ? action.label : null);
                const display = resolveDisplayLabel(rawTemplate, action.label || null, localVars, context);
                actionResults.push({
                    index,
                    type: action.type,
                    label: display,
                    optional: isOptional,
                    status: 'skipped-disabled',
                    durationMs: 0,
                    actionPath
                });
                try { context._partialOut = snapshotPartialOut(context, actionResults || []); } catch {}
            }
            continue;
        }

        const startedAt = Date.now();
        let actionToRun = null;
        // Set once the step has finished without failing; a step that failed
        // may have stopped halfway through acting on the page, so it keeps the
        // pause.
        let skipPause = false;

        let baseLabel = '';
        if (isNonEmptyString(action.label)) {
            baseLabel += interpolateVarTokensLoose(action.label, {localVars, ctx}).trim();
        } else if (isNonEmptyString(action.alias)) {
            baseLabel += action.alias;
        }
        const stepLabel = baseLabel || null;

        if (isNonEmptyString(action.type)) {
            baseLabel += (baseLabel ? ' - ' : '') + '"' + action.type + '"';
        }

        pushLog(context, 'action-start', `Action ${actionPath} (${baseLabel}) started`, {
            depth,
            actionPath,
            actionType: action.type,
            label: stepLabel,
            stepEvent: 'action-start'
        });

        try {
            const rawLabel = isNonEmptyString(action.label) ? action.label : null;

            // Preserve navigate.url before interpolateAll() runs.
            // interpolateAll() may blank "{var:...}" tokens in some strings.
            let rawUrl = null;
            if (action?.type === 'navigate') {
                rawUrl =
                    (isNonEmptyString(action?.url) ? String(action.url) : null) ||
                    (isNonEmptyString(action?.href) ? String(action.href) : null) ||
                    (isNonEmptyString(action?.targetUrl) ? String(action.targetUrl) : null) ||
                    (isNonEmptyString(action?.urlText) ? String(action.urlText) : null) ||
                    (isNonEmptyString(action?.value) ? String(action.value) : null);
            }

            const iter = context._iterVars || {};
            actionToRun = interpolateAll(action, {
                index: (typeof iter.index === 'number' ? iter.index : undefined),
                total: (typeof iter.total === 'number' ? iter.total : undefined),
                localVars,
                ctx: context
            });

            // Number fields may carry "{var:...}" tokens, which interpolation has
            // just turned into text. Read that text as a number here, once, so
            // every step's number handling sees a real number (or nothing).
            const numberWarnings = coerceNumberFields(actionToRun, action, ACTION_DEFINITIONS[action.type]?.fields);
            for (const w of numberWarnings) {
                pushLog(context, 'warning', `Action ${actionPath} (${action.type}): ${w.message}`, {
                    depth,
                    actionPath,
                    actionType: action.type,
                    field: w.field,
                    rawValue: w.raw ?? null,
                    resolvedValue: w.resolved
                });
            }

            if (rawLabel !== null && actionToRun && typeof actionToRun === 'object') {
                actionToRun.__rawLabel = rawLabel;
            }
            if (rawUrl !== null && actionToRun && typeof actionToRun === 'object') {
                actionToRun.__rawUrl = rawUrl;
            }

            const prevLogCtx = context._logCtx || null;
            context._logCtx = {depth, actionPath};

            try {
                await runActionAction(page, actionToRun, context, localVars, depth, actionPathArr);
            } finally {
                context._logCtx = prevLogCtx;
            }

            if (Array.isArray(actionResults)) {
                const display = computeActionResultsLabel(actionToRun);
                actionResults.push({
                    index,
                    type: action.type,
                    label: display,
                    optional: isOptional,
                    status: 'ok',
                    durationMs: Date.now() - startedAt,
                    actionPath
                });
                try { context._partialOut = snapshotPartialOut(context, actionResults || []); } catch {}
            }

            pushLog(context, 'action-end', `Action ${actionPath} completed in ${Date.now() - startedAt}ms`, {
                depth,
                actionPath,
                actionType: action.type,
                stepEvent: 'action-end'
            });
            skipPause = NO_PAUSE_AFTER_TYPES.has(action.type);
        } catch (err) {

            if (err && err._wfCancelled) {
                // Do NOT log as failure
                throw err;
            }

            const msg = err && err.message ? err.message : String(err);
            // The step that failed, which may be nested in this one: the
            // innermost step's catch runs first and sets it.
            if (err && typeof err === 'object' && !err._wfFailedAt) {
                try { err._wfFailedAt = actionPath; } catch {}
            }
            pushLog(context, 'error', `Action ${actionPath} failed${isOptional ? ' (optional)' : ''}: ${msg}`, {
                depth,
                actionPath,
                actionType: action.type,
                optional: isOptional,
                stepEvent: 'action-failed'
            });

            if (Array.isArray(actionResults)) {
                const display = computeActionResultsLabel(actionToRun);
                actionResults.push({
                    index,
                    type: action.type,
                    label: display,
                    optional: isOptional,
                    status: isOptional ? 'failed-optional' : 'failed',
                    error: msg,
                    // Where in it, when the step that failed is nested ("3.2").
                    ...(err && err._wfFailedAt && err._wfFailedAt !== actionPath ? { failedAt: err._wfFailedAt } : {}),
                    durationMs: Date.now() - startedAt,
                    actionPath
                });
                try { context._partialOut = snapshotPartialOut(context, actionResults || []); } catch {}
            }

            if (!isOptional) {
                try {
                    err._wfFailed = true;
                    err._wfPartialOut = snapshotPartialOut(context, actionResults, {
                        message: String(err?.message || err),
                        actionPath: err?.actionPath ?? null,
                        actionType: err?.actionType ?? (action?.type || null)
                    });
                    context._partialOut = err._wfPartialOut;
                } catch {}

                throw err;
            }
        }

        if (!skipPause) await postStepDelay(context);
    }

    // Emit a single summary at the end of the top-level run
    if (depth === 0) {
        try {
            const summary = summarizeIterationFailures(context);
            context.iterationFailureSummary = summary;

            if (summary.total > 0) {
                pushLog(context, 'summary', `Iteration failures: ${summary.total}`, summary);
            } else {
                pushLog(context, 'summary', 'Iteration failures: 0', summary);
            }
        } catch {
        }
    }
}

/** ------------------------------- keyboard helpers ------------------------------- */

function isCombo(key) {
    return key.includes('+');
}

async function pressKey(page, key) {
    if (!isNonEmptyString(key)) return;

    if (key.includes('+')) {
        const parts = key.split('+').map(k => k.trim());
        const main = parts.pop();

        for (const mod of parts) {
            await page.keyboard.down(normalizeKey(mod));
        }

        await page.keyboard.press(normalizeKey(main));

        for (const mod of parts.reverse()) {
            await page.keyboard.up(normalizeKey(mod));
        }
    } else {
        await page.keyboard.press(normalizeKey(key));
    }
}

function normalizeKey(k) {
    const map = {
        ctrl: 'Control',
        control: 'Control',
        shift: 'Shift',
        alt: 'Alt',
        meta: 'Meta',
        cmd: 'Meta',
        command: 'Meta',
        esc: 'Escape',
        escape: 'Escape',
        enter: 'Enter',
        tab: 'Tab'
    };

    const key = k.trim();
    const lower = key.toLowerCase();
    return map[lower] || key;
}


/**
 * Parse a textarea-like dataset where each non-empty line is one item.
 * - Plain text lines become { value: "<line>" }.
 * - JSON object lines become { ... } with all values normalized to strings.
 * - JSON primitives (string/number/boolean/null) become { value: "<string>" }.
 * - Lines starting with # or // are treated as comments.
 */

function tryParseJsonishObjectLine(line) {
    // Only attempt on object-literal-looking lines
    if (typeof line !== 'string') return null;
    const s = line.trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;

    // Basic safety gate: refuse obviously "code-like" inputs
    // (keeps this as data, not an expression evaluator)
    if (/[();`\\]/.test(s)) return null;

    // Quote unquoted identifier keys: {jarl: 1, foo_bar: "x"} -> {"jarl": 1, "foo_bar": "x"}
    const withQuotedKeys = s.replace(
        /([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,
        '$1"$2"$3'
    );

    // Optional: single-quoted strings -> double-quoted strings
    // 'abc' -> "abc" (simple form, avoids trying to fully implement JS string rules)
    const withDoubleQuotes = withQuotedKeys.replace(
        /:\s*'([^'\\]*(?:\\.[^'\\]*)*)'\s*([,}])/g,
        (m, inner, tail) => `:"${inner.replace(/"/g, '\\"')}"${tail}`
    );

    // Quote bareword values, including tokens that start with digits.
    // Examples:
    //   {a: rerere}      -> {"a":"rerere"}
    //   {a: 12asdfasd}   -> {"a":"12asdfasd"}
    // Leaves numbers, true/false/null, and already-quoted strings untouched.
    const withQuotedBareValues = withDoubleQuotes.replace(
        /:\s*([^\s",}\]]+)(\s*[,\}])/g,
        (m, token, tail) => {
            // JSON literals
            if (token === 'true' || token === 'false' || token === 'null') return `:${token}${tail}`;

            // number (int/float, optional leading minus)
            if (/^-?\d+(\.\d+)?$/.test(token)) return `:${token}${tail}`;

            // anything else becomes a string
            return `:"${String(token).replace(/"/g, '\\"')}"${tail}`;
        }
    );

    try {
        const parsed = JSON.parse(withQuotedBareValues);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return null;
    } catch {
        return null;
    }
}


function parseRepeatItemsText(text) {
    const raw = (typeof text === 'string') ? text : '';
    const lines = raw.split(/\r?\n/);
    const out = [];

    for (const line0 of lines) {
        const line = (typeof line0 === 'string') ? line0.trim() : '';
        if (!line) continue;
        if (line.startsWith('#') || line.startsWith('//')) continue;

        // Try JSON per-line when it looks like JSON
        const looksJson = line.startsWith('{') || line.startsWith('[') || line.startsWith('"');
        if (looksJson) {
            try {
                let parsed;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    // Fallback: allow {jarl: 112121} style "JSON-ish" objects
                    parsed = tryParseJsonishObjectLine(line);
                    if (parsed == null) throw new Error('jsonish-parse-failed');
                }

                // object => item vars
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const obj = {};
                    for (const k of Object.keys(parsed)) {
                        const v = parsed[k];
                        if (v === null || typeof v === 'undefined') obj[k] = '';
                        else if (typeof v === 'string') obj[k] = v;
                        else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') obj[k] = String(v);
                        else {
                            try {
                                obj[k] = JSON.stringify(v);
                            } catch {
                                obj[k] = String(v);
                            }
                        }
                    }
                    out.push(obj);
                    continue;
                }

                // primitive / array => { value: "..." }
                if (parsed === null || typeof parsed === 'undefined') {
                    out.push({value: ''});
                    continue;
                }
                if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean' || typeof parsed === 'bigint') {
                    out.push({value: String(parsed)});
                    continue;
                }
                try {
                    out.push({value: JSON.stringify(parsed)});
                } catch {
                    out.push({value: String(parsed)});
                }
                continue;
            } catch {
                // fall through to plain text
            }
        }

        out.push({value: line});
    }

    return out;
}

/** ------------------------------- crawl helpers ------------------------------- */

function safeGetOrigin(u) {
    try {
        return new URL(String(u)).origin;
    } catch {
        return null;
    }
}

/** ------------------------------- query helpers ------------------------------- */

async function queryOneDeep(page, selector) {
    // 1) normal DOM
    const direct = await page.$(selector).catch(() => null);
    if (direct) return direct;

    // 2) open shadow DOM deep search
    const h = await page.evaluateHandle((sel) => {
        const isElement = (x) => x && x.nodeType === 1;

        const match = (root) => {
            try { return root.querySelector(sel); } catch { return null; }
        };

        const walk = (root) => {
            // Start at documentElement to avoid weirdness with Document as a node
            const start = root.documentElement || root.body || root;
            const stack = [start];

            while (stack.length) {
                const node = stack.pop();
                if (!node) continue;

                // Try matching within this subtree root (cheap first)
                const found = match(node === start ? root : node);
                if (found) return found;

                // Traverse open shadow roots
                if (isElement(node) && node.shadowRoot) {
                    const inShadow = match(node.shadowRoot);
                    if (inShadow) return inShadow;
                    stack.push(node.shadowRoot);
                }

                // Traverse element children
                if (isElement(node) && node.children && node.children.length) {
                    for (let i = node.children.length - 1; i >= 0; i--) {
                        stack.push(node.children[i]);
                    }
                }
            }
            return null;
        };

        return walk(document);
    }, selector);

    const el = h?.asElement?.() || null;
    if (!el) {
        try { await h.dispose(); } catch {}
        return null;
    }
    return el;
}

// How long a forEachElement loop that has already run looks for more targets
// before taking it that none are left (see the loop's own check).
const LOOP_END_CHECK_MS = 1000;

async function waitForOneDeep(page, selector, { timeout = 10000, visible = false } = {}) {
    const t0 = Date.now();
    while (true) {
        const h = await queryOneDeep(page, selector);
        if (h) {
            if (!visible) return h;

            const ok = await h.evaluate((el) => {
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
            }).catch(() => false);

            if (ok) return h;
            try { await h.dispose(); } catch {}
        }

        if (Date.now() - t0 > timeout) return null;
        await new Promise(r => setTimeout(r, 150));
    }
}

async function safeDoubleRAF(page, timeoutMs = 500) {
    try {
        await Promise.race([
            page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))),
            new Promise(resolve => setTimeout(resolve, timeoutMs))
        ]);
    } catch {
    }
}

async function clearHoverStateForCapture(page) {
    if (!page) return;

    let moved = false;
    try {
        const target = (typeof page.target === 'function') ? page.target() : null;
        const createCDP = target && (typeof target.createCDPSession === 'function')
            ? target.createCDPSession.bind(target)
            : null;
        if (createCDP) {
            const cdp = await createCDP();
            try {
                await cdp.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: -1,
                    y: -1,
                    button: 'none',
                    buttons: 0
                });
                moved = true;
            } finally {
                try { await cdp.detach(); } catch {}
            }
        }
    } catch {}

    if (moved) return;

    try {
        if (page.mouse && typeof page.mouse.move === 'function') {
            const vp = (typeof page.viewport === 'function') ? page.viewport() : null;
            const x = (vp && Number.isFinite(vp.width) && vp.width > 1) ? (vp.width - 1) : 1;
            const y = (vp && Number.isFinite(vp.height) && vp.height > 1) ? (vp.height - 1) : 1;
            await page.mouse.move(x, y);
        }
    } catch {}
}

async function waitForOneDeepOrThrow(page, selector, {timeout = 10000, visible = false} = {}) {
    const h = await waitForOneDeep(page, selector, {timeout, visible});
    if (!h) {
        throw new Error(`Selector not found (open shadow DOM aware): ${selector}`);
    }
    return h;
}

/** Normalize a candidate URL (relative or absolute) against a base. Returns absolute URL string, without hash. */
/** Whether a url is a web page's (http or https), the only ones a run opens. */
function isWebUrl(raw) {
    try {
        const { protocol } = new URL(String(raw || '').trim());
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

function normalizeUrlCandidate(raw, baseUrl) {
    try {
        const s = String(raw || '').trim();
        if (!s) return null;
        if (s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('javascript:')) return null;
        const abs = baseUrl ? new URL(s, baseUrl) : new URL(s);
        // Web pages only: a crawled page's links to file: urls had the crawl
        // open the server's own files.
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
        abs.hash = '';
        // normalize trailing slash (except root)
        let out = abs.toString();
        if (out.endsWith('/') && abs.pathname !== '/' && !abs.search) out = out.slice(0, -1);
        return out;
    } catch {
        return null;
    }
}

function parsePatternLines(text) {
    if (!isNonEmptyString(text)) return [];
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(compilePattern);
}

function compilePattern(pat) {
    // /regex/flags
    if (pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
        const last = pat.lastIndexOf('/');
        const body = pat.slice(1, last);
        const flags = pat.slice(last + 1);
        try {
            return {type: 'regex', re: new RegExp(body, flags || undefined), raw: pat};
        } catch {
        }
    }
    // wildcard * and ?
    return {type: 'wild', raw: pat};
}

function testPattern(patObj, url) {
    if (!patObj) return false;
    if (patObj.type === 'regex') {
        try {
            return patObj.re.test(url);
        } catch {
            return false;
        }
    }
    // simple wildcard matching
    const esc = (s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
    const rx = '^' + esc(patObj.raw).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$';
    try {
        return new RegExp(rx, 'i').test(url);
    } catch {
        return false;
    }
}

function applyIncludeExclude(urls, includePatterns, excludePatterns) {
    let out = Array.isArray(urls) ? urls.slice() : [];
    if (includePatterns && includePatterns.length) {
        out = out.filter(u => includePatterns.some(p => testPattern(p, u)));
    }
    if (excludePatterns && excludePatterns.length) {
        out = out.filter(u => !excludePatterns.some(p => testPattern(p, u)));
    }
    return out;
}

function normalizeAndFilterUrls(urls, {baseUrl, sameOriginOnly, baseOrigin, dedupe}) {
    let out = (Array.isArray(urls) ? urls : []).map(u => normalizeUrlCandidate(u, baseUrl)).filter(Boolean);
    if (sameOriginOnly && baseOrigin) out = out.filter(u => safeGetOrigin(u) === baseOrigin);
    if (dedupe) {
        const seen = new Set();
        out = out.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
    }
    return out;
}

async function collectHrefsFromPage(page, {containerSelector = null, linkSelector = 'a[href]', maxLinks = 500} = {}) {
    const lim = Math.max(0, Number(maxLinks) || 0);
    try {
        return await page.evaluate((containerSel, linkSel, limit) => {
            const root = containerSel ? document.querySelector(containerSel) : document;
            if (!root) return [];
            const els = Array.from(root.querySelectorAll(linkSel));
            const out = [];
            for (const el of els) {
                const href = el.getAttribute('href') || '';
                if (!href) continue;
                out.push(href);
                if (limit && out.length >= limit) break;
            }
            return out;
        }, containerSelector, linkSelector, lim);
    } catch {
        return [];
    }
}

function sampleUrlList(urls, {strategy, limit, seed} = {}) {
    const list = Array.isArray(urls) ? urls.slice() : [];
    const lim = Math.max(0, Number(limit) || 0);
    if (!list.length) return [];
    if (strategy === 'firstN') return lim ? list.slice(0, lim) : list;

    if (strategy === 'random') {
        // deterministic LCG shuffle
        let x = Number(seed) || 1;
        const rnd = () => {
            x = (1103515245 * x + 12345) % 2147483648;
            return x / 2147483648;
        };
        const arr = list.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return lim ? arr.slice(0, lim) : arr;
    }

    const keyFn = (u) => {
        try {
            const url = new URL(u);
            const segs = url.pathname.split('/').filter(Boolean);
            if (strategy === 'byFirstSegment') {
                return (segs[0] || '') + '|' + url.origin;
            }
            // byPathTemplate: replace ids/numbers and long hex chunks with :id
            const normSegs = segs.map(s => {
                if (/^\d+$/.test(s)) return ':id';
                if (/^[0-9a-fA-F]{8,}$/.test(s)) return ':id';
                if (/^[0-9a-fA-F-]{12,}$/.test(s)) return ':id';
                return s.toLowerCase();
            });
            return normSegs.join('/') + '|' + url.origin;
        } catch {
            return u;
        }
    };

    const groups = new Map();
    for (const u of list) {
        const k = keyFn(u);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(u);
    }
    const picked = [];
    for (const arr of groups.values()) {
        picked.push(arr[0]);
        if (lim && picked.length >= lim) break;
    }
    return lim ? picked.slice(0, lim) : picked;
}

module.exports = {
    ACTION_DEFINITIONS,
    createWorkflowContext,
    applyActions,
    runEvidenceCaptureShared,
    countPlannedArtifacts,
    buildViewportFromPreset,
    resolveZoomFactor,
    applyZoomToViewport,
    clearHoverStateForCapture,
    applyRunConditions
};