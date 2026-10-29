'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isDisabled, isNonEmptyString, toNumber, toBool, sleep, cloneDeep } = require('./utils');

describe('isDisabled', () => {
    test('true only when action.disabled is exactly boolean true', () => {
        assert.equal(isDisabled({ disabled: true }), true);
        assert.equal(isDisabled({ disabled: 'true' }), false); // string, not boolean
        assert.equal(isDisabled({ disabled: 1 }), false);
        assert.equal(isDisabled({ disabled: false }), false);
        assert.equal(isDisabled({}), false);
    });

    test('handles null/undefined/non-object input without throwing', () => {
        assert.equal(isDisabled(null), false);
        assert.equal(isDisabled(undefined), false);
        assert.equal(isDisabled('not-an-object'), false);
        assert.equal(isDisabled(42), false);
    });
});

describe('isNonEmptyString', () => {
    test('true for a string with non-whitespace content', () => {
        assert.equal(isNonEmptyString('hi'), true);
        assert.equal(isNonEmptyString('  hi  '), true);
    });

    test('false for empty, whitespace-only, or non-string values', () => {
        assert.equal(isNonEmptyString(''), false);
        assert.equal(isNonEmptyString('   '), false);
        assert.equal(isNonEmptyString(null), false);
        assert.equal(isNonEmptyString(undefined), false);
        assert.equal(isNonEmptyString(0), false);
        assert.equal(isNonEmptyString(42), false);
        assert.equal(isNonEmptyString({}), false);
        assert.equal(isNonEmptyString([]), false);
    });
});

describe('toNumber', () => {
    test('parses numeric strings and passes through finite numbers', () => {
        assert.equal(toNumber('42', 0), 42);
        assert.equal(toNumber('3.14', 0), 3.14);
        assert.equal(toNumber(7, 0), 7);
        assert.equal(toNumber('-5', 0), -5);
    });

    test('falls back for non-finite results: NaN, Infinity, empty string, non-numeric string, null/undefined', () => {
        assert.equal(toNumber('not-a-number', 99), 99);
        assert.equal(toNumber(NaN, 99), 99);
        assert.equal(toNumber(Infinity, 99), 99);
        assert.equal(toNumber(-Infinity, 99), 99);
        assert.equal(toNumber(undefined, 99), 99);
        assert.equal(toNumber(null, 99), 0); // Number(null) === 0, which IS finite
        assert.equal(toNumber('', 99), 0); // Number('') === 0, which IS finite
    });

    test('booleans coerce via Number() (true->1, false->0), both finite', () => {
        assert.equal(toNumber(true, 99), 1);
        assert.equal(toNumber(false, 99), 0);
    });
});

describe('toBool', () => {
    test('true only for the exact boolean true, never truthy-coerced values', () => {
        assert.equal(toBool(true), true);
        assert.equal(toBool(false), false);
        assert.equal(toBool('true'), false);
        assert.equal(toBool(1), false);
        assert.equal(toBool('yes'), false);
        assert.equal(toBool(null), false);
        assert.equal(toBool(undefined), false);
    });
});

describe('sleep', () => {
    test('resolves after roughly the requested delay', async () => {
        const start = Date.now();
        await sleep(10);
        assert.ok(Date.now() - start >= 5); // loose bound to avoid flakiness
    });

    test('resolves on the next tick for 0ms', async () => {
        await sleep(0);
        assert.ok(true);
    });
});

describe('cloneDeep', () => {
    test('deep-clones nested objects/arrays without sharing references', () => {
        const original = { a: 1, nested: { b: [1, 2, { c: 3 }] } };
        const clone = cloneDeep(original);
        assert.deepEqual(clone, original);
        assert.notEqual(clone, original);
        assert.notEqual(clone.nested, original.nested);
        assert.notEqual(clone.nested.b, original.nested.b);
    });

    test('is a JSON round-trip: functions/undefined are dropped, dates become strings', () => {
        const original = { fn: () => {}, missing: undefined, when: new Date('2020-01-01T00:00:00.000Z'), keep: 1 };
        const clone = cloneDeep(original);
        assert.deepEqual(clone, { when: '2020-01-01T00:00:00.000Z', keep: 1 });
        assert.equal('fn' in clone, false);
        assert.equal('missing' in clone, false);
    });
});
