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

test('with pictures allowed, an image question sends its picture; one showing a typed value never', async () => {
    const page = await browser.newPage();
    await page.setContent(`<title>Sign in</title><p><img id="i" src="${'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='red'/></svg>")}" alt="Red" width="40" height="20"></p>
        <p id="f"><input type="image" id="go" alt="Go" src="${'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><text y='15'>Go</text></svg>")}" width="40" height="20"> <input id="pw" type="password" value="secret1"></p>`);
    const got = [];
    const c = { findings: [{ outcome: 'cantTell', occurrences: [
        { atomicCheckId: 'img-alt-quality', occurrenceOutcome: 'cantTell', target: ['#i'], html: '<img id="i" alt="Red">', failureSummary: 'x' },
        { atomicCheckId: 'control-name-title-only', occurrenceOutcome: 'cantTell', target: ['#f'], html: '<p id="f">', failureSummary: 'x' },
    ] }] };
    const provider = { ask: async (prompt, o) => { got.push(o.picture); return '{"verdict":"pass","confidence":0.9,"rationale":"ok"}'; } };
    const s = await answerCantTells({ page, canonical: c, provider, options: { pictures: true }, env: { A11Y_AI_PICTURES: 'on' } });
    assert.equal(s.stateDrift, 'none');
    assert.match(got[0], /^data:image\/jpeg;base64,/);
    assert.equal(got[1], null, 'the paragraph holds a password field');
    const [img, form] = c.findings[0].occurrences;
    assert.equal(img.ai.pictureSent, true);
    assert.match(form.ai.evidence.pictureNotSent, /typed/);
    assert.match(form.ai.evidence.screenshot, /^data:image/, 'kept for the review');
    await page.close();
});

test('with forms allowed, a paste is tried and the page put back; the field\'s texts are read', async () => {
    const page = await browser.newPage();
    await page.setContent(`<title>Sign in</title><form>
        <p><label for="pw">Password</label> <input id="pw" type="password" autocomplete="current-password" onpaste="return false"></p>
        <p><label for="pw2">Password again</label> <input id="pw2" type="password" autocomplete="new-password" onpaste="checkPaste(event)"></p>
        <p id="otp">Code <input class="d" maxlength="1" autocomplete="one-time-code" onpaste="spread(event)"><input class="d" maxlength="1"><input class="d" maxlength="1"><input class="d" maxlength="1"></p>
        <p><label for="mail">Email</label> <input id="mail" aria-invalid="true" aria-describedby="mail-hint"> <span id="mail-hint">We never share it.</span> <span style="color:#b00">Enter an email address like name@example.com</span></p>
      </form>
      <script>
        function checkPaste(e) { console.log('pasted'); }
        function spread(e) { e.preventDefault(); const t = e.clipboardData.getData('text'); [...document.querySelectorAll('.d')].forEach((b, i) => { b.value = t[i] || ''; }); }
      </script>`);
    const got = {};
    const provider = { name: 't', model: 't', answer: async (q) => { got[q.element.selector] = q.evidence; return { verdict: 'unsure', confidence: 0 }; } };
    const occ = (check, sel) => ({ atomicCheckId: check, occurrenceOutcome: 'cantTell', target: [sel], html: '<input>', failureSummary: 'x' });
    const c = { findings: [{ outcome: 'cantTell', occurrences: [occ('password-paste-enabled', '#pw'), occ('password-paste-enabled', '#pw2'), occ('password-paste-enabled', '#otp > input:nth-of-type(1)'), occ('invalid-field-error-message', '#mail')] }] };
    const s = await answerCantTells({ page, canonical: c, provider, options: { forms: true }, env: { A11Y_AI_FORM_HOSTS: 'not-this.test' } });
    assert.deepEqual(s.forms, { allowed: false, probed: 0 }, 'about:blank is no listed host');
    assert.equal(got['#pw'].paste, undefined);
    assert.equal(got['#pw'].field.onpaste, 'return false', 'the handler is read without trying');
    // The page's address is not on a host, so the probe itself is tried directly.
    const { collectEvidence } = require('./evidence');
    const ev = async (sel) => (await collectEvidence(page, { target: [sel], html: '' }, ['paste', 'field'], { forms: true }));
    assert.deepEqual((await ev('#pw')).paste, { tried: true, cancelled: true, filledByPage: false, boxes: 4, alerted: false });
    assert.equal((await ev('#pw2')).paste.cancelled, false);
    const otp = (await ev('#otp > input:nth-of-type(1)')).paste;
    assert.equal(otp.cancelled, true);
    assert.equal(otp.filledByPage, true);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.d')].map((b) => b.value)), ['', '', '', ''], 'put back');
    const mail = got['#mail'].field;
    assert.deepEqual(mail.describedBy, [{ id: 'mail-hint', text: 'We never share it.', shown: true, heard: true }]);
    assert.match(mail.groupText, /Enter an email address/);
    assert.equal(mail.hasValue, false);
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

test('an image map area gets the picture it is part of and the other areas; an image button its own picture', async () => {
    const PLAN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="#0a0"/><rect x="20" width="20" height="20" fill="#a50"/></svg>');
    const page = await browser.newPage();
    await page.setContent(`<title>Garden</title><img id="plan" src="${PLAN}" alt="Plan" usemap="#g" width="40" height="20">
<map name="g"><area id="a1" shape="rect" coords="0,0,20,20" href="#house" alt="Greenhouse"><area id="a2" shape="rect" coords="20,0,40,20" href="#shed" alt="Area 2"></map>
<form><input id="b" type="image" src="${PLAN}" alt="Check delivery"></form>`);
    await page.waitForFunction(() => document.getElementById('plan').complete);
    const c = { findings: [{ outcome: 'cantTell', occurrences: [
        { atomicCheckId: 'area-alt-quality', occurrenceOutcome: 'cantTell', target: ['#a2'], html: '<area id="a2" alt="Area 2">' },
        { atomicCheckId: 'input-image-alt-quality', occurrenceOutcome: 'cantTell', target: ['#b'], html: '<input id="b" type="image" alt="Check delivery">' },
    ] }] };
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async () => '{"verdict":"fail","confidence":0.9,"rationale":"x"}' } });
    const [area, button] = c.findings[0].occurrences.map((o) => o.ai.evidence.image);
    assert.equal(area.alt, 'Plan', "the map's picture");
    assert.deepEqual([area.area.coords, area.area.href, area.area.alt], ['20,0,40,20', '#shed', 'Area 2']);
    assert.deepEqual(area.area.otherAreas, [{ name: 'Greenhouse', href: '#house', coords: '0,0,20,20' }]);
    assert.equal(area.look.readable, true);
    assert.equal(button.alt, 'Check delivery');
    assert.deepEqual([button.look.readable, button.look.colours], [true, 2], "the button's own picture, read");
    await page.close();
});

