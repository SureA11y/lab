'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSeverity, engineVersion, runOnPage } = require('./a11y-labs-engine');

// A core release may hold rules only one standard requires (RGAA's), which it
// keeps off unless asked and the lab never asks for. The tests that those
// stay off need such a release, and skip with any other.
const CORE_HAS_GATED_RULES = require('@surea11y/core').getChecksCatalog().some((r) => (r.tags || []).includes('rgaa'));
const NEEDS_GATED_RULES = { skip: CORE_HAS_GATED_RULES ? false : 'this core release keeps no rules off' };

describe('a11y-labs-engine: engineVersion', () => {
    test('is read from the installed @surea11y/core package, not a hardcoded constant', () => {
        const installedVersion = require('@surea11y/core/package.json').version;
        assert.equal(engineVersion, installedVersion);
    });
});

describe('a11y-labs-engine: locale defaults', () => {
    test('defaults engineOptions.locale to "en" when not provided', async () => {
        let evaluateArgs = null;
        const fakePage = {
            url: async () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async (...args) => {
                evaluateArgs = args;
                return { url: 'https://example.test/', title: 'Example', timestamp: null, checksResults: [], rulesResults: [] };
            }
        };

        await runOnPage(fakePage, {
            runOnly: { includeRuleIds: ['aria-hidden-focus'] },
            engineOptions: {}
        });

        assert.equal(evaluateArgs[3]?.locale, 'en');
    });

    test('keeps a provided engineOptions.locale value', async () => {
        let evaluateArgs = null;
        const fakePage = {
            url: async () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async (...args) => {
                evaluateArgs = args;
                return { url: 'https://example.test/', title: 'Example', timestamp: null, checksResults: [], rulesResults: [] };
            }
        };

        await runOnPage(fakePage, {
            runOnly: { includeRuleIds: ['aria-hidden-focus'] },
            engineOptions: { locale: 'fr' }
        });

        assert.equal(evaluateArgs[3]?.locale, 'fr');
    });
});

describe('a11y-labs-engine: runOnly handed to core', () => {
    test('turns include tags into rule ids and leaves the includeTags key out', async () => {
        let evaluateArgs = null;
        const fakePage = {
            url: async () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async (...args) => {
                evaluateArgs = args;
                return { url: 'https://example.test/', title: 'Example', timestamp: null, checksResults: [], rulesResults: [] };
            }
        };

        await runOnPage(fakePage, { runOnly: { includeTags: ['forms'] }, engineOptions: {} });

        const runOnly = evaluateArgs[4];
        assert.equal('includeTags' in runOnly, false);
        assert.ok(runOnly.includeRuleIds.length > 0);
    });
});

describe('a11y-labs-engine: normalizeSeverity', () => {
    test('canonical spellings pass through unchanged', () => {
        for (const s of ['critical', 'serious', 'moderate', 'minor', 'info']) {
            assert.equal(normalizeSeverity(s), s);
        }
    });

    test('alias spellings are mapped to their canonical equivalent (matching canonical-shared.js)', () => {
        assert.equal(normalizeSeverity('severe'), 'serious');
        assert.equal(normalizeSeverity('low'), 'minor');
        assert.equal(normalizeSeverity('medium'), 'moderate');
        assert.equal(normalizeSeverity('informational'), 'info');
    });

    test('is case-insensitive', () => {
        assert.equal(normalizeSeverity('CRITICAL'), 'critical');
        assert.equal(normalizeSeverity('Severe'), 'serious');
    });

    test('unrecognized or missing severity falls back to "moderate"', () => {
        assert.equal(normalizeSeverity('bogus'), 'moderate');
        assert.equal(normalizeSeverity(undefined), 'moderate');
        assert.equal(normalizeSeverity(null), 'moderate');
        assert.equal(normalizeSeverity(''), 'moderate');
    });

    test('every possible output is accepted by validate-canonical.js\'s ALLOWED_SEVERITIES', () => {
        const { validateCanonical } = require('../canonical/validate-canonical');
        const possibleInputs = ['critical', 'serious', 'moderate', 'minor', 'info', 'severe', 'low', 'medium', 'informational', 'bogus', undefined];
        for (const input of possibleInputs) {
            const severity = normalizeSeverity(input);
            const res = validateCanonical({ findings: [{ uid: 'a', outcome: 'fail', severity }] });
            assert.equal(res.ok, true, `normalizeSeverity(${JSON.stringify(input)}) -> "${severity}" should be a valid canonical severity`);
        }
    });
});

describe('a11y-labs-engine: mixed occurrence tiers', () => {
    test('preserves occurrenceOutcome on canonical occurrences so UI can split fail vs cantTell within one rule', async () => {
        const fakePage = {
            url: async () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async () => ({
                url: 'https://example.test/',
                title: 'Example',
                timestamp: null,
                checksResults: [
                    {
                        ruleId: 'aria-hidden-focus',
                        outcome: 'fail',
                        severity: 'serious',
                        confidence: 'high',
                        occurrences: [
                            {
                                selector: '#ah_stays',
                                html: '<div id="ah_stays" aria-hidden="true" tabindex="0"></div>',
                                summary: 'stay',
                                occurrenceOutcome: 'fail'
                            },
                            {
                                selector: '#ah_redirects',
                                html: '<div id="ah_redirects" aria-hidden="true" tabindex="0"></div>',
                                summary: 'redirect',
                                occurrenceOutcome: 'cantTell'
                            }
                        ]
                    }
                ],
                rulesResults: []
            })
        };

        const { canonical } = await runOnPage(fakePage, {
            runOnly: { includeRuleIds: ['aria-hidden-focus'] },
            engineOptions: {}
        });
        const finding = canonical.findings.find((f) => f.ruleId === 'aria-hidden-focus');
        assert.ok(finding, 'expected canonical finding for aria-hidden-focus');
        assert.deepEqual(
            finding.occurrences.map((o) => o.occurrenceOutcome),
            ['fail', 'cantTell']
        );
    });
});

describe('a11y-labs-engine: occurrence hint and uncertainty', () => {
    async function runWith(occurrences) {
        const fakePage = {
            url: async () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async () => ({
                url: 'https://example.test/',
                title: 'Example',
                timestamp: null,
                checksResults: [
                    { ruleId: 'link-in-text-block', outcome: 'fail', severity: 'serious', confidence: 'high', occurrences }
                ],
                rulesResults: []
            })
        };
        const { canonical } = await runOnPage(fakePage, {
            runOnly: { includeRuleIds: ['link-in-text-block'] },
            engineOptions: {}
        });
        return canonical.findings.find((f) => f.ruleId === 'link-in-text-block').occurrences;
    }

    test('keeps the hint and, on a cantTell occurrence, the code and what would settle it', async () => {
        const [failOcc, undecidedOcc] = await runWith([
            { selector: '#a', html: '<a id="a"></a>', summary: 'fails', hint: '  Underline the link.  ', occurrenceOutcome: 'fail' },
            {
                selector: '#b',
                html: '<a id="b"></a>',
                summary: 'undecided',
                hint: 'Check the contrast by hand.',
                occurrenceOutcome: 'cantTell',
                uncertainty: {
                    code: 'not-computable',
                    needed: 'Measure the link against the text over the background image.',
                    evidence: { backgroundImage: true }
                }
            }
        ]);

        assert.equal(failOcc.hint, 'Underline the link.');
        assert.equal('uncertainty' in failOcc, false);
        assert.equal(undecidedOcc.hint, 'Check the contrast by hand.');
        assert.deepEqual(undecidedOcc.uncertainty, {
            code: 'not-computable',
            needed: 'Measure the link against the text over the background image.'
        });
    });

    test('leaves out an empty hint and an uncertainty block without a code', async () => {
        const [occ] = await runWith([
            { selector: '#a', html: '<a id="a"></a>', summary: 'x', hint: '   ', occurrenceOutcome: 'cantTell', uncertainty: { needed: 'y' } }
        ]);
        assert.equal('hint' in occ, false);
        assert.equal('uncertainty' in occ, false);
    });

    test('ignores an uncertainty block on a fail occurrence', async () => {
        const [occ] = await runWith([
            { selector: '#a', html: '<a id="a"></a>', summary: 'x', occurrenceOutcome: 'fail', uncertainty: { code: 'not-computable' } }
        ]);
        assert.equal('uncertainty' in occ, false);
    });
});

