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
    assert.ok(s.focusWalk.drift.includes('dom'));
    assert.match(logs.join('\n'), /next steps may meet a different page/);
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
