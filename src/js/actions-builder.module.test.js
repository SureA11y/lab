'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveSetViewportPresetValue,
    withResolvedSetViewportPreset,
    SELECT_TOKEN_SENTINEL,
    isTokenizedSelectValue,
    resolveSelectValueForUi,
    resolveSelectValueForSerialization,
    normalizeTagList,
    filterTagSuggestions
} = require('./actions-builder.module.js');

// These two helpers back the setViewport "Custom size" UI toggle: workflow-engine.js
// always gives explicit width/height precedence over "preset" at runtime, so the
// builder UI has to agree with that precedence rather than showing "preset" as if
// it were still in control. Only the pure decision logic is covered here - the DOM
// wiring (wireSetViewportPresetToggle) that shows/hides/clears the actual fields
// needs a real browser and is left for a future browserspec test.

describe('resolveSetViewportPresetValue', () => {
    test('returns "custom" when width is a positive finite number', () => {
        assert.equal(resolveSetViewportPresetValue({presetValue: 'default', width: 375}), 'custom');
    });

    test('returns "custom" when height is a positive finite number', () => {
        assert.equal(resolveSetViewportPresetValue({presetValue: 'default', height: 812}), 'custom');
    });

    test('returns "custom" when both width and height are set', () => {
        assert.equal(resolveSetViewportPresetValue({presetValue: 'default', width: 375, height: 2000}), 'custom');
    });

    test('accepts numeric strings (as they arrive from saved JSON/UI inputs)', () => {
        assert.equal(resolveSetViewportPresetValue({presetValue: 'default', width: '375'}), 'custom');
    });

    const nonCustomWidths = [
        ['0', 0], ['-1', -1], ['NaN', NaN], ['undefined', undefined],
        ['null', null], ['empty string', ''], ['non-numeric string', 'not-a-number']
    ];
    for (const [label, bad] of nonCustomWidths) {
        test(`does not treat width=${label} as a custom size`, () => {
            assert.equal(
                resolveSetViewportPresetValue({presetValue: 'mobile', width: bad}),
                'mobile'
            );
        });
    }

    test('passes presetValue through unchanged when no valid width/height is present', () => {
        assert.equal(resolveSetViewportPresetValue({presetValue: 'tablet'}), 'tablet');
    });

    test('returns undefined when neither presetValue nor a valid size is present', () => {
        assert.equal(resolveSetViewportPresetValue({}), undefined);
    });
});

describe('withResolvedSetViewportPreset', () => {
    test('returns non-object input unchanged', () => {
        assert.equal(withResolvedSetViewportPreset(null), null);
        assert.equal(withResolvedSetViewportPreset(undefined), undefined);
    });

    test('ignores actions that are not setViewport, even if they carry width/height', () => {
        const action = {type: 'screenshot', width: 375, height: 812};
        assert.equal(withResolvedSetViewportPreset(action), action);
    });

    test('normalizes the real-world ambiguous case: preset + width/height both set', () => {
        // Matches the "Switch to mobile viewport" custom-step action that motivated
        // this fix: {"preset":"default","width":375,"height":2000} - the saved
        // preset was already dead at runtime because width/height always win.
        const action = {type: 'setViewport', preset: 'default', width: 375, height: 2000, zoom: '1'};
        const result = withResolvedSetViewportPreset(action);

        assert.notEqual(result, action, 'must not mutate the original action object');
        assert.equal(action.preset, 'default', 'original object is left untouched');
        assert.deepEqual(result, {type: 'setViewport', preset: 'custom', width: 375, height: 2000, zoom: '1'});
    });

    test('adds preset:"custom" when width/height are set with no preset key at all', () => {
        const action = {type: 'setViewport', width: 375, height: 812};
        const result = withResolvedSetViewportPreset(action);
        assert.deepEqual(result, {type: 'setViewport', width: 375, height: 812, preset: 'custom'});
    });

    test('leaves a plain named preset (no width/height) untouched, same reference', () => {
        const action = {type: 'setViewport', preset: 'mobile'};
        assert.equal(withResolvedSetViewportPreset(action), action);
    });

    test('is idempotent when preset is already "custom"', () => {
        const action = {type: 'setViewport', preset: 'custom', width: 375, height: 812};
        assert.equal(withResolvedSetViewportPreset(action), action);
    });

    test('leaves a setViewport action with no preset/width/height untouched, same reference', () => {
        const action = {type: 'setViewport', zoom: '2'};
        assert.equal(withResolvedSetViewportPreset(action), action);
    });
});

