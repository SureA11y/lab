#!/usr/bin/env node
'use strict';

// Re-runs the questions a person has labelled and measures how often the AI
// agrees with them (docs/design/ai-cant-tell-design.md, "Measuring agreement").
// A labelled case is a can't-tell question in a saved report that has the AI
// pass's evidence and a person's answer (pass, fail or unsure, from "Review AI
// answers"). The questions are rebuilt from what the report kept and sent
// through the same step as the pass (askOne in ai-answer/index.js): the same
// provider, allowed sites, masking and log. No page is opened.
//
// With --lessons, each case is asked twice, without and with the lessons, and
// the lessons are accepted only if they lose no agreement and add no "pass"
// where a person said "fail". A case's own example is left out of the lessons
// it is asked with, so the AI is never shown the answer it is tested on.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const { askOne, DEFAULTS } = require('../server-side/ai-answer/index');
const { entryFor, PROMPT_VERSION } = require('../server-side/ai-answer/registry');
const { resolveProvider } = require('../server-side/ai-answer/provider');
const { loadLessons, lessonsFor } = require('../server-side/ai-answer/lessons');
const { allowedSitesOf, siteAllowed, maskingOn } = require('../server-side/ai-answer/outgoing');
const reportFormat = require('../shared/report-format');

const USAGE = `Usage: node src/cli/ai-agreement.js <report> [<report> ...] [options]

Re-runs the can't-tell questions a person labelled in "Review AI answers" and
compares the AI's answers with theirs, per check. A report is a .a11y-report.json,
a payload.json or a report zip. The model is the server's: A11Y_AI_ENDPOINT, else
ANTHROPIC_API_KEY, with A11Y_AI_ALLOWED_SITES and A11Y_AI_MASK as for a run.

Options:
  --lessons <file>     Also ask with these lessons, and say whether to accept
                       them: no lost agreement, no added pass-where-a-person-
                       said-fail, overall or in any check. Exits 1 when not.
  --out <dir>          Where to write agreement.json, agreement.md and
                       ai-sent.json (default: ai-agreement)
  --max-calls <n>      Stop before starting if the re-run would need more
                       calls than this (default 200)
  --seconds <n>        Time allowed for one answer (default ${DEFAULTS.seconds})
  --min-confidence <n> Below it an answer counts as unresolved (default ${DEFAULTS.minConfidence})
  --preview            Send nothing: write what would be sent, and score only
                       the answers the reports already hold
  -h, --help           Show this message

Exit codes: 0 done, 1 the lessons are not accepted, 2 a usage or read error.`;

