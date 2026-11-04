// The steps panel's model: the steps of a section as plain data, which of
// them a filter matches, which are kept as the context of a match, and how
// to step through the matches. No DOM here: steps-panel.js reads the nodes
// from the editor's lines and draws what this returns
// (docs/design/steps-panel-design.md).

/**
 * A step as the panel knows it.
 * @typedef {object} StepNode
 * @property {string} id         Stable for the life of the line.
 * @property {string} path       Its number in the editor: "3.2.1".
 * @property {number} depth      0 for a step of the section's own list.
 * @property {string|null} parentId
 * @property {string} type       The step type: "a11yScan", "group"…
 * @property {string} typeTitle  The type as the editor names it: "A11y scan".
 * @property {string} name       What the panel shows: its own title, else its label, else the type.
 * @property {string} searchText What a text filter looks in, lower case.
 * @property {boolean} disabled  Turned off, by itself or by a container it is in.
 * @property {boolean} container It holds steps of its own.
 * @property {boolean} [root]    A heading over steps, not a step: a custom step's
 *                               definition. A text filter finds it; kinds and counts leave it out.
 */

/** The type chips, in order. `all` is the chip that filters nothing. */
export const KINDS = [
    {id: 'all', label: 'All'},
    {id: 'scan', label: 'A11y scan'},
    {id: 'click', label: 'Click'},
    {id: 'container', label: 'Containers'},
    {id: 'disabled', label: 'Disabled'}
];

// The A11y scan chip is that type only: a Merged scan is a step of its own.
const SCAN_TYPES = new Set(['a11yScan']);
const CLICK_TYPES = new Set(['click', 'clickByText']);

/** Whether a step is of a kind; `all` takes every step. */
export function isOfKind(node, kind) {
    if (!node) return false;
    if (node.root) return kind === 'all';
    switch (kind) {
        case 'scan': return SCAN_TYPES.has(node.type);
        case 'click': return CLICK_TYPES.has(node.type);
        case 'container': return !!node.container;
        case 'disabled': return !!node.disabled;
        default: return true;
    }
}

/** The filter as typed, ready to compare: trimmed, lower case. */
export function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase();
}

/** Whether a step matches a kind and a (normalized) query. */
export function matchesFilter(node, kind, query) {
    if (!isOfKind(node, kind)) return false;
    if (!query) return true;
    return String(node.searchText || '').includes(query);
}

/** Whether a filter narrows anything: a kind other than `all`, or text. */
export function isFilterActive(kind, query) {
    return (kind && kind !== 'all') || !!normalizeQuery(query);
}

/** How many steps each kind holds, by kind id; `all` is every step. */
export function countKinds(nodes) {
    const counts = {};
    KINDS.forEach(({id}) => { counts[id] = 0; });
    (nodes || []).forEach((node) => {
        if (node.root) return;
        KINDS.forEach(({id}) => { if (isOfKind(node, id)) counts[id] += 1; });
    });
    return counts;
}

/**
 * What the panel lists for a filter. With no filter, every step. With one,
 * the matches and, as their context, the containers they are in, so a match
 * deep in the tree still shows where it is.
 *
 * @param {StepNode[]} nodes  In the order they are in the editor.
 * @param {{kind?: string, query?: string}} filter
 * @returns {{active: boolean, rows: {node: StepNode, match: boolean, context: boolean}[], matches: StepNode[]}}
 */
export function applyFilter(nodes, {kind = 'all', query = ''} = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const q = normalizeQuery(query);
    const active = isFilterActive(kind, q);
    if (!active) {
        return {active, rows: list.map((node) => ({node, match: false, context: false})), matches: []};
    }

    const byId = new Map(list.map((node) => [node.id, node]));
    const matches = list.filter((node) => matchesFilter(node, kind, q));
    const kept = new Set();
    matches.forEach((node) => {
        kept.add(node.id);
        let parentId = node.parentId;
        while (parentId && !kept.has(parentId)) {
            kept.add(parentId);
            parentId = byId.get(parentId)?.parentId ?? null;
        }
    });
    const matchIds = new Set(matches.map((node) => node.id));
    const rows = list
        .filter((node) => kept.has(node.id))
        .map((node) => ({node, match: matchIds.has(node.id), context: !matchIds.has(node.id)}));
    return {active, rows, matches};
}

/**
 * The match to go to from the current step, one way or the other, wrapping
 * at the ends. From a step that is not a match, forward is the first match
 * after it and back the last one before it, in editor order.
 *
 * @param {StepNode[]} nodes    Every step, in editor order.
 * @param {StepNode[]} matches  The matches, in editor order.
 * @param {string|null} currentId
 * @param {1|-1} direction
 * @returns {StepNode|null}
 */
export function stepThroughMatches(nodes, matches, currentId, direction) {
    if (!Array.isArray(matches) || !matches.length) return null;
    const dir = direction < 0 ? -1 : 1;
    const at = matches.findIndex((node) => node.id === currentId);
    if (at >= 0) return matches[(at + dir + matches.length) % matches.length];

    const order = new Map((nodes || []).map((node, i) => [node.id, i]));
    const here = order.has(currentId) ? order.get(currentId) : -1;
    if (dir > 0) return matches.find((node) => (order.get(node.id) ?? -1) > here) || matches[0];
    for (let i = matches.length - 1; i >= 0; i -= 1) {
        if ((order.get(matches[i].id) ?? -1) < here) return matches[i];
    }
    return matches[matches.length - 1];
}

/** Where a match is among the matches, 1-based, or 0 when it is not one. */
export function matchPosition(matches, id) {
    const at = (matches || []).findIndex((node) => node.id === id);
    return at + 1;
}

/**
 * The steps as a tree reads them: for each, its position among its siblings
 * and how many siblings it has (aria-posinset and aria-setsize), over the
 * rows actually listed.
 */
export function siblingPositions(rows) {
    const groups = new Map();
    (rows || []).forEach(({node}) => {
        const key = node.parentId || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(node.id);
    });
    const out = new Map();
    groups.forEach((ids) => ids.forEach((id, i) => out.set(id, {posinset: i + 1, setsize: ids.length})));
    return out;
}

/**
 * The rows left once folded containers hide what is in them. A folded
 * container's own row stays. Only for the list without a filter: a filter
 * shows every match, wherever it is.
 *
 * @param {{node: StepNode}[]} rows  In editor order.
 * @param {Set<string>} folded       Ids of folded containers.
 */
export function foldRows(rows, folded) {
    if (!folded || !folded.size) return rows || [];
    const out = [];
    let hideDeeperThan = Infinity;
    (rows || []).forEach((row) => {
        const {node} = row;
        if (node.depth > hideDeeperThan) return;
        hideDeeperThan = Infinity;
        out.push(row);
        if (node.container && folded.has(node.id)) hideDeeperThan = node.depth;
    });
    return out;
}

/** The containers a step is in, nearest first. */
export function ancestorIds(nodes, id) {
    const byId = new Map((nodes || []).map((n) => [n.id, n]));
    const out = [];
    for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) out.push(p);
    return out;
}
