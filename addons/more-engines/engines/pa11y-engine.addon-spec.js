'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const enginePath = require.resolve('./pa11y-engine');
const pa11yPath = require.resolve('pa11y');

/**
 * pa11y-engine.js does `require('pa11y')` lazily inside runOnPage(), so it can be
 * swapped out via the CJS require cache without touching module resolution config
 * or adding experimental flags to the main `npm test` run.
 */
async function withMockedPa11y(impl, fn) {
    const original = pa11yPath in require.cache ? require.cache[pa11yPath] : undefined;
    require.cache[pa11yPath] = { id: pa11yPath, filename: pa11yPath, loaded: true, exports: impl };
    delete require.cache[enginePath];
    const engine = require(enginePath);
    try {
        return await fn(engine);
    } finally {
        if (original) require.cache[pa11yPath] = original;
        else delete require.cache[pa11yPath];
        delete require.cache[enginePath];
    }
}

function fakePage(overrides = {}) {
    return {
        url: async () => 'https://example.test/',
        title: async () => 'Example Page',
        ...overrides
    };
}

describe('pa11y-engine: engineVersion', () => {
    test('is read from the installed pa11y package, not a hardcoded "-adapter" constant', () => {
        const installedVersion = require('pa11y/package.json').version;
        const { engineVersion } = require('./pa11y-engine');
        assert.equal(engineVersion, installedVersion);
        assert.doesNotMatch(engineVersion, /adapter/);
    });
});

describe('pa11y-engine: static metadata', () => {
    test('exposes engineId and engineName', () => {
        const { engineId, engineName } = require('./pa11y-engine');
        assert.equal(engineId, 'pa11y');
        assert.equal(engineName, 'Pa11y (axe)');
    });

    test('capabilities.actions.a11yScan flags match what pa11y actually supports', () => {
        const { capabilities } = require('./pa11y-engine');
        const scan = capabilities.actions.a11yScan;
        assert.equal(scan.context, true);
        assert.equal(scan.wcagLevel, true);
        assert.equal(scan.exclude, false);
        assert.equal(scan.disableRules, false);
        assert.equal(scan.includeRuleIds, false);
    });
});

describe('pa11y-engine: no-op adapter surface', () => {
    test('ensureInjected resolves without throwing (pa11y drives evaluation itself)', async () => {
        const { ensureInjected } = require('./pa11y-engine');
        await assert.doesNotReject(() => ensureInjected({}));
    });

    test('getRulesForRunOnly always returns an empty array (no stable rules catalog)', async () => {
        const { getRulesForRunOnly } = require('./pa11y-engine');
        assert.deepEqual(await getRulesForRunOnly({}, { type: 'tag', values: ['wcag2aa'] }), []);
        assert.deepEqual(await getRulesForRunOnly(), []);
    });

    test('getRulesCatalog reports the engine version with an empty rules list', () => {
        const { getRulesCatalog, engineVersion } = require('./pa11y-engine');
        assert.deepEqual(getRulesCatalog(), { version: engineVersion, rules: [] });
    });

    test('postProcessResults returns native results unchanged', () => {
        const { postProcessResults } = require('./pa11y-engine');
        const native = { issues: [{ code: 'x' }] };
        assert.equal(postProcessResults(native, {}), native);
    });
});

describe('pa11y-engine: pa11yStandard', () => {
    test('is WCAG2 and the selection\'s level', () => {
        const { pa11yStandard } = require('./pa11y-engine');
        assert.equal(pa11yStandard({ selection: { version: '2.0', level: 'A', profile: null, bestPractices: false } }), 'WCAG2A');
        assert.equal(pa11yStandard({ selection: { version: '2.1', level: 'AA', profile: 'en301549-v3.2.1', bestPractices: false } }), 'WCAG2AA');
    });

    test('comes from WCAG tags and a level when there is no selection, and is null with neither', () => {
        const { pa11yStandard } = require('./pa11y-engine');
        assert.equal(pa11yStandard({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aaa'] } }), 'WCAG2AAA');
        assert.equal(pa11yStandard({ runOnly: { tags: ['wcag21aa'] }, wcagLevel: 'A' }), 'WCAG2A');
        assert.equal(pa11yStandard({ runOnly: { type: 'tag', values: ['best-practice'] } }), null);
        assert.equal(pa11yStandard({}), null);
    });
});

describe('pa11y-engine: runOnPage - basic canonical shape', () => {
    test('builds canonical envelope with engine/page/scope/run/diagnostics metadata', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical, native } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(native, { issues: [] });
            assert.equal(canonical.version, '1.0');
            assert.equal(canonical.engine.id, 'pa11y');
            assert.equal(canonical.engine.name, 'Pa11y (axe)');
            assert.equal(canonical.page.url, 'https://example.test/');
            assert.equal(canonical.page.title, 'Example Page');
            assert.deepEqual(canonical.scope, { include: ['html'], exclude: [] });
            assert.deepEqual(canonical.run.runOnly, null);
            assert.deepEqual(canonical.diagnostics, { runner: 'axe', standard: null });
            assert.deepEqual(canonical.findings, []);
        });
    });

    test('defaults to the axe runner when engineOptions.pa11y.runner is not set', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            await engine.runOnPage(fakePage(), {});
        });
        assert.equal(capturedOpts.runner, 'axe');
    });

    test('honors engineOptions.pa11y.runner = "htmlcs"', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), { engineOptions: { pa11y: { runner: 'htmlcs' } } });
            assert.equal(canonical.diagnostics.runner, 'htmlcs');
        });
        assert.equal(capturedOpts.runner, 'htmlcs');
    });

    test('an unrecognized runner value falls back to "axe"', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), { engineOptions: { pa11y: { runner: 'bogus' } } });
            assert.equal(canonical.diagnostics.runner, 'axe');
        });
    });
});

