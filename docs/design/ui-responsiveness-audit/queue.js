// Queue-tab interactions while a batch runs, starting from a fresh page.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const INSTRUMENT = () => {
    window.__long = [];
    window.__events = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ s: e.startTime, d: e.duration }); })
        .observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__events.push({ n: e.name, s: e.startTime, d: e.duration }); })
        .observe({ type: 'event', durationThreshold: 16, buffered: true });
};

async function windowCost(page, ms) {
    return page.evaluate(async (ms) => {
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, ms));
        const lt = window.__long.filter((e) => e.s >= t0);
        return { windowMs: ms, longTasks: lt.length, blockedMs: Math.round(lt.reduce((a, e) => a + e.d, 0)), longestMs: Math.round(Math.max(0, ...lt.map((e) => e.d))) };
    }, ms);
}

async function measure(page, name, action, done) {
    await page.waitForTimeout(500);
    const t0 = await page.evaluate(() => performance.now());
    const w0 = Date.now();
    await action();
    if (done) await done();
    const untilDoneMs = Date.now() - w0;
    await page.waitForTimeout(1200);
    const m = await page.evaluate((t0) => {
        const lt = window.__long.filter((e) => e.s >= t0 - 5);
        const ev = window.__events.filter((e) => e.s >= t0 - 5 && /click|pointer/.test(e.n));
        return {
            firstFeedbackMs: ev.length ? Math.round(Math.max(...ev.map((e) => e.d))) : null,
            longestFreezeMs: Math.round(Math.max(0, ...lt.map((e) => e.d))),
            blockedMs: Math.round(lt.reduce((a, e) => a + e.d, 0)),
            domNodes: document.getElementsByTagName('*').length,
        };
    }, t0);
    console.log(JSON.stringify({ name, ...m, untilDoneMs }));
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(INSTRUMENT);
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    console.log(JSON.stringify({ name: 'run tab, batch running, nothing loaded (20 s)', ...(await windowCost(page, 20000)) }));
    await measure(page, 'switch to queue tab (nothing loaded)', () => page.click('#mode-queue'));
    console.log(JSON.stringify({ name: 'queue tab visible, nothing loaded (20 s)', ...(await windowCost(page, 20000)) }));

    const open = page.locator('[data-queue-action="open"]').first();
    await open.waitFor({ state: 'attached', timeout: 60000 });
    if (!(await open.isVisible())) {
        const toggle = page.locator('#queue-sessions [aria-expanded="false"]').first();
        if (await toggle.count()) await toggle.click();
    }
    await measure(page, 'queue: click "Open" on a finished report', () => open.click(),
        () => page.waitForFunction(() => document.querySelectorAll('#results *').length > 1000, null, { timeout: 300000 }));
    console.log(JSON.stringify({ name: 'report open, batch running (20 s)', ...(await windowCost(page, 20000)) }));
    await measure(page, 'switch to queue tab (report loaded)', () => page.click('#mode-queue'));
    console.log(JSON.stringify({ name: 'queue tab visible, report loaded (20 s)', ...(await windowCost(page, 20000)) }));
    await measure(page, 'switch back to open report', () => page.click('#mode-open'));
    await measure(page, 'switch to run workflow tab', () => page.click('#mode-run'));
    await measure(page, 'switch back to open report', () => page.click('#mode-open'),
        () => page.waitForFunction(() => document.querySelectorAll('#results *').length > 1000, null, { timeout: 300000 }));
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