describe('tokenized select helpers', () => {
    test('isTokenizedSelectValue accepts valid {var:name} tokens', () => {
        assert.equal(isTokenizedSelectValue('{var:preset}'), true);
        assert.equal(isTokenizedSelectValue('{var:scan.viewport_name}'), true);
    });

    test('isTokenizedSelectValue rejects invalid token shapes', () => {
        assert.equal(isTokenizedSelectValue('tablet'), false);
        assert.equal(isTokenizedSelectValue('{var:}'), false);
        assert.equal(isTokenizedSelectValue('{var:preset'), false);
    });

    test('resolveSelectValueForUi keeps known option values on the select', () => {
        const out = resolveSelectValueForUi({ value: 'tablet', allowedValues: ['default', 'tablet', 'mobile'] });
        assert.deepEqual(out, { selectValue: 'tablet', tokenValue: '' });
    });

    test('resolveSelectValueForUi maps unknown values to token mode without data loss', () => {
        const out1 = resolveSelectValueForUi({ value: '{var:preset}', allowedValues: ['default', 'tablet', 'mobile'] });
        const out2 = resolveSelectValueForUi({ value: 'legacy-value', allowedValues: ['default', 'tablet', 'mobile'] });
        assert.deepEqual(out1, { selectValue: SELECT_TOKEN_SENTINEL, tokenValue: '{var:preset}' });
        assert.deepEqual(out2, { selectValue: SELECT_TOKEN_SENTINEL, tokenValue: 'legacy-value' });
    });

    test('resolveSelectValueForSerialization returns token input when token mode is selected', () => {
        assert.equal(
            resolveSelectValueForSerialization({ selectValue: SELECT_TOKEN_SENTINEL, tokenValue: '  {var:preset}  ' }),
            '{var:preset}'
        );
    });

    test('resolveSelectValueForSerialization returns the direct select value for normal options', () => {
        assert.equal(
            resolveSelectValueForSerialization({ selectValue: 'tablet', tokenValue: '{var:preset}' }),
            'tablet'
        );
    });
});

describe('normalizeTagList', () => {
    test('trims, drops empties, and de-dupes case-insensitively preserving first-seen order', () => {
        assert.deepEqual(
            normalizeTagList(['  Desktop ', 'checkout', '', '   ', 'DESKTOP', 'checkout']),
            ['Desktop', 'checkout']
        );
    });

    test('accepts a comma-separated string', () => {
        assert.deepEqual(normalizeTagList('desktop, checkout , desktop'), ['desktop', 'checkout']);
    });

    test('returns an empty array for empty/absent/invalid input', () => {
        assert.deepEqual(normalizeTagList(''), []);
        assert.deepEqual(normalizeTagList('  ,  '), []);
        assert.deepEqual(normalizeTagList(undefined), []);
        assert.deepEqual(normalizeTagList(null), []);
        assert.deepEqual(normalizeTagList(42), []);
    });
});

describe('filterTagSuggestions', () => {
    const pool = ['desktop', 'mobile', 'tablet', 'checkout', 'Desktop'];

    test('drops taken tags (case-insensitive) and de-dupes the pool', () => {
        assert.deepEqual(
            filterTagSuggestions(pool, { taken: ['DESKTOP'] }),
            ['mobile', 'tablet', 'checkout']
        );
    });

    test('matches the typed substring case-insensitively', () => {
        assert.deepEqual(filterTagSuggestions(pool, { typed: 'et' }), ['tablet']);
        // 'desktop' and 'Desktop' collapse to the first-seen 'desktop'.
        assert.deepEqual(filterTagSuggestions(pool, { typed: 'O' }), ['desktop', 'mobile', 'checkout']);
    });

    test('caps results at the requested limit', () => {
        assert.deepEqual(filterTagSuggestions(pool, { limit: 2 }), ['desktop', 'mobile']);
    });

    test('is safe with an empty or missing pool', () => {
        assert.deepEqual(filterTagSuggestions([], { typed: 'x' }), []);
        assert.deepEqual(filterTagSuggestions(undefined), []);
    });
});
