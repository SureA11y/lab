'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { checkAgainstSchema } = require('./json-schema-check.js');

const keywords = (problems) => problems.map((p) => p.keyword);

describe('checkAgainstSchema', () => {
    test('passes a value that fits', () => {
        const schema = {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string', minLength: 1 }, size: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
        };
        assert.deepEqual(checkAgainstSchema(schema, { name: 'a', size: 2 }), []);
    });

    test('reports every problem, each with a path to find it by', () => {
        const schema = {
            type: 'object',
            required: ['name', 'list'],
            properties: {
                name: { type: 'string' },
                list: { type: 'array', items: { type: 'number' } },
            },
            additionalProperties: false,
        };
        const problems = checkAgainstSchema(schema, { list: [1, 'two', 3], extra: true, 'odd key': 1 });
        assert.deepEqual(problems.map((p) => [p.path, p.keyword]), [
            ['$', 'required'],
            ['$.list[1]', 'type'],
            ['$.extra', 'additionalProperties'],
            ['$["odd key"]', 'additionalProperties'],
        ]);
    });

    test('a value of the wrong type is not checked further', () => {
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'string', minLength: 3, enum: ['abc'] }, 4)), ['type']);
    });

    test('tells integers from other numbers, and does not take NaN as a number', () => {
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'integer' }, 1.5)), ['type']);
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'number' }, NaN)), ['type']);
        assert.deepEqual(checkAgainstSchema({ type: 'number' }, 1.5), []);
    });

    test('enum and const compare by value', () => {
        assert.deepEqual(checkAgainstSchema({ enum: ['a', 1, null] }, null), []);
        assert.deepEqual(keywords(checkAgainstSchema({ enum: ['a'] }, 'b')), ['enum']);
        assert.equal(checkAgainstSchema({ enum: ['a'] }, 'b')[0].value, 'b');
        assert.deepEqual(keywords(checkAgainstSchema({ const: 1 }, '1')), ['const']);
    });

    test('pattern, minLength, minItems and minimum', () => {
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'string', pattern: '^a' }, 'ba')), ['pattern']);
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'string', minLength: 1 }, '')), ['minLength']);
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'array', minItems: 1 }, [])), ['minItems']);
        assert.deepEqual(keywords(checkAgainstSchema({ type: 'number', minimum: 1 }, 0)), ['minimum']);
    });

    test('propertyNames checks each key, additionalProperties as a schema checks each value', () => {
        const schema = {
            type: 'object',
            propertyNames: { pattern: '^[a-z]+$' },
            additionalProperties: { type: 'string' },
        };
        const problems = checkAgainstSchema(schema, { good: 'x', Bad: 'y', other: 2 });
        assert.deepEqual(problems.map((p) => [p.path, p.keyword]), [
            ['$.Bad', 'propertyNames'],
            ['$.other', 'type'],
        ]);
    });

    test('anyOf of listed values and a pattern reads as a value problem', () => {
        const schema = { type: 'string', anyOf: [{ enum: ['a', 'b'] }, { type: 'string', pattern: '^\\{', description: 'a token' }] };
        assert.deepEqual(checkAgainstSchema(schema, '{x}'), []);
        const problems = checkAgainstSchema(schema, 'c');
        assert.deepEqual(keywords(problems), ['enum']);
        assert.match(problems[0].message, /one of "a", "b", or a token/);
    });

    test('anyOf of kinds reads as anyOf', () => {
        const schema = { anyOf: [{ type: 'number' }, { type: 'string', pattern: '^\\d+$' }] };
        assert.deepEqual(checkAgainstSchema(schema, '12'), []);
        assert.deepEqual(keywords(checkAgainstSchema(schema, 'twelve')), ['anyOf']);
    });

    test('if/then applies the branch only when the condition holds, and $ref resolves in $defs', () => {
        const root = {
            $defs: { big: { type: 'object', required: ['size'] } },
            allOf: [{ if: { properties: { kind: { const: 'big' } }, required: ['kind'] }, then: { $ref: '#/$defs/big' } }],
        };
        assert.deepEqual(checkAgainstSchema(root, { kind: 'small' }), []);
        assert.deepEqual(keywords(checkAgainstSchema(root, { kind: 'big' })), ['required']);
    });

    test('checks part of a schema against the whole for its $refs, under a given path', () => {
        const root = { $defs: { item: { type: 'string' } } };
        const problems = checkAgainstSchema({ $ref: '#/$defs/item' }, 1, { root, path: '$.items[3]' });
        assert.deepEqual(problems.map((p) => p.path), ['$.items[3]']);
    });

    test('an unresolvable $ref is a mistake in the schema, not in the value', () => {
        assert.throws(() => checkAgainstSchema({ $ref: '#/$defs/missing' }, 1), /Unresolvable \$ref/);
    });
    test('a field set to undefined is absent, as it is once saved as JSON', () => {
        const schema = { type: 'object', required: ['url'], properties: { url: { type: 'string' }, notes: { type: 'object' } }, additionalProperties: false };
        assert.deepEqual(checkAgainstSchema(schema, { url: 'u', notes: undefined, extra: undefined }), []);
        assert.deepEqual(keywords(checkAgainstSchema(schema, { url: undefined })), ['required']);
    });
});

test('maximum: a number above it is a problem, one at it is not', () => {
    const { checkAgainstSchema } = require('./json-schema-check');
    assert.deepEqual(checkAgainstSchema({ type: 'number', maximum: 10 }, 10), []);
    assert.deepEqual(checkAgainstSchema({ type: 'number', maximum: 10 }, 11).map((p) => p.keyword), ['maximum']);
});
