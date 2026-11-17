// The workflow's roadmap: its steps as a tree on a rail, one line each with the
// step's name and type, to see the flow at a glance. Groups, loops and
// conditions fold open in place; scans are marked; optional and turned-off
// steps say so.
//
// It draws from the steps the Workflow steps panel reads (StepNode, see
// steps-panel-model.js), and nothing else: no state of the app's, so the same
// drawing can go into a report. Without `onGo` it is plain text and folds
// (<details>), which needs no script.

// A scan, as the roadmap marks it: a Merged scan too, which the panel's A11y scan chip leaves out.
const SCAN_TYPES = new Set(['a11yScan', 'mergedScan']);

/**
 * The step fields that say what a step acts on, first found first shown.
 * A value to type is not among them: it may be a secret.
 */
export const DETAIL_FIELDS = ['url', 'selector', 'labelText', 'text', 'customStepId', 'ms', 'name'];

/**
 * What a step acts on, as short text: "#username", "docs.example.com/x", "15 s".
 * @param {(name: string) => string} get  A step's field by name, '' for none.
 */
export function stepDetail(get) {
    for (const name of DETAIL_FIELDS) {
        const raw = String(get(name) ?? '').trim();
        if (!raw) continue;
        if (name === 'ms') return `${Math.round(Number(raw) / 100) / 10} s`;
        if (name === 'labelText' || name === 'text') return `"${raw}"`;
        const oneLine = raw.replace(/\s+/g, ' ');
        return oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine;
    }
    return '';
}

/**
 * The steps as a tree of plain items, in order.
 * @param {import('./steps-panel-model.js').StepNode[]} nodes  In order, with `depth`.
 * @returns {{step: object, children: object[]}[]}
 */
export function roadmapTree(nodes) {
    const roots = [];
    const stack = [];
    for (const step of Array.isArray(nodes) ? nodes : []) {
        if (!step || step.root) continue;
        const item = {step, children: []};
        const depth = Math.max(0, Number(step.depth) || 0);
        stack.length = Math.min(stack.length, depth);
        (stack.length ? stack[stack.length - 1].children : roots).push(item);
        stack[depth] = item;
    }
    return roots;
}

/**
 * The workflow's steps with each call to a custom step opened in place: under
 * the call, the steps it runs, numbered after it ("3.2"). A custom step that
 * calls itself, however far down, is opened once.
 *
 * @param {object[]} nodes        The workflow's steps (StepNode).
 * @param {object[]} customNodes  The Custom steps panel's rows: each custom step's heading (`root`) and its steps.
 * @param {{id: string, headId: string, name: string}[]} defs  Each custom step: the id a call names, its heading's id, its name.
 * @returns {object[]} Steps in order; those from a custom step say `from: 'custom'`.
 */
export function expandCustomCalls(nodes, customNodes, defs) {
    const stepsOf = new Map();
    let current = null;
    for (const n of customNodes || []) {
        if (n.root) { current = []; stepsOf.set(n.id, current); } else current?.push(n);
    }
    const defById = new Map((defs || []).map((d) => [d.id, d]));

    function expand(list, minDepth, offset, prefix, seen, from) {
        const out = [];
        for (const n of list) {
            if (!n || n.root) continue;
            const item = {...n, depth: n.depth - minDepth + offset, path: prefix ? `${prefix}.${n.path}` : n.path, from};
            const def = n.calls ? defById.get(n.calls) : null;
            if (n.calls) item.detail = def?.name || n.calls;
            out.push(item);
            if (def && !seen.has(n.calls)) {
                item.container = true;
                out.push(...expand(stepsOf.get(def.headId) || [], 1, item.depth + 1, item.path, new Set([...seen, n.calls]), 'custom'));
            }
        }
        return out;
    }
    return expand(nodes || [], 0, 0, '', new Set(), 'workflow');
}

/** How many steps are in the roadmap, containers included. */
export function roadmapCount(nodes) {
    return (Array.isArray(nodes) ? nodes : []).filter((n) => n && !n.root).length;
}

function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function label(doc, step, onGo) {
    const kind = SCAN_TYPES.has(step.type) ? 'scan' : step.container ? 'container' : 'step';
    const row = el(doc, onGo ? 'button' : 'span', `roadmap__row roadmap__row--${kind}${step.disabled ? ' is-off' : ''}`);
    if (onGo) row.type = 'button';
    row.append(el(doc, 'span', 'roadmap__mark'));
    row.append(el(doc, 'span', 'roadmap__num', step.path || ''));
    const main = el(doc, 'span', 'roadmap__main');
    main.append(el(doc, 'span', 'roadmap__name', step.name || step.typeTitle || step.type));
    if (step.detail) main.append(el(doc, 'span', 'roadmap__detail', step.detail));
    row.append(main);
    const meta = el(doc, 'span', 'roadmap__meta');
    if (step.optional) meta.append(el(doc, 'span', 'roadmap__flag', 'optional'));
    if (step.disabled) meta.append(el(doc, 'span', 'roadmap__flag roadmap__flag--off', 'off'));
    if (step.container && step.childCount != null) meta.append(el(doc, 'span', 'roadmap__count', String(step.childCount)));
    // The type is said only when the name does not already say it.
    if (step.typeTitle && step.typeTitle !== step.name) meta.append(el(doc, 'span', 'roadmap__type', step.typeTitle));
    row.append(meta);
    if (onGo) row.addEventListener('click', () => onGo(step));
    return row;
}

function list(doc, items, onGo, top) {
    const ul = el(doc, 'ul', top ? 'roadmap__list roadmap__list--top' : 'roadmap__list');
    for (const item of items) {
        const step = {...item.step, childCount: item.children.length ? countAll(item.children) : null};
        const li = el(doc, 'li', 'roadmap__item');
        if (item.children.length) {
            const details = el(doc, 'details', 'roadmap__fold');
            details.open = true;
            const summary = el(doc, 'summary', 'roadmap__summary');
            summary.append(label(doc, step, onGo));
            details.append(summary, list(doc, item.children, onGo, false));
            li.append(details);
        } else {
            li.append(label(doc, step, onGo));
        }
        ul.append(li);
    }
    return ul;
}

function countAll(items) {
    return items.reduce((n, i) => n + 1 + countAll(i.children), 0);
}

/**
 * The roadmap as an element.
 * @param {Document} doc
 * @param {import('./steps-panel-model.js').StepNode[]} nodes
 * @param {{onGo?: (step: object) => void}} [o]  Each step as a button that goes to it.
 * @returns {HTMLElement}
 */
export function renderRoadmap(doc, nodes, {onGo} = {}) {
    const root = el(doc, 'div', 'roadmap');
    const tree = roadmapTree(nodes);
    if (!tree.length) {
        root.append(el(doc, 'p', 'roadmap__empty', 'No steps yet.'));
        return root;
    }
    root.append(list(doc, tree, onGo, true));
    return root;
}
