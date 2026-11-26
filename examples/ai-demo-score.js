#!/usr/bin/env node
'use strict';

// Scores a run of the AI answers demo against its correct answers.
//
//   node examples/serve-demo-site.js &
//   node src/cli/run-workflow.js examples/specs/ai-answers.spec.json --out runs/ai-demo
//   node examples/ai-demo-score.js runs/ai-demo/payload.json
//
// For each question the demo asks: the correct answer, the AI's, and how they
// compare. "AI pass, should fail" is the costly mistake. A question the AI
// left open (unsure, no model, a preview) is counted apart. Exits 1 when the
// AI said pass where the answer is fail, 2 on a usage or read error.

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
    console.error('Usage: node examples/ai-demo-score.js <payload.json>');
    process.exit(2);
}

let payload;
try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Could not read ${file}: ${e.message}`); process.exit(2); }
const { answers } = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-site', 'ai', 'expected.json'), 'utf8'));

// The AI's answer for each question of the run: page, check and target.
const found = new Map();
for (const scan of payload.scans || []) {
    const page = String(scan.url || '').replace(/^https?:\/\/[^/]+\//, '');
    // Best-practice findings (includeBestPractice) are asked too.
    for (const f of [...((scan.canonical && scan.canonical.findings) || []), ...((scan.canonical && scan.canonical.bestPractices) || [])]) {
        if (f.outcome !== 'cantTell') continue;
        for (const o of f.occurrences || []) {
            if (!o.ai) continue;
            const key = [page, o.ai.check, (o.target && o.target[0]) || ''].join('|');
            if (!found.has(key)) found.set(key, o.ai);
        }
    }
}

const word = (ai) => {
    if (!ai) return 'not asked';
    if (ai.provenance === 'ai-supported') return ai.verdict;
    return 'open (' + (ai.reason || 'unsure') + ')';
};
const counts = { agree: 0, missedFail: 0, falseFail: 0, open: 0, notAsked: 0 };
const rows = answers.map((a) => {
    const ai = found.get([a.page, a.check, a.target].join('|'));
    let result;
    if (!ai) { result = 'not asked'; counts.notAsked++; }
    else if (ai.provenance !== 'ai-supported') { result = 'left open'; counts.open++; }
    else if (ai.verdict === a.expected) { result = 'agrees'; counts.agree++; }
    else if (ai.verdict === 'pass') { result = 'AI PASS, SHOULD FAIL'; counts.missedFail++; }
    else { result = 'AI fail, should pass'; counts.falseFail++; }
    return { page: a.page.replace('ai/', ''), check: a.check, target: a.target.length > 34 ? a.target.slice(0, 33) + '…' : a.target, expected: a.expected, ai: word(ai), result, why: a.why, rationale: ai && ai.rationale };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('Page', 14) + pad('Check', 42) + pad('Target', 36) + pad('Correct', 9) + pad('AI', 24) + 'Result');
for (const r of rows) console.log(pad(r.page, 14) + pad(r.check, 42) + pad(r.target, 36) + pad(r.expected, 9) + pad(r.ai, 24) + r.result);
const answered = counts.agree + counts.missedFail + counts.falseFail;
console.log('');
console.log(`${answers.length} questions: ${answered} answered by the AI, ${counts.agree} agree, ${counts.missedFail} AI pass where it should fail, ${counts.falseFail} AI fail where it should pass, ${counts.open} left open, ${counts.notAsked} not asked.`);
const extra = [...found.keys()].filter((k) => !answers.some((a) => [a.page, a.check, a.target].join('|') === k));
if (extra.length) console.log(`Asked but not in expected.json: ${extra.join(', ')}`);
if (process.argv.includes('--why')) {
    console.log('');
    for (const r of rows.filter((x) => x.result !== 'agrees')) console.log(`- ${r.check} ${r.target}: correct is ${r.expected} because ${r.why}${r.rationale ? ` The AI said: ${r.rationale}` : ''}`);
}
process.exitCode = counts.missedFail ? 1 : 0;
