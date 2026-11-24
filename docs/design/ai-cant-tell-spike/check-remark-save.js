'use strict';

// Checks in the real lab app that a conformance remark made with "Add to the
// remarks" is saved in the downloaded report zip and comes back when that zip
// is opened again. Uses the pre-installed Playwright.
//
//   node examples/serve-demo-site.js &
//   node src/cli/run-workflow.js examples/specs/site-tour.spec.json --out <dir>
//   PORT=3123 node server.js &
//   node docs/design/ai-cant-tell-spike/check-remark-save.js <dir>/payload.json [http://127.0.0.1:3123/]
//
// Gives every can't-tell occurrence but the page-level manual ones a stub AI
// answer ("pass"), answers the img-alt-quality question as a fail with a
// reason, adds the remark to 1.1.1, downloads the report, opens the zip in a
// fresh page and compares. Exits 1 when the remark does not come back.
//
// Three things the app does that a script has to know: a picked report loads
// once the "open report" tab is shown; "Download report" asks for a name
// first; and where the browser has showSaveFilePicker the app saves through it,
// which a headless browser cannot answer, so it is taken away here and the app
// falls back to an ordinary download.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const [payloadFile, appUrl = 'http://127.0.0.1:3123/'] = process.argv.slice(2);
if (!payloadFile) {
    console.error('Usage: node check-remark-save.js <payload.json> [app url]');
    process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'remark-save-'));
const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
for (const scan of payload.scans || []) {
    for (const f of (scan.canonical && scan.canonical.findings) || []) {
        if (f.outcome !== 'cantTell') continue;
        for (const o of f.occurrences || []) {
            if (!o.atomicCheckId || o.atomicCheckId === 'manual-review') continue;
            o.ai = { verdict: 'pass', confidence: 0.9, rationale: 'Stub answer.', provenance: 'ai-supported', evidence: { facts: {} }, model: 'stub', promptVersion: 'registry-1', check: o.atomicCheckId, tier: 0 };
        }
    }
}
const sample = path.join(work, 'sample.a11y-report.json');
fs.writeFileSync(sample, JSON.stringify(payload));

async function openReport(page, file) {
    await page.goto(appUrl, { waitUntil: 'networkidle' });
    await page.setInputFiles('#resultsFiles', file);
    await page.getByRole('tab', { name: 'open report' }).click();
    await page.getByRole('button', { name: 'Review conformance' }).waitFor({ timeout: 30000 });
}

async function remarkRow(page) {
    await page.getByRole('button', { name: 'Review conformance' }).click();
    await page.evaluate(() => document.querySelectorAll('#acr-review-dialog details.acr-section').forEach((d) => { d.open = true; }));
    return page.locator('#acr-review-dialog .acr-row[data-key="1.1.1"]').first();
}

(async () => {
    const browser = await chromium.launch();
    try {
        const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
        await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
        await openReport(page, sample);

        await page.getByRole('button', { name: /^Review AI answers/ }).click();
        const card = page.locator('.air-card').filter({ hasText: 'img-alt-quality' }).first();
        await card.locator('input.ai-review-radio[value="fail"]').check();
        await card.locator('input.ai-review-note').fill('The alt text is only the file name');
        await card.locator('input.ai-review-note').press('Tab');
        await page.locator('[data-air-close]').click();

        let row = await remarkRow(page);
        await row.locator('[data-acr-ai-add]').click();
        const added = await row.locator('[data-part="remarks"]').inputValue();
        await page.locator('#acr-review-dialog [data-acr-close]').first().click();

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.getByRole('button', { name: /^Download report$/ }).first().click()
                .then(() => page.getByRole('dialog', { name: 'Name this report' }).getByRole('button', { name: 'Download' }).click()),
        ]);
        const zip = path.join(work, download.suggestedFilename());
        await download.saveAs(zip);

        // A fresh page: only the file carries the remark.
        const again = await (await browser.newContext()).newPage();
        await openReport(again, zip);
        row = await remarkRow(again);
        const back = await row.locator('[data-part="remarks"]').inputValue();
        await row.locator('[data-acr-ai-add]').click();
        const afterSecondAdd = await row.locator('[data-part="remarks"]').inputValue();

        console.log('Added:     ' + JSON.stringify(added));
        console.log('Read back: ' + JSON.stringify(back));
        const ok = !!added && back === added && afterSecondAdd === back;
        console.log(ok ? 'OK: the remark came back, and adding it again changed nothing.' : 'FAILED');
        process.exitCode = ok ? 0 : 1;
    } finally {
        await browser.close();
        fs.rmSync(work, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
