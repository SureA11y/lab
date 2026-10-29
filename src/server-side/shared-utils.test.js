'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { toSafeId } = require('./shared-utils');

function expectedHash(raw) {
    return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 6);
}

describe('toSafeId', () => {
    test('lowercases, hyphenates non-alphanumeric runs, and appends a deterministic hash', () => {
        const out = toSafeId('Hello World!');
        assert.equal(out, `hello-world-${expectedHash('Hello World!')}`);
    });

    test('preserves underscores', () => {
        assert.equal(toSafeId('hello_world'), `hello_world-${expectedHash('hello_world')}`);
    });

    test('strips accents via NFKD normalization', () => {
        assert.equal(toSafeId('café'), `cafe-${expectedHash('café')}`);
    });

    test('trims leading/trailing hyphens produced by normalization', () => {
        assert.equal(toSafeId('!!!hello!!!'), `hello-${expectedHash('!!!hello!!!')}`);
    });

    test('is deterministic for the same input', () => {
        assert.equal(toSafeId('same input'), toSafeId('same input'));
    });

    test('two inputs that normalize to the same visible id still get different hashes', () => {
        const a = toSafeId('café');
        const b = toSafeId('cafe');
        assert.ok(a.startsWith('cafe-'));
        assert.ok(b.startsWith('cafe-'));
        assert.notEqual(a, b);
    });

    test('falls back to "item" for an empty string', () => {
        assert.equal(toSafeId(''), `item-${expectedHash('')}`);
    });

    test('falls back to "item" for a string that normalizes to nothing (e.g. only symbols)', () => {
        assert.equal(toSafeId('!!!'), `item-${expectedHash('!!!')}`);
    });

    test('null and undefined are both treated as an empty string', () => {
        assert.equal(toSafeId(null), `item-${expectedHash('')}`);
        assert.equal(toSafeId(undefined), `item-${expectedHash('')}`);
        assert.equal(toSafeId(null), toSafeId(undefined));
    });

    test('whitespace-only input is NOT treated the same as empty (hash differs)', () => {
        const spaceOnly = toSafeId('   ');
        const empty = toSafeId('');
        assert.ok(spaceOnly.startsWith('item-'));
        assert.notEqual(spaceOnly, empty); // hash is over the raw (pre-trim) input
    });

    test('non-string input is stringified', () => {
        assert.equal(toSafeId(42), `42-${expectedHash('42')}`);
    });

    test('truncates the id portion to maxLength before appending the hash', () => {
        const out = toSafeId('hello world this is long', 5);
        assert.equal(out, `hello-${expectedHash('hello world this is long')}`);
    });

    test('truncation trims any trailing hyphen left by the cut', () => {
        // "hello-world" sliced to 6 chars is "hello-" - the trailing hyphen must be trimmed.
        const out = toSafeId('hello world', 6);
        assert.equal(out, `hello-${expectedHash('hello world')}`);
    });

    test('default maxLength is 60', () => {
        const longInput = 'a'.repeat(100);
        const withDefault = toSafeId(longInput);
        const withExplicit60 = toSafeId(longInput, 60);
        assert.equal(withDefault, withExplicit60);
        assert.equal(withDefault, `${'a'.repeat(60)}-${expectedHash(longInput)}`);
    });

    // Documents current (edge-case) behavior: maxLength <= 0 truncates the id portion away
    // entirely, leaving just a leading hyphen before the hash. Not reachable from any current
    // caller (a11y-report.js always uses the default) - documented so a future maxLength change
    // updates this test deliberately.
    test('maxLength <= 0 leaves the id portion empty (documented current behavior)', () => {
        assert.equal(toSafeId('hello', 0), `-${expectedHash('hello')}`);
    });
});
