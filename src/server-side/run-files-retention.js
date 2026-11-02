'use strict';

/**
 * How long a run's files stay on disk: the pictures under reports/runs/<run>/
 * and the evidence under reports/evidence/<run>/. They were never deleted: an
 * hour of runs left 96 MB, and a server left running fills its disk. A run's
 * folders go A11Y_RUN_FILES_HOURS after they were last written (default 24),
 * checked when the server starts and every hour after; 0 keeps them for good.
 *
 * A report downloaded as a package carries its own pictures; a report open in
 * the app, or saved as JSON alone, links to these, and shows none once
 * they are gone. Batches are the queue's to keep or delete (queue-files.js).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_HOURS = 24;
const FOLDERS = ['runs', 'evidence'];

/** A number of hours from 0, from A11Y_RUN_FILES_HOURS, else the default. */
function retentionHoursFrom(value) {
    if (value == null || value === '') return DEFAULT_HOURS;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOURS;
}

/**
 * Deletes every run folder under reportsRoot's runs/ and evidence/ last
 * written over `hours` ago. -> the folders deleted.
 */
function sweepRunFiles(reportsRoot, hours, now = Date.now()) {
    if (!(hours > 0)) return [];
    const cutoff = now - hours * 3600000;
    const removed = [];
    for (const folder of FOLDERS) {
        const base = path.join(reportsRoot, folder);
        let names = [];
        try { names = fs.readdirSync(base); } catch { continue; }
        for (const name of names) {
            const dir = path.join(base, name);
            try {
                const stat = fs.statSync(dir);
                if (!stat.isDirectory() || lastWritten(dir, stat.mtimeMs) > cutoff) continue;
                fs.rmSync(dir, { recursive: true, force: true });
                removed.push(dir);
            } catch {
                // Gone meanwhile, or not ours to read: left alone.
            }
        }
    }
    return removed;
}

/** When anything in `dir`, one level down, was last written. */
function lastWritten(dir, own) {
    let latest = own;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { return latest; }
    for (const name of entries) {
        try { latest = Math.max(latest, fs.statSync(path.join(dir, name)).mtimeMs); } catch {}
    }
    return latest;
}

/** Sweeps now and every hour, without keeping the process alive. */
function startRunFilesRetention(reportsRoot, hours, { log = () => {} } = {}) {
    if (!(hours > 0)) return null;
    const sweep = () => {
        const removed = sweepRunFiles(reportsRoot, hours);
        if (removed.length) log(`Deleted the files of ${removed.length} run${removed.length === 1 ? '' : 's'} older than ${hours} hours (A11Y_RUN_FILES_HOURS).`);
    };
    sweep();
    const timer = setInterval(sweep, 3600000);
    timer.unref();
    return timer;
}

module.exports = { retentionHoursFrom, sweepRunFiles, startRunFilesRetention, DEFAULT_HOURS };
