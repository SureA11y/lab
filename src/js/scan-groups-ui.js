// What a person does in the "Scan groups" section of the run summary
// (docs/design/scan-grouping-design.md §6, §10 step 3): choose the patterns to
// group by, name a chosen group, and include or exclude a group's scans.
//
// The choice is saved in the report (`scanGrouping`, scan-group-choice.js),
// so it travels with its downloads; Include all, Exclude all and Keep one set
// each scan's `includedInReport`, as the scans list's Exclude does.

import {STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (applyScanInclusion, getActiveBucket, redrawAsShown, resultsState, runSummaryUi, setStatusReport, setStatusRun, summaryEl, updateResults).
 */
export function createScanGroupsUi(app) {
    const choiceApi = () => globalThis.A11Y_SCAN_GROUP_CHOICE;
    const groupingApi = () => globalThis.A11Y_SCAN_GROUPS;

    function payloadOf() {
        const payload = app.getActiveBucket()?.payload;
        return payload && Array.isArray(payload.scans) ? payload : null;
    }

    function status(message) {
        if (app.resultsState.activeMode === 'report') app.setStatusReport(message, STATUS.OK);
        else app.setStatusRun(message, STATUS.OK);
    }

    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

    // The group a key names, as the section shows it now, and what it is called.
    function groupOf(payload, key) {
        const result = app.runSummaryUi.findScanGroups(app.runSummaryUi.getScansFromPayload(payload));
        const group = result ? groupingApi().flattenGroups(result.groups).find((g) => g.key === key) : null;
        if (!group) return null;
        const chosen = choiceApi().readChoice(payload).find((p) => p.key === key);
        return {group, name: (chosen && chosen.name) || group.label};
    }

    function choose(key, chosen) {
        const payload = payloadOf();
        if (!payload) return;
        const api = choiceApi();
        api.writeChoice(payload, api.setChosen(api.readChoice(payload), key, chosen));
        app.runSummaryUi.refreshScanGroups(payload);
        const found = groupOf(payload, key);
        const label = found ? found.group.label : key;
        status(chosen ? `Grouping the scans by ${label}.` : `No longer grouping the scans by ${label}.`);
    }

    // Merging or unmerging changes which scans the report shows, so it is
    // drawn again whole (docs/design/scan-grouping-design.md §9.2).
    function merge(key, merged) {
        const payload = payloadOf();
        if (!payload) return;
        const api = choiceApi();
        api.writeChoice(payload, api.setMerged(api.readChoice(payload), key, merged));
        app.redrawAsShown(payload);
        const found = groupOf(payload, key);
        const name = found ? found.name : key;
        const count = found ? found.group.size : 0;
        status(merged
            ? `${name}: its ${plural(count, 'scan')} shown as one merged scan.`
            : `${name}: its ${plural(count, 'scan')} shown each on its own again.`);
    }

    function rename(key, raw) {
        const payload = payloadOf();
        if (!payload) return;
        const api = choiceApi();
        const before = api.readChoice(payload).find((p) => p.key === key);
        if (!before) return;
        const next = api.setName(api.readChoice(payload), key, raw);
        const after = next.find((p) => p.key === key);
        // Nothing new (a blur after Enter saved it): leave the field as it is.
        if ((before.name || null) === (after.name || null)) return;
        api.writeChoice(payload, next);
        app.runSummaryUi.refreshScanGroups(payload);
        const found = groupOf(payload, key);
        status(after.name
            ? `Group ${found ? found.group.label : key} named "${after.name}".`
            : `Group ${found ? found.group.label : key} shown by its pattern again.`);
    }

    function act(key, action) {
        const payload = payloadOf();
        if (!payload) return;
        const found = groupOf(payload, key);
        if (!found) return;
        const {group, name} = found;
        const plan = choiceApi().planAction(payload.scans, group.members, action);
        const changes = plan.include.length + plan.exclude.length;
        if (!changes) {
            status(action === 'include'
                ? `Nothing to change: every scan of ${name} is already included.`
                : action === 'exclude'
                    ? `Nothing to change: every scan of ${name} is already excluded.`
                    : `Nothing to change: ${name} already has one scan included.`);
            return;
        }
        let message;
        if (action === 'include') {
            message = `${plural(plan.include.length, 'scan')} of ${name} included in the summary report.`;
        } else if (action === 'exclude') {
            message = `${plural(plan.exclude.length, 'scan')} of ${name} excluded from the summary report.`;
        } else {
            const kept = payload.scans.find((s) => s && group.members.includes(s.id) && (plan.include.includes(s.id)
                || (s.includedInReport !== false && !plan.exclude.includes(s.id))));
            const keptLabel = kept ? (kept.label || kept.id) : 'one scan';
            message = `Kept ${keptLabel} of ${name} in the summary report`
                + (plan.exclude.length ? `; ${plural(plan.exclude.length, 'other scan')} excluded.` : '.');
        }
        return app.applyScanInclusion(plan, message);
    }

    const root = app.summaryEl;
    if (!root) return {};

    root.addEventListener('change', (e) => {
        const box = e.target.closest('input[data-sg-choose]');
        if (box) {
            choose(box.getAttribute('data-sg-choose'), box.checked);
            return;
        }
        const toMerge = e.target.closest('input[data-sg-merge]');
        if (toMerge) {
            merge(toMerge.getAttribute('data-sg-merge'), toMerge.checked);
            return;
        }
        const name = e.target.closest('input[data-sg-name]');
        if (name) rename(name.getAttribute('data-sg-name'), name.value);
    });

    // Enter saves the name where the field is, and Escape puts back the
    // saved one; neither leaves the field.
    root.addEventListener('keydown', (e) => {
        const name = e.target.closest('input[data-sg-name]');
        if (!name) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            rename(name.getAttribute('data-sg-name'), name.value);
        } else if (e.key === 'Escape') {
            const saved = choiceApi().readChoice(payloadOf()).find((p) => p.key === name.getAttribute('data-sg-name'));
            if (name.value !== ((saved && saved.name) || '')) {
                e.preventDefault();
                e.stopPropagation();
                name.value = (saved && saved.name) || '';
            }
        }
    });

    root.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sg-action]');
        if (!btn) return;
        const key = btn.getAttribute('data-sg-group');
        const action = btn.getAttribute('data-sg-action');
        app.updateResults(btn, () => act(key, action));
    });

    return {choose, merge, rename, act};
}