describe('a11y-labs-engine: composite occurrence provenance', () => {
    test('keeps source atomic rule ids on composite occurrences', async () => {
        const fakePage = {
            url: async () => 'https://example.test/',
            title: async () => 'Example',
            evaluate: async () => ({
                url: 'https://example.test/',
                title: 'Example',
                timestamp: null,
                checksResults: [
                    {
                        ruleId: 'aria-hidden-focus',
                        outcome: 'cantTell',
                        severity: 'serious',
                        confidence: 'high',
                        occurrences: [
                            {
                                selector: '#ah_redirects',
                                html: '<div id="ah_redirects" aria-hidden="true" tabindex="0"></div>',
                                summary: 'redirect',
                                occurrenceOutcome: 'cantTell'
                            }
                        ]
                    },
                    {
                        ruleId: 'css-hidden-focus',
                        outcome: 'cantTell',
                        severity: 'serious',
                        confidence: 'high',
                        occurrences: [
                            {
                                selector: '#css_hidden',
                                html: '<a id="css_hidden" href="#" style="opacity:0">x</a>',
                                summary: 'hidden',
                                occurrenceOutcome: 'cantTell'
                            }
                        ]
                    }
                ],
                rulesResults: [
                    {
                        ruleId: 'wcag-2.4.7-focus-visible',
                        outcome: 'cantTell',
                        severity: 'serious',
                        title: 'Focus visible',
                        description: 'rollup',
                        data: {
                            details: {
                                checksIds: ['aria-hidden-focus', 'css-hidden-focus'],
                                contributors: [
                                    { testId: 'aria-hidden-focus', outcome: 'cantTell' },
                                    { testId: 'css-hidden-focus', outcome: 'cantTell' }
                                ]
                            }
                        }
                    }
                ]
            })
        };

        const { canonical } = await runOnPage(fakePage, {
            runOnly: { includeRuleIds: ['wcag-2.4.7-focus-visible'] },
            engineOptions: { findingsSource: 'both' }
        });

        const finding = canonical.findings.find((f) => f.ruleId === 'wcag-2.4.7-focus-visible');
        assert.ok(finding, 'expected composite canonical finding');
        assert.ok(Array.isArray(finding.occurrences) && finding.occurrences.length >= 2);

        const sourceIds = new Set(
            finding.occurrences
                .flatMap((o) => (Array.isArray(o.sourceAtomicRules) ? o.sourceAtomicRules : []))
                .map(String)
        );
        assert.ok(sourceIds.has('aria-hidden-focus'));
        assert.ok(sourceIds.has('css-hidden-focus'));
    });
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const enginePath = require.resolve('./a11y-labs-engine');
const corePath = require.resolve('@surea11y/core');

// The script that registers a scan's packs reaches evaluate as a string
// before the scan itself; a fake page has nothing to register them in. The
// binding then asks the page which style sheets it can't read
// (findUnreadableStyleSheets): a fake page has none.
function fakePage(evaluateImpl, overrides = {}) {
    return {
        url: async () => 'https://example.test/',
        title: async () => 'Example Page',
        evaluate: async (...args) => {
            if (typeof args[0] === 'string') return undefined;
            if (args[0] && args[0].name === 'findUnreadableStyleSheets') return [];
            return evaluateImpl(...args);
        },
        ...overrides
    };
}

describe('a11y-labs-engine: module misconfiguration guard', () => {
    test('throws at require time if @surea11y/core stops exporting runa11yCoreInPage as a function', () => {
        // @surea11y/puppeteer wraps core's runa11yCoreInPage when it loads,
        // and refuses anything else; the scan goes through it.
        const realCore = require('@surea11y/core');
        const original = require.cache[corePath];
        const scanModules = [
            require.resolve('./surea11y-scan'),
            require.resolve('@surea11y/puppeteer'),
            path.join(path.dirname(require.resolve('@surea11y/puppeteer')), 'A11yCoreBuilder.js'),
        ];
        const forget = () => {
            delete require.cache[enginePath];
            for (const p of scanModules) delete require.cache[p];
        };
        require.cache[corePath] = {
            id: corePath, filename: corePath, loaded: true,
            exports: { ...realCore, runa11yCoreInPage: 'not-a-function' }
        };
        forget();
        try {
            assert.throws(() => require(enginePath), /runa11yCoreInPage/);
        } finally {
            require.cache[corePath] = original;
            forget();
        }
    });
});

describe('a11y-labs-engine: normalizeOccurrenceOutcome (via canonical occurrences)', () => {
    test('an occurrence and finding outcome that are both "pass"/"notApplicable" produce a null occurrenceOutcome', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [{
                ruleId: 'accesskeys',
                outcome: 'pass',
                severity: 'minor',
                occurrences: [{ selector: '#a', html: '<div>', summary: 's', occurrenceOutcome: 'notApplicable' }]
            }],
            rulesResults: []
        }));
        const { canonical } = await runOnPage(page, {});
        assert.equal(canonical.findings[0].occurrences[0].occurrenceOutcome, null);
    });
});

describe('a11y-labs-engine: tag/ruleId helpers', () => {
    test('normalizeRuleIdsList accepts an array or comma-separated string, and [] for anything else', () => {
        const { normalizeRuleIdsList } = require('./a11y-labs-engine');
        assert.deepEqual(normalizeRuleIdsList([' a ', '', 'b']), ['a', 'b']);
        assert.deepEqual(normalizeRuleIdsList('a, b ,'), ['a', 'b']);
        assert.deepEqual(normalizeRuleIdsList(undefined), []);
        assert.deepEqual(normalizeRuleIdsList(42), []);
    });
});

describe('a11y-labs-engine: no-op adapter surface', () => {
    test('ensureInjected resolves without throwing', async () => {
        const { ensureInjected } = require('./a11y-labs-engine');
        await assert.doesNotReject(() => ensureInjected({}));
    });

    test('postProcessResults returns native results unchanged', () => {
        const { postProcessResults } = require('./a11y-labs-engine');
        const native = { checksResults: [] };
        assert.equal(postProcessResults(native, {}), native);
    });
});

describe('a11y-labs-engine: rule catalog metadata', () => {
    test('getRulesCatalog reports the engine version and the real check catalog', () => {
        const { getRulesCatalog, engineVersion } = require('./a11y-labs-engine');
        const result = getRulesCatalog();
        assert.equal(result.version, engineVersion);
        assert.ok(Array.isArray(result.rules) && result.rules.length > 0);
    });

    test('getAllRuleIds returns the ruleId of every catalog entry', () => {
        const { getAllRuleIds } = require('./a11y-labs-engine');
        const ids = getAllRuleIds();
        assert.ok(ids.includes('aria-hidden-focus'));
        assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    });

    test('getAllTags returns a sorted, de-duplicated union of every rule\'s tags', () => {
        const { getAllTags } = require('./a11y-labs-engine');
        const tags = getAllTags();
        assert.ok(tags.includes('wcag2a'));
        const sorted = [...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        assert.deepEqual(tags, sorted);
        assert.equal(new Set(tags).size, tags.length);
    });

    test('getRulesForRunOnly filters to the requested rule and includes derived wcag.sc', async () => {
        const { getRulesForRunOnly } = require('./a11y-labs-engine');
        const rules = await getRulesForRunOnly({}, { includeRuleIds: ['aria-hidden-focus'] });
        assert.equal(rules.length, 1);
        assert.equal(rules[0].ruleId, 'aria-hidden-focus');
        assert.ok(rules[0].wcag.sc.includes('4.1.2'));
    });

    test('every catalog rule exposes wcag.scNormative as a subset of wcag.sc', async () => {
        const { getRulesForRunOnly } = require('./a11y-labs-engine');
        const rules = await getRulesForRunOnly({}, null);
        for (const rule of rules) {
            assert.ok(Array.isArray(rule.wcag.scNormative), `${rule.ruleId} is missing wcag.scNormative`);
            for (const sc of rule.wcag.scNormative) {
                assert.ok(rule.wcag.sc.includes(sc), `${rule.ruleId}: ${sc} is normative but absent from wcag.sc`);
            }
        }
    });

    test('getRulesForRunOnly with no runOnly returns every rule a default run would run', async () => {
        const { getRulesForRunOnly, getRulesCatalog } = require('./a11y-labs-engine');
        const rules = await getRulesForRunOnly({}, null);
        const ids = new Set(rules.map((r) => r.ruleId));

        // Rules core keeps off check a requirement only one standard makes
        // (RGAA's), which the lab does not offer: a run leaves them out.
        // Every other rule in the catalog is there.
        const catalog = getRulesCatalog().rules;
        const optIn = catalog.filter((r) => (r.tags || []).includes('rgaa')).map((r) => r.ruleId);
        if (CORE_HAS_GATED_RULES) assert.ok(optIn.includes('doctype-present'));
        for (const id of optIn) assert.equal(ids.has(id), false, `${id} is opt-in and should not be in a default run`);
        assert.equal(rules.length, catalog.length - optIn.length);
    });
});

describe('a11y-labs-engine: runOnPage - page metadata resilience', () => {
    test('falls back to native engineOutput url/title and a generated timestamp when page.url()/title() throw', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({ url: 'https://native.example/', title: 'Native Title', timestamp: null, checksResults: [], rulesResults: [] }), {
            url: async () => { throw new Error('no url'); },
            title: async () => { throw new Error('no title'); }
        });
        const { canonical } = await runOnPage(page, {});
        assert.equal(canonical.page.url, 'https://native.example/');
        assert.equal(canonical.page.title, 'Native Title');
    });
});

