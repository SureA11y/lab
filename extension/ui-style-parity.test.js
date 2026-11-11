'use strict';

// The extension is its own document, but its stylesheet is written to mirror the
// app's: the same type scale, the same spacing, the same palette, so a control
// looks the same in the panel as it does in the tool. Its own header says so.
// Nothing held it to that, and the two had already parted company in places.
//
// What the palette does NOT have to share is intent - the extension picks its
// own accent and focus colour on purpose. Those are listed, not asserted away.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const ROOT = path.resolve(__dirname, '..');
const {readAppCss} = require('../src/css/app-styles');

// The app's stylesheet is in parts (src/css/app-styles.js), read as one.
const APP = 'the app stylesheet';
const cssOf = (file) => (file === APP ? readAppCss() : fs.readFileSync(file, 'utf8'));
const EXT = path.join(__dirname, 'ui.css');

function tokens(file, selectors, atContext) {
    const out = new Map();
    const at = [];
    csstree.walk(csstree.parse(cssOf(file), { onParseError() {} }), {
        enter(node) {
            if (node.type === 'Atrule') at.push('@' + node.name);
            if (node.type === 'Rule' && at.join('>') === atContext
                && selectors.includes(csstree.generate(node.prelude))) {
                node.block.children.forEach((d) => {
                    if (d.type === 'Declaration' && d.property.startsWith('--')) {
                        out.set(d.property, csstree.generate(d.value).trim());
                    }
                });
            }
        },
        leave(node) { if (node.type === 'Atrule') at.pop(); }
    });
    return out;
}

function ruleIndex(file) {
    const out = new Map();
    const at = [];
    csstree.walk(csstree.parse(cssOf(file), { onParseError() {} }), {
        enter(node) {
            if (node.type === 'Atrule') at.push('@' + node.name + ' ' + (node.prelude ? csstree.generate(node.prelude) : ''));
            if (node.type === 'Rule') {
                const key = at.join('|') + '###' + csstree.generate(node.prelude);
                if (!out.has(key)) out.set(key, new Set());
                node.block.children.forEach((d) => {
                    if (d.type === 'Declaration') out.get(key).add(d.property.toLowerCase());
                });
            }
        },
        leave(node) { if (node.type === 'Atrule') at.pop(); }
    });
    return out;
}

const APP_LIGHT = new Map([
    ...tokens(APP, [':root'], ''),
    ...tokens(APP, [':root[data-theme="light"],:root:not([data-theme])'], '')
]);
const APP_DARK = tokens(APP, [':root[data-theme="dark"]'], '');
const EXT_LIGHT = tokens(EXT, [':root'], '');
const EXT_DARK = tokens(EXT, [':root[data-theme="dark"]'], '');
const EXT_AUTO_DARK = tokens(EXT, [':root:not([data-theme])'], '@media');

// The extension chooses these for itself: a second accent for advisory findings,
// a green focus ring, shorter font fallbacks, and its own aliases onto the
// surface ramp. The dark soft tints are still translucent where the app has
// moved to solid; they composite to the same contrast, so this is shape, not
// appearance.
const LIGHT_ALLOWED_TO_DIFFER = [
    '--advisory', '--advisory-soft', '--focus-outline',
    '--font-display', '--font-mono', '--font-sans',
    '--line', '--panel', '--panel2', '--shadow'
];
const DARK_ALLOWED_TO_DIFFER = [
    '--advisory-soft', '--danger-soft', '--info-soft', '--na-soft', '--ok-soft', '--warn-soft'
];

// Shadows are the one pair that is already dark ink in both themes.
const NO_DARK_OVERRIDE_NEEDED = ['--shadow-overlay', '--shadow-popover'];

// Rules both stylesheets define that set different properties. Adding to this is
// a decision; an entry that stops drifting has to come out.
const KNOWN_PROPERTY_DRIFT = [
    "###.example-node",
    "###.impact-critical",
    "###.impact-minor",
    "###.impact-moderate",
    "###.impact-serious",
    "###.instances-meta",
    "###.legend-toggle",
    "###.legend-toggle:focus-visible",
    "###.src-dialog",
    "###.src-dialog-body",
    "###.src-dialog-footer",
    "###.src-dialog-header",
    "###.stream-counts",
    "###.table-container",
    "###.tag-pill",
    "###.theme-switch",
    "###.theme-switch:focus-visible",
    "###.theme-switch:hover:not(:disabled)",
    "###:root",
    "###:root[data-theme=\"dark\"]",
    "###body",
    "###button",
    "###html",
    "@media (prefers-color-scheme:dark)###:root:not([data-theme])",
];

