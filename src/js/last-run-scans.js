// How many scans the last run of a workflow did, kept in the browser, so the
// next run of the same workflow has a number to work out its time left from
// before its loops can count one (shared/scan-time-estimate.js). A run of the
// same steps usually does the same scans, give or take what the site changed.
//
// Kept per workflow (its steps and custom steps), in localStorage: a
// convenience for this browser, never needed. Storage that is missing,
// blocked or full only means there is no number.

const STORAGE_KEY = 'a11y-lab-last-run-scans';
// The workflows remembered, the most recent kept.
const KEEP = 50;

/** A short key for a workflow's steps: FNV-1a over its JSON. */
export function workflowKey(actions, customSteps) {
    let text;
    try {
        text = JSON.stringify([Array.isArray(actions) ? actions : [], customSteps || []]);
    } catch {
        return null;
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(16)}-${text.length}`;
}

/**
 * The scans a finished run did: each scan once, and each scan inside a Merged
 * scan too (what the time left counts), or null.
 */
export function scansRunOf(payload) {
    const scans = payload && Array.isArray(payload.scans) ? payload.scans : null;
    if (!scans) return null;
    let n = scans.length;
    for (const scan of scans) {
        if (scan && Array.isArray(scan.contexts) && scan.contexts.length > 1) {
            n += Math.max(0, scan.contexts.filter((c) => c && !c.skipped).length - 1);
        }
    }
    return n > 0 ? n : null;
}

function readAll(storage) {
    try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        const all = raw ? JSON.parse(raw) : null;
        return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
        return {};
    }
}

const defaultStorage = () => {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
};

/** The scans the last finished run of this workflow did, or null. */
export function readLastRunScans(key, storage = defaultStorage()) {
    if (!key) return null;
    const entry = readAll(storage)[key];
    const n = entry && Number(entry.scans);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Keeps the scans a run of this workflow did, for its next run. */
export function rememberLastRunScans(key, scans, storage = defaultStorage(), now = Date.now()) {
    if (!key || !storage || !(Number.isInteger(scans) && scans > 0)) return;
    const all = readAll(storage);
    all[key] = { scans, at: now };
    const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
    for (const old of keys.slice(KEEP)) delete all[old];
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Full or blocked: the next run has no number, as before.
    }
}
