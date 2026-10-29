'use strict';

/**
 * Where a finished /workflow-start run's result waits to be fetched
 * (server.js): a file, written once as the run ends, a piece at a time
 * (json-file-writer.js), not the payload object held for the half hour a
 * finished run is kept. /workflow-result streams the file.
 *
 * Held in memory, each run's result kept about 4 MB of the server's heap
 * for half an hour, and each fetch finalized it again and built its whole
 * JSON text (0.6–0.7 s for a 28 MB result), which also failed past V8's
 * ~512 MB string limit. A result that cannot be written (a full disk) stays
 * in memory and is sent as before.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonFile } = require('./json-file-writer');

function createRunResultStore({ dir = null } = {}) {
    let folder = dir;

    function ensureFolder() {
        if (!folder) folder = fs.mkdtempSync(path.join(os.tmpdir(), 'surea11y-lab-results-'));
        else fs.mkdirSync(folder, { recursive: true });
        return folder;
    }

    /** Writes `payload` for `runId`. -> { file, bytes } or null when it could not be written. */
    async function keep(runId, payload) {
        const safe = String(runId).replace(/[^A-Za-z0-9_-]/g, '_');
        let file = null;
        try {
            file = path.join(ensureFolder(), `${safe}.json`);
            const bytes = await writeJsonFile(file, payload);
            return { file, bytes };
        } catch {
            if (file) fs.rmSync(file, { force: true });
            return null;
        }
    }

    function remove(file) {
        if (file) fs.rmSync(file, { force: true });
    }

    /** Removes every result left: the server is stopping. */
    function clear() {
        if (folder) fs.rmSync(folder, { recursive: true, force: true });
    }

    return { keep, remove, clear, get dir() { return folder; } };
}

/**
 * Answers `{ ...head, payload: <the file's JSON> }` without reading the file
 * into memory: `head` is written around the file's bytes as they stream.
 */
function sendWithPayloadFile(res, head, file) {
    const before = JSON.stringify(head);
    // `{"status":"done"}` -> `{"status":"done","payload":` … `}`
    const open = `${before.slice(0, -1)}${before.length > 2 ? ',' : ''}"payload":`;
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(open) + fs.statSync(file).size + 1));
    res.write(open);
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.on('end', () => res.end('}'));
    stream.pipe(res, { end: false });
}

module.exports = { createRunResultStore, sendWithPayloadFile };
