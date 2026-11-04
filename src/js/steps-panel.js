// The steps panel: a map of a section's steps beside its editor, to find
// them and go to them (docs/design/steps-panel-design.md). It reads the
// steps from the editor's lines, draws them as a tree with a filter, follows
// the editor as it scrolls, and folds away to a rail, which the browser
// remembers for the section. What it lists and matches is the model's
// (steps-panel-model.js); this draws it and wires it.

import {getDirectActionLines, getDirectNestedActionContainers} from './action-tree.js';
import {
    KINDS, applyFilter, countKinds, isOfKind, matchPosition, siblingPositions, stepThroughMatches
} from './steps-panel-model.js';

const STORAGE_PREFIX = 'a11y-lab-steps-panel-';
const REBUILD_DELAY_MS = 200;
// How far below the top of the window a step counts as the one in view: below
// the sticky mode bar, with some room to read it.
const IN_VIEW_LINE_PX = 120;

/** Whether the browser remembers the panel as hidden for a section. */
export function readPanelHidden(storage, sectionKey) {
    try {
        return storage?.getItem(STORAGE_PREFIX + sectionKey) === 'hidden';
    } catch {
        return false;
    }
}

export function writePanelHidden(storage, sectionKey, hidden) {
    try {
        storage?.setItem(STORAGE_PREFIX + sectionKey, hidden ? 'hidden' : 'shown');
    } catch {
        // Private windows and blocked storage: the panel still works, it just
        // is not remembered.
    }
}

/** The fields of a line that are its own, not those of the steps nested in it. */
function ownFields(line) {
    return Array.from(line.querySelectorAll('.field[data-field-name]')).filter((f) => f.closest('.line') === line);
}

function fieldText(field) {
    const control = field.querySelector('input, select, textarea');
    if (!control) return '';
    if (control.type === 'password' || control.type === 'checkbox' || control.type === 'radio') return '';
    if (control.tagName === 'SELECT') {
        const opt = control.selectedOptions?.[0];
        return `${control.value} ${opt ? opt.textContent : ''}`;
    }
    return control.value || '';
}

function lineTitleText(line) {
    const titleEl = line.querySelector(':scope > .line-header .line-title');
    const text = String(titleEl?.textContent || '').trim();
    // "3.2.1 - Click" → "Click": the number is shown on its own.
    const dash = text.indexOf(' - ');
    return dash >= 0 ? text.slice(dash + 3).trim() : text;
}

/**
 * The steps of an editor, as the model takes them, read from its lines in
 * the order they are shown.
 *
 * Each step also has a `key`: its number and the lists it is in ("3.1|actions"),
 * the same whether read from the lines or from saved steps (readActionNodes),
 * so a step keeps its place when its custom step is opened in the editor.
 *
 * @param {Element} editorEl  The section's list of steps.
 * @param {(line: Element, key: string) => string} idOf
 * @param {{depth?: number, parentId?: string|null, parentDisabled?: boolean}} [under]
 *        Where the steps go in a larger tree: under a custom step, say.
 * @returns {{nodes: import('./steps-panel-model.js').StepNode[], lineById: Map<string, Element>}}
 */
export function readStepNodes(editorEl, idOf, under = {}) {
    const nodes = [];
    const lineById = new Map();

    function walk(container, depth, parentId, prefix, parentDisabled, trail) {
        getDirectActionLines(container).forEach((line, i) => {
            const path = line.dataset.actionIndexPath || (prefix ? `${prefix}.${i + 1}` : String(i + 1));
            const key = `${path}|${trail.join('.')}`;
            const id = idOf(line, key);
            const type = String(line.dataset.actionType || '');
            const typeTitle = String(line.dataset.baseTitle || type);
            const alias = String(line.dataset.alias || '').trim();
            const labelField = Array.from(line.querySelectorAll('.field[data-field-name="label"]')).find((f) => f.closest('.line') === line);
            const label = labelField ? fieldText(labelField).trim() : '';
            const shownTitle = lineTitleText(line) || typeTitle;
            const name = alias || label || shownTitle;
            const nested = getDirectNestedActionContainers(line);
            const node = {
                id, key, path, depth, parentId, type, typeTitle, name,
                // A step in a disabled container does not run either.
                disabled: parentDisabled || line.dataset.explicitDisabled === 'true' || line.dataset.inheritedDisabled === 'true',
                container: nested.length > 0
            };
            if (type === 'runCustomStep') {
                const called = Array.from(line.querySelectorAll('.field[data-field-name="customStepId"]')).find((f) => f.closest('.line') === line);
                node.calls = called ? String(called.querySelector('select, input')?.value || '').trim() : '';
            }
            // What a text filter looks in: every field of the step. Read the
            // first time a text filter asks, not on every read of the editor:
            // reading every field of 1000 steps took most of a rebuild.
            let searchText = null;
            Object.defineProperty(node, 'searchText', {
                enumerable: true,
                get() {
                    if (searchText === null) {
                        searchText = [name, shownTitle, typeTitle, type, ...ownFields(line).map(fieldText)].join(' ').toLowerCase();
                    }
                    return searchText;
                }
            });
            nodes.push(node);
            lineById.set(id, line);
            nested.forEach((sub) => walk(sub, depth + 1, id, path, node.disabled, trail.concat([sub.dataset.fieldName || ''])));
        });
    }

    if (editorEl) walk(editorEl, under.depth || 0, under.parentId ?? null, '', !!under.parentDisabled, []);
    return {nodes, lineById};
}

