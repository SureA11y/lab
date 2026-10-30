'use strict';

// Finding elements for a step, in the page and in its shadow roots: one
// element by selector or by its text, waiting for it, whether it shows, and
// the scope attribute a loop marks its current element with. Also the frame
// waits a capture needs, and taking the hover state off before one.

const {resolveByTextDeepHandle} = require('../deep-by-text');

// Interaction steps accept an optional `scrollIntoView` flag (boolean, or the "true"/"false"
// strings older configs may carry). Unset means true: scroll the target into view first.
function wantsScrollIntoView(action) {
    const v = action ? action.scrollIntoView : undefined;
    if (v === undefined || v === null || v === '') return true;
    return !(v === false || v === 'false');
}

/** ---------------------------- scope helpers ----------------------------- */

async function setScopeAttr(page, handle) {
    const scopeId = `scope_${Math.random().toString(36).slice(2, 9)}`;

    // Verify we actually managed to mark the element, otherwise scopeSel will never match.
    const ok = await handle.evaluate((el, id) => {
        try {
            el.setAttribute('data-wf-scope', id);
            return el.getAttribute('data-wf-scope') === id;
        } catch {
            return false;
        }
    }, scopeId).catch(() => false);

    if (!ok) {
        const err = new Error('forEachElement: failed to set scope attribute (element likely detached)');
        err._wfSkipIteration = true; // so your outer logic can recover cleanly
        throw err;
    }

    return { scopeId, scopeSel: `[data-wf-scope="${scopeId}"]` };
}

async function clearScopeAttr(page, scopeId) {
    try {
        await page.evaluate((id) => {
            const el = document.querySelector(`[data-wf-scope="${id}"]`);
            if (el) el.removeAttribute('data-wf-scope');
        }, scopeId);
    } catch {
    }
}

function rewriteCtxTokenShallow(action, scopeSel) {
    // shallow clone so we never rewrite nested action trees here
    const out = Object.assign({}, action);

    const rewrite = (v) => (typeof v === 'string' && v.includes(':ctx'))
        ? v.split(':ctx').join(scopeSel)
        : v;

    // common selector-bearing fields in your actions
    out.selector = rewrite(out.selector);
    out.targetSelector = rewrite(out.targetSelector);
    out.context = rewrite(out.context);
    out.selectorExists = rewrite(out.selectorExists);

    // If you have other selector fields in your action types, add them here
    // out.containerSelector = rewrite(out.containerSelector);
    // out.rootSelector = rewrite(out.rootSelector);

    return out;
}

async function resolveActiveScopeSelector(page) {
    try {
        const scopeId = await page.evaluate(() => {
            const nodes = document.querySelectorAll('[data-wf-scope]');
            if (!nodes || !nodes.length) return null;
            const el = nodes[nodes.length - 1];
            return el && typeof el.getAttribute === 'function' ? el.getAttribute('data-wf-scope') : null;
        });
        if (!scopeId) return null;
        return `[data-wf-scope="${String(scopeId).replace(/"/g, '\\"')}"]`;
    } catch {
        return null;
    }
}

async function _isVisible(handle, opts = {}) {
    const {
        requireInViewport = true,
        viewportPadding = 0 // allow a small margin, e.g. 8 or 16
    } = opts;

    try {
        return await handle.evaluate((el, {requireInViewport, viewportPadding}) => {
            if (!el) return false;

            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;

            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;

            if (!requireInViewport) return true;

            // Viewport intersection (with optional padding)
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;

            const pad = Math.max(0, Number(viewportPadding) || 0);

            return (r.bottom > -pad) &&
                (r.right > -pad) &&
                (r.top < vh + pad) &&
                (r.left < vw + pad);
        }, {requireInViewport, viewportPadding});
    } catch {
        return false;
    }
}

// Resolves a single element by its visible text via the shared deep-text resolver
// (the same one clickByText/hoverByText/focusByText use). Backs click's labelText targeting.
async function findOneByTextDeepHandle(page, {
    containerSel,
    needle,
    exact,
    caseSensitive,
    timeoutMs,
    allowPointerFallback,
    pointerFallbackMaxMatches
}, ctx) {
    return resolveByTextDeepHandle(page, {
        containerSel,
        needle,
        exact,
        caseSensitive,
        timeoutMs,
        allowPointerFallback,
        pointerFallbackMaxMatches
    }, ctx, needle);
}

