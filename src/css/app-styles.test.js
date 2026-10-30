'use strict';

// The app's stylesheet is in parts whose order is part of the styles: the
// page must link every part, once, in the order app-styles.js lists them,
// which is also the order the tests and build:report read them in.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { APP_STYLESHEETS, readAppCss } = require('./app-styles');

test('index.html links every part of the stylesheet, in order', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const linked = [...html.matchAll(/<link rel="stylesheet" href="css\/([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(linked, APP_STYLESHEETS);
});

test('every stylesheet beside it is a listed part', () => {
    const onDisk = fs.readdirSync(__dirname).filter((f) => f.endsWith('.css')).sort();
    assert.deepEqual(onDisk, [...APP_STYLESHEETS].sort());
});

test('the parts read as one text, the compare block whole inside it', () => {
    const css = readAppCss();
    const start = css.indexOf('/* compare:start');
    const end = css.indexOf('/* compare:end */');
    assert.ok(start > 0 && end > start);
    const compare = fs.readFileSync(path.join(__dirname, 'compare.css'), 'utf8');
    assert.ok(compare.includes('/* compare:start') && compare.includes('/* compare:end */'));
});