/**
 * Steps as the model takes them, read from saved steps rather than from
 * lines: the steps of a custom step that is not open in the editor. Numbered
 * and keyed as the editor numbers and keys them (readStepNodes), so the two
 * agree once it is opened.
 *
 * @param {object[]} actions
 * @param {object} o
 * @param {(key: string) => string} o.idOf
 * @param {(type: string) => string} o.typeTitleOf   "A11y scan" for "a11yScan".
 * @param {(action: object) => string} o.nameOf      What the step is called, '' for none.
 * @param {(type: string) => string[]} o.listsOf     The fields of a type that hold steps, in the editor's order.
 * @param {number} [o.depth]
 * @param {string|null} [o.parentId]
 * @param {boolean} [o.parentDisabled]
 */
export function readActionNodes(actions, o) {
    const nodes = [];
    function walk(list, depth, parentId, prefix, parentDisabled, trail) {
        (Array.isArray(list) ? list : []).forEach((action, i) => {
            if (!action || typeof action !== 'object') return;
            const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
            const key = `${path}|${trail.join('.')}`;
            const type = String(action.type || '');
            const typeTitle = o.typeTitleOf(type) || type;
            const name = o.nameOf(action) || typeTitle;
            const lists = o.listsOf(type).filter((f) => Array.isArray(action[f]));
            const node = {
                id: o.idOf(key), key, path, depth, parentId, type, typeTitle, name,
                disabled: parentDisabled || action.disabled === true,
                container: o.listsOf(type).length > 0
            };
            if (type === 'runCustomStep') node.calls = String(action.customStepId || '').trim();
            let searchText = null;
            Object.defineProperty(node, 'searchText', {
                enumerable: true,
                get() {
                    if (searchText === null) {
                        const values = Object.entries(action)
                            .filter(([k, v]) => k !== 'type' && v != null && typeof v !== 'object' && !/password|secret/i.test(k))
                            .map(([, v]) => String(v));
                        searchText = [name, typeTitle, type, ...values].join(' ').toLowerCase();
                    }
                    return searchText;
                }
            });
            nodes.push(node);
            lists.forEach((f) => walk(action[f], depth + 1, node.id, path, node.disabled, trail.concat([f])));
        });
    }
    walk(actions, o.depth || 0, o.parentId ?? null, '', !!o.parentDisabled, []);
    return nodes;
}

/**
 * Sets an element's text by changing its text node, and only when it differs.
 * Replacing the node is a change of the page's elements, which other parts
 * of the app watch for (scroll-reach.js scans every scroll box on each): the
 * rail's text changes as the editor scrolls, and that made every scroll
 * cost a scan of the whole page.
 */
function setText(node, text) {
    const only = node.firstChild;
    if (only && only.nodeType === 3 && !only.nextSibling) {
        if (only.data !== text) only.data = text;
    } else if (node.textContent !== text) {
        node.textContent = text;
    }
}

function el(doc, tag, props = {}, children = []) {
    const node = doc.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
        if (v == null || v === false) return;
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.entries(v).forEach(([dk, dv]) => { node.dataset[dk] = dv; });
        else node.setAttribute(k, v === true ? '' : String(v));
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null) return;
        node.append(c.nodeType ? c : doc.createTextNode(String(c)));
    });
    return node;
}

function searchIcon(doc) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'steps-panel__find-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const circle = doc.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '11');
    circle.setAttribute('r', '6.5');
    const handle = doc.createElementNS(ns, 'path');
    handle.setAttribute('d', 'M16 16l4 4');
    [circle, handle].forEach((s) => {
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '2');
        s.setAttribute('stroke-linecap', 'round');
        svg.append(s);
    });
    return svg;
}

