'use strict';

// Real-Chrome test: the testing guide (guide.html), served by the lab, as a
// person uses it. With a core that has test procedures:
// - the app's header links to it, in a tab of its own;
// - an address with a requirement opens the guide there, its heading focused;
// - the filters narrow it, and the address keeps them;
// - another standard (EN 301 549's pack) loads in it;
// - "Save as a page" gives core's page of the same procedures;
// - with a core that says which languages a standard has, the guide offers
//   those, says how much of one is in another, marks each part's language,
//   and reads a standard that lacks the one asked for in its own.
// With one that has none, the header has no link and the guide says so.
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');
const HAS_PROCEDURES = typeof require('@surea11y/core').listProcedures === 'function';
const HAS_LANGUAGES = typeof require('@surea11y/core').procedureLanguages === 'function';

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

let server;
let base;
let browser;

before(async () => {
    const port = await freePort();
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', A11Y_QUEUE_DIR: `guide-spec-${process.pid}` },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    base = `http://127.0.0.1:${port}`;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the server did not start')), 30000);
        server.stdout.on('data', (chunk) => {
            if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); }
        });
        server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the server exited (${code})`)); });
    });
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
});

after(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
        server.removeAllListeners('exit');
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        await exited;
    }
    require('node:fs').rmSync(path.join(ROOT, 'reports', `guide-spec-${process.pid}`), { recursive: true, force: true });
});

async function open(url) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + url, { waitUntil: 'networkidle0' });
    return { page, errors };
}

const statusOf = (page) => page.$eval('#guide-status', (el) => el.textContent);
const settled = (page, pattern) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('guide-status').textContent), { timeout: 30000 }, pattern.source);

test('the app\'s header links to the guide when there is one to show', async () => {
    const { page, errors } = await open('/');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const link = await page.$eval('#guide-link', (a) => ({ hidden: a.hidden, href: a.getAttribute('href'), target: a.target, name: a.getAttribute('aria-label') }));
    assert.equal(link.hidden, !HAS_PROCEDURES);
    assert.equal(link.href, '/guide');
    assert.equal(link.target, '_blank');
    assert.match(link.name, /opens in a new tab/);
    assert.deepEqual(errors, []);
    await page.close();
});

test('opened at a requirement, the guide shows it with its heading focused; filters narrow it, and the address keeps them', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag&id=1.4.12');
    await settled(page, /checks\./);
    assert.match(await statusOf(page), /^WCAG 2\.2, Level A and AA: \d+ criteria, \d+ checks\.$/);
    assert.match(await page.evaluate(() => document.activeElement.textContent.trim()), /^1\.4\.12 /);
    // Its checks open; the others stay folded to their titles.
    const open1412 = await page.$$eval('.guide-toggle', (ts) => ts.map((t) => [t.closest('.guide-req').id, t.getAttribute('aria-expanded')]));
    assert.ok(open1412.some(([id]) => id === 'req-1-4-12'));
    for (const [id, expanded] of open1412) assert.equal(expanded, String(id === 'req-1-4-12'), id);

    await page.click('#guide-more > summary');
    await page.click('#guide-expand');
    await page.click('input[name="tool"][value="screen-reader"]');
    await settled(page, /of \d+ criteria shown/);
    // A filter changed: every check folded again.
    assert.equal(await page.$$eval('.guide-toggle[aria-expanded="true"]', (els) => els.length), 0);
    assert.equal(await page.$$eval('.guide-check-body:not([hidden])', (els) => els.length), 0);
    assert.match(page.url(), /tools=screen-reader/);
    await page.click('input[name="automation"][value="person"]');
    await settled(page, /of \d+ criteria shown/);
    assert.match(page.url(), /automation=person/);

    await page.select('#guide-standard', 'en301549');
    await settled(page, /^EN 301 549 V4\.1\.1: /);
    assert.ok(await page.$$eval('.guide-req', (els) => els.length) > 0, 'EN 301 549\'s requirements, from its pack');
    assert.deepEqual(errors, []);
    await page.close();
});

test('opened at a AAA criterion, the guide adds the levels that show it', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag&version=2.2&id=1.4.6');
    await settled(page, /Level A and AA and AAA: /);
    assert.match(await page.evaluate(() => document.activeElement.textContent.trim()), /^1\.4\.6 /);
    assert.equal(await page.$eval('input[name="level"][value="AAA"]', (el) => el.checked), true);
    assert.deepEqual(errors, []);
    await page.close();
});

// The lab offers procedures in English alone, for now: its own are in
// English, so no standard is complete in another language.
test('the guide reads every standard in English, with no language to choose, and says so of one asked for', { skip: !HAS_LANGUAGES && 'the installed core does not say which languages it has' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag&version=2.1&locale=fr');
    await settled(page, /checks\./);
    const state = () => page.evaluate(() => ({
        hidden: document.getElementById('guide-language-field').hidden,
        note: document.getElementById('guide-language-note').textContent,
        marked: [...document.querySelectorAll('#guide-content [lang]')].map((el) => el.lang),
    }));
    let p = await state();
    assert.equal(p.hidden, true, 'one language is no choice');
    assert.equal(p.note, 'WCAG 2.1 has no French translation, so it is shown in English.');
    assert.deepEqual(p.marked, [], 'all of it in English, as the page');
    assert.doesNotMatch(await page.$eval('#guide-save', (a) => a.href), /locale=/, 'the saved page is in English');

    await page.select('#guide-standard', 'en301549');
    await settled(page, /^EN 301 549 V4\.1\.1: /);
    p = await state();
    assert.equal(p.hidden, true);
    assert.deepEqual(p.marked, []);
    assert.deepEqual(errors, []);
    await page.close();
});

test('with a core that does not say which languages it has, the guide offers none', { skip: (!HAS_PROCEDURES || HAS_LANGUAGES) && 'the installed core has no procedures, or says which languages it has' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag');
    await settled(page, /checks\./);
    assert.equal(await page.$eval('#guide-language-field', (el) => el.hidden), true);
    assert.deepEqual(errors, []);
    await page.close();
});

test('checks fold one by one or all at once; the contents follow; a link is copied; filters clear', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag&tools=keyboard');
    await settled(page, /of \d+ criteria shown/);
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(base, ['clipboard-read', 'clipboard-write']);

    // Every check starts folded to its title, findable in the page.
    assert.equal(await page.$$eval('.guide-toggle[aria-expanded="true"]', (els) => els.length), 0);
    assert.equal(await page.$$eval('.guide-check-body:not([hidden="until-found"])', (els) => els.length), 0);

    // One check unfolds, and folds.
    const toggle = await page.$('.guide-toggle');
    const bodyId = await toggle.evaluate((b) => b.getAttribute('aria-controls'));
    await toggle.click();
    assert.equal(await toggle.evaluate((b) => b.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval(`#${bodyId}`, (el) => el.hasAttribute('hidden')), false);
    await toggle.press('Enter');
    assert.equal(await toggle.evaluate((b) => b.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$eval(`#${bodyId}`, (el) => el.getAttribute('hidden')), 'until-found');

    // Find in page opens the check it finds a word in.
    assert.equal(await page.$eval(`#${bodyId}`, (el) => {
        el.dispatchEvent(new Event('beforematch', { bubbles: true }));
        return document.querySelector(`[aria-controls="${el.id}"]`).getAttribute('aria-expanded');
    }), 'true');

    // All of them, from the bar.
    await page.click('#guide-collapse');
    assert.equal(await page.$$eval('.guide-check-body:not([hidden])', (els) => els.length), 0);
    assert.match(await page.$eval('#guide-announce', (el) => el.textContent), /collapsed/);
    await page.click('#guide-expand');
    assert.equal(await page.$$eval('.guide-check-body[hidden]', (els) => els.length), 0);

    // The contents mark the part on screen.
    // A part far enough from the end for the page to bring it to the top.
    const part = await page.$$eval('.guide-toc a[data-toc]', (links) => {
        const room = document.documentElement.scrollHeight - innerHeight;
        const ok = links.map((a) => document.getElementById(a.dataset.toc)).filter((h) => h && h.getBoundingClientRect().top + scrollY > 200 && h.getBoundingClientRect().top + scrollY < room);
        return ok.length ? ok[ok.length - 1].id : null;
    });
    assert.ok(part, 'a part to scroll to');
    await page.$eval(`#${part}`, (h) => h.scrollIntoView({ block: 'start' }));
    await page.waitForFunction((id) => document.querySelector(`.guide-toc a[data-toc="${id}"]`)?.getAttribute('aria-current') === 'location', { timeout: 5000 }, part);

    // A requirement's link, copied, opens the guide at it.
    const copy = await page.$('.guide-copy');
    const id = await copy.evaluate((b) => b.dataset.copy);
    await copy.click();
    await page.waitForFunction(() => /copied|Copy this link/.test(document.getElementById('guide-announce').textContent), { timeout: 5000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    if (copied) assert.match(copied, new RegExp(`/guide\\?standard=wcag&version=2\\.2&id=${id.replace(/\./g, '\\.')}$`));

    // The filters say how many are on, and clear.
    assert.match(await page.$eval('#guide-more-count', (el) => el.textContent), /1 on/);
    await page.click('#guide-clear');
    await settled(page, /^WCAG 2\.2, Level A and AA: \d+ criteria, \d+ checks\.$/);
    assert.doesNotMatch(page.url(), /tools=/);

    // The colour theme, as the app keeps it.
    const before = await page.$eval('[data-theme-toggle]', (b) => b.dataset.choice);
    await page.click('[data-theme-toggle]');
    const after = await page.$eval('[data-theme-toggle]', (b) => b.dataset.choice);
    assert.notEqual(after, before);
    assert.equal(await page.evaluate(() => localStorage.getItem('a11y-lab-theme')), after);
    await page.evaluate(() => localStorage.removeItem('a11y-lab-theme'));
    assert.deepEqual(errors, []);
    await page.close();
});

test('on a phone, the contents fold away and come back', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 800 });
    await page.goto(base + '/guide', { waitUntil: 'networkidle0' });
    await settled(page, /checks\./);
    assert.equal(await page.$eval('#guide-toc-toggle', (b) => b.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$eval('#guide-toc-list', (el) => getComputedStyle(el).display), 'none');
    await page.click('#guide-toc-toggle');
    assert.notEqual(await page.$eval('#guide-toc-list', (el) => getComputedStyle(el).display), 'none');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375, 'nothing wider than the screen');
    await page.close();
});