function parseArgs(argv) {
    const o = { reports: [], lessons: null, out: 'ai-agreement', maxCalls: 200, seconds: DEFAULTS.seconds, minConfidence: DEFAULTS.minConfidence, preview: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
        const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number`); return n; };
        if (a === '-h' || a === '--help') o.help = true;
        else if (a === '--lessons') o.lessons = next();
        else if (a === '--out') o.out = next();
        else if (a === '--max-calls') o.maxCalls = num(next(), a);
        else if (a === '--seconds') o.seconds = num(next(), a);
        else if (a === '--min-confidence') o.minConfidence = num(next(), a);
        else if (a === '--preview') o.preview = true;
        else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
        else o.reports.push(a);
    }
    return o;
}

/** A report file's JSON, read as the current format. */
async function readReport(file) {
    let text;
    if (/\.zip$/i.test(file)) {
        const zip = await JSZip.loadAsync(fs.readFileSync(file));
        const entry = Object.values(zip.files).find((e) => !e.dir && /(\.a11y-report\.json|payload\.json)$/i.test(e.name));
        if (!entry) throw new Error(`${file} holds no report (no .a11y-report.json or payload.json)`);
        text = await entry.async('string');
    } else {
        text = fs.readFileSync(file, 'utf8');
    }
    const json = JSON.parse(text);
    reportFormat.upgradeReport(json);
    return json;
}

let viewModule = null;
const view = async () => viewModule || (viewModule = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'ai-answer-view.js')).href));

/**
 * The labelled cases of some reports: one per question (check and element),
 * the first report's label winning when two disagree. Each:
 * { key, check, person: 'pass'|'fail'|'unsure', note, recorded (the AI answer
 * the report holds), occurrence, finding, evidence, pageUrl, source }.
 * `skipped` counts what could not be a case, and why.
 */
async function labelledCases(reports) {
    const { collectAiCases } = await view();
    const byKey = new Map();
    const skipped = { notInRegistry: 0, noEvidence: 0, conflicting: 0 };
    for (const { file, payload } of reports) {
        const reviews = payload && payload.aiReview && typeof payload.aiReview === 'object' ? payload.aiReview : {};
        for (const c of collectAiCases(payload)) {
            const r = reviews[c.key];
            if (!r || !['pass', 'fail', 'unsure'].includes(r.verdict)) continue;
            if (!entryFor(c.check)) { skipped.notInRegistry++; continue; }
            if (!c.ai || !c.ai.evidence || typeof c.ai.evidence !== 'object') { skipped.noEvidence++; continue; }
            if (byKey.has(c.key)) {
                if (byKey.get(c.key).person !== r.verdict) skipped.conflicting++;
                continue;
            }
            byKey.set(c.key, {
                key: c.key,
                check: c.check,
                person: r.verdict,
                note: String(r.note || ''),
                recorded: c.ai,
                occurrence: { atomicCheckId: c.check, html: c.html, target: c.selector ? [c.selector] : [], failureSummary: c.issue, ...(c.howToCheck ? { howToCheck: c.howToCheck } : {}) },
                finding: { wcag: { sc: c.criterion } },
                // As the pass had it: the element's HTML is the occurrence's own.
                evidence: { element: String(c.html || '').slice(0, 1500), ...c.ai.evidence },
                pageUrl: c.urls[0] || null,
                source: file,
            });
        }
    }
    return { cases: [...byKey.values()], skipped };
}

/** The lessons of a check without the example made from `facts` (that case's own). */
function leaveOneOut(lessons, check, facts) {
    const entry = lessons && lessons.checks && lessons.checks[check];
    if (!entry) return lessons;
    const own = JSON.stringify(facts || null);
    const examples = entry.examples.filter((e) => JSON.stringify(e.facts) !== own);
    if (examples.length === entry.examples.length) return lessons;
    return { ...lessons, checks: { ...lessons.checks, [check]: { ...entry, examples } } };
}

const empty = () => ({ labelled: 0, personUnsure: 0, agree: 0, missedFail: 0, falseFail: 0, unresolved: 0 });

/**
 * How one set of answers (`answers`: key -> ai) compares with the people's,
 * per check and in total. Only a person's pass or fail is scored; a person's
 * "unsure" is counted apart. missedFail: the AI said pass where a person said
 * fail, the costly mistake. falseFail: the AI said fail where a person said
 * pass. unresolved: the AI gave no answer that counts.
 */
// When a check is trusted: at least 30 labelled cases, 95% agreement on the
// answers the AI gave, no "pass" where the person said "fail".
const TRUST = Object.freeze({ cases: 30, agreement: 0.95 });

function score(cases, answers) {
    const perCheck = {};
    const total = empty();
    for (const c of cases) {
        const row = perCheck[c.check] || (perCheck[c.check] = empty());
        const add = (k) => { row[k]++; total[k]++; };
        if (c.person === 'unsure') { add('personUnsure'); continue; }
        add('labelled');
        const ai = answers.get(c.key);
        const supported = ai && ai.provenance === 'ai-supported' && (ai.verdict === 'pass' || ai.verdict === 'fail');
        if (!supported) add('unresolved');
        else if (ai.verdict === c.person) add('agree');
        else if (ai.verdict === 'pass') add('missedFail');
        else add('falseFail');
    }
    for (const row of [...Object.values(perCheck), total]) {
        const answered = row.labelled - row.unresolved;
        row.agreement = row.labelled ? row.agree / row.labelled : null;
        row.answered = row.labelled ? answered / row.labelled : null;
        row.agreementWhenAnswered = answered ? row.agree / answered : null;
        // The user's rule for trusting a check (decision 8): enough cases, the
        // answers it gave right, never a pass where the person said fail.
        row.trusted = row.labelled >= TRUST.cases && row.agreementWhenAnswered !== null && row.agreementWhenAnswered >= TRUST.agreement && row.missedFail === 0;
    }
    return { perCheck, total };
}

/**
 * Whether lessons may be accepted: they lose no agreement and add no missed
 * fail, in total and in every check. { accepted, reasons }.
 */
function judgeLessons(without, withLessons) {
    const reasons = [];
    const checks = new Set([...Object.keys(without.perCheck), ...Object.keys(withLessons.perCheck)]);
    const cmp = (label, a, b) => {
        if (!a || !b) return;
        if (b.missedFail > a.missedFail) reasons.push(`${label}: ${b.missedFail - a.missedFail} more "pass" where a person said "fail" (${a.missedFail} → ${b.missedFail})`);
        if (b.agree < a.agree) reasons.push(`${label}: ${a.agree - b.agree} fewer agreements (${a.agree} → ${b.agree})`);
    };
    cmp('In total', without.total, withLessons.total);
    for (const check of [...checks].sort()) cmp(check, without.perCheck[check], withLessons.perCheck[check]);
    return { accepted: reasons.length === 0, reasons };
}

/** Asks every case once, with `lessons` or none; key -> ai. Logs into `outbox`. */
async function askAll(cases, { model, lessons, env, preview, minConfidence, seconds, outbox, onProgress = () => {} }) {
    const allowed = allowedSitesOf(env);
    const mask = maskingOn(env);
    const answers = new Map();
    let i = 0;
    for (const c of cases) {
        i++;
        if (c.person === 'unsure') continue;
        const base = { promptVersion: lessons ? PROMPT_VERSION + '+lessons' : PROMPT_VERSION, check: c.check, tier: 0 };
        if (!siteAllowed(c.pageUrl, allowed)) { answers.set(c.key, { ...base, provenance: 'unresolved', reason: 'site-not-allowed' }); continue; }
        const own = lessons ? leaveOneOut(lessons, c.check, c.evidence.facts) : null;
        const picked = own ? lessonsFor(own, c.check, c.evidence.facts || c.evidence) : null;
        const { ai } = await askOne({
            model, entry: entryFor(c.check), finding: c.finding, occurrence: c.occurrence, evidence: c.evidence,
            lessons: picked, pageInfo: c.pageUrl ? { url: c.pageUrl } : null, mask, preview,
            minConfidence, deadline: Date.now() + seconds * 1000, base, outbox,
        });
        answers.set(c.key, ai);
        onProgress(i, cases.length);
    }
    return answers;
}

const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);

function markdown(result) {
    const lines = [`# Agreement of the AI with people's labels`, '', `${result.cases} labelled cases from ${result.reports.length} report(s); ${result.personUnsure} a person was unsure of are not scored.`, ''];
    if (result.skipped.notInRegistry || result.skipped.noEvidence || result.skipped.conflicting) {
        lines.push(`Left out: ${result.skipped.notInRegistry} not answerable by the AI, ${result.skipped.noEvidence} without the evidence the pass read, ${result.skipped.conflicting} labelled differently in two reports (the first kept).`, '');
    }
    for (const [name, run] of Object.entries(result.runs)) {
        lines.push(`## ${run.title}`, '', '| Check | Labelled | Agree | AI pass, person fail | AI fail, person pass | Unresolved | Agreement | Answered | Agreement when answered | Trusted |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        const rows = Object.entries(run.score.perCheck).sort(([a], [b]) => a.localeCompare(b));
        for (const [check, r] of [...rows, ['**Total**', run.score.total]]) {
            lines.push(`| ${check}${r.labelled && r.labelled < 30 && check !== '**Total**' ? ' (fewer than 30)' : ''} | ${r.labelled} | ${r.agree} | ${r.missedFail} | ${r.falseFail} | ${r.unresolved} | ${pct(r.agreement)} | ${pct(r.answered)} | ${pct(r.agreementWhenAnswered)} | ${check === '**Total**' ? '' : (r.trusted ? 'yes' : 'no')} |`);
        }
        lines.push('');
        if (name === 'recorded') lines.push('The answers the reports already hold, from the runs that made them.', '');
    }
    if (result.lessons) {
        lines.push('## The lessons', '', result.lessons.accepted
            ? `Accepted: with \`${result.lessons.file}\` the AI loses no agreement and adds no "pass" where a person said "fail".`
            : `Not accepted (\`${result.lessons.file}\`):`, '');
        for (const r of result.lessons.reasons) lines.push(`- ${r}`);
        lines.push('', 'Each case was asked without its own example in the lessons.', '');
    }
    lines.push(`Masking ${result.masking ? 'on' : 'off'}; ${result.sent} question(s) ${result.preview ? 'would be sent (a preview: nothing was sent)' : 'sent'}, each in ai-sent.json.`);
    return lines.join('\n') + '\n';
}

async function main(argv = process.argv.slice(2), env = process.env, out = console) {
    let opts;
    try { opts = parseArgs(argv); } catch (e) { out.error(e.message + '\n\n' + USAGE); return 2; }
    if (opts.help) { out.log(USAGE); return 0; }
    if (!opts.reports.length) { out.error(USAGE); return 2; }

    const reports = [];
    for (const file of opts.reports) {
        try { reports.push({ file, payload: await readReport(file) }); } catch (e) { out.error(`Could not read ${file}: ${e.message}`); return 2; }
    }
    let lessons = null;
    if (opts.lessons) {
        if (!fs.existsSync(opts.lessons)) { out.error(`No lessons file at ${opts.lessons}`); return 2; }
        lessons = loadLessons(opts.lessons);
    }
    const { cases, skipped } = await labelledCases(reports);
    const scored = cases.filter((c) => c.person !== 'unsure');
    if (!scored.length) { out.error('No labelled cases: answer some questions pass or fail in "Review AI answers", save the report, and give it here.'); return 2; }

    let model = null;
    if (!opts.preview) {
        try { model = resolveProvider(null, env); } catch (e) { out.error(e.message); return 2; }
        if (!model) { out.error('No model: set A11Y_AI_ENDPOINT or ANTHROPIC_API_KEY, or use --preview.'); return 2; }
        const calls = scored.length * (lessons ? 2 : 1);
        if (calls > opts.maxCalls) { out.error(`This needs ${calls} calls, more than --max-calls ${opts.maxCalls}. Raise it to go on.`); return 2; }
        out.log(`Asking ${scored.length} labelled case(s)${lessons ? ' twice, without and with the lessons' : ''}: ${calls} call(s) to ${model.destination || model.name}.`);
    }

    const outbox = [];
    const common = { model, env, preview: opts.preview, minConfidence: opts.minConfidence, seconds: opts.seconds, outbox };
    const runs = { recorded: { title: 'As recorded in the reports', score: score(cases, new Map(cases.map((c) => [c.key, c.recorded]))) } };
    const asked = {};
    if (!opts.preview) {
        asked.without = await askAll(cases, { ...common, lessons: null });
        runs.without = { title: `Asked again${lessons ? ', without lessons' : ''}`, score: score(cases, asked.without) };
    } else {
        await askAll(cases, { ...common, lessons: null });
    }
    if (lessons) {
        asked.with = await askAll(cases, { ...common, lessons });
        if (!opts.preview) runs.with = { title: 'Asked again, with the lessons', score: score(cases, asked.with) };
    }

    const judged = lessons && !opts.preview ? judgeLessons(runs.without.score, runs.with.score) : null;
    const result = {
        at: new Date().toISOString(),
        reports: opts.reports,
        cases: cases.length,
        personUnsure: cases.length - scored.length,
        skipped,
        model: model ? (model.model || model.name) : null,
        preview: opts.preview,
        masking: maskingOn(env),
        sent: outbox.length,
        runs,
        ...(judged ? { lessons: { file: opts.lessons, ...judged } } : {}),
        // Per case, for a person to look into the differences.
        perCase: cases.map((c) => ({
            check: c.check, page: c.pageUrl, selector: c.occurrence.target[0] || null, person: c.person, note: c.note,
            recorded: c.recorded && c.recorded.provenance === 'ai-supported' ? c.recorded.verdict : 'unresolved',
            ...(asked.without ? { without: answerWord(asked.without.get(c.key)) } : {}),
            ...(asked.with && !opts.preview ? { with: answerWord(asked.with.get(c.key)) } : {}),
        })),
    };

    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, 'agreement.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(opts.out, 'agreement.md'), markdown(result));
    fs.writeFileSync(path.join(opts.out, 'ai-sent.json'), JSON.stringify(outbox, null, 2));

    for (const run of Object.values(runs)) {
        const t = run.score.total;
        out.log(`${run.title.padEnd(34)} agree ${t.agree}/${t.labelled} (${pct(t.agreement)}), pass where a person said fail: ${t.missedFail}, unresolved: ${t.unresolved}`);
    }
    if (judged) {
        out.log(judged.accepted ? 'Lessons accepted.' : 'Lessons NOT accepted:');
        for (const r of judged.reasons) out.log('  ' + r);
    }
    out.log(`Written: ${path.join(opts.out, 'agreement.md')}, agreement.json, ai-sent.json (${outbox.length} ${opts.preview ? 'previewed' : 'sent'})`);
    return judged && !judged.accepted ? 1 : 0;
}

function answerWord(ai) {
    if (!ai) return null;
    return ai.provenance === 'ai-supported' ? ai.verdict : `unresolved (${ai.reason || 'unsure'})`;
}

if (require.main === module) {
    main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
}

module.exports = { main, parseArgs, labelledCases, leaveOneOut, score, judgeLessons, readReport };
