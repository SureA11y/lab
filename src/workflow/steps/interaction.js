'use strict';

// The steps that act on an element of the page or wait for one: click, type,
// set a value or a password, hover, focus, select, scroll, press keys, and
// the waits.

const {ACTION_DEFINITIONS} = require('../action-definitions');
const {activateClickHandle} = require('../click-utils');
const {findOneByTextDeepHandle, waitForOneDeep, waitForOneDeepOrThrow, wantsScrollIntoView} = require('../engine/deep-query');
const {interpolateVarTokensLoose} = require('../engine/vars');
const {isNonEmptyString, sleep, toNumber} = require('../engine/utils');
const {
    normalizeWaitUntil,
    safePageUrl,
    waitForPossibleNavigation,
    waitForRenderSettle,
    waitForSel
} = require('../engine/nav');
const {postStepDelay} = require('../engine/post-step-delay');
const {pressKey} = require('../engine/keys');
const {pushLog} = require('../engine/log');
const {resolveByTextDeepHandle} = require('../deep-by-text');

async function stepClick(page, action, ctx, localVars, _depth, _actionPathPrefix, _selector, timeout) {
    const selector = isNonEmptyString(action.selector) ? action.selector.trim() : null;

    const needle = isNonEmptyString(action.labelText)
        ? interpolateVarTokensLoose(action.labelText.trim(), { localVars, ctx })
        : '';

    const exact = !!action.exact;
    const caseSensitive = !!action.caseSensitive;

    const retries = Math.max(0, toNumber(action.retries, 0));
    const retryDelay = Math.max(0, toNumber(action.retryDelay, 500));
    const waitUntil = action.waitUntil || null;

    const mouseButton = (action.mouseButton || action.button || 'left'); // 'left' | 'right' | 'middle'
    const programmatic = action.programmatic === true;
    const clickKind = (action.clickKind || 'click'); // 'click' | 'doubleClick'
    const scrollIntoView = wantsScrollIntoView(action);

    // Prefer action.timeout when provided, else fall back to the outer action timeout
    const t = Math.max(0, toNumber(action.timeout, timeout));

    // clickByText options (only meaningful when needle is used)
    const allowPointerFallback = !!action.allowPointerFallback;
    const pointerFallbackMaxMatches = Math.max(1, toNumber(action.pointerFallbackMaxMatches, 1));

    // If neither selector nor labelText, nothing to do
    if (!selector && !needle) return;

    let attempt = 0;
    while (true) {
        let h = null;
        try {
            // ---- Target resolution ----
            if (needle) {
                // labelText is the target, selector (if present) is the container scope
                h = await ctx.race(
                    findOneByTextDeepHandle(page, {
                        containerSel: selector,
                        needle,
                        exact,
                        caseSensitive,
                        timeoutMs: t,
                        allowPointerFallback,
                        pointerFallbackMaxMatches
                    }, ctx),
                    `click findOneByTextDeepHandle ${needle}`
                );

                if (!h) throw new Error(`click failed: "${needle}" not found within ${t}ms`);
            } else {
                // selector-only click (existing behavior)
                h = await ctx.race(
                    waitForOneDeep(page, selector, { timeout: t, visible: true }),
                    `click waitForOneDeep ${selector}`
                );
                if (!h) throw new Error(`click failed: "${selector}" not found`);
            }

            const clickLabel = needle ? `labelText=${needle}` : selector;

            const doActivate = async () => {
                await activateClickHandle({
                    page,
                    handle: h,
                    label: clickLabel,
                    timeoutMs: t,
                    ctx,
                    mouseButton,
                    programmatic,
                    clickKind,
                    scrollIntoView
                });
            };

            // The click runs inside the navigation watch, so a new
            // document asked for the moment it lands is not missed; a
            // click that starts no navigation is done after a second.
            const startUrl = safePageUrl(page);
            if (waitUntil) {
                await ctx.race(
                    waitForPossibleNavigation(page, startUrl, {
                        waitUntil: normalizeWaitUntil(waitUntil),
                        timeout: Math.min(8000, t),
                        trigger: doActivate
                    }),
                    `click waitForPossibleNavigation ${clickLabel}`
                );
            } else {
                // Even without explicit waitUntil, give SPA routers a short chance
                // to update URL/history before the next action. Only the
                // click's own failure stops the step; the wait's does not.
                let clickError = null;
                await ctx.race(
                    waitForPossibleNavigation(page, startUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: Math.min(1500, t),
                        trigger: () => doActivate().catch((err) => { clickError = err; throw err; })
                    }),
                    `click implicit waitForPossibleNavigation ${clickLabel}`
                ).catch(() => {});
                if (clickError) throw clickError;
            }

            // Let layout settle before subsequent actions (e.g., scan/screenshot).
            await waitForRenderSettle(page, 1000).catch(() => {});

            break;
        } catch (err) {
            if (attempt >= retries) throw err;
            attempt += 1;
            await ctx.race(sleep(retryDelay), 'click retryDelay');
        } finally {
            try { if (h) await h.dispose(); } catch {}
        }
    }
}

