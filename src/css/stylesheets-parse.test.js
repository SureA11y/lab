'use strict';

// Every stylesheet parses whole. A rule that loses its selector (an edit that
// replaced the selector's line in place of the comment above it) is not an
// error a browser shows: it takes the rule's declarations, up to the next "{",
// for one long selector it cannot match and drops it with the rule after it.
// The extension's buttons lost all their styles that way, .btn and
// .btn:hover, and every test that reads rules by selector still passed: the
// rule was not wrong, it was gone.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const {APP_STYLESHEETS, PAGE_STYLESHEETS} = require('./app-styles');

const ROOT = path.resolve(__dirname, '..', '..');
const SHEETS = [
    ...APP_STYLESHEETS.map((name) => path.join(__dirname, name)),
    ...Object.values(PAGE_STYLESHEETS).flat().map((name) => path.join(__dirname, name)),
    path.join(ROOT, 'src', 'report', 'report.css'),
    path.join(ROOT, 'extension', 'ui.css'),
];

// What a sheet's parse finds wrong: its errors, and any rule whose selector
// could not be read (kept as raw text), each with its line.
function problemsOf(file) {
    const problems = [];
    const ast = csstree.parse(fs.readFileSync(file, 'utf8'), {
        positions: true,
        onParseError: (e) => problems.push(`line ${e.line}: ${e.message}`),
    });
    csstree.walk(ast, {
        enter(node) {
            if (node.type === 'Rule' && node.prelude && node.prelude.type === 'Raw') {
                problems.push(`line ${node.loc.start.line}: a rule whose selector is "${node.prelude.value.trim().slice(0, 60)}"`);
            }
        },
    });
    return problems;
}

describe('every stylesheet parses whole', () => {
    for (const file of SHEETS) {
        test(path.relative(ROOT, file), () => {
            assert.ok(fs.existsSync(file), `${file} exists`);
            assert.deepEqual(problemsOf(file), []);
        });
    }

    test('the extension\'s buttons have their rule', () => {
        const css = fs.readFileSync(path.join(ROOT, 'extension', 'ui.css'), 'utf8');
        let found = false;
        csstree.walk(csstree.parse(css), {
            enter(node) {
                if (node.type === 'Rule' && csstree.generate(node.prelude) === '.btn') found = true;
            },
        });
        assert.ok(found, '.btn {…} is in extension/ui.css');
    });
});
