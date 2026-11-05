'use strict';

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');

let elementCount;
let elementCountText;
let markupWithoutIds;

before(async () => {
    ({elementCount, elementCountText, markupWithoutIds} = await import('./occurrence-elements.js'));
});

const node = (html, contexts, urls = ['https://example.test/']) => ({html, urls, ...(contexts ? {contexts} : {})});

describe('occurrence-elements', () => {
    test('leaves out the attributes that hold or point at ids, and nothing else', () => {
        assert.equal(
            markupWithoutIds('<div id="a1" class="x" aria-labelledby="l1 l2"><label for=\'f\'>L</label><span data-id="k">y</span></div>'),
            '<div class="x"><label>L</label><span data-id="k">y</span></div>'
        );
    });

    test('the same markup in two contexts is one element', () => {
        assert.equal(elementCount([node('<b id="o-0">A</b>', ['Desktop']), node('<b id="o-9">A</b>', ['Mobile'])]), 1);
    });

    test('the same markup twice in one context is two elements', () => {
        assert.equal(elementCount([node('<button id="b1"></button>'), node('<button id="b2"></button>')]), 2);
        assert.equal(elementCount([
            node('<b id="1">A</b>', ['Desktop']), node('<b id="2">A</b>', ['Desktop']), node('<b id="3">A</b>', ['Mobile']),
        ]), 2);
    });

    test('the same element flagged by two checks in one context is one element', () => {
        const opt = (id, ctx) => ({html: `<li role="option" id="${id}">A</li>`, target: [`#${id}`], urls: ['https://example.test/'], contexts: [ctx]});
        // A merged scan saved before the checks were listed under one occurrence:
        // each option twice per context, and its id another in each context.
        assert.equal(elementCount([
            opt('o-0', 'Desktop'), opt('o-0', 'Desktop'), opt('o-9', 'Mobile'), opt('o-9', 'Mobile'),
        ]), 1);
        assert.equal(elementCountText([opt('o-0', 'Desktop'), opt('o-0', 'Desktop')], 2), ' · 1 element');
    });

    test('an occurrence of several contexts counts once for them all', () => {
        assert.equal(elementCount([node('<b>A</b>', ['Desktop', 'Mobile']), node('<b id="m">A</b>', ['Mobile'])]), 2);
    });

    test('other pages hold other elements', () => {
        assert.equal(elementCount([node('<b id="1">A</b>', ['D'], ['https://a.test/']), node('<b id="2">A</b>', ['M'], ['https://b.test/'])]), 2);
    });

    test('without markup, the selector tells elements apart', () => {
        assert.equal(elementCount([{target: ['#a'], contexts: ['D']}, {target: ['#b'], contexts: ['M']}]), 2);
    });

    test('the text, only when there are fewer elements than occurrences', () => {
        assert.equal(elementCountText([node('<b id="1">A</b>', ['D']), node('<b id="2">A</b>', ['M'])], 2), ' · 1 element');
        assert.equal(elementCountText([node('<b>A</b>'), node('<i>B</i>')], 2), '');
        assert.equal(elementCountText([], 0), '');
    });
});
