'use strict';

/**
 * Builds the browser extension for each browser it runs in: dist/extension/
 * chrome/ and dist/extension/firefox/, each the extension's files with that
 * browser's manifest as manifest.json, ready to load unpacked or to package.
 * The shared modules are copied in first (build:extension-shared), so a build
 * never carries stale ones. Tests stay behind.
 *
 *   npm run build:extension
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist', 'extension');
const BROWSERS = { chrome: 'manifest.chrome.json', firefox: 'manifest.firefox.json' };

const IS_TEST = /\.(test|dom\.test|browserspec)\.js$/;
const IS_MANIFEST = /^manifest(\.\w+)?\.json$/;

function copyTree(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (IS_TEST.test(entry.name) || IS_MANIFEST.test(entry.name)) continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) copyTree(source, target);
        else fs.copyFileSync(source, target);
    }
}

function main() {
    execFileSync(process.execPath, [path.join(__dirname, 'copy-shared-to-extension.cjs.js')], { stdio: 'inherit' });
    for (const [browser, manifest] of Object.entries(BROWSERS)) {
        const out = path.join(DIST, browser);
        fs.rmSync(out, { recursive: true, force: true });
        copyTree(SOURCE, out);
        fs.copyFileSync(path.join(SOURCE, manifest), path.join(out, 'manifest.json'));
        console.log(`Built ${path.relative(ROOT, out)}`);
    }
}

main();
