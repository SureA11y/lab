'use strict';

/**
 * Writes a value as compact JSON to a file a piece at a time, so the result
 * of a long workflow (hundreds of scans, each with its screenshot inline) is
 * never one string. JSON.stringify builds the whole text first and V8 caps a
 * string at about 512 MB ("Invalid string length"); it also holds the event
 * loop for as long as it takes, stalling every other run and request.
 *
 * The output is what JSON.stringify(value) returns: toJSON is honoured,
 * undefined, functions and symbols are left out of objects and become null in
 * arrays, non-finite numbers become null. Writes wait for the stream to
 * drain, so memory stays at about one chunk on top of the value itself.
 */

const fs = require('fs');

const CHUNK = 1 << 20; // flush to disk in ~1 MB pieces
// Containers at least this deep, and no longer than this, are handed to
// JSON.stringify whole (one scan, one finding): far faster than walking them,
// and each holds the event loop only briefly. Bigger ones are walked.
const WALK_DEPTH = 2;
const WALK_LENGTH = 256;

/** The value JSON.stringify would serialize for `v` under `key`. */
function resolve(v, key) {
    if (v !== null && (typeof v === 'object' || typeof v === 'bigint') && typeof v.toJSON === 'function') {
        return v.toJSON(key);
    }
    return v;
}

function hasNoJsonForm(v) {
    return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

/**
 * @returns {Promise<number>} bytes written
 */
async function writeJsonFile(filePath, value) {
    const out = fs.createWriteStream(filePath, { encoding: 'utf8' });
    let streamError = null;
    out.on('error', (err) => { streamError = err; });

    let buf = '';
    let bytes = 0;
    const ancestors = new Set();

    async function flush(force) {
        if (streamError) throw streamError;
        if (!buf || (!force && buf.length < CHUNK)) return;
        const piece = buf;
        buf = '';
        bytes += Buffer.byteLength(piece, 'utf8');
        if (out.write(piece)) return;
        await new Promise((res, rej) => {
            const onDrain = () => { out.off('error', onError); res(); };
            const onError = (err) => { out.off('drain', onDrain); rej(err); };
            out.once('drain', onDrain);
            out.once('error', onError);
        });
    }

    function tryWhole(v, depth) {
        if (depth < WALK_DEPTH || typeof v.toJSON === 'function') return false;
        const size = Array.isArray(v) ? v.length : Object.keys(v).length;
        if (size > WALK_LENGTH) return false;
        try {
            buf += JSON.stringify(v);
            return true;
        } catch (err) {
            if (err instanceof RangeError) return false; // too big after all: walk it
            throw err;
        }
    }

    // `v` is already resolved (its toJSON, if any, has run).
    async function serialize(v, depth) {
        if (v === null) { buf += 'null'; return; }
        switch (typeof v) {
            case 'string': buf += JSON.stringify(v); return;
            case 'number': buf += Number.isFinite(v) ? String(v) : 'null'; return;
            case 'boolean': buf += v ? 'true' : 'false'; return;
            case 'bigint': throw new TypeError('Do not know how to serialize a BigInt');
            case 'object': break;
            default: buf += 'null'; return; // undefined/function/symbol in an array slot
        }

        if (tryWhole(v, depth)) return;
        if (ancestors.has(v)) throw new TypeError('Converting circular structure to JSON');
        ancestors.add(v);
        if (Array.isArray(v)) {
            buf += '[';
            for (let i = 0; i < v.length; i += 1) {
                if (i) buf += ',';
                await serialize(resolve(v[i], String(i)), depth + 1);
                if (buf.length >= CHUNK) await flush(false);
            }
            buf += ']';
        } else {
            buf += '{';
            let first = true;
            for (const k of Object.keys(v)) {
                const item = resolve(v[k], k);
                if (hasNoJsonForm(item)) continue;
                buf += (first ? '' : ',') + JSON.stringify(k) + ':';
                first = false;
                await serialize(item, depth + 1);
                if (buf.length >= CHUNK) await flush(false);
            }
            buf += '}';
        }
        ancestors.delete(v);
    }

    try {
        const root = resolve(value, '');
        if (hasNoJsonForm(root)) throw new TypeError('Nothing to write: the value has no JSON form');
        await serialize(root, 0);
        await flush(true);
        await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
        if (streamError) throw streamError;
        return bytes;
    } catch (err) {
        out.destroy();
        throw err;
    }
}

module.exports = { writeJsonFile };