test('scrolled past the filters, the bar keeps the logo, what is shown and the actions in reach; on a phone, the contents too', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page, errors } = await open('/guide?standard=wcag');
    await settled(page, /checks\./);
    const bar = () => page.$eval('#guide-bar', (b) => ({ shown: b.classList.contains('is-shown'), inert: b.inert, top: Math.round(b.getBoundingClientRect().top) }));
    assert.deepEqual(await bar(), { shown: false, inert: true, top: -52 }, 'out of sight, and out of reach, at the top');

    await page.evaluate(() => window.scrollTo(0, 2500));
    await page.waitForFunction(() => document.getElementById('guide-bar').classList.contains('is-shown'), { timeout: 5000 });
    assert.equal((await bar()).inert, false);
    assert.equal(await page.$eval('.guide-bar-brand', (a) => a.getAttribute('href')), '/');
    assert.match(await page.$eval('[data-guide-bar="status"]', (el) => el.textContent), /^WCAG 2\.2, Level A and AA: \d+ criteria, \d+ checks$/);
    // The contents beside the guide stick below the bar.
    await page.waitForFunction(() => document.getElementById('guide-toc').getBoundingClientRect().top >= document.getElementById('guide-bar').offsetHeight, { timeout: 5000 });

    await page.click('[data-guide-bar="expand"]');
    assert.equal(await page.$$eval('.guide-toggle[aria-expanded="false"]', (els) => els.length), 0);
    await page.click('[data-guide-bar="collapse"]');
    assert.equal(await page.$$eval('.guide-toggle[aria-expanded="true"]', (els) => els.length), 0);

    await page.click('[data-guide-bar="top"]');
    await page.waitForFunction(() => window.scrollY === 0 && !document.getElementById('guide-bar').classList.contains('is-shown'), { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'guide-search');

    // On a phone: Contents opens the contents over the page, and a link closes them.
    await page.setViewport({ width: 375, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 2500));
    await page.waitForFunction(() => document.getElementById('guide-bar').classList.contains('is-shown'), { timeout: 5000 });
    await page.click('[data-guide-bar="contents"]');
    assert.equal(await page.$eval('[data-guide-bar="contents"]', (b) => b.getAttribute('aria-expanded')), 'true');
    const link = await page.$('#guide-bar-toc a[data-toc]');
    const target = await link.evaluate((a) => a.dataset.toc);
    await link.click();
    assert.equal(await page.$eval('#guide-bar-toc', (el) => el.hidden), true);
    await page.waitForFunction((id) => {
        const top = document.getElementById(id).getBoundingClientRect().top;
        return top >= document.getElementById('guide-bar').offsetHeight && top < 200;
    }, { timeout: 5000 }, target);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375, 'nothing wider than the screen');
    assert.deepEqual(errors, []);
    await page.close();
});

