'use strict';

/**
 * Compresses what the server sends, for clients that accept gzip: its JSON
 * (a run's result, the queue), the reports it serves, and the app's own
 * pages, scripts and styles. A report is mostly text that repeats (rules,
 * selectors, markup): a 41.6 MB result went over the wire as it was.
 * Pictures, zips and anything already encoded are sent as they are.
 *
 * It wraps the response's write and end, as Express's own compression does,
 * so it serves res.json, res.send and a file streamed to the response alike.
 * A response under MIN_BYTES whose length is known is left alone.
 */

const zlib = require('zlib');

const COMPRESSIBLE = /^(application\/(json|javascript|xml|ld\+json|manifest\+json)|text\/|image\/svg\+xml)/i;
const MIN_BYTES = 1024;

function acceptsGzip(req) {
    const accept = String(req.headers['accept-encoding'] || '');
    return /\bgzip\b(?!;q=0(\.0*)?\b)/i.test(accept);
}

function gzip() {
    return function gzipMiddleware(req, res, next) {
        if (req.method === 'HEAD' || !acceptsGzip(req)) return next();
        res.vary('Accept-Encoding');

        const write = res.write;
        const end = res.end;
        let stream = null; // the gzip stream, once decided
        let decided = false;

        function decide(firstChunk) {
            if (decided) return;
            decided = true;
            const type = String(res.getHeader('Content-Type') || '');
            const length = Number(res.getHeader('Content-Length'));
            const chunkLength = firstChunk ? Buffer.byteLength(firstChunk) : 0;
            const small = Number.isFinite(length) ? length < MIN_BYTES : chunkLength < MIN_BYTES && res._gzipEnding;
            if (res.statusCode < 200 || res.statusCode === 204 || res.statusCode === 304
                || res.getHeader('Content-Encoding') || !COMPRESSIBLE.test(type) || small) {
                return;
            }
            res.removeHeader('Content-Length');
            res.setHeader('Content-Encoding', 'gzip');
            stream = zlib.createGzip({ level: 6 });
            stream.on('data', (chunk) => write.call(res, chunk));
            stream.on('end', () => end.call(res));
            stream.on('drain', () => res.emit('drain'));
        }

        res.write = function (chunk, encoding, cb) {
            if (!res.headersSent) decide(chunk);
            if (!stream) return write.call(res, chunk, encoding, cb);
            return stream.write(typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk, cb);
        };

        res.end = function (chunk, encoding, cb) {
            if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
            if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
            if (!res.headersSent) {
                res._gzipEnding = true;
                decide(chunk);
            }
            if (!stream) return end.call(res, chunk, encoding, cb);
            if (chunk != null) stream.write(typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk);
            if (cb) stream.once('end', cb);
            stream.end();
            return res;
        };

        next();
    };
}

module.exports = { gzip, acceptsGzip };
