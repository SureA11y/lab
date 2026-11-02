'use strict';

// Prefer browser (Firefox), fall back to chrome (Chrome/Edge)
const api = globalThis.browser || globalThis.chrome;

const SERVER_BASE = 'http://127.0.0.1:3000';

const SHARED = globalThis.A11Y_CANONICAL;
if (!SHARED) throw new Error('A11Y_CANONICAL shared module not loaded. Ensure popup.html loads canonical-shared.js before main.js');

const { isoNow, makeLocalId } = SHARED;

const DEFAULT_EXTENSION_ENGINE_ID = '@surea11y';

function createFallbackExtensionUiEngineFacade() {
    return {
        getDefaultEngineId() {
            return DEFAULT_EXTENSION_ENGINE_ID;
        },
        resolveEngine(engineId) {
            const id = String(engineId || DEFAULT_EXTENSION_ENGINE_ID).trim() || DEFAULT_EXTENSION_ENGINE_ID;
            const registry = Object.create(null);
            if (globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE && globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE.engineId) {
                registry[globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE.engineId] = globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE;
            }
            const engine = registry[id];
            if (!engine) {
                throw new Error(`Unsupported extension engine: ${id}`);
            }
            return engine;
        }
    };
}

const EXTENSION_UI_ENGINE = (globalThis.A11Y_EXTENSION_UI_ENGINE && typeof globalThis.A11Y_EXTENSION_UI_ENGINE.resolveEngine === 'function')
    ? globalThis.A11Y_EXTENSION_UI_ENGINE
    : createFallbackExtensionUiEngineFacade();

// --------------------------- Metrics (browser) ---------------------------
// Extracted to main-metrics.js
const METRICS = globalThis.A11Y_METRICS;
if (!METRICS) throw new Error('A11Y_METRICS module not loaded. Ensure main.html loads main-metrics.js before main.js');

const buildA11ySummary = METRICS.buildA11ySummary;
const ISSUES_TABLE = globalThis.A11Y_ISSUES_TABLE;
if (!ISSUES_TABLE) throw new Error('A11Y_ISSUES_TABLE module not loaded. Ensure popup.html loads main-issues-table.js before main.js');

// --------------------------- Workflow payload (shared builder) ---------------------------
const WORKFLOW_BUILDER_API = globalThis.A11Y_WORKFLOW_PAYLOAD_BUILDER || null;
const WORKFLOW_DEPS_API = globalThis.A11Y_WORKFLOW_DEPS || null;

