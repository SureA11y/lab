'use strict';

// The items a repeat step loops over, read from the text the user wrote: one
// item per line, a line that looks like an object read as one.

/**
 * Parse a textarea-like dataset where each non-empty line is one item.
 * - Plain text lines become { value: "<line>" }.
 * - JSON object lines become { ... } with all values normalized to strings.
 * - JSON primitives (string/number/boolean/null) become { value: "<string>" }.
 * - Lines starting with # or // are treated as comments.
 */

function tryParseJsonishObjectLine(line) {
    // Only attempt on object-literal-looking lines
    if (typeof line !== 'string') return null;
    const s = line.trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;

    // Basic safety gate: refuse obviously "code-like" inputs
    // (keeps this as data, not an expression evaluator)
    if (/[();`\\]/.test(s)) return null;

    // Quote unquoted identifier keys: {jarl: 1, foo_bar: "x"} -> {"jarl": 1, "foo_bar": "x"}
    const withQuotedKeys = s.replace(
        /([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,
        '$1"$2"$3'
    );

    // Optional: single-quoted strings -> double-quoted strings
    // 'abc' -> "abc" (simple form, avoids trying to fully implement JS string rules)
    const withDoubleQuotes = withQuotedKeys.replace(
        /:\s*'([^'\\]*(?:\\.[^'\\]*)*)'\s*([,}])/g,
        (m, inner, tail) => `:"${inner.replace(/"/g, '\\"')}"${tail}`
    );

    // Quote bareword values, including tokens that start with digits.
    // Examples:
    //   {a: rerere}      -> {"a":"rerere"}
    //   {a: 12asdfasd}   -> {"a":"12asdfasd"}
    // Leaves numbers, true/false/null, and already-quoted strings untouched.
    const withQuotedBareValues = withDoubleQuotes.replace(
        /:\s*([^\s",}\]]+)(\s*[,\}])/g,
        (m, token, tail) => {
            // JSON literals
            if (token === 'true' || token === 'false' || token === 'null') return `:${token}${tail}`;

            // number (int/float, optional leading minus)
            if (/^-?\d+(\.\d+)?$/.test(token)) return `:${token}${tail}`;

            // anything else becomes a string
            return `:"${String(token).replace(/"/g, '\\"')}"${tail}`;
        }
    );

    try {
        const parsed = JSON.parse(withQuotedBareValues);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return null;
    } catch {
        return null;
    }
}

function parseRepeatItemsText(text) {
    const raw = (typeof text === 'string') ? text : '';
    const lines = raw.split(/\r?\n/);
    const out = [];

    for (const line0 of lines) {
        const line = (typeof line0 === 'string') ? line0.trim() : '';
        if (!line) continue;
        if (line.startsWith('#') || line.startsWith('//')) continue;

        // Try JSON per-line when it looks like JSON
        const looksJson = line.startsWith('{') || line.startsWith('[') || line.startsWith('"');
        if (looksJson) {
            try {
                let parsed;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    // Fallback: allow {jarl: 112121} style "JSON-ish" objects
                    parsed = tryParseJsonishObjectLine(line);
                    if (parsed == null) throw new Error('jsonish-parse-failed');
                }

                // object => item vars
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const obj = {};
                    for (const k of Object.keys(parsed)) {
                        const v = parsed[k];
                        if (v === null || typeof v === 'undefined') obj[k] = '';
                        else if (typeof v === 'string') obj[k] = v;
                        else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') obj[k] = String(v);
                        else {
                            try {
                                obj[k] = JSON.stringify(v);
                            } catch {
                                obj[k] = String(v);
                            }
                        }
                    }
                    out.push(obj);
                    continue;
                }

                // primitive / array => { value: "..." }
                if (parsed === null || typeof parsed === 'undefined') {
                    out.push({value: ''});
                    continue;
                }
                if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean' || typeof parsed === 'bigint') {
                    out.push({value: String(parsed)});
                    continue;
                }
                try {
                    out.push({value: JSON.stringify(parsed)});
                } catch {
                    out.push({value: String(parsed)});
                }
                continue;
            } catch {
                // fall through to plain text
            }
        }

        out.push({value: line});
    }

    return out;
}

module.exports = {
    tryParseJsonishObjectLine,
    parseRepeatItemsText
};
