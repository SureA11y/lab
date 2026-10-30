// Times user-facing interactions in the lab UI with a large report.
// Usage: node audit.js <report.json> <label> [--queue] [--no-export]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const [reportPath, label, ...flags] = process.argv.slice(2);
const BASE = process.env.BASE || 'http://127.0.0.1:3000/';
const results = [];

const INSTRUMENT = () => {
    window.__long = [];
    window.__events = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ s: e.startTime, d: e.duration }); })
        .observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__events.push({ n: e.name, s: e.startTime, d: e.duration, p: e.processingEnd - e.processingStart });
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
};

async function settle(page, quietMs = 600) {
    // Wait until no long task has happened for quietMs.
    await page.evaluate(async (q) => {
        const now = () => performance.now();
        let last = now();
        for (;;) {
            await new Promise((r) => setTimeout(r, 100));
            const lt = window.__long[window.__long.length - 1];
            if (lt) last = Math.max(last, lt.s + lt.d);
            if (now() - last > q) return;
        }
    }, quietMs);
}

async function measure(page, name, action, done) {
    await settle(page, 400);
    const t0 = await page.evaluate(() => performance.now());
    const wall0 = Date.now();
    await action();
    if (done) await done();
    const wallDone = Date.now() - wall0;
    await settle(page);
    const m = await page.evaluate((t0) => {
        const lt = window.__long.filter((e) => e.s >= t0 - 5);
        const ev = window.__events.filter((e) => e.s >= t0 - 5 && /click|pointerup|pointerdown|keydown|change|input/.test(e.n));
        const end = lt.length ? Math.max(...lt.map((e) => e.s + e.d)) - t0 : 0;
        return {
            firstFeedbackMs: ev.length ? Math.round(Math.max(...ev.map((e) => e.d))) : null,
            longestFreezeMs: Math.round(lt.reduce((a, e) => Math.max(a, e.d), 0)),
            blockedMs: Math.round(lt.reduce((a, e) => a + e.d, 0)),
            lastLongTaskEndMs: Math.round(end),
            domNodes: document.getElementsByTagName('*').length,
            heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
        };
    }, t0);
    const row = { name, ...m, untilDoneMs: wallDone };
    results.push(row);
    console.log(JSON.stringify(row));
    return row;
}

(async () => {
    const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('dialog', (d) => d.accept('perf-export').catch(() => {}));
    await page.addInitScript(INSTRUMENT);

    const tNav = Date.now();
    await page.goto(BASE, { waitUntil: 'load' });
    await settle(page);
    results.push({ name: 'initial page load (to idle)', untilDoneMs: Date.now() - tNav });

    await measure(page, 'click "open report" tab (empty)', () => page.click('#mode-open'));

    // A report picked on its own opens at once (it used to wait in the list
    // for Load selected), so picking it is timed until it is on screen; Load
    // selected, pressed again, redraws it from the list.
    await measure(page, 'pick file -> report on screen',
        () => page.setInputFiles('#resultsFiles', reportPath),
        () => page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport')?.textContent || ''), null, { timeout: 300000 }));

    await measure(page, 'click "Load selected" again -> report on screen',
        () => page.click('#report-files-load-btn'),
        () => page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport')?.textContent || '') && document.querySelectorAll('#results *').length > 1000, null, { timeout: 300000 }));

    await measure(page, 'switch to "run workflow" tab (no run results)', () => page.click('#mode-run'));
    await measure(page, 'switch back to "open report" tab', () => page.click('#mode-open'),
        () => page.waitForFunction(() => document.querySelectorAll('#results *').length > 1000, null, { timeout: 300000 }));

    await measure(page, 'presentation mode -> Analysis', () => page.selectOption('#scan-presentation-mode', 'analysis'));
    await measure(page, 'presentation mode -> Findings', () => page.selectOption('#scan-presentation-mode', 'evidence'));

    const groupings = await page.$$eval('#results-grouping-select option', (o) => o.map((x) => x.value).filter((v) => v !== 'custom'));
    const cur = await page.$eval('#results-grouping-select', (s) => s.value);
    const other = groupings.find((g) => g !== cur);
    if (other) await measure(page, `grouping -> ${other}`, () => page.selectOption('#results-grouping-select', other));

    const trig = await page.$('.src-dialog-trigger:visible');
    if (trig) {
        await trig.scrollIntoViewIfNeeded();
        await measure(page, 'open "View details" dialog', () => trig.click());
        await page.keyboard.press('Escape');
    }

    const toggle = await page.$('[data-scan-action="toggle"]:visible');
    if (toggle) {
        await toggle.scrollIntoViewIfNeeded();
        await measure(page, 'exclude one scan from report', () => toggle.click());
        await measure(page, 'include it again', () => page.click('[data-scan-action="toggle"]:visible'));
    }

    // Scroll smoothness: frames over a scripted scroll through the results.
    await page.evaluate(() => window.scrollTo(0, 0));
    const scroll = await page.evaluate(async () => {
        const frames = [];
        let last = performance.now();
        let running = true;
        const tick = (t) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const h = document.documentElement.scrollHeight;
        for (let y = 0; y < Math.min(h, 60000); y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 16)); }
        running = false;
        const slow = frames.filter((f) => f > 50).length;
        return { pageHeightPx: h, frames: frames.length, slowFrames: slow, worstFrameMs: Math.round(Math.max(...frames)) };
    });
    results.push({ name: 'scroll through results', ...scroll });
    console.log(JSON.stringify(scroll));

    const dl = await page.$('#results-container button:visible:has-text("Download")');
    if (dl && !flags.includes('--no-export')) {
        await dl.scrollIntoViewIfNeeded();
        await measure(page, 'Download report (default ZIP)', () => dl.click(),
            () => page.waitForEvent('download', { timeout: 300000 }).catch(() => {}));
    }

    if (flags.includes('--queue')) {
        await measure(page, 'switch to queue tab', () => page.click('#mode-queue'));
        // Background cost of a running batch while the user looks at the queue.
        const q = await page.evaluate(async () => {
            const t0 = performance.now();
            await new Promise((r) => setTimeout(r, 20000));
            const lt = window.__long.filter((e) => e.s >= t0);
            return { windowMs: 20000, longTasks: lt.length, blockedMs: Math.round(lt.reduce((a, e) => a + e.d, 0)) };
        });
        results.push({ name: 'queue tab visible, batch running (20 s)', ...q });
        console.log(JSON.stringify(q));
        const openBtn = await page.$('[data-queue-action="open"]');
        if (openBtn) {
            await measure(page, 'queue: open finished report', () => openBtn.click(),
                () => page.waitForFunction(() => document.querySelector('#mode-open')?.getAttribute('aria-selected') === 'true'
                    && document.querySelectorAll('#results *').length > 100, null, { timeout: 300000 }));
            await measure(page, 'switch to "run workflow" tab (batch running)', () => page.click('#mode-run'));
            await measure(page, 'switch back to "open report" (batch running)', () => page.click('#mode-open'));
        }
    }

    fs.writeFileSync(path.join(__dirname, `results-${label}.json`), JSON.stringify(results, null, 1));
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
