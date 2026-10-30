'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildViewportFromPreset } = require('./scan-inputs.js');
const {
    SPEC_TYPE,
    SPEC_VERSION,
    isUiConfig,
    isRunSpec,
    buildRunSpec,
    runSpecFromUiConfig,
    normalizeRunSpec,
} = require('./run-spec.js');

const DEPS = { buildViewportFromPreset };

function specWith(extra = {}) {
    return {
        type: SPEC_TYPE,
        specVersion: SPEC_VERSION,
        url: 'https://example.com/',
        actions: [{ type: 'a11yScan' }],
        ...extra,
    };
}

function uiConfigWith(state = {}, extra = {}) {
    return {
        version: 1,
        type: 'a11y-ui-src-config',
        url: 'https://example.com/',
        state: {
            'url-input': 'https://example.com/',
            'actions-workflow': [{ type: 'a11yScan' }],
            ...state,
        },
        ...extra,
    };
}

function normalize(raw, extraDeps = {}) {
    return normalizeRunSpec(raw, { ...DEPS, ...extraDeps });
}

function rejectingValidator(message) {
    return () => {
        throw new Error(message);
    };
}

describe('buildRunSpec', () => {
    test('says how the page is shown only where the run sets it', () => {
        const spec = buildRunSpec({ url: 'https://example.com/', actions: [], colorScheme: 'dark', highContrast: 'on', language: 'de-DE' });
        assert.equal(spec.colorScheme, 'dark');
        assert.equal(spec.highContrast, 'on');
        assert.equal(spec.language, 'de-DE');
        const plain = buildRunSpec({ url: 'https://example.com/', actions: [], colorScheme: '', highContrast: 'off', language: '' });
        assert.deepEqual(['colorScheme', 'highContrast', 'language'].filter((k) => k in plain), []);
    });

    test('keeps what a run needs and leaves out what it does not set', () => {
        const spec = buildRunSpec({
            url: '  https://example.com/  ',
            actions: [{ type: 'a11yScan' }],
            scenarioName: '   ',
            customSteps: [],
            viewport: null,
        });

        assert.deepEqual(spec, {
            type: SPEC_TYPE,
            specVersion: SPEC_VERSION,
            url: 'https://example.com/',
            actions: [{ type: 'a11yScan' }],
        });
    });

    test('carries every field that is set', () => {
        const spec = buildRunSpec({
            url: 'https://example.com/',
            actions: [{ type: 'a11yScan', profile: 'en301549-v3.2.1' }],
            scenarioName: 'Checkout',
            customSteps: [{ id: 'login' }],
            viewport: { width: 1440, height: 900 },
        });

        assert.deepEqual(spec, {
            type: SPEC_TYPE,
            specVersion: SPEC_VERSION,
            url: 'https://example.com/',
            actions: [{ type: 'a11yScan', profile: 'en301549-v3.2.1' }],
            scenarioName: 'Checkout',
            customSteps: [{ id: 'login' }],
            viewport: { width: 1440, height: 900 },
        });
    });

    test('has no Include or Exclude selectors: each scan step has its own', () => {
        const spec = buildRunSpec({ url: 'https://example.com/', actions: [], context: 'main', exclude: '.ads' });
        assert.ok(!('context' in spec));
        assert.ok(!('exclude' in spec));
    });

    test('produces a runnable spec from nothing usable', () => {
        const spec = buildRunSpec();
        assert.equal(spec.url, null);
        assert.ok(!('profile' in spec));
        assert.deepEqual(spec.actions, []);
    });

    test('what it builds is what normalize accepts', () => {
        const built = buildRunSpec({
            url: 'https://example.com/',
            actions: [{ type: 'a11yScan' }],
            scenarioName: 'Checkout',
            viewport: { width: 1440, height: 900 },
        });

        const { ok, spec, errors, warnings } = normalize(built);

        assert.equal(ok, true);
        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, []);
        assert.deepEqual(spec, {
            url: 'https://example.com/',
            actions: [{ type: 'a11yScan' }],
            customSteps: [],
            viewport: { width: 1440, height: 900 },
            colorScheme: null,
            highContrast: false,
            language: null,
            acceptUntrustedCerts: false,
            scenarioName: 'Checkout',
        });
    });
});