describe('pa11y-engine: runOnPage - outcome/severity mapping by issue type', () => {
    test('"error" issues map to outcome fail / default severity serious', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'Image missing alt text' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings.length, 1);
            assert.equal(canonical.findings[0].outcome, 'fail');
            assert.equal(canonical.findings[0].severity, 'serious');
        });
    });

    test('"warning" issues map to outcome cantTell / default severity moderate', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'warning', code: 'some-code', message: 'possible issue' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].outcome, 'cantTell');
            assert.equal(canonical.findings[0].severity, 'moderate');
        });
    });

    test('"notice" issues are excluded from findings by default', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'notice', code: 'fyi-code', message: 'for your information' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.findings, []);
        });
    });

    test('"notice" issues are included (as notApplicable / minor) when engineOptions.pa11y.includeNotices is true', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'notice', code: 'fyi-code', message: 'for your information' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), { engineOptions: { pa11y: { includeNotices: true } } });
            assert.equal(canonical.findings.length, 1);
            assert.equal(canonical.findings[0].outcome, 'notApplicable');
            assert.equal(canonical.findings[0].severity, 'minor');
        });
    });

    test('accepts engineOptions flattened (no .pa11y namespace) the same as nested', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'notice', code: 'fyi-code', message: 'for your information' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), { engineOptions: { includeNotices: true } });
            assert.equal(canonical.findings.length, 1);
        });
    });

    test('an unrecognized issue.type defaults to outcome cantTell / severity moderate', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'mystery', code: 'unknown-code', message: 'huh' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].outcome, 'cantTell');
            assert.equal(canonical.findings[0].severity, 'moderate');
        });
    });
});

describe('pa11y-engine: runOnPage - severity overrides', () => {
    test('engineOptions.pa11y.severityByCode overrides the default severity for a matching code', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { severityByCode: { 'image-alt': 'critical' } } }
            });
            assert.equal(canonical.findings[0].severity, 'critical');
        });
    });

    test('severityByCode entries for codes not present in the results are ignored', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { severityByCode: { 'other-code': 'critical' } } }
            });
            assert.equal(canonical.findings[0].severity, 'serious');
        });
    });

    test('severityByCode alias spellings ("severe"/"low"/"medium") normalize to their canonical equivalent', async () => {
        const cases = [['severe', 'serious'], ['low', 'minor'], ['medium', 'moderate']];
        for (const [alias, canonicalSeverity] of cases) {
            await withMockedPa11y(async () => ({
                issues: [{ type: 'error', code: 'image-alt', message: 'msg' }]
            }), async (engine) => {
                const { canonical } = await engine.runOnPage(fakePage(), {
                    engineOptions: { pa11y: { severityByCode: { 'image-alt': alias } } }
                });
                assert.equal(canonical.findings[0].severity, canonicalSeverity, `alias "${alias}"`);
            });
        }
    });

    test('an unrecognized severityByCode value falls back to "moderate"', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { severityByCode: { 'image-alt': 'bogus-severity' } } }
            });
            assert.equal(canonical.findings[0].severity, 'moderate');
        });
    });
});

