#!/usr/bin/env node
'use strict';

/**
 * Brings saved configurations and run specs up to the current format
 * (src/shared/config-upgrade.js says what changes). Without --write it says
 * what it would change; with it, the files are rewritten in place, keeping
 * their indentation. Each file is then checked as --check checks a spec, so
 * what is left to do by hand is said too.
 */

const fs = require('fs');
const path = require('path');

const { checkSpec } = require('./check-spec');

const USAGE = `Usage: node src/cli/convert-config.js <file or folder>... [--write]

Brings saved configurations (.a11y-config.json) and run specs up to the
current format. A folder is searched for .json files. Without --write, says
what it would change; with it, rewrites the files in place. Commit or copy
them first.

Exit codes:
  0  every file is current, or now is
  2  bad usage
  4  a file still has problems --check reports, listed`;

const { convertDocument, convertStep } = require('../shared/config-upgrade.js');

/** The indentation a JSON file was written with, to write it back the same. */
function indentOf(text) {
    const m = /^\{\s*\n([ \t]+)"/.exec(text);
    return m ? m[1] : 2;
}

function jsonFilesUnder(target) {
    const stat = fs.statSync(target);
    if (stat.isFile()) return [target];
    const out = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) out.push(...jsonFilesUnder(full));
        else if (entry.name.endsWith('.json')) out.push(full);
    }
    return out;
}

function main(argv, { log = console.log, error = console.error } = {}) {
    const write = argv.includes('--write');
    const targets = argv.filter((a) => a !== '--write');
    if (argv.includes('-h') || argv.includes('--help')) {
        log(USAGE);
        return 0;
    }
    const unknown = targets.filter((a) => a.startsWith('-'));
    if (!targets.length || unknown.length) {
        error(unknown.length ? `Unknown option ${unknown.join(', ')}` : 'No file or folder given');
        error(`\n${USAGE}`);
        return 2;
    }

    let files;
    try {
        files = targets.flatMap((t) => jsonFilesUnder(path.resolve(t)));
    } catch (e) {
        error(`Error: ${e.message}`);
        return 2;
    }

    let changedFiles = 0;
    let stillWrong = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            continue; // not JSON a config can be
        }
        const { kind, doc, changes, notes } = convertDocument(parsed);
        if (!kind) continue;

        const rel = path.relative(process.cwd(), file);
        const { errors, warnings } = checkSpec(doc);
        if (!changes.length && !notes.length && !errors.length) continue;

        log(`\n${rel}${changes.length ? (write ? ' (rewritten)' : ' (would change)') : ''}`);
        for (const c of changes) log(`  ${c}`);
        for (const n of notes) log(`  Note: ${n}`);
        for (const w of warnings) log(`  Warning: ${w}`);
        for (const e of errors) log(`  Still to fix: ${e}`);

        if (changes.length) {
            changedFiles += 1;
            if (write) fs.writeFileSync(file, JSON.stringify(doc, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''), 'utf8');
        }
        if (errors.length) stillWrong += 1;
    }

    log(`\n${changedFiles ? `${changedFiles} file${changedFiles === 1 ? '' : 's'} ${write ? 'rewritten' : 'to change: run again with --write'}` : 'Nothing to change'}`
        + (stillWrong ? `, ${stillWrong} with problems left to fix by hand` : '') + '.');
    return stillWrong ? 4 : 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { convertDocument, convertStep, main };
