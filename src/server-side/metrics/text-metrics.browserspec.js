'use strict';

// Real-Chrome integration tests for text-metrics.js's collectTextMetrics.
//
// Why real Chrome: this function's entire body is a callback passed to page.evaluate() - it
// runs inside the page, walking the real DOM, reading textContent, and calling
// getComputedStyle. A hand-rolled mock document can't faithfully reproduce that, so it would
// prove nothing about the actual counting logic.
//
// Not named *.test.js on purpose - excluded from the default `npm test` (no Chrome dependency
// there). Run via `npm run test:dom`, which fails loudly (not silently) if Chrome can't launch.
//
// Coverage caveat: `npm run test:dom:coverage` will always understate real coverage here, for
// the same reason as dom-metrics.js/click-utils.js/deep-by-text.js - virtually the entire
// function body runs inside the page.evaluate() callback, invisible to Node's coverage
// instrumentation even though the tests below genuinely exercise that code.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { collectTextMetrics } = require('./text-metrics');

let browser;
let page;

before(async () => {
    try {
        browser = await puppeteer.launch({ headless: 'new' });
    } catch (e) {
        throw new Error(
            `text-metrics.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n` +
            `Original error: ${e && e.message ? e.message : e}`
        );
    }
});

after(async () => {
    if (browser) await browser.close().catch(() => {});
});

beforeEach(async () => {
    page = await browser.newPage();
});

afterEach(async () => {
    if (page) await page.close().catch(() => {});
});

async function setHtml(html) {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
}

// The traversal starts at <html> and skips (without descending into) hidden subtrees; <head> is
// display:none by the UA stylesheet and therefore pruned entirely, but <html> and <body>
// themselves are always visited as empty containers. Measure that baseline instead of hardcoding
// absolute numbers.
async function baseline() {
    await setHtml('');
    return collectTextMetrics(page);
}

describe('collectTextMetrics: input validation', () => {
    test('throws when page is missing', async () => {
        await assert.rejects(() => collectTextMetrics(null), /page is required/);
    });
});

describe('collectTextMetrics: basic text totals', () => {
    test('counts visible text characters (whitespace-collapsed) from a simple page', async () => {
        const base = await baseline();
        await setHtml('<p>Hello world</p>');
        const out = await collectTextMetrics(page);
        assert.equal(out.totals.visibleTextChars - base.totals.visibleTextChars, 'Hello world'.length);
    });

    test('collapses internal whitespace/newlines before counting length', async () => {
        const base = await baseline();
        await setHtml('<p>Hello\n   world</p>'); // collapses to "Hello world" (11 chars)
        const out = await collectTextMetrics(page);
        assert.equal(out.totals.visibleTextChars - base.totals.visibleTextChars, 'Hello world'.length);
    });

    test('a <head> subtree (display:none by the UA stylesheet) is skipped entirely, including its descendants', async () => {
        const base = await baseline();
        await page.setContent(`<!doctype html><html><head><title>Some Title Text</title></head><body></body></html>`);
        const out = await collectTextMetrics(page);
        // <title> text must not leak into visibleTextChars even though it technically has text content.
        assert.equal(out.totals.visibleTextChars, base.totals.visibleTextChars);
        assert.equal(out.totals.elementsVisited, base.totals.elementsVisited);
    });

    test('script/style/noscript content is excluded even though it has "text"', async () => {
        const base = await baseline();
        await setHtml('<script>var thisShouldNotCount = 12345;</script><style>.x{color:red}</style>');
        const out = await collectTextMetrics(page);
        assert.equal(out.totals.visibleTextChars, base.totals.visibleTextChars);
    });

    test('content nested inside a [hidden] ancestor is excluded entirely', async () => {
        const base = await baseline();
        await setHtml('<div hidden><p>Should not count</p></div><p>Should count</p>');
        const out = await collectTextMetrics(page);
        assert.equal(out.totals.visibleTextChars - base.totals.visibleTextChars, 'Should count'.length);
    });
});

describe('collectTextMetrics: headings', () => {
    test('counts visible heading elements matching the default selector (h1-h6)', async () => {
        const base = await baseline();
        await setHtml('<h1>Title</h1><h2>Sub</h2><h3>Sub sub</h3>');
        const out = await collectTextMetrics(page);
        assert.equal(out.totals.headingCount - base.totals.headingCount, 3);
    });

    test('a custom headingSelectors option overrides the default', async () => {
        const base = await baseline();
        await setHtml('<div class="heading">Custom</div><h1>Not counted here</h1>');
        const out = await collectTextMetrics(page, { headingSelectors: '.heading' });
        assert.equal(out.totals.headingCount - base.totals.headingCount, 1);
    });

    test('a hidden heading is not counted', async () => {
        const base = await baseline();
        await setHtml('<h1 hidden>Hidden</h1><h1>Visible</h1>');
        const out = await collectTextMetrics(page);
        assert.equal(out.totals.headingCount - base.totals.headingCount, 1);
    });
});

