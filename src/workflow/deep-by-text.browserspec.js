'use strict';

// Real-Chrome integration tests for deep-by-text.js's resolveByTextDeepHandle.
//
// Why real Chrome: this module's entire job is real-DOM/shadow-DOM traversal plus visibility
// (getComputedStyle/getBoundingClientRect) and hit-testing (elementFromPoint) decisions. None
// of that can be faithfully represented by a hand-rolled mock.
//
// Not named *.test.js on purpose - excluded from the default `npm test` (no Chrome dependency
// there). Run via `npm run test:dom`, which fails loudly (not silently) if Chrome can't launch.
//
// Coverage caveat: `npm run test:dom:coverage` will always understate real coverage for
// deep-by-text.js, badly. Virtually all of its logic (the entire EVAL_RESOLVE_FN body) runs
// inside a callback passed to page.evaluateHandle(), which gets serialized and actually
// executes inside Chrome's own V8 isolate via CDP, not in the Node.js process - so Node's
// coverage instrumentation has no visibility into it at all, even though the tests below
// genuinely exercise that code (that's what the real-DOM assertions verify: actual matches,
// actual shadow-DOM traversal, actual results). The reported uncovered range for that function
// body is a blind spot in what the tool can measure, not a gap in what's actually tested.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { resolveByTextDeepHandle } = require('./deep-by-text');

let browser;
let page;

