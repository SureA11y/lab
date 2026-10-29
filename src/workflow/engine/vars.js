'use strict';

const { isNonEmptyString, cloneDeep } = require('./utils');

/**
 * Creates a scope stack and a Proxy so existing code using ctx.vars
 * keeps working while writes, reads actually go through the top scope.
 */
function createVarScopes(seedInitial = {}) {
    const scopes = [Object.assign(Object.create(null), seedInitial)];

    const api = {
        pushVarScope(initial = {}) { scopes.push(Object.assign(Object.create(null), initial)); },
        popVarScope() { if (scopes.length > 1) scopes.pop(); },
        setVar(key, value) { scopes[scopes.length - 1][key] = value; },
        clearVar(key) {
            for (const s of scopes) delete s[key];
        },
        getVar(key) {
            for (let i = scopes.length - 1; i >= 0; i--) {
                if (Object.prototype.hasOwnProperty.call(scopes[i], key)) return scopes[i][key];
            }
            return undefined;
        },
        getVarsFlat() {
            const out = Object.create(null);
            for (const s of scopes) Object.assign(out, s);
            return out;
        },
        makeVarsProxy() {
            return new Proxy(Object.create(null), {
                set(_t, k, v) { api.setVar(String(k), v); return true; },
                get(_t, k) {
                    if (k === Symbol.toStringTag) return 'Object';
                    return api.getVar(String(k));
                },
                has(_t, k) { return api.getVar(String(k)) !== undefined; },
                deleteProperty(_t, k) { api.clearVar(String(k)); return true; },
                ownKeys() { return Object.keys(api.getVarsFlat()); },

                getOwnPropertyDescriptor(_t, k) {
                    const key = String(k);
                    const val = api.getVar(key);
                    if (val === undefined) return undefined;
                    return { enumerable: true, configurable: true, writable: true, value: val };
                }
            });
        }
    };

    return api;
}

function rewriteSelectorsWithCtx(actionLike, scopeSel) {
    const clone = cloneDeep(actionLike);
    const visit = (o) => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
            if (k === 'selector' && typeof v === 'string') {
                o[k] = v.includes(':ctx') ? v.replaceAll(':ctx', scopeSel) : v;
            } else if (Array.isArray(v)) {
                v.forEach(visit);
            } else if (v && typeof v === 'object') {
                visit(v);
            }
        }
    };
    visit(clone);
    return clone;
}

function interpolateIndexVars(actionLike, vars) {
    const clone = cloneDeep(actionLike);
    const rep = (s) => {
        if (typeof s !== 'string') return s;
        let out = s;
        if (typeof vars.index === 'number') {
            out = out
                .replaceAll('{index}', String(vars.index))
                .replaceAll('{oneBased}', String(vars.index + 1));
        }
        if (typeof vars.total === 'number') {
            out = out.replaceAll('{total}', String(vars.total));
        }
        return out;
    };
    const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'string') o[k] = rep(v);
            else if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') walk(v);
        }
    };
    walk(clone);
    return clone;
}

function interpolateTemplate(str, { localVars = null, ctx = null, keepUnresolved = false } = {}) {
    if (typeof str !== 'string') return str;

    return str.replace(/\{var:([a-zA-Z_][\w-]*)\}/g, (m, name) => {
        if (localVars && Object.prototype.hasOwnProperty.call(localVars, name)) {
            const v = localVars[name];
            return v == null ? '' : String(v);
        }

        // IMPORTANT: for Proxy-backed ctx.vars, hasOwnProperty works only if getOwnPropertyDescriptor is correct.
        if (ctx && ctx.vars && Object.prototype.hasOwnProperty.call(ctx.vars, name)) {
            const v = ctx.vars[name];
            return v == null ? '' : String(v);
        }

        // Preserve the unresolved token when keepUnresolved is set; otherwise blank it.
        return keepUnresolved ? m : '';
    });
}

