'use strict';

/**
 * Collects DOM / HTML heuristics, apart from the scan's findings.
 * Runs inside the page context via page.evaluate().
 */

async function collectDomMetrics(page, options = {}) {
    const {
        maxNodes = 20000,
        includeComputedVisibility = true
    } = options;

    if (!page) throw new Error('collectDomMetrics: page is required');

    const startedAt = Date.now();

    const metrics = await page.evaluate((cfg) => {
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

            // Custom control heuristic:
            // - Not a native interactive tag
            // - And either an interactive role, or focusable tabindex, or a click handler paired with focusability signal
            if (!INTERACTIVE_TAGS.has(tag)) {
                const focusSignal =
                    isFocusableByTabindex ||
                    isInteractiveRole ||
                    node.getAttribute('contenteditable') === 'true';

                if (isInteractiveRole || isStatefulRole || (hasOnclick && focusSignal) || isFocusableByTabindex) {
                    customControlCount++;
                }
            }

            // Hidden heuristic
            if (
                node.hasAttribute('hidden') ||
                node.getAttribute('aria-hidden') === 'true'
            ) {
                hiddenCount++;
            } else if (includeComputed) {
                // Cheap inline style pre-check, avoids getComputedStyle in some obvious cases
                const styleAttr = node.getAttribute('style');
                if (styleAttr && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(styleAttr)) {
                    hiddenCount++;
                } else {
                    const cs = getComputedStyle(node);
                    if (cs.display === 'none' || cs.visibility === 'hidden') {
                        hiddenCount++;
                    }
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

            // Optional but useful for debugging and tuning
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
    }, { maxNodes, includeComputedVisibility });

    metrics.timings = { totalMs: Date.now() - startedAt };
    return metrics;
}

module.exports = { collectDomMetrics };
