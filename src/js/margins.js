'use strict';

/**
 * Margins: how close a measuring rule's closest passing element came to its
 * threshold (surea11y's `margin`, kept as `canonical.margins`). Not findings:
 * a pass at 4.52:1 against 4.5:1 is still a pass, but one a small change in
 * colour, font or layout will turn into a failure.
 *
 * The data keeps pixels to one decimal and ratios unrounded; people read whole
 * pixels ("less than 1 px" under one) and ratios to two decimals, as core's
 * own report shows them.
 */

// Room under which a pass is called a near miss: a hundredth of a contrast
// ratio is invisible to the eye, and a pixel is one rounding step of layout.
// Kept small on purpose, so the label means "this will flip", not "this is
// below some comfort level".
const NEAR_MISS_ROOM = {ratio: 0.1, px: 1};

function isRatio(m) {
    return m && m.unit !== 'px';
}

function fixed(n, digits) {
    return Number(n).toFixed(digits);
}

/** The measured value, as people read it: "4.52:1" or "23 px". */
export function formatMarginValue(m, n = m.value) {
    return isRatio(m) ? `${fixed(n, 2)}:1` : `${Math.round(n)} px`;
}

/** The limit the element was judged against: "at least 4.5:1", "at most 7.5 px". */
export function formatMarginLimit(m) {
    const threshold = isRatio(m) ? `${m.threshold}:1` : `${m.threshold} px`;
    return `${m.limit === 'max' ? 'at most' : 'at least'} ${threshold}`;
}

/** The room left before the rule fails: "0.02", "3 px", "less than 1 px". */
export function formatMarginRoom(m) {
    if (isRatio(m)) {
        return m.headroom < 0.01 ? 'less than 0.01' : fixed(Math.floor(m.headroom * 100) / 100, 2);
    }
    return m.headroom < 1 ? 'less than 1 px' : `${Math.round(m.headroom)} px`;
}

/** Whether a pass had so little room that a small change will flip it. */
export function isNearMiss(m) {
    if (!m || !Number.isFinite(m.headroom)) return false;
    return m.headroom < (isRatio(m) ? NEAR_MISS_ROOM.ratio : NEAR_MISS_ROOM.px);
}

/** A scan's margins, the closest calls first. */
export function scanMargins(scan) {
    const list = Array.isArray(scan?.canonical?.margins) ? scan.canonical.margins : [];
    return list
        .filter((m) => m && m.ruleId && Number.isFinite(m.value) && Number.isFinite(m.headroom))
        .slice()
        .sort((a, b) => Number(isNearMiss(b)) - Number(isNearMiss(a)) || String(a.ruleId).localeCompare(String(b.ruleId)));
}
