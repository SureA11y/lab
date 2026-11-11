// Custom steps as data: their inputs read from and written to text, their
// ids kept unique when steps are imported, and a steps file parsed. No DOM
// and no state of the app's.

export function normalizeCustomStepInputs(rawInputs) {
    const list = Array.isArray(rawInputs) ? rawInputs : [];
    const out = [];
    const seen = new Set();
    for (const entry of list) {
        const item = typeof entry === 'string' ? {name: entry} : entry;
        if (!item || typeof item !== 'object') continue;
        const name = String(item.name || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const normalized = {name};
        if (item.required === true) normalized.required = true;
        // What a call shows for it, in place of its name (custom-step-inputs-table.js).
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        if (label) normalized.label = label;
        if (Object.prototype.hasOwnProperty.call(item, 'default')) normalized.default = item.default;
        out.push(normalized);
    }
    return out;
}

export function parseCustomStepInputsText(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const line of lines) {
        const required = line.endsWith('*');
        const name = required ? line.slice(0, -1).trim() : line;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(required ? {name, required: true} : {name});
    }
    return out;
}

export function formatCustomStepInputsText(inputs) {
    const list = normalizeCustomStepInputs(inputs);
    return list.map((item) => item.required ? `${item.name}*` : item.name).join('\n');
}

export function collectUsedCustomStepIds(actions, outSet) {
    const list = Array.isArray(actions) ? actions : [];
    list.forEach((action) => {
        if (!action || typeof action !== 'object') return;
        if (action.type === 'runCustomStep') {
            const id = String(action.customStepId || action.id || '').trim();
            if (id) outSet.add(id);
        }
        Object.entries(action).forEach(([_, value]) => {
            if (!Array.isArray(value)) return;
            const looksLikeActions = value.some((item) => item && typeof item === 'object' && typeof item.type === 'string');
            if (looksLikeActions) collectUsedCustomStepIds(value, outSet);
        });
    });
}

// Deep-clone an actions tree, rewriting every runCustomStep reference whose
// id appears in `remap` to its new id. Nested action arrays (repeat/if/crawl
// blocks, and custom steps that call other custom steps) are handled too.
export function deepRemapCustomStepIds(actions, remap) {
    if (!Array.isArray(actions)) return [];
    return actions.map((action) => {
        if (!action || typeof action !== 'object') return action;
        const next = {...action};

        if (next.type === 'runCustomStep') {
            // Engine reads `customStepId` with a legacy fallback to `id`.
            if (next.customStepId != null) {
                const ref = String(next.customStepId).trim();
                if (ref && Object.prototype.hasOwnProperty.call(remap, ref)) next.customStepId = remap[ref];
            } else if (next.id != null) {
                const ref = String(next.id).trim();
                if (ref && Object.prototype.hasOwnProperty.call(remap, ref)) next.id = remap[ref];
            }
        }

        Object.keys(next).forEach((key) => {
            const value = next[key];
            if (Array.isArray(value) && value.some((item) => item && typeof item === 'object' && typeof item.type === 'string')) {
                next[key] = deepRemapCustomStepIds(value, remap);
            }
        });

        return next;
    });
}

export function makeUniqueImportedId(baseIdRaw, taken) {
    const baseId = String(baseIdRaw || '').trim() || 'custom-step';
    if (!taken.has(baseId)) return baseId;
    const candidate = `${baseId}-imported`;
    if (!taken.has(candidate)) return candidate;
    let n = 2;
    while (taken.has(`${baseId}-imported-${n}`)) n += 1;
    return `${baseId}-imported-${n}`;
}

export function parseCustomStepsJson(rawText) {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) return [];

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error('Custom steps JSON is invalid: ' + String(e?.message || e));
    }

    const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object')
            ? Object.entries(parsed).map(([id, value]) => ({id, ...(value || {})}))
            : null;

    if (!list) throw new Error('Custom steps must be an array or object map.');

    const seen = new Set();
    const normalized = [];
    for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        if (!item || typeof item !== 'object') {
            throw new Error(`Custom step #${i + 1} must be an object.`);
        }
        const id = String(item.id || '').trim();
        if (!id) throw new Error(`Custom step #${i + 1} is missing id.`);
        if (seen.has(id)) throw new Error(`Custom step name "${id}" is duplicated.`);
        seen.add(id);
        if (!Array.isArray(item.actions) || !item.actions.length) {
            throw new Error(`Custom step "${id}" must include a non-empty actions array.`);
        }
        normalized.push({
            id,
            name: String(item.name || '').trim() || id,
            inputs: normalizeCustomStepInputs(item.inputs),
            actions: item.actions
        });
    }

    return normalized;
}

export function cloneCustomStepValue(step) {
    if (!step || typeof step !== 'object') return null;
    return {
        id: String(step.id || '').trim(),
        name: String(step.name || '').trim(),
        inputs: Array.isArray(step.inputs) ? step.inputs.map((i) => ({ ...i })) : [],
        actions: Array.isArray(step.actions) ? JSON.parse(JSON.stringify(step.actions)) : []
    };
}
