'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    escapeHtml,
    appendHtml,
    prependHtml,
    insertAfter,
    insertBefore,
    replaceInnerHtml,
    replaceElement,
    removeElements,
    setAttr,
    getAttr,
    getText,
    setText,
    getInnerHtml,
    wrap,
    addClass,
    removeClass,
    toggleClass
} = require('./html-utils');

// cheerio.load() always re-wraps a fragment with <html><head></head><body>...</body></html> on
// $.html() - that's a cheerio implementation detail, not something these helpers control, so
// assertions below check via .includes() on the meaningful inner fragment rather than full-string
// equality against the wrapper boilerplate.

describe('escapeHtml', () => {
    test('escapes all five HTML-significant characters', () => {
        assert.equal(escapeHtml(`<b>"it's"</b> & more`), '&lt;b&gt;&quot;it&#39;s&quot;&lt;/b&gt; &amp; more');
    });

    test('handles null/undefined/non-string input as empty/stringified', () => {
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
        assert.equal(escapeHtml(42), '42');
    });
});

describe('appendHtml', () => {
    test('appends inside every matched element', () => {
        const out = appendHtml('<div class="x">a</div><div class="x">b</div>', '.x', '<i>!</i>');
        assert.ok(out.includes('<div class="x">a<i>!</i></div>'));
        assert.ok(out.includes('<div class="x">b<i>!</i></div>'));
    });

    test('returns the original string unchanged when the selector matches nothing', () => {
        const input = '<div id="a">x</div>';
        assert.equal(appendHtml(input, '#missing', '<i>!</i>'), input);
    });

    test('returns the original string unchanged when the selector is empty', () => {
        const input = '<div id="a">x</div>';
        assert.equal(appendHtml(input, '', '<i>!</i>'), input);
    });

    // Regression test: loadHtml must degrade gracefully (return the original input) rather than
    // throw when cheerio.load() itself throws. A bare Symbol reliably makes cheerio.load() throw
    // (it can't be coerced to a string internally), so it's a deterministic repro.
    test('degrades gracefully (returns the original input) instead of throwing when cheerio.load() itself throws', () => {
        const original = Symbol('not html');
        assert.doesNotThrow(() => {
            const result = appendHtml(original, 'div', '<i>!</i>');
            assert.equal(result, original);
        });
    });
});

describe('prependHtml', () => {
    test('prepends inside every matched element', () => {
        const out = prependHtml('<div class="x">a</div>', '.x', '<i>!</i>');
        assert.ok(out.includes('<div class="x"><i>!</i>a</div>'));
    });

    test('returns the original string unchanged when nothing matches', () => {
        const input = '<div id="a">x</div>';
        assert.equal(prependHtml(input, '#missing', '<i>!</i>'), input);
    });
});

describe('insertAfter / insertBefore', () => {
    test('insertAfter places new HTML as the next sibling', () => {
        const out = insertAfter('<div id="a">a</div>', '#a', '<div id="b">b</div>');
        assert.ok(out.includes('<div id="a">a</div><div id="b">b</div>'));
    });

    test('insertBefore places new HTML as the previous sibling', () => {
        const out = insertBefore('<div id="a">a</div>', '#a', '<div id="b">b</div>');
        assert.ok(out.includes('<div id="b">b</div><div id="a">a</div>'));
    });

    test('both return the original string unchanged when nothing matches', () => {
        const input = '<div id="a">x</div>';
        assert.equal(insertAfter(input, '#missing', '<i>!</i>'), input);
        assert.equal(insertBefore(input, '#missing', '<i>!</i>'), input);
    });
});

describe('replaceInnerHtml', () => {
    test('replaces the inner HTML of every matched element', () => {
        const out = replaceInnerHtml('<div class="x">old</div>', '.x', '<b>new</b>');
        assert.ok(out.includes('<div class="x"><b>new</b></div>'));
    });

    test('returns the original string unchanged when nothing matches', () => {
        const input = '<div id="a">x</div>';
        assert.equal(replaceInnerHtml(input, '#missing', '<b>new</b>'), input);
    });
});

describe('replaceElement', () => {
    test('replaces the whole matched element', () => {
        const out = replaceElement('<div id="a">x</div>', '#a', '<span>new</span>');
        assert.ok(out.includes('<span>new</span>'));
        assert.ok(!out.includes('<div id="a">'));
    });

    test('returns the original string unchanged when nothing matches', () => {
        const input = '<div id="a">x</div>';
        assert.equal(replaceElement(input, '#missing', '<span>new</span>'), input);
    });
});

describe('removeElements', () => {
    test('removes every matched element', () => {
        const out = removeElements('<div id="a">a</div><div id="b">b</div>', '#a');
        assert.ok(!out.includes('id="a"'));
        assert.ok(out.includes('id="b"'));
    });

    test('returns the original string unchanged when nothing matches', () => {
        const input = '<div id="a">x</div>';
        assert.equal(removeElements(input, '#missing'), input);
    });
});

