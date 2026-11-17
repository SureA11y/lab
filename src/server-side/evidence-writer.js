'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The writer behind ctx.saveEvidenceFile: PNG and MHTML files under
 * `<baseDir>[/<dir>]`, with the URL they are served at.
 *
 * A file written with `unique: true` (the Save evidence step) never replaces
 * another: its name is claimed atomically, and when it is taken the file gets
 * `__2`, `__3`... before its extension. File names carry counters that restart
 * in every loop and every scan, so the same name comes up again and again
 * (an unlabeled step is always "Evidence"); without this, each scan's files
 * replaced the last one's and only the final scan's evidence was left.
 *
 * Without `unique` a file is written over what is there: element pictures are
 * named by their content, so the same picture is the same file.
 */
function createEvidenceWriter({baseDir, safeDirPart, ensureDirSync, toPublicUrl}) {
    const MAX_TRIES = 10000;

    function withSuffix(file, n) {
        const ext = path.extname(file);
        return `${file.slice(0, file.length - ext.length)}__${n}${ext}`;
    }

    // Writes `bytes` to a name that was free, and returns the path used.
    async function writeClaimingName(outDir, file, bytes) {
        for (let n = 1; n <= MAX_TRIES; n++) {
            const outPath = path.join(outDir, n === 1 ? file : withSuffix(file, n));
            let handle;
            try {
                handle = await fs.promises.open(outPath, 'wx');
            } catch (e) {
                if (e && e.code === 'EEXIST') continue;
                throw e;
            }
            try {
                await handle.writeFile(bytes);
            } finally {
                await handle.close();
            }
            return outPath;
        }
        throw new Error(`no free name for evidence file ${file} after ${MAX_TRIES} tries`);
    }

    return async function saveEvidenceFile({variant, data, filename, dir, url, meta, unique} = {}) {
        const v = String(variant || '').trim().toLowerCase();
        const sub = safeDirPart(dir);
        const outDir = sub ? path.join(baseDir, sub) : baseDir;

        // Create dir lazily, only when we actually write something
        ensureDirSync(outDir);

        const file = safeDirPart(filename) || `evidence-${Date.now()}.${v === 'mhtml' ? 'mhtml' : 'png'}`;

        let bytes;
        if (v === 'mhtml') {
            bytes = Buffer.from(data == null ? '' : String(data), 'utf8');
        } else {
            // default png
            bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
        }

        let outPath;
        if (unique === true) {
            outPath = await writeClaimingName(outDir, file, bytes);
        } else {
            outPath = path.join(outDir, file);
            await fs.promises.writeFile(outPath, bytes);
        }

        return {
            path: outPath,
            publicUrl: toPublicUrl(outPath),
            bytes: bytes.length,
            url: url || null,
            meta: meta || null
        };
    };
}

module.exports = {createEvidenceWriter};