/**
 * Variable comparisons are made as text: a value from a batch row or a JSON
 * dataset may be a number or a boolean, while the value typed into a step is
 * text, and "2310" should equal 2310. An unset variable equals nothing.
 */
function sameAsText(value, expected) {
    if (value === undefined || value === null) return false;
    return String(value) === String(expected);
}

/** ------------------------------- query helpers ------------------------------- */

async function queryOneDeep(page, selector) {
    // 1) normal DOM
    const direct = await page.$(selector).catch(() => null);
    if (direct) return direct;

    // 2) open shadow DOM deep search
    const h = await page.evaluateHandle((sel) => {
        const isElement = (x) => x && x.nodeType === 1;

        const match = (root) => {
            try { return root.querySelector(sel); } catch { return null; }
        };

        const walk = (root) => {
            // Start at documentElement to avoid weirdness with Document as a node
            const start = root.documentElement || root.body || root;
            const stack = [start];

            while (stack.length) {
                const node = stack.pop();
                if (!node) continue;

                // Try matching within this subtree root (cheap first)
                const found = match(node === start ? root : node);
                if (found) return found;

                // Traverse open shadow roots
                if (isElement(node) && node.shadowRoot) {
                    const inShadow = match(node.shadowRoot);
                    if (inShadow) return inShadow;
                    stack.push(node.shadowRoot);
                }

                // Traverse element children
                if (isElement(node) && node.children && node.children.length) {
                    for (let i = node.children.length - 1; i >= 0; i--) {
                        stack.push(node.children[i]);
                    }
                }
            }
            return null;
        };

        return walk(document);
    }, selector);

    const el = h?.asElement?.() || null;
    if (!el) {
        try { await h.dispose(); } catch {}
        return null;
    }
    return el;
}

async function waitForOneDeep(page, selector, { timeout = 10000, visible = false } = {}) {
    const t0 = Date.now();
    while (true) {
        const h = await queryOneDeep(page, selector);
        if (h) {
            if (!visible) return h;

            const ok = await h.evaluate((el) => {
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
            }).catch(() => false);

            if (ok) return h;
            try { await h.dispose(); } catch {}
        }

        if (Date.now() - t0 > timeout) return null;
        await new Promise(r => setTimeout(r, 150));
    }
}

async function safeDoubleRAF(page, timeoutMs = 500) {
    try {
        await Promise.race([
            page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))),
            new Promise(resolve => setTimeout(resolve, timeoutMs))
        ]);
    } catch {
    }
}

async function clearHoverStateForCapture(page) {
    if (!page) return;

    let moved = false;
    try {
        const target = (typeof page.target === 'function') ? page.target() : null;
        const createCDP = target && (typeof target.createCDPSession === 'function')
            ? target.createCDPSession.bind(target)
            : null;
        if (createCDP) {
            const cdp = await createCDP();
            try {
                await cdp.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: -1,
                    y: -1,
                    button: 'none',
                    buttons: 0
                });
                moved = true;
            } finally {
                try { await cdp.detach(); } catch {}
            }
        }
    } catch {}

    if (moved) return;

    try {
        if (page.mouse && typeof page.mouse.move === 'function') {
            const vp = (typeof page.viewport === 'function') ? page.viewport() : null;
            const x = (vp && Number.isFinite(vp.width) && vp.width > 1) ? (vp.width - 1) : 1;
            const y = (vp && Number.isFinite(vp.height) && vp.height > 1) ? (vp.height - 1) : 1;
            await page.mouse.move(x, y);
        }
    } catch {}
}

async function waitForOneDeepOrThrow(page, selector, {timeout = 10000, visible = false} = {}) {
    const h = await waitForOneDeep(page, selector, {timeout, visible});
    if (!h) {
        throw new Error(`Selector not found (open shadow DOM aware): ${selector}`);
    }
    return h;
}

module.exports = {
    wantsScrollIntoView,
    queryOneDeep,
    waitForOneDeep,
    waitForOneDeepOrThrow,
    safeDoubleRAF,
    findOneByTextDeepHandle,
    _isVisible,
    setScopeAttr,
    clearScopeAttr,
    resolveActiveScopeSelector,
    rewriteCtxTokenShallow,
    clearHoverStateForCapture,
    sameAsText
};
