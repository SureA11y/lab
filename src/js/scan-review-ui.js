// Reviewing a run's scans (docs/design/scan-grouping-design.md §11.2,
// docs/design/mockups/scan-review.html): the Review scans workspace, a dialog
// over the report, opened from the card at the top of the summary.
//
// What it shows comes from the run summary (reviewModelOf) and is drawn by
// scan-review-view.js; this part keeps what the person is doing (the group
// they look at, the pages they selected, the order), carries out what they
// ask, and keeps a history to undo it. Every change is saved in the report
// as the scans list's Exclude saves it: `includedInReport` on each scan, and
// `scanGrouping` (scan-group-choice.js) for what is grouped, named, merged
// and changed by hand. Then the report is drawn again as shown.

import {STATUS} from './ui-constants.js';
import {scanCardThumbnail} from './all-scans-data.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

/**
 * app: accessors for what the rest of the app shares with this part
 * (getActiveBucket, recomputeDerivedReportData, redrawAsShown, resultsState, runSummaryUi, setStatusReport, setStatusRun, summaryEl).
 */
export function createScanReviewUi(app) {
    const view = () => globalThis.A11Y_SCAN_REVIEW_VIEW;
    const choiceApi = () => globalThis.A11Y_SCAN_GROUP_CHOICE;

    // What the person is doing in the review, and their history of changes,
    // for each report: a report opened again starts afresh.
    const sessions = new WeakMap();
    function session(payload) {
        if (!sessions.has(payload)) {
            // collapsed: the tree's folded branches and sections (null until
            // the first drawing decides what starts folded).
            sessions.set(payload, {sel: null, selected: new Set(), anchor: null, sort: 'differs', impactOpen: false, moreOpen: false, history: [], collapsed: null});
        }
        return sessions.get(payload);
    }

    function payloadOf() {
        const payload = app.getActiveBucket()?.payload;
        return payload && Array.isArray(payload.scans) ? payload : null;
    }

    function status(message) {
        if (app.resultsState.activeMode === 'report') app.setStatusReport(message, STATUS.OK);
        else app.setStatusRun(message, STATUS.OK);
        const live = dialog && dialog.querySelector('.sr-live');
        if (live) live.textContent = message;
    }

    // ------------------------------------------------------------ the dialog

    let dialog = null;
    let previewDlg = null;
    let askDlg = null;

    function ensureDialogs() {
        if (dialog) return;
        dialog = document.createElement('dialog');
        dialog.className = 'sr-dialog';
        dialog.setAttribute('aria-labelledby', 'sr-title');
        dialog.innerHTML = '<div class="sr-head"><h2 id="sr-title">Review scans</h2><span class="sr-stats"></span>'
            + '<button type="button" class="secondary-button" data-sr-close data-sr-focus="close">Close</button></div>'
            + '<div class="sr-undobar" hidden></div>'
            + '<div class="sr-body"><nav class="sr-tree" aria-label="Groups"></nav><div class="sr-grid"></div><section class="sr-detail" aria-label="The group"></section></div>'
            + '<p class="sr-live visually-hidden" aria-live="polite"></p>';
        previewDlg = document.createElement('dialog');
        previewDlg.className = 'sr-dialog sr-preview';
        previewDlg.setAttribute('aria-labelledby', 'sr-preview-title');
        previewDlg.innerHTML = '<div class="sr-head"><h2 id="sr-preview-title"></h2><button type="button" class="secondary-button" data-sr-close-preview>Close</button></div>'
            + '<div class="sr-preview-body"></div><div class="sr-foot"></div><p class="sr-preview-live visually-hidden" aria-live="polite"></p>';
        askDlg = document.createElement('dialog');
        askDlg.className = 'sr-dialog sr-ask';
        askDlg.setAttribute('aria-labelledby', 'sr-ask-title');
        askDlg.innerHTML = '<div class="sr-head"><h2 id="sr-ask-title"></h2></div><div class="sr-ask-body"></div>'
            + '<div class="sr-foot"><button type="button" class="secondary-button" data-sr-ask-cancel>Cancel</button><button type="button" class="secondary-button sr-primary" data-sr-ask-ok></button></div>';
        document.body.append(dialog, previewDlg, askDlg);
        dialog.addEventListener('click', onClick);
        dialog.addEventListener('change', onChange);
        dialog.addEventListener('keydown', onKeydown);
        previewDlg.addEventListener('click', onPreviewClick);
        previewDlg.addEventListener('close', onPreviewClose);
        askDlg.addEventListener('click', (e) => {
            if (e.target.closest('[data-sr-ask-cancel]')) askDlg.close();
        });
    }

    function open(key) {
        const payload = payloadOf();
        if (!payload) return;
        ensureDialogs();
        const s = session(payload);
        if (key) s.sel = key;
        render();
        if (!dialog.open) dialog.showModal();
        const current = dialog.querySelector('.sr-node[aria-current="true"]');
        (current || dialog.querySelector('[data-sr-close]')).focus();
    }

    // Drawn again from the report: after a change here, or to the report.
    function refresh() {
        if (dialog && dialog.open) render();
    }

    function focusToken() {
        const active = document.activeElement;
        return active && dialog && dialog.contains(active) ? active.getAttribute('data-sr-focus') : null;
    }

    function restoreFocus(token, fallback) {
        const find = (t) => t && [...dialog.querySelectorAll('[data-sr-focus]')].find((el) => el.getAttribute('data-sr-focus') === t);
        const target = find(token) || find(fallback);
        if (target && typeof target.focus === 'function') target.focus();
    }

    function issuesFor(model, node) {
        if (!node || node.rest || node.run) return null;
        return app.runSummaryUi.groupIssuesOf(model.scans, {key: node.key, members: node.ids});
    }

    function render(nextFocus) {
        const payload = payloadOf();
        const v = view();
        if (!payload || !v || !dialog) return;
        const token = nextFocus || focusToken();
        const s = session(payload);
        const model = app.runSummaryUi.reviewModelOf(payload);
        if (!model) return;
        let node = s.sel ? v.nodeOf(model, s.sel) : null;
        if (!node) {
            const first = model.patterns.find((n) => n.ids.length > 1) || model.byHand[0] || model.runMerges[0];
            s.sel = first ? first.key : v.REST;
            node = v.nodeOf(model, s.sel);
        }
        const issues = issuesFor(model, node);
        const focus = app.runSummaryUi.groupFocus(payload);
        const impact = s.impactOpen && !node.rest ? app.runSummaryUi.impactOf(payload, node.key) : null;
        const thumbOf = (scan) => scanCardThumbnail(scan);
        // The other groups, which selected pages can be added to.
        const flat = (list) => list.flatMap((n) => [n, ...flat(n.children || [])]);
        const targets = flat([...model.patterns, ...model.byHand]).filter((n) => n.key !== s.sel).map((n) => ({key: n.key, name: n.name}));

        dialog.querySelector('.sr-stats').innerHTML = v.statsHTML(model, s.baseInReport);
        // The tree starts as an overview: the top-level groups with the ones
        // directly in them; deeper groups folded (the selected one's branch
        // stays open, whatever is folded). A long list of the run's merged
        // scans starts folded too: the templates are what the tree is for.
        if (!s.collapsed) s.collapsed = v.initiallyFolded(model);
        dialog.querySelector('.sr-tree').innerHTML = v.treeHTML(model, s.sel, {collapsed: s.collapsed});
        dialog.querySelector('.sr-grid').innerHTML = v.gridHTML(model, node, {selected: s.selected, sort: s.sort, issues, thumbOf, targets, moreOpen: s.moreOpen});
        // The column says what it is, above the group's name: what to do with it.
        dialog.querySelector('.sr-detail').innerHTML = '<p class="sr-pane-label">This group</p>' + v.detailHTML(model, node, {issues, impact, impactOpen: s.impactOpen, focus});
        const undo = dialog.querySelector('.sr-undobar');
        const last = s.history[s.history.length - 1];
        undo.hidden = !last;
        undo.innerHTML = last
            ? `<span>${escapeText(last.message)}</span> <button type="button" class="secondary-button" data-sr-undo data-sr-focus="undo">Undo</button>`
                + (s.history.length > 1 ? ` <span class="sr-note">${plural(s.history.length - 1, 'more change')} to undo</span>` : '')
            : '';
        restoreFocus(token, `node:${s.sel}`);
    }

    function escapeText(t) {
        const div = document.createElement('div');
        div.textContent = String(t);
        return div.innerHTML;
    }

    const escapeAttr = (t) => escapeText(t).replace(/"/g, '&quot;');

    // ----------------------------------------------------------- changes

    // What a change can alter, kept before it to undo it: the choice, which
    // scans are excluded, and the group the report shows alone.
    function snapshotOf(payload) {
        return {
            grouping: payload.scanGrouping ? JSON.parse(JSON.stringify(payload.scanGrouping)) : null,
            excluded: payload.scans.filter((x) => x && x.includedInReport === false).map((x) => x.id),
            focus: app.runSummaryUi.groupFocus(payload),
        };
    }

    function restore(payload, snap) {
        if (snap.grouping) payload.scanGrouping = snap.grouping;
        else delete payload.scanGrouping;
        const excluded = new Set(snap.excluded);
        for (const scan of payload.scans) if (scan && scan.id) scan.includedInReport = !excluded.has(scan.id);
        app.runSummaryUi.setGroupFocus(payload, snap.focus);
    }

    /**
     * Makes a change: kept to undo, saved in the report, the report drawn
     * again as shown, and the review with it, focus on `focusAfter` (a
     * data-sr-focus key) or on the control that had it.
     */
    function change(message, fn, focusAfter) {
        const payload = payloadOf();
        if (!payload) return;
        const s = session(payload);
        if (s.baseInReport == null) s.baseInReport = app.runSummaryUi.reviewModelOf(payload)?.totals.inReport ?? null;
        const token = focusAfter || focusToken();
        s.history.push({snap: snapshotOf(payload), message});
        fn(payload, s);
        s.impactOpen = false;
        s.moreOpen = false;
        app.redrawAsShown(payload);
        render(token);
        status(message);
    }

    function undo() {
        const payload = payloadOf();
        if (!payload) return;
        const s = session(payload);
        const last = s.history.pop();
        if (!last) return;
        restore(payload, last.snap);
        app.redrawAsShown(payload);
        render(s.history.length ? 'undo' : `node:${s.sel}`);
        status(`Undone: ${last.message}`);
    }

    // The choice with group `key` saved in it, so it can be named, merged or
    // changed by hand: every pattern is a group, saved once acted on.
    function withEntry(choice, key) {
        const api = choiceApi();
        return choice.some((p) => p.key === key) ? choice : api.setChosen(choice, key, true);
    }

    function edit(payload, fn) {
        const api = choiceApi();
        api.writeChoice(payload, fn(api.readChoice(payload)));
    }

    function modelNode(payload, key) {
        const model = app.runSummaryUi.reviewModelOf(payload);
        return model ? view().nodeOf(model, key) : null;
    }

    // The scans as the review shows them: a context of a run's merged scan,
    // unmerged or taken out, a scan of its own (run-summary-ui.js
    // reviewScansOf), whose own id is "<scan id>~<index>".
    const reviewScans = (payload) => app.runSummaryUi.reviewScansOf(payload);
    // Or as saved: a run's merged scan unmerged is in the report's scans only.
    const scanOf = (payload, id) => reviewScans(payload).scans.find((x) => x && x.id === id)
        || payload.scans.find((x) => x && x.id === id) || null;

    const labelOf = (payload, id) => {
        const scan = scanOf(payload, id);
        return (scan && (scan.label || scan.id)) || id;
    };

    /**
     * Includes or excludes scans, as the report saves it: a scan of the
     * report on itself (includedInReport); a context of a run's merged scan,
     * which lives in that scan, in the choice (setRunContextExcluded).
     */
    function setIncluded(payload, ids, included) {
        const contexts = reviewScans(payload).contexts;
        const set = new Set(ids);
        const ofContexts = ids.filter((id) => contexts.has(id));
        for (const scan of payload.scans) if (scan && set.has(scan.id)) scan.includedInReport = included;
        if (ofContexts.length) {
            edit(payload, (c) => ofContexts.reduce((acc, id) => {
                const {scanId, index} = contexts.get(id);
                return choiceApi().setRunContextExcluded(acc, scanId, index, !included);
            }, c));
        }
    }

    // ---------------------------------------------------------- actions

    function act(key, action) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node) return;
        if (action === 'focus') {
            const on = app.runSummaryUi.groupFocus(payload) !== key;
            change(on ? `The report shows only ${node.name}.` : 'The report shows every scan again.',
                (p) => app.runSummaryUi.setGroupFocus(p, on ? key : null));
            return;
        }
        if (action === 'remove') {
            change(`Removed the group ${node.name}; its scans are shown as they were.`,
                (p, s) => {
                    edit(p, (c) => choiceApi().setChosen(c, key, false));
                    s.sel = view().REST;
                }, `node:${view().REST}`);
            return;
        }
        const plan = choiceApi().planAction(reviewScans(payload).scans, node.ids, action);
        const changes = plan.include.length + plan.exclude.length;
        if (!changes) {
            status(action === 'include'
                ? `Nothing to change: every scan of ${node.name} is already included.`
                : action === 'exclude'
                    ? `Nothing to change: every scan of ${node.name} is already excluded.`
                    : `Nothing to change: ${node.name} already has one scan included.`);
            return;
        }
        const message = action === 'include'
            ? `${plural(plan.include.length, 'scan')} of ${node.name} included in the report.`
            : action === 'exclude'
                ? `${plural(plan.exclude.length, 'scan')} of ${node.name} excluded from the report.`
                : `Kept ${labelOf(payload, node.ids.find((id) => !plan.exclude.includes(id)))} of ${node.name}; excluded ${plural(plan.exclude.length, 'other scan')}.`;
        change(message, (p) => {
            setIncluded(p, plan.include, true);
            setIncluded(p, plan.exclude, false);
        });
    }

    // Merging or unmerging, once what it changes was seen. The selection is
    // cleared: what it was for is now one scan, or many again.
    function applyMerge(key) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node) return;
        if (node.run) {
            runMerge(node.id, node.unmerged);
            return;
        }
        const merged = (choiceApi().readChoice(payload).find((p) => p.key === key) || {}).merge === true;
        change(merged ? `${node.name}: its scans shown each on its own again.` : `${node.name}: its ${plural(node.included, 'page')} shown as one merged scan.`,
            (p, s) => {
                edit(p, (c) => choiceApi().setMerged(c, key, !merged));
                s.selected.clear();
            }, 'merge');
    }

    // From a merged scan's card in the report: the review on its group, with
    // what unmerging changes, to apply or cancel there.
    function openUnmerge(key) {
        const payload = payloadOf();
        if (!payload || !key) return;
        ensureDialogs();
        const s = session(payload);
        s.sel = key;
        s.selected.clear();
        s.impactOpen = true;
        s.moreOpen = false;
        render('apply-merge');
        if (!dialog.open) dialog.showModal();
        restoreFocus('apply-merge', `node:${key}`);
    }

    function rename(key, raw) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node) return;
        const api = choiceApi();
        const before = (api.readChoice(payload).find((p) => p.key === key) || {}).name || null;
        const name = api.setName([{key, name: raw}], key, raw)[0].name;
        if (before === name) return;
        change(name ? `Named the group ${name}.` : `The group is shown by its pattern again.`,
            (p) => edit(p, (c) => api.setName(withEntry(c, key), key, raw)), 'name');
    }

    function takeOut(key, ids) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node || !ids.length) return;
        const gone = node.byHand && node.ids.length - ids.length < 2;
        change(gone
            ? `Took ${plural(ids.length, 'scan')} out of ${node.name}, which had no other scan to group: the group is gone.`
            : `Took ${ids.length === 1 ? labelOf(payload, ids[0]) : plural(ids.length, 'scan')} out of ${node.name}.`,
        (p, s) => {
            edit(p, (c) => ids.reduce((acc, id) => choiceApi().removeScan(withEntry(acc, key), key, id), c));
            s.selected.clear();
            if (gone) s.sel = view().REST;
        }, gone ? `node:${view().REST}` : 'select-all');
    }

    function putBack(key, id) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node) return;
        change(`Put ${labelOf(payload, id)} back in ${node.name}.`,
            (p) => edit(p, (c) => choiceApi().putBack(c, key, id)), `preview:${id}`);
    }

    function addTo(key, ids) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node || !ids.length) return;
        change(`Added ${plural(ids.length, 'scan')} to ${node.name}.`, (p, s) => {
            edit(p, (c) => ids.reduce((acc, id) => choiceApi().addScan(withEntry(acc, key), key, id), c));
            s.selected.clear();
        }, 'select-all');
    }

    function bulkInclude(ids, included) {
        if (!ids.length) return;
        change(`${included ? 'Included' : 'Excluded'} ${plural(ids.length, 'scan')}.`, (p, s) => {
            setIncluded(p, ids, included);
            s.selected.clear();
        }, 'select-all');
    }

    // Asks in a dialog of its own: a name and whether to merge, for a group
    // made by hand; a confirmation listing the scans, for excluding the rest.
    // Cancelled, focus goes back to the control that asked (`returnTo`, a
    // data-sr-focus key), drawn again without the menu it may have been in.
    function ask(title, bodyHTML, okText, onOk, returnTo) {
        askDlg.querySelector('#sr-ask-title').textContent = title;
        askDlg.querySelector('.sr-ask-body').innerHTML = bodyHTML;
        const ok = askDlg.querySelector('[data-sr-ask-ok]');
        ok.textContent = okText;
        let done = false;
        ok.onclick = () => {
            done = true;
            askDlg.close();
            onOk();
        };
        askDlg.onclose = () => {
            if (done || !dialog.open) return;
            const s = session(payloadOf());
            s.moreOpen = false;
            render(returnTo || null);
        };
        askDlg.showModal();
        (askDlg.querySelector('input[type=text], select') || ok).focus();
    }

    // Keeping one page excludes all the others: said, and asked, first.
    function keepOne(key) {
        const payload = payloadOf();
        const node = payload && modelNode(payload, key);
        if (!node) return;
        const plan = choiceApi().planAction(reviewScans(payload).scans, node.ids, 'keepOne');
        if (!plan.include.length && !plan.exclude.length) {
            act(key, 'keepOne');
            return;
        }
        const kept = node.ids.find((id) => !plan.exclude.includes(id));
        ask(`Keep one page of ${node.name}?`,
            `<p><bdi>${escapeText(labelOf(payload, kept))}</bdi> stays in the report; ${plural(plan.exclude.length, 'other page')} of the group ${plan.exclude.length === 1 ? 'is' : 'are'} excluded from it. It can be undone.</p>`
            + scanListHTML(payload, plan.exclude),
            `Exclude ${plural(plan.exclude.length, 'page')}`,
            () => act(key, 'keepOne'),
            'act:keepOne');
    }

    // Selected pages into another group, chosen in a dialog.
    function askAddTo(ids, targets) {
        const payload = payloadOf();
        if (!payload || !ids.length || !targets.length) return;
        ask(`Add ${plural(ids.length, 'scan')} to a group`,
            `<p class="sr-field"><label for="sr-add-target">Group</label><select id="sr-add-target">`
            + targets.map((t) => `<option value="${escapeAttr(t.key)}">${escapeText(t.name)}</option>`).join('') + '</select></p>'
            + scanListHTML(payload, ids),
            'Add',
            () => addTo(askDlg.querySelector('#sr-add-target').value, ids),
            'more');
    }

    function scanListHTML(payload, ids) {
        return `<ul class="sr-asklist">${ids.map((id) => {
            const scan = scanOf(payload, id);
            return `<li><bdi>${escapeText(labelOf(payload, id))}</bdi> <span class="sr-mono">${escapeText(view().pathOf(scan && scan.url))}</span></li>`;
        }).join('')}</ul>`;
    }

    function groupByHand(ids, returnTo) {
        const payload = payloadOf();
        if (!payload || ids.length < 2) {
            status('Choose two scans or more to group them by hand.');
            return;
        }
        ask(`Group ${plural(ids.length, 'scan')} by hand`,
            '<p class="sr-field"><label for="sr-hand-name">Name</label><input type="text" id="sr-hand-name" maxlength="200" autocomplete="off"></p>'
            + '<p><label class="sr-switch"><input type="checkbox" id="sr-hand-merge" checked> <span>Merge them into one scan</span></label></p>'
            + scanListHTML(payload, ids),
            'Make the group',
            () => {
                const name = askDlg.querySelector('#sr-hand-name').value;
                const merge = askDlg.querySelector('#sr-hand-merge').checked;
                const made = choiceApi().addManualGroup(choiceApi().readChoice(payload), {name, members: ids, merge});
                if (!made.key) return;
                change(`Grouped ${plural(ids.length, 'scan')} by hand${name.trim() ? ` as ${name.trim()}` : ''}${merge ? ', merged into one scan' : ''}.`,
                    (p, s) => {
                        choiceApi().writeChoice(p, made.choice);
                        s.sel = made.key;
                        s.selected.clear();
                    }, `node:${made.key}`);
            }, returnTo);
    }

    function excludeRest() {
        const payload = payloadOf();
        const node = payload && modelNode(payload, view().REST);
        if (!node || !node.ids.length) return;
        ask(`Exclude ${plural(node.ids.length, 'scan')} from the report?`,
            '<p>They leave the report\'s totals and its download. Scans grouped later stay as they are now: excluding is done once, scan by scan.</p>'
            + scanListHTML(payload, node.ids),
            `Exclude ${plural(node.ids.length, 'scan')}`,
            () => change(`Excluded the ${plural(node.ids.length, 'scan')} in no group.`, (p) => setIncluded(p, node.ids, false)),
            'rest:exclude');
    }

    /**
     * A run's merged scan unmerged into its contexts, or merged again as the
     * run made it. Merged again, its contexts are no longer scans of their
     * own: one put in a group (added to a template, grouped by hand, taken
     * out of one) leaves it, which is said, and asked, first.
     */
    function runMerge(scanId, merged) {
        const payload = payloadOf();
        if (!payload) return;
        const name = labelOf(payload, scanId);
        const apply = () => change(merged ? `${name} merged again, as the run made it.` : `${name} shown as its contexts, each a scan of its own.`,
            (p, s) => {
                edit(p, (c) => {
                    const next = choiceApi().setRunMerged(c, scanId, merged);
                    return merged ? choiceApi().releaseRunContexts(next, scanId) : next;
                });
                s.selected.clear();
            }, 'merge');
        const held = merged ? choiceApi().runContextsHeld(choiceApi().readChoice(payload), scanId) : [];
        if (!held.length) { apply(); return; }
        const model = app.runSummaryUi.reviewModelOf(payload);
        const groupName = (key) => (model && view().nodeOf(model, key)?.name) || key;
        const items = held.map((h) => `<li><bdi>${escapeText(groupName(h.key))}</bdi>: ${h.ids.map((id) => `<bdi>${escapeText(labelOf(payload, id))}</bdi>`).join(', ')}</li>`).join('');
        ask(`Merge ${name} again?`,
            `<p>Merged again, its contexts are no longer scans of their own, so they leave the groups you put them in:</p><ul class="sr-asklist">${items}</ul><p>Undo puts them back.</p>`,
            'Merge again', apply, 'merge');
    }

    function runContextOut(scanId, index, out) {
        const payload = payloadOf();
        if (!payload) return;
        const scan = scanOf(payload, scanId);
        const name = (scan && scan.contexts && scan.contexts[Number(index)] && scan.contexts[Number(index)].name) || `Context ${Number(index) + 1}`;
        change(out ? `${name} taken out of ${labelOf(payload, scanId)}, and shown on its own.` : `${name} put back in ${labelOf(payload, scanId)}.`,
            (p) => edit(p, (c) => choiceApi().setRunContextOut(c, scanId, index, out)), `${out ? 'run-back' : 'run-out'}:${scanId}:${index}`);
    }

    // ---------------------------------------------------------- the preview

    let previewIds = [];
    let previewId = null;

    function preview(id) {
        const payload = payloadOf();
        const v = view();
        if (!payload || !v) return;
        const model = app.runSummaryUi.reviewModelOf(payload);
        const s = session(payload);
        const node = v.nodeOf(model, s.sel);
        const issues = issuesFor(model, node);
        const scan = model.byId.get(id);
        if (!scan) return;
        // Previous and next follow the grid's order.
        previewIds = [...dialog.querySelectorAll('.sr-grid [data-sr-preview]')].map((b) => b.getAttribute('data-sr-preview'));
        previewId = id;
        const i = previewIds.indexOf(id);
        const d = issues && issues.byScan ? issues.byScan.get(id) || null : null;
        const title = scan.label || scan.id;
        previewDlg.querySelector('#sr-preview-title').textContent = title;
        previewDlg.querySelector('.sr-preview-body').innerHTML = v.previewHTML(scan, scanCardThumbnail(scan), d, {excluded: scan.includedInReport === false, issues});
        const group = node && !node.rest && !node.run;
        const inGroup = group && node.ids.includes(id);
        const where = i >= 0 ? `${i + 1} of ${previewIds.length}` : '';
        // Moving through the pages on the left, what to do with this one on
        // the right; excluding, which takes it out of the report, looks so.
        previewDlg.querySelector('.sr-foot').innerHTML = `<span class="sr-foot-nav"><button type="button" class="secondary-button" data-sr-nav="${escapeAttr(previewIds[i - 1] || '')}"${i > 0 ? '' : ' disabled'}>Previous</button>`
            + (where ? `<span class="sr-foot-pos">${where}</span>` : '')
            + `<button type="button" class="secondary-button" data-sr-nav="${escapeAttr(previewIds[i + 1] || '')}"${i >= 0 && i < previewIds.length - 1 ? '' : ' disabled'}>Next</button></span>`
            + `<span class="sr-foot-acts">`
            + (inGroup ? `<button type="button" class="secondary-button" data-sr-preview-out="${escapeAttr(id)}">Take out of ${escapeText(node.name)}</button>` : '')
            + `<button type="button" class="secondary-button${scan.includedInReport === false ? '' : ' sr-danger'}" data-sr-preview-toggle="${escapeAttr(id)}">${scan.includedInReport === false ? 'Include in the report' : 'Exclude from the report'}</button></span>`;
        // Moving keeps focus on Previous or Next: the page reached is said.
        const live = previewDlg.querySelector('.sr-preview-live');
        if (live) live.textContent = previewDlg.open ? `${title}${where ? `, ${where}` : ''}` : '';
        if (!previewDlg.open) previewDlg.showModal();
    }

    function onPreviewClick(e) {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-sr-close-preview')) { previewDlg.close(); return; }
        const nav = b.getAttribute('data-sr-nav');
        if (nav) {
            // Focus stays on the button pressed, or on the other when it ends.
            const which = b.textContent;
            preview(nav);
            const buttons = [...previewDlg.querySelectorAll('[data-sr-nav]')];
            const same = buttons.find((x) => x.textContent === which && !x.disabled);
            (same || buttons.find((x) => !x.disabled) || previewDlg.querySelector('[data-sr-close-preview]')).focus();
            return;
        }
        const out = b.getAttribute('data-sr-preview-out');
        if (out) {
            previewDlg.close();
            takeOut(session(payloadOf()).sel, [out]);
            return;
        }
        const toggle = b.getAttribute('data-sr-preview-toggle');
        if (toggle) {
            const payload = payloadOf();
            const scan = payload && scanOf(payload, toggle);
            if (!scan) return;
            const include = scan.includedInReport === false;
            change(`${include ? 'Included' : 'Excluded'} ${labelOf(payload, toggle)}.`, (p) => setIncluded(p, [toggle], include), `preview:${toggle}`);
            preview(toggle);
            previewDlg.querySelector('[data-sr-preview-toggle]')?.focus();
        }
    }

    // Closed, focus goes back to the picture of the page last seen, in the
    // grid; to the review's own focus when that page is no longer there.
    function onPreviewClose() {
        if (!dialog.open || !previewId) return;
        const key = `preview:${previewId}`;
        const target = [...dialog.querySelectorAll('[data-sr-focus]')].find((el) => el.getAttribute('data-sr-focus') === key);
        if (target && !dialog.contains(document.activeElement)) target.focus();
    }

    // ---------------------------------------------------------- events

    function selectedIds() {
        const payload = payloadOf();
        const s = session(payload);
        const shown = [...dialog.querySelectorAll('.sr-grid [data-sr-pick]')].map((el) => el.getAttribute('data-sr-pick'));
        return shown.filter((id) => s.selected.has(id));
    }

    function onClick(e) {
        const payload = payloadOf();
        if (!payload) return;
        const s = session(payload);
        const t = e.target.closest('button, [data-sr-pick]');
        // A click anywhere but in the More menu closes it. A page's checkbox
        // is drawn again by its change, which comes after this click.
        const closing = s.moreOpen && !(t && t.closest('.sr-more'));
        if (closing) s.moreOpen = false;
        if (!t || t.matches('[data-sr-pick]')) {
            if (closing && !t) render();
            return;
        }
        const d = t.dataset;
        if ('srClose' in d) { dialog.close(); return; }
        if ('srUndo' in d) { undo(); return; }
        // A branch or section of the tree folded or unfolded; focus stays on
        // its button.
        if (d.srToggle) {
            if (!s.collapsed) s.collapsed = new Set();
            if (t.getAttribute('aria-expanded') === 'true') s.collapsed.add(d.srToggle);
            else s.collapsed.delete(d.srToggle);
            render(`toggle:${d.srToggle}`);
            return;
        }
        if (d.srNode) {
            s.sel = d.srNode;
            s.selected.clear();
            s.impactOpen = false;
            render(`node:${d.srNode}`);
            return;
        }
        if (d.srPreview) { render(`preview:${d.srPreview}`); preview(d.srPreview); return; }
        if ('srSelectAll' in d) {
            const ids = [...dialog.querySelectorAll('.sr-grid [data-sr-pick]')].map((el) => el.getAttribute('data-sr-pick'));
            const all = ids.every((id) => s.selected.has(id));
            ids.forEach((id) => (all ? s.selected.delete(id) : s.selected.add(id)));
            render('select-all');
            return;
        }
        if ('srMore' in d) {
            s.moreOpen = !s.moreOpen;
            render(s.moreOpen ? 'bulk:byhand' : 'more');
            return;
        }
        if (d.srPutback) { putBack(s.sel, d.srPutback); return; }
        if (d.srBulk) {
            const ids = selectedIds();
            if (d.srBulk === 'out') takeOut(s.sel, ids);
            else if (d.srBulk === 'exclude') bulkInclude(ids, false);
            else if (d.srBulk === 'include') bulkInclude(ids, true);
            else if (d.srBulk === 'byhand') groupByHand(ids, 'more');
            else if (d.srBulk === 'add') {
                const model = app.runSummaryUi.reviewModelOf(payload);
                const flat = (list) => list.flatMap((n) => [n, ...flat(n.children || [])]);
                askAddTo(ids, flat([...model.patterns, ...model.byHand]).filter((n) => n.key !== s.sel).map((n) => ({key: n.key, name: n.name})));
            } else if (d.srBulk === 'clear') {
                s.selected.clear();
                s.moreOpen = false;
                render('select-all');
            }
            return;
        }
        if (d.srMerge) {
            // Not yet: what it changes is shown first, to apply or cancel;
            // pressed again while shown, it is cancelled.
            s.impactOpen = !s.impactOpen;
            render(s.impactOpen ? 'apply-merge' : 'merge');
            return;
        }
        if (d.srApplyMerge) { applyMerge(d.srApplyMerge); return; }
        if ('srCancelMerge' in d) { s.impactOpen = false; render('merge'); return; }
        if (d.srAct) {
            if (d.srAct === 'keepOne') keepOne(s.sel);
            else act(s.sel, d.srAct);
            return;
        }
        if (d.srRest) {
            const node = modelNode(payload, view().REST);
            if (d.srRest === 'focus') act(view().REST, 'focus');
            else if (d.srRest === 'byhand') groupByHand(node ? node.ids : [], 'rest:byhand');
            else if (d.srRest === 'exclude') excludeRest();
            return;
        }
        if (d.srRunOut) { runContextOut(d.srRunOut, d.srContext, true); return; }
        if (d.srRunBack) { runContextOut(d.srRunBack, d.srContext, false); return; }
        // A click that only closed the menu.
        if (closing) render();
    }

    function onChange(e) {
        const payload = payloadOf();
        if (!payload) return;
        const s = session(payload);
        const t = e.target;
        if (t.matches('[data-sr-pick]')) {
            const id = t.getAttribute('data-sr-pick');
            const ids = [...dialog.querySelectorAll('.sr-grid [data-sr-pick]')].map((el) => el.getAttribute('data-sr-pick'));
            // Shift selects the pages between this one and the last picked.
            if (e.shiftKey && s.anchor && ids.includes(s.anchor)) {
                const [a, b] = [ids.indexOf(s.anchor), ids.indexOf(id)].sort((x, y) => x - y);
                ids.slice(a, b + 1).forEach((x) => (t.checked ? s.selected.add(x) : s.selected.delete(x)));
            } else if (t.checked) s.selected.add(id);
            else s.selected.delete(id);
            s.anchor = id;
            render(`pick:${id}`);
            return;
        }
        if (t.matches('[data-sr-sort]')) { s.sort = t.value; render('sort'); return; }
        if (t.matches('[data-sr-name]')) { rename(t.getAttribute('data-sr-name'), t.value); }
    }

    function onKeydown(e) {
        // Escape closes the More menu first, not the review.
        if (e.key === 'Escape') {
            const s = payloadOf() && session(payloadOf());
            if (s && s.moreOpen) {
                e.preventDefault();
                e.stopPropagation();
                s.moreOpen = false;
                render('more');
                return;
            }
        }
        const name = e.target.closest && e.target.closest('[data-sr-name]');
        if (!name) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            rename(name.getAttribute('data-sr-name'), name.value);
        } else if (e.key === 'Escape') {
            const payload = payloadOf();
            const saved = (choiceApi().readChoice(payload).find((p) => p.key === name.getAttribute('data-sr-name')) || {}).name || '';
            if (name.value !== saved) {
                e.preventDefault();
                e.stopPropagation();
                name.value = saved;
            }
        }
    }

    // In the report: a scan's group, and a merged scan's pages, open the
    // review there; a merged scan's Unmerge opens it on what unmerging
    // changes.
    if (app.results) {
        app.results.addEventListener('click', (e) => {
            const film = e.target.closest('[data-sr-film]');
            if (film) {
                open(film.getAttribute('data-sr-group') || null);
                preview(film.getAttribute('data-sr-film'));
                return;
            }
            const unmerge = e.target.closest('[data-sr-unmerge]');
            if (unmerge) { openUnmerge(unmerge.getAttribute('data-sr-unmerge')); return; }
            const group = e.target.closest('[data-sr-open-group]');
            if (group) open(group.getAttribute('data-sr-open-group') || null);
        });
    }

    // The card's button, and the line that shows every scan again.
    const root = app.summaryEl;
    if (root) {
        root.addEventListener('click', (e) => {
            if (e.target.closest('[data-sr-open]')) { open(); return; }
            if (e.target.closest('[data-sr-unfocus]')) {
                const payload = payloadOf();
                if (!payload) return;
                const s = session(payload);
                s.history.push({snap: snapshotOf(payload), message: 'The report shows every scan again.'});
                app.runSummaryUi.setGroupFocus(payload, null);
                app.redrawAsShown(payload);
                status('The report shows every scan again.');
            }
        });
    }

    return {open, refresh, preview: (id) => { open(); preview(id); }};
}
