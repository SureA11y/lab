'use strict';

/**
 * Whether a CSS selector list is written so a browser can parse it, as far as
 * that can be told without one: brackets, parentheses and quotes that open
 * and close, no empty selector in the list, no combinator left hanging, no
 * run of three colons. A selector this passes may still be one the browser
 * refuses (an unknown pseudo-class); the run says so when it gets there. One
 * this refuses, a browser would too, so a run with it is refused before it
 * starts rather than failing at its scan.
 *
 * Text with a {var:…} token is left alone: what it becomes is known only
 * once the run is going.
 *
 * -> null when it parses, else why not.
 */
function selectorSyntaxProblem(text) {
    if (typeof text !== 'string') return null;
    const sel = text.trim();
    if (!sel || sel.includes('{')) return null;

    const closing = { '(': ')', '[': ']' };
    const stack = [];
    let quote = null;
    for (let i = 0; i < sel.length; i += 1) {
        const ch = sel[i];
        if (ch === '\\') { i += 1; continue; }
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '(' || ch === '[') stack.push(closing[ch]);
        else if (ch === ')' || ch === ']') {
            if (stack.pop() !== ch) return `"${ch}" closes nothing that was opened`;
        }
    }
    if (quote) return `a quote (${quote}) is never closed`;
    if (stack.length) return `"${stack[stack.length - 1]}" is missing: something opened is never closed`;
    if (/:::/.test(sel)) return 'three colons in a row';

    // Each selector of the list: none empty, none ending or starting on a
    // combinator (outside brackets, where commas and > are text).
    for (const part of splitTopLevel(sel)) {
        const p = part.trim();
        if (!p) return 'an empty selector in the list (two commas, or one at an end)';
        if (/[>+~]$/.test(p)) return `"${p}" ends with a combinator`;
        if (/^[+~]/.test(p)) return `"${p}" starts with a combinator`;
    }
    return null;
}

/** `sel` split at its commas outside brackets, parentheses and quotes. */
function splitTopLevel(sel) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < sel.length; i += 1) {
        const ch = sel[i];
        if (ch === '\\') { i += 1; continue; }
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(' || ch === '[') depth += 1;
        else if (ch === ')' || ch === ']') depth -= 1;
        else if (ch === ',' && depth === 0) { parts.push(sel.slice(start, i)); start = i + 1; }
    }
    parts.push(sel.slice(start));
    return parts;
}

module.exports = { selectorSyntaxProblem };
