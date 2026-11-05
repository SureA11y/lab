'use strict';

/**
 * Command line front for the shared run spec: binds the viewport helper to
 * it, and parses the arguments the runner takes.
 */

const { buildViewportFromPreset } = require('../shared/scan-inputs.js');
const runSpec = require('../shared/run-spec.js');
const { parseFormats } = require('./export-formats');

const SPEC_DEPS = { buildViewportFromPreset };

function normalizeRunSpec(raw, { validateUrl = null } = {}) {
    return runSpec.normalizeRunSpec(raw, { ...SPEC_DEPS, validateUrl });
}

const FLAGS_WITH_VALUE = new Set([
    '--spec', '--out', '--url', '--scenario', '--baseline', '--promote', '--keep', '--store', '--format', '--review',
    '--ignore-path-prefix'
]);

function parseCliArgs(argv) {
    const options = {
        specPath: null,
        outDir: null,
        storeRoot: null,
        baselinePath: null,
        promote: null,
        keep: null,
        url: null,
        scenarioName: null,
        quiet: false,
        debugNative: false,
        formats: [],
        reviewPath: null,
        // Path prefixes left out when the run's pages are matched with the
        // baseline's (--ignore-path-prefix, repeatable).
        pathPrefixes: [],
        failOnLean: false,
        failOnFailures: false,
        check: false,
        dryRun: false,
        noBatch: false,
        acceptUntrustedCerts: false,
        help: false,
    };
    const errors = [];
    const list = Array.isArray(argv) ? argv : [];

    for (let i = 0; i < list.length; i += 1) {
        const arg = String(list[i]);

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--quiet' || arg === '-q') {
            options.quiet = true;
            continue;
        }
        if (arg === '--debug-native') {
            options.debugNative = true;
            continue;
        }
        if (arg === '--accept-untrusted-certs') {
            options.acceptUntrustedCerts = true;
            continue;
        }
        if (arg === '--fail-on-lean') {
            options.failOnLean = true;
            continue;
        }
        if (arg === '--fail-on-failures') {
            options.failOnFailures = true;
            continue;
        }
        if (arg === '--check') {
            options.check = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--no-batch') {
            options.noBatch = true;
            continue;
        }

        if (FLAGS_WITH_VALUE.has(arg)) {
            const value = list[i + 1];
            if (value === undefined || String(value).startsWith('--')) {
                errors.push(`${arg} needs a value`);
                continue;
            }
            i += 1;
            if (arg === '--spec') options.specPath = String(value);
            if (arg === '--out') options.outDir = String(value);
            if (arg === '--store') options.storeRoot = String(value);
            if (arg === '--baseline') options.baselinePath = String(value);
            if (arg === '--promote') options.promote = String(value);
            if (arg === '--url') options.url = String(value);
            if (arg === '--scenario') options.scenarioName = String(value);
            if (arg === '--review') options.reviewPath = String(value);
            if (arg === '--ignore-path-prefix') {
                const added = String(value).split(',').map((p) => p.trim()).filter(Boolean);
                if (!added.length) errors.push('--ignore-path-prefix needs a path, such as /v1');
                options.pathPrefixes = Array.from(new Set([...options.pathPrefixes, ...added]));
            }
            if (arg === '--format') {
                const parsed = parseFormats(value);
                errors.push(...parsed.errors);
                options.formats = Array.from(new Set([...options.formats, ...parsed.formats]));
            }
            if (arg === '--keep') {
                const keep = Number(value);
                if (!Number.isInteger(keep) || keep < 1) {
                    errors.push('--keep needs a whole number of runs to keep, at least 1');
                } else {
                    options.keep = keep;
                }
            }
            continue;
        }

        if (arg.startsWith('-')) {
            errors.push(`Unknown option ${arg}`);
            continue;
        }

        if (!options.specPath) {
            options.specPath = arg;
            continue;
        }

        errors.push(`Unexpected argument ${arg}`);
    }

    if (!options.help && !options.specPath) errors.push('No spec file given');

    // A dry run writes nothing and compares with nothing.
    if (options.dryRun) {
        const unused = [
            ['--out', options.outDir], ['--store', options.storeRoot], ['--baseline', options.baselinePath],
            ['--promote', options.promote], ['--keep', options.keep], ['--format', options.formats.length || null],
            ['--review', options.reviewPath],
            ['--ignore-path-prefix', options.pathPrefixes.length || null],
            ['--fail-on-lean', options.failOnLean || null], ['--fail-on-failures', options.failOnFailures || null],
            ['--check', options.check || null],
        ].filter(([, value]) => value != null).map(([flag]) => flag);
        if (unused.length) errors.push(`--dry-run writes nothing and compares with nothing, so it does not take ${unused.join(', ')}`);
    }

    return { options, errors };
}

/**
 * Apply command line overrides on top of a normalized spec. An overridden url
 * goes through the same validation as the one in the spec.
 */
function applyOverrides(spec, options, { validateUrl = null } = {}) {
    const errors = [];
    const out = { ...spec };

    const url = options && typeof options.url === 'string' ? options.url.trim() : '';
    if (url) {
        if (typeof validateUrl === 'function') {
            try {
                validateUrl(url);
                out.url = url;
            } catch (e) {
                errors.push(e.message);
            }
        } else {
            out.url = url;
        }
    }

    const scenarioName = options && typeof options.scenarioName === 'string' ? options.scenarioName.trim() : '';
    if (scenarioName) out.scenarioName = scenarioName;

    return { spec: out, errors };
}

module.exports = {
    SPEC_TYPE: runSpec.SPEC_TYPE,
    UI_CONFIG_TYPE: runSpec.UI_CONFIG_TYPE,
    SUPPORTED_SPEC_VERSION: runSpec.SPEC_VERSION,
    isUiConfig: runSpec.isUiConfig,
    isRunSpec: runSpec.isRunSpec,
    buildRunSpec: runSpec.buildRunSpec,
    runSpecFromUiConfig: runSpec.runSpecFromUiConfig,
    normalizeRunSpec,
    parseCliArgs,
    applyOverrides,
};
