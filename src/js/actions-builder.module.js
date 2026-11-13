import {createEl, iconButton, svgIcon} from './a11y-ui.utils.js';
import { HorizontalStepper } from './horizontal-stepper.js';
import { normalizeTagList, filterTagSuggestions } from './tags-input.js';
import {createStepPalette} from './step-palette.js';
import {createStepValues} from './step-values.js';
import {createStepValidation} from './step-validation.js';
import {createStepLine} from './step-line.js';
import {createStepFields} from './step-fields.js';
import {createStepInfo} from './step-info.js';
import {createStepActionsMenu} from './step-actions-menu.js';

export { normalizeTagList, filterTagSuggestions };

export const SHORTCUTS = ['a11yScan', 'click', 'screenshot'];

// ---- Primary/advanced split ----
function isPrimaryField(fieldDef) {
    if (!fieldDef) return false;

    const imp = fieldDef.importance;

    // explicit primary flag
    if (imp && typeof imp === "object" && imp.primary === true) return true;

    // string or numeric shorthand
    if (imp === "primary" || imp === 1) return true;

    // fallback: required fields are always primary
    if (fieldDef.required) return true;

    return false;
}

function splitPrimaryAndAdvanced(entries) {
    const primary = [];
    const advanced = [];
    for (const e of entries) {
        const def = e[1] || {};
        if (isPrimaryField(def)) primary.push(e);
        else advanced.push(e);
    }
    return {primary, advanced};
}

// ---- setViewport preset/custom-size resolution ----
// setViewport's runtime (workflow-engine.js) always gives explicit width/height
// precedence over the "preset" value. These pure helpers decide when the UI
// should represent that state as "Custom size" instead, so the visible control
// always matches what actually applies.
function isPositiveFiniteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
}

export const SELECT_TOKEN_SENTINEL = "__token__";

// ---- Number fields ----
// A number field holds either a literal number or a single variable token such
// as {var:count}. The token is kept as text in the saved step; the engine turns
// the variable's value into a number when the step runs.
const NUMBER_FIELD_TEXT_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NUMBER_FIELD_TOKEN_RE = /^\{(?:var:[a-zA-Z0-9_.-]+|index|oneBased|total)\}$/;

