'use strict';

/**
 * Makes what shows the lab to someone who hasn't run it, from the demo shop:
 *
 *   docs/assets/screens/app-workflow.png  the run workflow tab, with a workflow
 *   docs/assets/screens/app-report.png    a report's scans
 *   docs/assets/screens/app-compare.png   release 2 compared with release 1
 *   docs/assets/screens/demo.gif          a run, its report, the comparison
 *   docs/gallery/                         the reports and the comparison as
 *                                         files that open in any browser
 *
 * It runs the demo shop tour on release 1 and on release 2 against it, as
 * docs/getting-started.md does, then opens the results in the app. Run it
 * again after a change to what these show:
 *
 *   npm run build:showcase
 *
 * Needs ffmpeg for the GIF; without it, the GIF is left as it is.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const SCREENS = path.join(ROOT, 'docs', 'assets', 'screens');
const GALLERY = path.join(ROOT, 'docs', 'gallery');
const PORT = Number(process.env.SHOWCASE_PORT || 3990);
const APP = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 900 };
// Under reports/, which the lab serves at /reports, so the app can open them.
const STORE_NAME = 'showcase';
const STORE = path.join(ROOT, 'reports', STORE_NAME);

const children = [];

function start(args, env = {}) {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
    children.push(child);
    return child;
}

async function waitFor(url, timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${url} did not answer`);
}

function cli(args) {
    try {
        execFileSync(process.execPath, [path.join(ROOT, 'src', 'cli', 'run-workflow.js'), ...args], { cwd: ROOT, stdio: 'pipe' });
    } catch (err) {
        // 3: new failures against the baseline, which release 2 has.
        if (err.status !== 3) throw new Error(`run-workflow ${args.join(' ')}: ${err.stderr || err.message}`);
    }
}

/** The newest run of the tour in the store: its folder. */
function latestRun() {
    const runs = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === 'payload.json' && full.includes(`${path.sep}runs${path.sep}`)) runs.push(path.dirname(full));
        }
    })(STORE);
    return runs.sort().pop();
}

const served = (dir, file) => `/reports/${path.relative(path.join(ROOT, 'reports'), path.join(dir, file)).split(path.sep).join('/')}`;

async function newPage(browser, downloads) {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (downloads) {
        const cdp = await page.createCDPSession();
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    }
    // The app asks a report's name before downloading it: page.reportName.
    page.on('dialog', (dialog) => {
        dialog.accept(dialog.type() === 'prompt' ? page.reportName : undefined).catch(() => {});
    });
    // The app saves with the browser's save dialog where there is one.
    await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });
    return page;
}

async function waitForText(page, selector, pattern, timeout = 120000) {
    await page.waitForFunction(
        (sel, source) => new RegExp(source).test((document.querySelector(sel)?.textContent || '')),
        { timeout, polling: 250 }, selector, pattern.source);
}

/**
 * Scrolls so the heading starting with this text sits `offset` pixels from
 * the top, below the sticky tabs.
 */
async function scrollToHeading(page, text, offset = 60) {
    await page.evaluate((wanted, below) => {
        const heading = [...document.querySelectorAll('h1, h2, h3')].find((h) => h.offsetParent && h.textContent.trim().startsWith(wanted));
        if (!heading) throw new Error(`No heading "${wanted}"`);
        window.scrollTo(0, heading.getBoundingClientRect().top + window.scrollY - below);
    }, text, offset);
    await new Promise((resolve) => setTimeout(resolve, 300));
}

async function waitForDownload(dir, before, timeout = 60000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        const added = fs.readdirSync(dir).filter((f) => !before.includes(f) && !f.endsWith('.crdownload'));
        if (added.length) return path.join(dir, added[0]);
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('No download');
}

/** Downloads the open report as one HTML file, into `name` in the gallery. */
async function downloadSingleHtml(page, downloads, name, reportName) {
    page.reportName = reportName;
    const before = fs.readdirSync(downloads);
    await page.evaluate(() => {
        const chevron = [...document.querySelectorAll('button.split-button__chevron[aria-label="Other download formats"]')].find((b) => b.offsetParent);
        if (!chevron) throw new Error('No download menu');
        chevron.click();
    });
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.offsetParent && m.textContent.includes('Download as a single file'));
        if (!item) throw new Error('No single file download');
        item.click();
    });
    const file = await waitForDownload(downloads, before);
    fs.copyFileSync(file, path.join(GALLERY, name));
}

/** Frames of the screen every `everyMs` until `done` resolves. */
async function record(page, dir, done, everyMs = 400) {
    let n = fs.readdirSync(dir).length;
    let finished = false;
    done.then(() => { finished = true; }, () => { finished = true; });
    while (!finished) {
        await page.screenshot({ path: path.join(dir, `f${String(n++).padStart(4, '0')}.png`) });
        await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
}

async function hold(page, dir, count) {
    let n = fs.readdirSync(dir).length;
    const shot = path.join(dir, `f${String(n++).padStart(4, '0')}.png`);
    await page.screenshot({ path: shot });
    for (let i = 1; i < count; i += 1) fs.copyFileSync(shot, path.join(dir, `f${String(n++).padStart(4, '0')}.png`));
}

function makeGif(frames, out) {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    } catch {
        console.log('No ffmpeg: the GIF is left as it is.');
        return;
    }
    const filters = 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '2.5', '-i', path.join(frames, 'f%04d.png'), '-vf', filters, '-loop', '0', out]);
}

