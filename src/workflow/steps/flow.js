'use strict';

// The steps that hold other steps and choose which run: a group, a merged
// scan, a custom step, if, if URL, switch and its cases, and repeat.

const {_isVisible, resolveActiveScopeSelector, rewriteCtxTokenShallow, sameAsText} = require('../engine/deep-query');
const {cloneDeep, isDisabled, isNonEmptyString, toNumber} = require('../engine/utils');
const {evaluateUrlCondition} = require('../engine/url-condition');
const {formatActionPrefix} = require('../engine/step-helpers');
const {interpolateScanTags, normalizeExportVarNames, parseJsonObjectInput} = require('../engine/custom-steps');
const {interpolateTemplate, interpolateVarTokensLoose} = require('../engine/vars');
const {lookupVar, pickSwitchCase, readSwitchSubject} = require('../engine/switch-step');
const {parseRepeatItemsText} = require('../engine/repeat-items');
const {pushLog} = require('../engine/log');
const {recordIterationFailure} = require('../engine/iteration-failures');
const {safePageUrl} = require('../engine/nav');

// The engine's own functions these steps call, to run the steps inside them;
// set by the engine when it loads (it requires this module first).
let applyActions;

function bindEngine(engine) {
    ({applyActions} = engine);
}

async function stepGroup(page, action, ctx, localVars, depth, actionPathPrefix) {
    if (!Array.isArray(action.actions) || !action.actions.length) return;
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
}

async function stepMergedScan(page, action, ctx, localVars, depth, actionPathPrefix) {
    if (!Array.isArray(action.actions) || !action.actions.length) return;
    const label = typeof action.label === 'string' && action.label.trim()
        ? interpolateVarTokensLoose(action.label.trim(), {localVars, ctx}).trim()
        : '';
    // Inside another (directly, or through a custom step such as a
    // multi-viewport scan reused here): its scans join the outer one as more
    // of its contexts, so it all reports as the one scan. Its own name and
    // tags are not a scan's; each scan inside keeps its label and tags.
    if (ctx._mergedScan) {
        const outer = ctx._mergedScan.label;
        pushLog(ctx, 'info', `merged scan${label ? `: ${label}` : ''}, part of ${outer ? `the merged scan "${outer}"` : 'the merged scan it is in'}`);
        await applyActions(page, action.actions, null, 0, ctx, localVars, depth + 1, actionPathPrefix);
        return;
    }
    // One key per execution, counted on the root context so workers
    // share it: each iteration of a Repeat is a merged scan of its own.
    const root = ctx._rootCtx || ctx;
    root._mergedScanSeq = (root._mergedScanSeq || 0) + 1;
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
}

async function stepRunCustomStep(page, action, ctx, localVars, depth, actionPathPrefix) {
    const customStepId = String(action.customStepId || action.id || '').trim();
    if (!customStepId) throw new Error('runCustomStep requires customStepId');

    const customStepDef = ctx?.customSteps?.[customStepId];
    if (!customStepDef) throw new Error(`runCustomStep "${customStepId}" was not found`);
    if (!Array.isArray(customStepDef.actions) || !customStepDef.actions.length) return;

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
}

async function stepIf(page, action, ctx, localVars, depth, actionPathPrefix) {
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
}

async function stepIfUrl(page, action, ctx, localVars, depth, actionPathPrefix) {
    // action.value has had its {var:name} tokens filled in already, like
    // every step's fields, when the step was dispatched.
    const outcome = evaluateUrlCondition(await page.url(), action, action.value);
    const part = outcome.part === 'param' ? `param "${String(action.paramName).trim()}"` : outcome.part;
    const actualText = outcome.actual === null ? '(not present)' : JSON.stringify(outcome.actual);
    pushLog(ctx, 'info', `ifUrl: ${part} ${actualText} ${outcome.comparison} ${JSON.stringify(outcome.expected)} -> ${outcome.result}`, {depth});
    await runConditionBranch(page, action, outcome.result, ctx, localVars, depth, actionPathPrefix);
}

async function stepSwitch(page, action, ctx, localVars, depth, actionPathPrefix) {
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
}

async function stepCase() {
    throw new Error('A case step only runs inside a switch, as one of its cases');
}

async function stepRepeat(page, action, ctx, localVars, depth, actionPathPrefix) {
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

    if (!times || !Array.isArray(action.actions) || !action.actions.length) return;

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

const STEPS = {
    'group': stepGroup,
    'mergedScan': stepMergedScan,
    'runCustomStep': stepRunCustomStep,
    'if': stepIf,
    'ifUrl': stepIfUrl,
    'switch': stepSwitch,
    'case': stepCase,
    'repeat': stepRepeat
};

module.exports = {STEPS, bindEngine, runBranchActions, logBranchTaken, runConditionBranch};
