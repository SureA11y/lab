// How a report's findings are grouped: the grouping in use (built in, or
// loaded from a file), kept in local storage, and its picker. Moved out of
// a11y-ui.js; what it shares with the rest of the app it reaches through
// `app`.

import {groupings} from './config/groupings.js';
import {normalizeGroupingSpec} from './grouping-spec.js';
import {GROUPING_STATE_STORAGE_KEY, STATUS} from './ui-constants.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * (groupingFileInput, renderActiveBucket, renderer, resultsState, setStatusReport, setStatusRun, updateResults).
 */
export function createGroupingUi(app) {
    let groupingLoaded = false;
    let builtInGroupingSelectEls = [];
    let groupingPickerTargetMode = null;

    const groupingStateByMode = {
        run: {
            selectedBuiltInGroupingId: 'none',
            lastResolvedGroupingSelectionId: 'none',
            loadedCustomGrouping: null
        },
        report: {
            selectedBuiltInGroupingId: 'none',
            lastResolvedGroupingSelectionId: 'none',
            loadedCustomGrouping: null
        }
    };

    function normalizeStoredGroupingEntry(raw) {
        const out = {
            selectedBuiltInGroupingId: 'none',
            lastResolvedGroupingSelectionId: 'none',
            loadedCustomGrouping: null
        };

        if (!raw || typeof raw !== 'object') return out;

        const selectedBuiltInGroupingId = String(raw.selectedBuiltInGroupingId || 'none').trim() || 'none';
        const lastResolvedGroupingSelectionId = String(raw.lastResolvedGroupingSelectionId || 'none').trim() || 'none';

        out.selectedBuiltInGroupingId = selectedBuiltInGroupingId;
        out.lastResolvedGroupingSelectionId = lastResolvedGroupingSelectionId;

        const custom = raw.loadedCustomGrouping;
        if (
            custom &&
            typeof custom === 'object' &&
            String(custom.id || '').trim() &&
            String(custom.label || '').trim() &&
            Array.isArray(custom.groups)
        ) {
            const cleanedGroups = normalizeGroupingSpec(custom.groups);

            if (cleanedGroups.length) {
                out.loadedCustomGrouping = {
                    id: String(custom.id).trim(),
                    label: String(custom.label).trim(),
                    groups: cleanedGroups
                };
            }
        }

        if (out.selectedBuiltInGroupingId === 'custom-loaded' && !out.loadedCustomGrouping) {
            out.selectedBuiltInGroupingId = out.lastResolvedGroupingSelectionId || 'none';
            if (out.selectedBuiltInGroupingId === 'custom-loaded') {
                out.selectedBuiltInGroupingId = 'none';
            }
        }

        if (out.lastResolvedGroupingSelectionId === 'custom-loaded' && !out.loadedCustomGrouping) {
            out.lastResolvedGroupingSelectionId = 'none';
        }

        return out;
    }

    function loadGroupingStateFromStorage() {
        try {
            const raw = localStorage.getItem(GROUPING_STATE_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;

            const runEntry = normalizeStoredGroupingEntry(parsed.run);
            const reportEntry = normalizeStoredGroupingEntry(parsed.report);

            groupingStateByMode.run = runEntry;
            groupingStateByMode.report = reportEntry;
        } catch {
            // ignore storage errors
        }
    }

    function saveGroupingStateToStorage() {
        try {
            const payload = {
                run: {
                    selectedBuiltInGroupingId: groupingStateByMode.run.selectedBuiltInGroupingId,
                    lastResolvedGroupingSelectionId: groupingStateByMode.run.lastResolvedGroupingSelectionId,
                    loadedCustomGrouping: groupingStateByMode.run.loadedCustomGrouping
                },
                report: {
                    selectedBuiltInGroupingId: groupingStateByMode.report.selectedBuiltInGroupingId,
                    lastResolvedGroupingSelectionId: groupingStateByMode.report.lastResolvedGroupingSelectionId,
                    loadedCustomGrouping: groupingStateByMode.report.loadedCustomGrouping
                }
            };

            localStorage.setItem(GROUPING_STATE_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // ignore storage errors
        }
    }

    function getGroupingState(mode = app.resultsState.activeMode) {
        return mode === 'report'
            ? groupingStateByMode.report
            : groupingStateByMode.run;
    }

    function getSelectedBuiltInGroupingId(mode = app.resultsState.activeMode) {
        return getGroupingState(mode).selectedBuiltInGroupingId;
    }

    function setSelectedBuiltInGroupingId(value, mode = app.resultsState.activeMode) {
        getGroupingState(mode).selectedBuiltInGroupingId = value;
        saveGroupingStateToStorage();
    }

    function getLastResolvedGroupingSelectionId(mode = app.resultsState.activeMode) {
        return getGroupingState(mode).lastResolvedGroupingSelectionId;
    }

    function setLastResolvedGroupingSelectionId(value, mode = app.resultsState.activeMode) {
        getGroupingState(mode).lastResolvedGroupingSelectionId = value;
        saveGroupingStateToStorage();
    }

    function getLoadedCustomGrouping(mode = app.resultsState.activeMode) {
        return getGroupingState(mode).loadedCustomGrouping;
    }

    function setLoadedCustomGrouping(value, mode = app.resultsState.activeMode) {
        getGroupingState(mode).loadedCustomGrouping = value;
        saveGroupingStateToStorage();
    }

    loadGroupingStateFromStorage();

    function normalizeGroupingPresetList(list) {
        if (!Array.isArray(list)) return [];

        return list
            .map((item) => {
                if (!item || typeof item !== 'object') return null;

                const id = String(item.id || '').trim();
                const label = String(item.label || '').trim();
                const groups = Array.isArray(item.groups) ? item.groups : [];

                if (!id || !label || !groups.length) return null;

                return {
                    id,
                    label,
                    groups
                };
            })
            .filter(Boolean);
    }

    function getAvailableBuiltInGroupings(mode = app.resultsState.activeMode) {
        const items = [
            {id: 'none', label: 'None', groups: null},
            ...normalizeGroupingPresetList(groupings)
        ];

        const loadedCustomGrouping = getLoadedCustomGrouping(mode);
        if (loadedCustomGrouping) {
            items.push(loadedCustomGrouping);
        }

        items.push({id: 'custom', label: 'Custom...', groups: null});

        return items;
    }

    function findBuiltInGroupingById(id, mode = app.resultsState.activeMode) {
        const wanted = String(id || 'none').trim() || 'none';
        return getAvailableBuiltInGroupings(mode).find((item) => item.id === wanted) || null;
    }

    function refreshBuiltInGroupingSelectOptions(mode = app.resultsState.activeMode) {
        if (!builtInGroupingSelectEls.length) return;

        const currentValue = getSelectedBuiltInGroupingId(mode);
        const available = getAvailableBuiltInGroupings(mode);

        builtInGroupingSelectEls.forEach((selectEl) => {
            if (!selectEl) return;

            selectEl.innerHTML = '';

            for (const item of available) {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.label;
                if (item.id === currentValue) opt.selected = true;
                selectEl.appendChild(opt);
            }

            selectEl.value = findBuiltInGroupingById(currentValue, mode) ? currentValue : 'none';
        });
    }

    function applySelectedBuiltInGrouping(mode = app.resultsState.activeMode) {
        const selectedBuiltInGroupingId = getSelectedBuiltInGroupingId(mode);
        const selected = findBuiltInGroupingById(selectedBuiltInGroupingId, mode);

        if (!selected || selected.id === 'custom' || !selected.groups) {
            app.renderer.setIssueGroupingSpec(null);
        } else {
            app.renderer.setIssueGroupingSpec(selected.groups);
            setLastResolvedGroupingSelectionId(selected.id, mode);
        }

        if (selected && selected.id === 'none') {
            setLastResolvedGroupingSelectionId('none', mode);
        }

        if (mode === app.resultsState.activeMode) {
            app.renderActiveBucket();
        }
    }

    function buildVisualizationGroupingSelect() {
        const wrapper = document.createElement('div');

        const selectId = 'results-grouping-select';

        const label = document.createElement('label');
        label.textContent = 'Grouping';
        label.htmlFor = selectId;
        wrapper.appendChild(label);

        const select = document.createElement('select');
        select.id = selectId;
        select.name = 'resultsGrouping';

        const mode = app.resultsState.activeMode;
        const available = getAvailableBuiltInGroupings(mode);
        const selectedValue = findBuiltInGroupingById(getSelectedBuiltInGroupingId(mode), mode)
            ? getSelectedBuiltInGroupingId(mode)
            : 'none';;

        for (const item of available) {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.label;
            if (item.id === selectedValue) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }

        wrapper.appendChild(select);

        select.addEventListener('change', () => {
            const value = select.value;
            const nextValue = findBuiltInGroupingById(value, mode) ? value : 'none';

            if (nextValue === 'custom') {
                groupingPickerTargetMode = mode;
                app.groupingFileInput?.click();

                // Restore visible selection to the current resolved one,
                // because the custom file picker has not loaded anything yet.
                select.value = findBuiltInGroupingById(getSelectedBuiltInGroupingId(mode), mode)
                    ? getSelectedBuiltInGroupingId(mode)
                    : 'none';
                return;
            }

            setSelectedBuiltInGroupingId(nextValue, mode);
            app.updateResults(select, () => {
                applySelectedBuiltInGrouping(mode);
                announceGrouping();
            });
        });

        function announceGrouping() {
            const selectedGrouping = findBuiltInGroupingById(
                getSelectedBuiltInGroupingId(mode),
                mode
            );
            const labelText = selectedGrouping?.label || 'None';

            if (mode === 'report') {
                app.setStatusReport(
                    getSelectedBuiltInGroupingId(mode) === 'none'
                        ? 'Grouping disabled.'
                        : `Grouping applied: ${labelText}`,
                    STATUS.OK
                );
            } else {
                app.setStatusRun(
                    getSelectedBuiltInGroupingId(mode) === 'none'
                        ? 'Grouping disabled.'
                        : `Grouping applied: ${labelText}`,
                    STATUS.OK
                );
            }
        }

        return wrapper;
    }

    function updateGroupingButtonUi() {
        // No-op for now, old custom grouping buttons are hidden.
    }

    function setGroupingLoaded(isLoaded) {
        groupingLoaded = !!isLoaded;
        updateGroupingButtonUi();
    }

    setGroupingLoaded(false);

    // track simple iteration vars for placeholder resolution
    const liveVarState = {
        index: undefined, // zero-based
        oneBased: undefined, // one-based
        total: undefined,
        vars: Object.create(null)
    };

    // The step counter for the run in flight. Rebuilt per run because it is
    // seeded from that run's actions, and cleared between runs so a stale plan
    // can never be counted against new logs.
    const liveStepState = {counter: null};

    return {
        applySelectedBuiltInGrouping,
        buildVisualizationGroupingSelect,
        findBuiltInGroupingById,
        getLastResolvedGroupingSelectionId,
        getSelectedBuiltInGroupingId,
        get groupingPickerTargetMode() { return groupingPickerTargetMode; },
        set groupingPickerTargetMode(value) { groupingPickerTargetMode = value; },
        get liveStepState() { return liveStepState; },
        get liveVarState() { return liveVarState; },
        refreshBuiltInGroupingSelectOptions,
        setLoadedCustomGrouping,
        setSelectedBuiltInGroupingId,
    };
}
