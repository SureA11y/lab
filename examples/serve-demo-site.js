'use strict';

/**
 * Serves the demo shop the examples run against:
 *
 *   http://localhost:8780/   release 1
 *   http://localhost:8781/   release 2: some problems fixed, one new
 *
 * Release 2 is on its own port, at the same paths, as a staging copy of a site
 * would be: a comparison then matches each page, and each element, with its
 * counterpart, as it does between staging and live.
 *
 *   node examples/serve-demo-site.js
 *   PORT=9000 node examples/serve-demo-site.js   # 9000 and 9001
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, 'demo-site');
const PORT = Number(process.env.PORT) || 8780;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

/** A file of the release, or of the shop's shared files (styles, script, images). */
function find(roots, pathname) {
    for (const root of roots) {
        const file = path.normalize(path.join(root, pathname));
        if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
    return null;
}

function serve(roots) {
    return http.createServer((req, res) => {
        let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = find(roots, pathname);
        if (!file) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
}

const release1 = serve([SITE]).listen(PORT);
const release2 = serve([path.join(SITE, 'release-2'), SITE]).listen(PORT + 1, () => {
    console.log(`Demo shop: release 1 on http://localhost:${PORT}/, release 2 on http://localhost:${PORT + 1}/. Ctrl+C to stop.`);
});

module.exports = { release1, release2 };
