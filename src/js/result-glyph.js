'use strict';

/**
 * Result-state glyph tiles — SureA11y design system "five outcomes".
 *
 * A filled tile with the glyph knocked out (never a bare character):
 * radius = size × 0.21875, glyph = size × 0.68, IBM Plex Mono 700.
 * Colour + glyph + word, never colour alone. The tile itself is
 * decorative (aria-hidden); the word beside it carries the meaning.
 * Styling lives in css/a11y-lab-ui.css (.result-glyph*); the spec is
 * the design system's guidelines/result-glyphs.md.
 *
 * The app's canonical outcome keys map onto the design system's state
 * keys: cantTell → "unknown", notApplicable → "na"; pass/fail/advisory
 * keep their names.
 */
const RESULT_GLYPHS = {
    fail:          { cls: 'fail',     glyph: '✕' }, // ✕
    cantTell:      { cls: 'unknown',  glyph: '?' },
    pass:          { cls: 'pass',     glyph: '✓' }, // ✓
    notApplicable: { cls: 'na',       glyph: '–' }, // –
    advisory:      { cls: 'advisory', glyph: '!' },
};

function classFor(outcome, size) {
    const g = RESULT_GLYPHS[outcome];
    if (!g) return null;
    return 'result-glyph result-glyph--' + g.cls + (size === 'sm' ? ' result-glyph--sm' : '');
}

/** HTML string for a result tile, for string-built markup. */
export function resultGlyphHtml(outcome, { size } = {}) {
    const g = RESULT_GLYPHS[outcome];
    const cls = classFor(outcome, size);
    if (!g || !cls) return '';
    return '<span class="' + cls + '" aria-hidden="true">' + g.glyph + '</span>';
}

/** DOM element variant, for renderers that build nodes rather than strings. */
export function resultGlyphEl(outcome, { size, doc = document } = {}) {
    const g = RESULT_GLYPHS[outcome];
    const cls = classFor(outcome, size);
    if (!g || !cls) return null;
    const el = doc.createElement('span');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = g.glyph;
    return el;
}
