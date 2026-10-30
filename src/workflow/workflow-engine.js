'use strict';

/**
 * Workflow engine to execute declarative actions on a Puppeteer page.
 * Exposes: ACTION_DEFINITIONS, createWorkflowContext, applyActions, countPlannedArtifacts
 */

const {ACTION_DEFINITIONS} = require('./action-definitions');

const {isDisabled, isNonEmptyString, toNumber, cloneDeep} = require('./engine/utils');
const {interpolateVarTokensLoose, interpolateAll, resolveDisplayLabel} = require('./engine/vars');
const {pushLog} = require('./engine/log');
const {parseNumberStrict, hasVarToken, coerceNumberFields} = require('./engine/numbers');
const {buildViewportFromPreset} = require('../shared/scan-inputs.js');
const {clearHoverStateForCapture} = require('./engine/deep-query');
const {parseRepeatItemsText} = require('./engine/repeat-items');
const {applyRunConditions, resolveZoomFactor, applyZoomToViewport} = require('./engine/emulation');
const {summarizeIterationFailures} = require('./engine/iteration-failures');
const {normalizeCustomStepsById} = require('./engine/custom-steps');
const {postStepDelay} = require('./engine/post-step-delay');
const {normalizeEvidenceVariants} = require('./engine/step-helpers');
const {createWorkflowContext} = require('./engine/context');

// What each step type does, one module per kind of step (steps/*.js); a
// step's handler is looked up by its type. The steps that hold steps call
// back into the engine (bindEngine, at the end of this file).
const STEP_MODULES = [
    require('./steps/interaction'),
    require('./steps/page'),
    require('./steps/data'),
    require('./steps/flow'),
    require('./steps/for-each'),
    require('./steps/crawl'),
    require('./steps/capture')
];
const STEPS = Object.assign({}, ...STEP_MODULES.map((m) => m.STEPS));
const {runEvidenceCaptureShared} = require('./steps/capture');

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

    const step = Object.prototype.hasOwnProperty.call(STEPS, action.type) ? STEPS[action.type] : null;
    // A step the engine does not have used to be skipped without a word, so a
    // typo in a hand-written or generated workflow went unnoticed and the run
    // reported less than it was asked for.
    if (!step) throw new Error(`Unknown step type "${action.type}": the engine has no such step`);
    return step(page, action, ctx, localVars, depth, actionPathPrefix, selector, timeout);
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

// The steps that hold steps run them through the engine.
for (const m of STEP_MODULES) {
    if (m.bindEngine) m.bindEngine({applyActions, runActionAction});
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