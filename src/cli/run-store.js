'use strict';

/**
 * Where scheduled runs live on disk.
 *
 * A run kept unattended needs to find its own predecessor, keep a named
 * reference to compare releases against, and not grow without bound. The layout
 * is one directory per scenario:
 *
 *   <root>/<scenario>/runs/<stamp>/payload.json
 *   <root>/<scenario>/baselines/<name>.json
 *
 * A batch keeps its runs together, one folder per row, beside its batch.json:
 *
 *   <root>/<batch>/batches/<stamp>/batch.json
 *   <root>/<batch>/batches/<stamp>/<nn>-<row>/payload.json
 *
 * and each row's named baselines are its own scenario's, as if it had run
 * alone.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = 'a11y-runs';
const PAYLOAD_FILE = 'payload.json';
const RUNS_DIR = 'runs';
const BATCHES_DIR = 'batches';
const BATCH_MANIFEST = 'batch.json';
const BASELINES_DIR = 'baselines';
const AUTO_BASELINE = 'auto';
const NAMED_BASELINE_PREFIX = '@';

function safeDirPart(value, fallback) {
    const s = String(value || '')
        .replace(/^https?:\/\//, '')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
    return s || fallback;
}

function scenarioSlug(spec) {
    return safeDirPart((spec && (spec.scenarioName || spec.url)) || '', 'run');
}

function storeRoot(options) {
    return path.resolve((options && options.storeRoot) || DEFAULT_ROOT);
}

function scenarioDir(spec, options) {
    return path.join(storeRoot(options), scenarioSlug(spec));
}

function defaultOutDir(spec, stamp, options) {
    return path.join(scenarioDir(spec, options), RUNS_DIR, stamp);
}

function readPayload(filePath) {
    try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.scans)) return null;
        return payload;
    } catch {
        return null;
    }
}

function listRunDirs(runsDir) {
    try {
        return fs.readdirSync(runsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        return [];
    }
}

/**
 * The most recent run beside this one that scanned the same scenario. Runs from
 * another scenario sharing the directory are skipped rather than compared, and
 * a run with no payload is passed over.
 */
function findPreviousRun(currentOutDir, scenarioName) {
    const runsDir = path.dirname(path.resolve(currentOutDir));
    const current = path.basename(path.resolve(currentOutDir));
    const wanted = scenarioName || null;

    const candidates = listRunDirs(runsDir).filter((name) => name !== current).reverse();

    for (const name of candidates) {
        const filePath = path.join(runsDir, name, PAYLOAD_FILE);
        const payload = readPayload(filePath);
        if (!payload) continue;
        if (wanted && payload.scenarioName && payload.scenarioName !== wanted) continue;
        return { filePath, payload };
    }

    return null;
}

function baselineFilePath(name, spec, options) {
    return path.join(scenarioDir(spec, options), BASELINES_DIR, `${safeDirPart(name, 'baseline')}.json`);
}

/**
 * Turn what was asked for into a path: `auto` for the previous run beside this
 * one, `@name` for a promoted baseline, anything else as given.
 */
function resolveBaselineTarget(request, { outDir, spec, options }) {
    const value = String(request || '').trim();
    if (!value) return { kind: 'none' };

    if (value === AUTO_BASELINE) {
        const previous = findPreviousRun(outDir, spec && spec.scenarioName);
        if (!previous) {
            return { kind: 'auto', missing: true, message: 'no previous run to compare with yet' };
        }
        return { kind: 'auto', target: previous.filePath, label: path.basename(path.dirname(previous.filePath)) };
    }

    if (value.startsWith(NAMED_BASELINE_PREFIX)) {
        const name = value.slice(NAMED_BASELINE_PREFIX.length);
        if (!name) return { kind: 'named', error: 'a named baseline needs a name after @' };
        return { kind: 'named', target: baselineFilePath(name, spec, options), label: name };
    }

    return { kind: 'path', target: value, label: value };
}

/**
 * Copy a finished run's payload to a named baseline. A run that failed or came
 * back degraded is refused: a reference that covered less than it should makes
 * every later comparison read as an improvement.
 */
