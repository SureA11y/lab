'use strict';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function wait(page, ms) {
    if (page && typeof page.waitForTimeout === 'function') return page.waitForTimeout(ms);
    return sleep(ms);
}

/**
 * Resolve an element by labelText within document + open shadow roots.
 * Optionally scopes search within a container selector (also deep).
 * Optionally falls back to pointer-like resolution via elementFromPoint.
 *
 * Returns an ElementHandle or null.
 */
async function resolveByTextDeepHandle(page, {
    containerSel = null,
    needle,
    exact = false,
    caseSensitive = false,
    timeoutMs = 10000,
    interactiveSelector = null,
    allowPointerFallback = false,
    pointerFallbackMaxMatches = 1,
    preferLabelForCheckables = true
}, ctx, logLabel = '') {
    const startedAt = Date.now();
    const t = Math.max(0, Number(timeoutMs) || 0);

    while ((Date.now() - startedAt) < t) {
        const h = await (ctx?.race
                ? ctx.race(
                    page.evaluateHandle(EVAL_RESOLVE_FN,
                        containerSel,
                        needle,
                        !!exact,
                        !!caseSensitive,
                        !!allowPointerFallback,
                        Math.max(1, Number(pointerFallbackMaxMatches) || 1),
                        interactiveSelector,
                        !!preferLabelForCheckables
                    ),
                    logLabel ? `resolveByTextDeepHandle ${logLabel}` : 'resolveByTextDeepHandle'
                )
                : page.evaluateHandle(EVAL_RESOLVE_FN,
                    containerSel,
                    needle,
                    !!exact,
                    !!caseSensitive,
                    !!allowPointerFallback,
                    Math.max(1, Number(pointerFallbackMaxMatches) || 1),
                    interactiveSelector,
                    !!preferLabelForCheckables
                )
        );

        const asEl = h?.asElement?.() || null;
        if (asEl) {
            try { if (h && h !== asEl) await h.dispose(); } catch {}
            return asEl;
        }

        try { if (h) await h.dispose(); } catch {}
        try { await wait(page, 150); } catch {}
    }

    return null;
}

