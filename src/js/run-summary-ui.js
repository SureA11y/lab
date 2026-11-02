// A run's final summary: the result line the status keeps, and what the run
// found, once it has finished. Moved out of a11y-ui.js; what it shares with
// the rest of the app it reaches through `app`.

import {escapeAttr, escapeHtml, svgIcon} from './a11y-ui.utils.js';
import {failureFreeScansNote, isFailureFreeScan} from './scan-failures.js';
import {optInRulesLabel} from './report-fields.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (buildScanTagChipsHtml, buildSummaryControlsHtml, isScanIncludedInReport, resultsState, runResultText, runResultToStatus, scanMatchesActiveTagFilter, summaryEl).
 */
export function createRunSummaryUi(app) {
    /** Normalize scans list from final payload */
    function getScansFromPayload(data, { includedOnly = false } = {}) {
        const scans = Array.isArray(data?.scans) ? data.scans : [];
        return includedOnly ? scans.filter(app.isScanIncludedInReport) : scans;
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
            app.scanMatchesActiveTagFilter(scan) ? '' : 'scan-filtered-out',
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

        // Sort, hide-excluded and the "View all scans" trigger cluster at the end
        // of the header line.
        app.summaryEl.innerHTML =
            '<div class="summary-header-line">' +
                '<span class="summary-header-text">' + header + '</span>' +
                '<span class="summary-controls">' + app.buildSummaryControlsHtml() + allScansButtonHtml + '</span>' +
            '</div>' +
            rgaaRateHtml(getScansFromPayload(data, {includedOnly: true})) +
            (scansListHtml || '');

        if (app.runResultToStatus && app.resultsState.activeMode === 'run' && headerText == null) {
            app.runResultToStatus = false;
            app.runResultText = 'Finished: ' + header.replace(/^Workflow scan - /, '');
        }
    }

    return {
        buildScansListHtml,
        getScansFromPayload,
        writeSummaryHtml,
    };
}
