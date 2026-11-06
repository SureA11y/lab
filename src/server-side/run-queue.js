'use strict';

/**
 * The run queue (docs/design/workflow-queue-batch-design.md): workflows added from
 * the app wait their turn, run up to `concurrency` at a time through the same
 * `executeWorkflowRun` the Run button uses, and each one's result is written
 * to the session folder the moment it finishes.
 *
 * Memory stays flat however long the queue: a running item holds its spec, two
 * counters and a progress log for watching it (every line, but only the latest
 * screenshots - see progress-log.js), dropped a minute after it finishes; the
 * finished payload is written and dropped; what stays is the summary the
 * panel and `batch.json` show.
 *
 * A session starts when the queue goes from idle to busy and ends when it is
 * idle again; everything that runs in between shares one folder. A new batch
 * is refused while one runs, so a folder is always one batch. Sessions left
 * unfinished by a restart are marked `interrupted` on startup and resumed only
 * when asked, never automatically.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const files = require('./queue-files');
const { createProgressLog } = require('./progress-log');
const { normalizeVars } = require('../shared/run-spec.js');
const { upgradeRunSpec } = require('../shared/config-upgrade.js');
const { writeJsonFile } = require('./json-file-writer.js');
const { ACTION_DEFINITIONS } = require('../workflow/action-definitions');
const { SPOOL_PREFIX, createScanSpool, spoolDirFor } = require('./scan-spool');
const { createQueueGovernor } = require('./queue-governor');
const { createRunActivity } = require('./run-activity');
const { createBatchImages, packResultImages, imagePathsInFile, IMAGES_DIR } = require('./batch-package');
const { isConfig } = require('../shared/batch-config.js');

const DEFAULT_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

/**
 * How many runs of a batch of `count` go at once until someone sets it: as
 * many as it has, up to `max` - one run at a time left most of a machine
 * idle. The memory governor still holds a start when the heap is high.
 */
function automaticConcurrency(count, max = MAX_CONCURRENCY) {
    const n = Number.isInteger(count) && count > 0 ? count : DEFAULT_CONCURRENCY;
    return Math.min(n, max);
}
const KEEP_SESSIONS = 100;
const RECENT_SESSIONS = 10;
// How long a finished run's progress log stays readable, so someone watching
// it gets the last lines before it is dropped.
const WATCH_GRACE_MS = 60 * 1000;
const METRICS_INTERVAL_MS = 5000;

const UNFINISHED = new Set(['waiting', 'running', 'cancelling']);
const TERMINAL = new Set(['done', 'cancelled', 'error']);

// The fields executeWorkflowRun reads, out of the request the app sends.
// A run's Include and Exclude selectors are its scans' by then (upgradeRunSpec).
const RUN_FIELDS = [
    'url', 'actions', 'customSteps', 'viewport', 'colorScheme', 'highContrast', 'language',
    'acceptUntrustedCerts', 'scenarioName', 'vars'
];

function queueError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The run fields of a spec, in the current format: a run kept in batch.json
 * before the format changed resumes as the same run.
 */
function runSpecFrom(saved) {
    const spec = {};
    if (!isPlainObject(saved)) return spec;
    const raw = upgradeRunSpec(saved).spec;
    for (const key of RUN_FIELDS) {
        if (raw[key] !== undefined) spec[key] = raw[key];
    }
    return spec;
}

/**
 * Whether a saved spec had values the user masked. The app removes those
 * before saving and leaves `<field>Masked: true` in their place, so a run
 * resumed from the saved spec would type an empty string.
 */
function hasMaskedValues(value) {
    if (Array.isArray(value)) return value.some(hasMaskedValues);
    if (!isPlainObject(value)) return false;
    return Object.entries(value).some(([key, v]) => (
        (key.length > 6 && key.endsWith('Masked') && v === true) || hasMaskedValues(v)
    ));
}

const MASKED_SUFFIX = 'Masked';
// The runs a password field names, past which it says how many more.
const MASKED_RUNS_SHOWN = 3;

function maskedFieldsOf(node) {
    return Object.keys(node)
        .filter((k) => k.length > MASKED_SUFFIX.length && k.endsWith(MASKED_SUFFIX) && node[k] === true)
        .map((k) => k.slice(0, -MASKED_SUFFIX.length));
}

/**
 * Every masked value a saved spec lost, wherever it sits (steps, nested
 * steps, custom steps): `{ path, field, node }`, `path` leading to `node`.
 */
function findMaskedSlots(value, pathSoFar = [], out = []) {
    if (Array.isArray(value)) {
        value.forEach((v, i) => findMaskedSlots(v, [...pathSoFar, i], out));
    } else if (isPlainObject(value)) {
        for (const field of maskedFieldsOf(value)) out.push({ path: pathSoFar, field, node: value });
        for (const [k, v] of Object.entries(value)) findMaskedSlots(v, [...pathSoFar, k], out);
    }
    return out;
}

/**
 * One id for "the same masked field" across a batch's rows: same place in the
 * workflow, same step settings. Rows share their workflow, so the person types
 * each value once.
 */
function maskedSlotKey({ path: at, field, node }) {
    const { [field]: _value, ...rest } = node; // eslint-disable-line no-unused-vars
    return crypto.createHash('sha1').update(JSON.stringify([at, field, rest])).digest('hex').slice(0, 16);
}

// What a step says of itself, for a person picking a password out: its
// type's name (or its own title), its label, what it acts on, and the value
// it types ("Set field value · Email = “jorge@shop.com”", "Navigate to URL ·
// https://shop/login"). A value saved hidden is never shown: "= (hidden)".
const STEP_TARGET_FIELDS = ['labelText', 'selector', 'url', 'urlIncludes', 'selectorExists', 'targetSelector', 'itemsText', 'urlPart'];

