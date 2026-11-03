'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { minify } = require('terser');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// -------------------- Sources of truth --------------------

// Shared workflow payload builder + deps
const SRC_WORKFLOW_BUILDER = path.join(PROJECT_ROOT, 'src', 'shared', 'workflow-payload-builder.js');
const DEST_WORKFLOW_BUILDER = path.join(PROJECT_ROOT, 'extension', 'workflow-payload-builder.js');

const SRC_METRIC_DEFS = path.join(PROJECT_ROOT, 'src', 'shared', 'a11y-metric-defs.js');
const DEST_METRIC_DEFS = path.join(PROJECT_ROOT, 'extension', 'a11y-metric-defs.js');

const SRC_WORKFLOW_DEPS = path.join(PROJECT_ROOT, 'src', 'shared', 'workflow-payload-deps.js');
const DEST_WORKFLOW_DEPS = path.join(PROJECT_ROOT, 'extension', 'workflow-payload-deps.js');

// Issue dispersion ("Where the failures are"): analysis + view, in that load order
const SRC_DISPERSION = path.join(PROJECT_ROOT, 'src', 'shared', 'issue-dispersion.js');
const DEST_DISPERSION = path.join(PROJECT_ROOT, 'extension', 'issue-dispersion.js');
const SRC_DISPERSION_VIEW = path.join(PROJECT_ROOT, 'src', 'shared', 'issue-dispersion-view.js');
const DEST_DISPERSION_VIEW = path.join(PROJECT_ROOT, 'extension', 'issue-dispersion-view.js');

// Notes, margins and details read from a surea11y result, shared with the server adapter
const SRC_SCAN_NOTES = path.join(PROJECT_ROOT, 'src', 'shared', 'scan-notes.js');
const DEST_SCAN_NOTES = path.join(PROJECT_ROOT, 'extension', 'scan-notes.js');

// The conformance targets (WCAG levels and standards) a scan can check against
const SRC_CONFORMANCE_TARGETS = path.join(PROJECT_ROOT, 'src', 'shared', 'conformance-targets.js');
// What a report's scan checked against, read alike from old and new reports
const SRC_REPORT_SCAN = path.join(PROJECT_ROOT, 'src', 'shared', 'report-scan.js');
// Boxes that scroll, reachable by keyboard while they do
const SRC_SCROLL_REACH = path.join(PROJECT_ROOT, 'src', 'shared', 'scroll-reach.js');
const DEST_SCROLL_REACH = path.join(PROJECT_ROOT, 'extension', 'scroll-reach.js');
const DEST_REPORT_SCAN = path.join(PROJECT_ROOT, 'extension', 'report-scan.js');
const SRC_REPORT_FORMAT = path.join(PROJECT_ROOT, 'src', 'shared', 'report-format.js');
const DEST_REPORT_FORMAT = path.join(PROJECT_ROOT, 'extension', 'report-format.js');
const DEST_CONFORMANCE_TARGETS = path.join(PROJECT_ROOT, 'extension', 'conformance-targets.js');

const SRC_CANONICAL = path.join(PROJECT_ROOT, 'src', 'shared', 'canonical-shared.js');
const DEST_CANONICAL = path.join(PROJECT_ROOT, 'extension', 'canonical-shared.js');


// surea11y source of truth
const SRC_A11Y_LABS = path.join(PROJECT_ROOT, 'node_modules', '@surea11y', 'core', 'src', 'core.js');

// Browser-ready minified bundle used by the extension adapter
const DEST_A11Y_LABS_BROWSER = path.join(PROJECT_ROOT, 'extension', 'engines' , 'vendor', 'surea11y.browser.min.js');

// Core's browser-safe how-to-check entry (applyHowToCheck), bundled for the
// extension's own pages, which add a question's steps to a result after the
// scan as the binding does in Node; and the review dictionary it reads, the
// English one, since the extension scans in English.
const SRC_HOW_TO_CHECK = path.join(PROJECT_ROOT, 'node_modules', '@surea11y', 'core', 'src', 'how-to-check-core.js');
const DEST_HOW_TO_CHECK = path.join(PROJECT_ROOT, 'extension', 'engines', 'vendor', 'surea11y-how-to-check.min.js');
// The installed packs, for the extension: a script that registers them in a
// page after the bundle, and their standards, which the panel offers as
// profiles. Built from the packs installed here (server-side/standard-packs.js:
// the lab's dependencies, surea11y's own packs wherever installed, and
// A11Y_PACKS), so they are not kept in git.
const DEST_PACKS_SCRIPT = path.join(PROJECT_ROOT, 'extension', 'engines', 'vendor', 'surea11y-packs.js');
const DEST_STANDARDS = path.join(PROJECT_ROOT, 'extension', 'engines', 'vendor', 'standards.json');
const SRC_REVIEW_EN = path.join(PROJECT_ROOT, 'node_modules', '@surea11y', 'core', 'src', 'i18n', 'review', 'en.json');
const DEST_REVIEW_EN = path.join(PROJECT_ROOT, 'extension', 'engines', 'vendor', 'review', 'en.json');

