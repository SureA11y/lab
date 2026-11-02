'use strict';

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    safeDirPart,
    scenarioSlug,
    defaultOutDir,
    findPreviousRun,
    baselineFilePath,
    resolveBaselineTarget,
    promoteBaseline,
    pruneRuns,
    defaultBatchDir,
    batchRunDirName,
    findPreviousBatchRun,
    pruneBatches,
} = require('./run-store');

let root;

const SPEC = { scenarioName: 'Web Banking', url: 'https://example.com/' };

before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-store-'));
});

beforeEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
});

after(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function options() {
    return { storeRoot: root };
}

function writeRun(stamp, payload) {
    const dir = path.join(root, 'Web-Banking', 'runs', stamp);
    fs.mkdirSync(dir, { recursive: true });
    if (payload !== null) {
        fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(payload), 'utf8');
    }
    return dir;
}

function payload(runId, scenarioName = 'Web Banking') {
    return { runId, scenarioName, url: 'https://example.com/', scans: [] };
}

describe('safeDirPart', () => {
    test('turns a scenario name into a directory name', () => {
        assert.equal(safeDirPart('Web Banking / accounts', 'run'), 'Web-Banking-accounts');
    });

    test('strips the scheme from a url', () => {
        assert.equal(safeDirPart('https://example.com/path?a=1', 'run'), 'example.com-path-a=1');
    });

    test('falls back when nothing usable is left', () => {
        assert.equal(safeDirPart('', 'run'), 'run');
        assert.equal(safeDirPart('///', 'run'), 'run');
        assert.equal(safeDirPart(null, 'run'), 'run');
    });

    test('caps the length so the path stays sane', () => {
        assert.equal(safeDirPart('a'.repeat(200), 'run').length, 80);
    });
});

describe('scenarioSlug', () => {
    test('prefers the scenario name and falls back to the url', () => {
        assert.equal(scenarioSlug(SPEC), 'Web-Banking');
        assert.equal(scenarioSlug({ url: 'https://example.com/checkout' }), 'example.com-checkout');
        assert.equal(scenarioSlug({}), 'run');
        assert.equal(scenarioSlug(null), 'run');
    });
});

describe('defaultOutDir', () => {
    test('keeps runs of one scenario together', () => {
        const dir = defaultOutDir(SPEC, '2026-08-17T10-00-00-000Z', options());
        assert.equal(dir, path.join(root, 'Web-Banking', 'runs', '2026-08-17T10-00-00-000Z'));
    });
});

describe('findPreviousRun', () => {
    test('finds the newest run beside this one', () => {
        writeRun('2026-08-15T10-00-00-000Z', payload('run_old'));
        writeRun('2026-08-16T10-00-00-000Z', payload('run_recent'));
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        assert.equal(findPreviousRun(current, 'Web Banking').payload.runId, 'run_recent');
    });

    test('never returns the run being made', () => {
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));
        assert.equal(findPreviousRun(current, 'Web Banking'), null);
    });

    test('skips a directory with no payload in it', () => {
        writeRun('2026-08-15T10-00-00-000Z', payload('run_old'));
        writeRun('2026-08-16T10-00-00-000Z', null);
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        assert.equal(findPreviousRun(current, 'Web Banking').payload.runId, 'run_old');
    });

    test('skips a run of another scenario sharing the directory', () => {
        writeRun('2026-08-15T10-00-00-000Z', payload('run_mine'));
        writeRun('2026-08-16T10-00-00-000Z', payload('run_other', 'Something else'));
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        assert.equal(findPreviousRun(current, 'Web Banking').payload.runId, 'run_mine');
    });

    test('accepts a run that carries no scenario name', () => {
        writeRun('2026-08-16T10-00-00-000Z', payload('run_unnamed', null));
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        assert.equal(findPreviousRun(current, 'Web Banking').payload.runId, 'run_unnamed');
    });

    test('returns nothing when the directory does not exist', () => {
        assert.equal(findPreviousRun(path.join(root, 'nowhere', 'runs', 'x'), 'Web Banking'), null);
    });
});

