'use strict';

// The conditions of the if, collect-output and skip-iteration steps: what
// a condition asks of the page, and whether the page meets it.

const {isNonEmptyString} = require('./utils');
const {queryOneDeep} = require('./deep-query');

/**
 * Shared predicate model used by `skipIteration` and `collectOutput`'s `when`.
 * `source` carries the top-level predicate fields (skipIteration itself, or a
 * `when` sub-object) plus a legacy `config` alias.
 */
function buildConditionConfig(source, ctx) {
    if (!source || typeof source !== 'object') return null;

    const legacyCfg = (source.config && typeof source.config === 'object') ? source.config : {};
    const cfg = {};
    const put = (k, v) => { if (v !== undefined) cfg[k] = v; };
    put('selector', source.selector);
    put('selectorTextEquals', source.selectorTextEquals);
    put('selectorTextContains', source.selectorTextContains);
    put('selectorAttr', source.selectorAttr);
    put('attrEquals', source.attrEquals);
    put('attrContains', source.attrContains);
    put('selectorExists', source.selectorExists);
    put('urlIncludes', source.urlIncludes);
    put('var', source.var);
    put('varEquals', source.varEquals);
    put('or', source.or);
    Object.assign(cfg, legacyCfg);

    // varEquals compares a workflow variable, which only exists in the Node
    // context, so resolve it here before handing cfg to page.evaluate.
    if (isNonEmptyString(cfg.var)) {
        cfg._varValue = ctx.getVar(cfg.var.trim());
    }

    return cfg;
}

async function evaluateConditionPredicate(page, ctx, source) {
    const cfg = buildConditionConfig(source, ctx);
    if (!cfg) return false;

    return ctx.race(
        page.evaluate((cfg2) => {
            if (!cfg2 || typeof cfg2 !== 'object') return false;

            const queryOneDeep = (root, selector) => {
                if (!root || !selector) return null;

                const stack = [];
                stack.push(document.documentElement || document.body);

                while (stack.length) {
                    const node = stack.pop();
                    if (!node) continue;

                    try {
                        if (node.matches && node.matches(selector)) return node;
                    } catch {
                    }

                    const kids = node.children;
                    if (kids && kids.length) {
                        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
                    }

                    const sr = node.shadowRoot;
                    if (sr) {
                        try {
                            const hit = sr.querySelector(selector);
                            if (hit) return hit;
                        } catch {
                        }
                        const srKids = sr.children;
                        if (srKids && srKids.length) {
                            for (let i = srKids.length - 1; i >= 0; i--) stack.push(srKids[i]);
                        }
                    }
                }

                return null;
            };

            const elMatchesNeedle = (el, needle, exact, caseSensitive) => {
                if (!el) return false;
                const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                const n = String(needle || '').replace(/\s+/g, ' ').trim();
                if (!n) return false;
                const a = caseSensitive ? raw : raw.toLowerCase();
                const b = caseSensitive ? n : n.toLowerCase();
                return exact ? a === b : a.includes(b);
            };

            const results = [];

            if (cfg2.selectorExists) {
                results.push(!!queryOneDeep(document, cfg2.selectorExists));
            }

            if (cfg2.selector) {
                // Each check set on the element is a condition of its own,
                // combined with the others as the step says (and, or or): text
                // equals, text contains, the attribute's value, the legacy
                // labelText. With none, the element being there is the condition.
                const el = queryOneDeep(document, cfg2.selector);
                const text = () => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                const checks = [];
                if (cfg2.selectorTextEquals != null) checks.push(() => text() === String(cfg2.selectorTextEquals).trim());
                if (cfg2.selectorTextContains != null) checks.push(() => text().includes(String(cfg2.selectorTextContains).trim()));
                if (cfg2.selectorAttr) {
                    const attr = () => el.getAttribute(cfg2.selectorAttr);
                    if (cfg2.attrEquals != null) checks.push(() => attr() === String(cfg2.attrEquals));
                    if (cfg2.attrContains != null) checks.push(() => { const v = attr(); return v != null && v.includes(String(cfg2.attrContains)); });
                    // An attribute with no value to compare is there or not.
                    if (cfg2.attrEquals == null && cfg2.attrContains == null) checks.push(() => attr() != null);
                }
                // Legacy alias, kept for backward compatibility.
                if (cfg2.labelText) checks.push(() => elMatchesNeedle(el, cfg2.labelText, !!cfg2.exact, !!cfg2.caseSensitive));
                if (!checks.length) checks.push(() => true);
                // No element: every check on it fails.
                for (const check of checks) results.push(el ? check() : false);
            }

            if (cfg2.urlIncludes) {
                results.push(String(location.href || '').includes(cfg2.urlIncludes));
            }

            if (cfg2.varEquals !== undefined && Object.prototype.hasOwnProperty.call(cfg2, '_varValue')) {
                // Compared as text, like the if step: a batch row's build 2310
                // (a number) must equal the "2310" typed into the step.
                const v = cfg2._varValue;
                results.push(v !== undefined && v !== null && String(v) === String(cfg2.varEquals));
            }

            if (!results.length) return false;
            return cfg2.or === true ? results.some(Boolean) : results.every(Boolean);
        }, cfg),
        'condition evaluate'
    );
}

module.exports = {
    buildConditionConfig,
    evaluateConditionPredicate
};
