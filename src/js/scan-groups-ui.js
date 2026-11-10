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
        const result = app.runSummaryUi.findScanGroups(app.runSummaryUi.getScansFromPayload(payload), choiceApi().readChoice(payload));
        const group = result ? groupingApi().flattenGroups(result.groups).find((g) => g.key === key) : null;
        if (!group) return null;
        const chosen = choiceApi().readChoice(payload).find((p) => p.key === key);
        // Its scans as the person left them: with those added, without those
        // taken out (§9.2).
        const members = choiceApi().membersOf(group, chosen || null);
        return {group, members, name: (chosen && chosen.name) || group.label};
    }

    function choose(key, chosen) {
        const payload = payloadOf();
        if (!payload) return;
        const api = choiceApi();
        const wasMerged = api.readChoice(payload).some((p) => p.key === key && p.merge);
        api.writeChoice(payload, api.setChosen(api.readChoice(payload), key, chosen));
        // Unchoosing a merged group unmerges it: the report shows its scans again.
        if (wasMerged) app.redrawAsShown(payload);
        else app.runSummaryUi.refreshScanGroups(payload);
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
        const count = found ? found.members.length : 0;
        status(merged
            ? `${name}: its ${plural(count, 'scan')} shown as one merged scan.`
            : `${name}: its ${plural(count, 'scan')} shown each on its own again.`);
    }

    // The section's group `key` open, and focus on the control `token`: after
    // a change that moves the control (a scan taken out is put back from
    // another list) or makes it (a new group).
    function openAndFocus(key, token) {
        const section = app.summaryEl.querySelector('[data-sg-section]');
        if (!section) return;
        section.open = true;
        const group = [...section.querySelectorAll('details[data-sg-key]')]
            .find((el) => el.getAttribute('data-sg-key') === `chosen:${key}`);
        if (group) group.open = true;
        app.runSummaryUi.restoreGroupsFocus(token);
    }

    // A change to which scans a group holds (§9.2): saved, and the report
    // drawn again when the group is merged, as its merged scan changes.
    function changeMembers(key, change, message, focusToken) {
        const payload = payloadOf();
        if (!payload) return;
        const api = choiceApi();
        const before = api.readChoice(payload);
        const wasMerged = before.some((p) => p.key === key && p.merge);
        api.writeChoice(payload, change(before));
        const after = api.readChoice(payload).find((p) => p.key === key);
        if (wasMerged || (after && after.merge)) app.redrawAsShown(payload);
        else app.runSummaryUi.refreshScanGroups(payload);
        if (after) openAndFocus(key, focusToken);
        status(message);
    }

    const scanLabel = (payload, id) => {
        const s = payload.scans.find((x) => x && x.id === id);
        return (s && (s.label || s.id)) || id;
    };

    function takeOut(key, id) {
        const payload = payloadOf();
        if (!payload) return;
        const found = groupOf(payload, key);
        const name = found ? found.name : key;
        const label = scanLabel(payload, id);
        const gone = choiceApi().isManual(key) && found && found.members.length <= 2;
        changeMembers(key, (c) => choiceApi().removeScan(c, key, id),
            gone
                ? `${label} taken out of ${name}, which had no other scan to group: the group is gone.`
                : `${label} taken out of ${name}, and shown on its own.`,
            `put-back:${key}:${id}`);
    }

    function putBack(key, id) {
        const payload = payloadOf();
        if (!payload) return;
        const found = groupOf(payload, key);
        changeMembers(key, (c) => choiceApi().putBack(c, key, id),
            `${scanLabel(payload, id)} put back in ${found ? found.name : key}.`, `take-out:${key}:${id}`);
    }

    function addTo(key, id) {
        const payload = payloadOf();
        if (!payload) return;
        if (!id) {
            status('Choose a scan to add first.');
            return;
        }
        const found = groupOf(payload, key);
        changeMembers(key, (c) => choiceApi().addScan(c, key, id),
            `${scanLabel(payload, id)} added to ${found ? found.name : key}.`, `add-select:${key}`);
    }

    function removeGroup(key) {
        const payload = payloadOf();
        if (!payload) return;
        const found = groupOf(payload, key);
        const name = found ? found.name : key;
        const api = choiceApi();
        const wasMerged = api.readChoice(payload).some((p) => p.key === key && p.merge);
        api.writeChoice(payload, api.setChosen(api.readChoice(payload), key, false));
        if (wasMerged) app.redrawAsShown(payload);
        else app.runSummaryUi.refreshScanGroups(payload);
        const section = app.summaryEl.querySelector('[data-sg-section]');
        const form = section && section.querySelector('details[data-sg-key="group-by-hand"] > summary');
        if (form) form.focus();
        status(`Group ${name} removed; its scans are shown as they were.`);
    }

    function makeGroup(form) {
        const payload = payloadOf();
        if (!payload || !form) return;
        const members = [...form.querySelectorAll('input[data-sg-new-member]:checked')].map((i) => i.getAttribute('data-sg-new-member'));
        const nameInput = form.querySelector('input[data-sg-new-name]');
        const merge = !!form.querySelector('input[data-sg-new-merge]')?.checked;
        const api = choiceApi();
        const made = api.addManualGroup(api.readChoice(payload), {name: nameInput ? nameInput.value : '', members, merge});
        if (!made.key) {
            status('Choose two scans or more to group.');
            return;
        }
        api.writeChoice(payload, made.choice);
        if (merge) app.redrawAsShown(payload);
        else app.runSummaryUi.refreshScanGroups(payload);
        openAndFocus(made.key, `name:${made.key}`);
        const entry = api.readChoice(payload).find((p) => p.key === made.key);
        const name = (entry && entry.name) || 'The new group';
        status(`${name} made of ${plural(members.length, 'scan')}${merge ? ', shown as one merged scan' : ''}.`);
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
        const {members, name} = found;
        const plan = choiceApi().planAction(payload.scans, members, action);
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
            const kept = payload.scans.find((s) => s && members.includes(s.id) && (plan.include.includes(s.id)
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
        const by = (attr) => e.target.closest(`button[${attr}]`);
        let b;
        if ((b = by('data-sg-take-out'))) return void app.updateResults(b, () => takeOut(b.getAttribute('data-sg-take-out'), b.getAttribute('data-sg-scan')));
        if ((b = by('data-sg-put-back'))) return void app.updateResults(b, () => putBack(b.getAttribute('data-sg-put-back'), b.getAttribute('data-sg-scan')));
        if ((b = by('data-sg-add'))) {
            const key = b.getAttribute('data-sg-add');
            const select = [...root.querySelectorAll('select[data-sg-add-select]')].find((el) => el.getAttribute('data-sg-add-select') === key);
            return void app.updateResults(b, () => addTo(key, select ? select.value : ''));
        }
        if ((b = by('data-sg-delete'))) return void app.updateResults(b, () => removeGroup(b.getAttribute('data-sg-delete')));
        if ((b = by('data-sg-new-group'))) return void app.updateResults(b, () => makeGroup(b.closest('details')));
        const btn = e.target.closest('button[data-sg-action]');
        if (!btn) return;
        const key = btn.getAttribute('data-sg-group');
        const action = btn.getAttribute('data-sg-action');
        app.updateResults(btn, () => act(key, action));
    });

    return {choose, merge, rename, act, takeOut, putBack, addTo, removeGroup, makeGroup};
}
