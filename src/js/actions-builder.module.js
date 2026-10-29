import {createEl, iconButton, svgIcon} from './a11y-ui.utils.js';
import { HorizontalStepper } from './horizontal-stepper.js';
import { buildTagsInputControl, normalizeTagList, filterTagSuggestions } from './tags-input.js';

export { normalizeTagList, filterTagSuggestions };

const SHORTCUTS = ['a11yScan', 'click', 'screenshot'];

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

export const MASKED_VALUE_PLACEHOLDER = "Not saved - enter it again";

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
let clipboardAction = null;
const pasteButtons = new Set();

// A paste button is enabled when there is a copied step its list takes: a
// switch's cases list only takes cases, every other list anything but a case.
function pasteButtonDisabled(btn) {
    if (!clipboardAction) return true;
    return typeof btn._accepts === "function" && !btn._accepts(clipboardAction.type);
}

function setClipboardAction(actionObj) {
    clipboardAction = actionObj ? JSON.parse(JSON.stringify(actionObj)) : null;
    // Update all paste buttons state
    for (const btn of pasteButtons) {
        if (!btn || !btn.isConnected) continue;
        btn.disabled = pasteButtonDisabled(btn);
    }
}

function registerPasteButton(btn, accepts = null) {
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
        return readContainer(actionsEl);
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
        // Every edit lands here, so the row-variable check stays live.
        refreshReservedVariableErrors();
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
    // Every scan runs with surea11y, the lab's one engine, and a step shows
    // all its fields and profiles. The rule ids surea11y has are loaded when a
    // step first uses them, for typed ids to be checked against.
    const ENGINE_ID = "surea11y";

    /** The engine a scan step line runs with: surea11y. */
    function engineOfLine() {
        return ENGINE_ID;
    }

    // The rule ids the engine accepts in a scan step (a Set), loaded when a
    // step first uses them. Not loaded yet, or not to be had: nothing is
    // checked.
    const knownRuleIdsByEngine = new Map();

    function ensureKnownRuleIds(engineId) {
        if (!engineId || knownRuleIdsByEngine.has(engineId) || typeof fetch !== "function") return;
        knownRuleIdsByEngine.set(engineId, undefined);
        const base = options.ruleIdsUrl || "/api/engine/rule-ids";
        fetch(`${base}?engineId=${encodeURIComponent(engineId)}`, {headers: {"Accept": "application/json"}})
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => {
                const engines = Array.isArray(json && json.engines) ? json.engines : [];
                const own = engines.find((e) => e && String(e.id).toLowerCase() === engineId) || engines[0];
                knownRuleIdsByEngine.set(engineId, own && Array.isArray(own.ruleIds) ? new Set(own.ruleIds.map(String)) : null);
            })
            .catch(() => knownRuleIdsByEngine.set(engineId, null));
    }

    /**
     * The ids in a rule id field that the engine does not have, or [] when
     * that can't be told: its list is not loaded. An id with a {var:...}
     * token is only known at runtime.
     */
    function unknownRuleIds(value, engineId) {
        const set = knownRuleIdsByEngine.get(engineId);
        if (!set) return [];
        return String(value || "")
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id && !id.includes("{") && !set.has(id));
    }

    /** Readies a scan step line: the rule ids it is checked against. */
    function applyEngineToLine(lineEl) {
        if (!lineEl || lineEl.dataset.actionType !== "a11yScan") return;
        ensureKnownRuleIds(ENGINE_ID);
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
    // is left out of the palette and can't be pasted anywhere else.
    const isListedType = (type) => !!defs[type] && !defs[type].onlyIn;
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
                const msg = isEffectivelyDisabled(lineEl)
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

    function isEffectivelyDisabled(lineEl) {
        return isExplicitDisabled(lineEl) || isInheritedDisabled(lineEl);
    }

    function ensureId(el, prefix = "id") {
        if (el.id) return el.id;
        el.id = `${prefix}-${Math.random().toString(16).slice(2)}`;
        return el.id;
    }

    function ensureMenuLabel(btn) {
        // Add visible label in menu mode if not present
        let label = btn.querySelector(".flyout-btn-label");
        if (!label) {
            label = document.createElement("span");
            label.className = "flyout-btn-label";
            label.textContent = btn.getAttribute("aria-label") || btn.title || "Action";
            btn.appendChild(label);
        } else {
            // keep it current if aria-label changes
            const txt = btn.getAttribute("aria-label") || btn.title || "Action";
            if (label.textContent !== txt) label.textContent = txt;
        }
    }

    function removeMenuLabel(btn) {
        const label = btn.querySelector(".flyout-btn-label");
        if (label) label.remove();
    }

    /**
     * Turns an existing controls container into a responsive “inline actions or menu actions”
     * WITHOUT cloning buttons. It moves the same buttons between two places.
     *
     * @param {Object} opts
     * @param {HTMLElement} opts.containerEl
     * @param {number} opts.collapseAtPx
     * @param {string} [opts.triggerAriaLabel]
     * @param {string} [opts.triggerClassName]
     * @param {string} [opts.menuClassName]
     * @param {string} [opts.menuIconName]
     * @returns {{ destroy(): void, update(): void, setCollapsed(v:boolean): void }}
     */
    function createResponsiveActionsMenu({
                                             containerEl,
                                             collapseAtPx,
                                             collapseIfFn,
                                             measureEl = containerEl,
                                             triggerAriaLabel = "Open actions menu",
                                             triggerClassName = "secondary-button",
                                             menuClassName = "flyout-menu",
                                             menuIconName = "menu"
                                         } = {}) {
        if (!containerEl) throw new Error("createResponsiveActionsMenu: containerEl is required");
        if (!Number.isFinite(collapseAtPx) || collapseAtPx <= 0) {
            throw new Error("createResponsiveActionsMenu: collapseAtPx must be a positive number");
        }
        if (!measureEl || !(measureEl instanceof Element)) {
            throw new Error("createResponsiveActionsMenu: measureEl must be a DOM Element");
        }
        if (collapseIfFn && typeof collapseIfFn !== 'function') {
            throw new Error("createResponsiveActionsMenu: collapseIfFn is optional but must be a function");
        }

        // Collect source buttons once (these are the ones we will move around)
        // Important: only the direct children that are buttons, avoid picking up future flyout elements.
        const actionButtons = Array.from(containerEl.children).filter(
            (n) => n instanceof HTMLButtonElement
        );

        if (!actionButtons.length) throw new Error("createResponsiveActionsMenu: no action buttons found");

        // Build flyout structure inside the same container
        const flyoutRoot = document.createElement("div");
        flyoutRoot.className = "flyout-root";

        const trigger = iconButton({
            className: triggerClassName,
            ariaLabel: triggerAriaLabel,
            title: triggerAriaLabel,
            iconName: menuIconName,
            type: "button"
        });

        ensureId(trigger, "flyout-trigger");

        const menu = document.createElement("div");
        menu.className = menuClassName;
        menu.setAttribute("role", "menu");
        menu.setAttribute("tabindex", "-1");
        menu.setAttribute("aria-labelledby", trigger.id);
        menu.hidden = true;

        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");

        flyoutRoot.append(trigger, menu);

        containerEl.appendChild(flyoutRoot);

        let isOpen = false;
        let isCollapsed = false;

        function openMenu() {
            if (isOpen) return;
            isOpen = true;
            trigger.setAttribute("aria-expanded", "true");
            menu.hidden = false;

            // focus first enabled action button (now inside menu)
            const firstEnabled = actionButtons.find((b) => !isEffectivelyDisabled(b));
            (firstEnabled || menu).focus();
        }

        function closeMenu({restoreFocus = false} = {}) {
            if (!isOpen) return;
            isOpen = false;
            trigger.setAttribute("aria-expanded", "false");
            menu.hidden = true;
            if (restoreFocus) trigger.focus();
        }

        trigger.addEventListener("click", (e) => {
            e.preventDefault();
            if (isOpen) closeMenu({restoreFocus: true});
            else openMenu();
        });

        trigger.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openMenu();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                openMenu();
                // focus last enabled
                const enabled = [...actionButtons].reverse().find((b) => !isEffectivelyDisabled(b));
                if (enabled) enabled.focus();
            }
        });

        menu.addEventListener("keydown", (e) => {
            const enabled = actionButtons.filter((b) => !isEffectivelyDisabled(b));
            if (!enabled.length) {
                if (e.key === "Escape") closeMenu({restoreFocus: true});
                return;
            }

            const active = document.activeElement;
            const idx = enabled.indexOf(active);

            switch (e.key) {
                case "Escape":
                    e.preventDefault();
                    closeMenu({restoreFocus: true});
                    break;
                case "Tab":
                    closeMenu({restoreFocus: false});
                    break;
                case "ArrowDown": {
                    e.preventDefault();
                    const next = enabled[(Math.max(idx, -1) + 1) % enabled.length];
                    next.focus();
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    const prev = enabled[(idx <= 0 ? enabled.length : idx) - 1];
                    prev.focus();
                    break;
                }
                case "Home":
                    e.preventDefault();
                    enabled[0].focus();
                    break;
                case "End":
                    e.preventDefault();
                    enabled[enabled.length - 1].focus();
                    break;
            }
        });

        function onDocPointerDown(e) {
            if (!isOpen) return;
            if (flyoutRoot.contains(e.target)) return;
            closeMenu({restoreFocus: false});
        }

        document.addEventListener("pointerdown", onDocPointerDown, true);

        flyoutRoot.addEventListener("focusout", (e) => {
            if (!isOpen) return;
            const next = e.relatedTarget;
            if (next && flyoutRoot.contains(next)) return;
            closeMenu({restoreFocus: false});
        });

        function setCollapsed(nextCollapsed) {
            if (nextCollapsed === isCollapsed) return;
            isCollapsed = nextCollapsed;

            if (isCollapsed) {
                // Move buttons into menu
                for (const b of actionButtons) {
                    ensureMenuLabel(b);
                    b.classList.add("flyout-menu__item");
                    b.setAttribute("role", "menuitem");
                    // In menu mode, you usually want them full-width visually
                    menu.appendChild(b);
                }
                flyoutRoot.style.display = '';
            } else {
                // Close menu if open before moving buttons out
                closeMenu({restoreFocus: false});

                // Move buttons back inline
                for (const b of actionButtons) {
                    removeMenuLabel(b);
                    b.classList.remove("flyout-menu__item");
                    b.removeAttribute("role");
                    flyoutRoot.parentNode.insertBefore(b, flyoutRoot);
                }
                flyoutRoot.style.display = 'none';
            }
        }

        // Start: default to expanded UI, menu hidden
        flyoutRoot.style.display = 'none';
        setCollapsed(false);

        const ro = new ResizeObserver(() => {
            const w = measureEl.getBoundingClientRect().width;
            setCollapsed(w < collapseAtPx || (!!collapseIfFn && collapseIfFn(w)));
        });
        ro.observe(measureEl);

        function update() {
            const w = measureEl.getBoundingClientRect().width;
            setCollapsed(w < collapseAtPx || (!!collapseIfFn && collapseIfFn(w)));
        }

        function destroy() {
            document.removeEventListener("pointerdown", onDocPointerDown, true);
            ro.disconnect();
            closeMenu({restoreFocus: false});

            // Ensure buttons end up inline again
            setCollapsed(false);

            // Remove flyout root and inline slot wrapper, keep buttons in containerEl
            flyoutRoot.remove();
        }

        return {destroy, update, setCollapsed};
    }

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
        const disabled = isEffectivelyDisabled(lineEl);
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
        lineEl.setAttribute("aria-disabled", disabled ? "true" : "false");

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

    function addShortcuts(shortcutsDefs = [], shortcutCallback, container) {
        shortcutsDefs.forEach(shortcut => {
            if (!defs[shortcut]) return;
            const addA11yBtn = createEl(
                "button",
                {
                    type: "button",
                    className: "secondary-button",
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
                const described = line.dataset.actionType === "case" ? describeCaseLine(line) : "";
                const displayTitle = alias ? alias : (described || base);
                const titleEl = line.querySelector(":scope > .line-header .line-title");
                const indexPath = prefix ? `${prefix}.${i + 1}` : String(i + 1);
                memo.set(line, indexPath);
                if (titleEl) {

                    // Store updated path
                    line.dataset.actionIndexPath = indexPath;

                    const safeIndexForId = indexPath.replace(/\./g, "-");
                    const titleId = `action-${safeIndexForId}-${line._uid}`;

                    titleEl.textContent = `${indexPath} - ${displayTitle}`;
                    titleEl.parentNode.id = titleId;
                    line.setAttribute("aria-labelledby", titleId);
                }
                const titleActionTypeEl = line.querySelector(":scope > .line-header .line-title-action-type");
                if (titleActionTypeEl) titleActionTypeEl.hidden = !alias;

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
            const up = line.querySelector(".move-up");
            const down = line.querySelector(".move-down");
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
    }

    // ---- Info dialog builders ----
    function escapeInfoHtml(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
    }

    function buildGlobalContextHelp(_actionKey) {
        const wrap = document.createElement("div");
        const ul = document.createElement("ul");
        ul.innerHTML = [
            "<li><code>:ctx</code> in selectors refers to the current element when inside <code>forEachElement</code>. Example: <code>:ctx .title</code></li>",
            "<li>Iteration variables are available inside many string fields:",
            "<ul>",
            "<li><code>{index}</code> zero-based index, starts at 0</li>",
            "<li><code>{oneBased}</code> one-based index, starts at 1</li>",
            "<li><code>{total}</code> total iterations when known</li>",
            "</ul>",
            "</li>",
            "<li>Examples:",
            "<ul>",
            "<li>Selector using context: <code>:ctx a.item-{oneBased}</code></li>",
            "<li>Label templating: <code>Item {oneBased} of {total}</code></li>",
            "</ul>",
            "</li>",
            "<li>Workflow variables:",
            "<ul>",
            "<li>Use <code>{var:name}</code> in any string field to insert a variable set earlier with <code>getText</code>, <code>getCount</code> or <code>setVar</code></li>",
            "<li>Number fields (for example <code>repeat</code> repetitions) also accept <code>{var:name}</code>. The value is turned into a number when the step runs, so text such as <code>5</code> works too</li>",
            "<li>Inside <code>forEachElement</code>, variables set during the current iteration override global variables of the same name</li>",
            "</ul>",
            "</li>"
        ].join("");
        wrap.appendChild(createEl("h5", {}, "Context and variables"));
        wrap.appendChild(ul);
        return wrap;
    }

    function buildActionInfoContent(actionKey, actionDef) {
        const body = document.createElement("div");

        if (actionDef.description) {
            body.appendChild(createEl("p", {}, actionDef.description));
        }

        const fields = actionDef.fields || {};
        const names = Object.keys(fields);
        if (names.length) {
            // A field's example, or for a switch or a list of choices, which
            // an example says little about, its default, marked as such.
            const exampleHtml = (def) => {
                if (def.example != null && String(def.example).trim() !== "") {
                    return `<code>${escapeInfoHtml(String(def.example))}</code>`;
                }
                const choices = def.type === "boolean" || Array.isArray(def.options) || Array.isArray(def.enum);
                if (choices && def.default != null && String(def.default) !== "") {
                    return `<code>${escapeInfoHtml(String(def.default))}</code> <span class="sb-action-info__default">(default)</span>`;
                }
                return "";
            };
            const anyExamples = names.some((n) => exampleHtml(fields[n] || {}) !== "");

            const table = document.createElement("table");
            table.setAttribute("aria-label", "Fields");
            table.className = "sb-action-info__fields";

            // Fixed widths, Description the widest: it says the most.
            const widths = anyExamples ? [16, 11, 9, 44, 20] : [18, 12, 10, 60];

            table.innerHTML = [
                "<colgroup>",
                widths.map((w) => `<col style="width: ${w}%">`).join(""),
                "</colgroup>",
                "<thead><tr>",
                "<th scope=\"col\">Field</th>",
                "<th scope=\"col\">Type</th>",
                "<th scope=\"col\">Required</th>",
                "<th scope=\"col\">Description</th>",
                anyExamples ? "<th scope=\"col\">Example</th>" : "",
                "</tr></thead>",
                "<tbody></tbody>"
            ].join("");

            const tbody = table.querySelector("tbody");

            names.forEach((name) => {
                const def = fields[name] || {};
                const type = String(def.type || "any");
                const required = def.required ? "yes" : "no";
                const desc = def.description ? String(def.description) : "";
                const alias = (fields[name] && fields[name].alias) ? String(fields[name].alias) : "";

                const tr = document.createElement("tr");
                tr.innerHTML = [
                    `<td><strong>${escapeInfoHtml(alias || name)}</strong></td>`,
                    // "string | string[]", so a long type wraps between its parts.
                    `<td><code>${escapeInfoHtml(type.split("|").join(" | "))}</code></td>`,
                    `<td>${required}</td>`,
                    `<td>${escapeInfoHtml(desc)}</td>`,
                    anyExamples ? `<td>${exampleHtml(def)}</td>` : ""
                ].join("");
                tbody.appendChild(tr);
            });

            body.appendChild(createEl("h5", {}, "Fields"));
            body.appendChild(table);
        }

        const extras = document.createElement("div");
        const optionLines = [];
        Object.entries(actionDef.fields || {}).forEach(([name, def]) => {
            if (Array.isArray(def.options) || Array.isArray(def.enum)) {
                const opts = (def.options || def.enum).map((o) => {
                    if (typeof o === "object") return String(o.label ?? o.value);
                    return String(o);
                });
                optionLines.push(`<li><code>${name}</code>: ${opts.join(", ")}</li>`);
            }
        });
        if (optionLines.length) {
            extras.appendChild(createEl("h5", {}, "Allowed values"));
            const ul = document.createElement("ul");
            ul.innerHTML = optionLines.join("");
            extras.appendChild(ul);
            body.appendChild(extras);
        }

        if (Array.isArray(actionDef.examples) && actionDef.examples.length) {
            body.appendChild(createEl("h5", {}, "Use cases"));
            const ul = document.createElement("ul");
            actionDef.examples.forEach((ex) => {
                const li = document.createElement("li");
                const title = typeof ex === "string" ? ex : ex.title || "";
                li.textContent = title;
                ul.appendChild(li);
            });
            body.appendChild(ul);

            const codeSnippets = actionDef.examples
                .map((ex) => (ex && typeof ex === "object" && ex.snippet ? ex.snippet : null))
                .filter(Boolean);
            if (codeSnippets.length) {
                const codeWrap = document.createElement("div");
                codeWrap.className = "sb-action-info__examples";
                codeWrap.appendChild(createEl("p", {}, "Example snippets:"));
                codeSnippets.forEach((snippet) => {
                    const pre = document.createElement("pre");
                    const code = document.createElement("code");
                    code.textContent =
                        typeof snippet === "string"
                            ? snippet
                            : JSON.stringify(snippet, null, 2);
                    pre.appendChild(code);
                    codeWrap.appendChild(pre);
                });
                body.appendChild(codeWrap);
            }
        }

        body.appendChild(buildGlobalContextHelp(actionKey));
        return body;
    }

    // Gather tags already used by every OTHER scanTags widget currently in this
    // builder, so the tag input can suggest "pick existing" values alongside
    // free-text entry. Reads live widget state (not serialized JSON) so it
    // reflects edits the user just made in sibling steps.
    function collectExistingTagSuggestions(selfWrapper) {
        const seen = new Set();
        const out = [];
        actionsEl.querySelectorAll('.field[data-widget="tags"]').forEach((fieldEl) => {
            if (fieldEl === selfWrapper) return;
            const widget = fieldEl._tagsWidget;
            if (!widget || typeof widget.getTags !== "function") return;
            widget.getTags().forEach((tag) => {
                const key = tag.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push(tag);
            });
        });
        return out.sort((a, b) => a.localeCompare(b));
    }

    // ---- Field renderers ----
    function fieldInputFor(fieldName, fieldDef, actionKey, indexInLine) {
        const typeStr = String(fieldDef.type || "").toLowerCase();
        const fieldId = `${actionKey}__${fieldName}__${indexInLine}__${Math.random().toString(36).slice(2, 7)}`;
        const isRequired = !!fieldDef.required;

        const wrapper = createEl("div", {
            className: "field",
            dataset: {fieldName, fieldType: typeStr, required: String(isRequired)}
        });
        if (fieldDef.cssSelector === true) wrapper.dataset.cssSelector = "true";
        if (fieldDef.ruleIds === true) wrapper.dataset.ruleIds = "true";

        const labelText = fieldDef.alias ? String(fieldDef.alias) : fieldName;
        const labelEl = createEl("label", {htmlFor: fieldId}, labelText);
        if (isRequired) {
            const badge = createEl("span", {className: "req-badge", title: "Required"}, "*");
            labelEl.append(" ", badge);
        }

        const errorEl = createEl("div", {
            className: "error",
            id: `${fieldId}__err`,
            hidden: true
        });

        const dynamicOptions = (typeof fieldDef.optionsProvider === "function")
            ? fieldDef.optionsProvider({ fieldName, actionKey })
            : null;

        const rawChoices = Array.isArray(dynamicOptions)
            ? dynamicOptions
            : Array.isArray(fieldDef.options)
                ? fieldDef.options
                : Array.isArray(fieldDef.enum)
                    ? fieldDef.enum
                    : null;

        const choices = rawChoices
            ? rawChoices.map((c) =>
                typeof c === "object" && c !== null
                    ? {value: String(c.value), label: String(c.label ?? c.value)}
                    : {value: String(c), label: String(c)}
            )
            : null;

        let controlEl;

        if (fieldDef.widget === "tags") {
            wrapper.dataset.widget = "tags";
            const widget = buildTagsInputControl({
                fieldId,
                labelText,
                isRequired,
                placeholder: fieldDef.placeholder,
                getSuggestions: () => collectExistingTagSuggestions(wrapper),
                onChange: () => scheduleHistoryPush("field:tags"),
            });
            wrapper._tagsWidget = widget;
            controlEl = widget.el;
        } else if (typeStr === "boolean") {
            const select = document.createElement("select");
            select.id = fieldId;
            select.append(
                createEl("option", {value: "true"}, "Yes"),
                createEl("option", {value: "false"}, "No")
            );

            if (typeof fieldDef.default === "boolean") select.value = String(fieldDef.default);

            if (isRequired) {
                select.required = true;
                select.setAttribute("aria-required", "true");
            }

            controlEl = select;
        } else if (choices) {
            const select = document.createElement("select");
            if (typeStr === "string[]") {
                select.setAttribute("multiple", "");
                if (typeof fieldDef.size === "number" && fieldDef.size > 0) {
                    select.size = fieldDef.size;
                }
            }
            select.id = fieldId;
            choices.forEach(({value, label}) => {
                select.append(createEl("option", {value}, label));
            });
            if (fieldDef.default !== undefined) {
                if (select.multiple && Array.isArray(fieldDef.default)) {
                    const set = new Set(fieldDef.default.map(String));
                    Array.from(select.options).forEach(o => o.selected = set.has(o.value));
                } else {
                    select.value = String(fieldDef.default);
                }
            } else if (isRequired && !select.multiple) {
                // A required choice with no default is the person's to make
                // (Set color scheme): it starts on a prompt, not on whichever
                // option happens to come first, and stays invalid until chosen.
                select.prepend(createEl("option", {value: "", disabled: true}, "Choose…"));
                select.value = "";
            } else if (!isRequired && !select.multiple && fieldDef.emptyLabel) {
                // An optional choice whose empty value means something (Set color
                // scheme: keep it as it is) starts on that, as a choice of its
                // own, so it can be chosen again.
                select.prepend(createEl("option", {value: ""}, String(fieldDef.emptyLabel)));
                select.value = "";
            } else if (!isRequired && !select.multiple) {
                select.value = "";
            }
            if (isRequired) {
                select.required = true;
                select.setAttribute("aria-required", "true");
            }
            if (choices) {
                wrapper.dataset.enum = JSON.stringify(choices.map((c) => c.value));
            }
            // A field may refuse a variable token (variableToken: false): one
            // whose value the step editor has to know.
            if (!select.multiple && fieldDef.variableToken !== false) {
                select.append(createEl("option", { value: SELECT_TOKEN_SENTINEL }, "From a variable…"));

                const tokenInput = createEl("input", {
                    type: "text",
                    placeholder: "e.g. {var:preset}"
                });
                tokenInput.className = "select-token-input";
                tokenInput.hidden = true;
                tokenInput.setAttribute("aria-label", `${labelText} variable token`);

                const tokenHelp = createEl(
                    "small",
                    { className: "field-help" },
                    'Use a variable token like {var:preset} when this value should come from custom-step inputs.'
                );
                tokenHelp.hidden = true;

                const syncTokenUi = () => {
                    const tokenMode = select.value === SELECT_TOKEN_SENTINEL;
                    tokenInput.hidden = !tokenMode;
                    tokenHelp.hidden = !tokenMode;
                    if (tokenMode) {
                        tokenInput.setAttribute("aria-required", isRequired ? "true" : "false");
                    } else {
                        tokenInput.removeAttribute("aria-invalid");
                    }
                };
                select.addEventListener("change", syncTokenUi);

                wrapper._selectTokenUi = { select, tokenInput, tokenHelp, syncTokenUi };
                syncTokenUi();

                controlEl = createEl("div", { className: "sb-select-with-token" }, [select, tokenInput, tokenHelp]);
            } else {
                controlEl = select;
            }
        } else if (typeStr === "number") {
            // A text input, not type="number": the field also takes {var:name}.
            const input = document.createElement("input");
            input.type = "text";
            input.spellcheck = false;
            input.autocomplete = "off";
            input.id = fieldId;
            if (fieldDef.integer === true) wrapper.dataset.integer = "true";
            const ph = fieldDef.placeholder;
            input.placeholder =
                ph != null ? (typeof ph === "number" ? String(ph) : "e.g. " + ph) : "";
            if (typeof fieldDef.default === "number") input.value = String(fieldDef.default);
            if (isRequired) {
                input.required = true;
                input.setAttribute("aria-required", "true");
            }
            controlEl = input;
        } else {
            // Special case: multi-line text input
            if (fieldDef.multiline === true || fieldName === "itemsText" || fieldName === "css") {
                const ta = document.createElement("textarea");
                ta.id = fieldId;

                // Optional but useful defaults
                ta.rows = 8;
                ta.spellcheck = false;

                const ph = fieldDef.placeholder;
                ta.placeholder =
                    ph != null ? (typeof ph === "number" ? String(ph) : "e.g. " + ph) : "";

                if (typeof fieldDef.default === "string" || typeof fieldDef.default === "number") {
                    ta.value = String(fieldDef.default);
                }

                if (isRequired) {
                    ta.required = true;
                    ta.setAttribute("aria-required", "true");
                }

                controlEl = ta;
            } else {
                const input = document.createElement("input");
                input.type = "text";
                input.id = fieldId;

                const ph = fieldDef.placeholder;
                input.placeholder =
                    ph != null ? (typeof ph === "number" ? String(ph) : "e.g. " + ph) : "";
                if (typeStr.includes("[]")) input.placeholder = "comma separated";

                if (typeof fieldDef.default === "string" || typeof fieldDef.default === "number") {
                    input.value = String(fieldDef.default);
                }

                if (isRequired) {
                    input.required = true;
                    input.setAttribute("aria-required", "true");
                }

                let rendered = input;

                // 1) Optional password toggle (wraps input)
                if (shouldShowPasswordToggle(fieldName, fieldDef)) {
                    rendered = attachPasswordToggleToInput({ input: rendered, fieldId });
                }

                // 2) Optional catalog button. attachCatalogButtonToInput assumes it receives
                // the raw <input>, so it and the password toggle are mutually exclusive per field.
                if (shouldShowCatalogButton(fieldName)) {
                    rendered = attachCatalogButtonToInput({ input, options, fieldLabel: labelEl.textContent });
                }

                controlEl = rendered;
            }
        }

        // The error describes the field itself, also when the rules catalog's
        // wrapper holds it with its button.
        const describedEl = controlEl.classList.contains("sb-inline-field-with-btn")
            ? controlEl.querySelector("input")
            : controlEl;
        describedEl.setAttribute("aria-describedby", errorEl.id);
        wrapper.append(labelEl, controlEl, errorEl);

        // ---- History: track edits on this field (debounced) ----
        const editables = wrapper.querySelectorAll("input, select, textarea");
        editables.forEach((editable) => {
            editable.addEventListener("input", () => scheduleHistoryPush("field:input"));
            editable.addEventListener("change", () => pushHistory("field:change"));
        });

        return wrapper;
    }

    function shouldShowCatalogButton(fieldKey) {
        return fieldKey === 'includeRuleIds'
            || fieldKey === 'excludeRuleIds'
            || fieldKey === 'includeTagIds'
            || fieldKey === 'excludeTagIds';
    }

    function attachCatalogButtonToInput({input, options, fieldLabel = ''}) {
        const open = options && typeof options.openRulesCatalog === 'function'
            ? options.openRulesCatalog
            : null;

        if (!open) return input;

        // Wrap input + button (laid out by .sb-inline-field-with-btn)
        const wrap = document.createElement('div');
        wrap.className = 'sb-inline-field-with-btn';

        const btn = document.createElement('button');
        btn.type = 'button'; // important, avoid form submit
        btn.className = 'secondary-button sb-catalog-btn';
        btn.textContent = 'Catalog';
        // Two fields carry one, so the name says which; it starts with the
        // visible text, for speech input.
        const label = String(fieldLabel || '').trim();
        if (label) btn.setAttribute('aria-label', `Catalog for ${label}`);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentSelected = input.value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
            open({
                select: true,
                // The catalog of the step's engine.
                engineId: engineOfLine(input.closest(".line")),
                preselectedIds: currentSelected,
                fieldLabel: label,
                onAccept: (ids) => {
                    input.value = ids.join(', ');
                    pushHistory("catalog:accept");
                }
            });
        });

        wrap.appendChild(input);
        wrap.appendChild(btn);

        return wrap;
    }

    function shouldShowPasswordToggle(fieldName, fieldDef) {
        return !!fieldDef?.secret;
    }

    function attachPasswordToggleToInput({ input, fieldId }) {
        const wrap = document.createElement("div");
        wrap.className = "sb-input-with-icon";
        wrap.style.position = "relative";

        // Marks the field as secret for readLineToObject(): its value is never
        // saved, whether or not it is revealed on screen.
        wrap.dataset.secret = "true";

        input.classList.add("sb-input-with-icon__input");
        // Keeps password managers from offering to save a test account's value.
        input.autocomplete = "new-password";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sb-input-with-icon__btn";
        btn.setAttribute("aria-pressed", "false");

        // A toggle with a fixed name: aria-pressed carries the state, and the
        // title matches the accessible name.
        const label = "Show value";
        btn.title = label;
        btn.setAttribute("aria-label", label);

        function apply(revealed) {
            input.type = revealed ? "text" : "password";
            btn.setAttribute("aria-pressed", revealed ? "true" : "false");

            const oldSvg = btn.querySelector("svg");
            if (oldSvg) oldSvg.remove();
            btn.append(svgIcon(revealed ? "hide" : "show"));
        }

        let revealed = false;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            revealed = !revealed;
            apply(revealed);

            // Focus stays on the toggle, which says its new state through
            // aria-pressed; moving it to the field would leave a keyboard user
            // who wants to toggle again having to come back. Safari does not
            // focus a clicked button by itself.
            btn.focus();
        });

        // initial state
        apply(false);

        wrap.append(input, btn);
        return wrap;
    }

    function fieldActionArray(fieldName, fieldDef, actionKey, indexInLine) {
        const isRequired = !!fieldDef.required;
        const titleId = randomId("actions");
        const errorId = randomId("actions-error");

        const wrapper = createEl("div", {
            className: "action-array",
            dataset: {fieldName, fieldType: "action[]", required: String(isRequired)},
            role: "group",
            "aria-labelledby": titleId,
            "aria-describedby": errorId
        });

        const titleText = (fieldDef && fieldDef.alias) ? String(fieldDef.alias) : fieldName;
        const branchName = branchChipFor(actionKey, fieldName);
        const title = createEl("div", {className: "action-array__title", id: titleId}, [
            branchName ? createEl("span", {className: `branch-chip branch-chip--${branchName}`}, branchName) : null,
            titleText,
            isRequired ? createEl("span", {className: "req-badge", title: "Required"}, "*") : null
        ]);

        const summary = createEl("span", {className: "action-array__summary"}, "(0)");
        const headerRight = createEl("div", {className: "action-array__controls"}, [summary]);
        const header = createEl("div", {className: "action-array__header"}, [title, headerRight]);

        const subContainer = createEl("div", {className: "actions-subcontainer", dataset: {fieldName}});
        const errorEl = createEl("div", {className: "action-array__error", hidden: true, id: errorId});

        const controlsBox = createEl("div", {className: "inline-actions"});

        const shortcutCallback = (shortcut) => {
            return () => {
                const def = defs[shortcut];
                const line = makeLine(shortcut, def, (lineEl, dir, btnRef) =>
                    moveLine(subContainer, lineEl, dir, btnRef)
                );
                subContainer.append(line);
                pushRecent(shortcut);
                focusFirstInput(line);
                refreshReorderButtons(subContainer);
                refreshActionArraySummary(summary, subContainer);
                pushHistory("nested:add");
            }
        }
        // A list that holds one kind of step (a switch's cases) offers just
        // that step; the palette and shortcuts are for every other list.
        const itemType = fieldDef && fieldDef.itemType && defs[fieldDef.itemType] ? fieldDef.itemType : null;
        const accepts = itemType ? (type) => type === itemType : isListedType;
        if (itemType) {
            const addItemBtn = createEl(
                "button",
                {type: "button", className: "secondary-button"},
                `Add ${String(defs[itemType].label || itemType).toLowerCase()}`
            );
            addItemBtn.addEventListener("click", shortcutCallback(itemType));
            controlsBox.append(addItemBtn);
        } else {
            addShortcuts(SHORTCUTS, shortcutCallback, controlsBox);
        }

        // Existing generic "Add nested action" (palette)
        const addBtn = createEl(
            "button",
            {
                type: "button",
                className: "secondary-button icon-button",
                "aria-label": "Add nested action"
            },
            svgIcon("add")
        );

        addBtn.addEventListener("click", () => {
            showCommandPalette({
                onPick: (key) => {
                    const def = defs[key];
                    if (!def) return;
                    const line = makeLine(key, def, (lineEl, dir, btnRef) =>
                        moveLine(subContainer, lineEl, dir, btnRef)
                    );
                    subContainer.append(line);
                    pushRecent(key);
                    focusFirstInput(line);
                    refreshReorderButtons(subContainer);
                    refreshActionArraySummary(summary, subContainer);
                    pushHistory("nested:addAny");
                }
            });
        });

        if (!itemType) controlsBox.append(addBtn);
        const pasteBtn = iconButton({
            className: "secondary-button icon-button paste-button",
            ariaLabel: "Paste action",
            title: "Paste action",
            iconName: "paste"
        });
        registerPasteButton(pasteBtn, accepts);

        pasteBtn.addEventListener("click", () => {
            if (!clipboardAction || !accepts(clipboardAction.type)) return;
            const def = defs[clipboardAction.type];
            if (!def) return;

            const line = makeLine(clipboardAction.type, def, (lineEl, dir, btnRef) =>
                moveLine(subContainer, lineEl, dir, btnRef)
            );
            subContainer.append(line);
            populateLineFromObject(line, clipboardAction);
            focusFirstInput(line);
            refreshReorderButtons(subContainer);
            refreshActionArraySummary(summary, subContainer);
            pushHistory("nested:paste");
        });

        controlsBox.append(pasteBtn);


        const footer = createEl("div", {className: "action-array__footer"}, [controlsBox]);

        wrapper.append(header, subContainer, footer, errorEl);
        refreshReorderButtons(subContainer);
        return wrapper;
    }

    function createActionControls(actionKey, actionDef, line, onMove) {
        function isRootScopeNow() {
            return (line && !isNestedLine(line) && !!rootStepper);
        }
        const upBtn = iconButton({
            className: "move-up secondary-button",
            ariaLabel: `${isRootScopeNow() ? opts.labels.moveLeft : opts.labels.moveUp}`,
            title: isRootScopeNow() ? opts.labels.moveLeft : opts.labels.moveUp,
            iconName: "up"
        });
        upBtn.addEventListener("click", () => onMove(line, -1, upBtn));

        const downBtn = iconButton({
            className: "move-down secondary-button",
            ariaLabel: `${isRootScopeNow() ? opts.labels.moveRight : opts.labels.moveDown}`,
            title: isRootScopeNow() ? opts.labels.moveRight : opts.labels.moveDown,
            iconName: "down"
        });
        downBtn.addEventListener("click", () => onMove(line, +1, downBtn));

        const removeBtn = iconButton({
            className: "remove secondary-button",
            ariaLabel: `${opts.labels.remove}`,
            title: opts.labels.remove,
            iconName: "trash"
        });
        removeBtn.addEventListener("click", () => {
            if (isRootScopeNow()) {
                rootRemoveLine(line);
                refreshReorderButtons(actionsEl);
                pushHistory("remove");
                return;
            }

            const parent = line.parentElement;
            line.remove();
            if (parent) {
                refreshReorderButtons(parent);
                const actionArrayWrapper = parent.closest(".action-array");
                if (actionArrayWrapper) {
                    const summary = actionArrayWrapper.querySelector(".action-array__summary");
                    if (summary) refreshActionArraySummary(summary, parent);
                }
            }
            pushHistory("remove");
        });

        const infoDialogId = `actioninfo-${line._uid}`;
        const infoTitleId = `actioninfo-title-${line._uid}`;
        // The info dialog's body (a table of every field, examples) is built
        // when it is first opened: built for every step up front, it was most
        // of the editor's DOM, 1000 steps 520,000 nodes and a 23 s freeze.
        const infoBody = createEl("div", {className: "src-dialog-body"});
        const fillInfoBody = () => {
            if (!infoBody.firstChild) infoBody.appendChild(buildActionInfoContent(actionKey, actionDef));
        };
        const infoBtn = iconButton({
            className: "info-button secondary-button src-dialog-trigger",
            ariaLabel: `Show info`,
            title: "Action info",
            iconName: "info"
        });
        infoBtn.setAttribute("data-dialog-id", infoDialogId);

        const infoDialog = createEl(
            "dialog",
            {
                id: infoDialogId,
                className: "src-dialog",
                "aria-labelledby": infoTitleId
            },
            [
                createEl("div", {className: "src-dialog-header"}, [
                    createEl("p", {id: infoTitleId, className: "src-dialog-title"}, actionDef.label || actionKey),
                    createEl("p", {className: "src-dialog-meta"}, `Category: ${actionDef.category || "general"}`)
                ]),
                infoBody,
                createEl("div", {className: "src-dialog-footer"}, [
                    createEl("span", {}),
                    createEl("button", {type: "button", className: "src-dialog-close"}, "Close")
                ])
            ]
        );

        infoBtn.addEventListener("click", () => {
            fillInfoBody();
            if (typeof infoDialog.showModal === "function") infoDialog.showModal();
        });
        infoDialog.addEventListener("click", (e) => {
            if (e.target === infoDialog) infoDialog.close();
        });
        infoDialog.querySelector(".sb-action-info__close")?.addEventListener("click", () => infoDialog.close());

        const copyBtn = iconButton({
            className: "copy-button secondary-button",
            ariaLabel: `Copy action`,
            title: "Copy action",
            iconName: "copy"
        });
        // Copy handler: store a deep copy in the in-memory clipboard
        copyBtn.addEventListener("click", () => {
            const actionObj = readLineToObject(line);
            if (!actionObj || !actionObj.type) return;
            setClipboardAction(actionObj);
        });

        const toggleDisableActionBtn = iconButton({
            className: "toggle-disabled secondary-button",
            ariaLabel: `Disable this action`,
            title: `Disable`,
            iconName: "disable"
        });
        // Toggle handler: explicit disabled on this line, cascade to descendants
        toggleDisableActionBtn.addEventListener("click", () => {
            const nowDisabled = !isExplicitDisabled(line);
            setLineExplicitDisabled(line, nowDisabled);
            pushHistory("toggleDisabled");
        });

        const toggleActionBtn = iconButton({
            className: "toggle-action secondary-button",
            ariaLabel: "Collapse action panel",
            title: "Collapse",
            iconName: ["collapse"]
        });
        toggleActionBtn.setAttribute("aria-expanded", "true");
        toggleActionBtn.ariaExpanded = "true";
        // Toggle handler: explicit disabled on this line, cascade to descendants
        toggleActionBtn.addEventListener("click", () => {
            toggleAction(line);
            pushHistory("toggleCollapse");
        });

        const controls = createEl("div", {className: "line-controls"}, [infoBtn, toggleDisableActionBtn, upBtn, downBtn, copyBtn, removeBtn, toggleActionBtn]);

        return {controls, infoDialog}
    }

    function makeLine(actionKey, actionDef, onMove) {
        const line = createEl("div", {className: "line", role: "group"});
        line._uid = randomId("ln");
        line.dataset.actionType = actionKey;
        const baseTitle = `${actionDef.label || actionKey}`;
        line.dataset.baseTitle = baseTitle;

        const titleId = `line-title-${line._uid}`;
        const action = createEl("action", {className: "visually-hidden"}, "Action ");
        const titleText = createEl("div", {className: "line-title", id: titleId}, baseTitle);

        // Inline title editor (hidden by default)
        const titleInput = createEl("input", {
            type: "text",
            className: "line-title-input",
            hidden: true,
            "aria-label": "Edit action title"
        });

        // Edit title button (icon)
        const editTitleBtn = iconButton({
            className: "edit-title secondary-button icon-button",
            ariaLabel: "Edit action title",
            title: "Edit action title",
            iconName: "edit"
        });

        const titleActionTypeText = createEl("div", {className: "line-title-action-type", id: titleId}, `- "${baseTitle}"`);
        titleActionTypeText.hidden = true;

        // helpers
        function getBaseTitleForLine() {
            return String(line.dataset.baseTitle || "").trim();
        }

        function getAliasForLine() {
            return String(line.dataset.alias || "").trim();
        }

        function enterTitleEdit() {
            // Edit only the custom part, not the numbering prefix
            const current = getAliasForLine() || getBaseTitleForLine();

            titleInput.value = current;

            // Keep the line label stable for AT, but hide visually
            titleText.classList.add("visually-hidden");

            titleInput.hidden = false;

            requestAnimationFrame(() => {
                try {
                    titleInput.focus();
                    titleInput.select();
                } catch {
                    // ignore
                }
            });
        }

        function exitTitleEdit({ restoreText = true } = {}) {
            titleInput.hidden = true;
            titleText.classList.remove("visually-hidden");
            if (restoreText) {
                // Ensure numbering/title refresh happens (includes alias if present)
                updateLineTitles(actionsEl);
            }
        }

        function saveTitleEdit() {
            const raw = String(titleInput.value || "").trim();
            const base = getBaseTitleForLine();

            if (!raw || raw === base) {
                delete line.dataset.alias;
            } else {
                line.dataset.alias = raw;
            }

            titleActionTypeText.hidden = !getAliasForLine();

            exitTitleEdit({ restoreText: true });

            pushHistory("titleEdit");

            try {
                editTitleBtn.focus();
            } catch {
                // ignore
            }
        }

        function cancelTitleEdit() {
            exitTitleEdit({ restoreText: true });

            try {
                editTitleBtn.focus();
            } catch {
                // ignore
            }
        }

        editTitleBtn.addEventListener("click", (e) => {
            e.preventDefault();
            enterTitleEdit();
        });

        titleInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                saveTitleEdit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelTitleEdit();
            }
        });

        // Save on blur
        titleInput.addEventListener("blur", () => {
            if (titleInput.hidden) return;
            saveTitleEdit();
        });

        const titleLine = createEl("div", {className: "line-title-wrapper"}, [
            action,
            titleText,
            titleInput,
            editTitleBtn,
            titleActionTypeText
        ]);

        line.setAttribute("aria-labelledby", titleId);

        const {controls, infoDialog} = createActionControls(actionKey, actionDef, line, onMove);
        const header = createEl("div", {className: "line-header"}, [titleLine, controls]);

        createResponsiveActionsMenu({
            containerEl: controls,
            collapseAtPx: 480,
            measureEl: header,
            triggerAriaLabel: "Actions",
            triggerClassName: "secondary-button"
        });

        const fieldsWrap = createEl("div", {className: "fields"});

        const toggleMoreBtn = createEl(
            "button",
            {
                type: "button",
                className: "fields-toggle secondary-button",
                "aria-expanded": "false"
            },
            [
                createEl("span", {className: "fields-toggle-label"}, opts.labels.showMore),
                createEl("span", {className: "fields-toggle-icon", "aria-hidden": "true"}, "▾")
            ]
        );

        const advancedBlocks = [];

        function setAdvancedExpanded(on, {moveFocus = true} = {}) {
            toggleMoreBtn.setAttribute("aria-expanded", on ? "true" : "false");
            toggleMoreBtn.textContent = on ? opts.labels.showLess : opts.labels.showMore;

            fieldsWrap.classList.toggle("is-collapsed", !on);

            advancedBlocks.forEach((el) => {
                el.hidden = !on;
            });

            if (on && moveFocus) {
                // Move focus after the DOM updates
                requestAnimationFrame(() => {
                    focusFirstAdvancedField();
                });
            }
        }

        function focusFirstAdvancedField() {
            for (const block of advancedBlocks) {
                if (block.hidden) continue;

                const focusable = block.querySelector(
                    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
                );

                if (focusable && typeof focusable.focus === "function") {
                    focusable.focus();
                    return;
                }
            }
        }

        toggleMoreBtn.addEventListener("click", () => {
            const expanded = toggleMoreBtn.getAttribute("aria-expanded") === "true";
            setAdvancedExpanded(!expanded);
            pushHistory("toggleAdvanced");
        });
        setAdvancedExpanded(false);

        let visibleIndex = 0;

        const {primary, advanced} = splitFieldsForAction(actionDef);

        const actionArrayBlocks = [];

        function renderFieldEntry(fname, fdef, isAdvanced) {
            if (isActionArrayField(fdef)) {
                const block = fieldActionArray(fname, fdef, actionKey, visibleIndex++);
                if (isAdvanced) {
                    block.classList.add("is-advanced");
                    block.hidden = true;
                    advancedBlocks.push(block);
                }
                actionArrayBlocks.push(block);
                return true;
            } else {
                const fieldEl = fieldInputFor(fname, fdef, actionKey, visibleIndex++);
                if (isAdvanced) {
                    fieldEl.classList.add("is-advanced");
                    fieldEl.hidden = true;
                    advancedBlocks.push(fieldEl);
                }
                fieldsWrap.append(fieldEl);
                return true;
            }
        }

        let advancedRenderedCount = 0;

        function wireRepeatDatasetOverridesCount(lineEl) {
            // Only applies to repeat actions
            if (!lineEl || lineEl.dataset.actionType !== "repeat") return;

            // Find the fields by their wrapper dataset name
            const itemsField = lineEl.querySelector(':scope > .fields > .field[data-field-name="itemsText"] textarea');
            if (!itemsField) return;

            // Adjust this list to match your repeat definition field name(s)
            const countSelectors = [
                ':scope > .fields > .field[data-field-name="repetitions"] input',
                ':scope > .fields > .field[data-field-name="times"] input',
                ':scope > .fields > .field[data-field-name="count"] input'
            ];

            const countInput = countSelectors
                .map((sel) => lineEl.querySelector(sel))
                .find(Boolean);

            if (!countInput) return;

            const countFieldWrap = countInput.closest(".field");

            const apply = () => {
                const hasText = String(itemsField.value || "").trim() !== "";
                // Disable count when dataset is present
                countInput.disabled = hasText;
                if (countFieldWrap) countFieldWrap.classList.toggle("is-ignored", hasText);

                // Optional: make it obvious why it’s disabled
                if (hasText) {
                    countInput.setAttribute("aria-disabled", "true");
                    countInput.title = "Ignored because itemsText has values";
                } else {
                    countInput.removeAttribute("aria-disabled");
                    countInput.title = "";
                }
            };

            // React to edits
            itemsField.addEventListener("input", apply);
            itemsField.addEventListener("change", apply);

            // Apply once on initial render (important for loaded workflows)
            apply();
        }

        function wireRunCustomStepDynamicInputs(lineEl) {
            // Only applies to runCustomStep actions
            if (!lineEl || lineEl.dataset.actionType !== "runCustomStep") return;

            const getSchema = actionDef && actionDef.getStepInputsSchema;
            if (typeof getSchema !== "function") return;

            const customStepSelect = lineEl.querySelector(':scope > .fields > .field[data-field-name="customStepId"] select');
            const argsField = lineEl.querySelector(':scope > .fields > .field[data-field-name="argsJson"]');
            const argsTextarea = argsField ? argsField.querySelector("textarea") : null;
            if (!customStepSelect || !argsField || !argsTextarea) return;

            const dynamicWrap = createEl("div", {className: "field runcustomstep-dynamic-inputs", hidden: true});
            argsField.insertAdjacentElement("afterend", dynamicWrap);

            let dynamicInputEls = [];

            function readCurrentArgs() {
                try {
                    const parsed = JSON.parse(argsTextarea.value || "{}");
                    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
                } catch (e) {
                    return {};
                }
            }

            function writeArgsFromDynamicInputs() {
                const out = {};
                dynamicInputEls.forEach(({name, input}) => {
                    if (input.value !== "") out[name] = input.value;
                });
                argsTextarea.value = Object.keys(out).length ? JSON.stringify(out) : "";
                argsTextarea.dispatchEvent(new Event("input", {bubbles: true}));
                argsTextarea.dispatchEvent(new Event("change", {bubbles: true}));
            }

            function rebuild() {
                const schema = getSchema(customStepSelect.value);
                dynamicInputEls = [];
                dynamicWrap.innerHTML = "";

                if (!Array.isArray(schema) || !schema.length) {
                    dynamicWrap.classList.add("is-advanced");
                    dynamicWrap.hidden = true;
                    argsField.classList.remove("is-advanced");
                    argsField.hidden = false;
                    return;
                }

                const currentArgs = readCurrentArgs();
                argsField.classList.add("is-advanced");
                argsField.hidden = true;
                dynamicWrap.classList.remove("is-advanced");
                dynamicWrap.hidden = false;

                dynamicWrap.append(createEl("label", {}, "Inputs"));

                schema.forEach((def) => {
                    const name = String((def && def.name) || "").trim();
                    if (!name) return;
                    const required = !!(def && def.required);

                    const row = createEl("div", {className: "runcustomstep-dynamic-input-row"});
                    row.append(createEl("label", {}, required ? `${name} *` : name));

                    const input = createEl("input", {
                        type: "text",
                        value: currentArgs[name] != null ? String(currentArgs[name]) : "",
                        placeholder: required ? "Required" : ""
                    });
                    input.addEventListener("input", writeArgsFromDynamicInputs);
                    row.append(input);

                    dynamicWrap.append(row);
                    dynamicInputEls.push({name, input});
                });
            }

            customStepSelect.addEventListener("change", rebuild);
            rebuild();
        }

        function wireScanEngine(lineEl) {
            // Only applies to a11yScan actions
            if (!lineEl || lineEl.dataset.actionType !== "a11yScan") return;
            // Exposed so populateLineFromObject can ready a loaded step.
            lineEl._applyScanEngine = () => applyEngineToLine(lineEl);
            applyEngineToLine(lineEl);
        }

        function wireSetViewportPresetToggle(lineEl) {
            // Only applies to setViewport actions
            if (!lineEl || lineEl.dataset.actionType !== "setViewport") return;

            const presetField = lineEl.querySelector(':scope > .fields > .field[data-field-name="preset"]');
            const widthField = lineEl.querySelector(':scope > .fields > .field[data-field-name="width"]');
            const heightField = lineEl.querySelector(':scope > .fields > .field[data-field-name="height"]');
            const presetSelect = presetField ? presetField.querySelector("select") : null;
            if (!presetSelect || !widthField || !heightField) return;

            const widthInput = widthField.querySelector("input");
            const heightInput = heightField.querySelector("input");

            function applyVisibility() {
                const isCustom = presetSelect.value === "custom";

                widthField.hidden = !isCustom;
                heightField.hidden = !isCustom;
                widthField.classList.toggle("is-conditionally-hidden", !isCustom);
                heightField.classList.toggle("is-conditionally-hidden", !isCustom);

                if (!isCustom) {
                    // A named preset is the single source of truth for size once chosen -
                    // clear any leftover custom values so they can't silently keep
                    // overriding it (width/height always win over preset at runtime).
                    if (widthInput) widthInput.value = "";
                    if (heightInput) heightInput.value = "";
                }
            }

            presetSelect.addEventListener("change", () => {
                applyVisibility();
                pushHistory("field:change");
            });

            // Exposed so populateLineFromObject can re-sync visibility after loading
            // saved/pasted values: setFieldValue() sets .value directly and does not
            // dispatch a "change" event, so this listener alone would miss loaded data.
            lineEl._applySetViewportPresetVisibility = applyVisibility;

            applyVisibility();
        }

        // Switch and URL condition: show only the fields the chosen subject and
        // URL part use. A hidden field keeps its value (the engine ignores it),
        // so switching back does not lose what was typed.
        function wireSubjectFields(lineEl) {
            const type = lineEl ? lineEl.dataset.actionType : "";
            if (type !== "switch" && type !== "ifUrl") return;

            const fieldOf = (name) => lineEl.querySelector(`:scope > .fields > .field[data-field-name="${name}"]`);
            const subjectSelect = fieldOf("subject")?.querySelector("select") || null;
            const partSelect = fieldOf("urlPart")?.querySelector("select") || null;
            const show = (name, on) => {
                const el = fieldOf(name);
                if (!el) return;
                el.hidden = !on;
                el.classList.toggle("is-conditionally-hidden", !on);
            };

            function applyVisibility() {
                const byUrl = !subjectSelect || subjectSelect.value !== "var";
                show("urlPart", byUrl);
                show("paramName", byUrl && !!partSelect && partSelect.value === "param");
                if (subjectSelect) show("var", !byUrl);
            }

            subjectSelect?.addEventListener("change", applyVisibility);
            partSelect?.addEventListener("change", applyVisibility);
            // populateLineFromObject sets values without "change" events.
            lineEl._applySubjectFieldVisibility = applyVisibility;
            applyVisibility();
        }

        // primary first
        primary.forEach(([fname, fdef]) => {
            renderFieldEntry(fname, fdef, false);
        });

        // advanced after (hidden initially)
        advanced.forEach(([fname, fdef]) => {
            if (renderFieldEntry(fname, fdef, true)) advancedRenderedCount++;
        });

        // insert toggle after primary only if there are advanced fields (and at least one was rendered)
        const hasAdvanced = advancedRenderedCount > 0;
        if (hasAdvanced) {
            const toggleRow = createEl("div", {className: "fields-toggle-row"}, [toggleMoreBtn]);
            fieldsWrap.append(toggleRow);
            // Validation opens this section when the field it flagged sits in
            // there; it must not take the caret away from that field, hence
            // the opt-out from the toggle's usual focus jump.
            line._expandAdvancedFields = () => setAdvancedExpanded(true, {moveFocus: false});
        }

        line.append(header, fieldsWrap, infoDialog);

        if (actionArrayBlocks.length > 0) {
            const below = createEl("div", {className: "action-arrays-below"});
            actionArrayBlocks.forEach((block) => below.append(block));
            line.append(below);
        }

        // Initialize visuals
        applyDisabledState(line);

        if (actionKey === "case") {
            const refreshTitle = () => updateLineTitles(line.parentElement || actionsEl);
            fieldsWrap.addEventListener("input", refreshTitle);
            fieldsWrap.addEventListener("change", refreshTitle);
        }

        wireRepeatDatasetOverridesCount(line);
        wireRunCustomStepDynamicInputs(line);
        wireSetViewportPresetToggle(line);
        wireSubjectFields(line);
        wireScanEngine(line);

        return line;
    }

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

    function validateLine(lineEl, report = null) {
        // Skip validation entirely if disabled
        if (isEffectivelyDisabled(lineEl)) return true;

        let ok = true;

        // `missing` marks "you left a required field empty", the error the run
        // button most often stops on and the one worth the caret.
        const note = (el, {missing = false} = {}) => {
            if (!report || !el) return;
            if (!report.firstError) report.firstError = el;
            if (missing && !report.firstMissingRequired) report.firstMissingRequired = el;
        };

        // Only direct fields of this line
        lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
            const type = fieldEl.dataset.fieldType;
            const required = fieldEl.dataset.required === "true";
            const enumJson = fieldEl.dataset.enum || null;
            const allowed = enumJson ? JSON.parse(enumJson) : null;
            const control = fieldEl.querySelector("input, select, textarea");
            if (!control) return;

            setError(control, null);
            control.removeAttribute(RESERVED_ERROR_ATTR);
            if (fieldEl._selectTokenUi && fieldEl._selectTokenUi.tokenInput) {
                setError(fieldEl._selectTokenUi.tokenInput, null);
            }

            let raw = control.value;
            let val = typeof raw === "string" ? raw.trim() : raw;

            const tokenUi = fieldEl._selectTokenUi || null;
            if (tokenUi && tokenUi.select === control && control.value === SELECT_TOKEN_SENTINEL) {
                const tokenVal = resolveSelectValueForSerialization({
                    selectValue: control.value,
                    tokenValue: tokenUi.tokenInput?.value
                });
                if (!tokenVal) {
                    setError(tokenUi.tokenInput || control, "This field is required");
                    note(tokenUi.tokenInput || control, {missing: required});
                    ok = false;
                    return;
                }
                if (!isTokenizedSelectValue(tokenVal)) {
                    setError(
                        tokenUi.tokenInput || control,
                        "Use a variable token like {var:preset}"
                    );
                    note(tokenUi.tokenInput || control);
                    ok = false;
                    return;
                }
                // A variable token is resolved at runtime from custom-step inputs,
                // so its value can't be checked against the fixed enum options here.
                return;
            }

            // Before the empty-field skip: an empty argsJson is exactly when a
            // custom step input's default would hide a row variable.
            const reservedMsg = reservedVariableConflict(lineEl, fieldEl.dataset.fieldName, val);
            if (reservedMsg) {
                setError(control, reservedMsg);
                control.setAttribute(RESERVED_ERROR_ATTR, "true");
                note(control);
                ok = false;
                return;
            }

            if (!required && !val) return;

            if (type === "boolean") {
                if (val !== "true" && val !== "false") {
                    setError(control, "Choose true or false");
                    note(control, {missing: required && String(val) === ""});
                    ok = false;
                }
                return;
            }

            if (allowed && allowed.length) {
                if (!allowed.map(String).includes(String(val))) {
                    setError(control, `Choose one of: ${allowed.join(", ")}`);
                    note(control, {missing: required && String(val) === ""});
                    ok = false;
                    return;
                }
                return;
            }

            if (type === "number") {
                const integer = fieldEl.dataset.integer === "true";
                if (val === "" || !parseNumberFieldText(val, {integer})) {
                    setError(control, val === "" && required
                        ? "This number is required"
                        : (integer
                            ? "Provide a whole number or a variable such as {var:count}"
                            : "Provide a number or a variable such as {var:count}"));
                    note(control, {missing: required && val === ""});
                    ok = false;
                }
                return;
            }

            // Read from the environment where it runs: nothing to type.
            if (required && String(val) === "" && fieldEl.dataset.secretEnv) return;

            // A secret (a password) is never saved, so a config loaded back
            // has it empty: when the value read leaves secrets out anyway,
            // an empty one is not a reason to refuse the rest.
            if (required && String(val) === "" && secretsOptional
                && fieldEl.querySelector(".sb-input-with-icon[data-secret='true']")) {
                return;
            }

            if (required && String(val) === "") {
                setError(control, "This field is required");
                note(control, {missing: true});
                ok = false;
                return;
            }

            // A selector the browser can't parse fails the scan, so it is
            // caught here, before a run. One with a {var:...} token is only
            // known at runtime.
            // An id surea11y does not have would run nothing, or every rule:
            // a typo is caught here, before a run.
            if (fieldEl.dataset.ruleIds === "true" && val) {
                const engineId = engineOfLine(lineEl);
                const unknown = unknownRuleIds(val, engineId);
                if (unknown.length) {
                    const name = engineId;
                    setError(control, unknown.length === 1
                        ? `${name} has no rule named "${unknown[0]}"`
                        : `${name} has no rules named ${unknown.map((id) => `"${id}"`).join(", ")}`);
                    note(control);
                    ok = false;
                    return;
                }
            }

            if (fieldEl.dataset.cssSelector === "true" && val && !String(val).includes("{")) {
                const bad = invalidCssSelector(String(val));
                if (bad !== null) {
                    setError(control, `"${bad}" is not a valid CSS selector`);
                    note(control);
                    ok = false;
                }
            }
        });

        // Set color scheme and contrast keeps an empty field as it is, so with
        // both empty it would change nothing: the run refuses it, so it is
        // caught here.
        if (ok && lineEl.dataset.actionType === "setColorScheme") {
            const scheme = lineEl.querySelector(':scope > .fields > .field[data-field-name="colorScheme"] select');
            const contrast = lineEl.querySelector(':scope > .fields > .field[data-field-name="highContrast"] select');
            if (scheme && contrast && scheme.value === "" && contrast.value === "") {
                setError(scheme, "Choose a color scheme, high contrast, or both");
                note(scheme, {missing: true});
                ok = false;
            }
        }

        // Set language needs a language: from the list, typed in Other
        // language, or Run default. A typed one is checked here, unless a
        // variable gives it, which is only known at runtime.
        if (ok && lineEl.dataset.actionType === "setLanguage") {
            const listed = lineEl.querySelector(':scope > .fields > .field[data-field-name="language"] select');
            const typed = lineEl.querySelector(':scope > .fields > .field[data-field-name="customLanguage"] input');
            const typedVal = typed ? typed.value.trim() : "";
            if (listed && typed && listed.value === "" && typedVal === "") {
                setError(listed, "Choose a language, or type one in Other language");
                note(listed, {missing: true});
                ok = false;
            } else if (typed && typedVal && !typedVal.includes("{") && typedVal.toLowerCase() !== "default") {
                let valid = false;
                try { valid = Intl.getCanonicalLocales(typedVal).length === 1; } catch { valid = false; }
                if (!valid) {
                    setError(typed, `"${typedVal}" is not a language tag: use one such as es-MX, fr-CA or zh-Hant-HK`);
                    note(typed);
                    ok = false;
                }
            }
        }

        // Then validate nested arrays and their child lines recursively
        lineEl.querySelectorAll(":scope .action-array").forEach((arrWrap) => {
            const isRequired = arrWrap.dataset.required === "true";
            const sub = arrWrap.querySelector(".actions-subcontainer");
            const items = Array.from(sub.querySelectorAll(":scope > .line"));

            setError(arrWrap, null);

            if (isRequired && items.length === 0) {
                setError(arrWrap, "At least one action is required");
                note(arrWrap, {missing: true});
                ok = false;
                return;
            }

            // A scan inside two Merged scans would belong to both.
            if (lineEl.dataset.actionType === "mergedScan"
                && Array.from(sub.querySelectorAll('.line[data-action-type="mergedScan"]')).some((l) => !isEffectivelyDisabled(l))) {
                setError(arrWrap, "A Merged scan cannot contain another Merged scan");
                note(arrWrap);
                ok = false;
                return;
            }

            for (const child of items) {
                const childOk = validateLine(child, report);
                if (!childOk) {
                    ok = false;
                    setError(arrWrap, "Some nested actions have errors");
                    break;
                }
            }
        });

        if (!ok && report) report.invalidLines.add(lineEl);

        return ok;
    }

    /**
     * A collapsed step hides its fields, so the error message validation just
     * wrote would sit off screen and its control could not even take focus.
     * Clear the way to it the same way the step tree does when you pick a step
     * in it: everything collapses except the steps that failed and the steps
     * nesting them, which are expanded.
     */
    function revealInvalidLines(container, invalidLines) {
        const keepOpen = new Set();
        invalidLines.forEach((lineEl) => {
            let node = lineEl;
            while (node && container.contains(node)) {
                keepOpen.add(node);
                node = node.parentElement ? node.parentElement.closest(".line") : null;
            }
        });

        container.querySelectorAll(".line").forEach((lineEl) => {
            if (!keepOpen.has(lineEl)) collapseAction(lineEl);
        });

        keepOpen.forEach((lineEl) => {
            expandAction(lineEl);
            revealAdvancedFieldsWithErrors(lineEl);
        });
    }

    /** Same for a flagged field parked behind the step's "show more" toggle. */
    function revealAdvancedFieldsWithErrors(lineEl) {
        if (typeof lineEl._expandAdvancedFields !== "function") return;
        const flagged = lineEl.querySelector(
            ':scope > .fields > .field.is-advanced[aria-invalid="true"],' +
            ':scope > .action-arrays-below > .action-array.is-advanced[aria-invalid="true"]'
        );
        if (flagged) lineEl._expandAdvancedFields();
    }

    function validateContainer(container, {reveal = true} = {}) {
        let allOk = true;
        let firstInvalidLine = null;
        const report = {invalidLines: new Set(), firstMissingRequired: null, firstError: null};
        const lines = listLines(container);
        for (const line of lines) {
            const ok = validateLine(line, report);
            if (!ok) {
                allOk = false;
                if (!firstInvalidLine) firstInvalidLine = line;
            }
        }
        if (allOk) return {allOk, firstFocusTarget: null};

        if (reveal) revealInvalidLines(container, report.invalidLines);
        // The caret goes to the first empty required field - the thing the user
        // has to type into - and only falls back to another kind of error, or to
        // the step itself, when there is no such field.
        const firstFocusTarget =
            report.firstMissingRequired || report.firstError || firstInvalidLine;
        return {allOk, firstFocusTarget};
    }

    function readLineToObject(lineEl, { maskValues = "text", markMasked = false } = {}) {
        const type = lineEl.dataset.actionType;
        if (!type) {
            console.warn("Line without actionType", lineEl);
            return null;
        }

        const obj = { type };

        // Persist custom title (optional)
        const alias = String(lineEl.dataset.alias || "").trim();
        if (alias) obj.alias = alias;

        // Preserve explicit disabled state
        if (isExplicitDisabled(lineEl)) obj.disabled = true;

        // Preserve UI collapsed state
        if (lineEl.classList.contains("is-collapsed")) obj.collapsed = true;

        // Only direct fields of this line
        lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
            const name = fieldEl.dataset.fieldName;
            const ftype = fieldEl.dataset.fieldType;
            const required = fieldEl.dataset.required === "true";
            const control = fieldEl.querySelector("input, select, textarea");
            if (!name || !control) return;

            if (fieldEl.dataset.widget === "tags" && fieldEl._tagsWidget) {
                const tags = fieldEl._tagsWidget.getTags();
                if (tags.length || required) obj[name] = tags;
                return;
            }

            const isSecret = !!fieldEl.querySelector(".sb-input-with-icon[data-secret='true']");

            if (ftype === "boolean") {
                const val = control.value;
                if (required) {
                    obj[name] = val === "true";
                } else {
                    if (val === "") {
                        // omit
                    } else if (val === "true" || val === "false") {
                        obj[name] = val === "true";
                    }
                }
            } else if (ftype === "number") {
                const raw = control.value.trim();
                if (raw !== "") {
                    const parsed = parseNumberFieldText(raw);
                    if (parsed) obj[name] = parsed.value;
                } else if (required) {
                    obj[name] = null;
                }
            } else {
                let raw = control.value.trim();

                const tokenUi = fieldEl._selectTokenUi || null;
                if (tokenUi && tokenUi.select === control && raw === SELECT_TOKEN_SENTINEL) {
                    raw = resolveSelectValueForSerialization({
                        selectValue: raw,
                        tokenValue: tokenUi.tokenInput?.value
                    });
                }

                if ((ftype || "").includes("[]")) {
                    const arr = raw === "" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
                    if (arr.length || required) obj[name] = arr;
                    return;
                }

                if ((ftype || "").includes("number")) {
                    const num = Number(raw);
                    if (!Number.isNaN(num) && raw !== "") {
                        obj[name] = num;
                        return;
                    }
                }

                // A reference left as it was is the reference, saved or run:
                // it holds no secret, and nothing was masked.
                if (isSecret && raw === "" && fieldEl.dataset.secretEnv) {
                    obj[name] = {$env: fieldEl.dataset.secretEnv};
                    return;
                }

                // maskValues: "redact" - a secret value never leaves the browser:
                // the step is written without it, and markMasked below records
                // that the value is missing on purpose.
                if ((raw !== "" || required) && !(isSecret && maskValues === "redact")) {
                    obj[name] = raw;
                }

                // Outside the guard above: the flag must survive even when the
                // secret field is empty and the value key is omitted entirely.
                if (isSecret && markMasked) obj[maskedFlagKey(name)] = true;
            }
        });

        // Then collect nested actions from direct action-array children
        lineEl.querySelectorAll(":scope > .action-arrays-below > .action-array, :scope > .action-array").forEach((arrWrap) => {
            const fieldName = arrWrap.dataset.fieldName;
            const sub = arrWrap.querySelector(".actions-subcontainer");
            const items = Array.from(sub.querySelectorAll(":scope > .line"));
            const children = items.map((child) => readLineToObject(child, { maskValues, markMasked }));
            if (children.length > 0 || arrWrap.dataset.required === "true") {
                obj[fieldName] = children;
            }
        });

        if (
            obj.type === "repeat" &&
            typeof obj.itemsText === "string" &&
            obj.itemsText.trim() !== ""
        ) {
            delete obj.repetitions;
            delete obj.times;
            delete obj.count;
        }

        return obj;
    }

    function readContainer(container, { maskValues = "text", markMasked = false } = {}) {
        const lines = listLines(container);
        return lines.map((line) => readLineToObject(line, { maskValues, markMasked }));
    }

    function setFieldValue(fieldEl, value) {
        if (fieldEl.dataset.widget === "tags" && fieldEl._tagsWidget) {
            const arr = Array.isArray(value)
                ? value
                : (typeof value === "string" ? value.split(",") : []);
            fieldEl._tagsWidget.setTags(arr);
            return;
        }

        const control = fieldEl.querySelector("input, select, textarea");
        if (!control) return;

        if (fieldEl.querySelector(".sb-input-with-icon[data-secret='true']")) {
            const envName = secretRefName(value);
            setSecretReference(fieldEl, envName);
            if (envName) {
                control.value = "";
                return;
            }
        }

        const type = fieldEl.dataset.fieldType || "";
        const isArrayText =
            type.includes("[]") && control.tagName === "INPUT" && control.type === "text";
        const acceptsNumber = /\bnumber\b/.test(type);

        if (type === "boolean" && control.tagName === "SELECT") {
            // "false" as text is false: Boolean("false") would turn it true.
            if (value === "" || value == null) control.value = "";
            else control.value = String(value === true || value === "true");
            return;
        }

        if (type === "number" && control.tagName === "INPUT") {
            if (value == null || value === "") {
                control.value = "";
            } else {
                const parsed = parseNumberFieldText(value);
                control.value = parsed ? String(parsed.value) : "";
            }
            return;
        }

        if (control.tagName === "SELECT") {
            if (control.multiple) {
                const set = new Set((Array.isArray(value) ? value : []).map(String));
                Array.from(control.options).forEach(o => o.selected = set.has(o.value));
            } else {
                const tokenUi = fieldEl._selectTokenUi || null;
                if (tokenUi && tokenUi.select === control) {
                    const allowedValues = [...control.options]
                        .map((o) => String(o.value))
                        .filter((v) => v !== SELECT_TOKEN_SENTINEL);
                    const resolved = resolveSelectValueForUi({ value, allowedValues });
                    control.value = resolved.selectValue;
                    tokenUi.tokenInput.value = resolved.tokenValue;
                    tokenUi.syncTokenUi();
                } else {
                    const normalized = value == null ? "" : String(value);
                    // A step naming an engine that is not installed keeps it,
                    // as an option of its own, rather than quietly running
                    // with another: validation then says what is missing.
                    if (fieldEl.dataset.fieldName === "engine" && normalized
                        && ![...control.options].some((o) => o.value === normalized)) {
                        const missing = document.createElement("option");
                        missing.value = normalized;
                        missing.textContent = `${normalized} (not installed)`;
                        control.append(missing);
                    }
                    control.value = [...control.options].some((o) => o.value === normalized) ? normalized : "";
                }
            }
            return;
        }

        if (isArrayText && Array.isArray(value)) {
            control.value = value.join(", ");
            return;
        }

        if (
            acceptsNumber &&
            (typeof value === "number" || /^[+-]?\d+(\.\d+)?$/.test(String(value)))
        ) {
            control.value = value == null ? "" : String(value);
            return;
        }

        // A field that takes an object as well as text (argsJson) shows it as
        // the JSON it stands for, and saves that text.
        if (value && typeof value === "object") {
            control.value = JSON.stringify(value);
            return;
        }

        control.value = value == null ? "" : String(value);
    }

    /**
     * Shows a secret field as reading `envName` from the environment, or as
     * an ordinary secret field when `envName` is null. Typing a value replaces
     * the reference.
     */
    function setSecretReference(fieldEl, envName) {
        const input = fieldEl.querySelector("input");
        if (!input) return;
        const noteId = `${input.id || fieldEl.dataset.fieldName}-env-note`;
        const clear = () => {
            delete fieldEl.dataset.secretEnv;
            fieldEl.querySelector(".secret-env-note")?.remove();
            if (input.dataset.envPlaceholder != null) {
                input.placeholder = input.dataset.envPlaceholder;
                delete input.dataset.envPlaceholder;
            }
            const described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== noteId);
            if (described.length) input.setAttribute("aria-describedby", described.join(" "));
            else input.removeAttribute("aria-describedby");
        };
        clear();
        if (!envName) return;

        fieldEl.dataset.secretEnv = envName;
        input.dataset.envPlaceholder = input.placeholder || "";
        input.placeholder = `From the environment: ${envName}`;

        const note = document.createElement("p");
        note.className = "hint secret-env-note";
        note.id = noteId;
        note.textContent = `Read from the environment variable ${envName} where the workflow runs, and saved as that name. Type a value to use it instead.`;
        (input.closest(".sb-input-with-icon") || input).after(note);
        input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), noteId].filter(Boolean).join(" "));

        input.addEventListener("input", function replaced() {
            if (input.value === "") return;
            input.removeEventListener("input", replaced);
            clear();
        });
    }

    /** Says in the placeholder that a secret field came back empty because its
     *  value was not saved, as it does for every config with a secret value. */
    function applyMaskedFlagToField(fieldEl) {
        if (!fieldEl.querySelector(".sb-input-with-icon[data-secret='true']")) return;

        const input = fieldEl.querySelector("input");
        if (!input || input.value !== "") return;

        if (input.dataset.originalPlaceholder == null) {
            input.dataset.originalPlaceholder = input.placeholder || "";
        }
        input.placeholder = MASKED_VALUE_PLACEHOLDER;

        input.addEventListener("input", function restore() {
            input.placeholder = input.dataset.originalPlaceholder || "";
            delete input.dataset.originalPlaceholder;
            input.removeEventListener("input", restore);
        });
    }

    // indexPath: the step's place in the list being loaded ("3", "3.1"), to
    // say where a step left out was.
    function populateLineFromObject(lineEl, actionObj, indexPath = null) {
        // For setViewport, width/height (when set) silently override preset at
        // runtime - normalize preset to "custom" here so the dropdown always
        // reflects what actually applies, regardless of what was saved.
        const effectiveActionObj = withResolvedSetViewportPreset(actionObj);

        // Only direct fields of this line
        lineEl.querySelectorAll(":scope > .fields > .field").forEach((fieldEl) => {
            const name = fieldEl.dataset.fieldName;
            if (!name) return;
            if (Object.prototype.hasOwnProperty.call(effectiveActionObj, name)) {
                setFieldValue(fieldEl, effectiveActionObj[name]);
            }
            if (effectiveActionObj[maskedFlagKey(name)] === true) {
                applyMaskedFlagToField(fieldEl);
            }
        });

        // setFieldValue() above doesn't dispatch change events, so re-sync the
        // preset/custom-size visibility toggle explicitly after loading values.
        if (typeof lineEl._applySetViewportPresetVisibility === "function") {
            lineEl._applySetViewportPresetVisibility();
        }
        if (typeof lineEl._applyScanEngine === "function") {
            lineEl._applyScanEngine();
        }
        if (typeof lineEl._applySubjectFieldVisibility === "function") {
            lineEl._applySubjectFieldVisibility();
        }

        // Apply explicit disabled flag from JSON before children
        setLineExplicitDisabled(lineEl, !!actionObj?.disabled);

        // Apply optional alias (custom title)
        if (typeof actionObj?.alias === "string" && actionObj.alias.trim() !== "") {
            lineEl.dataset.alias = actionObj.alias.trim();
        } else {
            delete lineEl.dataset.alias;
        }

        // Restore UI collapsed state (only when effectively enabled)
        if (!isEffectivelyDisabled(lineEl)) {
            if (actionObj?.collapsed) collapseAction(lineEl);
            else expandAction(lineEl);
        }

        // Then populate direct nested action-arrays
        lineEl.querySelectorAll(":scope > .action-arrays-below > .action-array, :scope > .action-array").forEach((arrWrap) => {
            const fieldName = arrWrap.dataset.fieldName;
            const sub = arrWrap.querySelector(".actions-subcontainer");
            const summary = arrWrap.querySelector(".action-array__summary");
            if (!sub) return;

            sub.querySelectorAll(":scope > .line").forEach((n) => n.remove());

            const children = Array.isArray(actionObj[fieldName]) ? actionObj[fieldName] : [];
            children.forEach((childObj, childIndex) => {
                const def = defs[childObj?.type];
                if (!def) {
                    // Not a step the builder has: left out, and said so by
                    // appendActions, which collects these while it loads.
                    droppedWhileLoading?.push({
                        type: childObj?.type,
                        indexPath: indexPath ? `${indexPath}.${childIndex + 1}` : null,
                        field: fieldName,
                    });
                    return;
                }
                const childLine = makeLine(
                    childObj.type,
                    def,
                    (line, dir, btnRef) => moveLine(sub, line, dir, btnRef)
                );
                sub.append(childLine);
                populateLineFromObject(childLine, childObj || {}, indexPath ? `${indexPath}.${childIndex + 1}` : null);
            });

            refreshReorderButtons(sub);
            if (summary) refreshActionArraySummary(summary, sub);
        });
    }

    function createAndPopulateLine(actionObj, container, indexPath = null) {
        if (!actionObj || typeof actionObj !== "object") return null;
        const type = actionObj.type;
        const def = defs[type];
        if (!def) return null;

        const line = makeLine(type, def, (lineEl, dir, btnRef) =>
            moveLine(container, lineEl, dir, btnRef)
        );
        if (container === actionsEl) rootAddLine(line, { activate: false });
        else container.append(line);
        populateLineFromObject(line, actionObj, indexPath);
        return line;
    }

    // ---- Catalog helpers: categories, sorting, toolbar order ----
    function getActionLabel([key, def]) {
        return String(def?.label || key);
    }

    function normalizeCategory(def) {
        const raw = String(def?.category || "").trim();
        return raw ? raw : "general";
    }

    function groupAndSortDefs(defsObj) {
        const entries = Object.entries(defsObj);
        const byCategory = new Map();
        for (const e of entries) {
            const def = e[1];
            const cat = normalizeCategory(def);
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat).push(e);
        }
        for (const [cat, list] of byCategory) {
            list.sort((a, b) => getActionLabel(a).localeCompare(getActionLabel(b)));
        }
        const categoryOrder = Array.from(byCategory.keys()).sort((a, b) =>
            a.localeCompare(b)
        );
        return {byCategory, categoryOrder};
    }

    function getToolbarOrderedEntries(defsObj) {
        const entries = Object.entries(defsObj);
        const primaryKey = "a11yScan";
        const primary = entries.find(([k]) => k === primaryKey);
        const rest = entries
            .filter(([k]) => k !== primaryKey)
            .sort((a, b) => getActionLabel(a).localeCompare(getActionLabel(b)));
        return primary ? [primary, ...rest] : rest;
    }

    // ---- Palette catalog and recent memory ----
    const RECENT_MAX = 6;
    const recentKeys = [];

    function pushRecent(key) {
        const i = recentKeys.indexOf(key);
        if (i !== -1) recentKeys.splice(i, 1);
        recentKeys.unshift(key);
        if (recentKeys.length > RECENT_MAX) recentKeys.pop();
    }

    // ---- Command palette ----
    function showCommandPalette({onPick}) {
        const {byCategory, categoryOrder} = groupAndSortDefs(listedDefs());

        const dialogId = randomId("sb-palette");
        const titleId = randomId("sb-palette-title");

        const dlg = createEl("dialog", {
            id: dialogId,
            className: "src-dialog sb-palette",
            role: "dialog",
            "aria-labelledby": titleId,
            "aria-modal": "true"
        });

        const header = createEl("div", {className: "src-dialog-header"}, [
            createEl("p", {id: titleId, className: "src-dialog-title"}, "Add an action to the workflow"),
            createEl("p", {className: "src-dialog-meta"}, "Type to filter, use arrows to navigate, Enter to add")
        ]);

        const search = createEl("input", {
            type: "text",
            className: "sb-palette-search",
            placeholder: "Search actions by name, category, or description",
            "aria-autocomplete": "list",
            "aria-haspopup": "listbox"
        });

        const live = createEl("div", {
            className: "visually-hidden",
            role: "status"
        });

        const listboxId = `${dialogId}-listbox`;
        const resultsWrap = createEl("div", {className: "sb-palette-results"});
        const listbox = createEl("ul", {
            role: "listbox",
            id: listboxId,
            className: "sb-palette-listbox"
        });
        resultsWrap.append(listbox);

        const footer = createEl("div", {className: "src-dialog-footer"}, [
            createEl("span", {}),
            createEl("button", {type: "button", className: "src-dialog-close"}, "Close")
        ]);

        search.setAttribute("aria-controls", listboxId);

        dlg.append(
            header,
            createEl("div", {className: "src-dialog-body"}, [search, live, resultsWrap]),
            footer
        );

        let options = [];
        let activeIndex = -1;

        function makeOption(key, def) {
            const id = randomId("sbopt");

            const btn = createEl(
                "button",
                {
                    type: "button",
                    className: "sb-palette-btn",
                    tabindex: "-1", // we keep focus on the search input
                    "data-key": key
                },
                [
                    createEl("div", {className: "sb-palette-btn-title"}, def.label || key),
                ]
            );

            const li = createEl(
                "li",
                {
                    role: "option",
                    id,
                    className: "sb-palette-item",
                    tabindex: "-1",
                    "data-key": key,
                    "aria-selected": "false"
                },
                [btn]
            );

            // Hover moves the active highlight
            li.addEventListener("mousemove", () => {
                const idx = options.indexOf(li);
                if (idx !== -1 && idx !== activeIndex) setActive(idx);
            });

            // Click chooses
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const idx = options.indexOf(li);
                if (idx !== -1) setActive(idx);
                chooseActive();
            });

            return li;
        }

        function itemMatches(key, def, q) {
            if (!q) return true;
            const hay = [key, def?.label || "", def?.category || "", def?.description || ""]
                .join(" ")
                .toLowerCase();
            return hay.includes(q.toLowerCase());
        }

        function renderList(filterText = "") {
            listbox.innerHTML = "";
            options = [];
            activeIndex = -1;

            let count = 0;

            const appendHeader = (text) => {
                const header = createEl(
                    "li",
                    {role: "presentation", className: "sb-palette-group-title"},
                    text
                );
                listbox.append(header);
            };

            const appendOption = (k, d) => {
                const li = makeOption(k, d);
                listbox.append(li);
                options.push(li);
                count++;
            };

            for (const cat of categoryOrder) {
                const entries = (byCategory.get(cat) || []).filter(([k, d]) =>
                    itemMatches(k, d, filterText)
                );
                if (!entries.length) continue;

                appendHeader(cat);
                for (const [k, d] of entries) appendOption(k, d);
            }

            live.textContent = `${count} result${count === 1 ? "" : "s"}`;

            if (options.length) setActive(0);
            else {
                activeIndex = -1;
                search.removeAttribute("aria-activedescendant");
            }
        }

        function setActive(newIndex) {
            if (!options.length) {
                activeIndex = -1;
                search.removeAttribute("aria-activedescendant");
                return;
            }

            newIndex = Math.max(0, Math.min(newIndex, options.length - 1));

            // Clear previous active option
            if (activeIndex >= 0 && options[activeIndex]) {
                const prev = options[activeIndex];
                prev.setAttribute("aria-selected", "false");
                prev.classList.remove("is-active");

                // Also clear visual state on the inner button (if present)
                const prevBtn = prev.querySelector(".sb-palette-btn");
                if (prevBtn) prevBtn.classList.remove("is-active");
            }

            // Set new active option
            activeIndex = newIndex;
            const opt = options[activeIndex];

            opt.setAttribute("aria-selected", "true");
            opt.classList.add("is-active");

            // Also mark the inner button as active
            const btn = opt.querySelector(".sb-palette-btn");
            if (btn) btn.classList.add("is-active");

            search.setAttribute("aria-activedescendant", opt.id);
            opt.scrollIntoView({block: "nearest"});
        }

        function moveActive(delta) {
            if (!options.length) return;
            const target = activeIndex < 0 ? 0 : activeIndex + delta;
            setActive(target);
        }

        function pageMove(count) {
            if (!options.length) return;
            const target = activeIndex < 0 ? 0 : activeIndex + count;
            setActive(target);
        }

        function chooseActive() {
            if (activeIndex < 0 || !options[activeIndex]) return;
            const key = options[activeIndex].getAttribute("data-key");
            pushRecent(key);
            try {
                dlg.close("pick");
            } catch {
            }
            dlg.remove();
            onPick?.(key);
        }

        dlg.addEventListener("close", () => dlg.remove());
        dlg.querySelector(".src-dialog-close").addEventListener("click", () => dlg.close("cancel"));
        dlg.addEventListener("click", (e) => {
            if (e.target === dlg) dlg.close("cancel");
        });

        search.addEventListener("input", () => renderList(search.value));

        search.addEventListener("keydown", (e) => {
            const key = e.key;
            if (key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                return dlg.close("cancel");
            }
            if (key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                return chooseActive();
            }
            if (key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                return moveActive(+1);
            }
            if (key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                return moveActive(-1);
            }
            if (key === "Home") {
                e.preventDefault();
                e.stopPropagation();
                return setActive(0);
            }
            if (key === "End") {
                e.preventDefault();
                e.stopPropagation();
                return setActive(options.length - 1);
            }
            if (key === "PageDown") {
                e.preventDefault();
                e.stopPropagation();
                return pageMove(+10);
            }
            if (key === "PageUp") {
                e.preventDefault();
                e.stopPropagation();
                return pageMove(-10);
            }
        });

        document.body.appendChild(dlg);
        if (typeof dlg.showModal === "function") dlg.showModal();
        renderList("");
        search.focus();
    }

    // ---- Mount UI ----
    function mountToolbar(targetEl) {
        targetEl.innerHTML = "";

        const toolbarWrap = createEl("div", {className: "toolbar-favorites"});

        const shortcutCallback = (shortcut) => {
            return () => {
                const line = makeLine(shortcut, defs[shortcut], (lineEl, dir, btnRef) =>
                    moveLine(actionsEl, lineEl, dir, btnRef)
                );
                rootAddLine(line);
                pushRecent(shortcut);
                focusFirstInput(line);
                refreshReorderButtons(actionsEl);
                pushHistory("toolbar:addShortcut");
            }
        }
        addShortcuts(SHORTCUTS, shortcutCallback, toolbarWrap);

        const addAnyBtn = createEl(
            "button",
            {
                type: "button",
                className: "secondary-button icon-button",
                title: "Add any action (Ctrl/⌘+K)",
                ariaLabel: "Add any action (Ctrl/⌘+K)"
            },
            svgIcon('add')
        );

        addAnyBtn.addEventListener("click", () => {
            showCommandPalette({
                onPick: (key) => {
                    const def = defs[key];
                    if (!def) return;
                    const line = makeLine(key, def, (lineEl, dir, btnRef) =>
                        moveLine(actionsEl, lineEl, dir, btnRef)
                    );
                    rootAddLine(line);
                    pushRecent(key);
                    focusFirstInput(line);
                    refreshReorderButtons(actionsEl);
                    pushHistory("toolbar:addAny");
                }
            });
        });
        toolbarWrap.append(addAnyBtn);

        const pasteBtn = iconButton({
            className: "secondary-button icon-button paste-button",
            ariaLabel: "Paste action",
            title: "Paste action",
            iconName: "paste"
        });
        registerPasteButton(pasteBtn, isListedType);

        pasteBtn.addEventListener("click", () => {
            if (!clipboardAction || !isListedType(clipboardAction.type)) return;
            const def = defs[clipboardAction.type];
            if (!def) return;

            const line = makeLine(clipboardAction.type, def, (lineEl, dir, btnRef) =>
                moveLine(actionsEl, lineEl, dir, btnRef)
            );
            rootAddLine(line);
            populateLineFromObject(line, clipboardAction);
            focusFirstInput(line);
            refreshReorderButtons(actionsEl);
            pushHistory("toolbar:paste");
        });

        toolbarWrap.append(pasteBtn);

        targetEl.append(toolbarWrap);

        return {addAnyBtn, pasteBtn};
    }

    // render into all toolbars
    const toolbarMounts = toolbarTargets.map(mountToolbar);

    // only bind Ctrl/⌘+K once, but trigger the first mounted Add action button
    if (!window.__A11YLAB_PALETTE_HOTKEY_BOUND) {
        window.__A11YLAB_PALETTE_HOTKEY_BOUND = true;
        window.addEventListener("keydown", (e) => {
            const isMod = e.ctrlKey || e.metaKey;
            if (isMod && (e.key === "k" || e.key === "K")) {
                e.preventDefault();
                toolbarMounts[0]?.addAnyBtn?.click();
            }
        });
    }

    refreshReorderButtons(actionsEl);

    // history baseline
    pushHistory("init", { force: true });

    // ---- Public API ----
    function validate({reveal = true} = {}) {
        const {allOk, firstFocusTarget} = validateContainer(actionsEl, {reveal});
        return {ok: allOk, firstErrorEl: firstFocusTarget || null};
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
        const value = readContainer(actionsEl, { maskValues, markMasked });
        return {ok: true, value};
    }

    function addAction(type) {
        const def = defs[type];
        if (!def) throw new Error(`Unknown action type: ${type}`);
        const line = makeLine(type, def, (lineEl, dir, btnRef) =>
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

        return {added, errors};
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
        getValue,
        addAction,
        appendActions,
        loadActions,
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
