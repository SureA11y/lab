'use strict';

/**
 * A queue batch kept as a report package (docs/report-package.md): its
 * folder holds each run's result as JSON and, in images/, every picture they
 * show, each once, named by its content. A result names its pictures by
 * their path, "images/<hash>.<ext>", as a package's JSON does, so "Download
 * all" is the folder zipped, and it opens in the app with no lab.
 *
 * A run's result is packed as it is saved (packResultImages): its page and
 * workflow screenshots, in the spool (scan-spool.js) or in memory, become
 * files, and its element pictures, which the run wrote under the reports
 * root, are linked there (a hard link: no second copy on disk). The names are
 * those the app gives (report-package.js): the first 20 hex digits of the
 * picture's SHA-256 and its type's extension, so a batch and a report
 * downloaded from the app name the same picture the same way.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGES_DIR = 'images';

const EXTENSION_BY_MIME_TYPE = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
};
const MIME_TYPE_BY_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// A link the lab serves to a run's own folder: evidence or saved screenshots.
const RUN_FOLDER_RE = /^\/reports\/(evidence|runs)\/([A-Za-z0-9._-]+)\//;

// Nodes walked between turns of the event loop: a long run's result has
// hundreds of thousands, and the server answers meanwhile.
const YIELD_EVERY = 5000;

function pictureName(bytes, mimeType) {
    const extension = EXTENSION_BY_MIME_TYPE[String(mimeType || '').toLowerCase()];
    if (!extension) return null;
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20);
    return `${hash}.${extension}`;
}

function bytesOf(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    return null;
}

function decodeDataUrl(dataUrl) {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl);
    return match ? { mimeType: match[1].toLowerCase(), bytes: Buffer.from(match[2], 'base64') } : null;
}

async function exists(file) {
    try {
        await fs.promises.access(file);
        return true;
    } catch {
        return false;
    }
}

/** The batch's images/ folder: puts a picture there once and gives its name. */
function createBatchImages(sessionDir) {
    const dir = path.join(sessionDir, IMAGES_DIR);
    let made = false;
    const known = new Set();

    async function target(name) {
        if (!made) {
            await fs.promises.mkdir(dir, { recursive: true });
            made = true;
        }
        const file = path.join(dir, name);
        const present = known.has(name) || await exists(file);
        known.add(name);
        return { file, present };
    }

    return {
        dir,
        /** Writes `bytes`. */
        async addBytes(bytes, mimeType) {
            const name = pictureName(bytes, mimeType);
            if (!name) return null;
            const { file, present } = await target(name);
            if (!present) await fs.promises.writeFile(file, bytes);
            return name;
        },
        /** Moves a spooled picture in: the spool goes once the run is saved. */
        async moveFile(source, mimeType) {
            const bytes = await fs.promises.readFile(source);
            const name = pictureName(bytes, mimeType);
            if (!name) return null;
            const { file, present } = await target(name);
            if (!present) await fs.promises.rename(source, file).catch(() => fs.promises.writeFile(file, bytes));
            return name;
        },
        /** Links a picture the run wrote elsewhere, copying it if it cannot. */
        async linkFile(source, mimeType) {
            const bytes = await fs.promises.readFile(source);
            const name = pictureName(bytes, mimeType);
            if (!name) return null;
            const { file, present } = await target(name);
            if (!present) {
                await fs.promises.link(source, file).catch((err) => {
                    if (err && err.code === 'EEXIST') return null;
                    return fs.promises.copyFile(source, file);
                });
            }
            return name;
        },
    };
}

/** The file under `reportsRoot` a /reports/ link names, or null if it would leave it. */
function servedFile(link, reportsRoot) {
    if (!reportsRoot || !link.startsWith('/reports/')) return null;
    let rel;
    try {
        rel = decodeURIComponent(link.slice('/reports/'.length).split(/[?#]/)[0]);
    } catch {
        return null;
    }
    const root = path.resolve(reportsRoot);
    const file = path.resolve(root, rel);
    return file.startsWith(root + path.sep) ? file : null;
}

/**
 * Gives every picture in a run's `payload` its path in the batch: page and
 * workflow screenshots (an inline data URL, a spooled file, a buffer) and the
 * element pictures the lab serves. `payload` is changed. Returns the run's
 * own folders under the reports root its links named ("evidence/<run>"), so
 * deleting the batch can remove them, and the pictures that could not be
 * had, which keep their link. `prefix` is what a picture's name is given:
 * "images/", its path in a package, or a link the lab serves the folder at.
 */
async function packResultImages(payload, images, { reportsRoot = null, prefix = `${IMAGES_DIR}/` } = {}) {
    const paths = new Map(); // a picture's source -> its path, or null
    const runFolders = new Set();
    const missing = [];
    const seen = new WeakSet();
    let walked = 0;

    function once(key, make) {
        if (!paths.has(key)) {
            paths.set(key, make().then((name) => (name ? `${prefix}${name}` : null), (err) => {
                missing.push({ ref: key.startsWith('data:') ? 'an inline picture' : key, error: err && err.message ? err.message : String(err) });
                return null;
            }));
        }
        return paths.get(key);
    }

    async function pathFor(value) {
        if (typeof value === 'string') {
            if (value.startsWith('data:image/')) {
                const decoded = decodeDataUrl(value);
                return decoded ? once(value, () => images.addBytes(decoded.bytes, decoded.mimeType)) : null;
            }
            if (value.startsWith('/reports/')) {
                const folder = RUN_FOLDER_RE.exec(value);
                if (folder) runFolders.add(`${folder[1]}/${folder[2]}`);
                const file = servedFile(value, reportsRoot);
                const mimeType = MIME_TYPE_BY_EXTENSION[path.extname(value).slice(1).toLowerCase()];
                return file && mimeType ? once(value, () => images.linkFile(file, mimeType)) : null;
            }
            return null;
        }
        // A screenshot not yet a data URL (workflow-payload-builder, scan-spool):
        // its bytes, or the spool file holding them. Both are JPEG captures.
        if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
            if (typeof value.file === 'string') return once(`spool:${value.file}`, () => images.moveFile(value.file, 'image/jpeg'));
            const bytes = bytesOf(value.pictureBytes);
            if (bytes) return once(bytes, () => images.addBytes(bytes, 'image/jpeg'));
        }
        return null;
    }

    async function visit(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const keys = Array.isArray(node) ? node.keys() : Object.keys(node);
        for (const key of keys) {
            walked += 1;
            if (walked % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve));
            const value = node[key];
            const at = await pathFor(value);
            if (at) node[key] = at;
            else if (value && typeof value === 'object' && typeof value.toJSON !== 'function') await visit(value);
        }
    }

    await visit(payload);
    return { runFolders: [...runFolders].sort(), missing };
}

const IMAGE_PATH_RE = /"(images\/[A-Za-z0-9._-]+)"/g;
// Longer than any "images/<hash>.<ext>" with its quotes: what is kept of one
// chunk for the next, so a path split between them is still found.
const CARRY = 64;

/**
 * The "images/<name>" paths a result names, read from its file a chunk at a
 * time: a long run's result can be larger than a string can hold.
 */
async function imagePathsInFile(file) {
    const found = new Set();
    let tail = '';
    for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
        const text = tail + chunk;
        for (const m of text.matchAll(IMAGE_PATH_RE)) found.add(m[1]);
        tail = text.slice(-CARRY);
    }
    return [...found].sort();
}

module.exports = { IMAGES_DIR, createBatchImages, packResultImages, pictureName, servedFile, imagePathsInFile };
