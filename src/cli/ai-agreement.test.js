'use strict';

// The re-run of labelled cases (ai-agreement.js): which cases count, how
// agreement is scored, when lessons are accepted, and whole runs against a
// local endpoint.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

const { main, labelledCases, leaveOneOut, score, judgeLessons } = require('./ai-agreement');

let keyOf;
before(async () => {
    const view = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'ai-answer-view.js')).href);
    keyOf = (check, html, sel) => view.aiReviewKey({ sourceAtomicRules: [check], html, target: [sel] });
});

// A report with image questions: [alt, person's verdict, the AI's recorded verdict].
function report(items, extra = {}) {
    const occ = items.map(([alt, , ai], i) => ({
        atomicCheckId: 'img-alt-quality', html: `<img id="i${i}" alt="${alt}">`, target: [`#i${i}`], pageUrls: ['https://shop.example/p'],
        failureSummary: 'Check the alt text',
        ai: { verdict: ai, confidence: 0.9, provenance: 'ai-supported', check: 'img-alt-quality', evidence: { facts: { alt } } },
    }));
    const aiReview = {};
    items.forEach(([alt, person], i) => { if (person) aiReview[keyOf('img-alt-quality', `<img id="i${i}" alt="${alt}">`, `#i${i}`)] = { verdict: person, note: person === 'fail' ? 'a file name' : '' }; });
    return { reportVersion: 4, runId: 'r', url: 'https://shop.example/', timestamp: 't', scans: [{ id: 's1', url: 'https://shop.example/p', label: 'P', canonical: { findings: [{ id: 'f', outcome: 'cantTell', wcag: { sc: ['1.1.1'] }, occurrences: occ }] } }], aiReview, ...extra };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agreement-'));
const write = (dir, name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(data)); return f; };
const quiet = { log: () => {}, error: () => {} };

describe('labelledCases', () => {
    test('one case per question a person answered, unsure kept apart, conflicts and missing evidence counted', async () => {
        const a = report([['IMG_1.jpg', 'fail', 'pass'], ['Red shoes', 'pass', 'pass'], ['Blue bag', 'unsure', 'pass'], ['x', null, 'pass']]);
        const b = report([['IMG_1.jpg', 'pass', 'pass']]);
        delete a.scans[0].canonical.findings[0].occurrences[1].ai.evidence;
        const { cases, skipped } = await labelledCases([{ file: 'a', payload: a }, { file: 'b', payload: b }]);
        assert.deepEqual(cases.map((c) => [c.evidence.facts.alt, c.person]), [['IMG_1.jpg', 'fail'], ['Blue bag', 'unsure']]);
        assert.deepEqual(skipped, { notInRegistry: 0, noEvidence: 1, conflicting: 1 });
        assert.equal(cases[0].evidence.element, '<img id="i0" alt="IMG_1.jpg">', 'the element\'s HTML, as the pass had it');
    });
});

describe('score', () => {
    test('counts agreement, a pass where a person said fail, a fail where they said pass, and no answer', () => {
        const cases = [['a', 'fail'], ['b', 'fail'], ['c', 'pass'], ['d', 'pass'], ['e', 'unsure']].map(([key, person]) => ({ key, person, check: 'k' }));
        const ok = (verdict) => ({ provenance: 'ai-supported', verdict });
        const s = score(cases, new Map([['a', ok('fail')], ['b', ok('pass')], ['c', ok('fail')], ['d', { provenance: 'unresolved', reason: 'unsure' }], ['e', ok('pass')]]));
        assert.deepEqual(
            (({ labelled, personUnsure, agree, missedFail, falseFail, unresolved }) => ({ labelled, personUnsure, agree, missedFail, falseFail, unresolved }))(s.total),
            { labelled: 4, personUnsure: 1, agree: 1, missedFail: 1, falseFail: 1, unresolved: 1 });
        assert.equal(s.total.agreement, 0.25);
        assert.equal(s.total.answered, 0.75);
        assert.equal(s.perCheck.k.agree, 1);
    });
});

describe('leaveOneOut and judgeLessons', () => {
    test('a case is never asked with its own example', () => {
        const lessons = { version: 1, checks: { k: { rules: ['r'], examples: [{ facts: { alt: 'a' }, verdict: 'fail', reason: 'x' }, { facts: { alt: 'b' }, verdict: 'pass', reason: 'y' }] } } };
        assert.deepEqual(leaveOneOut(lessons, 'k', { alt: 'a' }).checks.k.examples.map((e) => e.facts.alt), ['b']);
        assert.equal(leaveOneOut(lessons, 'k', { alt: 'z' }), lessons);
        assert.equal(lessons.checks.k.examples.length, 2, 'the lessons themselves are left alone');
    });

    test('lessons are accepted only if they lose no agreement and add no missed fail, in total and per check', () => {
        const s = (agree, missedFail, other = { agree: 1, missedFail: 0 }) => ({ total: { agree, missedFail }, perCheck: { a: { agree, missedFail }, b: other } });
        assert.deepEqual(judgeLessons(s(3, 1), s(4, 0)), { accepted: true, reasons: [] });
        assert.equal(judgeLessons(s(3, 1), s(4, 2)).accepted, false);
        const worseInOne = judgeLessons(s(3, 0), { total: { agree: 4, missedFail: 0 }, perCheck: { a: { agree: 4, missedFail: 0 }, b: { agree: 0, missedFail: 0 } } });
        assert.equal(worseInOne.accepted, false);
        assert.match(worseInOne.reasons.join(), /^b: 1 fewer agreements/);
    });
});