// Self-hosted brand webfonts (SureA11y design system)
const SRC_FONTS_DIR = path.join(PROJECT_ROOT, 'src', 'fonts');
const DEST_FONTS_DIR = path.join(PROJECT_ROOT, 'extension', 'fonts');

function ensureDirForFile(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function copyFile(src, dest) {
    if (!fs.existsSync(src)) {
        throw new Error(`Source file does not exist: ${src}`);
    }
    ensureDirForFile(dest);
    fs.copyFileSync(src, dest);
    console.log(`✔ Copied: ${path.relative(PROJECT_ROOT, src)} -> ${path.relative(PROJECT_ROOT, dest)}`);
}

function copyDirRecursive(src, dest) {
    if (!fs.existsSync(src)) {
        throw new Error(`Source directory does not exist: ${src}`);
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
    console.log(`✔ Copied dir: ${path.relative(PROJECT_ROOT, src)} -> ${path.relative(PROJECT_ROOT, dest)}`);
}

function buildRequireEntrySource(relImport, wrapperSource) {
    return `'use strict';\nconst api = require(${JSON.stringify(relImport)});\n\n${wrapperSource}`;
}

async function buildBrowserBundle({
                                      src,
                                      dest,
                                      entrySourcefile,
                                      wrapperSource,
                                      missingSourceLabel,
                                      bundleLabel
                                  }) {
    if (!fs.existsSync(src)) {
        throw new Error(`${missingSourceLabel || 'Source'} file does not exist: ${src}`);
    }

    ensureDirForFile(dest);

    const relImport = './' + path.relative(PROJECT_ROOT, src).replace(/\\/g, '/');
    const entryContents = buildRequireEntrySource(relImport, wrapperSource);

    const buildResult = await esbuild.build({
        absWorkingDir: PROJECT_ROOT,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        target: ['firefox115', 'chrome115'],
        write: false,
        logLevel: 'silent',
        stdin: {
            resolveDir: PROJECT_ROOT,
            sourcefile: entrySourcefile || 'browser-entry.js',
            contents: entryContents
        }
    });

    const bundledCode = buildResult.outputFiles[0].text;

    const minified = await minify(bundledCode, {
        compress: true,
        mangle: true,
        format: {
            comments: false
        }
    });

    if (!minified || !minified.code) {
        throw new Error(`Terser did not return minified code for ${bundleLabel || 'browser'} bundle`);
    }

    fs.writeFileSync(dest, minified.code, 'utf8');

    console.log(`✔ Built and minified browser bundle: ${path.relative(PROJECT_ROOT, dest)}`);
}

// The @surea11y/core release the bundle is built from. Core keeps it off
// its exports and puts it on each result (engine.version), so the panel
// would otherwise only know it once a scan has run.
function readCoreVersionSafe() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'node_modules', '@surea11y', 'core', 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
    } catch {
        return null;
    }
}

const HOW_TO_CHECK_WRAPPER_SOURCE = `
globalThis.A11Y_HOW_TO_CHECK = {
    applyHowToCheck: api.applyHowToCheck,
    reviewGroupOf: api.reviewGroupOf,
    occurrenceOutcome: api.occurrenceOutcome
};
`;

const A11Y_LABS_WRAPPER_SOURCE = `
function getCompositeRulesCatalog() {
    if (typeof api.getCompositeRulesCatalog === 'function') {
        return api.getCompositeRulesCatalog();
    }
    if (api.COMPOSITE_RULES && typeof api.COMPOSITE_RULES === 'object') {
        return Object.values(api.COMPOSITE_RULES);
    }
    return [];
}

globalThis.A11Y_LABS_BROWSER = {
    // The core release, not SCHEMA_VERSION: that is the result format's
    // version, which stays the same across releases.
    version: ${JSON.stringify(readCoreVersionSafe())},
    VERSION: ${JSON.stringify(readCoreVersionSafe())},
    SCHEMA_VERSION: api.SCHEMA_VERSION || null,
    ENGINE_TAG: api.ENGINE_TAG || '@surea11y',

    runa11yCoreInPage:
        api.runa11yCoreInPage ||
        api.runA11yCoreInPage ||
        api.runInPage,

    runA11yCoreInPage:
        api.runA11yCoreInPage ||
        api.runa11yCoreInPage ||
        api.runInPage,

    runInPage:
        api.runInPage ||
        api.runa11yCoreInPage ||
        api.runA11yCoreInPage,

    getChecksCatalog:
        api.getChecksCatalog ||
        api.getRulesCatalog,

    getRulesCatalog:
        api.getRulesCatalog ||
        api.getChecksCatalog,

    getCompositeRulesCatalog,

    COMPOSITE_RULES: api.COMPOSITE_RULES || {},

    raw: api
};
`;

