'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isoNow, makeLocalId, splitWcagTagToRef } = require('./canonical-shared');

describe('splitWcagTagToRef', () => {
    test('parses three-digit tags', () => {
        assert.equal(splitWcagTagToRef('wcag111'), '1.1.1');
        assert.equal(splitWcagTagToRef('wcag143'), '1.4.3');
        assert.equal(splitWcagTagToRef('wcag412'), '4.1.2');
    });

    test('parses four-digit tags without splitting the two-digit criterion', () => {
        assert.equal(splitWcagTagToRef('wcag1410'), '1.4.10');
        assert.equal(splitWcagTagToRef('wcag1411'), '1.4.11');
        assert.equal(splitWcagTagToRef('wcag1413'), '1.4.13');
        assert.equal(splitWcagTagToRef('wcag2411'), '2.4.11');
        assert.equal(splitWcagTagToRef('wcag339'), '3.3.9');
    });

    test('is case-insensitive', () => {
        assert.equal(splitWcagTagToRef('WCAG1410'), '1.4.10');
    });

    test('rejects level tags, short tags and non-wcag tags', () => {
        for (const tag of ['wcag2aa', 'wcag21aa', 'wcag2', 'wcag21', 'wcag', 'cat.color', 'best-practice', '', null, undefined]) {
            assert.equal(splitWcagTagToRef(tag), null, `expected null for ${String(tag)}`);
        }
    });
});

describe('isoNow / makeLocalId (basic sanity, non-deterministic)', () => {
    test('isoNow returns a well-formed ISO timestamp', () => {
        assert.match(isoNow(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('makeLocalId returns a prefixed, unique-looking id', () => {
        const a = makeLocalId('scan');
        const b = makeLocalId('scan');
        assert.ok(a.startsWith('scan-'));
        assert.notEqual(a, b);
    });

    test('makeLocalId defaults the prefix to "id"', () => {
        assert.ok(makeLocalId().startsWith('id-'));
    });

    test('makeLocalId falls back to a Date.now()/Math.random id when globalThis.crypto.randomUUID is unavailable', () => {
        const originalCrypto = globalThis.crypto;
        try {
            // Simulate an environment without the WebCrypto randomUUID API.
            Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
            const id = makeLocalId('scan');
            assert.match(id, /^scan-\d+-[0-9a-f]+$/);
        } finally {
            Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
        }
    });
});
