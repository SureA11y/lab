'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const basePath = require.resolve('./pa11y-engine');
const enginePath = require.resolve('./pa11y-htmlcs-engine');
const pa11yPath = require.resolve('pa11y');

/**
 * pa11y-htmlcs-engine.js is a thin wrapper around pa11y-engine.js. Both require()
 * the real 'pa11y' package lazily inside runOnPage(), so it can be swapped out via
 * the CJS require cache without experimental flags. Both ./pa11y-engine and
 * ./pa11y-htmlcs-engine need to be re-required per test so they pick up the mock.
 */
async function withMockedPa11y(impl, fn) {
    const original = pa11yPath in require.cache ? require.cache[pa11yPath] : undefined;
    require.cache[pa11yPath] = { id: pa11yPath, filename: pa11yPath, loaded: true, exports: impl };
    delete require.cache[basePath];
    delete require.cache[enginePath];
    const engine = require(enginePath);
    try {
        return await fn(engine);
    } finally {
        if (original) require.cache[pa11yPath] = original;
        else delete require.cache[pa11yPath];
        delete require.cache[basePath];
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

describe('pa11y-htmlcs-engine: static metadata', () => {
    test('reports its own identity, distinct from the base pa11y-engine', () => {
        const engine = require('./pa11y-htmlcs-engine');
        const base = require('./pa11y-engine');
        assert.equal(engine.engineId, 'pa11y-htmlcs');
        assert.equal(engine.engineName, 'Pa11y (HTML_CodeSniffer)');
        assert.notEqual(engine.engineId, base.engineId);
        assert.notEqual(engine.engineName, base.engineName);
    });

    test('engineVersion matches the base adapter (both come from the installed pa11y package)', () => {
        const engine = require('./pa11y-htmlcs-engine');
        const base = require('./pa11y-engine');
        assert.equal(engine.engineVersion, base.engineVersion);
        assert.equal(engine.engineVersion, require('pa11y/package.json').version);
    });
});

describe('pa11y-htmlcs-engine: pass-through helpers', () => {
    test('re-exports the standard helper with the same behavior as the base adapter', () => {
        const engine = require('./pa11y-htmlcs-engine');
        assert.equal(engine.pa11yStandard({ runOnly: { tags: ['wcag21aa'] } }), 'WCAG2AA');
    });

    test('re-exports capabilities identical to the base adapter', () => {
        const engine = require('./pa11y-htmlcs-engine');
        const base = require('./pa11y-engine');
        assert.deepEqual(engine.capabilities, base.capabilities);
    });

    test('ensureInjected/getRulesForRunOnly/postProcessResults/getRulesCatalog behave like the base adapter', async () => {
        const engine = require('./pa11y-htmlcs-engine');
        await assert.doesNotReject(() => engine.ensureInjected({}));
        assert.deepEqual(await engine.getRulesForRunOnly({}, {}), []);
        const native = { issues: [] };
        assert.equal(engine.postProcessResults(native, {}), native);
        assert.deepEqual(engine.getRulesCatalog(), { version: engine.engineVersion, rules: [] });
    });
});

describe('pa11y-htmlcs-engine: forces the htmlcs runner', () => {
    test('sets runner to "htmlcs" when no engineOptions are given', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            await engine.runOnPage(fakePage(), {});
        });
        assert.equal(capturedOpts.runner, 'htmlcs');
    });

    test('overrides an explicit "axe" runner request back to "htmlcs"', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { runner: 'axe' } }
            });
            assert.equal(canonical.diagnostics.runner, 'htmlcs');
        });
        assert.equal(capturedOpts.runner, 'htmlcs');
    });

    test('preserves other pa11y.* options while overriding only the runner', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            await engine.runOnPage(fakePage(), {
                engineOptions: { pa11y: { runner: 'axe', timeout: 5000, includeNotices: true } }
            });
        });
        assert.equal(capturedOpts.runner, 'htmlcs');
        assert.equal(capturedOpts.timeout, 5000);
        assert.equal(capturedOpts.includeNotices, true);
    });

    test('preserves top-level (flattened, non-.pa11y) engineOptions keys alongside the forced runner', async () => {
        await withMockedPa11y(async () => ({
            issues: [{ type: 'notice', code: 'fyi', message: 'for your information' }]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {
                engineOptions: { includeNotices: true }
            });
            // includeNotices flows through as a flattened option read by shouldIncludeNotice()
            assert.equal(canonical.findings.length, 1);
            assert.equal(canonical.diagnostics.runner, 'htmlcs');
        });
    });

    test('treats a non-object engineOptions as empty instead of throwing', async () => {
        let capturedOpts;
        await withMockedPa11y(async (url, opts) => { capturedOpts = opts; return { issues: [] }; }, async (engine) => {
            await assert.doesNotReject(() => engine.runOnPage(fakePage(), { engineOptions: 'not-an-object' }));
        });
        assert.equal(capturedOpts.runner, 'htmlcs');
    });

    test('treats non-object args as empty instead of throwing', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            await assert.doesNotReject(() => engine.runOnPage(fakePage(), null));
        });
    });

    test('does not mutate the caller-supplied args/engineOptions objects', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const engineOptions = { pa11y: { runner: 'axe', timeout: 1000 } };
            const args = { engineOptions };
            await engine.runOnPage(fakePage(), args);
            assert.equal(engineOptions.pa11y.runner, 'axe', 'caller\'s original runner value must be untouched');
            assert.equal(args.engineOptions, engineOptions);
        });
    });
});

