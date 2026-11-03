'use strict';

/**
 * run-health.js (shared)
 *
 * Whether a finished run actually covered what its spec asked for.
 *
 * A run that skipped a scan or lost iterations reports fewer findings while
 * looking clean, so unattended runs need this separately from the findings
 * themselves: fewer failures is only good news when the run was whole.
 *
 * Failures on actions the spec marked optional are reported but do not count as
 * degraded — the spec said they may fail.
 *
 * Browser: available as globalThis.A11Y_RUN_HEALTH.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_RUN_HEALTH = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    function asArray(v) {
        return Array.isArray(v) ? v : [];
    }

    function scanLabel(scan, index) {
        const label = scan && typeof scan.label === 'string' ? scan.label.trim() : '';
        if (label) return label;
        const id = scan && typeof scan.id === 'string' ? scan.id.trim() : '';
        return id || `scan ${index + 1}`;
    }

    function actionLabel(result) {
        const label = result && typeof result.label === 'string' ? result.label.trim() : '';
        const type = result && typeof result.type === 'string' ? result.type : 'action';
        const path = result && result.actionPath ? `${result.actionPath} ` : '';
        return `${path}${label || type}`;
    }

    function collectSkippedScans(payload) {
        return asArray(payload && payload.scans).reduce((out, scan, index) => {
            if (!scan || (!scan.skipped && !scan.skipInfo)) return out;
            out.push({
                label: scanLabel(scan, index),
                url: scan.url || null,
                reason: (scan.skipInfo && (scan.skipInfo.reason || scan.skipInfo.message)) || null,
            });
            return out;
        }, []);
    }

    // The scans whose page had iframes they were asked to scan and could not
    // (the engine's frames-not-scanned notice): their findings leave out what
    // those iframes show, so a comparison would read theirs as fixed.
    function collectFramesNotScanned(payload) {
        return asArray(payload && payload.scans).reduce((out, scan, index) => {
            const notices = asArray(scan && scan.canonical && scan.canonical.notices);
            const notice = notices.find((n) => n && n.code === 'frames-not-scanned');
            if (notice) out.push({ label: scanLabel(scan, index), url: scan.url || null, message: notice.message || null });
            return out;
        }, []);
    }

    function collectActionFailures(payload, wanted) {
        return asArray(payload && payload.actionResults).reduce((out, result) => {
            if (!result || result.status !== wanted) return out;
            out.push({ label: actionLabel(result), error: result.error || null });
            return out;
        }, []);
    }

    /**
     * Read a finished run's payload.
     *
     * `degraded` covers only what the run failed to do; `cancelled` and `failed`
     * are reported separately because they are already visible as a run status.
     */
    function assessRun(payload) {
        const report = payload && typeof payload === 'object' ? payload : {};

        const skippedScans = collectSkippedScans(report);
        const framesNotScanned = collectFramesNotScanned(report);
        const failedActions = collectActionFailures(report, 'failed');
        const optionalFailures = collectActionFailures(report, 'failed-optional');

        const summary = report.iterationFailureSummary || null;
        const iterationFailures = summary && Number.isFinite(summary.total) ? summary.total : 0;

        const reasons = [];
        if (skippedScans.length) {
            reasons.push({
                kind: 'skipped-scans',
                count: skippedScans.length,
                detail: skippedScans.map((s) => s.label).join(', '),
            });
        }
        if (framesNotScanned.length) {
            reasons.push({
                kind: 'frames-not-scanned',
                count: framesNotScanned.length,
                detail: framesNotScanned.map((s) => s.label).join(', '),
            });
        }
        if (iterationFailures) {
            const topError = asArray(summary.topErrors)[0];
            reasons.push({
                kind: 'iteration-failures',
                count: iterationFailures,
                detail: topError ? topError.error : null,
            });
        }
        if (failedActions.length) {
            reasons.push({
                kind: 'failed-actions',
                count: failedActions.length,
                detail: failedActions.map((a) => a.label).join(', '),
            });
        }

        const cancelled = !!report.cancelled;
        const failed = !!report.failed;
        const degraded = reasons.length > 0;

        return {
            ok: !degraded && !cancelled && !failed,
            degraded,
            cancelled,
            failed,
            reasons,
            skippedScans,
            framesNotScanned,
            failedActions,
            optionalFailures,
            iterationFailures,
            iterationFailureSummary: summary,
        };
    }

    /** One line per reason, for a log or a message. */
    function describeRunHealth(health) {
        if (!health || !Array.isArray(health.reasons) || !health.reasons.length) return [];

        return health.reasons.map((reason) => {
            switch (reason.kind) {
                case 'skipped-scans':
                    return `${reason.count} scan${reason.count === 1 ? '' : 's'} skipped: ${reason.detail}`;
                case 'frames-not-scanned':
                    return `${reason.count} scan${reason.count === 1 ? '' : 's'} could not scan some of the page's iframes, `
                        + `so what they show is not in the findings: ${reason.detail}`;
                case 'iteration-failures':
                    return `${reason.count} iteration${reason.count === 1 ? '' : 's'} failed`
                        + (reason.detail ? `: ${reason.detail}` : '');
                case 'failed-actions':
                    return `${reason.count} action${reason.count === 1 ? '' : 's'} failed: ${reason.detail}`;
                default:
                    return `${reason.kind}: ${reason.count}`;
            }
        });
    }

    return { assessRun, describeRunHealth };
}));