describe('normalizeRunSpec', () => {
    test('fills the defaults a run needs from a minimal spec', () => {
        const { ok, spec, errors, warnings } = normalize(specWith());

        assert.equal(ok, true);
        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, []);
        assert.deepEqual(spec, {
            url: 'https://example.com/',
            actions: [{ type: 'a11yScan' }],
            customSteps: [],
            viewport: null,
            colorScheme: null,
            highContrast: false,
            language: null,
            acceptUntrustedCerts: false,
            scenarioName: null,
        });
    });

    test('accepts untrusted certificates only when the spec says so, refusing what is not a setting', () => {
        assert.equal(normalize(specWith()).spec.acceptUntrustedCerts, false);
        assert.equal(normalize(specWith({ acceptUntrustedCerts: true })).spec.acceptUntrustedCerts, true);
        assert.equal(normalize(specWith({ acceptUntrustedCerts: 'on' })).spec.acceptUntrustedCerts, true);
        assert.equal(normalize(specWith({ acceptUntrustedCerts: false })).spec.acceptUntrustedCerts, false);
        const { ok, errors } = normalize(specWith({ acceptUntrustedCerts: 'yes' }));
        assert.equal(ok, false);
        assert.deepEqual(errors, ['acceptUntrustedCerts "yes" is not a setting: use true or false']);
    });

    test('reads how the page is shown as the run starts, refusing what is not a setting', () => {
        const { ok, spec } = normalize(specWith({ colorScheme: 'dark', highContrast: 'on', language: 'pt-br' }));
        assert.equal(ok, true);
        assert.equal(spec.colorScheme, 'dark');
        assert.equal(spec.highContrast, true);
        assert.equal(spec.language, 'pt-BR');

        // A variable is read once the run's variables are known.
        assert.equal(normalize(specWith({ language: '{var:lang}' })).spec.language, '{var:lang}');

        const bad = normalize(specWith({ colorScheme: 'sepia', highContrast: 'maybe', language: 'not a tag' }));
        assert.equal(bad.ok, false);
        assert.equal(bad.errors.length, 3);
        assert.match(bad.errors.join(' '), /sepia.*maybe.*not a tag/);
    });

    test('rejects a spec that is not an object', () => {
        for (const raw of [null, 'a string', 42, ['an array']]) {
            const { ok, errors } = normalize(raw);
            assert.equal(ok, false);
            assert.deepEqual(errors, ['Spec must be a JSON object']);
        }
    });

    test('collects every problem in one pass instead of failing on the first', () => {
        const { ok, spec, errors } = normalize({
            actions: [],
            customSteps: '{not json',
            viewport: { width: 0, height: 720 },
            exclude: '.ads',
        });

        assert.equal(ok, false);
        assert.equal(spec, null);
        assert.equal(errors.length, 5);
        assert.ok(errors.includes('Spec must have a url'));
        assert.ok(errors.includes('Spec has no actions to run, define at least one (e.g. a11yScan)'));
        assert.ok(errors.some((e) => e.startsWith('customSteps is not valid JSON')));
        assert.ok(errors.includes('viewport must have positive numeric width and height'));
        assert.ok(errors.some((e) => e.startsWith('A run has no Include or Exclude selectors')));
    });

    test('reports a missing actions array differently from an empty one', () => {
        assert.deepEqual(normalize(specWith({ actions: undefined })).errors, ['Spec must have an actions array']);
        assert.deepEqual(
            normalize(specWith({ actions: [] })).errors,
            ['Spec has no actions to run, define at least one (e.g. a11yScan)']
        );
    });

    describe('url', () => {
        test('treats a blank url as missing', () => {
            const { ok, errors } = normalize(specWith({ url: '   ' }));
            assert.equal(ok, false);
            assert.deepEqual(errors, ['Spec must have a url']);
        });

        test('surfaces the injected validator message', () => {
            const { ok, errors } = normalize(specWith({ url: 'ftp://example.com' }), {
                validateUrl: rejectingValidator('Unsupported protocol: ftp:'),
            });

            assert.equal(ok, false);
            assert.deepEqual(errors, ['Unsupported protocol: ftp:']);
        });

        test('accepts any url when no validator is injected', () => {
            const { ok, spec } = normalize(specWith({ url: 'ftp://example.com' }));
            assert.equal(ok, true);
            assert.equal(spec.url, 'ftp://example.com');
        });

        test('does not call the validator when the url is missing', () => {
            let called = false;
            const { ok } = normalize(specWith({ url: null }), { validateUrl: () => { called = true; } });

            assert.equal(ok, false);
            assert.equal(called, false);
        });
    });

    describe('profile', () => {
        test('a run has none: each scan step chooses its own', () => {
            assert.equal('profile' in normalize(specWith()).spec, false);
        });

        test('a run profile other than the default stops the run, in a spec or a saved config, pointing to the converter', () => {
            for (const raw of [specWith({ profile: 'EN301549-V3.2.1' }), uiConfigWith({ 'run-profile': 'en301549-v3.2.1' })]) {
                const { ok, errors } = normalize(raw);
                assert.equal(ok, false);
                assert.match(errors[0], /^"profile" "(EN301549-V3\.2\.1|en301549-v3\.2\.1)" is not read any more: each scan step chooses its profile, wcag22-aa unless it says otherwise\. node src\/cli\/convert-config\.js/);
            }
        });

        test('the default one, and the evidence format, are only warned about: nothing changes', () => {
            const { ok, spec, warnings } = normalize(specWith({ profile: 'wcag22-aa', globalEvidenceFormat: 'png' }));
            assert.equal(ok, true);
            assert.equal('globalEvidenceFormat' in spec, false);
            assert.match(warnings.join('\n'), /"profile" is not read any more/);
            assert.match(warnings.join('\n'), /"globalEvidenceFormat" is not read any more: a scan no longer saves evidence; add a Save evidence step/);
        });

        test('wcag and tags are errors, so a spec cannot run at a level it did not ask for', () => {
            const { ok, errors } = normalize(specWith({ wcag: { level: 'AAA' }, tags: ['wcag2a'] }));
            assert.equal(ok, false);
            assert.equal(errors.length, 2);
            assert.match(errors[0], /^"wcag" is not read any more: each scan step chooses its WCAG version and level with its "profile"/);
            assert.match(errors[1], /^"tags" is not read any more/);
        });
    });

    describe('viewport', () => {
        test('resolves a known preset', () => {
            const { spec, warnings } = normalize(specWith({ viewport: 'tablet' }));
            assert.deepEqual(spec.viewport, { width: 768, height: 1024 });
            assert.deepEqual(warnings, []);
        });

        test('warns and drops an unknown preset rather than failing the run', () => {
            const { ok, spec, warnings } = normalize(specWith({ viewport: 'phablet' }));
            assert.equal(ok, true);
            assert.equal(spec.viewport, null);
            assert.deepEqual(warnings, ['Unknown viewport preset "phablet", using the browser default']);
        });

        test('warns about any preset when no resolver is injected', () => {
            const { ok, warnings } = normalizeRunSpec(specWith({ viewport: 'tablet' }), {});
            assert.equal(ok, true);
            assert.deepEqual(warnings, ['Unknown viewport preset "tablet", using the browser default']);
        });

        test('accepts explicit dimensions and coerces numeric strings', () => {
            const { spec } = normalize(specWith({ viewport: { width: '1024', height: 640 } }));
            assert.deepEqual(spec.viewport, { width: 1024, height: 640 });
        });

        test('rejects dimensions that are not positive numbers', () => {
            for (const viewport of [{ width: -1, height: 100 }, { width: 100, height: 'tall' }, { width: 100 }]) {
                const { ok, errors } = normalize(specWith({ viewport }));
                assert.equal(ok, false);
                assert.deepEqual(errors, ['viewport must have positive numeric width and height']);
            }
        });

        test('treats an empty preset as no viewport', () => {
            const { ok, spec, warnings } = normalize(specWith({ viewport: '' }));
            assert.equal(ok, true);
            assert.equal(spec.viewport, null);
            assert.deepEqual(warnings, []);
        });
    });

    describe('custom steps', () => {
        test('parses a JSON string, as the app stores it', () => {
            const { spec } = normalize(specWith({ customSteps: '[{"id":"login","actions":[]}]' }));
            assert.deepEqual(spec.customSteps, [{ id: 'login', actions: [] }]);
        });

        test('passes an array through untouched', () => {
            const steps = [{ id: 'login', actions: [{ type: 'click' }] }];
            assert.deepEqual(normalize(specWith({ customSteps: steps })).spec.customSteps, steps);
        });

        test('rejects JSON that does not hold an array', () => {
            const { ok, errors } = normalize(specWith({ customSteps: '{"id":"login"}' }));
            assert.equal(ok, false);
            assert.deepEqual(errors, ['customSteps must be an array']);
        });

        test('rejects a type that is neither array nor string', () => {
            const { ok, errors } = normalize(specWith({ customSteps: { id: 'login' } }));
            assert.equal(ok, false);
            assert.deepEqual(errors, ['customSteps must be an array or a JSON string']);
        });

        test('treats an empty string as no custom steps', () => {
            const { ok, spec } = normalize(specWith({ customSteps: '' }));
            assert.equal(ok, true);
            assert.deepEqual(spec.customSteps, []);
        });
    });

    describe('engines and selectors', () => {
        test('does not read a run-level engine: each scan step names its own', () => {
            const { ok, spec, warnings } = normalize(specWith({ scanEngine: 'engine-b' }));
            assert.equal(ok, true);
            assert.ok(!('scanEngine' in spec));
            assert.deepEqual(warnings, ['"scanEngine" is not read any more: each scan step names its engine (its "engine" field), and a step without one runs with the default engine']);
        });

        test('refuses a run\'s Include or Exclude selectors, naming the converter', () => {
            for (const extra of [{ context: 'main' }, { exclude: '.ads, .cookie' }, { exclude: ['.ads'] }]) {
                const { ok, errors } = normalize(specWith(extra));
                assert.equal(ok, false);
                assert.equal(errors.length, 1);
                assert.match(errors[0], /^A run has no Include or Exclude selectors any more.*convert-config\.js <file> --write/);
            }
        });

        test('takes empty ones, which set nothing', () => {
            for (const extra of [{ context: '   ' }, { exclude: '' }, { exclude: [] }, { context: null }]) {
                assert.equal(normalize(specWith(extra)).ok, true);
            }
        });
    });

    describe('warnings', () => {
        test('flags an unknown field without failing', () => {
            const { ok, warnings } = normalize(specWith({ scenarioname: 'typo' }));
            assert.equal(ok, true);
            assert.deepEqual(warnings, ['Unknown spec field "scenarioname" ignored']);
        });

        test('flags a spec version it does not know', () => {
            const { ok, warnings } = normalize(specWith({ specVersion: 9 }));
            assert.equal(ok, true);
            assert.deepEqual(warnings, ['Spec version 9 is not 1, reading it anyway']);
        });

        test('stays quiet when the version is absent', () => {
            assert.deepEqual(normalize(specWith({ specVersion: undefined })).warnings, []);
        });
    });
});