/** How a step's type is coloured: scans, containers, or the rest. Words say it too. */
function categoryOf(node) {
    if (isOfKind(node, 'scan')) return 'scan';
    if (node.container) return 'container';
    return 'action';
}

const CHEVRON_LEFT = 'M15 6l-6 6 6 6';
const CHEVRON_RIGHT = 'M9 6l6 6-6 6';
const CHEVRON_UP = 'M6 15l6-6 6 6';
const CHEVRON_DOWN = 'M6 9l6 6 6-6';

function icon(doc, d) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
}

/**
 * Puts a steps panel in `host`, beside `editorEl`.
 *
 * @param {object} o
 * @param {Element} o.host          The panel's element, an <aside>.
 * @param {Element} o.editorEl      The section's list of steps.
 * @param {string}  o.sectionKey    Names it in storage: "workflow".
 * @param {string}  o.title         "Workflow steps".
 * @param {(line: Element, opts: {focus: boolean}) => void} o.goToLine
 *        Opens the line and the containers it is in, scrolls to it and, with
 *        `focus`, moves focus to it.
 * @param {Storage} [o.storage]     Where hidden or shown is kept.
 * @param {Window}  [o.win]
 * @param {(line: Element) => boolean} [o.isLineShown]  Whether a line is drawn (tests replace it).
 * @param {(line: Element) => DOMRect} [o.rectOf]       Its place on screen (tests replace it).
 * @param {() => boolean} [o.isEditorShown]             Whether the section is open (tests replace it).
 * @param {() => {nodes: object[], lineById: Map<string, Element>}} [o.read]
 *        Where the steps come from; the editor's lines by default. Custom
 *        steps read the one open in the editor from its lines, the others
 *        from their saved steps.
 * @param {(node: object) => void} [o.open]
 *        Brings a step that has no line yet into the editor (opens its
 *        custom step), before the panel goes to it.
 * @param {Element[]} [o.actions]   Controls of the section's own, shown under the title.
 * @param {{count: (kind: string, query: string) => number, label: string, go: (kind: string, query: string) => void}} [o.elsewhere]
 *        Says how many steps match in the other section, and leads there.
 * @param {() => void} [o.onRead]   Told each time the panel has read the steps again.
 * @param {(id: string) => string} [o.callName]  The name of the custom step a call runs.
 */
