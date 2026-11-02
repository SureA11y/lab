'use strict';

// The report's built styles and script (src/report/*.min.*), which every
// downloaded report and comparison page carries. They are built, not
// committed: `npm start` builds them, but a server started with
// `node server.js` or `npm run start:server`, or the command line, had none,
// and Download report failed with a 404. Whoever needs them builds them here
// the first time, if they are missing; without the build's tools (installed
// with --omit=dev) it says how to build them.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'src', 'report');
const BUILT = ['report.min.js', 'report.min.css', 'comparison.min.css'];
const BUILD_SCRIPT = path.join(ROOT, 'src', 'js', 'build-report-assets.cjs.js');
const HOW = 'npm run build:report';

/** Which built assets are missing, by file name. */
function missingReportAssets(dir = REPORT_DIR) {
    return BUILT.filter((name) => !fs.existsSync(path.join(dir, name)));
}

/**
 * Builds the report's assets when one is missing. -> { built, missing, error }:
 * `built` when it built them now, `missing` what is still missing after, and
 * `error` why, where the build failed.
 */
function ensureReportAssets({ dir = REPORT_DIR, run = spawnSync } = {}) {
    if (!missingReportAssets(dir).length) return { built: false, missing: [], error: null };
    const out = run(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    const missing = missingReportAssets(dir);
    if (!missing.length) return { built: true, missing, error: null };
    const why = String((out && (out.stderr || (out.error && out.error.message))) || '').trim().split('\n').pop() || 'the build failed';
    return { built: false, missing, error: `${why}. Build them with ${HOW}.` };
}

module.exports = { ensureReportAssets, missingReportAssets, HOW_TO_BUILD: HOW };
