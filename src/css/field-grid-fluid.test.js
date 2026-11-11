'use strict';

// The actions builder's field grids must size their columns against the
// grid's own box, not the viewport. A nested step only gets the panel width
// minus every ancestor's indent, padding and rail, so viewport breakpoints
// handed deeply nested steps a 4x180px grid that could not fit: the nested
// card rendered wider than the parent card it sits in, and long labels ran
// over the next column. The grids are fluid: as many columns of at least
// 14rem as there is room for (auto-fit), and the fields there are share the
// row, so two fields in a wide step are not two 200px ones beside an empty
// row.
//
// jsdom computes no layout, so the guarantee is asserted against the stylesheet
// source.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {readAppCss} = require('./app-styles');

const CSS = readAppCss();

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
    return decl ? decl[1].trim() : null;
}

describe('actions builder field grids size themselves', () => {
    test('each step row is an inline-size query container', () => {
        const lineRule = BLOCKS.find(
            (b) => b.prelude === ':is(#actions-builder, #custom-step-actions-builder) .line'
        );
        assert.ok(lineRule, '.line rule is present');
        assert.match(lineRule.body, /container-type:\s*inline-size/);
    });

    test('both grids take as many 14rem columns as fit, never more than the grid is wide', () => {
        const bases = BLOCKS.filter((b) => GRID_SELECTOR.test(b.prelude) && columnsIn(b.body));
        assert.equal(bases.length, 2, 'both .fields and .runcustomstep-dynamic-inputs declare their columns');
        for (const base of bases) {
            // min(14rem, 100%): a step narrower than one column gets one column
            // its own width, and the card is never pushed wider than its parent.
            assert.equal(columnsIn(base.body), 'repeat(auto-fit, minmax(min(14rem, 100%), 1fr))', base.prelude);
        }
    });

    test('no breakpoint, of the viewport or of the container, sets their columns', () => {
        const offenders = BLOCKS
            .filter((b) => (b.prelude.startsWith('@media') || b.prelude.startsWith('@container')) && GRID_SELECTOR.test(b.body))
            .filter((b) => /grid-template-columns/.test(b.body))
            .map((b) => b.prelude);
        assert.deepEqual(offenders, []);
    });

    test('a URL, a selector, a text or a value takes the whole row', () => {
        const wide = BLOCKS.find((b) => b.prelude === ':is(#actions-builder, #custom-step-actions-builder) .fields > .field[data-wide="true"]');
        assert.ok(wide);
        assert.match(wide.body, /grid-column:\s*1\s*\/\s*-1/);
    });
});
