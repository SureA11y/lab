// The roadmap of a workflow that is only saved, not open in the editor: the
// configuration a report carries (payload.config, and the zip's
// *.a11y-config.json). What a report shows and what the Workflow bar's
// dialog shows are the same drawing (workflow-roadmap.js).

import {readActionNodes} from './steps-panel.js';
import {expandCustomCalls} from './workflow-roadmap.js';

function parseList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * The roadmap's steps for a saved configuration, calls to custom steps opened in place.
 *
 * @param {object} config  An `a11y-ui-src-config`: its workflow and custom steps.
 * @param {{typeTitleOf: (type: string) => string, listsOf: (type: string) => string[], nameOfAction: (action: object) => string}} defs
 *        How the editor names a step: its type's title, which fields hold steps, and its own name.
 * @returns {object[]} Empty when the configuration holds no workflow.
 */
export function roadmapStepsFromConfig(config, {typeTitleOf, listsOf, nameOfAction}) {
    const state = config?.state || {};
    const workflow = parseList(state['actions-workflow']);
    if (!workflow.length) return [];
    const custom = parseList(state['custom-steps-json']).filter((d) => d && typeof d === 'object');
    const nameOfDef = (id) => {
        const def = custom.find((d) => String(d.id || '').trim() === id);
        return def ? String(def.name || def.id || '') : '';
    };
    // A call with no title of its own is named by the custom step it runs.
    const nameOf = (action) => nameOfAction(action)
        || (action.type === 'runCustomStep' ? nameOfDef(String(action.customStepId || '').trim()) : '');
    const read = (actions, idOf, extra = {}) => readActionNodes(actions, {idOf, typeTitleOf, nameOf, listsOf, ...extra});

    const workflowNodes = read(workflow, (key) => `w/${key}`);
    const customNodes = [];
    const defs = [];
    custom.forEach((def, i) => {
        const headId = `d${i}`;
        const name = String(def.name || def.id || `Custom step ${i + 1}`);
        customNodes.push({id: headId, root: true, depth: 0, name});
        customNodes.push(...read(def.actions, (key) => `${headId}/${key}`, {depth: 1, parentId: headId}));
        defs.push({id: String(def.id || '').trim(), headId, name});
    });
    return expandCustomCalls(workflowNodes, customNodes, defs);
}
