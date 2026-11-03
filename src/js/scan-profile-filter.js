'use strict';

// Pure helpers backing the per-scan profile filter in the report view: which
// profiles a report's scans were checked against, whether the filter is worth
// offering, and whether a given scan matches. No DOM, so they're unit-tested
// directly; the report UI holds the live selection and calls these.
//
// A scan's profiles come from shared/report-scan.js (scanProfiles), which reads
// every report format alike. A scan checked against several profiles at once
// (WCAG 2.2 AA + WAI-ARIA 1.2) has each of them; one whose report does not say
// has none, and is offered as "Unknown profile".

// The key a scan's "Unknown profile" chip filters by. Real keys are a
// profile's id, or its label for an older WCAG version with no id.
export const UNKNOWN_PROFILE = '';

function defaultProfilesOf(scan) {
    const api = globalThis.A11Y_REPORT_SCAN;
    return api && typeof api.scanProfiles === 'function' ? api.scanProfiles(scan) : [];
}

/** The keys of a scan's profiles, or [UNKNOWN_PROFILE] when it names none. */
export function scanProfileKeys(scan, profilesOf = defaultProfilesOf) {
    const keys = [];
    for (const p of profilesOf(scan) || []) {
        const key = p && (p.id || p.label) ? String(p.id || p.label) : '';
        if (key && !keys.includes(key)) keys.push(key);
    }
    return keys.length ? keys : [UNKNOWN_PROFILE];
}

/**
 * The profiles across the given scans, as chips to offer:
 * [{ key, label }] in the order first met, the unknown one last. `useful` is
 * false when picking any of them would not change what is shown (every scan
 * has the same profiles, or there is only one), so the UI can leave the
 * filter out.
 */
export function collectScanProfiles(scans, profilesOf = defaultProfilesOf) {
    const list = Array.isArray(scans) ? scans.filter(Boolean) : [];
    const labels = new Map();
    const counts = new Map();

    for (const scan of list) {
        const named = new Map();
        for (const p of profilesOf(scan) || []) {
            const key = p && (p.id || p.label) ? String(p.id || p.label) : '';
            if (key && !named.has(key)) named.set(key, String(p.label || p.id));
        }
        if (!named.size) named.set(UNKNOWN_PROFILE, 'Unknown profile');
        for (const [key, label] of named) {
            if (!labels.has(key)) labels.set(key, label);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    const profiles = [...labels]
        .map(([key, label]) => ({key, label}))
        .sort((a, b) => (a.key === UNKNOWN_PROFILE) - (b.key === UNKNOWN_PROFILE));
    const useful = profiles.length > 1 && profiles.some((p) => counts.get(p.key) < list.length);

    return {profiles, useful};
}

/** A filter from the selected profile keys. */
export function makeProfileFilter(keys = []) {
    return {keys: new Set((Array.isArray(keys) ? keys : []).map(String))};
}

export function isProfileFilterActive(filter) {
    return !!filter && filter.keys.size > 0;
}

// A scan matches when the filter is inactive, or when any of its profiles is
// selected: picking two profiles shows the scans of either.
export function scanMatchesProfileFilter(scan, filter, profilesOf = defaultProfilesOf) {
    if (!isProfileFilterActive(filter)) return true;
    return scanProfileKeys(scan, profilesOf).some((key) => filter.keys.has(key));
}
