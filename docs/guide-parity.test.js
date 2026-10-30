'use strict';

// The runner's guide comes twice: scheduled-scans-guide.md, and
// unattended-scans.html, a shorter page to send someone. The page fell behind
// the Markdown once (an example spec the runner refuses, spec fields it no
// longer had, ones it lacked), so here both are held to the code: the same
// spec fields, all of them fields the runner reads; the runner's own options;
// and the app's viewport presets.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MD = fs.readFileSync(path.join(__dirname, 'scheduled-scans-guide.md'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'unattended-scans.html'), 'utf8');
const CLI = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'run-workflow.js'), 'utf8');
const { KNOWN_SPEC_KEYS } = require('../src/shared/run-spec.js');
const { VIEWPORT_PRESETS } = require('../src/shared/scan-inputs.js');

const sorted = (list) => [...new Set(list)].sort();

// The spec's field table: the rows after its "| Field | Required | Notes |" head.
function mdSpecFields() {
    const at = MD.indexOf('| Field | Required | Notes |');
    assert.notEqual(at, -1, 'the Markdown guide has its spec field table');
    const rows = MD.slice(at).split('\n').slice(2);
    const fields = [];
    for (const row of rows) {
        const m = row.match(/^\| `([^`]+)` \|/);
        if (!m) break;
        fields.push(m[1]);
    }
    return fields;
}

function htmlSpecFields() {
    const section = HTML.slice(HTML.indexOf('<section id="spec">'));
    const table = section.slice(section.indexOf('<table>'), section.indexOf('</table>'));
    return [...table.matchAll(/<tr><td><code>([^<]+)<\/code><\/td><td>(?:yes|no)<\/td>/g)].map((m) => m[1]);
}

// The options a help text lists: lines starting with two spaces and "--".
const optionsIn = (text) => sorted([...text.matchAll(/^ {2}(--[a-z][a-z-]*)/gm)].map((m) => m[1]));
const cliUsage = CLI.slice(CLI.indexOf('const USAGE = `'), CLI.indexOf('`;', CLI.indexOf('const USAGE = `')));

test('both guides document the same spec fields, and only fields the runner reads', () => {
    const md = mdSpecFields();
    assert.ok(md.length >= 5, `found ${md.join(', ')}`);
    assert.deepEqual(sorted(htmlSpecFields()), sorted(md));
    const unknown = md.filter((f) => !KNOWN_SPEC_KEYS.includes(f));
    assert.deepEqual(unknown, [], 'a documented field the runner does not read');
});

test('both guides list exactly the runner\'s own options', () => {
    const cli = optionsIn(cliUsage);
    assert.ok(cli.includes('--baseline') && cli.includes('--accept-untrusted-certs'), cli.join(' '));
    assert.deepEqual(optionsIn(MD), cli, 'scheduled-scans-guide.md');
    assert.deepEqual(optionsIn(HTML), cli, 'unattended-scans.html');
});

test('both guides name the app\'s viewport presets', () => {
    for (const name of Object.keys(VIEWPORT_PRESETS)) {
        assert.ok(MD.includes(`\`${name}\``), `scheduled-scans-guide.md lacks ${name}`);
        assert.ok(HTML.includes(`<code>${name}</code>`), `unattended-scans.html lacks ${name}`);
    }
});

test('an example spec puts no Include or Exclude selectors on the run', () => {
    // A run-level context or exclude is refused: they belong on scan steps.
    for (const [name, text] of [['scheduled-scans-guide.md', MD], ['unattended-scans.html', HTML]]) {
        const examples = [...text.matchAll(/"type": "a11y-run-spec"[\s\S]*?\n\}/g)].map((m) => m[0]);
        assert.ok(examples.length, `${name} has an example spec`);
        for (const ex of examples) {
            assert.doesNotMatch(ex.replace(/\{ "type": "a11yScan"[^}]*\}/g, ''), /"(context|exclude)":/, name);
        }
    }
});