async function stepType(page, action, ctx, localVars, _depth, _actionPathPrefix, selector, timeout) {
    if (!selector) return;
    const text = isNonEmptyString(action.text)
        ? interpolateVarTokensLoose(action.text.trim(), {localVars, ctx})
        : '';
    const delay = Math.max(0, toNumber(action.delay, 0));

    const h = await ctx.race(
        waitForOneDeep(page, selector, {timeout, visible: true}),
        `type waitForOneDeep ${selector}`
    );
    if (!h) throw new Error(`type failed: "${selector}" not found`);
    try {
        if (wantsScrollIntoView(action)) {
            await ctx.race(
                h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                `type scrollIntoView ${selector}`
            ).catch(() => {});
        }

        if (action.clear) {
            // Best effort clear: focus, select all, backspace
            await ctx.race(h.focus().catch(() => {}), `type focus ${selector}`);
            await ctx.race(page.keyboard.down('Control').catch(() => {}), 'type ctrl down');
            await ctx.race(page.keyboard.press('KeyA').catch(() => {}), 'type ctrl+a');
            await ctx.race(page.keyboard.up('Control').catch(() => {}), 'type ctrl up');
            await ctx.race(page.keyboard.press('Backspace').catch(() => {}), 'type backspace');
        }

        await ctx.race(h.focus(), `type focus ${selector}`);
        await ctx.race(page.keyboard.type(text, {delay}), `type keyboard.type ${selector}`);

        if (action.pressEnter) await ctx.race(page.keyboard.press('Enter'), 'type press Enter');
    } finally {
        try { await h.dispose(); } catch {}
    }
}

