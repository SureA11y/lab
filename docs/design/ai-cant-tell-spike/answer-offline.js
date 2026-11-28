#!/usr/bin/env node
'use strict';

// Has a model answer a run's AI questions outside the lab, on exactly the
// prompts the lab would send, and puts its answers back into the run: to
// evaluate a model without giving the lab a key, as the spike did.
//
// 1. Run the workflow as a preview (A11Y_AI_PREVIEW=on, or ai: { preview: true }):
//    its ai-sent.json holds every question as it would be sent, masked.
// 2. node answer-offline.js prompts <ai-sent.json> <questions.jsonl>
//    One line per question: { id, page, check, selector, prompt }, and
//    `picture` (pictures/<id>.jpg beside it) for a question sent with one.
// 3. A model answers each prompt, blind (the prompt only), one line per
//    question in answers.jsonl: { id, verdict, confidence, rationale }.
// 4. node answer-offline.js apply <payload.json> <questions.jsonl> <answers.jsonl> <out.json> [model name]
//    The run with those answers, as the lab would have attached them: the
//    same confidence threshold (0.6), keyboard never passed by the AI.
//
// Then score it (examples/ai-demo-score.js for the demo) or open it in the
// lab's Review AI answers.

const fs = require('fs');
const path = require('path');
const { entryFor, PROMPT_VERSION } = require('../../../src/server-side/ai-answer/registry');
const { statusOf } = require('../../../src/server-side/ai-answer/raise');

const MIN_CONFIDENCE = 0.6;
const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// A question sent with the element's picture (a step's `pictures`): the
// picture is written beside questions.jsonl (pictures/q7.jpg), and the line
// names it, for a model that answers from files.
// A run writes its pictures as files (images/<hash>.jpg beside ai-sent.json);
// a question kept in memory has it as a data URL.
function pictureOf(body, runDir) {
    const shot = body && body.picture === true && body.evidence && typeof body.evidence.screenshot === 'string' ? body.evidence.screenshot : null;
    if (!shot) return null;
    const m = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(shot);
    if (m) return { ext: m[1] === 'jpeg' ? 'jpg' : m[1], data: Buffer.from(m[2], 'base64') };
    const file = path.resolve(runDir, shot);
    if (!file.startsWith(path.resolve(runDir) + path.sep) || !fs.existsSync(file)) return null;
    return { ext: path.extname(file).slice(1) || 'jpg', data: fs.readFileSync(file) };
}

function prompts(sentFile, outFile) {
    const sent = JSON.parse(fs.readFileSync(sentFile, 'utf8'));
    const dir = path.join(path.dirname(outFile), 'pictures');
    const lines = sent.map((e, i) => {
        const id = 'q' + (i + 1);
        const line = {
            id,
            page: e.page,
            check: e.check,
            selector: e.selector,
            prompt: (e.body && (e.body.prompt || (e.body.messages && e.body.messages[0] && e.body.messages[0].content))) || '',
        };
        const pic = pictureOf(e.body, path.dirname(sentFile));
        if (pic) {
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${id}.${pic.ext}`);
            fs.writeFileSync(file, pic.data);
            line.picture = path.relative(path.dirname(outFile), file);
        }
        return line;
    });
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
            for (const f of [...((scan.canonical && scan.canonical.findings) || []), ...((scan.canonical && scan.canonical.bestPractices) || [])]) {
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
    // Phase 2's places (`canonical.aiRaised`): the answer, with its quote, and
    // the place's status from it, as the lab would set them.
    for (const a of readJsonl(answersFile)) {
        const q = questions.get(a.id);
        if (!q) continue;
        for (const scan of payload.scans || []) {
            if (scan.url !== q.page) continue;
            for (const r of (scan.canonical && scan.canonical.aiRaised) || []) {
                if (r.check !== q.check || r.selector !== q.selector) continue;
                const verdict = ['pass', 'fail', 'unsure'].includes(a.verdict) ? a.verdict : null;
                const confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0));
                const sure = verdict && verdict !== 'unsure' && confidence >= MIN_CONFIDENCE;
                r.ai = { ...r.ai, verdict, confidence, rationale: String(a.rationale || '').slice(0, 600), ...(typeof a.quote === 'string' ? { quote: a.quote.slice(0, 300) } : {}), provenance: sure ? 'ai-supported' : 'unresolved', model: modelName };
                if (sure) delete r.ai.reason; else r.ai.reason = verdict ? 'unsure' : 'unreadable-answer';
                r.status = statusOf(r.ai, r.text);
                applied++;
            }
        }
    }
    // A question the lab asked once for several identical elements (the same
    // check and the same evidence, `reused`) gets the same answer, as the
    // lab's own call would give it.
    const answeredBy = new Map();
    const occurrences = () => (payload.scans || []).flatMap((scan) => [...((scan.canonical && scan.canonical.findings) || []), ...((scan.canonical && scan.canonical.bestPractices) || [])].flatMap((f) => f.occurrences || []));
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
