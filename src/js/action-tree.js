// The workflow's steps as lines in the editor and as a tree: finding a step's
// line by its path, collapsing and expanding lines, matching a log entry to
// its step, and the tree of steps the run log shows. No state of the app's
// own: each function works on the elements or actions it is given (moved
// out of a11y-ui.js).

import {svgIcon} from './a11y-ui.utils.js';

/**
 * The icon button at the right end of the Batch, Custom steps and Workflow
 * headers repeats its section's toggle there. It presses that toggle and
 * follows its aria-expanded, whichever code changes it. It is there for the
 * pointer: out of the tab order and hidden from screen readers, which reach
 * the section's own toggle, so keyboard users stop at one, not two.
 */
export function initSectionEndToggles() {
    document.querySelectorAll('button.section-end-toggle[data-section-toggle]').forEach((btn) => {
        const toggle = document.getElementById(btn.dataset.sectionToggle);
        if (!toggle) return;
        btn.tabIndex = -1;
        btn.setAttribute('aria-hidden', 'true');
        const name = toggle.querySelector('.legend-toggle-label')?.textContent.trim().toLowerCase() || 'section';

        function refresh() {
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            btn.querySelector('svg')?.remove();
            btn.append(svgIcon(expanded ? 'collapse' : 'expand'));
            const label = `${expanded ? 'Collapse' : 'Expand'} ${name}`;
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }

        btn.addEventListener('click', () => toggle.click());
        new MutationObserver(refresh).observe(toggle, {attributes: true, attributeFilter: ['aria-expanded']});
        refresh();
    });
}

export function getDirectActionLines(containerEl) {
    if (!containerEl) return [];
    const out = [];
    Array.from(containerEl.children || []).forEach((child) => {
        if (!(child instanceof Element)) return;
        if (child.classList.contains('line')) {
            out.push(child);
            return;
        }
        if (child.classList.contains('stepper__panel')) {
            const line = child.querySelector(':scope > .line');
            if (line) out.push(line);
        }
    });
    return out;
}

export function getDirectNestedActionContainers(lineEl) {
    if (!lineEl) return [];
    return Array.from(
        lineEl.querySelectorAll(':scope > .action-arrays-below > .action-array > .actions-subcontainer, :scope > .action-array > .actions-subcontainer')
    );
}

export function findDirectNestedActionContainerByField(lineEl, fieldName) {
    const list = getDirectNestedActionContainers(lineEl);
    if (!list.length) return null;
    const key = String(fieldName || '').trim();
    if (!key) return list[0];
    return list.find((el) => String(el.dataset?.fieldName || '') === key) || null;
}

export function getLineToggleButton(lineEl) {
    if (!lineEl) return null;
    return lineEl.querySelector(':scope > .line-header .toggle-action') || lineEl.querySelector('.toggle-action');
}

export function collapseLineIfExpanded(lineEl) {
    if (!lineEl || lineEl.classList.contains('is-collapsed')) return;
    const toggle = getLineToggleButton(lineEl);
    if (toggle && !toggle.disabled) toggle.click();
}

export function expandLineIfCollapsed(lineEl) {
    if (!lineEl || !lineEl.classList.contains('is-collapsed')) return;
    const toggle = getLineToggleButton(lineEl);
    if (toggle && !toggle.disabled) toggle.click();
}

// A line hidden behind a collapsed ancestor (or any other hidden ancestor,
// e.g. a non-active stepper panel) doesn't count as "currently expanded"
// for the collapse-all/expand-all button below.
export function isLineVisible(lineEl) {
    return !!(lineEl && lineEl.offsetParent !== null);
}

export function hasVisibleExpandedLine(root) {
    if (!root) return false;
    return Array.from(root.querySelectorAll('.line')).some(
        (line) => !line.classList.contains('is-collapsed') && isLineVisible(line)
    );
}

export function collapseAllLinesIn(root) {
    if (!root) return;
    root.querySelectorAll('.line').forEach((line) => collapseLineIfExpanded(line));
}

export function expandAllLinesIn(root) {
    if (!root) return;
    root.querySelectorAll('.line').forEach((line) => expandLineIfCollapsed(line));
}

// Wires a single icon-button to collapse/expand every step under `root`.
// Its icon/label reflect the action the NEXT click will perform: collapse
// while at least one step is expanded and visible, expand otherwise.
// Returns a `refresh()` callers can invoke after anything changes the
// step list (add/remove/load, individual toggle, undo/redo).
export function setupCollapseAllStepsButton(btn, root) {
    if (!btn) return null;

    function refresh() {
        const lineCount = root ? root.querySelectorAll('.line').length : 0;
        btn.disabled = lineCount === 0;

        const willCollapse = hasVisibleExpandedLine(root);
        const oldSvg = btn.querySelector('svg');
        if (oldSvg) oldSvg.remove();
        btn.append(svgIcon(willCollapse ? 'collapse-all' : 'expand-all'));

        const label = willCollapse ? 'Collapse all steps' : 'Expand all steps';
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }

    btn.addEventListener('click', () => {
        if (hasVisibleExpandedLine(root)) collapseAllLinesIn(root);
        else expandAllLinesIn(root);
        refresh();
    });

    refresh();
    return refresh;
}

