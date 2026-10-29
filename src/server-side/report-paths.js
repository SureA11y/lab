const path = require('path');

// Project root = one level up from /server-side
const rootDir = path.join(__dirname, '..');

// Base reports folder: public/reports
const REPORTS_ROOT = path.join(rootDir, '..', 'reports');

// Subfolders for specific engines and contexts
const AXE_REPORTS_ROOT       = path.join(REPORTS_ROOT, 'axe');
const UNIT_AXE_REPORTS_ROOT  = path.join(REPORTS_ROOT, 'unit', 'axe');
const E2E_CYPRESS_REPORTS_ROOT = path.join(REPORTS_ROOT, 'e2e', 'cypress');

module.exports = {
    rootDir,
    REPORTS_ROOT,
    AXE_REPORTS_ROOT,
    UNIT_AXE_REPORTS_ROOT,
    E2E_CYPRESS_REPORTS_ROOT,
};
