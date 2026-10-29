'use strict';

/**
 * Disk side of the run queue (see docs/design/workflow-queue-batch-design.md §6-7):
 * where a queue session's folder goes and what it is called, how its result
 * files are named, the `batch.json` manifest, and which old sessions are kept.
 *
 * Every path built here stays inside the queue's base directory: session ids
 * are checked against one strict pattern before they are joined to it, and
 * result file names are reduced to a safe character set, so neither a request
 * nor a workflow's scenario name can point a write or a download elsewhere.
 */

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'batch.json';
const MANIFEST_TYPE = 'a11y-queue-session';
const MANIFEST_VERSION = 1;
// The session's resource and scan-timing log, one JSON object per line (§5.1).
const METRICS_NAME = 'metrics.jsonl';
// A batch's configuration: what "Save configuration" writes, by its suffix.
const CONFIG_SUFFIX = '.a11y-config.json';

// 2026-10-12T14-03-27, with -2, -3 ... when two sessions start in the same second.
const SESSION_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,4})?$/;

const MAX_FILE_STEM = 80;

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** The session folder name for a start time, in the server's local time. */
function sessionStamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        + `T${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

function isSessionId(id) {
    return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/** The folder of a session, or null when the id is not one this module makes. */
function sessionDirFor(baseDir, id) {
    return isSessionId(id) ? path.join(baseDir, id) : null;
}

/** Creates a new, empty session folder named after `ms` and returns its id. */
function createSessionDir(baseDir, ms) {
    fs.mkdirSync(baseDir, { recursive: true });
    const stamp = sessionStamp(ms);
    for (let n = 1; n < 10000; n += 1) {
        const id = n === 1 ? stamp : `${stamp}-${n}`;
        try {
            fs.mkdirSync(path.join(baseDir, id));
            return id;
        } catch (err) {
            if (err && err.code === 'EEXIST') continue;
            throw err;
        }
    }
    throw new Error(`No free session folder name for ${stamp}`);
}

/** A file name stem from a run's name: letters, digits, dot, dash, underscore. */
function fileStem(name) {
    const stem = String(name || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, MAX_FILE_STEM)
        .replace(/[-.]+$/g, '');
    return stem || 'run';
}

/**
 * `<stem>.json`, or `<stem>-2.json` and so on when the name is taken. `taken`
 * holds the names already given out in this session; the manifest's own name
 * is always taken.
 */
function uniqueResultFileName(name, taken) {
    const stem = fileStem(name);
    for (let n = 1; ; n += 1) {
        const candidate = n === 1 ? `${stem}.json` : `${stem}-${n}.json`;
        // Never a name the batch's configuration takes (CONFIG_SUFFIX).
        if (candidate === MANIFEST_NAME || candidate.endsWith(CONFIG_SUFFIX) || taken.has(candidate)) continue;
        taken.add(candidate);
        return candidate;
    }
}

/**
 * Writes JSON so a reader never sees half a file: to a dotfile beside the
 * target (dotfiles are not served), then renamed over it.
 */
function writeJsonAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

function readManifest(dir) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
        return parsed && parsed.type === MANIFEST_TYPE && Array.isArray(parsed.items) ? parsed : null;
    } catch {
        return null;
    }
}

function writeManifest(dir, manifest) {
    writeJsonAtomic(path.join(dir, MANIFEST_NAME), manifest);
}

/** Session ids under `baseDir` that hold a manifest, newest first. */
function listSessionIds(baseDir) {
    let entries;
    try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory() && isSessionId(e.name)
            && fs.existsSync(path.join(baseDir, e.name, MANIFEST_NAME)))
        .map((e) => e.name)
        .sort(compareSessionIdsNewestFirst);
}

// The timestamp sorts as text; the -n suffix has to sort as a number (-10 after -9).
function compareSessionIdsNewestFirst(a, b) {
    const stampA = a.slice(0, 19);
    const stampB = b.slice(0, 19);
    if (stampA !== stampB) return stampA < stampB ? 1 : -1;
    const nA = Number(a.slice(20)) || 1;
    const nB = Number(b.slice(20)) || 1;
    return nB - nA;
}

// What a run writes beside its result, each in a folder of its own under the
// reports root: evidence (element screenshots, evidence captures) and saved
// screenshots. A result names those files by their public URL.
const RUN_FOLDER_REF_RE = /\/reports\/(evidence|runs)\/([A-Za-z0-9._-]+)\//g;

/**
 * The run folders a session's results point to, as paths under
 * `reportsRoot`. Read from the results themselves, so it also finds them for
 * sessions saved before anything recorded them.
 */
function runFoldersOf(sessionDir, reportsRoot) {
    if (!reportsRoot) return [];
    let names;
    try {
        names = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json') && f !== MANIFEST_NAME && !f.endsWith(CONFIG_SUFFIX) && !f.startsWith('.'));
    } catch {
        return [];
    }
    const found = new Set();
    for (const name of names) {
        let text;
        try {
            text = fs.readFileSync(path.join(sessionDir, name), 'utf8');
        } catch {
            continue;
        }
        for (const m of text.matchAll(RUN_FOLDER_REF_RE)) {
            if (m[2] === '.' || m[2] === '..') continue;
            found.add(path.join(reportsRoot, m[1], m[2]));
        }
    }
    return [...found];
}

/**
 * Deletes a session's folder and the run folders its results point to.
 * Returns how many of those run folders there were.
 */
// A run folder as batch.json records it: "evidence/<run>" or "runs/<run>".
const RECORDED_RUN_FOLDER_RE = /^(evidence|runs)\/([A-Za-z0-9._-]+)$/;

/**
 * The run folders batch.json records for its runs: a batch kept as a package
 * (batch-package.js) has its pictures in images/, and its results no longer
 * link to them.
 */
function recordedRunFolders(sessionDir, reportsRoot) {
    if (!reportsRoot) return [];
    const manifest = readManifest(sessionDir);
    const folders = [];
    for (const item of (manifest && manifest.items) || []) {
        for (const f of Array.isArray(item && item.runFolders) ? item.runFolders : []) {
            const m = RECORDED_RUN_FOLDER_RE.exec(String(f));
            if (m && m[2] !== '.' && m[2] !== '..') folders.push(path.join(reportsRoot, m[1], m[2]));
        }
    }
    return folders;
}

function removeSession(baseDir, id, reportsRoot) {
    const dir = sessionDirFor(baseDir, id);
    if (!dir) return 0;
    const runFolders = [...new Set([...runFoldersOf(dir, reportsRoot), ...recordedRunFolders(dir, reportsRoot)])];
    fs.rmSync(dir, { recursive: true, force: true });
    for (const folder of runFolders) fs.rmSync(folder, { recursive: true, force: true });
    return runFolders.length;
}

/**
 * Deletes the oldest sessions beyond `keep`, never one listed in `protect`,
 * with the run folders their results point to. Only folders this module
 * created (a session id holding a manifest) are ever candidates. Returns the
 * ids removed.
 */
function pruneSessions(baseDir, keep, protect = [], reportsRoot = null) {
    const keepSet = new Set(protect);
    const ids = listSessionIds(baseDir);
    const removed = [];
    let kept = 0;
    for (const id of ids) {
        if (keepSet.has(id) || kept < keep) {
            kept += 1;
            continue;
        }
        removeSession(baseDir, id, reportsRoot);
        removed.push(id);
    }
    return removed;
}

module.exports = {
    MANIFEST_NAME,
    MANIFEST_TYPE,
    MANIFEST_VERSION,
    METRICS_NAME,
    CONFIG_SUFFIX,
    sessionStamp,
    isSessionId,
    sessionDirFor,
    createSessionDir,
    fileStem,
    uniqueResultFileName,
    writeJsonAtomic,
    readManifest,
    writeManifest,
    listSessionIds,
    pruneSessions,
    runFoldersOf,
    removeSession,
};
