'use strict';

// The words for scan groups (docs/design/scan-grouping-design.md §6, §10 steps
// 2 and 3): the "Scan groups" section under a run's scans list, as an HTML
// string built from a findGroups result (scan-groups.js) and the groups the
// person chose (scan-group-choice.js).
//
// Two parts. "Patterns found": every group the sources see, nested, each with
// a checkbox to group by it. "Your groups": the chosen ones, each scan under
// the narrowest chosen group holding it, with a name to give and the actions
// that include or exclude a group's scans.
//
// It knows nothing about how groups are found: a group is shown by its label,
// its members and, when its source gave one, the host and number of distinct
// URLs in its evidence. The controls carry data attributes the app listens to
// (data-sg-choose, data-sg-name, data-sg-action) and a data-sg-focus key, so
// focus can come back to the same control after a redraw.
//
// Browser: available as globalThis.A11Y_SCAN_GROUPS_VIEW.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./scan-groups.js'));
    } else {
        if (!root.A11Y_SCAN_GROUPS) {
            throw new Error('scan-groups-view.js: load scan-groups.js before this file');
        }
        root.A11Y_SCAN_GROUPS_VIEW = factory(root.A11Y_SCAN_GROUPS);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (grouping) {

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

    const isIncluded = (scan) => !scan || scan.includedInReport !== false;

    // The open state of a chosen group is kept apart from the same pattern's
    // list of scans among the patterns found.
    const CHOSEN_PREFIX = 'chosen:';
    const NOT_GROUPED = 'not-grouped';
    const NOT_CHOSEN = 'not-in-your-groups';

    function hostOf(group) {
        const host = group && group.evidence && group.evidence.host;
        return typeof host === 'string' && host ? host : null;
    }

    // "487 scans · 480 URLs · 480 of 487 included", what a group is read by.
    function countsText(group, scansById) {
        const parts = [plural(group.size, 'scan')];
        const urls = group.evidence && group.evidence.urls;
        if (Number.isFinite(urls) && urls !== group.size) parts.push(plural(urls, 'URL'));
        const included = group.members.filter((id) => isIncluded(scansById.get(id))).length;
        parts.push(included === group.size
            ? (group.size === 2 ? 'both included' : 'all included')
            : included === 0 ? 'none included' : `${included} of ${group.size} included`);
        return parts.join(' · ');
    }

    function memberItemHTML(id, scansById) {
        const scan = scansById.get(id) || {};
        const label = scan.label || scan.id || id;
        const url = typeof scan.url === 'string' ? scan.url : '';
        return `<li class="${isIncluded(scan) ? '' : 'scan-summary-excluded'}">`
            + `<a href="#sc-${esc(id)}">${esc(label)}</a>`
            + (isIncluded(scan) ? '' : ' <span class="scan-excluded-badge">Excluded</span>')
            + (url && url !== label ? ` <span class="sg-url">${esc(url)}</span>` : '')
            + `</li>`;
    }

    function membersHTML(ids, scansById, caption) {
        if (!ids.length) return '';
        return (caption ? `<p class="sg-caption">${esc(caption)}</p>` : '')
            + `<ul class="sg-members">${ids.map((id) => memberItemHTML(id, scansById)).join('')}</ul>`;
    }

    function openAttr(ctx, key) {
        return ctx.openKeys.has(key) ? ' open' : '';
    }

    function listDetailsHTML(key, summaryHTML, bodyHTML, ctx, extraClass) {
        return `<details class="sg-group${extraClass ? ` ${extraClass}` : ''}" data-sg-key="${esc(key)}"${openAttr(ctx, key)}>`
            + `<summary>${summaryHTML}</summary>${bodyHTML}</details>`;
    }

    // ------------------------------------------------------- patterns found

    function patternHTML(group, ctx) {
        const host = ctx.showHosts ? hostOf(group) : null;
        const id = `sg-choose-${ctx.nextId++}`;
        const chosen = ctx.chosenKeys.has(group.key);
        const counts = countsText(group, ctx.scansById);

        let scansBody;
        if (group.children.length) {
            // Its scans no smaller pattern holds, so each scan is listed once,
            // under the pattern that says most about it.
            const inChildren = new Set(group.children.flatMap((g) => g.members));
            const own = group.members.filter((m) => !inChildren.has(m));
            scansBody = own.length
                ? membersHTML(own, ctx.scansById, `${plural(own.length, 'scan')} in no narrower pattern:`)
                : `<p class="sg-caption">Every scan of it is in a narrower pattern below.</p>`;
        } else {
            scansBody = membersHTML(group.members, ctx.scansById, '');
        }

        return `<li class="sg-pattern">`
            + `<span class="sg-choose">`
            + `<input type="checkbox" id="${id}" data-sg-choose="${esc(group.key)}" data-sg-focus="choose:${esc(group.key)}"${chosen ? ' checked' : ''}>`
            + ` <label for="${id}"><span class="sg-label">${esc(group.label)}</span>`
            + (host ? ` <span class="sg-host">on ${esc(host)}</span>` : '')
            + `</label> <span class="sg-counts">${esc(counts)}</span></span>`
            + listDetailsHTML(group.key, `Scans<span class="visually-hidden"> of ${esc(group.label)}</span>`, scansBody, ctx, 'sg-scans')
            + (group.children.length
                ? `<ul class="sg-tree">${group.children.map((g) => patternHTML(g, ctx)).join('')}</ul>`
                : '')
            + `</li>`;
    }

    // ---------------------------------------------------------- your groups

    // A group with its scans as the person left them (§9.2): its count is
    // of those, and its distinct URLs are no longer the pattern's to tell.
    function withEditedMembers(group, entry) {
        if (!entry || (!entry.add && !entry.remove)) return group;
        const removed = new Set(entry.remove || []);
        const members = group.members.filter((id) => !removed.has(id));
        for (const id of entry.add || []) if (!members.includes(id)) members.push(id);
        return { ...group, members, size: members.length, evidence: null };
    }

    // Scans named by label, three at most, the rest counted.
    function scanNames(ids, scansById) {
        const names = ids.map((id) => {
            const s = scansById.get(id);
            return (s && (s.label || s.id)) || id;
        });
        return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
    }

    // What a group's scans fail together and apart (§10 step 6): the
    // template's failures, on most scans, and their content's, on a few.
    function issuesHTML(key, issues, ctx) {
        if (!issues) return '';
        const k = `issues:${key}`;
        const t = issues.template.length;
        const c = issues.content.length;
        const summary = !t && !c
            ? 'What its scans fail: <span class="sg-counts">nothing</span>'
            : `What its scans fail: <span class="sg-counts">${esc([
                t ? `${plural(t, 'rule')} on most scans` : '',
                c ? `${plural(c, 'rule')} on some` : '',
            ].filter(Boolean).join(', '))}</span>`;
        const rule = (e, where) => `<li><span class="sg-rule">${esc(e.title)}</span> `
            + `<span class="sg-url">${esc(`${e.ruleId} · ${e.severity} · ${plural(e.elements, 'element')}${where ? ` · ${where}` : ''}`)}</span></li>`;
        const body = (t
            ? `<p class="sg-caption">On most scans, so the template's, fixed once for all of them:</p>`
                + `<ul class="sg-members">${issues.template.map((e) => rule(e, '')).join('')}</ul>`
            : '<p class="sg-caption">Nothing fails on most scans.</p>')
            + (c
                ? `<p class="sg-caption">On a few scans, so their own content's, which excluding them hides:</p>`
                    + `<ul class="sg-members">${issues.content.map((e) => rule(e,
                        `on ${e.scans.length} of ${issues.scansTotal}: ${scanNames(e.scans, ctx.scansById)}`)).join('')}</ul>`
                : '<p class="sg-caption">Nothing fails on some scans only.</p>');
        return `<details class="sg-group sg-issues" data-sg-key="${esc(k)}"${openAttr(ctx, k)}>`
            + `<summary>${summary}</summary>${body}</details>`;
    }

    function chosenHTML(node, ctx) {
        const key = node.key;
        const name = ctx.names.get(key) || null;
        const shown = name || node.label;
        const host = ctx.showHosts ? hostOf(node.group) : null;
        const summary = `<span class="${name ? 'sg-name' : 'sg-label'}">${esc(shown)}</span>`
            // The pattern beside its name; a group by hand has none to show.
            + (name && node.group.source !== 'manual' ? ` <span class="sg-label sg-pattern-of">${esc(node.label)}</span>` : '')
            + (host ? ` <span class="sg-host">on ${esc(host)}</span>` : '')
            + ` <span class="sg-counts">${esc(countsText(withEditedMembers(node.group, ctx.entries.get(key)), ctx.scansById))}</span>`;

        const nameId = `sg-name-${ctx.nextId++}`;
        const mergeId = `sg-merge-${ctx.nextId++}`;
        const merged = ctx.mergedKeys.has(key);
        // Merged into a larger merged group, it shows as part of that one
        // (docs/design/scan-grouping-design.md §9.4); its switch stays, for
        // when that one is unmerged.
        const into = ctx.mergedInto(node);
        const controls = `<div class="sg-controls">`
            + `<span class="sg-name-field"><label for="${nameId}">Name</label> `
            + `<input type="text" id="${nameId}" data-sg-name="${esc(key)}" data-sg-focus="name:${esc(key)}"`
            + ` value="${esc(name || '')}" maxlength="${ctx.maxName}" autocomplete="off"></span>`
            + `<span class="sg-actions" role="group" aria-label="${esc(`Scans of ${shown}`)}">`
            + [['include', 'Include all'], ['exclude', 'Exclude all'], ['keepOne', 'Keep one']].map(([action, text]) =>
                `<button type="button" class="secondary-button" data-sg-action="${action}" data-sg-group="${esc(key)}"`
                + ` data-sg-focus="${action}:${esc(key)}">${text}</button>`).join('')
            + `</span>`
            + `<span class="sg-merge"><input type="checkbox" id="${mergeId}" data-sg-merge="${esc(key)}" data-sg-focus="merge:${esc(key)}"${merged ? ' checked' : ''}>`
            + ` <label for="${mergeId}">Merge into one scan</label></span>`
            // A group by hand has no pattern to unchoose: it is removed here.
            + (node.group.source === 'manual'
                ? `<button type="button" class="secondary-button" data-sg-delete="${esc(key)}" data-sg-focus="delete:${esc(key)}"`
                    + ` aria-label="${esc(`Remove the group ${shown}`)}">Remove group</button>`
                : '')
            + `</div>`
            + (into ? `<p class="sg-caption sg-merged-into">Shown merged into ${esc(into)}, the larger merged group it is in.</p>` : '')
            + issuesHTML(key, ctx.issuesOf(node.group), ctx);

        const children = node.children.length
            ? `<ul class="sg-tree">${node.children.map((c) => `<li>${chosenHTML(c, ctx)}</li>`).join('')}</ul>`
            : '';
        // A merged group lists its scans as the person left them, each to
        // take out, and the scans to add (§9.2); another lists its own.
        const own = merged
            ? editableMembersHTML(node, ctx)
            : membersHTML(node.own, ctx.scansById, node.children.length && node.own.length
                ? `${plural(node.own.length, 'scan')} in no narrower group you chose:` : '');

        const k = CHOSEN_PREFIX + key;
        return `<details class="sg-group sg-chosen" data-sg-key="${esc(k)}"${openAttr(ctx, k)}>`
            + `<summary>${summary}</summary>${controls}${children}${own}</details>`;
    }

    // A merged group's scans as the person left them (§9.2): the pattern's
    // without those taken out, with those added, each with Take out; those
    // taken out, each with Put back; and a scan of the run to add.
    function editableMembersHTML(node, ctx) {
        const key = node.key;
        const entry = ctx.entries.get(key) || {};
        const byHand = Array.isArray(entry.members);
        const removed = byHand ? [] : (entry.remove || []).filter((id) => ctx.scansById.has(id));
        const added = new Set(byHand ? [] : entry.add || []);
        const position = new Map(ctx.scanOrder.map((id, i) => [id, i]));
        const inGroup = new Set(byHand ? entry.members : node.members.filter((id) => !removed.includes(id)));
        for (const id of added) inGroup.add(id);
        const members = [...inGroup].filter((id) => position.has(id)).sort((a, b) => position.get(a) - position.get(b));
        const shown = ctx.names.get(key) || node.label;

        const button = (kind, id, text, scanLabel) => `<button type="button" class="secondary-button sg-scan-btn" data-sg-${kind}="${esc(key)}"`
            + ` data-sg-scan="${esc(id)}" data-sg-focus="${kind}:${esc(key)}:${esc(id)}"`
            + ` aria-label="${esc(`${text} ${scanLabel}`)}">${text}</button>`;
        const labelOf = (id) => {
            const sc = ctx.scansById.get(id);
            return (sc && (sc.label || sc.id)) || id;
        };
        const item = (id, kind, text) => {
            const sc = ctx.scansById.get(id) || {};
            const included = !sc || sc.includedInReport !== false;
            return `<li class="${included ? '' : 'scan-summary-excluded'}">`
                + `<a href="#sc-${esc(id)}">${esc(labelOf(id))}</a>`
                + (included ? '' : ' <span class="scan-excluded-badge">Excluded</span>')
                + (added.has(id) ? ' <span class="sg-host">added by hand</span>' : '')
                + (typeof sc.url === 'string' && sc.url !== labelOf(id) ? ` <span class="sg-url">${esc(sc.url)}</span>` : '')
                + ` ${button(kind, id, text, labelOf(id))}</li>`;
        };

        let html = `<ul class="sg-members">${members.map((id) => item(id, 'take-out', 'Take out')).join('')}</ul>`;
        if (removed.length) {
            html += `<p class="sg-caption">Taken out by hand, shown on their own:</p>`
                + `<ul class="sg-members">${removed.map((id) => item(id, 'put-back', 'Put back')).join('')}</ul>`;
        }
        const others = ctx.scanOrder.filter((id) => !inGroup.has(id) && !removed.includes(id));
        if (others.length) {
            const selectId = `sg-add-${ctx.nextId++}`;
            html += `<p class="sg-add"><label for="${selectId}">Add a scan to ${esc(shown)}</label> `
                + `<select id="${selectId}" data-sg-add-select="${esc(key)}" data-sg-focus="add-select:${esc(key)}">`
                + `<option value="">Choose a scan</option>`
                + others.map((id) => `<option value="${esc(id)}">${esc(labelOf(id))}</option>`).join('')
                + `</select> <button type="button" class="secondary-button" data-sg-add="${esc(key)}" data-sg-focus="add:${esc(key)}">Add</button></p>`;
        }
        return html;
    }

    // What the run merged (§8): each merged scan of a Merged scan step, to
    // show as its contexts or to take a context out of. A report saved
    // before the run kept its contexts' scans says why it cannot.
    function runMergesHTML(list, ctx) {
        const merged = list.filter((sc) => sc.mergedScan === true && Array.isArray(sc.contexts) && sc.contexts.length);
        if (!merged.length) return '';
        const items = merged.map((sc) => {
            const entry = ctx.entries.get(`run:${sc.id}`) || {};
            const kept = sc.contexts.map((c, i) => ({ c, i })).filter(({ c }) => c && c.scan);
            const out = new Set(entry.remove || []);
            const unmerged = entry.merge === false;
            const k = `run:${sc.id}`;
            const counts = [plural(sc.contexts.length, 'context'),
                unmerged ? 'shown each on its own' : (out.size ? `${out.size} taken out` : 'merged as the run made it')];
            let body;
            if (!kept.length) {
                body = '<p class="sg-caption">This report did not keep its contexts\' own scans: the lab that saved it did not yet, '
                    + 'so it can only be shown merged.</p>';
            } else {
                const switchId = `sg-run-${ctx.nextId++}`;
                body = `<div class="sg-controls"><span class="sg-merge"><input type="checkbox" id="${switchId}" data-sg-run-merge="${esc(sc.id)}"`
                    + ` data-sg-focus="run-merge:${esc(sc.id)}"${unmerged ? '' : ' checked'}> <label for="${switchId}">Merged into one scan</label></span></div>`;
                if (unmerged) {
                    body += `<p class="sg-caption">Shown as its ${plural(kept.length, 'context')}, each a scan of its own in the list above.</p>`;
                } else {
                    const stay = kept.filter(({ i }) => !out.has(String(i))).length;
                    body += `<ul class="sg-members">${kept.map(({ c, i }) => {
                        const isOut = out.has(String(i));
                        const kind = isOut ? 'run-back' : 'run-out';
                        const text = isOut ? 'Put back' : 'Take out';
                        // The last context left stays: a merged scan of none is unmerged.
                        const button = !isOut && stay < 2 ? '' : ` <button type="button" class="secondary-button sg-scan-btn" data-sg-${kind}="${esc(sc.id)}"`
                            + ` data-sg-context="${i}" data-sg-focus="${kind}:${esc(sc.id)}:${i}" aria-label="${esc(`${text} ${c.name}`)}">${text}</button>`;
                        return `<li>${esc(c.name)}${isOut ? ' <span class="sg-host">taken out, shown on its own</span>' : ''}${button}</li>`;
                    }).join('')}</ul>`;
                }
            }
            return `<li><details class="sg-group sg-run" data-sg-key="${esc(k)}"${openAttr(ctx, k)}>`
                + `<summary><span class="sg-name">${esc(sc.label || sc.id)}</span> <span class="sg-counts">${esc(counts.join(' · '))}</span></summary>`
                + body + `</details></li>`;
        }).join('');
        return `<section class="sg-part" aria-labelledby="sg-run-h">`
            + `<h4 class="sg-h" id="sg-run-h">Merged by the run</h4>`
            + `<p class="sg-intro">Scans a Merged scan step made of one view in several contexts (a theme, a width). `
            + 'Each can be shown as its contexts, each a scan of its own, or have a context taken out of it.</p>'
            + `<ul class="sg-tree sg-roots">${items}</ul></section>`;
    }

    // Scans grouped by hand (§9.2): a name, the scans, and whether to merge
    // them, for groups no URL pattern finds.
    function manualFormHTML(list, ctx) {
        const k = 'group-by-hand';
        const nameId = `sg-new-name-${ctx.nextId++}`;
        const mergeId = `sg-new-merge-${ctx.nextId++}`;
        const items = list.map((sc) => {
            const id = `sg-new-${ctx.nextId++}`;
            return `<li><input type="checkbox" id="${id}" data-sg-new-member="${esc(sc.id)}" data-sg-focus="new-member:${esc(sc.id)}">`
                + ` <label for="${id}">${esc(sc.label || sc.id)}</label>`
                + (typeof sc.url === 'string' && sc.url ? ` <span class="sg-url">${esc(sc.url)}</span>` : '')
                + `</li>`;
        }).join('');
        return `<details class="sg-group sg-by-hand" data-sg-key="${k}"${openAttr(ctx, k)}>`
            + `<summary>Group scans by hand</summary>`
            + `<p class="sg-caption">For scans no pattern finds together: the template at other addresses, the pages of one flow. `
            + 'Choose two scans or more.</p>'
            + `<div class="sg-controls"><span class="sg-name-field"><label for="${nameId}">Name</label> `
            + `<input type="text" id="${nameId}" data-sg-new-name data-sg-focus="new-name" maxlength="${ctx.maxName}" autocomplete="off"></span>`
            + `<span class="sg-merge"><input type="checkbox" id="${mergeId}" data-sg-new-merge data-sg-focus="new-merge" checked>`
            + ` <label for="${mergeId}">Merge them into one scan</label></span></div>`
            + `<fieldset class="sg-pick"><legend>Scans</legend><ul class="sg-members">${items}</ul></fieldset>`
            + `<button type="button" class="secondary-button" data-sg-new-group data-sg-focus="new-group">Make the group</button>`
            + `</details>`;
    }

    // ------------------------------------------------------------- section

    /**
     * The "Scan groups" section for a run's scans.
     * - result: what findGroups returned for these scans;
     * - scans: the run's scans, all of them (an excluded scan is still part
     *   of its group, shown as excluded);
     * - opts.choice: the chosen groups, [{ key, name }] (readChoice); keys the
     *   result does not have are ignored;
     * - opts.open: the section starts open; opts.openKeys: the data-sg-key of
     *   the groups to start open (those open before the summary was redrawn);
     * - opts.issuesOf(group): what a chosen group's scans fail together and
     *   apart (scan-group-merge.js groupIssues), or null.
     * Empty for fewer than two scans, unless the run merged one: there is
     * nothing to group, nor to unmerge.
     */
    function sectionHTML(result, scans, opts) {
        const o = opts || {};
        const list = Array.isArray(scans) ? scans.filter(Boolean) : [];
        // Nothing to group in one scan, unless the run merged it from contexts.
        const runMerged = list.some((sc) => sc.mergedScan === true && Array.isArray(sc.contexts) && sc.contexts.length);
        if ((list.length < 2 && !runMerged) || !result) return '';
        const scansById = new Map(list.map((s) => [s.id, s]));
        const groups = Array.isArray(result.groups) ? result.groups : [];
        const choice = Array.isArray(o.choice) ? o.choice.filter((p) => p && typeof p.key === 'string') : [];
        const hosts = new Set(groups.map(hostOf).filter(Boolean));
        const ctx = {
            scansById,
            openKeys: o.openKeys instanceof Set ? o.openKeys : new Set(o.openKeys || []),
            showHosts: hosts.size > 1,
            chosenKeys: new Set(choice.map((p) => p.key)),
            names: new Map(choice.filter((p) => p.name).map((p) => [p.key, p.name])),
            mergedKeys: new Set(choice.filter((p) => p.merge === true).map((p) => p.key)),
            mergedInto: () => null,
            entries: new Map(),
            issuesOf: typeof o.issuesOf === 'function' ? o.issuesOf : () => null,
            maxName: Number.isFinite(o.maxName) ? o.maxName : 200,
            nextId: 0,
        };

        // Groups by hand are the person's, not patterns the URLs repeat: they
        // show under Your groups, and the patterns found are the others.
        const withoutManual = (level) => level.flatMap((g) => (g.source === 'manual'
            ? withoutManual(g.children)
            : [{ ...g, children: withoutManual(g.children) }]));
        const patterns = withoutManual(groups);
        const inPatterns = new Set(grouping.flattenGroups(patterns).flatMap((g) => g.members));
        const noPattern = list.map((sc) => sc.id).filter((id) => !inPatterns.has(id));
        ctx.entries = new Map(choice.map((p) => [p.key, p]));
        ctx.scanOrder = list.map((sc) => sc.id);

        let body = '';
        const chosen = grouping.chooseGroups(result, choice.map((p) => p.key));
        // The nearest merged group above a chosen one, by name, if any.
        const byKey = new Map(grouping.flattenGroups(groups).map((g) => [g.key, g]));
        ctx.mergedInto = (node) => {
            let up = node.group.parentKey ? byKey.get(node.group.parentKey) : null;
            let found = null;
            while (up) {
                if (ctx.mergedKeys.has(up.key)) found = up;
                up = up.parentKey ? byKey.get(up.parentKey) : null;
            }
            return found ? (ctx.names.get(found.key) || found.label) : null;
        };
        if (chosen.groups.length) {
            body += `<section class="sg-part" aria-labelledby="sg-yours-h">`
                + `<h4 class="sg-h" id="sg-yours-h">Your groups</h4>`
                + `<p class="sg-intro">Each scan is listed under the narrowest group you chose that holds it. `
                + 'Include all, Exclude all and Keep one act on every scan of a group, those of the groups inside it too; '
                + 'Keep one leaves the first included scan in the report and takes the rest out. '
                + 'A merged group\'s scans can be taken out of it, and other scans added.</p>'
                + `<ul class="sg-tree sg-roots">${chosen.groups.map((n) => `<li>${chosenHTML(n, ctx)}</li>`).join('')}</ul>`
                + (chosen.ungrouped.length
                    ? listDetailsHTML(NOT_CHOSEN,
                        `<span class="sg-label sg-plain">Not in your groups</span> <span class="sg-counts">${esc(plural(chosen.ungrouped.length, 'scan'))}</span>`,
                        membersHTML(chosen.ungrouped, scansById, ''), ctx, 'sg-ungrouped')
                    : '')
                + `</section>`;
        }

        if (!patterns.length) {
            body += `<p class="sg-intro">The URLs of these ${plural(list.length, 'scan')} repeat no pattern, so there are no groups to choose. `
                + 'A group needs several different pages that share the shape of their address, as pages made from one template do '
                + '(<code>/products/red-shirt</code> and <code>/products/blue-hat</code>). Scans can still be grouped by hand.</p>';
        } else {
            const total = grouping.flattenGroups(patterns).length;
            const grouped = list.length - noPattern.length;
            body += `<section class="sg-part" aria-labelledby="sg-found-h">`
                + `<h4 class="sg-h" id="sg-found-h">Patterns found</h4>`
                + `<p class="sg-intro">${plural(total, 'pattern')} that the scans' URLs repeat, as pages made from one template do, `
                + `holding ${plural(grouped, 'scan')} of ${list.length}. A pattern inside another is a narrower one; `
                + 'a scan is in every pattern on its way down. Choose the patterns to group the scans by.</p>'
                + `<ul class="sg-tree sg-roots">${patterns.map((g) => patternHTML(g, ctx)).join('')}</ul>`
                + (noPattern.length
                    ? listDetailsHTML(NOT_GROUPED,
                        `<span class="sg-label sg-plain">In no pattern</span> <span class="sg-counts">${esc(plural(noPattern.length, 'scan'))}</span>`,
                        membersHTML(noPattern, scansById, ''), ctx, 'sg-ungrouped')
                    : '')
                + `</section>`;
        }
        body += runMergesHTML(list, ctx);
        body += manualFormHTML(list, ctx);
        return `<details class="a11y-details sg" data-sg-section${o.open ? ' open' : ''}>`
            + `<summary>Scan groups</summary>${body}</details>`;
    }

    return {
        CHOSEN_PREFIX,
        sectionHTML,
    };
}));
