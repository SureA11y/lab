'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseRows, resolveBatch, collectVarTokens, interpolate, MAX_ROWS } = require('./batch-rows.js');

describe('parseRows', () => {
    test('reads a JSON list of rows', () => {
        const r = parseRows('[{"name":"v2.3"},{"name":"v2.4"}]');
        assert.equal(r.ok, true);
        assert.equal(r.rows.length, 2);
    });

    test('explains what is wrong with text that is not a list of rows', () => {
        assert.equal(parseRows('   ').empty, true);
        assert.match(parseRows('[{"name": "v2.3",}]').error, /^This is not valid JSON/);
        assert.match(parseRows('{"name":"v2.3"}').error, /must be a JSON list/);
        assert.match(parseRows('[]').error, /no workflows/);
        const many = JSON.stringify(Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ name: `r${i}` })));
        assert.match(parseRows(many).error, new RegExp(`at most ${MAX_ROWS} workflows`));
    });
});

describe('resolveBatch', () => {
    test('resolves each row into a run: its name, its url or the workflow\'s, its vars', () => {
        const r = resolveBatch({
            rows: [
                { name: 'v2.3', url: 'https://example.com/v2.3', vars: { date: '2026-03-01' } },
                { name: 'v2.4' },
            ],
            workflowUrl: 'https://example.com/',
        });
        assert.equal(r.ok, true);
        assert.deepEqual(r.runs, [
            { row: 1, name: 'v2.3', url: 'https://example.com/v2.3', vars: { date: '2026-03-01' } },
            { row: 2, name: 'v2.4', url: 'https://example.com/', vars: {} },
        ]);
    });

    test('a run name pattern fills from the row\'s vars, its name, url and row number', () => {
        const r = resolveBatch({
            rows: [{ name: 'v2.3', vars: { build: 2310 } }],
            namePattern: 'Product {var:name} build {var:build} (#{var:row})',
            workflowUrl: 'https://example.com/',
        });
        assert.equal(r.runs[0].name, 'Product v2.3 build 2310 (#1)');
    });

    test('names every problem by row, and queues nothing when there is one', () => {
        const r = resolveBatch({
            rows: [
                { name: 'ok', url: 'https://example.com/' },
                'v2.4',
                { nmae: 'typo' },
                { name: 'bad url', url: 'example.com/x' },
                { name: 'ftp', url: 'ftp://example.com/' },
                { name: 'vars', vars: { 'a.b': 1 } },
                { url: 'https://example.com/' },
                { name: 'ok' },
            ],
            workflowUrl: 'https://example.com/',
        });
        assert.equal(r.ok, false);
        assert.deepEqual(r.runs, []);
        assert.deepEqual(r.errors, [
            'Workflow 2 must be an object like { "name": …, "url": … }.',
            'Workflow 3: "nmae" is not a workflow field. Use name, url and vars; other values go inside vars.',
            'Workflow 4: "example.com/x" is not a full URL.',
            'Workflow 5: "ftp://example.com/" must start with http:// or https://.',
            'Workflow 6: vars: "a.b" is not a usable variable name (letters, digits, _ and -, not starting with a digit)',
            'Workflow 7 has no name. Give it one, or set a run name pattern.',
            'Workflows 1 and 8 are both named "ok"; each run needs its own name.',
        ]);
    });

    test('says which pattern token a row does not set', () => {
        const r = resolveBatch({
            rows: [{ name: 'a', vars: { build: 1 } }, { name: 'b' }],
            namePattern: '{var:name} {var:build} {var:date}',
            workflowUrl: 'https://example.com/',
        });
        assert.deepEqual(r.errors, [
            'Workflow 1: the run name uses {var:date}, which this workflow does not set.',
            'Workflow 2: the run name uses {var:build} and {var:date}, which this workflow does not set.',
        ]);
    });

    test('a row without a url needs the workflow to have one', () => {
        const r = resolveBatch({ rows: [{ name: 'a' }] });
        assert.deepEqual(r.errors, ['Workflow 1 has no url, and the workflow has none to fall back on.']);
    });

    test('warns, without blocking, about workflow tokens the rows do not set', () => {
        const workflow = {
            actions: [
                { type: 'navigate', url: 'https://example.com/{var:build}/{var:lang}' },
                { type: 'setVar', key: 'lang', value: 'en' },
                { type: 'group', actions: [{ type: 'click', labelText: 'Open {var:menu.label}' }] },
            ],
            customSteps: [],
        };
        const r = resolveBatch({
            rows: [{ name: 'a', vars: { build: 1 } }, { name: 'b' }, { name: 'c' }],
            workflowUrl: 'https://example.com/',
            workflow,
        });
        assert.equal(r.ok, true);
        assert.deepEqual(r.warnings, [
            'The workflow uses {var:build}, but workflows 2 and 3 do not set it. Fine if the workflow sets it itself, in a loop for instance.',
            'The workflow uses {var:menu}, but no workflow sets it. Fine if the workflow sets it itself, in a loop for instance.',
        ]);
    });
});

describe('helpers', () => {
    test('collectVarTokens finds tokens at any depth, by their root name', () => {
        assert.deepEqual([...collectVarTokens({ a: ['{var:x} {var:y.z}', { b: '{var:x}' }] })], ['x', 'y']);
    });

    test('interpolate reports the tokens it could not fill', () => {
        assert.deepEqual(interpolate('{var:a}-{var:b}', { a: 1, b: '' }), { text: '1-', missing: ['b'] });
    });
});

describe('row variables a workflow would hide', () => {
    test('a row variable named like a loop variable is refused', () => {
        const r = resolveBatch({ rows: [{ name: 'a', vars: { index: 1 } }, { name: 'b', vars: { value: 'x' } }], workflowUrl: 'https://example.com/' });
        assert.equal(r.ok, false);
        assert.match(r.errors[0], /^Workflow 1: "index" is a name every loop sets \(index, oneBased, total, item, value\)/);
        assert.match(r.errors[1], /^Workflow 2: "value" is a name every loop sets/);
    });

    test('custom steps that would hide a row variable are named, step by step', () => {
        const workflow = {
            actions: [],
            customSteps: [
                { id: 'login', name: 'Log in', actions: [{ type: 'group', actions: [{ type: 'setVar', key: 'build', value: '1' }] }] },
                { id: 'clean', actions: [{ type: 'clearVar', key: 'date' }, { type: 'getText', var: 'other' }] },
                { id: 'pass', actions: [{ type: 'runCustomStep', customStepId: 'x', argsJson: '{"build":"{var:build}","date":"today"}', exportVars: 'build' }] },
            ],
        };
        const r = resolveBatch({ rows: [{ name: 'a', vars: { build: 1, date: 'd' } }], workflowUrl: 'https://example.com/', workflow });
        assert.deepEqual(r.errors, [
            'Custom step "Log in": a Set variable step overwrites "build", which is a batch workflow variable. Rename one of them.',
            'Custom step "clean": a Clear variable step removes "date", which is a batch workflow variable. Rename one of them.',
            'Custom step "pass": a call to another custom step overwrites "build", which is a batch workflow variable. Rename one of them.',
            'Custom step "pass": a call to another custom step overwrites "date", which is a batch workflow variable. Rename one of them.',
        ]);
    });
});