async function main() {
    fs.rmSync(STORE, { recursive: true, force: true });
    fs.mkdirSync(GALLERY, { recursive: true });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-'));
    const downloads = path.join(work, 'downloads');
    const frames = path.join(work, 'frames');
    fs.mkdirSync(downloads);
    fs.mkdirSync(frames);

    start([path.join('examples', 'serve-demo-site.js')]);
    await waitFor('http://localhost:8780/');
    await waitFor('http://localhost:8781/');

    // The tour on release 1, kept as a baseline, then on release 2 against it.
    const spec = path.join('examples', 'specs', 'site-tour.spec.json');
    cli([spec, '--store', STORE, '--promote', 'release-1', '-q']);
    const run1 = latestRun();
    cli([spec, '--store', STORE, '--url', 'http://localhost:8781/', '--baseline', '@release-1', '-q']);
    const run2 = latestRun();
    fs.copyFileSync(path.join(run2, 'comparison.html'), path.join(GALLERY, 'comparison.html'));

    start(['server.js'], { PORT: String(PORT) });
    await waitFor(`${APP}/health`);
    const browser = await puppeteer.launch({ headless: true, args: process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : [] });
    try {
        // The run workflow tab, with the shopping flow loaded, and a run of it.
        console.log('workflow');
        const page = await newPage(browser);
        await page.goto(APP, { waitUntil: 'networkidle0' });
        const input = await page.$('#config-file');
        await input.uploadFile(path.join(ROOT, 'examples', 'configs', 'shopping-flow.a11y-config.json'));
        await page.waitForFunction(() => document.querySelector('#url-input')?.value.includes('8780'));
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.screenshot({ path: path.join(SCREENS, 'app-workflow.png') });

        await hold(page, frames, 4);
        await page.click('#scan-button');
        await record(page, frames, waitForText(page, '#statusRun', /^Finished:/));
        console.log(`  ${(await page.$eval('#statusRun', (el) => el.textContent)).trim()}`);
        await hold(page, frames, 5);
        await page.close();

        // Release 1's report, as the open report tab shows it.
        console.log('report');
        const report = await newPage(browser, downloads);
        await report.goto(`${APP}/?report=${encodeURIComponent(served(run1, 'payload.json'))}`, { waitUntil: 'networkidle0' });
        await report.waitForFunction(() => [...document.querySelectorAll('h2, h3')].some((h) => h.offsetParent && h.textContent.trim().startsWith('Scan: Products')), { timeout: 60000 });
        await scrollToHeading(report, 'Scan: Products');
        await report.screenshot({ path: path.join(SCREENS, 'app-report.png') });
        await hold(report, frames, 6);
        await downloadSingleHtml(report, downloads, 'release-1.html', 'Demo shop tour, release 1');
        await report.goto(`${APP}/?report=${encodeURIComponent(served(run2, 'payload.json'))}`, { waitUntil: 'networkidle0' });
        await report.waitForFunction(() => [...document.querySelectorAll('h2, h3')].some((h) => h.offsetParent && h.textContent.trim().startsWith('Scan: Products')), { timeout: 60000 });
        await downloadSingleHtml(report, downloads, 'release-2.html', 'Demo shop tour, release 2');
        await report.close();

        // Release 2 against release 1, in the compare tab.
        console.log('compare');
        const compare = await newPage(browser);
        const both = [run1, run2].map((dir) => `compare=${encodeURIComponent(served(dir, 'payload.json'))}`).join('&');
        await compare.goto(`${APP}/?${both}`, { waitUntil: 'networkidle0' });
        await compare.waitForFunction(() => /improved|worse|changed/i.test(document.querySelector('#compare-tab-content, [data-tab="compare"], main')?.textContent || ''), { timeout: 60000 });
        // The label above the title shows; the load status above it goes
        // under the tabs.
        await scrollToHeading(compare, 'Demo shop tour', 72);
        await compare.screenshot({ path: path.join(SCREENS, 'app-compare.png') });
        await hold(compare, frames, 8);
        await compare.close();
    } finally {
        await browser.close();
    }

    makeGif(frames, path.join(SCREENS, 'demo.gif'));
    fs.rmSync(work, { recursive: true, force: true });
    for (const name of fs.readdirSync(GALLERY)) {
        console.log(`${path.join('docs', 'gallery', name)}  ${Math.round(fs.statSync(path.join(GALLERY, name)).size / 1024)} KB`);
    }
    for (const name of fs.readdirSync(SCREENS)) {
        console.log(`${path.join('docs', 'assets', 'screens', name)}  ${Math.round(fs.statSync(path.join(SCREENS, name)).size / 1024)} KB`);
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => {
        for (const child of children) child.kill();
    });