describe('setAttr / getAttr', () => {
    test('setAttr sets an attribute on every matched element', () => {
        const out = setAttr('<button id="a"></button>', '#a', 'aria-hidden', 'true');
        assert.ok(out.includes('aria-hidden="true"'));
    });

    test('setAttr with null/undefined removes the attribute', () => {
        const out = setAttr('<button id="a" aria-hidden="true"></button>', '#a', 'aria-hidden', null);
        assert.ok(!out.includes('aria-hidden'));
    });

    test('setAttr stringifies non-string values', () => {
        const out = setAttr('<input id="a">', '#a', 'disabled', true);
        assert.ok(out.includes('disabled="true"'));
    });

    test('setAttr returns the original string when selector or attrName is missing', () => {
        const input = '<div id="a"></div>';
        assert.equal(setAttr(input, '', 'x', 'y'), input);
        assert.equal(setAttr(input, '#a', '', 'y'), input);
    });

    test('getAttr returns the attribute value from the first match', () => {
        assert.equal(getAttr('<a id="a" href="/x">l</a>', '#a', 'href'), '/x');
    });

    test('getAttr returns undefined when the attribute is absent', () => {
        assert.equal(getAttr('<a id="a">l</a>', '#a', 'href'), undefined);
    });

    test('getAttr returns undefined when the selector matches nothing', () => {
        assert.equal(getAttr('<a id="a">l</a>', '#missing', 'href'), undefined);
    });
});

describe('getText / setText', () => {
    test('getText returns the text content of the first match', () => {
        assert.equal(getText('<p id="a">Hello <b>World</b></p>', '#a'), 'Hello World');
    });

    test('getText returns "" when nothing matches', () => {
        assert.equal(getText('<p id="a">Hello</p>', '#missing'), '');
    });

    test('setText sets and HTML-escapes text on every matched element', () => {
        const out = setText('<p class="x"></p>', '.x', '<script>alert(1)</script>');
        assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
        assert.ok(!out.includes('<script>alert(1)</script>'));
    });

    test('setText with null/undefined sets empty text', () => {
        const out = setText('<p class="x">old</p>', '.x', null);
        assert.ok(out.includes('<p class="x"></p>'));
    });
});

describe('getInnerHtml', () => {
    test('returns the inner HTML of the first match', () => {
        assert.equal(getInnerHtml('<div id="a"><b>x</b></div>', '#a'), '<b>x</b>');
    });

    test('returns "" when nothing matches', () => {
        assert.equal(getInnerHtml('<div id="a"></div>', '#missing'), '');
    });
});

describe('wrap', () => {
    test('wraps each matched element independently, not just the first', () => {
        const out = wrap('<p class="x">a</p><p class="x">b</p>', '.x', '<div class="w"></div>');
        assert.ok(out.includes('<div class="w"><p class="x">a</p></div>'));
        assert.ok(out.includes('<div class="w"><p class="x">b</p></div>'));
    });

    test('returns the original string when wrapperHtml is missing', () => {
        const input = '<p class="x">a</p>';
        assert.equal(wrap(input, '.x', ''), input);
    });

    test('returns the original string when nothing matches', () => {
        const input = '<p class="x">a</p>';
        assert.equal(wrap(input, '.missing', '<div></div>'), input);
    });
});

describe('addClass / removeClass / toggleClass', () => {
    test('addClass accepts a space-separated string', () => {
        const out = addClass('<div id="a" class="x"></div>', '#a', 'y z');
        assert.ok(out.includes('class="x y z"'));
    });

    test('addClass accepts an array', () => {
        const out = addClass('<div id="a" class="x"></div>', '#a', ['y', 'z']);
        assert.ok(out.includes('class="x y z"'));
    });

    test('addClass with an empty class list is a no-op (returns original)', () => {
        const input = '<div id="a" class="x"></div>';
        assert.equal(addClass(input, '#a', ''), input);
        assert.equal(addClass(input, '#a', []), input);
    });

    test('removeClass removes the given class(es)', () => {
        const out = removeClass('<div id="a" class="x y z"></div>', '#a', 'y');
        assert.ok(out.includes('class="x z"'));
    });

    test('toggleClass with no force argument toggles presence', () => {
        const onOut = toggleClass('<div id="a" class="on"></div>', '#a', 'on');
        assert.ok(onOut.includes('class=""'));
        const offOut = toggleClass('<div id="a"></div>', '#a', 'on');
        assert.ok(offOut.includes('class="on"'));
    });

    test('toggleClass with force:true always adds, force:false always removes', () => {
        const forcedOn = toggleClass('<div id="a"></div>', '#a', 'on', true);
        assert.ok(forcedOn.includes('class="on"'));

        const forcedOff = toggleClass('<div id="a" class="on"></div>', '#a', 'on', false);
        assert.ok(forcedOff.includes('class=""'));
    });

    test('all three return the original string when nothing matches', () => {
        const input = '<div id="a" class="x"></div>';
        assert.equal(addClass(input, '#missing', 'y'), input);
        assert.equal(removeClass(input, '#missing', 'x'), input);
        assert.equal(toggleClass(input, '#missing', 'x'), input);
    });
});
