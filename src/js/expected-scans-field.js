'use strict';

/**
 * The Workflow header's "Expected scans" field.
 *
 * The field holds only what the person typed, so a saved configuration never
 * carries a number the workflow worked out and later outgrew. What the
 * workflow works out itself is shown beside it:
 *
 * - "calculated": every path through the workflow runs the same number of
 *   scans, so that number is used when the field is empty (placeholder shows it).
 * - "not sure": the number of scans depends on a condition or on how many items
 *   a loop finds, so there is no time estimate until a number is typed. The
 *   placeholder says "up to N" where the workflow has a ceiling.
 * - nothing: the person typed one, or the workflow has no scans.
 *
 * The workflow is looked at again when it changes (a step added, removed or
 * edited) and when a configuration is opened.
 */

const DEBOUNCE_MS = 300;

/**
 * What to show for a workflow with no number typed.
 * -> { kind: 'calculated' | 'unsure' | 'none', count, ceiling }
 * `estimate` is the shared module (shared/scan-time-estimate.js) and `plan`
 * what planWorkflowSteps returns.
 */
export function describeExpectedScans(plan, estimate, type = 'a11yScan') {
    const exact = estimate.exactScanCount(plan, type);
    if (exact) return {kind: 'calculated', count: exact, ceiling: exact};

    const slot = plan && plan.byType ? plan.byType[type] : null;
    const loops = plan && Array.isArray(plan.unsizedLoops) ? plan.unsizedLoops : [];
    const inUnsizedLoop = loops.some((l) => l && l.perIterationByType && l.perIterationByType[type] > 0);
    if (!slot && !inUnsizedLoop) return {kind: 'none', count: null, ceiling: null};

    // A loop with no limit has no ceiling, so "up to" would be a guess.
    const ceiling = !inUnsizedLoop && slot && slot.max > 0 ? slot.max : null;
    return {kind: 'unsure', count: null, ceiling};
}

function hintText(info, typed) {
    const base = 'How many scans this run is expected to do, counting every scan that runs: each scan inside a Merged scan counts, not the one scan the report keeps. The time left is worked out from it and from how long the scans have taken so far.';
    if (typed) return `${base} Clear it to use the workflow's own count, when it has one.`;
    if (info.kind === 'calculated') {
        return `${base} This workflow runs ${info.count} scan${info.count === 1 ? '' : 's'} on every path, so that is used. Type a number to use another.`;
    }
    if (info.kind === 'unsure') {
        return `${base} The number of scans here depends on conditions or loops. Left empty, it comes from the last run of this workflow, and, once two items of a loop are done, from the scans they took; a number typed gives way to that count where they disagree.`;
    }
    return `${base} Leave it empty for no estimate.`;
}

/**
 * Wires the field. -> { refresh }.
 *
 * getWorkflow: () => { actions, customSteps } as the editor stands, or null.
 * watch: elements whose changes (steps added or removed, fields edited) call
 * for another look.
 */
export function setupExpectedScansField({
    doc = document,
    getWorkflow,
    watch = [],
    estimate = globalThis.A11Y_SCAN_TIME_ESTIMATE,
    plan = globalThis.A11Y_WORKFLOW_STEP_PLAN,
    schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
    const input = doc.getElementById('run-expected-scans');
    const note = doc.getElementById('run-expected-scans-note');
    const hint = doc.getElementById('run-expected-scans-hint');
    if (!input || !estimate || !plan || typeof getWorkflow !== 'function') return {refresh() {}};

    function refresh() {
        const typed = input.value.trim() !== '';
        let info = {kind: 'none', count: null, ceiling: null};

        if (!typed) {
            try {
                const workflow = getWorkflow();
                if (workflow && Array.isArray(workflow.actions) && workflow.actions.length) {
                    const walked = plan.planWorkflowSteps(workflow.actions, {customSteps: workflow.customSteps});
                    info = describeExpectedScans(walked, estimate);
                }
            } catch {
                // A workflow that cannot be walked has no count to offer.
            }
        }

        input.placeholder = info.kind === 'calculated'
            ? String(info.count)
            : (info.kind === 'unsure' && info.ceiling ? `up to ${info.ceiling}` : '');

        if (note) {
            note.textContent = typed ? '' : (info.kind === 'calculated' ? 'calculated' : (info.kind === 'unsure' ? 'not sure' : ''));
            note.dataset.kind = typed ? 'none' : info.kind;
        }
        if (hint) hint.textContent = hintText(info, typed);
    }

    let timer = null;
    function later() {
        if (timer != null) return;
        timer = schedule(() => {
            timer = null;
            refresh();
        }, DEBOUNCE_MS);
    }

    input.addEventListener('input', refresh);
    for (const el of watch) {
        if (!el) continue;
        el.addEventListener('input', later);
        el.addEventListener('change', later);
        if (typeof MutationObserver === 'function') {
            new MutationObserver(later).observe(el, {childList: true, subtree: true});
        }
    }

    refresh();
    return {refresh};
}
