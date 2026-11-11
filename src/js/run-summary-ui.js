// A run's final summary: the result line the status keeps, and what the run
// found, once it has finished. Moved out of a11y-ui.js; what it shares with
// the rest of the app it reaches through `app`.

import {escapeAttr, escapeHtml, svgIcon} from './a11y-ui.utils.js';
import {failureFreeScansNote, isFailureFreeScan} from './scan-failures.js';
import {optInRulesLabel} from './report-fields.js';
import {scanCardThumbnail} from './all-scans-data.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (buildScanTagChipsHtml, buildSummaryControlsHtml, isScanIncludedInReport, resultsState, runResultText, runResultToStatus, scanMatchesActiveFilters, summaryEl).
 */
export function createRunSummaryUi(app) {
    /** Normalize scans list from final payload */
    // Each read as the Profiles selector shows it (app.viewScan).
    function getScansFromPayload(data, { includedOnly = false } = {}) {
        const scans = Array.isArray(data?.scans) ? data.scans : [];
        const view = typeof app.viewScan === 'function' ? app.viewScan : (scan) => scan;
        return (includedOnly ? scans.filter(app.isScanIncludedInReport) : scans).map(view);
    }

    /** Build one <li> row for the scans summary list (same behavior, extracted) */
    function buildScanSummaryListItem(scan, index, total) {
        const isSkipped = !!scan.skipped || !!scan.skipInfo;
        const s = scan.summary || {};
        const count = isSkipped ? 0 : typeof s.failCount === 'number' ? s.failCount : 0;
        const isIncluded = scan.includedInReport !== false;

        const label = scan.label || scan.id || 'Scan ' + (index + 1);

        const perScanNodes = isSkipped
            ? 0
            : (() => {
                const findings = scan?.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [];
                return findings.reduce((acc2, f) => {
                    if (f?.outcome !== 'fail') return acc2;
                    const occs = Array.isArray(f.occurrences) ? f.occurrences : [];
                    return acc2 + occs.length;
                }, 0);
            })();

        const scanIdAttr = escapeAttr(scan.id || '');
        const isFirst = index === 0;
        const isLast = index === (total - 1);

        const controlsHtml =
            '<span class="scan-summary-controls">' +
            `<button type="button" class="secondary-button icon-button scan-summary-rename" data-scan-action="rename" data-scan-id="${scanIdAttr}" aria-label="Rename scan" title="Rename scan">${svgIcon('edit').outerHTML}</button>` +
            `<button type="button" class="secondary-button icon-button scan-summary-move-up" data-scan-action="move-up" data-scan-id="${scanIdAttr}" aria-label="Move scan up"${isFirst ? ' disabled aria-disabled="true"' : ''}>▲</button>` +
            `<button type="button" class="secondary-button icon-button scan-summary-move-down" data-scan-action="move-down" data-scan-id="${scanIdAttr}" aria-label="Move scan down"${isLast ? ' disabled aria-disabled="true"' : ''}>▼</button>` +
            `<button type="button" class="secondary-button scan-summary-toggle" data-scan-action="toggle" data-scan-id="${scanIdAttr}" aria-pressed="${isIncluded ? 'true' : 'false'}">${isIncluded ? 'Exclude' : 'Include'}</button>` +
            '</span>';

        const nameWrapperHtml =
            '<span class="scan-name-wrapper">' +
            `<strong class="scan-name-text" data-scan-id="${scanIdAttr}">${escapeHtml(label)}</strong>` +
            `<input type="text" class="scan-name-input" data-scan-id="${scanIdAttr}" aria-label="Edit scan name" hidden>` +
            '</span>';

        const excludedBadgeHtml = isIncluded
            ? ''
            : '<span class="scan-excluded-badge">Excluded</span> ';

        const liClasses = [
            isIncluded ? '' : 'scan-summary-excluded',
            app.scanMatchesActiveFilters(scan) ? '' : 'scan-filtered-out',
            isFailureFreeScan(scan) ? 'scan-no-failures' : '',
        ].filter(Boolean).join(' ');

        const sortAttrs = globalThis.A11Y_SCAN_SORT
            ? ' ' + globalThis.A11Y_SCAN_SORT.scanSortAttrs(scan, index)
            : '';
        // A row of columns, lined up with the rows above and below it: its
        // name, and under it what it found; its tags; its buttons.
        const metaBits = isSkipped
            ? [`<a href="#sc-${scan.id}" title="go to the report">skipped, ` +
                escapeHtml(scan.skipInfo?.reason || 'reason not provided') +
                (scan.skipInfo?.estimatedNodes != null && scan.skipInfo?.threshold != null
                    ? ' · ' + escapeHtml(`estimated nodes: ${scan.skipInfo.estimatedNodes} (threshold: ${scan.skipInfo.threshold})`)
                    : '') + '</a>']
            : [`<a href="#sc-${scan.id}" title="go to the report">` +
                count + ' failure' + (count === 1 ? '' : 's') +
                (perScanNodes > 0 ? ' in ' + perScanNodes + ' element' + (perScanNodes === 1 ? '' : 's') : '') + '</a>'];
        if (!isSkipped && globalThis.A11Y_REPORT_SCAN?.scanProfilesLabel(scan)) {
            metaBits.push(escapeHtml(globalThis.A11Y_REPORT_SCAN.scanProfilesLabel(scan)));
        }
        if (!isSkipped && optInRulesLabel(scan)) metaBits.push('plus ' + escapeHtml(optInRulesLabel(scan)));
        // A note can explain a count, such as no failures on a scope that
        // matched nothing, so the list points to it.
        if (!isSkipped && Array.isArray(scan?.canonical?.notices) && scan.canonical.notices.length) {
            metaBits.push('<span class="scan-has-notes"><a href="#sc-' + escapeAttr(scan.id || '') + '">' +
                (scan.canonical.notices.length === 1 ? 'see the note' : 'see the notes') + '</a></span>');
        }
        let item = `<li class="${liClasses}" data-scan-id="${scanIdAttr}"${sortAttrs}>`;
        item +=
            '<span class="scan-summary-main">' +
                '<span class="scan-summary-name">' + nameWrapperHtml + excludedBadgeHtml + '</span>' +
                // Heard as one sentence: "Main menu: 7 failures in 20 elements, ..."
                '<span class="scan-summary-meta"><span class="visually-hidden">: </span>' + metaBits.join('<span aria-hidden="true"> · </span><span class="visually-hidden">, </span>') + '</span>' +
            '</span>' +
            '<span class="scan-summary-tags">' + app.buildScanTagChipsHtml(scan) + '</span>' +
            controlsHtml;

        item += '</li>';
        return item;
    }

    /** Build the <ul> summary list HTML */
    function buildScansListHtml(scans) {
        if (!Array.isArray(scans) || !scans.length) return '';
        const total = scans.length;
        const items = scans.map((scan, index) => buildScanSummaryListItem(scan, index, total)).join('');
        if (!items) return '';

        // Only shown in "Failures only", so the scans that mode hides are
        // accounted for instead of silently missing.
        const note = failureFreeScansNote(scans);
        const noteHtml = note ? '<p class="failure-free-scans-note">' + escapeHtml(note) + '</p>' : '';
        // Its own titled, framed box that scrolls, so the rows past its height
        // are seen to be there; focusable, to scroll it from the keyboard.
        const shown = (items.match(/<li /g) || []).length;
        return noteHtml + '<p class="scan-summary-list-h" id="scan-summary-list-h">' + shown + ' scan' + (shown === 1 ? '' : 's') + ' in this list</p>' +
            '<ol class="scan-summary-list" tabindex="0" aria-labelledby="scan-summary-list-h">' + items + '</ol>';
    }

    /**
     * RGAA's compliance rate over the included scans that targeted it, as one
     * line under the summary header; empty without RGAA scans. Only the
     * criteria the automated checks settled count, which the line says.
     */
    function rgaaRateHtml(scans) {
        const api = globalThis.A11Y_REPORT_CONFORMANCE;
        const r = api && typeof api.rgaaComplianceRate === 'function' ? api.rgaaComplianceRate(scans) : null;
        if (!r) return '';
        const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
        const rate = r.rate == null
            ? 'no rate yet: the automated checks settled no criterion'
            : `<strong>${Math.round(r.rate * 100)}%</strong> (${r.met} of ${r.met + r.notMet} criteria met)`;
        return '<p class="rgaa-rate"><span lang="fr">RGAA</span> 4.1.2 compliance rate, from automated checks only: ' + rate +
            ' · ' + escapeHtml(plural(r.toVerify, 'criterion', 'criteria')) + ' to verify by hand' +
            ' · ' + escapeHtml(plural(r.notApplicable, 'criterion', 'criteria')) + ' not applicable' +
            ' · across ' + escapeHtml(plural(r.pages, 'page', 'pages')) + '. ' +
            '<span class="rgaa-rate-note">An audit judges every criterion; this rate counts only those the checks could settle, and a criterion met here still needs a person to confirm it.</span></p>';
    }

    /** Write the main summary panel HTML */
    // The grouping depends only on the scans' ids and URLs, so it is kept
    // while they stay the same: excluding a scan, or choosing a group, draws
    // the section again without finding the groups again.
    let groupingMemo = {key: null, result: null};

    // A skipped scan was not scanned, so its URL says nothing of a page.
    const groupingUrlOf = (scan) => (scan && !scan.skipped && !scan.skipInfo ? scan.url : null);

    /**
     * The groups of these scans (scan-groups.js findGroups): the patterns
     * their URLs repeat, and the groups the person made by hand in `choice`
     * (the manual source). Null without the shared modules.
     */
    function findScanGroups(scans, choice = []) {
        const grouping = globalThis.A11Y_SCAN_GROUPS;
        const urlGroups = globalThis.A11Y_SCAN_URL_GROUPS;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        if (!grouping || !urlGroups || !Array.isArray(scans)) return null;
        const manual = choiceApi ? choiceApi.readChoice({scanGrouping: {patterns: choice}})
            .filter((p) => choiceApi.isManual(p.key)).map((p) => [p.key, p.name, p.members]) : [];
        const key = JSON.stringify([scans.map((scan) => [scan?.id, groupingUrlOf(scan)]), manual]);
        if (groupingMemo.key !== key) {
            const sources = [urlGroups.createUrlGroupSource({getUrl: groupingUrlOf})];
            if (choiceApi) sources.push(choiceApi.createManualGroupSource(choice));
            groupingMemo = {key, result: grouping.findGroups(scans, {sources})};
        }
        return groupingMemo.result;
    }

    // What a group's scans fail together and apart, kept while its scans
    // are the same objects: the Profiles selector reads them anew (viewScan),
    // and nothing else in the report changes their findings.
    const issuesMemo = new Map();

    function groupIssuesOf(scans, group) {
        const api = globalThis.A11Y_SCAN_GROUP_MERGE;
        const fold = globalThis.A11Y_SCAN_FOLD;
        if (!api || !fold || !group || typeof api.groupIssues !== 'function') return null;
        const ids = new Set(group.members);
        const members = scans.filter((s) => s && ids.has(s.id));
        const known = issuesMemo.get(group.key);
        if (known && known.members.length === members.length && known.members.every((m, i) => m === members[i])) {
            return known.value;
        }
        const value = api.groupIssues(members, {fold});
        issuesMemo.set(group.key, {members, value});
        return value;
    }

    // The scans as shown are worked out again only when what they depend on
    // changes: the scans and their order, which are included, their labels
    // and tags, and the groups merged.
    let shownMemo = {payload: null, key: null, value: null};

    /**
     * The report's scans as shown (docs/design/scan-grouping-design.md §9.5):
     * each merged group in place of its scans (scan-group-merge.js), each
     * run's merged scan as the person left it (§8), the others as they are.
     * { scans, merges, contexts }: merges by merged scan id, contexts by the
     * id of a context shown on its own ({ scanId, index }). Every
     * part of the report that counts or lists scans reads them through this;
     * the grouping, the downloads and the edits read the scans themselves.
     */
    function shownScans(payload) {
        const scans = Array.isArray(payload?.scans) ? payload.scans : [];
        const mergeApi = globalThis.A11Y_SCAN_GROUP_MERGE;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        const fold = globalThis.A11Y_SCAN_FOLD;
        const none = {scans, merges: new Map(), contexts: new Map()};
        if (!mergeApi || !choiceApi || !fold) return none;
        const choice = choiceApi.readChoice(payload);
        // Nothing merged here, nothing the run merged changed.
        if (!choice.some((p) => p.merge || choiceApi.isRun(p.key))) return none;

        const key = JSON.stringify([
            choice,
            scans.map((s) => [s?.id, s?.includedInReport !== false, s?.label || null, s?.scanTags || null, groupingUrlOf(s)]),
        ]);
        if (shownMemo.payload === payload && shownMemo.key === key) return shownMemo.value;
        const value = mergeApi.scansAsShown(scans, findScanGroups(scans, choice), choice, {
            fold,
            buildA11ySummary: globalThis.A11Y_SUMMARY?.buildA11ySummary,
            buildCoverageAwareSummary: globalThis.A11Y_COVERAGE_SUMMARY?.buildCoverageAwareSummary,
        });
        shownMemo = {payload, key, value};
        return value;
    }

    // The narrowest group of two scans or more holding each scan, a group by
    // hand before a pattern: what its card says it is part of.
    function groupsByScan(payload) {
        const model = reviewModelOf(payload);
        const out = new Map();
        if (!model) return out;
        const flat = (list) => list.flatMap((n) => [n, ...flat(n.children || [])]);
        const nodes = [...model.byHand, ...flat(model.patterns)].filter((n) => n.ids.length > 1);
        for (const n of nodes) {
            n.ids.forEach((id, i) => {
                const known = out.get(id);
                if (!known || (!known.byHand && (n.byHand || n.ids.length < known.total))) {
                    out.set(id, {key: n.key, name: n.name, index: i + 1, total: n.ids.length, byHand: n.byHand});
                }
            });
        }
        return out;
    }

    /**
     * The report as shown: itself, with its scans as shown (shownScans), each
     * scan in a group saying which (`reviewGroup`: { key, name, index,
     * total }), for its card. Copies: the report's scans are not changed.
     */
    function viewPayload(payload) {
        if (!payload || typeof payload !== 'object') return payload;
        const {scans} = shownScans(payload);
        const groups = groupsByScan(payload);
        if (!groups.size) return scans === payload.scans ? payload : {...payload, scans};
        return {...payload, scans: scans.map((s) => (s && !s.mergedGroup && groups.has(s.id) ? {...s, reviewGroup: groups.get(s.id)} : s))};
    }

    // ---------------------------------------------------------------- review

    /**
     * What the review of the scans shows (scan-review-view.js reviewModel):
     * the report's scans as they are, their groups (every pattern, the groups
     * by hand), the scans in no group, the run's merges, and the totals as
     * shown. Null without the shared modules.
     */
    function reviewModelOf(payload) {
        const view = globalThis.A11Y_SCAN_REVIEW_VIEW;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        if (!view || !choiceApi || !payload) return null;
        const scans = getScansFromPayload(payload);
        const choice = choiceApi.readChoice(payload);
        const result = findScanGroups(scans, choice);
        if (!result) return null;
        return view.reviewModel({scans, result, choice, shown: shownScans(payload), membersOf: choiceApi.membersOf});
    }

    // How many scans the report shows, and failures it lists, for these scans
    // as shown: what a merge changes.
    function shownTotals(scans) {
        const included = scans.filter((s) => s && s.includedInReport !== false);
        const fails = (s) => (s.canonical && Array.isArray(s.canonical.findings) ? s.canonical.findings.filter((f) => f && f.outcome === 'fail').length : 0);
        return {scans: included.length, failures: included.reduce((n, s) => n + fails(s), 0)};
    }

    /**
     * What merging group `key` would change, or unmerging it when it is
     * merged: { scans: [now, then], failures: [now, then] }, the report's
     * scans and failures as shown. Shown to the person before they apply it.
     */
    function impactOf(payload, key) {
        const mergeApi = globalThis.A11Y_SCAN_GROUP_MERGE;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        const fold = globalThis.A11Y_SCAN_FOLD;
        if (!mergeApi || !choiceApi || !fold || !payload) return null;
        const scans = Array.isArray(payload.scans) ? payload.scans : [];
        const choice = choiceApi.readChoice(payload);
        const merged = choice.some((p) => p.key === key && p.merge);
        const next = choiceApi.setMerged(choice, key, !merged);
        const deps = {fold, buildA11ySummary: globalThis.A11Y_SUMMARY?.buildA11ySummary, buildCoverageAwareSummary: globalThis.A11Y_COVERAGE_SUMMARY?.buildCoverageAwareSummary};
        const now = shownTotals(shownScans(payload).scans);
        const then = shownTotals(mergeApi.scansAsShown(scans, findScanGroups(scans, next), next, deps).scans);
        return {scans: [now.scans, then.scans], failures: [now.failures, then.failures]};
    }

    // ------------------------------------------------- showing only a group

    // The group the report shows alone ("Show only these in the report"),
    // by key: a view, as the tag filter is, kept for the report open and
    // not saved. Its scans are worked out again when the groups change.
    let focus = {payload: null, key: null};
    let focusMemo = {sig: null, ids: null};

    function groupFocus(payload) {
        return focus.payload === payload ? focus.key : null;
    }

    function setGroupFocus(payload, key) {
        focus = {payload, key: key || null};
        focusMemo = {sig: null, ids: null};
    }

    // The ids of the scans the focused group holds, as they are.
    function focusIds(payload) {
        const key = groupFocus(payload);
        if (!key) return null;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        const sig = JSON.stringify([key, choiceApi ? choiceApi.readChoice(payload) : null, (payload.scans || []).map((s) => s && s.id)]);
        if (focusMemo.sig === sig) return focusMemo.ids;
        const model = reviewModelOf(payload);
        const view = globalThis.A11Y_SCAN_REVIEW_VIEW;
        const node = model && view ? view.nodeOf(model, key) : null;
        const ids = new Set(node ? node.ids : []);
        focusMemo = {sig, ids};
        return ids;
    }

    /**
     * Whether a scan as shown is in the group the report shows alone: true
     * when no group is; a merged scan when one of its scans is, a context of
     * a run's merged scan when that scan is.
     */
    function inGroupFocus(payload, scan) {
        if (!payload || !scan) return true;
        const ids = focusIds(payload);
        if (!ids) return true;
        if (scan.mergedGroup && Array.isArray(scan.mergedGroup.members)) return scan.mergedGroup.members.some((m) => ids.has(m.id));
        if (scan.runContext) return ids.has(scan.runContext.scanId);
        return ids.has(scan.id);
    }

    // The card at the top of the summary (scan-review-view.js), and the line
    // that says the report shows one group alone.
    function reviewCardHtml(payload) {
        const view = globalThis.A11Y_SCAN_REVIEW_VIEW;
        const model = reviewModelOf(payload);
        if (!view || !model) return '';
        let html = '';
        const key = groupFocus(payload);
        if (key) {
            const node = view.nodeOf(model, key);
            const name = node ? (node.rest ? 'the scans in no group' : node.name) : 'one group';
            html += `<p class="sr-focusbar">The report shows only <strong>${escapeHtml(name)}</strong>: the other scans are hidden, not excluded. `
                + `<button type="button" class="secondary-button" data-sr-unfocus data-sr-focus="unfocus">Show every scan</button></p>`;
        }
        return html + view.summaryCardHTML(model, {thumbOf: scanCardThumbnail});
    }

    /**
     * Draws the card again in place, from the report itself: after a scan is
     * renamed or moved, when nothing else of the summary changes. The review,
     * when open, is drawn again too.
     */
    function refreshScanGroups(payload) {
        const slot = app.summaryEl ? app.summaryEl.querySelector('[data-sr-card-slot]') : null;
        if (slot) slot.innerHTML = reviewCardHtml(payload);
        if (app.scanReview && typeof app.scanReview.refresh === 'function') app.scanReview.refresh();
    }

    function writeSummaryHtml({data, fallbackUrl, totals, scansListHtml, scansCount, headerText, allScansButtonHtml = ''}) {
        const header = headerText != null
            ? headerText
            : 'Workflow scan - ' +
            totals.totalViolations +
            ' failure' +
            (totals.totalViolations === 1 ? '' : 's') +
            (totals.totalNodes > 0
                ? ' in ' + totals.totalNodes + ' element' + (totals.totalNodes === 1 ? '' : 's')
                : '') +
            ', across ' +
            scansCount +
            ' scan' +
            (scansCount === 1 ? '' : 's') +
            '.';

        // Reviewed as the scans are, not as shown: a merged group's scans
        // stay in their groups (§9.5).
        const raw = (typeof app.getActiveBucket === 'function' && app.getActiveBucket()?.payload) || data;
        const cardHtml = reviewCardHtml(raw);

        // Sort, hide-excluded and the "View all scans" trigger cluster at the end
        // of the header line.
        app.summaryEl.innerHTML =
            '<div class="summary-header-line">' +
                '<span class="summary-header-text">' + header + '</span>' +
                '<span class="summary-controls">' + app.buildSummaryControlsHtml() + allScansButtonHtml + '</span>' +
            '</div>' +
            // Under the header: how much of the run repeats a template, and
            // the way into reviewing it (docs/design/scan-grouping-design.md §11.2).
            '<div data-sr-card-slot>' + cardHtml + '</div>' +
            rgaaRateHtml(getScansFromPayload(data, {includedOnly: true})) +
            (scansListHtml || '');

        if (app.runResultToStatus && app.resultsState.activeMode === 'run' && headerText == null) {
            app.runResultToStatus = false;
            app.runResultText = 'Finished: ' + header.replace(/^Workflow scan - /, '');
        }
    }

    return {
        buildScansListHtml,
        findScanGroups,
        getScansFromPayload,
        groupFocus,
        groupIssuesOf,
        impactOf,
        inGroupFocus,
        refreshScanGroups,
        reviewModelOf,
        setGroupFocus,
        shownScans,
        viewPayload,
        writeSummaryHtml,
    };
}
