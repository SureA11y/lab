'use strict';

// Set language's tags, and the note a scan gets when the page declares
// another language than the one asked for. What the browser does with a
// language is checked in Chrome (page-conditions.browserspec.js).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { canonicalLanguageTag, acceptLanguages } = require('./page-language');
const { languageNotice } = require('../../shared/scan-notes.js');

describe('language tags', () => {
    test('a tag is taken in its canonical form, anything else is refused', () => {
        assert.equal(canonicalLanguageTag('pt-br'), 'pt-BR');
        assert.equal(canonicalLanguageTag(' zh-hant-hk '), 'zh-Hant-HK');
        assert.equal(canonicalLanguageTag('es-419'), 'es-419');
        assert.equal(canonicalLanguageTag('not a tag'), null);
        assert.equal(canonicalLanguageTag(''), null);
    });

    test('the browser lists the tag, then its language alone', () => {
        assert.deepEqual(acceptLanguages('de-DE'), ['de-DE', 'de']);
        assert.deepEqual(acceptLanguages('zh-Hant-HK'), ['zh-Hant-HK', 'zh']);
        assert.deepEqual(acceptLanguages('ja'), ['ja']);
    });
});

describe('the language note on a scan', () => {
    test('a page declaring another language gets one', () => {
        const n = languageNotice({ requested: 'de-DE', declared: 'en' });
        assert.equal(n.code, 'language-mismatch');
        assert.match(n.message, /de-DE/);
        assert.match(n.message, /lang="en"/);
    });

    test('the same language in another region, or no lang at all, gets none', () => {
        assert.equal(languageNotice({ requested: 'es-ES', declared: 'es-MX' }), null);
        assert.equal(languageNotice({ requested: 'pt-BR', declared: 'PT_br' }), null);
        assert.equal(languageNotice({ requested: 'de-DE', declared: null }), null);
        assert.equal(languageNotice(null), null);
    });
});
