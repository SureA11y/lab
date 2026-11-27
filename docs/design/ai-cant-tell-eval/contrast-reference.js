'use strict';

// A reference measurement for contrast-computable cases, independent of the
// lab's own evidence (evidence.js measurePixels): in a browser of its own,
// it takes a picture of the element, then makes its text transparent and
// takes the same picture again, so the background under each glyph is read
// directly, not guessed from the colours. A case is labelled fail when more
// than a tenth of the background under the glyphs is below the ratio WCAG
// 1.4.3 asks (4.5:1, or 3:1 for text of 24px, or 18.66px bold), pass
// otherwise. Used to label the real cases of the measure lane.
//
//   node docs/design/ai-cant-tell-eval/contrast-reference.js <cases.json> <labels.json>
//
// cases.json: [{ id, page, selector }]. Needs Chrome (Puppeteer), and sharp.

const fs = require('fs');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const lum = (r, g, b) => { const c = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function measure(page, selector) {
    const box = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const m = cs.color.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
        return { x: r.left + scrollX, y: r.top + scrollY, width: Math.min(r.width, 800), height: Math.min(r.height, 300), color: m ? [+m[1], +m[2], +m[3]] : null, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400 };
    }, selector);
    if (!box || !box.color || box.width < 2 || box.height < 2) return null;
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    const raw = async () => (await sharp(await page.screenshot({ type: 'png', clip, captureBeyondViewport: true })).removeAlpha().raw().toBuffer());
    const withText = await raw();
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.dataset.refColor = el.style.color; el.style.setProperty('color', 'transparent', 'important'); el.style.setProperty('text-shadow', 'none', 'important'); for (const d of el.querySelectorAll('*')) d.style.setProperty('color', 'transparent', 'important'); }, selector);
    const without = await raw();
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.style.color = el.dataset.refColor; delete el.dataset.refColor; }, selector);
    if (withText.length !== without.length) return null;
    const text = lum(...box.color);
    const under = [];
    for (let i = 0; i < withText.length; i += 3) {
        const d = Math.abs(withText[i] - without[i]) + Math.abs(withText[i + 1] - without[i + 1]) + Math.abs(withText[i + 2] - without[i + 2]);
        if (d < 60) continue; // not under a glyph
        under.push(ratio(text, lum(without[i], without[i + 1], without[i + 2])));
    }
    if (under.length < 10) return { measured: false };
    const large = box.size >= 24 || (box.size >= 18.66 && box.weight >= 700);
    const need = large ? 3 : 4.5;
    under.sort((a, b) => a - b);
    const below = under.filter((x) => x < need).length / under.length;
    return { measured: true, need, below: Math.round(below * 100) / 100, p10: Math.round(under[Math.floor(under.length * 0.1)] * 100) / 100 };
}

async function main(casesFile, outFile) {
    const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const labels = {};
    const notes = {};
    let current = null;
    for (const c of cases) {
        if (c.page !== current) { await page.goto(c.page, { waitUntil: 'networkidle2' }); current = c.page; }
        const m = await measure(page, c.selector).catch(() => null);
        if (!m || !m.measured) { labels[c.id] = 'unsure'; notes[c.id] = 'not measurable'; continue; }
        labels[c.id] = m.below > 0.1 ? 'fail' : 'pass';
        notes[c.id] = `${Math.round(m.below * 100)}% of the background under the glyphs below ${m.need}:1 (10th percentile ${m.p10}:1)`;
    }
    await browser.close();
    fs.writeFileSync(outFile, JSON.stringify({ labels, notes }, null, 1));
    const n = Object.values(labels).reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {});
    console.log(Object.keys(labels).length, 'cases', JSON.stringify(n));
}

if (require.main === module) main(process.argv[2], process.argv[3]).catch((e) => { console.error(e); process.exit(1); });

module.exports = { measure };
