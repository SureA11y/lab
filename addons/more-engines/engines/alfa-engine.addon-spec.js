'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('./alfa-engine');

describe('alfa-engine: static metadata', () => {
    test('exposes engineId, engineName and a version read from @siteimprove/alfa-rules', () => {
        assert.equal(engine.engineId, 'alfa');
        assert.equal(engine.engineName, 'Alfa (Siteimprove)');
        assert.equal(engine.engineVersion, require('@siteimprove/alfa-rules/package.json').version);
    });

    test('getRulesCatalog is not supported synchronously (Alfa loads lazily via ESM import)', () => {
        assert.equal(engine.getRulesCatalog, null);
    });
});

describe('alfa-engine: pass-through behavior', () => {
    test('ensureInjected is a no-op (Alfa audits a serialized DOM snapshot, not the live page)', async () => {
        await assert.doesNotReject(() => engine.ensureInjected({}));
    });

    test('postProcessResults returns its input unchanged by default', () => {
        const native = { canonical: { findings: [] } };
        assert.equal(engine.postProcessResults(native, {}), native);
    });
});

describe('alfa-engine: capabilities', () => {
    test('declares wcagLevel and includeBestPractice as supported, and context/exclude scoping as not', () => {
        const caps = engine.capabilities.actions.a11yScan;
        assert.equal(caps.wcagLevel, true);
        assert.equal(caps.includeBestPractice, true);
        assert.equal(caps.context, false);
        assert.equal(caps.exclude, false);
    });
});
