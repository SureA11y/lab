'use strict';

// The tiers only stay separate if something checks. Node-side code reaching into
// browser code is how the runner ended up importing the app's utils, and copies
// of one table are how the metric definitions drifted.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const NODE_TIERS = ['server-side', 'workflow', 'cli'];
const SHARED = 'shared';
const APP = 'js';

// Build scripts are tooling: they read from every tier by definition.
const IS_BUILD_SCRIPT = /\.cjs\.js$/;
const IS_TEST = /\.(test|browserspec|dom\.test)\.js$/;

function listJsFiles(dir) {
    const out = [];
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) out.push(full);
        }
    };
    walk(dir);
    return out;
}

function sourceFilesOf(tier) {
    return listJsFiles(path.join(ROOT, tier))
        .filter((file) => !IS_TEST.test(path.basename(file)))
        .filter((file) => !IS_BUILD_SCRIPT.test(path.basename(file)));
}

function importsOf(file) {
    const text = fs.readFileSync(file, 'utf8');
    const specifiers = [];
    const patterns = [
        /require\(\s*['"]([^'"]+)['"]\s*\)/g,
        /(?:^|\s)from\s+['"]([^'"]+)['"]/g,
        /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) specifiers.push(match[1]);
    }

    return specifiers;
}

function resolvesInto(file, specifier, tier) {
    if (!specifier.startsWith('.')) return false;
    const target = path.resolve(path.dirname(file), specifier);
    return target.startsWith(path.join(ROOT, tier) + path.sep);
}

function crossings(fromTiers, intoTier) {
    const found = [];
    for (const tier of fromTiers) {
        for (const file of sourceFilesOf(tier)) {
            for (const specifier of importsOf(file)) {
                if (resolvesInto(file, specifier, intoTier)) {
                    found.push(`${path.relative(ROOT, file)} -> ${specifier}`);
                }
            }
        }
    }
    return found;
}

describe('tier boundaries', () => {
    test('the runner, the engine and the cli never import browser code', () => {
        assert.deepEqual(crossings(NODE_TIERS, APP), []);
    });

    test('shared code depends on nothing outside shared', () => {
        const found = [];
        for (const file of sourceFilesOf(SHARED)) {
            for (const specifier of importsOf(file)) {
                if (!specifier.startsWith('.')) continue;
                const target = path.resolve(path.dirname(file), specifier);
                if (!target.startsWith(path.join(ROOT, SHARED) + path.sep)) {
                    found.push(`${path.relative(ROOT, file)} -> ${specifier}`);
                }
            }
        }
        assert.deepEqual(found, []);
    });

    test('browser code never imports the runner or the engine', () => {
        const appFiles = listJsFiles(path.join(ROOT, APP))
            .filter((file) => !IS_BUILD_SCRIPT.test(path.basename(file)))
            .filter((file) => !IS_TEST.test(path.basename(file)));

        const found = [];
        for (const file of appFiles) {
            for (const specifier of importsOf(file)) {
                for (const tier of ['server-side', 'workflow']) {
                    if (resolvesInto(file, specifier, tier)) {
                        found.push(`${path.relative(ROOT, file)} -> ${specifier}`);
                    }
                }
            }
        }
        assert.deepEqual(found, []);
    });
});

describe('one table for the viewport presets', () => {
    const { VIEWPORT_PRESETS, viewportPresetOptions } = require('./scan-inputs.js');

    test('the page offers exactly the presets the table defines', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const select = /<select id="viewport-preset"[^>]*>([\s\S]*?)<\/select>/.exec(html);
        assert.ok(select, 'the page has a viewport preset select');

        const offered = [...select[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)]
            .map(([, value, label]) => ({ value, label: label.trim() }));

        assert.deepEqual(offered, viewportPresetOptions());
    });

    test('the setViewport action offers the same presets, plus a custom size', () => {
        const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
        const options = ACTION_DEFINITIONS.setViewport.fields.preset.options;

        assert.deepEqual(options, viewportPresetOptions({ includeCustom: true }));
    });

    test('both guides quote the sizes the table gives', () => {
        const docs = path.join(ROOT, '..', 'docs');

        for (const file of ['scheduled-scans-guide.md', 'unattended-scans.html']) {
            const text = fs.readFileSync(path.join(docs, file), 'utf8');

            for (const [key, preset] of Object.entries(VIEWPORT_PRESETS)) {
                assert.ok(text.includes(key), `${file} lists the ${key} preset`);
                assert.ok(
                    text.includes(`${preset.width} × ${preset.height}`),
                    `${file} gives ${key} as ${preset.width} × ${preset.height}`
                );
            }
        }
    });

    test('the engine resolves a preset to the size the table gives', () => {
        const { buildViewportFromPreset } = require('../workflow/workflow-engine.js');

        for (const [key, preset] of Object.entries(VIEWPORT_PRESETS)) {
            assert.deepEqual(buildViewportFromPreset(key), { width: preset.width, height: preset.height });
        }
        assert.equal(buildViewportFromPreset('nope'), null);
    });
});

describe('one list of profiles', () => {
    const { SCAN_TARGETS, DEFAULT_SCAN_TARGET } = require('./conformance-targets.js');
    const PROFILES = Object.entries(SCAN_TARGETS).map(([value, t]) => ({ value, label: t.label }));

    test('the run settings have no profile: each scan step chooses its own', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.doesNotMatch(html, /id="run-profile"/);
    });

    test('a scan step offers every profile, the default one chosen', () => {
        const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
        const field = ACTION_DEFINITIONS.a11yScan.fields.profile;
        assert.equal(field.default, DEFAULT_SCAN_TARGET);
        assert.deepEqual(field.options, PROFILES);
    });

    test('the extension offers every profile: a WCAG level, or none, and the standards', () => {
        // As the scan step does: the WCAG levels as radios, WCAG 2.2 AA
        // chosen, the standards as checkboxes (a pack's are added at start).
        const html = fs.readFileSync(path.join(ROOT, '..', 'extension', 'ui.html'), 'utf8');
        const inputs = (name) => [...html.matchAll(new RegExp(`<input type="(radio|checkbox)" name="${name}" value="([^"]*)"([^>]*)>`, 'g'))]
            .map(([, , value, rest]) => ({ value, checked: /\bchecked\b/.test(rest) }));
        const levels = inputs('profileWcag');
        const standards = inputs('profileStandard');
        assert.deepEqual([...levels.map((i) => i.value).filter(Boolean), ...standards.map((i) => i.value)],
            PROFILES.map((p) => p.value));
        assert.ok(levels.some((i) => i.value === ''), 'and Don\'t check WCAG');
        assert.deepEqual(levels.filter((i) => i.checked).map((i) => i.value), [DEFAULT_SCAN_TARGET]);
    });
});

describe('the extension\'s copies of shared modules', () => {
    // The extension cannot load from src/shared, so build:extension-shared
    // copies these in. A copy left behind runs old code there: its profile
    // picker once read a field the copy no longer had.
    test('are the same as their sources (run `npm run build:extension-shared` if this fails)', () => {
        const extensionDir = path.join(ROOT, '..', 'extension');
        const stale = fs.readdirSync(path.join(ROOT, SHARED))
            .filter((name) => name.endsWith('.js') && !IS_TEST.test(name))
            .filter((name) => fs.existsSync(path.join(extensionDir, name)))
            .filter((name) => fs.readFileSync(path.join(ROOT, SHARED, name), 'utf8') !== fs.readFileSync(path.join(extensionDir, name), 'utf8'));
        assert.deepEqual(stale, []);
    });
});
