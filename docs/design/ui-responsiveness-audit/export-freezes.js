// Longest main-thread tasks during a ZIP export of a loaded report.
// Usage: [BASE=http://127.0.0.1:3000/] node export-freezes.js <report.json>
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  p.on('dialog', (d) => d.accept('long').catch(() => {}));
  await p.addInitScript(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); });
  await p.goto(process.env.BASE || 'http://127.0.0.1:3000/'); await p.click('#mode-open');
  await p.setInputFiles('#resultsFiles', process.argv[2]);
  // A report picked on its own opens at once.
  await p.waitForFunction(() => /loaded/i.test(document.querySelector('#statusReport')?.textContent || ''), null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  const t0 = await p.evaluate(() => performance.now());
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 900000 }), p.locator('#results-container button:visible:has-text("Download")').first().click()]);
  await p.waitForTimeout(1000);
  const lt = await p.evaluate((t0) => window.__long.filter((e) => e.s >= t0).map((e) => ({ at: e.s - Math.round(t0), d: e.d })), t0);
  const top = [...lt].sort((a, b) => b.d - a.d).slice(0, 6);
  console.log('tasks', lt.length, 'blocked', lt.reduce((a, e) => a + e.d, 0), 'top', JSON.stringify(top));
  await b.close();
})();
