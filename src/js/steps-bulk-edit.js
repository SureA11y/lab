// Edit together: which fields the selected steps share, what each holds now,
// and what each step would get from the values chosen. Plain data, no DOM:
// the steps panel draws the form and the previews from it
// (docs/design/steps-panel-design.md).

// Fields that say what one step is, not how it runs: changing them for
// several at once makes no sense, or would break the steps.
const NOT_SHARED = new Set(['label', 'alias', 'customStepId', 'argsJson', 'labelText']);

/** How a field is edited: a choice, yes or no, a number, a list, or text. */
export function kindOf(fieldDef) {
    const type = String(fieldDef?.type || '');
    if (Array.isArray(fieldDef?.options) && fieldDef.options.length) return 'choice';
    if (type === 'boolean') return 'boolean';
    if (type === 'number') return 'number';
    if (type.includes('[]')) return 'list';
    return 'text';
}

function isSecret(name, fieldDef) {
    return fieldDef?.secret === true || fieldDef?.masked === true || /password|secret|token/i.test(name);
}

function isPrimary(name, fieldDef, typeDef) {
    const order = typeDef?.fieldOrder?.primary;
    if (Array.isArray(order) && order.includes(name)) return true;
    const imp = fieldDef?.importance;
    return imp === 'primary' || imp === 1 || (imp && typeof imp === 'object' && imp.primary === true) || fieldDef?.required === true;
}

function optionList(fieldDef) {
    return (fieldDef?.options || []).map((o) => (o && typeof o === 'object'
        ? {value: String(o.value ?? ''), label: String(o.label ?? o.value ?? '')}
        : {value: String(o), label: String(o)}));
}

/**
 * The fields every one of the given step types has, alike: same name, same
 * type. Steps inside a container are a list of steps, not a field, and are
 * left out, as are a step's own name and secrets. The fields shown before
 * "Show more options" come first.
 *
 * @param {string[]} types
 * @param {object} defs  The step definitions, by type.
 * @returns {{name: string, label: string, kind: string, options: {value: string, label: string}[], primary: boolean}[]}
 */
export function sharedFields(types, defs) {
    const list = Array.from(new Set(types || [])).filter((t) => defs?.[t]);
    if (!list.length) return [];
    const [first, ...rest] = list;
    const fields = defs[first].fields || {};
    const out = [];
    Object.entries(fields).forEach(([name, def]) => {
        const type = String(def?.type || '');
        if (!type || type.includes('Action') || NOT_SHARED.has(name) || def?.hidden || isSecret(name, def)) return;
        if (!rest.every((t) => String(defs[t].fields?.[name]?.type || '') === type)) return;
        out.push({
            name,
            label: String(def.alias || name),
            kind: kindOf(def),
            options: optionList(def),
            primary: list.some((t) => isPrimary(name, defs[t].fields?.[name], defs[t]))
        });
    });
    return out.filter((f) => f.primary).concat(out.filter((f) => !f.primary));
}

/** A list field's value as a list of its items. */
export function asList(value) {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (value == null || value === '') return [];
    return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

/** A value as the form shows it. */
export function showValue(value, field) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '(empty)';
    if (field.kind === 'boolean') return value === true || value === 'true' ? 'Yes' : 'No';
    if (field.kind === 'list') return asList(value).join(', ');
    if (field.kind === 'choice') {
        const opt = field.options.find((o) => o.value === String(Array.isArray(value) ? value[0] : value));
        if (opt) return opt.label;
    }
    return String(value);
}

/** What the selected steps hold now, each different value with how many have it, most first. */
export function tally(values, field) {
    const counts = new Map();
    values.forEach((v) => {
        const text = showValue(v, field);
        counts.set(text, (counts.get(text) || 0) + 1);
    });
    return Array.from(counts, ([text, n]) => ({text, n})).sort((a, b) => b.n - a.n);
}

function same(a, b, field) {
    if (field.kind === 'list') return asList(a).join('\u0000') === asList(b).join('\u0000');
    if (field.kind === 'boolean') return (a === true || a === 'true') === (b === true || b === 'true');
    const norm = (v) => (v == null ? '' : String(Array.isArray(v) ? v.join(',') : v));
    return norm(a) === norm(b);
}

/**
 * What a step gets from an edit. A list adds or removes items; anything
 * else takes the value chosen.
 *
 * @param {*} before
 * @param {{value: *, mode?: 'add'|'remove'}} edit
 * @param {{kind: string}} field
 */
export function nextValue(before, edit, field) {
    if (field.kind === 'list') {
        const items = asList(edit.value);
        const now = asList(before);
        if (edit.mode === 'remove') return now.filter((v) => !items.includes(v));
        return now.concat(items.filter((v) => !now.includes(v)));
    }
    if (field.kind === 'boolean') return edit.value === true || edit.value === 'true';
    if (field.kind === 'number') return Number(edit.value);
    return edit.value;
}

/** Whether an edit asks for anything: a field left as "Keep" does not. */
export function isEdit(edit, field) {
    if (!edit) return false;
    if (field.kind === 'list') return asList(edit.value).length > 0;
    if (field.kind === 'number') return edit.value !== '' && edit.value != null && Number.isFinite(Number(edit.value));
    return edit.value !== '' && edit.value != null;
}

/**
 * What each step would get: for each, the fields that would change, with
 * their value before and after. Steps nothing would change are left out.
 *
 * @param {{id: string, values: object}[]} steps  Each selected step's values.
 * @param {Object<string, {value: *, mode?: string}>} edits  By field name.
 * @param {ReturnType<typeof sharedFields>} fields
 */
export function planChanges(steps, edits, fields) {
    const active = fields.filter((f) => isEdit(edits?.[f.name], f));
    const out = [];
    (steps || []).forEach(({id, values}) => {
        const changes = [];
        active.forEach((f) => {
            const before = values?.[f.name];
            const after = nextValue(before, edits[f.name], f);
            if (same(before, after, f)) return;
            changes.push({name: f.name, label: f.label, before, after, beforeText: showValue(before, f), afterText: showValue(after, f)});
        });
        if (changes.length) out.push({id, changes});
    });
    return out;
}
