'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selectorSyntaxProblem } = require('./selector-syntax');

test('selectors a browser reads pass, with commas and brackets inside them', () => {
    for (const ok of ['main', 'main, #content', 'a[href="x,y"]', ':is(a, b) > c', 'button:not(* > *)', 'div::before', '[data-x=\'a]b\']', 'a\\(b', '{var:sel}', '', null]) {
        assert.equal(selectorSyntaxProblem(ok), null, String(ok));
    }
});

test('selectors no browser reads are named, with why', () => {
    assert.match(selectorSyntaxProblem(':::nope(('), /never closed/);
    assert.match(selectorSyntaxProblem('main)'), /closes nothing/);
    assert.match(selectorSyntaxProblem('a[href="x]'), /quote/);
    assert.match(selectorSyntaxProblem('main,,nav'), /empty selector/);
    assert.match(selectorSyntaxProblem('.a >'), /ends with a combinator/);
    assert.match(selectorSyntaxProblem('~ p'), /starts with a combinator/);
    assert.match(selectorSyntaxProblem('a:::hover'), /three colons/);
});