describe('extension stylesheet mirrors the app', () => {
    test('the measurement scales are identical, not merely close', () => {
        const families = ['--fs-', '--space-', '--radius-', '--stroke-', '--duration-', '--ease-'];
        let checked = 0;
        for (const [name, value] of APP_LIGHT) {
            if (!families.some((f) => name.startsWith(f)) || !EXT_LIGHT.has(name)) continue;
            checked++;
            assert.equal(EXT_LIGHT.get(name), value,
                `${name} is ${value} in the app and ${EXT_LIGHT.get(name)} in the extension - the same control would not be the same size in both`);
        }
        assert.ok(checked >= 30, `expected the scales to overlap, compared only ${checked} tokens`);
    });

    test('a light-theme colour the app defines has the same value in the extension', () => {
        for (const [name, value] of APP_LIGHT) {
            if (!EXT_LIGHT.has(name) || LIGHT_ALLOWED_TO_DIFFER.includes(name)) continue;
            assert.equal(EXT_LIGHT.get(name), value, `${name}: app ${value}, extension ${EXT_LIGHT.get(name)}`);
        }
    });

    test('a dark-theme colour the app defines has the same value in the extension', () => {
        for (const [name, value] of APP_DARK) {
            if (!EXT_DARK.has(name) || DARK_ALLOWED_TO_DIFFER.includes(name)) continue;
            assert.equal(EXT_DARK.get(name), value, `${name}: app ${value}, extension ${EXT_DARK.get(name)}`);
        }
    });

    test('the allow-lists carry no token that has since converged', () => {
        for (const name of LIGHT_ALLOWED_TO_DIFFER) {
            if (!APP_LIGHT.has(name) || !EXT_LIGHT.has(name)) continue;
            assert.notEqual(EXT_LIGHT.get(name), APP_LIGHT.get(name),
                `${name} now matches the app - remove it from LIGHT_ALLOWED_TO_DIFFER`);
        }
        for (const name of DARK_ALLOWED_TO_DIFFER) {
            if (!APP_DARK.has(name) || !EXT_DARK.has(name)) continue;
            assert.notEqual(EXT_DARK.get(name), APP_DARK.get(name),
                `${name} now matches the app - remove it from DARK_ALLOWED_TO_DIFFER`);
        }
    });

    test('no shared rule drops a declaration the other sheet sets', () => {
        const app = ruleIndex(APP);
        const ext = ruleIndex(EXT);
        const shared = [...app.keys()].filter((k) => ext.has(k));
        assert.ok(shared.length > 30, `expected the sheets to overlap, found ${shared.length}`);
        for (const key of shared) {
            const a = app.get(key), b = ext.get(key);
            const differs = [...a].some((p) => !b.has(p)) || [...b].some((p) => !a.has(p));
            if (!differs) continue;
            assert.ok(KNOWN_PROPERTY_DRIFT.includes(key),
                `${key.split('###')[1]} sets different properties in the two stylesheets and is not in KNOWN_PROPERTY_DRIFT`);
        }
    });

    test('the known-drift list has no entries that have since converged', () => {
        const app = ruleIndex(APP);
        const ext = ruleIndex(EXT);
        for (const key of KNOWN_PROPERTY_DRIFT) {
            if (!app.has(key) || !ext.has(key)) continue;
            const a = app.get(key), b = ext.get(key);
            const differs = [...a].some((p) => !b.has(p)) || [...b].some((p) => !a.has(p));
            assert.ok(differs, `${key.split('###')[1]} no longer drifts - remove it from KNOWN_PROPERTY_DRIFT`);
        }
    });
});

describe('extension stylesheet themes completely', () => {
    test('every literal colour in the light theme has a dark counterpart', () => {
        for (const [name, value] of EXT_LIGHT) {
            if (/^var\(/.test(value) || !/#|rgb|hsl/.test(value)) continue;
            if (NO_DARK_OVERRIDE_NEEDED.includes(name)) continue;
            assert.ok(EXT_DARK.has(name), `${name} is ${value} in the light theme and is never redefined for dark`);
        }
    });

    test('the explicit and automatic dark themes say the same thing', () => {
        assert.ok(EXT_DARK.size > 20, `expected a populated dark block, found ${EXT_DARK.size}`);
        for (const [name, value] of EXT_DARK) {
            assert.equal(EXT_AUTO_DARK.get(name), value,
                `${name} differs between [data-theme="dark"] and the prefers-color-scheme block, so choosing Dark and following the OS give different results`);
        }
        for (const name of EXT_AUTO_DARK.keys()) {
            assert.ok(EXT_DARK.has(name), `${name} is set for the automatic dark theme but not the explicit one`);
        }
    });
});
