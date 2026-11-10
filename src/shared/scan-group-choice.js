'use strict';

// What a person does with scan groups (docs/design/scan-grouping-design.md §6,
// §7): the groups they chose to group by and the names they gave them, saved
// in the report as `scanGrouping`, and what Include all, Exclude all and Keep
// one do to the scans of a group.
//
// The actions only plan: they say which scans to include and which to
// exclude, and the app sets each scan's `includedInReport`, the one flag
// that decides what the report counts (D3). A scan whose state would not
// change is not listed, so the plan's size is what the action changes.
//
// Pure and DOM-free.
//
// Browser: available as globalThis.A11Y_SCAN_GROUP_CHOICE.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_GROUP_CHOICE = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const MAX_NAME = 200;

    function cleanName(name) {
        const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
        return text || null;
    }

    function normalize(list) {
        const seen = new Set();
        const out = [];
        for (const p of Array.isArray(list) ? list : []) {
            if (!p || typeof p.key !== 'string' || !p.key || seen.has(p.key)) continue;
            seen.add(p.key);
            const entry = { key: p.key, name: cleanName(p.name) };
            // Merged into one scan (§9): only said when it is.
            if (p.merge === true) entry.merge = true;
            out.push(entry);
        }
        return out;
    }

    /** The chosen groups a report holds: [{ key, name }], name null when unnamed. */
    function readChoice(payload) {
        const sg = payload && payload.scanGrouping;
        return normalize(sg && typeof sg === 'object' ? sg.patterns : null);
    }

    /** Saves the choice in the report, or removes the field when nothing is chosen. */
    function writeChoice(payload, choice) {
        if (!payload || typeof payload !== 'object') return;
        const patterns = normalize(choice);
        if (patterns.length) payload.scanGrouping = { patterns };
        else delete payload.scanGrouping;
    }

    /** The choice with `key` chosen (added last) or not (removed, its name with it). */
    function setChosen(choice, key, chosen) {
        const list = normalize(choice);
        const without = list.filter((p) => p.key !== key);
        if (!chosen) return without;
        return list.length === without.length ? [...list, { key, name: null }] : list;
    }

    /** The choice with `key`'s name set; an empty name puts the pattern back. */
    function setName(choice, key, name) {
        return normalize(choice).map((p) => (p.key === key ? { ...p, name: cleanName(name) } : p));
    }

    /**
     * The choice with `key`'s scans merged into one (docs/design/
     * scan-grouping-design.md §9) or not. Merging a group not chosen yet
     * chooses it.
     */
    function setMerged(choice, key, merged) {
        const list = normalize(choice);
        if (!list.some((p) => p.key === key)) {
            return merged ? [...list, { key, name: null, merge: true }] : list;
        }
        return list.map((p) => {
            if (p.key !== key) return p;
            const { merge: _was, ...rest } = p;
            return merged ? { ...rest, merge: true } : rest;
        });
    }

    /**
     * The choices of several reports opened as one: every group any of them
     * chose, the first name given to it kept. Groups that do not match the
     * merged scans are left for the view to ignore (chooseGroups' missing).
     */
    function mergeChoices(payloads) {
        const merged = [];
        const byKey = new Map();
        for (const payload of Array.isArray(payloads) ? payloads : []) {
            for (const p of readChoice(payload)) {
                const known = byKey.get(p.key);
                if (!known) {
                    const entry = { ...p };
                    byKey.set(p.key, entry);
                    merged.push(entry);
                } else {
                    if (!known.name && p.name) known.name = p.name;
                    // Merged in any of them, merged in the report they make.
                    if (p.merge) known.merge = true;
                }
            }
        }
        return merged;
    }

    const isIncluded = (scan) => !!scan && scan.includedInReport !== false;

    /**
     * What an action on a group's scans changes: { include, exclude }, ids in
     * report order, only of scans whose state changes.
     * - 'include': every scan of the group in the report;
     * - 'exclude': every scan out of it;
     * - 'keepOne': one scan in, the rest out. The one kept is the first in
     *   report order that is already included, so an earlier choice of which
     *   page stands for the template is kept; with none included, the first.
     * `scans` are the report's scans, in its order.
     */
    function planAction(scans, memberIds, action) {
        const members = new Set(Array.isArray(memberIds) ? memberIds : []);
        const list = (Array.isArray(scans) ? scans : []).filter((s) => s && members.has(s.id));
        const include = [];
        const exclude = [];
        if (action === 'include') {
            for (const s of list) if (!isIncluded(s)) include.push(s.id);
        } else if (action === 'exclude') {
            for (const s of list) if (isIncluded(s)) exclude.push(s.id);
        } else if (action === 'keepOne') {
            const keep = list.find(isIncluded) || list[0];
            for (const s of list) {
                if (s === keep) { if (!isIncluded(s)) include.push(s.id); } else if (isIncluded(s)) exclude.push(s.id);
            }
        } else {
            throw new TypeError(`Unknown scan group action: ${action}`);
        }
        return { include, exclude };
    }

    return {
        MAX_NAME,
        readChoice,
        writeChoice,
        setChosen,
        setName,
        setMerged,
        mergeChoices,
        planAction,
    };
}));
