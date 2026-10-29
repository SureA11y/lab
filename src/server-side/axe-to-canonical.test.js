'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { CANON_VERSION } = require('../shared/canonical-shared');
const { fromAxeResults } = require('./axe-to-canonical');

function axeItem(overrides = {}) {
    return {
        id: 'color-contrast',
        impact: 'serious',
        help: 'Elements must have sufficient color contrast',
        description: 'Ensures contrast ratio meets WCAG 2 AA',
        helpUrl: 'https://dequeuniversity.com/rules/axe/color-contrast',
        tags: ['wcag2aa', 'wcag143', 'cat.color'],
        nodes: [{ target: ['.btn'], html: '<button class="btn">Buy</button>', failureSummary: 'Fix contrast' }],
        ...overrides
    };
}

describe('fromAxeResults: category -> outcome mapping', () => {
    test('violations -> fail, incomplete -> cantTell, passes -> pass, inapplicable -> notApplicable', () => {
        const collected = {
            violations: [axeItem({ id: 'a' })],
            incomplete: [axeItem({ id: 'b' })],
            passes: [axeItem({ id: 'c' })],
            inapplicable: [axeItem({ id: 'd' })]
        };
        const out = fromAxeResults(collected);
        const byId = Object.fromEntries(out.findings.map(f => [f.id, f.outcome]));
        assert.equal(byId.a, 'fail');
        assert.equal(byId.b, 'cantTell');
        assert.equal(byId.c, 'pass');
        assert.equal(byId.d, 'notApplicable');
    });

    test('missing category arrays are treated as empty, producing no findings and zero counts', () => {
        const out = fromAxeResults({});
        assert.deepEqual(out.findings, []);
        assert.deepEqual(out.summary.outcomes, { fail: 0, cantTell: 0, pass: 0, notApplicable: 0 });
    });

    test('an item with no id (empty ruleId) is skipped entirely', () => {
        const out = fromAxeResults({ violations: [axeItem({ id: '' }), axeItem({ id: 'real' })] });
        assert.equal(out.findings.length, 1);
        assert.equal(out.findings[0].id, 'real');
    });

    test('summary.outcomes counts the requirements\' findings, and summary.bestPractices the best practices\'', () => {
        const out = fromAxeResults({
            violations: [axeItem({ id: '' }), axeItem({ id: 'real' }), axeItem({ id: 'region', tags: ['cat.keyboard', 'best-practice'] })],
            passes: [axeItem({ id: 'landmark-one-main', tags: ['best-practice'] })]
        });
        assert.deepEqual(out.summary.outcomes, { fail: 1, cantTell: 0, pass: 0, notApplicable: 0 });
        assert.deepEqual(out.summary.bestPractices, { fail: 1, cantTell: 0, pass: 1, notApplicable: 0 });
        assert.equal(out.findings.find((f) => f.ruleId === 'region').bestPractice, true);
        assert.equal('bestPractice' in out.findings.find((f) => f.ruleId === 'real'), false);
    });
});

describe('fromAxeResults: severity normalization', () => {
    for (const impact of ['critical', 'serious', 'moderate', 'minor']) {
        test(`impact "${impact}" maps to itself`, () => {
            const out = fromAxeResults({ violations: [axeItem({ impact })] });
            assert.equal(out.findings[0].severity, impact);
        });
    }

    test('impact is case-insensitive', () => {
        const out = fromAxeResults({ violations: [axeItem({ impact: 'CRITICAL' })] });
        assert.equal(out.findings[0].severity, 'critical');
    });

    test('missing/unknown impact maps to "unknown"', () => {
        const out = fromAxeResults({ violations: [axeItem({ impact: undefined })] });
        assert.equal(out.findings[0].severity, 'unknown');

        const out2 = fromAxeResults({ violations: [axeItem({ impact: 'nonsense' })] });
        assert.equal(out2.findings[0].severity, 'unknown');
    });
});

describe('fromAxeResults: WCAG tag parsing', () => {
    test('parses "wcagNNN" tags into dotted SC refs', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['wcag143'] })] });
        assert.deepEqual(out.findings[0].standards.wcag, [{ ref: '1.4.3', level: null }]);
    });

    test('non-wcag tags are preserved in standards.tags, wcag refs are not duplicated there', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['wcag143', 'cat.color', 'best-practice'] })] });
        assert.deepEqual(out.findings[0].standards.tags, ['cat.color', 'best-practice']);
    });

    test('derives wcagLevel A from a wcag2a-style tag', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['wcag2a'] })] });
        assert.equal(out.findings[0].standards.wcagLevel, 'A');
    });

    test('derives wcagLevel AA from a wcag2aa-style tag (also matches wcag21aa/wcag22aa)', () => {
        assert.equal(fromAxeResults({ violations: [axeItem({ tags: ['wcag2aa'] })] }).findings[0].standards.wcagLevel, 'AA');
        assert.equal(fromAxeResults({ violations: [axeItem({ tags: ['wcag21aa'] })] }).findings[0].standards.wcagLevel, 'AA');
        assert.equal(fromAxeResults({ violations: [axeItem({ tags: ['wcag22aa'] })] }).findings[0].standards.wcagLevel, 'AA');
    });

    test('derives wcagLevel AAA and prefers it when multiple levels are present', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['wcag2a', 'wcag2aa', 'wcag2aaa'] })] });
        assert.equal(out.findings[0].standards.wcagLevel, 'AAA');
    });

    test('no wcag-shaped tags at all -> wcagLevel is null', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['best-practice'] })] });
        assert.equal(out.findings[0].standards.wcagLevel, null);
    });

    test('missing tags array is treated as empty (no crash)', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: undefined })] });
        assert.deepEqual(out.findings[0].standards.wcag, []);
        assert.equal(out.findings[0].standards.wcagLevel, null);
    });

    test('two-digit criterion tags keep the criterion together', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['wcag1410'] })] });
        assert.deepEqual(out.findings[0].standards.wcag, [{ ref: '1.4.10', level: null }]);
    });
});