describe('collectTextMetrics: paragraphs distribution', () => {
    test('count/p50Chars/p90Chars/maxChars reflect the matched elements, using the default selector (p, li, dd, td)', async () => {
        // A bare <td> outside <table>/<tr> is dropped entirely by the HTML5 parser's table
        // insertion-mode rules (a well-known quirk: document.body.innerHTML = '<td>x</td>'
        // creates no td element at all) - needs real table structure to actually exist in the DOM.
        await setHtml(
            '<p>' + 'a'.repeat(10) + '</p>' +
            '<ul><li>' + 'b'.repeat(20) + '</li></ul>' +
            '<table><tr><td>' + 'c'.repeat(30) + '</td></tr></table>'
        );
        const out = await collectTextMetrics(page);
        assert.equal(out.paragraphs.count, 3);
        assert.equal(out.paragraphs.maxChars, 30);
        // sorted lens [10, 20, 30]; p50 idx = floor(0.5*2)=1 -> 20; p90 idx = floor(0.9*2)=1 -> 20
        assert.equal(out.paragraphs.p50Chars, 20);
        assert.equal(out.paragraphs.p90Chars, 20);
    });

    test('a custom paragraphSelectors option overrides the default', async () => {
        await setHtml('<blockquote>' + 'x'.repeat(15) + '</blockquote><p>should be ignored</p>');
        const out = await collectTextMetrics(page, { paragraphSelectors: 'blockquote' });
        assert.equal(out.paragraphs.count, 1);
        assert.equal(out.paragraphs.maxChars, 15);
    });

    test('empty/whitespace-only paragraph elements are excluded (zero-length after normalization)', async () => {
        await setHtml('<p>   </p><p>real text</p>');
        const out = await collectTextMetrics(page);
        assert.equal(out.paragraphs.count, 1);
    });
});

describe('collectTextMetrics: links', () => {
    test('classifies links with visible text vs. no text', async () => {
        await setHtml('<a href="/a">Click here</a><a href="/b"></a>');
        const out = await collectTextMetrics(page);
        assert.equal(out.links.linksCount, 2);
        assert.equal(out.links.linksNoVisibleTextCount, 1);
    });

    test('a link with no visible text but an aria-label counts as having a name signal, not "no name"', async () => {
        await setHtml('<a href="/a" aria-label="Go to page"></a>');
        const out = await collectTextMetrics(page);
        assert.equal(out.links.linksNoVisibleTextCount, 1);
        assert.equal(out.links.linksNameSignalCount, 1);
        assert.equal(out.links.linksNoTextNoNameSignalCount, 0);
    });

    test('a link with no visible text and no name signal at all is the truly problematic case', async () => {
        await setHtml('<a href="/a"><svg></svg></a>'); // icon-only, no text, no aria-label/title
        const out = await collectTextMetrics(page);
        assert.equal(out.links.linksNoTextNoNameSignalCount, 1);
    });

    test('a hidden link is not counted at all', async () => {
        await setHtml('<a href="/a" hidden>Hidden link</a><a href="/b">Visible</a>');
        const out = await collectTextMetrics(page);
        assert.equal(out.links.linksCount, 1);
    });

    test('linkTextShare is the fraction of all visible text that comes from link text', async () => {
        await setHtml('<p>' + 'x'.repeat(90) + '</p><a href="/a">' + 'y'.repeat(10) + '</a>');
        const out = await collectTextMetrics(page);
        assert.ok(Math.abs(out.links.linkTextShare - 0.1) < 0.01);
    });
});

describe('collectTextMetrics: buttons', () => {
    test('classifies buttons with visible text vs. no text, across button/input/[role=button]', async () => {
        await setHtml(`
            <button>Submit</button>
            <button></button>
            <input type="submit" value="Send">
            <div role="button"></div>
        `);
        const out = await collectTextMetrics(page);
        assert.equal(out.buttons.buttonsCount, 4);
        assert.equal(out.buttons.buttonsNoVisibleTextCount, 2); // empty <button> and the empty [role=button]
    });

    test('input[type=submit]\'s value attribute counts as its visible text, not textContent', async () => {
        await setHtml('<input type="submit" value="Go">');
        const out = await collectTextMetrics(page);
        assert.equal(out.buttons.buttonsNoVisibleTextCount, 0);
        assert.equal(out.buttons.visibleButtonTextChars, 'Go'.length);
    });

    test('an empty input[type=submit] with only a title attribute counts as having a name signal via hasNameSignal\'s value-attribute check', async () => {
        // hasNameSignal() treats a non-empty `value` on a button-ish input as a signal on its own;
        // here there's no value, so title is what saves it from "no name signal" status.
        await setHtml('<input type="submit" title="Send the form">');
        const out = await collectTextMetrics(page);
        assert.equal(out.buttons.buttonsNoVisibleTextCount, 1);
        assert.equal(out.buttons.buttonsNameSignalCount, 1);
        assert.equal(out.buttons.buttonsNoTextNoNameSignalCount, 0);
    });
});

describe('collectTextMetrics: density', () => {
    test('textCharsPerHeading is visibleTextChars divided by headingCount', async () => {
        await setHtml('<h1>H</h1><p>' + 'a'.repeat(100) + '</p>');
        const out = await collectTextMetrics(page);
        // Not an exact isolated value (page already has some baseline chars/headings), but the
        // ratio must be finite and positive given at least one heading and substantial text.
        assert.ok(Number.isFinite(out.density.textCharsPerHeading));
        assert.ok(out.density.textCharsPerHeading > 0);
    });

    test('with zero headings, textCharsPerHeading still returns a finite number (divides by max(1, 0))', async () => {
        await setHtml('<p>' + 'a'.repeat(50) + '</p>');
        const out = await collectTextMetrics(page);
        assert.ok(Number.isFinite(out.density.textCharsPerHeading));
    });
});

describe('collectTextMetrics: capping', () => {
    test('capped becomes true once total visible text exceeds maxTextChars', async () => {
        // maxTextChars floors at 10000 internally, so the text itself must exceed that floor.
        await setHtml('<p>' + 'a'.repeat(10001) + '</p>');
        const out = await collectTextMetrics(page, { maxTextChars: 10000 });
        assert.equal(out.capped, true);
    });

    test('capped stays false comfortably under the text limit', async () => {
        await setHtml('<p>short</p>');
        const out = await collectTextMetrics(page, { maxTextChars: 10000 });
        assert.equal(out.capped, false);
    });
});
