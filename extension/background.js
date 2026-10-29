'use strict';

// Chrome/Edge MV3 loads this file alone as the service worker (no <script> tags
// to pull in siblings the way popup.html/panel.html do), so it has to load its
// own dependencies. Firefox's MV2 background page instead lists all of these
// directly in manifest.json's background.scripts, where `importScripts` isn't
// defined (it's a Worker-only global) - the guard keeps this a no-op there.
if (typeof importScripts === 'function') {
    importScripts(
        'conformance-targets.js',
        'fullpage-screenshot.js',
        'engines/a11y-extension-surea11y-engine.js',
        'a11y-extension-engine.js'
    );
}

// Prefer browser (Firefox), fall back to chrome (Chrome)
const api = globalThis.browser || globalThis.chrome;

// Keep in sync with your Node runner default
const DEFAULT_SCAN_CSS = `{filter: opacity(.8) blur(5px);}`;
// Default engine for extension scans. The UI can override this later.
const DEFAULT_EXTENSION_ENGINE_ID = '@surea11y';

function tabsQuery(queryInfo) {
    return new Promise((resolve, reject) => {
        try {
            api.tabs.query(queryInfo, (tabs) => {
                const err = api.runtime && api.runtime.lastError;
                if (err) reject(err);
                else resolve(tabs || []);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function tabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
        try {
            api.tabs.create(createProperties, (tab) => {
                const err = api.runtime && api.runtime.lastError;
                if (err) reject(new Error(err.message || String(err)));
                else resolve(tab || null);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function tabsUpdate(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
        try {
            api.tabs.update(tabId, updateProperties, (tab) => {
                const err = api.runtime && api.runtime.lastError;
                if (err) reject(err);
                else resolve(tab || null);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function tabsGet(tabId) {
    return new Promise((resolve, reject) => {
        try {
            api.tabs.get(tabId, (tab) => {
                const err = api.runtime && api.runtime.lastError;
                if (err) reject(err);
                else resolve(tab || null);
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function getActiveTab() {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    return tabs && tabs[0];
}

/**
 * Execute JS in the tab, returning an array of results.
 * - MV3 (Chrome, Firefox MV3): returns [{result}] -> we normalize to [result]
 * - MV2 (Firefox): tabs.executeScript returns a raw array of results
 */
async function execInTab(tabId, { func, args = [], world = 'MAIN' } = {}) {
    // MV3 path
    if (api.scripting && typeof api.scripting.executeScript === 'function') {
        const injected = await api.scripting.executeScript({
            target: { tabId },
            world, // Chrome supports MAIN, Firefox MV3 support may vary
            func,
            args
        });
        return injected.map(x => (x && Object.prototype.hasOwnProperty.call(x, 'result')) ? x.result : undefined);
    }

    // MV2 path (Firefox)
    // Convert function + args into a code string
    const code = `(${func})(${(args || []).map(a => JSON.stringify(a)).join(',')});`;
    return await api.tabs.executeScript(tabId, { code });
}

// Expose execInTab for our capture module
globalThis.__A11Y_EXEC_IN_TAB = execInTab;


// --------------------------- Generic injection helper (popup/devtools) ---------------------------
// Allows extension UIs that cannot access tabs/scripting (e.g. DevTools panel pages) to
// request background to inject code/files into the target tab.
async function injectInTab(tabId, details = {}) {
    const allFrames = !!details.allFrames;

    // MV3 path
    if (api.scripting && typeof api.scripting.executeScript === 'function') {
        const target = { tabId, allFrames };
        if (Array.isArray(details.files) && details.files.length) {
            await api.scripting.executeScript({ target, files: details.files });
            return;
        }
        if (details.file) {
            await api.scripting.executeScript({ target, files: [String(details.file)] });
            return;
        }
        if (typeof details.code === 'string') {
            const code = String(details.code);
            // This runs arbitrary `code` in the target page's world. Only the
            // extension's own popup/devtools/background pages can reach this
            // (no `externally_connectable` in manifest.*.json, so a web page
            // can't send it a runtime message) - keep it that way, or this
            // becomes an arbitrary-code-execution bridge into any page.
            await api.scripting.executeScript({
                target,
                func: (src) => { try { (0, eval)(src); } catch (e) { throw e; } },
                args: [code]
            });
            return;
        }
        return;
    }

    // MV2 path (Firefox)
    if (api.tabs && typeof api.tabs.executeScript === 'function') {
        if (Array.isArray(details.files) && details.files.length) {
            for (const f of details.files) {
                await new Promise((resolve, reject) => {
                    api.tabs.executeScript(tabId, { allFrames, file: String(f) }, () => {
                        const err = api.runtime && api.runtime.lastError;
                        if (err) reject(new Error(err.message || String(err)));
                        else resolve();
                    });
                });
            }
            return;
        }
        if (details.file) {
            await new Promise((resolve, reject) => {
                api.tabs.executeScript(tabId, { allFrames, file: String(details.file) }, () => {
                    const err = api.runtime && api.runtime.lastError;
                    if (err) reject(new Error(err.message || String(err)));
                    else resolve();
                });
            });
            return;
        }
        if (typeof details.code === 'string') {
            await new Promise((resolve, reject) => {
                api.tabs.executeScript(tabId, { allFrames, code: String(details.code) }, () => {
                    const err = api.runtime && api.runtime.lastError;
                    if (err) reject(new Error(err.message || String(err)));
                    else resolve();
                });
            });
            return;
        }
        return;
    }

    throw new Error('No injection API available in background');
}


// --------------------------- Metrics collection (page-context) ---------------------------
// These mirror your Node runner metrics (dom-metrics.js + text-metrics.js), but run inside the tab.
// Returned structure matches runner behavior:
// - domMetrics.textMetrics is set when both are available
// - timings.totalMs added per metric group

async function collectDomMetricsInTab(tabId, options = {}) {
    const cfg = {
        maxNodes: Number.isFinite(Number(options.maxNodes)) ? Number(options.maxNodes) : 20000,
        includeComputedVisibility: options.includeComputedVisibility !== false
    };

    const startedAt = Date.now();

    const [result] = await execInTab(tabId, {
        func: (cfg) => {
            const MAX = Math.max(1000, Number(cfg.maxNodes || 20000));
            const includeComputed = !!cfg.includeComputedVisibility;

            const SEMANTIC_TAGS = new Set([
                'main','nav','header','footer','aside','section','article',
                'h1','h2','h3','h4','h5','h6',
                'ul','ol','li',
                'table','thead','tbody','tfoot','tr','th','td','caption',
                'form','label','fieldset','legend',
                'button','a','img','input','select','textarea',
                'figure','figcaption',
                'details','summary',
                'dialog'
            ]);

            const INTERACTIVE_TAGS = new Set(['a','button','input','select','textarea','summary']);
            const EVALUABLE_TAGS = new Set([
                'a','button','input','select','textarea','img','iframe',
                'h1','h2','h3','h4','h5','h6',
                'main','nav','header','footer','aside','form','label','fieldset','legend',
                'table','th'
            ]);

            const INTERACTIVE_ROLES = new Set([
                'button','link','checkbox','switch','tab','menuitem',
                'radio','option','combobox','textbox','slider'
            ]);

            const STATEFUL_ROLES = new Set([
                'dialog','alertdialog','tablist','menu','listbox','tree','grid'
            ]);

            const FOCUSABLE_SELECTOR = [
                'a[href]',
                'button:not([disabled])',
                'input:not([disabled])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                'summary',
                '[tabindex]:not([tabindex="-1"])',
                '[contenteditable="true"]'
            ].join(',');

            const root = document.documentElement;
            const queue = [{ node: root, depth: 1 }];
            let qi = 0;

            let totalElements = 0;
            let capped = false;
            let depthMax = 0;

            let divCount = 0;
            let spanCount = 0;
            let semanticCount = 0;
            let evaluableCount = 0;

            let interactiveNativeCount = 0;
            let customControlCount = 0;

            let hiddenCount = 0;
            let iframeCount = 0;
            let dialogCount = 0;
            let detailsCount = 0;
            let tablistCount = 0;
            let ariaExpandedCount = 0;
            let positiveTabindexCount = 0;
            let shadowHostCount = 0;

            while (qi < queue.length) {
                const { node, depth } = queue[qi++];
                if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;

                totalElements++;
                if (totalElements > MAX) { capped = true; break; }

                depthMax = Math.max(depthMax, depth);
                const tag = node.tagName.toLowerCase();

                if (tag === 'div') divCount++;
                if (tag === 'span') spanCount++;
                if (SEMANTIC_TAGS.has(tag)) semanticCount++;
                if (EVALUABLE_TAGS.has(tag)) evaluableCount++;

                if (INTERACTIVE_TAGS.has(tag)) {
                    if (tag !== 'a' || node.hasAttribute('href')) {
                        interactiveNativeCount++;
                    }
                }

                const role = (node.getAttribute('role') || '').toLowerCase();
                const hasOnclick = node.hasAttribute('onclick') || typeof node.onclick === 'function';
                const hasTabindex = node.hasAttribute('tabindex');
                let tabindexNum = null;
                if (hasTabindex) {
                    const tv = Number(node.getAttribute('tabindex'));
                    if (Number.isFinite(tv)) tabindexNum = tv;
                }
                const isFocusableByTabindex = tabindexNum != null && tabindexNum >= 0;
                const isInteractiveRole = INTERACTIVE_ROLES.has(role);
                const isStatefulRole = STATEFUL_ROLES.has(role);

                if (!INTERACTIVE_TAGS.has(tag)) {
                    const focusSignal =
                        isFocusableByTabindex ||
                        isInteractiveRole ||
                        node.getAttribute('contenteditable') === 'true';

                    if (isInteractiveRole || isStatefulRole || (hasOnclick && focusSignal) || isFocusableByTabindex) {
                        customControlCount++;
                    }
                }

                if (
                    node.hasAttribute('hidden') ||
                    node.getAttribute('aria-hidden') === 'true'
                ) {
                    hiddenCount++;
                } else if (includeComputed) {
                    const styleAttr = node.getAttribute('style');
                    if (styleAttr && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(styleAttr)) {
                        hiddenCount++;
                    } else {
                        try {
                            const cs = getComputedStyle(node);
                            if (cs.display === 'none' || cs.visibility === 'hidden') {
                                hiddenCount++;
                            }
                        } catch {}
                    }
                }

                if (tag === 'iframe') iframeCount++;
                if (tag === 'dialog') dialogCount++;
                if (tag === 'details') detailsCount++;
                if (role === 'tablist') tablistCount++;
                if (node.hasAttribute('aria-expanded')) ariaExpandedCount++;

                if (tabindexNum != null && tabindexNum > 0) {
                    positiveTabindexCount++;
                }

                if (node.shadowRoot) shadowHostCount++;

                for (const child of node.children) {
                    queue.push({ node: child, depth: depth + 1 });
                }
            }

            let focusableCount = 0;
            try {
                focusableCount = document.querySelectorAll(FOCUSABLE_SELECTOR).length;
            } catch {}

            const semanticRatio =
                (semanticCount + 1) / (semanticCount + divCount + spanCount + 1);

            const coverageRatio =
                (evaluableCount + 1) / (totalElements + 1);

            return {
                totalElements,
                capped,
                depthMax,
                coverageRatio,
                semanticRatio,
                customControlsRatio:
                    (customControlCount + 0.5) / (interactiveNativeCount + 0.5),
                hiddenRatio:
                    (hiddenCount + 1) / (totalElements + 1),
                focusableDensityPer1k:
                    (focusableCount / Math.max(1, totalElements)) * 1000,
                statefulComponentsCount:
                    dialogCount + detailsCount + tablistCount + ariaExpandedCount,
                positiveTabindexCount,
                iframeCount,
                shadowHostCount,
                counts: {
                    div: divCount,
                    span: spanCount,
                    semantic: semanticCount,
                    evaluable: evaluableCount,
                    interactiveNative: interactiveNativeCount,
                    customControls: customControlCount,
                    hidden: hiddenCount,
                    focusable: focusableCount,
                    dialog: dialogCount,
                    details: detailsCount,
                    tablist: tablistCount,
                    ariaExpanded: ariaExpandedCount
                }
            };
        },
        args: [cfg]
    });

    if (!result || typeof result !== 'object') return null;
    result.timings = { totalMs: Date.now() - startedAt };
    return result;
}

async function collectTextMetricsInTab(tabId, options = {}) {
    const cfg = {
        maxNodes: Number.isFinite(Number(options.maxNodes)) ? Number(options.maxNodes) : 20000,
        includeComputedVisibility: options.includeComputedVisibility !== false,
        maxTextChars: Number.isFinite(Number(options.maxTextChars)) ? Number(options.maxTextChars) : 2000000,
        paragraphSelectors: typeof options.paragraphSelectors === 'string' ? options.paragraphSelectors : 'p, li, dd, td',
        headingSelectors: typeof options.headingSelectors === 'string' ? options.headingSelectors : 'h1, h2, h3, h4, h5, h6'
    };

    const startedAt = Date.now();

    const [result] = await execInTab(tabId, {
        func: (cfg) => {
            const MAX_NODES = Math.max(1000, Number(cfg.maxNodes || 20000));
            const MAX_TEXT = Math.max(10000, Number(cfg.maxTextChars || 2000000));
            const includeComputed = !!cfg.includeComputedVisibility;

            const PARA_SEL = String(cfg.paragraphSelectors || 'p, li, dd, td');
            const HEAD_SEL = String(cfg.headingSelectors || 'h1, h2, h3, h4, h5, h6');

            function clamp(n, min, max) {
                return Math.max(min, Math.min(max, n));
            }

            function hasNameSignal(el) {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                if (el.getAttribute('aria-label')) return true;
                if (el.getAttribute('aria-labelledby')) return true;
                if (el.getAttribute('title')) return true;

                const tag = (el.tagName || '').toLowerCase();
                if (tag === 'input') {
                    const type = String(el.getAttribute('type') || '').toLowerCase();
                    if (type === 'button' || type === 'submit' || type === 'reset') {
                        const v = el.getAttribute('value');
                        if (v && String(v).trim()) return true;
                    }
                }
                return false;
            }

            function normalizeTextLen(s) {
                if (!s) return 0;
                const t = String(s).replace(/\s+/g, ' ').trim();
                return t.length;
            }

            function isElementHidden(el) {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
                if (el.hasAttribute('hidden')) return true;
                if (el.getAttribute('aria-hidden') === 'true') return true;

                const tag = (el.tagName || '').toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'noscript') return true;

                const styleAttr = el.getAttribute('style');
                if (styleAttr && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(styleAttr)) return true;

                if (!includeComputed) return false;

                try {
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
                } catch {}

                return false;
            }

            let totalElementsVisited = 0;
            let totalVisibleTextChars = 0;
            let capped = false;

            const root = document.documentElement;
            const queue = [{ node: root }];
            let qi = 0;

            while (qi < queue.length) {
                const cur = queue[qi++].node;
                if (!cur || cur.nodeType !== Node.ELEMENT_NODE) continue;

                if (isElementHidden(cur)) continue;

                totalElementsVisited++;
                if (totalElementsVisited > MAX_NODES) { capped = true; break; }

                const childNodes = cur.childNodes;
                for (let i = 0; i < childNodes.length; i++) {
                    const n = childNodes[i];
                    if (!n) continue;
                    if (n.nodeType === Node.TEXT_NODE) {
                        const len = normalizeTextLen(n.nodeValue);
                        if (len) {
                            totalVisibleTextChars += len;
                            if (totalVisibleTextChars > MAX_TEXT) { capped = true; break; }
                        }
                    }
                }
                if (capped) break;

                const kids = cur.children;
                for (let k = 0; k < kids.length; k++) {
                    queue.push({ node: kids[k] });
                }
            }

            const paraLens = [];
            try {
                const nodes = document.querySelectorAll(PARA_SEL);
                const limit = Math.min(nodes.length, 3000);
                for (let i = 0; i < limit; i++) {
                    const el = nodes[i];
                    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
                    if (isElementHidden(el)) continue;

                    const len = normalizeTextLen(el.textContent);
                    if (len > 0) paraLens.push(len);
                }
            } catch {}

            paraLens.sort((a, b) => a - b);

            function percentile(sorted, p) {
                if (!sorted.length) return 0;
                const idx = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
                return sorted[idx];
            }

            const p50 = percentile(paraLens, 50);
            const p90 = percentile(paraLens, 90);
            const maxPara = paraLens.length ? paraLens[paraLens.length - 1] : 0;

            let headingCount = 0;
            try {
                const hs = document.querySelectorAll(HEAD_SEL);
                const limit = Math.min(hs.length, 2000);
                for (let i = 0; i < limit; i++) {
                    const el = hs[i];
                    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
                    if (isElementHidden(el)) continue;
                    headingCount++;
                }
            } catch {}

            const textCharsPerHeading = totalVisibleTextChars / Math.max(1, headingCount);

            let linksCount = 0;
            let visibleLinkTextChars = 0;
            let linksNoVisibleTextCount = 0;
            let linksNoTextNoNameSignalCount = 0;
            let linksNameSignalCount = 0;

            try {
                const links = document.querySelectorAll('a[href]');
                const limit = Math.min(links.length, 5000);
                for (let i = 0; i < limit; i++) {
                    const a = links[i];
                    if (!a || a.nodeType !== Node.ELEMENT_NODE) continue;
                    if (isElementHidden(a)) continue;

                    linksCount++;

                    const len = normalizeTextLen(a.textContent);
                    if (len > 0) {
                        visibleLinkTextChars += len;
                        if (hasNameSignal(a)) linksNameSignalCount++;
                    } else {
                        linksNoVisibleTextCount++;
                        if (hasNameSignal(a)) linksNameSignalCount++;
                        else linksNoTextNoNameSignalCount++;
                    }
                }
            } catch {}

            const linkTextShare =
                totalVisibleTextChars > 0
                    ? (visibleLinkTextChars / totalVisibleTextChars)
                    : 0;

            let buttonsCount = 0;
            let visibleButtonTextChars = 0;
            let buttonsNoVisibleTextCount = 0;
            let buttonsNoTextNoNameSignalCount = 0;
            let buttonsNameSignalCount = 0;

            try {
                const btns = document.querySelectorAll(
                    'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
                );
                const limit = Math.min(btns.length, 5000);
                for (let i = 0; i < limit; i++) {
                    const el = btns[i];
                    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
                    if (isElementHidden(el)) continue;

                    buttonsCount++;

                    const tag = (el.tagName || '').toLowerCase();
                    const text = tag === 'input' ? (el.getAttribute('value') || '') : (el.textContent || '');
                    const len = normalizeTextLen(text);

                    if (len > 0) {
                        visibleButtonTextChars += len;
                        if (hasNameSignal(el)) buttonsNameSignalCount++;
                    } else {
                        buttonsNoVisibleTextCount++;
                        if (hasNameSignal(el)) buttonsNameSignalCount++;
                        else buttonsNoTextNoNameSignalCount++;
                    }
                }
            } catch {}

            const buttonTextShare =
                totalVisibleTextChars > 0
                    ? (visibleButtonTextChars / totalVisibleTextChars)
                    : 0;

            return {
                capped,
                totals: {
                    visibleTextChars: totalVisibleTextChars,
                    elementsVisited: totalElementsVisited,
                    headingCount
                },
                density: {
                    visibleTextCharsPer1k: (totalVisibleTextChars / Math.max(1, totalElementsVisited)) * 1000,
                    textCharsPerHeading
                },
                paragraphs: {
                    selector: PARA_SEL,
                    count: paraLens.length,
                    p50Chars: p50,
                    p90Chars: p90,
                    maxChars: maxPara
                },
                links: {
                    selector: 'a[href]',
                    linksCount,
                    linksPer1k: (linksCount / Math.max(1, totalElementsVisited)) * 1000,
                    visibleLinkTextChars,
                    linkTextShare,

                    linksNoVisibleTextCount,
                    linksNoVisibleTextRate: linksCount ? clamp(linksNoVisibleTextCount / linksCount, 0, 1) : 0,

                    linksNameSignalCount,
                    linksNameSignalRate: linksCount ? clamp(linksNameSignalCount / linksCount, 0, 1) : 0,

                    linksNoTextNoNameSignalCount,
                    linksNoTextNoNameSignalRate: linksCount ? clamp(linksNoTextNoNameSignalCount / linksCount, 0, 1) : 0
                },
                buttons: {
                    selector: 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
                    buttonsCount,
                    buttonsPer1k: (buttonsCount / Math.max(1, totalElementsVisited)) * 1000,
                    visibleButtonTextChars,
                    buttonTextShare,

                    buttonsNoVisibleTextCount,
                    buttonsNoVisibleTextRate: buttonsCount ? (buttonsNoVisibleTextCount / buttonsCount) : 0,

                    buttonsNameSignalCount,
                    buttonsNameSignalRate: buttonsCount ? (buttonsNameSignalCount / buttonsCount) : 0,

                    buttonsNoTextNoNameSignalCount,
                    buttonsNoTextNoNameSignalRate: buttonsCount ? (buttonsNoTextNoNameSignalCount / buttonsCount) : 0
                }
            };
        },
        args: [cfg]
    });

    if (!result || typeof result !== 'object') return null;
    result.timings = { totalMs: Date.now() - startedAt };
    return result;
}


async function injectFile(tabId, file) {
    // MV3
    if (api.scripting && typeof api.scripting.executeScript === 'function') {
        await api.scripting.executeScript({
            target: { tabId },
            files: [file],
            world: 'MAIN'
        });
        return;
    }

    // MV2
    await api.tabs.executeScript(tabId, { file });
}

function getExtensionEngineFacade() {
    const facade = globalThis.A11Y_EXTENSION_ENGINE;
    return (facade && typeof facade.resolveEngine === 'function') ? facade : null;
}

function getResolvedExtensionEngine(engineId) {
    const facade = getExtensionEngineFacade();
    if (!facade) return null;
    try {
        return facade.resolveEngine(engineId || DEFAULT_EXTENSION_ENGINE_ID);
    } catch {
        return null;
    }
}

// An engine that cannot be resolved is reported rather than substituted: a scan
// silently run by a different engine than the one selected would be labelled
// with the selection, not with what actually produced the findings.
function requireResolvedExtensionEngine(engineId, method) {
    const engine = getResolvedExtensionEngine(engineId);
    if (!engine || typeof engine[method] !== 'function') {
        throw new Error(`Unsupported extension engine: ${engineId || DEFAULT_EXTENSION_ENGINE_ID}`);
    }
    return engine;
}

async function ensureEngineInjected(tabId, engineId) {
    const engine = requireResolvedExtensionEngine(engineId, 'ensureInjected');

    return engine.ensureInjected(tabId, {
        api,
        injectFile,
        injectInTab,
        execInTab
    });
}

async function runSelectedEngine(tabId, engineId, engineOptions = {}) {
    const engine = requireResolvedExtensionEngine(engineId, 'runInTab');

    const result = await engine.runInTab(tabId, engineOptions, {
        api,
        injectFile,
        injectInTab,
        execInTab
    });

    return {
        engine: {
            id: engine.engineId || engineId || DEFAULT_EXTENSION_ENGINE_ID,
            name: engine.engineName || engine.engineId || engineId || DEFAULT_EXTENSION_ENGINE_ID,
            version: engine.engineVersion || null
        },
        results: result
    };
}

// -----------------------
// Temporary CSS (runner parity)
// -----------------------

function stripOuterBraces(styleBlock) {
    const s = String(styleBlock || '').trim();
    if (!s) return '';
    // allow "{ ... }" or "..."
    if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1).trim();
    return s;
}

function buildSelectorRules(selectors, styleBlock, isContext = false) {
    const list = Array.isArray(selectors) ? selectors : [];
    const decl = stripOuterBraces(styleBlock);
    if (!decl) return '';

    const out = [];
    for (const raw of list) {
        const sel = String(raw || '').trim();
        if (!sel) continue;

        // Match your Node runner:
        // For "context", blur everything except the context node, its descendants, and its ancestors.
        // Ancestor exclusion uses :has()
        const updatedSel = !isContext ? sel : `*:not(${sel}):not(${sel} *):not(:has(${sel}))`;
        out.push(`${updatedSel} { ${decl} }`);
    }
    return out.join('\n');
}

function buildBeforeScanCss(scanOptions = {}) {
    const o = (scanOptions && typeof scanOptions === 'object') ? scanOptions : {};

    const contextSelector =
        (typeof o.contextSelector === 'string' && o.contextSelector.trim())
            ? o.contextSelector.trim()
            : null;

    const excludeSelectors = Array.isArray(o.excludeSelectors)
        ? o.excludeSelectors.map(s => String(s).trim()).filter(Boolean)
        : [];

    let css = null;

    if (contextSelector) {
        const r = buildSelectorRules([contextSelector], DEFAULT_SCAN_CSS, true);
        if (r) css = (css ? (css + '\n') : '') + r;
    }

    if (excludeSelectors.length) {
        const r = buildSelectorRules(excludeSelectors, DEFAULT_SCAN_CSS, false);
        if (r) css = (css ? (css + '\n') : '') + r;
    }

    return css;
}

async function withTemporaryStyle(tabId, cssText, fn) {
    const css = (typeof cssText === 'string') ? cssText.trim() : '';
    if (!css) return await fn();

    const styleId = `__a11y_scan_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    try {
        // Inject
        await execInTab(tabId, {
            world: 'MAIN',
            args: [css, styleId],
            func: (css, id) => {
                try {
                    const style = document.createElement('style');
                    style.id = id;
                    style.textContent = css;
                    (document.head || document.documentElement).appendChild(style);
                } catch {}
            }
        });

        return await fn();
    } finally {
        // Remove
        try {
            await execInTab(tabId, {
                world: 'MAIN',
                args: [styleId],
                func: (id) => {
                    try {
                        const el = document.getElementById(id);
                        if (el) el.remove();
                    } catch {}
                }
            });
        } catch {
            // ignore (tab navigated/closed)
        }
    }
}

// -----------------------
// Screenshot
// -----------------------

async function captureViewportScreenshot() {
    // Firefox: Promise form. Chrome: callback form.
    return new Promise((resolve) => {
        try {
            const fn = api.tabs.captureVisibleTab;

            // Chrome callback signature: (windowId, options, cb)
            if (typeof fn === 'function' && fn.length >= 2) {
                fn.call(api.tabs, null, { format: 'png' }, (dataUrl) => resolve(dataUrl || null));
                return;
            }

            // Firefox promise signature: (windowId, options) => Promise
            Promise.resolve(fn.call(api.tabs, null, { format: 'png' }))
                .then((dataUrl) => resolve(dataUrl || null))
                .catch(() => resolve(null));
        } catch {
            resolve(null);
        }
    });
}

async function getViewportRatio(tabId) {
    try {
        const resArr = await execInTab(tabId, {
            world: 'MAIN',
            func: () => {
                const w = Number(window.innerWidth) || 0;
                const h = Number(window.innerHeight) || 0;
                if (!w || !h) return null;
                return w / h;
            }
        });
        const result = resArr && resArr[0];
        return (typeof result === 'number' && Number.isFinite(result)) ? result : null;
    } catch {
        return null;
    }
}

async function getBestShortcutTargetTab() {
    const tabs = await tabsQuery({ active: true, lastFocusedWindow: true });

    const tab = (tabs || []).find((t) => {
        const url = String((t && t.url) || '');
        return typeof t?.id === 'number'
            && !url.startsWith('chrome-extension://')
            && !url.startsWith('moz-extension://')
            && !url.startsWith('edge-extension://')
            && !url.startsWith('devtools://');
    }) || (tabs && tabs[0]) || null;

    return (tab && typeof tab.id === 'number') ? tab : null;
}

async function broadcastRunShortcutToExtensionUis(tabId) {
    try {
        api.runtime.sendMessage({
            type: 'A11Y_TRIGGER_RUN_SHORTCUT',
            tabId
        });
    } catch {}
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        try {
            if (!msg || (msg.type !== 'RUN_A11Y_ENGINE' && msg.type !== 'POST_TO_UI_TAB' && msg.type !== 'A11Y_EXEC_IN_TAB' && msg.type !== 'A11Y_PICKER_RESULT' && msg.type !== 'A11Y_FOCUS_TAB' && msg.type !== 'PING')) {
                sendResponse({ ok: false, error: 'Unsupported message' });
                return;
            }

            if (msg && msg.type === 'A11Y_FOCUS_TAB') {
                const tabId = msg.tabId;

                // Helper: focus tab + its window (best effort)
                async function focusNow() {
                    try { await api.tabs.update(tabId, { active: true }); } catch {}

                    try {
                        const tab = await tabsGet(tabId); // use your wrapper to keep error handling consistent
                        if (tab && typeof tab.windowId === 'number' && api.windows && typeof api.windows.update === 'function') {
                            try { await api.windows.update(tab.windowId, { focused: true }); } catch {}
                        }
                    } catch {}
                }

                // 1) Try immediately (sometimes works)
                await focusNow();

                // 2) Try again after DevTools click finishes (this is the important one)
                setTimeout(() => { focusNow(); }, 0);

                // 3) And once more shortly after (covers some Firefox/Chrome timing quirks)
                setTimeout(() => { focusNow(); }, 75);

                sendResponse({ ok: true });
                return true;
            }

            // DevTools/popup helper: inject code/files into a tab via background
            if (msg.type === 'A11Y_EXEC_IN_TAB') {
                const tabId = msg.tabId;
                if (!Number.isFinite(Number(tabId))) {
                    sendResponse({ ok: false, error: 'Missing tabId' });
                    return;
                }
                await injectInTab(Number(tabId), msg.details || {});
                sendResponse({ ok: true });
                return;
            }

            // Relay picker results to any open extension UI (popup/panel).
            // Only relay messages that actually came from the in-page picker (a
            // content script, which always sets sender.tab) - otherwise the
            // runtime.sendMessage broadcast below is received by this very
            // listener too, which would relay it again, forever.
            if (msg.type === 'A11Y_PICKER_RESULT') {
                if (sender && sender.tab) {
                    try { api.runtime.sendMessage(msg); } catch {}
                }
                sendResponse({ ok: true });
                return;
            }

            if (msg.type === 'PING') {
                sendResponse({ ok: true, pong: true, when: Date.now() });
                return;
            }

            // -----------------------
// Send payload to UI tab (works from popup AND DevTools panel)
// -----------------------
            if (msg.type === 'POST_TO_UI_TAB') {
                const payload = msg && msg.payload;
                const fileName = (msg && typeof msg.fileName === 'string' && msg.fileName.trim())
                    ? msg.fileName.trim()
                    : 'extension-report.json';

                if (!payload || typeof payload !== 'object') {
                    throw new Error('No payload to send');
                }

                const uiPrefixes = [
                    'http://127.0.0.1:3000/src/',
                    'http://127.0.0.1:3000/src'
                ];

                // Find existing UI tab by scanning all tabs (MV2/MV3 compatible)
                let uiTab = null;
                const allTabs = await tabsQuery({ currentWindow: true });
                for (const t of (allTabs || [])) {
                    const u = String(t && t.url ? t.url : '');
                    if (uiPrefixes.some(p => u.startsWith(p))) {
                        uiTab = t;
                        break;
                    }
                }

                // Create if missing
                if (!uiTab || !uiTab.id) {
                    // Open the UI tab in the same window as the active tab (Chrome MV3 is pickier)
                    let winId = null;
                    try {
                        const active = await getActiveTab();
                        if (active && typeof active.windowId === 'number') winId = active.windowId;
                    } catch {}

                    uiTab = await tabsCreate({
                        url: uiPrefixes[0],
                        active: true,
                        ...(typeof winId === 'number' ? { windowId: winId } : {})
                    });
                } else {
                    try { await tabsUpdate(uiTab.id, { active: true }); } catch {}
                    try {
                        if (api.windows && typeof api.windows.update === 'function' && uiTab.windowId) {
                            api.windows.update(uiTab.windowId, { focused: true });
                        }
                    } catch {}
                }

                if (!uiTab || !uiTab.id) throw new Error('Could not find or open the UI tab.');

                const injectedMsg = {
                    type: 'A11Y_IMPORT_PAYLOAD',
                    payload,
                    fileName
                };

                // Inject window.postMessage into the UI tab (no content script needed)
                // MV3
                if (api.scripting && typeof api.scripting.executeScript === 'function') {
                    await api.scripting.executeScript({
                        target: { tabId: uiTab.id },
                        func: (m) => window.postMessage(m, window.location.origin),
                        args: [injectedMsg]
                    });
                    sendResponse({ ok: true });
                    return;
                }

                // MV2 (Firefox)
                await new Promise((resolve, reject) => {
                    const code = `window.postMessage(${JSON.stringify(injectedMsg)}, window.location.origin);`;
                    api.tabs.executeScript(uiTab.id, { code }, () => {
                        const err = api.runtime && api.runtime.lastError;
                        if (err) reject(err);
                        else resolve();
                    });
                });

                sendResponse({ ok: true });
                return;
            }

            let tabId = (msg && typeof msg.tabId === 'number') ? msg.tabId : null;

            let tab = null;
            if (!tabId) {
                tab = await getActiveTab();
                if (!tab || !tab.id) throw new Error('No active tab');
                tabId = tab.id;
            } else {
                // Best-effort tab metadata for response
                try {
                    const t = await tabsGet(tabId);
                    tab = t || null;
                } catch {
                    tab = null;
                }
            }

            const engineId =
                (msg && typeof msg === 'object' && typeof msg.engineId === 'string' && msg.engineId.trim())
                    ? msg.engineId.trim()
                    : DEFAULT_EXTENSION_ENGINE_ID;

            const engineOptions =
                (msg && typeof msg === 'object' && msg.engineOptions && typeof msg.engineOptions === 'object')
                    ? msg.engineOptions
                    : {};

            await ensureEngineInjected(tabId, engineId);

            const beforeScanCss = buildBeforeScanCss(engineOptions);

            const out = await withTemporaryStyle(tabId, beforeScanCss, async () => {
                // Mirror Node runner: collect DOM + text metrics before the scan
                const metricsCfg = { maxNodes: 20000, includeComputedVisibility: true };

                let domMetrics = null;
                let textMetrics = null;
                try { domMetrics = await collectDomMetricsInTab(tabId, metricsCfg); } catch {}
                try { textMetrics = await collectTextMetricsInTab(tabId, metricsCfg); } catch {}

                if (domMetrics && textMetrics) domMetrics.textMetrics = textMetrics;
                else if (!domMetrics && textMetrics) domMetrics = { textMetrics };

                const engineRun = await runSelectedEngine(tabId, engineId, engineOptions);

                const capturePromise =
                    (globalThis.A11YFullPageScreenshot &&
                        typeof globalThis.A11YFullPageScreenshot.captureBest === 'function')
                        ? globalThis.A11YFullPageScreenshot.captureBest(tabId)
                        : Promise.resolve({ dataUrl: null, mode: 'missing-module' });

                const [shot, viewportRatio] = await Promise.all([
                    capturePromise,
                    getViewportRatio(tabId)
                ]);

                return { results: engineRun.results, engine: engineRun.engine, shot, viewportRatio, domMetrics };
            });

            const screenshot = (out.shot && out.shot.dataUrl)
                ? { name: 'Main screenshot', dataUrl: out.shot.dataUrl, mode: out.shot.mode }
                : null;

            sendResponse({
                ok: true,
                results: out.results,
                engine: (out && out.engine && typeof out.engine === 'object') ? out.engine : { id: engineId, name: engineId, version: null },
                page: { url: (tab && tab.url) ? tab.url : null, title: (tab && tab.title) ? tab.title : null },
                domMetrics: (out && out.domMetrics && typeof out.domMetrics === 'object') ? out.domMetrics : null,
                screenshot,
                viewportRatio: out.viewportRatio
            });
        } catch (e) {
            sendResponse({ ok: false, error: String(e?.message || e) });
        }
    })();

    return true;
});

if (api.commands && api.commands.onCommand) {
    api.commands.onCommand.addListener((command) => {
        (async () => {
            try {
                if (command !== 'run-a11y-scan') return;

                const tab = await getBestShortcutTargetTab();
                if (!tab || typeof tab.id !== 'number') return;

                await broadcastRunShortcutToExtensionUis(tab.id);
            } catch (e) {
                console.warn('[A11Y] command failed:', e);
            }
        })();
    });
}