describe('resolveBaselineTarget', () => {
    test('resolves auto to the previous run', () => {
        writeRun('2026-08-16T10-00-00-000Z', payload('run_recent'));
        const outDir = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        const request = resolveBaselineTarget('auto', { outDir, spec: SPEC, options: options() });

        assert.equal(request.kind, 'auto');
        assert.equal(request.label, '2026-08-16T10-00-00-000Z');
        assert.match(request.target, /2026-08-16T10-00-00-000Z[/\\]payload\.json$/);
    });

    test('says so when there is no previous run yet', () => {
        const outDir = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));
        const request = resolveBaselineTarget('auto', { outDir, spec: SPEC, options: options() });

        assert.equal(request.missing, true);
        assert.match(request.message, /no previous run/);
    });

    test('resolves a named baseline under the scenario', () => {
        const request = resolveBaselineTarget('@release-1.4', {
            outDir: path.join(root, 'Web-Banking', 'runs', 'x'),
            spec: SPEC,
            options: options(),
        });

        assert.equal(request.kind, 'named');
        assert.equal(request.label, 'release-1.4');
        assert.equal(request.target, path.join(root, 'Web-Banking', 'baselines', 'release-1.4.json'));
    });

    test('rejects an empty name', () => {
        const request = resolveBaselineTarget('@', { outDir: root, spec: SPEC, options: options() });
        assert.match(request.error, /needs a name/);
    });

    test('passes a path through untouched', () => {
        const request = resolveBaselineTarget('runs/last/payload.json', {
            outDir: root, spec: SPEC, options: options(),
        });

        assert.equal(request.kind, 'path');
        assert.equal(request.target, 'runs/last/payload.json');
    });

    test('reports nothing to compare with when no baseline was asked for', () => {
        for (const value of ['', '   ', null, undefined]) {
            assert.equal(resolveBaselineTarget(value, { outDir: root, spec: SPEC, options: options() }).kind, 'none');
        }
    });
});

describe('promoteBaseline', () => {
    function makeRun() {
        const dir = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));
        return path.join(dir, 'payload.json');
    }

    test('keeps a whole run as the named baseline', () => {
        const result = promoteBaseline('release-1.4', {
            payloadPath: makeRun(),
            spec: SPEC,
            options: options(),
            health: { degraded: false },
            status: 'done',
        });

        assert.equal(result.ok, true);
        assert.equal(result.target, baselineFilePath('release-1.4', SPEC, options()));
        assert.equal(JSON.parse(fs.readFileSync(result.target, 'utf8')).runId, 'run_current');
    });

    test('refuses a degraded run, which would make later runs look better', () => {
        const result = promoteBaseline('release-1.4', {
            payloadPath: makeRun(),
            spec: SPEC,
            options: options(),
            health: { degraded: true },
            status: 'done',
        });

        assert.equal(result.ok, false);
        assert.match(result.error, /degraded/);
        assert.equal(fs.existsSync(baselineFilePath('release-1.4', SPEC, options())), false);
    });

    test('refuses a run that did not finish', () => {
        for (const status of ['error', 'cancelled']) {
            const result = promoteBaseline('release-1.4', {
                payloadPath: makeRun(),
                spec: SPEC,
                options: options(),
                health: { degraded: false },
                status,
            });

            assert.equal(result.ok, false);
            assert.match(result.error, new RegExp(status));
        }
    });

    test('reports a baseline it cannot write', () => {
        const result = promoteBaseline('release-1.4', {
            payloadPath: path.join(root, 'missing.json'),
            spec: SPEC,
            options: options(),
            health: { degraded: false },
            status: 'done',
        });

        assert.equal(result.ok, false);
        assert.match(result.error, /could not write baseline/);
    });
});

