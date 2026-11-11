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

    // ------------------------------------------------- names from the titles

    // Parts of a page title: "Insight 3 - Blog - Insights - Example Bank".
    const titleParts = (title) => String(title || '').split(/\s+[-|–—·•»]\s+/).map((s) => s.trim()).filter(Boolean);
    // The share of a group's titles a part or a word must be in to name it:
    // most, so one page titled otherwise does not take the name away.
    const NAME_SHARE = 0.8;
    // Words that say nothing of what the pages are.
    const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'your', 'our', 'you', 'are', 'this', 'that', 'page', 'pages',
        'about', 'into', 'its', 'not', 'all', 'new', 'how', 'why', 'when', 'les', 'des', 'une', 'pour', 'avec', 'der', 'die',
        'das', 'und', 'los', 'las', 'del', 'con', 'por', 'para']);

    // The last parts most titles end with ("Blog - Insights - Example Bank"),
    // as many as most share; [] when they share none.
    function commonEnd(partsList) {
        let best = [];
        for (let k = 1; k <= 4; k++) {
            const counts = new Map();
            for (const parts of partsList) {
                // A title that is only its site's name is no page of a section.
                if (parts.length <= k) continue;
                const end = JSON.stringify(parts.slice(-k));
                counts.set(end, (counts.get(end) || 0) + 1);
            }
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            if (!top || top[1] < NAME_SHARE * partsList.length) break;
            best = JSON.parse(top[0]);
        }
        return best;
    }

    // The words of a title worth naming pages by.
    const wordsOf = (text) => new Set((String(text || '').toLowerCase().match(/[\p{L}][\p{L}'’]+/gu) || [])
        .filter((w) => w.length >= 3 && !STOP.has(w)));

    /**
     * A name for a group of pages from their titles, or null: the section
     * most of them end with, without the site's name every page of the run
     * ends with ("Blog - Insights pages"); else a word most of them have
     * ("Product pages"), not one every title of the run has. `site`: {
     * end: commonEnd of every title of the run, words: the words in all of
     * them }.
     */
    function suggestName(titles, site) {
        const list = (titles || []).filter((t) => typeof t === 'string' && t.trim());
        if (list.length < 2) return null;
        const partsList = list.map(titleParts);
        const end = commonEnd(partsList);
        const siteEnd = site && Array.isArray(site.end) ? site.end : [];
        const siteWords = site && site.words instanceof Set ? site.words : new Set();
        const endsWithSite = siteEnd.length && end.length >= siteEnd.length && siteEnd.every((p, i) => end[end.length - siteEnd.length + i] === p);
        const section = endsWithSite ? end.slice(0, end.length - siteEnd.length) : end;
        if (section.length) return `${section.join(' - ')} pages`;
        // A word most titles have, before the parts they end with.
        const counts = new Map();
        const order = new Map();
        for (const parts of partsList) {
            const own = end.length && JSON.stringify(parts.slice(-end.length)) === JSON.stringify(end) ? parts.slice(0, -end.length) : parts;
            for (const w of wordsOf(own.join(' '))) {
                if (siteWords.has(w)) continue;
                counts.set(w, (counts.get(w) || 0) + 1);
                if (!order.has(w)) order.set(w, order.size);
            }
        }
        const top = [...counts.entries()].filter(([, n]) => n >= NAME_SHARE * list.length)
            .sort((a, b) => b[1] - a[1] || order.get(a[0]) - order.get(b[0]))[0];
        return top ? `${top[0].charAt(0).toUpperCase()}${top[0].slice(1)} pages` : null;
    }

    // The fixed parts of a pattern: "/en/products/category-0/{slug}" has
    // en, products and category-0.
    const literalsOf = (label) => String(label || '').split(/[/?&=]/).filter((s) => s && !s.includes('{') && !s.includes('…'));

    /**
     * A suggested name for each pattern, by key, from its pages' titles
     * (suggestName). A pattern inside another named alike says what sets it
     * apart, from its own fixed part: "Product pages · category-0".
     */
    function suggestNames(scans, groups, membersOf) {
        const list = (Array.isArray(scans) ? scans : []).filter(Boolean);
        const byId = new Map(list.map((s) => [s.id, s]));
        const titled = list.map((s) => s.label).filter((t) => typeof t === 'string' && t.trim());
        const runWords = titled.map(wordsOf);
        const site = {
            end: commonEnd(titled.map(titleParts)),
            words: new Set(runWords.length ? [...runWords[0]].filter((w) => runWords.every((set) => set.has(w))) : []),
        };
        const out = new Map();
        const walk = (level, parent) => (level || []).forEach((g) => {
            if (g.source === 'manual') { walk(g.children, parent); return; }
            const ids = typeof membersOf === 'function' ? membersOf(g) : g.members;
            let name = suggestName((ids || []).map((id) => byId.get(id) && byId.get(id).label), site);
            if (name && parent && parent.name === name) {
                const own = literalsOf(g.label).filter((s) => !literalsOf(parent.label).includes(s));
                name = own.length ? `${name} · ${own[own.length - 1]}` : null;
            }
            if (name) out.set(g.key, name);
            walk(g.children, { name: name || (parent && parent.name) || null, label: g.label });
        });
        walk(Array.isArray(groups) ? groups : []);
        return out;
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
        // A name from its pages' titles, which the person's own name replaces.
        const suggested = suggestNames(list, groups, members);
        const nameOf = (g) => (entries.get(g.key) && entries.get(g.key).name) || suggested.get(g.key) || g.label;

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
                name: nameOf(g),
                suggested: g.source === 'manual' ? null : suggested.get(g.key) || null,
                pattern: g.source === 'manual' ? null : g.label,
                // A pattern that only says where several templates are, as
                // /en/… holds the products' and the blog's: not one template.
                section: !!(g.evidence && g.evidence.kind === 'prefix'),
                ids,
                included: ids.filter((id) => isIncluded(list.find((s) => s.id === id))).length,
                taken: entry && Array.isArray(entry.remove) && g.source !== 'manual' ? entry.remove.filter((id) => list.some((s) => s.id === id)) : [],
                merged: mergedKeys.has(g.key) || wanted.has(g.key),
                mergedInto: into ? nameOf(into) : null,
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
        // The templates as the workspace lists them: every pattern of two
        // pages or more, nested ones too.
        const templates = flatten(patterns).filter((n) => n.ids.length > 1);
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
                // Before anything is merged: each included scan on its own.
                included: list.filter(isIncluded).length,
                inReport: inReport.length,
                failures: inReport.reduce((n, s) => n + failCount(s), 0),
                // Merged by the person, and the run's merged scans left merged.
                merged: merges.size,
                runMerged: runMerges.filter((r) => !r.unmerged).length,
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
        const listed = flatten(model.patterns).filter((n) => n.ids.length > 1);
        // The largest template, not a section that holds several (/en/…).
        const largest = listed.filter((n) => !n.section).sort((a, b) => b.ids.length - a.ids.length)[0] || null;
        const stack = largest ? largest.ids.slice(0, 4).map((id, i) => `<span class="sr-stack-item" style="--i:${i}">${thumbHTML(model.byId.get(id), thumbOf(model.byId.get(id)), { decorative: true })}</span>`).join('') : '';

        // The bar: the templates side by side, each page once; a section is
        // shown as the templates in it, and its pages in none of them.
        const segments = [];
        const add = (n) => {
            const kids = (n.children || []).filter((c) => c.ids.length > 1);
            if (!n.section || !kids.length) { segments.push({ name: n.name, count: n.ids.length }); return; }
            kids.forEach(add);
            const inKids = new Set(kids.flatMap((c) => c.ids));
            const left = n.ids.filter((id) => !inKids.has(id)).length;
            if (left) segments.push({ name: `Other pages of ${n.name}`, count: left });
        };
        model.patterns.filter((n) => n.ids.length > 1).forEach(add);
        segments.sort((a, b) => b.count - a.count);
        const shades = ['var(--sr-c1)', 'var(--sr-c2)', 'var(--sr-c3)', 'var(--sr-c4)', 'var(--sr-c5)'];
        const shown = segments.slice(0, 5);
        const others = t.scans - t.repeat;
        const bar = shown.map((n, i) => `<span style="width:${(n.count / t.scans) * 100}%;background:${shades[i]}"></span>`).join('');
        const legend = shown.map((n, i) => `<span><i style="background:${shades[i]}"></i>${esc(n.name)} ${n.count}</span>`).join('')
            + (segments.length > shown.length ? `<span>${plural(segments.length - shown.length, 'more template')}</span>` : '')
            + `<span><i class="sr-none"></i>In no template ${others}</span>`;

        const headline = t.templates
            ? `${t.repeat} of ${plural(t.scans, 'page')} share a layout, in ${plural(t.templates, 'template')}${largest && t.templates > 1 ? ` (largest: ${largest.ids.length})` : ''}.`
            : 'Review the scans of this run';
        // The template whose merge shortens the report most, of those not
        // merged and holding no page already in a merged scan.
        const mergedIds = new Set(flatten([...model.patterns, ...model.byHand]).filter((n) => n.merged).flatMap((n) => n.ids));
        const next = listed.filter((n) => !n.section && !n.merged && n.included > 1 && !n.ids.some((id) => mergedIds.has(id)))
            .sort((a, b) => b.included - a.included)[0] || null;
        const shorter = next ? t.inReport - next.included + 1 : null;
        // Once merged, it says what the report is now.
        const now = t.merged
            ? `${plural(t.merged, 'group')} merged: the report shows ${plural(t.inReport, 'scan')} instead of ${t.included}.`
                + (next ? ` Merging ${esc(next.name)} too can shorten it to ${shorter}.` : '')
            : (next ? `Merging ${esc(next.name)} can shorten the report from ${plural(t.inReport, 'scan')} to ${shorter}.` : '');
        const sub = listed.length
            ? `${now ? `${now} ` : ''}Review the pages by their pictures to merge a template, take out the pages that differ and exclude what is noise.`
            : `Scans merged by the run can be shown as their contexts, and scans grouped by hand.${now ? ` ${now}` : ''}`;
        return `<section class="sr-card" aria-labelledby="sr-card-h">`
            + (stack ? `<span class="sr-stack" aria-hidden="true">${stack}</span>` : '')
            + `<span class="sr-card-text"><strong id="sr-card-h">${esc(headline)}</strong><span class="sr-card-sub">${sub}</span>`
            + (t.templates ? `<span class="sr-bar" role="img" aria-label="${esc(shown.map((n) => `${n.name}: ${n.count}`).join(', ') + `, in no template: ${others}`)}">${bar}</span><span class="sr-legend">${legend}</span>` : '')
            + `</span><button type="button" class="secondary-button sr-open" data-sr-open data-sr-focus="open">Review scans</button></section>`;
    }

    // -------------------------------------------------------------- the workspace

    function statsHTML(model, base) {
        const t = model.totals;
        const changed = base != null && t.inReport !== base;
        // Each count with its unit; the failures are counted as the impact
        // of a merge counts them, a rule failing on a scan once, so the two
        // agree. The run's merged scans count as merged, said apart.
        const merged = t.merged + t.runMerged;
        return `<span class="sr-stat${changed ? ' sr-stat--changed' : ''}">In the report <b>${t.inReport}</b> ${t.inReport === 1 ? 'scan' : 'scans'}</span>`
            + `<span class="sr-stat" title="Each rule a scan in the report fails, counted once per scan">Failures listed <b>${t.failures}</b></span>`
            // Who merged them, said apart: "303 by the run" alone read as
            // 303 scans merged into something.
            + `<span class="sr-stat">Merged <b>${merged}</b> ${merged === 1 ? 'scan' : 'scans'}${t.runMerged ? ` (${t.runMerged} by the run, ${t.merged} by you)` : ''}</span>`
            + `<span class="sr-stat">Excluded <b>${t.excluded}</b> ${t.excluded === 1 ? 'scan' : 'scans'}</span>`;
    }

    /**
     * The groups as a tree whose branches fold: a group with groups in it has
     * a button before it that shows or hides them (aria-expanded), and each
     * section of the list ("Templates found", "Merged by the run") folds the
     * same way. view: { collapsed: Set of the keys folded (a group's key, or
     * a section's: sec:templates, sec:byhand, sec:rest, sec:run) }. The
     * branch and section holding the selected group stay open whatever the set
     * says, so the selection is never folded out of sight.
     */
    function treeHTML(model, sel, view) {
        const collapsed = view && view.collapsed instanceof Set ? view.collapsed : new Set();
        const holds = (n) => n.key === sel || (n.children || []).some(holds);
        const domId = (key) => `sr-sub-${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}`;
        const chevron = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const nodeButton = (n) => `<button type="button" class="sr-node" data-sr-node="${esc(n.key)}" data-sr-focus="node:${esc(n.key)}" aria-current="${sel === n.key ? 'true' : 'false'}" title="${esc(n.pattern && n.pattern !== n.name ? `${n.name}: ${n.pattern}` : n.name)}">`
            // The pattern under a name given to it; an unnamed group is its
            // pattern, an address, in the code font.
            + `<span class="sr-node-label${isAddress(n) ? ' sr-url' : ''}">${esc(n.name)}${n.pattern && n.pattern !== n.name ? ` <span class="sr-node-pattern sr-url">${esc(n.pattern)}</span>` : (n.byHand ? ' <span class="sr-node-pattern">by hand</span>' : '')}</span>`
            + (n.merged ? ' <span class="sr-node-badge">merged</span>' : '')
            + ` <span class="sr-node-count">${n.ids.length}</span></button>`;
        const item = (n) => {
            const kids = n.children || [];
            if (!kids.length) return `<li class="sr-leaf">${nodeButton(n)}</li>`;
            const open = !collapsed.has(n.key) || kids.some(holds);
            return `<li class="sr-branch"><span class="sr-row">`
                + `<button type="button" class="sr-twisty" data-sr-toggle="${esc(n.key)}" data-sr-focus="toggle:${esc(n.key)}" aria-expanded="${open}" aria-controls="${domId(n.key)}" aria-label="${esc(`${open ? 'Hide' : 'Show'} the ${plural(kids.length, 'group')} in ${n.name}`)}">${chevron}</button>`
                + nodeButton(n) + `</span>`
                + `<ul id="${domId(n.key)}"${open ? '' : ' hidden'}>${kids.map(item).join('')}</ul></li>`;
        };
        // A section of the list, its heading a button that folds it.
        const section = (key, title, count, inner, holdsSel) => {
            const open = !collapsed.has(key) || holdsSel;
            return `<h3 class="sr-tree-h"><button type="button" class="sr-tree-toggle" data-sr-toggle="${key}" data-sr-focus="toggle:${key}" aria-expanded="${open}" aria-controls="${domId(key)}">`
                + `${chevron}<span>${esc(title)}</span> <span class="sr-tree-count">${count}</span></button></h3>`
                + `<div id="${domId(key)}"${open ? '' : ' hidden'}>${inner}</div>`;
        };
        let html = '';
        if (model.patterns.length) {
            html += section('sec:templates', 'Templates found', model.patterns.length, `<ul>${model.patterns.map(item).join('')}</ul>`, model.patterns.some(holds));
        } else {
            html += `<p class="sr-tree-none">The URLs of these scans repeat no pattern.</p>`;
        }
        if (model.byHand.length) html += section('sec:byhand', 'Grouped by hand', model.byHand.length, `<ul>${model.byHand.map(item).join('')}</ul>`, model.byHand.some(holds));
        html += section('sec:rest', 'The rest', model.rest.length, `<ul><li class="sr-leaf"><button type="button" class="sr-node" data-sr-node="${REST}" data-sr-focus="node:${REST}" aria-current="${sel === REST ? 'true' : 'false'}">`
            + `<span class="sr-node-label">In no group</span> <span class="sr-node-count">${model.rest.length}</span></button></li></ul>`, sel === REST);
        if (model.runMerges.length) {
            html += section('sec:run', 'Merged by the run', model.runMerges.length, `<ul>${model.runMerges.map((r) => `<li class="sr-leaf"><button type="button" class="sr-node" data-sr-node="${esc(r.key)}" data-sr-focus="node:${esc(r.key)}" aria-current="${sel === r.key ? 'true' : 'false'}">`
                + `<span class="sr-node-label">${esc(r.name)} <span class="sr-node-pattern">${esc(r.contexts.map((c) => c.name).join(' · '))}</span></span>`
                + ` <span class="sr-node-badge">${r.unmerged ? 'unmerged' : 'run'}</span></button></li>`).join('')}</ul>`, model.runMerges.some((r) => r.key === sel));
        }
        return html;
    }

    // Up to this many of the run's merged scans, their section starts open.
    const RUN_MERGES_OPEN = 8;

    /**
     * What the tree starts with folded: an overview, the top-level groups with
     * the ones directly in them, deeper groups folded; and the run's merged
     * scans' section when it is long, the templates being what the tree is
     * for. -> Set of keys, for treeHTML's view.collapsed.
     */
    function initiallyFolded(model) {
        const deeper = (nodes, depth) => nodes.flatMap((n) => [
            ...((n.children || []).length && depth >= 1 ? [n.key] : []),
            ...deeper(n.children || [], depth + 1),
        ]);
        return new Set([
            ...deeper([...(model.patterns || []), ...(model.byHand || [])], 0),
            ...((model.runMerges || []).length > RUN_MERGES_OPEN ? ['sec:run'] : []),
        ]);
    }

    // A group named by its URL pattern, not by a person.
    function isAddress(n) {
        return !n.byHand && (!n.pattern || n.pattern === n.name);
    }

    // What a tile says of its scan, each mark one short line. A page that
    // differs says so in its badge, not in an outline as well. Where most of
    // the group differs, nothing stands out (`standOut` false): its own
    // failures are counted plainly, and being built unlike the others, true
    // of most, is not said. A page of a merged group that is in the merged
    // scan says so, quietly.
    function badgesHTML(d, scan, takenOut, standOut, inMerged) {
        const own = d && d.own && d.own.length;
        const differs = standOut && !takenOut && (own || (d && d.unlike));
        const differsText = own ? `Differs · ${plural(own, 'own failure')}` : 'Differs · built otherwise';
        return [
            differs ? `<span class="sr-badge sr-badge--differs" title="${esc(differsText)}${d.unlike && own ? ', built unlike the others' : ''}">${esc(differsText)}</span>` : '',
            !differs && own ? `<span class="sr-badge">${plural(own, 'own failure')}</span>` : '',
            !isIncluded(scan) ? '<span class="sr-badge sr-badge--excluded">excluded</span>' : '',
            takenOut ? '<span class="sr-badge">taken out</span>' : '',
            inMerged && isIncluded(scan) && !takenOut ? '<span class="sr-badge sr-badge--merged">in the merged scan</span>' : '',
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
            const boxId = `sr-pick-${id}`;
            return `<li class="sr-tile${selected.has(id) ? ' sr-tile--selected' : ''}${isIncluded(s) ? '' : ' sr-tile--excluded'}">`
                + `<button type="button" class="sr-thumb" data-sr-preview="${esc(id)}" data-sr-focus="preview:${esc(id)}" aria-label="${esc(`See ${s.label || s.id} large`)}">${thumbHTML(s, thumbOf(s), { decorative: true })}</button>`
                + `<span class="sr-tile-body"><span class="sr-tile-top">`
                + (takenOut ? '' : `<input type="checkbox" id="${esc(boxId)}" data-sr-pick="${esc(id)}" data-sr-focus="pick:${esc(id)}"${selected.has(id) ? ' checked' : ''}>`)
                + `<label${takenOut ? '' : ` for="${esc(boxId)}"`} class="sr-tile-name" dir="auto" title="${esc(s.label || s.id)}">${esc(s.label || s.id)}</label></span>`
                + `<span class="sr-tile-path sr-url" title="${esc(pathOf(s.url))}">${esc(pathOf(s.url))}</span><span class="sr-badges">${badgesHTML(d, s, takenOut, standOut, group && node.merged)}</span>`
                + (takenOut ? `<button type="button" class="sr-link" data-sr-putback="${esc(id)}" data-sr-focus="putback:${esc(id)}">Put back</button>` : '')
                + `</span></li>`;
        };
        const title = node.rest ? 'In no group' : node.name;
        // The column says what it shows, above the group's name.
        let html = `<div class="sr-grid-head"><div class="sr-grid-title"><p class="sr-pane-label">Pages</p><h3 id="sr-grid-h"${!node.rest && !node.run && isAddress(node) ? ' class="sr-url"' : ''}>${esc(title)}</h3></div><span class="sr-grid-tools">`
            + (group ? `<label>Order <select data-sr-sort data-sr-focus="sort"><option value="differs"${v.sort !== 'report' ? ' selected' : ''}>Those that differ first</option><option value="report"${v.sort === 'report' ? ' selected' : ''}>As in the report</option></select></label>` : '')
            + (ids.length ? `<button type="button" class="secondary-button" data-sr-select-all data-sr-focus="select-all">${picked.length === ids.length ? 'Select none' : 'Select all'}</button>` : '')
            + `</span></div>`;
        if (group) {
            // Merged, the grid says what the report shows of these pages.
            const shownAs = node.mergedInto ? `, shown in the merged scan of ${esc(node.mergedInto)}`
                : node.merged ? ', shown as 1 merged scan in the report' : '';
            const alike = !differ ? `${shownAs}; alike.`
                : standOut ? `${shownAs}; <strong>${differ}</strong> ${differ === 1 ? 'differs' : 'differ'} from the others${v.sort !== 'report' ? ', first' : ''}.`
                : `${shownAs}, with little in common: most fail or are built in their own way. Its templates below it in the list may say more.`;
            html += `<p class="sr-note">${plural(ids.length, 'scan')}${alike} Select a picture to see it large.</p>`;
        }
        if (picked.length) {
            // One row: what applies to these pages, the rarer actions under
            // More, and a way out of the selection.
            const anyIn = picked.some((id) => isIncluded(model.byId.get(id)));
            const anyOut = picked.some((id) => !isIncluded(model.byId.get(id)));
            const canAdd = Array.isArray(v.targets) && v.targets.length > 0;
            html += `<div class="sr-selbar" role="group" aria-label="${esc(`${plural(picked.length, 'selected scan')}`)}"><strong>${picked.length} selected</strong>`
                + (anyIn ? '<button type="button" class="secondary-button" data-sr-bulk="exclude" data-sr-focus="bulk:exclude">Exclude</button>' : '')
                + (anyOut ? '<button type="button" class="secondary-button" data-sr-bulk="include" data-sr-focus="bulk:include">Include</button>' : '')
                + (group ? '<button type="button" class="secondary-button" data-sr-bulk="out" data-sr-focus="bulk:out">Take out of group</button>' : '')
                + `<span class="sr-more"><button type="button" class="secondary-button" data-sr-more data-sr-focus="more" aria-expanded="${v.moreOpen ? 'true' : 'false'}" aria-controls="sr-more-menu">More<span aria-hidden="true"> ▾</span></button>`
                + `<span class="sr-more-menu" id="sr-more-menu"${v.moreOpen ? '' : ' hidden'}>`
                + '<button type="button" data-sr-bulk="byhand" data-sr-focus="bulk:byhand">Group by hand…</button>'
                // Into another group, merged or not, whatever its pattern.
                + (canAdd ? '<button type="button" data-sr-bulk="add" data-sr-focus="bulk:add">Add to group…</button>' : '')
                + '</span></span>'
                + '<button type="button" class="sr-link sr-clear" data-sr-bulk="clear" data-sr-focus="bulk:clear">Clear selection</button>'
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
            + ` <span class="sr-fails-on">${r.scans.length} of ${plural(total, "page")}${fixOnce ? '<small><span class="visually-hidden"> · </span>fix once</small>' : ''}</span></li>`).join('')}</ul>`;
    }

    /**
     * Merging, or unmerging: what is shown now, in words, and a button that
     * says what it covers and opens what it would change (`impact`), to apply
     * or cancel. Nothing changes before Apply. `key` is a group's or a run's
     * merged scan's ('run:<id>'); `state`, `button` and `apply` its words.
     */
    function mergeBoxHTML({ key, state, note, button, apply, impact, open, outcome }) {
        return `<div class="sr-box sr-merge"><p class="sr-merge-state">${state}</p>`
            + (note ? `<p class="sr-note">${note}</p>` : '')
            // The group's main action, until it is open: then Apply is.
            + (button ? `<button type="button" class="secondary-button${open ? '' : ' sr-primary'}" data-sr-merge="${esc(key)}" data-sr-focus="merge" aria-expanded="${open ? 'true' : 'false'}" aria-controls="sr-impact">${esc(button)}</button>` : '')
            + (impact && open ? `<div class="sr-impact" id="sr-impact" role="group" aria-labelledby="sr-impact-h"><h4 class="sr-sub" id="sr-impact-h">What it changes</h4>`
                + `<p class="sr-impact-row"><span>Scans in the report</span> <span><b>${impact.scans[0]}</b> → <b>${impact.scans[1]}</b></span></p>`
                + `<p class="sr-impact-row"><span>Failures listed</span> <span><b>${impact.failures[0]}</b> → <b>${impact.failures[1]}</b></span></p>`
                + (outcome ? `<p class="sr-note">${outcome}</p>` : '')
                + `<span class="sr-actions"><button type="button" class="secondary-button sr-primary" data-sr-apply-merge="${esc(key)}" data-sr-focus="apply-merge">${esc(apply)}</button>`
                + `<button type="button" class="secondary-button" data-sr-cancel-merge data-sr-focus="cancel-merge">Cancel</button></span></div>` : '')
            + `</div>`;
    }

    /**
     * The right of the workspace: the group's name, merging with what it
     * changes, its actions, and its failures. view: { issues, impact ({ scans:
     * [now, then], failures: [now, then] } of merging or unmerging),
     * impactOpen, focus (the key shown alone, or null) }.
     */
    function detailHTML(model, node, view) {
        const v = view || {};
        if (node.run) {
            const stay = node.contexts.filter((x) => x.kept && !x.out).length;
            const merge = !node.kept
                ? '<p class="sr-note">This report did not keep its contexts\' own scans (the run did not keep them, or the lab that saved it did not yet), so it can only be shown merged.</p>'
                : mergeBoxHTML({
                    key: node.key,
                    state: node.unmerged
                        ? `<strong>Not merged</strong> · Each of its ${plural(node.contexts.length, 'context')} is a scan of its own`
                        : `<strong>Merged by the run</strong> · Shown as 1 scan in the report · ${plural(stay, 'context')}`,
                    button: node.unmerged ? 'Merge again…' : 'Unmerge…',
                    apply: node.unmerged ? 'Merge again' : `Unmerge into ${plural(stay, 'scan')}`,
                    impact: v.impact,
                    open: v.impactOpen,
                    outcome: node.unmerged ? 'Its contexts are shown as one scan again, as the run made it.' : 'Each context is shown as a scan of its own, named by its context.',
                });
            const contexts = node.kept && !node.unmerged ? `<div class="sr-box"><h4 class="sr-sub">Its contexts</h4><ul class="sr-fails">${node.contexts.map((c) => {
                const kind = c.out ? 'run-back' : 'run-out';
                const text = c.out ? 'Put back' : 'Take out';
                const button = !c.kept || (!c.out && stay < 2) ? '' : `<button type="button" class="secondary-button" data-sr-${kind}="${esc(node.id)}" data-sr-context="${c.index}" data-sr-focus="${kind}:${esc(node.id)}:${c.index}" aria-label="${esc(`${text} ${c.name}`)}">${text}</button>`;
                return `<li><span>${esc(c.name)}${c.out ? ' <span class="sr-badge">taken out</span>' : ''}</span>${button}</li>`;
            }).join('')}</ul></div>` : '';
            return `<h3>${esc(node.name)}</h3><p class="sr-note">Merged by the run from ${plural(node.contexts.length, 'context')}: each failure says which contexts it is in.</p>${merge}${contexts}`;
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
        const contentPages = issues ? new Set(issues.content.flatMap((r) => r.scans)).size : 0;
        const nameId = 'sr-name';
        const hintId = 'sr-name-hint';
        const pages = node.included;
        const excluded = total - pages;
        // Merged, what the report shows of it; not merged, what merging does.
        const state = node.mergedInto
            ? `<strong>Merged</strong> · Shown in the merged scan of ${esc(node.mergedInto)}, the larger merged group it is in`
            : node.merged
                ? `<strong>Merged</strong> · Shown as 1 scan in the report · ${plural(pages, 'page')}${excluded ? `, ${excluded} excluded left out` : ''}`
                : '<strong>Not merged</strong> · Each page is a scan of its own in the report';
        const merge = mergeBoxHTML({
            key: node.key,
            state,
            note: node.merged ? '' : 'Merged, a failure of the template is listed once, on all its pages; a page\'s own failure stays on that page. It can be undone.',
            button: node.merged ? 'Unmerge…' : (excluded ? `Merge its ${pages} included pages…` : `Merge all ${plural(total, 'page')}…`),
            apply: node.merged ? 'Unmerge' : `Merge ${plural(pages, 'page')}`,
            impact: v.impact,
            open: v.impactOpen,
            outcome: node.merged ? 'Unmerging shows each page again.' : (contentPages
                ? `What the template fails is listed once; what ${plural(contentPages, 'page')} ${contentPages === 1 ? 'fails' : 'fail'} on ${contentPages === 1 ? 'its' : 'their'} own stays on ${contentPages === 1 ? 'it' : 'them'}.`
                : 'What the template fails is listed once.'),
        });
        return `<h3${isAddress(node) ? ' class="sr-url"' : ''}>${esc(node.name)}</h3>`
            // Its pattern under a name given or suggested; not again under the pattern.
            + `<p class="sr-note">${node.byHand ? 'Grouped by hand · ' : (isAddress(node) ? '' : `<span class="sr-url">${esc(node.pattern)}</span> · `)}${plural(total, 'scan')}, ${node.included} included</p>`
            // The name suggested from the titles shows in the empty field,
            // and is said under it, as a placeholder alone is not read out
            // by every screen reader.
            + `<p class="sr-field"><label for="${nameId}">Name</label><input type="text" id="${nameId}" data-sr-name="${esc(node.key)}" data-sr-focus="name" value="${esc(node.entry && node.entry.name ? node.entry.name : '')}"`
            + `${node.suggested ? ` placeholder="${esc(node.suggested)}" aria-describedby="${hintId}"` : ''} maxlength="200" autocomplete="off">`
            + (node.suggested ? `<small id="${hintId}" class="sr-hint">${node.entry && node.entry.name ? `Suggested from the pages' titles: ${esc(node.suggested)}.` : 'Suggested from the pages\' titles; type a name of your own to replace it.'}</small>` : '')
            + `</p>`
            + merge
            // What to do with its pages, right under merging.
            + `<div class="sr-box"><h4 class="sr-sub">Its pages</h4><span class="sr-actions sr-actions--stack">`
            + `<button type="button" class="secondary-button" data-sr-act="keepOne" data-sr-focus="act:keepOne">Keep one page, exclude the rest…</button></span>`
            + `<span class="sr-actions"><button type="button" class="secondary-button" data-sr-act="exclude" data-sr-focus="act:exclude">Exclude all</button>`
            + `<button type="button" class="secondary-button" data-sr-act="include" data-sr-focus="act:include">Include all</button>`
            + `<button type="button" class="secondary-button" data-sr-act="focus" data-sr-focus="act:focus">${v.focus === node.key ? 'Show every scan' : 'Show only these'}</button>`
            + (node.byHand ? `<button type="button" class="secondary-button" data-sr-act="remove" data-sr-focus="act:remove">Remove group</button>` : '')
            + `</span></div>`
            // A failure is the template's when the same element fails on most
            // pages; one on other elements, page by page, is their content's,
            // however many pages have one (a rule can fail on every page, on
            // a different element on each).
            + (issues ? `<div class="sr-box"><h4 class="sr-sub">The same element on most pages: the template's</h4>`
                + (issues.template.length ? ruleListHTML(issues.template, issues.scansTotal, true) : '<p class="sr-note">No element fails on most pages.</p>')
                + `<h4 class="sr-sub">Elements of each page's own</h4>`
                + (issues.content.length ? ruleListHTML(issues.content, issues.scansTotal, false) : '<p class="sr-note">No page fails on an element of its own.</p>')
                + `</div>` : '');
    }

    /**
     * A scan seen large (from the grid or the report): its picture, the
     * template's failures it shares, those only it has (and those it shares
     * with a few pages), and the template's failures it lacks. d: groupIssues
     * byScan entry, or null; opts.issues: the group's groupIssues, read rule
     * by rule, so a rule both of the template and of the page's own content
     * is in both lists.
     */
    function previewHTML(scan, url, d, opts) {
        const o = opts || {};
        const issues = o.issues && Array.isArray(o.issues.template) ? o.issues : null;
        const fails = (scan.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [])
            .filter((f) => f && f.outcome === 'fail');
        const li = (title, extra) => `<li><span>${esc(title)}</span>${extra ? ` <span class="sr-fails-on">${esc(extra)}</span>` : ''}</li>`;
        const list = (rules, extra, none) => `<ul class="sr-fails">${rules.map((r) => li(r.title || r.ruleId, extra(r))).join('') || `<li>${none}</li>`}</ul>`;
        let text;
        if (d) {
            const on = (r) => Array.isArray(r.scans) && r.scans.includes(scan.id);
            const own = d.own || [];
            const ownIds = new Set(own.map((r) => r.ruleId));
            const shares = issues ? issues.template.filter(on) : fails.filter((f) => !ownIds.has(f.ruleId || f.id));
            const lacks = issues ? issues.template.filter((r) => !on(r)) : (d.missing || []);
            const content = issues ? issues.content.filter(on) : own.map((r) => ({ ...r, scans: [scan.id] }));
            const only = content.filter((r) => r.scans.length === 1);
            const few = content.filter((r) => r.scans.length > 1);
            text = `<h4 class="sr-sub">Shares with the template</h4>${list(shares, (r) => r.severity, 'Nothing')}`
                + `<h4 class="sr-sub">Only on this page</h4>${list(only, (r) => r.severity, few.length ? 'Nothing' : 'Nothing: it is like the others')}`
                + (few.length ? `<h4 class="sr-sub">On this page and a few others</h4>${list(few, (r) => `${r.severity} · on ${r.scans.length} pages`, 'Nothing')}` : '')
                + (lacks.length ? `<h4 class="sr-sub">The template's failures it lacks</h4>${list(lacks, (r) => r.severity, 'Nothing')}` : '')
                + (d.unlike ? '<p class="sr-note">It is built unlike the others: it may be another template, to take out of this group.</p>' : '');
        } else {
            text = `<h4 class="sr-sub">Fails</h4>${list(fails, (f) => f.severity, 'Nothing')}`;
        }
        return `<div class="sr-preview-pic">${url ? `<img src="${esc(url)}" alt="${esc(`Screenshot of ${scan.label || scan.id}`)}">` : thumbHTML(scan, null)}`
            + `<p class="sr-mono sr-note">${esc(scan.url || '')}</p></div>`
            + `<div class="sr-preview-text">${text}`
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
        initiallyFolded,
        gridHTML,
        detailHTML,
        previewHTML,
        thumbHTML,
        pathOf,
        suggestName,
        suggestNames,
    };
}));
