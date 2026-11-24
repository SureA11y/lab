'use strict';

// Builds a set of "can't tell" cases for a person to evaluate against the AI's
// answers: samples unique questions from a run's payload.json, visits each
// page to collect the evidence the AI pass would read (the pass's own code)
// and a picture of the element. Writes eval-set.json.
//
//   node build-eval-set.js <payload.json> <out-dir> [perCheckJSON]

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { collectEvidence } = require('../../../src/server-side/ai-answer/evidence');
const { entryFor } = require('../../../src/server-side/ai-answer/registry');

const [payloadFile, outDir, perCheckArg] = process.argv.slice(2);
const PER_CHECK = perCheckArg ? JSON.parse(perCheckArg) : {
    'img-alt-decorative': 14, 'img-alt-quality': 14, 'link-name-quality': 14,
    'form-control-programmatic-label-quality': 10, 'page-title-patterns': 10, 'p-as-heading': 6,
};

// A seeded shuffle, so the same run gives the same sample.
function shuffle(list, seed = 7) {
    const a = list.slice();
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) % 4294967296;
        const j = s % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function uniqueCases(payload) {
    const map = new Map();
    for (const scan of payload.scans) {
        for (const f of (scan.canonical && scan.canonical.findings) || []) {
            if (f.outcome !== 'cantTell') continue;
            for (const o of f.occurrences || []) {
                if ((o.occurrenceOutcome || o.outcome) !== 'cantTell' || !entryFor(o.atomicCheckId)) continue;
                const key = o.atomicCheckId + '|' + (o.html || '').slice(0, 300);
                let c = map.get(key);
                if (!c) {
                    c = {
                        check: o.atomicCheckId, rule: f.ruleId, criterion: (f.wcag && f.wcag.sc) || null, title: f.title,
                        occurrence: { atomicCheckId: o.atomicCheckId, target: o.target, html: o.html, failureSummary: o.failureSummary, hint: o.hint, howToCheck: o.howToCheck, details: o.details },
                        lean: o.lean || null, pages: [],
                    };
                    map.set(key, c);
                }
                if (o.pageUrl && !c.pages.includes(o.pageUrl)) c.pages.push(o.pageUrl);
            }
        }
    }
    return [...map.values()];
}

function sample(cases) {
    const out = [];
    for (const [check, n] of Object.entries(PER_CHECK)) {
        const pool = shuffle(cases.filter((c) => c.check === check));
        // Where the tool leans, take both ways, so a lean is not all we test.
        const leaning = pool.filter((c) => c.lean && c.lean.toward);
        const fail = leaning.filter((c) => c.lean.toward === 'fail');
        const pass = leaning.filter((c) => c.lean.toward !== 'fail');
        const none = pool.filter((c) => !(c.lean && c.lean.toward));
        const picked = [];
        const lanes = [fail, pass, none];
        for (let i = 0; picked.length < Math.min(n, pool.length); i++) {
            let moved = false;
            for (const lane of lanes) { if (lane[i] && picked.length < n) { picked.push(lane[i]); moved = true; } }
            if (!moved) break;
        }
        out.push(...picked);
    }
    return out.map((c, i) => ({ caseId: 'A' + String(i + 1).padStart(2, '0'), ...c }));
}

(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    const all = uniqueCases(payload);
    const cases = sample(all);
    console.log(`unique answerable questions: ${all.length}; sampled: ${cases.length}`);
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const byPage = new Map();
    for (const c of cases) { const u = c.pages[0]; if (!byPage.has(u)) byPage.set(u, []); byPage.get(u).push(c); }
    let n = 0;
    for (const [url, group] of byPage) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            await page.click('#onetrust-reject-all-handler').catch(() => {});
            await new Promise((r) => setTimeout(r, 800));
        } catch (e) {
            for (const c of group) c.visit = { ok: false, error: String(e.message || e).slice(0, 120) };
            await page.close();
            continue;
        }
        for (const c of group) {
            c.visit = { ok: true, url };
            const wanted = entryFor(c.check).evidence;
            c.evidence = await collectEvidence(page, c.occurrence, wanted);
            const sel = Array.isArray(c.occurrence.target) ? c.occurrence.target[0] : null;
            try {
                const el = typeof sel === 'string' ? await page.$(sel) : null;
                if (el) {
                    const box = await el.boundingBox();
                    if (box && box.width > 1 && box.height > 1) {
                        const buf = await el.screenshot({ type: 'jpeg', quality: 70 });
                        const file = `${c.caseId}.jpg`;
                        fs.writeFileSync(path.join(outDir, file), buf);
                        c.screenshot = file;
                    } else c.visit.note = 'element not visible on load (hidden, in a menu or collapsed)';
                } else c.visit.note = 'selector matches nothing now (page changed, or a state the scan reached)';
            } catch (e) {
                c.visit.note = 'screenshot failed: ' + String(e.message || e).slice(0, 80);
            }
            n++;
        }
        await page.close();
        console.log(`${n}/${cases.length}`);
    }
    await browser.close();
    fs.writeFileSync(path.join(outDir, 'eval-set.json'), JSON.stringify(cases, null, 1));
    const withShot = cases.filter((c) => c.screenshot).length;
    console.log(`written: ${cases.length} cases, ${withShot} with a screenshot`);
})();
