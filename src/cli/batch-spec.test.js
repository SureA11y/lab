'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isBatch, checkBatch } = require('./batch-spec');
const { main, worstExit } = require('./run-workflow');
const { EXIT } = require('./baseline');

const SPEC = {
    type: 'a11y-run-spec',
    specVersion: 1,
    url: 'https://example.com/',
    vars: { env: 'live', page: 'home' },
    actions: [{ type: 'a11yScan', label: '{var:page}' }],
};

function batchSpec(over = {}) {
    return {
        type: 'a11y-batch-spec',
        specVersion: 1,
        name: 'Shop',
        spec: SPEC,
        rows: [
            { name: 'Home' },
            { name: 'Cart', url: 'https://example.com/cart', vars: { page: 'cart' } },
        ],
        ...over,
    };
}

function config(batch) {
    return {
        version: 1,
        type: 'a11y-ui-src-config',
        state: { 'url-input': 'https://example.com/', 'scenario-name': 'From the app', 'actions-workflow': SPEC.actions },
        batch,
    };
}

describe('isBatch', () => {
    test('a batch spec, or a config whose batch is on', () => {
        assert.equal(isBatch(batchSpec()), true);
        assert.equal(isBatch(config({ rows: [{ name: 'A' }], enabled: true })), true);
        assert.equal(isBatch(config({ rows: [{ name: 'A' }], enabled: false })), false);
        assert.equal(isBatch(config({ rowsText: '[{"name":', enabled: true })), false);
        assert.equal(isBatch(SPEC), false);
    });
});

describe('checkBatch', () => {
    test('one run per row: its name, its url or the workflow\'s, and the workflow\'s variables under its own', () => {
        const { ok, errors, batch } = checkBatch(batchSpec());
        assert.deepEqual(errors, []);
        assert.equal(ok, true);
        assert.equal(batch.name, 'Shop');
        assert.deepEqual(batch.runs.map((r) => [r.name, r.spec.url, r.spec.scenarioName, r.spec.vars]), [
            ['Home', 'https://example.com/', 'Home', { env: 'live', page: 'home' }],
            ['Cart', 'https://example.com/cart', 'Cart', { env: 'live', page: 'cart' }],
        ]);
    });

    test('a workflow without a url of its own is fine when every row has one', () => {
        const { url, ...noUrl } = SPEC;
        const rows = [{ name: 'A', url: 'https://example.com/a' }, { name: 'B', url: 'https://example.com/b' }];
        assert.deepEqual(checkBatch(batchSpec({ spec: noUrl, rows })).errors, []);
    });

    test('names runs by the pattern, as the app does', () => {
        const { batch } = checkBatch(batchSpec({ namePattern: 'Shop {var:page}', rows: [{ vars: { page: 'a' } }, { vars: { page: 'b' } }] }));
        assert.deepEqual(batch.runs.map((r) => r.name), ['Shop a', 'Shop b']);
    });

    test('reports the workflow\'s problems and the rows\' together', () => {
        const { ok, errors } = checkBatch(batchSpec({
            spec: { ...SPEC, actions: [{ type: 'navigate' }] },
            rows: [{ name: 'A', colour: 'red' }],
        }));
        assert.equal(ok, false);
        assert.deepEqual(errors, [
            'spec: $.actions[0] needs "url"',
            'Workflow 1: "colour" is not a workflow field. Use name, url and vars; other values go inside vars.',
        ]);
    });

    test('two runs with one name are refused, as the app refuses them', () => {
        const { errors } = checkBatch(batchSpec({ rows: [{ name: 'A' }, { name: 'A' }] }));
        assert.deepEqual(errors, ['Workflows 1 and 2 are both named "A"; each run needs its own name.']);
    });

    test('a batch spec\'s unknown field is a warning', () => {
        assert.deepEqual(checkBatch(batchSpec({ owner: 'me' })).warnings, ['$.owner "owner" is not a known field']);
    });

    test('a config\'s batch runs its form\'s workflow, named after its scenario', () => {
        const { errors, batch } = checkBatch(config({ rows: [{ name: 'A' }, { name: 'B', url: 'https://example.com/b' }], enabled: true }));
        assert.deepEqual(errors, []);
        assert.equal(batch.name, 'From the app');
        assert.deepEqual(batch.runs.map((r) => r.url), ['https://example.com/', 'https://example.com/b']);
    });
});

describe('worstExit', () => {
    test('a batch exits as its worst run', () => {
        assert.equal(worstExit([EXIT.OK, EXIT.NEW_INSTANCES, EXIT.DEGRADED]), EXIT.DEGRADED);
        assert.equal(worstExit([EXIT.LIKELY_FAILURES, EXIT.RUN_FAILED]), EXIT.RUN_FAILED);
        assert.equal(worstExit([EXIT.OK, EXIT.CANCELLED]), EXIT.CANCELLED);
        assert.equal(worstExit([EXIT.OK]), EXIT.OK);
    });
});

describe('run-workflow.js with a batch', () => {
    async function run(doc, args) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-cli-'));
        const file = path.join(dir, 'batch.json');
        fs.writeFileSync(file, JSON.stringify(doc));
        const out = [];
        const { log, error } = console;
        console.log = (...a) => out.push(a.join(' '));
        console.error = (...a) => out.push(a.join(' '));
        try {
            return { code: await main([file, ...args]), out, dir };
        } finally {
            console.log = log;
            console.error = error;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    test('--check says how many runs it holds', async () => {
        const { code, out } = await run(batchSpec(), ['--check']);
        assert.equal(code, EXIT.OK);
        assert.match(out.join('\n'), /ok, a batch of 2 runs, 1 step/);
    });

    test('--check lists every problem and exits 2', async () => {
        const { code, out } = await run(batchSpec({ rows: [{ name: 'A' }, { name: 'A' }] }), ['--check']);
        assert.equal(code, EXIT.BAD_USAGE);
        assert.match(out.join('\n'), /both named "A"/);
    });

    test('--no-batch checks a config\'s workflow alone', async () => {
        const { code, out } = await run(config({ rows: [{ name: 'A' }, { name: 'A' }], enabled: true }), ['--check', '--no-batch']);
        assert.equal(code, EXIT.OK);
        assert.match(out.join('\n'), /ok, 1 step/);
    });

    test('refuses what does not apply to a batch, before any browser opens', async () => {
        assert.equal((await run(batchSpec(), ['--url', 'https://example.com/x'])).code, EXIT.BAD_USAGE);
        const { code, out } = await run(batchSpec(), ['--baseline', 'old/payload.json']);
        assert.equal(code, EXIT.BAD_USAGE);
        assert.match(out.join('\n'), /use --baseline auto or @name/);
    });
});
