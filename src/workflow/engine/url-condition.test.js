'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { readUrlPart, evaluateUrlCondition } = require('./url-condition');

const URL = 'https://Shop.Example.com:8443/cart/checkout?step=2&lang=en#payment';

const check = (href, action) => evaluateUrlCondition(href, action, action.value).result;

describe('readUrlPart', () => {
    test('reads each part the way a person writes it', () => {
        assert.equal(readUrlPart(URL, 'host'), 'shop.example.com');
        assert.equal(readUrlPart(URL, 'port'), '8443');
        assert.equal(readUrlPart(URL, 'path'), '/cart/checkout');
        assert.equal(readUrlPart(URL, 'query'), 'step=2&lang=en');
        assert.equal(readUrlPart(URL, 'param', 'lang'), 'en');
        assert.equal(readUrlPart(URL, 'hash'), 'payment');
    });

    test('a URL with no port is on the protocol default port', () => {
        assert.equal(readUrlPart('https://example.com/', 'port'), '443');
        assert.equal(readUrlPart('http://example.com/', 'port'), '80');
    });

    test('a missing parameter is null, an empty one is ""', () => {
        assert.equal(readUrlPart('https://example.com/?a=', 'param', 'a'), '');
        assert.equal(readUrlPart('https://example.com/?a=1', 'param', 'b'), null);
    });

    test('an unreadable URL is null', () => {
        assert.equal(readUrlPart('not a url', 'path'), null);
    });
});

describe('evaluateUrlCondition', () => {
    test('equals / notEquals on every part', () => {
        assert.equal(check(URL, { urlPart: 'host', comparison: 'equals', value: 'shop.example.com' }), true);
        assert.equal(check(URL, { urlPart: 'port', comparison: 'equals', value: '8443' }), true);
        assert.equal(check(URL, { urlPart: 'path', comparison: 'equals', value: '/cart/checkout' }), true);
        assert.equal(check(URL, { urlPart: 'query', comparison: 'equals', value: 'step=2&lang=en' }), true);
        assert.equal(check(URL, { urlPart: 'param', paramName: 'step', comparison: 'equals', value: '2' }), true);
        assert.equal(check(URL, { urlPart: 'hash', comparison: 'equals', value: 'payment' }), true);
        assert.equal(check(URL, { urlPart: 'path', comparison: 'notEquals', value: '/cart/checkout' }), false);
        assert.equal(check(URL, { urlPart: 'path', comparison: 'notEquals', value: '/cart' }), true);
    });

    test('comparison defaults to equals', () => {
        assert.equal(check(URL, { urlPart: 'hash', value: 'payment' }), true);
    });

    test('contains / notContains', () => {
        assert.equal(check(URL, { urlPart: 'path', comparison: 'contains', value: 'checkout' }), true);
        assert.equal(check(URL, { urlPart: 'path', comparison: 'notContains', value: 'checkout' }), false);
        assert.equal(check(URL, { urlPart: 'host', comparison: 'notContains', value: 'other' }), true);
    });

    test('a parameter value is compared whole: step=20 does not equal 2', () => {
        assert.equal(check('https://example.com/?step=20', { urlPart: 'param', paramName: 'step', value: '2' }), false);
    });

    test('a leading ? or # in the value is ignored, and the value is trimmed', () => {
        assert.equal(check(URL, { urlPart: 'hash', value: '#payment' }), true);
        assert.equal(check(URL, { urlPart: 'query', value: ' ?step=2&lang=en ' }), true);
    });

    test('the domain name ignores case, the path does not', () => {
        assert.equal(check(URL, { urlPart: 'host', value: 'SHOP.example.COM' }), true);
        assert.equal(check(URL, { urlPart: 'path', value: '/Cart/Checkout' }), false);
    });

    test('an empty value matches an empty part: no fragment equals ""', () => {
        assert.equal(check('https://example.com/a', { urlPart: 'hash', value: '' }), true);
        assert.equal(check(URL, { urlPart: 'hash', value: '' }), false);
    });

    test('a missing parameter equals nothing and contains nothing', () => {
        const href = 'https://example.com/?a=1';
        assert.equal(check(href, { urlPart: 'param', paramName: 'b', comparison: 'equals', value: '' }), false);
        assert.equal(check(href, { urlPart: 'param', paramName: 'b', comparison: 'contains', value: '' }), false);
        assert.equal(check(href, { urlPart: 'param', paramName: 'b', comparison: 'notEquals', value: 'x' }), true);
        assert.equal(check(href, { urlPart: 'param', paramName: 'b', comparison: 'notContains', value: 'x' }), true);
    });

    test('percent-encoded parts match their decoded text too', () => {
        const href = 'https://example.com/b%C3%BAsqueda?q=caf%C3%A9#secci%C3%B3n';
        assert.equal(check(href, { urlPart: 'path', value: '/búsqueda' }), true);
        assert.equal(check(href, { urlPart: 'path', value: '/b%C3%BAsqueda' }), true);
        assert.equal(check(href, { urlPart: 'param', paramName: 'q', value: 'café' }), true);
        assert.equal(check(href, { urlPart: 'hash', value: 'sección' }), true);
    });

    test('a misconfigured step throws instead of taking the else branch', () => {
        assert.throws(() => check(URL, { urlPart: 'domain', value: 'x' }), /urlPart must be one of/);
        assert.throws(() => check(URL, { urlPart: 'path', comparison: 'startsWith', value: 'x' }), /comparison must be one of/);
        assert.throws(() => check(URL, { urlPart: 'param', value: 'x' }), /paramName is required/);
    });

    test('reports the part it read, for the log', () => {
        const out = evaluateUrlCondition(URL, { urlPart: 'param', paramName: 'lang', comparison: 'notEquals' }, 'fr');
        assert.deepEqual(out, { result: true, actual: 'en', expected: 'fr', part: 'param', comparison: 'notEquals' });
    });
});