before(async () => {
    try {
        browser = await puppeteer.launch({ headless: 'new', ignoreHTTPSErrors: true });
    } catch (e) {
        throw new Error(
            `deep-by-text.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n` +
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

async function idOf(handle) {
    if (!handle) return null;
    return page.evaluate(el => el.id || el.tagName, handle);
}

describe('resolveByTextDeepHandle: basic text matching', () => {
    test('finds an interactive element by visible text (substring, case-insensitive by default)', async () => {
        await setHtml(`<button id="target">Submit Form</button>`);
        const h = await resolveByTextDeepHandle(page, { needle: 'submit', timeoutMs: 500 });
        assert.equal(await idOf(h), 'target');
    });

    test('exact:true requires the full normalized name to match, not a substring', async () => {
        await setHtml(`<button id="a">Submit</button><button id="b">Submit form</button>`);
        const h = await resolveByTextDeepHandle(page, { needle: 'Submit', exact: true, timeoutMs: 500 });
        assert.equal(await idOf(h), 'a');
    });

    test('caseSensitive:true rejects a differently-cased match', async () => {
        await setHtml(`<button id="target">SUBMIT</button>`);
        const h = await resolveByTextDeepHandle(page, { needle: 'submit', caseSensitive: true, timeoutMs: 300 });
        assert.equal(h, null);
    });

    test('returns null when nothing matches, after waiting out timeoutMs', async () => {
        await setHtml(`<button id="target">Cancel</button>`);
        const started = Date.now();
        const h = await resolveByTextDeepHandle(page, { needle: 'submit', timeoutMs: 300 });
        assert.equal(h, null);
        assert.ok(Date.now() - started >= 280);
    });

    test('skips a display:none match and finds the next visible one', async () => {
        await setHtml(`
            <button id="hidden" style="display:none">Submit</button>
            <button id="visible">Submit</button>
        `);
        const h = await resolveByTextDeepHandle(page, { needle: 'submit', timeoutMs: 500 });
        assert.equal(await idOf(h), 'visible');
    });
});

describe('resolveByTextDeepHandle: accessible-name fallbacks', () => {
    test('falls back to aria-label when there is no visible text', async () => {
        await setHtml(`<button id="target" aria-label="Close dialog"></button>`);
        const h = await resolveByTextDeepHandle(page, { needle: 'close dialog', timeoutMs: 500 });
        assert.equal(await idOf(h), 'target');
    });

    test('falls back to aria-labelledby, resolving the referenced element\'s text', async () => {
        await setHtml(`
            <span id="lbl">Close the dialog</span>
            <button id="target" aria-labelledby="lbl"></button>
        `);
        const h = await resolveByTextDeepHandle(page, { needle: 'close the dialog', timeoutMs: 500 });
        assert.equal(await idOf(h), 'target');
    });

    test('falls back to the title attribute', async () => {
        await setHtml(`<button id="target" title="Delete item"></button>`);
        const h = await resolveByTextDeepHandle(page, { needle: 'delete item', timeoutMs: 500 });
        assert.equal(await idOf(h), 'target');
    });

    test('input[type=submit] falls back to its value attribute', async () => {
        await setHtml(`<input id="target" type="submit" value="Send now">`);
        const h = await resolveByTextDeepHandle(page, { needle: 'send now', timeoutMs: 500 });
        assert.equal(await idOf(h), 'target');
    });
});

describe('resolveByTextDeepHandle: checkbox/radio label association', () => {
    test('preferLabelForCheckables (default true) resolves an explicit label[for] to the LABEL, not the input', async () => {
        await setHtml(`
            <input id="cb" type="checkbox">
            <label id="lbl" for="cb">Accept terms</label>
        `);
        const h = await resolveByTextDeepHandle(page, { needle: 'accept terms', timeoutMs: 500 });
        assert.equal(await idOf(h), 'lbl');
    });

    test('preferLabelForCheckables resolves an implicit wrapping label to the LABEL', async () => {
        await setHtml(`
            <label id="lbl"><input id="cb" type="checkbox"> Accept terms</label>
        `);
        const h = await resolveByTextDeepHandle(page, { needle: 'accept terms', timeoutMs: 500 });
        assert.equal(await idOf(h), 'lbl');
    });

    test('preferLabelForCheckables:false returns the input itself even though a label exists', async () => {
        await setHtml(`
            <input id="cb" type="checkbox">
            <label id="lbl" for="cb">Accept terms</label>
        `);
        const h = await resolveByTextDeepHandle(page, {
            needle: 'accept terms', timeoutMs: 500, preferLabelForCheckables: false
        });
        // A checkbox's own name candidates already include its associated label's text (that's
        // how getNameCandidates lets it match at all) - preferLabelForCheckables only controls
        // whether a *match* on the checkbox gets redirected to the label element on return.
        // With it off, the checkbox itself matches "accept terms" and is returned unchanged.
        assert.equal(await idOf(h), 'cb');
    });
});

describe('resolveByTextDeepHandle: shadow DOM', () => {
    test('finds a match inside an open shadow root', async () => {
        await setHtml(`<div id="host"></div>`);
        await page.evaluate(() => {
            const host = document.getElementById('host');
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = '<button id="inner">Shadow Submit</button>';
        });
        const h = await resolveByTextDeepHandle(page, { needle: 'shadow submit', timeoutMs: 500 });
        assert.equal(await idOf(h), 'inner');
    });

    test('finds a match nested two shadow roots deep', async () => {
        await setHtml(`<div id="host"></div>`);
        await page.evaluate(() => {
            const host = document.getElementById('host');
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = '<div id="inner-host"></div>';
            const innerHost = root.getElementById('inner-host');
            const innerRoot = innerHost.attachShadow({ mode: 'open' });
            innerRoot.innerHTML = '<button id="deep">Deep Submit</button>';
        });
        const h = await resolveByTextDeepHandle(page, { needle: 'deep submit', timeoutMs: 500 });
        assert.equal(await idOf(h), 'deep');
    });
});

describe('resolveByTextDeepHandle: pointer-fallback oversized-container avoidance', () => {
    // Guards findTextHit's pointer-fallback: when the only candidate is a giant generic wrapper
    // (isTooLargeContainer rejects anything covering >60% of the viewport) and no smaller
    // acceptable ancestor exists, it must report "no match" (return null) rather than return the
    // oversized element as a click target. Walking via parentElement can only reach ancestors
    // >= the child's size, so it can never rescue an oversized hit.
    test('returns null rather than a full-viewport container as the click target', async () => {
        await setHtml(`
            <div id="huge" style="width:100%; height:100vh; margin:0; padding:20px; box-sizing:border-box;">
                needle text here
            </div>
        `);
        const h = await resolveByTextDeepHandle(page, {
            needle: 'needle text here', timeoutMs: 500, allowPointerFallback: true
        });
        assert.equal(h, null);
    });
});

describe('resolveByTextDeepHandle: containerSel scoping', () => {
    test('ignores a match outside the container and finds the one inside', async () => {
        await setHtml(`
            <button id="outside">Submit</button>
            <div id="scope"><button id="inside">Submit</button></div>
        `);
        const h = await resolveByTextDeepHandle(page, { containerSel: '#scope', needle: 'submit', timeoutMs: 500 });
        assert.equal(await idOf(h), 'inside');
    });

    test('returns null if the only match is outside the container', async () => {
        await setHtml(`
            <button id="outside">Submit</button>
            <div id="scope"><button id="other">Cancel</button></div>
        `);
        const h = await resolveByTextDeepHandle(page, { containerSel: '#scope', needle: 'submit', timeoutMs: 300 });
        assert.equal(h, null);
    });
});

describe('resolveByTextDeepHandle: pointer fallback (allowPointerFallback)', () => {
    test('without allowPointerFallback, plain non-interactive text is not found', async () => {
        await setHtml(`<div id="target" style="padding:20px">Just some plain text</div>`);
        const h = await resolveByTextDeepHandle(page, { needle: 'plain text', timeoutMs: 300 });
        assert.equal(h, null);
    });

    test('with allowPointerFallback:true, plain non-interactive text becomes findable via hit-testing', async () => {
        await setHtml(`<div id="target" style="padding:20px; display:inline-block">Just some plain text</div>`);
        const h = await resolveByTextDeepHandle(page, {
            needle: 'plain text', timeoutMs: 500, allowPointerFallback: true
        });
        assert.notEqual(h, null);
        // The returned node should be the text's element itself or a visible ancestor of it.
        const ok = await page.evaluate((el, targetId) => {
            const target = document.getElementById(targetId);
            return el === target || target.contains(el) || el.contains(target);
        }, h, 'target');
        assert.equal(ok, true);
    });
});

describe('resolveByTextDeepHandle: interactiveSelector override', () => {
    test('a custom interactiveSelector is honored instead of the built-in default list', async () => {
        await setHtml(`<div id="target" data-clickable="true">Custom widget</div>`);
        // A <div> is not in the default interactive list, so without the override this would
        // require allowPointerFallback; with the override it should be found directly.
        const h = await resolveByTextDeepHandle(page, {
            needle: 'custom widget',
            timeoutMs: 500,
            interactiveSelector: '[data-clickable="true"]'
        });
        assert.equal(await idOf(h), 'target');
    });
});
