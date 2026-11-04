// The steps panel: a map of a section's steps beside its editor, to find
// them and go to them (docs/design/steps-panel-design.md). It reads the
// steps from the editor's lines, draws them as a tree with a filter, follows
// the editor as it scrolls, and folds away to a rail, which the browser
// remembers for the section. What it lists and matches is the model's
// (steps-panel-model.js); this draws it and wires it.

import {getDirectActionLines, getDirectNestedActionContainers} from './action-tree.js';
import {asList, isEdit, planChanges, sharedFields, tally} from './steps-bulk-edit.js';
import {
    KINDS, ancestorIds, applyFilter, countKinds, foldRows, isOfKind, matchPosition, siblingPositions, stepThroughMatches
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
                // Turned off by itself, not only by a container it is in.
                explicitDisabled: line.dataset.explicitDisabled === 'true',
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
                explicitDisabled: action.disabled === true,
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
 * @param {Element} [o.barHost]     Where the selection bar goes, above the editor.
 * @param {(lines: Element[], on: boolean) => number} [o.setDisabled]
 *        Turns steps off or on as one change; says how many changed.
 * @param {string} [o.unselectableNote]  Says why some steps cannot be selected.
 * @param {{defs: object, read: (line: Element) => object, apply: (entries: {line: Element, values: object}[]) => number, warn?: (nodes: object[]) => string}} [o.edit]
 *        Edit together: the step definitions, reading a step's values, and
 *        setting several steps' fields as one change.
 */
export function createStepsPanel(o) {
    const {host, editorEl, sectionKey, title, goToLine} = o;
    const doc = host.ownerDocument;
    const win = o.win || doc.defaultView;
    const storage = 'storage' in o ? o.storage : win?.localStorage;
    const isLineShown = o.isLineShown || ((line) => line.offsetParent !== null);
    const rectOf = o.rectOf || ((line) => line.getBoundingClientRect());
    const isEditorShown = o.isEditorShown || (() => editorEl.offsetParent !== null);

    // A step is known by its number and the lists it is in, not by its
    // card: Undo and Redo draw the cards again, and the step selected, the
    // current one and the folded ones must still be the same steps after.
    const read = o.read || (() => readStepNodes(editorEl, (line, key) => key));

    const state = {
        kind: 'all',
        query: '',
        currentId: null,
        inViewId: null,
        focusId: null,
        hidden: readPanelHidden(storage, sectionKey),
        nodes: [],
        lineById: new Map(),
        view: {active: false, rows: [], matches: []},
        // Selecting: on with Select, or ⌘/Ctrl-click on a row; off with Done.
        selecting: false,
        selected: new Set(),
        // Containers folded in the list (not while a filter is on).
        folded: new Set(),
        // Edit together: open or not, and the values chosen, by field.
        editOpen: false,
        edits: {},
        // What the last Disable, Enable or Apply did: said until the selection changes.
        barNote: ''
    };
    // ⌘ on a Mac, where Ctrl-click is the right click; Ctrl elsewhere.
    const isMac = /Mac|iPhone|iPad|iPod/i.test(win?.navigator?.userAgentData?.platform || win?.navigator?.platform || '');
    const modKeyName = isMac ? '⌘' : 'Ctrl';
    const withModKey = (event) => (isMac ? event.metaKey : event.ctrlKey);
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
    const selectBtn = el(doc, 'button', {
        type: 'button', className: 'steps-panel__select',
        title: `Choose steps to turn off or on together (or ${modKeyName}-click a step)`
    }, 'Select');
    const doneBtn = el(doc, 'button', {type: 'button', className: 'steps-panel__done'}, 'Done');
    doneBtn.hidden = true;
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
    const selectAllBox = el(doc, 'input', {type: 'checkbox', id: `${baseId}-all`});
    const selectAllText = el(doc, 'span', {text: 'Select all'});
    const selectAll = el(doc, 'label', {className: 'steps-panel__select-all', for: `${baseId}-all`}, [selectAllBox, selectAllText]);
    const unselectableEl = el(doc, 'p', {className: 'steps-panel__unselectable', text: o.unselectableNote || ''});
    const selectRow = el(doc, 'div', {className: 'steps-panel__select-row'}, [selectAll, unselectableEl]);
    selectRow.hidden = true;
    const treeEl = el(doc, 'ul', {className: 'steps-panel__tree', role: 'tree', 'aria-label': title, id: `${baseId}-tree`});
    const emptyEl = el(doc, 'p', {className: 'steps-panel__empty'});

    const findField = el(doc, 'div', {className: 'steps-panel__find-field'}, [searchIcon(doc), findInput]);
    const hint = el(doc, 'p', {className: 'steps-panel__hint', 'aria-hidden': 'true'});
    let hintFor = null;
    function drawHint() {
        // Written only when the mode changes: replacing it on every draw set
        // off the app's watchers of the page (see setText).
        if (hintFor === state.selecting) return;
        hintFor = state.selecting;
        hint.textContent = '';
        const k = (t) => el(doc, 'kbd', {text: t});
        if (state.selecting) hint.append(k('Space'), ' selects · ', k('Enter'), ' shows it · ', k('Esc'), ' done');
        else hint.append(k('↑'), k('↓'), ' move · ', k('Enter'), ' opens · ', k(modKeyName), '-click selects');
    }

    const full = el(doc, 'div', {className: 'steps-panel__full', id: `${baseId}-full`}, [
        el(doc, 'div', {className: 'steps-panel__head'}, [
            el(doc, 'h3', {className: 'steps-panel__title', text: title}),
            el(doc, 'div', {className: 'steps-panel__head-actions'}, [selectBtn, doneBtn, hideBtn])
        ]),
        o.actions?.length ? el(doc, 'div', {className: 'steps-panel__actions'}, o.actions) : null,
        el(doc, 'div', {className: 'steps-panel__controls'}, [findLabel, findField, chipsEl, statusEl, linksEl, selectRow]),
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

    // ---- The selection bar, above the editor ----
    const barCount = el(doc, 'b', {className: 'steps-panel-bar__count'});
    const barTypes = el(doc, 'span', {className: 'steps-panel-bar__types'});
    const barText = el(doc, 'p', {className: 'steps-panel-bar__text', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true'}, [barCount, barTypes]);
    const disableBtn = el(doc, 'button', {type: 'button', className: 'steps-panel-bar__btn'});
    const enableBtn = el(doc, 'button', {type: 'button', className: 'steps-panel-bar__btn'});
    const editToggle = el(doc, 'button', {
        type: 'button', className: 'steps-panel-bar__edit', 'aria-expanded': 'false', 'aria-controls': `${baseId}-edit`
    });
    const editHint = el(doc, 'span', {className: 'steps-panel-bar__edit-hint'});
    const editPending = el(doc, 'span', {className: 'steps-panel-bar__pending'});
    const editBody = el(doc, 'div', {className: 'steps-panel-edit', id: `${baseId}-edit`, role: 'group', 'aria-label': 'Edit the selected steps together'});
    editBody.hidden = true;
    const bar = el(doc, 'div', {className: 'steps-panel-bar', role: 'region', 'aria-label': `Selected ${title.toLowerCase()}`}, [
        el(doc, 'div', {className: 'steps-panel-bar__row'}, [
            barText,
            el(doc, 'div', {className: 'steps-panel-bar__actions', role: 'group', 'aria-label': 'For the selected steps'}, [disableBtn, enableBtn])
        ]),
        o.edit ? el(doc, 'div', {className: 'steps-panel-bar__row steps-panel-bar__row--edit'}, [editToggle, editHint, editPending]) : null,
        o.edit ? editBody : null
    ]);
    const barEmpty = el(doc, 'p', {className: 'steps-panel-bar__empty', text: 'Tick steps in the panel. They show here, in the order they run, wherever they are.'});
    bar.hidden = true;
    barEmpty.hidden = true;
    if (o.barHost) o.barHost.append(bar, barEmpty);

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
            node.id === state.inViewId ? 'is-in-view' : '',
            state.selecting && state.selected.has(node.id) ? 'is-selected' : ''
        ].filter(Boolean).join(' ');
    }

    function selectable(node) {
        return !!node && !node.root && state.lineById.has(node.id);
    }

    function drawTree() {
        const filtering = state.view.active;
        const rows = filtering ? state.view.rows : foldRows(state.view.rows, state.folded);
        const positions = siblingPositions(rows);
        const listed = new Set(rows.map((r) => r.node.id));
        if (!listed.has(state.focusId)) {
            state.focusId = listed.has(state.currentId) ? state.currentId : (rows[0]?.node.id ?? null);
        }
        const frag = doc.createDocumentFragment();
        rowIndex = new Map(rows.map((row, i) => [row.node.id, i]));
        if (state.selecting) treeEl.setAttribute('aria-multiselectable', 'true');
        else treeEl.removeAttribute('aria-multiselectable');
        rows.forEach((row) => {
            const node = row.node;
            const pos = positions.get(node.id);
            const item = el(doc, 'li', {
                role: 'treeitem', className: rowClass(row), tabindex: node.id === state.focusId ? '0' : '-1',
                // The indent and its guide lines are drawn by CSS from the depth.
                style: `--depth: ${node.depth}`,
                'aria-level': node.depth + 1, 'aria-setsize': pos.setsize, 'aria-posinset': pos.posinset,
                'aria-expanded': node.container ? (!filtering && state.folded.has(node.id) ? 'false' : 'true') : null,
                'aria-current': node.id === state.currentId ? 'true' : null,
                'aria-selected': state.selecting && selectable(node) ? (state.selected.has(node.id) ? 'true' : 'false') : null,
                dataset: {stepId: node.id}
            }, [
                // A container's caret folds it; it shows a filter's matches whatever their fold.
                node.container && !filtering
                    ? el(doc, 'span', {className: 'steps-panel__caret', 'aria-hidden': 'true', title: state.folded.has(node.id) ? 'Unfold' : 'Fold'}, state.folded.has(node.id) ? '▸' : '▾')
                    : el(doc, 'span', {className: 'steps-panel__caret is-leaf', 'aria-hidden': 'true'}),
                state.selecting && selectable(node)
                    ? el(doc, 'span', {className: `steps-panel__check${state.selected.has(node.id) ? ' is-on' : ''}`, 'aria-hidden': 'true'})
                    : null,
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
        drawSelection();
        drawHint();
    }

    // ---- Selecting ----
    /** The rows a "Select all" takes: the matches with a filter, else every step. */
    function poolForAll() {
        const list = state.view.active ? state.view.matches : state.nodes;
        return list.filter(selectable);
    }

    function selectedNodes() {
        return state.nodes.filter((n) => state.selected.has(n.id));
    }

    function drawSelection() {
        selectBtn.hidden = state.selecting;
        doneBtn.hidden = !state.selecting;
        selectRow.hidden = !state.selecting;
        const pool = poolForAll();
        const on = pool.filter((n) => state.selected.has(n.id)).length;
        selectAllBox.checked = pool.length > 0 && on === pool.length;
        selectAllBox.indeterminate = on > 0 && on < pool.length;
        selectAllBox.disabled = pool.length === 0;
        setText(selectAllText, state.view.active ? `Select all ${pool.length} matches` : `Select all ${pool.length} steps`);
        unselectableEl.hidden = !o.unselectableNote || !state.view.rows.some(({node}) => !node.root && !selectable(node));

        const picked = selectedNodes();
        bar.hidden = !state.selecting;
        barEmpty.hidden = !state.selecting || picked.length > 0;
        setText(barCount, picked.length === 1 ? '1 selected' : `${picked.length} selected`);
        const types = new Map();
        picked.forEach((n) => types.set(n.typeTitle, (types.get(n.typeTitle) || 0) + 1));
        setText(barTypes, state.barNote || (types.size ? ` · ${Array.from(types, ([t, n]) => `${n} ${t}`).join(', ')}` : ''));
        // Disable counts the steps it would turn off, Enable those it would
        // turn back on: a step off only because its container is stays as it is.
        const canOff = picked.filter((n) => !n.explicitDisabled).length;
        const canOn = picked.filter((n) => n.explicitDisabled).length;
        setText(disableBtn, canOff ? `Disable ${canOff}` : 'Disable');
        setText(enableBtn, canOn ? `Enable ${canOn}` : 'Enable');
        disableBtn.disabled = !canOff || !o.setDisabled;
        enableBtn.disabled = !canOn || !o.setDisabled;
        drawSelectionView();
        drawEdit();
    }

    // ---- Edit together ----
    let editFields = [];
    let editFieldsKey = '';
    let editValues = null; // Map: step id -> its values, read when needed
    let moreOpen = false;

    let valuesKey = '';
    function selectedValues() {
        const key = Array.from(state.selected).join('\n');
        if (key !== valuesKey) {
            valuesKey = key;
            editValues = null;
        }
        if (!editValues) {
            editValues = new Map();
            selectedNodes().forEach((n) => {
                const line = state.lineById.get(n.id);
                if (line) editValues.set(n.id, o.edit.read(line) || {});
            });
        }
        return editValues;
    }

    function currentPlan() {
        const values = selectedValues();
        return planChanges(Array.from(values, ([id, v]) => ({id, values: v})), state.edits, editFields);
    }

    function fieldControl(f) {
        const id = `${baseId}-edit-${f.name}`;
        const edit = state.edits[f.name] || {};
        const keep = 'Keep each step\u2019s own';
        let control;
        if (f.kind === 'choice' || f.kind === 'boolean') {
            const opts = f.kind === 'boolean' ? [{value: 'true', label: 'Yes'}, {value: 'false', label: 'No'}] : f.options;
            control = el(doc, 'select', {id, className: 'steps-panel-edit__control', dataset: {field: f.name}},
                [el(doc, 'option', {value: ''}, keep), ...opts.map((op) => el(doc, 'option', {value: op.value}, op.label))]);
            control.value = edit.value == null ? '' : String(edit.value);
        } else if (f.kind === 'list') {
            const mode = el(doc, 'select', {className: 'steps-panel-edit__mode', 'aria-label': `${f.label}: add or remove`, dataset: {field: f.name, part: 'mode'}},
                [el(doc, 'option', {value: 'add'}, 'Add'), el(doc, 'option', {value: 'remove'}, 'Remove')]);
            mode.value = edit.mode || 'add';
            const input = el(doc, 'input', {id, type: 'text', className: 'steps-panel-edit__control', placeholder: 'Comma-separated', dataset: {field: f.name}});
            input.value = asList(edit.value).join(', ');
            control = el(doc, 'div', {className: 'steps-panel-edit__list'}, [mode, input]);
        } else {
            control = el(doc, 'input', {id, type: f.kind === 'number' ? 'number' : 'text', className: 'steps-panel-edit__control', placeholder: keep, dataset: {field: f.name}});
            control.value = edit.value == null ? '' : String(edit.value);
        }
        return control;
    }

    function fieldRow(f, values) {
        const now = tally(values.map((v) => v?.[f.name]), f);
        const nowEl = el(doc, 'p', {className: 'steps-panel-edit__now'}, [
            'Now: ',
            now.length > 1 ? el(doc, 'span', {className: 'steps-panel-edit__mixed', text: 'Mixed'}) : null,
            ...now.map(({text, n}) => el(doc, 'span', {className: 'steps-panel-edit__value'}, [text, el(doc, 'b', {text: ` ×${n}`})]))
        ]);
        return el(doc, 'div', {className: 'steps-panel-edit__row', dataset: {field: f.name}}, [
            el(doc, 'label', {className: 'steps-panel-edit__label', for: `${baseId}-edit-${f.name}`, text: f.label}),
            el(doc, 'div', {className: 'steps-panel-edit__field'}, [nowEl, fieldControl(f)]),
            el(doc, 'p', {className: 'steps-panel-edit__count', dataset: {count: f.name}})
        ]);
    }

    const editWarn = el(doc, 'p', {className: 'steps-panel-edit__warn'});
    const editSummary = el(doc, 'p', {className: 'steps-panel-edit__summary', role: 'status', 'aria-live': 'polite'});
    const editClear = el(doc, 'button', {type: 'button', className: 'steps-panel-edit__clear'}, 'Clear changes');
    const editApply = el(doc, 'button', {type: 'button', className: 'steps-panel-edit__apply'});
    const moreBtn = el(doc, 'button', {type: 'button', className: 'steps-panel-edit__more', 'aria-expanded': 'false'});

    function drawEditForm() {
        const picked = selectedNodes();
        const key = Array.from(new Set(picked.map((n) => n.type))).sort().join(',');
        if (key === editFieldsKey && editBody.firstChild) return false;
        editFieldsKey = key;
        editFields = o.edit ? sharedFields(picked.map((n) => n.type), o.edit.defs) : [];
        Object.keys(state.edits).forEach((name) => { if (!editFields.some((f) => f.name === name)) delete state.edits[name]; });
        const values = Array.from(selectedValues().values());
        // Drawn again after the editor is read again (an Undo, say): focus
        // goes back to the control that had it, the caret where it was.
        const had = editBody.contains(doc.activeElement) ? doc.activeElement : null;
        const back = had ? {field: had.dataset?.field, part: had.dataset?.part || '', cls: had.className, at: had.selectionStart} : null;
        editBody.textContent = '';
        const types = key.split(',').filter(Boolean);
        editBody.append(el(doc, 'p', {className: 'steps-panel-edit__intro', text: types.length > 1
            ? `These steps are of ${types.length} kinds, so only the fields they all have are here. Only the fields you change are written.`
            : 'Only the fields you change are written; the rest stay as each step has them. Each card shows what it will get.'}));
        if (!editFields.length) {
            editBody.append(el(doc, 'p', {className: 'steps-panel-edit__none', text: 'These steps share no field that can be set for all of them at once.'}));
            return true;
        }
        const primary = editFields.filter((f) => f.primary);
        const rest = editFields.filter((f) => !f.primary);
        const main = primary.length ? primary : rest.splice(0, 4);
        main.forEach((f) => editBody.append(fieldRow(f, values)));
        if (rest.length) {
            const more = el(doc, 'div', {className: 'steps-panel-edit__rest', id: `${baseId}-edit-more`});
            rest.forEach((f) => more.append(fieldRow(f, values)));
            more.hidden = !moreOpen && !rest.some((f) => isEdit(state.edits[f.name], f));
            moreBtn.setAttribute('aria-controls', more.id);
            moreBtn.setAttribute('aria-expanded', more.hidden ? 'false' : 'true');
            setText(moreBtn, more.hidden ? `More fields (${rest.length})` : 'Fewer fields');
            editBody.append(moreBtn, more);
        }
        editBody.append(editWarn, el(doc, 'div', {className: 'steps-panel-edit__foot'}, [editSummary, editClear, editApply]));
        if (back) {
            const again = back.field
                ? editBody.querySelector(`[data-field="${back.field}"]${back.part ? `[data-part="${back.part}"]` : ':not([data-part])'}`)
                : Array.from(editBody.querySelectorAll('button')).find((x) => x.className === back.cls);
            if (again) {
                again.focus({preventScroll: true});
                if (typeof back.at === 'number' && typeof again.setSelectionRange === 'function') {
                    try { again.setSelectionRange(back.at, back.at); } catch { /* not a text field */ }
                }
            }
        }
        return true;
    }

    // Whether any card shows a preview now: clearing them searches the
    // whole editor, too slow to do on every draw of a thousand steps.
    let previewsShown = false;
    function drawPreviews(plan) {
        if (!plan.length && !previewsShown) return;
        previewsShown = plan.length > 0;
        editorEl.querySelectorAll('.steps-panel-preview').forEach((n) => n.remove());
        editorEl.querySelectorAll('.field.has-pending-change').forEach((f) => f.classList.remove('has-pending-change'));
        plan.forEach(({id, changes}) => {
            const line = state.lineById.get(id);
            const head = line?.querySelector(':scope > .line-header');
            if (!head) return;
            const items = changes.map((c) => el(doc, 'li', {}, [
                el(doc, 'span', {className: 'steps-panel-preview__field', text: `${c.label}: `}),
                el(doc, 'del', {text: c.beforeText}),
                el(doc, 'span', {'aria-hidden': 'true', text: ' → '}),
                el(doc, 'span', {className: 'visually-hidden', text: ' becomes '}),
                el(doc, 'ins', {text: c.afterText})
            ]));
            head.after(el(doc, 'div', {className: 'steps-panel-preview'}, [
                el(doc, 'p', {className: 'steps-panel-preview__title', text: changes.length === 1 ? 'Will change, once applied:' : `${changes.length} changes, once applied:`}),
                el(doc, 'ul', {}, items)
            ]));
            changes.forEach((c) => line.querySelector(`:scope > .fields > .field[data-field-name="${c.name}"]`)?.classList.add('has-pending-change'));
        });
    }

    function drawEdit() {
        if (!o.edit) return;
        const picked = selectedNodes();
        const n = picked.length;
        const can = state.selecting && n >= 2;
        if (!can) state.editOpen = false;
        editToggle.disabled = !can;
        editToggle.setAttribute('aria-expanded', state.editOpen ? 'true' : 'false');
        setText(editToggle, n >= 2 ? `${state.editOpen ? '▾' : '▸'} Edit ${n} steps together` : '▸ Edit steps together');
        setText(editHint, n < 2 ? 'Select 2 or more steps to change them together.' : '');
        editBody.hidden = !state.editOpen;
        if (!state.selecting) {
            state.edits = {};
            editValues = null;
            editFieldsKey = '';
            if (editBody.firstChild) editBody.textContent = '';
            drawPreviews([]);
            setText(editPending, '');
            return;
        }
        if (state.editOpen) drawEditForm();
        const plan = n >= 2 ? currentPlan() : [];
        const changes = plan.reduce((a, p) => a + p.changes.length, 0);
        setText(editPending, changes ? `${changes} ${changes === 1 ? 'change' : 'changes'} in ${plan.length} ${plan.length === 1 ? 'step' : 'steps'}, not applied` : '');
        if (state.editOpen) {
            editFields.forEach((f) => {
                const k = plan.filter((p) => p.changes.some((c) => c.name === f.name)).length;
                const countEl = editBody.querySelector(`[data-count="${f.name}"]`);
                if (countEl) setText(countEl, k ? `Changes ${k} of ${n}` : '');
                editBody.querySelector(`.steps-panel-edit__row[data-field="${f.name}"]`)?.classList.toggle('is-changed', k > 0);
            });
            const warn = o.edit.warn ? o.edit.warn(picked) : '';
            editWarn.hidden = !warn;
            setText(editWarn, warn || '');
            setText(editSummary, changes ? `${changes} ${changes === 1 ? 'change' : 'changes'} in ${plan.length} ${plan.length === 1 ? 'step' : 'steps'}` : 'Nothing to change yet.');
            setText(editApply, plan.length ? `Apply to ${plan.length} ${plan.length === 1 ? 'step' : 'steps'}` : 'Apply');
            editApply.disabled = !plan.length;
            editClear.disabled = !Object.keys(state.edits).length;
        }
        drawPreviews(plan);
    }

    function setEdit(name, patch) {
        const now = {...(state.edits[name] || {}), ...patch};
        state.edits[name] = now;
        drawEdit();
    }

    function applyEdit() {
        const plan = currentPlan();
        if (!plan.length) return;
        const entries = plan.map(({id, changes}) => ({
            line: state.lineById.get(id),
            values: Object.fromEntries(changes.map((c) => [c.name, c.after]))
        })).filter((e) => e.line);
        const fields = plan.reduce((a, p) => a + p.changes.length, 0);
        drawPreviews([]);
        const n = o.edit.apply(entries);
        state.edits = {};
        editValues = null;
        editFieldsKey = '';
        state.barNote = ` · changed ${fields} ${fields === 1 ? 'field' : 'fields'} in ${n} ${n === 1 ? 'step' : 'steps'}; Undo puts ${fields === 1 ? 'it' : 'them'} back`;
        rebuild();
        editToggle.focus();
    }

    // The editor shows only the selected steps and, as their path, the
    // containers they are in: a class on the editor and on those lines; no
    // line is moved, opened or closed.
    // Drawn again only when the selection, the mode or the cards change:
    // touching the editor's classes makes the browser restyle all of it.
    let viewDrawn = '';
    function drawSelectionView() {
        const want = state.selecting ? `on:${Array.from(state.selected).join(',')}` : 'off';
        if (want === viewDrawn) return;
        viewDrawn = want;
        editorEl.querySelectorAll('.line.is-picked, .line.is-picked-path').forEach((l) => l.classList.remove('is-picked', 'is-picked-path'));
        editorEl.classList.toggle('is-selection-view', state.selecting);
        o.barHost?.classList.toggle('is-selecting', state.selecting);
        if (!state.selecting) return;
        state.selected.forEach((id) => {
            const line = state.lineById.get(id);
            if (!line) return;
            line.classList.add('is-picked');
            for (let p = line.parentElement?.closest('.line'); p && editorEl.contains(p); p = p.parentElement?.closest('.line')) p.classList.add('is-picked-path');
        });
    }

    function startSelecting() {
        if (state.selecting) return;
        state.selecting = true;
        state.selected.clear();
        state.barNote = '';
    }

    function stopSelecting({moveFocus = false} = {}) {
        if (!state.selecting) return;
        state.selecting = false;
        state.selected.clear();
        draw();
        if (moveFocus) selectBtn.focus();
        const line = state.lineById.get(state.currentId);
        if (line) goToLine(line, {focus: false, node: nodeById(state.currentId)});
    }

    function toggleSelected(id, on = !state.selected.has(id)) {
        const node = nodeById(id);
        if (!selectable(node)) return;
        if (on) state.selected.add(id);
        else state.selected.delete(id);
        editValues = null;
        state.barNote = '';
        const row = rowFor(id);
        if (row) {
            row.classList.toggle('is-selected', on);
            row.setAttribute('aria-selected', on ? 'true' : 'false');
            row.querySelector('.steps-panel__check')?.classList.toggle('is-on', on);
        }
        drawSelection();
    }

    function setDisabled(on) {
        const lines = selectedNodes()
            .filter((n) => (on ? !n.explicitDisabled : n.explicitDisabled))
            .map((n) => state.lineById.get(n.id))
            .filter(Boolean);
        if (!lines.length || !o.setDisabled) return;
        const n = o.setDisabled(lines, on);
        state.barNote = ` · ${on ? 'turned off' : 'turned on'} ${n} ${n === 1 ? 'step' : 'steps'}; Undo puts ${n === 1 ? 'it' : 'them'} back`;
        rebuild();
    }

    // ---- Folding ----
    function setFolded(id, folded) {
        const node = nodeById(id);
        if (!node?.container || state.view.active) return;
        if (folded) state.folded.add(id);
        else state.folded.delete(id);
        drawTree();
        focusRow(id);
    }

    /** Unfolds the containers a step is in, so its row is listed. */
    function unfoldTo(id) {
        let changed = false;
        ancestorIds(state.nodes, id).forEach((a) => { if (state.folded.delete(a)) changed = true; });
        if (changed) drawTree();
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
        // A step whose card is still there follows its card to its new
        // number (a step moved, or one before it removed); one whose card
        // was drawn again (Undo, Redo) keeps its number.
        const idOfLine = new Map();
        got.lineById.forEach((line, id) => idOfLine.set(line, id));
        // Undo and Redo draw every card again; a step removed takes only its
        // own: if any card is still there, a card that is not was removed.
        const redrawnAll = !Array.from(state.lineById.values()).some((line) => idOfLine.has(line));
        const follow = (id) => {
            const line = state.lineById.get(id);
            if (line && idOfLine.has(line)) return idOfLine.get(line);
            return redrawnAll ? id : null;
        };
        state.selected = new Set(Array.from(state.selected, follow).filter(Boolean));
        state.folded = new Set(Array.from(state.folded, (id) => follow(id) || id));
        if (state.currentId) state.currentId = follow(state.currentId);
        if (state.focusId) state.focusId = follow(state.focusId) || state.focusId;
        state.nodes = got.nodes;
        state.lineById = got.lineById;
        if (state.selecting) viewDrawn = '';
        editValues = null;
        editFieldsKey = '';
        state.selected.forEach((id) => { if (!state.lineById.has(id)) state.selected.delete(id); });
        state.folded.forEach((id) => { if (!state.nodes.some((n) => n.id === id)) state.folded.delete(id); });
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

    // The previews of Edit together are the panel's own: adding or taking
    // them away is not a change of the steps.
    const isOwnNode = (n) => n?.nodeType === 1 && n.classList?.contains('steps-panel-preview');
    const isOwnRecord = (r) => (r.type === 'childList'
        && [...r.addedNodes, ...r.removedNodes].every(isOwnNode))
        || !!r.target?.closest?.('.steps-panel-preview');
    const observer = win?.MutationObserver ? new win.MutationObserver((records) => {
        if (records.every(isOwnRecord)) return;
        scheduleRebuild();
    }) : null;
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
        if (!rowFor(id)) unfoldTo(id);
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
    }

    // ---- Following the editor ----
    function rowFor(id) {
        return id ? treeEl.querySelector(`[data-step-id="${id}"]`) : null;
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
        // A step folded away is shown by the nearest container that is listed.
        if (id && !rowIndex.has(id)) id = ancestorIds(state.nodes, id).find((a) => rowIndex.has(a)) || id;
        if (id === state.inViewId) return;
        rowFor(state.inViewId)?.classList.remove('is-in-view');
        state.inViewId = id;
        rowFor(id)?.classList.add('is-in-view');
        drawRail();
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
    selectBtn.addEventListener('click', () => {
        startSelecting();
        draw();
        doneBtn.focus();
    });
    doneBtn.addEventListener('click', () => stopSelecting({moveFocus: true}));
    selectAllBox.addEventListener('change', () => {
        editValues = null;
        state.barNote = '';
        const pool = poolForAll();
        if (selectAllBox.checked) pool.forEach((n) => state.selected.add(n.id));
        else pool.forEach((n) => state.selected.delete(n.id));
        draw();
    });
    disableBtn.addEventListener('click', () => setDisabled(true));
    editToggle.addEventListener('click', () => {
        state.editOpen = !state.editOpen;
        drawEdit();
        if (state.editOpen) editBody.querySelector('select, input')?.focus();
    });
    const onEditInput = (event) => {
        const t = event.target;
        const name = t.dataset?.field;
        if (!name) return;
        if (t.dataset.part === 'mode') setEdit(name, {mode: t.value});
        else setEdit(name, {value: t.value});
    };
    editBody.addEventListener('input', onEditInput);
    editBody.addEventListener('change', onEditInput);
    moreBtn.addEventListener('click', () => {
        moreOpen = !moreOpen;
        editFieldsKey = '';
        drawEdit();
        moreBtn.focus();
    });
    editClear.addEventListener('click', () => {
        state.edits = {};
        editFieldsKey = '';
        drawEdit();
        editToggle.focus();
    });
    editApply.addEventListener('click', applyEdit);
    enableBtn.addEventListener('click', () => setDisabled(false));
    prevBtn.addEventListener('click', () => stepMatch(-1));
    nextBtn.addEventListener('click', () => stepMatch(1));

    treeEl.addEventListener('click', (event) => {
        const item = event.target.closest('[role="treeitem"]');
        if (!item) return;
        const id = item.dataset.stepId;
        const node = nodeById(id);
        if (event.target.closest('.steps-panel__caret') && node?.container && !state.view.active) {
            setFolded(id, !state.folded.has(id));
            return;
        }
        // ⌘/Ctrl-click: selects, turning Select on with the current step if it was off.
        if (withModKey(event)) {
            event.preventDefault();
            if (!selectable(node)) return;
            if (!state.selecting) {
                startSelecting();
                if (selectable(nodeById(state.currentId))) state.selected.add(state.currentId);
                state.selected.add(id);
                state.focusId = id;
                draw();
                focusRow(id);
                return;
            }
            toggleSelected(id);
            return;
        }
        if (state.selecting) {
            // While selecting, a click picks or drops the step, and that is
            // all: the editor stays where it is and focus stays on the row.
            toggleSelected(id);
            const row = rowFor(id);
            if (row) {
                treeEl.querySelectorAll('[role="treeitem"][tabindex="0"]').forEach((r) => r.setAttribute('tabindex', '-1'));
                row.setAttribute('tabindex', '0');
                state.focusId = id;
                row.focus({preventScroll: true});
            }
            return;
        }
        goTo(id, {focus: true});
    });

    function focusRow(id) {
        const row = rowFor(id);
        if (!row) return;
        treeEl.querySelectorAll('[role="treeitem"][tabindex="0"]').forEach((r) => r.setAttribute('tabindex', '-1'));
        row.setAttribute('tabindex', '0');
        state.focusId = id;
        // Moving focus is the one time the list moves: the browser keeps the
        // focused row in sight, or someone at the keyboard would lose it.
        row.focus();
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
                // A folded container unfolds; an open one goes to its first step.
                if (node?.container && !state.view.active && state.folded.has(node.id)) {
                    event.preventDefault();
                    setFolded(node.id, false);
                    return;
                }
                const next = rows[at + 1];
                if (node?.container && next && nodeById(next.dataset.stepId)?.parentId === node.id) target = next;
                break;
            }
            case 'ArrowLeft':
                // An open container folds; anything else goes to its container.
                if (node?.container && !state.view.active && !state.folded.has(node.id)) {
                    event.preventDefault();
                    setFolded(node.id, true);
                    return;
                }
                target = node?.parentId ? rowFor(node.parentId) : null;
                break;
            case 'Enter':
                event.preventDefault();
                // While selecting, Enter shows the step's card and focus stays here.
                goTo(item.dataset.stepId, {focus: !state.selecting});
                if (state.selecting) item.focus({preventScroll: true});
                return;
            case ' ':
                event.preventDefault();
                if (state.selecting) toggleSelected(item.dataset.stepId);
                else goTo(item.dataset.stepId, {focus: true});
                return;
            case 'Escape':
                if (!state.selecting) return;
                event.preventDefault();
                stopSelecting();
                focusRow(item.dataset.stepId);
                return;
            case 'a':
            case 'A':
                if (!state.selecting || !withModKey(event)) return;
                event.preventDefault();
                poolForAll().forEach((n) => state.selected.add(n.id));
                state.barNote = '';
                draw();
                focusRow(item.dataset.stepId);
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
        /** For tests and the app: whether selecting, and what is selected. */
        get selecting() { return state.selecting; },
        get selectedIds() { return Array.from(state.selected); },
        stopSelecting,
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
            bar.remove();
            barEmpty.remove();
            if (warmHandle) win?.cancelIdleCallback?.(warmHandle);
            host.textContent = '';
        }
    };
}
