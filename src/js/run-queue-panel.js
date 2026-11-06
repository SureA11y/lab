'use strict';

import { setBusy } from './busy.js';
import { resultGlyphEl } from './result-glyph.js';

/**
 * The queue tab: what is waiting, running and finished, one section per queue
 * session, with the links to each saved result and to the whole session as a
 * zip. State comes from GET /queue and is polled only while the tab is shown
 * and a session is running.
 *
 * Re-rendered from scratch on every change; focus is put back on the
 * equivalent control afterwards (by data-focus-key), and finished runs are
 * announced through the status line rather than by making the table live.
 */

const STATUS_LABELS = {
    waiting: 'Waiting',
    running: 'Running',
    cancelling: 'Cancelling…',
    done: 'Done',
    error: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
};

const TERMINAL = new Set(['done', 'error', 'cancelled', 'interrupted']);

// A running run that has logged nothing for this long says so: it may be on a
// long wait, or stuck on a page.
export const STALL_MS = 5 * 60 * 1000;

const NOTIFY_STORAGE_KEY = 'a11y-queue-notify';

export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const totalSeconds = Math.round(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

function formatStart(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

/**
 * When a run's status was reached, in full but short, as reports write
 * dates: "6 Nov 2026, 11:33". `full` adds the seconds and the month's name,
 * for its title.
 */
export function formatWhen(iso, { full = false } = {}) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', full
        ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
        : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Checkout – Queue started 14 Oct, 10:33:42", or without the name if it has none. */
function sessionTitle(session) {
    const started = `Queue started ${formatStart(session.startedAt)}`;
    return session.name ? `${session.name} – ${started}` : started;
}

/** The batch as a sentence names it: "the batch Checkout, started …". */
function describeBatch(session) {
    const started = `started ${formatStart(session.startedAt)}`;
    return session.name ? `the batch ${session.name}, ${started}` : `the batch ${started}`;
}

function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * Findings by outcome, counted as the live totals and the report count them.
 * Batches saved before this counted elements under failInstances etc.; their
 * failRules figure is the same count as `fail` now.
 */
// A finished run's figures carry the outcome's tile after them, as the live
// totals and the scan cards do: colour, glyph and the column's word, never
// colour alone. A count of 0 gets none (nothing to draw the eye to), and nor
// does a run still going; an empty slot the tile's width keeps their numbers
// in line with the others.
const FINISHED = new Set(['done', 'error', 'cancelled']);
function findingsCell(doc, item, findings, key, className) {
    const text = findingsText(findings, key);
    if (!text) return el(doc, 'td', { className });
    const glyph = FINISHED.has(item.status) && Number(text) > 0 ? resultGlyphEl(key, { size: 'sm', doc }) : null;
    return el(doc, 'td', { className }, [
        text,
        glyph || el(doc, 'span', { className: 'queue-glyph-slot', 'aria-hidden': 'true' }),
    ]);
}

function findingsText(findings, key) {
    const count = Number.isFinite(findings[key]) ? findings[key] : findings[`${key}Rules`];
    if (!Number.isFinite(count)) return '';
    return String(count);
}

/** One line on where a session stands. */
/** "1 every 9.0s": tenths under 10 s, where they still tell runs apart. */
export function formatPace(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    return ms < 10000 ? `1 every ${(ms / 1000).toFixed(1)}s` : `1 every ${formatDuration(ms)}`;
}

const formatCount = (n) => n.toLocaleString('en-US');

export function describeSession(session) {
    const c = session.counts || {};
    const total = c.total || 0;
    const finished = (c.done || 0) + (c.error || 0) + (c.cancelled || 0);
    const parts = [];
    if (session.state === 'running') {
        parts.push(`Running · ${finished} of ${total} finished`);
        if (c.waiting) parts.push(`${c.waiting} waiting`);
        if (session.scansPerMin) {
            // Merged scans fold several scans into the one the Scans column counts.
            const merged = Number.isFinite(session.mergedScansPerMin) ? ` (${formatCount(session.mergedScansPerMin)} after merging)` : '';
            parts.push(`about ${plural(session.scansPerMin, 'scan')} a minute${merged}`);
        }
    } else if (session.state === 'interrupted') {
        parts.push(`Interrupted by a server restart · ${finished} of ${total} finished`);
    } else {
        parts.push(`Finished · ${plural(total, 'run')}`);
    }
    if (c.error) parts.push(`${c.error} failed`);
    if (c.cancelled) parts.push(`${c.cancelled} cancelled`);
    return parts.join(' · ');
}

function formatMb(mb) {
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * The running batch's line on the server's memory (GET /queue's `hold` and
 * `resources`), or '' with no reading yet. While the governor holds the next
 * run it says so, why, and when it will start.
 */
export function describeHealth({ hold = null, resources = null } = {}) {
    const reading = hold || resources;
    if (!reading || !Number.isFinite(reading.heapPct)) return '';
    const limit = resources && Number.isFinite(resources.heapLimitMb) ? ` of its ${formatMb(resources.heapLimitMb)} limit` : ' of its limit';
    const pct = `${Math.round(reading.heapPct)}%${limit}`;
    if (!hold) return `Server memory: ${pct}.`;
    return `Holding the next run while server memory is high: ${pct}. `
        + `It starts once memory is below ${hold.resumeBelowPct}%; the runs already going carry on.`;
}

/**
 * A finished batch in a line (§8.3): "4,212 scans in 2h 10m · slowest:
 * Checkout (1h 42m) · server memory peaked at 41% of its 4.0 GB limit · held a
 * run back for memory twice". '' when there is nothing to say.
 */
export function describeSummary(session) {
    // The server says it of the whole batch (scans, slowest); a batch given
    // with its runs is read from them.
    const items = Array.isArray(session.items) ? session.items : [];
    const parts = [];
    const scans = Number.isFinite(session.scans)
        ? session.scans
        : items.reduce((n, i) => n + (Number.isFinite(i.scansRun) ? i.scansRun : (Number.isFinite(i.scans) ? i.scans : 0)), 0);
    const span = Date.parse(session.finishedAt) - Date.parse(session.startedAt);
    if (scans) parts.push(Number.isFinite(span) && span >= 0 ? `${plural(scans, 'scan')} in ${formatDuration(span)}`.replace(String(scans), formatCount(scans)) : plural(scans, 'scan'));
    let slowest = session.slowest !== undefined ? session.slowest : null;
    if (session.slowest === undefined) {
        const timed = items.filter((i) => Number.isFinite(i.durationMs) && i.status !== 'cancelled' && i.status !== 'interrupted');
        if (timed.length > 1) slowest = timed.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
    }
    // A batch cancelled before any run went has none to name.
    if (slowest && slowest.durationMs > 0) parts.push(`slowest: ${slowest.name} (${formatDuration(slowest.durationMs)})`);
    const stats = session.stats || {};
    if (Number.isFinite(stats.peakHeapPct)) {
        const limit = Number.isFinite(stats.heapLimitMb) ? ` of its ${formatMb(stats.heapLimitMb)} limit` : '';
        parts.push(`server memory peaked at ${Math.round(stats.peakHeapPct)}%${limit}`);
    }
    if (stats.holds > 0) {
        parts.push(`held a run back for memory ${stats.holds === 1 ? 'once' : stats.holds === 2 ? 'twice' : `${stats.holds} times`}`);
    }
    return parts.join(' · ');
}

function el(doc, tag, attrs = {}, children = []) {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'text') node.textContent = value;
        else if (key === 'className') node.className = value;
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return node;
}

// 24x24 stroke icons, drawn like the app's other icon buttons.
const ICONS = {
    open: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h6'],
    watch: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    cancel: ['M6 6l12 12', 'M18 6L6 18'],
    warning: ['M12 3L2 21h20z', 'M12 10v5', 'M12 18h.01'],
    // Load workflow: back into the editor, to type its passwords again.
    edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
    // Run again: a circling arrow.
    rerun: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4h-4'],
    // Delete a run from a finished batch: a bin.
    delete: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
};

function icon(doc, name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' })) {
        svg.setAttribute(k, v);
    }
    for (const d of ICONS[name]) {
        const path = doc.createElementNS(NS, 'path');
        for (const [k, v] of Object.entries({ d, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
            path.setAttribute(k, v);
        }
        svg.append(path);
    }
    return svg;
}

/**
 * An icon-only row action: the icon for the eye, the verb on hover (title),
 * and "Open Product v2.3" as its accessible name, all in hidden text.
 */
function iconAction(doc, tag, verb, iconName, name, attrs) {
    return el(doc, tag, {
        ...attrs,
        className: 'secondary-button icon-button queue-icon-button',
        title: verb,
    }, [icon(doc, iconName), el(doc, 'span', { className: 'visually-hidden', text: `${verb} ${name}` })]);
}

// One turn of .tab-spinner (its tabSpin animation in css/controls.css).
const SPIN_MS = 900;

/**
 * The table is built again on every poll, and a new element's animation starts
 * from the top, so the spinner jumped back once a second. Started this far
 * into its turn, a new spinner carries on where the one it replaces was: the
 * page clock sets the angle, not the element's age.
 */
function spinnerPhase(doc) {
    const perf = doc && doc.defaultView && doc.defaultView.performance;
    const now = perf && typeof perf.now === 'function' ? perf.now() : Date.now();
    return `animation-delay: -${Math.round(now % SPIN_MS)}ms`;
}

// A running batch carries the runs' spinner right after its "Running", open or
// folded: folded, it would otherwise read like a finished batch but for one
// word. The spinner is a cue only; the words say it is running.
const RUNNING = 'Running';
function statusLine(doc, session) {
    const text = describeSession(session);
    if (session.state !== 'running' || !text.startsWith(RUNNING)) return text;
    return [
        RUNNING,
        el(doc, 'span', { className: 'tab-spinner queue-spinner', 'aria-hidden': 'true', style: spinnerPhase(doc) }),
        text.slice(RUNNING.length),
    ];
}

/**
 * What a running run is on and how lively it is, for the Watch dialog's
 * summary (§8.1): `{ step, liveness, stall }`, from the details GET /queue and
 * a run's progress give. `stall` is '' unless it has logged nothing for
 * STALL_MS. The queue's rows show none of it: text that changes every second
 * resized the table as it ran.
 */
export function describeRunNow(details = {}) {
    const step = details.phase === 'saving'
        ? 'Building and writing the result'
        : (details.activity || 'Starting');
    const scan = Number.isFinite(details.sinceScanMs) ? `Last scan ${formatDuration(details.sinceScanMs)} ago` : 'No scan yet';
    const pace = formatPace(details.paceMs);
    const stall = details.phase !== 'saving' && details.sinceProgressMs >= STALL_MS
        ? `No progress for ${formatDuration(details.sinceProgressMs)}: it may be on a long wait, or stuck on a page.`
        : '';
    return { step, liveness: pace ? `${scan} · ${pace}` : scan, stall };
}

const STALL_LABEL = 'No progress for over 5 minutes. Watch the run for details.';

/**
 * Under a run's status, when it was reached: "6 Nov 2026, 11:33", and
 * "Ran again" when the result came from Run again. A running run says when
 * it started; a waiting one has no time yet.
 */
function whenLines(doc, item, { line = null } = {}) {
    const running = item.status === 'running' || item.status === 'cancelling';
    const at = running ? item.startedAt : (item.status === 'waiting' ? null : item.finishedAt);
    const short = formatWhen(at);
    if (!short) return [];
    const word = running ? 'Started' : (item.status === 'done' ? 'Finished' : 'Ended');
    return [
        el(doc, 'time', {
            className: 'queue-note queue-when',
            datetime: at,
            title: `${word} ${formatWhen(at, { full: true })}`,
        }, running ? `Started ${short}` : short),
        !running && item.ranAgain && line !== 'rerun' ? el(doc, 'span', { className: 'queue-note', text: 'Ran again' }) : null,
    ];
}

// A line's label, above its status, where a row shows more than one result.
const LINE_LABELS = { active: 'Active', rerun: 'Run again' };

function statusCell(doc, item, { line = null } = {}) {
    const busy = item.status === 'running' || item.status === 'cancelling';
    // Building and writing its result, once its last step is done (§8.1).
    const saving = item.status === 'running' && item.phase === 'saving';
    const cell = el(doc, 'td', { className: `queue-status queue-status--${item.status}` }, [
        line ? el(doc, 'span', { className: `queue-line-tag queue-line-tag--${line}`, text: LINE_LABELS[line] }) : null,
        // The word carries the state for screen readers; the spinner is a cue,
        // after it, so every status word starts at the same edge.
        saving ? 'Saving result' : (STATUS_LABELS[item.status] || item.status),
        busy ? el(doc, 'span', { className: 'tab-spinner queue-spinner', 'aria-hidden': 'true', style: spinnerPhase(doc) }) : null,
    ]);
    // A run that has logged nothing for minutes gets a warning sign, the same
    // size whatever it says, so the row keeps its shape; what it is on is in
    // the Watch dialog (§8.1).
    if (item.status === 'running' && !saving && item.sinceProgressMs >= STALL_MS) {
        cell.append(el(doc, 'span', { className: 'queue-stall', title: STALL_LABEL }, [
            icon(doc, 'warning'),
            el(doc, 'span', { className: 'visually-hidden', text: ` ${STALL_LABEL}` }),
        ]));
    }
    cell.append(...whenLines(doc, item, { line }).filter(Boolean));
    if (item.status === 'interrupted' && item.needsValues) {
        cell.append(el(doc, 'span', { className: 'queue-note', text: 'Its passwords were not saved' }));
    }
    if (item.error) {
        cell.append(el(doc, 'span', { className: 'queue-note', text: item.error }));
    }
    return cell;
}

function actionsCell(doc, session, item, { queueBusy = false } = {}) {
    // The buttons sit in a flex row inside the cell: a flex td is no longer a
    // table cell, and its row's stripe would stop short of the row's height.
    const cell = el(doc, 'div', { className: 'queue-actions' });
    if (item.fileUrl) {
        cell.append(iconAction(doc, 'button', 'Open', 'open', item.name, {
            type: 'button',
            'data-queue-action': 'open',
            'data-item-id': item.id,
            'data-focus-key': `open:${item.id}`,
        }));
        // Its report package: its result and its pictures (batch-package.js).
        cell.append(iconAction(doc, 'a', 'Download', 'download', item.name, {
            href: item.zipUrl || item.fileUrl,
            download: item.zipUrl ? (item.zipName || true) : (item.file || true),
            'data-focus-key': `download:${item.id}`,
        }));
    }
    if (session.state === 'running' && item.status === 'running') {
        cell.append(iconAction(doc, 'button', 'Watch', 'watch', item.name, {
            type: 'button',
            'data-queue-action': 'watch',
            'data-item-id': item.id,
            'data-focus-key': `watch:${item.id}`,
        }));
    } else if (session.state === 'running' && item.status === 'waiting') {
        // A waiting run has no Watch yet: hold its place, so Cancel lines up
        // with the Cancel of the running rows above.
        cell.append(el(doc, 'span', { className: 'queue-icon-slot', 'aria-hidden': 'true' }));
    }
    if (session.state === 'running' && (item.status === 'waiting' || item.status === 'running')) {
        cell.append(iconAction(doc, 'button', 'Cancel', 'cancel', item.name, {
            type: 'button',
            'data-queue-action': 'cancel',
            'data-item-id': item.id,
            'data-focus-key': `cancel:${item.id}`,
        }));
    }
    // A finished batch's row, run again from the workflow it saved; one
    // added as a report has none.
    if (session.state !== 'running' && item.hasConfig && !item.imported
        && item.status !== 'waiting' && item.status !== 'running' && item.status !== 'cancelling') {
        cell.append(iconAction(doc, 'button', 'Run again', 'rerun', item.name, {
            type: 'button',
            'aria-disabled': queueBusy ? 'true' : null,
            'data-queue-action': queueBusy ? 'blocked' : 'rerun',
            'data-blocked-reason': queueBusy ? QUEUE_BUSY_CHANGE : null,
            'data-session-id': session.id,
            'data-item-id': item.id,
            'data-focus-key': `rerun:${item.id}`,
        }));
    }
    // A finished batch's run, deleted from it (its result, and what only it
    // used); not its only one: the batch is deleted as a whole.
    if (session.state !== 'running'
        && item.status !== 'waiting' && item.status !== 'running' && item.status !== 'cancelling') {
        const only = (session.counts?.total ?? (session.items || []).length) <= 1;
        const why = queueBusy ? QUEUE_BUSY_CHANGE : (only ? DELETE_ONLY_RUN : null);
        cell.append(iconAction(doc, 'button', 'Delete', 'delete', item.name, {
            type: 'button',
            'aria-disabled': why ? 'true' : null,
            'data-queue-action': why ? 'blocked' : 'delete-item',
            'data-blocked-reason': why,
            'data-session-id': session.id,
            'data-item-id': item.id,
            'data-focus-key': `delete-item:${item.id}`,
        }));
    }
    // An icon button as the others are, so a row's actions always fit its
    // column on one line.
    if (item.status === 'interrupted' && item.needsValues && item.hasConfig) {
        cell.append(iconAction(doc, 'button', 'Load workflow', 'edit', item.name, {
            type: 'button',
            'data-queue-action': 'load',
            'data-item-id': item.id,
            'data-focus-key': `load:${item.id}`,
        }));
    }
    return el(doc, 'td', { className: 'queue-actions-cell' }, cell);
}

const MASKED_SUFFIX = 'Masked';

/** Keys that change how a step looks in the editor, not what it does. */
const EDITOR_ONLY_KEYS = new Set(['collapsed']);

/** A setValue step saved hidden, before setPassword existed, is one now. */
function passwordStepType(type) {
    return type === 'setValue' ? 'setPassword' : type;
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).filter((k) => !EDITOR_ONLY_KEYS.has(k)).sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** Every password typed in a workflow, wherever it sits: `{ path, field, step, value }`. */
function typedPasswords(value, at = [], out = []) {
    if (Array.isArray(value)) {
        value.forEach((v, i) => typedPasswords(v, [...at, i], out));
    } else if (value && typeof value === 'object') {
        for (const [key, flag] of Object.entries(value)) {
            if (flag !== true || key.length <= MASKED_SUFFIX.length || !key.endsWith(MASKED_SUFFIX)) continue;
            const field = key.slice(0, -MASKED_SUFFIX.length);
            const { [field]: typed, ...step } = value;
            if (typeof typed !== 'string' || typed === '') continue;
            out.push({ path: at, field, step: { ...step, type: passwordStepType(step.type) }, value: typed });
        }
        for (const [key, v] of Object.entries(value)) typedPasswords(v, [...at, key], out);
    }
    return out;
}

function targetOf(step) {
    const parts = [step.selector, step.labelText].map((v) => (typeof v === 'string' ? v.trim() : ''));
    return parts.some(Boolean) ? JSON.stringify([step.type, ...parts]) : null;
}

/** The one value the candidates agree on, else null. */
function agreedValue(candidates) {
    const values = new Set(candidates.map((c) => c.value));
    return values.size === 1 ? [...values][0] : null;
}

/**
 * The passwords interrupted runs need that are still typed in the editor, by
 * field key. Each field (from GET /queue/sessions/:id/masked-fields) is the
 * step that lost its value; the editor's step with the same settings fills it
 * - at the same place in the workflow first, else anywhere if they all hold
 * the same password - and failing that, the step with the same type and field
 * selector or label. A field with no single answer is left for the person.
 *
 * @param {object[]} fields
 * @param {{actions?: object[], customSteps?: object[]}|null} workflow The editor's
 *   workflow with its passwords, `<field>Masked: true` marking each.
 */
export function passwordsFromWorkflow(fields, workflow) {
    const found = {};
    if (!workflow) return found;
    const typed = typedPasswords({ actions: workflow.actions || [], customSteps: workflow.customSteps || [] });
    for (const f of fields || []) {
        const m = f.match;
        if (!m || !m.step) continue;
        const sameField = typed.filter((t) => t.field === m.field);
        const stepKey = canonical(m.step);
        const sameStep = sameField.filter((t) => canonical(t.step) === stepKey);
        const pathKey = JSON.stringify(m.path);
        const target = targetOf(m.step);
        const value = agreedValue(sameStep.filter((t) => JSON.stringify(t.path) === pathKey))
            ?? agreedValue(sameStep)
            ?? (target ? agreedValue(sameField.filter((t) => targetOf(t.step) === target)) : null);
        if (value !== null) found[f.key] = value;
    }
    return found;
}

/**
 * Asks for the hidden (masked) values a batch's interrupted runs need, one
 * field per value however many runs share it. A field with a `value` (found in
 * the editor) comes filled in. Resolves with the values by field key, or null
 * when dismissed. Nothing is kept: the dialog is removed once closed, and the
 * values go to the server for this resume only.
 */
/**
 * What a password field says of where it is asked, so a person can tell
 * which password it is: the steps it is inside and its own place ("In: Step
 * 5: Group · “Second factor” › Step 2"), the steps just before it ("After:
 * Set field value · Email = “jorge@shop.com”"), the runs it is for ("For:
 * Checkout (https://shop/…) and 2 more"), and whether the open workflow
 * filled it in. A field from an older server, with none of that, says where
 * it is as it did ("Step 2 › 1").
 */
export function valueContext(f) {
    const lines = [];
    const trail = Array.isArray(f.trail) ? f.trail : [];
    const place = [...trail, f.position].filter(Boolean);
    if (place.length) lines.push(`In: ${place.join(' › ')}`);
    else if (f.where) lines.push(`In: ${f.where}`);
    if (Array.isArray(f.before) && f.before.length) lines.push(`After: ${f.before.join(' › ')}`);
    const runs = Array.isArray(f.runs) ? f.runs : [];
    if (runs.length) {
        const named = runs.map((r) => [r.name, r.url ? `(${r.url})` : ''].filter(Boolean).join(' ') || 'a run');
        const more = (f.rows || runs.length) - runs.length;
        lines.push(`For: ${named.join(', ')}${more > 0 ? ` and ${plural(more, 'more run')}` : ''}`);
    } else if (f.rows) {
        lines.push(`Used by ${plural(f.rows, 'run')}`);
    }
    if (f.value) lines.push('Filled in from the open workflow');
    return lines;
}

export function askMaskedValuesInDialog(doc, fields, { action = 'Resume' } = {}) {
    return new Promise((resolve) => {
        const titleId = 'queue-values-title';
        const inputs = fields.map((f, i) => el(doc, 'input', {
            id: `queue-value-${i}`,
            type: 'password',
            autocomplete: 'off',
            required: true,
            'aria-describedby': `queue-value-${i}-where`,
            'data-key': f.key,
        }));
        fields.forEach((f, i) => { if (f.value) inputs[i].value = f.value; });
        const form = el(doc, 'form', { method: 'dialog', className: 'src-dialog-body queue-values-form' }, [
            el(doc, 'p', {
                className: 'src-dialog-meta',
                text: 'Passwords are not saved. They are used for these runs only and are not written anywhere.',
            }),
            ...fields.map((f, i) => el(doc, 'div', { className: 'queue-value-field' }, [
                el(doc, 'label', { for: `queue-value-${i}`, text: `${f.action} · ${f.field}${f.target ? ` (${f.target})` : ''}` }),
                inputs[i],
                el(doc, 'ul', { id: `queue-value-${i}-where`, className: 'queue-note queue-value-context' },
                    valueContext(f).map((line) => el(doc, 'li', { text: line }))),
            ])),
            el(doc, 'div', { className: 'queue-values-actions' }, [
                el(doc, 'button', { type: 'submit', value: 'resume', text: action }),
                el(doc, 'button', { type: 'button', className: 'secondary-button', 'data-dismiss': '', text: 'Cancel' }),
            ]),
        ]);
        const dialog = el(doc, 'dialog', { className: 'src-dialog queue-values-dialog', 'aria-labelledby': titleId }, [
            el(doc, 'div', { className: 'src-dialog-header' }, [
                el(doc, 'h3', { id: titleId, className: 'src-dialog-title', text: 'Type the passwords again' }),
            ]),
            form,
        ]);

        let result = null;
        form.addEventListener('submit', () => {
            result = Object.fromEntries(inputs.map((input) => [input.getAttribute('data-key'), input.value]));
        });
        form.querySelector('[data-dismiss]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => {
            for (const input of inputs) input.value = '';
            dialog.remove();
            resolve(result);
        });
        doc.body.append(dialog);
        dialog.showModal();
        (inputs.find((input) => !input.value) || inputs[0])?.focus();
    });
}

/** "Workflow 3 · date: 2026-03-01 · build: 2310" for a batch run, else null. */
export function describeRow(item) {
    const parts = [];
    if (Number.isInteger(item.row)) parts.push(`Workflow ${item.row}`);
    for (const [k, v] of Object.entries(item.vars || {})) parts.push(`${k}: ${v}`);
    if (item.imported) parts.push('Added as a report');
    return parts.length ? parts.join(' · ') : null;
}

/**
 * A re-run that ended with no result to choose, or null: the row's result
 * is the one it had, and says so. A re-run's result waiting for a choice,
 * or chosen, needs no note: the row shows it.
 */
export function describeReruns(item) {
    const last = item.lastRerun;
    if (!item.reruns || !last || last.kept || item.candidate || !item.file) return null;
    if (item.status === 'running' || item.status === 'waiting' || item.status === 'cancelling') return null;
    if (last.status === 'done') return null;
    const why = last.status === 'cancelled' ? 'was cancelled' : last.status === 'interrupted' ? 'was cut short' : `failed${last.error ? ` (${last.error})` : ''}`;
    const when = formatWhen(last.at);
    return `Run again${when ? ` ${when}` : ''} ${why}, so this is the earlier result`;
}

// The scans the report holds, and below them, when Merged scans folded some
// together, how many ran: "12" over "20 before merging". Real text, not a
// tooltip, so it is read with the number.
function scansCell(doc, item) {
    if (!Number.isFinite(item.scans)) return el(doc, 'td', { className: 'queue-num', text: '' });
    const run = Number.isFinite(item.scansRun) && item.scansRun > item.scans ? item.scansRun : null;
    // Its average pace once done (§8.3); a running run's, which changes as it
    // goes, is in the Watch dialog.
    const ran = Number.isFinite(item.scansRun) && item.scansRun > 0 ? item.scansRun : item.scans;
    const pace = item.status === 'done' && Number.isFinite(item.durationMs) && ran > 0 ? item.durationMs / ran : null;
    return el(doc, 'td', { className: 'queue-num' }, [
        String(item.scans),
        run ? el(doc, 'span', { className: 'queue-note', text: `${run} before merging` }) : null,
        pace ? el(doc, 'span', { className: 'queue-note', text: formatPace(pace) }) : null,
    ]);
}

// A running row's time, as the server last gave it: the panel counts on from
// there, so the clock keeps going while the server is too busy to answer
// (building and saving a long run's result holds it for a while). Every answer
// puts the server's figure back; a finished row shows the server's duration.
function durationCell(doc, item, duration) {
    const live = (item.status === 'running' || item.status === 'cancelling')
        && !Number.isFinite(item.durationMs) && Number.isFinite(item.elapsedMs);
    return el(doc, 'td', {
        className: 'queue-num',
        text: formatDuration(duration),
        ...(live ? { 'data-live-elapsed': String(item.elapsedMs) } : {}),
    });
}

function nameCell(doc, item, { rows = 1, versionsOpen = false } = {}) {
    const versions = (item.versions || []).length;
    return el(doc, 'th', {
        scope: 'row',
        className: rows > 1 ? 'queue-name queue-name--group' : 'queue-name',
        rowspan: rows > 1 ? String(rows) : null,
        tabindex: '-1',
        'data-focus-key': `row:${item.id}`,
    }, [
        item.name,
        item.url ? el(doc, 'span', { className: 'queue-note', text: item.url }) : null,
        describeRow(item) ? el(doc, 'span', { className: 'queue-note', text: describeRow(item) }) : null,
        describeReruns(item) ? el(doc, 'span', { className: 'queue-note', text: describeReruns(item) }) : null,
        // A row that kept more than one result: they open below it.
        versions ? el(doc, 'button', {
            type: 'button',
            className: 'link-button queue-versions-toggle',
            'aria-expanded': versionsOpen ? 'true' : 'false',
            'data-queue-action': 'versions',
            'data-item-id': item.id,
            'data-focus-key': `versions:${item.id}`,
        }, [`${versions + 1} versions`, el(doc, 'span', { className: 'visually-hidden', text: ` of ${item.name}` })]) : null,
    ]);
}

// A result of a row other than its own fields (the active one while it runs
// again, a re-run's waiting for a choice, a version), as a row the cells read.
function asRow(item, result) {
    return { ...item, ...result, phase: null, sinceProgressMs: null, elapsedMs: null };
}

// Open and Download for one of a row's results.
function resultActions(doc, item, result) {
    const cell = el(doc, 'div', { className: 'queue-actions' });
    if (!result.fileUrl) return el(doc, 'td', { className: 'queue-actions-cell' }, cell);
    const key = `${item.id}:${result.file}`;
    cell.append(iconAction(doc, 'button', 'Open', 'open', item.name, {
        type: 'button',
        'data-queue-action': 'open',
        'data-item-id': item.id,
        'data-result-file': result.file,
        'data-focus-key': `open:${key}`,
    }));
    cell.append(iconAction(doc, 'a', 'Download', 'download', item.name, {
        href: result.zipUrl || result.fileUrl,
        download: result.zipUrl ? (result.zipName || true) : (result.file || true),
        'data-focus-key': `download:${key}`,
    }));
    return el(doc, 'td', { className: 'queue-actions-cell' }, cell);
}

// A count, and under it what the active result had, coloured when it got
// better or worse ("was 4"). Lower is better for failures and higher for
// passes; fewer scans is worse.
function withWas(doc, cell, now, was, better) {
    if (!Number.isFinite(was)) return cell;
    const trend = !Number.isFinite(now) || now === was || !better ? '' : (better(now, was) ? ' queue-was--better' : ' queue-was--worse');
    cell.append(el(doc, 'span', { className: `queue-note queue-was${trend}`, text: `was ${was}` }));
    return cell;
}

function countsCells(doc, row, { was = null } = {}) {
    // No scan yet, no figures: a 0 would read as a clean page.
    const findings = row.scans > 0 ? (row.findings || {}) : {};
    const before = was && was.scans > 0 ? (was.findings || {}) : {};
    const n = (f, k) => (Number.isFinite(f[k]) ? f[k] : f[`${k}Rules`]);
    const duration = Number.isFinite(row.durationMs) ? row.durationMs : row.elapsedMs;
    return [
        was ? withWas(doc, scansCell(doc, row), row.scans, was.scans, (a, b) => a > b) : scansCell(doc, row),
        was ? withWas(doc, findingsCell(doc, row, findings, 'fail', 'queue-num queue-fail'), n(findings, 'fail'), n(before, 'fail'), (a, b) => a < b)
            : findingsCell(doc, row, findings, 'fail', 'queue-num queue-fail'),
        was ? withWas(doc, findingsCell(doc, row, findings, 'cantTell', 'queue-num queue-cantTell'), n(findings, 'cantTell'), n(before, 'cantTell'), null)
            : findingsCell(doc, row, findings, 'cantTell', 'queue-num queue-cantTell'),
        was ? withWas(doc, findingsCell(doc, row, findings, 'pass', 'queue-num queue-pass'), n(findings, 'pass'), n(before, 'pass'), (a, b) => a > b)
            : findingsCell(doc, row, findings, 'pass', 'queue-num queue-pass'),
        durationCell(doc, row, duration),
    ];
}

/**
 * After Run again: what the re-run's result is beside the active one, and
 * which one keeping is suggested ('new' when it finished all its scans,
 * else 'active'). `{ text, warn, suggest }`.
 */
export function describeChoice(active, candidate) {
    const fail = (r) => {
        const f = (r && r.findings) || {};
        return Number.isFinite(f.fail) ? f.fail : f.failRules;
    };
    const finished = candidate.status === 'done' && (candidate.scans || 0) >= (active.scans || 0);
    if (!finished) {
        return {
            warn: 'Run again did not finish:',
            text: `${plural(candidate.scans || 0, 'scan')} of ${active.scans || 0}; its counts are not comparable with the active result.`,
            suggest: 'active',
        };
    }
    const now = fail(candidate);
    const was = fail(active);
    let change = '';
    if (Number.isFinite(now) && Number.isFinite(was)) {
        change = now === was ? ', as many as the active result' : `, ${Math.abs(now - was)} ${now < was ? 'fewer' : 'more'} than the active result`;
    }
    const scans = candidate.scans === active.scans ? `same ${plural(candidate.scans || 0, 'scan')}` : `${plural(candidate.scans || 0, 'scan')}, was ${active.scans || 0}`;
    return {
        warn: null,
        text: `${Number.isFinite(now) ? `${now} failing` : 'Done'}${change}; ${scans}.`,
        suggest: 'new',
    };
}

const KEEP_CHOICES = [
    ['new', 'the new one'],
    ['active', 'the active one'],
    ['both', 'both'],
];

// The line under a re-run's result: what it is, and which to keep.
function choiceRow(doc, item, active, candidate) {
    const { warn, text, suggest } = describeChoice(active, candidate);
    const links = [el(doc, 'span', { className: 'queue-keep-ask', text: 'Keep:' })];
    KEEP_CHOICES.forEach(([keep, label], i) => {
        if (i) links.push(el(doc, 'span', { className: 'queue-keep-sep', 'aria-hidden': 'true', text: '·' }));
        links.push(el(doc, 'button', {
            type: 'button',
            className: keep === suggest ? 'link-button queue-link queue-link--suggested' : 'link-button queue-link',
            'data-queue-action': 'keep',
            'data-keep': keep,
            'data-item-id': item.id,
            'data-focus-key': `keep-${keep}:${item.id}`,
        }, [label, el(doc, 'span', { className: 'visually-hidden', text: ` for ${item.name}${keep === suggest ? ' (suggested)' : ''}` })]));
    });
    return el(doc, 'tr', { className: `queue-line queue-line--choice${warn ? ' queue-line--bad' : ''}`, 'data-line-of': item.id }, [
        el(doc, 'td', { colspan: '7' }, el(doc, 'div', { className: 'queue-choice' }, [
            el(doc, 'p', {}, [
                el(doc, warn ? 'span' : 'strong', { className: warn ? 'queue-choice-warn' : null, text: warn || 'Run again finished:' }),
                ` ${text}`,
            ]),
            el(doc, 'div', { className: 'queue-keep' }, links),
        ])),
    ]);
}

// The rows a row's versions open into: each of its results, oldest first,
// the active one marked; the others can be made active or deleted.
function versionRows(doc, item) {
    const active = { ...item, active: true };
    const all = [active, ...(item.versions || [])]
        .sort((a, b) => (Date.parse(a.finishedAt) || 0) - (Date.parse(b.finishedAt) || 0));
    return all.map((result) => {
        const row = asRow(item, result);
        const status = statusCell(doc, row, { line: result.active ? 'active' : null });
        if (!result.active) {
            status.append(el(doc, 'div', { className: 'queue-keep' }, [
                el(doc, 'button', {
                    type: 'button',
                    className: 'link-button queue-link',
                    'data-queue-action': 'activate-version',
                    'data-item-id': item.id,
                    'data-result-file': result.file,
                    'data-focus-key': `activate:${item.id}:${result.file}`,
                }, ['Make active', el(doc, 'span', { className: 'visually-hidden', text: ` the version of ${item.name} from ${formatWhen(result.finishedAt)}` })]),
                el(doc, 'span', { className: 'queue-keep-sep', 'aria-hidden': 'true', text: '·' }),
                el(doc, 'button', {
                    type: 'button',
                    className: 'link-button queue-link',
                    'data-queue-action': 'delete-version',
                    'data-item-id': item.id,
                    'data-result-file': result.file,
                    'data-focus-key': `delete-version:${item.id}:${result.file}`,
                }, ['Delete', el(doc, 'span', { className: 'visually-hidden', text: ` the version of ${item.name} from ${formatWhen(result.finishedAt)}` })]),
            ]));
        }
        return el(doc, 'tr', { className: `queue-line queue-line--version${result.active ? ' queue-line--active' : ''}`, 'data-line-of': item.id }, [
            status,
            ...countsCells(doc, row),
            resultActions(doc, item, result),
        ]);
    });
}

/**
 * A row of a batch's table, or a group of rows sharing its name cell:
 * while it runs again, the active result above the run; once the re-run
 * has a result, that result under the active one and a line to choose which
 * to keep; with its versions open, each of its results.
 */
function itemRows(doc, session, item, opts = {}) {
    const { versionsOpen = false } = opts;
    const runningAgain = item.active && ['waiting', 'running', 'cancelling'].includes(item.status);
    if (runningAgain) {
        const active = asRow(item, item.active);
        return [
            el(doc, 'tr', { className: 'queue-line queue-line--active', 'data-item-id': item.id }, [
                nameCell(doc, item, { rows: 2 }),
                statusCell(doc, active, { line: 'active' }),
                ...countsCells(doc, active),
                resultActions(doc, item, item.active),
            ]),
            el(doc, 'tr', { className: 'queue-line queue-line--rerun', 'data-line-of': item.id }, [
                statusCell(doc, item, { line: 'rerun' }),
                ...countsCells(doc, item),
                actionsCell(doc, session, item, opts),
            ]),
        ];
    }
    if (item.candidate) {
        const candidate = asRow(item, item.candidate);
        const bad = !(item.candidate.status === 'done' && (item.candidate.scans || 0) >= (item.scans || 0));
        return [
            el(doc, 'tr', { className: 'queue-line queue-line--active', 'data-item-id': item.id }, [
                nameCell(doc, item, { rows: 3 }),
                statusCell(doc, item, { line: 'active' }),
                ...countsCells(doc, item),
                resultActions(doc, item, item),
            ]),
            el(doc, 'tr', { className: `queue-line queue-line--rerun${bad ? ' queue-line--bad' : ''}`, 'data-line-of': item.id }, [
                statusCell(doc, candidate, { line: 'rerun' }),
                ...countsCells(doc, candidate, { was: item }),
                resultActions(doc, item, item.candidate),
            ]),
            choiceRow(doc, item, item, item.candidate),
        ];
    }
    const versions = versionsOpen && (item.versions || []).length ? versionRows(doc, item) : [];
    return [
        el(doc, 'tr', { 'data-item-id': item.id, className: versions.length ? 'queue-line--group' : null }, [
            nameCell(doc, item, { rows: 1 + versions.length, versionsOpen }),
            statusCell(doc, item),
            ...countsCells(doc, item),
            actionsCell(doc, session, item, opts),
        ]),
        ...versions,
    ];
}

// Why a control is unavailable, said when it is clicked (the app's disabled
// pattern: aria-disabled, still focusable, never silent).
const WAIT_FOR_BATCH = 'Available once this batch finishes: until then it would hold only the runs saved so far.';
const QUEUE_BUSY = 'Another batch is running. Resume this one once it has finished.';
const QUEUE_BUSY_CHANGE = 'Another batch is running. Change this one once it has finished.';
const DELETE_ONLY_RUN = 'This is the batch’s only run. Delete the batch instead.';
const SENDING_TO_COMPARE = 'This batch is being sent to Compare. Delete it once that is done.';

// How many of a batch's runs the app asks for at a time.
export const ITEMS_PAGE = 100;

/**
 * Below a batch's runs: that they are loading, or how many are not shown yet
 * with a button for the next page. Null when every run is shown.
 */
function itemsFooterRow(doc, session) {
    const shown = (session.items || []).length;
    const total = Number.isFinite(session.itemsTotal) ? session.itemsTotal : shown;
    if (session.itemsLoading && !shown) {
        return el(doc, 'tr', { className: 'queue-items-more' }, el(doc, 'td', { colspan: '8', text: 'Loading the runs…' }));
    }
    if (shown >= total) return null;
    const next = Math.min(ITEMS_PAGE, total - shown);
    return el(doc, 'tr', { className: 'queue-items-more' }, el(doc, 'td', { colspan: '8' }, [
        el(doc, 'span', { className: 'queue-note', text: `Showing ${formatCount(shown)} of ${formatCount(total)} runs. ` }),
        el(doc, 'button', {
            type: 'button',
            className: 'secondary-button',
            'data-queue-action': 'more',
            'data-session-id': session.id,
            'data-focus-key': `more:${session.id}`,
        }, `Show ${formatCount(next)} more`),
    ]));
}

function sessionSection(doc, session, { expanded = true, queueBusy = false, health = null, compareBlocked = null, sendingToCompare = null, openVersions = new Set() } = {}) {
    const headingId = `queue-session-${session.id}`;
    const bodyId = `queue-session-body-${session.id}`;
    const title = sessionTitle(session);

    const running = session.state === 'running';
    // Compare takes one load at a time; whatever is loading (this batch or
    // something else) holds the other batches' Send to Compare.
    const compareWhy = running ? WAIT_FOR_BATCH : compareBlocked;
    const sending = sendingToCompare === session.id;
    const actions = el(doc, 'div', { className: 'queue-session-actions' }, [
        // A partial zip is easy to take for the whole batch, so it waits.
        running ? el(doc, 'button', {
            type: 'button',
            className: 'secondary-button',
            'aria-disabled': 'true',
            'data-queue-action': 'blocked',
            'data-blocked-reason': WAIT_FOR_BATCH,
            'data-focus-key': `zip:${session.id}`,
        }, 'Download all (zip)') : el(doc, 'a', {
            className: 'secondary-button',
            href: session.zipUrl,
            download: session.zipName || `queue-${session.id}.zip`,
            'data-focus-key': `zip:${session.id}`,
        }, 'Download all (zip)'),
        running || session.hasResults || (session.items || []).some((i) => i.fileUrl) ? el(doc, 'button', {
            type: 'button',
            className: 'secondary-button',
            'aria-disabled': compareWhy ? 'true' : null,
            'data-queue-action': compareWhy ? 'blocked' : 'compare',
            'data-blocked-reason': compareWhy,
            'data-session-id': session.id,
            'data-focus-key': `compare:${session.id}`,
        }, 'Send to Compare') : null,
        session.resumable ? el(doc, 'button', {
            type: 'button',
            className: 'secondary-button',
            'aria-disabled': queueBusy ? 'true' : null,
            'data-queue-action': queueBusy ? 'blocked' : 'resume',
            'data-blocked-reason': queueBusy ? QUEUE_BUSY : null,
            'data-session-id': session.id,
            'data-focus-key': `resume:${session.id}`,
        }, 'Resume') : null,
        session.state !== 'running' ? el(doc, 'button', {
            type: 'button',
            className: 'secondary-button remove queue-delete',
            // Its results are still being read: deleting them would cut the
            // comparison short.
            'aria-disabled': sending ? 'true' : null,
            'data-queue-action': sending ? 'blocked' : 'delete',
            'data-blocked-reason': sending ? SENDING_TO_COMPARE : null,
            'data-session-id': session.id,
            'data-focus-key': `delete:${session.id}`,
        }, ['Delete', el(doc, 'span', { className: 'visually-hidden', text: ` ${describeBatch(session)}` })]) : null,
    ]);

    const table = el(doc, 'table', { className: 'queue-table' }, [
        el(doc, 'caption', { className: 'visually-hidden', text: `Runs in ${title}` }),
        // Fixed widths, so a count or a time growing as a run goes never moves
        // the columns; the name takes what is left.
        el(doc, 'colgroup', {}, ['name', 'status', 'scans', 'fail', 'canttell', 'pass', 'duration', 'actions']
            .map((c) => el(doc, 'col', { className: `queue-col-${c}` }))),
        el(doc, 'thead', {}, el(doc, 'tr', {}, [
            el(doc, 'th', { scope: 'col', text: 'Name' }),
            el(doc, 'th', { scope: 'col', text: 'Status' }),
            el(doc, 'th', { scope: 'col', className: 'queue-num', text: 'Scans' }),
            el(doc, 'th', { scope: 'col', className: 'queue-num', text: 'Failing' }),
            el(doc, 'th', { scope: 'col', className: 'queue-num', text: 'Can’t tell' }),
            el(doc, 'th', { scope: 'col', className: 'queue-num', text: 'Passing' }),
            el(doc, 'th', { scope: 'col', className: 'queue-num', text: 'Duration' }),
            el(doc, 'th', { scope: 'col', text: 'Actions' }),
        ])),
        el(doc, 'tbody', {}, [
            // Striped by run, not by table row: a run's lines share its stripe.
            ...(session.items || []).flatMap((item, i) => itemRows(doc, session, item, { queueBusy, versionsOpen: openVersions.has(item.id) })
                .map((tr) => { if (i % 2) tr.classList.add('queue-row--even'); return tr; })),
            itemsFooterRow(doc, session),
        ]),
    ]);

    return el(doc, 'section', {
        className: `queue-session queue-session--${session.state}`,
        'aria-labelledby': headingId,
        'data-session-id': session.id,
    }, [
        // A disclosure: the heading holds the button, so the batch is found by
        // heading and opened from it.
        el(doc, 'h3', { id: headingId, className: 'queue-session-title' }, el(doc, 'button', {
            type: 'button',
            className: 'legend-toggle queue-session-toggle',
            'aria-expanded': expanded ? 'true' : 'false',
            'aria-controls': bodyId,
            'data-queue-action': 'toggle',
            'data-session-id': session.id,
            'data-focus-key': `session:${session.id}`,
        }, title)),
        el(doc, 'p', { className: 'queue-session-meta' }, statusLine(doc, session)),
        !running && describeSummary(session) ? el(doc, 'p', { className: 'queue-session-summary', text: describeSummary(session) }) : null,
        running && health && describeHealth(health) ? el(doc, 'p', {
            className: health.hold ? 'queue-session-health queue-session-health--held' : 'queue-session-health',
            text: describeHealth(health),
        }) : null,
        el(doc, 'div', { id: bodyId, className: 'queue-session-body', hidden: !expanded }, [
            actions,
            el(doc, 'div', { className: 'queue-table-wrap' }, table),
        ]),
    ]);
}

/**
 * The sessions list for a GET /queue state. `isExpanded(session)` decides
 * which show their runs; by default all do.
 */
export function renderQueueSessions(doc, state, { isExpanded = () => true, compareBlocked = null, sendingToCompare = null, openVersions = new Set() } = {}) {
    const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
    if (!sessions.length) {
        return el(doc, 'p', {
            className: 'hint queue-empty',
            text: 'Nothing queued yet. Paste workflows in the Batch section of the run workflow tab, then use Run batch.',
        });
    }
    const queueBusy = sessions.some((s) => s.state === 'running');
    const frag = doc.createDocumentFragment();
    const health = { hold: state.hold || null, resources: state.resources || null };
    for (const s of sessions) frag.append(sessionSection(doc, s, { expanded: isExpanded(s), queueBusy, health, compareBlocked, sendingToCompare, openVersions }));
    return frag;
}

/** What to announce between two states: runs that have just finished. */
export function describeChanges(prev, next) {
    if (!prev) return [];
    // A batch's runs as the queue gives them in summary (the ones going and
    // the last to finish), or all of them where it gives them.
    const known = (s) => [...(s.active || []), ...(s.recent || []), ...(s.items || [])];
    const before = new Map();
    for (const s of prev.sessions || []) for (const i of known(s)) if (!before.has(i.id)) before.set(i.id, i.status);
    const out = [];
    const said = new Set();
    for (const s of next.sessions || []) {
        for (const i of known(s)) {
            if (said.has(i.id)) continue;
            said.add(i.id);
            const was = before.get(i.id);
            if (was && was !== i.status && TERMINAL.has(i.status) && i.status !== 'interrupted') {
                out.push(`${i.name}: ${(STATUS_LABELS[i.status] || i.status).toLowerCase()}`);
            }
        }
    }
    // The governor holding the next run, or letting it start: a batch that
    // ends drops its hold, which is no news.
    const running = (next.sessions || []).some((s) => s.state === 'running');
    if (!prev.hold && next.hold) out.push('Holding the next run while server memory is high');
    else if (prev.hold && !next.hold && running) out.push('Server memory is back down: the next run can start');
    return out;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.listEl            Where the sessions render.
 * @param {HTMLSelectElement} opts.concurrencySelect
 * @param {HTMLButtonElement} opts.cancelAllButton
 * @param {HTMLElement} opts.statusEl          role="status" line.
 * @param {(item, session) => void} opts.onOpen
 * @param {(item, session) => void} opts.onLoadWorkflow
 * @param {(session) => void} opts.onSendToCompare
 * @param {(item, session) => void} opts.onWatch  Shows a running run live, in a dialog.
 * @param {(isRunning: boolean) => void} opts.onRunningChange  A batch started or stopped running.
 * @param {(message: string) => boolean} [opts.confirmDelete] Asks before deleting.
 * @param {(fields: object[]) => Promise<Record<string,string>|null>} [opts.askMaskedValues]
 *   Asks for the hidden values interrupted runs need; null when dismissed.
 * @param {() => ({actions: object[], customSteps: object[]}|null)} [opts.getFormWorkflow]
 *   The editor's workflow with its passwords, for Resume to reuse them.
 * @param {HTMLInputElement} [opts.notifyToggle] "Notify me when a batch finishes":
 *   shown only where the browser can notify; the choice is kept in this browser.
 * @param {object} [opts.notifications] The browser's Notification, for tests.
 * @param {object} [opts.activity] The activity panel (activity.js): Delete and
 *   Resume show there as they go.
 */
export function createRunQueuePanel({
    listEl,
    concurrencySelect,
    cancelAllButton,
    statusEl,
    onOpen = () => {},
    onLoadWorkflow = () => {},
    onSendToCompare = () => {},
    onWatch = () => {},
    onRunningChange = () => {},
    confirmDelete = (message) => window.confirm(message),
    askMaskedValues = null,
    getFormWorkflow = () => null,
    activity = null,
    fetchImpl = (...args) => fetch(...args),
    notifyToggle = null,
    notifications = (typeof Notification === 'function' ? Notification : null),
    storage = (() => { try { return window.localStorage; } catch { return null; } })(),
    pollMs = 1500,
    // While a batch runs and the tab is not shown: enough to keep its spinner
    // honest without polling at the visible rate.
    hiddenPollMs = 5000,
    // With no batch known to run, while the page is on screen: a batch started
    // from another tab, browser or the API shows up within this long.
    idlePollMs = 30000,
} = {}) {
    if (!listEl) throw new Error('createRunQueuePanel: listEl is required');
    const doc = listEl.ownerDocument;

    let state = null;
    let lastJson = '';
    // Batches showing their runs. A running one opens by itself and stays open
    // once it finishes, so a batch being watched does not snap shut; earlier
    // ones stay collapsed until asked for. Kept for this page only.
    const expanded = new Set();
    const collapsedByUser = new Set();
    // Rows whose versions are open, by id.
    const openVersions = new Set();
    let visible = false;
    let wasRunning = false;
    let timer = null;
    let ticker = null;
    // When the rows on screen were built: a running row's time counts on from
    // it. A monotonic clock, so a change to the computer's clock moves nothing.
    let renderedAt = 0;
    // The last poll failed (server stopped or restarting): the clock stops
    // rather than count for a run nobody can vouch for.
    let unreachable = false;
    let inFlight = null;
    // The controls whose action is under way, by data-focus-key: marked busy
    // again after each re-render, which would otherwise drop the mark.
    const busyKeys = new Set();
    // Why Send to Compare is held (Compare is loading something), and the
    // batch being sent, whose Delete waits for it.
    let compareBlocked = null;
    let sendingToCompare = null;
    // The page's own title: a running batch puts its progress in front of it,
    // for whoever is in another tab (§8.2).
    const baseTitle = doc.title;
    let finishedUnseen = false;
    let runningSessionId = null;

    // Same tones as the app's other status lines: .status.ok / .status.error.
    function setStatus(text, tone = '') {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = tone ? `status ${tone}` : 'status';
    }

    function hasRunning() {
        return !!state && state.sessions.some((s) => s.state === 'running');
    }

    function render() {
        const focusKey = doc.activeElement && listEl.contains(doc.activeElement)
            ? doc.activeElement.getAttribute('data-focus-key')
            : null;

        for (const s of state.sessions) {
            if (s.state === 'running' && !collapsedByUser.has(s.id)) expanded.add(s.id);
        }
        const view = keepView();
        listEl.replaceChildren(renderQueueSessions(doc, state, {
            isExpanded: (s) => expanded.has(s.id),
            compareBlocked,
            sendingToCompare,
            openVersions,
        }));
        view.restore();

        if (concurrencySelect) {
            const max = state.maxConcurrency || 8;
            // First, the default: as many as the batch has, up to the maximum;
            // while a batch runs, how many that is for it.
            const live = state.sessions && state.sessions.some((s) => s.state === 'running');
            const autoText = state.concurrencyChosen === false && live
                ? `Automatic (${state.concurrency})`
                : `Automatic (up to ${max})`;
            if (concurrencySelect.options.length !== max + 1) {
                concurrencySelect.replaceChildren(
                    el(doc, 'option', { value: 'auto', text: autoText }),
                    ...Array.from({ length: max }, (_, i) => el(doc, 'option', { value: String(i + 1), text: String(i + 1) }))
                );
            } else if (concurrencySelect.options[0].textContent !== autoText) {
                concurrencySelect.options[0].textContent = autoText;
            }
            if (doc.activeElement !== concurrencySelect) {
                concurrencySelect.value = state.concurrencyChosen === false ? 'auto' : String(state.concurrency);
            }
        }
        if (cancelAllButton) {
            cancelAllButton.setAttribute('aria-disabled', hasRunning() ? 'false' : 'true');
        }

        markBusy();
        if (focusKey) restoreFocus(focusKey, { stay: true });
    }

    /**
     * What the reader is looking at before a re-render: the first row or
     * heading on screen and where it sits, and how far each batch's table is
     * scrolled sideways. `restore()` puts them back, so a poll never moves
     * the page under someone reading it (the old nodes are gone, so the
     * browser's own scroll anchoring cannot do it).
     */
    function keepView() {
        const win = doc.defaultView;
        let anchor = null;
        for (const node of listEl.querySelectorAll('[data-focus-key]')) {
            const rect = node.getBoundingClientRect();
            if (rect.height && rect.bottom > 0) {
                anchor = { key: node.getAttribute('data-focus-key'), top: rect.top };
                break;
            }
        }
        const sideways = new Map();
        for (const wrap of listEl.querySelectorAll('.queue-table-wrap')) {
            const id = wrap.closest('[data-session-id]')?.getAttribute('data-session-id');
            if (id && wrap.scrollLeft) sideways.set(id, wrap.scrollLeft);
        }
        return {
            restore() {
                for (const [id, left] of sideways) {
                    const wrap = listEl.querySelector(`[data-session-id="${CSS.escape(id)}"] .queue-table-wrap`);
                    if (wrap) wrap.scrollLeft = left;
                }
                if (!anchor || !win?.scrollBy) return;
                const node = listEl.querySelector(`[data-focus-key="${CSS.escape(anchor.key)}"]`);
                const moved = node ? node.getBoundingClientRect().top - anchor.top : 0;
                if (moved) win.scrollBy(0, moved);
            },
        };
    }

    function markBusy() {
        listEl.querySelectorAll('[data-queue-action][data-focus-key]').forEach((control) => {
            setBusy(control, busyKeys.has(control.getAttribute('data-focus-key')));
        });
    }

    /**
     * Shows `control` busy until `pending` settles, so a slow action (opening
     * a large result, reading a batch for Compare) is seen to be under way and
     * cannot be started twice. `busyText`, put in the status line by the
     * caller before starting, is cleared after unless the action said
     * something else.
     */
    function trackBusy(control, pending, busyText) {
        const key = control.getAttribute('data-focus-key');
        if (!key) return;
        busyKeys.add(key);
        markBusy();
        Promise.resolve(pending).catch(() => {}).finally(() => {
            busyKeys.delete(key);
            markBusy();
            if (busyText && statusEl && statusEl.textContent === busyText) setStatus('');
        });
    }

    // The same control if it is still there; otherwise its run's row, or its
    // session's heading, so focus never falls back to the top of the page.
    // With `stay`, the page does not scroll to the control or its row: the
    // reader may have scrolled away from it since, and a poll must not pull
    // the page back. Focus that has to move further is still scrolled to.
    function restoreFocus(focusKey, { stay = false } = {}) {
        const [kind, id] = focusKey.split(/:(.*)/s);
        const candidates = [focusKey, `row:${id}`, `session:${id}`];
        for (const [i, key] of candidates.entries()) {
            const target = listEl.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
            if (target) {
                target.focus({ preventScroll: stay && i < 2 });
                return;
            }
        }
        // The batch it belonged to is gone (deleted): the first batch's toggle.
        if (kind) listEl.querySelector('.queue-session-toggle')?.focus();
    }

    const clock = () => (globalThis.performance?.now ? performance.now() : Date.now());

    function tick() {
        const since = clock() - renderedAt;
        for (const cell of listEl.querySelectorAll('[data-live-elapsed]')) {
            const text = formatDuration(Number(cell.getAttribute('data-live-elapsed')) + since);
            if (cell.textContent !== text) cell.textContent = text;
        }
    }

    function schedule() {
        clearTimeout(timer);
        timer = null;
        if (hasRunning() && visible && !unreachable) {
            if (!ticker) {
                // Finer than a second, so rounding never skips one.
                ticker = setInterval(tick, 250);
                ticker?.unref?.();
            }
        } else if (ticker) {
            clearInterval(ticker);
            ticker = null;
        }
        if (hasRunning()) {
            timer = setTimeout(refresh, visible ? pollMs : hiddenPollMs);
        } else if (!doc.hidden) {
            timer = setTimeout(refresh, idlePollMs);
        }
        // Under Node (tests) a pending poll must not keep the process alive;
        // a browser's timer id has no unref.
        timer?.unref?.();
    }

    // Back on the page: whatever happened meanwhile, at once. A page not on
    // screen does no idle polling (schedule), so this is how it catches up.
    doc.addEventListener('visibilitychange', () => {
        if (!doc.hidden) refresh();
    });

    // A batch's runs, as far as they have been read: GET /queue gives each
    // batch in summary, and an open batch's runs come from its itemsUrl a
    // page at a time. session id -> { items, total, limit, key, loading }
    const pages = new Map();

    /** Reads the runs of an open batch, as many as it shows, when they may have changed. */
    // A batch's runs changed without its counts moving (a result kept, a
    // version made active or deleted): read them again on the next refresh.
    function rowsChanged(sessionId) {
        const page = pages.get(sessionId);
        if (page) page.key = null;
    }

    async function loadItems(session, { force = false } = {}) {
        // A batch the server gave with its runs (or without an itemsUrl) has none to read.
        if (!session || !session.itemsUrl || (Array.isArray(session.items) && !session.itemsPaged)) return;
        const page = pages.get(session.id) || { items: [], total: session.counts?.total || 0, limit: ITEMS_PAGE, key: null };
        // A finished batch's runs no longer change: read again only when
        // asked for more, or when its counts moved (a resume).
        const key = JSON.stringify(session.counts || {});
        if (!force && session.state !== 'running' && page.key === key) return;
        page.loading = true;
        pages.set(session.id, page);
        try {
            const res = await fetchImpl(`${session.itemsUrl}?offset=0&limit=${page.limit}`, { method: 'GET' });
            if (!res.ok) throw new Error(`The server answered ${res.status}`);
            const body = await res.json();
            page.items = Array.isArray(body.items) ? body.items : [];
            page.total = Number.isFinite(body.total) ? body.total : page.items.length;
            page.key = key;
        } finally {
            page.loading = false;
        }
    }

    /** The queue as the server gave it, each open batch with the runs read so far. */
    function withPages(queueState) {
        for (const s of queueState.sessions || []) {
            if (Array.isArray(s.items) && !s.itemsPaged) continue;
            s.itemsPaged = true;
            const page = pages.get(s.id);
            s.items = page ? page.items : [];
            s.itemsTotal = page ? page.total : (s.counts?.total || 0);
            s.itemsLoading = expanded.has(s.id) && (!page || page.loading || page.key === null);
        }
        for (const id of pages.keys()) {
            if (!(queueState.sessions || []).some((s) => s.id === id)) pages.delete(id);
        }
        return queueState;
    }

    async function refresh() {
        if (inFlight) return inFlight;
        inFlight = (async () => {
            try {
                const res = await fetchImpl('/queue', { method: 'GET' });
                if (!res.ok) throw new Error(`The server answered ${res.status}`);
                const next = await res.json();
                for (const s of next.sessions || []) {
                    if (s.state === 'running' && !collapsedByUser.has(s.id)) expanded.add(s.id);
                }
                await Promise.all((next.sessions || [])
                    .filter((s) => expanded.has(s.id))
                    .map((s) => loadItems(s).catch(() => {})));
                withPages(next);
                const changes = describeChanges(state, next);
                const json = JSON.stringify(next);
                state = next;
                unreachable = false;
                if (json !== lastJson) {
                    lastJson = json;
                    render();
                    renderedAt = clock();
                }
                if (changes.length) setStatus(changes.join('. ') + '.');
                const running = hasRunning();
                if (running !== wasRunning) {
                    wasRunning = running;
                    if (!running) batchFinished();
                    onRunningChange(running);
                }
                runningSessionId = state.sessions.find((s) => s.state === 'running')?.id || runningSessionId;
                updateTitle();
            } catch (err) {
                unreachable = true;
                setStatus(`Could not read the queue: ${err && err.message ? err.message : err}`, 'error');
            } finally {
                inFlight = null;
                schedule();
            }
        })();
        return inFlight;
    }

    async function post(url, body) {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `The server answered ${res.status}`);
        return data;
    }

    function findItem(itemId) {
        for (const session of state?.sessions || []) {
            const item = [...(session.items || []), ...(session.active || [])].find((i) => i.id === itemId);
            if (item) return { session, item };
        }
        return {};
    }

    // An action that can take a while, in the activity panel when there is
    // one; the status line says how it ended, so the card stays quiet. An
    // error is shown by act() and ends the task failed.
    async function asTask(title, work) {
        if (!activity) return work(null);
        const task = activity.start(title, { quiet: true });
        try {
            return await work(task);
        } catch (err) {
            if (!task.ended) task.fail(err);
            throw err;
        } finally {
            if (!task.ended) task.done();
        }
    }

    async function act(fn, okText) {
        try {
            await fn();
            if (okText) setStatus(okText);
        } catch (err) {
            setStatus(err && err.message ? err.message : String(err), 'error');
        }
        await refresh();
    }

    /**
     * The hidden values `fieldsUrl` lists, always asked for: a run with a
     * password does not start without the person confirming it. Those still
     * typed in the editor the batch was started from come filled in, and the
     * dialog says so. { values }, or null when dismissed; {} when none is
     * needed.
     */
    async function gatherValues(fieldsUrl, task, { action = 'Resume' } = {}) {
        task?.step('Finding the passwords its runs need');
        const res = await fetchImpl(fieldsUrl, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `The server answered ${res.status}`);
        if (!data.fields?.length) return {};
        const known = passwordsFromWorkflow(data.fields, getFormWorkflow());
        task?.step('Waiting for the passwords');
        // The dialog's button says what pressing it does: Resume, Run again.
        const ask = askMaskedValues || ((fields) => askMaskedValuesInDialog(doc, fields, { action }));
        const values = await ask(data.fields.map((f) => (known[f.key] ? { ...f, value: known[f.key] } : f)));
        return values ? { values } : null;
    }

    listEl.addEventListener('click', (event) => {
        const button = event.target.closest('[data-queue-action]');
        if (!button || !listEl.contains(button)) return;
        // Already under way: the spinner says so.
        if (button.dataset.busy === 'true') return;
        const action = button.getAttribute('data-queue-action');
        const sessionId = button.getAttribute('data-session-id');
        const itemId = button.getAttribute('data-item-id');
        const track = (pending, busyText) => trackBusy(button, pending, busyText);

        if (action === 'open' || action === 'load' || action === 'watch') {
            const found = findItem(itemId);
            const { session } = found;
            let { item } = found;
            if (!item) return;
            // One of its other results: the active one while it runs again,
            // a re-run's waiting for a choice, a version.
            const file = button.getAttribute('data-result-file');
            if (file && file !== item.file) {
                const result = [item.active, item.candidate, ...(item.versions || [])].find((r) => r && r.file === file);
                if (!result) return;
                item = { ...item, ...result };
            }
            const busyText = {
                open: `Opening “${item.name}”…`,
                load: `Loading the workflow of “${item.name}”…`,
                watch: null,
            }[action];
            if (busyText) setStatus(busyText, 'busy');
            track(({ open: onOpen, load: onLoadWorkflow, watch: onWatch })[action](item, session), busyText);
        } else if (action === 'more') {
            const session = state?.sessions.find((s) => s.id === sessionId);
            const page = pages.get(sessionId);
            if (!session || !page) return;
            page.limit += ITEMS_PAGE;
            setStatus('Loading more runs…', 'busy');
            track(loadItems(session, { force: true }).then(() => {
                withPages(state);
                lastJson = JSON.stringify(state);
                render();
                setStatus(`Showing ${formatCount(page.items.length)} of ${formatCount(page.total)} runs.`);
            }), null);
        } else if (action === 'blocked') {
            setStatus(button.getAttribute('data-blocked-reason') || 'Not available right now.', 'error');
        } else if (action === 'toggle') {
            if (expanded.has(sessionId)) {
                expanded.delete(sessionId);
                collapsedByUser.add(sessionId);
            } else {
                expanded.add(sessionId);
                collapsedByUser.delete(sessionId);
                // Its runs are read now it is open, and shown once read.
                const session = state?.sessions.find((s) => s.id === sessionId);
                if (session && session.itemsUrl && !pages.get(sessionId)?.key) {
                    withPages(state);
                    loadItems(session, { force: true }).catch(() => {}).then(() => {
                        if (!state) return;
                        withPages(state);
                        lastJson = JSON.stringify(state);
                        render();
                    });
                }
            }
            render();
            // Some browsers (Safari) do not focus a clicked button; the
            // re-render would then drop focus to the page.
            restoreFocus(`session:${sessionId}`);
        } else if (action === 'delete') {
            const session = state?.sessions.find((s) => s.id === sessionId);
            if (!session) return;
            const count = session.counts?.total || session.items.length;
            const ok = confirmDelete(
                `Delete ${describeBatch(session)}? `
                + `Its ${plural(count, 'saved result')} and batch.json are removed from the server. This cannot be undone.`
            );
            if (!ok) return;
            track(act(() => asTask(`Delete ${describeBatch(session)}`, async (task) => {
                task?.step('Removing its files from the server');
                await post(`/queue/sessions/${encodeURIComponent(sessionId)}/delete`);
                expanded.delete(sessionId);
                const said = `Deleted ${describeBatch(session)}.`;
                setStatus(said);
                task?.done(said);
            })));
        } else if (action === 'compare') {
            const session = state?.sessions.find((s) => s.id === sessionId);
            if (session) {
                const busyText = 'Reading the batch’s results for Compare…';
                setStatus(busyText, 'busy');
                sendingToCompare = sessionId;
                render();
                track(Promise.resolve(onSendToCompare(session)).finally(() => {
                    sendingToCompare = null;
                    if (state) render();
                }), busyText);
            }
        } else if (action === 'cancel') {
            track(act(() => post(`/queue/items/${encodeURIComponent(itemId)}/cancel`), 'Cancel requested.'));
        } else if (action === 'resume') {
            const session = state?.sessions.find((s) => s.id === sessionId);
            track(act(() => asTask(`Resume ${session ? describeBatch(session) : 'the batch'}`, async (task) => {
                let values;
                if (session?.needsValues) {
                    const got = await gatherValues(`/queue/sessions/${encodeURIComponent(sessionId)}/masked-fields`, task);
                    if (!got) {
                        setStatus('Not resumed.');
                        task?.cancel();
                        restoreFocus(`resume:${sessionId}`);
                        return;
                    }
                    ({ values } = got);
                }
                task?.step('Queuing its runs again');
                const r = await post(`/queue/sessions/${encodeURIComponent(sessionId)}/resume`, values ? { values } : {});
                const said = `Resumed ${plural(r.resumed, 'run')}.`
                    + (r.stillWaiting ? ` ${plural(r.stillWaiting, 'run')} still need their passwords.` : '');
                setStatus(said);
                if (r.stillWaiting) task?.warn(said);
                else task?.done(said);
            })));
        } else if (action === 'rerun') {
            const { session, item } = findItem(itemId);
            if (!session || !item) return;
            track(act(() => asTask(`Run “${item.name}” again`, async (task) => {
                let values;
                if (item.needsValues) {
                    const got = await gatherValues(`/queue/sessions/${encodeURIComponent(session.id)}/masked-fields?item=${encodeURIComponent(item.id)}`, task, { action: 'Run again' });
                    if (!got) {
                        setStatus('Not run again.');
                        task?.cancel();
                        restoreFocus(`rerun:${item.id}`);
                        return;
                    }
                    values = got.values;
                }
                task?.step('Queuing it');
                await post(`/queue/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(item.id)}/rerun`, values ? { values } : {});
                const said = `Running “${item.name}” again. Its result waits beside the active one until you choose which to keep; if it ends with none, the active one stays.`;
                setStatus(said);
                task?.done(said);
            })));
        } else if (action === 'versions') {
            if (openVersions.has(itemId)) openVersions.delete(itemId);
            else openVersions.add(itemId);
            render();
            restoreFocus(`versions:${itemId}`);
        } else if (action === 'keep') {
            const { session, item } = findItem(itemId);
            if (!session || !item) return;
            const keep = button.getAttribute('data-keep');
            const said = {
                new: `“${item.name}” keeps the new result.`,
                active: `“${item.name}” keeps its active result; the new one is deleted.`,
                both: `“${item.name}” keeps both results: the active one, and the new one as a version.`,
            }[keep];
            if (!said) return;
            track(act(() => asTask(`Keep ${keep === 'both' ? 'both results' : `the ${keep} result`} of “${item.name}”`, async (task) => {
                task?.step(keep === 'both' ? 'Keeping both' : 'Removing the other one from the server');
                await post(`/queue/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(item.id)}/keep`, { keep });
                rowsChanged(session.id);
                if (keep === 'both') openVersions.add(item.id);
                setStatus(said);
                task?.done(said);
            })).then(() => restoreFocus(keep === 'both' ? `versions:${item.id}` : `row:${item.id}`)));
        } else if (action === 'activate-version' || action === 'delete-version') {
            const { session, item } = findItem(itemId);
            const file = button.getAttribute('data-result-file');
            const version = item && (item.versions || []).find((v) => v.file === file);
            if (!session || !version) return;
            const when = formatWhen(version.finishedAt);
            if (action === 'activate-version') {
                track(act(() => asTask(`Make the version of “${item.name}” from ${when} active`, async (task) => {
                    task?.step('Making it active');
                    await post(`/queue/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(item.id)}/versions/activate`, { file });
                    rowsChanged(session.id);
                    const said = `“${item.name}” now uses its version from ${when}.`;
                    setStatus(said);
                    task?.done(said);
                })).then(() => restoreFocus(`versions:${item.id}`)));
                return;
            }
            const ok = confirmDelete(
                `Delete the version of “${item.name}” from ${when}? `
                + 'Its result, and the pictures and evidence only it used, are removed from the server. This cannot be undone.'
            );
            if (!ok) return;
            track(act(() => asTask(`Delete the version of “${item.name}” from ${when}`, async (task) => {
                task?.step('Removing its files from the server');
                await post(`/queue/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(item.id)}/versions/delete`, { file });
                rowsChanged(session.id);
                const left = (item.versions || []).length - 1;
                if (!left) openVersions.delete(item.id);
                const said = `Deleted the version of “${item.name}” from ${when}.`;
                setStatus(said);
                task?.done(said);
            })).then(() => restoreFocus(left ? `versions:${item.id}` : `row:${item.id}`)));
        } else if (action === 'delete-item') {
            const { session, item } = findItem(itemId);
            if (!session || !item) return;
            const versions = (item.versions || []).length;
            const ok = confirmDelete(
                `Delete “${item.name}”${versions ? ` and its ${plural(versions + 1, 'version')}` : ''} from ${describeBatch(session)}? `
                + `${versions ? 'Their results' : 'Its result'}, and the pictures and evidence only ${versions ? 'they' : 'it'} used, are removed from the server. This cannot be undone.`
            );
            if (!ok) return;
            // Focus goes where the row was: the next row's Delete, else the
            // one before, else the batch.
            const rows = session.items || [];
            const at = rows.findIndex((i) => i.id === item.id);
            const next = rows[at + 1] || rows[at - 1] || null;
            track(act(() => asTask(`Delete “${item.name}”`, async (task) => {
                task?.step('Removing its files from the server');
                await post(`/queue/sessions/${encodeURIComponent(session.id)}/items/${encodeURIComponent(item.id)}/delete`);
                const said = `Deleted “${item.name}” from ${describeBatch(session)}.`;
                setStatus(said);
                task?.done(said);
                restoreFocus(next ? `delete-item:${next.id}` : `session:${session.id}`);
            })));
        }
    });

    /* ---------- while you are elsewhere (§8.2) ---------- */

    /** "(3/7) " in front of the title while a batch runs; "Batch finished · " until it is seen. */
    function updateTitle() {
        const live = state?.sessions.find((s) => s.state === 'running');
        let title = baseTitle;
        if (live) {
            const c = live.counts || {};
            const finished = (c.done || 0) + (c.error || 0) + (c.cancelled || 0);
            title = `(${finished}/${c.total || 0}) ${baseTitle}`;
        } else if (finishedUnseen) {
            title = `Batch finished · ${baseTitle}`;
        }
        if (doc.title !== title) doc.title = title;
    }

    function notifyChosen() {
        try {
            return storage?.getItem(NOTIFY_STORAGE_KEY) === 'on';
        } catch {
            return false;
        }
    }

    function batchFinished() {
        const session = state.sessions.find((s) => s.id === runningSessionId) || null;
        runningSessionId = null;
        // Seen already if the queue tab is on screen.
        finishedUnseen = !(visible && !doc.hidden);
        if (!doc.hidden || !notifyChosen() || !notifications || notifications.permission !== 'granted') return;
        try {
            const name = session && session.name ? session.name : '';
            const body = session
                ? [describeSession(session), describeSummary(session)].filter(Boolean).join('. ')
                : 'The batch has finished.';
            // eslint-disable-next-line no-new
            new notifications('Batch finished', { body: name ? `${name}: ${body}` : body, tag: 'a11y-queue-batch' });
        } catch {
            // A browser that refuses after all: the title still says so.
        }
    }

    if (notifyToggle) {
        const label = notifyToggle.closest('label') || notifyToggle;
        label.hidden = !notifications;
        notifyToggle.checked = !!notifications && notifyChosen() && notifications.permission === 'granted';
        notifyToggle.addEventListener('change', async () => {
            const store = (on) => {
                try {
                    storage?.setItem(NOTIFY_STORAGE_KEY, on ? 'on' : 'off');
                } catch {
                }
            };
            if (!notifyToggle.checked) {
                store(false);
                setStatus('No notification when a batch finishes.');
                return;
            }
            let permission = notifications.permission;
            if (permission === 'default') {
                try {
                    permission = await notifications.requestPermission();
                } catch {
                    permission = 'denied';
                }
            }
            if (permission !== 'granted') {
                notifyToggle.checked = false;
                store(false);
                setStatus('The browser does not allow notifications for this page. You can allow them in its site settings.', 'error');
                return;
            }
            store(true);
            setStatus('You will be notified when a batch finishes while this page is not on screen.', 'ok');
        });
    }

    /** How many runs are going right now, in the running batch. */
    function runningNow() {
        const live = state?.sessions.find((s) => s.state === 'running');
        if (!live) return 0;
        const going = Array.isArray(live.active) ? live.active : (live.items || []);
        return going.filter((i) => i.status === 'running' || i.status === 'cancelling').length;
    }

    concurrencySelect?.addEventListener('change', () => {
        if (concurrencySelect.value === 'auto') {
            const max = (state && state.maxConcurrency) || 8;
            act(() => post('/queue/settings', { concurrency: 'auto' }),
                `As many at the same time as a batch has workflows, up to ${max}. Runs already going are not stopped.`);
            return;
        }
        const value = Number(concurrencySelect.value);
        const running = runningNow();
        // Lowering it never stops a run already going: say what happens instead.
        const message = running > value
            ? `Up to ${plural(value, 'run')} at the same time. The ${running} running now will finish first; `
                + `new workflows start once fewer than ${value} are running.`
            : `Up to ${plural(value, 'run')} at the same time.`;
        act(() => post('/queue/settings', { concurrency: value }), message);
    });

    cancelAllButton?.addEventListener('click', () => {
        if (cancelAllButton.getAttribute('aria-disabled') === 'true') return;
        act(async () => {
            const r = await post('/queue/cancel');
            setStatus(r.cancelled ? `Cancelling ${plural(r.cancelled, 'run')}.` : 'Nothing to cancel.');
        });
    });

    return {
        refresh,
        /**
         * Holds every batch's Send to Compare, saying `reason` when pressed,
         * while Compare loads something; null lets them go again.
         */
        setCompareBlocked(reason) {
            if ((reason || null) === compareBlocked) return;
            compareBlocked = reason || null;
            if (state) render();
        },
        /** Polls at the visible rate while shown; slower while hidden and a batch runs. */
        setVisible(isVisible) {
            visible = !!isVisible;
            if (visible && finishedUnseen) {
                finishedUnseen = false;
                updateTitle();
            }
            if (visible) refresh();
            else schedule();
        },
        /**
         * Queues `[{ run, config }]` under the batch's `name` and shows the
         * result. `config` is the batch's own, Batch section and all, which
         * the server keeps beside its results.
         */
        async add(items, { name = '', config = null } = {}) {
            const r = await post('/queue/items', config ? { items, name, config } : { items, name });
            await refresh();
            return r;
        },
        getState: () => state,
        setStatus,
        /** Focuses a control by its data-focus-key, or its row if it is gone (after a dialog closes). */
        focusControl(focusKey) {
            if (focusKey) restoreFocus(focusKey);
        },
    };
}