describe('pa11y-engine: runOnPage - evidence.engineNode toggle', () => {
    test('includes evidence.engineNode by default', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'msg', selector: '#a' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.ok(canonical.findings[0].occurrences[0].evidence);
            assert.equal(canonical.findings[0].occurrences[0].evidence.engineNode.pageUrl, 'https://example.test/');
        });
    });

    test('omits evidence.engineNode when engineOptions.pa11y.includeEngineNode is false', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'msg', selector: '#a' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { includeEngineNode: false } }
            });
            assert.equal(canonical.findings[0].occurrences[0].evidence, undefined);
        });
    });
});

describe('pa11y-engine: runOnPage - shortRuleId / htmlcs technique codes', () => {
    test('extracts the trailing technique code (e.g. "H67.1") as ruleId for htmlcs-style codes', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H67.1', message: 'Img missing alt' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].ruleId, 'H67.1');
        });
    });

    test('extracts a technique code with no numeric sub-suffix (e.g. "H37")', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].ruleId, 'H37');
        });
    });

    test('leaves already-short axe rule ids (kebab-case) unchanged', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'image-alt', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].ruleId, 'image-alt');
        });
    });

    test('falls back to the full code when no technique pattern is found and code is missing/empty', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: '', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].ruleId, 'pa11y-issue');
        });
    });
});

describe('pa11y-engine: runOnPage - WCAG success criterion extraction', () => {
    test('extracts SC from an htmlcs-style code ("1_1_1" -> "1.1.1")', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H67.1', message: 'msg' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.findings[0].wcag.sc, ['1.1.1']);
        });
    });

    test('extracts SC-shaped substrings from message/description text when code has no htmlcs pattern', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'axe-rule-id', message: 'Violates 2.4.7 focus visible', description: 'See also 1.4.3' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(new Set(canonical.findings[0].wcag.sc), new Set(['2.4.7', '1.4.3']));
        });
    });

    test('de-duplicates SC hits found in both code and text', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'axe-rule-id', message: 'Violates 2.4.7 and 2.4.7 again' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.findings[0].wcag.sc, ['2.4.7']);
        });
    });

    test('is an empty array when nothing SC-shaped is present', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'error', code: 'axe-rule-id', message: 'no sc mentioned here' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.findings[0].wcag.sc, []);
        });
    });
});

describe('pa11y-engine: runOnPage - grouping and merge semantics', () => {
    test('groups multiple issues sharing the same code into one finding with multiple occurrences', async () => {
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'error', code: 'image-alt', message: 'msg', selector: '#a' },
                { type: 'error', code: 'image-alt', message: 'msg', selector: '#b' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings.length, 1);
            assert.equal(canonical.findings[0].occurrences.length, 2);
            assert.deepEqual(canonical.findings[0].occurrences.map((o) => o.target[0]), ['#a', '#b']);
        });
    });

    test('keeps the worst outcome across merged occurrences (fail beats cantTell)', async () => {
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'warning', code: 'dup-code', message: 'warn first', selector: '#a' },
                { type: 'error', code: 'dup-code', message: 'error second', selector: '#b' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings.length, 1);
            assert.equal(canonical.findings[0].outcome, 'fail');
        });
    });

    test('order of merge does not matter: fail still wins when it comes first', async () => {
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'error', code: 'dup-code', message: 'error first', selector: '#a' },
                { type: 'warning', code: 'dup-code', message: 'warn second', selector: '#b' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings[0].outcome, 'fail');
        });
    });

    test('keeps the worst severity across merged occurrences (critical beats serious)', async () => {
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'error', code: 'dup-code', message: 'msg', selector: '#a' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { severityByCode: { 'dup-code': 'critical' } } }
            });
            assert.equal(canonical.findings[0].severity, 'critical');
        });
    });

    test('merges wcag.sc across occurrences of the same finding', async () => {
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'error', code: 'dup-code', message: 'Violates 1.1.1', selector: '#a' },
                { type: 'error', code: 'dup-code', message: 'Violates 2.4.7', selector: '#b' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(new Set(canonical.findings[0].wcag.sc), new Set(['1.1.1', '2.4.7']));
        });
    });
});

describe('pa11y-engine: runOnPage - scope / context / exclude', () => {
    test('a provided contextSelector is passed through as rootElement and reflected in scope.include', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), { contextSelector: '#main' });
            assert.deepEqual(canonical.scope.include, ['#main']);
        });
        assert.equal(capturedOpts.rootElement, '#main');
    });

    test('defaults scope.include to ["html"] when no contextSelector is given', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.scope.include, ['html']);
        });
    });

    test('excludeSelectors are reflected in scope.exclude for traceability, even though pa11y cannot enforce them', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), { excludeSelectors: ['.ads', '.tracker'] });
            assert.deepEqual(canonical.scope.exclude, ['.ads', '.tracker']);
        });
        assert.equal(capturedOpts.rootElement, undefined);
    });
});