describe('saved config', () => {
    test('recognizes the two file types', () => {
        assert.equal(isUiConfig(uiConfigWith()), true);
        assert.equal(isUiConfig(specWith()), false);
        assert.equal(isUiConfig(null), false);

        assert.equal(isRunSpec(specWith()), true);
        assert.equal(isRunSpec(uiConfigWith()), false);
        assert.equal(isRunSpec(undefined), false);
    });

    test('reads configs saved before the type was renamed', () => {
        const older = uiConfigWith({ 'scenario-name': 'Older file' }, { type: 'a11y-ui-config' });

        assert.equal(isUiConfig(older), true);

        const { ok, spec } = normalize(older);
        assert.equal(ok, true);
        assert.equal(spec.scenarioName, 'Older file');
        assert.deepEqual(spec.actions, [{ type: 'a11yScan' }]);
    });

    test('reads a config carrying state under any type, as the app does', () => {
        const untyped = uiConfigWith({}, { type: undefined });
        delete untyped.type;

        assert.equal(isUiConfig(untyped), true);
        assert.equal(normalize(untyped).ok, true);
    });

    test('does not mistake a spec or a bare list for a config', () => {
        assert.equal(isUiConfig(specWith()), false);
        assert.equal(isUiConfig([{ type: 'a11yScan' }]), false);
        assert.equal(isUiConfig({ type: 'a11y-run-spec', state: { 'url-input': 'x' } }), false);
    });

    test('prefers the embedded spec over the form state', () => {
        const config = uiConfigWith(
            { 'scenario-name': 'From state', 'viewport-preset': 'mobile' },
            {
                runSpec: buildRunSpec({
                    url: 'https://embedded.example.com/',
                    actions: [{ type: 'a11yScan', label: 'Embedded' }],
                    scenarioName: 'From spec',
                    viewport: { width: 800, height: 600 },
                }),
            }
        );

        const { ok, spec } = normalize(config);

        assert.equal(ok, true);
        assert.equal(spec.url, 'https://embedded.example.com/');
        assert.equal(spec.scenarioName, 'From spec');
        assert.deepEqual(spec.viewport, { width: 800, height: 600 });
        assert.deepEqual(spec.actions, [{ type: 'a11yScan', label: 'Embedded' }]);
    });

    test('ignores a runSpec field that is not one', () => {
        const config = uiConfigWith({ 'scenario-name': 'From state' }, { runSpec: { url: 'https://nope.example.com/' } });
        const { spec } = normalize(config);

        assert.equal(spec.url, 'https://example.com/');
        assert.equal(spec.scenarioName, 'From state');
    });

    test('maps the form ids the app reads at run time', () => {
        const { ok, spec } = normalize(uiConfigWith({
            'scenario-name': 'Web Banking',
            'viewport-preset': 'desktop-lg',
            'custom-steps-json': '[{"id":"login"}]',
        }));

        assert.equal(ok, true);
        assert.equal(spec.scenarioName, 'Web Banking');
        assert.deepEqual(spec.viewport, { width: 1440, height: 900 });
        assert.deepEqual(spec.customSteps, [{ id: 'login' }]);
    });

    test('refuses a config saved with the run\'s Include or Exclude selectors, which the app converts', () => {
        for (const id of ['scan-context', 'exclude-selectors-global', 'scan-exclude']) {
            const { ok, errors } = normalize(uiConfigWith({ [id]: 'main' }));
            assert.equal(ok, false, id);
            assert.match(errors[0], /^A run has no Include or Exclude selectors/);
        }
    });

    test('reads the older camelCase ids when the kebab ones are absent', () => {
        const { spec } = normalize(uiConfigWith({
            scenarioName: 'Older config',
            viewportPreset: 'mobile',
        }));

        assert.equal(spec.scenarioName, 'Older config');
        assert.deepEqual(spec.viewport, { width: 375, height: 812 });
    });

    test('prefers the kebab id when a config carries both', () => {
        const { spec } = normalize(uiConfigWith({
            'scenario-name': 'Current',
            scenarioName: 'Older',
            'viewport-preset': 'tablet',
            viewportPreset: 'mobile',
        }));

        assert.equal(spec.scenarioName, 'Current');
        assert.deepEqual(spec.viewport, { width: 768, height: 1024 });
    });

    test('falls back to the top level url when the form field is empty', () => {
        assert.equal(normalize(uiConfigWith({ 'url-input': '' })).spec.url, 'https://example.com/');
    });

    test('does not warn about the widget state a saved config carries', () => {
        const { ok, warnings } = normalize(uiConfigWith({
            'a11yScan__label__0__x5klm': 'Home',
            'group-scans': 'true',
            'scan-presentation-mode': 'evidence',
        }));

        assert.equal(ok, true);
        assert.deepEqual(warnings, []);
    });

    test('still reports a config with no actions', () => {
        const empty = normalize(uiConfigWith({ 'actions-workflow': [] }));
        assert.equal(empty.ok, false);
        assert.deepEqual(empty.errors, ['Spec has no actions to run, define at least one (e.g. a11yScan)']);

        const config = uiConfigWith();
        delete config.state['actions-workflow'];
        assert.deepEqual(normalize(config).errors, ['Spec must have an actions array']);
    });

    test('drops absent fields rather than passing undefined on', () => {
        const spec = runSpecFromUiConfig(uiConfigWith());
        assert.ok(!('context' in spec));
        assert.ok(!('scanEngine' in spec));
    });
});

