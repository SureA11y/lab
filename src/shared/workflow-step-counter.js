'use strict';

/**
 * workflow-step-counter.js (shared)
 *
 * A live "steps done / steps left" tally for a running workflow.
 *
 * It is fed the same progress log entries the engine already emits (see
 * pushLog in src/workflow/engine/log.js) and needs nothing else: the server
 * streams them to the UI via /workflow-progress, the CLI gets them through its
 * own progress callback, so one counter serves both.
 *
 * The contract it keeps
 * ---------------------
 * `done` is exact - it counts actions the engine reported as finished.
 *
 * `remaining` is an upper bound that **never rises on its own**. Every runtime
 * fact the engine reports can only remove work from it: an `if` picks a branch
 * and the other branch's cost is reclaimed, a bounded loop resolves to fewer
 * items than its ceiling and the slack is reclaimed, an action completes and
 * the count drops by one. That is a deliberate UX property - a number that
 * only falls reads as progress, while one that jumps upward reads as a broken
 * promise.
 *
 * The single exception is spelled out rather than hidden. A loop with no
 * declared ceiling (a `forEachElement` without `limit`, a `crawlQueue` without
 * `maxPages`) cannot be sized in advance, so it is never counted into
 * `remaining` at all - it sits in `unsized` instead, which is what a UI should
 * render as "+2 loops not yet sized". When the engine reports the size such a
 * loop resolved to, its work moves out of `unsized` and into `remaining`, and
 * the snapshot flags it as `lastResolution`. That is a bucket transfer of
 * something the user was already told was unknown, not a silent increase - and
 * the UI can announce it as such.
 *
 * Anything that would raise `remaining` outside that path is a bug, so it is
 * clamped and counted in `ratchetHits` rather than shown. A snapshot with a
 * non-zero `ratchetHits` means the plan and the engine disagreed about
 * something; the tests assert it stays zero.
 *
 * Browser: available as globalThis.A11Y_WORKFLOW_STEP_COUNTER.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./workflow-step-plan.js'));
    } else {
        root.A11Y_WORKFLOW_STEP_COUNTER = factory(root.A11Y_WORKFLOW_STEP_PLAN);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (PLAN) {

    if (!PLAN || typeof PLAN.planWorkflowSteps !== 'function') {
        throw new Error('workflow-step-counter.js: load workflow-step-plan.js first');
    }

    // Log entry types the engine marks with extra.stepEvent. Reading the marker
    // rather than the message text keeps the counter off the wording of logs
    // that exist for humans.
    const STEP_EVENTS = Object.freeze({
        ACTION_START: 'action-start',
        ACTION_END: 'action-end',
        ACTION_SKIPPED: 'action-skipped',
        ACTION_FAILED: 'action-failed',
        LOOP_ITERATION: 'loop-iteration',
        BRANCH: 'branch'
    });

    function readStepEvent(entry) {
        const extra = entry && typeof entry === 'object' ? entry.extra : null;
        if (!extra || typeof extra !== 'object') return null;
        const kind = extra.stepEvent;
        return (typeof kind === 'string' && kind) ? kind : null;
    }

    function bump(map, key, by) {
        if (!key || !by) return;
        map[key] = (map[key] || 0) + by;
    }

    function nonNegative(n) {
        return n > 0 ? n : 0;
    }

    /**
     * createStepCounter({actions, customSteps}) or ({plan})
     *
     * Pass the workflow's actions (and custom steps) and the plan is built for
     * you; pass a plan directly to reuse one already computed for the run.
     */
    function createStepCounter(options = {}) {
        const plan = options.plan || PLAN.planWorkflowSteps(options.actions, {customSteps: options.customSteps});

        // The budget is the most steps this run can still turn out to need.
        // It starts at the plan's ceiling and is only ever revised by facts.
        let budget = plan.max;
        const budgetByType = Object.create(null);
        for (const key of Object.keys(plan.byType)) budgetByType[key] = plan.byType[key].max;

        let done = 0;
        const doneByType = Object.create(null);

        let unsized = plan.unsized;
        let ratchetHits = 0;
        let ratchet = nonNegative(budget);
        let lastResolution = null;

        const resolvedLoops = [];
        const unmatched = [];

        // Where the run is, as facts rather than estimates. The workflow's own
        // steps (depth 0) are a fixed list: each one runs, fails or is skipped
        // once, so "step 5 of 8" never has to be taken back, whatever loops and
        // branches do inside them. `current` is the step that started last,
        // at any depth, and `loops` the item each loop is on, by its path.
        const workflowTotal = (Array.isArray(options.actions) ? options.actions : [])
            .filter((a) => a && a.type).length;
        let workflowDone = 0;
        let workflowAt = null;
        let current = null;
        const loops = Object.create(null);

        // A top-level step has finished, one way or another.
        function onEnded(extra) {
            if (extra.depth === 0) workflowDone = Math.min(workflowTotal, workflowDone + 1);
            if (typeof extra.actionPath === 'string') delete loops[extra.actionPath];
        }

        // The innermost loop the current step sits in: the longest loop path
        // that is a prefix of the step's own path.
        function loopOf(actionPath) {
            if (typeof actionPath !== 'string') return null;
            let best = null;
            for (const path of Object.keys(loops)) {
                if (!actionPath.startsWith(path + '.')) continue;
                if (!best || path.length > best.length) best = path;
            }
            return best ? {...loops[best]} : null;
        }

        // Applied whenever the engine says a loop entered its first iteration,
        // so a loop nested inside another loop is re-appraised on every entry.
        function onLoopEntered(actionPath, total) {
            const node = plan.nodes[actionPath];
            if (!node || node.kind !== 'loop') {
                unmatched.push({actionPath, total, reason: 'no-plan-node'});
                return false;
            }

            const perIteration = node.perIterationMax || 0;
            const byType = node.perIterationByType || {};

            if (node.ceiling == null) {
                // Unsized: it was never in the budget, so sizing it adds work.
                // Only a resolved count does; a dynamic loop reports null and
                // stays unsized for its whole life.
                if (!Number.isFinite(total)) return false;

                budget += total * perIteration;
                for (const key of Object.keys(byType)) bump(budgetByType, key, total * byType[key]);
                unsized = nonNegative(unsized - 1);
                resolvedLoops.push({actionPath, type: node.type, total, added: total * perIteration});
                lastResolution = {actionPath, type: node.type, total, added: total * perIteration};
                return true;
            }

            // Bounded: the ceiling was budgeted, the real count is at most that,
            // so the difference comes back.
            if (!Number.isFinite(total)) return false;
            const slack = node.ceiling - total;
            if (slack <= 0) return false;

            budget -= slack * perIteration;
            for (const key of Object.keys(byType)) bump(budgetByType, key, -(slack * byType[key]));
            resolvedLoops.push({actionPath, type: node.type, total, reclaimed: slack * perIteration});
            return false;
        }

        // The branches not taken are work this run will never do. An if has
        // two (then, else); a switch one per case plus its default.
        function branchesOf(node) {
            if (node && node.kind === 'if') {
                return {
                    then: {max: node.thenMax, byType: node.thenByType},
                    else: {max: node.elseMax, byType: node.elseByType}
                };
            }
            if (node && node.kind === 'switch') return node.branches;
            return null;
        }

        function onBranchTaken(actionPath, taken, caseIndex) {
            const node = plan.nodes[actionPath];
            const branches = branchesOf(node);
            const key = (taken === 'case') ? `case:${caseIndex}` : taken;
            const chosen = branches && branches[key];
            if (!chosen) {
                unmatched.push({actionPath, taken, reason: branches ? 'no-plan-branch' : 'no-plan-node'});
                return;
            }
            let worst = 0;
            const worstByType = Object.create(null);
            for (const branch of Object.values(branches)) {
                worst = Math.max(worst, branch.max);
                for (const type of Object.keys(branch.byType)) {
                    worstByType[type] = Math.max(worstByType[type] || 0, branch.byType[type]);
                }
            }

            budget -= (worst - chosen.max);
            for (const type of Object.keys(worstByType)) {
                bump(budgetByType, type, -(worstByType[type] - (chosen.byType[type] || 0)));
            }
        }

        function accept(entry) {
            const kind = readStepEvent(entry);
            if (!kind) return snapshot();

            const extra = entry.extra;
            let sanctionedRise = false;

            switch (kind) {
                case STEP_EVENTS.ACTION_START: {
                    current = {
                        actionPath: typeof extra.actionPath === 'string' ? extra.actionPath : null,
                        type: extra.actionType || null,
                        label: (typeof extra.label === 'string' && extra.label.trim()) ? extra.label.trim() : null
                    };
                    if (extra.depth === 0) {
                        const n = Number(extra.actionPath);
                        if (Number.isInteger(n) && n > 0) workflowAt = n;
                    }
                    break;
                }
                case STEP_EVENTS.ACTION_SKIPPED: {
                    onEnded(extra);
                    break;
                }
                case STEP_EVENTS.ACTION_END:
                case STEP_EVENTS.ACTION_FAILED: {
                    // A failed action still ran; it is done either way, and the
                    // budget already had room for it.
                    done += 1;
                    bump(doneByType, extra.actionType, 1);
                    onEnded(extra);
                    break;
                }
                case STEP_EVENTS.LOOP_ITERATION: {
                    if (typeof extra.actionPath === 'string' && Number.isInteger(extra.index)) {
                        loops[extra.actionPath] = {
                            index: extra.index,
                            total: Number.isFinite(extra.total) ? extra.total : null
                        };
                    }
                    // Only the first pass tells us the size; later passes are the
                    // loop doing the work already accounted for.
                    if (extra.index === 0) {
                        const total = Number.isFinite(extra.total) ? extra.total : null;
                        sanctionedRise = onLoopEntered(extra.actionPath, total);
                    }
                    break;
                }
                case STEP_EVENTS.BRANCH: {
                    onBranchTaken(extra.actionPath, extra.taken, extra.caseIndex);
                    break;
                }
                default:
                    break;
            }

            const raw = nonNegative(budget - done);
            if (sanctionedRise) {
                ratchet = raw;
            } else if (raw > ratchet) {
                ratchetHits += 1;
            } else {
                ratchet = raw;
            }

            return snapshot();
        }

        function acceptAll(entries) {
            let last = snapshot();
            for (const entry of (Array.isArray(entries) ? entries : [])) last = accept(entry);
            return last;
        }

        function remainingByType() {
            const out = Object.create(null);
            const keys = new Set(Object.keys(budgetByType).concat(Object.keys(doneByType)));
            for (const key of keys) {
                out[key] = nonNegative((budgetByType[key] || 0) - (doneByType[key] || 0));
            }
            return out;
        }

        function snapshot() {
            const remaining = ratchet;
            return {
                done,
                doneByType: {...doneByType},
                remaining,
                remainingRaw: nonNegative(budget - done),
                remainingByType: remainingByType(),
                // done + remaining, for a progress bar that needs a denominator.
                // Meaningless on its own while `unsized` is non-zero - say so in
                // the UI rather than drawing a bar that cannot fill honestly.
                total: done + remaining,
                unsized,
                lastResolution,
                ratchetHits,
                // The workflow's own steps: how many there are, how many have
                // finished, and the number of the one running (1-based).
                workflow: {total: workflowTotal, done: workflowDone, at: workflowAt},
                // The step that started last, and the item of the loop it is in
                // ({index, total}; total is null while the loop's size is unknown).
                current: current ? {...current, loop: loopOf(current.actionPath)} : null,
                resolvedLoops: resolvedLoops.slice(),
                unmatched: unmatched.slice(),
                plan: {min: plan.min, max: plan.max, unsized: plan.unsized}
            };
        }

        return {accept, acceptAll, snapshot, plan};
    }

    return {STEP_EVENTS, createStepCounter};
}));
