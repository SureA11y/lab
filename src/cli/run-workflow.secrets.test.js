'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('./run-workflow');
const { EXIT } = require('./baseline');

const SPEC = {
    type: 'a11y-run-spec',
    specVersion: 1,
    url: 'https://example.com/',
    actions: [{ type: 'setPassword', labelText: 'Password', value: { $env: 'LAB_UNSET_SECRET_FOR_TEST' } }],
};

async function run(doc, args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-cli-'));
    const file = path.join(dir, 'spec.json');
    fs.writeFileSync(file, JSON.stringify(doc));
    const out = [];
    const { log, error } = console;
    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => out.push(a.join(' '));
    try {
        return { code: await main([file, '--out', path.join(dir, 'out'), ...args]), out: out.join('\n'), dir: fs.readdirSync(dir) };
    } finally {
        console.log = log;
        console.error = error;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('an unset reference stops the run before a browser opens, with exit 2, writing nothing', async () => {
    delete process.env.LAB_UNSET_SECRET_FOR_TEST;
    const { code, out, dir } = await run(SPEC, []);
    assert.equal(code, EXIT.BAD_USAGE);
    assert.match(out, /\$LAB_UNSET_SECRET_FOR_TEST is not set in the environment/);
    assert.deepEqual(dir, ['spec.json']);
});

test('--check only warns: the spec may run elsewhere', async () => {
    delete process.env.LAB_UNSET_SECRET_FOR_TEST;
    const { code, out } = await run(SPEC, ['--check']);
    assert.equal(code, EXIT.OK);
    assert.match(out, /Warning: \$LAB_UNSET_SECRET_FOR_TEST is not set in the environment here/);
});

test('a batch stops the same way', async () => {
    delete process.env.LAB_UNSET_SECRET_FOR_TEST;
    const batch = { type: 'a11y-batch-spec', specVersion: 1, name: 'B', spec: SPEC, rows: [{ name: 'A' }] };
    const { code, out } = await run(batch, []);
    assert.equal(code, EXIT.BAD_USAGE);
    assert.match(out, /is not set in the environment/);
});