describe('pruneRuns', () => {
    test('keeps the newest runs and removes the rest', () => {
        writeRun('2026-08-14T10-00-00-000Z', payload('run_1'));
        writeRun('2026-08-15T10-00-00-000Z', payload('run_2'));
        writeRun('2026-08-16T10-00-00-000Z', payload('run_3'));
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_4'));

        const result = pruneRuns(current, 2);

        assert.equal(result.removed.length, 2);
        assert.deepEqual(
            fs.readdirSync(path.dirname(current)).sort(),
            ['2026-08-16T10-00-00-000Z', '2026-08-17T10-00-00-000Z']
        );
    });

    test('counts the run just made as one of the kept', () => {
        writeRun('2026-08-16T10-00-00-000Z', payload('run_old'));
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        assert.equal(pruneRuns(current, 1).removed.length, 1);
        assert.deepEqual(fs.readdirSync(path.dirname(current)), ['2026-08-17T10-00-00-000Z']);
    });

    test('removes nothing when there are fewer runs than asked for', () => {
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));
        assert.deepEqual(pruneRuns(current, 5).removed, []);
    });

    test('leaves directories that hold no payload alone', () => {
        writeRun('2026-08-14T10-00-00-000Z', null);
        writeRun('2026-08-15T10-00-00-000Z', payload('run_old'));
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        pruneRuns(current, 1);

        assert.deepEqual(
            fs.readdirSync(path.dirname(current)).sort(),
            ['2026-08-14T10-00-00-000Z', '2026-08-17T10-00-00-000Z']
        );
    });

    test('refuses a keep count that would delete everything', () => {
        const current = writeRun('2026-08-17T10-00-00-000Z', payload('run_current'));

        for (const keep of [0, -1, 'all', null]) {
            const result = pruneRuns(current, keep);
            assert.deepEqual(result.removed, []);
            assert.match(result.error, /at least 1/);
        }

        assert.equal(fs.existsSync(current), true);
    });
});

describe('batches', () => {
    function writeBatch(stamp, items, payloads = {}) {
        const dir = path.join(root, 'Shop', 'batches', stamp);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify({ type: 'a11y-queue-session', version: 1, items }));
        for (const [file, payload] of Object.entries(payloads)) {
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), JSON.stringify(payload));
        }
        return dir;
    }

    test('a batch\'s folder is under its name, and a row\'s is numbered in it', () => {
        assert.equal(defaultBatchDir('Shop pages', 'S1', { storeRoot: root }), path.join(root, 'Shop-pages', 'batches', 'S1'));
        assert.equal(batchRunDirName(3, 12, 'Product v2.4'), '03-Product-v2.4');
        assert.equal(batchRunDirName(3, 120, 'A'), '003-A');
    });

    test('finds the same row in the most recent earlier batch that ran it', () => {
        writeBatch('2026-01', [{ name: 'Cart', file: '02-Cart/payload.json' }], { '02-Cart/payload.json': { scans: [] } });
        writeBatch('2026-02', [{ name: 'Cart', file: null }]);
        const current = writeBatch('2026-03', [{ name: 'Cart', file: null }]);
        const previous = findPreviousBatchRun(current, 'Cart');
        assert.equal(previous.filePath, path.join(root, 'Shop', 'batches', '2026-01', '02-Cart', 'payload.json'));
        assert.equal(findPreviousBatchRun(current, 'Home'), null);
    });

    test('--keep counts batches, and leaves other folders alone', () => {
        for (const stamp of ['2026-01', '2026-02', '2026-03']) writeBatch(stamp, []);
        fs.mkdirSync(path.join(root, 'Shop', 'batches', 'notes'));
        const { removed } = pruneBatches(path.join(root, 'Shop', 'batches', '2026-03'), 2);
        assert.deepEqual(removed, [path.join(root, 'Shop', 'batches', '2026-01')]);
        assert.ok(fs.existsSync(path.join(root, 'Shop', 'batches', 'notes')));
    });
});

describe('a scenario\'s folder', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const store = require('./run-store');

    test('has no commas or semicolons; a store that kept one under its older name goes on with it', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
        const spec = { scenarioName: 'Demo shop, every product; v2' };
        const outDir = store.defaultOutDir(spec, 'stamp', { storeRoot: root });
        assert.equal(path.basename(path.dirname(path.dirname(outDir))), 'Demo-shop-every-product-v2');
        fs.mkdirSync(path.join(root, 'Demo-shop,-every-product;-v2'), { recursive: true });
        const kept = store.defaultOutDir(spec, 'stamp', { storeRoot: root });
        assert.equal(path.basename(path.dirname(path.dirname(kept))), 'Demo-shop,-every-product;-v2');
    });
});