// This function runs in the page context (do not reference Node-side variables here).
function EVAL_RESOLVE_FN(containerSel, text, isExact, isCaseSensitive, allowPF, pfMaxMatches, interactiveSelector, preferLabelForCheckables) {
    const norm = (s) => {
        let out = (s ?? '').replace(/\s+/g, ' ').trim();
        if (!isCaseSensitive) out = out.toLowerCase();
        return out;
    };

    const isVisible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
    };

    const cssEscape = (s) => {
        try {
            return (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function')
                ? CSS.escape(String(s))
                : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
        } catch {
            return String(s);
        }
    };

    const getNameCandidates = (el) => {
        const out = [];
        if (!el) return out;

        const push = (v) => {
            const s = (v ?? '').toString().replace(/\s+/g, ' ').trim();
            if (!s) return;
            // de-dupe (case-insensitive de-dupe is fine even when caseSensitive)
            const key = s.toLowerCase();
            if (!out._seen) out._seen = new Set();
            if (out._seen.has(key)) return;
            out._seen.add(key);
            out.push(s);
        };

        // 1) Visible text
        push(el.innerText || el.textContent || '');

        // 2) aria-label
        try { push(el.getAttribute && el.getAttribute('aria-label')); } catch {}

        // 2b) aria-labelledby
        try {
            const ids = el.getAttribute && el.getAttribute('aria-labelledby');
            if (ids) {
                const t = ids.split(/\s+/).filter(Boolean).map(id => {
                    const ref = document.getElementById(id);
                    return ref ? ((ref.innerText || ref.textContent || '').trim()) : '';
                }).filter(Boolean).join(' ').trim();
                push(t);
            }
        } catch {}

        // 2c) title
        try { push(el.getAttribute && el.getAttribute('title')); } catch {}

        // 3) For checkboxes/radios, pull name from labels
        const isCheckable = (() => {
            try {
                return el.matches && el.matches('input[type="checkbox"], input[type="radio"]');
            } catch {
                return false;
            }
        })();

        if (isCheckable) {
            // explicit label[for=id]
            try {
                const id = el.getAttribute('id');
                if (id) {
                    const lab = document.querySelector(`label[for="${cssEscape(id)}"]`);
                    push(lab ? (lab.innerText || lab.textContent || '') : '');
                }
            } catch {}

            // implicit wrapper label
            try {
                const lab = el.closest && el.closest('label');
                push(lab ? (lab.innerText || lab.textContent || '') : '');
            } catch {}
        }

        // 4) input button-ish value fallback
        try {
            if (el.matches && el.matches('input[type="button"], input[type="submit"], input[type="reset"]')) {
                push(el.getAttribute('value') || '');
                push(el.value || '');
                if (el.matches('input[type="submit"]')) push('submit');
                if (el.matches('input[type="reset"]')) push('reset');
            }
        } catch {}

        // cleanup helper field
        try { delete out._seen; } catch {}
        return out;
    };

    const getPreferredClickTarget = (el) => {
        if (!preferLabelForCheckables) return el;
        if (!el) return el;

        try {
            if (el.tagName === 'LABEL') return el;

            const isCheckable =
                (el.matches && el.matches('input[type="checkbox"], input[type="radio"]')) ||
                el.getAttribute?.('role') === 'checkbox' ||
                el.getAttribute?.('role') === 'radio' ||
                el.getAttribute?.('role') === 'switch';

            if (isCheckable) {
                const implicit = el.closest && el.closest('label');
                if (implicit && isVisible(implicit)) return implicit;

                const id = el.getAttribute && el.getAttribute('id');
                if (id) {
                    const explicit = document.querySelector(`label[for="${cssEscape(id)}"]`);
                    if (explicit && isVisible(explicit)) return explicit;
                }
            }
        } catch {}

        return el;
    };

    const queryOneDeep = (root, selector) => {
        if (!root || !selector) return null;

        const stack = [];
        if (root === document) stack.push(document.documentElement || document.body);
        else stack.push(root);

        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;

            try {
                if (node.matches && node.matches(selector)) return node;
            } catch {}

            const children = node.children;
            if (children && children.length) {
                for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
            }

            const sr = node.shadowRoot;
            if (sr) {
                try {
                    const hit = sr.querySelector(selector);
                    if (hit) return hit;
                } catch {}
                const srChildren = sr.children;
                if (srChildren && srChildren.length) {
                    for (let i = srChildren.length - 1; i >= 0; i--) stack.push(srChildren[i]);
                }
            }
        }

        return null;
    };

    const collectRootsDeep = (startNode) => {
        const roots = [];
        if (!startNode) return roots;

        roots.push(startNode);

        const stack = [];
        const seen = new Set();

        const pushNode = (n) => {
            if (!n) return;
            if (seen.has(n)) return;
            seen.add(n);
            stack.push(n);
        };

        if (startNode === document) pushNode(document.documentElement || document.body);
        else pushNode(startNode);

        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;

            const sr = node.shadowRoot;
            if (sr && !seen.has(sr)) {
                seen.add(sr);
                roots.push(sr);
                const srKids = sr.children;
                if (srKids && srKids.length) {
                    for (let i = srKids.length - 1; i >= 0; i--) pushNode(srKids[i]);
                }
            }

            const kids = node.children;
            if (kids && kids.length) {
                for (let i = kids.length - 1; i >= 0; i--) pushNode(kids[i]);
            }
        }

        return roots;
    };

    const isTooLargeContainer = (el) => {
        try {
            const r = el.getBoundingClientRect();
            const vw = Math.max(1, window.innerWidth || 1);
            const vh = Math.max(1, window.innerHeight || 1);
            const frac = (r.width * r.height) / (vw * vh);
            return frac > 0.60;
        } catch {
            return false;
        }
    };

    const findTextHit = (root, nNeedle) => {
        let matchCount = 0;

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const raw = node.nodeValue || '';
                    const txt = norm(raw);
                    if (!txt) return NodeFilter.FILTER_REJECT;
                    if (isExact ? txt === nNeedle : txt.includes(nNeedle)) return NodeFilter.FILTER_ACCEPT;
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );

        let node = walker.nextNode();
        while (node) {
            const parentEl = node.parentElement;
            if (parentEl && isVisible(parentEl)) {
                matchCount++;
                if (matchCount >= pfMaxMatches) {
                    try {
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        const rects = range.getClientRects();
                        const rect = rects && rects.length ? rects[0] : range.getBoundingClientRect();
                        range.detach && range.detach();

                        if (rect && rect.width > 0 && rect.height > 0) {
                            const x = rect.left + Math.min(rect.width / 2, 10);
                            const y = rect.top + Math.min(rect.height / 2, 10);
                            return { el: parentEl, x, y };
                        }
                    } catch {}
                    return { el: parentEl, x: null, y: null };
                }
            }
            node = walker.nextNode();
        }

        return null;
    };

    let scope = null;
    if (containerSel) scope = queryOneDeep(document, containerSel);
    const roots = scope ? collectRootsDeep(scope) : collectRootsDeep(document);

    const INTERACTIVE = (typeof interactiveSelector === 'string' && interactiveSelector.trim())
        ? interactiveSelector
        : (
            'button, a, label,' +
            ' [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"],' +
            ' [role="treeitem"], [role="menuitem"], [role="tab"], [role="option"],' +
            ' input[type="button"], input[type="submit"], input[type="reset"],' +
            ' input[type="checkbox"], input[type="radio"],' +
            ' [tabindex]:not([tabindex="-1"])'
        );

    const n = norm(text);
    const seenEls = new Set();

    // Phase 1: strict interactive search
    for (const root of roots) {
        const candidates = [];

        try {
            if (root !== document && root.nodeType === 1 && root.matches && root.matches(INTERACTIVE)) {
                candidates.push(root);
            }
        } catch {}

        try {
            candidates.push(...Array.from(root.querySelectorAll ? root.querySelectorAll(INTERACTIVE) : []));
        } catch {}

        for (const el of candidates) {
            if (!el || seenEls.has(el)) continue;
            seenEls.add(el);

            if (!isVisible(el)) continue;

            const names = getNameCandidates(el);
            if (!names || !names.length) continue;

            let matched = false;
            for (const name of names) {
                const cand = norm(name);
                if (!cand) continue;
                if (isExact ? cand === n : cand.includes(n)) {
                    matched = true;
                    break;
                }
            }

            if (matched) {
                return getPreferredClickTarget(el);
            }
        }
    }

    // Phase 2: optional pointer-like fallback
    if (!allowPF) return null;

    for (const root of roots) {
        const hit = findTextHit(root === document ? (document.documentElement || document.body) : root, n);
        if (!hit || !hit.el) continue;

        if (typeof hit.x === 'number' && typeof hit.y === 'number') {
            const x = Math.max(0, Math.min((window.innerWidth || 1) - 1, hit.x));
            const y = Math.max(0, Math.min((window.innerHeight || 1) - 1, hit.y));

            const top = document.elementFromPoint(x, y);

            if (top && hit.el.contains(top)) {
                if (isVisible(top) && !isTooLargeContainer(top)) return getPreferredClickTarget(top);

                // Walking via parentElement can only reach ancestors, which in normal document
                // flow are never smaller than `top` - so this can only "rescue" a `top` that
                // failed isVisible for some other reason, not one that failed the size check.
                // If nothing acceptable turns up, this hit doesn't yield a usable target: move
                // on to the next root instead of returning the oversized/invisible element we
                // already rejected (that would defeat the point of the size/visibility checks).
                let cur = top;
                let hops = 0;
                while (cur && hops < 10) {
                    if (isVisible(cur) && !isTooLargeContainer(cur)) return getPreferredClickTarget(cur);
                    cur = cur.parentElement;
                    hops++;
                }

                continue;
            }

            if (isVisible(hit.el) && !isTooLargeContainer(hit.el)) return getPreferredClickTarget(hit.el);

            let cur = hit.el;
            let hops = 0;
            while (cur && hops < 10) {
                if (isVisible(cur) && !isTooLargeContainer(cur)) return getPreferredClickTarget(cur);
                cur = cur.parentElement;
                hops++;
            }

            continue;
        }

        if (isVisible(hit.el) && !isTooLargeContainer(hit.el)) return getPreferredClickTarget(hit.el);

        let cur = hit.el;
        let hops = 0;
        while (cur && hops < 10) {
            if (isVisible(cur) && !isTooLargeContainer(cur)) return getPreferredClickTarget(cur);
            cur = cur.parentElement;
            hops++;
        }
    }

    return null;
}

module.exports = {
    resolveByTextDeepHandle
};