export function createStepsPanel(o) {
    const {host, editorEl, sectionKey, title, goToLine} = o;
    const doc = host.ownerDocument;
    const win = o.win || doc.defaultView;
    const storage = 'storage' in o ? o.storage : win?.localStorage;
    const isLineShown = o.isLineShown || ((line) => line.offsetParent !== null);
    const rectOf = o.rectOf || ((line) => line.getBoundingClientRect());
    const isEditorShown = o.isEditorShown || (() => editorEl.offsetParent !== null);

    const ids = new WeakMap();
    let nextId = 1;
    const idOf = (line) => {
        if (!ids.has(line)) ids.set(line, `s${nextId++}`);
        return ids.get(line);
    };
    const read = o.read || (() => readStepNodes(editorEl, idOf));

    const state = {
        kind: 'all',
        query: '',
        currentId: null,
        inViewId: null,
        focusId: null,
        hidden: readPanelHidden(storage, sectionKey),
        nodes: [],
        lineById: new Map(),
        view: {active: false, rows: [], matches: []}
    };
    const baseId = `steps-panel-${sectionKey}`;

    // ---- Skeleton ----
    host.classList.add('steps-panel');
    host.setAttribute('aria-label', title);
    host.textContent = '';

    const hideBtn = el(doc, 'button', {
        type: 'button', className: 'icon-button secondary-button steps-panel__hide',
        'aria-label': 'Hide the steps panel', title: 'Hide the steps panel',
        'aria-expanded': 'true', 'aria-controls': `${baseId}-full`
    }, icon(doc, CHEVRON_LEFT));
    const findInput = el(doc, 'input', {
        type: 'search', id: `${baseId}-find`, className: 'steps-panel__find',
        placeholder: 'Label, selector, URL, {var:…}', autocomplete: 'off', spellcheck: 'false'
    });
    const findLabel = el(doc, 'label', {for: `${baseId}-find`, className: 'steps-panel__find-label', text: 'Find steps'});
    const chipsEl = el(doc, 'div', {className: 'steps-panel__chips', role: 'group', 'aria-label': 'Show only'});
    // The count stands out, where it is among the matches does not:
    // "5 matches · 2 of 5". Read out whole as one status.
    const statusCount = el(doc, 'b', {className: 'steps-panel__status-count'});
    const statusWhere = el(doc, 'span', {className: 'steps-panel__status-where'});
    const statusText = el(doc, 'p', {className: 'steps-panel__status-text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'}, [statusCount, statusWhere]);
    const prevBtn = el(doc, 'button', {type: 'button', className: 'icon-button secondary-button', 'aria-label': 'Previous match', title: 'Previous match'}, icon(doc, CHEVRON_UP));
    const nextBtn = el(doc, 'button', {type: 'button', className: 'icon-button secondary-button', 'aria-label': 'Next match', title: 'Next match'}, icon(doc, CHEVRON_DOWN));
    const clearBtn = el(doc, 'button', {type: 'button', className: 'steps-panel__clear link-button', text: 'Clear the filter'});
    const navBtns = el(doc, 'div', {className: 'steps-panel__match-nav'}, [prevBtn, nextBtn]);
    const statusEl = el(doc, 'div', {className: 'steps-panel__status'}, [statusText, navBtns]);
    const elsewhereBtn = el(doc, 'button', {type: 'button', className: 'steps-panel__elsewhere link-button'});
    elsewhereBtn.hidden = true;
    // Under the count: clearing the filter, and matches in the other section.
    const linksEl = el(doc, 'div', {className: 'steps-panel__links'}, [clearBtn, elsewhereBtn]);
    const treeEl = el(doc, 'ul', {className: 'steps-panel__tree', role: 'tree', 'aria-label': title, id: `${baseId}-tree`});
    const emptyEl = el(doc, 'p', {className: 'steps-panel__empty'});

    const findField = el(doc, 'div', {className: 'steps-panel__find-field'}, [searchIcon(doc), findInput]);
    const hint = el(doc, 'p', {className: 'steps-panel__hint', 'aria-hidden': 'true'}, [
        el(doc, 'kbd', {text: '↑'}), el(doc, 'kbd', {text: '↓'}), ' move · ', el(doc, 'kbd', {text: 'Enter'}), ' opens the step'
    ]);

    const full = el(doc, 'div', {className: 'steps-panel__full', id: `${baseId}-full`}, [
        el(doc, 'div', {className: 'steps-panel__head'}, [el(doc, 'h3', {className: 'steps-panel__title', text: title}), hideBtn]),
        o.actions?.length ? el(doc, 'div', {className: 'steps-panel__actions'}, o.actions) : null,
        el(doc, 'div', {className: 'steps-panel__controls'}, [findLabel, findField, chipsEl, statusEl, linksEl]),
        treeEl,
        emptyEl,
        hint
    ]);

    const showBtn = el(doc, 'button', {
        type: 'button', className: 'icon-button secondary-button steps-panel__show',
        'aria-label': 'Show the steps panel', title: 'Show the steps panel',
        'aria-expanded': 'false', 'aria-controls': `${baseId}-full`
    }, icon(doc, CHEVRON_RIGHT));
    const railWhere = el(doc, 'span', {className: 'steps-panel__rail-where', 'aria-hidden': 'true'});
    const railCount = el(doc, 'span', {className: 'steps-panel__rail-count'});
    const rail = el(doc, 'div', {className: 'steps-panel__rail'}, [showBtn, railWhere, railCount]);

    host.append(full, rail);

    // ---- Drawing ----
    let rowIndex = new Map();

    function nodeById(id) {
        return state.nodes.find((n) => n.id === id) || null;
    }

    // The chips are made once and changed in place: made again on every
    // press, the pressed one lost focus, and putting it back laid out the
    // whole page, a fifth of a second at 1000 steps.
    const chipEls = new Map();
    KINDS.forEach(({id, label}) => {
        const count = id === 'all' ? null : el(doc, 'span', {className: 'steps-panel__chip-count', text: '0'});
        const btn = el(doc, 'button', {
            type: 'button', className: 'steps-panel__chip', 'aria-pressed': 'false', dataset: {kind: id}
        }, [el(doc, 'span', {text: label}), count]);
        chipEls.set(id, {btn, count});
        chipsEl.append(btn);
    });

    function drawChips() {
        const counts = countKinds(state.nodes);
        chipEls.forEach(({btn, count}, id) => {
            const pressed = state.kind === id;
            btn.hidden = id !== 'all' && !pressed && !counts[id];
            btn.classList.toggle('is-on', pressed);
            const p = pressed ? 'true' : 'false';
            if (btn.getAttribute('aria-pressed') !== p) btn.setAttribute('aria-pressed', p);
            if (count) setText(count, String(counts[id]));
        });
    }

    function drawStatus() {
        const {active, matches} = state.view;
        clearBtn.hidden = !active;
        navBtns.hidden = !active || matches.length === 0;
        if (!active) {
            const n = countKinds(state.nodes).all;
            setText(statusCount, n === 1 ? '1 step' : `${n} steps`);
            setText(statusWhere, '');
            return;
        }
        if (!matches.length) {
            setText(statusCount, 'No steps match.');
            setText(statusWhere, '');
            return;
        }
        const at = matchPosition(matches, state.currentId);
        const count = matches.length === 1 ? '1 match' : `${matches.length} matches`;
        setText(statusCount, count);
        setText(statusWhere, at ? ` · ${at} of ${matches.length}` : '');
    }

    function rowClass(row) {
        const node = row.node;
        return [
            'steps-panel__row',
            row.match ? 'is-match' : '',
            row.context ? 'is-context' : '',
            node.disabled ? 'is-disabled' : '',
            node.root ? 'is-root' : '',
            node.id === state.currentId ? 'is-current' : '',
            node.id === state.inViewId ? 'is-in-view' : ''
        ].filter(Boolean).join(' ');
    }

    function drawTree() {
        const {rows} = state.view;
        const positions = siblingPositions(rows);
        const listed = new Set(rows.map((r) => r.node.id));
        if (!listed.has(state.focusId)) {
            state.focusId = listed.has(state.currentId) ? state.currentId : (rows[0]?.node.id ?? null);
        }
        const frag = doc.createDocumentFragment();
        rowIndex = new Map(rows.map((row, i) => [row.node.id, i]));
        treeHeight = 0;
        rows.forEach((row) => {
            const node = row.node;
            const pos = positions.get(node.id);
            const item = el(doc, 'li', {
                role: 'treeitem', className: rowClass(row), tabindex: node.id === state.focusId ? '0' : '-1',
                // The indent and its guide lines are drawn by CSS from the depth.
                style: `--depth: ${node.depth}`,
                'aria-level': node.depth + 1, 'aria-setsize': pos.setsize, 'aria-posinset': pos.posinset,
                'aria-expanded': node.container ? 'true' : null,
                'aria-current': node.id === state.currentId ? 'true' : null,
                dataset: {stepId: node.id}
            }, [
                el(doc, 'span', {className: 'steps-panel__type', dataset: {cat: categoryOf(node)}, text: node.typeTitle}),
                node.path ? el(doc, 'span', {className: 'steps-panel__num', text: node.path}) : null,
                el(doc, 'span', {className: 'steps-panel__name'}, [
                    node.name,
                    node.disabled ? el(doc, 'span', {className: 'steps-panel__flag', text: ' (disabled)'}) : null
                ]),
                node.note ? el(doc, 'span', {className: 'steps-panel__note', text: node.note}) : null,
                row.context ? el(doc, 'span', {className: 'visually-hidden', text: ', holds matches'}) : null
            ]);
            frag.append(item);
        });
        // Drawing again replaces the rows: if one had focus, it goes back to
        // the same step's new row, or focus would fall to the page.
        const hadFocus = treeEl.contains(doc.activeElement) ? doc.activeElement.dataset?.stepId : null;
        treeEl.textContent = '';
        treeEl.append(frag);
        if (hadFocus) {
            const again = rowFor(listed.has(hadFocus) ? hadFocus : state.focusId);
            if (again) {
                treeEl.querySelectorAll('[role="treeitem"][tabindex="0"]').forEach((r) => r.setAttribute('tabindex', '-1'));
                again.setAttribute('tabindex', '0');
                again.focus({preventScroll: true});
            }
        }
        treeEl.hidden = rows.length === 0;
        emptyEl.hidden = rows.length > 0 || state.view.active;
        emptyEl.textContent = state.nodes.length ? '' : 'No steps yet.';
    }

    function drawRail() {
        const where = nodeById(state.inViewId) || nodeById(state.currentId);
        setText(railWhere, where ? `Steps · at ${where.path || where.name}` : 'Steps');
        const {active, matches} = state.view;
        railCount.hidden = !active;
        setText(railCount, active ? String(matches.length) : '');
        const label = active ? `${matches.length} matches for the current filter` : '';
        if (railCount.getAttribute('aria-label') !== label) railCount.setAttribute('aria-label', label);
    }

    function drawHidden() {
        treeHeight = 0;
        host.classList.toggle('is-hidden', state.hidden);
        full.hidden = state.hidden;
        rail.hidden = !state.hidden;
    }

    function drawElsewhere() {
        const n = o.elsewhere && state.view.active ? o.elsewhere.count(state.kind, state.query) : 0;
        elsewhereBtn.hidden = !n;
        linksEl.hidden = clearBtn.hidden && !n;
        if (n) setText(elsewhereBtn, `${n} more ${n === 1 ? 'match' : 'matches'} in ${o.elsewhere.label} →`);
    }

    function draw() {
        state.view = applyFilter(state.nodes, {kind: state.kind, query: state.query});
        drawChips();
        drawStatus();
        drawTree();
        drawRail();
        drawElsewhere();
    }

    function setFilter(kind, query) {
        state.kind = KINDS.some((k) => k.id === kind) ? kind : 'all';
        state.query = String(query || '');
        findInput.value = state.query;
        draw();
    }

    // ---- Reading the editor ----
    let visibleLines = null; // the lines drawn now, in order; null when stale

    let nodeOfLine = new WeakMap();

    function rebuild() {
        const got = read();
        // A call to a custom step with no title of its own is called by the
        // custom step it runs.
        if (o.callName) {
            got.nodes.forEach((n) => {
                if (n.type === 'runCustomStep' && n.calls && n.name === n.typeTitle) n.name = o.callName(n.calls) || n.calls;
            });
        }
        state.nodes = got.nodes;
        state.lineById = got.lineById;
        nodeOfLine = new WeakMap();
        state.nodes.forEach((n) => { const line = state.lineById.get(n.id); if (line) nodeOfLine.set(line, n); });
        if (state.currentId && !state.nodes.some((n) => n.id === state.currentId)) state.currentId = null;
        if (state.inViewId && !state.lineById.has(state.inViewId)) state.inViewId = null;
        visibleLines = null;
        draw();
        observeLines();
        warmSearchText();
        o.onRead?.();
    }

    // What a text filter looks in is read lazily; read it while the browser
    // is idle, a few steps at a time, so the first key typed in Find does not
    // wait for every field of every step.
    let warmHandle = null;
    function warmSearchText() {
        const idle = win?.requestIdleCallback?.bind(win);
        if (!idle) return;
        if (warmHandle) win.cancelIdleCallback?.(warmHandle);
        const nodes = state.nodes;
        let i = 0;
        const step = (deadline) => {
            while (i < nodes.length && deadline.timeRemaining() > 2) {
                void nodes[i].searchText;
                i += 1;
            }
            warmHandle = i < nodes.length && nodes === state.nodes ? idle(step) : null;
        };
        warmHandle = idle(step);
    }

    let rebuildTimer = null;
    function scheduleRebuild() {
        visibleLines = null;
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            rebuildTimer = null;
            rebuild();
        }, REBUILD_DELAY_MS);
    }

    const observer = win?.MutationObserver ? new win.MutationObserver(scheduleRebuild) : null;
    observer?.observe(editorEl, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-explicit-disabled', 'data-inherited-disabled', 'data-alias', 'data-action-index-path']
    });
    const onEdit = () => scheduleRebuild();
    editorEl.addEventListener('input', onEdit, true);
    editorEl.addEventListener('change', onEdit, true);
    // Opening or closing a card changes what is drawn, not the steps.
    const onEditorClick = () => { visibleLines = null; };
    editorEl.addEventListener('click', onEditorClick, true);

    // ---- Going to a step ----
    function markLocated(id) {
        editorEl.querySelectorAll('.line.is-located').forEach((l) => l.classList.remove('is-located'));
        const line = state.lineById.get(id);
        if (line) line.classList.add('is-located');
    }

    function goTo(id, {focus = false} = {}) {
        const node = nodeById(id);
        if (!node) return;
        let line = state.lineById.get(id) || null;
        // A step of a custom step that is not open: open it, then read the
        // editor again to find the step's line.
        if (!line && o.open) {
            o.open(node);
            rebuild();
            line = state.lineById.get(id) || null;
        }
        // The rows change in place: drawing the list again would take away
        // the row that has focus, and focus with it.
        const before = rowFor(state.currentId);
        if (before) {
            before.classList.remove('is-current');
            before.removeAttribute('aria-current');
        }
        state.currentId = id;
        const row = rowFor(id);
        if (row) {
            row.classList.add('is-current');
            row.setAttribute('aria-current', 'true');
            treeEl.querySelectorAll('[role="treeitem"][tabindex="0"]').forEach((r) => { if (r !== row) r.setAttribute('tabindex', '-1'); });
            row.setAttribute('tabindex', '0');
            state.focusId = id;
        }
        markLocated(id);
        goToLine(line, {focus, node});
        visibleLines = null;
        drawStatus();
        drawRail();
    }

    function stepMatch(direction) {
        const target = stepThroughMatches(state.nodes, state.view.matches, state.currentId, direction);
        if (target) goTo(target.id, {focus: false});
        if (target) keepRowInView(target.id);
    }

    // ---- Following the editor ----
    function rowFor(id) {
        return id ? treeEl.querySelector(`[data-step-id="${id}"]`) : null;
    }

    // Where rows are, worked out rather than read: reading a row's place
    // while the editor scrolls made the browser lay out the whole page again,
    // a seventh of a second a scroll at 1000 steps. Rows are one line high,
    // so a row's top is its index times the height of one, measured once.
    let rowHeight = 0;
    let treeHeight = 0;
    let treeScroll = 0;
    treeEl.addEventListener('scroll', () => { treeScroll = treeEl.scrollTop; }, {passive: true});

    function keepRowInView(id) {
        const index = rowIndex.get(id);
        if (index === undefined || treeEl.hidden || state.hidden) return;
        if (!rowHeight || !treeHeight) {
            const first = treeEl.firstElementChild;
            rowHeight = first ? first.offsetHeight : 0;
            treeHeight = treeEl.clientHeight;
            treeScroll = treeEl.scrollTop;
            if (!rowHeight || !treeHeight) return;
        }
        const top = index * rowHeight;
        if (top < treeScroll || top + rowHeight > treeScroll + treeHeight) {
            treeScroll = Math.max(0, top - treeHeight / 2);
            treeEl.scrollTop = treeScroll;
        }
    }

    function linesShown() {
        if (!visibleLines) {
            visibleLines = state.nodes
                .map((n) => state.lineById.get(n.id))
                .filter((line) => line && isLineShown(line));
        }
        return visibleLines;
    }

    /** The step at the reading line: the innermost one that spans it, else the next one below it. */
    function findInView() {
        const lines = linesShown();
        if (!lines.length) return null;
        // Lines are in document order, so their tops only go down: find the
        // last one that starts above the reading line…
        let lo = 0;
        let hi = lines.length - 1;
        let last = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (rectOf(lines[mid]).top <= IN_VIEW_LINE_PX) { last = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (last < 0) return lines[0];
        // …then the innermost line that still spans it: that one, or one of
        // the containers it is in, which come before it.
        for (let i = last; i >= 0; i -= 1) {
            if (rectOf(lines[i]).bottom > IN_VIEW_LINE_PX) return lines[i];
        }
        return lines[last + 1] || lines[last];
    }

    function setInView(id) {
        if (id === state.inViewId) return;
        rowFor(state.inViewId)?.classList.remove('is-in-view');
        state.inViewId = id;
        rowFor(id)?.classList.add('is-in-view');
        drawRail();
        keepRowInView(id);
    }

    /** Works the step in view out from where the lines are (without an observer, and in tests). */
    function syncInView() {
        if (!isEditorShown()) return;
        const line = findInView();
        const node = line ? nodeOfLine.get(line) : null;
        setInView(node ? node.id : null);
    }

    // With an IntersectionObserver, the browser says which lines cross a
    // one-pixel band at the reading line: the step there and the containers
    // it is in. The innermost is the step in view. Scrolling then reads no
    // layout: reading the lines' places on every scroll made the browser lay
    // out the whole editor again, a third of a second at 1000 steps.
    const useBand = !o.rectOf && typeof win?.IntersectionObserver === 'function';
    const crossing = new Set();
    let band = null;

    function onBand(entries) {
        entries.forEach((e) => { if (e.isIntersecting) crossing.add(e.target); else crossing.delete(e.target); });
        let best = null;
        crossing.forEach((line) => {
            const node = nodeOfLine.get(line);
            if (node && (!best || node.depth > best.depth)) best = node;
        });
        // Between two cards nothing crosses the band: keep the last one.
        if (best) setInView(best.id);
    }

    function observeLines() {
        if (!useBand) return;
        band?.disconnect();
        crossing.clear();
        const below = Math.max(0, (win.innerHeight || 800) - IN_VIEW_LINE_PX - 1);
        band = new win.IntersectionObserver(onBand, {rootMargin: `-${IN_VIEW_LINE_PX}px 0px -${below}px 0px`, threshold: 0});
        state.lineById.forEach((line) => band.observe(line));
    }

    let frame = 0;
    const onScroll = () => {
        if (frame) return;
        const raf = win?.requestAnimationFrame?.bind(win) || ((cb) => setTimeout(cb, 16));
        frame = raf(() => {
            frame = 0;
            syncInView();
        });
    };
    let resizeTimer = null;
    const onResize = () => {
        treeHeight = 0;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(observeLines, 150);
    };
    if (useBand) {
        win.addEventListener('resize', onResize, {passive: true});
    } else {
        win?.addEventListener('scroll', onScroll, {passive: true});
        win?.addEventListener('resize', onScroll, {passive: true});
    }

    // ---- Events ----
    findInput.addEventListener('input', () => {
        state.query = findInput.value;
        draw();
    });
    findInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            stepMatch(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape' && findInput.value) {
            event.preventDefault();
            findInput.value = '';
            state.query = '';
            draw();
        }
    });
    chipsEl.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-kind]');
        if (!btn) return;
        state.kind = btn.dataset.kind;
        draw();
    });
    clearBtn.addEventListener('click', () => {
        state.kind = 'all';
        state.query = '';
        findInput.value = '';
        draw();
        findInput.focus();
    });
    elsewhereBtn.addEventListener('click', () => o.elsewhere?.go(state.kind, state.query));
    prevBtn.addEventListener('click', () => stepMatch(-1));
    nextBtn.addEventListener('click', () => stepMatch(1));

    treeEl.addEventListener('click', (event) => {
        const item = event.target.closest('[role="treeitem"]');
        if (!item) return;
        goTo(item.dataset.stepId, {focus: true});
    });

    function focusRow(id) {
        const row = rowFor(id);
        if (!row) return;
        treeEl.querySelectorAll('[role="treeitem"][tabindex="0"]').forEach((r) => r.setAttribute('tabindex', '-1'));
        row.setAttribute('tabindex', '0');
        state.focusId = id;
        row.focus();
        keepRowInView(id);
    }

    treeEl.addEventListener('keydown', (event) => {
        const item = event.target.closest('[role="treeitem"]');
        if (!item) return;
        const rows = Array.from(treeEl.querySelectorAll('[role="treeitem"]'));
        const at = rows.indexOf(item);
        const node = nodeById(item.dataset.stepId);
        let target = null;
        switch (event.key) {
            case 'ArrowDown': target = rows[at + 1]; break;
            case 'ArrowUp': target = rows[at - 1]; break;
            case 'Home': target = rows[0]; break;
            case 'End': target = rows[rows.length - 1]; break;
            case 'ArrowRight': {
                const next = rows[at + 1];
                if (node?.container && next && nodeById(next.dataset.stepId)?.parentId === node.id) target = next;
                break;
            }
            case 'ArrowLeft': target = node?.parentId ? rowFor(node.parentId) : null; break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                goTo(item.dataset.stepId, {focus: true});
                return;
            default: return;
        }
        event.preventDefault();
        if (target) focusRow(target.dataset.stepId);
    });

    function setHidden(hidden, {remember = true, moveFocus = false} = {}) {
        state.hidden = !!hidden;
        if (remember) writePanelHidden(storage, sectionKey, state.hidden);
        hideBtn.setAttribute('aria-expanded', state.hidden ? 'false' : 'true');
        showBtn.setAttribute('aria-expanded', state.hidden ? 'false' : 'true');
        drawHidden();
        if (moveFocus) (state.hidden ? showBtn : hideBtn).focus();
    }
    hideBtn.addEventListener('click', () => setHidden(true, {moveFocus: true}));
    showBtn.addEventListener('click', () => setHidden(false, {moveFocus: true}));

    setHidden(state.hidden, {remember: false});
    rebuild();

    return {
        /** Reads the editor again now, after a change made all at once (a config loaded). */
        refresh: rebuild,
        /** Draws again without reading: a note changed. */
        redraw: draw,
        /** Counts the other section's matches again: its steps changed. */
        recountElsewhere: drawElsewhere,
        setHidden,
        setFilter,
        /** Goes to a step as clicking its row does. */
        goTo,
        /** Shows the panel if hidden and puts focus on a step's row, else the current one, else the first. */
        focusTree(id) {
            if (state.hidden) setHidden(false);
            const row = rowFor(id) || rowFor(state.currentId) || treeEl.querySelector('[role="treeitem"]');
            if (row) focusRow(row.dataset.stepId);
        },
        /** The steps as last read. */
        get nodes() { return state.nodes; },
        countMatches: (kind, query) => applyFilter(state.nodes, {kind, query}).matches.length,
        isHidden: () => state.hidden,
        /** For tests: what the panel holds. */
        get state() { return state; },
        syncInView,
        destroy() {
            observer?.disconnect();
            clearTimeout(rebuildTimer);
            editorEl.removeEventListener('input', onEdit, true);
            editorEl.removeEventListener('change', onEdit, true);
            editorEl.removeEventListener('click', onEditorClick, true);
            win?.removeEventListener('scroll', onScroll);
            win?.removeEventListener('resize', onScroll);
            win?.removeEventListener('resize', onResize);
            clearTimeout(resizeTimer);
            band?.disconnect();
            if (warmHandle) win?.cancelIdleCallback?.(warmHandle);
            host.textContent = '';
        }
    };
}