test('an object, a canvas and a video poster bring what they show; a best practice is asked too', async () => {
    const RED = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#ff0000"/></svg>');
    const page = await browser.newPage();
    await page.setContent(`<title>Media</title><object id="o" data="${RED}" type="image/svg+xml" width="20" height="10">Red bar</object>
<canvas id="c" width="10" height="10" aria-label="canvas">No canvas support</canvas><script>const x = document.getElementById('c').getContext('2d'); x.fillStyle = '#00f'; x.fillRect(0, 0, 10, 10);</script>
<figure><video id="v" poster="${RED}" controls></video><figcaption>Pruning roses</figcaption></figure>
<a href="/cart"><img id="i" src="${RED}" alt="Cart"> Cart</a>`);
    await page.waitForFunction(() => document.getElementById('i').complete);
    const occ = (check, id) => ({ atomicCheckId: check, occurrenceOutcome: 'cantTell', target: ['#' + id], html: `<x id="${id}">` });
    const c = {
        findings: [{ outcome: 'cantTell', occurrences: [occ('object-text-alternative-quality', 'o'), occ('canvas-text-alternative-quality', 'c'), occ('video-poster-text-alternative-present', 'v')] }],
        // A best practice, and its occurrence names no check: the rule does.
        bestPractices: [{ ruleId: 'image-redundant-alt', outcome: 'cantTell', occurrences: [{ occurrenceOutcome: 'cantTell', target: ['#i'], html: '<img id="i" alt="Cart">' }] }],
    };
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async () => '{"verdict":"pass","confidence":0.9,"rationale":"x"}' } });
    const [o, cv, v] = c.findings[0].occurrences.map((x) => x.ai.evidence.image);
    assert.deepEqual([o.embedded.tag, o.embedded.fallbackText, o.look.mainColour], ['object', 'Red bar', '#ff0000']);
    assert.deepEqual([cv.canvas, cv.look.mainColour, cv.embedded.fallbackText], [true, '#0000ff', 'No canvas support']);
    assert.deepEqual([v.embedded.tag, v.embedded.controls, v.look.mainColour], ['video', true, '#ff0000']);
    const bp = c.bestPractices[0].occurrences[0].ai;
    assert.deepEqual([bp.check, bp.provenance], ['image-redundant-alt', 'ai-supported']);
    await page.close();
});