describe('fromAxeResults: wcag.sc', () => {
    test('prefers item.SC when present', () => {
        const out = fromAxeResults({ violations: [axeItem({ SC: ['1.4.3', '2.1.1'] })] });
        assert.deepEqual(out.findings[0].wcag.sc, ['1.4.3', '2.1.1']);
    });

    test('falls back to refs derived from tags when item.SC is absent', () => {
        const out = fromAxeResults({ violations: [axeItem({ tags: ['wcag143'], SC: undefined })] });
        assert.deepEqual(out.findings[0].wcag.sc, ['1.4.3']);
    });
});

describe('fromAxeResults: title/description/helpUrl', () => {
    test('title prefers help, falls back to description, then null', () => {
        assert.equal(fromAxeResults({ violations: [axeItem({ help: 'H', description: 'D' })] }).findings[0].title, 'H');
        assert.equal(fromAxeResults({ violations: [axeItem({ help: undefined, description: 'D' })] }).findings[0].title, 'D');
        assert.equal(fromAxeResults({ violations: [axeItem({ help: undefined, description: undefined })] }).findings[0].title, null);
    });

    test('description and helpUrl default to null when absent/non-string', () => {
        const out = fromAxeResults({ violations: [axeItem({ description: undefined, helpUrl: 42 })] });
        assert.equal(out.findings[0].description, null);
        assert.equal(out.findings[0].helpUrl, null);
    });
});

describe('fromAxeResults: occurrences', () => {
    test('one occurrence per node, with target normalized to an array', () => {
        const out = fromAxeResults({
            violations: [axeItem({
                nodes: [
                    { target: ['.a', '.b'], html: '<div>a</div>' },
                    { target: '.single-string-target', html: '<div>b</div>' }
                ]
            })]
        });
        const [occ1, occ2] = out.findings[0].occurrences;
        assert.deepEqual(occ1.target, ['.a', '.b']);
        assert.deepEqual(occ2.target, ['.single-string-target']);
    });

    test('missing target defaults to an empty array', () => {
        const out = fromAxeResults({ violations: [axeItem({ nodes: [{ html: '<div>x</div>' }] })] });
        assert.deepEqual(out.findings[0].occurrences[0].target, []);
    });

    test('html defaults to null when not a string', () => {
        const out = fromAxeResults({ violations: [axeItem({ nodes: [{ target: ['.a'], html: undefined }] })] });
        assert.equal(out.findings[0].occurrences[0].html, null);
    });

    test('failureSummary and summary are both populated from node.failureSummary (currently duplicated)', () => {
        const out = fromAxeResults({
            violations: [axeItem({ nodes: [{ target: ['.a'], failureSummary: 'Fix this' }] })]
        });
        assert.equal(out.findings[0].occurrences[0].failureSummary, 'Fix this');
        assert.equal(out.findings[0].occurrences[0].summary, 'Fix this');
    });

    test('evidence.engineNode carries the raw node object through', () => {
        const node = { target: ['.a'], html: '<div>x</div>', custom: 'field' };
        const out = fromAxeResults({ violations: [axeItem({ nodes: [node] })] });
        assert.equal(out.findings[0].occurrences[0].evidence.engineNode, node);
    });

    test('occurrence uid is deterministic for identical inputs and differs when the target differs', () => {
        const makeOut = (target) => fromAxeResults({
            violations: [axeItem({ nodes: [{ target, html: '<div>x</div>' }] })]
        }).findings[0].occurrences[0].uid;

        const uidA1 = makeOut(['.a']);
        const uidA2 = makeOut(['.a']);
        const uidB = makeOut(['.b']);

        assert.equal(uidA1, uidA2);
        assert.notEqual(uidA1, uidB);
    });

    test('an item with no nodes produces zero occurrences, not a crash', () => {
        const out = fromAxeResults({ violations: [axeItem({ nodes: [] })] });
        assert.deepEqual(out.findings[0].occurrences, []);
    });

    test('a node-level url/pageUrl overrides the top-level page url for that occurrence', () => {
        const out = fromAxeResults(
            { violations: [axeItem({ nodes: [{ target: ['.a'], url: 'https://other.example/' }] })] },
            { page: { url: 'https://main.example/' } }
        );
        assert.equal(out.findings[0].occurrences[0].pageUrl, 'https://other.example/');
        assert.equal(out.page.url, 'https://main.example/');
    });
});

