'use strict';

// The words for scan groups (docs/design/scan-grouping-design.md §9 step 2):
// the "Scan groups" section under a run's scans list, as an HTML string built
// from a findGroups result (scan-groups.js). Read-only: it shows the groups
// and which of their scans are included, and changes nothing.
//
// It knows nothing about how groups are found: whatever sources made them,
// a group is shown by its label, its members and, when the source gave one,
// the host and number of distinct URLs in its evidence.
//
// Browser: available as globalThis.A11Y_SCAN_GROUPS_VIEW.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_GROUPS_VIEW = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

    const isIncluded = (scan) => !scan || scan.includedInReport !== false;

    function hostOf(group) {
        const host = group && group.evidence && group.evidence.host;
        return typeof host === 'string' && host ? host : null;
    }

    // "487 scans · 480 URLs · 480 included", the counts a group is read by.
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

    function groupHTML(group, ctx) {
        const host = ctx.showHosts ? hostOf(group) : null;
        const open = ctx.openKeys.has(group.key) ? ' open' : '';
        let body = '';
        if (group.children.length) {
            body += `<ul class="sg-tree">${group.children.map((g) => `<li>${groupHTML(g, ctx)}</li>`).join('')}</ul>`;
            // Its scans that no smaller group holds, so each scan is listed
            // once under the group that says most about it.
            const inChildren = new Set(group.children.flatMap((g) => g.members));
            const own = group.members.filter((id) => !inChildren.has(id));
            body += membersHTML(own, ctx.scansById, own.length
                ? `${plural(own.length, 'scan')} in no smaller group:` : '');
        } else {
            body += membersHTML(group.members, ctx.scansById, '');
        }
        return `<details class="sg-group" data-sg-key="${esc(group.key)}"${open}>`
            + `<summary><span class="sg-label">${esc(group.label)}</span>`
            + (host ? ` <span class="sg-host">on ${esc(host)}</span>` : '')
            + ` <span class="sg-counts">${esc(countsText(group, ctx.scansById))}</span></summary>`
            + body
            + `</details>`;
    }

    /**
     * The "Scan groups" section for a run's scans.
     * - result: what findGroups returned for these scans;
     * - scans: the run's scans, all of them (an excluded scan is still part
     *   of its group, shown as excluded);
     * - opts.open: the section starts open; opts.openKeys: the keys of the
     *   groups to start open (the ones open before the summary was redrawn).
     * Empty for fewer than two scans: there is nothing to group.
     */
    function sectionHTML(result, scans, opts) {
        const o = opts || {};
        const list = Array.isArray(scans) ? scans.filter(Boolean) : [];
        if (list.length < 2 || !result) return '';
        const scansById = new Map(list.map((s) => [s.id, s]));
        const groups = Array.isArray(result.groups) ? result.groups : [];
        const ungrouped = Array.isArray(result.ungrouped) ? result.ungrouped : [];
        const hosts = new Set(groups.map(hostOf).filter(Boolean));
        const ctx = {
            scansById,
            openKeys: o.openKeys instanceof Set ? o.openKeys : new Set(o.openKeys || []),
            showHosts: hosts.size > 1,
        };

        let body;
        if (!groups.length) {
            body = `<p class="sg-intro">The URLs of these ${plural(list.length, 'scan')} repeat no pattern, so there are no groups. `
                + 'A group needs several different pages that share the shape of their address, as pages made from one template do '
                + '(<code>/products/red-shirt</code> and <code>/products/blue-hat</code>).</p>';
        } else {
            const grouped = list.length - ungrouped.length;
            let total = 0;
            const count = (level) => level.forEach((g) => { total += 1; count(g.children); });
            count(groups);
            body = `<p class="sg-intro">${plural(total, 'group')} of scans whose URLs repeat a pattern, `
                + `as pages made from one template do, holding ${plural(grouped, 'scan')} of ${list.length}. `
                + 'A group inside another is a narrower pattern; a scan is in every group on its way down. '
                + 'This list does not change the report: include or exclude scans from the list above.</p>'
                + `<ul class="sg-tree sg-roots">${groups.map((g) => `<li>${groupHTML(g, ctx)}</li>`).join('')}</ul>`;
            if (ungrouped.length) {
                const key = 'not-grouped';
                body += `<details class="sg-group sg-ungrouped" data-sg-key="${key}"${ctx.openKeys.has(key) ? ' open' : ''}>`
                    + `<summary><span class="sg-label">Not grouped</span> <span class="sg-counts">${esc(plural(ungrouped.length, 'scan'))}</span></summary>`
                    + membersHTML(ungrouped, scansById, '')
                    + `</details>`;
            }
        }
        return `<details class="a11y-details sg" data-sg-section${o.open ? ' open' : ''}>`
            + `<summary>Scan groups</summary>${body}</details>`;
    }

    return {
        sectionHTML,
    };
}));