function promoteBaseline(name, { payloadPath, spec, options, health, status }) {
    if (status && status !== 'done') {
        return { ok: false, error: `not promoting a ${status} run to a baseline` };
    }
    if (health && health.degraded) {
        return { ok: false, error: 'not promoting a degraded run to a baseline' };
    }

    const target = baselineFilePath(name, spec, options);
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(payloadPath, target);
    } catch (e) {
        return { ok: false, error: `could not write baseline ${target}: ${e.message}` };
    }

    return { ok: true, target };
}

/** A batch's folder: <root>/<batch>/batches/<stamp>. */
function defaultBatchDir(name, stamp, options) {
    return path.join(storeRoot(options), safeDirPart(name, 'batch'), BATCHES_DIR, stamp);
}

/** A row's folder in its batch's: "03-Product-v2.4". */
function batchRunDirName(position, count, name) {
    return `${String(position).padStart(Math.max(2, String(count).length), '0')}-${safeDirPart(name, 'run')}`;
}

function readBatchManifest(dir) {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, BATCH_MANIFEST), 'utf8'));
        return manifest && Array.isArray(manifest.items) ? manifest : null;
    } catch {
        return null;
    }
}

/**
 * The same row's run in the most recent batch beside this one: `--baseline
 * auto` for a batch. A row is the same when its name is; a batch whose run
 * of it left no payload is passed over.
 */
function findPreviousBatchRun(currentBatchDir, runName) {
    const batchesDir = path.dirname(path.resolve(currentBatchDir));
    const current = path.basename(path.resolve(currentBatchDir));
    for (const name of listRunDirs(batchesDir).filter((n) => n !== current).reverse()) {
        const dir = path.join(batchesDir, name);
        const manifest = readBatchManifest(dir);
        const item = manifest && manifest.items.find((i) => i && i.name === runName && typeof i.file === 'string');
        if (!item) continue;
        const filePath = path.join(dir, item.file);
        if (readPayload(filePath)) return { filePath, label: `${name}/${path.dirname(item.file)}` };
    }
    return null;
}

/**
 * Keep the newest `keep` batches beside this one and remove the rest. Only
 * folders holding a batch.json are considered.
 */
function pruneBatches(currentBatchDir, keep) {
    const limit = Number(keep);
    if (!Number.isFinite(limit) || limit < 1) {
        return { removed: [], error: '--keep needs a number of batches to keep, at least 1' };
    }
    const batchesDir = path.dirname(path.resolve(currentBatchDir));
    const batches = listRunDirs(batchesDir)
        .map((name) => path.join(batchesDir, name))
        .filter((dir) => fs.existsSync(path.join(dir, BATCH_MANIFEST)));
    const removed = [];
    for (const dir of batches.slice(0, Math.max(0, batches.length - limit))) {
        try {
            fs.rmSync(dir, { recursive: true });
            removed.push(dir);
        } catch {
            // Leave a batch in place rather than half-delete it.
        }
    }
    return { removed };
}

/**
 * Keep the newest `keep` runs beside this one and remove the rest. Only
 * directories holding a payload are considered, so nothing else placed in the
 * folder is touched.
 */
function pruneRuns(currentOutDir, keep) {
    const limit = Number(keep);
    if (!Number.isFinite(limit) || limit < 1) {
        return { removed: [], error: '--keep needs a number of runs to keep, at least 1' };
    }

    const runsDir = path.dirname(path.resolve(currentOutDir));

    const runs = listRunDirs(runsDir)
        .map((name) => ({ name, dir: path.join(runsDir, name) }))
        .filter((entry) => fs.existsSync(path.join(entry.dir, PAYLOAD_FILE)));

    if (runs.length <= limit) return { removed: [] };

    const doomed = runs.slice(0, runs.length - limit);
    const removed = [];

    for (const entry of doomed) {
        try {
            fs.rmSync(entry.dir, { recursive: true });
            removed.push(entry.dir);
        } catch {
            // Leave a run in place rather than half-delete it.
        }
    }

    return { removed };
}

module.exports = {
    DEFAULT_ROOT,
    PAYLOAD_FILE,
    RUNS_DIR,
    BATCHES_DIR,
    BATCH_MANIFEST,
    BASELINES_DIR,
    safeDirPart,
    scenarioSlug,
    scenarioDir,
    defaultOutDir,
    findPreviousRun,
    baselineFilePath,
    resolveBaselineTarget,
    promoteBaseline,
    pruneRuns,
    defaultBatchDir,
    batchRunDirName,
    readBatchManifest,
    findPreviousBatchRun,
    pruneBatches,
};
