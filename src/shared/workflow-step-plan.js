'use strict';

/**
 * workflow-step-plan.js (shared)
 *
 * A static estimate of how many steps a workflow will run, before it runs.
 *
 * The workflow config is a tree, not a flat list, and it is evaluated lazily:
 * an `if` picks a branch at runtime, a `forEachElement` only learns its item
 * count once the selector is queried, a `crawlQueue` grows its queue as pages
 * are discovered. So "how many steps is this?" has no single answer up front.
 * What it does have is a *range*, plus a count of the constructs whose size
 * cannot be known at all:
 *
 *   min      fewest steps the workflow can run
 *   max      most steps it can run, given every declared ceiling
 *   unsized  loop executions with no declared ceiling at all
 *
 * The `unsized` term is what keeps a progress counter honest. A workflow with
 * `min: 4, max: 64, unsized: 1` is telling the UI "somewhere between 4 and 64,
 * plus one loop I cannot size yet" - which is a truthful thing to show, unlike
 * a single fabricated number that has to jump upward the moment the loop
 * resolves. See workflow-step-counter.js for how the two are consumed.
 *
 * What counts as a step
 * ---------------------
 * One step per action node the engine will actually execute - container
 * actions (`group`, `if`, `forEachElement`, ...) included, because the engine
 * emits its own action-start/action-end pair for each of them
 * (workflow-engine.js, _applyActionsImpl). Counting them here is what keeps
 * the plan comparable to the live tally; a caller that wants leaves only can
 * subtract the container types from `byType` using CONTAINER_TYPES.
 *
 * Disabled actions are excluded, matching the engine: it logs them as skipped
 * and never emits an action-start for them.
 *
 * Why min can be 0 for a bounded loop
 * -----------------------------------
 * `limit` and `maxPages` are ceilings, never floors: a selector can match
 * nothing. Treating them as max-only is what makes a live estimate *fall*
 * rather than rise as the run resolves each loop - the property the counter
 * relies on.
 *
 * Browser: available as globalThis.A11Y_WORKFLOW_STEP_PLAN.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_WORKFLOW_STEP_PLAN = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // Action types that run nested actions of their own. Their own action-start
    // is counted as a step like any other; this list lets a caller separate
    // "steps that did something on the page" from the scaffolding around them.
    const CONTAINER_TYPES = Object.freeze([
        'group',
        'mergedScan',
        'if',
        'ifUrl',
        'switch',
        'repeat',
        'forEachElement',
        'crawlQueue',
        'runCustomStep'
    ]);

    // The keys under which an action can carry nested actions.
    const NESTED_KEYS = Object.freeze(['actions', 'preActions', 'elseActions', 'defaultActions', 'iterSetupActions']);

    // Why a loop could not be sized. Surfaced per loop in `unsizedLoops` so the
    // UI can explain the "+N not yet sized" term instead of just showing it.
    const UNSIZED_REASONS = Object.freeze({
        NO_LIMIT: 'no-limit',                 // forEachElement without `limit`
        NO_MAX_PAGES: 'no-max-pages',         // crawlQueue without `maxPages`
        RUNTIME_REPETITIONS: 'runtime-repetitions', // repeat driven by a var
        RECURSION: 'recursion'                // runCustomStep re-entering itself
    });

    function isDisabled(action) {
        return !!(action && action.disabled === true);
    }

    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim().length > 0;
    }

    function positiveInt(v) {
        return (Number.isFinite(v) && v > 0) ? Math.floor(v) : 0;
    }

    const RUNTIME_TOKEN_RE = /\{\s*var\s*:|\{\s*(?:index|oneBased|total)\s*\}/i;

    function hasRuntimeToken(v) {
        return typeof v === 'string' && RUNTIME_TOKEN_RE.test(v);
    }

    /** Number fields may also hold text ("3"), which the engine reads as a number. */
    function positiveIntLoose(v) {
        if (typeof v === 'string') {
            const text = v.trim();
            return /^\d+$/.test(text) ? positiveInt(Number(text)) : 0;
        }
        return positiveInt(v);
    }

    /** An empty tally. `byType` stays a null-prototype map so action types named
     *  like Object.prototype members ("constructor") cannot collide with it. */
    function emptyCount() {
        return {min: 0, max: 0, unsized: 0, byType: Object.create(null), unsizedLoops: []};
    }

    function addType(byType, type, min, max, unsized) {
        const key = String(type || 'unknown');
        // Don't mint a key for a contribution of nothing: a body that is scaled
        // by zero iterations should leave no trace in byType at all.
        if (!min && !max && !unsized && !Object.prototype.hasOwnProperty.call(byType, key)) return;
        const slot = byType[key] || (byType[key] = {min: 0, max: 0, unsized: 0});
        slot.min += min;
        slot.max += max;
        slot.unsized += unsized;
    }

    function mergeInto(dst, src) {
        dst.min += src.min;
        dst.max += src.max;
        dst.unsized += src.unsized;
        for (const key of Object.keys(src.byType)) {
            const s = src.byType[key];
            addType(dst.byType, key, s.min, s.max, s.unsized);
        }
        for (const loop of src.unsizedLoops) dst.unsizedLoops.push(loop);
        return dst;
    }

    /** Scale a tally by a known iteration count. Unsized loops inside a body that
     *  runs N times are N separate sizing events, so they scale too. */
    function scale(count, n) {
        if (n <= 0) return emptyCount();
        const out = emptyCount();
        out.min = count.min * n;
        out.max = count.max * n;
        out.unsized = count.unsized * n;
        for (const key of Object.keys(count.byType)) {
            const s = count.byType[key];
            addType(out.byType, key, s.min * n, s.max * n, s.unsized * n);
        }
        for (let i = 0; i < n; i += 1) {
            for (const loop of count.unsizedLoops) out.unsizedLoops.push(loop);
        }
        return out;
    }

    /** Take the worse of two branches, field by field. Only one `if` branch ever
     *  runs, so its unsized loops are a max, not a sum. */
    function worstOf(a, b) {
        const out = emptyCount();
        out.min = Math.min(a.min, b.min);
        out.max = Math.max(a.max, b.max);
        out.unsized = Math.max(a.unsized, b.unsized);
        const keys = new Set(Object.keys(a.byType).concat(Object.keys(b.byType)));
        for (const key of keys) {
            const x = a.byType[key] || {min: 0, max: 0, unsized: 0};
            const y = b.byType[key] || {min: 0, max: 0, unsized: 0};
            addType(out.byType, key, Math.min(x.min, y.min), Math.max(x.max, y.max), Math.max(x.unsized, y.unsized));
        }
        // Both branches' loops are listed: either may be the one that runs, and
        // the caller wants to know what *could* need sizing.
        for (const loop of a.unsizedLoops) out.unsizedLoops.push(loop);
        for (const loop of b.unsizedLoops) out.unsizedLoops.push(loop);
        return out;
    }

    /** Accept customSteps as an array of {id, actions} or an id-keyed object,
     *  matching normalizeCustomStepsById in the engine. */
    function customStepsById(raw) {
        const byId = Object.create(null);
        const list = Array.isArray(raw)
            ? raw
            : (raw && typeof raw === 'object')
                ? Object.entries(raw).map(([id, value]) => ({id, ...(value || {})}))
                : [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const id = String(item.id || '').trim();
            if (!id) continue;
            byId[id] = item;
        }
        return byId;
    }

    /**
     * How many times `repeat` will loop, if that is knowable without running.
     * Mirrors the runtime precedence in workflow-engine.js: a non-empty
     * itemsText wins, then `times`, then `repetitions`. Returns null when the
     * count only materialises at runtime - an itemsText or repetitions
     * carrying a {var:...} token is resolved by interpolation, so a static walk
     * cannot size it.
     */
    function repeatTimes(action) {
        const raw =
            (typeof action.itemsText === 'string') ? action.itemsText :
                (typeof action.items === 'string') ? action.items :
                    (typeof action.datasetText === 'string') ? action.datasetText :
                        (typeof action.dataset === 'string') ? action.dataset :
                            (Array.isArray(action.dataset)) ? action.dataset.join('\n') :
                                (Array.isArray(action.items)) ? action.items.join('\n') :
                                    '';

        if (isNonEmptyString(raw)) {
            if (hasRuntimeToken(raw)) return null;
            const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
            if (lines.length) return lines.length;
        }

        // `times` is a legacy alias the engine only honours as a real number.
        const times = positiveInt(action.times);
        if (times) return times;
        // A count held in a variable (repetitions: "{var:count}") is only known
        // once the step runs.
        if (hasRuntimeToken(action.repetitions)) return null;
        const reps = positiveIntLoose(action.repetitions);
        if (reps) return reps;

        // No itemsText, no count: the engine breaks out without iterating.
        return 0;
    }

    /**
     * planWorkflowSteps(actions, {customSteps})
     *
     * Returns {min, max, unsized, byType, unsizedLoops}. `unsizedLoops` entries
     * carry `perIteration` - the cost of one pass through that loop's body - so
     * a live counter can turn the loop into real numbers the moment the engine
     * reports its resolved size, without re-walking the tree.
     */
    function planWorkflowSteps(actions, options = {}) {
        const customSteps = customStepsById(options.customSteps);

        // path -> what a live counter needs to turn this node's estimate into a
        // real number once the engine reports which way it went.
        const nodes = Object.create(null);

        /**
         * `preFiltered` mirrors an engine quirk that the paths depend on: some
         * nested lists are stripped of disabled actions *before* applyActions
         * sees them (forEachElement's actions/preActions/iterSetupActions, and
         * repeat's actions), so a disabled entry there shifts its siblings'
         * numbering. Everywhere else - top level, group, if, crawlQueue, custom
         * steps - applyActions numbers by raw array index and a disabled action
         * keeps its slot. Reproducing both is what makes these paths line up
         * with the `actionPath` the engine puts on every log entry.
         */
        const walk = (list, stack, path, preFiltered) => {
            const acc = emptyCount();
            if (!Array.isArray(list)) return acc;

            const source = preFiltered ? list.filter((a) => !isDisabled(a)) : list;

            for (let i = 0; i < source.length; i += 1) {
                const action = source[i];
                if (!action || typeof action !== 'object' || !action.type) continue;
                if (isDisabled(action)) continue;

                const type = String(action.type);
                const here = path ? `${path}.${i + 1}` : String(i + 1);

                // The action's own step, counted for every type alike.
                const node = emptyCount();
                node.min = 1;
                node.max = 1;
                addType(node.byType, type, 1, 1, 0);

                mergeInto(acc, node);
                mergeInto(acc, walkChildren(action, type, stack, here));
            }
            return acc;
        };

        const walkChildren = (action, type, stack, here) => {
            switch (type) {
                case 'group':
                case 'mergedScan':
                    return walk(action.actions, stack, here, false);

                case 'if':
                case 'ifUrl': {
                    const thenSide = walk(action.actions, stack, here, false);
                    const elseSide = walk(action.elseActions, stack, here, false);
                    // Only one branch runs. Recording both costs lets a counter
                    // reclaim the difference the moment the engine logs which.
                    nodes[here] = {
                        kind: 'if',
                        type,
                        thenMax: thenSide.max,
                        elseMax: elseSide.max,
                        thenByType: maxByType(thenSide),
                        elseByType: maxByType(elseSide)
                    };
                    return worstOf(thenSide, elseSide);
                }

                case 'switch': {
                    // One branch runs: the first matching case, or the default.
                    // A case is not a step of its own; its steps are numbered
                    // under it (S.k.j), the default's under the switch (S.j),
                    // matching the engine. Disabled cases keep their number.
                    const branches = Object.create(null);
                    const sides = [];
                    (Array.isArray(action.cases) ? action.cases : []).forEach((kase, i) => {
                        if (!kase || typeof kase !== 'object' || isDisabled(kase)) return;
                        const side = walk(kase.actions, stack, `${here}.${i + 1}`, false);
                        branches[`case:${i + 1}`] = {max: side.max, byType: maxByType(side)};
                        sides.push(side);
                    });
                    const defaultSide = walk(action.defaultActions, stack, here, false);
                    branches.default = {max: defaultSide.max, byType: maxByType(defaultSide)};
                    sides.push(defaultSide);
                    nodes[here] = {kind: 'switch', type, branches};
                    return sides.reduce((w, side) => worstOf(w, side));
                }

                case 'repeat': {
                    const body = walk(action.actions, stack, here, true);
                    if (!body.max && !body.min && !body.unsized) return emptyCount();

                    const times = repeatTimes(action);
                    if (times === null) {
                        return unsizedLoop(type, here, body, UNSIZED_REASONS.RUNTIME_REPETITIONS);
                    }
                    nodes[here] = loopNode(type, times, body);
                    return scale(body, times);
                }

                case 'forEachElement': {
                    const body = mergeInto(
                        mergeInto(emptyCount(), walk(action.iterSetupActions, stack, here, true)),
                        mergeInto(walk(action.preActions, stack, here, true), walk(action.actions, stack, here, true))
                    );
                    const limit = positiveInt(action.limit);
                    if (!limit) {
                        // No ceiling: the selector decides, and with dynamic:true it
                        // is re-queried every iteration and can still grow.
                        return unsizedLoop(type, here, body, UNSIZED_REASONS.NO_LIMIT);
                    }
                    nodes[here] = loopNode(type, limit, body);
                    return boundedLoop(body, limit);
                }

                case 'crawlQueue': {
                    const body = walk(action.actions, stack, here, false);
                    const maxPages = positiveInt(action.maxPages);
                    if (!maxPages) {
                        return unsizedLoop(type, here, body, UNSIZED_REASONS.NO_MAX_PAGES);
                    }
                    nodes[here] = loopNode(type, maxPages, body);
                    return boundedLoop(body, maxPages);
                }

                case 'runCustomStep': {
                    const id = String(action.customStepId || action.id || '').trim();
                    const def = customSteps[id];
                    // An unresolvable id contributes only the call itself; the engine
                    // throws when it reaches it, and a plan is not the place to decide
                    // whether that throw is fatal.
                    if (!def || !Array.isArray(def.actions) || !def.actions.length) return emptyCount();
                    if (stack.includes(id)) {
                        // Re-entrant: bounded at runtime by maxDepth, but the depth
                        // reached depends on runtime conditions, so it stays unsized
                        // rather than being silently counted as nothing.
                        return unsizedLoop(type, here, emptyCount(), UNSIZED_REASONS.RECURSION);
                    }
                    // The engine gives a custom step's body its own path namespace
                    // (customStep(<id>) in workflow-engine.js), so paths inside it
                    // are numbered from there rather than continuing the caller's.
                    return walk(def.actions, stack.concat([id]), `${here}::customStep(${id})`, false);
                }

                default: {
                    // An unknown container-ish action still gets its children counted,
                    // so a new action type added to the engine degrades to a plain
                    // sum rather than vanishing from the estimate.
                    const acc = emptyCount();
                    for (const key of NESTED_KEYS) {
                        if (Array.isArray(action[key])) mergeInto(acc, walk(action[key], stack, here, false));
                    }
                    return acc;
                }
            }
        };

        const maxByType = (count) => Object.keys(count.byType).reduce((m, k) => {
            m[k] = count.byType[k].max;
            return m;
        }, Object.create(null));

        const loopNode = (type, ceiling, body) => ({
            kind: 'loop',
            type,
            ceiling,
            perIterationMax: body.max,
            perIterationByType: maxByType(body)
        });

        // A loop with a declared ceiling: at most `ceiling` passes, but possibly
        // none - which is what lets the live estimate only ever fall.
        const boundedLoop = (body, ceiling) => {
            const out = scale(body, ceiling);
            out.min = 0;
            for (const key of Object.keys(out.byType)) out.byType[key].min = 0;
            return out;
        };

        // A loop with no ceiling: contributes nothing to min or max, and one to
        // unsized. `perIterationMax` lets a counter expand it once the engine
        // reports the size it resolved to.
        const unsizedLoop = (type, here, body, reason) => {
            const entry = {
                type,
                path: here,
                reason,
                perIteration: {min: body.min, max: body.max, unsized: body.unsized},
                perIterationByType: maxByType(body)
            };
            nodes[here] = {kind: 'loop', type, ceiling: null, reason, perIterationMax: body.max, perIterationByType: entry.perIterationByType};

            const out = emptyCount();
            out.unsized = 1;
            out.unsizedLoops.push(entry);
            return out;
        };

        const total = walk(actions, [], '', false);
        return {
            min: total.min,
            max: total.max,
            unsized: total.unsized,
            byType: total.byType,
            unsizedLoops: total.unsizedLoops,
            nodes
        };
    }

    return {
        CONTAINER_TYPES,
        NESTED_KEYS,
        UNSIZED_REASONS,
        planWorkflowSteps,
        repeatTimes
    };
}));