test('"Save as a page" gives core\'s page of the same procedures', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const { page } = await open('/guide?standard=wcag&levels=A');
    await settled(page, /checks\./);
    const href = await page.$eval('#guide-save', (a) => a.getAttribute('href'));
    assert.match(href, /^\/api\/procedures\/page\?standard=wcag&version=2\.2&levels=A$/);
    const res = await fetch(base + href);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename=".+testing guide\.html"/);
    assert.match(await res.text(), /^<!doctype html>/i);
    await page.close();
});

test('with a core without procedures, the guide says there is nothing to show', { skip: HAS_PROCEDURES && 'the installed core has test procedures' }, async () => {
    const { page, errors } = await open('/guide');
    await settled(page, /No test procedures/);
    assert.match(await page.$eval('#guide-content', (el) => el.textContent), /has no test procedures/);
    assert.deepEqual(errors, []);
    await page.close();
});

// Every "View details" dialog of a report, opened, and the links into the
// guide they hold: { links: [{ label, href }], ownSteps, dialogs }.
async function linksOfReport(page, file) {
    await page.click('#mode-open');
    await (await page.$('#resultsFiles')).uploadFile(file);
    await page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport')?.textContent || ''), { timeout: 60000 });
    return page.evaluate(async () => {
        const out = { links: [], ownSteps: 0, dialogs: 0 };
        for (const button of document.querySelectorAll('#results .src-dialog-trigger')) {
            button.click();
            await new Promise((resolve) => setTimeout(resolve, 30));
            const dialog = document.getElementById(button.dataset.dialogId);
            if (!dialog) continue;
            out.dialogs += 1;
            for (const a of dialog.querySelectorAll('.guide-ref a')) out.links.push({ label: a.textContent.replace(' (opens in a new tab)', ''), href: a.getAttribute('href'), target: a.target });
            if (/How to check/.test(dialog.textContent)) out.ownSteps += 1;
            dialog.querySelector('.src-dialog-close')?.click();
        }
        return out;
    });
}

