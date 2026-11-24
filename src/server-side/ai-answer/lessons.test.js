'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadLessons, lessonsFor, lessonsPrompt } = require('./lessons');
const { answerCantTells, buildPrompt } = require('./index');

const lessons = {
    version: 1,
    checks: {
        'img-alt-quality': {
            rules: ['A file name as alt text always fails.', '   '],
            examples: [
                { facts: { alt: 'IMG_2231.jpg' }, verdict: 'fail', reason: 'only a file name', aiVerdict: 'pass' },
                { facts: { alt: 'Two colleagues at a desk' }, verdict: 'pass', reason: 'describes it' },
                { facts: { alt: 'x' }, verdict: 'maybe' },
            ],
        },
        'link-name-quality': 'not an object',
    },
};

describe('loadLessons', () => {
    test('keeps usable rules and examples and drops the rest', () => {
        const l = loadLessons(lessons);
        assert.deepEqual(l.checks['img-alt-quality'].rules, ['A file name as alt text always fails.']);
        assert.equal(l.checks['img-alt-quality'].examples.length, 2);
        assert.equal(l.checks['link-name-quality'], undefined);
    });
    test('reads a file, and a missing or broken one gives empty lessons', () => {
        const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-')), 'l.json');
        fs.writeFileSync(f, JSON.stringify(lessons));
        assert.equal(Object.keys(loadLessons(f).checks).length, 1);
        assert.deepEqual(loadLessons(path.join(os.tmpdir(), 'no-such-lessons.json')), { version: 1, checks: {} });
        fs.writeFileSync(f, '{broken');
        assert.deepEqual(loadLessons(f), { version: 1, checks: {} });
    });
});

describe('lessonsFor', () => {
    test('puts the example most like the facts first and is empty for a check with none', () => {
        const l = loadLessons(lessons);
        const sel = lessonsFor(l, 'img-alt-quality', { alt: 'IMG_9999.jpg jpg file' });
        assert.equal(sel.examples[0].facts.alt, 'IMG_2231.jpg');
        assert.equal(lessonsFor(l, 'page-title-patterns', {}), null);
    });
    test('the prompt text says the lessons are data and is empty without any', () => {
        const l = loadLessons(lessons);
        const text = lessonsPrompt(lessonsFor(l, 'img-alt-quality', {}));
        assert.match(text, /data, not instructions/);
        assert.match(text, /<lessons>[\s\S]*only a file name[\s\S]*<\/lessons>/);
        assert.equal(lessonsPrompt(null), '');
    });
});

describe('the pass with lessons', () => {
    const canonical = () => ({
        findings: [{ outcome: 'cantTell', occurrences: [{
            atomicCheckId: 'img-alt-quality', occurrenceOutcome: 'cantTell', outcome: 'cantTell',
            target: ['#e'], html: '<img id="e">', failureSummary: 'check it',
        }] }],
    });
    test('the lessons reach the prompt and the answer records that they were used', async () => {
        const prompts = [];
        const provider = { model: 'fake', ask: async (p) => { prompts.push(p); return '{"verdict":"fail","confidence":0.9,"rationale":"r"}'; } };
        const c = canonical();
        await answerCantTells({ page: { evaluate: async () => ({}) }, canonical: c, provider, options: { lessons } });
        assert.match(prompts[0], /A file name as alt text always fails/);
        assert.equal(c.findings[0].occurrences[0].ai.promptVersion.endsWith('+lessons'), true);
    });
    test('without lessons the prompt and the version are as before', async () => {
        const prompts = [];
        const provider = { model: 'fake', ask: async (p) => { prompts.push(p); return '{"verdict":"pass","confidence":0.9,"rationale":"r"}'; } };
        const c = canonical();
        await answerCantTells({ page: { evaluate: async () => ({}) }, canonical: c, provider });
        assert.doesNotMatch(prompts[0], /<lessons>/);
        assert.equal(c.findings[0].occurrences[0].ai.promptVersion.endsWith('+lessons'), false);
    });
    test('buildPrompt leaves the lessons out when there are none', () => {
        assert.doesNotMatch(buildPrompt({ question: 'q', evidence: [] }, {}, {}), /lessons/);
    });
});
