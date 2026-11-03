'use strict';

// Real-Chrome check that a scan through @surea11y/puppeteer (surea11y-scan.js)
// returns what core's runa11yCoreInPage returns on the same page with the same
// arguments, handed to page.evaluate directly, as the lab did before, with the
// steps that answer each question (howToCheck), which core adds in Node and the
// binding adds after every scan (addHowToCheck). Guards an update of the
// binding, binding-base or core against changing the lab's results.
//
// Not a *.test.js file, so `npm test` never needs Chrome. Run it with:
//   npm run test:dom
// The page is static: no animation, no network, so two scans of it agree.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { runa11yCoreInPage, addHowToCheck } = require('@surea11y/core');

const { scanPage, scanFrames, captureScreenshots } = require('./surea11y-scan');
const { CAPTURE_BUDGET_MS, TIME_LIMIT_ERROR, screenshotOptionsForStep, storeElementScreenshots } = require('../element-screenshots');

const FIXTURE = `<!doctype html><html lang="en"><head><title>Fixture</title>
<style>.low{color:#999;background:#aaa}</style></head><body>
<header><img src="a.png"><a href="#"></a></header>
<main id="main">
  <h1>Prices</h1><h3>Skipped level</h3>
  <p class="low">Low contrast text</p>
  <form><input type="text"><label for="ghost">Ghost</label><input type="submit" value=""></form>
  <div role="button">Fake</div><span tabindex="5">Tab</span>
  <div id="dup"></div><div id="dup"></div>
  <iframe srcdoc="<img src='b.png'>"></iframe>
  <div id="host"></div>
</main>
<footer class="ad"><a href="#"><img src="c.png"></a></footer>
<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button></button>';</script>
</body></html>`;

const AA = { version: '2.2', level: 'AA' };
const CASES = {
    'no selection': [null, { locale: 'en' }, null],
    'WCAG 2.2 AA': [null, { locale: 'en' }, { wcag: AA, tags: [], excludeTags: [], includeRuleIds: [], excludeRuleIds: [] }],
    'best practices beside WCAG 2.0 A': [null, { locale: 'en' }, { wcag: { version: '2.0', level: 'A' }, bestPractices: true }],
    'a standard profile': [null, { locale: 'en', profile: 'en301549-v3.2.1' }, { tags: [], includeRuleIds: [] }],
    'tags with includeMode or': [null, { locale: 'en' }, { includeMode: 'or', tags: ['wcag2a', 'best-practice'] }],
    'rule ids, excluded ids and a level as options': [null, { locale: 'en', wcagVersion: '2.2', wcagLevel: 'AA' },
        { includeRuleIds: ['image-alt', 'label', 'contrast-minimum'], excludeRuleIds: ['label'] }],
    'scope and exclusions, in French': ['#main', { locale: 'fr', excludeSelectors: ['.ad'] }, { wcag: AA }],
    'a scope matching nothing': ['#missing', { locale: 'en' }, { wcag: AA }],
};

// The clock is the only thing two scans of a static page differ in.
function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v).sort()) if (k !== 'timestamp') o[k] = stable(v[k]);
        return o;
    }
    return v;
}

let browser;

before(async () => {
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    } catch (e) {
        throw new Error(
            'surea11y-scan.browserspec.js requires a working Chrome install (via Puppeteer) and could not launch one.\n'
            + `Original error: ${e && e.message ? e.message : e}`
        );
    }
});

after(async () => {
    if (browser) await browser.close().catch(() => {});
});

async function freshPage() {
    const page = await browser.newPage();
    await page.setContent(FIXTURE, { waitUntil: 'load' });
    return page;
}

describe('surea11y-scan in Chrome', () => {
    for (const [name, [contextSelector, engineOptions, runOnly]] of Object.entries(CASES)) {
        test(`${name}: the binding's result is core's own`, async () => {
            const direct = await freshPage();
            const viaBinding = await freshPage();
            const warn = console.warn;
            console.warn = () => {};
            try {
                const expected = addHowToCheck(await direct.evaluate(runa11yCoreInPage, 'https://example.test/', contextSelector, engineOptions, runOnly));
                const actual = await scanPage(viaBinding, { pageUrl: 'https://example.test/', contextSelector, engineOptions, runOnly });
                assert.ok(Array.isArray(expected.checksResults) && expected.checksResults.length, 'core scanned something');
                assert.deepEqual(stable(actual), stable(expected));
            } finally {
                console.warn = warn;
                await direct.close();
                await viaBinding.close();
            }
        });
    }

    test('an invalid scope fails with core\'s message, and now its code', async () => {
        const page = await freshPage();
        try {
            const expected = await page.evaluate(runa11yCoreInPage, null, '###', { locale: 'en' }, null).catch((e) => e);
            await assert.rejects(
                scanPage(page, { pageUrl: null, contextSelector: '###', engineOptions: { locale: 'en' } }),
                (err) => err.message === expected.message && err.code === 'INVALID_CONTEXT_SELECTOR'
            );
        } finally {
            await page.close();
        }
    });
});

