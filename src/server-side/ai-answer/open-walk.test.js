'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CLOSE_NAME } = require('./open-walk');

test('a close control is told by its short name, symbols included', () => {
    for (const name of ['Close', 'close dialog', 'X', '×', '✕', 'Dismiss', 'Cancel', 'No', 'Not now']) assert.match(name, CLOSE_NAME, name);
    for (const name of ['Xbox', 'Size guide', 'Delivery details', 'Back-to-school offers', 'Notes', 'November offers']) assert.doesNotMatch(name, CLOSE_NAME, name);
});

const { ACTS_NAME } = require('./open-walk');

test('a plain button whose name says it acts is never pressed', () => {
    for (const name of ['Delete', 'Remove item', 'Buy now', 'Add to cart and checkout', 'Send', 'Sign out', 'Log out', 'Subscribe', 'Accept all cookies', 'Cancel my order', 'Save', 'Discard']) assert.match(name, ACTS_NAME, name);
    for (const name of ['Add Delivery Address', 'Open chat', 'More', 'Size guide', 'Show filters', 'Menu', 'Cancel', 'Details']) assert.doesNotMatch(name, ACTS_NAME, name);
});
