'use strict';

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const CleanCSS = require('clean-css');

const REPORT_DIR = path.join(__dirname, '..', 'report');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const APP_CSS = path.join(__dirname, '..', 'css', 'a11y-lab-ui.css');

// The exported comparison reuses the app's Compare-tab styles rather than a
// mirrored copy, so the two can't drift. a11y-lab-ui.css delimits that block.
const COMPARE_START = '/* compare:start';
const COMPARE_END = '/* compare:end */';

/*
 * The self-hosted SureA11y brand faces used by the app UI (src/css/a11y-lab-ui.css).
 * The exported report is a standalone document with no access to the app's font
 * files, so we base64-embed the woff2 as @font-face rules straight into
 * report.min.css. That keeps the export self-contained in BOTH shapes — the
 * single inlined HTML and the zip (the zip exporter only extracts data:image
 * URLs, so these font data URLs simply travel inside styles/report.css).
 *
 * Only the weights the report actually needs are embedded, to keep the payload
 * small (~120 KB of woff2 total across all faces).
 */
const EMBEDDED_FONTS = [
    { family: 'Space Grotesk', weight: 400, file: 'space-grotesk/SpaceGrotesk-Regular.woff2' },
    { family: 'Space Grotesk', weight: 500, file: 'space-grotesk/SpaceGrotesk-Medium.woff2' },
    { family: 'Space Grotesk', weight: 700, file: 'space-grotesk/SpaceGrotesk-Bold.woff2' },
    { family: 'IBM Plex Mono', weight: 400, file: 'ibm-plex-mono/IBMPlexMono-Regular.woff2' },
    { family: 'IBM Plex Mono', weight: 500, file: 'ibm-plex-mono/IBMPlexMono-Medium.woff2' },
    { family: 'IBM Plex Mono', weight: 600, file: 'ibm-plex-mono/IBMPlexMono-SemiBold.woff2' },
    { family: 'Public Sans', weight: 400, file: 'public-sans/PublicSans-Regular.woff2' },
    { family: 'Public Sans', weight: 600, file: 'public-sans/PublicSans-SemiBold.woff2' }
];

function buildEmbeddedFontFaceCss() {
    return EMBEDDED_FONTS
        .map(({ family, weight, file }) => {
            const fontPath = path.join(FONTS_DIR, file);

            if (!fs.existsSync(fontPath)) {
                throw new Error(`Missing brand font: ${fontPath}`);
            }

            const base64 = fs.readFileSync(fontPath).toString('base64');

            return (
                '@font-face{' +
                `font-family:"${family}";` +
                'font-style:normal;' +
                `font-weight:${weight};` +
                'font-display:swap;' +
                `src:url(data:font/woff2;base64,${base64}) format("woff2");` +
                '}'
            );
        })
        .join('\n');
}

function extractComparisonCss() {
    if (!fs.existsSync(APP_CSS)) {
        throw new Error(`Missing file: ${APP_CSS}`);
    }

    const appCss = fs.readFileSync(APP_CSS, 'utf8');
    const startMarker = appCss.indexOf(COMPARE_START);
    const endMarker = appCss.indexOf(COMPARE_END);

    if (startMarker === -1 || endMarker === -1 || endMarker < startMarker) {
        throw new Error(
            `Could not find the ${COMPARE_START} / ${COMPARE_END} markers in ` +
            `${path.relative(path.join(__dirname, '..', '..'), APP_CSS)}`
        );
    }

    const blockStart = appCss.indexOf('*/', startMarker);
    return appCss.slice(blockStart + 2, endMarker).trim();
}

async function buildReportAssets() {
    // ---- JS (minify + uglify) ----
    const jsInPath = path.join(REPORT_DIR, 'report.js');
    const jsOutPath = path.join(REPORT_DIR, 'report.min.js');

    const jsZipSource = path.resolve(
        'node_modules/jszip/dist/jszip.min.js'
    );

    const jsZipDestination = path.resolve(
        'src/report/jszip.min.js'
    );

    if (!fs.existsSync(jsZipSource)) {
        throw new Error(
            `JSZip was not found at: ${jsZipSource}. ` +
            'Run "yarn install" or "npm install" first.'
        );
    }

    fs.copyFileSync(jsZipSource, jsZipDestination);

    console.log(
        '✔ jszip.min.js copied to src/report'
    );

    if (!fs.existsSync(jsInPath)) {
        throw new Error(`Missing file: ${jsInPath}`);
    }

    // Shared modules the exported report runs at runtime, prepended so their
    // globals (A11Y_SCAN_SORT, A11Y_TOAST) exist before report.js uses them.
    const sharedModules = [
        path.join(__dirname, '..', 'shared', 'scan-sort.js'),
        path.join(__dirname, '..', 'shared', 'toast.js'),
        // Order matters: the view module reads the analysis module's global.
        path.join(__dirname, '..', 'shared', 'issue-dispersion.js'),
        path.join(__dirname, '..', 'shared', 'issue-dispersion-view.js')
    ];
    const sharedCode = sharedModules
        .map((p) => {
            if (!fs.existsSync(p)) throw new Error(`Missing shared module: ${p}`);
            return fs.readFileSync(p, 'utf8');
        })
        .join('\n');

    const jsCode = sharedCode + '\n' + fs.readFileSync(jsInPath, 'utf8');

    const jsMinified = await minify(jsCode, {
        compress: true,
        mangle: true,
        format: { comments: false }
    });

    if (!jsMinified || !jsMinified.code) {
        throw new Error('Terser failed to produce output.');
    }

    fs.writeFileSync(jsOutPath, jsMinified.code, 'utf8');

    // ---- CSS (minify) ----
    const cssInPath = path.join(REPORT_DIR, 'report.css');
    const cssOutPath = path.join(REPORT_DIR, 'report.min.css');

    if (!fs.existsSync(cssInPath)) {
        throw new Error(`Missing file: ${cssInPath}`);
    }

    const cssCode = fs.readFileSync(cssInPath, 'utf8');
    const cssMinified = new CleanCSS({ level: 2 }).minify(cssCode);

    if (cssMinified.errors.length) {
        throw new Error(`CleanCSS errors: ${cssMinified.errors.join(' , ')}`);
    }

    // Prepend the base64-embedded brand @font-face rules so the exported
    // report renders in Space Grotesk / Public Sans / IBM Plex Mono with no
    // external requests. Kept out of report.css itself to keep that source
    // hand-editable; the huge data URLs live only in the generated output.
    const fontFaceCss = buildEmbeddedFontFaceCss();

    fs.writeFileSync(
        cssOutPath,
        `${fontFaceCss}\n${cssMinified.styles}`,
        'utf8'
    );

    // ---- Comparison CSS (extracted from the app stylesheet, then minified) ----
    const comparisonCss = extractComparisonCss();
    const comparisonMinified = new CleanCSS({ level: 2 }).minify(comparisonCss);

    if (comparisonMinified.errors.length) {
        throw new Error(`CleanCSS errors: ${comparisonMinified.errors.join(' , ')}`);
    }

    fs.writeFileSync(
        path.join(REPORT_DIR, 'comparison.min.css'),
        comparisonMinified.styles,
        'utf8'
    );

    console.log(
        `✔ report.min.js, report.min.css and comparison.min.css generated in ` +
        `src/report (${EMBEDDED_FONTS.length} brand fonts embedded)`
    );
}

buildReportAssets().catch((err) => {
    console.error('✖ Build failed:', err);
    process.exitCode = 1;
});