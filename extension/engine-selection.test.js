'use strict';

// Tests for the extension's engine: it scans with surea11y alone, so the
// registry resolves surea11y, the panel offers no choice, and the background
// dispatch reports an engine it lacks rather than falling back to another.
// The adapter is a plain script that attaches itself to globalThis, so it is
// required for its side effects. node's test runner isolates each file in its
// own process.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let REGISTRY;
let SUREA11Y;

before(() => {
    // The background worker loads the shared selection module first.
    globalThis.A11Y_CONFORMANCE_TARGETS = require('./conformance-targets.js');
    globalThis.A11Y_CANONICAL = require('./canonical-shared.js');
    require('./engines/a11y-extension-surea11y-engine.js');
    require('./a11y-extension-engine.js');

    REGISTRY = globalThis.A11Y_EXTENSION_ENGINE;
    SUREA11Y = globalThis.A11Y_EXTENSION_A11Y_LABS_ENGINE;
});

describe('engine registry', () => {
    test('surea11y registers itself, and is the only engine', () => {
        assert.equal(SUREA11Y.engineId, '@surea11y');
        assert.deepEqual(REGISTRY.listEngines().map((e) => e.id), ['@surea11y']);
    });

    test('the panel offers no choice of engine or language: it scans with surea11y, in English', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
        assert.doesNotMatch(html, /id="engineSelect"|id="resultsLanguage"/);
        const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
        assert.match(main, /const DEFAULT_EXTENSION_ENGINE_ID = '@surea11y';/);
        assert.match(main, /engineOptions: \{ locale: RESULTS_LANGUAGE \}/);
        assert.match(main, /const RESULTS_LANGUAGE = 'en';/);
    });

    test('an absent or blank id resolves surea11y', () => {
        assert.equal(REGISTRY.resolveEngine(), SUREA11Y);
        assert.equal(REGISTRY.resolveEngine('  '), SUREA11Y);
        assert.equal(REGISTRY.getDefaultEngineId(), '@surea11y');
    });

    test('an unknown id is rejected rather than silently defaulted', () => {
        assert.throws(() => REGISTRY.resolveEngine('other-engine'), /Unsupported extension engine: other-engine/);
    });

    test('the extension ships no other engine', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        assert.deepEqual(fs.readdirSync(path.join(__dirname, 'engines')).filter((f) => f.endsWith('.js')), ['a11y-extension-surea11y-engine.js']);
        for (const file of ['manifest.json', 'manifest.firefox.json', 'popup.html', 'panel.html', 'background.js']) {
            const refs = fs.readFileSync(path.join(__dirname, file), 'utf8').match(/engines\/[\w./-]+\.js/g) || [];
            assert.deepEqual(refs.filter((ref) => !/^engines\/(a11y-extension-surea11y-engine|vendor\/surea11y[\w.-]*)\.js$/.test(ref)), [], file);
        }
    });
});

describe('background dispatch: resolve or report', () => {
    function dispatch(engineId, registry) {
        const DEFAULT = '@surea11y';
        const resolve = (id) => registry[String(id || DEFAULT).trim() || DEFAULT] || null;

        return (method) => {
            const engine = resolve(engineId);
            if (!engine || typeof engine[method] !== 'function') {
                throw new Error(`Unsupported extension engine: ${engineId || DEFAULT}`);
            }
            return engine;
        };
    }

    test('surea11y dispatches to its adapter for both injection and running', () => {
        const pick = dispatch('@surea11y', {'@surea11y': SUREA11Y});
        assert.equal(pick('ensureInjected'), SUREA11Y);
        assert.equal(pick('runInTab'), SUREA11Y);
    });

    test('an unknown engine reports rather than falling back to surea11y', () => {
        const pick = dispatch('other-engine', {'@surea11y': SUREA11Y});
        assert.throws(() => pick('ensureInjected'), /Unsupported extension engine: other-engine/);
    });

    test('an adapter that failed to load reports rather than scanning with nothing', () => {
        const pick = dispatch('@surea11y', {});
        assert.throws(() => pick('runInTab'), /Unsupported extension engine: @surea11y/);
    });

    test('an adapter missing the method it is asked for is rejected, not called', () => {
        const pick = dispatch('@surea11y', {'@surea11y': {engineId: '@surea11y'}});
        assert.throws(() => pick('runInTab'), /Unsupported extension engine: @surea11y/);
    });

    test('the real background source resolves before injecting', () => {
        const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'background.js'), 'utf8');
        assert.match(src, /function requireResolvedExtensionEngine/,
            'the dispatch must go through the resolve-or-throw helper');
    });
});

