'use strict';

/**
 * What a running workflow is doing, from its progress entries, for the queue
 * tab's running rows (docs/design/workflow-queue-batch-design.md §8.1): the step it
 * is on, inside which loop iterations, e.g. "Repeat 34 of 120 › Scan “Home”".
 *
 * Built from the entries' structured fields (extra.stepEvent, actionPath,
 * actionType, label, and a loop iteration's index and total), never their
 * text. Steps are kept as a stack: a step ends what it started, and the
 * deepest one still open is the one shown. Iterate steps running items side
 * by side interleave their steps; the latest one started is shown.
 */

function createRunActivity({ labelOf = (type) => type } = {}) {
    const open = []; // { path, type, label }, outermost first
    const loops = new Map(); // action path -> { index, total }

    function push(entry) {
        const extra = entry && entry.extra;
        const event = extra && extra.stepEvent;
        const at = extra && typeof extra.actionPath === 'string' ? extra.actionPath : null;
        if (!event || !at) return;
        if (event === 'action-start') {
            open.push({ path: at, type: extra.actionType || null, label: extra.label || null });
        } else if (event === 'action-end') {
            for (let i = open.length - 1; i >= 0; i -= 1) {
                if (open[i].path === at) {
                    open.splice(i, 1);
                    break;
                }
            }
            loops.delete(at);
        } else if (event === 'loop-iteration' && Number.isInteger(extra.index)) {
            loops.set(at, { index: extra.index, total: Number.isInteger(extra.total) ? extra.total : null });
        }
    }

    function stepName(step) {
        const name = labelOf(step.type) || step.type || 'Step';
        return step.label ? `${name} “${step.label}”` : name;
    }

    /** "Repeat 34 of 120 › Scan “Home”", or null before the first step. */
    function describe() {
        const current = open[open.length - 1];
        if (!current) return null;
        const parts = [];
        for (const step of open) {
            const loop = loops.get(step.path);
            if (!loop || step === current) continue;
            // Only the loops the current step is inside.
            if (!current.path.startsWith(`${step.path}.`)) continue;
            const n = loop.index + 1;
            parts.push(`${stepName(step)} ${loop.total ? `${n} of ${loop.total}` : n}`);
        }
        parts.push(stepName(current));
        return parts.join(' › ');
    }

    return { push, describe };
}

module.exports = { createRunActivity };