async function stepSetValue(page, action, ctx, localVars, _depth, _actionPathPrefix, _selector, timeout) {
    const selector = action.selector && action.selector.trim();
    const needle = isNonEmptyString(action.labelText)
        ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
        : '';
    const exact = !!action.exact;
    const caseSensitive = !!action.caseSensitive;

    const hasSelector = !!selector;
    const hasNeedle = !!needle;

    // nothing to search by → skip
    if (!hasSelector && !hasNeedle) return;

    // A config saved from the app never carries a password, only the flag
    // saying one was there. Failing loudly beats silently typing an empty
    // string into a login form and reporting a green run. setValue with
    // the flag is a step saved before setPassword existed.
    const isPassword = action.type === 'setPassword' || action.valueMasked === true;
    if (isPassword && !isNonEmptyString(action.value)) {
        throw new Error(
            `${action.type} failed: passwords are not saved with the configuration. ` +
            'Load the config in the app and type the password again before running it.'
        );
    }

    const value = action.value ?? '';

    const effectiveSelector = hasSelector
        ? selector
        : 'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="searchbox"], [contenteditable="true"]';

    // Wait until at least one candidate exists, including open shadow DOM
    const any = await ctx.race(
        waitForOneDeep(page, effectiveSelector, {timeout, visible: false}),
        `setValue waitForOneDeep ${effectiveSelector}`
    );
    if (!any) throw new Error(`setValue failed: no matching controls found for selector: ${effectiveSelector}`);
    try { await any.dispose(); } catch {}

    const scrollIntoView = wantsScrollIntoView(action);

    const didSet = await ctx.race(
        page.evaluate(
            (effectiveSelector, val, needle, exact, caseSensitive, scrollIntoView) => {
                const cssEscape = (s) => {
                    try {
                        return (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function')
                            ? CSS.escape(String(s))
                            : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
                    } catch {
                        return String(s);
                    }
                };

                const getRoot = (el) => {
                    try {
                        const r = el && typeof el.getRootNode === 'function' ? el.getRootNode() : document;
                        return r || document;
                    } catch {
                        return document;
                    }
                };

                const queryByIdInRoot = (root, id) => {
                    if (!id) return null;

                    // Document: fast path
                    if (root && root.nodeType === 9 && typeof root.getElementById === 'function') {
                        const hit = root.getElementById(id);
                        if (hit) return hit;
                    }

                    // ShadowRoot or fallback
                    try {
                        return root.querySelector(`#${cssEscape(id)}`);
                    } catch {
                        return null;
                    }
                };

                const pushClean = (set, v) => {
                    if (typeof v !== 'string') return;
                    const raw = v.trim();
                    if (!raw) return;
                    set.add(raw);
                    const cleaned = raw.replace(/[\s*:+]+$/, '').trim();
                    if (cleaned && cleaned !== raw) set.add(cleaned);
                };

                const extractFromLabellingElement = (root) => {
                    if (!root) return [];
                    const texts = new Set();
                    pushClean(texts, root.innerText || root.textContent);
                    root.querySelectorAll?.('[aria-label],[title]')?.forEach(el => {
                        pushClean(texts, el.getAttribute('aria-label'));
                        pushClean(texts, el.getAttribute('title'));
                    });
                    return Array.from(texts);
                };

                const getAllInputLabels = (el) => {
                    if (!el || !(el instanceof HTMLElement)) return [];
                    const labels = new Set();

                    pushClean(labels, el.getAttribute('aria-label'));

                    const ariaLabelledby = el.getAttribute('aria-labelledby');
                    if (ariaLabelledby) {
                        const root = getRoot(el);

                        ariaLabelledby.split(/\s+/).forEach(idref => {
                            if (!idref) return;

                            // Try same root first (shadow-safe)
                            const inRoot = queryByIdInRoot(root, idref);
                            if (inRoot) {
                                extractFromLabellingElement(inRoot).forEach(t => labels.add(t));
                                return;
                            }

                            // Fallback to document
                            const inDoc = queryByIdInRoot(document, idref);
                            if (inDoc) {
                                extractFromLabellingElement(inDoc).forEach(t => labels.add(t));
                            }
                        });
                    }

                    const id = el.getAttribute('id');
                    if (id) {
                        const root = getRoot(el);

                        // Same root (shadow-safe)
                        try {
                            root.querySelectorAll(`label[for="${cssEscape(id)}"]`).forEach(l => {
                                extractFromLabellingElement(l).forEach(t => labels.add(t));
                            });
                        } catch {}

                        // Fallback to document
                        try {
                            document.querySelectorAll(`label[for="${cssEscape(id)}"]`).forEach(l => {
                                extractFromLabellingElement(l).forEach(t => labels.add(t));
                            });
                        } catch {}
                    }

                    const implicit = el.closest('label');
                    if (implicit) {
                        let texts = extractFromLabellingElement(implicit);
                        if (el.value) {
                            texts = texts.map(t => t.replace(el.value, '').trim()).filter(Boolean);
                        }
                        texts.forEach(t => labels.add(t));
                    }

                    pushClean(labels, el.getAttribute('title'));
                    pushClean(labels, el.getAttribute('placeholder'));

                    return Array.from(labels);
                };

                const normalize = (s) => caseSensitive ? s : s.toLowerCase();

                const matchesNeedle = (labels, needle2, exact2) => {
                    if (!needle2) return true;
                    const target = normalize(needle2);
                    return labels.some(lbl => {
                        const l = normalize(lbl);
                        return exact2 ? l === target : l.includes(target);
                    });
                };

                const setElementValue = (el, val2) => {
                    const proto = Object.getPrototypeOf(el) &&
                        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');

                    if (proto && typeof proto.set === 'function') {
                        proto.set.call(el, val2);
                    } else if (el.isContentEditable) {
                        el.textContent = val2;
                    } else {
                        el.value = val2;
                    }

                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                };

                // Collect candidates from document + all open shadow roots
                const roots = [];
                roots.push(document);

                const stack = [document.documentElement || document.body];
                while (stack.length) {
                    const node = stack.pop();
                    if (!node) continue;

                    if (node.shadowRoot) {
                        roots.push(node.shadowRoot);
                        // traverse inside shadow too
                        const sr = node.shadowRoot;
                        if (sr && sr.children) {
                            for (let i = sr.children.length - 1; i >= 0; i--) stack.push(sr.children[i]);
                        }
                    }

                    if (node.children && node.children.length) {
                        for (let i = node.children.length - 1; i >= 0; i--) {
                            stack.push(node.children[i]);
                        }
                    }
                }

                const elements = [];
                const seen = new Set();

                for (const root of roots) {
                    let found = [];
                    try {
                        found = Array.from(root.querySelectorAll(effectiveSelector));
                    } catch {
                        found = [];
                    }
                    for (const el of found) {
                        if (!el) continue;
                        if (seen.has(el)) continue;
                        seen.add(el);
                        elements.push(el);
                    }
                }

                for (const el of elements) {
                    if (el.disabled) continue;
                    if (el.readOnly) continue;
                    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') continue;

                    // If the caller provided an explicit selector, and we are iterating elements that already match it,
                    // do not require labelText match.
                    if (needle) {
                        const labels = getAllInputLabels(el);
                        if (!matchesNeedle(labels, needle, exact)) continue;
                    }

                    if (scrollIntoView) {
                        try { el.scrollIntoView({block: 'center', inline: 'nearest'}); } catch {}
                    }
                    setElementValue(el, val);
                    return true;
                }

                return false;
            },
            effectiveSelector,
            String(value),
            needle,
            exact,
            caseSensitive,
            scrollIntoView
        ),
        `setValue evaluate ${effectiveSelector}`
    );

    if (!didSet) {
        throw new Error(
            `setValue failed: no eligible element matched selector=${effectiveSelector} labelText=${needle ? JSON.stringify(needle) : '(none)'}`
        );
    }
}

async function stepClickByText(page, action, ctx, localVars) {
    const needle = isNonEmptyString(action.labelText)
        ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
        : '';
    if (!needle) {
        if (action.optional) return;
        throw new Error(`clickByText failed: labelText resolved to empty string`);
    }

    const containerSel = isNonEmptyString(action.selector) ? action.selector.trim() : null;
    const exact = !!action.exact;
    const caseSensitive = !!action.caseSensitive;
    const waitUntil = action.waitUntil || null; // e.g. 'load' | 'domcontentloaded' | 'networkidle0'
    const t = Math.max(0, toNumber(action.timeout, 10000));

    const mouseButton = (action.mouseButton || action.button || 'left'); // 'left' | 'right' | 'middle'
    const programmatic = action.programmatic === true;
    const clickKind = (action.clickKind || 'click'); // 'click' | 'doubleClick'
    const scrollIntoView = wantsScrollIntoView(action);

    // New options
    const allowPointerFallback = !!action.allowPointerFallback; // default false
    const pointerFallbackMaxMatches = Math.max(1, toNumber(action.pointerFallbackMaxMatches, 1)); // default 1

    // Find an element by its visible text (or common label sources) within document + open shadow DOM.
    // Optionally, fall back to a "pointer-like" click by using elementFromPoint at the matching text location.
    const interactiveSelector =
        'button, a, label,' +
        ' [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"],' +
        ' [role="treeitem"], [role="menuitem"], [role="tab"], [role="option"],' +
        ' input[type="button"], input[type="submit"], input[type="reset"],' +
        ' input[type="checkbox"], input[type="radio"],' +
        ' [tabindex]:not([tabindex="-1"])';

    const elHandle = await resolveByTextDeepHandle(page, {
        containerSel,
        needle,
        exact,
        caseSensitive,
        timeoutMs: t,
        interactiveSelector,
        allowPointerFallback,
        pointerFallbackMaxMatches,
        preferLabelForCheckables: true
    }, ctx, needle);

    if (!elHandle) throw new Error(`clickByText failed: "${needle}" not found within ${t}ms`);

    try {
        const doActivate = async () => {
            await activateClickHandle({
                page,
                handle: elHandle,
                label: `labelText="${needle}"`,
                timeoutMs: t,
                ctx,
                mouseButton,
                programmatic,
                clickKind,
                scrollIntoView
            });
        };

        if (waitUntil) {
            const startUrl = safePageUrl(page);

            await waitForPossibleNavigation(page, startUrl, {
                waitUntil: normalizeWaitUntil(waitUntil),
                timeout: Math.min(8000, t),
                trigger: doActivate
            });
        } else {
            await doActivate();
        }
    } finally {
        try {
            await elHandle.dispose();
        } catch {}
    }
}

async function stepHover(page, action, ctx, _localVars, _depth, _actionPathPrefix, selector, timeout) {
    if (!selector) return;
    const h = await ctx.race(
        waitForOneDeep(page, selector, {timeout, visible: true}),
        `hover waitForOneDeep ${selector}`
    );
    if (!h) throw new Error(`hover failed: "${selector}" not found`);
    try {
        if (wantsScrollIntoView(action)) {
            await ctx.race(
                h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                `hover scrollIntoView ${selector}`
            ).catch(() => {});
        }
        await ctx.race(h.hover(), `hover handle.hover ${selector}`);
    } finally {
        try { await h.dispose(); } catch {}
    }
}

async function stepHoverByText(page, action, ctx, localVars) {
    const needle = isNonEmptyString(action.labelText)
        ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
        : '';

    if (!needle) {
        if (action.optional) return;
        throw new Error('hoverByText failed: missing labelText');
    }

    const containerSel = isNonEmptyString(action.selector) ? action.selector.trim() : null;
    const exact = !!action.exact;
    const caseSensitive = !!action.caseSensitive;
    const t = Math.max(0, toNumber(action.timeout, 10000));

    // Optional: wait for a selector AFTER hover, e.g., a menu opens
    const postWaitSel = isNonEmptyString(action.postWaitForSelector) ? action.postWaitForSelector.trim() : null;
    const postWaitVisible = action.postWaitVisible !== false; // default true
    const postWaitTimeout = toNumber(action.postWaitTimeout, t);

    // Resolve the element via shared deep text resolver
    const interactiveSelector =
        'button, a, label,' +
        ' [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"],' +
        ' input[type="button"], input[type="submit"], input[type="reset"],' +
        ' [tabindex]:not([tabindex="-1"])';

    const elHandle = await resolveByTextDeepHandle(page, {
        containerSel,
        needle,
        exact,
        caseSensitive,
        timeoutMs: t,
        interactiveSelector,
        allowPointerFallback: false,
        pointerFallbackMaxMatches: 1,
        preferLabelForCheckables: false
    }, ctx, needle);

    if (!elHandle) {
        throw new Error(`hoverByText failed: "${needle}" not found within ${t}ms`);
    }

    try {
        // Ensure on-screen before hovering
        if (wantsScrollIntoView(action)) {
            await elHandle.evaluate((el) => el.scrollIntoView({block: 'center', inline: 'nearest'}));
        }

        try {
            await elHandle.hover();
        } catch {
            // Fallback: move mouse to the element's center
            const box = await elHandle.boundingBox();
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            } else {
                // Final fallback: trigger a mouseover in DOM
                await elHandle.evaluate((el) => {
                    el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window}));
                    el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false, cancelable: true, view: window}));
                });
            }
        }

        if (postWaitSel) {
            // NOTE: this still does NOT pierce shadow roots; if you need that, switch to waitForOneDeep.
            await ctx.race(
                waitForSel(page, postWaitSel, {visible: postWaitVisible, timeout: postWaitTimeout}),
                `hoverByText postWaitForSel ${postWaitSel}`
            ).catch(() => {});
        }
    } finally {
        try { await elHandle.dispose(); } catch {}
    }
}

