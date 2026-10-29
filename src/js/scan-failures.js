'use strict';

// Whether a scan has anything to show in the "Failures only" presentation mode.
//
// The mode is a view lens: it hides can't-tell rows and tables through CSS, and
// with this it also hides whole scans that have no failure left to show. The
// rule has to match what the results table renders, so an occurrence carries its
// own outcome over the finding's - the same split a11y-ui.rendering.js applies
// (a finding marked cantTell may still hold failing occurrences, and the other
// way round).
//
// Skipped scans are never failure-free: they were not tested, and hiding them
// would make "not checked" read as "nothing wrong".

const TIERS = ['fail', 'cantTell'];

function occurrenceTier(occ, findingOutcome) {
    const own = String(occ?.occurrenceOutcome || occ?.outcome || '').trim();
    if (TIERS.includes(own)) return own;
    return TIERS.includes(findingOutcome) ? findingOutcome : null;
}

function findingHasTier(finding, tier) {
    const occs = Array.isArray(finding?.occurrences) ? finding.occurrences : [];
    if (!occs.length) return finding?.outcome === tier;
    return occs.some((occ) => occurrenceTier(occ, finding?.outcome) === tier);
}

function scanFindings(scan) {
    return Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
}

export function isSkippedScan(scan) {
    return !!(scan && (scan.skipped || scan.skipInfo));
}

export function scanHasFailures(scan) {
    return scanFindings(scan).some((f) => findingHasTier(f, 'fail'));
}

export function scanHasReviewItems(scan) {
    return scanFindings(scan).some((f) => findingHasTier(f, 'cantTell'));
}

// True when "Failures only" should hide the whole scan.
export function isFailureFreeScan(scan) {
    return !!scan && !isSkippedScan(scan) && !scanHasFailures(scan);
}

// The note shown in "Failures only" so hidden scans are accounted for rather
// than silently missing. Empty when nothing would be hidden.
export function failureFreeScansNote(scans) {
    const hidden = (Array.isArray(scans) ? scans : []).filter(isFailureFreeScan);
    if (!hidden.length) return '';

    const n = hidden.length;
    const withReview = hidden.filter(scanHasReviewItems).length;

    let text = `${n} scan${n === 1 ? '' : 's'} hidden: no failures`;
    if (withReview) {
        text += ` (${withReview} ${withReview === 1 ? 'has' : 'have'} can't-tell items to review)`;
    }
    return text + '.';
}
