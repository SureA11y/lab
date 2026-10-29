'use strict';

// Pure helpers backing the per-scan tag filter in the report view. No DOM, so
// they're unit-tested directly; the report UI holds the live filter state and
// calls these to decide the distinct tag set, whether a filter is active, and
// whether a given scan matches.

import { normalizeTagList } from './tags-input.js';

// Distinct tags across the given scans: case-insensitive, keeping the first-seen
// casing, sorted alphabetically. Also reports whether any scan is untagged, so
// the UI knows to offer the synthetic "Untagged" chip.
export function collectScanTags(scans) {
    const seen = new Map(); // lowercased key -> first-seen original casing
    let hasUntagged = false;

    (Array.isArray(scans) ? scans : []).forEach((scan) => {
        const raw = scan && Array.isArray(scan.scanTags) ? scan.scanTags : [];
        const clean = raw.map((t) => String(t == null ? '' : t).trim()).filter(Boolean);
        if (!clean.length) {
            hasUntagged = true;
            return;
        }
        clean.forEach((t) => {
            const key = t.toLowerCase();
            if (!seen.has(key)) seen.set(key, t);
        });
    });

    const tags = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    return { tags, hasUntagged };
}

// Write an edited tag list onto a scan in `payload`, normalizing it first. An
// empty result stores null rather than [], matching how a scan with no tags
// arrives from the payload builder. Returns null when the scan can't be found,
// otherwise the scan plus its before/after tags so the caller can patch the DOM
// and announce the change.
export function applyScanTagsEdit(payload, scanId, rawTags) {
    const scans = payload && Array.isArray(payload.scans) ? payload.scans : null;
    if (!scans || !scanId) return null;

    const scan = scans.find((s) => s && s.id === scanId);
    if (!scan) return null;

    const previous = Array.isArray(scan.scanTags) ? scan.scanTags.slice() : [];
    const next = normalizeTagList(rawTags);

    scan.scanTags = next.length ? next : null;

    return { scan, previous, next };
}

// Canonicalize a raw selection ({ tags: string[], untagged: bool, mode }) into a
// filter object with a lowercased Set for O(1) matching. `mode` is the match
// combinator across selected tags: 'or' (default, a scan needs any one) or
// 'and' (a scan needs all of them). Anything but 'and' falls back to 'or'.
export function makeTagFilter({ tags = [], untagged = false, mode = 'or' } = {}) {
    const set = new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase()));
    return {
        tags: set,
        untagged: !!untagged,
        mode: String(mode).toLowerCase() === 'and' ? 'and' : 'or',
    };
}

export function isTagFilterActive(filter) {
    return !!filter && (filter.tags.size > 0 || filter.untagged === true);
}

// A scan matches when the filter is inactive, or when it satisfies the active
// selection under the filter's mode:
//
//   OR  (default): the scan carries ANY selected tag, or it is untagged and
//                  "Untagged" is selected. Lets a user widen a view -
//                  "desktop + mobile" shows either, optionally plus untagged.
//   AND          : the scan carries EVERY selected tag. Lets a user narrow a
//                  view - "mobile + checkout" shows only scans that are both.
//                  "Untagged" is a "has no tags" constraint, so pairing it with
//                  any required tag is contradictory and matches nothing.
//
// With 0 or 1 selected constraints the two modes are identical.
export function scanMatchesTagFilter(scan, filter) {
    if (!isTagFilterActive(filter)) return true;

    const raw = scan && Array.isArray(scan.scanTags) ? scan.scanTags : [];
    const tags = raw.map((t) => String(t == null ? '' : t).trim()).filter(Boolean);

    if (filter.mode === 'and') {
        // "Untagged" means the scan must carry no tags; combined with any
        // required tag (selected here or present on the scan) it can never hold.
        if (filter.untagged && (filter.tags.size > 0 || tags.length > 0)) return false;
        if (filter.untagged) return tags.length === 0;
        const has = new Set(tags.map((t) => t.toLowerCase()));
        for (const t of filter.tags) {
            if (!has.has(t)) return false;
        }
        return true;
    }

    // OR (default).
    if (!tags.length) return filter.untagged === true;
    for (const t of tags) {
        if (filter.tags.has(t.toLowerCase())) return true;
    }
    return false;
}
