'use strict';

// Adding an engine is adding its adapter to ./engines and naming it in
// a11y-engine.config.json: nothing else in the lab changes. This runs the
// facade in a process of its own, with a stub adapter (test-support) found
// beside surea11y's and named by a config in that process's directory.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FACADE = path.join(__dirname, 'a11y-engine.js');
const STUB = path.join(__dirname, '..', 'test-support', 'stub-engine.js');

// The facade lists ./engines once, when it loads; the stub is added to that
// list, so it is found as an adapter put there would be.
const PROBE = `
const fs = require('fs');
const path = require('path');
const realReaddir = fs.readdirSync;
fs.readdirSync = function (dir, ...rest) {
    const out = realReaddir.call(this, dir, ...rest);
    return path.resolve(String(dir)) === ${JSON.stringify(path.join(__dirname, 'engines'))}
        ? [...out, path.relative(dir, ${JSON.stringify(STUB)})]
        : out;
};
const e = require(${JSON.stringify(FACADE)});
(async () => {
    const result = await e.runOnPage({}, { runOnly: { type: 'tag', values: ['wcag2a'] }, wcagLevel: 'A' });
    process.stdout.write(JSON.stringify({
        engineId: e.engineId,
        listed: e.listEngines().engines.map((x) => x.id),
        engines: result.canonical.engines,
        uids: result.canonical.findings.map((f) => f.uid),
        prepared: await e.preparePage({}),
        hooks: e.pageHooksFrom('none') === undefined,
        own: e.ownResult({ checksResults: [] }),
        ruleIds: e.getKnownRuleIds(),
        stubAppliesStandard: e.appliesStandard('stub'),
        targets: e.getCapabilities().conformanceTargets.length,
    }));
})().catch((err) => { process.stderr.write(String(err && err.stack || err)); process.exit(1); });
`;

function runWithStub() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-engine-'));
    try {
        fs.writeFileSync(path.join(dir, 'a11y-engine.config.json'), JSON.stringify({ engineId: 'stub' }));
        return JSON.parse(execFileSync(process.execPath, ['-e', PROBE], { cwd: dir, encoding: 'utf8' }));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('a new engine adapter', () => {
    const out = runWithStub();

    test('is found beside surea11y, and the config makes it the lab\'s engine', () => {
        assert.deepEqual(out.listed, ['stub', 'surea11y']);
        assert.equal(out.engineId, 'stub');
    });

    test('runs a scan whose findings say they are its own', () => {
        assert.deepEqual(out.engines, [{ id: 'stub', name: 'Stub', version: '0.0.1' }]);
        assert.deepEqual(out.uids, ['stub|fail:stub-rule']);
    });

    test('gets the defaults for the hooks it leaves out', () => {
        assert.deepEqual(out.prepared, []);
        assert.equal(out.hooks, true);
        assert.equal(out.own, null);
        assert.equal(out.stubAppliesStandard, false);
    });

    test('gives the step editor its rule ids, and its conformance targets', () => {
        assert.deepEqual(out.ruleIds, { engines: [{ id: 'stub', ruleIds: ['stub-rule'] }] });
        assert.ok(out.targets > 0);
    });
});
