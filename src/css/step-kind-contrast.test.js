'use strict';

// A step's kind, above its title ("Get text into variable"), is small text in
// the softest text colour: lighter than the title, so the eye passes over it,
// and still at least 4.5:1 (WCAG 1.4.3, AA, for text this small) on every
// surface a step's card has: a step (--surface-base), a nested one
// (--surface-raised), and one nested deeper (--surface-overlay), in the light
// theme and in the dark one, chosen or the system's. Read from the
// stylesheets, so a token changed later is checked as well.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {readAppCss} = require('./app-styles');

const TOKENS = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');

// The body of the first block opened by `prelude`, braces balanced.
function blockAfter(css, prelude) {
    const at = css.indexOf(prelude);
    assert.ok(at >= 0, `${prelude} is in tokens.css`);
    const open = css.indexOf('{', at + prelude.length - 1);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
    }
    throw new Error(`${prelude} is not closed`);
}

// A token's value in a theme's block, its var() references followed.
function token(block, name, seen = new Set()) {
    assert.ok(!seen.has(name), `--${name} does not refer to itself`);
    seen.add(name);
    const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`)) || TOKENS.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(m, `--${name} is defined`);
    const value = m[1].trim();
    const ref = value.match(/^var\(--([\w-]+)\)$/);
    return ref ? token(block, ref[1], seen) : value;
}

function luminance(hex) {
    const h = hex.replace('#', '');
    assert.match(h, /^[0-9a-f]{6}$/i, `${hex} is a six-digit colour`);
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
    light: blockAfter(TOKENS, ':root[data-theme="light"],\n:root:not([data-theme]) {'),
    dark: blockAfter(TOKENS, ':root[data-theme="dark"] {'),
    'system dark': blockAfter(blockAfter(TOKENS, '@media (prefers-color-scheme: dark) {'), ':root:not([data-theme]) {'),
};
const SURFACES = ['surface-base', 'surface-raised', 'surface-overlay'];

describe("a step's kind", () => {
    test('is in the softest text colour', () => {
        const css = readAppCss();
        const rule = css.match(/\.line \.line-title-wrapper \.line-title-action-type \{([^}]*)\}/);
        assert.ok(rule, 'the kind has its rule');
        assert.match(rule[1], /color:\s*var\(--text-soft\);/);
    });

    for (const [theme, block] of Object.entries(THEMES)) {
        test(`is 4.5:1 or more on every card's surface, ${theme}`, () => {
            const soft = token(block, 'text-soft');
            for (const surface of SURFACES) {
                const ratio = contrast(soft, token(block, surface));
                assert.ok(ratio >= 4.5, `--text-soft on --${surface}: ${ratio.toFixed(2)}:1`);
            }
        });

        test(`is lighter to the eye than the title, ${theme}`, () => {
            const base = token(block, 'surface-base');
            assert.ok(contrast(token(block, 'text-soft'), base) < contrast(token(block, 'text-muted'), base));
        });
    }
});