describe('a11y-labs-engine: runOnPage - contextSelector / excludeSelectors', () => {
    test('contextSelector is trimmed and reflected in scope.include and passed to page.evaluate', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        const { canonical } = await runOnPage(page, { contextSelector: '  #main  ' });
        assert.deepEqual(canonical.scope.include, ['#main']);
        assert.equal(capturedArgs[2], '#main');
    });

    test('defaults scope.include to ["html"] when no contextSelector is given', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({ checksResults: [], rulesResults: [] }));
        const { canonical } = await runOnPage(page, {});
        assert.deepEqual(canonical.scope.include, ['html']);
    });

    test('merges the top-level excludeSelectors with engineOptions.excludeSelectors instead of one clobbering the other (regression)', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        const { canonical } = await runOnPage(page, {
            excludeSelectors: ['.a', '.b'],
            engineOptions: { excludeSelectors: ['.b', '.c'] }
        });
        const cfgPassedToCore = capturedArgs[3];
        assert.deepEqual(new Set(cfgPassedToCore.excludeSelectors), new Set(['.a', '.b', '.c']));
        assert.deepEqual(canonical.scope.exclude, ['.a', '.b']);
    });

    test('excludeSelectors alone (no engineOptions.excludeSelectors) still reaches the core config', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, { excludeSelectors: ['.only'] });
        assert.deepEqual(capturedArgs[3].excludeSelectors, ['.only']);
    });
});

describe('a11y-labs-engine: runOnPage - engineMode / contrast', () => {
    test('engineOptions.engineMode is surfaced to the core config as cfg.contrast.mode', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, { engineOptions: { engineMode: 'dark' } });
        assert.deepEqual(capturedArgs[3].contrast, { mode: 'dark' });
    });

    test('cfg.contrast is absent when engineMode is not set', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, {});
        assert.equal(capturedArgs[3].contrast, undefined);
    });
});

describe('a11y-labs-engine: runOnPage - rule ids surea11y does not have', () => {
    test('leaves out an unknown id beside known ones, and notes it', async () => {
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        const { canonical } = await runOnPage(page, {
            runOnly: { includeRuleIds: ['img-alt-present', 'color-contrast'], excludeRuleIds: ['region'] }
        });
        assert.deepEqual(capturedArgs[4].includeRuleIds, ['img-alt-present']);
        assert.deepEqual(canonical.runOptions.unknownRuleIds, { include: ['color-contrast'], exclude: [] });
        assert.equal(canonical.notices.length, 1);
        assert.equal(canonical.notices[0].code, 'unknown-rule-ids');
        assert.match(canonical.notices[0].message, /color-contrast/);
    });

    test('runs no rule, rather than every rule, when every included id is another engine\'s', async () => {
        let called = false;
        const page = fakePage(async () => { called = true; return { checksResults: [], rulesResults: [] }; });
        const { canonical } = await runOnPage(page, {
            runOnly: { includeRuleIds: ['color-contrast', 'image-alt'] }
        });
        assert.equal(called, false, 'core must not be called: it throws on such a list');
        assert.equal(canonical.findings.length, 0);
        assert.equal(canonical.notices[0].code, 'no-known-rules');
    });

    test('accepts rollup ids and the engine-prefixed form of a check id', async () => {
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        const { canonical } = await runOnPage(page, {
            runOnly: { includeRuleIds: ['wcag-1.1.1-non-text-content', 'a11ycore-img-alt-present'] }
        });
        assert.deepEqual(capturedArgs[4].includeRuleIds, ['wcag-1.1.1-non-text-content', 'a11ycore-img-alt-present']);
        assert.deepEqual(canonical.notices, []);
        assert.equal(canonical.runOptions.unknownRuleIds, null);
    });
});