describe('uiConfigFromRunSpec', () => {
    const { VIEWPORT_PRESETS } = require('./scan-inputs.js');
    const { uiConfigFromRunSpec } = require('./run-spec.js');

    test('a spec opened in the app reads back as the same run', () => {
        const original = specWith({
            scenarioName: 'Checkout',
            viewport: 'tablet',
            actions: [{ type: 'a11yScan', label: 'Cart', profile: 'en301549-v3.2.1', context: 'main', exclude: '.ads, .chat' }, { type: 'click', selector: '#pay' }],
            customSteps: [{ id: 'login', actions: [{ type: 'a11yScan' }] }],
        });
        const { config, notes } = uiConfigFromRunSpec(original, { viewportPresets: VIEWPORT_PRESETS });
        assert.deepEqual(notes, []);

        assert.deepEqual(normalize(config).spec, normalize(original).spec);
    });

    test('how the page is shown reads back too: a listed language in the list, any other with Other…', () => {
        const languages = ['de-DE', 'es-ES'];
        for (const language of ['de-DE', 'es-MX', '{var:lang}']) {
            const original = specWith({ colorScheme: 'dark', highContrast: 'on', language });
            const { config } = uiConfigFromRunSpec(original, { viewportPresets: VIEWPORT_PRESETS, languages });
            const listed = languages.includes(language);
            assert.equal(config.state['run-language'], listed ? language : 'other');
            assert.equal(config.state['run-language-other'], listed ? '' : language);
            const after = normalize(config).spec;
            assert.equal(after.colorScheme, 'dark');
            assert.equal(after.highContrast, true);
            assert.equal(after.language, language);
        }
    });

    test('a spec that sets none leaves the browser\'s own in the form', () => {
        const { config } = uiConfigFromRunSpec(specWith(), { viewportPresets: VIEWPORT_PRESETS });
        assert.equal(config.state['run-color-scheme'], '');
        assert.equal(config.state['run-high-contrast'], 'off');
        assert.equal(config.state['run-language'], '');
        const after = normalize(config).spec;
        assert.deepEqual([after.colorScheme, after.highContrast, after.language], [null, false, null]);
    });

    test('accepting untrusted certificates opens in the form and reads back, off when the spec says nothing', () => {
        const on = uiConfigFromRunSpec(specWith({ acceptUntrustedCerts: true }), { viewportPresets: VIEWPORT_PRESETS }).config;
        assert.equal(on.state['run-untrusted-certs'], 'on');
        assert.equal(normalize(on).spec.acceptUntrustedCerts, true);
        const off = uiConfigFromRunSpec(specWith(), { viewportPresets: VIEWPORT_PRESETS }).config;
        assert.equal(off.state['run-untrusted-certs'], 'off');
        assert.equal(normalize(off).spec.acceptUntrustedCerts, false);
    });
});

