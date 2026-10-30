'use strict';

/**
 * Page chrome for the mockup only — the band, the view tabs, the annotation
 * notes and the feasibility table.
 *
 * The dashboard itself is NOT styled here. It comes from the app's own
 * stylesheet (the block between the compare markers in
 * src/css/compare.css) on the app's own tokens (src/report/report.css), the
 * same two pieces the exported comparison ships, so this page shows the shipped
 * component rather than a lookalike.
 */

module.exports = `
/* report.css pads the body and centres header/main for a report document; this
   page is a walkthrough, so it takes the full width back. */
body {
    margin: 0; padding: 0; background: var(--surface-1); color: var(--text-main);
    font-family: var(--font-sans); font-size: 15px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
}
header.mock-band, main.mock-views, section.feas { max-width: none; margin: 0; }
.wrap { max-width: 1160px; margin: 0 auto; padding: 0 28px; }
.mock-band { background: #131715; color: #e7ece8; padding: 22px 0 0; }
:root[data-theme="dark"] .mock-band { background: #0f1412; }
.mock-brandrow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.mock-mark { width: 30px; height: 30px; border-radius: 8px; flex: 0 0 auto; }
.mock-wordmark { font-family: var(--font-display); font-weight: 600; font-size: 16px; }
.mock-wordmark .dim { color: #9aa79f; font-weight: 400; }
.mock-tag {
    margin-left: auto; font-family: var(--font-mono); font-size: 11px; letter-spacing: .08em;
    text-transform: uppercase; color: #9aa79f; border: 1px solid rgba(255,255,255,.14);
    padding: 4px 10px; border-radius: 999px;
}
.mock-band h1 { color: #e7ece8; font-family: var(--font-display); font-size: clamp(28px, 4vw, 42px); font-weight: 600; margin: 26px 0 8px; max-width: 20ch; letter-spacing: -.015em; text-wrap: balance; }
.mock-band .sub { color: #9aa79f; max-width: 62ch; margin: 0; }
.mock-meta { display: flex; gap: 22px; flex-wrap: wrap; margin: 22px 0 0; padding: 0; list-style: none; }
.mock-meta li { font-size: 13px; color: #9aa79f; }
.mock-meta b { display: block; color: #e7ece8; font-family: var(--font-display); font-size: 17px; font-weight: 600; }

.mock-tabs { display: flex; gap: 4px; margin-top: 26px; }
.mock-tab {
    font: inherit; font-size: 14px; color: #9aa79f; background: transparent;
    border: 1px solid transparent; border-bottom: none; padding: 10px 18px;
    border-radius: 8px 8px 0 0; cursor: pointer;
}
.mock-tab:hover { color: #e7ece8; }
.mock-tab[aria-selected="true"] { background: var(--surface-1); color: var(--text-main); font-weight: 600; border-color: var(--border-subtle); }
.mock-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mock-views { padding: 34px 0 64px; }
[hidden] { display: none !important; }

/* Annotations are mockup chrome, deliberately unlike the product UI. */
.note {
    margin: 26px 0; border: 1px dashed var(--border-strong); border-left: 4px solid var(--accent);
    border-radius: 0 6px 6px 0; padding: 16px 20px; background: transparent;
}
.note-k { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin: 0 0 7px; }
.note p { font-size: 13.5px; color: var(--text-muted); max-width: 78ch; margin: 0; }
.note p + p { margin-top: 8px; }
.note strong { color: var(--text-main); }
.note ul { margin: 8px 0 0; padding-left: 20px; font-size: 13.5px; color: var(--text-muted); }
.note li + li { margin-top: 5px; }

.feas { background: var(--surface-0); border-top: 1px solid var(--border-subtle); padding: 52px 0 72px; }
.feas h2 { font-family: var(--font-display); font-size: 26px; font-weight: 600; margin: 0 0 6px; }
.feas .lede { color: var(--text-muted); max-width: 74ch; margin: 0 0 26px; font-size: 14px; }
.phases { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.phase { background: var(--surface-5); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 18px; }
.phase-n { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin: 0; }
.phase h3 { font-family: var(--font-display); font-size: 16px; margin: 6px 0 8px; }
.phase p { font-size: 13px; color: var(--text-muted); margin: 0; }
.phase .cost { display: inline-block; margin-top: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--text-soft); border: 1px solid var(--border-soft); padding: 3px 9px; border-radius: 999px; }
.ledger { margin-top: 26px; overflow-x: auto; }
.ledger table { border-collapse: collapse; width: 100%; font-size: 13px; }
.ledger th, .ledger td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border-soft); vertical-align: top; background: transparent; position: static; text-transform: none; letter-spacing: normal; }
.ledger thead th { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-soft); font-weight: 500; }
.ledger td.state { white-space: nowrap; }
.tag { font-family: var(--font-mono); font-size: 10.5px; padding: 2px 8px; border-radius: 999px; }
.tag--have { color: var(--ok); background: var(--ok-soft); }
.tag--new { color: var(--accent); background: var(--accent-soft); }
.tag--edit { color: var(--warn); background: var(--warn-soft); }
.mono { font-family: var(--font-mono); }

@media (max-width: 1000px) { .phases { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .phases { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

/* Forced colours. The dashboard brings its own block from the app stylesheet;
   this is the walkthrough's own chrome. The notes, cards and ledger already
   carry real borders, and the ledger tags say "new" or "unchanged" in words, so
   the tabs are the only thing here that state a state in colour alone. Unlike
   the app's underlined tabs these are filled, so they take the fill. */
@media (forced-colors: active) {
    .mock-tab { border-color: Canvas; }
    .mock-tab[aria-selected="true"] {
        background: Highlight;
        color: HighlightText;
        border-color: Highlight;
    }
}
`;
