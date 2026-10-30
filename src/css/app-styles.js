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

function readAppCss() {
    return APP_STYLESHEETS.map((name) => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
}

module.exports = {APP_STYLESHEETS, readAppCss};
