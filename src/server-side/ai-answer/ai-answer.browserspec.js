'use strict';

// Real-Chrome check of the AI pass: it reads the page around an element, and
// drops its answers if it changed the page. Needs Chrome (via Puppeteer).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { answerCantTells } = require('./index');

let browser;
before(async () => { browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }); });
after(async () => { if (browser) await browser.close().catch(() => {}); });

const HTML = '<title>Cart - Shop</title><h1>Cart</h1><ul><li><a href="/p"><img id="i" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E" alt="Shoes"></a></li></ul>';

function canonical() {
    return { findings: [{ outcome: 'cantTell', occurrences: [{
        atomicCheckId: 'img-alt-quality', occurrenceOutcome: 'cantTell', target: ['#i'], html: '<img id="i" alt="Shoes">', failureSummary: 'check alt',
    }] }] };
}

test('the model is given the page around the element, and its answer is attached', async () => {
    const page = await browser.newPage();
    await page.setContent(HTML);
    let prompt = '';
    const c = canonical();
    await answerCantTells({ page, canonical: c, provider: { ask: async (p) => { prompt = p; return '{"verdict":"pass","confidence":0.9,"rationale":"ok"}'; } } });
    assert.match(prompt, /<li><a href=/);
    assert.equal(c.findings[0].occurrences[0].ai.provenance, 'ai-supported');
    await page.close();
});

test('a pass that changes the page keeps no answers and says so', async () => {
    const page = await browser.newPage();
    await page.setContent(HTML);
    const c = canonical();
    const provider = { ask: async () => { await page.evaluate(() => { document.body.append(document.createElement('p')); }); return '{"verdict":"pass","confidence":0.9,"rationale":"ok"}'; } };
    const s = await answerCantTells({ page, canonical: c, provider });
    assert.equal(s.stateDrift, 'detected');
    assert.equal(c.findings[0].occurrences[0].ai, undefined);
    await page.close();
});

test('the facts a person would read off the element are read from the page', async () => {
    const { readFacts } = require('./evidence');
    const page = await browser.newPage();
    await page.setContent('<h2>Shoes</h2><a href="/p"><img id="i" src="data:," alt="Canvas shoes"></a><a href="/q">More</a><a href="/r">More</a><button id="b"><svg aria-hidden="true" width="8" height="8"></svg></button>');
    const img = await readFacts(page, '#i');
    assert.equal(img.alt, 'Canvas shoes');
    assert.equal(img.control.href, '/p');
    assert.deepEqual(img.accessibleName, { role: 'image', name: 'Canvas shoes' });
    assert.equal(img.nearestHeadingBefore, 'Shoes');
    const button = await readFacts(page, '#b');
    assert.equal(button.accessibleName.name, '');
    const more = await readFacts(page, 'a[href="/q"]');
    assert.deepEqual(more.sameTextLinks, { others: 1, distinctTargets: ['/r'] });
    assert.equal(await readFacts(page, '#nothing'), null);
    await page.close();
});

test("the pass takes a picture of a shown element without moving the page, and keeps it out of the prompt", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 400 });
    await page.setContent('<div style="height:900px">top</div><p id="i" style="font-size:30px">Down below</p><p id="h" style="display:none">hidden</p>');
    await page.evaluate(() => window.scrollTo(0, 0));
    let prompt = "";
    const c = { findings: [{ outcome: "cantTell", occurrences: [
        { atomicCheckId: "p-as-heading", occurrenceOutcome: "cantTell", target: ["#i"], html: '<p id="i">Down below</p>', failureSummary: "x" },
        { atomicCheckId: "p-as-heading", occurrenceOutcome: "cantTell", target: ["#h"], html: '<p id="h">hidden</p>', failureSummary: "x" },
    ] }] };
    const s = await answerCantTells({ page, canonical: c, provider: { ask: async (p) => { prompt += p; return '{"verdict":"pass","confidence":0.9,"rationale":"ok"}'; } } });
    assert.equal(s.stateDrift, "none");
    const [shown, hidden] = c.findings[0].occurrences;
    assert.match(shown.ai.evidence.screenshot, /^data:image\/jpeg;base64,/);
    assert.equal(hidden.ai.evidence.screenshot, undefined);
    assert.doesNotMatch(prompt, /base64/);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.close();
});