async function stepHoverOut(page, action, ctx) {
    const sel = isNonEmptyString(action.selector) ? action.selector.trim() : null;

    try {
        if (sel) {
            // Prefer deep hover target (open shadow DOM)
            const h = await ctx.race(
                waitForOneDeep(page, sel, {timeout: toNumber(action.timeout, 10000), visible: true}),
                `hoverOut waitForOneDeep ${sel}`
            );

            if (h) {
                try {
                    if (wantsScrollIntoView(action)) {
                        await h.evaluate((el) => el.scrollIntoView({block: 'center', inline: 'nearest'}));
                    }
                    // Try puppeteer hover using a bounding box (works across shadow targets)
                    const box = await h.boundingBox();
                    if (box) {
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    } else {
                        // Fallback: DOM event
                        await h.evaluate((el) => {
                            el.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, cancelable: true, view: window}));
                        });
                    }
                } finally {
                    try { await h.dispose(); } catch {}
                }
            } else {
                // As last resort, old behavior
                await page.hover(sel);
            }
        } else {
            // Move to a neutral spot to reliably cancel :hover
            await page.mouse.move(5, 5);
        }
    } catch (e) {
        pushLog(ctx, 'warning', `hoverOut failed: ${String(e && e.message || e)}`);
    }

    await postStepDelay(ctx, page);
}

