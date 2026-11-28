'use strict';

// Real-Chrome check of the focus walk (focus-walk.js) and the focus questions
// of the AI pass: Tab from the top, what each stop shows, and the page put
// back as it was. Needs Chrome (via Puppeteer).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const { walkFocus } = require('./focus-walk');
const { fingerprint, sameFingerprint } = require('./evidence');
const { answerCantTells } = require('./index');

let browser;
before(async () => { browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] }); });
after(async () => { if (browser) await browser.close().catch(() => {}); });

// A link with a visible focus, one whose outline is taken away, a field, and a
// link under a fixed banner; long enough to scroll.
const PAGE = `<title>Shop</title>
<style>a.bare:focus { outline: none; } #banner { position: fixed; left: 0; right: 0; bottom: 0; height: 120px; background: #eee; }</style>
<nav aria-label="Main"><a href="#one" id="one">One</a> <a href="#two" class="bare" id="two">Two</a></nav>
<main><h1>Sign up</h1><label>Name <input id="name"></label></main>
<div style="height: 1500px"></div>
<a href="#three" id="three" style="position: fixed; bottom: 40px; left: 10px">Three</a>
<div id="banner">Cookies</div>`;

async function open(html) {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 700 });
    // The pixels are measured, so the page must not turn dark with the machine's theme.
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.setContent(html);
    return page;
}

test('walks from the top, says what shows focus and what covers it, and puts focus and scroll back', async () => {
    const page = await open(PAGE);
    await page.focus('#name');
    await page.evaluate(() => window.scrollTo(0, 300));
    const before = await fingerprint(page);
    const walk = await walkFocus(page);
    const after = await fingerprint(page);

    assert.deepEqual(walk.stops.map((s) => s.name), ['One', 'Two', 'Name', 'Three']);
    assert.equal(walk.ended, 'left-page');
    assert.equal(walk.restored, true);
    assert.ok(walk.stops[0].changesOnFocus.includes('outline'), 'the default outline shows focus');
    assert.deepEqual(walk.stops[1].changesOnFocus, [], 'no outline, nothing else: no visible change');
    assert.match(walk.stops[3].covered || '', /div#banner/);
    assert.ok(walk.stops[0].screenshot.startsWith('data:image/jpeg;base64,'));
    assert.deepEqual(walk.stops.map((s) => [s.landmark, s.heading]), [['navigation “Main”', null], ['navigation “Main”', null], ['main', 'h1 “Sign up”'], [null, 'h1 “Sign up”']]);
    assert.ok(walk.map.screenshot.startsWith('data:image/jpeg;base64,'), 'a picture of the whole page');
    assert.deepEqual([walk.map.width, walk.map.height], [900, await page.evaluate(() => document.documentElement.scrollHeight)]);
    assert.ok(sameFingerprint(before, after), 'focus, scroll and page as they were');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'name');
    assert.equal(await page.evaluate(() => document.querySelector('[data-a11y-focus-walk-start]')), null, 'no trace left');
    await page.close();
});

test('a custom checkbox that hides its input shows focus on its label, and the walk sees it there', async () => {
    const page = await browser.newPage();
    await page.setContent(`<style>
        .cb { position: relative; } .cb input { position: absolute; opacity: 0; width: 40px; height: 40px; margin: 0; }
        .cb label { padding-left: 50px; } .cb label::before { content: ""; position: absolute; left: 0; top: 0; width: 36px; height: 36px; border: 2px solid #0b0c0c; }
        .cb input:focus + label::before { box-shadow: 0 0 0 3px #fd0; border-width: 4px; }
      </style><div class="cb"><input id="a" type="checkbox"><label for="a">Email</label></div>`);
    const walk = await walkFocus(page);
    const stop = walk.stops.find((s) => s.selector === '#a' || /Email/.test(s.name || ''));
    assert.ok(stop, 'the hidden input is a stop');
    assert.ok(stop.changesOnFocus.some((c) => /\(label::before\)/.test(c)), JSON.stringify(stop.changesOnFocus));
    await page.close();
});

