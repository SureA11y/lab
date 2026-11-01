'use strict';

// The steps that read the page into variables or decide on it: get text, get
// a count, set and clear a variable, collect output, and skip an iteration.

const {evaluateConditionPredicate} = require('../engine/conditions');
const {interpolateVarTokensLoose} = require('../engine/vars');
const {isNonEmptyString, toNumber} = require('../engine/utils');
const {pushLog} = require('../engine/log');
const {queryOneDeep} = require('../engine/deep-query');

async function stepGetText(page, action, ctx, localVars) {
    const selector = isNonEmptyString(action.selector) ? action.selector.trim() : '';
    const varName = isNonEmptyString(action.var) ? action.var.trim() : '';
    const doTrim = action.trim !== false;
    const attr = isNonEmptyString(action.attr) ? action.attr.trim() : null;
    const rawAttr = action.rawAttr === true;
    const useInnerText = action.useInnerText === true;

    if (!selector || !varName) return;

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
    if (!elHandle) return;

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
}

async function stepGetCount(page, action, ctx, localVars) {
    const selector = isNonEmptyString(action.selector) ? action.selector.trim() : '';
    const varName = isNonEmptyString(action.var) ? action.var.trim() : '';
    if (!selector || !varName) return;

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
}

async function stepSetVar(page, action, ctx, localVars) {
    const key = isNonEmptyString(action.key) ? action.key.trim() : '';
    if (!key) return;
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
}

async function stepClearVar(_page, action, ctx, localVars) {
    const key = isNonEmptyString(action.key) ? action.key.trim() : '';
    if (!key) return;
    if (localVars && typeof localVars === 'object') delete localVars[key];
    if (ctx && ctx.vars) delete ctx.vars[key];
}

async function stepCollectOutput(page, action, ctx, localVars, _depth, _actionPathPrefix, selector) {
    const key = isNonEmptyString(action.key) ? action.key.trim() : '';
    if (!key) return;

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
        if (!whenOk) return;
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

    if (value === null) return;

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
}

async function stepSkipIteration(page, action, ctx, localVars) {
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
}

const STEPS = {
    'getText': stepGetText,
    'getCount': stepGetCount,
    'setVar': stepSetVar,
    'clearVar': stepClearVar,
    'collectOutput': stepCollectOutput,
    'skipIteration': stepSkipIteration
};

module.exports = {STEPS};
