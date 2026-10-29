'use strict';

/**
 * Where a queued run keeps its scans' page screenshots until its result is
 * written (docs/design/workflow-queue-batch-design.md §6), instead of in memory.
 *
 * A run holds every scan it has finished until it ends, since the result is
 * built from all of them at once. Each page screenshot is about half of what
 * a scan holds, so with several runs of hundreds of scans going at once the
 * server held them by the gigabyte. The spool writes each one to a file as
 * the scan finishes and leaves in its place a screenshot whose `dataUrl`
 * reads that file back only when the result is written: the written result
 * is byte for byte what it was.
 *
 * The folder is the session's `.spool-<item id>`: a dot name, so "Download
 * all" and the list of results leave it out. It is removed once the result is
 * saved, or the run has ended without one.
 */

const fs = require('fs');
const path = require('path');

const SPOOL_PREFIX = '.spool-';

function bytesOf(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    return null;
}

/**
 * A data URL read from `file` when the result is written. The prefix is the
 * one a buffer gets there (workflow-payload-builder's deferredDataUrl).
 */
function fileDataUrl(file) {
    // `file` lets a batch move the picture into its images/ folder instead
    // (batch-package.js).
    return { file, toJSON: () => 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64') };
}

function spoolDirFor(sessionDir, itemId) {
    return path.join(sessionDir, `${SPOOL_PREFIX}${itemId}`);
}

function createScanSpool(dir) {
    let count = 0;
    let made = false;

    /**
     * `shot` as the runner keeps it - a capture artifact `{ buffer, ... }` or
     * a bare buffer - with its bytes moved to a file. Anything else (no
     * bytes, an empty capture, a screenshot already a link or a data URL)
     * comes back as it was.
     */
    async function spillScreenshot(shot) {
        if (!shot || typeof shot !== 'object') return shot;
        const bare = bytesOf(shot);
        if (!bare && (shot.publicUrl || shot.dataUrl)) return shot;
        const bytes = bare || bytesOf(shot.buffer) || bytesOf(shot.data);
        if (!bytes || bytes.length === 0) return shot;

        if (!made) {
            await fs.promises.mkdir(dir, { recursive: true });
            made = true;
        }
        count += 1;
        const file = path.join(dir, `${count}.jpg`);
        await fs.promises.writeFile(file, bytes);

        if (bare) return { dataUrl: fileDataUrl(file) };
        const { buffer, data, base64, publicUrl, ...rest } = shot; // eslint-disable-line no-unused-vars
        return { ...rest, dataUrl: fileDataUrl(file) };
    }

    async function remove() {
        if (!made) return;
        await fs.promises.rm(dir, { recursive: true, force: true });
        made = false;
    }

    return { dir, spillScreenshot, remove };
}

module.exports = { SPOOL_PREFIX, createScanSpool, spoolDirFor, fileDataUrl };