test('a loop that keeps focus is reported as coming back, and the limit holds', async () => {
    const trap = `<a href="#a" id="a">A</a><a href="#b" id="b">B</a>
<script>document.getElementById('b').addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); document.getElementById('a').focus(); } });</script>`;
    const page = await open(trap);
    const walk = await walkFocus(page);
    assert.equal(walk.ended, 'came-back');
    assert.equal(walk.endedAt, 1);
    const few = await walkFocus(await open(PAGE), { maxStops: 2 });
    assert.deepEqual([few.ended, few.stops.length], ['limit', 2]);
    await page.close();
});

test('a link that gives focus up at once is a stop that lost focus, listed as unusable by keyboard, and the walk goes on', async () => {
    const page = await open(`<title>Shop</title>
<a href="#a" id="a">First</a>
<a href="#b" id="b" onfocus="blur();">Second</a>
<a href="#c" id="c" onfocus="this.blur()">Third</a>
<a href="#d" id="d">Fourth</a>`);
    const walk = await walkFocus(page);
    assert.deepEqual(walk.stops.map((s) => [s.name, !!s.lostFocus]), [['First', false], ['Second', true], ['Third', true], ['Fourth', false]]);
    assert.equal(walk.ended, 'left-page');
    assert.deepEqual(walk.unreachable.items.map((u) => u.selector), ['#b', '#c']);
    assert.match(walk.unreachable.items[0].why, /gives it up at once/);
    assert.equal(walk.unreachable.total, 2);
    assert.equal(await page.evaluate(() => typeof window.__a11yFocusWalk), 'undefined', 'no trace left');
    await page.close();
});

function canonical() {
    const manual = (ruleId, sc) => ({ ruleId, outcome: 'cantTell', wcag: { sc: [sc] }, occurrences: [{ atomicCheckId: 'manual-review', occurrenceOutcome: 'cantTell', target: ['html'], html: '', failureSummary: 'Check keyboard navigation and focus order by hand.' }] });
    return { findings: [
        manual('wcag-2.4.7-focus-visible', '2.4.7'),
        manual('wcag-2.4.3-focus-order', '2.4.3'),
        manual('wcag-2.1.1-keyboard', '2.1.1'),
        { ruleId: 'wcag-2.4.2-page-titled', outcome: 'cantTell', occurrences: [{ atomicCheckId: 'page-title-patterns', occurrenceOutcome: 'cantTell', target: ['title'], html: '<title>Shop</title>', failureSummary: 'check the title' }] },
    ] };
}

test('the focus questions are asked from the walk, without pictures, only when asked for', async () => {
    const page = await open(PAGE);
    const prompts = [];
    const provider = { name: 'test', ask: async (p) => { prompts.push(p); return '{"verdict":"fail","confidence":0.9,"rationale":"Stop 2 shows no focus."}'; } };

    const off = canonical();
    await answerCantTells({ page, canonical: off, provider, env: {} });
    assert.equal(prompts.length, 1, 'only the title: no walk without focus on');
    assert.equal(off.findings[0].occurrences[0].ai, undefined);

    prompts.length = 0;
    const on = canonical();
    const s = await answerCantTells({ page, canonical: on, options: { focus: true }, provider, env: {} });
    assert.equal(prompts.length, 4, 'the title, focus visible, focus order and keyboard');
    assert.deepEqual(s.outbox.map((e) => e.check).sort(), ['focus-order', 'focus-visible', 'keyboard', 'page-title-patterns'], 'the log names the question asked');
    assert.deepEqual(Object.keys(s.byCheck).sort(), ['focus-order', 'focus-visible', 'keyboard', 'page-title-patterns'], 'counted by the question asked');
    assert.match(prompts[1], /"focusWalk"/);
    assert.doesNotMatch(prompts.join(''), /data:image/);
    const visible = on.findings[0].occurrences[0].ai;
    assert.deepEqual([visible.check, visible.tier, visible.page, visible.provenance], ['focus-visible', 1, 'about:blank', 'ai-supported']);
    assert.ok(visible.evidence.focusWalk.stops[1].screenshot, 'the person still gets the pictures');
    const keyboard = on.findings[2].occurrences[0].ai;
    assert.deepEqual([keyboard.check, keyboard.provenance, keyboard.verdict], ['keyboard', 'ai-supported', 'fail'], 'a fail it may give');
    assert.deepEqual([s.focusWalk.stops, s.focusWalk.restored], [4, true]);
    await page.close();
});