/** Reads a number field's text: {kind: "number", value}, {kind: "token", value} or null. */
export function parseNumberFieldText(text, {integer = false} = {}) {
    const t = String(text ?? "").trim();
    if (NUMBER_FIELD_TOKEN_RE.test(t)) return {kind: "token", value: t};
    if (!NUMBER_FIELD_TEXT_RE.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return null;
    return {kind: "number", value: n};
}

// ---- Masked fields ----
// A secret field (secret: true in the action definitions, the value of "Set
// password value") is hidden on screen by default and never leaves the browser:
// saved configs, the run spec inside them, and the shareable link all go
// without it. What travels instead is `<field>Masked: true`, so the app can show
// the field as empty on purpose, and the runner can fail with a useful message
// rather than typing an empty string into the page. Its eye button only reveals
// the value on screen; a revealed value is still not saved.
export const MASKED_FLAG_SUFFIX = "Masked";

export function maskedFlagKey(fieldName) {
    return `${fieldName}${MASKED_FLAG_SUFFIX}`;
}

export const MASKED_VALUE_PLACEHOLDER = "Type it again: not saved with the configuration";

// A secret field can name an environment variable instead of holding the
// secret, {"$env": "SHOP_PASSWORD"} (src/shared/secret-refs.js): whatever runs
// the workflow reads it there. The field shows the reference, which is saved
// as it is; typing a value replaces it.
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The variable a secret reference names, or null for anything else. */
export function secretRefName(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === 1 && typeof value.$env === "string" && ENV_NAME_RE.test(value.$env)
        ? value.$env
        : null;
}

// "Set field value" steps used to hide their value with the eye button, which
// also kept it out of saved configs. Hidden values are their own step type now,
// so a step saved that way loads as "Set password value" and stays unsaved.
export function withPasswordStepType(actionObj) {
    if (!actionObj || typeof actionObj !== "object") return actionObj;
    if (actionObj.type !== "setValue" || actionObj[maskedFlagKey("value")] !== true) return actionObj;
    return {...actionObj, type: "setPassword"};
}

/** withPasswordStepType() over a list of steps and every step nested in them. */
export function withPasswordStepTypeDeep(actions) {
    if (Array.isArray(actions)) return actions.map(withPasswordStepTypeDeep);
    if (!actions || typeof actions !== "object") return actions;

    const out = {};
    for (const [key, value] of Object.entries(withPasswordStepType(actions))) {
        out[key] = Array.isArray(value) ? withPasswordStepTypeDeep(value) : value;
    }
    return out;
}

// ---- What a loaded step does not use ----
// A step keeps only the keys its fields and lists of steps read: anything
// else in a file (a switch's cases under "actions", "selector" on an if) is
// gone once the step is loaded, and would be gone from the file once saved
// again. These are what the editor says it left out, so the loss is not
// silent. Besides its fields, a step keeps these of its own.
const STEP_OWN_KEYS = new Set(["type", "alias", "disabled", "collapsed"]);

/** How many steps a value holds, those nested in them too. */
function countStepsIn(value) {
    if (Array.isArray(value)) return value.reduce((n, v) => n + countStepsIn(v), 0);
    if (!value || typeof value !== "object") return 0;
    const self = typeof value.type === "string" ? 1 : 0;
    return self + Object.values(value).reduce((n, v) => n + (Array.isArray(v) ? countStepsIn(v) : 0), 0);
}

/**
 * The keys of a list of steps, and of the steps nested in them, that the
 * editor does not use: [{path, type, label, key, steps}], `path` numbered by
 * the step's place in the list ("3", "3.1" for the first step nested in it),
 * `steps` the steps the key held, which are left out with it. A step of a
 * type the editor does not have is not looked into: it is left out whole,
 * and said so elsewhere. Empty values (null, "") lose nothing.
 */
export function unusedStepKeys(actions, defs, prefix = "") {
    const out = [];
    (Array.isArray(actions) ? actions : []).forEach((action, i) => {
        if (!action || typeof action !== "object") return;
        const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
        const def = defs && defs[action.type];
        if (!def) return;
        const fields = def.fields || {};
        for (const [key, value] of Object.entries(action)) {
            if (value === undefined || value === null || value === "") continue;
            if (STEP_OWN_KEYS.has(key) || Object.prototype.hasOwnProperty.call(fields, key)) continue;
            if (key.endsWith(MASKED_FLAG_SUFFIX) && Object.prototype.hasOwnProperty.call(fields, key.slice(0, -MASKED_FLAG_SUFFIX.length))) continue;
            out.push({path, type: action.type, label: def.label || action.type, key, steps: countStepsIn(value)});
        }
        for (const [key, fieldDef] of Object.entries(fields)) {
            if (String(fieldDef?.type || "").toLowerCase().includes("action[]") && Array.isArray(action[key])) {
                out.push(...unusedStepKeys(action[key], defs, path));
            }
        }
    });
    return out;
}

/**
 * The keys unusedStepKeys() found, a sentence per step, in the order of the
 * file: "Step 8 (Switch): 'actions' was not used, so 6 nested steps were
 * left out". `where` names the list ("Custom step “login”, step") for steps
 * that are not the workflow's.
 */
export function describeUnusedStepKeys(unused, where = "Step") {
    const byStep = new Map();
    for (const u of Array.isArray(unused) ? unused : []) {
        if (!byStep.has(u.path)) byStep.set(u.path, {label: u.label, keys: []});
        byStep.get(u.path).keys.push(u);
    }
    return Array.from(byStep, ([path, {label, keys}]) => {
        const said = keys.map((k) => {
            const lost = k.steps ? `, so ${k.steps === 1 ? "1 nested step was" : `${k.steps} nested steps were`} left out` : "";
            return `'${k.key}' was not used${lost}`;
        });
        return `${where} ${path} (${label}): ${said.join("; ")}`;
    });
}

/** Strips every masked field flagged by maskedFlagKey() from an action tree,
 *  for callers holding plain action objects rather than a live builder (custom
 *  steps, which keep their values in memory so runs from the app still work). */
export function redactMaskedFieldsDeep(actions) {
    if (Array.isArray(actions)) return actions.map(redactMaskedFieldsDeep);
    if (!actions || typeof actions !== "object") return actions;

    const masked = new Set(
        Object.keys(actions)
            .filter((k) => k.endsWith(MASKED_FLAG_SUFFIX) && actions[k] === true)
            .map((k) => k.slice(0, -MASKED_FLAG_SUFFIX.length))
            .filter(Boolean)
    );

    const out = {};
    for (const [key, value] of Object.entries(actions)) {
        if (masked.has(key)) continue;
        out[key] = redactMaskedFieldsDeep(value);
    }
    return out;
}

export function isTokenizedSelectValue(v) {
    if (v == null) return false;
    return /^\{var:[a-zA-Z0-9_.-]+\}$/.test(String(v).trim());
}

export function resolveSelectValueForUi({ value, allowedValues } = {}) {
    const normalized = value == null ? "" : String(value);
    const allowedSet = new Set(Array.isArray(allowedValues) ? allowedValues.map(String) : []);
    const hasExactOption = normalized !== "" && allowedSet.has(normalized);
    if (hasExactOption) return { selectValue: normalized, tokenValue: "" };
    if (normalized !== "") return { selectValue: SELECT_TOKEN_SENTINEL, tokenValue: normalized };
    return { selectValue: "", tokenValue: "" };
}

export function resolveSelectValueForSerialization({ selectValue, tokenValue } = {}) {
    if (String(selectValue || "") !== SELECT_TOKEN_SENTINEL) return selectValue;
    return String(tokenValue == null ? "" : tokenValue).trim();
}

export function resolveSetViewportPresetValue({presetValue, width, height} = {}) {
    const hasCustomSize = isPositiveFiniteNumber(width) || isPositiveFiniteNumber(height);
    if (hasCustomSize) return "custom";
    return presetValue;
}

// Returns actionObj unchanged unless it's a setViewport action whose width/height
// require the preset to be shown/saved as "custom" - in which case a shallow copy
// with preset overridden is returned. Never mutates the input.
export function withResolvedSetViewportPreset(actionObj) {
    if (!actionObj || typeof actionObj !== "object" || actionObj.type !== "setViewport") return actionObj;

    const hasPreset = Object.prototype.hasOwnProperty.call(actionObj, "preset");
    const resolved = resolveSetViewportPresetValue({
        presetValue: hasPreset ? actionObj.preset : undefined,
        width: actionObj.width,
        height: actionObj.height
    });

    if (resolved === undefined) return actionObj;
    if (hasPreset && resolved === actionObj.preset) return actionObj;

    return {...actionObj, preset: resolved};
}

// ---- Copy/Paste clipboard (in-memory, shared by every builder instance) ----
// The workflow and the custom-step editor are separate builder instances, so
// keeping the clipboard here - instead of inside createActionsBuilder() - is
// what lets an action copied in one be pasted into the other.
export let clipboardAction = null;
const pasteButtons = new Set();

// A paste button is enabled when there is a copied step its list takes: a
// switch's cases list only takes cases, every other list anything but a case.
function pasteButtonDisabled(btn) {
    if (!clipboardAction) return true;
    return typeof btn._accepts === "function" && !btn._accepts(clipboardAction.type);
}

export function setClipboardAction(actionObj) {
    clipboardAction = actionObj ? JSON.parse(JSON.stringify(actionObj)) : null;
    // Update all paste buttons state
    for (const btn of pasteButtons) {
        if (!btn || !btn.isConnected) continue;
        btn.disabled = pasteButtonDisabled(btn);
    }
}

export function registerPasteButton(btn, accepts = null) {
    if (!btn) return;
    btn._accepts = accepts;
    pasteButtons.add(btn);
    btn.disabled = pasteButtonDisabled(btn);
}

export function createActionsBuilder ({
                                       defs,
                                       toolbarEl,
                                       actionsEl,
                                       options = {}
                                   }) {
    // ---- Guardrails ----
    // What the parts moved into modules of their own reach of the rest:
    // accessors, so they read and set the values as they are.
    const builder = {
        get actionsEl() { return actionsEl; },
        get addShortcuts() { return addShortcuts; },
        get defs() { return defs; },
        get focusFirstInput() { return focusFirstInput; },
        get isListedType() { return isListedType; },
        get listedDefs() { return listedDefs; },
        get makeLine() { return stepLine.makeLine; },
        get moveLine() { return moveLine; },
        get populateLineFromObject() { return stepValues.populateLineFromObject; },
        get pushHistory() { return pushHistory; },
        get randomId() { return randomId; },
        get refreshReorderButtons() { return refreshReorderButtons; },
        get rootAddLine() { return rootAddLine; },
        get toolbarTargets() { return toolbarTargets; },
        get collapseAction() { return collapseAction; },
        get droppedWhileLoading() { return droppedWhileLoading; },
        set droppedWhileLoading(value) { droppedWhileLoading = value; },
        get expandAction() { return expandAction; },
        get isEffectivelyDisabled() { return stepActionsMenu.isEffectivelyDisabled; },
        get isExplicitDisabled() { return isExplicitDisabled; },
        get listLines() { return listLines; },
        get refreshActionArraySummary() { return refreshActionArraySummary; },
        get setLineExplicitDisabled() { return setLineExplicitDisabled; },
        get RESERVED_ERROR_ATTR() { return RESERVED_ERROR_ATTR; },
        get engineOfLine() { return engineOfLine; },
        get invalidCssSelector() { return invalidCssSelector; },
        get reservedVariableConflict() { return reservedVariableConflict; },
        get secretsOptional() { return secretsOptional; },
        set secretsOptional(value) { secretsOptional = value; },
        get setError() { return setError; },
        get unknownRuleIds() { return unknownRuleIds; },
        get applyDisabledState() { return applyDisabledState; },
        get applyEngineToLine() { return applyEngineToLine; },
        get buildActionInfoContent() { return stepInfo.buildActionInfoContent; },
        get createResponsiveActionsMenu() { return stepActionsMenu.createResponsiveActionsMenu; },
        get fieldActionArray() { return stepFields.fieldActionArray; },
        get fieldInputFor() { return stepFields.fieldInputFor; },
        get isActionArrayField() { return isActionArrayField; },
        get isNestedLine() { return isNestedLine; },
        get opts() { return opts; },
        get rootRemoveLine() { return rootRemoveLine; },
        get rootStepper() { return rootStepper; },
        set rootStepper(value) { rootStepper = value; },
        get splitFieldsForAction() { return splitFieldsForAction; },
        get stepValues() { return stepValues; },
        get toggleAction() { return toggleAction; },
        get updateLineTitles() { return updateLineTitles; },
        get branchChipFor() { return branchChipFor; },
        get options() { return options; },
        get scheduleHistoryPush() { return scheduleHistoryPush; },
        get stepLine() { return stepLine; },
        get stepPalette() { return stepPalette; },
        get isInheritedDisabled() { return isInheritedDisabled; },
    };

    if (!defs || typeof defs !== "object") {
        throw new Error('createActionsBuilder : "defs" (action definitions) is required');
    }
    const toolbarTargets = Array.isArray(toolbarEl) ? toolbarEl : [toolbarEl];

    // While appendActions loads a step, the steps nested in it that the
    // builder does not have (populateLineFromObject leaves them out). Up here
    // with the rest of the builder's state, as setup may already load steps.
    let droppedWhileLoading = null;

    // ---- Batch row variables (setReservedVariableNames) ----
    // Names a batch row sets while the batch is on. A step that would hide or
    // remove one of them is a field error, live and at validation. Declared up
    // here: history pushes during setup already refresh these errors.
    let reservedVarNames = new Set();
    const RESERVED_ERROR_ATTR = "data-reserved-var-error";
    // The fields that name a variable a step creates, removes or passes on.
    const VARIABLE_NAME_FIELDS = {
        setVar: ["key"],
        getText: ["var"],
        getCount: ["var"],
        clearVar: ["key"],
        runCustomStep: ["exportVars", "argsJson"],
    };

    // ---- Undo / Redo history ----
    const HISTORY_MAX = 60;
    const undoStack = [];
    const redoStack = [];
    let isRestoringHistory = false;

    const historyButtons = {
        undo: new Set(),
        redo: new Set()
    };

    function getHistoryState() {
        return {
            canUndo: undoStack.length > 1,
            canRedo: redoStack.length > 0,
            undoCount: Math.max(0, undoStack.length - 1),
            redoCount: redoStack.length
        };
    }

    function updateHistoryButtons() {
        const st = getHistoryState();

        for (const b of historyButtons.undo) {
            if (!b || !b.isConnected) continue;
            b.disabled = !st.canUndo;
        }
        for (const b of historyButtons.redo) {
            if (!b || !b.isConnected) continue;
            b.disabled = !st.canRedo;
        }
    }

    function registerHistoryButton(kind, btn) {
        if (!btn) return;
        if (kind === 'undo') historyButtons.undo.add(btn);
        if (kind === 'redo') historyButtons.redo.add(btn);
        updateHistoryButtons();
    }

    function snapshotForHistory() {
        return stepValues.readContainer(actionsEl);
    }

    let lastHistorySig = null;

    function stableStringify(value) {
        const seen = new WeakSet();

        function norm(v) {
            if (v === null || typeof v !== "object") return v;

            if (seen.has(v)) return null; // should not happen here, but keep safe
            seen.add(v);

            if (Array.isArray(v)) return v.map(norm);

            const out = {};
            for (const k of Object.keys(v).sort()) {
                out[k] = norm(v[k]);
            }
            return out;
        }

        return JSON.stringify(norm(value));
    }

    function snapshotsEqual(a, b) {
        try {
            return stableStringify(a) === stableStringify(b);
        } catch {
            return false;
        }
    }

    function pushHistory(reason = '', { force = false } = {}) {
        // Every edit lands here, so the row-variable check and the steps that
        // need a password stay live.
        refreshReservedVariableErrors();
        refreshPasswordNeeds();
        if (isRestoringHistory) return;

        const snap = snapshotForHistory();

        // Fast stable signature check
        let sig = null;
        try {
            sig = stableStringify(snap);
        } catch {
            sig = null;
        }

        // If this snapshot is exactly the same as the last pushed one, skip
        if (!force && sig && lastHistorySig === sig) return;

        const prev = undoStack.length ? undoStack[undoStack.length - 1] : null;

        // Keep the existing comparison too (acts as fallback)
        if (!force && prev && snapshotsEqual(prev, snap)) {
            if (sig) lastHistorySig = sig;
            return;
        }

        undoStack.push(snap);

        // cap
        if (undoStack.length > HISTORY_MAX) undoStack.splice(0, undoStack.length - HISTORY_MAX);

        // any new action clears redo
        redoStack.length = 0;

        // update last sig after push
        if (sig) lastHistorySig = sig;

        updateHistoryButtons();
    }

    // Debounced history push for typing
    let historyDebounceT = null;
    function scheduleHistoryPush(reason = 'edit') {
        if (isRestoringHistory) return;
        if (historyDebounceT) clearTimeout(historyDebounceT);
        historyDebounceT = setTimeout(() => {
            historyDebounceT = null;
            pushHistory(reason);
        }, 250);
    }

    function restoreFromHistorySnapshot(actionList) {
        isRestoringHistory = true;
        try {
            // IMPORTANT: do NOT auto-inject default action here
            clear();
            appendActions(Array.isArray(actionList) ? actionList : [], { focusFirst: false, callback: () => {} });
            refreshReorderButtons(actionsEl);
            try {
                lastHistorySig = stableStringify(actionList);
            } catch {
                lastHistorySig = null;
            }
        } finally {
            isRestoringHistory = false;
            updateHistoryButtons();
            refreshReservedVariableErrors();
        }
    }

    function undo() {
        if (undoStack.length <= 1) return false;

        const current = undoStack.pop();
        redoStack.push(current);

        const prev = undoStack[undoStack.length - 1];
        restoreFromHistorySnapshot(prev);

        return true;
    }

    function redo() {
        if (!redoStack.length) return false;

        const next = redoStack.pop();
        undoStack.push(next);

        restoreFromHistorySnapshot(next);

        return true;
    }

    function createUndoButton({
        className = "secondary-button undo-button icon-button",
        ariaLabel = "Undo",
        title = "Undo"
    } = {}) {
        const btn = iconButton({ className, ariaLabel, title, iconName: "undo", type: "button" });
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            undo();
        });
        registerHistoryButton('undo', btn);
        return btn;
    }

    function createRedoButton({
        className = "secondary-button redo-button icon-button",
        ariaLabel = "Redo",
        title = "Redo"
    } = {}) {
        const btn = iconButton({ className, ariaLabel, title, iconName: "redo", type: "button" });
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            redo();
        });
        registerHistoryButton('redo', btn);
        return btn;
    }

    function attachHistoryButtons({ undoBtn, redoBtn } = {}) {
        if (undoBtn) registerHistoryButton('undo', undoBtn);
        if (redoBtn) registerHistoryButton('redo', redoBtn);
        updateHistoryButtons();
    }

    if (!toolbarTargets.length || toolbarTargets.some((el) => !(el instanceof HTMLElement))) {
        throw new Error('createActionsBuilder : "toolbarEl" must be a DOM element or an array of DOM elements');
    }
    if (!(actionsEl instanceof HTMLElement)) {
        throw new Error('createActionsBuilder : "actionsEl" must be a DOM element');
    }

    // ---- Field ordering for consistent UI ----
    const FIELD_ORDER_BUCKETS = [
        ["id", "label", "name"],
        ["selector", "targetSelector", "attr", "context", "clickWithin", "url"],
        ["text", "value", "keys", "profile", "tags"],
        [
            "waitUntil",
            "waitForSelector",
            "waitVisible",
            "waitTimeout",
            "goBack",
            "reverse",
            "limit",
            "dynamic",
            "navigateBy",
            "iterSetupActions",
            "preActions",
            "actions",
            "elseActions"
        ],
        ["timeout", "retries", "retryDelay", "delay", "visible"],
        [
            "var",
            "key",
            "equals",
            "value",
            "selectorTextEquals",
            "selectorTextContains",
            "attrEquals",
            "attrContains",
            "urlIncludes"
        ],
        ["exclude", "includeRuleIds", "excludeRuleIds", "includeTags", "excludeTags", "includeMode", "runOnly", "disableRules", "to", "y", "width", "height", "caseSensitive", "exact"],
        ["optional"]
    ];

    const FIELD_WEIGHT = (() => {
        const map = new Map();
        FIELD_ORDER_BUCKETS.forEach((bucket, i) => {
            bucket.forEach((name, j) => map.set(name, i * 100 + j));
        });
        return (name) => (map.has(name) ? map.get(name) : 9999);
    })();

    function sortFieldsForUI(entries) {
        return entries.sort(([a, aDef], [b, bDef]) => {
            const wa = FIELD_WEIGHT(a);
            const wb = FIELD_WEIGHT(b);
            if (wa !== wb) return wa - wb;
            const reqA = !!(aDef && aDef.required);
            const reqB = !!(bDef && bDef.required);
            if (reqA !== reqB) return reqA ? -1 : 1;
            return a.localeCompare(b);
        });
    }

    function splitFieldsForAction(actionDef) {
        const entries = Object.entries((actionDef && actionDef.fields) ? actionDef.fields : {});
        const fieldOrder = actionDef && actionDef.fieldOrder;

        const hasFieldOrder = !!(fieldOrder && (Array.isArray(fieldOrder.primary) || Array.isArray(fieldOrder.secondary)));

        // Backward compatible: if no fieldOrder is present, keep the old behavior (importance/required + heuristic sorting).
        if (!hasFieldOrder) {
            const entriesSorted = sortFieldsForUI(entries);
            return splitPrimaryAndAdvanced(entriesSorted);
        }

        const map = new Map(entries);
        const primaryNames = Array.isArray(fieldOrder.primary) ? fieldOrder.primary : [];
        const secondaryNames = Array.isArray(fieldOrder.secondary) ? fieldOrder.secondary : [];

        const seen = new Set();
        const primary = [];
        const advanced = [];

        const pushByName = (arr, name) => {
            const key = String(name || '');
            if (!key) return;
            if (seen.has(key)) return;
            if (!map.has(key)) return;
            seen.add(key);
            arr.push([key, map.get(key)]);
        };

        primaryNames.forEach((n) => pushByName(primary, n));
        secondaryNames.forEach((n) => pushByName(advanced, n));

        // Safety: append any remaining fields (not listed in fieldOrder) as advanced, in a stable UI order.
        const remaining = entries.filter(([name]) => !seen.has(name));
        const remainingSorted = sortFieldsForUI(remaining);
        remainingSorted.forEach((e) => advanced.push(e));

        return {primary, advanced};
    }


    // ---- Options with safe defaults ----
    const opts = {
        toolbarButtonTitles: options.toolbarButtonTitles !== false,
        labels: {
            quickAdd: options.labels?.quickAdd ?? "Choose action type:",
            add: options.labels?.add ?? "Add",
            expand: options.labels?.expand ?? "Expand",
            moveUp: options.labels?.moveUp ?? "Move up",
            moveDown: options.labels?.moveDown ?? "Move down",
            moveLeft: options.labels?.moveLeft ?? "Move left",
            moveRight: options.labels?.moveRight ?? "Move right",
            remove: options.labels?.remove ?? "Remove",
            showMore: options.labels?.showMore ?? "Show more options",
            showLess: options.labels?.showLess ?? "Show fewer options"
        }
    };

    // ---- The scan step's engine ----
    // Every scan runs with the lab's one engine, which the server names
    // (surea11y by default, see a11y-engine.js). Its rule ids are loaded when
    // a step first uses them, for typed ids to be checked against, and the
    // engine's id comes with them.
    let labEngineId = null;

    /** The engine a scan step line runs with: the lab's, once it is known. */
    function engineOfLine() {
        return labEngineId;
    }

    // The rule ids the engine accepts in a scan step (a Set), loaded when a
    // step first uses them. Not loaded yet (undefined), or not to be had
    // (null): nothing is checked.
    let knownRuleIds;
    let knownRuleIdsAsked = false;

    function ensureKnownRuleIds() {
        if (knownRuleIdsAsked || typeof fetch !== "function") return;
        knownRuleIdsAsked = true;
        const base = options.ruleIdsUrl || "/api/engine/rule-ids";
        fetch(base, {headers: {"Accept": "application/json"}})
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => {
                const own = Array.isArray(json && json.engines) ? json.engines[0] : null;
                if (own && own.id) labEngineId = String(own.id);
                knownRuleIds = own && Array.isArray(own.ruleIds) ? new Set(own.ruleIds.map(String)) : null;
            })
            .catch(() => { knownRuleIds = null; });
    }

    /**
     * The ids in a rule id field that the engine does not have, or [] when
     * that can't be told: its list is not loaded. An id with a {var:...}
     * token is only known at runtime.
     */
    function unknownRuleIds(value) {
        if (!knownRuleIds) return [];
        return String(value || "")
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id && !id.includes("{") && !knownRuleIds.has(id));
    }

    /** Readies a scan step line: the rule ids it is checked against. */
    function applyEngineToLine(lineEl) {
        if (!lineEl || lineEl.dataset.actionType !== "a11yScan") return;
        ensureKnownRuleIds();
    }

    // ---- Tiny utils ----
    const $ = (root, sel) => root.querySelector(sel);
    const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));
    const focusFirstInput = (root) => {
        const el = root.querySelector("input, select, textarea");
        if (el && typeof el.focus === "function") el.focus();
    };

    const isActionArrayField = (def) =>
        String(def?.type || "").toLowerCase().includes("action[]");

    // A step that only lives in one kind of list (a case, in a switch's cases)
    // is left out of the palette and can't be pasted anywhere else. A Slot
    // step is only offered in a custom step's own steps (options.inCustomStep).
    const isListedType = (type) => !!defs[type] && !defs[type].onlyIn
        && (!defs[type].onlyInCustomStep || options.inCustomStep === true);
    const listedDefs = () => Object.fromEntries(Object.entries(defs).filter(([type]) => isListedType(type)));

    // The chip on a branching step's lists: which branch each one is.
    function branchChipFor(actionKey, fieldName) {
        if (actionKey === "if" || actionKey === "ifUrl") {
            return fieldName === "actions" ? "then" : fieldName === "elseActions" ? "else" : null;
        }
        if (actionKey === "switch" && fieldName === "defaultActions") return "default";
        return null;
    }

    // A case's title says what it matches ("Case · contains "/checkout""), so a
    // collapsed list of cases reads as a routing table.
    function describeCaseLine(lineEl) {
        const fieldControl = (name) => lineEl.querySelector(`:scope > .fields > .field[data-field-name="${name}"] select, :scope > .fields > .field[data-field-name="${name}"] input`);
        const comparison = fieldControl("comparison");
        const value = fieldControl("value");
        const comparisonText = comparison && comparison.selectedOptions && comparison.selectedOptions[0]
            ? comparison.selectedOptions[0].textContent.trim()
            : "";
        const valueText = value ? String(value.value || "") : "";
        if (!comparisonText) return "";
        return `${lineEl.dataset.baseTitle} · ${comparisonText} "${valueText}"`;
    }

    // A Slot step's title names its place ("Slot · After signing in"), so
    // the custom step's steps read as where the call's steps go.
    function describeSlotLine(lineEl) {
        const select = lineEl.querySelector(':scope > .fields > .field[data-field-name="slot"] select');
        const option = select && select.value && select.selectedOptions ? select.selectedOptions[0] : null;
        return option ? `${lineEl.dataset.baseTitle} · ${option.textContent.trim()}` : "";
    }

    // ---- Horizontal stepper (root-only) ----
    // Wraps ONLY the top-level actions (direct children of actionsEl).
    // Nested action arrays remain vertical and unchanged.
    const useHorizontalStepper = options.useHorizontalStepper !== false;

    /** @type {HorizontalStepper|null} */
    let rootStepper = null;

    function ensureRootStepper() {
        if (!useHorizontalStepper) return null;
        if (rootStepper) return rootStepper;

        // actionsEl becomes the stepper root host.
        rootStepper = new HorizontalStepper(actionsEl, {
            onChange: () => {
                try { refreshReorderButtons(actionsEl); } catch { /* ignore */ }
            }
        });

        return rootStepper;
    }

    function isNestedLine(lineEl) {
        return !!(lineEl && lineEl.closest && lineEl.closest(".actions-subcontainer"));
    }

    function getLineStepperId(lineEl) {
        if (!lineEl) return "";
        return String(lineEl.dataset.stepperId || lineEl._uid || "");
    }

    function cssEscape(s) {
        if (globalThis.CSS && typeof globalThis.CSS.escape === "function") return globalThis.CSS.escape(s);
        return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    }

    function rootListLinesFromStepper() {
        if (!rootStepper) return [];

        if (typeof rootStepper.getCount === "function" && typeof rootStepper.getIdAt === "function") {
            const out = [];
            const n = rootStepper.getCount();
            for (let i = 0; i < n; i += 1) {
                const id = rootStepper.getIdAt(i);
                if (!id) continue;
                const panel = actionsEl.querySelector(`.stepper__panel[data-action-id="${cssEscape(String(id))}"]`);
                const line = panel ? panel.querySelector(".line") : null;
                if (line) out.push(line);
            }
            return out;
        }

        return Array.from(actionsEl.querySelectorAll(".stepper__panel > .line"));
    }

    function listLines(container) {
        if (container === actionsEl && rootStepper) return rootListLinesFromStepper();
        return $$(container, ":scope > .line");
    }

    function rootAddLine(lineEl, { activate = true } = {}) {
        if (!lineEl) return null;
        const stepper = ensureRootStepper();
        if (!stepper || typeof stepper.addStep !== "function") {
            actionsEl.append(lineEl);
            return null;
        }

        const id = getLineStepperId(lineEl) || String(Math.random()).slice(2);
        lineEl.dataset.stepperId = id;

        stepper.addStep(lineEl, { id });

        if (activate && typeof stepper.setActive === "function") {
            stepper.setActive(id);
        }

        return id;
    }

    function rootRemoveLine(lineEl) {
        if (!rootStepper) {
            lineEl?.remove?.();
            return;
        }
        const id = getLineStepperId(lineEl);
        if (!id) return;
        if (typeof rootStepper.removeAction === "function") rootStepper.removeAction(id);
    }

    function rootMoveLine(lineEl, direction, focusBtn) {
        if (!rootStepper) return;
        const id = getLineStepperId(lineEl);
        if (!id) return;

        if (direction < 0 && typeof rootStepper.moveLeft === "function") rootStepper.moveLeft(id);
        else if (direction > 0 && typeof rootStepper.moveRight === "function") rootStepper.moveRight(id);

        if (typeof rootStepper.setActive === "function") rootStepper.setActive(id);
        if (focusBtn && typeof focusBtn.focus === "function") focusBtn.focus();
    }


    function parsesAsSelector(selector) {
        try {
            document.createDocumentFragment().querySelector(selector);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * The part of a selector list the browser can't parse, or null when it
     * parses. Names the comma-separated piece at fault when one alone fails,
     * else the whole list (a comma can sit inside :is(), so a split is only
     * a guess).
     */
    function invalidCssSelector(list) {
        if (parsesAsSelector(list)) return null;
        const parts = list.split(",").map((p) => p.trim()).filter(Boolean);
        const bad = parts.filter((p) => !parsesAsSelector(p));
        return bad.length === 1 ? bad[0] : list.trim();
    }

    /** Clear or set error message on a field wrapper or control. */
    function setError(inputOrWrapper, msg) {
        const wrapper =
            inputOrWrapper.closest?.(".field, .action-array") || inputOrWrapper;
        // A list of steps holds its own error after the steps in it, whose
        // lists hold theirs: only its own child is its message.
        const err = wrapper.classList?.contains("action-array")
            ? wrapper.querySelector?.(":scope > .action-array__error")
            : wrapper.querySelector?.(".error, .action-array__error");
        if (!err) return;

        err.textContent = "";
        err.hidden = true;
        wrapper.removeAttribute("aria-invalid");

        if (
            inputOrWrapper instanceof HTMLElement &&
            inputOrWrapper.matches("input, select, textarea")
        ) {
            inputOrWrapper.removeAttribute("aria-invalid");
        }

        if (msg) {
            err.textContent = msg;
            err.hidden = false;
            wrapper.setAttribute("aria-invalid", "true");
            if (
                inputOrWrapper instanceof HTMLElement &&
                inputOrWrapper.matches("input, select, textarea")
            ) {
                inputOrWrapper.setAttribute("aria-invalid", "true");
            }
        }
    }

    // --- Batch row variables a step would hide ---

    /** The variable names a field's text names, by field. */
    function variableNamesIn(fieldName, text) {
        const value = String(text ?? "").trim();
        if (!value) return [];
        if (fieldName === "exportVars") return value.split(",").map((v) => v.trim()).filter(Boolean);
        if (fieldName === "argsJson") {
            // An argument passing the row's own value on, "build": "{var:build}",
            // hides nothing.
            try {
                const args = JSON.parse(value);
                if (!args || typeof args !== "object" || Array.isArray(args)) return [];
                return Object.keys(args).filter((k) => String(args[k]).trim() !== `{var:${k}}`);
            } catch {
                return [];
            }
        }
        return [value];
    }

    /**
     * Inputs of the custom step a runCustomStep line calls that would hide a
     * row variable inside it: named like one, and not handed the row's own
     * value by this call, so the input's default (or nothing) takes its place.
     */
    function inputsHidingRowVariables(lineEl, argsText) {
        const schema = defs.runCustomStep && defs.runCustomStep.getStepInputsSchema;
        if (typeof schema !== "function") return [];
        const idControl = lineEl.querySelector(
            ':scope > .fields > .field[data-field-name="customStepId"] select, :scope > .fields > .field[data-field-name="customStepId"] input'
        );
        const inputs = schema(idControl ? idControl.value : "") || [];
        let args = {};
        try {
            const parsed = JSON.parse(String(argsText || "").trim() || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
        } catch {
            return [];
        }
        return inputs
            .map((input) => (input && typeof input.name === "string" ? input.name.trim() : ""))
            .filter((name) => name && reservedVarNames.has(name) && !Object.prototype.hasOwnProperty.call(args, name));
    }

    /** Why this field of this step would hide a batch row variable, or null. */
    function reservedVariableConflict(lineEl, fieldName, text) {
        if (!reservedVarNames.size) return null;
        const actionType = lineEl.dataset.actionType;
        if (!(VARIABLE_NAME_FIELDS[actionType] || []).includes(fieldName)) return null;
        if (fieldName === "argsJson") {
            const hiddenInput = inputsHidingRowVariables(lineEl, text)[0];
            if (hiddenInput) {
                return `The custom step’s input “${hiddenInput}” hides the batch workflow variable of the same name inside it. Pass "${hiddenInput}": "{var:${hiddenInput}}" here, or rename the input.`;
            }
        }
        const hit = variableNamesIn(fieldName, text).find((n) => reservedVarNames.has(n));
        if (!hit) return null;
        if (actionType === "clearVar") {
            return `“${hit}” is a batch workflow variable: clearing it removes the workflow’s value for the rest of the run. Remove this step or use another name.`;
        }
        if (fieldName === "exportVars") {
            return `“${hit}” is a batch workflow variable: exporting it from the custom step replaces the workflow’s value. Rename one of them.`;
        }
        if (fieldName === "argsJson") {
            return `The argument “${hit}” hides the batch workflow variable of the same name inside the custom step. Rename it, or pass "{var:${hit}}".`;
        }
        return `“${hit}” is also a batch workflow variable: from this step on, the workflow’s value is hidden. Rename one of them.`;
    }

    // ---- Passwords to type again ----
    // A password is never saved, so a workflow loaded back has its passwords
    // empty, often deep in it. Each step that has one to type says so in its
    // header ("Needs password", line.dataset.needsPassword for the steps
    // panel), and options.onPasswordsChange(count) is told each time the
    // count changes, for the section to say how many are left.
    let lastPasswordCount = -1;

    /** The password fields to type before a run, in the order they run. */
    function passwordsToType() {
        return Array.from(actionsEl.querySelectorAll(".sb-input-with-icon[data-secret='true'] input")).filter((input) => {
            const field = input.closest(".field");
            const line = input.closest(".line");
            if (!field || !line || input.value !== "") return false;
            // Read from the environment where it runs: nothing to type.
            if (field.dataset.secretEnv) return false;
            // A step that is off, or inside one that is, does not run.
            return !line.closest(".line[data-explicit-disabled='true']");
        });
    }

    function setNeedsPassword(line, on) {
        let badge = line._needsPasswordBadge;
        if (!badge && !on) return;
        if (!badge) {
            badge = createEl("span", {className: "line-badge line-badge--password"}, "Needs password");
            line._needsPasswordBadge = badge;
            line.querySelector(":scope > .line-header .line-title-wrapper")?.append(badge);
        }
        badge.hidden = !on;
        if (on) line.dataset.needsPassword = "true";
        else delete line.dataset.needsPassword;
    }

    function refreshPasswordNeeds() {
        const pending = passwordsToType();
        const lines = new Set(pending.map((input) => input.closest(".line")));
        actionsEl.querySelectorAll(".line[data-needs-password]").forEach((line) => {
            if (!lines.has(line)) setNeedsPassword(line, false);
        });
        lines.forEach((line) => setNeedsPassword(line, true));
        if (pending.length !== lastPasswordCount) {
            lastPasswordCount = pending.length;
            if (typeof options.onPasswordsChange === "function") options.onPasswordsChange(pending.length);
        }
    }

    /**
     * Marks or clears the row-variable error on every field that names a
     * variable, without touching any other error a field may show: only
     * errors this check set (RESERVED_ERROR_ATTR) are ever cleared here.
     */
    function refreshReservedVariableErrors() {
        if (!reservedVarNames.size && !actionsEl.querySelector(`[${RESERVED_ERROR_ATTR}]`)) return;
        actionsEl.querySelectorAll(".line").forEach((lineEl) => {
            const fields = VARIABLE_NAME_FIELDS[lineEl.dataset.actionType];
            if (!fields) return;
            lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
                if (!fields.includes(fieldEl.dataset.fieldName)) return;
                const control = fieldEl.querySelector("input, select, textarea");
                if (!control) return;
                const msg = stepActionsMenu.isEffectivelyDisabled(lineEl)
                    ? null
                    : reservedVariableConflict(lineEl, fieldEl.dataset.fieldName, control.value);
                if (msg) {
                    setError(control, msg);
                    control.setAttribute(RESERVED_ERROR_ATTR, "true");
                } else if (control.hasAttribute(RESERVED_ERROR_ATTR)) {
                    setError(control, null);
                    control.removeAttribute(RESERVED_ERROR_ATTR);
                }
            });
        });
    }

    /** The variable names batch rows set, while the batch is on; [] when off. */
    function setReservedVariableNames(names = []) {
        reservedVarNames = new Set((names || []).map(String));
        refreshReservedVariableErrors();
    }

    // --- Disabled state helpers (explicit vs inherited) ---
    function isExplicitDisabled(lineEl) {
        return lineEl?.dataset?.explicitDisabled === "true";
    }

    function isInheritedDisabled(lineEl) {
        return lineEl?.dataset?.inheritedDisabled === "true";
    }

    // In step-actions-menu.js.
    const stepActionsMenu = createStepActionsMenu(builder);

    function collapseAction(lineEl) {
        const collapsed = lineEl.classList.contains('is-collapsed');
        const t = lineEl.querySelector(".toggle-action");

        if(collapsed || !t) return;

        lineEl.classList.add("is-collapsed");

        const oldSvg = t.querySelector("svg");
        if (oldSvg) oldSvg.remove();
        t.setAttribute("aria-expanded", "false");
        t.ariaExpanded = "false";
        t.title = "Expand";
        t.setAttribute("aria-label", "Expand action panel");
        t.append(svgIcon('expand'));
    }

    function expandAction(lineEl) {
        const collapsed = lineEl.classList.contains('is-collapsed');
        const t = lineEl.querySelector(".toggle-action");

        if(!collapsed || !t) return;

        lineEl.classList.remove("is-collapsed");

        const oldSvg = t.querySelector("svg");
        if (oldSvg) oldSvg.remove();
        t.setAttribute("aria-expanded", "true");
        t.ariaExpanded = "true";
        t.title = "Collapse";
        t.setAttribute("aria-label", "Collapse action panel");
        t.append(svgIcon('collapse'));
    }

    /** Enable or disable inputs under a line based on effective state. */
    function toggleAction(lineEl) {
        const collapsed = lineEl.classList.contains('is-collapsed');

        if(collapsed) {
            expandAction(lineEl);
        } else {
            collapseAction(lineEl);
        }
    }

    /** Enable or disable inputs under a line based on effective state. */
    function applyDisabledState(lineEl) {
        const disabled = stepActionsMenu.isEffectivelyDisabled(lineEl);
        lineEl.classList.toggle("is-disabled", disabled);

        if (disabled) {
            collapseAction(lineEl);
        } else {
            // Do not force expand if user (or loaded config) wants it collapsed
            if (!lineEl.classList.contains("is-collapsed")) {
                expandAction(lineEl);
            }
        }
        const fieldsContainer = lineEl.querySelector(".fields");
        // Not aria-disabled on the step: on a group it says every control in
        // it is unavailable, the button that turns the step back on among
        // them. Its fields are disabled one by one below; its name says it
        // is off ("Action 4 - A11y scan, disabled").
        lineEl.removeAttribute("aria-disabled");
        const titleWrap = lineEl.querySelector(":scope > .line-header .line-title-wrapper");
        let note = titleWrap ? titleWrap.querySelector(":scope > .line-disabled-note") : null;
        if (disabled && titleWrap && !note) {
            note = createEl("span", {className: "visually-hidden line-disabled-note"}, ", disabled");
            const title = titleWrap.querySelector(":scope > .line-title");
            if (title) title.after(note);
            else titleWrap.append(note);
        } else if (!disabled && note) {
            note.remove();
        }

        fieldsContainer.querySelectorAll("input, select, textarea, button").forEach((el) => {
            if (el.closest(".line") !== lineEl) return;
            const cls = el.classList || {contains: () => false};
            if (el.tagName === "BUTTON") {
                el.disabled = disabled;
            } else {
                el.disabled = disabled;
            }
        });

        const t = lineEl.querySelector(".toggle-disabled");

        if (t) {
            // Update tooltip + accessible name
            t.title = disabled ? "Enable this action" : "Disable this action";
            t.setAttribute(
                "aria-label",
                disabled ? "Enable this action" : "Disable this action"
            );

            // Swap icon
            const oldSvg = t.querySelector("svg");
            if (oldSvg) oldSvg.remove();

            t.append(svgIcon(disabled ? "enable" : "disable"));
        }
    }

    /** Set or clear explicit disabled on a line and propagate. */
    function setLineExplicitDisabled(lineEl, on) {
        if (on) lineEl.dataset.explicitDisabled = "true";
        else delete lineEl.dataset.explicitDisabled;
        applyDisabledState(lineEl);
    }

    /**
     * Turns several steps off or on as one change: one Undo puts them all
     * back. The steps panel's Disable and Enable use it on the selection.
     * Steps already as asked are left as they are.
     */
    function setStepsDisabled(lines, on) {
        let changed = 0;
        (lines || []).forEach((lineEl) => {
            if (!lineEl || !actionsEl.contains(lineEl) || isExplicitDisabled(lineEl) === !!on) return;
            setLineExplicitDisabled(lineEl, !!on);
            changed += 1;
        });
        if (changed) pushHistory(on ? "disableSteps" : "enableSteps");
        return changed;
    }

    /**
     * A field as a card of the given type has it, outside any card: Edit
     * together uses it, so a field reads and works as it does on the step
     * (Profile's choices, Tags' chips). It sits in a holder shaped like a
     * card, as the editor reads fields from cards; the holder is not one.
     *
     * @returns {{el: Element, field: Element, read: () => *, set: (value: *) => void} | null}
     */
    function createEditField(type, name) {
        const fieldDef = defs?.[type]?.fields?.[name];
        if (!fieldDef) return null;
        const field = stepFields.fieldInputFor(name, fieldDef, type, 0);
        const holder = createEl("div", {className: "edit-together-field", dataset: {actionType: type}}, [
            createEl("div", {className: "fields"}, [field])
        ]);
        return {
            el: holder,
            field,
            read: () => stepValues.readLineToObject(holder, {maskValues: "text"})?.[name],
            set: (value) => stepValues.setFieldValue(field, value),
        };
    }

    /** One step's values, as saved: what Edit together reads from each card. */
    function readStep(lineEl) {
        return lineEl && actionsEl.contains(lineEl) ? stepValues.readLineToObject(lineEl, {maskValues: "text"}) : null;
    }

    /**
     * Sets fields of several steps as one change: one Undo puts them all
     * back. Only the fields named are set, through the same setter loading a
     * config uses, so the fields drawn as widgets (Profile, Tags) take them
     * too; the steps inside a container are not touched.
     *
     * @param {{line: Element, values: Object<string, *>}[]} entries
     * @returns {number} How many steps changed.
     */
    function setStepsFieldValues(entries) {
        let changed = 0;
        (entries || []).forEach(({line, values}) => {
            if (!line || !actionsEl.contains(line) || !values) return;
            let any = false;
            Object.entries(values).forEach(([name, value]) => {
                const fieldEl = line.querySelector(`:scope > .fields > .field[data-field-name="${name}"]`);
                if (!fieldEl) return;
                stepValues.setFieldValue(fieldEl, value);
                any = true;
            });
            if (!any) return;
            changed += 1;
            // What setting a field by hand would bring up to date.
            line._applySetViewportPresetVisibility?.();
            line._applyScanEngine?.();
            line._applySubjectFieldVisibility?.();
            line._applyRunCustomStepInputs?.();
            line._applyRunCustomStepSlots?.();
        });
        if (changed) {
            updateLineTitles(actionsEl);
            pushHistory("editTogether");
        }
        return changed;
    }

    function addShortcuts(shortcutsDefs = [], shortcutCallback, container) {
        shortcutsDefs.forEach(shortcut => {
            if (!defs[shortcut]) return;
            const addA11yBtn = createEl(
                "button",
                {
                    type: "button",
                    // A shortcut: the add button's menu holds the same steps,
                    // so a phone's narrow list shows that button alone.
                    className: "secondary-button action-shortcut",
                    title: defs[shortcut]?.description || ""
                },
                defs[shortcut]?.label || ""
            );

            addA11yBtn.addEventListener("click", shortcutCallback(shortcut));

            container.appendChild(addA11yBtn);
        });
    }

    // ---- Numbering and reordering helpers ----
    function updateLineTitles(container) {
        const memo = new WeakMap();

        function computeIndexPathForLine(lineEl) {
            if (!lineEl) return "";

            if (memo.has(lineEl)) return memo.get(lineEl);

            let siblings;
            let parentContainer = lineEl.parentElement;

            // If this line is inside a root stepper panel,
            // compute siblings from the stepper instead of panel
            if (rootStepper && parentContainer?.classList?.contains("stepper__panel")) {
                siblings = rootListLinesFromStepper();
                parentContainer = actionsEl; // treat root as container
            } else {
                siblings = listLines(parentContainer);
            }
            const idx = siblings.indexOf(lineEl);
            const localIndex = String(idx >= 0 ? idx + 1 : 1);

            // If nested, parentContainer is inside a parent .line
            const parentLine = parentContainer.closest?.(".line");
            const prefix = parentLine ? computeIndexPathForLine(parentLine) : "";

            const indexPath = prefix ? `${prefix}.${localIndex}` : localIndex;

            memo.set(lineEl, indexPath);
            return indexPath;
        }

        // A container's steps are numbered from their place in it, under the
        // number of the step holding it. Looking each step up in its list
        // again listed the list once a step: 1000 steps took 5 s to number.
        function updateContainerTitles(containerEl, prefix) {
            const lines = listLines(containerEl);

            for (const [i, line] of lines.entries()) {
                const base = line.dataset.baseTitle || "";
                const alias = String(line.dataset.alias || "").trim();
                const described = line.dataset.actionType === "case" ? describeCaseLine(line)
                    : line.dataset.actionType === "slot" ? describeSlotLine(line) : "";
                const displayTitle = alias ? alias : (described || base);
                const titleEl = line.querySelector(":scope > .line-header .line-title");
                const indexPath = prefix ? `${prefix}.${i + 1}` : String(i + 1);
                memo.set(line, indexPath);
                if (titleEl) {

                    // Store updated path
                    line.dataset.actionIndexPath = indexPath;

                    const safeIndexForId = indexPath.replace(/\./g, "-");
                    const titleId = `action-${safeIndexForId}-${line._uid}`;

                    // "3.2 - Click": the number styled apart from the name,
                    // the " - " between them kept in the text (what a screen
                    // reader says, and what is read back from the title) but
                    // not drawn.
                    titleEl.replaceChildren(
                        createEl("span", {className: "line-title-index"}, [
                            indexPath,
                            createEl("span", {className: "visually-hidden line-title-sep"}, " - ")
                        ]),
                        displayTitle
                    );
                    titleEl.parentNode.id = titleId;
                    line.setAttribute("aria-labelledby", titleId);
                }
                const titleActionTypeEl = line.querySelector(":scope > .line-header .line-title-action-type");
                // The kind of step, above every title; not said again to a
                // screen reader when the title is the kind.
                if (titleActionTypeEl) {
                    if (displayTitle === base) titleActionTypeEl.setAttribute("aria-hidden", "true");
                    else titleActionTypeEl.removeAttribute("aria-hidden");
                }

                // Recurse into any nested actions-subcontainer under this line
                const nestedContainers = line.querySelectorAll(
                    ":scope > .action-arrays-below .actions-subcontainer, :scope > .action-array .actions-subcontainer"
                );
                // Only this step's own lists: the query also finds those of the
                // steps nested in them, which number their own.
                nestedContainers.forEach((sub) => {
                    if (sub.closest(".line") === line) updateContainerTitles(sub, indexPath);
                });
            }
        }

        // A root step's panel in the stepper stands for the root list.
        const start = rootStepper && container?.classList?.contains("stepper__panel") ? actionsEl : container;
        // The number of the step holding `start`, when it is nested.
        const holder = start !== actionsEl ? start?.closest?.(".line") : null;
        updateContainerTitles(start, holder ? computeIndexPathForLine(holder) : "");
    }

    function refreshReorderButtons(container) {
        const lines = listLines(container);
        const isRoot = container === actionsEl && !!rootStepper;
        lines.forEach((line, idx) => {
            // The line's own buttons, never those of a step inside it (a
            // call's places have none of their own).
            const up = line.querySelector(":scope > .line-header .move-up");
            const down = line.querySelector(":scope > .line-header .move-down");
            if (up) {
                const disabled = idx === 0;
                up.disabled = disabled;
                up._wiredBtns?.forEach(btn => btn.disabled = disabled);
                if (isRoot) {
                    up.title = opts.labels.moveLeft;
                    up.setAttribute("aria-label", opts.labels.moveLeft);
                } else {
                    up.title = opts.labels.moveUp;
                    up.setAttribute("aria-label", opts.labels.moveUp);
                }
            }
            if (down) {
                const disabled = idx === lines.length - 1;
                down.disabled = disabled;
                down._wiredBtns?.forEach(btn => btn.disabled = disabled);
                if (isRoot) {
                    down.title = opts.labels.moveRight;
                    down.setAttribute("aria-label", opts.labels.moveRight);
                } else {
                    down.title = opts.labels.moveDown;
                    down.setAttribute("aria-label", opts.labels.moveDown);
                }
            }
        });

        const actionArrayWrapper = container.closest?.(".action-array");
        if (actionArrayWrapper) {
            const summary = actionArrayWrapper.querySelector(".action-array__summary");
            if (summary) refreshActionArraySummary(summary, container);
        }

        updateLineTitles(container);
    }

    function moveLine(container, line, direction, focusBtn) {
        // Root-level moves are horizontal in the stepper (left/right)
        if (container === actionsEl && rootStepper) {
            rootMoveLine(line, direction, focusBtn);
            refreshReorderButtons(container);
            pushHistory("move");
            return;
        }
        const sib =
            direction < 0 ? line.previousElementSibling : line.nextElementSibling;
        if (!sib) return;
        if (direction < 0) container.insertBefore(line, sib);
        else container.insertBefore(sib, line);
        if (focusBtn && typeof focusBtn.focus === "function") focusBtn.focus();
        refreshReorderButtons(container);
        pushHistory("move");
    }

    function refreshActionArraySummary(summaryEl, subContainer) {
        const items = $$(subContainer, ":scope > .line");
        const names = items.map((l) => l.dataset.actionType);
        summaryEl.textContent = `(${items.length})${names.length ? " " + names.join(" · ") : ""}`;
        // An empty list says "Nothing runs here." with one add button, not
        // its row of shortcuts (step-fields.js); a list of one kind of step
        // (a switch's cases) has a single button already.
        const list = subContainer.closest(".action-array");
        if (list && list.querySelector(":scope > .action-array__empty")) list.classList.toggle("is-empty", items.length === 0);
    }

    // In step-info.js.
    const stepInfo = createStepInfo(builder);

    // In step-fields.js.
    const stepFields = createStepFields(builder);

    // In step-line.js.
    const stepLine = createStepLine(builder);

    // ---- Validation and reading ----
    /**
     * @param {HTMLElement} lineEl
     * @param {{invalidLines: Set<HTMLElement>, firstMissingRequired: ?HTMLElement,
     *          firstError: ?HTMLElement}} [report] Filled in as errors are found,
     *          in the reading order the user sees, so the caller can send focus
     *          to the first empty required field rather than to the step.
     */
    // Set while a value is read that leaves secret values out (see getValue).
    let secretsOptional = false;

    // In step-validation.js.
    const stepValidation = createStepValidation(builder);

    // In step-values.js.
    const stepValues = createStepValues(builder);

    function createAndPopulateLine(actionObj, container, indexPath = null) {
        if (!actionObj || typeof actionObj !== "object") return null;
        const type = actionObj.type;
        const def = defs[type];
        if (!def) return null;

        const line = stepLine.makeLine(type, def, (lineEl, dir, btnRef) =>
            moveLine(container, lineEl, dir, btnRef)
        );
        if (container === actionsEl) rootAddLine(line, { activate: false });
        else container.append(line);
        stepValues.populateLineFromObject(line, actionObj, indexPath);
        return line;
    }

    // In step-palette.js.
    const stepPalette = createStepPalette(builder);

    refreshReorderButtons(actionsEl);

    // Typing a password clears its step's badge at once, not when the edit
    // reaches the history.
    actionsEl.addEventListener("input", (event) => {
        if (event.target?.closest?.(".sb-input-with-icon[data-secret='true']")) refreshPasswordNeeds();
    });

    // history baseline
    pushHistory("init", { force: true });

    // ---- Public API ----
    function validate({reveal = true} = {}) {
        const {allOk, firstFocusTarget} = stepValidation.validateContainer(actionsEl, {reveal});
        return {ok: allOk, firstErrorEl: firstFocusTarget || null};
    }

    /**
     * Marks every field in error now, as a run would, without opening a step
     * or moving focus: after a config is loaded, a required field it left
     * empty shows so at once, not only when Run is pressed. A password left
     * empty because it is never saved is not an error here: it is asked for
     * on its own (the steps say "Needs password").
     */
    function showFieldErrors() {
        secretsOptional = true;
        try {
            return validate({reveal: false});
        } finally {
            secretsOptional = false;
        }
    }

    /**
     * `reveal: false` checks without opening the failing steps, collapsing the
     * others or moving focus: saving a config must keep the steps as the user
     * left them.
     */
    function getValue({ validate: doValidate = true, maskValues = "text", markMasked = false, reveal = true } = {}) {
        if (doValidate) {
            // Read for a config file or a link (maskValues "redact"): secrets
            // are left out of it, so an empty one is fine there. A run reads
            // with the values and still requires them.
            secretsOptional = maskValues === "redact";
            let v;
            try {
                v = validate({reveal});
            } finally {
                secretsOptional = false;
            }
            if (!v.ok) {
                if (reveal && v.firstErrorEl && v.firstErrorEl.focus) v.firstErrorEl.focus();
                return {ok: false, value: null, firstErrorEl: v.firstErrorEl};
            }
        }
        const value = stepValues.readContainer(actionsEl, { maskValues, markMasked });
        return {ok: true, value};
    }

    function addAction(type) {
        const def = defs[type];
        if (!def) throw new Error(`Unknown action type: ${type}`);
        const line = stepLine.makeLine(type, def, (lineEl, dir, btnRef) =>
            moveLine(actionsEl, lineEl, dir, btnRef)
        );
        rootAddLine(line);
        focusFirstInput(line);
        refreshReorderButtons(actionsEl);
        pushHistory("api:addStep");
        return line;
    }

    function clear() {
        if (rootStepper && typeof rootStepper.destroy === "function") {
            try { rootStepper.destroy(); } catch { /* ignore */ }
            rootStepper = null;
        }
        actionsEl.innerHTML = "";
        refreshReorderButtons(actionsEl);
    }

    function appendActions(actions = [], {
        focusFirst = false, callback = () => {
        }
    } = {}) {
        const added = [];
        const errors = [];

        if (!Array.isArray(actions)) actions = [actions];
        actions = withPasswordStepTypeDeep(actions);

        actions.forEach((actionObj, idx) => {
            droppedWhileLoading = [];
            // Numbered by its place in the list given ("3", then "3.1" for the
            // first step nested in it), so a step left out can be found there.
            const line = createAndPopulateLine(actionObj, actionsEl, String(idx + 1));
            if (line) {
                added.push(line);
            } else {
                errors.push({
                    index: idx,
                    action: actionObj,
                    type: actionObj?.type,
                    indexPath: String(idx + 1),
                    reason: "Unknown or invalid action type"
                });
            }
            // Steps nested in this one that the builder does not have.
            for (const dropped of droppedWhileLoading) {
                errors.push({ index: idx, ...dropped, reason: "Unknown or invalid action type" });
            }
            droppedWhileLoading = null;
        });

        refreshReorderButtons(actionsEl);

        if (added.length) {
            if (focusFirst) focusFirstInput(added[0]);
            callback();
        }

        pushHistory("api:appendActions");

        // What the steps held that their fields do not take, left out with
        // them: the caller says so (a config loaded).
        return {added, errors, unused: unusedStepKeys(actions, defs)};
    }

    function loadActions(actions = [], {
        clearFirst = true, focusFirst = true, injectDefaultWhenEmpty = true, callback = () => {
        }
    } = {}) {
        // If the workflow has no actions, inject a minimal default action
        if (injectDefaultWhenEmpty && Array.isArray(actions) && actions.length === 0) {
            actions = [{type: "a11yScan"}];
        }

        if (clearFirst) clear();
        const res = appendActions(actions, {focusFirst, callback});
        pushHistory("api:loadActions");
        return res;
    }

    function destroy() {
        clear();
        toolbarEl.innerHTML = "";
    }

    function randomId(prefix = "id") {
        const bytes =
            globalThis.crypto && crypto.getRandomValues
                ? crypto.getRandomValues(new Uint8Array(6))
                : Uint8Array.from({length: 6}, () => Math.floor(Math.random() * 256));
        const hex = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        return `${prefix}-${hex}`;
    }

    return {
        validate,
        showFieldErrors,
        passwordsToType,
        // Steps' keys this editor would leave out (unusedStepKeys), for steps
        // kept elsewhere until opened in it: the custom steps.
        unusedKeys: (actions) => unusedStepKeys(withPasswordStepTypeDeep(actions), defs),
        getValue,
        addAction,
        appendActions,
        loadActions,
        setStepsDisabled,
        readStep,
        setStepsFieldValues,
        createEditField,
        setReservedVariableNames,
        clear,
        destroy,

        // history
        undo,
        redo,
        getHistoryState,
        createUndoButton,
        createRedoButton,
        attachHistoryButtons
    };
}