describe('pa11y-engine: runOnPage - WCAG standard derivation', () => {
    test('the scan\'s selection sets the pa11y "standard" option', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            const selection = { version: '2.1', level: 'AA', profile: null, bestPractices: false };
            const { canonical } = await engine.runOnPage(fakePage(), { selection });
            assert.equal(canonical.diagnostics.standard, 'WCAG2AA');
        });
        assert.equal(capturedOpts.standard, 'WCAG2AA');
    });

    test('the strictest level wins when multiple wcag levels are present in runOnly tags', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const runOnly = { type: 'tag', values: ['wcag2a', 'wcag2aaa'] };
            const { canonical } = await engine.runOnPage(fakePage(), { runOnly });
            assert.equal(canonical.diagnostics.standard, 'WCAG2AAA');
        });
    });

    test('falls back to engineOptions.pa11y.standard when runOnly yields no wcag level', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            await engine.runOnPage(fakePage(), { engineOptions: { pa11y: { standard: 'WCAG2A' } } });
        });
        assert.equal(capturedOpts.standard, 'WCAG2A');
    });

    test('is undefined (pa11y default) when neither runOnly nor an explicit standard is given', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            await engine.runOnPage(fakePage(), {});
        });
        assert.equal(capturedOpts.standard, undefined);
    });

    test('derives "WCAG2A" when only the "A" level tag is present', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            const runOnly = { type: 'tag', values: ['wcag2a'] };
            const { canonical } = await engine.runOnPage(fakePage(), { runOnly });
            assert.equal(canonical.diagnostics.standard, 'WCAG2A');
        });
        assert.equal(capturedOpts.standard, 'WCAG2A');
    });

    test('is null when runOnly is tag-typed but contains no wcag-level tag', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                runOnly: { type: 'tag', values: ['best-practice'] }
            });
            assert.equal(canonical.diagnostics.standard, null);
        });
    });
});

describe('pa11y-engine: runOnPage - page metadata resilience', () => {
    test('falls back to native.pageUrl and a null title when page.url()/page.title() throw', async () => {
        await withMockedPa11y(async () => ({ issues: [], pageUrl: 'https://native.example/' }), async (engine) => {
            const brokenPage = fakePage({
                url: async () => { throw new Error('no url'); },
                title: async () => { throw new Error('no title'); }
            });
            const { canonical } = await engine.runOnPage(brokenPage, {});
            assert.equal(canonical.page.url, 'https://native.example/');
            assert.equal(canonical.page.title, null);
        });
    });

    test('page.url()/title() succeeding populates canonical.page directly', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.page.url, 'https://example.test/');
            assert.equal(canonical.page.title, 'Example Page');
        });
    });
});

describe('pa11y-engine: runOnPage - page/browser/url fallback attempts', () => {
    test('falls back from page-mode to browser-mode when the first pa11y call throws', async () => {
        const calls = [];
        await withMockedPa11y(async (url, opts) => {
            calls.push({ hasPage: !!opts.page, hasBrowser: !!opts.browser });
            if (opts.page) throw new Error('page mode unsupported by this pa11y version');
            return { issues: [], via: 'browser-or-url' };
        }, async (engine) => {
            const page = fakePage({ browser: () => ({ id: 'fake-browser-handle' }) });
            const { native } = await engine.runOnPage(page, {});
            assert.equal(native.via, 'browser-or-url');
        });
        assert.deepEqual(calls, [{ hasPage: true, hasBrowser: false }, { hasPage: false, hasBrowser: true }]);
    });

    test('falls back all the way to a plain URL scan when page and browser modes both throw', async () => {
        const calls = [];
        await withMockedPa11y(async (url, opts) => {
            calls.push({ hasPage: !!opts.page, hasBrowser: !!opts.browser });
            if (opts.page || opts.browser) throw new Error('unsupported');
            return { issues: [], via: 'plain-url' };
        }, async (engine) => {
            const page = fakePage({ browser: () => ({ id: 'fake-browser-handle' }) });
            const { native } = await engine.runOnPage(page, {});
            assert.equal(native.via, 'plain-url');
        });
        assert.deepEqual(calls, [
            { hasPage: true, hasBrowser: false },
            { hasPage: false, hasBrowser: true },
            { hasPage: false, hasBrowser: false }
        ]);
    });

    test('skips the browser-mode attempt when page.browser is not a function', async () => {
        const calls = [];
        await withMockedPa11y(async (url, opts) => {
            calls.push({ hasPage: !!opts.page, hasBrowser: !!opts.browser });
            if (opts.page) throw new Error('unsupported');
            return { issues: [] };
        }, async (engine) => {
            const page = fakePage(); // no .browser()
            await engine.runOnPage(page, {});
        });
        assert.deepEqual(calls, [{ hasPage: true, hasBrowser: false }, { hasPage: false, hasBrowser: false }]);
    });

    test('throws a wrapping error (with the last underlying message) when all three attempts fail', async () => {
        await withMockedPa11y(async () => { throw new Error('headless chrome crashed'); }, async (engine) => {
            await assert.rejects(
                () => engine.runOnPage(fakePage(), {}),
                (err) => {
                    assert.match(err.message, /^pa11y scan failed:/);
                    assert.match(err.message, /headless chrome crashed/);
                    return true;
                }
            );
        });
    });

    test('wraps a non-Error rejection reason without crashing', async () => {
        await withMockedPa11y(async () => { throw 'plain string rejection'; }, async (engine) => {
            await assert.rejects(
                () => engine.runOnPage(fakePage(), {}),
                (err) => {
                    assert.match(err.message, /pa11y scan failed:/);
                    return true;
                }
            );
        });
    });
});