test('an image question says what the picture shows: blank, one colour, or not readable', async () => {
    const SPACER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const RED = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#ff0000"/></svg>');
    const page = await browser.newPage();
    await page.setContent(`<title>Images</title><p><img id="s" src="${SPACER}" alt="" width="10" height="25"> None</p><p><img id="r" src="${RED}" alt="" width="20" height="10"> Bar</p>`);
    const c = { findings: [{ outcome: 'cantTell', occurrences: ['s', 'r'].map((id) => ({ atomicCheckId: 'img-alt-decorative', occurrenceOutcome: 'cantTell', target: ['#' + id], html: `<img id="${id}" alt="">` })) }] };
    const prompts = [];
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async (p) => { prompts.push(p); return '{"verdict":"pass","confidence":0.9,"rationale":"ok"}'; } } });
    const [spacer, red] = c.findings[0].occurrences.map((o) => o.ai.evidence.image.look);
    assert.deepEqual([spacer.readable, spacer.blank], [true, true]);
    assert.deepEqual([red.readable, red.blank, red.colours, red.mainColour], [true, false, 1, '#ff0000']);
    assert.match(prompts[0], /"blank":true/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), 0, 'no canvas left in the page');
    await page.close();

    // An image from another site: its pixels are kept from the page.
    const http = require('node:http');
    const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#00f"/></svg>'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const other = await browser.newPage();
    await other.setContent(`<title>x</title><img id="o" src="http://127.0.0.1:${server.address().port}/a.svg" alt="">`);
    await other.waitForFunction(() => document.getElementById('o').complete);
    const o = { findings: [{ outcome: 'cantTell', occurrences: [{ atomicCheckId: 'img-alt-decorative', occurrenceOutcome: 'cantTell', target: ['#o'], html: '<img id="o" alt="">' }] }] };
    await answerCantTells({ page: other, canonical: o, env: {}, provider: { ask: async () => '{"verdict":"unsure","confidence":0.3,"rationale":"x"}' } });
    const look = o.findings[0].occurrences[0].ai.evidence.image.look;
    assert.equal(look.readable, false);
    assert.match(look.why, /another site/);
    await other.close();
    await new Promise((r) => server.close(r));
});

test('an SVG question gets what the SVG draws, not its path data', async () => {
    const page = await browser.newPage();
    const LONG = 'M' + '10,10 L20,20 '.repeat(40);
    await page.setContent(`<title>Icons</title><svg style="display:none"><symbol id="icon-search"><path d="${LONG}"/></symbol></svg>
<p><a href="/s"><svg id="s" class="icon-search" role="img" aria-label="Search"><use href="#icon-search"/></svg></a></p>
<p><button type="button"><svg id="l" role="img" width="20" height="20"><title>Layer 1</title><desc>Exported</desc><path d="${LONG}"/><text x="2" y="12">Go</text></svg></button></p>`);
    const html = await page.$eval('#l', (e) => e.outerHTML);
    const c = { findings: [{ outcome: 'cantTell', occurrences: [
        { atomicCheckId: 'svg-text-alternative-quality', occurrenceOutcome: 'cantTell', target: ['#s'], html: '<svg id="s" aria-label="Search"></svg>' },
        { atomicCheckId: 'svg-text-alternative-quality', occurrenceOutcome: 'cantTell', target: ['#l'], html },
    ] }] };
    const prompts = [];
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async (p) => { prompts.push(p); return '{"verdict":"fail","confidence":0.9,"rationale":"Layer 1 names nothing."}'; } } });
    const [search, layer] = c.findings[0].occurrences.map((o) => o.ai);
    assert.deepEqual(search.evidence.image.svg.uses, ['#icon-search']);
    assert.equal(search.evidence.image.svg.classes, 'icon-search');
    assert.deepEqual([layer.evidence.image.svg.title, layer.evidence.image.svg.desc, layer.evidence.image.svg.texts], ['Layer 1', 'Exported', ['Go']]);
    assert.doesNotMatch(layer.evidence.image.svg.markup, /L20,20 L20/, 'the path data is left out');
    assert.doesNotMatch(prompts[1], /10,10 L20,20 10,10/, 'from the element too');
    assert.equal(layer.provenance, 'ai-supported');
    await page.close();
});
