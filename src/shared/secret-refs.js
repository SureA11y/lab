'use strict';

/**
 * secret-refs.js (shared)
 *
 * A secret field (a setPassword step's value) can hold a reference instead
 * of the secret itself:
 *
 *   { "type": "setPassword", "labelText": "Password", "value": { "$env": "SHOP_PASSWORD" } }
 *
 * so a spec that logs in can be saved, shared and run unattended with no
 * password in it. Whatever runs the workflow (the command line, the server,
 * the queue) resolves the reference from its own environment as the run
 * starts, and hands the value to the browser only: the workflow written to
 * the report, the log and any saved configuration keeps the reference.
 *
 * Only `$env` for now; a secrets file or a vault would be another key in the
 * same object.
 *
 * Browser: available as globalThis.A11Y_SECRET_REFS.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SECRET_REFS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const ENV_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';
    const ENV_NAME_RE = new RegExp(ENV_NAME_PATTERN);

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    /** True for { "$env": "NAME" } and nothing else. */
    function isSecretRef(value) {
        return isPlainObject(value)
            && Object.keys(value).length === 1
            && typeof value.$env === 'string'
            && ENV_NAME_RE.test(value.$env);
    }

    /** The environment variables a workflow's steps name, each once, in order. */
    function secretRefNames(value, into = []) {
        if (isSecretRef(value)) {
            if (!into.includes(value.$env)) into.push(value.$env);
        } else if (Array.isArray(value)) {
            for (const v of value) secretRefNames(v, into);
        } else if (isPlainObject(value)) {
            for (const v of Object.values(value)) secretRefNames(v, into);
        }
        return into;
    }

    function replaceRefs(value, env) {
        if (isSecretRef(value)) return String(env[value.$env]);
        if (Array.isArray(value)) return value.map((v) => replaceRefs(v, env));
        if (isPlainObject(value)) {
            const out = {};
            for (const [k, v] of Object.entries(value)) out[k] = replaceRefs(v, env);
            return out;
        }
        return value;
    }

    /**
     * `value` (steps, custom steps) with every reference replaced by its
     * variable's value from `env`: -> { value, missing }, `missing` the names
     * `env` does not set (an empty value counts as unset), and `value` null
     * when there are any. `value` is a copy; the original keeps its references.
     */
    function resolveSecretRefs(value, env) {
        const source = env && typeof env === 'object' ? env : {};
        const names = secretRefNames(value);
        const missing = names.filter((name) => typeof source[name] !== 'string' || source[name] === '');
        if (missing.length) return { value: null, missing };
        return { value: names.length ? replaceRefs(value, source) : value, missing };
    }

    /** "SHOP_PASSWORD is not set" / "A and B are not set", for a message. */
    function describeMissing(missing) {
        const names = missing.map((n) => `$${n}`);
        const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        return `${list} ${names.length === 1 ? 'is' : 'are'} not set in the environment`;
    }

    return {
        ENV_NAME_PATTERN,
        isSecretRef,
        secretRefNames,
        resolveSecretRefs,
        describeMissing,
    };
}));
