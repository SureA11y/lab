'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CLOSE_NAME } = require('./open-walk');

test('a close control is told by its short name, symbols included', () => {
    for (const name of ['Close', 'close dialog', 'X', '×', '✕', 'Dismiss', 'Cancel']) assert.match(name, CLOSE_NAME, name);
    for (const name of ['Xbox', 'Size guide', 'Delivery details', 'Back-to-school offers']) assert.doesNotMatch(name, CLOSE_NAME, name);
});
