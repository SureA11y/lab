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
