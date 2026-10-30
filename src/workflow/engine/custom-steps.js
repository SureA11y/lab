'use strict';

// Custom steps as the engine reads them: their input definitions, their inputs
// given as JSON, the variables they export, and the tags a scan step names.

const {cloneDeep, isNonEmptyString} = require('./utils');
const {interpolateVarTokensLoose} = require('./vars');

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

module.exports = {
    normalizeCustomStepInputDefs,
    normalizeCustomStepsById,
    parseJsonObjectInput,
    normalizeExportVarNames,
    interpolateScanTags
};