async function stepFocus(page, action, _ctx, _localVars, _depth, _actionPathPrefix, selector, timeout) {
    if (!selector) return;

    let h = null;
    try {
        h = await waitForOneDeepOrThrow(page, selector, {visible: true, timeout});
        if (wantsScrollIntoView(action)) {
            await h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'}));
        }
        await h.focus();
    } finally {
        try { if (h) await h.dispose(); } catch {}
    }
}

async function stepFocusByText(page, action, ctx, localVars) {
    const needle = isNonEmptyString(action.labelText)
        ? interpolateVarTokensLoose(action.labelText.trim(), {localVars, ctx})
        : '';

    if (!needle) {
        if (action.optional) return;
        throw new Error('hoverByText failed: missing labelText');
    }

    const containerSel = isNonEmptyString(action.selector) ? action.selector.trim() : null;
    const exact = !!action.exact;
    const caseSensitive = !!action.caseSensitive;
    const t = Math.max(0, toNumber(action.timeout, 10000));

    // Optional: wait for a selector AFTER hover, e.g., a menu opens
    const postWaitSel = isNonEmptyString(action.postWaitForSelector) ? action.postWaitForSelector.trim() : null;
    const postWaitVisible = action.postWaitVisible !== false; // default true
    const postWaitTimeout = toNumber(action.postWaitTimeout, t);

    // Resolve the element via shared deep text resolver
    const interactiveSelector =
        'button, a, label,' +
        ' [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="treeitem"],' +
        ' input[type="button"], input[type="submit"], input[type="reset"],' +
        ' [tabindex]:not([tabindex="-1"])';

    const elHandle = await resolveByTextDeepHandle(page, {
        containerSel,
        needle,
        exact,
        caseSensitive,
        timeoutMs: t,
        interactiveSelector,
        allowPointerFallback: false,
        pointerFallbackMaxMatches: 1,
        preferLabelForCheckables: false
    }, ctx, needle);

    if (!elHandle) {
        throw new Error(`focusByText failed: "${needle}" not found within ${t}ms`);
    }

    // try/finally so elHandle is disposed on both the success and failure paths
    // (matches the "focus"/"hover" cases above).
    try {
        if (wantsScrollIntoView(action)) {
            await elHandle.evaluate((el) => el.scrollIntoView({block: 'center', inline: 'nearest'}));
        }
        await elHandle.focus();
    } finally {
        try { await elHandle.dispose(); } catch {}
    }
}

