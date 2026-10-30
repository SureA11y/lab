// CPU-profiles the slow interactions and breaks down where the DOM goes.
// Usage: node profile.js <report.json>
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const reportPath = process.argv[2];

function summarize(profile, top = 18) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
        const n = byId.get(id);
        const cf = n.callFrame;
        const file = (cf.url || '').split('/').pop();
        const key = cf.functionName ? `${cf.functionName} (${file}:${cf.lineNumber + 1})` : `(${cf.url ? file : n.callFrame.functionName || 'native'})`;
        self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    return { totalMs: Math.round(total), top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${Math.round(v)}ms  ${k}`) };
}

async function profiled(cdp, page, name, fn) {
    await page.waitForTimeout(800);
    await cdp.send('Profiler.start');
    await fn();
    await page.waitForTimeout(1500);
    const { profile } = await cdp.send('Profiler.stop');
    console.log(`\n=== ${name}`);
    const s = summarize(profile);
    console.log(`sampled total ${s.totalMs}ms`);
    s.top.forEach((l) => console.log('  ' + l));
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });
    await page.click('#mode-open');
    // A report picked on its own opens at once: picking it is what is profiled.
    await profiled(cdp, page, 'Open a report', async () => {
        await page.setInputFiles('#resultsFiles', reportPath);
        await page.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport')?.textContent || ''), null, { timeout: 300000 });
    });

    const dom = await page.evaluate(() => {
        const all = document.getElementsByTagName('*').length;
        const inDialogs = [...document.querySelectorAll('#results dialog')].reduce((a, d) => a + d.getElementsByTagName('*').length, 0);
        const dialogs = document.querySelectorAll('#results dialog').length;
        const closedDetails = [...document.querySelectorAll('#results details:not([open])')].reduce((a, d) => a + d.getElementsByTagName('*').length, 0);
        const imgs = document.querySelectorAll('img').length;
        const dataImgs = [...document.querySelectorAll('img')].filter((i) => (i.getAttribute('src') || '').startsWith('data:')).length;
        const hidden = [...document.querySelectorAll('#results [hidden], #results .is-hidden')].reduce((a, d) => a + d.getElementsByTagName('*').length, 0);
        const sections = [...document.querySelectorAll('#results > *')].map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}: ${e.getElementsByTagName('*').length}`);
        const htmlMB = (document.documentElement.outerHTML.length / 1e6).toFixed(1);
        return { all, dialogs, inDialogs, closedDetails, hidden, imgs, dataImgs, htmlMB, sections: sections.slice(0, 12) };
    });
    console.log('\nDOM breakdown', JSON.stringify(dom, null, 1));

    await page.click('#mode-run');
    await page.waitForTimeout(1500);
    await profiled(cdp, page, 'Switch back to open report', async () => {
        await page.click('#mode-open');
        await page.waitForFunction(() => document.querySelectorAll('#results *').length > 1000, null, { timeout: 300000 });
    });

    const other = await page.$$eval('#results-grouping-select option', (o) => o.map((x) => x.value).filter((v) => v !== 'custom' && v !== 'none'));
    await profiled(cdp, page, `Grouping change -> ${other[0]}`, async () => {
        await page.selectOption('#results-grouping-select', other[0]);
    });
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
