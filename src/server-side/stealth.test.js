'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { desktopIdentity, stealthOn } = require('./stealth');

test('the browser\'s user agent without "Headless", with client hints that agree with it', () => {
    const id = desktopIdentity('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.7012.4 Safari/537.36');
    assert.equal(id.userAgent, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7012.4 Safari/537.36');
    assert.equal(id.platform, 'Linux x86_64');
    assert.deepEqual(id.userAgentMetadata.brands.map((b) => `${b.brand}/${b.version}`), ['Chromium/153', 'Google Chrome/153', 'Not_A Brand/24']);
    assert.equal(id.userAgentMetadata.fullVersion, '153.0.7012.4');
    assert.equal(id.userAgentMetadata.mobile, false);
    assert.equal(desktopIdentity('Mozilla/5.0 (Windows NT 10.0; Win64; x64) HeadlessChrome/150.0.0.0').userAgentMetadata.platform, 'Windows');
});

test('A11Y_STEALTH turns it on with 1, true, yes or on, and nothing else', () => {
    for (const on of ['1', 'true', 'YES', ' on ']) assert.equal(stealthOn({ A11Y_STEALTH: on }), true, on);
    for (const off of [undefined, '', '0', 'false', 'off']) assert.equal(stealthOn({ A11Y_STEALTH: off }), false, String(off));
});
