'use strict';

import {isFailureFreeScan} from './scan-failures.js';

// Pure helpers that turn a final scan object into the props the "View all
// scans" dialog card needs. Kept DOM-free so they can be unit-tested; the DOM
// assembly lives in stream-ui.js (renderAllScansCard) and a11y-ui.js.
//
// The card is meant to look and read exactly like the live-preview scan card,
// so the counts rule here mirrors the results header (generateScanMetadata):
// canonical findings first, summary counts as a fallback.

export function scanCardCounts(scan) {
    const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
    if (findings.length) {
        return {
            violations: findings.filter((f) => f?.outcome === 'fail').length,
            incomplete: findings.filter((f) => f?.outcome === 'cantTell').length,
            passes: findings.filter((f) => f?.outcome === 'pass').length
        };
    }
    const s = scan?.summary || {};
    return {
        violations: Number.isFinite(s.failCount) ? s.failCount : 0,
        incomplete: Number.isFinite(s.reviewCount) ? s.reviewCount : 0,
        passes: Number.isFinite(s.passesCount) ? s.passesCount : 0
    };
}

// The scan's existing first screenshot, reused as the card thumbnail — so no
// extra image is stored and, in the exported report, it de-dupes to the same
// file the results already reference.
export function scanCardThumbnail(scan) {
    if (Array.isArray(scan?.screenshots) && scan.screenshots.length) {
        const first = scan.screenshots[0];
        if (typeof first === 'string') return first;
        if (first) return first.publicUrl || first.dataUrl || null;
    }
    const report = scan?.report;
    if (report && typeof report === 'object') {
        return report.screenshotPublicUrl || report.screenshotDataUrl || null;
    }
    return null;
}

// Failure and occurrence counts for sorting. Prefers the baked summary; falls
// back to the canonical findings for reports exported before those fields.
export function scanSortMetrics(scan) {
    const summary = scan?.summary || {};
    let failures = Number.isFinite(summary.failCount) ? summary.failCount : null;
    let occurrences = Number.isFinite(summary.occurrenceCount) ? summary.occurrenceCount : null;

    if (failures === null || occurrences === null) {
        const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
        const fails = findings.filter((f) => f?.outcome === 'fail');
        if (failures === null) failures = fails.length;
        if (occurrences === null) {
            occurrences = fails.reduce((n, f) => n + (Array.isArray(f.occurrences) ? f.occurrences.length : 0), 0);
        }
    }
    return {failures, occurrences};
}

export function scanToAllScansCardProps(scan, index, {matchesTagFilter = () => true} = {}) {
    const diagnostics = scan?.canonical?.diagnostics || {};
    return {
        sort: {order: Number(index) || 0, ...scanSortMetrics(scan)},
        label: scan?.label || scan?.id || `Scan ${index + 1}`,
        context: scan?.context || null,
        counts: scanCardCounts(scan),
        meta: {durationMs: diagnostics.durationMs, estimatedNodes: diagnostics.estimatedNodes},
        url: scan?.canonical?.page?.url || scan?.url || null,
        previewUrl: scanCardThumbnail(scan),
        viewportRatio: scan?.viewportRatio || 4 / 3,
        scanId: scan?.id || null,
        excluded: scan?.includedInReport === false,
        filteredOut: !matchesTagFilter(scan),
        skipped: !!(scan?.skipped || scan?.skipInfo),
        failureFree: isFailureFreeScan(scan),
        skipInfo: scan?.skipInfo || null
    };
}