describe('pa11y-htmlcs-engine: other runOnPage args pass through unchanged', () => {
    test('runOnly, contextSelector, and excludeSelectors are forwarded to the base adapter', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const runOnly = { type: 'tag', values: ['wcag2aa'] };
            const { canonical } = await engine.runOnPage(fakePage(), {
                runOnly,
                contextSelector: '#main',
                excludeSelectors: ['.ads']
            });
            assert.deepEqual(canonical.run.runOnly, runOnly);
            assert.deepEqual(canonical.scope, { include: ['#main'], exclude: ['.ads'] });
            assert.equal(canonical.diagnostics.standard, 'WCAG2AA');
        });
    });

    test('a realistic run produces findings with the same outcome/severity mapping as the base adapter', async () => {
        await withMockedPa11y(async () => ({
            issues: [
                { type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H67.1', message: 'Image missing alt', selector: '#img1' },
                { type: 'warning', code: 'some-warning', message: 'possible issue' },
            ]
        }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.equal(canonical.findings.length, 2);
            const fail = canonical.findings.find((f) => f.ruleId === 'H67.1');
            assert.equal(fail.outcome, 'fail');
            assert.equal(fail.severity, 'serious');
            const cantTell = canonical.findings.find((f) => f.ruleId === 'some-warning');
            assert.equal(cantTell.outcome, 'cantTell');
        });
    });
});

describe('pa11y-htmlcs-engine: canonical.engine identity (regression)', () => {
    test('stamps canonical.engine with its own identity, not the base pa11y-engine\'s', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const { canonical } = await engine.runOnPage(fakePage(), {});
            assert.deepEqual(canonical.engine, {
                id: 'pa11y-htmlcs',
                name: 'Pa11y (HTML_CodeSniffer)',
                version: engine.engineVersion
            });
        });
    });

    test('does not affect the base adapter\'s own canonical.engine when required independently', async () => {
        await withMockedPa11y(async () => ({ issues: [] }), async (engine) => {
            const base = require('./pa11y-engine');
            const { canonical } = await base.runOnPage(fakePage(), {});
            assert.equal(canonical.engine.id, 'pa11y');
            assert.equal(canonical.engine.name, 'Pa11y (axe)');
        });
    });
});

describe('pa11y-htmlcs-engine: error propagation', () => {
    test('propagates the base adapter\'s wrapped error when all pa11y attempts fail', async () => {
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
});

describe('pa11y-htmlcs-engine: saveHtmlReport identity (regression)', () => {
    test('labels the exported report with its own engine name/version, not the base adapter\'s', () => {
        const engine = require('./pa11y-htmlcs-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-htmlcs-report-'));
        try {
            const outPath = engine.saveHtmlReport({ findings: [] }, { outDir, filename: 'report.html' });
            const html = fs.readFileSync(outPath, 'utf-8');
            assert.match(html, /Engine: Pa11y \(HTML_CodeSniffer\)/);
            assert.doesNotMatch(html, /Engine: Pa11y \(axe\)/);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    test('an explicit meta.engineName/meta.engineVersion override still wins', () => {
        const engine = require('./pa11y-htmlcs-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-htmlcs-report-'));
        try {
            const outPath = engine.saveHtmlReport({}, {
                outDir,
                filename: 'report.html',
                engineName: 'Custom Name',
                engineVersion: '0.0.0-custom'
            });
            const html = fs.readFileSync(outPath, 'utf-8');
            assert.match(html, /Engine: Custom Name \(0\.0\.0-custom\)/);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    test('does not mutate the caller-supplied meta object', () => {
        const engine = require('./pa11y-htmlcs-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-htmlcs-report-'));
        try {
            const meta = { outDir, filename: 'report.html' };
            engine.saveHtmlReport({}, meta);
            assert.equal(meta.engineName, undefined);
            assert.equal(meta.engineVersion, undefined);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    test('the base adapter\'s own saveHtmlReport is unaffected and still labels itself "Pa11y (axe)"', () => {
        const base = require('./pa11y-engine');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-axe-report-'));
        try {
            const outPath = base.saveHtmlReport({}, { outDir, filename: 'report.html' });
            const html = fs.readFileSync(outPath, 'utf-8');
            assert.match(html, /Engine: Pa11y \(axe\)/);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });
});
