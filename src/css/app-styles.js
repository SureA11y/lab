'use strict';

// The app's stylesheet, in parts, in the order index.html links them: a rule
// of a later part overrides one of an earlier part as a later rule of one file
// would, so the order is part of the styles. Tests, build:report and the
// mockup build read the parts as one text with readAppCss().

const fs = require('fs');
const path = require('path');

const APP_STYLESHEETS = [
    'tokens.css',
    'layout.css',
    'custom-steps.css',
    'controls.css',
    'results.css',
    'log-and-dialogs.css',
    'live.css',
    'steps-builder.css',
    'metrics.css',
    'rules-catalog.css',
    'print-and-forced-colours.css',
    'compare.css',
    'panels.css',
    'conformance-review.css'
];

// The stylesheets of the lab's other pages, by page: not parts of the app's.
const PAGE_STYLESHEETS = {
    'guide.html': ['guide.css']
};

function readAppCss() {
    return APP_STYLESHEETS.map((name) => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
}

// The rules the exported report shares with the app are written once, in the
// app's stylesheet, between these markers (any number of blocks, in any part).
// build:report copies them into the report's stylesheet, so they cannot drift:
//
//   /* report:shared:start - what it is for */
//   ...rules (or whole @media blocks)...
//   /* report:shared:end */
//
// What only the report needs (its page, header and theme switch) stays in
// src/report/report.css.
const SHARED_BLOCK = /\/\* report:shared:start[^]*?\*\/([^]*?)\/\* report:shared:end \*\//g;

function sharedBlocks(css) {
    return [...css.matchAll(SHARED_BLOCK)].map((m) => m[1].trim());
}

/** The rules the app and the report share, as written in the app's stylesheet. */
function readSharedCss() {
    return APP_STYLESHEETS
        .flatMap((name) => sharedBlocks(fs.readFileSync(path.join(__dirname, name), 'utf8')))
        .join('\n\n');
}

/** The report's stylesheet before minifying: what it shares with the app, then its own. */
function readReportCss() {
    const own = fs.readFileSync(path.join(__dirname, '..', 'report', 'report.css'), 'utf8');
    return readSharedCss() + '\n\n' + own;
}

module.exports = {APP_STYLESHEETS, PAGE_STYLESHEETS, readAppCss, readSharedCss, readReportCss, sharedBlocks};