function runtimeSendMessage(message) {
    return new Promise((resolve, reject) => {
        try {
            api.runtime.sendMessage(message, (res) => {
                const err = api.runtime && api.runtime.lastError;
                if (err) reject(new Error(err.message || String(err)));
                else resolve(res);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function tabsQuery(queryInfo) {
    return new Promise((resolve, reject) => {
        try {
            api.tabs.query(queryInfo, (tabs) => {
                const err = api.runtime && api.runtime.lastError;
                if (err) reject(new Error(err.message || String(err)));
                else resolve(tabs || []);
            });
        } catch (e) {
            reject(e);
        }
    });
}

// storage.session is Chrome MV3-only. Fallback to storage.local when absent (Firefox MV2).
const sessionStore = (api.storage && api.storage.session) ? api.storage.session : (api.storage ? api.storage.local : null);

function isContextInvalidatedError(e) {
    const msg = String((e && e.message) ? e.message : e);
    return /context.*invalidated/i.test(msg) || /extension.*invalidated/i.test(msg);
}

function sessionGet(keys) {
    try {
        if (!sessionStore || typeof sessionStore.get !== 'function') return Promise.resolve({});
        const p = sessionStore.get(keys);
        // Chrome MV3 returns a Promise, MV2 may return via callback in some APIs, but storage.get is Promise in MV3.
        if (p && typeof p.then === 'function') {
            return p.catch((e) => {
                if (isContextInvalidatedError(e)) return {};
                throw e;
            });
        }
        return Promise.resolve(p || {});
    } catch (e) {
        if (isContextInvalidatedError(e)) return Promise.resolve({});
        return Promise.reject(e);
    }
}

function sessionSet(obj) {
    try {
        if (!sessionStore || typeof sessionStore.set !== 'function') return Promise.resolve();
        const p = sessionStore.set(obj);
        if (p && typeof p.then === 'function') {
            return p.catch((e) => {
                if (isContextInvalidatedError(e)) return;
                throw e;
            });
        }
        return Promise.resolve();
    } catch (e) {
        if (isContextInvalidatedError(e)) return Promise.resolve();
        return Promise.reject(e);
    }
}

async function getTargetTab() {
    // DevTools panel path
    const panelTabId = getPanelTargetTabId();
    if (typeof panelTabId === 'number' && Number.isFinite(panelTabId)) {
        return { id: panelTabId };
    }

    if (!api.tabs || typeof api.tabs.query !== 'function') {
        throw new Error('tabs API is not available, and no target tab could be resolved.');
    }

    let tabs = [];

    // Best popup path
    try {
        tabs = await tabsQuery({ active: true, lastFocusedWindow: true });
    } catch {}

    // Fallback
    if (!tabs || !tabs.length) {
        try {
            tabs = await tabsQuery({ active: true, currentWindow: true });
        } catch {}
    }

    // Extra defensive fallback for rare popup / focus edge cases
    if (!tabs || !tabs.length) {
        try {
            tabs = await tabsQuery({ active: true });
        } catch {}
    }

    // Prefer a real page tab, not an extension/internal page
    const tab = (tabs || []).find((t) => {
        const url = String(t && t.url || '');
        return typeof t?.id === 'number'
            && !url.startsWith('chrome-extension://')
            && !url.startsWith('moz-extension://')
            && !url.startsWith('edge-extension://')
            && !url.startsWith('devtools://');
    }) || (tabs && tabs[0]);

    if (!tab || typeof tab.id !== 'number' || !Number.isFinite(tab.id)) {
        throw new Error('No target tab');
    }

    return tab;
}

function getPanelTargetTabId() {
    try {
        const tabId = globalThis.__A11Y_TARGET_TAB_ID;
        if (typeof tabId === 'number' && Number.isFinite(tabId)) {
            return tabId;
        }
    } catch {}

    return null;
}

function initUi() {
    const startBtn = document.getElementById('start');
    const runBtn = document.getElementById('run');
    const downloadBtn = document.getElementById('download');
    const finishBtn = document.getElementById('finish');
    const resultBtn = document.getElementById('result');
    const clearBtn = document.getElementById('clear');
    const sendToUiBtn = document.getElementById('sendToUi');

    const out = document.getElementById('out');
    // The output scrolls past 350px: reachable by keyboard while it does.
    if (out && globalThis.A11Y_SCROLL_REACH) globalThis.A11Y_SCROLL_REACH.keepScrollBoxesReachable(out.parentElement || document.body, '.out');
    const statusEl = document.getElementById('status');
    const runIdEl = document.getElementById('runId');
    const labelInput = document.getElementById('label');
    const profileField = document.getElementById('profile');
    const includeBestPracticeInput = document.getElementById('includeBestPractice');
    const contextInput = document.getElementById('context');
    const excludeInput = document.getElementById('exclude');

    const isDevTools = document.body.classList.contains('panel');

    // DS Disclosure (button + aria-expanded/aria-controls) for the Advanced
    // options panel — replaces a native <details>/<summary>.
    const advancedToggle = document.getElementById('advancedToggle');
    const advancedContent = document.getElementById('advancedContent');

    function setAdvancedExpanded(expanded) {
        if (!advancedToggle || !advancedContent) return;
        advancedToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        advancedContent.hidden = !expanded;
        advancedToggle.setAttribute('aria-label', expanded ? 'Collapse advanced options' : 'Expand advanced options');
    }

    if (advancedToggle && advancedContent) {
        // The devtools panel has vertical room, so default it open; the popup
        // stays collapsed to keep the initial surface compact.
        setAdvancedExpanded(isDevTools);
        advancedToggle.addEventListener('click', () => {
            const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
            setAdvancedExpanded(!expanded);
        });
    }

    const customCssInput = document.getElementById('custom-css');
    const customCssAddBtn = document.getElementById('customCssAdd');
    const customCssRemoveBtn = document.getElementById('customCssRemove');

    const shotWrap = document.getElementById('shotWrap');
    const shotBox = document.getElementById('shotBox');
    const shotImg = document.getElementById('shotImg');
    const shotMeta = document.getElementById('shotMeta');

    const screenshotDialogApi =
        globalThis.A11Y_SCREENSHOT_DIALOG &&
        typeof globalThis.A11Y_SCREENSHOT_DIALOG.createScreenshotDialog === 'function'
            ? globalThis.A11Y_SCREENSHOT_DIALOG.createScreenshotDialog()
            : null;

    let currentScreenshotButtons = [];

    let lastScreenshotDataUrl = null;

    const CUSTOM_CSS_STYLE_ID = '__a11y_ext_custom_css__';
    let customCssInjected = false;

    let pickerActive = false;

    let runId = null;
    let lastResultPayload = null;
    let lastResultFileName = null;
    let sessionState = 'idle'; // 'idle' | 'started' | 'finished'
    let sessionScanCount = 0;
    let isApplyingRemoteSessionSync = false;

    function persistSessionState() {
        sessionSet({
            runId: runId || null,
            sessionState,
            sessionScanCount
        }).catch(() => {});
    }

    function getCustomCssText() {
        return String(customCssInput?.value || '').trim();
    }

    function syncCustomCssButtons() {
        if (customCssAddBtn) customCssAddBtn.disabled = !getCustomCssText();
        if (customCssRemoveBtn) customCssRemoveBtn.disabled = !customCssInjected;
    }

    function forceImportant(css) {
        const s = String(css || '');
        return s.replace(/:\s*[^;}{]+(?=\s*[;}])/g, (decl) => {
            if (/!important/i.test(decl)) return decl;
            return `${decl} !important`;
        });
    }

    async function injectOrReplaceCustomCss(tabId, cssText) {
        const rawCSS = String(cssText || '').trim();
        if (!rawCSS) return;

        const css = forceImportant(rawCSS);
        // IMPORTANT: Use code-string injection so it also works via the DevTools-panel fallback
        // (A11Y_EXEC_IN_TAB supports "code", not "func").
        const code = `
            (function(){
                try {
                    var id = ${JSON.stringify(CUSTOM_CSS_STYLE_ID)};
                    var css = ${JSON.stringify(css)};
                    try {
                        var old = document.getElementById(id);
                        if (old) old.remove();
                    } catch {}
                    var style = document.createElement('style');
                    style.id = id;
                    style.textContent = css;
                    (document.head || document.documentElement).appendChild(style);
                } catch {}
            })();
        `;

        await execInTab(tabId, { code, allFrames: false });
    }

    async function removeCustomCss(tabId) {
        const code = `
            (function(){
                try {
                    var id = ${JSON.stringify(CUSTOM_CSS_STYLE_ID)};
                    var el = document.getElementById(id);
                    if (el) el.remove();
                } catch {}
            })();
        `;
        await execInTab(tabId, { code, allFrames: false });
    }

    function clearScreenshotUi() {
        clearScreenshotDialogItems();
        lastScreenshotDataUrl = null;
        if (shotImg) shotImg.removeAttribute('src');
        if (shotMeta) shotMeta.textContent = '';
        if (shotBox) shotBox.style.removeProperty('--shot-ratio');
        if (shotWrap) shotWrap.hidden = true;
    }

    function renderScreenshotUi(screenshotObj, viewportRatio) {
        const dataUrl = screenshotObj && typeof screenshotObj.dataUrl === 'string'
            ? screenshotObj.dataUrl
            : null;

        if (!dataUrl) {
            clearScreenshotUi();
            return;
        }

        lastScreenshotDataUrl = dataUrl;

        if (shotImg) shotImg.src = dataUrl;

        if (shotBox) {
            const r =
                (typeof viewportRatio === 'number' && Number.isFinite(viewportRatio) && viewportRatio > 0)
                    ? viewportRatio
                    : (16 / 9);
            shotBox.style.setProperty('--shot-ratio', `${r} / 1`);
        }

        let metaText = 'screenshot';

        if (shotMeta) {
            const mode = screenshotObj && screenshotObj.mode ? String(screenshotObj.mode) : '';
            const ratio =
                typeof viewportRatio === 'number' && Number.isFinite(viewportRatio)
                    ? viewportRatio.toFixed(3)
                    : '';

            metaText =
                (mode ? `mode: ${mode}` : 'screenshot') +
                (ratio ? `, ratio: ${ratio}` : '');

            shotMeta.textContent = metaText;
        }

        if (shotWrap) {
            const dialogApi =
                globalThis.A11Y_SCREENSHOT_DIALOG &&
                typeof globalThis.A11Y_SCREENSHOT_DIALOG.createScreenshotDialog === 'function'
                    ? (window.__shotDialog ||= globalThis.A11Y_SCREENSHOT_DIALOG.createScreenshotDialog())
                    : null;

            // remove old wrapper if present
            const existingBtn = shotWrap.querySelector('.shotButton');
            if (existingBtn) {
                existingBtn.replaceWith(shotBox);
            }

            if (dialogApi && shotBox && shotImg) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'shotButton';
                btn.setAttribute('aria-label', 'Open screenshot preview');

                btn.appendChild(shotBox);

                btn.addEventListener('click', () => {
                    dialogApi.open({
                        src: shotImg.src,
                        alt: 'Screenshot preview',
                        title: 'Screenshot preview',
                        meta: metaText
                    });
                });

                shotWrap.insertBefore(btn, shotMeta);
            }

            shotWrap.hidden = false;
        }
    }

    function clearScreenshotDialogItems() {
        for (const btn of currentScreenshotButtons) {
            if (btn && btn.isConnected) {
                btn.replaceWith(...btn.childNodes);
            }
        }
        currentScreenshotButtons = [];

        if (screenshotDialogApi && screenshotDialogApi.dialog && screenshotDialogApi.dialog.open) {
            screenshotDialogApi.close();
        }
    }

    function buildScreenshotMetaText(screenshotObj, viewportRatio) {
        const mode = screenshotObj && screenshotObj.mode ? String(screenshotObj.mode) : '';
        const ratio = (typeof viewportRatio === 'number' && Number.isFinite(viewportRatio))
            ? viewportRatio.toFixed(3)
            : '';

        return (mode ? `mode: ${mode}` : 'screenshot') + (ratio ? `, ratio: ${ratio}` : '');
    }

    function makeScreenshotButton({ boxEl, imgEl, metaText, titleText }) {
        if (!boxEl || !imgEl) return boxEl;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shotButton';
        btn.setAttribute('aria-label', metaText ? `${titleText}, ${metaText}` : titleText);

        btn.appendChild(boxEl);

        btn.addEventListener('click', () => {
            if (!screenshotDialogApi) return;
            screenshotDialogApi.open({
                src: imgEl.src,
                alt: imgEl.alt || titleText,
                title: titleText,
                meta: metaText
            });
        });

        currentScreenshotButtons.push(btn);
        return btn;
    }

    const CUSTOM_CSS_STORAGE_KEYS = ['customCssText', 'customCssInjected'];

    async function loadCustomCssState() {
        try {
            const data = await api.storage.local.get(CUSTOM_CSS_STORAGE_KEYS);
            if (customCssInput && typeof data?.customCssText === 'string') {
                customCssInput.value = data.customCssText;
            }
            customCssInjected = !!data?.customCssInjected;
            try {
                const tab = await getTargetTab();
                if (tab?.id) customCssInjected = await detectCustomCssInjected(tab.id);
            } catch {}
        } catch {
            // ignore
        }

        syncCustomCssButtons();
    }

    async function saveCustomCssState() {
        try {
            await api.storage.local.set({
                customCssText: String(customCssInput?.value || ''),
                customCssInjected: !!customCssInjected
            });
        } catch {
            // ignore
        }
    }

    async function detectCustomCssInjected(tabId) {
        try {
            const code = `
            (function(){
                try { return !!document.getElementById(${JSON.stringify(CUSTOM_CSS_STYLE_ID)}); }
                catch { return false; }
            })();
        `;
            let found = false;
            if (api.scripting && typeof api.scripting.executeScript === 'function') {
                const injected = await api.scripting.executeScript({
                    target: { tabId },
                    func: (src) => { try { return (0, eval)(src); } catch { return false; } },
                    args: [code]
                });
                found = !!(injected && injected[0] && injected[0].result);
            } else {
                // MV2
                const arr = await new Promise((resolve) => {
                    api.tabs.executeScript(tabId, { code }, (res) => resolve(res || []));
                });
                found = !!(arr && arr[0]);
            }
            return found;
        } catch {
            return false;
        }
    }

    function downloadJson(filename, obj) {
        const safeName = String(filename || 'extension-report.json')
            .replace(/[\\/:*?"<>|]+/g, '-')
            .trim() || 'extension-report.json';

        const json = JSON.stringify(obj, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = safeName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // "Where the failures are" for a run of several scans: the same analysis,
    // wording and charts as the lab's report view (src/shared/issue-dispersion*.js,
    // copied here by build:extension-shared). The panel has no scan anchors, so
    // strip columns read out their scan but do not link to it.
    function renderDispersionBlock(outEl, scans) {
        const core = globalThis.A11Y_ISSUE_DISPERSION;
        const view = globalThis.A11Y_ISSUE_DISPERSION_VIEW;
        if (!core || !view || !Array.isArray(scans) || scans.length < 2) return;

        view.installDispersionInteractions(document);

        const holder = document.createElement('div');
        holder.innerHTML = view.reportSectionHTML(core.analyseDispersion(scans), { id: 'dsp-panel', linkScans: false });
        outEl.append(...holder.childNodes);
    }

    function renderGlobalFindingsBlock(outEl, payload) {
        // By outcome, built from the scans: a report does not keep them
        // (report-format.js).
        const global = payload && Array.isArray(payload.scans) && WORKFLOW_DEPS_API && typeof WORKFLOW_DEPS_API.findingsByOutcome === 'function'
            ? WORKFLOW_DEPS_API.findingsByOutcome(payload.scans)
            : null;
        const gf = global ? [...(global.fail || []), ...(global.cantTell || [])] : [];
        if (!gf.length) return;

        const header = document.createElement('div');
        header.className = 'muted muted-block';
        header.textContent = `Global findings, aggregated across all scans (${gf.length} rule(s))`;
        outEl.appendChild(header);

        const row = document.createElement('div');
        row.className = 'resultsRow';

        // LEFT placeholder to keep same alignment as per-scan rows
        const placeholder = document.createElement('div');
        placeholder.className = 'shotWrap';
        placeholder.style.opacity = '0.6';
        placeholder.textContent = '';
        row.appendChild(placeholder);

        // RIGHT container, reuse the same issues table renderer
        const scanOut = document.createElement('div');
        scanOut.className = 'scanOut';
        row.appendChild(scanOut);

        outEl.appendChild(row);

        const pseudoScan = {
            id: 'global',
            scanId: 'global',
            label: 'Global findings',
            url: (payload && payload.url) ? String(payload.url) : null,
            canonical: { findings: gf }
        };

        ISSUES_TABLE.renderInto(scanOut, pseudoScan, { enableDialogs: true });

        const sep = document.createElement('hr');
        sep.className = 'result-sep';
        outEl.appendChild(sep);
    }

    customCssInput?.addEventListener('input', () => {
        // Only "Preview on page" depends on textarea content. "Remove preview" depends on injected state.
        syncCustomCssButtons();
        saveCustomCssState().catch(() => {});
    });

    customCssAddBtn?.addEventListener('click', async () => {
        const css = getCustomCssText();
        if (!css) return;

        try {
            setStatus('Previewing custom CSS on the page...');
            const tab = await getTargetTab();
            if (!tab || !tab.id) throw new Error('No target tab');

            await injectOrReplaceCustomCss(tab.id, css);
            customCssInjected = true;
            syncCustomCssButtons();
            await saveCustomCssState();

            setStatus('Preview applied. Remove it when done, or run a scan (it will be applied automatically either way).');
        } catch (e) {
            setStatus(`Could not preview custom CSS: ${String(e && e.message ? e.message : e)}`);
        }
    });

    customCssRemoveBtn?.addEventListener('click', async () => {
        try {
            setStatus('Removing custom CSS preview...');
            const tab = await getTargetTab();
            if (!tab || !tab.id) throw new Error('No target tab');

            await removeCustomCss(tab.id);
            customCssInjected = false;
            syncCustomCssButtons();
            await saveCustomCssState();

            setStatus('Preview removed.');
        } catch (e) {
            setStatus(`Could not remove custom CSS preview: ${String(e && e.message ? e.message : e)}`);
        }
    });

    // -------------------------------- Picker helpers -------------------------------
    // NOTE: ui.html is loaded into #root by ui-loader.js, which often means inline <script> tags
    // do not execute (innerHTML). We therefore wire the picker buttons here, in main.js,
    // so it works reliably in both the popup and the DevTools panel.

    async function execInTab(tabId, details) {
        // MV3 path (Chrome/Edge, Firefox MV3)
        if (api.scripting && typeof api.scripting.executeScript === 'function') {
            const target = { tabId, allFrames: !!details.allFrames };
            if (details.func) {
                await api.scripting.executeScript({ target, func: details.func, args: details.args || [] });
                return;
            }
            if (details.files && details.files.length) {
                await api.scripting.executeScript({ target, files: details.files });
                return;
            }
            if (typeof details.code === 'string') {
                const code = String(details.code);
                await api.scripting.executeScript({
                    target,
                    func: (src) => { try { (0, eval)(src); } catch {} },
                    args: [code]
                });
                return;
            }
            return;
        }

        // MV2 path (Firefox, and some Chrome extension pages)
        if (api.tabs && typeof api.tabs.executeScript === 'function') {
            await new Promise((resolve, reject) => {
                try {
                    api.tabs.executeScript(tabId, {
                        allFrames: !!details.allFrames,
                        code: details.code,
                        file: details.file
                    }, () => {
                        const err = api.runtime && api.runtime.lastError;
                        if (err) reject(new Error(err.message || String(err)));
                        else resolve();
                    });
                } catch (e) {
                    reject(e);
                }
            });
            return;
        }

        // DevTools panel / restricted extension context fallback:
        // ask background.js to inject for us (background has tabs/scripting permissions).
        if (api.runtime && typeof api.runtime.sendMessage === 'function') {
            const payload = {
                type: 'A11Y_EXEC_IN_TAB',
                tabId,
                details: {
                    allFrames: !!details.allFrames,
                    code: (typeof details.code === 'string') ? String(details.code) : undefined,
                    file: details.file ? String(details.file) : undefined,
                    files: Array.isArray(details.files) ? details.files.map(String) : undefined
                }
            };
            await runtimeSendMessage(payload);
            return;
        }

        throw new Error('No available injection mechanism in this extension context.');
    }

    async function startPicker(targetKey, selectorType) {
        const tab = await getTargetTab();
        if (!tab || !tab.id) throw new Error('No target tab');

        pickerActive = true;
        setStatus('Picker active. Use arrows, Enter, Escape in this panel. Click in page to select.');

        const sessionId = String(Date.now()) + ':' + Math.random().toString(16).slice(2);
        const payload = {
            target: String(targetKey || ''),
            selectorType: String(selectorType || '').trim() || 'selector',
            sessionId,
            clipboardPrefix: ''
        };

        // Store in page-global for css-selector.js to read.
        if (api.scripting && typeof api.scripting.executeScript === 'function') {
            await execInTab(tab.id, {
                func: (p) => { globalThis.paramFromSaveContentExtPicker = p; },
                args: [payload],
                allFrames: false
            });
            await execInTab(tab.id, { files: ['css-selector.js'], allFrames: false });
        } else {
            await execInTab(tab.id, {
                code: `window.paramFromSaveContentExtPicker = ${JSON.stringify(payload)};`,
                allFrames: false
            });
            await execInTab(tab.id, { file: 'css-selector.js', allFrames: false });
        }
    }

    function applyPickedValueToUi(rawTarget, pickedValue, selectorType) {
        const target = String(rawTarget || '');
        const value = String(pickedValue || '').trim();
        const type = String(selectorType || 'selector').trim().toLowerCase();

        if (!value) return;

        // Your button uses data-selector="contentSelector", but the field id is "context".
        const fieldId = (target === 'contentSelector') ? 'context' : target;
        const field = document.getElementById(fieldId);
        if (!field) return;

        // Keep the existing comma-append behavior only for selector lists.
        if (fieldId === 'exclude' && type !== 'gettext') {
            const current = String(field.value || '').trim();
            if (!current) field.value = value;
            else field.value = current.replace(/\s*,\s*$/, '') + ', ' + value;
        } else {
            field.value = value;
        }

        try { field.focus(); } catch {}
        saveContextAndExclude().catch(() => {});
    }

    function clearSelectorField(rawTarget) {
        const target = String(rawTarget || '');
        const fieldId = (target === 'contentSelector') ? 'context' : target;

        const field = document.getElementById(fieldId);
        if (!field) return;

        field.value = '';
        try { field.focus(); } catch {}

        // Persist the cleared value
        saveContextAndExclude().catch(() => {});
    }

    function wirePickerButtons() {
        // Use event delegation so wiring survives UI re-renders (ui.html is injected into #root).
        if (globalThis.__A11Y_PICKER_DELEGATION__) return;
        globalThis.__A11Y_PICKER_DELEGATION__ = true;

        document.addEventListener('click', async (e) => {
            // Delegate picker buttons
            const pickerBtn = e && e.target && typeof e.target.closest === 'function'
                ? e.target.closest('.pickerBtn')
                : null;
            if (pickerBtn) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const target = pickerBtn.getAttribute('data-selector');
                    const selectorType = pickerBtn.getAttribute('data-selector-type');
                    try { pickerBtn.blur(); } catch {}
                    await startPicker(target, selectorType);
                    setStatus('Pick an element in the page, press Escape to cancel.');
                } catch (err) {
                    setStatus('Picker failed.');
                    console.warn(err);
                }
                return;
            }

            const clearBtnLocal = e && e.target && typeof e.target.closest === 'function'
                ? e.target.closest('.clearBtn')
                : null;
            if (clearBtnLocal) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const target = clearBtnLocal.getAttribute('data-selector');
                    clearSelectorField(target);
                    setStatus('Cleared.');
                } catch (err) {
                    console.warn(err);
                }
                return;
            }
        }, true);

        // Listen for picker results coming from css-selector.js
        if (api && api.runtime && api.runtime.onMessage && typeof api.runtime.onMessage.addListener === 'function') {
            api.runtime.onMessage.addListener((msg) => {
                try {
                    if (!msg || msg.type !== 'A11Y_PICKER_RESULT') return;
                    pickerActive = false;
                    applyPickedValueToUi(
                        msg.target,
                        typeof msg.value === 'string' ? msg.value : msg.selector,
                        msg.selectorType
                    );
                    setStatus('Selector added.');
                } catch {}
            });
        }
    }

    if (api.runtime && api.runtime.onMessage && typeof api.runtime.onMessage.addListener === 'function') {
        api.runtime.onMessage.addListener((msg) => {
            try {
                if (!msg || msg.type !== 'A11Y_TRIGGER_RUN_SHORTCUT') return;

                const targetTabId = (typeof msg.tabId === 'number' && Number.isFinite(msg.tabId))
                    ? msg.tabId
                    : null;

                const panelTabId = getPanelTargetTabId();

                // In DevTools panel mode, only react if this panel belongs to the same inspected tab.
                if (document.body.classList.contains('panel')) {
                    if (typeof panelTabId !== 'number' || targetTabId == null || panelTabId !== targetTabId) {
                        return;
                    }
                }

                runScanFromUi().catch((e) => {
                    out.textContent = String(e && e.stack ? e.stack : e);
                    setStatus('Failed');
                });
            } catch (e) {
                console.warn('[A11Y] failed to handle shortcut run message', e);
            }
        });
    }

    function pickerCommandCode(cmd) {
        // cmd is a small string like "move:up" or "confirm" or "cancel"
        return `
    (function(){
      try {
        var p = globalThis.__A11Y_CSS_SELECTOR_PICKER__;
        if (!p || p.destroyed) return;
        var cmd = ${JSON.stringify(cmd)};
        if (cmd === 'confirm' && typeof p.confirm === 'function') return p.confirm();
        if (cmd === 'cancel' && typeof p.cancel === 'function') return p.cancel();
        if (cmd.startsWith('move:') && typeof p.move === 'function') return p.move(cmd.slice(5));
      } catch {}
    })();
  `;
    }

    async function sendPickerCommand(cmd) {
        const tab = await getTargetTab();
        if (!tab || !tab.id) return;
        await execInTab(tab.id, { code: pickerCommandCode(cmd), allFrames: false });
    }

    // Capture keys in the panel, because focus stays here.
    document.addEventListener('keydown', async (e) => {
        if (!pickerActive) return;

        // Don’t hijack typing in inputs/textareas in the panel
        const t = e.target;
        const tag = (t && t.tagName) ? t.tagName.toLowerCase() : '';
        const isTypingField = tag === 'input' || tag === 'textarea' || (t && t.isContentEditable);
        if (isTypingField) return;

        let cmd = null;
        if (e.key === 'ArrowUp') cmd = 'move:up';
        else if (e.key === 'ArrowDown') cmd = 'move:down';
        else if (e.key === 'ArrowLeft') cmd = 'move:left';
        else if (e.key === 'ArrowRight') cmd = 'move:right';
        else if (e.key === 'Enter') cmd = 'confirm';
        else if (e.key === 'Escape') cmd = 'cancel';

        if (!cmd) return;

        e.preventDefault();
        e.stopPropagation();

        try { await sendPickerCommand(cmd); } catch {}
    }, true);

    function syncActionButtons() {
        const payloadScanCount = getPayloadScanCount(lastResultPayload);
        const hasPayloadToSend = payloadScanCount > 0;
        const hasRunId = !!runId;
        const isStarted = sessionState === 'started';
        const isFinished = sessionState === 'finished';
        const hasServerScans = sessionScanCount > 0;

        if (startBtn) startBtn.disabled = isStarted;
        if (downloadBtn) downloadBtn.disabled = !hasPayloadToSend;
        if (sendToUiBtn) sendToUiBtn.disabled = !hasPayloadToSend;
        if (finishBtn) finishBtn.disabled = !isStarted;
        if (resultBtn) resultBtn.disabled = !hasRunId || !hasServerScans || (!isStarted && !isFinished);
    }

    function getPayloadScanCount(payload) {
        return (payload && Array.isArray(payload.scans)) ? payload.scans.length : 0;
    }

    function setStatus(msg) {
        statusEl.textContent = msg || '';
    }

    function setRunId(id) {
        runId = id || null;
        runIdEl.textContent = runId || '(none)';
        syncActionButtons();
        persistSessionState();
    }

    // The extension scans with surea11y, in English: the panel offers no
    // choice of engine or language.
    function getSelectedEngineId() {
        return DEFAULT_EXTENSION_ENGINE_ID;
    }

    function getSelectedEngineDefinition() {
        const engineId = getSelectedEngineId();
        return EXTENSION_UI_ENGINE.resolveEngine(engineId);
    }

    async function loadRunId() {
        const data = await sessionGet(['runId', 'sessionState', 'sessionScanCount']);
        const savedRunId = data && data.runId ? data.runId : null;
        const savedSessionState = data && typeof data.sessionState === 'string' ? data.sessionState : '';
        const savedSessionScanCount = data && Number.isFinite(data.sessionScanCount) ? data.sessionScanCount : 0;

        runId = savedRunId;
        sessionScanCount = savedSessionScanCount;
        runIdEl.textContent = runId || '(none)';
        sessionState = savedRunId
            ? (savedSessionState === 'finished' ? 'finished' : 'started')
            : 'idle';

        syncActionButtons();
    }

    async function refreshSharedSessionStateFromStorage() {
        if (isApplyingRemoteSessionSync) return;
        isApplyingRemoteSessionSync = true;

        try {
            const previousRunId = runId;
            const previousSessionState = sessionState;
            const previousSessionScanCount = sessionScanCount;

            await loadRunId();

            // If the shared session changed in another panel, local payload/result
            // data may no longer match the current shared session.
            const sessionIdentityChanged = previousRunId !== runId;
            const sessionLifecycleChanged = previousSessionState !== sessionState;
            const sessionCountChanged = previousSessionScanCount !== sessionScanCount;

            if (sessionIdentityChanged || sessionLifecycleChanged || sessionCountChanged) {
                if (previousRunId !== runId) {
                    lastResultPayload = null;
                    lastResultFileName = null;
                    clearScreenshotUi();
                    if (out) out.textContent = '';
                }

                syncActionButtons();
            }
        } finally {
            isApplyingRemoteSessionSync = false;
        }
    }

    // The profiles a scan checks against, as the lab's scan step offers
    // them: one WCAG 2.2 level, or none, and any standards, core's own and
    // those of the packs the extension was built with
    // (engines/vendor/standards.json, from build:extension-shared). With the
    // best-practice option beside them, they resolve to the scan's selection
    // ({ version, level, profile, profiles?, bestPractices }) the way the lab
    // resolves them (shared/conformance-targets.js).
    const RESTATES_WCAG = new Set(['en301549-v4.1.1', 'en301549-v3.2.1']);
    // The packs the extension was built with, by name, which a scan of one of
    // their profiles names to core.
    let builtPackNames = [];

    const wcagRadios = () => Array.from(profileField ? profileField.querySelectorAll('input[name="profileWcag"]') : []);
    const standardBoxes = () => Array.from(profileField ? profileField.querySelectorAll('input[name="profileStandard"]') : []);
    const targetLabelOf = (id) => globalThis.A11Y_CONFORMANCE_TARGETS?.targetLabel(id) || id;

    /** The profiles chosen, the WCAG level first: ['wcag22-aa', 'wai-aria-1.2']. */
    function selectedProfiles() {
        const radio = wcagRadios().find((r) => r.checked);
        const wcag = radio && radio.value ? [radio.value] : [];
        return [...wcag, ...standardBoxes().filter((b) => b.checked).map((b) => b.value)];
    }

    /** Chooses profiles: one id, a list, or ids separated by commas. */
    function setSelectedProfiles(value) {
        const targets = globalThis.A11Y_CONFORMANCE_TARGETS;
        const ids = targets ? targets.profileList(value) : [];
        const wcag = ids.find((id) => targets.isWcagTarget(id)) || '';
        for (const r of wcagRadios()) r.checked = r.value === wcag;
        for (const b of standardBoxes()) b.checked = ids.includes(b.value);
        syncProfileSummary();
    }

    function syncProfileSummary() {
        const ids = selectedProfiles();
        const summary = document.getElementById('profileSummary');
        if (summary) {
            summary.textContent = ids.length
                ? `This scan checks: ${ids.map(targetLabelOf).join(' + ')}`
                : 'Nothing chosen: the scan checks WCAG 2.2 AA.';
        }
        const note = document.getElementById('profileOverlap');
        const wcag = ids.find((id) => globalThis.A11Y_CONFORMANCE_TARGETS?.isWcagTarget(id));
        const restated = wcag ? ids.filter((id) => RESTATES_WCAG.has(id)) : [];
        if (note) {
            note.hidden = !restated.length;
            note.textContent = restated.length
                ? `${restated.map(targetLabelOf).join(' and ')} restate${restated.length === 1 ? 's' : ''} WCAG Level A and AA: beside ${targetLabelOf(wcag)} the scan checks those criteria again, under the standard’s name.`
                : '';
        }
    }

    /**
     * The standards of the packs the extension was built with, offered beside
     * core's own. A build without packs has none.
     */
    async function loadBuiltStandards() {
        let built = null;
        try {
            const url = api.runtime && typeof api.runtime.getURL === 'function'
                ? api.runtime.getURL('engines/vendor/standards.json')
                : 'engines/vendor/standards.json';
            const res = await fetch(url);
            built = res.ok ? await res.json() : null;
        } catch {
            built = null;
        }
        if (!built || !Array.isArray(built.standards)) return;
        builtPackNames = Array.isArray(built.packs) ? built.packs.filter((n) => typeof n === 'string' && n) : [];
        const targets = globalThis.A11Y_CONFORMANCE_TARGETS;
        if (targets) targets.registerStandardProfiles(built.standards);
        const group = document.getElementById('profileStandards');
        if (!group) return;
        for (const std of built.standards) {
            for (const p of Array.isArray(std && std.profiles) ? std.profiles : []) {
                if (!p || typeof p.id !== 'string' || standardBoxes().some((b) => b.value === p.id)) continue;
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.name = 'profileStandard';
                input.value = p.id;
                const label = document.createElement('label');
                label.className = 'profiles-option';
                label.append(input, ' ', String(p.label || p.id));
                group.append(label);
            }
        }
    }

    function getSelectedTarget() {
        const ids = selectedProfiles();
        // What the session keeps and a scan step would save: one id as it
        // always was, several as a list.
        const raw = ids.length > 1 ? ids : (ids[0] || 'wcag22-aa');
        const targets = globalThis.A11Y_CONFORMANCE_TARGETS;
        const selection = targets.resolveScanSelection({
            profile: raw,
            includeBestPractice: !!includeBestPracticeInput?.checked
        });
        return {
            raw,
            selection,
            level: selection.level,
            profile: selection.profile,
            label: selection.profile ? targets.targetLabel(selection.profile) : null,
            // A scan of several: every one, named.
            profiles: Array.isArray(selection.profiles)
                ? selection.profiles.map((id) => ({ id, label: targets.targetLabel(id) || id }))
                : null,
            tags: targets.selectionTags(selection)
        };
    }

    // The language surea11y writes its findings and steps in.
    const RESULTS_LANGUAGE = 'en';

    async function loadProfile() {
        await loadBuiltStandards();
        const data = await sessionGet(['profile', 'includeBestPractice']);
        const saved = data && (typeof data.profile === 'string' || Array.isArray(data.profile)) ? data.profile : null;
        if (saved) setSelectedProfiles(saved);
        else syncProfileSummary();
        if (includeBestPracticeInput && data && typeof data.includeBestPractice === 'boolean') {
            includeBestPracticeInput.checked = data.includeBestPractice;
        }
    }

    function getContextSelector() {
        const v = String(contextInput?.value || '').trim();
        return v || null;
    }

    function getExcludeSelectorsRaw() {
        const v = String(excludeInput?.value || '').trim();
        return v || '';
    }

    function parseExcludeSelectors(raw) {
        const s = String(raw || '').trim();
        if (!s) return [];
        return s.split(',')
            .map((x) => x.trim())
            .filter(Boolean);
    }

    async function loadContextAndExclude() {
        const data = await api.storage.local.get(['contextSelector', 'excludeSelectorsRaw']);
        const ctx = data && typeof data.contextSelector === 'string' ? data.contextSelector : '';
        const exc = data && typeof data.excludeSelectorsRaw === 'string' ? data.excludeSelectorsRaw : '';

        if (contextInput) contextInput.value = ctx;
        if (excludeInput) excludeInput.value = exc;
    }

    async function saveContextAndExclude() {
        try {
            await api.storage.local.set({
                contextSelector: String(contextInput?.value || ''),
                excludeSelectorsRaw: String(excludeInput?.value || '')
            });
        } catch {}
    }

    profileField?.addEventListener('change', async () => {
        syncProfileSummary();
        try {
            await sessionSet({ profile: getSelectedTarget().raw });
        } catch {}
    });

    includeBestPracticeInput?.addEventListener('change', async () => {
        try {
            await sessionSet({ includeBestPractice: !!includeBestPracticeInput.checked });
        } catch {}
    });

    // Wire picker buttons once the shared UI is present.
    wirePickerButtons();

    contextInput?.addEventListener('input', () => {
        saveContextAndExclude();
    });

    excludeInput?.addEventListener('input', () => {
        saveContextAndExclude();
    });

    async function postJson(path, body) {
        const res = await fetch(SERVER_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) {
            throw new Error(json && (json.error || json.details) ? (json.error || json.details) : `HTTP ${res.status}`);
        }
        return json;
    }

    async function getJson(path) {
        const res = await fetch(SERVER_BASE + path, { method: 'GET' });
        if (res.status === 202) return { status: 'collecting' };
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) {
            throw new Error(json && (json.error || json.details) ? (json.error || json.details) : `HTTP ${res.status}`);
        }
        return json;
    }

    startBtn.addEventListener('click', async () => {
        clearScreenshotUi();
        out.textContent = '';
        setStatus('Starting session...');

        try {
            const r = await postJson('/manual-start', {
                scenarioName: null,
                tags: null
            });

            sessionState = 'started';
            sessionScanCount = 0;
            lastResultPayload = null;
            lastResultFileName = null;
            setRunId(r.runId);
            syncActionButtons();
            persistSessionState();

            out.textContent = `Session started.\nrunId=${r.runId}`;
            setStatus('Ready');
        } catch (e) {
            out.textContent = String(e && e.stack ? e.stack : e);
            setStatus('Failed');
        }
    });

    async function ensureSessionStarted() {
        if (runId) return runId;

        setStatus('Starting session...');
        const r = await postJson('/manual-start', { scenarioName: null, tags: null });

        sessionState = 'started';sessionState = 'started';
        sessionScanCount = 0;
        lastResultPayload = null;
        lastResultFileName = null;
        setRunId(r.runId);
        syncActionButtons();
        persistSessionState();

        out.textContent = `Session started.\nrunId=${r.runId}`;
        setStatus('Ready');

        return r.runId;
    }

    async function runScanFromUi() {
        out.textContent = '';
        setStatus('Running accessibility scan...');

        let didAutoInjectCustomCss = false;
        let tabForCleanup = null;

        try {
            try {
                await ensureSessionStarted();
            } catch (e) {
                // Server unavailable, proceed locally, but disable session actions
                sessionState = 'idle';
                setRunId(null);
                syncActionButtons();
            }

            const target = getSelectedTarget();
            const { selection } = target;
            const wcagLevel = target.level;
            try {
                await sessionSet({ profile: target.raw, includeBestPractice: selection.bestPractices });
            } catch {}

            const engineId = getSelectedEngineId();
            const selectedEngine = getSelectedEngineDefinition();

            const contextSelector = getContextSelector();
            const excludeSelectorsRaw = getExcludeSelectorsRaw();
            const excludeSelectors = parseExcludeSelectors(excludeSelectorsRaw);

            // Persist these preferences (even if user didn't type after opening popup)
            await saveContextAndExclude();

            const tab = await getTargetTab();
            if (!tab || !tab.id) throw new Error('No target tab');

            tabForCleanup = tab;

            // Auto-inject custom CSS just for this run (if textarea has content)
            const cssForThisRun = getCustomCssText();
            if (cssForThisRun) {
                setStatus('Injecting custom CSS for this run...');
                await removeCustomCss(tab.id).catch(() => {});
                await injectOrReplaceCustomCss(tab.id, cssForThisRun);
                didAutoInjectCustomCss = true;

                // Keep UI state consistent: it is injected right now
                customCssInjected = true;
                syncCustomCssButtons();
            }

            const res = await runtimeSendMessage({
                type: 'RUN_A11Y_ENGINE',
                engineId,
                tabId: tab.id,
                engineOptions: {
                    selection,
                    contextSelector,
                    excludeSelectors,
                    // The packs this build has, which a pack's profile needs.
                    packs: builtPackNames,
                    engineOptions: { locale: RESULTS_LANGUAGE }
                }
            });

            if (!res || !res.ok) {
                throw new Error(res && res.error ? res.error : 'Unknown error');
            }

            renderScreenshotUi(res && res.screenshot ? res.screenshot : null, res && res.viewportRatio);

            const label = String(labelInput.value || '').trim() || null;

            setStatus('Preparing canonical scan...');

            const pageUrl = (res && res.page && typeof res.page.url === 'string' && res.page.url)
                ? res.page.url
                : (tab && tab.url ? String(tab.url) : null);
            const pageTitle = (res && res.page && typeof res.page.title === 'string' && res.page.title)
                ? res.page.title
                : null;

            let native = { ...(res.results || {}) };
            // Each question's steps (How to check), which the engine in the
            // page leaves out.
            if (typeof selectedEngine.addHowToCheck === 'function') {
                native = await selectedEngine.addHowToCheck(native);
            }
            if (!native.url && pageUrl) native.url = pageUrl;
            if (!native.pageTitle && pageTitle) native.pageTitle = pageTitle;

            // The selection's tags, recorded on the scan as the lab records them.
            const tagsArr = target.tags;

            const engineMeta = (res && res.engine && typeof res.engine === 'object')
                ? {
                    id: res.engine.id || selectedEngine.engineId || engineId,
                    version: res.engine.version || selectedEngine.engineVersion || null,
                    name: res.engine.name || selectedEngine.engineName || engineId
                }
                : {
                    id: selectedEngine.engineId || engineId,
                    version: selectedEngine.engineVersion || null,
                    name: selectedEngine.engineName || engineId
                };

            let canonical;
            try {
                canonical = selectedEngine.canonicalize(native, {
                    engine: engineMeta,
                    page: {
                        url: native.url || pageUrl || null,
                        title: native.pageTitle || pageTitle || null,
                        viewport: (res && res.page && res.page.viewport) ? res.page.viewport : null,
                        timestamp: isoNow()
                    },
                    scope: {
                        include: contextSelector
                            ? contextSelector.split(',').map((s) => s.trim()).filter(Boolean)
                            : ['html'],
                        exclude: Array.isArray(excludeSelectors) ? excludeSelectors : []
                    },
                    runOptions: {
                        standardTags: tagsArr,
                        includeBestPractice: selection.bestPractices,
                        engineOptions: {}
                    }
                });
            } catch (e) {
                console.error('[UI] canonicalize failed', e);
                throw e;
            }

            // As the lab does after every engine: the best practices go apart,
            // so the counts, scores and summaries read the requirements only.
            globalThis.A11Y_CONFORMANCE_TARGETS.separateBestPractices(canonical);

            if (canonical && Array.isArray(canonical.findings)) {
                for (const f of [...canonical.findings, ...canonical.bestPractices]) {
                    if (!f) continue;
                    if (!f.provenance) f.provenance = {};
                    if (!f.provenance.engine) f.provenance.engine = {};
                    if (!f.provenance.engine.name) f.provenance.engine.name = engineMeta.name;
                    if (!f.provenance.engine.id) f.provenance.engine.id = engineMeta.id;
                    if (!f.provenance.engine.version && engineMeta.version) f.provenance.engine.version = engineMeta.version;
                }
            }

            const domMetrics = (res && res.domMetrics && typeof res.domMetrics === 'object') ? res.domMetrics : null;

            let a11ySummary = null;
            try {
                if (canonical && domMetrics && typeof domMetrics.totalElements === 'number') {
                    a11ySummary = buildA11ySummary({ canonical, domMetrics });
                }
            } catch {
                a11ySummary = null;
            }

            const scanId = makeLocalId('manual-scan');
            const scanObj = {
                id: scanId,
                scanId: scanId,
                orderKey: null,

                iterationIndex: null,
                scanIndex: null,

                label,
                context: contextSelector || null,
                exclude: Array.isArray(excludeSelectors) ? excludeSelectors : null,
                tags: tagsArr.length ? tagsArr : null,
                // What it checked against, as the lab's reports record it.
                ...globalThis.A11Y_REPORT_SCAN.scanProfileFields({
                    standard: target.profile ? { id: target.profile, label: target.label } : null,
                    version: selection.version,
                    level: wcagLevel,
                    // A scan of several: those that ran, and those that did not.
                    profiles: (canonical && canonical.runOptions && canonical.runOptions.conformanceProfiles) || null,
                    profilesNotRun: (canonical && canonical.runOptions && canonical.runOptions.profilesNotRun) || null,
                }),
                runOnly: null,

                url: native.url || pageUrl || null,
                skipped: false,
                skipInfo: null,

                canonical,
                results: null,
                nativeForReport: native,

                domMetrics,
                a11ySummary,

                screenshot: (res && res.screenshot && typeof res.screenshot === 'object') ? res.screenshot : null,

                screenshots: [],
                viewportRatio: (typeof res?.viewportRatio === 'number' && Number.isFinite(res.viewportRatio)) ? res.viewportRatio : null,

                extraScreenshots: []
            };

            let payload = null;

            if (
                WORKFLOW_BUILDER_API &&
                typeof WORKFLOW_BUILDER_API.createWorkflowPayloadBuilder === 'function' &&
                WORKFLOW_DEPS_API &&
                WORKFLOW_DEPS_API.METRIC_DEFS &&
                typeof WORKFLOW_DEPS_API.buildGlobalSummary === 'function'
            ) {
                try {
                    const builder = WORKFLOW_BUILDER_API.createWorkflowPayloadBuilder({
                        METRIC_DEFS: WORKFLOW_DEPS_API.METRIC_DEFS,
                        sortByOrderKey: WORKFLOW_DEPS_API.sortByOrderKey,
                        buildGlobalSummary: WORKFLOW_DEPS_API.buildGlobalSummary,
                        cryptoSha1Hex16: WORKFLOW_DEPS_API.cryptoSha1Hex16
                    });

                    payload = builder.finalizeWorkflowPayload(
                        builder.buildWorkflowPayloadBase({
                            url: scanObj.url || null,
                            scenarioName: null,
                            scans: [scanObj],
                            workflowScreenshots: [],
                            cancelled: false,
                            failed: false,
                            errorDetails: null,
                            debugNative: false,
                            includeScanScreenshots: true,
                            timestamp: isoNow()
                        })
                    );
                } catch (e) {
                    payload = null;
                }
            }

            if (!payload) {
                payload = {
                    ok: true,
                    runId: runId || null,
                    createdAt: isoNow(),
                    scans: [scanObj]
                };
            }

            lastResultPayload = payload;
            lastResultFileName = runId ? `manual-run-${runId}.json` : `manual-scan-${scanObj.scanId}.json`;
            syncActionButtons();

            out.textContent = '';
            clearScreenshotDialogItems();
            ISSUES_TABLE.renderInto(out, scanObj, { enableDialogs: true });

            const footer = document.createElement('div');
            footer.className = 'muted muted-footnote';
            footer.textContent =
                `Screenshot captured: ${res.screenshot ? 'yes' : 'no'}, viewportRatio: ${res.viewportRatio ?? '(none)'}`;
            out.appendChild(footer);

            let sentToServer = false;
            if (runId) {
                try {
                    setStatus('Sending to server...');
                    const r = await postJson('/manual-scan', { runId, scan: scanObj });

                    sessionScanCount += 1;
                    persistSessionState();
                    syncActionButtons();

                    const info = document.createElement('div');
                    info.className = 'muted muted-footnote';
                    info.textContent = `Stored on server, scanId=${r.scanId}`;
                    out.appendChild(info);

                    sentToServer = true;
                } catch (e) {
                    const warn = document.createElement('div');
                    warn.className = 'muted muted-footnote';
                    warn.textContent =
                        `Warning: could not send scan to server. Local results are shown, session actions disabled. (${String(e && e.message ? e.message : e)})`;
                    out.appendChild(warn);

                    sessionState = 'idle';
                    sessionScanCount = 0;
                    lastResultPayload = null;
                    lastResultFileName = null;
                    setRunId(null);
                    syncActionButtons();
                    persistSessionState();
                }
            } else {
                sessionState = 'idle';
                sessionScanCount = 0;
                lastResultPayload = null;
                lastResultFileName = null;
                setRunId(null);
                syncActionButtons();
                persistSessionState();
            }

            setStatus(sentToServer ? 'Done' : 'Done (local only)');
        } catch (e) {
            out.textContent = String(e && e.stack ? e.stack : e);
            setStatus('Failed');
        } finally {
            if (didAutoInjectCustomCss && tabForCleanup && tabForCleanup.id) {
                try {
                    await removeCustomCss(tabForCleanup.id);
                } catch {}

                customCssInjected = false;
                syncCustomCssButtons();
                try { await saveCustomCssState(); } catch {}
            }
        }
    }

    runBtn.addEventListener('click', () => {
        runScanFromUi().catch((e) => {
            out.textContent = String(e && e.stack ? e.stack : e);
            setStatus('Failed');
        });
    });

    downloadBtn.addEventListener('click', () => {
        if (!lastResultPayload) return;
        downloadJson(lastResultFileName, lastResultPayload);
    });

    finishBtn.addEventListener('click', async () => {
        out.textContent = '';
        setStatus('Finishing...');
        clearScreenshotUi();

        try {
            if (!runId) throw new Error('No session.');

            const currentRunId = runId;
            const r = await postJson('/manual-finish', { runId: currentRunId });

            sessionState = 'finished';
            syncActionButtons();
            persistSessionState();

            out.textContent = `Shared session finished.\\nstatus=${r.status}\\nNow click "Get result".`;
            setStatus('Done');
        } catch (e) {
            out.textContent = String(e && e.stack ? e.stack : e);
            setStatus('Failed');
        }
    });

    resultBtn.addEventListener('click', async () => {
        out.textContent = '';
        setStatus('Fetching result...');
        clearScreenshotUi();

        try {
            if (!runId) throw new Error('No session.');

            const r = await getJson('/manual-result?runId=' + encodeURIComponent(runId));

            if (r.status && r.status !== 'done') {
                out.textContent = `Not ready yet.\nstatus=${r.status}`;
                setStatus('Pending');
                return;
            }

            lastResultPayload = r.payload || null;
            lastResultFileName = runId ? `manual-run-${runId}.json` : 'extension-report.json';

            syncActionButtons();

            const scans = (r && r.payload && Array.isArray(r.payload.scans)) ? r.payload.scans : [];

            if (!scans.length) {
                out.textContent = JSON.stringify(r.payload, null, 2);
                setStatus('Done');
                return;
            }

            out.textContent = '';
            clearScreenshotDialogItems();
            renderGlobalFindingsBlock(out, lastResultPayload);
            renderDispersionBlock(out, scans);

            for (let i = 0; i < scans.length; i++) {
                const scan = scans[i];
                if (!scan) continue;

                // Optional header line per scan
                const header = document.createElement('div');
                header.className = 'muted muted-block';

                const label = scan.label ? String(scan.label) : '';
                const url = scan.url ? String(scan.url) : '';
                const scanId = scan.scanId ? String(scan.scanId) : (scan.id ? String(scan.id) : '');
                // Every profile it checked against: "WCAG 2.2 AA + WAI-ARIA 1.2".
                const targetLabel = String(globalThis.A11Y_REPORT_SCAN?.scanProfilesLabel(scan) || '');

                header.textContent =
                    `Scan ${i + 1}/${scans.length}`
                    + (label ? `, ${label}` : '')
                    + (targetLabel ? `, ${targetLabel}` : '')
                    + (scanId ? `, id: ${scanId}` : '')
                    + (url ? `, ${url}` : '');

                out.appendChild(header);

                // This is the "left screenshot, right table" row, same as your live-run UI
                const row = document.createElement('div');
                row.className = 'resultsRow';

                const screenshot = (scan.screenshot && typeof scan.screenshot === 'object') ? scan.screenshot : null;
                const shot = (scan.screenshots && scan.screenshots.length >= 1) ? scan.screenshots[0] : screenshot;
                const dataUrl = (shot && typeof shot.dataUrl === 'string') ? shot.dataUrl : null;

                if (dataUrl) {
                    const fig = document.createElement('figure');
                    fig.className = 'shotWrap';

                    const box = document.createElement('div');
                    box.className = 'shotBox';

                    const img = document.createElement('img');
                    img.className = 'shotImg';
                    img.alt = 'Screenshot captured after the scan';
                    img.src = dataUrl;

                    box.appendChild(img);

                    const ratio = (typeof scan.viewportRatio === 'number' && Number.isFinite(scan.viewportRatio) && scan.viewportRatio > 0)
                        ? scan.viewportRatio
                        : null;

                    if (ratio) {
                        box.style.setProperty('--shot-ratio', `${ratio} / 1`);
                    }

                    const metaText =
                        (shot && shot.mode ? `mode: ${String(shot.mode)}` : 'screenshot') +
                        (ratio ? `, ratio: ${ratio.toFixed(3)}` : '');

                    const clickableBox = makeScreenshotButton({
                        boxEl: box,
                        imgEl: img,
                        metaText,
                        titleText: `Screenshot preview, scan ${i + 1}`
                    });

                    fig.appendChild(clickableBox);

                    const cap = document.createElement('figcaption');
                    cap.className = 'shotMeta';
                    const mode = shot && shot.mode ? String(shot.mode) : '';
                    cap.textContent =
                        (mode ? `mode: ${mode}` : 'screenshot')
                        + (ratio ? `, ratio: ${ratio.toFixed(3)}` : '');

                    fig.appendChild(cap);

                    row.appendChild(fig);
                } else {
                    // Keep alignment consistent, even without screenshot
                    const placeholder = document.createElement('div');
                    placeholder.className = 'shotWrap';
                    placeholder.style.opacity = '0.6';
                    placeholder.textContent = '';
                    row.appendChild(placeholder);
                }

                const scanOut = document.createElement('div');
                scanOut.className = 'scanOut';
                row.appendChild(scanOut);

                out.appendChild(row);

                if (scan.canonical && Array.isArray(scan.canonical.findings)) {
                    ISSUES_TABLE.renderInto(scanOut, scan, { enableDialogs: true });
                } else {
                    scanOut.textContent = JSON.stringify(scan, null, 2);
                }
            }

            setStatus('Done');
        } catch (e) {
            out.textContent = String(e && e.stack ? e.stack : e);
            setStatus('Failed');
        }
    });

    clearBtn.addEventListener('click', async () => {
        out.textContent = 'Shared session cleared. Start a new session when ready.';
        setStatus('');
        labelInput.value = '';

        sessionState = 'idle';
        sessionScanCount = 0;
        lastResultPayload = null;
        lastResultFileName = null;
        setRunId(null);

        clearScreenshotUi();

        syncActionButtons();
        persistSessionState();
    });

    sendToUiBtn?.addEventListener('click', async () => {
        out.textContent = '';
        setStatus('Sending to UI...');

        try {
            if (!lastResultPayload) throw new Error('No payload available yet.');

            const res = await runtimeSendMessage({
                type: 'POST_TO_UI_TAB',
                payload: lastResultPayload,
                fileName: lastResultFileName
            });

            if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Failed to send payload to UI');

            out.textContent = 'Payload sent to the active tab UI via window.postMessage.';
            setStatus('Done');
        } catch (e) {
            out.textContent = String(e && e.stack ? e.stack : e);
            setStatus('Failed');
        }
    });

    syncActionButtons();

    loadRunId().catch(() => {
        sessionState = 'idle';
        setRunId(null);
    });

    loadProfile().catch(() => {});

    loadContextAndExclude().catch(() => {});

    loadCustomCssState().catch(() => {});

    if (api.storage && api.storage.onChanged && typeof api.storage.onChanged.addListener === 'function') {
        api.storage.onChanged.addListener((changes, areaName) => {
            const expectedArea =
                (api.storage && api.storage.session && sessionStore === api.storage.session)
                    ? 'session'
                    : 'local';

            if (areaName !== expectedArea) return;

            const hasRunIdChange = !!(changes && changes.runId);
            const hasSessionStateChange = !!(changes && changes.sessionState);
            const hasSessionScanCountChange = !!(changes && changes.sessionScanCount);

            if (!hasRunIdChange && !hasSessionStateChange && !hasSessionScanCountChange) {
                return;
            }

            refreshSharedSessionStateFromStorage().catch(() => {});
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshSharedSessionStateFromStorage().catch(() => {});
        }
    });

    window.addEventListener('focus', () => {
        refreshSharedSessionStateFromStorage().catch(() => {});
    });
}

function initWhenReady() {
    // root exists immediately, but UI elements appear after fetch(ui.html)
    if (document.getElementById('start')) {
        initUi();
        return;
    }
    setTimeout(initWhenReady, 25);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady);
} else {
    initWhenReady();
}