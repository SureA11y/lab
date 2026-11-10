'use strict';

// Groups of scans that belong together (docs/design/scan-grouping-design.md).
//
// This module knows nothing about what makes scans alike. It asks its
// sources, each one a way of telling (the URL today; the markup or anything
// else later), which groups they see, and it puts their answers together:
// one set of groups, nested by their members alone, so a group from one
// source can sit inside a group from another.
//
// A source is { id, propose(items, context) } and propose returns
//   [{ key, label, members, specificity, evidence }]
// - key: unique within the source, stable for the same group across reloads
//   (the person's choice of groups is saved by it);
// - label: what the group is shown as;
// - members: the ids of the items in the group;
// - specificity: how much the group says about its members, compared with
//   the source's other groups; of two groups with the same members, the one
//   that says more is kept;
// - evidence: anything the source wants the view to show about the group.
// It is the source's job to propose only groups that mean something
// (design notes D9); this module only drops what cannot be a group at all.
//
// Items are what is grouped: the scans of a run, or later the contexts of
// merged scans. Their ids are read with `getId`.
//
// Pure and DOM-free. Nothing here is stored: groups are worked out again
// whenever they are shown.
//
// Browser: available as globalThis.A11Y_SCAN_GROUPS.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_GROUPS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const DEFAULTS = Object.freeze({
        // A group of one item is that item, not a group.
        minMembers: 2,
    });

    const defaultGetId = (item) => (item && item.id != null ? item.id : null);

    function assertSource(source) {
        if (!source || typeof source.id !== 'string' || !source.id
            || typeof source.propose !== 'function') {
            throw new TypeError('A group source needs an id and a propose(items, context) function.');
        }
    }

    function byDisplayOrder(a, b) {
        return b.size - a.size
            || String(a.label).localeCompare(String(b.label))
            || a.key.localeCompare(b.key);
    }

    // Of two groups competing for a place (the same members, or the same
    // parent size), the one kept: the more specific, then the first source,
    // then the key, so the answer never depends on the order of a Map.
    function preferred(a, b) {
        if (a.specificity !== b.specificity) return a.specificity > b.specificity ? a : b;
        if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex < b.sourceIndex ? a : b;
        return a.key <= b.key ? a : b;
    }

    function isSubset(small, large) {
        if (small.size > large.size) return false;
        for (const id of small) if (!large.has(id)) return false;
        return true;
    }

    /**
     * The groups the sources see among the items, nested.
     *
     * Returns { groups, ungrouped }:
     * - groups: the top-level groups, each { key, source, label, members,
     *   size, specificity, evidence, equivalents, parentKey, children },
     *   largest first. `key` is the source's key prefixed with the source id.
     *   A group's parent is the smallest group holding all its members and
     *   more; groups that only overlap are siblings. `equivalents` lists the
     *   groups dropped for having exactly its members (the same group seen
     *   another way, by another source or another pattern).
     * - ungrouped: the ids of the items in no group, in item order.
     * - ids: the ids of every item, in item order.
     */
    function findGroups(items, options = {}) {
        const list = Array.isArray(items) ? items : [];
        const getId = typeof options.getId === 'function' ? options.getId : defaultGetId;
        const minMembers = Number.isFinite(options.minMembers)
            ? Math.max(2, options.minMembers) : DEFAULTS.minMembers;
        const sources = Array.isArray(options.sources) ? options.sources : [];
        sources.forEach(assertSource);

        const position = new Map();
        list.forEach((item) => {
            const id = getId(item);
            if (id != null && !position.has(id)) position.set(id, position.size);
        });
        const inItemOrder = (a, b) => position.get(a) - position.get(b);

        const candidates = [];
        sources.forEach((source, sourceIndex) => {
            const proposed = source.propose(list, { getId });
            if (!Array.isArray(proposed)) return;
            const seenKeys = new Set();
            for (const g of proposed) {
                if (!g || typeof g.key !== 'string' || !g.key || seenKeys.has(g.key)) continue;
                seenKeys.add(g.key);
                const members = [...new Set(Array.isArray(g.members) ? g.members : [])]
                    .filter((id) => position.has(id))
                    .sort(inItemOrder);
                if (members.length < minMembers) continue;
                candidates.push({
                    key: `${source.id}:${g.key}`,
                    source: source.id,
                    label: g.label != null && g.label !== '' ? String(g.label) : g.key,
                    members,
                    size: members.length,
                    specificity: Number.isFinite(g.specificity) ? g.specificity : 0,
                    evidence: g.evidence === undefined ? null : g.evidence,
                    sourceIndex,
                });
            }
        });

        // The same members seen twice are one group: keep the one that says
        // more, and name the others as its equivalents.
        const bySignature = new Map();
        for (const c of candidates) {
            const signature = c.members.map((id) => position.get(id)).join(',');
            const same = bySignature.get(signature);
            if (same) same.push(c); else bySignature.set(signature, [c]);
        }
        const kept = [];
        for (const same of bySignature.values()) {
            const winner = same.reduce(preferred);
            winner.equivalents = same.filter((c) => c !== winner)
                .map(({ key, source, label }) => ({ key, source, label }))
                .sort((a, b) => a.key.localeCompare(b.key));
            kept.push(winner);
        }

        // Each group's parent: the smallest group holding all its members and
        // more. Groups that only overlap stay siblings.
        const sets = new Map(kept.map((g) => [g, new Set(g.members)]));
        const nodes = new Map(kept.map((g) => [g, {
            key: g.key,
            source: g.source,
            label: g.label,
            members: g.members,
            size: g.size,
            specificity: g.specificity,
            evidence: g.evidence,
            equivalents: g.equivalents,
            parentKey: null,
            children: [],
        }]));
        const roots = [];
        for (const g of kept) {
            let parent = null;
            for (const other of kept) {
                if (other === g || other.size <= g.size) continue;
                if (!isSubset(sets.get(g), sets.get(other))) continue;
                if (!parent || other.size < parent.size
                    || (other.size === parent.size && preferred(other, parent) === other)) {
                    parent = other;
                }
            }
            const node = nodes.get(g);
            if (parent) {
                node.parentKey = parent.key;
                nodes.get(parent).children.push(node);
            } else {
                roots.push(node);
            }
        }
        const sortTree = (level) => {
            level.sort(byDisplayOrder);
            level.forEach((n) => sortTree(n.children));
            return level;
        };

        const grouped = new Set(kept.flatMap((g) => g.members));
        const ids = [...position.keys()];
        const ungrouped = ids.filter((id) => !grouped.has(id));

        return { groups: sortTree(roots), ungrouped, ids };
    }

    /**
     * The groups a person chose to group by, out of a findGroups result
     * (design notes §6). `chosenKeys` are group keys; those the result does
     * not have (a pattern gone after a merge of reports) are left out and
     * listed in `missing`.
     *
     * Returns { groups, ungrouped, missing }:
     * - groups: the chosen groups, each { key, label, group, members, own,
     *   children }, nested under their nearest chosen ancestor, in the
     *   result's order. `group` is the findGroups node; `members` all its
     *   items; `own` those no chosen group inside it holds, so each item is
     *   listed under the most specific chosen group that has it.
     * - ungrouped: the items in no chosen group, in item order.
     */
    function chooseGroups(result, chosenKeys) {
        const groups = result && Array.isArray(result.groups) ? result.groups : [];
        const all = flattenGroups(groups);
        const byKey = new Map(all.map((g) => [g.key, g]));
        const wanted = [...new Set(Array.isArray(chosenKeys) ? chosenKeys : [])];
        const chosen = new Set(wanted.filter((k) => byKey.has(k)));
        const missing = wanted.filter((k) => !byKey.has(k));

        const nodes = new Map();
        const roots = [];
        for (const g of all) {
            if (!chosen.has(g.key)) continue;
            const node = { key: g.key, label: g.label, group: g, members: g.members, own: [], children: [] };
            nodes.set(g.key, node);
            let up = g.parentKey ? byKey.get(g.parentKey) : null;
            while (up && !chosen.has(up.key)) up = up.parentKey ? byKey.get(up.parentKey) : null;
            // Parents come before their children in `all`, so the chosen
            // ancestor's node already exists.
            if (up) nodes.get(up.key).children.push(node); else roots.push(node);
        }
        for (const node of nodes.values()) {
            const inChildren = new Set(node.children.flatMap((c) => c.members));
            node.own = node.members.filter((id) => !inChildren.has(id));
        }

        const covered = new Set([...nodes.values()].flatMap((n) => n.members));
        const order = result && Array.isArray(result.ids)
            ? result.ids
            : [...new Set([...all.flatMap((g) => g.members), ...(result && result.ungrouped || [])])];
        return { groups: roots, ungrouped: order.filter((id) => !covered.has(id)), missing };
    }

    /** Every group of a findGroups result, parents before their children. */
    function flattenGroups(groups) {
        const out = [];
        const walk = (level) => (level || []).forEach((g) => { out.push(g); walk(g.children); });
        walk(groups);
        return out;
    }

    return {
        DEFAULTS,
        findGroups,
        flattenGroups,
        chooseGroups,
    };
}));
