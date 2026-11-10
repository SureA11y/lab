// A run's final summary: the result line the status keeps, and what the run
// found, once it has finished. Moved out of a11y-ui.js; what it shares with
// the rest of the app it reaches through `app`.

import {escapeAttr, escapeHtml, svgIcon} from './a11y-ui.utils.js';
import {failureFreeScansNote, isFailureFreeScan} from './scan-failures.js';
import {optInRulesLabel} from './report-fields.js';

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
        let item = `<li class="${liClasses}" data-scan-id="${scanIdAttr}"${sortAttrs}>`;
        item +=
            nameWrapperHtml +
            excludedBadgeHtml +
            (isSkipped
                ? `: <a href="#sc-${scan.id}" title="go to the report">skipped, ` +
                escapeHtml(scan.skipInfo?.reason || 'reason not provided') +
                (scan.skipInfo?.estimatedNodes != null && scan.skipInfo?.threshold != null
                    ? ' · ' +
                    escapeHtml(`estimated nodes: ${scan.skipInfo.estimatedNodes} (threshold: ${scan.skipInfo.threshold})`)
                    : '')
                : `: <a href="#sc-${scan.id}" title="go to the report">` +
                count +
                ' failure' +
                (count === 1 ? '' : 's') +
                (perScanNodes > 0 ? ' in ' + perScanNodes + ' element' + (perScanNodes === 1 ? '' : 's') : '')) +
            '</a>' +
            (isSkipped ? ''
                : globalThis.A11Y_REPORT_SCAN?.scanProfilesLabel(scan)
                    ? ' <small>(' + escapeHtml(globalThis.A11Y_REPORT_SCAN.scanProfilesLabel(scan)) + ')</small>' : '') +
            (!isSkipped && optInRulesLabel(scan) ? ' <small>(plus ' + escapeHtml(optInRulesLabel(scan)) + ')</small>' : '') +
            // A note can explain a count, such as no failures on a scope
            // that matched nothing, so the list points to it.
            (!isSkipped && Array.isArray(scan?.canonical?.notices) && scan.canonical.notices.length
                ? ' <small class="scan-has-notes">· <a href="#sc-' + escapeAttr(scan.id || '') + '">' +
                    (scan.canonical.notices.length === 1 ? 'see the note' : 'see the notes') + '</a></small>'
                : '') +
            app.buildScanTagChipsHtml(scan) +
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
        return noteHtml + '<ol>' + items + '</ol>';
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

    /** The groups of these scans (scan-groups.js findGroups), or null without the shared modules. */
    function findScanGroups(scans) {
        const grouping = globalThis.A11Y_SCAN_GROUPS;
        const urlGroups = globalThis.A11Y_SCAN_URL_GROUPS;
        if (!grouping || !urlGroups || !Array.isArray(scans)) return null;
        const key = JSON.stringify(scans.map((scan) => [scan?.id, groupingUrlOf(scan)]));
        if (groupingMemo.key !== key) {
            const result = grouping.findGroups(scans, {
                sources: [urlGroups.createUrlGroupSource({getUrl: groupingUrlOf})],
            });
            groupingMemo = {key, result};
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
     * each merged group in place of its scans (scan-group-merge.js), the
     * others as they are. { scans, merges }, merges by merged scan id. Every
     * part of the report that counts or lists scans reads them through this;
     * the grouping, the downloads and the edits read the scans themselves.
     */
    function shownScans(payload) {
        const scans = Array.isArray(payload?.scans) ? payload.scans : [];
        const mergeApi = globalThis.A11Y_SCAN_GROUP_MERGE;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        const fold = globalThis.A11Y_SCAN_FOLD;
        const none = {scans, merges: new Map()};
        if (!mergeApi || !choiceApi || !fold) return none;
        const choice = choiceApi.readChoice(payload);
        if (!choice.some((p) => p.merge)) return none;

        const key = JSON.stringify([
            choice,
            scans.map((s) => [s?.id, s?.includedInReport !== false, s?.label || null, s?.scanTags || null, groupingUrlOf(s)]),
        ]);
        if (shownMemo.payload === payload && shownMemo.key === key) return shownMemo.value;
        const value = mergeApi.scansAsShown(scans, findScanGroups(scans), choice, {
            fold,
            buildA11ySummary: globalThis.A11Y_SUMMARY?.buildA11ySummary,
            buildCoverageAwareSummary: globalThis.A11Y_COVERAGE_SUMMARY?.buildCoverageAwareSummary,
        });
        shownMemo = {payload, key, value};
        return value;
    }

    /** The report as shown: itself, with its scans as shown (shownScans). */
    function viewPayload(payload) {
        if (!payload || typeof payload !== 'object') return payload;
        const {scans} = shownScans(payload);
        return scans === payload.scans ? payload : {...payload, scans};
    }

    function groupsSectionEl() {
        return app.summaryEl ? app.summaryEl.querySelector('[data-sg-section]') : null;
    }

    /**
     * "Scan groups" (docs/design/scan-grouping-design.md §6, §10 steps 2 and 3):
     * the run's scans grouped by the patterns their URLs repeat, under the
     * scans list, with the groups chosen in `data` (its scanGrouping). Over
     * every scan, excluded ones too, so a group can say how many of its scans
     * are included. Empty when the shared modules are not loaded.
     */
    function scanGroupsHtml(scans, data) {
        const view = globalThis.A11Y_SCAN_GROUPS_VIEW;
        const choiceApi = globalThis.A11Y_SCAN_GROUP_CHOICE;
        const result = findScanGroups(scans);
        if (!view || !choiceApi || !result) return '';

        // Drawing it again keeps what was open, also across a redraw of the
        // whole report, which clears the summary first (holdGroupsState).
        const state = readGroupsState() || heldState || {open: false, openKeys: []};
        return view.sectionHTML(result, scans, {
            open: state.open,
            openKeys: state.openKeys,
            choice: choiceApi.readChoice(data),
            maxName: choiceApi.MAX_NAME,
            issuesOf: (group) => groupIssuesOf(scans, group),
        });
    }

    function readGroupsState() {
        const section = groupsSectionEl();
        if (!section) return null;
        return {
            open: !!section.open,
            openKeys: [...section.querySelectorAll('details[data-sg-key]')]
                .filter((el) => el.open).map((el) => el.getAttribute('data-sg-key')),
            focus: captureGroupsFocus(),
        };
    }

    // What the section looked like before the whole report is drawn again
    // (a group merged or unmerged, its scans included or excluded): kept until
    // the summary is written, which opens the same groups. Focus is given back
    // by whoever drew it again, once the results are shown.
    let heldState = null;

    function holdGroupsState() {
        heldState = readGroupsState();
    }

    /** Which control of the section has focus, to give it back after a redraw. */
    function captureGroupsFocus() {
        const active = document.activeElement;
        const section = groupsSectionEl();
        if (!active || !section || !section.contains(active)) return null;
        return active.getAttribute('data-sg-focus') || null;
    }

    function restoreGroupsFocus(token) {
        if (!token) return;
        const section = groupsSectionEl();
        const target = section && [...section.querySelectorAll('[data-sg-focus]')]
            .find((el) => el.getAttribute('data-sg-focus') === token);
        if (target && typeof target.focus === 'function') target.focus();
    }

    /**
     * Draws the section again in place, from the report itself: after a
     * group is chosen or named, or a scan renamed or moved, when nothing
     * else of the summary changes. Focus stays on the same control.
     */
    function refreshScanGroups(payload) {
        const section = groupsSectionEl();
        if (!section) return;
        const token = captureGroupsFocus();
        const html = scanGroupsHtml(getScansFromPayload(payload), payload);
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const next = holder.firstElementChild;
        if (next) section.replaceWith(next); else section.remove();
        restoreGroupsFocus(token);
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

        // Grouped as the scans are, not as shown: a merged group's scans
        // stay in their groups (§9.5).
        const raw = (typeof app.getActiveBucket === 'function' && app.getActiveBucket()?.payload) || data;
        const groupsHtml = scanGroupsHtml(getScansFromPayload(raw), raw);

        // Sort, hide-excluded and the "View all scans" trigger cluster at the end
        // of the header line.
        app.summaryEl.innerHTML =
            '<div class="summary-header-line">' +
                '<span class="summary-header-text">' + header + '</span>' +
                '<span class="summary-controls">' + app.buildSummaryControlsHtml() + allScansButtonHtml + '</span>' +
            '</div>' +
            rgaaRateHtml(getScansFromPayload(data, {includedOnly: true})) +
            (scansListHtml || '') +
            groupsHtml;
        // Used once: the next drawing of the summary reads the section itself.
        heldState = null;

        if (app.runResultToStatus && app.resultsState.activeMode === 'run' && headerText == null) {
            app.runResultToStatus = false;
            app.runResultText = 'Finished: ' + header.replace(/^Workflow scan - /, '');
        }
    }

    return {
        buildScansListHtml,
        captureGroupsFocus,
        findScanGroups,
        getScansFromPayload,
        holdGroupsState,
        refreshScanGroups,
        restoreGroupsFocus,
        shownScans,
        viewPayload,
        writeSummaryHtml,
    };
}
