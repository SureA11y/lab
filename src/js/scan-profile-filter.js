'use strict';

// Pure helpers backing the Profiles selector in the report view: which
// profiles a report's scans were checked against, whether the selector is
// worth offering, which scans still show and which of a scan's profiles stay.
// Every profile is shown until it is turned off: a scan whose profiles are all
// off is hidden, and one with a profile still on shows only those profiles'
// results (shared/shared-profiles.js narrowScanToProfiles). No DOM, so they're
// unit-tested directly; the report UI holds the live selection.
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
 * The profiles across the given scans, as switches to offer:
 * [{ key, label }] in the order first met, the unknown one last. `useful` is
 * false when there is only one, so turning it off would leave nothing: the
 * UI leaves the selector out. A report of one scan of several profiles has
 * several to choose from.
 */
export function collectScanProfiles(scans, profilesOf = defaultProfilesOf) {
    const list = Array.isArray(scans) ? scans.filter(Boolean) : [];
    const labels = new Map();

    for (const scan of list) {
        const named = new Map();
        for (const p of profilesOf(scan) || []) {
            const key = p && (p.id || p.label) ? String(p.id || p.label) : '';
            if (key && !named.has(key)) named.set(key, String(p.label || p.id));
        }
        if (!named.size) named.set(UNKNOWN_PROFILE, 'Unknown profile');
        for (const [key, label] of named) {
            if (!labels.has(key)) labels.set(key, label);
        }
    }

    const profiles = [...labels]
        .map(([key, label]) => ({key, label}))
        .sort((a, b) => (a.key === UNKNOWN_PROFILE) - (b.key === UNKNOWN_PROFILE));
    const useful = profiles.length > 1;

    return {profiles, useful};
}

/** A filter from the keys of the profiles turned off. */
export function makeProfileFilter(offKeys = []) {
    return {off: new Set((Array.isArray(offKeys) ? offKeys : []).map(String))};
}

export function isProfileFilterActive(filter) {
    return !!filter && filter.off.size > 0;
}

/** The keys of a scan's profiles still on. */
export function keptProfileKeys(scan, filter, profilesOf = defaultProfilesOf) {
    const keys = scanProfileKeys(scan, profilesOf);
    return isProfileFilterActive(filter) ? keys.filter((key) => !filter.off.has(key)) : keys;
}

// A scan shows while any of its profiles is on: one whose profiles are all
// off is hidden.
export function scanMatchesProfileFilter(scan, filter, profilesOf = defaultProfilesOf) {
    return keptProfileKeys(scan, filter, profilesOf).length > 0;
}
