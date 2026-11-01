const path = require('path');

// Project root = one level up from /server-side
const rootDir = path.join(__dirname, '..');

// Base reports folder: public/reports
const REPORTS_ROOT = path.join(rootDir, '..', 'reports');

module.exports = {
    rootDir,
    REPORTS_ROOT,
};
