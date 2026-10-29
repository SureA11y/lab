'use strict';

// Every relative link in the documentation leads somewhere: to a file that
// exists, and, for a link into a Markdown file, to a heading it has. Design
// notes are a record, and left as they were written.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'design', 'dist', 'reports', 'a11y-runs']);

function markdownFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...markdownFiles(full));
        else if (entry.name.endsWith('.md')) out.push(full);
    }
    return out;
}

// GitHub's anchors: lower case, punctuation dropped, spaces as hyphens.
function anchorsOf(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1]
        .trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-')));
}

const files = markdownFiles(ROOT);

test('the documentation has its pages', () => {
    for (const page of ['README.md', 'docs/README.md', 'docs/getting-started.md', 'docs/use-cases/README.md', 'examples/README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md']) {
        assert.ok(fs.existsSync(path.join(ROOT, page)), page);
    }
});

for (const file of files) {
    test(`links in ${path.relative(ROOT, file)} lead somewhere`, () => {
        const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
        const broken = [];
        for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
            if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
            const [where, anchor] = target.split('#');
            const resolved = path.resolve(path.dirname(file), decodeURIComponent(where));
            if (!fs.existsSync(resolved)) {
                broken.push(`${target} (no such file)`);
            } else if (anchor && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) {
                broken.push(`${target} (no such heading)`);
            }
        }
        assert.deepEqual(broken, []);
    });
}
