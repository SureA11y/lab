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

    function chosenHTML(node, ctx) {
        const key = node.key;
        const name = ctx.names.get(key) || null;
        const shown = name || node.label;
        const host = ctx.showHosts ? hostOf(node.group) : null;
        const summary = `<span class="${name ? 'sg-name' : 'sg-label'}">${esc(shown)}</span>`
            + (name ? ` <span class="sg-label sg-pattern-of">${esc(node.label)}</span>` : '')
            + (host ? ` <span class="sg-host">on ${esc(host)}</span>` : '')
            + ` <span class="sg-counts">${esc(countsText(node.group, ctx.scansById))}</span>`;

        const nameId = `sg-name-${ctx.nextId++}`;
        const controls = `<div class="sg-controls">`
            + `<span class="sg-name-field"><label for="${nameId}">Name</label> `
            + `<input type="text" id="${nameId}" data-sg-name="${esc(key)}" data-sg-focus="name:${esc(key)}"`
            + ` value="${esc(name || '')}" maxlength="${ctx.maxName}" autocomplete="off"></span>`
            + `<span class="sg-actions" role="group" aria-label="${esc(`Scans of ${shown}`)}">`
            + [['include', 'Include all'], ['exclude', 'Exclude all'], ['keepOne', 'Keep one']].map(([action, text]) =>
                `<button type="button" class="secondary-button" data-sg-action="${action}" data-sg-group="${esc(key)}"`
                + ` data-sg-focus="${action}:${esc(key)}">${text}</button>`).join('')
            + `</span></div>`;

        const children = node.children.length
            ? `<ul class="sg-tree">${node.children.map((c) => `<li>${chosenHTML(c, ctx)}</li>`).join('')}</ul>`
            : '';
        const own = membersHTML(node.own, ctx.scansById, node.children.length && node.own.length
            ? `${plural(node.own.length, 'scan')} in no narrower group you chose:` : '');

        const k = CHOSEN_PREFIX + key;
        return `<details class="sg-group sg-chosen" data-sg-key="${esc(k)}"${openAttr(ctx, k)}>`
            + `<summary>${summary}</summary>${controls}${children}${own}</details>`;
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
     *   the groups to start open (those open before the summary was redrawn).
     * Empty for fewer than two scans: there is nothing to group.
     */
    function sectionHTML(result, scans, opts) {
        const o = opts || {};
        const list = Array.isArray(scans) ? scans.filter(Boolean) : [];
        if (list.length < 2 || !result) return '';
        const scansById = new Map(list.map((s) => [s.id, s]));
        const groups = Array.isArray(result.groups) ? result.groups : [];
        const ungrouped = Array.isArray(result.ungrouped) ? result.ungrouped : [];
        const choice = Array.isArray(o.choice) ? o.choice.filter((p) => p && typeof p.key === 'string') : [];
        const hosts = new Set(groups.map(hostOf).filter(Boolean));
        const ctx = {
            scansById,
            openKeys: o.openKeys instanceof Set ? o.openKeys : new Set(o.openKeys || []),
            showHosts: hosts.size > 1,
            chosenKeys: new Set(choice.map((p) => p.key)),
            names: new Map(choice.filter((p) => p.name).map((p) => [p.key, p.name])),
            maxName: Number.isFinite(o.maxName) ? o.maxName : 200,
            nextId: 0,
        };

        let body;
        if (!groups.length) {
            body = `<p class="sg-intro">The URLs of these ${plural(list.length, 'scan')} repeat no pattern, so there are no groups. `
                + 'A group needs several different pages that share the shape of their address, as pages made from one template do '
                + '(<code>/products/red-shirt</code> and <code>/products/blue-hat</code>).</p>';
        } else {
            body = '';
            const chosen = grouping.chooseGroups(result, choice.map((p) => p.key));
            if (chosen.groups.length) {
                body += `<section class="sg-part" aria-labelledby="sg-yours-h">`
                    + `<h4 class="sg-h" id="sg-yours-h">Your groups</h4>`
                    + `<p class="sg-intro">Each scan is listed under the narrowest group you chose that holds it. `
                    + 'Include all, Exclude all and Keep one act on every scan of a group, those of the groups inside it too; '
                    + 'Keep one leaves the first included scan in the report and takes the rest out.</p>'
                    + `<ul class="sg-tree sg-roots">${chosen.groups.map((n) => `<li>${chosenHTML(n, ctx)}</li>`).join('')}</ul>`
                    + (chosen.ungrouped.length
                        ? listDetailsHTML(NOT_CHOSEN,
                            `<span class="sg-label sg-plain">Not in your groups</span> <span class="sg-counts">${esc(plural(chosen.ungrouped.length, 'scan'))}</span>`,
                            membersHTML(chosen.ungrouped, scansById, ''), ctx, 'sg-ungrouped')
                        : '')
                    + `</section>`;
            }

            const total = grouping.flattenGroups(groups).length;
            const grouped = list.length - ungrouped.length;
            body += `<section class="sg-part" aria-labelledby="sg-found-h">`
                + `<h4 class="sg-h" id="sg-found-h">Patterns found</h4>`
                + `<p class="sg-intro">${plural(total, 'pattern')} that the scans' URLs repeat, as pages made from one template do, `
                + `holding ${plural(grouped, 'scan')} of ${list.length}. A pattern inside another is a narrower one; `
                + 'a scan is in every pattern on its way down. Choose the patterns to group the scans by.</p>'
                + `<ul class="sg-tree sg-roots">${groups.map((g) => patternHTML(g, ctx)).join('')}</ul>`
                + (ungrouped.length
                    ? listDetailsHTML(NOT_GROUPED,
                        `<span class="sg-label sg-plain">In no pattern</span> <span class="sg-counts">${esc(plural(ungrouped.length, 'scan'))}</span>`,
                        membersHTML(ungrouped, scansById, ''), ctx, 'sg-ungrouped')
                    : '')
                + `</section>`;
        }
        return `<details class="a11y-details sg" data-sg-section${o.open ? ' open' : ''}>`
            + `<summary>Scan groups</summary>${body}</details>`;
    }

    return {
        CHOSEN_PREFIX,
        sectionHTML,
    };
}));
