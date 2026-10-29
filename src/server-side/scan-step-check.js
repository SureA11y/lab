'use strict';

/**
 * A workflow's scan steps, checked before its run starts: each runs with
 * surea11y, the lab's one engine, and the profile it chooses must be one
 * surea11y can check (conformance-targets.js).
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
 * Checks each scan step of a workflow and of its custom steps: a step still
 * naming another engine (from a spec written for an earlier lab), a profile
 * that is not one (a bare level such as "AA" included, which would otherwise
 * be read as no profile at all), or a profile surea11y cannot check, fails the
 * run there and then, naming the scan, rather than when that scan comes. A
 * profile with a {var:...} token is only known at runtime and is not checked.
 *
 * describeEngine(id | null) gives { id, name, selectsBy } for surea11y, and
 * throws for any other engine. A scan without a profile checks WCAG 2.2 AA.
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
        problems.push(`Scan ${name}: ${described.name || described.id} cannot check ${label}. Choose another profile.`);
    }
    if (problems.length) throw new Error(problems.join('\n'));
}

module.exports = { scanStepsOf, checkScanSteps };