// Pictures of flagged elements (element-screenshots.js), taken through the
// binding in real Chrome: each a PNG holding its element and the padding
// around it, the page put back as it was (scroll, no box left over), and
// the limits the lab sets kept. Images missing their text alternative,
// spaced so most start below the fold and need scrolling to.
const SHOTS_FIXTURE = `<!doctype html><html lang="en"><head><title>Pictures</title>
<style>body{margin:40px} p{margin:0 0 400px} img{display:block;width:120px;height:40px;background:#c00}</style></head><body><main>
${Array.from({ length: 5 }, (_, i) => `<p><img id="i${i}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p>`).join('\n')}
</main></body></html>`;

const IMAGE_ALT = { includeRuleIds: ['img-alt-present'] };

// A PNG's size in pixels, from its header.
function pngSize(buf) {
    assert.ok(Buffer.isBuffer(buf) && buf.subarray(1, 4).toString('latin1') === 'PNG', 'a PNG');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// The distinct pictures of a result, and what the page looks like after.
function shotsOf(result) {
    const all = result.checksResults.flatMap((c) => c.occurrences || []).map((o) => o.screenshot).filter(Boolean);
    return [...new Set(all)];
}

async function shotsPage() {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
    await page.setContent(SHOTS_FIXTURE, { waitUntil: 'load' });
    await page.evaluate(() => window.scrollTo(0, 300));
    return page;
}

const pageState = (page) => page.evaluate(() => ({ scrollY: window.scrollY, boxes: document.querySelectorAll('surea11y-highlight').length }));

describe('element screenshots in Chrome', () => {
    test('pictures each flagged element with its padding, and puts the page back', async () => {
        const page = await shotsPage();
        try {
            const result = await scanPage(page, { pageUrl: 'https://example.test/', runOnly: IMAGE_ALT });
            await captureScreenshots(page, result, { ...screenshotOptionsForStep('fail'), budgetMs: CAPTURE_BUDGET_MS });

            const shots = shotsOf(result);
            assert.equal(shots.length, 5, 'one picture per image');
            for (const shot of shots) {
                const { width, height } = pngSize(shot.buffer);
                // 120x40 and 16px around it, the box where the element is in it.
                assert.ok(width >= 120 + 2 * 16 && height >= 40 + 2 * 16, `${width}x${height}`);
                assert.deepEqual(shot.box && [shot.box.width, shot.box.height], [120, 40]);
                assert.ok(!shot.cropped);
            }
            assert.deepEqual(await pageState(page), { scrollY: 300, boxes: 0 });
        } finally {
            await page.close();
        }
    });

    test('stops at the step\'s limit, and the elements past it say so', async () => {
        const page = await shotsPage();
        try {
            const result = await scanPage(page, { pageUrl: 'https://example.test/', runOnly: IMAGE_ALT });
            await captureScreenshots(page, result, screenshotOptionsForStep('fail', 2));
            const shots = shotsOf(result);
            assert.equal(shots.filter((s) => s.buffer).length, 2);
            assert.deepEqual(shots.filter((s) => !s.buffer).map((s) => s.skipped), ['max-reached', 'max-reached', 'max-reached']);
            assert.deepEqual(await pageState(page), { scrollY: 300, boxes: 0 });
        } finally {
            await page.close();
        }
    });

    test('a per-rule limit pictures that many of the rule\'s elements; with no limit, every one', async () => {
        const page = await shotsPage();
        try {
            const perRule = await scanPage(page, { pageUrl: 'https://example.test/', runOnly: IMAGE_ALT });
            await captureScreenshots(page, perRule, screenshotOptionsForStep('fail', 0, 2));
            const shots = shotsOf(perRule);
            assert.equal(shots.filter((s) => s.buffer).length, 2);
            assert.deepEqual(shots.filter((s) => !s.buffer), [1, 2, 3].map(() => ({ skipped: 'rule-limit', max: 2 })));

            const all = await scanPage(page, { pageUrl: 'https://example.test/', runOnly: IMAGE_ALT });
            await captureScreenshots(page, all, screenshotOptionsForStep('fail', 0, 0));
            assert.equal(shotsOf(all).filter((s) => s.buffer).length, 5);
            assert.deepEqual(await pageState(page), { scrollY: 300, boxes: 0 });
        } finally {
            await page.close();
        }
    });

    test('out of time, no further picture starts and the page is still put back', async () => {
        const page = await shotsPage();
        try {
            const result = await scanPage(page, { pageUrl: 'https://example.test/', runOnly: IMAGE_ALT });
            await captureScreenshots(page, result, { ...screenshotOptionsForStep('fail'), budgetMs: 1 });
            const shots = shotsOf(result);
            assert.equal(shots.length, 5);
            assert.ok(shots.some((s) => s.error === TIME_LIMIT_ERROR), 'some were stopped');
            assert.ok(shots.every((s) => s.buffer || s.error === TIME_LIMIT_ERROR), JSON.stringify(shots.map((s) => s.skipped || 'picture')));
            assert.deepEqual(await pageState(page), { scrollY: 300, boxes: 0 });
        } finally {
            await page.close();
        }
    });

    test('through the engine: the pictures reach the canonical occurrences and are stored as files', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = await shotsPage();
        try {
            const { canonical } = await runOnPage(page, { runOnly: IMAGE_ALT, elementScreenshots: screenshotOptionsForStep('fail') });
            const saved = [];
            const stored = await storeElementScreenshots(canonical, {
                save: async ({ data, filename, dir }) => { saved.push({ data, filename, dir }); return { publicUrl: `/reports/evidence/run/${dir}/${filename}` }; },
                dir: 'elements-scan',
            });
            assert.equal(stored, 5);
            assert.equal(saved.length, 5);
            for (const file of saved) pngSize(file.data);
            const urls = canonical.findings.flatMap((f) => f.occurrences || []).map((o) => o.elementScreenshot && o.elementScreenshot.url).filter(Boolean);
            assert.ok(urls.length >= 5 && urls.every((u) => u.startsWith('/reports/evidence/run/elements-scan/element-')));
            assert.ok(!JSON.stringify(canonical).includes('"buffer"'), 'no image bytes left in the result');
        } finally {
            await page.close();
        }
    });
});

// Core's hooks (installCoreHooks), in real Chrome: installed before the
// page loads, they run early, and let the keyboard rules see a click
// handler added from script.
const HOOKS_FIXTURE = `<!doctype html><html lang="en"><head><title>Hooks</title></head><body><main>
<h1>Settings</h1><div id="save" role="button" tabindex="0">Save</div><div id="status" aria-live="polite"></div>
<script>
document.getElementById('save').addEventListener('click', () => { document.getElementById('status').textContent = 'Saved'; });
</script></main></body></html>`;

describe('core hooks in Chrome', () => {
    const { installCoreHooks } = require('./surea11y-scan');
    const KEYBOARD = { includeRuleIds: ['click-handler-keyboard-operable'] };
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(HOOKS_FIXTURE);

    test('a click handler added from script fails', async () => {
        const page = await browser.newPage();
        try {
            assert.deepEqual(await installCoreHooks(page), ['internals', 'listener', 'liveRegion']);
            await page.goto(url, { waitUntil: 'load' });
            const result = await scanPage(page, { pageUrl: 'https://example.test/', engineOptions: { locale: 'en' }, runOnly: KEYBOARD });
            assert.equal(result.engine.environment.listenerHook, 'early');
            assert.equal(result.engine.environment.liveRegionHook, 'early');
            const check = result.checksResults.find((c) => c.ruleId === 'click-handler-keyboard-operable');
            assert.equal(check.outcome, 'fail');
        } finally {
            await page.close();
        }
    });

    test('without the hooks, the handler is not judged', async () => {
        const page = await browser.newPage();
        try {
            assert.deepEqual(await installCoreHooks(page, []), []);
            await page.goto(url, { waitUntil: 'load' });
            const result = await scanPage(page, { pageUrl: 'https://example.test/', engineOptions: { locale: 'en' }, runOnly: KEYBOARD });
            assert.equal(result.engine.environment.listenerHook, undefined);
            const check = result.checksResults.find((c) => c.ruleId === 'click-handler-keyboard-operable');
            assert.notEqual(check && check.outcome, 'fail');
        } finally {
            await page.close();
        }
    });
});

// Frames are read as core's own scan across frames reads them: those the
// page doesn't show, that the scan excludes or leaves outside its Include, or
// that show nothing are left out, each with its reason, a frame inside one
// with it; one under aria-hidden is scanned as aria-hidden.
describe('frames in Chrome', () => {
    const framesOf = async (page) => {
        const out = {};
        const subs = page.frames().filter((f) => f !== page.mainFrame());
        for (const frame of subs) {
            const el = await frame.frameElement();
            out[await el.evaluate((e) => e.id || `${e.ownerDocument.defaultView.frameElement.id} > inner`)] = frame;
        }
        return { subs, out };
    };

    test('left out, scanned as aria-hidden, or scanned', async () => {
        const page = await browser.newPage();
        try {
            await page.setContent(`<!doctype html><html lang="en"><head><title>Frames</title></head><body><main id="main">
                <iframe id="shown" title="Map" srcdoc="<p>map</p>"></iframe>
                <iframe id="none" style="display:none" srcdoc="<p>x</p>"></iframe>
                <div class="ad"><iframe id="excluded" srcdoc="<p>ad</p>"></iframe></div>
                <iframe id="ah" aria-hidden="TRUE" srcdoc="<img src='a.png'><p>tracker</p><iframe srcdoc='<img src=b.png>'></iframe>"></iframe>
                <iframe id="empty"></iframe>
                <iframe id="shadowed" srcdoc="<body><script>document.body.attachShadow({mode:'open'}).innerHTML='<img src=c.png>'</script></body>"></iframe>
            </main><footer><iframe id="outside" srcdoc="<p>out</p>"></iframe></footer></body></html>`, { waitUntil: 'load' });
            const results = await scanFrames(page, { engineOptions: { locale: 'en', excludeSelectors: ['.ad'] }, contextSelector: '#main' });
            const { subs, out } = await framesOf(page);
            const at = (id) => results[subs.indexOf(out[id])];
            assert.ok(at('shown').result, 'a frame shown is scanned');
            assert.equal(at('none').skipped, 'hidden');
            assert.equal(at('excluded').skipped, 'excluded');
            assert.equal(at('outside').skipped, 'outside-scope');
            assert.equal(at('empty').skipped, 'empty');
            assert.ok(at('shadowed').result, 'a body with a shadow root shows something');
            for (const id of ['ah', 'ah > inner']) {
                assert.equal(at(id).ariaHidden, true, id);
                const img = at(id).result.checksResults.find((c) => c.ruleId === 'img-alt-present');
                assert.notEqual(img && img.outcome, 'fail', `${id}: a name is no rule of what is out of the tree`);
            }
        } finally {
            await page.close();
        }
    });

    test('a lazy frame below the fold is loaded and scanned, under its own URL', async () => {
        const page = await browser.newPage();
        try {
            await page.setContent('<!doctype html><html lang="en"><head><title>Lazy</title></head><body><main>'
                + '<div style="height:4000px"></div>'
                + '<iframe id="lazy" loading="lazy" title="lazy" src="data:text/html,<img src=x.png>"></iframe>'
                + '</main></body></html>', { waitUntil: 'domcontentloaded' });
            const started = Date.now();
            const [lazy] = await scanFrames(page, { engineOptions: { locale: 'en' } });
            assert.ok(Date.now() - started < 9000, 'not waited out');
            assert.ok(lazy.result, lazy.error || lazy.skipped);
            assert.match(String(lazy.url), /^data:text\/html/);
        } finally {
            await page.close();
        }
    });

    test('frames in two shadow roots are told apart, each naming its host', async () => {
        const page = await browser.newPage();
        try {
            await page.setContent('<!doctype html><html lang="en"><head><title>Shadow</title></head><body><main>'
                + '<x-a></x-a><x-a></x-a>'
                + '<script>for (const h of document.querySelectorAll("x-a")) h.attachShadow({mode:"open"}).innerHTML = \'<iframe title="s" srcdoc="<img src=y.png>"></iframe>\';</script>'
                + '</main></body></html>', { waitUntil: 'load' });
            const results = await scanFrames(page, { engineOptions: { locale: 'en' } });
            assert.equal(results.length, 2);
            const selectors = results.map((r) => JSON.stringify(r.frameSelectors));
            assert.notEqual(selectors[0], selectors[1]);
            assert.ok(selectors.every((x) => x.includes('>>>')), selectors.join(' | '));
        } finally {
            await page.close();
        }
    });
});