function interpolateVarsDeep(obj, { localVars = null, ctx = null } = {}, parentKey = null) {
    if (obj == null) return obj;

    // Do not interpolate dataset-bearing fields (repeat/iterators).
    if (parentKey && (
        parentKey === 'itemsText' ||
        parentKey === 'datasetText' ||
        parentKey === 'items' ||
        parentKey === 'dataset' ||
        parentKey === 'datasetItemsText' ||
        parentKey === 'datasetOnePerLine' ||
        parentKey === 'datasetLines' ||
        parentKey === 'include' ||
        parentKey === 'exclude'
    )) {
        return obj; // leave raw so repeat can resolve per-iteration later
    }

    // Do not recurse into nested action lists: each nested action gets its own
    // interpolation pass, correctly timed, when applyActions actually reaches it.
    // Interpolating them here (while the *container* action - if/forEachElement/
    // group/repeat - is being dispatched) would resolve {var:...} tokens before
    // sibling actions inside that same container (e.g. a getText/setVar earlier
    // in the branch) have run and set them, permanently blanking the token.
    if (parentKey && (
        parentKey === 'actions' ||
        parentKey === 'elseActions' ||
        parentKey === 'defaultActions' ||
        parentKey === 'preActions' ||
        parentKey === 'iterSetupActions'
    )) {
        return obj;
    }

    if (typeof obj === 'string') {
        if (parentKey === 'label') return obj;
        return interpolateTemplate(obj, { localVars, ctx });
    }
    if (Array.isArray(obj)) return obj.map((x) => interpolateVarsDeep(x, { localVars, ctx }, null));
    if (typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            out[k] = interpolateVarsDeep(v, { localVars, ctx }, k);
        }
        return out;
    }
    return obj;
}

function interpolateAll(actionLike, { index, total, localVars = null, ctx = null } = {}) {
    const withIndex = interpolateIndexVars(actionLike, { index, total });
    return interpolateVarsDeep(withIndex, { localVars, ctx });
}

/** Avoid surprises when rendering labels in UIs */
function resolveDisplayLabel(rawTemplate, computed, localVars, ctx) {
    if (isNonEmptyString(rawTemplate)) {
        return interpolateVarTokensLoose(rawTemplate, { localVars, ctx });
    }
    return isNonEmptyString(computed) ? computed : null;
}

function getByPathLoose(obj, path) {
    if (!obj || !path) return undefined;
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function interpolateVarTokensLoose(str, {localVars, ctx} = {}) {
    const s = String(str ?? '');
    return s.replace(/\{var:([a-zA-Z0-9_.-]+)\}/g, (m, name) => {
        // 1) locals first
        if (localVars && typeof localVars === 'object') {
            const v = getByPathLoose(localVars, name);
            if (v !== undefined) return v == null ? '' : String(v);
        }

        // 2) ctx.getVar() (scope stack) next — fixes {var:value} in repeat scopes
        if (ctx && typeof ctx.getVar === 'function' && !String(name).includes('.')) {
            const v1 = ctx.getVar(String(name));
            if (v1 !== undefined) return v1 == null ? '' : String(v1);
        }

        // 3) ctx.vars (Proxy) next
        if (ctx && ctx.vars) {
            const v2 = getByPathLoose(ctx.vars, name);
            if (v2 !== undefined) return v2 == null ? '' : String(v2);
        }

        // 4) last resort: a flattened snapshot
        if (ctx && typeof ctx.getVarsFlat === 'function') {
            const flat = ctx.getVarsFlat() || {};
            const v3 = getByPathLoose(flat, name);
            if (v3 !== undefined) return v3 == null ? '' : String(v3);
        }

        // IMPORTANT: missing vars become empty, not "{var:...}"
        return '';
    });
}
module.exports = {
    createVarScopes,
    rewriteSelectorsWithCtx,
    interpolateIndexVars,
    interpolateTemplate,
    interpolateVarsDeep,
    interpolateVarTokensLoose,
    interpolateAll,
    resolveDisplayLabel
};
