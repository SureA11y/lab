'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseNumberStrict, hasVarToken, coerceNumberFields } = require('./numbers');

describe('parseNumberStrict', () => {
    test('accepts numbers and number text, trimming surrounding whitespace', () => {
        assert.deepEqual(parseNumberStrict(3), { ok: true, value: 3 });
        assert.deepEqual(parseNumberStrict(' 5 '), { ok: true, value: 5 });
        assert.deepEqual(parseNumberStrict('-2'), { ok: true, value: -2 });
        assert.deepEqual(parseNumberStrict('1.5'), { ok: true, value: 1.5 });
        assert.deepEqual(parseNumberStrict('.5'), { ok: true, value: 0.5 });
    });

    test('rejects text that is not entirely a number instead of guessing', () => {
        for (const text of ['3 items', 'abc', '1,234', '1e3', '0x10', 'Infinity', '5.', '--1']) {
            assert.deepEqual(parseNumberStrict(text), { ok: false, reason: 'not-a-number' }, text);
        }
    });

    test('empty text and missing values are reported as empty', () => {
        assert.deepEqual(parseNumberStrict(''), { ok: false, reason: 'empty' });
        assert.deepEqual(parseNumberStrict('   '), { ok: false, reason: 'empty' });
        assert.deepEqual(parseNumberStrict(undefined), { ok: false, reason: 'empty' });
        assert.deepEqual(parseNumberStrict(null), { ok: false, reason: 'empty' });
    });

    test('integer: true rejects fractions rather than rounding them', () => {
        assert.deepEqual(parseNumberStrict('2.5', { integer: true }), { ok: false, reason: 'not-whole' });
        assert.deepEqual(parseNumberStrict(2.5, { integer: true }), { ok: false, reason: 'not-whole' });
        assert.deepEqual(parseNumberStrict('2.0', { integer: true }), { ok: true, value: 2 });
    });

    test('non-finite and non-number values are rejected', () => {
        assert.equal(parseNumberStrict(NaN).ok, false);
        assert.equal(parseNumberStrict(Infinity).ok, false);
        assert.equal(parseNumberStrict(true).ok, false);
        assert.equal(parseNumberStrict({}).ok, false);
    });
});

describe('hasVarToken', () => {
    test('detects {var:...} and iteration tokens', () => {
        assert.equal(hasVarToken('{var:count}'), true);
        assert.equal(hasVarToken('{oneBased}'), true);
        assert.equal(hasVarToken('5'), false);
        assert.equal(hasVarToken(5), false);
    });
});

describe('coerceNumberFields', () => {
    const defs = {
        repetitions: { type: 'number', integer: true, min: 1 },
        timeout: { type: 'number' },
        label: { type: 'string' },
        value: { type: 'string|number|boolean' }
    };

    test('turns number text into numbers and leaves literal numbers and other field types alone', () => {
        const action = { repetitions: '4', timeout: 1500, label: '7', value: '8' };
        const warnings = coerceNumberFields(action, { repetitions: '{var:n}' }, defs);
        assert.deepEqual(action, { repetitions: 4, timeout: 1500, label: '7', value: '8' });
        assert.deepEqual(warnings, []);
    });

    test('an unreadable value is removed so the step falls back to its default, with a warning naming the variable', () => {
        const action = { repetitions: '3 items' };
        const warnings = coerceNumberFields(action, { repetitions: '{var:rows}' }, defs);
        assert.equal('repetitions' in action, false);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].field, 'repetitions');
        assert.equal(warnings[0].resolved, '3 items');
        assert.match(warnings[0].message, /variable "rows" has the value "3 items", which is not a number/);
        // The raw token is never quoted verbatim: log messages are {var:...}-interpolated.
        assert.doesNotMatch(warnings[0].message, /\{var:/);
    });

    test('an unset variable is reported as empty, with a hint', () => {
        const action = { repetitions: '' };
        const [w] = coerceNumberFields(action, { repetitions: '{var:missing}' }, defs);
        assert.match(w.message, /variable "missing" has the value "", which is empty \(is the variable set\?\)/);
    });

    test('a fraction in a whole-number field is rejected', () => {
        const action = { repetitions: '2.5' };
        const [w] = coerceNumberFields(action, { repetitions: '2.5' }, defs);
        assert.equal('repetitions' in action, false);
        assert.match(w.message, /"2.5" is not a whole number/);
    });

    test('a value below min is kept (the step has its own rule for it) but reported', () => {
        const action = { repetitions: '0' };
        const [w] = coerceNumberFields(action, { repetitions: '{var:count}' }, defs);
        assert.equal(action.repetitions, 0);
        assert.match(w.message, /below the minimum of 1/);
    });

    test('tolerates missing definitions or actions', () => {
        assert.deepEqual(coerceNumberFields(null, null, defs), []);
        assert.deepEqual(coerceNumberFields({ a: '1' }, {}, undefined), []);
    });
});
