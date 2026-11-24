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
    assert.equal(prompts.length, 3, 'the title, focus visible and focus order; keyboard stays a person\'s');
    assert.match(prompts[1], /"focusWalk"/);
    assert.doesNotMatch(prompts.join(''), /data:image/);
    const visible = on.findings[0].occurrences[0].ai;
    assert.deepEqual([visible.check, visible.tier, visible.page, visible.provenance], ['focus-visible', 1, 'about:blank', 'ai-supported']);
    assert.ok(visible.evidence.focusWalk.stops[1].screenshot, 'the person still gets the pictures');
    assert.equal(on.findings[2].occurrences[0].ai, undefined);
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
