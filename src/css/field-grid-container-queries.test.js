'use strict';

// The actions builder's field grids must size their columns against the step's own
// box, not the viewport. A nested step only gets the panel width minus every
// ancestor's indent, padding and rail, so viewport breakpoints handed deeply nested
// steps a 4x180px grid that could not fit: the nested card rendered wider than the
// parent card it sits in, and long labels ran over the next column.
//
// jsdom computes no layout, so the guarantee is asserted against the stylesheet
// source: the breakpoints must be @container (not @media), and each one must be at
// least as wide as the columns it turns on actually need.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, 'a11y-lab-ui.css'), 'utf8');

// The tracks the grids are built from: N columns need N * MIN_COL + (N - 1) * GAP.
const MIN_COL = 180;
const GAP = 16;

const GRID_SELECTOR = /:is\(#actions-builder, #custom-step-actions-builder\) \.(fields|runcustomstep-dynamic-inputs)\b/;

// Walk top-level blocks, returning {prelude, body} for each. Nested at-rules are
// returned as one block whose body still holds the inner rules.
function topLevelBlocks(css) {
    const blocks = [];
    let depth = 0;
    let start = 0;
    let openAt = -1;
    for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (ch === '{') {
            if (depth === 0) openAt = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                blocks.push({
                    prelude: css.slice(start, openAt).trim(),
                    body: css.slice(openAt + 1, i)
                });
                start = i + 1;
            }
        }
    }
    return blocks;
}

const BLOCKS = topLevelBlocks(CSS);

function columnsIn(body) {
    const decl = body.match(/grid-template-columns:\s*([^;]+);/);
    if (!decl) return null;
    const value = decl[1].trim();
    const repeated = value.match(/repeat\(\s*(\d+)\s*,/);
    return { value, count: repeated ? Number(repeated[1]) : 1 };
}

describe('actions builder field grids are container-driven', () => {
    test('each step row is an inline-size query container', () => {
        const lineRule = BLOCKS.find(
            (b) => b.prelude === ':is(#actions-builder, #custom-step-actions-builder) .line'
        );
        assert.ok(lineRule, '.line rule is present');
        assert.match(lineRule.body, /container-type:\s*inline-size/);
    });

    test('the grids default to one full-width column before any breakpoint', () => {
        const bases = BLOCKS.filter((b) => GRID_SELECTOR.test(b.prelude) && columnsIn(b.body));
        assert.equal(bases.length, 2, 'both .fields and .runcustomstep-dynamic-inputs declare a base');
        for (const base of bases) {
            const cols = columnsIn(base.body);
            assert.equal(cols.count, 1, `${base.prelude} starts at one column`);
            // minmax(0, ...) so even a container narrower than one column cannot
            // push the grid past the card that holds it.
            assert.match(cols.value, /minmax\(\s*0/, `${base.prelude} floors its track at 0`);
        }
    });

    test('extra columns are turned on by @container, never by @media', () => {
        const offenders = BLOCKS
            .filter((b) => b.prelude.startsWith('@media') && GRID_SELECTOR.test(b.body))
            .filter((b) => /grid-template-columns/.test(b.body))
            .map((b) => b.prelude);
        assert.deepEqual(offenders, [], 'no viewport media query sizes the builder field grids');

        const containerRules = BLOCKS.filter(
            (b) => b.prelude.startsWith('@container') && GRID_SELECTOR.test(b.body)
        );
        assert.ok(containerRules.length >= 6, 'both grids get their 2/3/4-column steps from @container');
    });

    test('every breakpoint is wide enough for the columns it turns on', () => {
        const containerRules = BLOCKS.filter(
            (b) => b.prelude.startsWith('@container') && GRID_SELECTOR.test(b.body)
        );
        for (const rule of containerRules) {
            const bp = rule.prelude.match(/min-width:\s*(\d+)px/);
            assert.ok(bp, `${rule.prelude} queries a min-width`);
            const width = Number(bp[1]);
            const cols = columnsIn(rule.body);
            assert.ok(cols, `${rule.prelude} sets grid-template-columns`);
            const needed = cols.count * MIN_COL + (cols.count - 1) * GAP;
            assert.ok(
                width >= needed,
                `${rule.prelude} turns on ${cols.count} columns, which need ${needed}px, but fires at ${width}px`
            );
        }
    });
});
