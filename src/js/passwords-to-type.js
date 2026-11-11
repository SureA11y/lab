// Passwords to type again. A password is never saved with a configuration,
// so one loaded back has every password empty, often deep in its steps and
// in its custom steps. The Workflow section says how many are left in one
// banner, with a button that goes to the next one, and Run waits for them.
// The editor marks the steps (actions-builder.module.js, "Needs password");
// this counts those of custom steps not open in an editor, from their saved
// steps, and draws the banner.

/** The fields of a step type that hold a secret (a password). */
function secretFieldsOf(def) {
    return Object.entries((def && def.fields) || {}).filter(([, f]) => f && f.secret).map(([name]) => name);
}

/** Whether a saved value of a secret field still has to be typed. */
function isEmptySecret(value) {
    if (value && typeof value === 'object' && typeof value.$env === 'string') return false;
    return value === undefined || value === null || value === '';
}

/** Whether a saved step has a password of its own to type (not its nested steps'). */
export function stepHasEmptyPassword(action, defs) {
    const def = action && defs && defs[action.type];
    return !!def && secretFieldsOf(def).some((name) => isEmptySecret(action[name]));
}

/**
 * The passwords a list of saved steps has empty, in the steps that run (not
 * in one turned off, or inside one): how many fields, with the first step's
 * number ("3.1"). Fields are counted, not steps: each is typed.
 */
export function emptyPasswordsInActions(actions, defs, prefix = '') {
    let count = 0;
    let firstPath = null;
    (Array.isArray(actions) ? actions : []).forEach((action, i) => {
        if (!action || typeof action !== 'object' || action.disabled === true) return;
        const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
        const def = defs && defs[action.type];
        if (!def) return;
        const own = secretFieldsOf(def).filter((name) => isEmptySecret(action[name])).length;
        if (own && !firstPath) firstPath = path;
        count += own;
        for (const [name, field] of Object.entries(def.fields || {})) {
            if (!String(field?.type || '').toLowerCase().includes('action[]') || !Array.isArray(action[name])) continue;
            const nested = emptyPasswordsInActions(action[name], defs, path);
            if (nested.count && !firstPath) firstPath = nested.firstPath;
            count += nested.count;
        }
    });
    return {count, firstPath};
}

/** The custom step ids a list of steps runs, those it runs through them too. */
function calledIds(actions, out = new Set()) {
    (Array.isArray(actions) ? actions : []).forEach((action) => {
        if (!action || typeof action !== 'object' || action.disabled === true) return;
        if (action.type === 'runCustomStep') {
            const id = String(action.customStepId || action.id || '').trim();
            if (id) out.add(id);
        }
        Object.values(action).forEach((value) => {
            if (Array.isArray(value)) calledIds(value, out);
        });
    });
    return out;
}

/** The ids of the custom steps a workflow runs, directly or through another. */
export function customStepIdsRun(customSteps, workflowActions) {
    const steps = Array.isArray(customSteps) ? customSteps : [];
    const byId = new Map(steps.map((s) => [String(s?.id || '').trim(), s]));
    const reached = new Set();
    const queue = Array.from(calledIds(workflowActions));
    while (queue.length) {
        const id = queue.shift();
        if (reached.has(id) || !byId.has(id)) continue;
        reached.add(id);
        calledIds(byId.get(id).actions).forEach((next) => queue.push(next));
    }
    return reached;
}

/**
 * The custom steps the workflow runs, directly or through another custom
 * step, that have passwords to type: [{index, id, name, count}]. A custom
 * step nobody runs can wait. `skipIndex` is the one open in its editor,
 * which counts its own from its fields.
 */
export function customStepsWithEmptyPasswords(customSteps, workflowActions, defs, {skipIndex = -1} = {}) {
    const steps = Array.isArray(customSteps) ? customSteps : [];
    const reached = customStepIdsRun(steps, workflowActions);
    const out = [];
    steps.forEach((step, index) => {
        const id = String(step?.id || '').trim();
        if (!reached.has(id) || index === skipIndex) return;
        const {count} = emptyPasswordsInActions(step.actions, defs);
        if (count) out.push({index, id, name: String(step.name || id), count});
    });
    return out;
}

/** "1 password to type again", "4 passwords to type again". */
export function passwordsBannerText(count) {
    return count === 1 ? '1 password to type again' : `${count} passwords to type again`;
}

/**
 * The banner, in `host`: how many passwords are left and a button that goes
 * to the next one. -> { update(count) }. Hidden at 0.
 */
export function createPasswordsBanner({host, onNext}) {
    if (!host) return {update() {}};
    const doc = host.ownerDocument;
    host.classList.add('passwords-banner');
    host.textContent = '';
    const text = doc.createElement('p');
    text.className = 'passwords-banner__text';
    const count = doc.createElement('strong');
    const why = doc.createElement('span');
    why.textContent = ': they are never saved with a configuration.';
    text.append(count, why);
    const next = doc.createElement('button');
    next.type = 'button';
    next.className = 'secondary-button passwords-banner__next';
    next.textContent = 'Go to the next one';
    next.addEventListener('click', () => onNext && onNext());
    host.append(text, next);
    host.hidden = true;

    let shown = -1;
    function update(n) {
        const c = Math.max(0, Number(n) || 0);
        if (c === shown) return;
        shown = c;
        host.hidden = c === 0;
        count.textContent = passwordsBannerText(c);
        next.textContent = c === 1 ? 'Go to it' : 'Go to the next one';
    }
    return {update};
}