describe('a11y-labs-engine: runOnPage - a scope that matches nothing', () => {
    const scanWith = (contextMatch) => runOnPage(
        fakePage(async () => ({ checksResults: [], rulesResults: [], contextMatch })),
        { contextSelector: '#app, #missing' }
    );

    test('notes a scan whose scope matched no element, and keeps core\'s contextMatch', async () => {
        const contextMatch = { elementCount: 0, unmatchedSelectors: ['#app', '#missing'] };
        const { native, canonical } = await scanWith(contextMatch);
        assert.deepEqual(native.contextMatch, contextMatch);
        assert.deepEqual(canonical.scope.match, contextMatch);
        assert.equal(canonical.notices.length, 1);
        assert.equal(canonical.notices[0].code, 'context-unmatched');
        assert.match(canonical.notices[0].message, /#app, #missing/);
    });

    test('names the part of a scope that matched nothing when the rest was scanned', async () => {
        const { canonical } = await scanWith({ elementCount: 3, unmatchedSelectors: ['#missing'] });
        assert.equal(canonical.notices[0].code, 'context-partly-unmatched');
        assert.match(canonical.notices[0].message, /"#missing"/);
    });

    test('adds no note when the whole scope matched, or there was none', async () => {
        assert.deepEqual((await scanWith({ elementCount: 2, unmatchedSelectors: [] })).canonical.notices, []);
        const { canonical } = await runOnPage(fakePage(async () => ({ checksResults: [], rulesResults: [], contextMatch: null })), {});
        assert.deepEqual(canonical.notices, []);
        assert.equal(canonical.scope.match, null);
    });
});

describe('a11y-labs-engine: runOnPage - margins', () => {
    test('keeps each measuring rule\'s margin, with the rule\'s title', async () => {
        const margin = { measure: 'contrast-ratio', unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.52, headroom: 0.02, measuredCount: 12, selector: 'p.lead', structuralPath: [1, 0], context: { largeText: false } };
        const { canonical } = await runOnPage(fakePage(async () => ({
            checksResults: [
                { ruleId: 'contrast-minimum', outcome: 'pass', occurrences: [], margin },
                { ruleId: 'img-alt-present', outcome: 'pass', occurrences: [] }
            ],
            rulesResults: []
        })), {});
        assert.equal(canonical.margins.length, 1);
        assert.deepEqual({ ...canonical.margins[0], title: undefined }, { ruleId: 'contrast-minimum', ...margin, title: undefined });
        assert.ok(canonical.margins[0].title && canonical.margins[0].title !== 'contrast-minimum');
    });

    test('is empty when no rule reports one', async () => {
        const { canonical } = await runOnPage(fakePage(async () => ({ checksResults: [], rulesResults: [] })), {});
        assert.deepEqual(canonical.margins, []);
    });
});

describe('a11y-labs-engine: occurrence details', () => {
    const { normalizeOccurrenceDetails } = require('./a11y-labs-engine');

    test('keeps scalars and short lists of scalars, without reasonCode', () => {
        assert.deepEqual(normalizeOccurrenceDetails({
            reasonCode: 'x', altSignal: 'file-name', length: 180, ok: false, methods: ['label', 'title'],
            nested: { a: 1 }, mixed: ['a', { b: 1 }], empty: '  ', nan: NaN
        }), { altSignal: 'file-name', length: 180, ok: false, methods: ['label', 'title'] });
    });

    test('cuts long strings and lists, and caps the number of fields', () => {
        const out = normalizeOccurrenceDetails({ text: 'x'.repeat(500), list: Array.from({ length: 30 }, (_, i) => i) });
        assert.equal(out.text.length, 200);
        assert.equal(out.list.length, 10);
        const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
        assert.equal(Object.keys(normalizeOccurrenceDetails(many)).length, 12);
    });

    test('gives null when nothing is left to show', () => {
        assert.equal(normalizeOccurrenceDetails({ reasonCode: 'x' }), null);
        assert.equal(normalizeOccurrenceDetails(null), null);
        assert.equal(normalizeOccurrenceDetails([1, 2]), null);
    });

    test('puts details and shadow hosts on the canonical occurrence', async () => {
        const { canonical } = await runOnPage(fakePage(async () => ({
            checksResults: [{
                ruleId: 'img-alt-quality', outcome: 'cantTell',
                occurrences: [{ selector: 'img', html: '<img>', summary: 's', shadowHostSelectors: ['my-app'], data: { details: { reasonCode: 'r', altSignal: 'url' } } }]
            }],
            rulesResults: []
        })), { engineOptions: { findingsSource: 'atomic' } });
        const occ = canonical.findings.find((f) => f.ruleId === 'img-alt-quality').occurrences[0];
        assert.deepEqual(occ.details, { altSignal: 'url' });
        assert.deepEqual(occ.shadowHostSelectors, ['my-app']);
    });
});

describe('a11y-labs-engine: runOnPage - runOnly normalization', () => {
    test('the legacy {type:"tag", values} shape makes a selection of its WCAG tags, keeping the others', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, { runOnly: { type: 'tag', values: 'wcag2aa,best-practice,keyboard' } });
        assert.deepEqual(capturedArgs[4].wcag, { version: '2.0', level: 'AA' });
        assert.equal(capturedArgs[4].bestPractices, true);
        assert.deepEqual(capturedArgs[4].tags, ['keyboard']);
    });

    test('wcagLevel overrides standard tags only when runOnly.tags is non-empty', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });

        await runOnPage(page, { wcagLevel: 'AA', runOnly: { tags: ['wcag2a'] } });
        assert.deepEqual(capturedArgs[4].wcag, { version: '2.0', level: 'AA' });
        assert.deepEqual(capturedArgs[4].tags ?? [], []);

        await runOnPage(page, { wcagLevel: 'AA', runOnly: { includeRuleIds: ['aria-hidden-focus'] } });
        assert.deepEqual(capturedArgs[4].tags ?? [], []);
        assert.deepEqual(capturedArgs[4].includeRuleIds, ['aria-hidden-focus']);
    });

    test('includeTags expands to includeRuleIds via the real catalog ("or" mode = union with explicit includeRuleIds)', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, {
            runOnly: { includeTags: ['keyboard'], includeRuleIds: ['img-alt-present'], includeMode: 'or' }
        });
        const ids = new Set(capturedArgs[4].includeRuleIds);
        assert.ok(ids.has('accesskeys'), 'expected a rule tagged "keyboard" to be included');
        assert.ok(ids.has('img-alt-present'), 'expected the explicit includeRuleIds to be unioned in');
    });

    test('includeTags in "and" mode intersects with explicit includeRuleIds instead of unioning', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, {
            runOnly: { includeTags: ['keyboard'], includeRuleIds: ['accesskeys', 'not-tagged-keyboard'], includeMode: 'and' }
        });
        assert.deepEqual(capturedArgs[4].includeRuleIds, ['accesskeys']);
    });

    test('includeTags never brings in a rule core keeps off', NEEDS_GATED_RULES, async () => {
        const core = require('@surea11y/core');
        const { runOnPage } = require('./a11y-labs-engine');
        const optIn = core.getChecksCatalog()
            .filter((r) => (r.tags || []).includes('rgaa') && (r.tags || []).includes('forms'))
            .map((r) => r.ruleId);
        assert.ok(optIn.includes('field-group-legend'), 'expected kept-off rules tagged "forms" in the catalog');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });

        await runOnPage(page, { runOnly: { tags: ['wcag2a'], includeTags: ['forms'] } });
        const ids = capturedArgs[4].includeRuleIds;
        assert.ok(ids.includes('form-control-programmatic-label-present'), 'expected the WCAG rules tagged "forms"');
        assert.deepEqual(optIn.filter((id) => ids.includes(id)), []);
    });

    test('a rule core keeps off stays off, even when the scan names its tag', NEEDS_GATED_RULES, async () => {
        const core = require('@surea11y/core');
        const { runOnPage } = require('./a11y-labs-engine');
        const keptOff = core.getChecksCatalog().filter((r) => (r.tags || []).includes('rgaa')).map((r) => r.ruleId);
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });

        await runOnPage(page, { runOnly: { includeTags: ['rgaa'] }, engineOptions: { optInRules: 'all' } });
        const ids = capturedArgs[4].includeRuleIds || [];
        assert.deepEqual(keptOff.filter((id) => ids.includes(id)), []);
        assert.equal(capturedArgs[3].optInRules, undefined, 'never asked of core');
    });

    test('excludeTags expands to excludeRuleIds via the real catalog, merged with explicit excludeRuleIds', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, {
            runOnly: { excludeTags: ['keyboard'], excludeRuleIds: ['img-alt-present'] }
        });
        const ids = new Set(capturedArgs[4].excludeRuleIds);
        assert.ok(ids.has('accesskeys'));
        assert.ok(ids.has('img-alt-present'));
    });

    test('exclude wins: a ruleId present in both includeRuleIds and excludeRuleIds is dropped from includeRuleIds', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, {
            runOnly: { includeRuleIds: ['aria-hidden-focus', 'css-hidden-focus'], excludeRuleIds: ['aria-hidden-focus'] }
        });
        assert.deepEqual(capturedArgs[4].includeRuleIds, ['css-hidden-focus']);
    });

    test('an includeTags filter matching no catalog rule collapses includeRuleIds to empty rather than scanning everything', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, { runOnly: { includeTags: ['no-such-tag-exists'] } });
        // An empty include list reads to core as every rule, so core is not called.
        assert.equal(capturedArgs, undefined);
    });

    test('runOnly is passed as null to core when no filter fields were provided at all', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, {});
        assert.equal(capturedArgs[4], null);
    });

    test('modern shape with only excludeRuleIds set (every other field empty) is still treated as a real filter, not null', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });
        await runOnPage(page, { runOnly: { excludeRuleIds: ['aria-hidden-focus'] } });
        assert.deepEqual(capturedArgs[4].excludeRuleIds, ['aria-hidden-focus']);
    });
});

describe('a11y-labs-engine: runOnPage - unknown ruleId fallback metadata', () => {
    test('a checksResults entry whose ruleId is not in the catalog still produces a finding, using a synthesized meta', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [{
                ruleId: 'totally-unknown-rule-xyz',
                outcome: 'fail',
                severity: 'serious',
                confidence: 'high',
                occurrences: [{ selector: '#a', html: '<div>', summary: 'bad' }]
            }],
            rulesResults: []
        }));
        const { canonical } = await runOnPage(page, {});
        const finding = canonical.findings[0];
        assert.equal(finding.ruleId, 'totally-unknown-rule-xyz');
        assert.equal(finding.title, 'totally-unknown-rule-xyz');
        assert.equal(finding.severity, 'serious');
        assert.deepEqual(finding.wcag.sc, []);
        assert.deepEqual(finding.standards, { normativeMappings: [], informativeReferences: [] });
    });
});

describe('a11y-labs-engine: runOnPage - confidence mapping', () => {
    test('an explicit confidence label (high/medium/low) maps to its fixed numeric value', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const cases = [['high', 0.95], ['medium', 0.75], ['low', 0.4]];
        for (const [label, expected] of cases) {
            const page = fakePage(async () => ({
                checksResults: [{ ruleId: 'accesskeys', outcome: 'fail', severity: 'minor', confidence: label, occurrences: [] }],
                rulesResults: []
            }));
            const { canonical } = await runOnPage(page, {});
            assert.equal(canonical.findings[0].confidence, expected, `label "${label}"`);
        }
    });

    test('an unrecognized confidence label falls back to an outcome-based numeric confidence', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const cases = [['cantTell', 0.6], ['notApplicable', 0.9], ['pass', 0.9]];
        for (const [outcome, expected] of cases) {
            const page = fakePage(async () => ({
                checksResults: [{ ruleId: 'accesskeys', outcome, severity: 'minor', confidence: 'not-a-real-label', occurrences: [] }],
                rulesResults: []
            }));
            const { canonical } = await runOnPage(page, {});
            assert.equal(canonical.findings[0].confidence, expected, `outcome "${outcome}"`);
        }
    });
});

