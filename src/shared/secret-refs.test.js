'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isSecretRef, secretRefNames, resolveSecretRefs, describeMissing } = require('./secret-refs.js');

test('a reference is { "$env": NAME } and nothing else', () => {
    assert.equal(isSecretRef({ $env: 'SHOP_PASSWORD' }), true);
    assert.equal(isSecretRef({ $env: 'SHOP_PASSWORD', note: 'x' }), false);
    assert.equal(isSecretRef({ $env: '1BAD' }), false);
    assert.equal(isSecretRef('$env:SHOP'), false);
});

test('finds every name once, nested steps included', () => {
    const steps = [
        { type: 'setPassword', value: { $env: 'A' } },
        { type: 'group', actions: [{ type: 'setPassword', value: { $env: 'B' } }, { type: 'setPassword', value: { $env: 'A' } }] },
    ];
    assert.deepEqual(secretRefNames(steps), ['A', 'B']);
});

test('resolves into a copy, and an empty value is unset', () => {
    const steps = [{ type: 'setPassword', value: { $env: 'A' } }];
    const { value, missing } = resolveSecretRefs(steps, { A: 'pw' });
    assert.deepEqual(missing, []);
    assert.equal(value[0].value, 'pw');
    assert.deepEqual(steps[0].value, { $env: 'A' });
    assert.deepEqual(resolveSecretRefs(steps, { A: '' }), { value: null, missing: ['A'] });
});

test('says which are missing', () => {
    assert.equal(describeMissing(['A']), '$A is not set in the environment');
    assert.equal(describeMissing(['A', 'B', 'C']), '$A, $B and $C are not set in the environment');
});