test('a question that asks for it gets what the checker reported, bounded', async () => {
    const page = await browser.newPage();
    await page.setContent('<title>Form</title><p><label for="a">Phone</label> <input id="a"></p><p><label for="b">Phone</label> <input id="b"></p>');
    const details = { label: 'Phone', sharedWith: 1, sharedWithFields: ['#b'], long: 'x'.repeat(500), list: Array.from({ length: 30 }, (_, i) => i) };
    const c = { findings: [{ outcome: 'cantTell', occurrences: [
        { atomicCheckId: 'form-control-label-quality', occurrenceOutcome: 'cantTell', target: ['#a'], html: '<input id="a">', details },
        { atomicCheckId: 'img-alt-quality', occurrenceOutcome: 'cantTell', target: ['#b'], html: '<input id="b">', details },
    ] }] };
    const prompts = [];
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async (p) => { prompts.push(p); return '{"verdict":"fail","confidence":0.9,"rationale":"x"}'; } } });
    const [label, alt] = c.findings[0].occurrences.map((o) => o.ai.evidence);
    assert.deepEqual(label.reported.sharedWithFields, ['#b']);
    assert.ok(label.reported.long.length <= 201 && label.reported.list.length === 10, 'long values are cut');
    assert.match(prompts[0], /"sharedWithFields":\["#b"\]/);
    assert.equal(alt.reported, undefined, 'only for a question that asks for it');
    await page.close();
});

test('structure questions get the table, the heading outline and the landmarks', async () => {
    const page = await browser.newPage();
    await page.setContent(`<title>Shop</title><div id="top">Shop · <a href="/">Home</a></div><main><h1>Care</h1><h2>Guides</h2><h4 id="h">Roses</h4>
<table id="t"><tr><th scope="col">Day</th><th scope="col" id="n">Notes</th></tr><tr><td>Sunday</td></tr></table></main>`);
    const occ = (check, sel) => ({ atomicCheckId: check, occurrenceOutcome: 'cantTell', target: [sel], html: '<x>' });
    const c = { findings: [], bestPractices: [{ ruleId: 'x', outcome: 'cantTell', occurrences: [occ('table-th-has-data-cells', '#n'), occ('heading-order', '#h'), occ('region', '#top')] }] };
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async () => '{"verdict":"fail","confidence":0.9,"rationale":"x"}' } });
    const [table, outline, region] = c.bestPractices[0].occurrences.map((o) => o.ai.evidence);
    assert.deepEqual(table.table.rows, [['th[col]: Day', 'th[col]: Notes ←'], ['Sunday']]);
    assert.deepEqual(outline.outline, ['h1 Care', 'h2 Guides', 'h4 Roses ←']);
    assert.deepEqual(region.landmarks.list.map((m) => m.role), ['main']);
    assert.match(region.landmarks.outsideLandmarks[0], /^<div#top> Shop/);
    await page.close();
});

test('contrast the checker cannot compute is measured from the picture of the text', async () => {
    const page = await browser.newPage();
    await page.setContent(`<title>Sale</title><style>p { font: 16px sans-serif; padding: 8px; width: 300px; color: #fff; }</style>
<p id="light" style="background: linear-gradient(#fafafa, #e0e0e0)">Spring sale on all seeds</p>
<p id="dark" style="background: linear-gradient(#1b4332, #081c15)">Spring sale on all seeds</p>`);
    const occ = (id) => ({ atomicCheckId: 'contrast-computable', occurrenceOutcome: 'cantTell', target: ['#' + id], html: `<p id="${id}">`, details: { reasonCode: 'BACKGROUND_IMAGE_OR_GRADIENT' } });
    const c = { findings: [{ outcome: 'cantTell', occurrences: [occ('light'), occ('dark')] }] };
    await answerCantTells({ page, canonical: c, env: {}, provider: { ask: async () => '{"verdict":"fail","confidence":0.9,"rationale":"x"}' } });
    const [light, dark] = c.findings[0].occurrences.map((o) => o.ai.evidence.pixels);
    assert.deepEqual([light.method, light.measured], ['exact', true], 'read with the text made transparent for a moment');
    assert.ok(light.shareBelow4_5 > 0.95, 'white on near white: the background under the letters is below 4.5:1: ' + JSON.stringify(light));
    assert.ok(dark.shareBelow4_5 === 0 && dark.ratioMin > 10, 'white on dark green: above it everywhere: ' + JSON.stringify(dark));
    assert.equal(await page.$eval('#light', (e) => e.getAttribute('style')), 'background: linear-gradient(#fafafa, #e0e0e0)', 'its style is put back as it was');
    assert.ok(dark.ratioMedian > 10 && dark.shareBelow4_5 < 0.1, 'white on dark green: ' + JSON.stringify(dark));
    assert.equal(light.textColour, '#ffffff');
    await page.close();
});