function clip(text, max = 60) {
    const one = String(text).replace(/\s+/g, ' ').trim();
    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function stepSummary(node) {
    if (!isPlainObject(node)) return 'Step';
    const type = node.type === 'setValue' && node.valueMasked === true ? 'setPassword' : node.type;
    const def = ACTION_DEFINITIONS[type];
    const shown = (f) => typeof node[f] === 'string' && node[f].trim() !== '' && node[`${f}Masked`] !== true;
    const parts = [typeof node.alias === 'string' && node.alias.trim() ? node.alias.trim() : (def?.label || type || 'Step')];
    if (shown('label')) parts.push(`“${clip(node.label, 40)}”`);
    const target = STEP_TARGET_FIELDS.find(shown);
    if (target) parts.push(clip(node[target]));
    let text = parts.join(' · ');
    const valueField = ['value', 'text'].find((f) => node[`${f}Masked`] === true || shown(f));
    if (valueField) text += node[`${valueField}Masked`] === true ? ' = (hidden)' : ` = “${clip(node[valueField], 40)}”`;
    return text;
}

/**
 * Where a hidden value sits, for a person to tell which password it is: the
 * steps it is inside (`trail`, outermost first: "Custom step “Login”",
 * "Step 3: Group · “Sign in”"), its own place ("Step 2"), and up to two steps
 * just before it (`before`, nearest last), such as the one typing the user
 * name.
 */
function slotContext(spec, at) {
    const trail = [];
    let cursor = spec;
    let parent = null;
    let index = null;
    for (let i = 0; i < at.length; i += 1) {
        const key = at[i];
        if (Array.isArray(cursor) && typeof key === 'number') {
            parent = cursor;
            index = key;
        }
        const next = cursor?.[key];
        // A step the value is inside, not the step itself.
        const inside = isPlainObject(next) && typeof next.type === 'string' && i < at.length - 1
            && at.slice(i + 1).some((k) => typeof k === 'number');
        if (i === 1 && at[0] === 'customSteps' && isPlainObject(next)) {
            trail.push(`Custom step “${typeof next.name === 'string' && next.name ? next.name : Number(key) + 1}”`);
        } else if (inside) {
            trail.push(`Step ${Number(key) + 1}: ${stepSummary(next)}`);
        }
        cursor = next;
    }
    const before = parent && Number.isInteger(index)
        ? parent.slice(Math.max(0, index - 2), index).filter(isPlainObject).map(stepSummary)
        : [];
    return { trail, position: Number.isInteger(index) ? `Step ${index + 1}` : null, before };
}

/**
 * What the person is asked for: "Set password value · Password", "#password",
 * "Step 3 › 2", and where it sits (slotContext). `match` says which step it
 * is, so the app can fill it from a password still typed in its editor.
 */
function describeMaskedSlot(spec, { path: at, field, node }) {
    // A setValue step saved hidden, before setPassword existed, is one now.
    const type = node.type === 'setValue' ? 'setPassword' : node.type;
    const def = ACTION_DEFINITIONS[type];
    const { [field]: _value, ...step } = node; // eslint-disable-line no-unused-vars
    const steps = [];
    let where = '';
    let cursor = spec;
    for (let i = 0; i < at.length; i += 1) {
        const key = at[i];
        if (i === 1 && at[0] === 'customSteps') {
            const name = cursor?.[key]?.name;
            where = `Custom step “${typeof name === 'string' && name ? name : Number(key) + 1}”`;
        } else if (typeof key === 'number' && i > 0) {
            steps.push(key + 1);
        }
        cursor = cursor?.[key];
    }
    const target = [node.selector, node.labelText].find((v) => typeof v === 'string' && v.trim());
    return {
        action: def?.label || type || 'Step',
        field: def?.fields?.[field]?.alias || field,
        target: target ? target.trim() : null,
        where: [where, steps.length ? `Step ${steps.join(' › ')}` : ''].filter(Boolean).join(' · '),
        ...slotContext(spec, at),
        match: { path: at, field, step: { ...step, type } },
    };
}

/** A copy of a saved spec with its masked values typed back in, the flags kept. */
function fillMaskedValues(spec, values) {
    const filled = structuredClone(spec);
    // Keys first: filling one field of a step changes the others' keys.
    const slots = findMaskedSlots(filled).map((slot) => ({ slot, value: values[maskedSlotKey(slot)] }));
    if (slots.some(({ value }) => typeof value !== 'string' || value === '')) return null;
    for (const { slot, value } of slots) slot.node[slot.field] = value;
    return filled;
}

/**
 * Removes every value flagged `<field>Masked: true`, keeping the flag - the
 * server side of the app's redactMaskedFieldsDeep. The queue writes results to
 * disk under reports/, which is served, so a run's actions are redacted before
 * its payload is saved; the run itself had the real values.
 */
function redactMaskedFields(value) {
    if (Array.isArray(value)) return value.map(redactMaskedFields);
    if (!isPlainObject(value)) return value;
    const masked = new Set(
        Object.keys(value)
            .filter((k) => k.length > 6 && k.endsWith('Masked') && value[k] === true)
            .map((k) => k.slice(0, -6))
    );
    const out = {};
    for (const [key, v] of Object.entries(value)) {
        if (masked.has(key)) continue;
        out[key] = redactMaskedFields(v);
    }
    return out;
}

/**
 * What the panel and the manifest show of a finished run's payload: its
 * findings by outcome, one per rule per scan, added up from each scan's
 * summary as the live totals are. payload.findings is no use for this: it
 * merges a rule's findings across scans, so a rule failing on 200 scans
 * counts once there.
 * Elements are not counted: pass findings mostly do not list theirs.
 */
function summarizePayload(payload) {
    const scans = Array.isArray(payload?.scans) ? payload.scans : [];
    const findings = { fail: 0, cantTell: 0, pass: 0 };
    // Every scan that ran: a merged scan's contexts beyond its first are
    // scans the report holds as one.
    let scansRun = scans.length;
    for (const scan of scans) {
        const counts = summaryCounts(scan?.summary);
        findings.fail += counts.fail;
        findings.cantTell += counts.cantTell;
        findings.pass += counts.pass;
        if (scan && scan.mergedScan === true && Array.isArray(scan.contexts)) {
            scansRun += Math.max(0, scan.contexts.filter((c) => c && !c.skipped).length - 1);
        }
    }
    return { scans: scans.length, scansRun, findings };
}

/** A batch's scenario name, or null; batches saved before it had none. */
function batchName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function itemName(spec, position) {
    const scenario = typeof spec.scenarioName === 'string' ? spec.scenarioName.trim() : '';
    if (scenario) return scenario;
    try {
        const u = new URL(spec.url);
        return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
        return `Run ${position}`;
    }
}

function isScanReady(entry) {
    return !!entry && entry.type === 'scan' && entry.message === 'a11yScan ready';
}

/** A Merged scan step's scans, counted as each finished, have become one. */
/** A run about to build its result from its scans (workflow-run.js). */
function isResultBuild(entry) {
    return !!entry && entry.extra && entry.extra.stepEvent === 'result-build';
}

// How many of a run's latest scans its pace is the median gap of.
const PACE_SCANS = 10;

const labelOfAction = (type) => (ACTION_DEFINITIONS[type] && ACTION_DEFINITIONS[type].label) || type;

function median(values) {
    if (!values.length) return null;
    const v = [...values].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function isScanMerge(entry) {
    return !!entry && entry.type === 'scan' && entry.message === 'a11yScan merged';
}

/** A scan's findings by outcome, from its summary (failCount and the rest). */
function summaryCounts(s) {
    if (!s || typeof s !== 'object') return { fail: 0, cantTell: 0, pass: 0 };
    const n = (v) => (Number.isFinite(v) ? v : 0);
    return {
        fail: n(s.failCount),
        cantTell: n(s.reviewCount),
        pass: n(s.passesCount),
    };
}

/** A finished scan's findings by outcome, from its progress entry. */
function scanCounts(entry) {
    return summaryCounts(entry && entry.extra && entry.extra.summary);
}

/**
 * @param {object} opts
 * @param {string} opts.baseDir        Folder that holds one subfolder per session.
 * @param {string} [opts.reportsRoot]  Where runs keep their evidence and saved
 *                                     screenshots; removed with their session.
 * @param {Function} opts.executeRun   (spec, hooks) => { status, payload, error }
 * @param {Function} [opts.validateUrl] Throws on a URL the server will not open.
 * @param {Function} [opts.checkRun] `(spec) -> [problem]`: why a run cannot work as
 *   asked, as /workflow-start refuses one; none when it can.
 * @param {object} [opts.resourceSampler] `{ sample(), host() }` (resource-sampler.js):
 *                                     sampled every few seconds while a batch runs,
 *                                     for the governor and metrics.jsonl.
 * @param {boolean} [opts.writeMetrics] Whether a session writes metrics.jsonl.
 * @param {object} [opts.governor]     queue-governor.js: holds the next run
 *                                     while the server's memory is high.
 */
function createRunQueue({
    baseDir,
    reportsRoot = null,
    executeRun,
    validateUrl = () => {},
    checkRun = () => [],
    now = Date.now,
    keepSessions = KEEP_SESSIONS,
    maxConcurrency = MAX_CONCURRENCY,
    resourceSampler = null,
    writeMetrics = true,
    metricsIntervalMs = METRICS_INTERVAL_MS,
    governor = createQueueGovernor({ now }),
    logError = (msg, err) => console.error(`[run-queue] ${msg}`, err && err.message ? err.message : err),
} = {}) {
    if (!baseDir) throw new Error('createRunQueue: baseDir is required');
    if (typeof executeRun !== 'function') throw new Error('createRunQueue: executeRun is required');

    let concurrency = DEFAULT_CONCURRENCY;
    // Whether someone set the concurrency (setConcurrency). Until then each
    // batch takes automaticConcurrency of its own number of runs.
    let concurrencyChosen = false;
    let session = null;
    const running = new Map(); // item id -> { abortController, cancelled }
    // Items whose progress can be watched: running, or finished less than
    // WATCH_GRACE_MS ago. Outlives the session, which closes with its last run.
    const watchable = new Map(); // item id -> item

    const iso = () => new Date(now()).toISOString();

    /* ---------- manifest ---------- */

    function manifestItem(item) {
        return {
            id: item.id,
            name: item.name,
            url: item.url,
            status: item.status,
            addedAt: item.addedAt,
            startedAt: item.startedAt,
            finishedAt: item.finishedAt,
            durationMs: item.durationMs,
            scans: item.scans,
            scansRun: item.scansRun ?? null,
            findings: item.findings,
            file: item.file,
            error: item.error,
            needsValues: item.needsValues,
            row: item.row,
            vars: item.vars,
            config: item.config,
            // Its own folders under the reports root (evidence, saved
            // screenshots), removed with the batch: its result no longer
            // links to them once its pictures are in images/.
            runFolders: item.runFolders || null,
            // Run again: how often, and how its last re-run ended. While one
            // runs, the result it replaces, which stays if it fails.
            reruns: item.reruns || 0,
            lastRerun: item.lastRerun || null,
            previous: item.previous || null,
            // A report added to the batch as it was, not run here.
            imported: item.imported || null,
        };
    }

    // What a re-run keeps of the result it replaces, to put back if it fails.
    const RESULT_FIELDS = ['status', 'startedAt', 'finishedAt', 'durationMs', 'scans', 'scansRun', 'findings', 'file', 'error'];

    function resultOf(item) {
        const out = {};
        for (const k of RESULT_FIELDS) out[k] = item[k] ?? null;
        return out;
    }

    function persist() {
        if (!session) return;
        try {
            files.writeManifest(session.dir, {
                type: files.MANIFEST_TYPE,
                version: files.MANIFEST_VERSION,
                id: session.id,
                name: session.name,
                startedAt: session.startedAt,
                finishedAt: session.finishedAt,
                // While a row runs again: the batch's own finish, put back
                // when it ends, or by init if a restart cuts it short.
                ...(session.keepFinishedAt ? { keepFinishedAt: session.keepFinishedAt } : {}),
                concurrency,
                stats: session.stats || null,
                // The batch's configuration, as "Save configuration" writes
                // one, beside the results (§6).
                configFile: session.configFile || null,
                items: session.items.map(manifestItem),
            });
        } catch (err) {
            logError(`could not write ${files.MANIFEST_NAME} for ${session.id}`, err);
        }
    }

    /* ---------- metrics ---------- */

    /**
     * The session's metrics.jsonl (§5.1): what the server and browser used
     * every few seconds, and when each run started, scanned and ended, so a
     * batch can be read back to see where it slowed down. Appended, so a
     * resumed session carries on in the same file. A failed write is logged
     * once and the log stops; the batch never waits on it.
     *
     * The same samples go to the governor (§5.2), log or no log: when it
     * holds the next run, or lets it start again, the log says so.
     */
    function openMetrics(s) {
        if (!resourceSampler) return;
        const file = path.join(s.dir, files.METRICS_NAME);
        let pending = Promise.resolve();
        let broken = !writeMetrics;
        let closed = false;
        let sampling = false;
        const write = (record) => {
            if (broken || closed) return;
            const line = JSON.stringify({ t: iso(), ...record }) + '\n';
            pending = pending.then(() => fs.promises.appendFile(file, line)).catch((err) => {
                if (!broken) logError(`could not write ${files.METRICS_NAME} for ${s.id}`, err);
                broken = true;
            });
        };
        const tick = async () => {
            if (sampling) return;
            sampling = true;
            try {
                const resources = await resourceSampler.sample();
                if (closed) return;
                const runs = s.items
                    .filter((i) => running.has(i.id))
                    .map((i) => ({ item: i.id, scansRun: i.scansRun || 0 }));
                write({
                    kind: 'sample',
                    concurrency,
                    running: running.size,
                    waiting: s.items.filter((i) => i.status === 'waiting').length,
                    runs,
                    ...resources,
                });
                recordPeak(s, resources);
                const change = governor.observe(resources);
                if (change === 'hold') s.stats.holds += 1;
                if (change) {
                    const { hold } = governor.view();
                    write({ kind: change, heapPct: resources.heapPct, running: running.size, ...(hold ? { holdAtPct: hold.holdAtPct, resumeBelowPct: hold.resumeBelowPct } : {}) });
                    if (change === 'resume') pump();
                }
            } catch (err) {
                logError('could not sample resources', err);
            } finally {
                sampling = false;
            }
        };
        let host = null;
        try { host = typeof resourceSampler.host === 'function' ? resourceSampler.host() : null; } catch {}
        write({ kind: 'session', session: s.id, concurrency, maxConcurrency, host });
        const timer = setInterval(tick, metricsIntervalMs);
        if (typeof timer.unref === 'function') timer.unref();
        s.metrics = {
            write,
            close: () => {
                clearInterval(timer);
                write({ kind: 'session-end' });
                // A sample still being taken is not written after it.
                closed = true;
                governor.reset();
                return pending;
            },
        };
    }

    /** The batch's server memory peak, for its summary (§8.3). */
    function recordPeak(s, resources) {
        if (!s.stats) s.stats = { peakHeapPct: null, peakHeapMb: null, heapLimitMb: null, holds: 0 };
        const pct = resources && resources.heapPct;
        if (!Number.isFinite(pct) || (s.stats.peakHeapPct !== null && pct <= s.stats.peakHeapPct)) return;
        s.stats.peakHeapPct = pct;
        s.stats.peakHeapMb = Number.isFinite(resources.heapUsedMb) ? resources.heapUsedMb : null;
        s.stats.heapLimitMb = Number.isFinite(resources.heapLimitMb) ? resources.heapLimitMb : null;
    }

    function metric(record) {
        if (session && session.metrics) session.metrics.write(record);
    }

    /* ---------- sessions ---------- */

    /**
     * The batch's configuration, workflow and Batch section with every row,
     * saved beside its results as "<name>.a11y-config.json" so loading it in
     * the run workflow tab sets the batch up again. Masked values were left
     * out by the app.
     */
    function writeConfig(s, config) {
        if (!isConfig(config)) return;
        const fileName = `${files.fileStem(s.name || 'batch')}${files.CONFIG_SUFFIX}`;
        try {
            files.writeJsonAtomic(path.join(s.dir, fileName), redactMaskedFields(config));
            s.configFile = fileName;
        } catch (err) {
            logError(`could not write the configuration of ${s.id}`, err);
        }
    }

    function openSession({ name = null, config = null } = {}) {
        if (session) return;
        const id = files.createSessionDir(baseDir, now());
        session = {
            id,
            name,
            dir: path.join(baseDir, id),
            startedAt: iso(),
            finishedAt: null,
            items: [],
            takenFiles: new Set(),
            stats: { peakHeapPct: null, peakHeapMb: null, heapLimitMb: null, holds: 0 },
        };
        writeConfig(session, config);
        // Written first so the new session counts among the ones kept.
        persist();
        openMetrics(session);
        try {
            files.pruneSessions(baseDir, keepSessions, [id], reportsRoot);
        } catch (err) {
            logError('could not remove old sessions', err);
        }
    }

    function closeSession() {
        session.finishedAt = session.keepFinishedAt || iso();
        session.keepFinishedAt = null;
        persist();
        if (session.metrics) session.metrics.close();
        session = null;
    }

    /* ---------- running ---------- */

    function pump() {
        if (!session) return;
        // The governor may hold the next run while memory is high; it starts
        // from the sampling tick once memory is back down (§5.2).
        while (running.size < concurrency && governor.allowsStart(running.size)) {
            const next = session.items.find((i) => i.status === 'waiting');
            if (!next) break;
            start(next);
        }
        if (running.size === 0 && !session.items.some((i) => UNFINISHED.has(i.status))) {
            closeSession();
        }
    }

    function start(item) {
        const ctl = { abortController: new AbortController(), cancelled: false };
        running.set(item.id, ctl);
        item.status = 'running';
        item.startedAt = iso();
        item.scansDone = 0;
        item.scansRun = 0;
        item.mergedSeen = new Set();
        item.liveFail = 0;
        item.liveCantTell = 0;
        item.livePass = 0;
        item.sessionId = session.id;
        item.log = createProgressLog();
        item.activity = createRunActivity({ labelOf: labelOfAction });
        item.phase = 'running';
        item.lastProgressMs = null;
        item.lastScanAtMs = null;
        item.scanGaps = [];
        watchable.set(item.id, item);
        persist();
        metric({ kind: 'run-start', item: item.id, name: item.name, running: running.size });

        const owner = session;
        const startedMs = now();
        item.lastScanMs = startedMs;
        runItem(item, ctl, owner)
            .catch((err) => {
                item.status = 'error';
                item.error = err && err.message ? err.message : String(err);
            })
            .finally(() => {
                // A failed re-run put back the times of the result it kept.
                if (item.restored) delete item.restored;
                else {
                    item.finishedAt = iso();
                    item.durationMs = now() - startedMs;
                }
                running.delete(item.id);
                item.activity = null;
                item.scanGaps = null;
                if (owner.metrics) {
                    owner.metrics.write({
                        kind: 'run-end', item: item.id, status: item.status,
                        durationMs: item.durationMs, scansRun: item.scansRun ?? null, running: running.size,
                    });
                }
                const dropLog = setTimeout(() => {
                    item.log = null;
                    watchable.delete(item.id);
                }, WATCH_GRACE_MS);
                if (typeof dropLog.unref === 'function') dropLog.unref();
                persist();
                pump();
            });
    }

    /**
     * Runs an item and saves its result. Its scans' page screenshots wait in
     * a spool folder rather than in memory until then (scan-spool.js).
     */
    async function runItem(item, ctl, owner) {
        const spool = createScanSpool(spoolDirFor(owner.dir, item.id));
        try {
            await runAndSave(item, ctl, owner, spool);
        } finally {
            await spool.remove().catch((err) => logError(`could not remove ${spool.dir}`, err));
        }
    }

    async function runAndSave(item, ctl, owner, spool) {
        let result;
        try {
            result = await executeRun(item.spec, {
                progress: (entry) => {
                    if (isScanReady(entry)) {
                        // A Merged scan counts once, from its first context;
                        // scansRun counts every scan.
                        const key = entry.extra && entry.extra.mergedScanKey;
                        item.scansRun += 1;
                        if (!key || !item.mergedSeen.has(key)) item.scansDone += 1;
                        if (key) item.mergedSeen.add(key);
                        const counts = scanCounts(entry);
                        item.liveFail += counts.fail;
                        item.liveCantTell += counts.cantTell;
                        item.livePass += counts.pass;
                        const at = now();
                        const gap = at - item.lastScanMs;
                        const scanMs = entry.extra && entry.extra.meta && entry.extra.meta.durationMs;
                        if (owner.metrics) {
                            owner.metrics.write({
                                kind: 'scan',
                                item: item.id,
                                scan: item.scansRun,
                                // The scan itself, then the time since the run's
                                // last scan: its steps, waits and navigation too.
                                scanMs: Number.isFinite(scanMs) ? scanMs : null,
                                sinceLastMs: gap,
                                running: running.size,
                            });
                        }
                        item.lastScanMs = at;
                        item.lastScanAtMs = at;
                        item.scanGaps.push(gap);
                        if (item.scanGaps.length > PACE_SCANS) item.scanGaps.shift();
                    } else if (isScanMerge(entry)) {
                        // Swap the scans it was made from for the one scan,
                        // so the counts stay where the saved result has them.
                        const contexts = Array.isArray(entry.extra && entry.extra.contexts) ? entry.extra.contexts : [];
                        for (const c of contexts) {
                            const counts = summaryCounts(c && c.summary);
                            item.liveFail -= counts.fail;
                            item.liveCantTell -= counts.cantTell;
                            item.livePass -= counts.pass;
                        }
                        const merged = summaryCounts(entry.extra && entry.extra.summary);
                        item.liveFail += merged.fail;
                        item.liveCantTell += merged.cantTell;
                        item.livePass += merged.pass;
                        // Counted once from its first context already; an
                        // older runner, with no key, counted each context.
                        const key = entry.extra && entry.extra.key;
                        if (!key || !item.mergedSeen.has(key)) {
                            item.scansDone = Math.max(0, item.scansDone - contexts.length + 1);
                        }
                    }
                    if (isResultBuild(entry)) item.phase = 'saving';
                    if (item.activity) item.activity.push(entry);
                    item.lastProgressMs = now();
                    if (item.log) item.log.push(entry);
                },
                isCancelled: () => ctl.cancelled,
                abortSignal: ctl.abortController.signal,
                spool,
            });
        } catch (err) {
            result = { status: 'error', payload: null, error: { details: err && err.message ? err.message : String(err) } };
        }
        item.spec = null;
        // The result is built; what is left is writing it.
        item.phase = 'saving';

        const status = TERMINAL.has(result?.status) ? result.status : 'error';
        const payload = result?.payload || null;

        if (!payload) {
            const failed = ctl.cancelled ? 'cancelled' : 'error';
            const error = ctl.cancelled ? null : (result?.error?.details || 'Workflow failed before producing any result');
            if (item.previous) {
                // A re-run with nothing to show: the result it was to
                // replace stays, and the row says the re-run did not finish.
                keepPrevious(item, failed, error);
                return;
            }
            item.status = failed;
            if (error) item.error = error;
            return;
        }

        if (Array.isArray(payload.actions)) payload.actions = redactMaskedFields(payload.actions);
        // A batch row's values travel with its result, so the file says which
        // version it covered and not only when it ran.
        if (item.vars && Object.keys(item.vars).length) payload.vars = item.vars;
        // The configuration it ran, so the report can set it up again
        // (docs/report-package.md).
        if (isConfig(item.config)) payload.config = redactMaskedFields(item.config);

        const fileName = files.uniqueResultFileName(item.name, owner.takenFiles);
        const target = path.join(owner.dir, fileName);
        const tmp = path.join(owner.dir, `.${fileName}.${process.pid}.tmp`);
        try {
            // Its pictures into the batch's images/ folder, which the result
            // names them by: the batch is a report package (batch-package.js).
            if (!owner.images) owner.images = createBatchImages(owner.dir);
            const packed = await packResultImages(payload, owner.images, { reportsRoot });
            // A re-run's folders join those of the result it replaces: they all
        // go with the batch.
        item.runFolders = [...new Set([...(item.runFolders || []), ...packed.runFolders])].sort();
            if (packed.missing.length) {
                logError(`${packed.missing.length} picture(s) of ${item.name} could not be added to the batch`, new Error(packed.missing[0].error));
            }
            await writeJsonFile(tmp, payload);
            await fs.promises.rename(tmp, target);
        } catch (err) {
            await fs.promises.rm(tmp, { force: true }).catch(() => {});
            const error = `Could not save the result: ${err && err.message ? err.message : err}`;
            if (item.previous) {
                keepPrevious(item, 'error', error);
                return;
            }
            item.status = 'error';
            item.error = error;
            return;
        }

        if (item.previous) {
            // The re-run's result replaces the one it was run again for.
            const old = item.previous.file;
            if (old && old !== fileName) {
                await fs.promises.rm(path.join(owner.dir, old), { force: true }).catch((err) => logError(`could not remove ${old}`, err));
                owner.takenFiles.delete(old);
            }
            item.previous = null;
        }
        if (item.reruns) item.lastRerun = { at: iso(), status, error: null };

        const summary = summarizePayload(payload);
        item.file = fileName;
        item.scans = summary.scans;
        item.scansRun = summary.scansRun;
        item.findings = summary.findings;
        if (status === 'error') {
            item.error = payload.errorDetails?.message || 'Workflow failed';
        }
        item.status = status;
    }

    // A re-run that ended without a result: the one it was to replace is
    // put back, and the row says how the re-run went.
    function keepPrevious(item, status, error) {
        const startedAt = item.startedAt;
        Object.assign(item, item.previous);
        item.previous = null;
        item.restored = true;
        item.lastRerun = { at: iso(), startedAt, status, error: error || null };
    }

    /* ---------- public ---------- */

    /** Spool folders a run left behind when the server stopped mid-run. */
    function removeSpools(dir) {
        let names = [];
        try {
            names = fs.readdirSync(dir).filter((n) => n.startsWith(SPOOL_PREFIX));
        } catch {
            return;
        }
        for (const name of names) {
            try {
                fs.rmSync(path.join(dir, name), { recursive: true, force: true });
            } catch (err) {
                logError(`could not remove ${name} in ${dir}`, err);
            }
        }
    }

    /**
     * Marks items a previous process left unfinished as interrupted, and
     * removes the spool folders their runs left.
     */
    function init() {
        fs.mkdirSync(baseDir, { recursive: true });
        const recovered = [];
        for (const id of files.listSessionIds(baseDir)) {
            const dir = files.sessionDirFor(baseDir, id);
            const manifest = files.readManifest(dir);
            if (!manifest) continue;
            removeSpools(dir);
            const stranded = manifest.items.filter((i) => UNFINISHED.has(i.status));
            if (!stranded.length) continue;
            for (const item of stranded) {
                if (item.previous) {
                    // A re-run cut short: the result it was replacing stands.
                    Object.assign(item, item.previous);
                    item.previous = null;
                    item.lastRerun = { at: iso(), status: 'interrupted', error: null };
                } else {
                    item.status = 'interrupted';
                }
            }
            manifest.interruptedAt = iso();
            // A batch whose row was running again finished before: it keeps
            // that finish, and so the time it took.
            if (typeof manifest.keepFinishedAt === 'string') {
                manifest.finishedAt = manifest.keepFinishedAt;
                delete manifest.keepFinishedAt;
            }
            try {
                files.writeManifest(dir, manifest);
                recovered.push(id);
            } catch (err) {
                logError(`could not mark ${id} as interrupted`, err);
            }
        }
        return recovered;
    }

    /**
     * Queues `[{ run, config, row? }]`: `run` is the request /workflow-start
     * takes (with a batch row's `vars`), `config` the saved-config form of the
     * same workflow (masked values removed), kept in the manifest so the run
     * can be resumed or reloaded, and `row` the batch row it came from.
     * `name` is the form's scenario name, which the batch is shown under
     * (each row's own name replaces it in that row's run).
     * Every item is checked before any is queued.
     */
    function prepareItems(rawItems) {
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
            throw queueError(400, 'No workflows to queue');
        }
        return rawItems.map((raw, index) => {
            const spec = runSpecFrom(raw && raw.run);
            const where = rawItems.length > 1 ? `Item ${index + 1}: ` : '';
            if (!Array.isArray(spec.actions) || spec.actions.length === 0) {
                throw queueError(400, `${where}No actions to run`);
            }
            try {
                validateUrl(spec.url);
            } catch (err) {
                throw queueError(400, `${where}${err && err.message ? err.message : 'Invalid url'}`);
            }
            const varErrors = [];
            const vars = normalizeVars(spec.vars, varErrors);
            if (varErrors.length) throw queueError(400, `${where}${varErrors[0]}`);
            const problems = checkRun(spec) || [];
            if (problems.length) {
                throw queueError(400, `${where}The workflow cannot run: ${problems.length === 1 ? problems[0] : `${problems.length} problems: ${problems.join('; ')}`}`);
            }
            if (Object.keys(vars).length) spec.vars = vars;
            else delete spec.vars;
            const row = Number.isInteger(raw.row) && raw.row > 0 ? raw.row : null;
            return { spec, row, config: isPlainObject(raw.config) ? raw.config : null };
        });
    }

    // A new row of the session, waiting to run.
    function newItem({ spec, row, config }, position) {
        return {
            id: crypto.randomUUID(),
            name: itemName(spec, position),
            url: typeof spec.url === 'string' ? spec.url : null,
            status: 'waiting',
            addedAt: iso(),
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            scans: null,
            scansRun: null,
            findings: null,
            file: null,
            error: null,
            needsValues: hasMaskedValues(config && config.runSpec),
            row,
            vars: spec.vars || null,
            config,
            spec,
            scansDone: 0,
        };
    }

    function addItems(rawItems, { name = null, config = null } = {}) {
        const prepared = prepareItems(rawItems);

        // One batch at a time: rows added to a running batch would share its
        // folder, its record and its Send to Compare with another batch's.
        if (session) {
            throw queueError(409, 'A batch is already running. Wait for it to finish, or cancel it, before running another.');
        }
        if (!concurrencyChosen) concurrency = automaticConcurrency(prepared.length, maxConcurrency);
        openSession({ name: batchName(name), config });

        const ids = prepared.map((p) => {
            const item = newItem(p, session.items.length + 1);
            session.items.push(item);
            return item.id;
        });

        const sessionId = session.id;
        persist();
        pump();
        return { sessionId, itemIds: ids };
    }

    function setConcurrency(value) {
        // 'auto': back to each batch's own number of runs, up to the maximum.
        if (value === 'auto') {
            concurrencyChosen = false;
            if (session) {
                const left = session.items.filter((i) => i.status === 'waiting' || running.has(i.id)).length;
                concurrency = automaticConcurrency(left, maxConcurrency);
            }
            persist();
            metric({ kind: 'concurrency', concurrency });
            pump();
            return concurrency;
        }
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > maxConcurrency) {
            throw queueError(400, `Runs at the same time must be a whole number from 1 to ${maxConcurrency}`);
        }
        concurrency = n;
        concurrencyChosen = true;
        persist();
        metric({ kind: 'concurrency', concurrency });
        pump();
        return concurrency;
    }

    function cancelItem(itemId) {
        const item = session && session.items.find((i) => i.id === itemId);
        if (!item) throw queueError(404, 'No such item in the running queue');

        if (item.status === 'waiting') {
            item.status = 'cancelled';
            item.finishedAt = iso();
            persist();
            pump();
        } else if (item.status === 'running') {
            const ctl = running.get(item.id);
            if (ctl) {
                ctl.cancelled = true;
                try { ctl.abortController.abort(); } catch {}
            }
            item.status = 'cancelling';
            persist();
        }
        return item.status;
    }

    function cancelAll() {
        if (!session) return 0;
        // Every waiting item is marked before anything can start the next one.
        let count = 0;
        for (const item of session.items) {
            if (item.status === 'waiting') {
                item.status = 'cancelled';
                item.finishedAt = iso();
                count += 1;
            }
        }
        for (const item of session.items) {
            if (item.status === 'running') {
                cancelItem(item.id);
                count += 1;
            }
        }
        persist();
        pump();
        return count;
    }

    /**
     * Re-queues an interrupted session's unfinished items into its own folder.
     * Items whose workflow had masked values stay interrupted: their values
     * were never saved, so the workflow has to be loaded and filled in again.
     */
    function readSessionManifest(id) {
        const dir = files.sessionDirFor(baseDir, id);
        const manifest = dir ? files.readManifest(dir) : null;
        if (!manifest) throw queueError(404, 'No such session');
        return { dir, manifest };
    }

    function waitsForValues(m) {
        return m.status === 'interrupted' && !!m.needsValues && !!(m.config && m.config.runSpec);
    }

    /**
     * The masked values a session's interrupted rows need before they can
     * resume, each listed once however many rows share it.
     */
    function getMaskedFields(id, { itemId = null } = {}) {
        const { manifest } = readSessionManifest(id);
        const byKey = new Map();
        // One row to run again, or the interrupted rows to resume.
        const rows = itemId
            ? manifest.items.filter((m) => m.id === itemId && m.needsValues && m.config && m.config.runSpec)
            : manifest.items.filter(waitsForValues);
        for (const m of rows) {
            const spec = runSpecFrom(m.config.runSpec);
            for (const slot of findMaskedSlots(spec)) {
                const key = maskedSlotKey(slot);
                const seen = byKey.get(key) || byKey.set(key, { key, ...describeMaskedSlot(spec, slot), rows: 0, runs: [] }).get(key);
                seen.rows += 1;
                // The runs it is for, by name and page: the first few.
                if (seen.runs.length < MASKED_RUNS_SHOWN) seen.runs.push({ name: m.name || null, url: m.url || null });
            }
        }
        return { fields: [...byKey.values()] };
    }

    /**
     * @param {string} id
     * @param {{ values?: Record<string, string> }} [opts] Masked values by
     *   field key (getMaskedFields). They go into the specs held in memory
     *   for this run only; batch.json keeps the redacted workflow.
     */
    function resumeSession(id, { values = null } = {}) {
        if (session) throw queueError(409, 'The queue is busy. Resume this session once it has finished.');
        const { dir, manifest } = readSessionManifest(id);
        const typed = isPlainObject(values) ? values : null;

        const items = itemsFromManifest(manifest);

        let resumed = 0;
        for (const item of items) {
            if (item.status !== 'interrupted') continue;
            if (item.needsValues && !typed) continue;
            let spec = runSpecFrom(item.config && item.config.runSpec);
            if (!Array.isArray(spec.actions) || spec.actions.length === 0) continue;
            if (item.needsValues) {
                spec = fillMaskedValues(spec, typed);
                if (!spec) continue; // a value missing: the row stays interrupted
            }
            try {
                validateUrl(spec.url);
            } catch {
                continue;
            }
            Object.assign(item, {
                status: 'waiting', startedAt: null, finishedAt: null, durationMs: null, error: null, spec,
            });
            resumed += 1;
        }
        const stillWaiting = items.filter((i) => i.status === 'interrupted' && i.needsValues).length;
        if (!resumed) {
            throw queueError(400, typed && stillWaiting
                ? 'Type every hidden value to resume these runs.'
                : 'Nothing in this session can be resumed on its own');
        }
        if (!concurrencyChosen) concurrency = automaticConcurrency(resumed, maxConcurrency);

        reopen(id, dir, manifest, items);
        return { sessionId: id, resumed, stillWaiting };
    }

    // A finished session's rows, as the queue holds them while it runs.
    function itemsFromManifest(manifest) {
        return manifest.items.map((m) => ({
            id: m.id,
            name: m.name,
            url: m.url,
            status: m.status,
            addedAt: m.addedAt,
            startedAt: m.startedAt,
            finishedAt: m.finishedAt,
            durationMs: m.durationMs,
            scans: m.scans ?? null,
            scansRun: m.scansRun ?? null,
            findings: m.findings ?? null,
            file: m.file ?? null,
            error: m.error ?? null,
            needsValues: !!m.needsValues,
            row: m.row ?? null,
            vars: m.vars ?? null,
            config: m.config ?? null,
            runFolders: m.runFolders ?? null,
            reruns: m.reruns || 0,
            lastRerun: m.lastRerun ?? null,
            previous: m.previous ?? null,
            imported: m.imported ?? null,
            spec: null,
            scansDone: 0,
        }));
    }

    /**
     * Makes a finished session the running one again, with `items`, and
     * starts what waits in it: resumed, re-run or added rows land in its
     * folder, its batch.json and its zip, as if they had run with it.
     */
    function reopen(id, dir, manifest, items, { keepTimes = false } = {}) {
        session = {
            id,
            name: batchName(manifest.name),
            dir,
            startedAt: manifest.startedAt,
            finishedAt: null,
            // A row run again keeps the batch's own times: when it started,
            // when it finished, and so how long it took. Ending, the batch
            // takes its finish back (closeSession), and so does one a restart
            // cut short (init): a re-run days later is not the batch taking
            // days.
            keepFinishedAt: keepTimes && typeof manifest.finishedAt === 'string' ? manifest.finishedAt : null,
            items,
            takenFiles: new Set(items.flatMap((i) => [i.file, i.previous && i.previous.file]).filter(Boolean)),
            configFile: typeof manifest.configFile === 'string' ? manifest.configFile : null,
            // A reopened batch's peak and holds carry on from where they were.
            stats: manifest.stats && typeof manifest.stats === 'object'
                ? { peakHeapPct: null, peakHeapMb: null, heapLimitMb: null, holds: 0, ...manifest.stats }
                : { peakHeapPct: null, peakHeapMb: null, heapLimitMb: null, holds: 0 },
        };
        persist();
        openMetrics(session);
        pump();
    }

    // A finished batch to change: none may run meanwhile, as one batch runs
    // at a time.
    function finishedSession(id) {
        if (session) {
            throw queueError(409, session.id === id
                ? 'This batch is still running. Wait for it to finish first.'
                : 'Another batch is running. Wait for it to finish first.');
        }
        return readSessionManifest(id);
    }

    /**
     * Runs a finished batch's row again, from the workflow it saved, with
     * its row's values. Its new result replaces its old one; a re-run that
     * ends with no result keeps the old one, and the row says so
     * (`lastRerun`). A workflow with hidden values needs them in `values`
     * (getMaskedFields' keys), as resuming does.
     */
    function rerunItem(id, itemId, { values = null } = {}) {
        const { dir, manifest } = finishedSession(id);
        const items = itemsFromManifest(manifest);
        const item = items.find((i) => i.id === itemId);
        if (!item) throw queueError(404, 'No such run in this batch');
        if (item.imported) throw queueError(400, 'This run was added as a report, so there is no workflow to run again.');
        let spec = runSpecFrom(item.config && item.config.runSpec);
        if (!Array.isArray(spec.actions) || spec.actions.length === 0) {
            throw queueError(400, 'This run kept no workflow to run again.');
        }
        if (item.needsValues) {
            spec = fillMaskedValues(spec, isPlainObject(values) ? values : null);
            if (!spec) throw queueError(400, 'Type every hidden value to run this again.');
        }
        try {
            validateUrl(spec.url);
        } catch (err) {
            throw queueError(400, err && err.message ? err.message : 'Invalid url');
        }
        if (item.vars && Object.keys(item.vars).length) spec.vars = item.vars;
        item.previous = item.file ? resultOf(item) : null;
        item.reruns = (item.reruns || 0) + 1;
        Object.assign(item, {
            status: 'waiting', startedAt: null, finishedAt: null, durationMs: null, error: null,
            scans: null, scansRun: null, findings: null, file: null, spec,
        });
        if (!concurrencyChosen) concurrency = automaticConcurrency(1, maxConcurrency);
        reopen(id, dir, manifest, items, { keepTimes: true });
        return { sessionId: id, itemId };
    }

    /**
     * Deletes one run of a finished batch: its row in batch.json, its result,
     * and the pictures (images/) and run folders (evidence, screenshots)
     * that it alone used; another row's stay. The batch's zip and Send to
     * Compare follow, as they read its folder and batch.json. Its last run is
     * not deleted: the batch is, as a whole (deleteSession). The batch's
     * configuration, saved when it started, stays as it was, as adding a run
     * leaves it.
     */
    async function deleteItem(id, itemId) {
        const { dir, manifest } = finishedSession(id);
        const items = itemsFromManifest(manifest);
        const item = items.find((i) => i.id === itemId);
        if (!item) throw queueError(404, 'No such run in this batch');
        if (items.length === 1) throw queueError(409, 'This is the batch\'s only run. Delete the batch instead.');
        const remaining = items.filter((i) => i !== item);

        // Its files, as names inside the batch's folder only.
        const own = (name) => typeof name === 'string' && name && name === path.basename(name) && !name.startsWith('.');
        const filesOf = (i) => [i.file, i.previous && i.previous.file].filter(own);
        const mine = filesOf(item);
        const others = new Set(remaining.flatMap(filesOf));
        const goes = mine.filter((f) => !others.has(f));

        // What it used, read before its result goes.
        const usedPictures = async (names) => {
            const found = new Set();
            for (const name of names) {
                try {
                    for (const p of await imagePathsInFile(path.join(dir, name))) found.add(p);
                } catch { /* gone or unreadable: it names nothing */ }
            }
            return found;
        };
        const itsPictures = await usedPictures(goes);
        const itsFolders = new Set([...goes.flatMap((f) => files.runFoldersOfFile(path.join(dir, f), reportsRoot)), ...files.recordedRunFoldersOf(item, reportsRoot)]);

        // A batch that started running meanwhile is not changed under it.
        if (session && session.id === id) throw queueError(409, 'This batch started running meanwhile. Delete the run once it has finished.');
        // Gone from the batch first, in one write: the rest is cleaning up.
        files.writeManifest(dir, { ...manifest, items: remaining.map(manifestItem) });

        for (const name of goes) await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {});

        // Pictures and run folders another run still uses stay.
        const stillUsed = await usedPictures([...others]);
        let removedPictures = 0;
        // Only the batch's own pictures, named by their content's hash
        // (batch-package.js pictureName): "images/…" in a result can also be
        // the page's own image, quoted in a finding's HTML.
        const BATCH_PICTURE = /^[0-9a-f]{20}\.[a-z0-9]+$/;
        for (const picture of itsPictures) {
            if (stillUsed.has(picture) || !picture.startsWith(`${IMAGES_DIR}/`)) continue;
            if (!BATCH_PICTURE.test(path.basename(picture))) continue;
            const file = path.join(dir, IMAGES_DIR, path.basename(picture));
            try {
                await fs.promises.rm(file);
                removedPictures += 1;
            } catch { /* already gone */ }
        }
        const foldersKept = new Set([...[...others].flatMap((f) => files.runFoldersOfFile(path.join(dir, f), reportsRoot)), ...remaining.flatMap((i) => files.recordedRunFoldersOf(i, reportsRoot))]);
        let removedFolders = 0;
        for (const folder of itsFolders) {
            if (foldersKept.has(folder)) continue;
            await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
            removedFolders += 1;
        }
        return { sessionId: id, deleted: itemId, remaining: remaining.length, removedPictures, removedRunFolders: removedFolders };
    }

    /**
     * What a running item is doing and how lively it is (§8.1), as ages so the
     * tab needs no clock of its own to agree with the server's.
     */
    function liveDetails(item) {
        return {
            phase: item.phase || 'running',
            activity: item.activity ? item.activity.describe() : null,
            sinceScanMs: item.lastScanAtMs ? Math.max(0, now() - item.lastScanAtMs) : null,
            sinceProgressMs: item.lastProgressMs ? Math.max(0, now() - item.lastProgressMs) : null,
            paceMs: item.scanGaps && item.scanGaps.length ? median(item.scanGaps) : null,
        };
    }

    function itemView(item, { live }) {
        const view = {
            id: item.id,
            name: item.name,
            url: item.url,
            status: item.status,
            addedAt: item.addedAt,
            startedAt: item.startedAt,
            finishedAt: item.finishedAt,
            durationMs: item.durationMs,
            scans: item.scans,
            scansRun: item.scansRun ?? null,
            findings: item.findings,
            file: item.file,
            error: item.error,
            needsValues: !!item.needsValues,
            hasConfig: !!item.config,
            row: item.row ?? null,
            vars: item.vars ?? null,
            reruns: item.reruns || 0,
            lastRerun: item.lastRerun || null,
            imported: item.imported || null,
            // While it runs again: the result it would replace.
            replacing: item.previous && item.previous.file ? item.previous.file : null,
        };
        if (live && (item.status === 'running' || item.status === 'cancelling')) {
            view.scans = item.scansDone;
            view.scansRun = item.scansRun;
            // Added up scan by scan, as the saved result's figures are.
            view.findings = { fail: item.liveFail || 0, cantTell: item.liveCantTell || 0, pass: item.livePass || 0, soFar: true };
            view.elapsedMs = item.startedAt ? Math.max(0, now() - Date.parse(item.startedAt)) : 0;
            Object.assign(view, liveDetails(item));
        }
        return view;
    }

    // The runs of a batch that finished last, for the app to say so: a
    // summary carries these and the runs going now, not every run.
    const RECENT_ITEMS = 20;
    // At most this many runs to a page of GET /queue/sessions/:id/items.
    const MAX_ITEMS_PAGE = 500;

    /**
     * A batch as GET /queue gives it: its counts, stats and what the app
     * says of it (scans, the slowest run, whether it has results), the runs
     * going now and the last to finish, but not every run, which comes a page
     * at a time (getItems): a batch of 5,000 runs made the queue 1.9 MB, read
     * every second and a half while it ran.
     */
    function sessionView(s, { live, withItems = true }) {
        const items = s.items.map((i) => itemView(i, { live }));
        const counts = { total: items.length };
        for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
        const interrupted = items.some((i) => i.status === 'interrupted');
        return {
            id: s.id,
            name: batchName(s.name),
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
            state: live ? 'running' : (interrupted ? 'interrupted' : 'finished'),
            resumable: !live && items.some((i) => i.status === 'interrupted' && i.hasConfig),
            // Rows Resume can run only once their masked values are typed again.
            needsValues: !live && items.some((i) => i.status === 'interrupted' && i.needsValues && i.hasConfig),
            counts,
            // Scans a minute across the runs going now, from each one's pace,
            // and as many of them as the report keeps once Merged scans fold
            // their contexts into one (§8.3).
            ...(live ? batchPace(items) : {}),
            stats: s.stats || null,
            ...itemsSummary(items),
            ...(withItems ? { items } : {}),
        };
    }

    function itemsSummary(items) {
        const scans = items.reduce((n, i) => n + (Number.isFinite(i.scansRun) ? i.scansRun : (Number.isFinite(i.scans) ? i.scans : 0)), 0);
        // Runs that went to their end: a batch cancelled before any did has
        // no slowest run, where it named one cancelled a second in.
        const timed = items.filter((i) => Number.isFinite(i.durationMs) && i.status !== 'cancelled' && i.status !== 'interrupted');
        const slowest = timed.length > 1 ? timed.reduce((a, b) => (b.durationMs > a.durationMs ? b : a)) : null;
        const finished = items.filter((i) => i.finishedAt && i.status !== 'running' && i.status !== 'cancelling' && i.status !== 'waiting');
        finished.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
        return {
            scans,
            slowest: slowest ? { id: slowest.id, name: slowest.name, durationMs: slowest.durationMs } : null,
            hasResults: items.some((i) => !!i.file),
            active: items.filter((i) => i.status === 'running' || i.status === 'cancelling'),
            recent: finished.slice(0, RECENT_ITEMS).map((i) => ({ id: i.id, name: i.name, status: i.status })),
        };
    }

    /**
     * A page of a batch's runs, in the order they were queued, optionally only
     * those with a status. -> { sessionId, total, offset, limit, items }
     */
    function getItems(id, { offset = 0, limit = 100, status = null } = {}) {
        let source = null;
        let live = false;
        if (session && session.id === id) {
            source = session;
            live = true;
        } else {
            const dir = files.sessionDirFor(baseDir, id);
            source = dir ? files.readManifest(dir) : null;
        }
        if (!source) throw queueError(404, 'No such session');
        const from = Math.max(0, Math.floor(Number(offset)) || 0);
        const size = Math.min(MAX_ITEMS_PAGE, Math.max(1, Math.floor(Number(limit)) || 100));
        const wanted = status ? new Set(String(status).split(',').map((x) => x.trim()).filter(Boolean)) : null;
        const all = source.items.filter((i) => !wanted || wanted.has(i.status));
        return {
            sessionId: id,
            total: all.length,
            offset: from,
            limit: size,
            items: all.slice(from, from + size).map((i) => itemView(i, { live })),
        };
    }

    /**
     * A run's pace counts every scan it runs, each context of a Merged scan
     * included; the report, and the Scans column, count a Merged scan once.
     * What a run has kept of the scans it ran so far (`scans` over `scansRun`)
     * turns its pace into the report's.
     */
    function batchPace(items) {
        let perMin = 0;
        let mergedPerMin = 0;
        for (const i of items) {
            if (i.status !== 'running' || i.phase === 'saving' || !(i.paceMs > 0)) continue;
            const pace = 60000 / i.paceMs;
            perMin += pace;
            mergedPerMin += i.scansRun > 0 && Number.isFinite(i.scans) ? pace * Math.min(1, i.scans / i.scansRun) : pace;
        }
        const scansPerMin = perMin > 0 ? Math.round(perMin) : null;
        const merged = Math.round(mergedPerMin);
        return {
            scansPerMin,
            mergedScansPerMin: scansPerMin !== null && merged < scansPerMin ? merged : null,
        };
    }

    /** The running session, if any, then the most recent ones on disk. */
    function getState({ limit = RECENT_SESSIONS, items = true } = {}) {
        const sessions = [];
        if (session) sessions.push(sessionView(session, { live: true, withItems: items }));
        for (const id of files.listSessionIds(baseDir)) {
            if (sessions.length >= limit) break;
            if (session && id === session.id) continue;
            const manifest = files.readManifest(files.sessionDirFor(baseDir, id));
            if (manifest) sessions.push(sessionView(manifest, { live: false, withItems: items }));
        }
        const { hold, resources } = session ? governor.view() : { hold: null, resources: null };
        return { concurrency, concurrencyChosen, maxConcurrency, hold, resources, sessions };
    }

    /**
     * Deletes a finished session's folder (every result and its batch.json)
     * and what its runs saved beside it: their evidence and screenshots. The
     * running session is refused; cancel it first.
     */
    function deleteSession(id) {
        if (session && session.id === id) {
            throw queueError(409, 'This batch is still running. Cancel it, then delete it once it has stopped.');
        }
        const dir = files.sessionDirFor(baseDir, id);
        if (!dir || !files.readManifest(dir)) throw queueError(404, 'No such session');
        files.removeSession(baseDir, id, reportsRoot);
        return { deleted: id };
    }

    /**
     * A run's progress from absolute log index `since`, in the shape
     * /workflow-progress answers with, for watching it in the run tab. Only a
     * running item, or one that finished in the last minute, has a log.
     */
    function getItemProgress(itemId, since = 0) {
        const item = watchable.get(itemId);
        if (!item) throw queueError(404, 'This run is not running');
        const { logs, nextIndex } = item.log ? item.log.slice(since) : { logs: [], nextIndex: Number(since) || 0 };
        const live = item.status === 'running' || item.status === 'cancelling';
        return {
            status: item.status,
            nextIndex,
            logs,
            name: item.name,
            sessionId: item.sessionId,
            row: item.row ?? null,
            scans: live ? item.scansDone : item.scans,
            scansRun: live ? item.scansRun : (item.scansRun ?? null),
            elapsedMs: live && item.startedAt ? Math.max(0, now() - Date.parse(item.startedAt)) : item.durationMs,
            file: item.file,
            error: item.error,
            // For the Watch dialog's summary of what the run is on (§8.1).
            ...(live ? liveDetails(item) : {}),
        };
    }

    /** The folder of a session that exists, for downloading it. */
    function sessionDir(id) {
        const dir = files.sessionDirFor(baseDir, id);
        return dir && files.readManifest(dir) ? dir : null;
    }

    return {
        init,
        addItems,
        setConcurrency,
        cancelItem,
        cancelAll,
        resumeSession,
        rerunItem,
        deleteItem,
        getMaskedFields,
        deleteSession,
        getItemProgress,
        getState,
        getItems,
        sessionDir,
    };
}

module.exports = {
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
    KEEP_SESSIONS,
    automaticConcurrency,
    createRunQueue,
    hasMaskedValues,
    redactMaskedFields,
    summarizePayload,
    findMaskedSlots,
    describeMaskedSlot,
};
