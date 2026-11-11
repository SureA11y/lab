'use strict';

// Reviewing a run's scans (docs/design/scan-grouping-design.md §11.2,
// docs/design/mockups/scan-review.html): the card at the top of the run
// summary that says how much of the run repeats a template, and the Review
// scans workspace, as HTML strings from a model of the report's groups.
//
// Every pattern found is a group, with no step to choose it: acting on one
// (naming, merging, excluding its scans) is what saves it in the report. The
// workspace has the groups on the left (the patterns, the groups made by hand,
// the scans in no group, the scans a Merged scan step made), the selected
// group's pages as a grid of their screenshots in the middle, those that
// differ from the others first, and the group's failures and actions on the
// right.
//
// It knows nothing of the app: reviewModel takes what the shared modules
// worked out (the groups, the choice, the scans as shown, each group's
// issues) and the views are pure strings. The controls carry data attributes
// the app listens to and a data-sr-focus key, so focus comes back to the same
// control after a redraw.
//
// Browser: available as globalThis.A11Y_SCAN_REVIEW_VIEW.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_REVIEW_VIEW = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
    const isIncluded = (scan) => !!scan && scan.includedInReport !== false;

    const REST = 'rest';
    const RUN = 'run:';

    function flatten(groups) {
        const out = [];
        const walk = (level) => (level || []).forEach((g) => { out.push(g); walk(g.children); });
        walk(groups);
        return out;
    }

    function pathOf(url) {
        try {
            const u = new URL(url);
            return `${u.pathname}${u.search}${u.hash}`;
        } catch {
            return String(url || '');
        }
    }

    // How many failures a scan as shown lists: its failing rules.
    function failCount(scan) {
        const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : null;
        if (findings) return findings.filter((f) => f && f.outcome === 'fail').length;
        const n = scan && scan.summary && scan.summary.failCount;
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * What the review shows, from the report:
     * - scans: the report's scans as they are, report order;
     * - result: findGroups over them (the URL source and the groups by hand);
     * - choice: the saved choice (scan-group-choice.js readChoice);
     * - shown: the scans as shown (scan-group-merge.js scansAsShown);
     * - membersOf(group, entry): a group's scans as left by hand.
     */
    function reviewModel({ scans, result, choice, shown, membersOf }) {
        const list = (Array.isArray(scans) ? scans : []).filter(Boolean);
        const entries = new Map((Array.isArray(choice) ? choice : []).map((p) => [p.key, p]));
        const groups = result && Array.isArray(result.groups) ? result.groups : [];
        const merges = shown && shown.merges ? shown.merges : new Map();
        const mergedKeys = new Set([...merges.values()].map((m) => m.key));
        const wanted = new Set([...entries.values()].filter((p) => p.merge === true).map((p) => p.key));
        const byKey = new Map(flatten(groups).map((g) => [g.key, g]));
        const members = (g) => membersOf(g, entries.get(g.key) || null);

        // The nearest merged group above one, which it is shown merged into.
        const mergedInto = (g) => {
            let up = g.parentKey ? byKey.get(g.parentKey) : null;
            let found = null;
            while (up) {
                if (mergedKeys.has(up.key)) found = up;
                up = up.parentKey ? byKey.get(up.parentKey) : null;
            }
            return found;
        };
        const node = (g) => {
            const entry = entries.get(g.key) || null;
            const ids = members(g);
            const into = wanted.has(g.key) && !mergedKeys.has(g.key) ? mergedInto(g) : null;
            return {
                key: g.key,
                group: g,
                entry,
                byHand: g.source === 'manual',
                name: (entry && entry.name) || g.label,
                pattern: g.source === 'manual' ? null : g.label,
                ids,
                included: ids.filter((id) => isIncluded(list.find((s) => s.id === id))).length,
                taken: entry && Array.isArray(entry.remove) && g.source !== 'manual' ? entry.remove.filter((id) => list.some((s) => s.id === id)) : [],
                merged: mergedKeys.has(g.key) || wanted.has(g.key),
                mergedInto: into ? ((entries.get(into.key) && entries.get(into.key).name) || into.label) : null,
                children: (g.children || []).filter((c) => c.source !== 'manual').map(node),
            };
        };
        // Patterns, without the groups by hand a manual group may have nested.
        const withoutManual = (level) => level.flatMap((g) => (g.source === 'manual'
            ? withoutManual(g.children || [])
            : [{ ...g, children: withoutManual(g.children || []) }]));
        const patterns = withoutManual(groups).map(node);
        const byHand = flatten(groups).filter((g) => g.source === 'manual').map((g) => ({ ...node(g), children: [] }));

        const grouped = new Set([...flatten(patterns).flatMap((n) => n.ids), ...byHand.flatMap((n) => n.ids)]);
        const rest = list.filter((s) => !grouped.has(s.id)).map((s) => s.id);

        // The scans a Merged scan step made, to unmerge or take a context out of.
        const runMerges = list.filter((s) => s.mergedScan === true && Array.isArray(s.contexts) && s.contexts.length).map((s) => {
            const entry = entries.get(`${RUN}${s.id}`) || {};
            const out = new Set(entry.remove || []);
            return {
                key: `${RUN}${s.id}`,
                id: s.id,
                name: s.label || s.id,
                kept: s.contexts.some((c) => c && c.scan),
                unmerged: entry.merge === false,
                contexts: s.contexts.map((c, i) => ({ name: (c && c.name) || `Context ${i + 1}`, index: i, kept: !!(c && c.scan), out: out.has(String(i)) })),
            };
        });

        const shownList = shown && Array.isArray(shown.scans) ? shown.scans : list;
        const inReport = shownList.filter(isIncluded);
        const templates = patterns.filter((n) => n.ids.length > 1);
        const repeat = new Set(templates.flatMap((n) => n.ids)).size;
        return {
            scans: list,
            byId: new Map(list.map((s) => [s.id, s])),
            patterns,
            byHand,
            rest,
            runMerges,
            totals: {
                scans: list.length,
                inReport: inReport.length,
                failures: inReport.reduce((n, s) => n + failCount(s), 0),
                merged: merges.size,
                excluded: list.filter((s) => !isIncluded(s)).length,
                repeat,
                templates: templates.length,
            },
        };
    }

    /** A node of the model by its key ('rest', 'run:<id>' or a group key), or null. */
    function nodeOf(model, key) {
        if (key === REST) return { key: REST, rest: true, name: 'In no group', ids: model.rest };
        if (typeof key === 'string' && key.startsWith(RUN)) {
            const run = model.runMerges.find((r) => r.key === key);
            return run ? { ...run, run: true, ids: [run.id] } : null;
        }
        return flatten([...model.patterns, ...model.byHand]).find((n) => n.key === key) || null;
    }

    // -------------------------------------------------------------- the card

    // A picture of a scan's page, or its address where it has none.
    function thumbHTML(scan, url, opts) {
        const o = opts || {};
        const alt = `Screenshot of ${scan.label || scan.id}`;
        return url
            ? `<img class="sr-shot" src="${esc(url)}" alt="${o.decorative ? '' : esc(alt)}" loading="lazy" decoding="async">`
            : `<span class="sr-noshot"${o.decorative ? ' aria-hidden="true"' : ''}>${o.decorative ? '' : '<span class="sr-noshot-label">No screenshot</span>'}<span class="sr-noshot-path">${esc(pathOf(scan.url))}</span></span>`;
    }

    /**
     * The card at the top of the run summary: how much of the run is pages of
     * a template, and the button that opens the review. Empty without a
     * template (a run whose URLs repeat nothing) and without a run's merged
     * scan to review.
     */
    function summaryCardHTML(model, opts) {
        const o = opts || {};
        const thumbOf = typeof o.thumbOf === 'function' ? o.thumbOf : () => null;
        const t = model.totals;
        if (!t.templates && !model.runMerges.length && !model.byHand.length) return '';
        const top = model.patterns.filter((n) => n.ids.length > 1).sort((a, b) => b.ids.length - a.ids.length);
        const lead = top[0];
        const stack = lead ? lead.ids.slice(0, 4).map((id, i) => `<span class="sr-stack-item" style="--i:${i}">${thumbHTML(model.byId.get(id), thumbOf(model.byId.get(id)), { decorative: true })}</span>`).join('') : '';
        const shades = ['var(--sr-c1)', 'var(--sr-c2)', 'var(--sr-c3)', 'var(--sr-c4)', 'var(--sr-c5)'];
        const shown = top.slice(0, 5);
        const others = t.scans - t.repeat;
        const bar = shown.map((n, i) => `<span style="width:${(n.ids.length / t.scans) * 100}%;background:${shades[i]}"></span>`).join('');
        const legend = shown.map((n, i) => `<span><i style="background:${shades[i]}"></i>${esc(n.name)} ${n.ids.length}</span>`).join('')
            + (top.length > shown.length ? `<span>${plural(top.length - shown.length, 'more template')}</span>` : '')
            + `<span><i class="sr-none"></i>In no template ${others}</span>`;
        const headline = t.templates
            ? `${t.repeat} of ${plural(t.scans, 'scan')} are pages of ${plural(t.templates, 'template')}`
            : 'Review the scans of this run';
        const merged = t.merged ? ` ${plural(t.merged, 'group')} ${t.merged === 1 ? 'is' : 'are'} merged: the report reads ${plural(t.inReport, 'scan')}.` : '';
        const sub = lead
            ? `${esc(lead.name)} alone ${lead.ids.length === 1 ? 'is' : 'are'} ${plural(lead.ids.length, 'scan')}. Review them by their pictures: merge a template into one scan, take out the pages that differ, exclude what is noise.${esc(merged)}`
            : `Scans merged by the run can be shown as their contexts, and scans grouped by hand.${esc(merged)}`;
        return `<section class="sr-card" aria-labelledby="sr-card-h">`
            + (stack ? `<span class="sr-stack" aria-hidden="true">${stack}</span>` : '')
            + `<span class="sr-card-text"><strong id="sr-card-h">${esc(headline)}</strong><span class="sr-card-sub">${sub}</span>`
            + (t.templates ? `<span class="sr-bar" role="img" aria-label="${esc(shown.map((n) => `${n.name}: ${n.ids.length}`).join(', ') + `, in no template: ${others}`)}">${bar}</span><span class="sr-legend">${legend}</span>` : '')
            + `</span><button type="button" class="secondary-button sr-open" data-sr-open data-sr-focus="open">Review scans</button></section>`;
    }

    // -------------------------------------------------------------- the workspace

    function statsHTML(model, base) {
        const t = model.totals;
        const changed = base != null && t.inReport !== base;
        return `<span class="sr-stat${changed ? ' sr-stat--changed' : ''}">In the report <b>${t.inReport}</b> ${t.inReport === 1 ? 'scan' : 'scans'}</span>`
            + `<span class="sr-stat">Failures <b>${t.failures}</b></span>`
            + `<span class="sr-stat">Merged <b>${t.merged}</b></span>`
            + `<span class="sr-stat">Excluded <b>${t.excluded}</b></span>`;
    }

    function treeHTML(model, sel) {
        const item = (n) => `<li><button type="button" class="sr-node" data-sr-node="${esc(n.key)}" data-sr-focus="node:${esc(n.key)}" aria-current="${sel === n.key ? 'true' : 'false'}" title="${esc(n.pattern && n.pattern !== n.name ? `${n.name}: ${n.pattern}` : n.name)}">`
            // The pattern under a name given to it; an unnamed group is its
            // pattern, an address, in the code font.
            + `<span class="sr-node-label${isAddress(n) ? ' sr-url' : ''}">${esc(n.name)}${n.pattern && n.pattern !== n.name ? ` <span class="sr-node-pattern sr-url">${esc(n.pattern)}</span>` : (n.byHand ? ' <span class="sr-node-pattern">by hand</span>' : '')}</span>`
            + (n.merged ? ' <span class="sr-node-badge">merged</span>' : '')
            + ` <span class="sr-node-count">${n.ids.length}</span></button>`
            + (n.children && n.children.length ? `<ul>${n.children.map(item).join('')}</ul>` : '') + `</li>`;
        let html = '';
        if (model.patterns.length) html += `<h3 class="sr-tree-h">Templates found</h3><ul>${model.patterns.map(item).join('')}</ul>`;
        else html += `<p class="sr-tree-none">The URLs of these scans repeat no pattern.</p>`;
        if (model.byHand.length) html += `<h3 class="sr-tree-h">Grouped by hand</h3><ul>${model.byHand.map(item).join('')}</ul>`;
        html += `<h3 class="sr-tree-h">The rest</h3><ul><li><button type="button" class="sr-node" data-sr-node="${REST}" data-sr-focus="node:${REST}" aria-current="${sel === REST ? 'true' : 'false'}">`
            + `<span class="sr-node-label">In no group</span> <span class="sr-node-count">${model.rest.length}</span></button></li></ul>`;
        if (model.runMerges.length) {
            html += `<h3 class="sr-tree-h">Merged by the run</h3><ul>${model.runMerges.map((r) => `<li><button type="button" class="sr-node" data-sr-node="${esc(r.key)}" data-sr-focus="node:${esc(r.key)}" aria-current="${sel === r.key ? 'true' : 'false'}">`
                + `<span class="sr-node-label">${esc(r.name)} <span class="sr-node-pattern">${esc(r.contexts.map((c) => c.name).join(' · '))}</span></span>`
                + ` <span class="sr-node-badge">${r.unmerged ? 'unmerged' : 'run'}</span></button></li>`).join('')}</ul>`;
        }
        return html;
    }

    // A group named by its URL pattern, not by a person.
    function isAddress(n) {
        return !n.byHand && (!n.pattern || n.pattern === n.name);
    }

    // What a tile says of its scan. Where most of the group differs, nothing
    // stands out (`standOut` false): its own failures are counted plainly, and
    // being built unlike the others, true of most, is not said.
    function badgesHTML(d, scan, takenOut, standOut) {
        const own = d && d.own && d.own.length;
        return [
            own ? `<span class="sr-badge${standOut ? ' sr-badge--differs' : ''}">${plural(own, 'own failure')}${standOut && d.unlike ? ', built unlike the others' : ''}</span>` : '',
            !own && standOut && d && d.unlike ? '<span class="sr-badge sr-badge--differs">built unlike the others</span>' : '',
            !isIncluded(scan) ? '<span class="sr-badge sr-badge--excluded">excluded</span>' : '',
            takenOut ? '<span class="sr-badge">taken out</span>' : '',
        ].join('');
    }

    /**
     * The middle of the workspace: the selected group's pages as a grid of
     * their screenshots. view: { sel, selected (Set of ids), sort ('differs'
     * or 'report'), issues (groupIssues of the group, or null), thumbOf,
     * targets ([{ key, name }], the groups selected pages can be added to) }.
     */
    function gridHTML(model, node, view) {
        const v = view || {};
        const thumbOf = typeof v.thumbOf === 'function' ? v.thumbOf : () => null;
        const selected = v.selected instanceof Set ? v.selected : new Set();
        const byScan = v.issues && v.issues.byScan ? v.issues.byScan : new Map();
        const group = !node.rest && !node.run;
        let ids = node.ids.filter((id) => model.byId.has(id));
        const weight = (id) => {
            const d = byScan.get(id);
            return d ? d.own.length + (d.unlike ? 2 : 0) : 0;
        };
        if (group && v.sort !== 'report') ids = [...ids].sort((a, b) => weight(b) - weight(a));
        const differ = ids.filter((id) => weight(id) > 0).length;
        // Pages of one template, a few of them unlike the rest: those are
        // outlined. Where most differ (a pattern wider than a template, as
        // /usa/... is), outlining nearly all would single out nothing.
        const standOut = differ > 0 && differ <= ids.length / 2;
        const picked = ids.filter((id) => selected.has(id));
        const tile = (id, takenOut) => {
            const s = model.byId.get(id);
            const d = byScan.get(id);
            const differs = standOut && !takenOut && weight(id) > 0;
            const boxId = `sr-pick-${id}`;
            return `<li class="sr-tile${selected.has(id) ? ' sr-tile--selected' : ''}${isIncluded(s) ? '' : ' sr-tile--excluded'}${differs ? ' sr-tile--differs' : ''}">`
                + `<button type="button" class="sr-thumb" data-sr-preview="${esc(id)}" data-sr-focus="preview:${esc(id)}" aria-label="${esc(`See ${s.label || s.id} large`)}">${thumbHTML(s, thumbOf(s), { decorative: true })}</button>`
                + `<span class="sr-tile-body"><span class="sr-tile-top">`
                + (takenOut ? '' : `<input type="checkbox" id="${esc(boxId)}" data-sr-pick="${esc(id)}" data-sr-focus="pick:${esc(id)}"${selected.has(id) ? ' checked' : ''}>`)
                + `<label${takenOut ? '' : ` for="${esc(boxId)}"`} class="sr-tile-name" title="${esc(s.label || s.id)}">${esc(s.label || s.id)}</label></span>`
                + `<span class="sr-tile-path sr-url" title="${esc(pathOf(s.url))}">${esc(pathOf(s.url))}</span><span class="sr-badges">${badgesHTML(d, s, takenOut, standOut)}</span>`
                + (takenOut ? `<button type="button" class="sr-link" data-sr-putback="${esc(id)}" data-sr-focus="putback:${esc(id)}">Put back</button>` : '')
                + `</span></li>`;
        };
        const title = node.rest ? 'In no group' : node.name;
        let html = `<div class="sr-grid-head"><h3 id="sr-grid-h"${!node.rest && !node.run && isAddress(node) ? ' class="sr-url"' : ''}>${esc(title)}</h3><span class="sr-grid-tools">`
            + (group ? `<label>Order <select data-sr-sort data-sr-focus="sort"><option value="differs"${v.sort !== 'report' ? ' selected' : ''}>Those that differ first</option><option value="report"${v.sort === 'report' ? ' selected' : ''}>As in the report</option></select></label>` : '')
            + (ids.length ? `<button type="button" class="secondary-button" data-sr-select-all data-sr-focus="select-all">${picked.length === ids.length ? 'Select none' : 'Select all'}</button>` : '')
            + `</span></div>`;
        if (group) {
            const alike = !differ ? ', alike.'
                : standOut ? `; <strong>${differ}</strong> ${differ === 1 ? 'differs' : 'differ'} from the others, outlined${v.sort !== 'report' ? ', first' : ''}.`
                : `, with little in common: most fail or are built in their own way. Its templates below it in the list may say more.`;
            html += `<p class="sr-note">${plural(ids.length, 'scan')}${alike} Select a picture to see it large.</p>`;
        }
        if (picked.length) {
            html += `<div class="sr-selbar" role="group" aria-label="${esc(`${plural(picked.length, 'selected scan')}`)}"><strong>${plural(picked.length, 'scan')} selected</strong>`
                + (group ? '<button type="button" class="secondary-button" data-sr-bulk="out" data-sr-focus="bulk:out">Take out of the group</button>' : '')
                + '<button type="button" class="secondary-button" data-sr-bulk="exclude" data-sr-focus="bulk:exclude">Exclude</button>'
                + '<button type="button" class="secondary-button" data-sr-bulk="include" data-sr-focus="bulk:include">Include</button>'
                + '<button type="button" class="secondary-button" data-sr-bulk="byhand" data-sr-focus="bulk:byhand">Group by hand</button>'
                // Into another group, merged or not, whatever its pattern.
                + (Array.isArray(v.targets) && v.targets.length
                    ? `<span class="sr-add"><label for="sr-add-target">Add to</label> <select id="sr-add-target" data-sr-add-target data-sr-focus="add-target">`
                        + `<option value="">a group…</option>${v.targets.map((t) => `<option value="${esc(t.key)}">${esc(t.name)}</option>`).join('')}</select>`
                        + ` <button type="button" class="secondary-button" data-sr-bulk="add" data-sr-focus="bulk:add">Add</button></span>`
                    : '')
                + '</div>';
        }
        html += ids.length
            ? `<ul class="sr-tiles" aria-labelledby="sr-grid-h">${ids.map((id) => tile(id, false)).join('')}</ul>`
            : '<p class="sr-note">No scan here.</p>';
        const taken = node.taken || [];
        if (taken.length) html += `<h4 class="sr-sub">Taken out of the group, shown on their own</h4><ul class="sr-tiles">${taken.map((id) => tile(id, true)).join('')}</ul>`;
        return html;
    }

    function ruleListHTML(rules, total, fixOnce) {
        return `<ul class="sr-fails sr-fails--rules">${rules.map((r) => `<li><span class="sr-fail-name">${esc(r.title)}</span>`
            + ` <span class="sr-sev sr-sev--${esc(r.severity)}">${esc(r.severity)}</span>`
            + ` <span class="sr-fails-on">${r.scans.length} of ${total}${fixOnce ? '<small><span class="visually-hidden"> · </span>fix once</small>' : ''}</span></li>`).join('')}</ul>`;
    }

    /**
     * The right of the workspace: the group's name, its failures, merging with
     * what it changes, and its actions. view: { issues, impact ({ scans: [now,
     * then], failures: [now, then] } of merging or unmerging), impactOpen,
     * focus (the key shown alone, or null) }.
     */
    function detailHTML(model, node, view) {
        const v = view || {};
        if (node.run) {
            const body = !node.kept
                ? '<p class="sr-note">This report did not keep its contexts\' own scans (the run did not keep them, or the lab that saved it did not yet), so it can only be shown merged.</p>'
                : `<div class="sr-box"><label class="sr-switch"><input type="checkbox" data-sr-run-merge="${esc(node.id)}" data-sr-focus="run-merge:${esc(node.id)}"${node.unmerged ? '' : ' checked'}> <span>Merged into one scan<small>Unmerge to see each context as a scan of its own.</small></span></label></div>`
                    + (node.unmerged ? '' : `<div class="sr-box"><h4 class="sr-sub">Its contexts</h4><ul class="sr-fails">${node.contexts.map((c) => {
                        const stay = node.contexts.filter((x) => x.kept && !x.out).length;
                        const kind = c.out ? 'run-back' : 'run-out';
                        const text = c.out ? 'Put back' : 'Take out';
                        const button = !c.kept || (!c.out && stay < 2) ? '' : `<button type="button" class="secondary-button" data-sr-${kind}="${esc(node.id)}" data-sr-context="${c.index}" data-sr-focus="${kind}:${esc(node.id)}:${c.index}" aria-label="${esc(`${text} ${c.name}`)}">${text}</button>`;
                        return `<li><span>${esc(c.name)}${c.out ? ' <span class="sr-badge">taken out</span>' : ''}</span>${button}</li>`;
                    }).join('')}</ul></div>`);
            return `<h3>${esc(node.name)}</h3><p class="sr-note">Merged by the run from ${plural(node.contexts.length, 'context')}: each failure says which contexts it is in.</p>${body}`;
        }
        if (node.rest) {
            return `<h3>In no group</h3><p class="sr-note">${plural(node.ids.length, 'scan')} no pattern finds together: pages of their own, not of a template. They are not merged; these act on all of them.</p>`
                + (node.ids.length ? `<div class="sr-box sr-actions sr-actions--stack">`
                    + `<button type="button" class="secondary-button" data-sr-rest="focus" data-sr-focus="rest:focus">${v.focus === REST ? 'Show every scan' : 'Show only these in the report'}</button>`
                    + `<button type="button" class="secondary-button" data-sr-rest="byhand" data-sr-focus="rest:byhand">Group them by hand…</button>`
                    + `<button type="button" class="secondary-button" data-sr-rest="exclude" data-sr-focus="rest:exclude">Exclude them from the report…</button></div>` : '')
                + '<p class="sr-note">Showing only some scans changes what the report shows until you show every scan again; excluding takes them out of its totals and its download.</p>';
        }
        const issues = v.issues;
        const total = node.ids.length;
        const im = v.impact;
        const contentPages = issues ? new Set(issues.content.flatMap((r) => r.scans)).size : 0;
        const nameId = 'sr-name';
        return `<h3${isAddress(node) ? ' class="sr-url"' : ''}>${esc(node.name)}</h3>`
            // Its pattern under a name given to it; not again under the pattern.
            + `<p class="sr-note">${node.byHand ? 'Grouped by hand · ' : (isAddress(node) ? '' : `<span class="sr-url">${esc(node.pattern)}</span> · `)}${plural(total, 'scan')}, ${node.included} included</p>`
            + `<p class="sr-field"><label for="${nameId}">Name</label><input type="text" id="${nameId}" data-sr-name="${esc(node.key)}" data-sr-focus="name" value="${esc(node.entry && node.entry.name ? node.entry.name : '')}" maxlength="200" autocomplete="off"></p>`
            // While what it changes is shown, the switch shows the change asked
            // for: applying makes it so, Cancel puts it back.
            + `<div class="sr-box"><label class="sr-switch"><input type="checkbox" data-sr-merge="${esc(node.key)}" data-sr-focus="merge"${(v.impactOpen ? !node.merged : node.merged) ? ' checked' : ''}> <span>Merge into one scan<small>A failure of the template is listed once, on all its pages; a page's own failure stays on that page. Can be undone.</small></span></label>`
            + (node.mergedInto ? `<p class="sr-note">Shown merged into ${esc(node.mergedInto)}, the larger merged group it is in.</p>` : '')
            + (im && v.impactOpen ? `<div class="sr-impact" role="group" aria-label="What it changes"><p class="sr-impact-row"><span>Scans in the report</span> <span><b>${im.scans[0]}</b> → <b>${im.scans[1]}</b></span></p>`
                + `<p class="sr-impact-row"><span>Failures listed</span> <span><b>${im.failures[0]}</b> → <b>${im.failures[1]}</b></span></p>`
                + `<p class="sr-note">${node.merged ? 'Unmerging shows each page again.' : (contentPages
                    ? `What the template fails is listed once; what ${plural(contentPages, 'page')} ${contentPages === 1 ? 'fails' : 'fail'} on ${contentPages === 1 ? 'its' : 'their'} own stays on ${contentPages === 1 ? 'it' : 'them'}.`
                    : 'What the template fails is listed once.')}</p>`
                + `<span class="sr-actions"><button type="button" class="secondary-button sr-primary" data-sr-apply-merge="${esc(node.key)}" data-sr-focus="apply-merge">${node.merged ? 'Unmerge' : 'Merge'}</button>`
                + `<button type="button" class="secondary-button" data-sr-cancel-merge data-sr-focus="cancel-merge">Cancel</button></span></div>` : '')
            + `</div>`
            + (issues ? `<div class="sr-box"><h4 class="sr-sub">On most scans: the template's</h4>`
                + (issues.template.length ? ruleListHTML(issues.template, issues.scansTotal, true) : '<p class="sr-note">Nothing fails on most scans.</p>')
                + `<h4 class="sr-sub">On a few scans: their own content's</h4>`
                + (issues.content.length ? ruleListHTML(issues.content, issues.scansTotal, false) : '<p class="sr-note">Nothing fails on a few scans only.</p>')
                + `</div>` : '')
            + `<div class="sr-box"><h4 class="sr-sub">Its scans</h4><span class="sr-actions">`
            + `<button type="button" class="secondary-button" data-sr-act="keepOne" data-sr-focus="act:keepOne">Keep one</button>`
            + `<button type="button" class="secondary-button" data-sr-act="exclude" data-sr-focus="act:exclude">Exclude all</button>`
            + `<button type="button" class="secondary-button" data-sr-act="include" data-sr-focus="act:include">Include all</button></span>`
            + `<span class="sr-actions"><button type="button" class="secondary-button" data-sr-act="focus" data-sr-focus="act:focus">${v.focus === node.key ? 'Show every scan' : 'Show only these in the report'}</button>`
            + (node.byHand ? `<button type="button" class="secondary-button" data-sr-act="remove" data-sr-focus="act:remove">Remove group</button>` : '')
            + `</span></div>`;
    }

    /**
     * A scan seen large (from the grid or the report): its picture, what it
     * fails like the others and on its own, and the template's failures it
     * lacks. d: groupIssues byScan entry, or null; groupName for the action.
     */
    function previewHTML(scan, url, d, opts) {
        const o = opts || {};
        const own = d ? d.own : [];
        const missing = d ? d.missing : [];
        const ownIds = new Set(own.map((r) => r.ruleId));
        const fails = (scan.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [])
            .filter((f) => f && f.outcome === 'fail');
        const like = fails.filter((f) => !ownIds.has(f.ruleId || f.id));
        const li = (title, extra) => `<li><span>${esc(title)}</span>${extra ? ` <span class="sr-fails-on">${esc(extra)}</span>` : ''}</li>`;
        return `<div class="sr-preview-pic">${url ? `<img src="${esc(url)}" alt="${esc(`Screenshot of ${scan.label || scan.id}`)}">` : thumbHTML(scan, null)}`
            + `<p class="sr-mono sr-note">${esc(scan.url || '')}</p></div>`
            + `<div class="sr-preview-text">`
            + (d ? `<h4 class="sr-sub">Fails like the others</h4><ul class="sr-fails">${like.map((f) => li(f.title || f.ruleId, f.severity)).join('') || '<li>Nothing</li>'}</ul>`
                + `<h4 class="sr-sub">Fails on its own</h4><ul class="sr-fails">${own.map((r) => li(r.title, r.severity)).join('') || '<li>Nothing: it is like the others</li>'}</ul>`
                + (missing.length ? `<h4 class="sr-sub">Does not fail like the others</h4><ul class="sr-fails">${missing.map((r) => li(r.title, r.severity)).join('')}</ul>` : '')
                + (d.unlike ? '<p class="sr-note">It is built unlike the others: it may be another template, to take out of this group.</p>' : '')
                : `<h4 class="sr-sub">Fails</h4><ul class="sr-fails">${fails.map((f) => li(f.title || f.ruleId, f.severity)).join('') || '<li>Nothing</li>'}</ul>`)
            + (o.excluded ? '<p class="sr-note"><span class="sr-badge sr-badge--excluded">excluded</span> It is not in the report.</p>' : '')
            + `</div>`;
    }

    return {
        REST,
        reviewModel,
        nodeOf,
        summaryCardHTML,
        statsHTML,
        treeHTML,
        gridHTML,
        detailHTML,
        previewHTML,
        thumbHTML,
        pathOf,
    };
}));
