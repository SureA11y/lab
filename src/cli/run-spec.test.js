'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeRunSpec, parseCliArgs, applyOverrides } = require('./run-spec');


function specWith(extra = {}) {
    return {
        type: 'a11y-run-spec',
        specVersion: 1,
        url: 'https://example.com/',
        actions: [{ type: 'a11yScan' }],
        ...extra,
    };
}

function rejectingValidator(message) {
    return () => {
        throw new Error(message);
    };
}

describe('normalizeRunSpec binding', () => {
    test('a run has no profile: one other than the default stops the run, pointing to the converter', () => {
        assert.equal('profile' in normalizeRunSpec(specWith()).spec, false);
        assert.match(normalizeRunSpec(specWith({ profile: 'en301549-v4.1.1' })).errors[0], /"profile" "en301549-v4\.1\.1" is not read any more: each scan step chooses its profile.*convert-config\.js/);
        const plain = normalizeRunSpec(specWith({ profile: 'wcag22-aa' }));
        assert.equal(plain.ok, true);
        assert.match(plain.warnings.join('\n'), /"profile" is not read any more/);
    });

    test('resolves viewport presets without the caller passing a resolver', () => {
        assert.deepEqual(normalizeRunSpec(specWith({ viewport: 'mobile' })).spec.viewport, { width: 375, height: 812 });
    });

    test('passes the url validator through', () => {
        const { ok, errors } = normalizeRunSpec(specWith(), {
            validateUrl: rejectingValidator('Unsupported protocol: ftp:'),
        });

        assert.equal(ok, false);
        assert.deepEqual(errors, ['Unsupported protocol: ftp:']);
    });
});

describe('parseCliArgs', () => {
    test('takes the spec path as the first positional argument', () => {
        const { options, errors } = parseCliArgs(['spec.json']);
        assert.deepEqual(errors, []);
        assert.equal(options.specPath, 'spec.json');
    });

    test('takes the spec path from the flag and reads every option', () => {
        const { options, errors } = parseCliArgs([
            '--spec', 'spec.json',
            '--out', 'runs/nightly',
            '--store', 'nightly-store',
            '--baseline', 'runs/last/payload.json',
            '--promote', 'release-1.4',
            '--keep', '10',
            '--url', 'https://staging.example.com/',
            '--scenario', 'Nightly',
            '--format', 'junit',
            '--format', 'SARIF,junit',
            '--format', 'acr',
            '--review', 'runs/last/payload.json',
            '--debug-native',
            '--accept-untrusted-certs',
            '--fail-on-lean',
            '--fail-on-failures',
            '--check',
            '--quiet',
        ]);

        assert.deepEqual(errors, []);
        assert.deepEqual(options, {
            specPath: 'spec.json',
            outDir: 'runs/nightly',
            storeRoot: 'nightly-store',
            baselinePath: 'runs/last/payload.json',
            promote: 'release-1.4',
            keep: 10,
            url: 'https://staging.example.com/',
            scenarioName: 'Nightly',
            quiet: true,
            debugNative: true,
            formats: ['junit', 'sarif', 'acr'],
            reviewPath: 'runs/last/payload.json',
            failOnLean: true,
            failOnFailures: true,
            check: true,
            dryRun: false,
            noBatch: false,
            acceptUntrustedCerts: true,
            help: false,
        });
    });

    test('takes --dry-run, which writes and compares nothing', () => {
        const { options, errors } = parseCliArgs(['spec.json', '--dry-run', '--url', 'https://staging.example.com/', '--quiet']);
        assert.deepEqual(errors, []);
        assert.equal(options.dryRun, true);

        const refused = parseCliArgs(['spec.json', '--dry-run', '--baseline', 'auto', '--out', 'x', '--format', 'sarif']).errors;
        assert.deepEqual(refused, ['--dry-run writes nothing and compares with nothing, so it does not take --out, --baseline, --format']);
    });

    test('rejects an unknown export format', () => {
        const { errors } = parseCliArgs(['spec.json', '--format', 'pdf']);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /Unknown format "pdf"/);
    });

    test('takes a baseline directory as well as a file', () => {
        assert.equal(parseCliArgs(['spec.json', '--baseline', 'runs/last']).options.baselinePath, 'runs/last');
        assert.deepEqual(parseCliArgs(['spec.json', '--baseline']).errors, ['--baseline needs a value']);
    });

    test('takes auto and a named baseline as they are', () => {
        assert.equal(parseCliArgs(['spec.json', '--baseline', 'auto']).options.baselinePath, 'auto');
        assert.equal(parseCliArgs(['spec.json', '--baseline', '@release-1.4']).options.baselinePath, '@release-1.4');
    });

    test('rejects a keep count that is not a whole number of runs', () => {
        for (const value of ['0', '-2', 'many', '1.5']) {
            const { options, errors } = parseCliArgs(['spec.json', '--keep', value]);
            assert.equal(options.keep, null);
            assert.deepEqual(errors, ['--keep needs a whole number of runs to keep, at least 1']);
        }
    });

    test('accepts the short flags', () => {
        assert.equal(parseCliArgs(['spec.json', '-q']).options.quiet, true);
        assert.equal(parseCliArgs(['-h']).options.help, true);
    });

    test('does not ask for a spec when help is requested', () => {
        const { options, errors } = parseCliArgs(['--help']);
        assert.equal(options.help, true);
        assert.deepEqual(errors, []);
    });

    test('reports a flag left without a value', () => {
        assert.deepEqual(parseCliArgs(['spec.json', '--out']).errors, ['--out needs a value']);
        assert.deepEqual(
            parseCliArgs(['--spec', '--quiet']).errors,
            ['--spec needs a value', 'No spec file given']
        );
    });

    test('reports unknown options and stray arguments', () => {
        assert.deepEqual(parseCliArgs(['spec.json', '--strict']).errors, ['Unknown option --strict']);
        assert.deepEqual(parseCliArgs(['spec.json', 'other.json']).errors, ['Unexpected argument other.json']);
    });

    test('reports an empty argument list', () => {
        assert.deepEqual(parseCliArgs([]).errors, ['No spec file given']);
        assert.deepEqual(parseCliArgs(undefined).errors, ['No spec file given']);
    });
});

