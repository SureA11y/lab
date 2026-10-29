'use strict';

/**
 * batch-rows.js (shared)
 *
 * A batch runs one workflow once per row of a pasted JSON list
 * (docs/design/workflow-queue-batch-design.md §4). This file reads that list and
 * checks it before anything is queued, so a typo shows up as "Row 4: …" next
 * to the box rather than as a failed run halfway through the batch.
 *
 *   [ { "name": "v2.3", "url": "https://…/v2.3", "vars": { "date": "2026-03-01" } }, … ]
 *
 * - name: the run's name, unless a run name pattern is given.
 * - url:  replaces the workflow's starting URL; optional.
 * - vars: starting variables, read by the workflow as {var:date}.
 *
 * Problems that would make a run wrong block the batch. A workflow token no
 * row sets only warns: the workflow may set it itself (Set variable, a loop).
 *
 * Browser: globalThis.A11Y_BATCH_ROWS (load shared/run-spec.js first).
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./run-spec.js'));
    } else {
        root.A11Y_BATCH_ROWS = factory(root.A11Y_RUN_SPEC);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (runSpec) {

    const MAX_ROWS = 500;
    const ROW_FIELDS = ['name', 'url', 'vars'];
    const TOKEN_RE = /\{var:([A-Za-z0-9_.-]+)\}/g;
    // Every loop sets these on each iteration (forEachElement the first three,
    // repeat all five), so inside a loop they would hide a row's value.
    const LOOP_VARIABLE_NAMES = ['index', 'oneBased', 'total', 'item', 'value'];

    // What a step does to a variable it names, for the message.
    const HIDES_BY_STEP = {
        setVar: 'a Set variable step overwrites',
        getText: 'a Get text step overwrites',
        getCount: 'a Get count step overwrites',
        clearVar: 'a Clear variable step removes',
        runCustomStep: 'a call to another custom step overwrites',
    };

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function defaultValidateUrl(url) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error(`"${url}" is not a full URL`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`"${url}" must start with http:// or https://`);
        }
    }

    /** Every {var:name} token in a value, at any depth; dotted names by their root. */
    function collectVarTokens(value, into = new Set()) {
        if (typeof value === 'string') {
            for (const m of value.matchAll(TOKEN_RE)) into.add(m[1].split('.')[0]);
        } else if (Array.isArray(value)) {
            for (const v of value) collectVarTokens(v, into);
        } else if (isPlainObject(value)) {
            for (const v of Object.values(value)) collectVarTokens(v, into);
        }
        return into;
    }

    /** Names the workflow sets itself with Set variable steps, at any depth. */
    function collectSetVarKeys(value, into = new Set()) {
        if (Array.isArray(value)) {
            for (const v of value) collectSetVarKeys(v, into);
        } else if (isPlainObject(value)) {
            if (value.type === 'setVar' && typeof value.key === 'string' && value.key.trim()) {
                into.add(value.key.trim());
            }
            for (const v of Object.values(value)) collectSetVarKeys(v, into);
        }
        return into;
    }

    /**
     * Steps that would hide or remove one of `names`, at any depth:
     * [{ does, name }]. Mirrors the step editor's field errors, for custom
     * steps the editor is not showing.
     */
    function stepsHidingVars(value, names, into = []) {
        if (Array.isArray(value)) {
            for (const v of value) stepsHidingVars(v, names, into);
        } else if (isPlainObject(value)) {
            const type = value.type;
            const named = [];
            if ((type === 'setVar' || type === 'clearVar') && typeof value.key === 'string') named.push(value.key.trim());
            if ((type === 'getText' || type === 'getCount') && typeof value.var === 'string') named.push(value.var.trim());
            if (type === 'runCustomStep') {
                const exported = Array.isArray(value.exportVars)
                    ? value.exportVars
                    : String(value.exportVars || '').split(',');
                named.push(...exported.map((v) => String(v).trim()));
                try {
                    const args = typeof value.argsJson === 'string' && value.argsJson.trim() ? JSON.parse(value.argsJson) : (isPlainObject(value.args) ? value.args : {});
                    if (isPlainObject(args)) {
                        named.push(...Object.keys(args).filter((k) => String(args[k]).trim() !== `{var:${k}}`));
                    }
                } catch { /* an argsJson that does not parse is the step editor's to report */ }
            }
            for (const name of named) {
                if (name && names.has(name)) into.push({ does: HIDES_BY_STEP[type] || `a ${type} step overwrites`, name });
            }
            for (const v of Object.values(value)) stepsHidingVars(v, names, into);
        }
        return into;
    }

    /**
     * Fills {var:x} tokens from `values`. Returns the text and the tokens that
     * had no value, so the caller can say which.
     */
    function interpolate(pattern, values) {
        const missing = [];
        const text = String(pattern).replace(TOKEN_RE, (m, name) => {
            const v = values[name];
            if (v === undefined || v === null || v === '') {
                missing.push(name);
                return '';
            }
            return String(v);
        });
        return { text: text.trim(), missing };
    }

    /** The pasted text as an array of row objects, or the reason it is not one. */
    function parseRows(text) {
        const source = String(text ?? '').trim();
        if (!source) return { ok: false, empty: true, rows: [], error: 'Paste the workflows as a JSON list.' };
        let parsed;
        try {
            parsed = JSON.parse(source);
        } catch (err) {
            return { ok: false, rows: [], error: `This is not valid JSON: ${err && err.message ? err.message : err}` };
        }
        if (!Array.isArray(parsed)) {
            return { ok: false, rows: [], error: 'The workflows must be a JSON list: [ { … }, { … } ].' };
        }
        if (!parsed.length) return { ok: false, rows: [], error: 'The list has no workflows.' };
        if (parsed.length > MAX_ROWS) {
            return { ok: false, rows: [], error: `A batch holds at most ${MAX_ROWS} workflows; this one has ${parsed.length}.` };
        }
        return { ok: true, rows: parsed, error: null };
    }

    function andList(items) {
        if (items.length <= 1) return items.join('');
        return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
    }

    /**
     * Checks rows against the workflow and resolves each into a run.
     *
     * @param {object} opts
     * @param {Array}  opts.rows          From parseRows.
     * @param {string} [opts.namePattern] e.g. "Product {var:name}".
     * @param {string} [opts.workflowUrl] Used by rows without a url.
     * @param {*}      [opts.workflow]    Actions and custom steps, searched for tokens.
     * @returns {{ ok, runs: [{ row, name, url, vars }], errors: string[], warnings: string[] }}
     */
    function resolveBatch({ rows, namePattern = '', workflowUrl = '', workflow = null, validateUrl = defaultValidateUrl } = {}) {
        const errors = [];
        const runs = [];
        const pattern = typeof namePattern === 'string' ? namePattern.trim() : '';

        rows.forEach((row, index) => {
            const n = index + 1;
            const where = `Workflow ${n}`;
            if (!isPlainObject(row)) {
                errors.push(`${where} must be an object like { "name": …, "url": … }.`);
                return;
            }

            const unknown = Object.keys(row).filter((k) => !ROW_FIELDS.includes(k));
            if (unknown.length) {
                errors.push(`${where}: "${unknown[0]}" is not a workflow field. Use name, url and vars; other values go inside vars.`);
                return;
            }

            const rowErrors = [];
            if (row.name !== undefined && typeof row.name !== 'string') rowErrors.push(`${where}: name must be text.`);
            if (row.url !== undefined && typeof row.url !== 'string') rowErrors.push(`${where}: url must be text.`);
            const vars = runSpec.normalizeVars(row.vars, rowErrors, `${where}: vars`);
            const loopName = Object.keys(vars).find((k) => LOOP_VARIABLE_NAMES.includes(k));
            if (loopName) {
                rowErrors.push(`${where}: "${loopName}" is a name every loop sets (${LOOP_VARIABLE_NAMES.join(', ')}), so inside a loop the workflow's value would be hidden. Use another name.`);
            }
            if (rowErrors.length) {
                errors.push(...rowErrors);
                return;
            }

            const url = (typeof row.url === 'string' && row.url.trim()) || (workflowUrl || '').trim();
            if (!url) {
                errors.push(`${where} has no url, and the workflow has none to fall back on.`);
                return;
            }
            try {
                validateUrl(url);
            } catch (err) {
                errors.push(`${where}: ${err && err.message ? err.message : 'invalid url'}.`);
                return;
            }

            const rowName = typeof row.name === 'string' ? row.name.trim() : '';
            let name = rowName;
            if (pattern) {
                const { text, missing } = interpolate(pattern, { ...vars, name: rowName, url, row: n });
                if (missing.length) {
                    const tokens = missing.map((m) => `{var:${m}}`);
                    errors.push(`${where}: the run name uses ${andList(tokens)}, which this workflow does not set.`);
                    return;
                }
                name = text;
            }
            if (!name) {
                errors.push(`${where} has no name. Give it one, or set a run name pattern.`);
                return;
            }

            runs.push({ row: n, name, url, vars });
        });

        const seen = new Map();
        for (const run of runs) {
            if (seen.has(run.name)) {
                errors.push(`Workflows ${seen.get(run.name)} and ${run.row} are both named "${run.name}"; each run needs its own name.`);
            } else {
                seen.set(run.name, run.row);
            }
        }

        // Custom steps the step editor may not be showing: a step in one that
        // would hide a row variable is reported here, by custom step.
        if (!errors.length && workflow && Array.isArray(workflow.customSteps)) {
            const names = new Set(runs.flatMap((r) => Object.keys(r.vars)));
            for (const custom of workflow.customSteps) {
                if (!isPlainObject(custom)) continue;
                const label = custom.name || custom.id || 'unnamed';
                for (const hit of stepsHidingVars(custom.actions, names)) {
                    errors.push(`Custom step "${label}": ${hit.does} "${hit.name}", which is a batch workflow variable. Rename one of them.`);
                }
            }
        }

        const warnings = [];
        if (!errors.length && workflow) {
            const setByWorkflow = collectSetVarKeys(workflow);
            for (const token of collectVarTokens(workflow)) {
                if (setByWorkflow.has(token)) continue;
                const without = runs.filter((r) => !(token in r.vars)).map((r) => r.row);
                if (!without.length) continue;
                const which = without.length === runs.length
                    ? 'no workflow sets it'
                    : `${without.length === 1 ? 'workflow' : 'workflows'} ${andList(without.slice(0, 5).map(String))}${without.length > 5 ? ' and others' : ''} ${without.length === 1 ? 'does' : 'do'} not set it`;
                warnings.push(`The workflow uses {var:${token}}, but ${which}. Fine if the workflow sets it itself, in a loop for instance.`);
            }
        }

        return { ok: errors.length === 0, runs: errors.length ? [] : runs, errors, warnings };
    }

    return {
        MAX_ROWS,
        LOOP_VARIABLE_NAMES,
        stepsHidingVars,
        ROW_FIELDS,
        collectVarTokens,
        collectSetVarKeys,
        interpolate,
        parseRows,
        resolveBatch,
    };
}));
