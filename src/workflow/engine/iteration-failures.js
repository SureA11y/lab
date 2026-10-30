'use strict';

// The failures of a loop's iterations: each one recorded as the loop goes, and
// a summary of them for the run.

function recordIterationFailure(ctx, payload) {
    try {
        if (!ctx) return;
        if (!Array.isArray(ctx.iterationFailures)) ctx.iterationFailures = [];
        ctx.iterationFailures.push({
            time: new Date().toISOString(),
            ...payload
        });
    } catch {
    }
}

function summarizeIterationFailures(ctx) {
    const list = (ctx && Array.isArray(ctx.iterationFailures)) ? ctx.iterationFailures : [];
    const total = list.length;

    const byType = Object.create(null);
    const byLabel = Object.create(null);
    const byError = Object.create(null);

    for (const f of list) {
        const t = String(f.iteratorType || 'unknown');
        byType[t] = (byType[t] || 0) + 1;

        const label = String(f.iteratorLabel || '');
        if (label) byLabel[label] = (byLabel[label] || 0) + 1;

        const err = String(f.error || '');
        if (err) byError[err] = (byError[err] || 0) + 1;
    }

    const topErrors = Object.entries(byError)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([error, count]) => ({count, error}));

    const topLabels = Object.entries(byLabel)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({count, label}));

    return {
        total,
        byType,
        topLabels,
        topErrors
    };
}

module.exports = {
    recordIterationFailure,
    summarizeIterationFailures
};