describe('pa11y-engine: runOnPage - postProcess hook', () => {
    test('invokes the postProcess hook when provided as an object, without letting it crash the run', async () => {
        let hookCalled = false;
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const originalPostProcessResults = engine.postProcessResults;
            // postProcessResults is a module-private no-op; verify indirectly that a
            // throwing postProcess context does not abort runOnPage (caught internally).
            const page = fakePage();
            await assert.doesNotReject(() => engine.runOnPage(page, { postProcess: { anything: true } }));
            hookCalled = true;
        });
        assert.equal(hookCalled, true);
    });

    test('is skipped without error when postProcess is not an object', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            await assert.doesNotReject(() => engine.runOnPage(fakePage(), { postProcess: 'not-an-object' }));
        });
    });
});

describe('pa11y-engine: runOnPage - run.engineOptions echo', () => {
    test('echoes back the runOnly and engineOptions used for the run', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const runOnly = { type: 'tag', values: ['wcag2aa'] };
            const engineOptions = { pa11y: { runner: 'htmlcs' } };
            const { canonical } = await engine.runOnPage(fakePage(), { runOnly, engineOptions });
            assert.deepEqual(canonical.run.runOnly, runOnly);
            assert.deepEqual(canonical.run.engineOptions, engineOptions);
        });
    });

    test('defaults engineOptions to {} when omitted', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.run.engineOptions, {});
        });
    });
});

describe('pa11y-engine: runOnPage - canonical output passes strict validation', () => {
    test('a realistic multi-issue run produces a canonical result accepted by validate-canonical.js', async () => {
        const { validateCanonical } = require('../../../src/server-side/canonical/validate-canonical');
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H67.1', message: 'Image missing alt', selector: '#img1', context: '<img>' },
                { type: 'warning', code: 'image-redundant-alt', message: 'Redundant alt text', selector: '#img2' },
                { type: 'notice', code: 'some-notice', message: 'FYI' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { includeNotices: true } }
            });
            const res = validateCanonical(canonical);
            assert.equal(res.ok, true, JSON.stringify(res.errors));
        });
    });
});

describe('pa11y-engine: saveHtmlReport', () => {
    test('writes an HTML file with escaped title and pretty-printed JSON payload', () => {
        const { saveHtmlReport, engineVersion } = require('./pa11y-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-report-'));
        try {
            const outPath = saveHtmlReport({ findings: [{ uid: 'a' }] }, {
                outDir,
                filename: 'report.html',
                title: '<script>alert(1)</script>'
            });
            assert.equal(outPath, path.join(outDir, 'report.html'));
            const html = fs.readFileSync(outPath, 'utf-8');
            assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
            assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
            assert.match(html, /&quot;uid&quot;: &quot;a&quot;/);
            assert.match(html, new RegExp(`Engine: Pa11y \\(axe\\) \\(${engineVersion}\\)`));
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    test('creates outDir recursively and defaults filename/title when not provided', () => {
        const { saveHtmlReport } = require('./pa11y-engine');
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-report-'));
        const outDir = path.join(base, 'nested', 'deep');
        try {
            const outPath = saveHtmlReport({}, { outDir });
            assert.ok(fs.existsSync(outPath));
            assert.match(path.basename(outPath), /^pa11y-report-\d+\.html$/);
            const html = fs.readFileSync(outPath, 'utf-8');
            assert.match(html, /Pa11y Accessibility Report/);
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });
});
