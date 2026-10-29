'use strict';

/**
 * A workflow's scan steps, checked before its run starts: each names its own
 * engine (or runs with the default one), and the profile it chooses must be
 * one that engine can check (conformance-targets.js).
 */

const { SCAN_TARGETS, scanTargetId, targetSupported } = require('./conformance-targets');

/**
 * Every scan step in a list of actions, at any depth: the steps that hold
 * actions of their own (Group, Repeat, Merged scan...) are searched too.
 */
function scanStepsOf(actions, out = []) {
    for (const action of Array.isArray(actions) ? actions : []) {
        if (!action || typeof action !== 'object') continue;
        if (action.type === 'a11yScan') out.push(action);
        for (const value of Object.values(action)) {
            if (Array.isArray(value) && value.some((v) => v && typeof v === 'object' && typeof v.type === 'string')) {
                scanStepsOf(value, out);
            }
        }
    }
    return out;
}

/**
 * Checks each scan step of a workflow and of its custom steps: an engine that
 * is not installed, a profile that is not one (a bare level such as "AA"
 * included, which would otherwise be read as no profile at all), or a profile
 * the step's engine cannot check, fails the run there and then, naming the
 * scan, rather than when that scan comes. A profile with a {var:...} token is
 * only known at runtime and is not checked; an engine is never a variable.
 *
 * describeEngine(id | null) gives { id, name, selectsBy } for an engine, the
 * default one for null, and throws for one that is not installed. A scan
 * without a profile checks WCAG 2.2 AA, which every engine can.
 */
function checkScanSteps(actions, customSteps, describeEngine) {
    const customActions = (Array.isArray(customSteps) ? customSteps : [])
        .flatMap((c) => (c && Array.isArray(c.actions) ? c.actions : []));
    const problems = [];
    for (const step of [...scanStepsOf(actions), ...scanStepsOf(customActions)]) {
        const name = (typeof step.label === 'string' && step.label.trim()) ? `"${step.label.trim()}"` : 'without a label';
        const engine = (typeof step.engine === 'string' && step.engine.trim()) ? step.engine.trim() : null;
        let described;
        try {
            described = describeEngine(engine);
        } catch (e) {
            problems.push(`Scan ${name}: ${e && e.message ? e.message : e}`);
            continue;
        }
        const target = step.profile;
        if (typeof target !== 'string' || !target.trim() || target.includes('{')) continue;
        if (!scanTargetId(target)) {
            problems.push(`Scan ${name}: "${target}" is not a profile. Choose one of ${Object.keys(SCAN_TARGETS).join(', ')}.`);
            continue;
        }
        if (targetSupported(target, described.selectsBy)) continue;
        const label = SCAN_TARGETS[scanTargetId(target)].label;
        problems.push(`Scan ${name}: ${described.name || described.id} cannot check ${label}. Choose another profile, or another engine.`);
    }
    if (problems.length) throw new Error(problems.join('\n'));
}

module.exports = { scanStepsOf, checkScanSteps };