test('every link from the demo reports\' findings into the guide lands on its requirement; findings keep their own steps', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const fixtures = path.join(__dirname, 'fixtures');
    // The fixtures keep little of each occurrence: here their questions get
    // the steps a scan gives them, to see that a finding keeps its own.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-links-'));
    const STEPS = { steps: ['Find the element the report names.'], passWhen: 'It passes.', failWhen: 'It fails.' };
    const seen = new Map();
    for (const name of ['standards-wcag.report.json', 'standards-en301549.report.json']) {
        const report = JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
        for (const scan of report.scans) {
            for (const f of scan.canonical.findings) {
                if (f.outcome === 'cantTell') for (const o of f.occurrences || []) o.howToCheck = STEPS;
            }
        }
        const file = path.join(tmp, name);
        fs.writeFileSync(file, JSON.stringify(report));
        const { page, errors } = await open('/');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const found = await linksOfReport(page, file);
        assert.ok(found.dialogs > 0 && found.links.length > 0, `${name}: ${found.dialogs} dialogs, ${found.links.length} links`);
        assert.ok(found.ownSteps > 0, `${name}: findings keep their own How to check`);
        for (const l of found.links) {
            assert.equal(l.target, '_blank');
            seen.set(l.href, l.label);
        }
        assert.deepEqual(errors, []);
        await page.close();
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    // Each one names a requirement the guide lists, in that standard and version.
    for (const [href, label] of seen) {
        const q = new URL(href, base).searchParams;
        const list = await (await fetch(`${base}/api/procedures/list?standard=${q.get('standard')}&version=${q.get('version')}&levels=A,AA,AAA`)).json();
        assert.ok(list.listing.requirements.some((r) => String(r.id) === q.get('id')), `${label}: ${href}`);
    }
    // And opened, the guide shows each with its heading focused.
    for (const href of seen.keys()) {
        const { page, errors } = await open(href);
        await settled(page, /checks\./);
        const id = new URL(href, base).searchParams.get('id');
        assert.ok((await page.evaluate(() => document.activeElement.textContent.trim())).startsWith(id), href);
        assert.deepEqual(errors, []);
        await page.close();
    }
});

test('a downloaded report has no link into the guide', { skip: !HAS_PROCEDURES && 'the installed core has no test procedures' }, async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-dl-'));
    const { page, errors } = await open('/');
    page.on('dialog', (d) => d.accept());
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const found = await linksOfReport(page, path.join(__dirname, 'fixtures', 'standards-wcag.report.json'));
    assert.ok(found.links.length > 0, 'the app has them, its dialogs opened');
    const item = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^Download as a single file/.test(b.textContent.trim())));
    await item.evaluate((b) => b.click());
    // The report's name, asked in the app's own dialog.
    await page.waitForSelector('dialog.report-name-dialog[open]');
    await page.click('dialog.report-name-dialog button[type="submit"]');
    let html = null;
    for (let i = 0; i < 160 && !html; i++) {
        const name = fs.readdirSync(downloads).find((f) => f.endsWith('.html'));
        if (name) html = fs.readFileSync(path.join(downloads, name), 'utf8');
        else await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(html, 'downloaded');
    assert.match(html, /How to check|View details/, 'the findings are in it');
    assert.doesNotMatch(html, /guide-ref|\/guide\?/);
    assert.deepEqual(errors, []);
    fs.rmSync(downloads, { recursive: true, force: true });
    await page.close();
});