describe('surea11y adapter: results language', () => {
    let seenCfg;
    let catalogCfg;

    // The page-side function looks the runtime up on globalThis; this one
    // records what it was given and answers in the language it was asked for.
    beforeEach(() => {
        seenCfg = null;
        catalogCfg = null;
        const dom = new JSDOM('<!doctype html><html><head><title>Shop</title></head><body><img></body></html>', {url: 'https://example.test/'});
        globalThis.window = dom.window;
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;
        globalThis.A11Y_LABS_BROWSER = {
            runa11yCoreInPage: (_url, _ctx, cfg) => {
                seenCfg = cfg;
                return {
                    engine: {locale: {requested: cfg.locale, resolved: cfg.locale, reason: 'ok'}},
                    checksResults: [{
                        ruleId: 'img-alt-present',
                        outcome: 'fail',
                        severity: 'critical',
                        occurrences: [{selector: 'img', html: '<img>', summary: 'alt 属性がありません。', hint: 'alt 属性を追加してください。'}]
                    }],
                    rulesResults: []
                };
            },
            getChecksCatalog: (cfg) => {
                catalogCfg = cfg;
                return [{ruleId: 'img-alt-present', title: '<img> 要素には alt 属性が必要', tags: []}];
            }
        };
    });

    const execInTab = (_tabId, details) => Promise.resolve([details.func.apply(globalThis, details.args)]);

    test('the chosen language reaches the engine and its rule catalog', async () => {
        await SUREA11Y.runInTab(1, {engineOptions: {locale: 'ja'}}, {execInTab});

        assert.equal(seenCfg.locale, 'ja');
        assert.equal(catalogCfg.locale, 'ja', 'rule titles would stay in English otherwise');
    });

    test('names the core release the result reports, not the bundle\'s schema version', async () => {
        const run = globalThis.A11Y_LABS_BROWSER.runa11yCoreInPage;
        globalThis.A11Y_LABS_BROWSER.version = '1.0.0';
        globalThis.A11Y_LABS_BROWSER.runa11yCoreInPage = (...args) => {
            const out = run(...args);
            out.engine.version = '1.10.0';
            return out;
        };
        try {
            const native = await SUREA11Y.runInTab(1, {}, {execInTab});
            assert.equal(native.engineVersion, '1.10.0');
            assert.equal(SUREA11Y.canonicalize(native).engine.version, '1.10.0');
        } finally {
            globalThis.A11Y_LABS_BROWSER.runa11yCoreInPage = run;
            delete globalThis.A11Y_LABS_BROWSER.version;
        }
    });

    test('passes core a runOnly with only the keys core reads', async () => {
        const CORE_KEYS = ['type', 'values', 'wcag', 'bestPractices', 'tags', 'excludeTags', 'includeRuleIds',
            'excludeRuleIds', 'includeTestIds', 'excludeTestIds', 'includeMode', 'optInTags'];
        const run = globalThis.A11Y_LABS_BROWSER.runa11yCoreInPage;
        const seen = [];
        globalThis.A11Y_LABS_BROWSER.runa11yCoreInPage = (...args) => {
            seen.push(args[3]);
            return run(...args);
        };
        try {
            await SUREA11Y.runInTab(1, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa']}}, {execInTab});
            await SUREA11Y.runInTab(1, {runOnly: {tags: ['wcag2a'], includeTags: ['wcag21a'], excludeRuleIds: []}}, {execInTab});
            for (const runOnly of seen) {
                assert.deepEqual(Object.keys(runOnly).filter((k) => !CORE_KEYS.includes(k)), [], 'core warns about any other key');
            }
            for (const runOnly of seen) {
                const emptyLists = Object.entries(runOnly).filter(([k, v]) => k !== 'tags' && Array.isArray(v) && !v.length);
                assert.deepEqual(emptyLists, [], 'an empty list is left out');
            }
        } finally {
            globalThis.A11Y_LABS_BROWSER.runa11yCoreInPage = run;
        }
    });

    test('asks the engine for EN 301 549 mappings, keeping any others requested', async () => {
        await SUREA11Y.runInTab(1, {}, {execInTab});
        assert.deepEqual(seenCfg.mappings, ['en301549']);

        await SUREA11Y.runInTab(1, {engineOptions: {mappings: ['section508']}}, {execInTab});
        assert.deepEqual(seenCfg.mappings, ['section508', 'en301549']);

        await SUREA11Y.runInTab(1, {engineOptions: {mappings: ['en301549:V4.1.1']}}, {execInTab});
        assert.deepEqual(seenCfg.mappings, ['en301549:V4.1.1'], 'a version already asked for is left as it is');
    });

    test('findings in another language are marked with it; English ones are not', async () => {
        const nativeJa = await SUREA11Y.runInTab(1, {engineOptions: {locale: 'ja'}}, {execInTab});
        const ja = SUREA11Y.canonicalize(nativeJa, {runOptions: {engineOptions: {findingsSource: 'atomic'}}});
        assert.equal(ja.findings[0].lang, 'ja');
        assert.equal(ja.findings[0].title, '<img> 要素には alt 属性が必要');
        assert.equal(ja.findings[0].occurrences[0].hint, 'alt 属性を追加してください。');

        const nativeEn = await SUREA11Y.runInTab(1, {}, {execInTab});
        const en = SUREA11Y.canonicalize(nativeEn, {runOptions: {engineOptions: {findingsSource: 'atomic'}}});
        assert.equal('lang' in en.findings[0], false);
    });
});
