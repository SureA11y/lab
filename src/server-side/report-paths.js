const path = require('path');

// Project root = one level up from /server-side
const rootDir = path.join(__dirname, '..');

/**
 * Where reports, evidence, element pictures and the queue's batches are
 * written, and what the server serves at /reports: A11Y_REPORTS_ROOT (a path
 * from the lab's folder, or absolute), else the lab's reports/ folder. Every
 * part of the lab reads it here: the setting was read by one writer alone,
 * which put its files where the server did not serve them.
 */
function reportsRootFrom(env = process.env) {
    const given = String(env.A11Y_REPORTS_ROOT || '').trim();
    return given ? path.resolve(rootDir, '..', given) : path.join(rootDir, '..', 'reports');
}

const REPORTS_ROOT = reportsRootFrom();

module.exports = {
    rootDir,
    REPORTS_ROOT,
    reportsRootFrom,
};
