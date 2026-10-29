'use strict';

/**
 * "Download all" for a queue session: the session folder - every saved result
 * and batch.json - streamed to the response as one zip, without building it in
 * memory or on disk first. Temporary dotfiles left by a write in progress are
 * skipped, so a zip taken while the queue runs holds only whole files.
 */

const path = require('path');

function contentDisposition(fileName) {
    const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** `extra`: files to add that the folder does not hold, `[{ name, text }]`. */
function streamDirectoryZip(res, dir, downloadName, { logError = console.error, extra = [] } = {}) {
    // archiver is ESM-only from v8; require() of ESM needs Node 22.12+, the
    // project's minimum already.
    const { ZipArchive } = require('archiver');
    const archive = new ZipArchive({ zlib: { level: 6 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(downloadName));
    res.setHeader('Cache-Control', 'no-store');

    archive.on('warning', (err) => logError('[queue-zip] warning', err && err.message ? err.message : err));
    archive.on('error', (err) => {
        logError('[queue-zip] failed', err && err.message ? err.message : err);
        res.destroy(err);
    });
    res.on('close', () => {
        if (!res.writableFinished) archive.abort();
    });

    archive.pipe(res);
    archive.directory(dir, false, (entry) => (path.basename(entry.name).startsWith('.') ? false : entry));
    for (const file of extra) archive.append(file.text, { name: file.name });
    archive.finalize();
}

/**
 * Some of a folder's files as a zip, each at its path in the folder: one
 * run's own package, its result and the pictures it names in images/.
 */
function streamFilesZip(res, dir, relPaths, downloadName, { logError = console.error, extra = [] } = {}) {
    const { ZipArchive } = require('archiver');
    const archive = new ZipArchive({ zlib: { level: 6 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(downloadName));
    res.setHeader('Cache-Control', 'no-store');

    archive.on('warning', (err) => logError('[queue-zip] warning', err && err.message ? err.message : err));
    archive.on('error', (err) => {
        logError('[queue-zip] failed', err && err.message ? err.message : err);
        res.destroy(err);
    });
    res.on('close', () => {
        if (!res.writableFinished) archive.abort();
    });

    archive.pipe(res);
    for (const rel of relPaths) archive.file(path.join(dir, rel), { name: rel });
    for (const file of extra) archive.append(file.text, { name: file.name });
    archive.finalize();
}

module.exports = { streamDirectoryZip, streamFilesZip, contentDisposition };