describe('main, against an endpoint', () => {
    let server;
    let base;
    let calls = 0;
    // Says fail for a file name only when a lesson tells it to; "trusting"
    // lessons say pass to everything.
    before(async () => {
        server = http.createServer((req, res) => {
            let data = '';
            req.on('data', (c) => { data += c; });
            req.on('end', () => {
                calls++;
                const q = JSON.parse(data);
                const alt = (q.evidence && q.evidence.facts && q.evidence.facts.alt) || '';
                const rules = (q.lessons && q.lessons.rules) || [];
                const verdict = rules.some((r) => /file name/.test(r)) && /\.jpg$/.test(alt) ? 'fail'
                    : rules.some((r) => /trust/.test(r)) ? 'pass'
                    : /\.jpg$/.test(alt) ? 'pass' : (alt === 'Blue bag' ? 'fail' : 'pass');
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ verdict, confidence: 0.9, rationale: 'test', answeredBy: { name: 'test agent', version: '1' } }));
            });
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${server.address().port}/answer`;
    });
    after(() => new Promise((r) => server.close(r)));

    const items = [['IMG_1.jpg', 'fail', 'pass'], ['IMG_2.jpg', 'fail', 'pass'], ['Red shoes', 'pass', 'pass'], ['Blue bag', 'fail', 'fail'], ['Green hat', 'unsure', 'pass']];

    test('lessons that help are accepted, and every question sent is logged', async () => {
        const dir = tmp();
        const file = write(dir, 'r.a11y-report.json', report(items));
        const lessons = write(dir, 'ai-lessons.json', { version: 1, checks: { 'img-alt-quality': { rules: ['A file name is never alt text.'], examples: [] } } });
        const out = path.join(dir, 'out');
        calls = 0;
        const code = await main([file, '--lessons', lessons, '--out', out], { A11Y_AI_ENDPOINT: base }, quiet);
        assert.equal(code, 0);
        assert.equal(calls, 8, 'four scored cases, twice');
        const result = JSON.parse(fs.readFileSync(path.join(out, 'agreement.json'), 'utf8'));
        assert.deepEqual([result.runs.recorded.score.total.agree, result.runs.without.score.total.agree, result.runs.with.score.total.agree], [2, 2, 4]);
        assert.deepEqual([result.runs.without.score.total.missedFail, result.runs.with.score.total.missedFail], [2, 0]);
        assert.equal(result.lessons.accepted, true);
        assert.equal(result.personUnsure, 1);
        assert.equal(result.perCase[0].with, 'fail');
        assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'ai-sent.json'), 'utf8')).length, 8);
        assert.match(fs.readFileSync(path.join(out, 'agreement.md'), 'utf8'), /Accepted/);
    });

    test('lessons that add a pass where a person said fail are refused, with exit code 1', async () => {
        const dir = tmp();
        const file = write(dir, 'r.a11y-report.json', report(items));
        const lessons = write(dir, 'ai-lessons.json', { version: 1, checks: { 'img-alt-quality': { rules: ['Always trust the alt text.'], examples: [] } } });
        const code = await main([file, '--lessons', lessons, '--out', path.join(dir, 'out')], { A11Y_AI_ENDPOINT: base }, quiet);
        assert.equal(code, 1);
        const result = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'agreement.json'), 'utf8'));
        assert.equal(result.lessons.accepted, false);
        assert.match(result.lessons.reasons.join('\n'), /more "pass" where a person said "fail"/);
    });

    test('a preview sends nothing and needs no model; too many calls stop it before it starts', async () => {
        const dir = tmp();
        const file = write(dir, 'r.a11y-report.json', report(items));
        calls = 0;
        assert.equal(await main([file, '--preview', '--out', path.join(dir, 'p')], {}, quiet), 0);
        assert.equal(calls, 0);
        const sent = JSON.parse(fs.readFileSync(path.join(dir, 'p', 'ai-sent.json'), 'utf8'));
        assert.deepEqual([sent.length, sent[0].mode], [4, 'preview']);
        assert.equal(await main([file, '--max-calls', '3', '--out', path.join(dir, 'q')], { A11Y_AI_ENDPOINT: base }, quiet), 2);
        assert.equal(calls, 0);
        assert.equal(await main([file, '--out', path.join(dir, 'r')], {}, quiet), 2, 'no model and no preview');
    });
});