test('a walk that leaves the page changed drops only the focus answers, and says so', async () => {
    const changing = PAGE + `<script>document.getElementById('two').addEventListener('focus', () => document.body.append(document.createElement('hr')));</script>`;
    const page = await open(changing);
    const logs = [];
    const provider = { ask: async () => '{"verdict":"pass","confidence":0.9,"rationale":"ok"}' };
    const c = canonical();
    const s = await answerCantTells({ page, canonical: c, options: { focus: true }, provider, env: {}, log: (level, m) => logs.push(m) });
    assert.equal(c.findings[0].occurrences[0].ai.reason, 'state-drift');
    assert.ok(c.findings[0].occurrences[0].ai.evidence.focusWalk, 'what it saw is kept');
    assert.equal(c.findings[3].occurrences[0].ai.provenance, 'ai-supported', 'the title, read before the walk, is kept');
    assert.ok(s.focusWalk.drift.includes('view'), 'an element was added: the page shows something new');
    assert.match(logs.join('\n'), /next steps may meet a different page/);
    await page.close();
});

test('an attribute a component sets as focus passes is not a changed page', async () => {
    // As the W3C's skip-to-content element does (focus="none" once focus leaves it).
    const marking = PAGE + `<script>for (const a of document.querySelectorAll('a')) a.addEventListener('blur', () => document.body.setAttribute('data-focus', 'none'));</script>`;
    const page = await open(marking);
    const provider = { ask: async () => '{"verdict":"pass","confidence":0.9,"rationale":"ok"}' };
    const c = canonical();
    const s = await answerCantTells({ page, canonical: c, options: { focus: true }, provider, env: {} });
    assert.equal(s.focusWalk.drift, undefined);
    assert.equal(c.findings[0].occurrences[0].ai.provenance, 'ai-supported', 'the focus answers are kept');
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-focus')), 'none', 'the attribute did change');
    await page.close();
});

test('finds what a mouse can use but Tab never reaches, and the AI may not pass keyboard', async () => {
    const page = await open(`<title>Shop</title>
<a href="#ok" id="ok">Reachable</a>
<div id="clicky" onclick="void 0" style="width: 80px; height: 20px">Open menu</div>
<span id="fake" role="button" style="display: inline-block; width: 60px; height: 20px">Buy</span>
<a href="#skip" id="skipped" tabindex="-1">Skipped link</a>
<div id="card" style="cursor: pointer; width: 200px; height: 40px"><a href="#in">Card link</a></div>
<button disabled style="cursor: pointer">Off</button>`);
    const walk = await walkFocus(page);
    const found = Object.fromEntries(walk.unreachable.items.map((u) => [u.selector, u.why]));
    assert.match(found['#clicky'], /click attribute/);
    assert.match(found['#fake'], /role button/);
    assert.match(found['#skipped'], /taken out of the Tab order/);
    assert.equal(found['#card'], undefined, 'a card whose link Tab reaches is fine');
    assert.equal(walk.unreachable.total, 3);
    assert.ok(walk.map.screenshot, 'the picture is taken for the boxes too');

    const c = { findings: [{ ruleId: 'wcag-2.1.1-keyboard', outcome: 'cantTell', wcag: { sc: ['2.1.1'] }, occurrences: [{ atomicCheckId: 'manual-review', occurrenceOutcome: 'cantTell', target: ['html'], html: '' }] }] };
    let prompt = '';
    await answerCantTells({ page, canonical: c, options: { focus: true }, env: {}, provider: { ask: async (p) => { prompt = p; return '{"verdict":"pass","confidence":0.95,"rationale":"All reachable."}'; } } });
    assert.match(prompt, /"unreachable"/);
    assert.match(prompt, /Do not answer "pass"/);
    const ai = c.findings[0].occurrences[0].ai;
    assert.deepEqual([ai.provenance, ai.reason, ai.rationale], ['unresolved', 'pass-needs-person', 'All reachable.']);
    await page.close();
});