describe('a11y-labs-engine: runOnPage - findingsSource filtering', () => {
    function scanPage() {
        return fakePage(async () => ({
            checksResults: [{ ruleId: 'aria-hidden-focus', outcome: 'fail', severity: 'serious', occurrences: [] }],
            rulesResults: [{
                ruleId: 'custom-composite-rule',
                outcome: 'fail',
                severity: 'serious',
                data: { details: { checksIds: ['aria-hidden-focus'], contributors: [{ testId: 'aria-hidden-focus', outcome: 'fail' }] } }
            }]
        }));
    }

    test('"atomic" includes only atomic findings', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { canonical } = await runOnPage(scanPage(), { engineOptions: { findingsSource: 'atomic' } });
        assert.deepEqual(canonical.findings.map((f) => f.ruleId), ['aria-hidden-focus']);
    });

    test('"composite" includes only composite (rollup) findings', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { canonical } = await runOnPage(scanPage(), { engineOptions: { findingsSource: 'composite' } });
        assert.deepEqual(canonical.findings.map((f) => f.ruleId), ['custom-composite-rule']);
    });

    test('"both" (and the default when unset) includes atomic and composite findings', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { canonical: withBoth } = await runOnPage(scanPage(), { engineOptions: { findingsSource: 'both' } });
        assert.deepEqual(withBoth.findings.map((f) => f.ruleId).sort(), ['aria-hidden-focus', 'custom-composite-rule']);

        const { canonical: withDefault } = await runOnPage(scanPage(), {});
        assert.deepEqual(withDefault.findings.map((f) => f.ruleId).sort(), ['aria-hidden-focus', 'custom-composite-rule']);
    });

    test('native violations/incomplete/passes/inapplicable buckets are always populated regardless of findingsSource', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { native } = await runOnPage(scanPage(), { engineOptions: { findingsSource: 'composite' } });
        assert.equal(native.violations.length, 1);
        assert.equal(native.violations[0].id, 'aria-hidden-focus');
    });

    test('findingsByKind splits atomic vs composite regardless of findingsSource', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { canonical } = await runOnPage(scanPage(), {});
        assert.deepEqual(canonical.findingsByKind.atomic.map((f) => f.ruleId), ['aria-hidden-focus']);
        assert.deepEqual(canonical.findingsByKind.composite.map((f) => f.ruleId), ['custom-composite-rule']);
    });

    test('a composite whose contributors all pass (or are all notApplicable) still produces a composite finding, not just fail/cantTell', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [
                { ruleId: 'html-lang-present', outcome: 'pass', severity: 'serious', occurrences: [] },
                { ruleId: 'video-caption', outcome: 'notApplicable', severity: 'serious', occurrences: [] }
            ],
            rulesResults: [
                {
                    ruleId: 'wcag-passing-composite',
                    outcome: 'pass',
                    severity: 'serious',
                    data: {
                        details: {
                            checksIds: ['html-lang-present'],
                            contributors: [{ testId: 'html-lang-present', outcome: 'pass' }]
                        }
                    }
                },
                {
                    ruleId: 'wcag-inapplicable-composite',
                    outcome: 'notApplicable',
                    severity: 'serious',
                    data: {
                        details: {
                            checksIds: ['video-caption'],
                            contributors: [{ testId: 'video-caption', outcome: 'notApplicable' }]
                        }
                    }
                }
            ]
        }));

        const { canonical } = await runOnPage(page, { engineOptions: { findingsSource: 'composite' } });
        const byRuleId = Object.fromEntries(canonical.findings.map((f) => [f.ruleId, f.outcome]));
        assert.equal(byRuleId['wcag-passing-composite'], 'pass');
        assert.equal(byRuleId['wcag-inapplicable-composite'], 'notApplicable');
    });

    test('a composite with mixed pass and notApplicable contributors splits into separate pass/notApplicable findings, same as fail/cantTell', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [
                { ruleId: 'rule-a', outcome: 'pass', severity: 'serious', occurrences: [] },
                { ruleId: 'rule-b', outcome: 'notApplicable', severity: 'serious', occurrences: [] }
            ],
            rulesResults: [{
                ruleId: 'wcag-mixed-composite',
                outcome: 'pass',
                severity: 'serious',
                data: {
                    details: {
                        checksIds: ['rule-a', 'rule-b'],
                        contributors: [
                            { testId: 'rule-a', outcome: 'pass' },
                            { testId: 'rule-b', outcome: 'notApplicable' }
                        ]
                    }
                }
            }]
        }));

        const { canonical } = await runOnPage(page, { engineOptions: { findingsSource: 'composite' } });
        const matches = canonical.findings.filter((f) => f.ruleId === 'wcag-mixed-composite');
        assert.deepEqual(matches.map((f) => f.outcome).sort(), ['notApplicable', 'pass']);

        const passFinding = matches.find((f) => f.outcome === 'pass');
        const naFinding = matches.find((f) => f.outcome === 'notApplicable');
        assert.deepEqual(passFinding.evidence.rollup.checksIds, ['rule-a']);
        assert.deepEqual(naFinding.evidence.rollup.checksIds, ['rule-b']);
    });
});

describe('a11y-labs-engine: runOnPage - composite wcag.sc derivation', () => {
    test('falls back to data.details.wcagSc, de-duplicated and sorted, when no normativeMappings are present', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [{ ruleId: 'aria-hidden-focus', outcome: 'fail', severity: 'serious', occurrences: [] }],
            rulesResults: [{
                ruleId: 'custom-composite-rule',
                outcome: 'fail',
                severity: 'serious',
                data: {
                    details: {
                        wcagSc: ['9.9.9', '9.9.9', '1.1.1'],
                        checksIds: ['aria-hidden-focus'],
                        contributors: [{ testId: 'aria-hidden-focus', outcome: 'fail' }]
                    }
                }
            }]
        }));
        const { canonical } = await runOnPage(page, {});
        const composite = canonical.findings.find((f) => f.ruleId === 'custom-composite-rule');
        assert.deepEqual(composite.wcag.sc, ['1.1.1', '9.9.9']);
        assert.deepEqual(composite.wcag.scNormative, ['1.1.1', '9.9.9']);
    });

    test('wcag.scNormative excludes informative references that wcag.sc keeps', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [{ ruleId: 'aria-hidden-focus', outcome: 'fail', severity: 'serious', occurrences: [] }],
            rulesResults: [{
                ruleId: 'custom-composite-rule',
                outcome: 'fail',
                severity: 'serious',
                meta: {
                    normativeMappings: [{ standard: 'WCAG', requirement: '1.4.3' }],
                    informativeReferences: [{ standard: 'WCAG', requirement: '1.3.1' }]
                },
                data: {
                    details: {
                        checksIds: ['aria-hidden-focus'],
                        contributors: [{ testId: 'aria-hidden-focus', outcome: 'fail' }]
                    }
                }
            }]
        }));
        const { canonical } = await runOnPage(page, {});
        const composite = canonical.findings.find((f) => f.ruleId === 'custom-composite-rule');
        assert.deepEqual(composite.wcag.sc, ['1.3.1', '1.4.3']);
        assert.deepEqual(composite.wcag.scNormative, ['1.4.3']);
    });

    test('a contributor whose outcome cannot be resolved (unknown testId, no valid outcome) contributes to neither fail nor cantTell', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [{ ruleId: 'aria-hidden-focus', outcome: 'fail', severity: 'serious', occurrences: [] }],
            rulesResults: [{
                ruleId: 'custom-composite-rule',
                outcome: 'fail',
                severity: 'serious',
                data: {
                    details: {
                        checksIds: ['aria-hidden-focus', 'no-such-atomic-rule'],
                        contributors: [
                            { testId: 'aria-hidden-focus', outcome: 'fail' },
                            { testId: 'no-such-atomic-rule' } // no outcome, and not in atomicOutcomeByRuleId
                        ]
                    }
                }
            }]
        }));
        const { canonical } = await runOnPage(page, {});
        const composite = canonical.findings.find((f) => f.ruleId === 'custom-composite-rule');
        assert.ok(composite, 'expected the composite finding to still be produced from the resolvable contributor');
        assert.deepEqual(composite.evidence.rollup.checksIds, ['aria-hidden-focus']);
    });

    test('a rulesResults entry with no ruleId at all yields no composite finding', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [{ ruleId: 'aria-hidden-focus', outcome: 'fail', severity: 'serious', occurrences: [] }],
            rulesResults: [{
                ruleId: '',
                outcome: 'fail',
                severity: 'serious',
                data: { details: { checksIds: ['aria-hidden-focus'], contributors: [{ testId: 'aria-hidden-focus', outcome: 'fail' }] } }
            }]
        }));
        const { canonical } = await runOnPage(page, {});
        assert.deepEqual(canonical.findings.map((f) => f.ruleId), ['aria-hidden-focus']);
    });
});

