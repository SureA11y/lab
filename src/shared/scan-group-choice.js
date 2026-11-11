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

    // A list of scan ids, each once, in the order given; empty is none.
    function ids(list) {
        const out = [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && id))];
        return out.length ? out : null;
    }

    const MANUAL = 'manual:';
    const isManual = (key) => typeof key === 'string' && key.startsWith(MANUAL);
    // A scan a Merged scan step made, by its id (docs/design/
    // scan-grouping-design.md §8): saved only once the person changes it.
    const RUN = 'run:';
    const isRun = (key) => typeof key === 'string' && key.startsWith(RUN);
    const runKey = (scanId) => `${RUN}${scanId}`;
    // Contexts are named by their index in the merged scan, as text.
    const indexes = (list) => {
        const out = [...new Set((Array.isArray(list) ? list : []).map(String).filter((x) => /^\d+$/.test(x)))];
        return out.length ? out : null;
    };

    function normalize(list) {
        const seen = new Set();
        const out = [];
        for (const p of Array.isArray(list) ? list : []) {
            if (!p || typeof p.key !== 'string' || !p.key || seen.has(p.key)) continue;
            if (isRun(p.key)) {
                // Unmerged, or with contexts taken out or excluded; as the run
                // made it otherwise, which is not saved.
                const entry = { key: p.key };
                if (p.merge === false) entry.merge = false;
                const remove = indexes(p.remove);
                const exclude = indexes(p.exclude);
                if (remove) entry.remove = remove;
                if (exclude) entry.exclude = exclude;
                if (Object.keys(entry).length > 1) {
                    seen.add(p.key);
                    out.push(entry);
                }
                continue;
            }
            // A group by hand is its scans: without two, it is none.
            const members = isManual(p.key) ? ids(p.members) : null;
            if (isManual(p.key) && (!members || members.length < 2)) continue;
            seen.add(p.key);
            const entry = { key: p.key, name: cleanName(p.name) };
            // Merged into one scan (§9): only said when it is.
            if (p.merge === true) entry.merge = true;
            // Changed by hand (§9.2): the scans added to the pattern's and
            // taken out of them; a group by hand lists its own.
            if (members) entry.members = members;
            else {
                const add = ids(p.add);
                const remove = ids(p.remove);
                if (add) entry.add = add;
                if (remove) entry.remove = remove.filter((id) => !add || !add.includes(id));
                if (entry.remove && !entry.remove.length) delete entry.remove;
            }
            out.push(entry);
        }
        return out;
    }

    /**
     * A group's scans as the person left them (§9.2, §9.4): a group by hand's
     * own; a pattern's, with the scans added to it and without those taken
     * out. Ids in the order given: the group's, then those added.
     */
    function membersOf(group, entry) {
        if (entry && Array.isArray(entry.members)) return entry.members.slice();
        const base = group && Array.isArray(group.members) ? group.members : [];
        const removed = new Set(entry && entry.remove ? entry.remove : []);
        const out = base.filter((id) => !removed.has(id));
        for (const id of (entry && entry.add) || []) if (!out.includes(id) && !removed.has(id)) out.push(id);
        return out;
    }

    function update(choice, key, change) {
        return normalize(normalize(choice).map((p) => (p.key === key ? change({ ...p }) : p)));
    }

    /**
     * The choice with scan `id` added to group `key`. It leaves any other
     * group it was added to, so the last place it was put is where it is
     * (§9.4); a scan taken out of `key` before is put back.
     */
    function addScan(choice, key, id) {
        const list = normalize(choice).map((p) => {
            if (p.key === key || !p.add || !p.add.includes(id)) return p;
            const add = p.add.filter((x) => x !== id);
            const { add: _was, ...rest } = p;
            return add.length ? { ...rest, add } : rest;
        });
        return update(list, key, (p) => {
            if (p.members) return { ...p, members: [...p.members, id] };
            if (p.remove && p.remove.includes(id)) return { ...p, remove: p.remove.filter((x) => x !== id) };
            return { ...p, add: [...(p.add || []), id] };
        });
    }

    /**
     * The choice with scan `id` taken out of group `key`: out of a group by
     * hand's scans (which goes when fewer than two are left), out of those
     * added to a pattern's, or noted as taken out of the pattern's.
     */
    function removeScan(choice, key, id) {
        return update(choice, key, (p) => {
            if (p.members) return { ...p, members: p.members.filter((x) => x !== id) };
            if (p.add && p.add.includes(id)) return { ...p, add: p.add.filter((x) => x !== id) };
            return { ...p, remove: [...(p.remove || []), id] };
        });
    }

    /** The choice with scan `id`, taken out of group `key` before, back in it. */
    function putBack(choice, key, id) {
        return update(choice, key, (p) => (p.remove ? { ...p, remove: p.remove.filter((x) => x !== id) } : p));
    }

    /**
     * The choice with a group by hand made of `members` (scan ids, two at
     * least), named `name`, merged into one scan or not. { choice, key },
     * key null when it could not be made.
     */
    function addManualGroup(choice, { name, members, merge = true } = {}) {
        const list = normalize(choice);
        const scans = ids(members);
        if (!scans || scans.length < 2) return { choice: list, key: null };
        let n = 1;
        const taken = new Set(list.map((p) => p.key));
        while (taken.has(`${MANUAL}${n}`)) n += 1;
        const key = `${MANUAL}${n}`;
        const entry = { key, name: cleanName(name), members: scans };
        if (merge) entry.merge = true;
        return { choice: normalize([...list, entry]), key };
    }

    // A run's merged scan, as the person changed it: the choice with its
    // entry made by `change`, or gone when back as the run made it.
    function updateRun(choice, scanId, change) {
        const key = runKey(scanId);
        const list = normalize(choice);
        const known = list.find((p) => p.key === key) || { key };
        const next = normalize([change({ ...known })]);
        return [...list.filter((p) => p.key !== key), ...next];
    }

    /** The run's merged scan `scanId` merged as the run made it, or shown as its contexts. */
    function setRunMerged(choice, scanId, merged) {
        return updateRun(choice, scanId, (p) => {
            const { merge: _was, exclude: _ex, ...rest } = p;
            return merged ? rest : { ...rest, merge: false };
        });
    }

    /**
     * Its context `index` taken out of it (shown on its own), or put back;
     * put back, it is in the merged scan again, no longer excluded on its own.
     */
    function setRunContextOut(choice, scanId, index, out) {
        const i = String(index);
        return updateRun(choice, scanId, (p) => {
            const remove = (p.remove || []).filter((x) => x !== i);
            const exclude = (p.exclude || []).filter((x) => x !== i);
            return out ? { ...p, remove: [...remove, i] } : { ...p, remove, exclude };
        });
    }

    // The id a context of a run's merged scan has as a scan of its own,
    // "<scan id>~<index>" (scan-group-merge.js contextAsScan), split.
    function contextIdParts(id) {
        const m = /^(.*)~(\d+)$/.exec(String(id));
        return m ? { scanId: m[1], index: m[2] } : null;
    }

    /**
     * The groups that hold contexts of the run's merged scan `scanId` as
     * scans of their own (added to a pattern, taken out of one, grouped by
     * hand): [{ key, ids }]. Merged again, those contexts are no longer scans
     * of their own, so the person is asked first (releaseRunContexts).
     */
    function runContextsHeld(choice, scanId) {
        const own = (id) => { const c = contextIdParts(id); return !!c && c.scanId === String(scanId); };
        return normalize(choice)
            .filter((p) => !isRun(p.key))
            .map((p) => ({ key: p.key, ids: [...new Set([...(p.add || []), ...(p.remove || []), ...(p.members || [])].filter(own))] }))
            .filter((x) => x.ids.length);
    }

    /** The choice without the contexts of `scanId` in any group: they are back in it. */
    function releaseRunContexts(choice, scanId) {
        const own = (id) => { const c = contextIdParts(id); return !!c && c.scanId === String(scanId); };
        const keep = (list) => (Array.isArray(list) ? list.filter((id) => !own(id)) : list);
        return normalize(normalize(choice).map((p) => (isRun(p.key) ? p : {
            ...p,
            ...(p.add ? { add: keep(p.add) } : {}),
            ...(p.remove ? { remove: keep(p.remove) } : {}),
            ...(p.members ? { members: keep(p.members) } : {}),
        })));
    }

    /** Unmerged or taken out, its context `index` excluded from the report or included. */
    function setRunContextExcluded(choice, scanId, index, excluded) {
        const i = String(index);
        return updateRun(choice, scanId, (p) => {
            const exclude = (p.exclude || []).filter((x) => x !== i);
            return { ...p, exclude: excluded ? [...exclude, i] : exclude };
        });
    }

    /**
     * The choice with its scan ids renamed by `rename(id)` (which returns the
     * id unchanged, or its new one): the scans added, taken out or grouped by
     * hand, and the run's merged scans its `run:` keys name. For reports
     * opened as one, whose scans are renamed where another report has the
     * same id. Keys of patterns name no scan and stay as they are.
     */
    function renameScanIds(choice, rename) {
        const one = (id) => {
            const next = typeof rename === 'function' ? rename(id) : id;
            return typeof next === 'string' && next ? next : id;
        };
        // A context's id follows its scan's: "s12~1" becomes "s12b~1".
        const to = (id) => {
            const c = contextIdParts(id);
            if (!c) return one(id);
            const renamed = one(id);
            return renamed !== id ? renamed : `${one(c.scanId)}~${c.index}`;
        };
        const list = (field, p) => (Array.isArray(p[field]) ? { [field]: p[field].map(to) } : {});
        return normalize(normalize(choice).map((p) => ({
            ...p,
            ...(isRun(p.key) ? { key: runKey(to(p.key.slice(RUN.length))) } : {}),
            ...list('add', p),
            ...list('remove', isRun(p.key) ? {} : p),
            ...list('members', p),
        })));
    }

    /**
     * The groups a report shows merged in its view, by name: the name given,
     * else the pattern of its key ("/products/{*}"), else "a group by hand".
     * For what reads the report's scans as saved (a comparison), to say so.
     */
    function mergedGroupNames(payload) {
        return readChoice(payload).filter((p) => p.merge === true).map((p) => {
            if (p.name) return p.name;
            if (isManual(p.key)) return 'a group by hand';
            const pattern = p.key.replace(/^[a-z]+:/, '');
            const slash = pattern.indexOf('/');
            return slash >= 0 ? pattern.slice(slash) : pattern;
        });
    }

    /**
     * The groups by hand of a choice, as a group source for findGroups
     * (scan-groups.js): id `manual`, so their keys are the entries' own. They
     * say more than any pattern about their scans, which the person named.
     */
    function createManualGroupSource(choice) {
        const groups = normalize(choice).filter((p) => isManual(p.key) && p.members);
        return {
            id: 'manual',
            propose: () => groups.map((p) => ({
                key: p.key.slice(MANUAL.length),
                label: p.name || `Group by hand ${p.key.slice(MANUAL.length)}`,
                members: p.members,
                specificity: 1000,
                evidence: { kind: 'manual' },
            })),
        };
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
        const taken = new Set();
        for (const payload of Array.isArray(payloads) ? payloads : []) {
            const entries = readChoice(payload);
            // Groups by hand are numbered within their report: another
            // report's "manual:1" is another group. Those already taken by an
            // earlier report are renumbered, clear of this report's own.
            const own = new Set(entries.filter((p) => isManual(p.key)).map((p) => p.key));
            const renumber = new Map();
            let n = 1;
            for (const key of own) {
                if (!taken.has(key)) continue;
                while (taken.has(`${MANUAL}${n}`) || own.has(`${MANUAL}${n}`)) n += 1;
                renumber.set(key, `${MANUAL}${n}`);
                n += 1;
            }
            for (const q of entries) {
                const p = renumber.has(q.key) ? { ...q, key: renumber.get(q.key) } : q;
                if (isManual(p.key)) taken.add(p.key);
                const known = byKey.get(p.key);
                if (!known) {
                    const entry = { ...p };
                    byKey.set(p.key, entry);
                    merged.push(entry);
                } else {
                    if (!known.name && p.name) known.name = p.name;
                    // Merged in any of them, merged in the report they make.
                    if (p.merge) known.merge = true;
                    // What any of them added or took out by hand, together.
                    for (const field of ['add', 'remove', 'members']) {
                        if (p[field]) known[field] = [...new Set([...(known[field] || []), ...p[field]])];
                    }
                }
            }
        }
        // A scan both added and taken out by different reports stays added.
        return normalize(merged);
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
        membersOf,
        addScan,
        removeScan,
        putBack,
        addManualGroup,
        createManualGroupSource,
        isManual,
        isRun,
        runKey,
        mergedGroupNames,
        renameScanIds,
        setRunMerged,
        setRunContextOut,
        setRunContextExcluded,
        runContextsHeld,
        releaseRunContexts,
        contextIdParts,
        planAction,
    };
}));