async function stepWaitForSelector(page, action, ctx, _localVars, _depth, _actionPathPrefix, selector, timeout) {
    if (!selector) return;
    const visible = action.visible !== false;
    const hidden = action.hidden === true;

    if (hidden) {
        // Hidden checks across shadow DOM are tricky, keep existing behavior for now.
        await ctx.race(page.waitForSelector(selector, {hidden: true, timeout}), `waitForSelector hidden ${selector}`);
        return;
    }

    const h = await ctx.race(
        waitForOneDeep(page, selector, {timeout, visible}),
        `waitForSelector waitForOneDeep ${selector}`
    );

    if (!h) {
        throw new Error(`waitForSelector timed out: ${selector}`);
    }

    try { await h.dispose(); } catch {}
}

async function stepWait(_page, action, ctx) {
    // Within the field's 0 to 1 hour, for a value only known now (a
    // {var:…}): past 2^31 - 1 ms a timer fires at once, so a wait of
    // a month waited 1 ms.
    const {min, max} = ACTION_DEFINITIONS.wait.fields.ms;
    const ms = Math.min(max, Math.max(min, toNumber(action.ms, 1000)));
    await ctx.race(sleep(ms), 'wait action');
}

async function stepScrollIntoView(page, _action, ctx, _localVars, _depth, _actionPathPrefix, selector, timeout) {
    if (!selector) return;
    const h = await ctx.race(
        waitForOneDeep(page, selector, {timeout, visible: false}),
        `scrollIntoView waitForOneDeep ${selector}`
    );
    if (!h) throw new Error(`scrollIntoView failed: "${selector}" not found`);
    try {
        await ctx.race(
            h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
            `scrollIntoView scroll ${selector}`
        );
    } finally {
        try { await h.dispose(); } catch {}
    }
}

