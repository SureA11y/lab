'use strict';

// A run's context: its variables, options, results and logs, and the child
// context a loop item or a crawled page runs in, sharing what it must with the
// parent.

const {createVarScopes} = require('./vars');
const {normalizeCustomStepsById} = require('./custom-steps');
const {stopLoading} = require('./nav');

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

module.exports = {
    createWorkflowContext,
    createChildContext
};
