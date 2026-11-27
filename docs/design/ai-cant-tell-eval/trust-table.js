'use strict';

// Which checks the AI is trusted on (the user's decision 8, 2026-11-27): at
// least 30 labelled real cases, at least 95% agreement on the answers it
// gave, and no "pass" where the label is "fail". Summed over the real-site
// runs of this folder, one run per set of pages (re-runs of the same pages
// left out), the demo not counted. Writes trust.md.
//
//   node docs/design/ai-cant-tell-eval/trust-table.js
//
// Two kinds of run: the earlier ones keep ai:agreement's table
// (agreement.md, labels by review key); the later ones keep labels by
// question id (labels.json) beside questions.jsonl and answers.jsonl, scored
// here as ai:agreement scores (an answer counts when it is not "unsure" and
// its confidence is 0.6 or more).

const fs = require('fs');
const path = require('path');

const MIN_CASES = 30;
const MIN_AGREEMENT = 0.95;
const MIN_CONFIDENCE = 0.6;

// From ai:agreement's tables (the first, "as recorded").
const TABLE_RUNS = ['w3c-bad', 'uw-au', 'govuk-audit', 'govuk-audit-more', 'wai-tutorials', 'apg-open'];
// Labelled by question id.
const QUESTION_RUNS = ['svg-w3c', 'image-buttons', 'media-alt', 'names-labels', 'structure', 'walk-lane-walk', 'measure-lane-exact'];
// Left out as re-runs of pages counted above: govuk-open (the GOV.UK keyboard
// pages again, with the open walk), walk-lane-read (the same elements as
// walk-lane-walk, without the walk), measure-lane (the same cases as
// measure-lane-exact, measured by colour), w3c-pictures (the W3C pages of
// w3c-bad again, the picture questions with pictures).

// The labels of the GOV.UK runs were re-read by WCAG's reading (decision 7)
// after their tables were written: the changes, by check, to apply to them.
const CORRECTIONS = {
    'govuk-audit': {
        // "Click here" in its sentence and the search field labelled by its
        // button: labelled fail, answered pass; now labelled pass.
        'link-name-quality': { agree: 1, missedFail: -1 },
        'form-control-programmatic-label-quality': { agree: 1, missedFail: -1 },
    },
    'govuk-audit-more': {
        // Labels unsure before, pass now; the AI left them open.
        keyboard: { labelled: 2, unresolved: 2 },
        'focus-order': { labelled: 1, unresolved: 1 },
    },
};

const here = __dirname;
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const jsonl = (f) => read(f).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const empty = () => ({ labelled: 0, agree: 0, missedFail: 0, falseFail: 0, unresolved: 0, runs: new Set() });

function fromTable(run, totals) {
    const md = read(path.join(run, 'agreement.md'));
    const table = md.slice(md.indexOf('| Check |'));
    const rows = table.split('\n').slice(2).filter((l) => l.startsWith('|') && !l.includes('**Total**'));
    for (const r of rows) {
        const cells = r.split('|').map((c) => c.trim());
        const check = cells[1].replace(/ \(fewer than 30\)$/, '');
        if (!check || check.startsWith('---')) break;
        const [labelled, agree, missedFail, falseFail, unresolved] = cells.slice(2, 7).map(Number);
        const row = totals[check] || (totals[check] = empty());
        const fix = (CORRECTIONS[run] || {})[check] || {};
        row.labelled += labelled + (fix.labelled || 0);
        row.agree += agree + (fix.agree || 0);
        row.missedFail += missedFail + (fix.missedFail || 0);
        row.falseFail += falseFail + (fix.falseFail || 0);
        row.unresolved += unresolved + (fix.unresolved || 0);
        row.runs.add(run);
    }
}

function fromQuestions(run, totals) {
    const labels = JSON.parse(read(path.join(run, 'labels.json')));
    const checkOf = Object.fromEntries(jsonl(path.join(run, 'questions.jsonl')).map((q) => [q.id, q.check]));
    for (const a of jsonl(path.join(run, 'answers.jsonl'))) {
        const label = labels[a.id];
        const check = checkOf[a.id];
        if (!label || label === 'unsure' || !check) continue;
        const row = totals[check] || (totals[check] = empty());
        row.runs.add(run);
        row.labelled++;
        const verdict = a.verdict !== 'unsure' && Number(a.confidence) >= MIN_CONFIDENCE ? a.verdict : null;
        if (!verdict) row.unresolved++;
        else if (verdict === label) row.agree++;
        else if (verdict === 'pass') row.missedFail++;
        else row.falseFail++;
    }
}

function trustTable() {
    const totals = {};
    for (const run of TABLE_RUNS) fromTable(run, totals);
    for (const run of QUESTION_RUNS) fromQuestions(run, totals);
    return Object.entries(totals).map(([check, r]) => {
        const answered = r.labelled - r.unresolved;
        const whenAnswered = answered ? r.agree / answered : null;
        const trusted = r.labelled >= MIN_CASES && whenAnswered !== null && whenAnswered >= MIN_AGREEMENT && r.missedFail === 0;
        const why = trusted ? '' : [r.labelled < MIN_CASES ? `${r.labelled} of ${MIN_CASES} cases` : '', whenAnswered !== null && whenAnswered < MIN_AGREEMENT ? 'agreement below 95%' : '', r.missedFail ? `${r.missedFail} wrong pass` : '', whenAnswered === null ? 'never answered' : ''].filter(Boolean).join(', ');
        return { check, ...r, runs: [...r.runs].sort(), answered, whenAnswered, trusted, why };
    }).sort((a, b) => (b.trusted - a.trusted) || (b.labelled - a.labelled) || a.check.localeCompare(b.check));
}

function markdown(rows) {
    const pct = (x) => (x === null ? '-' : Math.round(x * 100) + '%');
    const lines = [
        '# Which checks the AI is trusted on',
        '',
        'Generated by `node docs/design/ai-cant-tell-eval/trust-table.js`. A check is',
        `trusted (decision 8) with at least ${MIN_CASES} labelled real cases, at least`,
        `${MIN_AGREEMENT * 100}% agreement on the answers the AI gave, and no "pass" where the label is`,
        '"fail". Real-site runs only, one per set of pages; labels are the',
        "assistant's, not a person's, so trust here is provisional until a person",
        'labels the runs. Until a check is trusted its answers stay suggestions.',
        'A check the AI may only fail (`keyboard`, `keyboard-element`) is trusted for',
        'its fails only, and on the answers it gave: few for keyboard.',
        '',
        '| Check | Trusted | Labelled | Answered | Agree | Wrong pass | Wrong fail | Agreement when answered | Why not | Runs |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...rows.map((r) => `| \`${r.check}\` | ${r.trusted ? '**yes**' : 'no'} | ${r.labelled} | ${r.answered} | ${r.agree} | ${r.missedFail} | ${r.falseFail} | ${pct(r.whenAnswered)} | ${r.why} | ${r.runs.join(', ')} |`),
        '',
    ];
    return lines.join('\n');
}

if (require.main === module) {
    const rows = trustTable();
    fs.writeFileSync(path.join(here, 'trust.md'), markdown(rows));
    console.log(`${rows.filter((r) => r.trusted).length} of ${rows.length} checks trusted; trust.md written`);
}

module.exports = { trustTable, markdown, MIN_CASES, MIN_AGREEMENT };
