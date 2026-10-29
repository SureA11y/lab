'use strict';

/**
 * Per-topic coverage for the grouped issues view. Lives browser-side because the
 * topic list comes from the selected grouping, which can be a user-supplied file.
 */

const STATUS_FAILING = ['doesNotSupport', 'partiallySupports'];

function asArray(x) {
    return Array.isArray(x) ? x : [];
}

export function summarizeTopic(coverageSummary, scList) {
    const wanted = new Set(asArray(scList).map((s) => String(s).trim()).filter(Boolean));
    const criteria = asArray(coverageSummary && coverageSummary.criteria).filter((c) => c && wanted.has(c.sc));

    const countBy = (pred) => criteria.filter(pred).length;

    const automatable = countBy((c) => c.automation === 'automatic');
    const evaluated = countBy((c) => c.checks && c.checks.evaluated > 0);
    const failing = countBy((c) => STATUS_FAILING.includes(c.status));

    // States are counts only, so none of this depends on a tuned threshold.
    let state = 'noFailures';
    if (!criteria.length) state = 'unknown';
    else if (automatable === 0) state = 'notAutomatable';
    else if (evaluated === 0) state = 'notEvaluated';
    else if (failing > 0) state = 'failing';

    return {
        listed: wanted.size,
        inScope: criteria.length,
        automatable,
        manualOnly: countBy((c) => c.automation === 'manualOnly'),
        notAutomatable: countBy((c) => c.automation === 'notAutomatable'),
        evaluated,
        failing,
        needsReview: countBy((c) => c.checks && c.checks.cantTell > 0),
        supports: countBy((c) => c.status === 'supports'),
        state,
        criteria
    };
}

// Leads with reach: how much of a topic is checkable decides whether its silence means anything.
export function topicBadgeText(topic) {
    if (!topic || topic.state === 'unknown') return '';

    if (topic.state === 'notAutomatable') {
        return `No automated check exists for any of these ${topic.inScope} criteria`;
    }

    const parts = [`${topic.automatable} of ${topic.inScope} machine-testable`];

    if (topic.evaluated === 0) {
        parts.push('none evaluated here');
    } else {
        parts.push(`${topic.evaluated} evaluated`);
        // Said outright rather than left as an absence: silence here means no check
        // objected, and a check only tests part of what a criterion requires.
        parts.push(topic.failing > 0 ? `${topic.failing} failing` : 'no automated failures');
    }

    if (topic.needsReview > 0) parts.push(`${topic.needsReview} need review`);

    return parts.join(' · ');
}