describe('a11y-labs-engine: runOnPage - diagnostics', () => {
    test('diagnostics.engine.compositeCatalogCount reports the real composite catalog size, not 0 (regression)', async () => {
        const core = require('@surea11y/core');
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({ checksResults: [], rulesResults: [] }));
        const { canonical } = await runOnPage(page, {});
        // COMPOSITE_RULES may also hold the rollups of rules core keeps off,
        // which its catalog lists only for options that ask for them.
        assert.equal(canonical.diagnostics.engine.compositeCatalogCount, core.getRulesCatalog({ locale: 'en' }).length);
        if (CORE_HAS_GATED_RULES) assert.ok(canonical.diagnostics.engine.compositeCatalogCount < core.COMPOSITE_RULES.length);
        assert.ok(canonical.diagnostics.engine.compositeCatalogCount > 0);
    });

    test('diagnostics.engine.rulesResults echoes the raw composite results from the page', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const rulesResults = [{ ruleId: 'x', outcome: 'fail', severity: 'serious', data: { details: {} } }];
        const page = fakePage(async () => ({ checksResults: [], rulesResults }));
        const { canonical } = await runOnPage(page, {});
        assert.deepEqual(canonical.diagnostics.engine.rulesResults, rulesResults);
    });
});

describe('a11y-labs-engine: runOnPage - report config redaction', () => {
    test('strips cfg.probes from runOptions.engineOptions to avoid embedding large/sensitive payloads in reports', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({ checksResults: [], rulesResults: [] }));
        const { canonical } = await runOnPage(page, { engineOptions: { probes: { huge: 'payload' }, locale: 'en' } });
        assert.equal(canonical.runOptions.engineOptions.probes, undefined);
        assert.equal(canonical.runOptions.engineOptions.locale, 'en');
    });
});

describe('a11y-labs-engine: runOnPage - postProcess hook', () => {
    test('does not throw when postProcess is provided as an object', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({ checksResults: [], rulesResults: [] }));
        await assert.doesNotReject(() => runOnPage(page, { postProcess: { anything: true } }));
    });

    test('is skipped without error when postProcess is not an object', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({ checksResults: [], rulesResults: [] }));
        await assert.doesNotReject(() => runOnPage(page, { postProcess: 'not-an-object' }));
    });
});

describe('a11y-labs-engine: runOnPage - canonical output passes strict validation', () => {
    test('a realistic mixed atomic+composite run produces canonical output accepted by validate-canonical.js', async () => {
        const { validateCanonical } = require('../canonical/validate-canonical');
        const { runOnPage } = require('./a11y-labs-engine');
        const page = fakePage(async () => ({
            checksResults: [
                { ruleId: 'aria-hidden-focus', outcome: 'fail', severity: 'serious', confidence: 'high', occurrences: [{ selector: '#a', html: '<div>', summary: 's' }] },
                { ruleId: 'css-hidden-focus', outcome: 'cantTell', severity: 'serious', confidence: 'medium', occurrences: [] }
            ],
            rulesResults: [{
                ruleId: 'wcag-2.4.7-focus-visible',
                outcome: 'cantTell',
                severity: 'serious',
                title: 'Focus visible',
                data: { details: { checksIds: ['aria-hidden-focus', 'css-hidden-focus'], contributors: [{ testId: 'aria-hidden-focus', outcome: 'cantTell' }, { testId: 'css-hidden-focus', outcome: 'cantTell' }] } }
            }]
        }));
        const { canonical } = await runOnPage(page, {});
        const res = validateCanonical(canonical);
        assert.equal(res.ok, true, JSON.stringify(res.errors));
    });
});

