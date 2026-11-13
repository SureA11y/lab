'use strict';

// Custom steps as the engine reads them: their input definitions, the places
// where a call can give them steps, their inputs given as JSON, the variables
// they export, and the tags a scan step names.

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

/**
 * The places a custom step holds for steps a call gives it (its slots):
 * [{name, required}], each name once. A name alone ("afterSubmit") is an
 * optional place.
 */
function normalizeCustomStepSlotDefs(slotsRaw) {
    const list = Array.isArray(slotsRaw) ? slotsRaw : [];
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
        out.push({ name, required: def.required === true });
    }
    return out;
}

/**
 * The steps a call gives for each place, by name, from its `slots` list of
 * slotSteps steps. A disabled one gives nothing; a name given twice keeps
 * its first list.
 */
function callSlotFills(slotsRaw) {
    const fills = Object.create(null);
    const list = Array.isArray(slotsRaw) ? slotsRaw : [];
    list.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object' || entry.disabled === true) return;
        if (entry.type !== 'slotSteps') {
            throw new Error(`runCustomStep: place ${i + 1} is a "${entry.type}" step; a call's places only hold slotSteps steps`);
        }
        const name = String(entry.slot || '').trim();
        if (!name || Object.prototype.hasOwnProperty.call(fills, name)) return;
        fills[name] = { actions: Array.isArray(entry.actions) ? entry.actions : [], index: i + 1 };
    });
    return fills;
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
            inputs: normalizeCustomStepInputDefs(item.inputs),
            slots: normalizeCustomStepSlotDefs(item.slots)
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
    normalizeCustomStepSlotDefs,
    callSlotFills,
    normalizeCustomStepsById,
    parseJsonObjectInput,
    normalizeExportVarNames,
    interpolateScanTags
};