async function stepScroll(page, action) {
    if (action.to === 'top') {
        await page.evaluate(() => {
            window.scrollTo(0, 0);
        });
    } else if (action.to === 'bottom') {
        await page.evaluate(() => {
            const height =
                document.body && document.body.scrollHeight
                    ? document.body.scrollHeight
                    : document.documentElement.scrollHeight || 0;
            window.scrollTo(0, height);
        });
    } else if (typeof action.y === 'number') {
        await page.evaluate((deltaY) => {
            window.scrollBy(0, deltaY);
        }, action.y);
    }
}

async function stepKeyboard(page, action) {
    if (Array.isArray(action.keys)) {
        for (const key of action.keys) {
            await pressKey(page, key);
        }
    }

    if (isNonEmptyString(action.text)) {
        await page.keyboard.type(action.text);
    }
}

async function stepSelect(page, action, ctx, localVars, _depth, _actionPathPrefix, selector, timeout) {
    if (!selector) return;
    const value = isNonEmptyString(action.value)
        ? interpolateVarTokensLoose(action.value.trim(), {localVars, ctx})
        : null;
    if (value == null) return;

    const h = await ctx.race(
        waitForOneDeep(page, selector, {timeout, visible: false}),
        `select waitForOneDeep ${selector}`
    );
    if (!h) throw new Error(`select failed: "${selector}" not found`);

    try {
        const hasOption = await h.evaluate((el, val) => {
            if (!el || !el.querySelector) return false;
            try {
                return !!el.querySelector(`option[value="${CSS.escape(String(val))}"]`);
            } catch {
                return false;
            }
        }, String(value)).catch(() => false);

        if (!hasOption) throw new Error(`select failed: option "${value}" not found`);

        if (wantsScrollIntoView(action)) {
            await ctx.race(
                h.evaluate(el => el.scrollIntoView({block: 'center', inline: 'nearest'})),
                `select scrollIntoView ${selector}`
            ).catch(() => {});
        }

        // ElementHandle.select exists for <select>
        await ctx.race(h.select(String(value)), `select handle.select ${selector}`);
    } finally {
        try { await h.dispose(); } catch {}
    }
}

const STEPS = {
    'click': stepClick,
    'type': stepType,
    'setValue': stepSetValue,
    'setPassword': stepSetValue,
    'clickByText': stepClickByText,
    'hover': stepHover,
    'hoverByText': stepHoverByText,
    'hoverOut': stepHoverOut,
    'focus': stepFocus,
    'focusByText': stepFocusByText,
    'waitForSelector': stepWaitForSelector,
    'wait': stepWait,
    'scrollIntoView': stepScrollIntoView,
    'scroll': stepScroll,
    'keyboard': stepKeyboard,
    'select': stepSelect
};

module.exports = {STEPS};
