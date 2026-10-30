'use strict';

// Real-Chrome integration tests for dom-metrics.js's collectDomMetrics.
//
// Why real Chrome: this function's entire body is a callback passed to page.evaluate() - it
// runs inside the page, walking the real DOM and calling getComputedStyle. A hand-rolled mock
// document can't faithfully reproduce computed-style cascade or querySelectorAll semantics, so
// it would prove nothing about the actual counting/classification logic.
//
// Not named *.test.js on purpose - excluded from the default `npm test` (no Chrome dependency
// there). Run via `npm run test:dom`, which fails loudly (not silently) if Chrome can't launch.
//
// Coverage caveat: `npm run test:dom:coverage` will always understate real coverage here.
// Virtually the entire function body runs inside the page.evaluate() callback, which gets
// serialized and actually executes inside Chrome's own V8 isolate via CDP, not in the Node.js
// process - invisible to Node's coverage instrumentation even though the tests below genuinely
// exercise that code (that's what the real-DOM assertions verify).

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { collectDomMetrics } = require('./dom-metrics');

let browser;
let page;

before(async () => {
    try {
        browser = await puppeteer.launch({ headless: 'new' });
    } catch (e) {
        throw new Error(
            `dom-metrics.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n` +
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

describe('collectDomMetrics: input validation', () => {
    test('throws when page is missing', async () => {
        await assert.rejects(() => collectDomMetrics(null), /page is required/);
    });
});

describe('collectDomMetrics: basic counts', () => {
    test('counts div/span tags, and includes timings', async () => {
        await setHtml('<div></div><div></div><span></span>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.div, 2);
        assert.equal(out.counts.span, 1);
        assert.equal(typeof out.timings.totalMs, 'number');
    });

    test('semantic tags (nav, main, button, etc.) are counted separately from div/span', async () => {
        await setHtml('<main></main><nav></nav><div></div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.semantic, 2);
        assert.equal(out.counts.div, 1);
    });

    test('depthMax reflects the deepest nesting level', async () => {
        await setHtml('<div><div><div><span>deep</span></div></div></div>');
        const out = await collectDomMetrics(page);
        // html > body > div > div > div > span: depth counted from documentElement at depth 1
        assert.ok(out.depthMax >= 6);
    });
});

describe('collectDomMetrics: interactiveNativeCount', () => {
    test('counts native interactive tags, but an <a> only counts when it has href', async () => {
        await setHtml('<a href="/x">link</a><a>no href</a><button>btn</button>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.interactiveNative, 2); // href-anchor + button, not the bare <a>
    });
});

describe('collectDomMetrics: customControlCount heuristic', () => {
    test('a non-native element with an interactive ARIA role is counted as a custom control', async () => {
        await setHtml('<div role="button">Click</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.customControls, 1);
    });

    test('a non-native element with a focusable tabindex is counted as a custom control', async () => {
        await setHtml('<div tabindex="0">Focusable</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.customControls, 1);
    });

    test('a plain div with no role/tabindex/onclick is NOT counted as a custom control', async () => {
        await setHtml('<div>Just text</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.customControls, 0);
    });

    test('onclick alone (without a focusability signal) does not count as a custom control', async () => {
        await setHtml('<div onclick="void 0">Click</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.customControls, 0);
    });

    test('onclick plus a focusability signal (tabindex) does count', async () => {
        await setHtml('<div onclick="void 0" tabindex="0">Click</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.customControls, 1);
    });

    test('a native interactive tag (e.g. button) is never counted as a "custom" control', async () => {
        await setHtml('<button role="button" tabindex="0">Native</button>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.customControls, 0);
    });
});

describe('collectDomMetrics: hidden detection', () => {
    // The traversal starts at document.documentElement, so it always visits <head> (and
    // whatever's inside it) too - and <head>/<style>/<script>/etc. are computed display:none by
    // the browser's own UA stylesheet, so they correctly count as "hidden" on every page,
    // even ones with no test-specific hidden elements at all. Measure that baseline first and
    // assert on the delta, rather than a brittle absolute count that would break if a future
    // Chrome version changes how many implicit elements a bare page contains.
    async function baselineHiddenCount() {
        await setHtml('');
        return (await collectDomMetrics(page)).counts.hidden;
    }

    test('detects [hidden] and aria-hidden="true"', async () => {
        const base = await baselineHiddenCount();
        await setHtml('<div hidden></div><div aria-hidden="true"></div><div>visible</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.hidden - base, 2);
    });

    test('detects inline style display:none / visibility:hidden', async () => {
        const base = await baselineHiddenCount();
        await setHtml('<div style="display:none"></div><div style="visibility:hidden"></div><div>visible</div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.counts.hidden - base, 2);
    });

    test('detects CSS-class-driven hidden via computed style when includeComputedVisibility is true (default)', async () => {
        const base = await baselineHiddenCount();
        await page.setContent(`<!doctype html><html><head><style>.hide{display:none}</style></head>
            <body><div class="hide"></div><div>visible</div></body></html>`);
        const out = await collectDomMetrics(page, { includeComputedVisibility: true });
        // +1 for the intentionally-hidden div; the <style> tag itself is also display:none, but
        // baselineHiddenCount() didn't include one, so it adds its own +1 here too.
        assert.equal(out.counts.hidden - base, 2);
    });

    test('does NOT detect CSS-class-driven hidden when includeComputedVisibility is false', async () => {
        await page.setContent(`<!doctype html><html><head><style>.hide{display:none}</style></head>
            <body><div class="hide"></div><div>visible</div></body></html>`);
        const out = await collectDomMetrics(page, { includeComputedVisibility: false });
        assert.equal(out.counts.hidden, 0);
    });
});

describe('collectDomMetrics: misc counters', () => {
    test('iframeCount, dialogCount, detailsCount, tablistCount, ariaExpandedCount', async () => {
        await setHtml(`
            <iframe></iframe>
            <dialog></dialog>
            <details></details>
            <div role="tablist"></div>
            <button aria-expanded="false"></button>
        `);
        const out = await collectDomMetrics(page);
        assert.equal(out.iframeCount, 1);
        assert.equal(out.counts.dialog, 1);
        assert.equal(out.counts.details, 1);
        assert.equal(out.counts.tablist, 1);
        assert.equal(out.counts.ariaExpanded, 1);
        assert.equal(out.statefulComponentsCount, 4); // dialog + details + tablist + ariaExpanded
    });

    test('positiveTabindexCount counts only tabindex > 0, not 0 or negative', async () => {
        await setHtml('<div tabindex="1"></div><div tabindex="0"></div><div tabindex="-1"></div>');
        const out = await collectDomMetrics(page);
        assert.equal(out.positiveTabindexCount, 1);
    });

    test('shadowHostCount counts elements with an attached (open) shadow root', async () => {
        await setHtml('<div id="host"></div><div id="plain"></div>');
        await page.evaluate(() => document.getElementById('host').attachShadow({ mode: 'open' }));
        const out = await collectDomMetrics(page);
        assert.equal(out.shadowHostCount, 1);
    });

    test('focusableDensityPer1k reflects the FOCUSABLE_SELECTOR match count relative to totalElements', async () => {
        await setHtml('<button>a</button><a href="/x">b</a><div tabindex="0">c</div>');
        const out = await collectDomMetrics(page);
        assert.ok(out.focusableDensityPer1k > 0);
    });
});

describe('collectDomMetrics: maxNodes capping', () => {
    test('capped becomes true once totalElements exceeds maxNodes, without visiting everything', async () => {
        // Function enforces a floor of 1000 on maxNodes; generate well past that.
        await page.evaluate(() => {
            const frag = document.createDocumentFragment();
            for (let i = 0; i < 1500; i++) frag.appendChild(document.createElement('div'));
            document.body.appendChild(frag);
        });
        const out = await collectDomMetrics(page, { maxNodes: 1000 });
        assert.equal(out.capped, true);
        assert.ok(out.totalElements <= 1001);
    });

    test('capped stays false when well under the node limit', async () => {
        await setHtml('<div></div><div></div><div></div>');
        const out = await collectDomMetrics(page, { maxNodes: 1000 });
        assert.equal(out.capped, false);
    });
});