describe('a11y-labs-engine: saveHtmlReport', () => {
    // Enough of a core result for core's renderer: one failing rule with one
    // occurrence, and the engine block that sets the report's language.
    const coreResult = {
        engineId: 'surea11y',
        engine: { tag: 'a11ycore', locale: { requested: 'en', resolved: 'en', reason: 'ok' }, wcagVersion: '2.2' },
        url: 'https://example.test/cart',
        timestamp: '2026-09-29T10:00:00.000Z',
        checksResults: [{
            ruleId: 'img-alt-present',
            outcome: 'fail',
            severity: 'critical',
            title: 'Images have alternative text',
            occurrences: [{ selector: 'img.hero', html: '<img class="hero">', summary: 'The image has no alt attribute.', hint: 'Add an alt attribute.' }]
        }],
        rulesResults: []
    };

    test("renders core's report for the scan and returns where to open it", () => {
        const { saveHtmlReport } = require('./a11y-labs-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labs-report-'));
        try {
            const report = saveHtmlReport({ native: coreResult }, {
                outDir,
                label: 'Cart <empty>',
                url: coreResult.url,
                screenshot: 'data:image/jpeg;base64,AAAA'
            });

            assert.match(path.basename(report.path), /^cart-empty-.+\.html$/);
            assert.equal(report.publicUrl, null, 'a folder outside reports/ has no public URL');
            assert.equal(report.screenshotDataUrl, 'data:image/jpeg;base64,AAAA');

            const html = fs.readFileSync(report.path, 'utf-8');
            assert.match(html, /<h1>Cart &lt;empty&gt;<\/h1>/);
            assert.match(html, /img-alt-present/);
            assert.match(html, /Add an alt attribute\./);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    test('writes under reports/surea11y by default and returns a /reports URL', () => {
        const { saveHtmlReport } = require('./a11y-labs-engine');
        const { REPORTS_ROOT } = require('../report-paths');
        const report = saveHtmlReport({ native: { byEngine: { surea11y: coreResult } } }, {
            scenarioName: 'Report test ' + process.pid,
            filename: 'cart.html'
        });
        try {
            const folder = path.basename(path.dirname(report.path));
            assert.match(folder, new RegExp('^report-test-' + process.pid));
            assert.equal(report.path, path.join(REPORTS_ROOT, 'surea11y', folder, 'cart.html'));
            assert.equal(report.publicUrl, '/reports/surea11y/' + folder + '/cart.html');
            assert.ok(fs.existsSync(report.path));
        } finally {
            fs.rmSync(path.dirname(report.path), { recursive: true, force: true });
            // Leave no empty folders behind in the checkout; rmdir refuses
            // a folder that still holds anything.
            for (const dir of [path.join(REPORTS_ROOT, 'surea11y'), REPORTS_ROOT]) {
                try { fs.rmdirSync(dir); } catch {}
            }
        }
    });

    test('returns null and writes nothing without a surea11y result', () => {
        const { saveHtmlReport } = require('./a11y-labs-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labs-report-'));
        try {
            assert.equal(saveHtmlReport({ native: null }, { outDir }), null);
            assert.equal(saveHtmlReport({ native: { byEngine: { 'engine-b': { checksResults: [] } } } }, { outDir }), null);
            assert.deepEqual(fs.readdirSync(outDir), []);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });
});

describe('a11y-labs-engine: runOnPage - conformance profile', () => {
    test('a known profile reaches core and replaces the level tags, keeping excludes', async () => {
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { engine: { profile: args[3].profile }, checksResults: [], rulesResults: [] }; });

        await runOnPage(page, {
            wcagLevel: 'AAA',
            runOnly: { tags: ['wcag2a', 'wcag21a'], excludeRuleIds: ['region'] },
            engineOptions: { profile: ' EN301549-v3.2.1 ' }
        });

        assert.equal(capturedArgs[3].profile, 'en301549-v3.2.1');
        assert.deepEqual(capturedArgs[4].tags ?? [], []);
        assert.deepEqual(capturedArgs[4].excludeRuleIds, ['region']);
    });

    test('scans again with the standard\'s WCAG tags when core does not have the profile, and says so', async () => {
        const calls = [];
        // A core release without the standard: it reports no profile.
        const page = fakePage(async (...args) => { calls.push(args); return { engine: {}, checksResults: [], rulesResults: [] }; });

        const { canonical } = await runOnPage(page, {
            wcagLevel: 'AA',
            runOnly: { tags: ['wcag2a'], excludeRuleIds: ['region'] },
            engineOptions: { profile: 'en301549-v3.2.1' }
        });

        assert.equal(calls.length, 2);
        assert.equal(calls[1][3].profile, undefined, 'the second scan asks for no profile');
        assert.deepEqual(calls[1][4].tags, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
        assert.deepEqual(calls[1][4].excludeRuleIds, ['region']);
        assert.equal(canonical.notices[0].code, 'profile-unavailable');
        assert.match(canonical.notices[0].message, /no EN 301 549 V3\.2\.1 profile/);
        assert.equal(canonical.runOptions.conformanceProfile, null);
    });

    test('takes the pictures once, of the scan that stays, when it scans again', async () => {
        const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
        const scans = [];
        const ops = [];
        const view = {
            rect: { x: 10, y: 10, width: 40, height: 20 }, viewport: { x: 0, y: 0, width: 800, height: 600 },
            window: { width: 800, height: 600 }, scroll: { x: 0, y: 0 }, devicePixelRatio: 1,
        };
        const page = fakePage(async (_fn, first) => {
            if (first && typeof first === 'object' && first.op) {
                ops.push(first.op);
                if (first.op === 'frame-key') return { key: 'top' };
                if (first.op === 'target') return view;
                return {};
            }
            scans.push(first);
            return {
                engine: {},
                rulesResults: [],
                checksResults: [{ ruleId: 'img-alt-present', outcome: 'fail', occurrences: [{ selector: '#a', summary: 'No alt.' }] }],
            };
        }, { screenshot: async () => PNG });

        const { canonical } = await runOnPage(page, {
            engineOptions: { profile: 'en301549-v3.2.1' },
            elementScreenshots: { outcomes: ['fail'], padding: 16, max: 50 },
        });

        assert.equal(scans.length, 2, 'scanned again for the missing standard');
        assert.deepEqual(ops.filter((op) => op === 'target'), ['target'], 'one element, pictured once');
        const shots = canonical.findings.flatMap((f) => f.occurrences || []).map((o) => o.elementScreenshot).filter(Boolean);
        assert.ok(shots.length >= 1 && shots.every((shot) => Buffer.isBuffer(shot.buffer)));
    });

    test('does not scan again when the step\'s own includes override the standard', async () => {
        const calls = [];
        const page = fakePage(async (...args) => { calls.push(args); return { engine: {}, checksResults: [], rulesResults: [] }; });
        await runOnPage(page, { runOnly: { includeRuleIds: ['img-alt-present'] }, engineOptions: { profile: 'en301549-v3.2.1' } });
        assert.equal(calls.length, 1);
    });

    test('an unknown profile is not sent and the level tags stay', async () => {
        let capturedArgs;
        const page = fakePage(async (...args) => { capturedArgs = args; return { checksResults: [], rulesResults: [] }; });

        await runOnPage(page, { wcagLevel: 'AA', runOnly: { tags: ['wcag2a'] }, engineOptions: { profile: 'iso-40500' } });

        assert.equal('profile' in capturedArgs[3], false);
        assert.deepEqual(capturedArgs[4].wcag, { version: '2.0', level: 'AA' });
    });

    test('records the profile core applied, with its display name, and the WCAG version', async () => {
        const page = fakePage(async () => ({
            engine: { profile: 'en301549-v3.2.1', wcagVersion: '2.1' },
            checksResults: [],
            rulesResults: []
        }));

        const { canonical } = await runOnPage(page, { engineOptions: { profile: 'en301549-v3.2.1' } });

        assert.deepEqual(canonical.runOptions.conformanceProfile, { id: 'en301549-v3.2.1', label: 'EN 301 549 V3.2.1' });
        assert.equal(canonical.runOptions.wcagVersion, '2.1');
    });

    test('records no profile when core did not apply one', async () => {
        const page = fakePage(async () => ({ engine: { wcagVersion: '2.2' }, checksResults: [], rulesResults: [] }));

        const { canonical } = await runOnPage(page, {
            runOnly: { includeRuleIds: ['image-alt'] },
            engineOptions: { profile: 'wcag22-aa' }
        });

        assert.equal(canonical.runOptions.conformanceProfile, null);
    });
});

describe('a11y-labs-engine: runOnPage - results language', () => {
    function pageAnswering(resolved) {
        return fakePage(async () => ({
            engine: { locale: { requested: resolved, resolved, reason: 'ok' } },
            checksResults: [{
                ruleId: 'img-alt-present',
                outcome: 'fail',
                severity: 'critical',
                occurrences: [{ selector: 'img', html: '<img>', summary: 'x' }]
            }],
            rulesResults: []
        }));
    }

    test('findings in another language carry it as lang, and the run records the locale', async () => {
        const { canonical } = await runOnPage(pageAnswering('de'), {
            runOnly: { includeRuleIds: ['img-alt-present'] },
            engineOptions: { locale: 'de', findingsSource: 'atomic' }
        });
        assert.ok(canonical.findings.length > 0);
        for (const f of canonical.findings) assert.equal(f.lang, 'de');
        assert.equal(canonical.runOptions.locale.resolved, 'de');
    });

    test('English findings get no lang', async () => {
        const { canonical } = await runOnPage(pageAnswering('en'), {
            runOnly: { includeRuleIds: ['img-alt-present'] },
            engineOptions: { findingsSource: 'atomic' }
        });
        for (const f of canonical.findings) assert.equal('lang' in f, false);
    });
});

describe('a11y-labs-engine: results languages', () => {
    const core = require('@surea11y/core');
    const { LOCALES } = require('./a11y-labs-engine');
    const { ACTION_DEFINITIONS } = require('../../workflow/action-definitions.js');

    test('offers exactly the languages core ships a dictionary for, in the scan step too', () => {
        const shipped = ['en', ...core.getLocaleCoverage().locales.map((l) => l.locale)].sort();
        assert.deepEqual(Object.keys(LOCALES).sort(), shipped);
        assert.deepEqual(ACTION_DEFINITIONS.a11yScan.fields.locale.options.map((o) => o.value).sort(), shipped);
    });

    test('every offered translation is complete, so no finding falls back to English', () => {
        for (const l of core.getLocaleCoverage().locales) {
            assert.equal(l.percent, 100, `${l.locale}: ${l.missing} strings missing`);
        }
    });
});

describe('a11y-labs-engine: getRulesForRunOnly follows the scan', () => {
    const { getRulesForRunOnly } = require('./a11y-labs-engine');
    const ids = async (...args) => (await getRulesForRunOnly(null, ...args)).map((r) => r.ruleId);

    test('applies the scan\'s WCAG level to its tags, as the scan does', async () => {
        const withoutLevel = await ids({ tags: ['wcag2a'] });
        const withLevel = await ids({ tags: ['wcag2a'] }, { wcagLevel: 'AA' });
        assert.ok(!withoutLevel.includes('contrast-minimum'));
        assert.ok(withLevel.includes('contrast-minimum'), 'an AA rule is listed for an AA scan');
    });

    test('lists no rule when every included id is another engine\'s, as the scan runs none', async () => {
        assert.deepEqual(await ids({ includeRuleIds: ['color-contrast'] }), []);
        assert.deepEqual(await ids({ includeRuleIds: ['color-contrast', 'img-alt-present'] }), ['img-alt-present']);
    });

    test('lists the rules a scan with the same options ran', async () => {
        let ranWith;
        await runOnPage(fakePage(async (...args) => { ranWith = args[4]; return { checksResults: [], rulesResults: [] }; }), {
            runOnly: { tags: ['wcag2a'], excludeRuleIds: ['region'] }, wcagLevel: 'AA'
        });
        const listed = await ids({ tags: ['wcag2a'], excludeRuleIds: ['region'] }, { wcagLevel: 'AA' });
        const core = require('@surea11y/core');
        assert.deepEqual(listed, core.getChecksForRunOnly(ranWith, { locale: 'en' }).map((r) => r.ruleId));
    });
});

describe('a11y-labs-engine: the scan\'s selection', () => {
    function capture() {
        const calls = [];
        const page = fakePage(async (...args) => { calls.push(args); return { engine: { profile: args[3] && args[3].profile }, checksResults: [], rulesResults: [] }; });
        return { page, calls, last: () => calls[calls.length - 1] };
    }

    test('goes to core as its WCAG target and best-practice switch, and is recorded', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, last } = capture();
        const { canonical } = await runOnPage(page, {
            selection: { version: '2.1', level: 'AA', profile: null, bestPractices: true },
            runOnly: { excludeRuleIds: ['region'] }
        });
        assert.deepEqual(last()[4].wcag, { version: '2.1', level: 'AA' });
        assert.equal(last()[4].bestPractices, true);
        assert.deepEqual(last()[4].excludeRuleIds, ['region']);
        assert.deepEqual(canonical.runOptions.wcagTarget, { version: '2.1', level: 'AA' });
    });

    test('the rules a step includes are the ones it runs: the target steps aside, its version stays', async () => {
        // Beside a target core would add them to the target's rules.
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, last } = capture();
        await runOnPage(page, {
            selection: { version: '2.1', level: 'AA', profile: null, bestPractices: true },
            runOnly: { includeRuleIds: ['img-alt-present'] }
        });
        assert.equal(last()[4].wcag, undefined);
        assert.equal(last()[4].bestPractices, undefined);
        assert.deepEqual(last()[4].tags ?? [], []);
        assert.deepEqual(last()[4].includeRuleIds, ['img-alt-present']);
        assert.equal(last()[3].wcagVersion, '2.1');
        assert.equal(last()[3].wcagLevel, 'AA', 'so core reports no criterion above the scan\'s level');
    });

    test('included rules run alone against core itself, and the recorded rule list agrees', async () => {
        const { getRulesForRunOnly } = require('./a11y-labs-engine');
        const selection = { version: '2.2', level: 'AA', profile: null, bestPractices: false };
        const only = await getRulesForRunOnly({}, { includeRuleIds: ['contrast-minimum'] }, { selection });
        assert.deepEqual(only.map((r) => r.ruleId || r.id), ['contrast-minimum']);
        const byTag = await getRulesForRunOnly({}, { includeTags: ['contrast'] }, { selection });
        assert.ok(byTag.length > 0 && byTag.length < 10, `a few contrast rules, not the target's (${byTag.length})`);
        assert.ok(byTag.every((r) => (r.tags || []).includes('contrast')));
        assert.ok(!byTag.some((r) => (r.ruleId || r.id) === 'contrast-enhanced'), 'no AAA check on an AA scan');
        const aaa = await getRulesForRunOnly({}, { includeTags: ['contrast'] }, { selection: { ...selection, level: 'AAA' } });
        assert.ok(aaa.some((r) => (r.ruleId || r.id) === 'contrast-enhanced'), 'on an AAA scan it is in');
        const named = await getRulesForRunOnly({}, { includeRuleIds: ['contrast-enhanced'] }, { selection });
        assert.deepEqual(named.map((r) => r.ruleId || r.id), ['contrast-enhanced'], 'a rule named by id runs as named');
        const bp = await getRulesForRunOnly({}, { includeTags: ['best-practice'] }, { selection });
        assert.ok(bp.length > 0, 'rules that check no criterion are taken as the tag names them');
        const all = await getRulesForRunOnly({}, null, { selection });
        assert.ok(all.length > 30, 'with nothing included, the target');
    });

    test('include tags that select no rule run none, and say so, rather than every rule', async () => {
        const { runOnPage, getRulesForRunOnly } = require('./a11y-labs-engine');
        const selection = { version: '2.2', level: 'AA', profile: null, bestPractices: false };
        assert.deepEqual(await getRulesForRunOnly({}, { includeTags: ['no-such-tag'] }, { selection }), []);
        const { page, calls } = capture();
        const { canonical } = await runOnPage(page, { selection, runOnly: { includeTags: ['no-such-tag'] } });
        assert.equal(calls.length, 0, 'core is not asked to run anything');
        assert.match(canonical.notices.find((n) => n.code === 'no-known-rules').message, /no surea11y rule matches the tags this scan includes \(no-such-tag\)\./);
    });

    test('a standard goes to core as its profile, without a target', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, calls } = capture();
        await runOnPage(page, { selection: { version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices: false } });
        assert.equal(calls.length, 1);
        assert.equal(calls[0][4], null);
        assert.equal(calls[0][3].profile, 'en301549-v3.2.1');
    });

    test('best-practices add to a standard: core gets the profile and its switch', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, calls } = capture();
        await runOnPage(page, { selection: { version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices: true } });
        assert.equal(calls.length, 1);
        assert.equal(calls[0][3].profile, 'en301549-v3.2.1');
        assert.equal(calls[0][4].bestPractices, true);
        assert.equal('wcag' in calls[0][4], false);
        assert.deepEqual(calls[0][4].tags ?? [], []);
    });

    test('the recorded rule list of a standard with best-practices has both', async () => {
        const { getRulesForRunOnly } = require('./a11y-labs-engine');
        const sel = (bestPractices) => ({ selection: { version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices } });
        const without = (await getRulesForRunOnly(null, null, sel(false))).map((r) => r.ruleId);
        const withBp = (await getRulesForRunOnly(null, null, sel(true))).map((r) => r.ruleId);
        assert.ok(without.includes('duplicate-id'), 'EN 301 549 V3.2.1 keeps 4.1.1');
        assert.ok(!without.includes('region'));
        assert.ok(withBp.includes('duplicate-id') && withBp.includes('region'));
    });

    test('a caller\'s WCAG tags and level make a selection of their highest version', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, last } = capture();
        await runOnPage(page, { runOnly: { tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'] } });
        assert.deepEqual(last()[4].wcag, { version: '2.2', level: 'AA' });
        assert.equal(last()[4].bestPractices, true);
        assert.deepEqual(last()[4].tags ?? [], []);

        await runOnPage(page, { wcagLevel: 'A', runOnly: { tags: ['wcag2aa', 'wcag22aa'] } });
        assert.deepEqual(last()[4].wcag, { version: '2.2', level: 'A' });
    });

    test('a caller\'s own runOnly.wcag passes through, the scan\'s level setting the level', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, last } = capture();
        await runOnPage(page, { runOnly: { wcag: { version: '2.1', level: 'aa' }, bestPractices: true } });
        assert.deepEqual(last()[4].wcag, { version: '2.1', level: 'AA' });
        assert.equal(last()[4].bestPractices, true);

        await runOnPage(page, { wcagLevel: 'AAA', runOnly: { wcag: { version: '2.2', level: 'AA' } } });
        assert.deepEqual(last()[4].wcag, { version: '2.2', level: 'AAA' });
        assert.equal('bestPractices' in last()[4], false);
    });

    test('without a selection or WCAG tags, core runs as it would', async () => {
        const { runOnPage } = require('./a11y-labs-engine');
        const { page, last } = capture();
        await runOnPage(page, {});
        assert.equal(last()[4], null);
        await runOnPage(page, { runOnly: { includeTags: ['keyboard'] } });
        assert.equal('wcag' in last()[4], false);
    });

    test('the recorded rule list follows the selection: 4.1.1 is out under 2.2 and in under 2.1', async () => {
        const { getRulesForRunOnly } = require('./a11y-labs-engine');
        const sel = (version) => ({ selection: { version, level: 'A', profile: null, bestPractices: false } });
        const ids22 = (await getRulesForRunOnly(null, null, sel('2.2'))).map((r) => r.ruleId);
        const ids21 = (await getRulesForRunOnly(null, null, sel('2.1'))).map((r) => r.ruleId);
        assert.ok(ids21.includes('duplicate-id'));
        assert.ok(!ids22.includes('duplicate-id'));
    });
});
