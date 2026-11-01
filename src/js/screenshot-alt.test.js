'use strict';

// A screenshot's text alternative, which is also the name of the button that
// opens it larger: it says it is a screenshot, and of what.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'stream-ui.js')).href);

test('names a screenshot by what it shows', async () => {
    const { screenshotAlt } = await load();
    assert.equal(screenshotAlt('Home'), 'Screenshot: Home');
    assert.equal(screenshotAlt('Scan: Cart'), 'Screenshot: Cart');
    assert.equal(screenshotAlt('Added to the cart'), 'Screenshot: Added to the cart');
});

test('says "screenshot" once, and something when there is no name', async () => {
    const { screenshotAlt } = await load();
    assert.equal(screenshotAlt('Main screenshot'), 'Main screenshot');
    assert.equal(screenshotAlt('Screenshot 2'), 'Screenshot 2');
    assert.equal(screenshotAlt(''), 'Screenshot');
    assert.equal(screenshotAlt(undefined), 'Screenshot');
});
