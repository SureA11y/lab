#!/usr/bin/env node
'use strict';

// Has a model answer a run's AI questions outside the lab, on exactly the
// prompts the lab would send, and puts its answers back into the run: to
// evaluate a model without giving the lab a key, as the spike did.
//
// 1. Run the workflow as a preview (A11Y_AI_PREVIEW=on, or ai: { preview: true }):
//    its ai-sent.json holds every question as it would be sent, masked.
// 2. node answer-offline.js prompts <ai-sent.json> <questions.jsonl>
//    One line per question: { id, page, check, selector, prompt }.
// 3. A model answers each prompt, blind (the prompt only), one line per
//    question in answers.jsonl: { id, verdict, confidence, rationale }.
// 4. node answer-offline.js apply <payload.json> <questions.jsonl> <answers.jsonl> <out.json> [model name]
//    The run with those answers, as the lab would have attached them: the
//    same confidence threshold (0.6), keyboard never passed by the AI.
//
// Then score it (examples/ai-demo-score.js for the demo) or open it in the
// lab's Review AI answers.

const fs = require('fs');
const { entryFor, PROMPT_VERSION } = require('../../../src/server-side/ai-answer/registry');

const MIN_CONFIDENCE = 0.6;
const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function prompts(sentFile, outFile) {
    const sent = JSON.parse(fs.readFileSync(sentFile, 'utf8'));
    const lines = sent.map((e, i) => ({
        id: 'q' + (i + 1),
        page: e.page,
        check: e.check,
        selector: e.selector,
        prompt: (e.body && (e.body.prompt || (e.body.messages && e.body.messages[0] && e.body.messages[0].content))) || '',
    }));
    fs.writeFileSync(outFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    console.log(`${lines.length} questions in ${outFile}`);
}

function apply(payloadFile, questionsFile, answersFile, outFile, modelName = 'a model run outside the lab') {
    const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    const questions = new Map(readJsonl(questionsFile).map((q) => [q.id, q]));
    let applied = 0;
    const missing = [];
    for (const a of readJsonl(answersFile)) {
        const q = questions.get(a.id);
        if (!q) { missing.push(a.id); continue; }
        const verdict = ['pass', 'fail', 'unsure'].includes(a.verdict) ? a.verdict : null;
        const confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0));
        for (const scan of payload.scans || []) {
            if (scan.url !== q.page) continue;
            for (const f of (scan.canonical && scan.canonical.findings) || []) {
                for (const o of f.occurrences || []) {
                    if (!o.ai || o.ai.check !== q.check || ((o.target && o.target[0]) || null) !== (q.selector || null)) continue;
                    const entry = entryFor(q.check) || {};
                    const sure = verdict && verdict !== 'unsure' && confidence >= MIN_CONFIDENCE;
                    const pass = verdict === 'pass' && entry.passAllowed === false;
                    o.ai = {
                        ...o.ai, verdict, confidence, rationale: String(a.rationale || '').slice(0, 600),
                        provenance: sure && !pass ? 'ai-supported' : 'unresolved',
                        reason: pass ? 'pass-needs-person' : (sure ? undefined : (verdict ? 'unsure' : 'unreadable-answer')),
                        model: modelName, promptVersion: o.ai.promptVersion || PROMPT_VERSION,
                    };
                    if (o.ai.reason === undefined) delete o.ai.reason;
                    applied++;
                }
            }
        }
    }
    // A question the lab asked once for several identical elements (the same
    // check and the same evidence, `reused`) gets the same answer, as the
    // lab's own call would give it.
    const answeredBy = new Map();
    const occurrences = () => (payload.scans || []).flatMap((scan) => ((scan.canonical && scan.canonical.findings) || []).flatMap((f) => f.occurrences || []));
    for (const o of occurrences()) {
        if (o.ai && !o.ai.reused && o.ai.model === modelName) answeredBy.set(JSON.stringify([o.ai.check, o.ai.evidence]), o.ai);
    }
    let reused = 0;
    for (const o of occurrences()) {
        if (!o.ai || !o.ai.reused) continue;
        const source = answeredBy.get(JSON.stringify([o.ai.check, o.ai.evidence]));
        if (!source) continue;
        o.ai = { ...source, reused: true };
        reused++;
    }
    fs.writeFileSync(outFile, JSON.stringify(payload));
    console.log(`${applied} answers attached in ${outFile}${reused ? `, and to ${reused} reused` : ''}${missing.length ? `; ${missing.length} answers name no question: ${missing.join(', ')}` : ''}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'prompts' && args.length >= 2) prompts(args[0], args[1]);
else if (cmd === 'apply' && args.length >= 4) apply(...args);
else {
    console.error('Usage:\n  node answer-offline.js prompts <ai-sent.json> <questions.jsonl>\n  node answer-offline.js apply <payload.json> <questions.jsonl> <answers.jsonl> <out.json> [model name]');
    process.exit(2);
}

module.exports = { prompts, apply };