/**
 * The packs' script and standards, from the packs installed here, with the
 * core the bundle is built from: a page running another core refuses a pack
 * script. Without packs, neither file, and the extension offers core's own
 * profiles.
 */
function writePacks() {
    const { loadPacks, describeStandard } = require('../server-side/standard-packs.js');
    const { names, packs } = loadPacks();
    for (const file of [DEST_PACKS_SCRIPT, DEST_STANDARDS]) fs.rmSync(file, { force: true });
    if (!packs.length) {
        console.log('✔ No packs installed: the extension offers core\'s own profiles');
        return;
    }
    const { packScript } = require('@surea11y/core/pack');
    fs.mkdirSync(path.dirname(DEST_PACKS_SCRIPT), { recursive: true });
    fs.writeFileSync(DEST_PACKS_SCRIPT, packScript(packs), 'utf8');
    // The names a scan gives core (engineOptions.packs): each pack's name
    // and version, as the script registers them.
    const packNames = packs
        .filter((p) => p && typeof p.name === 'string' && p.name)
        .map((p) => (p.version ? `${p.name}@${p.version}` : p.name));
    const standards = packs.map(describeStandard).filter(Boolean)
        .map((s) => ({ key: s.key, name: s.name, package: s.package, versions: s.versions, profiles: s.profiles }));
    fs.writeFileSync(DEST_STANDARDS, JSON.stringify({ packs: packNames, standards }, null, 1) + '\n', 'utf8');
    console.log(`✔ Wrote the packs for the extension: ${names.join(', ')}`);
}

(async () => {
    try {
        copyFile(SRC_CANONICAL, DEST_CANONICAL);
        copyFile(SRC_WORKFLOW_BUILDER, DEST_WORKFLOW_BUILDER);
        copyFile(SRC_METRIC_DEFS, DEST_METRIC_DEFS);
        copyFile(SRC_WORKFLOW_DEPS, DEST_WORKFLOW_DEPS);
        copyFile(SRC_DISPERSION, DEST_DISPERSION);
        copyFile(SRC_DISPERSION_VIEW, DEST_DISPERSION_VIEW);
        copyFile(SRC_SCAN_NOTES, DEST_SCAN_NOTES);
        copyFile(SRC_CONFORMANCE_TARGETS, DEST_CONFORMANCE_TARGETS);
        copyFile(SRC_REPORT_SCAN, DEST_REPORT_SCAN);
        copyFile(SRC_SCROLL_REACH, DEST_SCROLL_REACH);
        copyFile(SRC_REPORT_FORMAT, DEST_REPORT_FORMAT);


        copyDirRecursive(SRC_FONTS_DIR, DEST_FONTS_DIR);

        // Browser-ready minified bundle for the extension runtime
        await buildBrowserBundle({
            src: SRC_A11Y_LABS,
            dest: DEST_A11Y_LABS_BROWSER,
            entrySourcefile: 'surea11y-browser-entry.js',
            wrapperSource: A11Y_LABS_WRAPPER_SOURCE,
            missingSourceLabel: 'surea11y source',
            bundleLabel: 'surea11y browser'
        });

        await buildBrowserBundle({
            src: SRC_HOW_TO_CHECK,
            dest: DEST_HOW_TO_CHECK,
            entrySourcefile: 'surea11y-how-to-check-entry.js',
            wrapperSource: HOW_TO_CHECK_WRAPPER_SOURCE,
            missingSourceLabel: 'surea11y how-to-check source',
            bundleLabel: 'surea11y how-to-check'
        });
        copyFile(SRC_REVIEW_EN, DEST_REVIEW_EN);

        writePacks();

    } catch (err) {
        console.error('✖ Failed to sync files to extension');
        console.error(err);
        process.exit(1);
    }
})();
