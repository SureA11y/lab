'use strict';

const { interpolateTemplate } = require('./vars');

function interpolateLogMessage(message, ctx) {
    let msg = String(message ?? '');
    msg = interpolateTemplate(msg, { ctx });

    const iter = (ctx && ctx._iterVars) ? ctx._iterVars : {};
    const hasIndex = typeof iter.index === 'number';
    const hasTotal = typeof iter.total === 'number';

    msg = msg
        .replaceAll('{index}', hasIndex ? String(iter.index) : '')
        .replaceAll('{oneBased}', hasIndex ? String(iter.index + 1) : '')
        .replaceAll('{total}', hasTotal ? String(iter.total) : '');

    return msg;
}

// The longest a variable's value is in a log entry; the log is read, the
// value is the run's.
const LOG_VALUE_MAX = 2000;

// What each log last said of each variable, by where the entries go (the
// run's progress, else its runLogs): an entry carries only what changed.
const lastSaid = new WeakMap();

/**
 * The run's variables for a log entry: those whose value changed since the
 * last entry went the same way, each at most LOG_VALUE_MAX characters, or
 * undefined when none did. The app merges each entry's into what it shows,
 * so it shows the same; a full copy in every entry made a 150 MB variable
 * 150 MB per entry, and held one progress poll for 5 s.
 */
function varsForLog(context) {
    if (!context) return undefined;
    const all = typeof context.getVarsFlat === 'function'
        ? context.getVarsFlat()
        : (context.vars ? { ...context.vars } : null);
    if (!all) return undefined;
    const sink = typeof context.progress === 'function' ? context.progress : (Array.isArray(context.runLogs) ? context.runLogs : null);
    let said = sink ? lastSaid.get(sink) : null;
    if (sink && !said) lastSaid.set(sink, said = new Map());

    const out = {};
    let changed = false;
    for (const [key, value] of Object.entries(all)) {
        let text;
        try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { text = String(value); }
        if (said && said.get(key) === text) continue;
        if (said) said.set(key, text);
        out[key] = typeof text === 'string' && text.length > LOG_VALUE_MAX ? `${text.slice(0, LOG_VALUE_MAX)}…` : value;
        changed = true;
    }
    return changed ? out : undefined;
}

/** Push uniform log entries, and fan out via ctx.progress if present */
function pushLog(context, type, message, extra = null) {
    const finalMessage = interpolateLogMessage(message, context);
    const normalizedExtra =
        (extra && typeof extra === 'object')
            ? { ...extra }
            : (extra == null ? null : { value: extra });

    // Prefer explicit extra.depth, otherwise inherit from the current log context (set by applyActions/runActionAction).
    const inheritedDepth =
        (context && context._logCtx && typeof context._logCtx.depth === 'number')
            ? context._logCtx.depth
            : 0;

    const depth =
        (normalizedExtra && typeof normalizedExtra.depth === 'number')
            ? normalizedExtra.depth
            : inheritedDepth;

    // Optional: also inherit actionPath if not provided explicitly
    const inheritedActionPath =
        (context && context._logCtx && typeof context._logCtx.actionPath === 'string')
            ? context._logCtx.actionPath
            : undefined;

    const entry = {
        time: new Date().toISOString(),
        type,
        message: finalMessage,
        depth,
        extra: normalizedExtra,
        // If you want, you can expose actionPath at top-level too, but only if your UI expects it.
        // actionPath: (extra && typeof extra.actionPath === 'string') ? extra.actionPath : inheritedActionPath,
        vars: varsForLog(context)
    };

    // If you *do* want the UI to have it, stash it in extra safely (without overwriting explicit).
    if (inheritedActionPath && entry.extra && typeof entry.extra === 'object' && entry.extra.actionPath == null) {
        entry.extra.actionPath = inheritedActionPath;
    }

    // Expose active custom-step stack so UI can deep-link action-start logs
    // back into the right custom-step editor context.
    if (Array.isArray(context?._customStepStack) && context._customStepStack.length) {
        if (!entry.extra || typeof entry.extra !== 'object') entry.extra = {};
        if (!Array.isArray(entry.extra.customStepStack)) {
            entry.extra.customStepStack = context._customStepStack.map((s) => String(s || '')).filter(Boolean);
        }
    }

    if (Array.isArray(context.runLogs)) context.runLogs.push(entry);
    if (typeof context.progress === 'function') {
        try { context.progress(entry); } catch {}
    }
}

module.exports = {
    pushLog,
    varsForLog,
    LOG_VALUE_MAX,
    interpolateLogMessage
};