test('measures each indicator against 2.4.13 and how much of each stop is hidden, and leaves the page as it was', async () => {
    const page = await open(`<title>Shop</title>
<style>a, button { display: inline-block; margin: 20px; font: 16px sans-serif; }
#strong:focus { outline: 3px solid #000; outline-offset: 2px; }
#faint:focus { outline: 1px solid #eee; }
#half { position: fixed; top: 300px; left: 20px; width: 120px; height: 40px; margin: 0; }
#over { position: fixed; top: 300px; left: 20px; width: 60px; height: 40px; background: #333; }</style>
<a href="#s" id="strong">Strong focus</a><a href="#f" id="faint">Faint focus</a>
<button id="half">Half hidden</button><div id="over"></div>`);
    const before = await fingerprint(page);
    const walk = await walkFocus(page, { measureAppearance: true });
    const after = await fingerprint(page);
    const by = Object.fromEntries(walk.stops.map((s) => [s.selector, s]));
    assert.equal(by['#strong'].appearance.meets, true, JSON.stringify(by['#strong'].appearance));
    assert.equal(by['#faint'].appearance.meets, false, JSON.stringify(by['#faint'].appearance));
    assert.ok(by['#faint'].appearance.changed > 0, 'the faint outline changed pixels, just not at 3:1');
    assert.ok(by['#half'].coveredShare > 0.2 && by['#half'].coveredShare < 0.8, String(by['#half'].coveredShare));
    assert.match(by['#half'].covered, /div#over/);
    assert.equal(by['#strong'].coveredShare, 0);
    assert.ok(sameFingerprint(before, after), 'the measuring put the scroll back too');

    const plain = await walkFocus(page);
    assert.equal(plain.stops[0].appearance, undefined, 'no measuring unless 2.4.13 is asked');
    await page.close();
});

test('the pass measures appearance only when the scanner asks 2.4.13', async () => {
    const page = await open('<title>Shop</title><a href="#a" id="a">A</a> <a href="#b" id="b">B</a>');
    const ask = (rule) => ({ findings: [{ ruleId: rule, outcome: 'cantTell', occurrences: [{ atomicCheckId: 'manual-review', occurrenceOutcome: 'cantTell', target: ['html'], html: '' }] }] });
    const provider = { ask: async () => '{"verdict":"unsure","confidence":0.2,"rationale":"x"}' };
    const appearance = ask('wcag-2.4.13-focus-appearance');
    await answerCantTells({ page, canonical: appearance, options: { focus: true }, provider, env: {} });
    const a = appearance.findings[0].occurrences[0].ai;
    assert.equal(a.check, 'focus-appearance');
    assert.ok(a.evidence.focusWalk.stops.every((s) => s.appearance && typeof s.appearance.meets === 'boolean'));
    // 1.4.11 per element, from the same measurement.
    const contrastPage = await open('<title>Shop</title><style>#x:focus { outline: none; }</style><a href="#x" id="x">X</a>');
    const contrast = { findings: [{ ruleId: 'wcag-1.4.11-non-text-contrast', outcome: 'cantTell', occurrences: [{ atomicCheckId: 'css-focus-indicator-suppressed', occurrenceOutcome: 'cantTell', target: ['#x'], html: '<a href="#x" id="x">X</a>' }] }] };
    await answerCantTells({ page: contrastPage, canonical: contrast, options: { focus: true }, provider, env: {} });
    const c = contrast.findings[0].occurrences[0].ai;
    assert.equal(c.check, 'focus-contrast-element');
    const stop = c.evidence.focusWalk.stops.find((s) => s.n === c.evidence.target.stop);
    assert.deepEqual([stop.appearance.changed, stop.appearance.atContrast], [0, 0], 'outline removed: nothing changes');
    assert.ok(stop.appearance.oneLine > 0);
    await contrastPage.close();

    const order = ask('wcag-2.4.3-focus-order');
    await answerCantTells({ page, canonical: order, options: { focus: true }, provider, env: {} });
    assert.ok(order.findings[0].occurrences[0].ai.evidence.focusWalk.stops.every((s) => s.appearance === undefined));
    await page.close();
});

test('follows the page\'s own Tab order: positive tabindex first, in their order', async () => {
    const page = await open('<title>Order</title><a href="#a" id="a">A</a> <a href="#b" id="b" tabindex="2">B</a> <a href="#c" id="c">C</a> <a href="#d" id="d" tabindex="1">D</a>');
    const walk = await walkFocus(page, { mapPicture: false });
    assert.deepEqual(walk.stops.map((s) => s.name), ['D', 'B', 'A', 'C']);
    assert.equal(walk.ended, 'left-page');
    await page.close();
});

test('goes on past a video\'s own controls, which keep the video focused, to what follows', async () => {
    const page = await open('<title>Video</title><a href="#a">Before</a> <video controls width="200" height="100"></video> <a href="#b">After the video</a>');
    const walk = await walkFocus(page, { mapPicture: false });
    const names = walk.stops.map((s) => s.name || s.tag);
    assert.ok(names.includes('After the video'), names.join(', '));
    assert.equal(walk.ended, 'left-page');
    // (An empty video has no controls to Tab through here; with a source, its
    // controls keep the video focused, counted as presses inside it.)
    await page.close();
});

test('a page Tab reaches nothing on is still asked about the keyboard, from what a mouse can use', async () => {
    const page = await open('<title>Fake</title><p>Pay now:</p><div id="pay" onclick="void 0" style="width:80px;height:30px;background:#036;color:#fff">Pay</div>');
    const c = { findings: [
        { ruleId: 'wcag-2.1.1-keyboard', outcome: 'cantTell', occurrences: [{ atomicCheckId: 'manual-review', occurrenceOutcome: 'cantTell', target: ['html'], html: '' }] },
        { ruleId: 'wcag-2.4.3-focus-order', outcome: 'cantTell', occurrences: [{ atomicCheckId: 'manual-review', occurrenceOutcome: 'cantTell', target: ['html'], html: '' }] },
    ] };
    const prompts = [];
    await answerCantTells({ page, canonical: c, options: { focus: true }, env: {}, provider: { ask: async (p) => { prompts.push(p); return '{"verdict":"fail","confidence":0.9,"rationale":"The Pay control cannot be reached."}'; } } });
    const [keyboard, order] = c.findings.map((f) => f.findings ? null : f.occurrences[0].ai);
    assert.equal(prompts.length, 1, 'keyboard asked; focus order not (no stops)');
    assert.match(prompts[0], /#pay/);
    assert.deepEqual([keyboard.provenance, keyboard.verdict], ['ai-supported', 'fail']);
    assert.equal(order.reason, 'no-focus-stops');
    await page.close();
});

// The open walk (open-walk.js): what says it opens something is pressed, and
// nothing else; nothing leaves the page; what opened is closed again.
const { openWalk } = require('./open-walk');

const OPENING = `<title>Shop</title>
<a href="#" id="lb">Open lightbox</a>
<button type="button" id="more" aria-expanded="false" aria-controls="sec">More</button>
<section id="sec" hidden><a href="#a">Inside</a></section>
<button type="button" id="del">Delete</button>
<form id="f" action="https://example.invalid/send"><button id="send">Send</button></form>
<a href="https://example.invalid/next" role="button" id="cont">Continue</a>
<a href="https://example.invalid/away" id="away">Away</a>
<div id="box" hidden><p>Offer</p><span class="x">X</span><a href="#b">Read the offer</a></div>
<script>
window.pressed = [];
document.getElementById('lb').addEventListener('click', () => { document.getElementById('box').hidden = false; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('box').hidden = true; });
document.querySelector('.x').addEventListener('click', () => { document.getElementById('box').hidden = true; });
const more = document.getElementById('more');
more.addEventListener('click', () => { const open = more.getAttribute('aria-expanded') === 'true'; more.setAttribute('aria-expanded', String(!open)); document.getElementById('sec').hidden = open; });
document.getElementById('del').addEventListener('click', () => window.pressed.push('delete'));
document.getElementById('f').addEventListener('submit', () => window.pressed.push('send'));
</script>`;

test('the open walk presses only what says it opens something, and puts the page back', async () => {
    const page = await open(OPENING);
    const url = page.url();
    const before = await fingerprint(page);
    const o = await openWalk(page, { settleMs: 60 });
    const after = await fingerprint(page);
    assert.ok(sameFingerprint(before, after), 'the page is as it was: ' + JSON.stringify([before, after]));
    assert.equal(page.url(), url, 'nothing left the page');
    assert.deepEqual(await page.evaluate(() => window.pressed), [], 'not the plain button, not the form');
    assert.deepEqual(o.controls.map((c) => [c.name, c.why]), [['Open lightbox', 'link to #'], ['More', 'aria-expanded'], ['Continue', 'role=button']]);

    const [lb, more, cont] = o.controls;
    assert.equal(lb.activated, true);
    assert.equal(lb.focusAfter, 'control', 'focus stayed on the link');
    assert.equal(lb.opened.focusable, 1);
    assert.deepEqual(lb.opened.close, { name: 'X', tag: 'span', focusable: false });
    assert.equal(lb.escapeCloses, true);
    assert.equal(lb.tabs.reachedInside > 0, true);

    assert.deepEqual(more.expanded, ['false', 'true']);
    assert.equal(more.escapeCloses, false, 'Escape does not close a section that opens in place');
    assert.equal(more.closedAfter, true, 'pressed again to close it');

    assert.equal(cont.key, 'Space');
    assert.equal(cont.activated, false, 'Space does nothing on a link');
    assert.equal(cont.enter.activated, true, 'Enter works');
    assert.deepEqual(cont.enter.wouldLeave, ['https://example.invalid/next'], 'and would leave, stopped');
    assert.equal(o.restored, true);
    assert.equal(await page.evaluate(() => typeof window.__a11yOpenWalk), 'undefined', 'no trace left');
    await page.close();
});

test('a script that navigates while the open walk runs is stopped', async () => {
    const page = await open(`<title>Shop</title><a href="#" id="go" aria-haspopup="true">Menu</a>
<script>document.getElementById('go').addEventListener('click', () => { location.href = 'https://example.invalid/elsewhere'; });</script>`);
    const url = page.url();
    const o = await openWalk(page, { settleMs: 100 });
    assert.equal(page.url(), url);
    assert.deepEqual(o.controls[0].wouldLeave, ['https://example.invalid/elsewhere']);
    assert.equal(o.controls[0].activated, true);
    await page.close();
});

test('with open on, the keyboard and focus order questions see what was opened', async () => {
    const page = await open(OPENING);
    const prompts = [];
    const provider = { name: 'test', ask: async (p) => { prompts.push(p); return '{"verdict":"fail","confidence":0.9,"rationale":"The close control cannot take focus."}'; } };
    const c = canonical();
    const s = await answerCantTells({ page, canonical: c, options: { focus: true, open: true }, provider, env: {} });
    assert.deepEqual([s.focusWalk.opened.tried, s.focusWalk.opened.leftChanged], [3, undefined]);
    const keyboard = c.findings[2].occurrences[0].ai;
    assert.equal(keyboard.evidence.focusWalk.opened.controls.length, 3);
    assert.deepEqual(keyboard.steps.map((x) => x.action), ['tab', 'open']);
    assert.match(prompts.find((p) => /Do not answer "pass"/.test(p)), /"opened"/);
    assert.deepEqual(await page.evaluate(() => window.pressed), []);

    const off = canonical();
    await answerCantTells({ page, canonical: off, options: { focus: true }, provider, env: {} });
    assert.equal(off.findings[2].occurrences[0].ai.evidence.focusWalk.opened, undefined, 'nothing is pressed unless asked');
    await page.close();
});

test('with buttons, plain buttons are pressed too, except one that says it acts, and nothing reaches the server', async () => {
    const page = await open(`<title>Shop</title>
<button type="button" id="dlg">Add delivery address</button>
<button type="button" id="del">Delete</button>
<button type="button" id="ping">Show stock</button>
<div role="dialog" aria-modal="true" id="d" hidden><p>Address</p><button type="button" id="x">Close</button></div>
<script>
window.pressed = [];
const d = document.getElementById('d');
document.getElementById('dlg').addEventListener('click', () => { d.hidden = false; document.getElementById('x').focus(); });
document.getElementById('x').addEventListener('click', () => { d.hidden = true; document.getElementById('dlg').focus(); });
d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { d.hidden = true; document.getElementById('dlg').focus(); } });
document.getElementById('del').addEventListener('click', () => window.pressed.push('delete'));
document.getElementById('ping').addEventListener('click', () => { fetch('https://example.invalid/stock', { method: 'POST', body: 'x' }).catch(() => window.pressed.push('post-failed')); });
</script>`);
    const before = await fingerprint(page);
    const plain = await openWalk(page, { settleMs: 100 });
    assert.equal(plain.controls.length, 0, 'without buttons, no plain button is pressed');
    const o = await openWalk(page, { settleMs: 100, buttons: true });
    assert.deepEqual(o.controls.map((c) => c.name), ['Add delivery address', 'Show stock'], 'not Delete');
    const [dlg, ping] = o.controls;
    assert.equal(dlg.opened.dialog, true);
    assert.equal(dlg.focusAfter, 'inside', 'the dialog takes focus');
    assert.deepEqual(dlg.opened.close, { name: 'Close', tag: 'button', focusable: true });
    assert.equal(dlg.escapeCloses, true);
    assert.deepEqual(ping.blockedRequests, ['POST https://example.invalid/stock'], 'the POST never left');
    assert.deepEqual(await page.evaluate(() => window.pressed.filter((x) => x === 'delete')), []);
    assert.ok(sameFingerprint(before, await fingerprint(page)));
    await page.close();
});

test('with the focus walk, a reading question that asks for it gets the element\'s own stop', async () => {
    const page = await open(`<title>Shop</title><style>.skip { position: absolute; left: -9999px; } .skip.shows:focus { left: 0; }</style>
<a href="#main" class="skip shows" id="good">Skip to content</a><a href="#top" class="skip" id="bad">Back to top</a>
<main id="main"><h1>Shop</h1><a href="#x" id="x">Products</a></main>`);
    const occ = (id) => ({ atomicCheckId: 'css-hidden-focus', occurrenceOutcome: 'cantTell', target: ['#' + id], html: `<a id="${id}">` });
    const c = { findings: [{ ruleId: 'wcag-2.4.7-focus-visible', outcome: 'cantTell', occurrences: [occ('good'), occ('bad')] }] };
    const provider = { ask: async () => '{"verdict":"pass","confidence":0.9,"rationale":"x"}' };
    await answerCantTells({ page, canonical: c, options: { focus: true }, provider, env: {} });
    const [good, bad] = c.findings[0].occurrences.map((o) => o.ai.evidence.walkStop);
    assert.deepEqual([good.stop, good.stopFacts.hidden], [1, false], 'shown on focus');
    assert.deepEqual([bad.stop, bad.stopFacts.hidden], [2, true], 'off the page while focused');
    assert.equal(good.stopFacts.after, '2. Back to top');

    const plain = { findings: [{ ruleId: 'wcag-2.4.7-focus-visible', outcome: 'cantTell', occurrences: [occ('good')] }] };
    await answerCantTells({ page, canonical: plain, provider, env: {} });
    assert.equal(plain.findings[0].occurrences[0].ai.evidence.walkStop, undefined, 'without the walk, asked as before');
    await page.close();
});