describe('fromAxeResults: finding uid', () => {
    test('is composed from engine id, outcome, and ruleId', () => {
        const out = fromAxeResults(
            { violations: [axeItem({ id: 'color-contrast' })] },
            { engine: { id: 'axe' } }
        );
        assert.equal(out.findings[0].uid, 'axe:fail:color-contrast');
    });

    test('defaults engine id to "axe" when meta.engine is not provided', () => {
        const out = fromAxeResults({ violations: [axeItem()] });
        assert.equal(out.findings[0].uid, 'axe:fail:color-contrast');
        assert.equal(out.engine.id, 'axe');
    });
});

describe('fromAxeResults: page/scope/runOptions/diagnostics defaults and overrides', () => {
    test('page.url falls back to collectedScans.url, then null', () => {
        assert.equal(fromAxeResults({ url: 'https://scan.example/' }).page.url, 'https://scan.example/');
        assert.equal(fromAxeResults({}).page.url, null);
        assert.equal(fromAxeResults({}, { page: { url: 'https://meta.example/' } }).page.url, 'https://meta.example/');
    });

    test('page.timestamp defaults to an ISO string when not provided', () => {
        const out = fromAxeResults({});
        assert.match(out.page.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    });

    test('page.timestamp uses meta.page.timestamp verbatim when provided', () => {
        const out = fromAxeResults({}, { page: { timestamp: '2020-01-01T00:00:00.000Z' } });
        assert.equal(out.page.timestamp, '2020-01-01T00:00:00.000Z');
    });

    test('scope.include defaults to ["html"], scope.exclude defaults to []', () => {
        const out = fromAxeResults({});
        assert.deepEqual(out.scope.include, ['html']);
        assert.deepEqual(out.scope.exclude, []);
    });

    test('scope.include/exclude accept a comma-separated string or an array', () => {
        const out1 = fromAxeResults({}, { scope: { include: 'a, b ,c', exclude: '.x' } });
        assert.deepEqual(out1.scope.include, ['a', 'b', 'c']);
        assert.deepEqual(out1.scope.exclude, ['.x']);

        const out2 = fromAxeResults({}, { scope: { include: ['a', ' b '] } });
        assert.deepEqual(out2.scope.include, ['a', 'b']);
    });

    test('scope.include/exclude of a non-array, non-string, truthy value (e.g. a number) normalizes to []', () => {
        const out = fromAxeResults({}, { scope: { include: 42, exclude: { not: 'a list' } } });
        assert.deepEqual(out.scope.include, []);
        assert.deepEqual(out.scope.exclude, []);
    });

    test('runOptions defaults are empty/false, and pass through when provided', () => {
        const out = fromAxeResults({}, {
            runOptions: {
                standardTags: ['wcag2aa'],
                includeBestPractice: true,
                resultTypes: ['violations'],
                engineOptions: { foo: 'bar' }
            }
        });
        assert.deepEqual(out.runOptions.standardTags, ['wcag2aa']);
        assert.equal(out.runOptions.includeBestPractice, true);
        assert.deepEqual(out.runOptions.resultTypes, ['violations']);
        assert.deepEqual(out.runOptions.engineOptions, { foo: 'bar' });

        const defaults = fromAxeResults({});
        assert.deepEqual(defaults.runOptions.standardTags, []);
        assert.equal(defaults.runOptions.includeBestPractice, false);
        assert.deepEqual(defaults.runOptions.resultTypes, []);
        assert.deepEqual(defaults.runOptions.engineOptions, {});
    });

    test('diagnostics defaults to zeroed/empty, non-finite durationMs/estimatedNodes are ignored', () => {
        const defaults = fromAxeResults({});
        assert.deepEqual(defaults.diagnostics, { durationMs: 0, estimatedNodes: 0, warnings: [], errors: [] });

        const withBadValues = fromAxeResults({}, { diagnostics: { durationMs: 'not-a-number', estimatedNodes: NaN } });
        assert.equal(withBadValues.diagnostics.durationMs, 0);
        assert.equal(withBadValues.diagnostics.estimatedNodes, 0);

        const withGoodValues = fromAxeResults({}, { diagnostics: { durationMs: 1234, estimatedNodes: 56, warnings: ['w'], errors: ['e'] } });
        assert.deepEqual(withGoodValues.diagnostics, { durationMs: 1234, estimatedNodes: 56, warnings: ['w'], errors: ['e'] });
    });

    test('rules passes through collectedScans.rules verbatim, defaulting to []', () => {
        assert.deepEqual(fromAxeResults({}).rules, []);
        const rules = [{ id: 'x' }];
        assert.equal(fromAxeResults({ rules }).rules, rules);
    });

    test('version is always CANON_VERSION', () => {
        assert.equal(fromAxeResults({}).version, CANON_VERSION);
    });
});