describe('applyOverrides', () => {
    test('replaces only the fields given on the command line', () => {
        const spec = normalizeRunSpec(specWith({ scenarioName: 'From spec' })).spec;
        const { spec: out, errors } = applyOverrides(spec, {
            url: 'https://staging.example.com/',
            scenarioName: null,
        });

        assert.deepEqual(errors, []);
        assert.equal(out.url, 'https://staging.example.com/');
        assert.equal(out.scenarioName, 'From spec');
        assert.deepEqual(out.tags, spec.tags);
    });

    test('leaves the spec untouched when nothing is overridden', () => {
        const spec = normalizeRunSpec(specWith()).spec;
        assert.deepEqual(applyOverrides(spec, {}).spec, spec);
        assert.deepEqual(applyOverrides(spec, null).spec, spec);
    });

    test('validates an overridden url and keeps the spec url when it is rejected', () => {
        const spec = normalizeRunSpec(specWith()).spec;
        const { spec: out, errors } = applyOverrides(
            spec,
            { url: 'ftp://example.com' },
            { validateUrl: rejectingValidator('Unsupported protocol: ftp:') }
        );

        assert.deepEqual(errors, ['Unsupported protocol: ftp:']);
        assert.equal(out.url, 'https://example.com/');
    });

    test('ignores blank overrides', () => {
        const spec = normalizeRunSpec(specWith({ scenarioName: 'From spec' })).spec;
        const { spec: out, errors } = applyOverrides(spec, { url: '  ', scenarioName: '   ' });

        assert.deepEqual(errors, []);
        assert.equal(out.url, 'https://example.com/');
        assert.equal(out.scenarioName, 'From spec');
    });
});
