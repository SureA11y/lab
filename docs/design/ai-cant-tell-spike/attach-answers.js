'use strict';

// Makes a report the lab app can open and review from a run's payload.json
// and the answers a model gave to the sampled cases (eval-set.json and
// ai-answers.json, see build-eval-set.js): keeps only the scans where a
// sampled question occurs, and attaches each answer, with the facts the model
// was given, to every occurrence of that question in them.
//
//   node attach-answers.js <payload.json> <eval dir> <out.a11y-report.json> [modelName]

const fs = require('fs');
const path = require('path');

const [payloadFile, evalDir, outFile, modelName = 'a model, run outside the app'] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
const cases = JSON.parse(fs.readFileSync(path.join(evalDir, 'eval-set.json'), 'utf8'));
const answers = new Map(JSON.parse(fs.readFileSync(path.join(evalDir, 'ai-answers.json'), 'utf8')).map((a) => [a.caseId, a]));

const keyOf = (check, html) => check + '|' + String(html || '').slice(0, 300);
const aiByKey = new Map();
for (const c of cases) {
    const a = answers.get(c.caseId);
    if (!a) continue;
    const sure = a.verdict !== 'unsure' && a.confidence >= 0.6;
    const { element, ...given } = c.evidence || {};
    const shot = c.screenshot && path.join(evalDir, c.screenshot);
    if (shot && fs.existsSync(shot)) given.screenshot = 'data:image/jpeg;base64,' + fs.readFileSync(shot).toString('base64');
    aiByKey.set(keyOf(c.check, c.occurrence.html), {
        verdict: a.verdict, confidence: a.confidence, rationale: a.rationale,
        provenance: sure ? 'ai-supported' : 'unresolved', ...(sure ? {} : { reason: 'unsure' }),
        evidence: given, model: modelName, promptVersion: 'registry-1', check: c.check, tier: 0,
        steps: [{ action: 'read', tier: 0, target: (c.occurrence.target && c.occurrence.target[0]) || null, result: Object.keys(c.evidence || {}) }],
    });
}

// The scans to keep: for each sampled question, the first scan it occurs in.
const wanted = new Set(aiByKey.keys());
const covered = new Set();
const keepIdx = new Set();
payload.scans.forEach((scan, i) => {
    for (const f of (scan.canonical && scan.canonical.findings) || []) {
        if (f.outcome !== 'cantTell') continue;
        for (const o of f.occurrences || []) {
            const k = keyOf(o.atomicCheckId, o.html);
            if (wanted.has(k) && !covered.has(k)) { covered.add(k); keepIdx.add(i); }
        }
    }
});
const scans = payload.scans.filter((_, i) => keepIdx.has(i));
let attached = 0;
for (const scan of scans) {
    for (const f of (scan.canonical && scan.canonical.findings) || []) {
        if (f.outcome !== 'cantTell') continue;
        for (const o of f.occurrences || []) {
            const ai = aiByKey.get(keyOf(o.atomicCheckId, o.html));
            if (ai) { o.ai = ai; attached++; }
        }
    }
}
const out = { ...payload, scans, scenarioName: (payload.scenarioName || 'report') + ' (AI review sample)' };
delete out.aiReview;
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`scans kept: ${scans.length} of ${payload.scans.length}; questions covered: ${covered.size} of ${wanted.size}; occurrences with an answer: ${attached}; size: ${Math.round(fs.statSync(outFile).size / 1048576)} MB`);