describe('starting variables', () => {
    test('a spec carries vars only when it sets some', () => {
        assert.equal('vars' in buildRunSpec({ url: 'https://x.test', actions: [{ type: 'a11yScan' }] }), false);
        assert.deepEqual(
            buildRunSpec({ url: 'https://x.test', actions: [{ type: 'a11yScan' }], vars: { build: '2310' } }).vars,
            { build: '2310' }
        );
        assert.equal('vars' in normalizeRunSpec(specWith(), DEPS).spec, false);
    });

    test('normalize keeps text, numbers and booleans under usable names', () => {
        const r = normalizeRunSpec(specWith({ vars: { date: '2026-03-01', build: 2310, beta: true, _x: null } }), DEPS);
        assert.equal(r.ok, true);
        assert.deepEqual(r.spec.vars, { date: '2026-03-01', build: 2310, beta: true, _x: null });
        assert.deepEqual(r.warnings, []);
    });

    test('normalize refuses names the engine cannot read and values that are not plain', () => {
        const r = normalizeRunSpec(specWith({ vars: { '2nd': 'a', 'a.b': 'b', nested: { x: 1 } } }), DEPS);
        assert.equal(r.ok, false);
        assert.equal(r.errors.length, 3);
        assert.match(r.errors[0], /"2nd" is not a usable variable name/);
        assert.match(r.errors[2], /vars\.nested must be text, a number or true\/false/);
        assert.equal(normalizeRunSpec(specWith({ vars: ['a'] }), DEPS).ok, false);
    });
});
