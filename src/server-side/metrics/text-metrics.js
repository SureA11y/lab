'use strict';

/**
 * Collects text-focused DOM heuristics, language-agnostic.
 * Runs inside the page context via page.evaluate().
 *
 * Output is intended as "risk/context signals", not pass/fail.
 */

async function collectTextMetrics(page, options = {}) {
    const {
        maxNodes = 20000,
        includeComputedVisibility = true,
        maxTextChars = 2_000_000, // safety cap
        paragraphSelectors = 'p, li, dd, td',
        headingSelectors = 'h1, h2, h3, h4, h5, h6'
    } = options;

    if (!page) throw new Error('collectTextMetrics: page is required');

    const startedAt = Date.now();

    const metrics = await page.evaluate((cfg) => {
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

            // common accessible name signals, cheap checks only
            if (el.getAttribute('aria-label')) return true;
            if (el.getAttribute('aria-labelledby')) return true;
            if (el.getAttribute('title')) return true;

            // input buttons often use value as visible label, count as signal
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
            // Collapse whitespace for stability across formatting
            const t = String(s).replace(/\s+/g, ' ').trim();
            return t.length;
        }

        function isElementHidden(el) {
            if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;

            // Fast checks first
            if (el.hasAttribute('hidden')) return true;
            if (el.getAttribute('aria-hidden') === 'true') return true;

            // Skip common non-content
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'script' || tag === 'style' || tag === 'noscript') return true;

            // Cheap inline style pre-check
            const styleAttr = el.getAttribute('style');
            if (styleAttr && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(styleAttr)) return true;

            if (!includeComputed) return false;

            try {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return true;
            } catch {}

            return false;
        }

        // -------- Total visible text (via text nodes) --------
        let totalElementsVisited = 0;
        let totalVisibleTextChars = 0;
        let capped = false;

        const root = document.documentElement;
        const queue = [{ node: root }];
        let qi = 0;

        // We traverse elements to avoid TreeWalker on huge DOMs that can be expensive.
        // While traversing, we count text nodes under each element via childNodes.
        while (qi < queue.length) {
            const cur = queue[qi++].node;
            if (!cur || cur.nodeType !== Node.ELEMENT_NODE) continue;

            // Skip hidden containers early
            if (isElementHidden(cur)) continue;

            totalElementsVisited++;
            if (totalElementsVisited > MAX_NODES) { capped = true; break; }

            // Count direct text node children (fast)
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

            // Enqueue children elements
            const kids = cur.children;
            for (let k = 0; k < kids.length; k++) {
                queue.push({ node: kids[k] });
            }
        }

        // -------- Paragraph length distribution (p, li, dd, td) --------
        const paraLens = [];
        try {
            const nodes = document.querySelectorAll(PARA_SEL);
            const limit = Math.min(nodes.length, 3000); // cap for performance
            for (let i = 0; i < limit; i++) {
                const el = nodes[i];
                if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
                if (isElementHidden(el)) continue;

                // Avoid innerText (layout). Use textContent normalized.
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

        // -------- Text chars per heading (simple but very useful) --------
        let headingCount = 0;
        try {
            const hs = document.querySelectorAll(HEAD_SEL);
            const limit = Math.min(hs.length, 2000); // cap for performance
            for (let i = 0; i < limit; i++) {
                const el = hs[i];
                if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
                if (isElementHidden(el)) continue;
                headingCount++;
            }
        } catch {}

        // If no headings, still compute (it becomes a big number, useful signal)
        const textCharsPerHeading = totalVisibleTextChars / Math.max(1, headingCount);

        // -------- Link text density (navigation/content mix signal) --------
        let linksCount = 0;
        let visibleLinkTextChars = 0;
        let linksNoVisibleTextCount = 0;
        let linksNoTextNoNameSignalCount = 0;
        let linksNameSignalCount = 0;

        try {
            const links = document.querySelectorAll('a[href]');
            const limit = Math.min(links.length, 5000); // cap for performance
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

        // -------- Button text density (control-heavy UI signal) --------
        let buttonsCount = 0;
        let visibleButtonTextChars = 0;
        let buttonsNoVisibleTextCount = 0;
        let buttonsNoTextNoNameSignalCount = 0;
        let buttonsNameSignalCount = 0;

        try {
            const btns = document.querySelectorAll(
                'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
            );
            const limit = Math.min(btns.length, 5000); // cap for performance
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
                // More stable than raw chars
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
    }, { maxNodes, includeComputedVisibility, maxTextChars, paragraphSelectors, headingSelectors });

    metrics.timings = { totalMs: Date.now() - startedAt };
    return metrics;
}

module.exports = { collectTextMetrics };