export function resolveLineByPathFromContainer(containerEl, path, arrayTrail, depth = 0) {
    const lines = getDirectActionLines(containerEl);
    const line = lines[path[depth] - 1];
    if (!line) return null;

    if (depth >= path.length - 1) {
        return { line, ancestors: [] };
    }

    // If we know the exact nested array field, follow it directly.
    if (arrayTrail[depth]) {
        const nextContainer = findDirectNestedActionContainerByField(line, arrayTrail[depth]);
        if (!nextContainer) return null;
        const nested = resolveLineByPathFromContainer(nextContainer, path, arrayTrail, depth + 1);
        if (!nested) return null;
        return { line: nested.line, ancestors: [line, ...nested.ancestors] };
    }

    // Otherwise, try every nested container until one resolves.
    const nestedContainers = getDirectNestedActionContainers(line);
    for (const nextContainer of nestedContainers) {
        const nested = resolveLineByPathFromContainer(nextContainer, path, arrayTrail, depth + 1);
        if (nested) return { line: nested.line, ancestors: [line, ...nested.ancestors] };
    }

    return null;
}

export function parseActionPath(pathRaw) {
    const txt = String(pathRaw || '').trim();
    if (!/^\d+(?:\.\d+)*$/.test(txt)) return null;
    const path = txt.split('.').map((part) => Number(part));
    if (!path.length || path.some((n) => !Number.isInteger(n) || n <= 0)) return null;
    return path;
}

export function extractActionPathFromMessage(messageRaw) {
    const txt = String(messageRaw || '');
    const m = /^Action\s+([0-9]+(?:\.[0-9]+)*)\s*\(/i.exec(txt);
    return m ? m[1] : '';
}

export function resolveStepRefForLogEntry(entry) {
    if (!entry || entry.type !== 'action-start') return null;

    const rawActionPath = String(entry?.extra?.actionPath || '').trim() || extractActionPathFromMessage(entry?.message);
    const path = parseActionPath(rawActionPath);
    if (!path) return null;

    const customStepStack = Array.isArray(entry?.extra?.customStepStack)
        ? entry.extra.customStepStack.map((v) => String(v || '').trim()).filter(Boolean)
        : [];

    if (customStepStack.length) {
        return {
            scope: 'custom-step',
            customStepId: customStepStack[customStepStack.length - 1],
            path,
            arrayTrail: []
        };
    }

    return {
        scope: 'workflow',
        path,
        arrayTrail: []
    };
}

export function getNestedActionArraysFromAction(actionObj) {
    const out = [];
    if (!actionObj || typeof actionObj !== 'object') return out;
    Object.entries(actionObj).forEach(([fieldName, value]) => {
        if (!Array.isArray(value)) return;
        const looksLikeActions = value.some((item) => item && typeof item === 'object' && typeof item.type === 'string');
        if (!looksLikeActions) return;
        out.push({ fieldName, actions: value });
    });
    return out;
}

export function buildCustomStepMaps(customSteps) {
    const byId = Object.create(null);
    const nameById = Object.create(null);
    (Array.isArray(customSteps) ? customSteps : []).forEach((step) => {
        const id = String(step?.id || '').trim();
        if (!id) return;
        byId[id] = step;
        nameById[id] = String(step?.name || '').trim() || id;
    });
    return { byId, nameById };
}

export function deriveActionDisplayLabel(action, customStepNamesById = null) {
    if (!action || typeof action !== 'object') return '';
    const preferred = String(action.label || action.name || action.title || action.alias || '').trim();
    if (preferred) return preferred;

    if (action.type === 'runCustomStep') {
        const customStepId = String(action.customStepId || action.id || '').trim();
        if (!customStepId) return '';
        const customStepName = customStepNamesById && customStepNamesById[customStepId]
            ? String(customStepNamesById[customStepId]).trim()
            : '';
        return customStepName && customStepName !== customStepId
            ? `${customStepId} — ${customStepName}`
            : customStepId;
    }

    return '';
}

export function buildActionTreeNodes(actions, baseRef, pathPrefix = [], arrayTrailPrefix = [], opts = {}) {
    const list = Array.isArray(actions) ? actions : [];
    const customStepsById = opts.customStepsById || null;
    const customStepNamesById = opts.customStepNamesById || null;
    const inlineCustomSteps = opts.inlineCustomSteps === true;
    const customStepStack = Array.isArray(opts.customStepStack) ? opts.customStepStack : [];

    return list
        .map((action, index) => {
            if (!action || typeof action !== 'object') return null;
            const path = pathPrefix.concat([index + 1]);
            const type = String(action.type || 'action');
            const customLabel = deriveActionDisplayLabel(action, customStepNamesById);
            const primary = customLabel || type;
            const label = `${path.join('.')} · ${primary}`;

            const nestedChildren = [];
            getNestedActionArraysFromAction(action).forEach(({ fieldName, actions: nestedActions }) => {
                nestedChildren.push(...buildActionTreeNodes(
                    nestedActions,
                    baseRef,
                    path,
                    arrayTrailPrefix.concat([fieldName]),
                    opts
                ));
            });

            if (inlineCustomSteps && type === 'runCustomStep' && customStepsById) {
                const customStepId = String(action.customStepId || action.id || '').trim();
                const customStepDef = customStepId ? customStepsById[customStepId] : null;
                if (customStepDef && Array.isArray(customStepDef.actions)) {
                    if (customStepStack.includes(customStepId)) {
                        nestedChildren.push({
                            label: `[cycle] custom step "${customStepId}"`,
                            ref: {
                                scope: 'custom-step',
                                customStepId,
                                path: [],
                                arrayTrail: []
                            },
                            children: []
                        });
                    } else {
                        const inlineChildren = buildActionTreeNodes(
                            customStepDef.actions,
                            { scope: 'custom-step', customStepId },
                            [],
                            [],
                            {
                                ...opts,
                                customStepStack: customStepStack.concat([customStepId])
                            }
                        );
                        nestedChildren.push(...inlineChildren);
                    }
                }
            }

            return {
                label,
                ref: {
                    ...baseRef,
                    path,
                    arrayTrail: arrayTrailPrefix.slice()
                },
                children: nestedChildren
            };
        })
        .filter(Boolean);
}
