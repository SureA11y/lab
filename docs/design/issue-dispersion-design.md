# Where the Failures Are: Issue Dispersion — Design Notes

> Status: **Shipped.** The report view, the exported report, both comparison
> views and the extension panel show "Where the failures are". This document
> keeps the definitions, the reasoning and the rejected alternatives; §13
> records what was built and where it departs from the plan.
>
> The planning mockup with generated data is at
> `docs/design/mockups/issue-dispersion.html`. The shipped section uses the same
> rules, but the mockup is a standalone page and does not import the shipped
> code.

## 1. Motivation

Two reports can have the same number of failing rules and need completely
different work. Three rules that fail in all 300 scans of a run are one broken
shared component: fix it once and the run is clean. The same three rules in 5
of those 300 scans are a problem in one flow. Totals, scores and the per-rule
diff cannot tell those apart; how the failures are *spread* across the scans
can.

The feature answers three questions, in this order:

1. **What pattern is this run?** Widespread, concentrated, scattered or mixed.
2. **Where are the failures?** Which scans or stretches of the run.
3. **What kind of problem is each rule?** Shared component, broken template,
   broken page or state, or one-off.

And, when comparing, **how did that change?** A rule whose count stayed flat
while it went from every scan to one flow was contained, and that is the
movement the current comparison cannot show.

## 2. Decisions

These were settled while planning and are the premises of everything below.

- **D1: the denominator is scans, not pages.** Dispersion is measured against
  the analyzed, included scans of the run. Counting by page or path would hide
  most of the signal for a single-page app, where one URL carries many states,
  and would merge a workflow's steps into one "page".
- **D2: an issue is a failing rule.** A rule is present in a scan when it has
  at least one failing occurrence there. Element counts only add weight
  (intensity, shading); they never define identity. This matches the
  comparison engines, which already match rules and not elements
  (`workflow-run-comparison-design.md` §4.1).
- **D3: automatic failures only.** `cantTell` results are not counted in any
  metric. They get one sentence in the explanation ("4 more rules need manual
  review in 120 scans; they are not counted here") so they stay visible.
- **D4: computed, not stored.** Dispersion is derived when a report is shown,
  from the scans in the current view. The JSON format does not change (§7).
- **D5: visual and explained.** Every chart comes with a generated explanation
  that says what the pattern means and what to do next, and with a table
  version of its data.
- **D6: the order is the report's scan order.** The strip, the hotspots and
  the explanation follow the order of the scans in the report, and they update
  when the user moves a scan. Until the user moves one, that order is the
  workflow order.

## 3. Vocabulary, and the clash to avoid

The codebase already has a "reach" that is **page-based**:

- `buildMatrix` in `src/shared/report-multi-diff.js` classifies each rule as
  `systemic` / `partial` / `local` by distinct page paths over analyzed scans
  (`scopeOf`, same 60% and 25% thresholds).
- Occurrence mining (`src/server-side/metrics/occurrence-mining.js`) calls a
  defect systemic when it is on every scanned page, and the "Where the issues
  cluster" section shows that reading.

Dispersion is **scan-based** (D1), so it must not reuse those words or they
will disagree on screen for the same rule. The terms used here:

| Term | Meaning |
|---|---|
| **scan reach** | Share of analyzed scans in which the rule fails. |
| **widespread / partial / local** | Scan reach ≥ 60% / 25–60% / < 25%. The thresholds match `scopeOf`, but the words deliberately do not repeat `systemic`. |
| **presence** | One (rule, scan) pair where the rule fails. |
| **intensity** | Failing elements per scan where the rule fails. |
| **hotspot** | A stretch of consecutive scans that carries most of the non-widespread failures. |
| **pattern** | The run-level reading: widespread, concentrated, scattered, mixed. |

If both readings are ever shown side by side, the page-based one keeps its
current label ("On every page scanned") and the scan-based one says "scans".

## 4. Metrics

**Input:** the scans in the current view, in the report's scan order (D6):
the order of `payload.scans`, which is what a move changes. That
means the included scans (`includedInReport !== false`), after the active tag
filter and engine lens, with skipped scans (`skipped` or `skipInfo`) left out.
It is the same set `recomputeDerivedReportData` already uses for the global
findings and metrics, minus the skipped scans. `N` is the number of scans in
that set.

**Per scan:** the failing rules, read the same way as `collectFailingRules`
(`src/shared/report-diff.js`) so rule identity and severity agree with the
comparison. Occurrences are split by occurrence outcome first, as the tables do
(`splitFindingByOccurrenceOutcome`), so a rule whose only occurrences in a scan
are `cantTell` is not present there.

| Metric | Definition | Reads as |
|---|---|---|
| `affectedRate` | scans with ≥ 1 failing rule ÷ N | "79% of scans have automatic failures" |
| `reach(rule)` | scans where the rule fails ÷ N | per-rule spread |
| `intensity(rule)` | failing elements of the rule ÷ scans where it fails | "5.4 elements per failing scan" |
| `footprint` | presences ÷ (R × N), with R the number of failing rules | 100% = every rule in every scan |
| `top10Share` | failing elements in the worst ⌈10% of N⌉ scans ÷ all failing elements | ~10% when spread evenly |
| `scansFor80` | fewest scans that hold 80% of the failing elements, and that as a share of N | "Just 1.7% of scans hold 80% of the failures" |
| `bands` | number of rules that are widespread / partial / local | "3 · 1 · 4" |
| `cleanIfWidespreadFixed` | scans whose failing rules are all widespread, plus clean scans | "fixing those 3 would leave 208 of 300 clean" |

**Rule kind (the rule map's quadrants):** widespread means reach ≥ 60%; heavy
means intensity ≥ 3.

| | light (< 3) | heavy (≥ 3) |
|---|---|---|
| **widespread** | Shared component | Broken template |
| **not widespread** | One-off | Broken page or state |

**Hotspots.** A scan is flagged when it has two or more non-widespread failing
rules, or one or more when `affectedRate ≤ 20%`. Flagged scans at most 2 apart
(in scan order) are grouped into one stretch. A stretch is a hotspot when
it holds at least 15% of the failing elements of non-widespread rules. At most
the two largest are reported, each with its scan range and the step labels it
covers.

**Minimum data.** With fewer than **10** scans, percentages are not shown and
no pattern is claimed; the strip and the counts still are. With no failing
rules, the section says so in one line and draws nothing.

**Not used:** the Gini coefficient and the Lorenz curve. They measure the same
thing as `top10Share` and `scansFor80` but need explaining, and are unstable
with small counts. `scansFor80` is the headline because it reads as a
sentence.

All thresholds (60%, 25%, 3 elements, 10 scans, 15%, 20%) are starting values,
to be checked against real reports (§12).

## 5. Pattern

Evaluated in order; the first match wins.

| # | Condition | Pattern |
|---|---|---|
| 1 | N < 10 | Too few scans |
| 2 | no failing rules | No automatic failures |
| 3 | `affectedRate ≤ 20%` | Concentrated |
| 4 | every failing rule is widespread | Widespread |
| 5 | at least one widespread rule | Mixed |
| 6 | `top10Share ≥ 60%` | Concentrated |
| 7 | otherwise | Scattered |

What each suggests, which the explanation says:

- **Widespread:** shared template or component. Fix once, large gain.
- **Concentrated:** one flow, page or state. Start by opening those scans.
- **Scattered:** content and authoring. No single fix; guidance and checks for
  authors help more than a patch.
- **Mixed:** fix the widespread core first, then the hotspots.

The pattern is shown as a badge that has an icon and a text label as well as a
colour.

## 6. Explanation

Generated from rules and templates, like `src/js/a11y-narrative.js`, not by a
language model: it has to be reproducible, work offline, and be identical in
the app and in the exported HTML.

Rules for every sentence:

- It is backed by a number from §4, and the number is in the sentence.
- It uses cautious verbs for causes ("suggests", "usually means") and plain
  ones for facts.
- It ends with what to do next when there is something to do.
- Rule ids are shown as code; step names come from the scans (§12).

Structure: one bold sentence for the pattern with its key number, one or two
sentences for the reading and the next step, an optional sentence for heavy
widespread rules (Broken template), and the can't-tell note last.

Example (mixed):

> **A widespread core plus local problems.** `region`, `link-name` and
> `color-contrast` fail in 73%–100% of the 300 scans, which suggests a shared
> component. Fixing those 3 alone would leave 208 of 300 scans clean. The other
> 5 rules are more local: 39% of their failing elements are in scans 120–125
> (Payment). Also, 4 rules need manual review in 120 scans. They are not
> counted here.

## 7. Where it is computed

A new shared module, **`src/shared/issue-dispersion.js`**, with pure functions
and its own tests, in the same style as `report-diff.js` and
`report-multi-diff.js`:

```js
analyseDispersion(scans) → {
    scansAnalyzed, rulesFailing, enoughData, pattern,
    affectedScans, affectedRate, footprint, top10Share,
    scansFor80, scansFor80Share, totalElements, cleanIfWidespreadFixed,
    medianRulesPerAffectedScan, maxRulesInScan,
    bands: { widespread, partial, local },
    rules:   [{ ruleId, title, severity, scans, reach, elements, intensity, band, kind }],
    perScan: [{ index, scanId, label, widespread, other, otherElements, elements, ruleIds }],
    hotspots:[{ fromIndex, toIndex, scanCount, scanIds, labels, ellipsis, elements, share }],
    cantTell:{ rules, scans },
}
compareDispersion(a, b)   → { a, b, rows: [{ ruleId, a, b, delta, change }], counts }   // §10
seriesDispersion(results) → { results, rows: [{ ruleId, reach: [], trend }] }          // §10
```

The words and pictures live beside it in **`src/shared/issue-dispersion-view.js`**:
the explanation (§6), the report section, the strip, the rule map, the
comparison bodies and one delegated interaction layer.

Everything that shows dispersion calls these two modules: the app's report view,
the exported report, both comparison engines and the extension. That way the
numbers cannot drift apart.

**Why it is not stored in the JSON:**

- The result depends on things that change after the run: scans excluded by
  hand, the tag filter, the engine lens, files merged into one report, and
  runs with skipped scans. A stored value would be stale as soon as any of
  those changed.
- The loader already discards stored derived values and rebuilds them
  (`a11yGlobalFindings` and `metrics` are rebuilt by
  `recomputeDerivedReportData`, `src/js/a11y-ui.js`; since report version 3
  `a11yGlobalFindings` is not saved at all). Dispersion follows the same
  rule.
- It is cheap: one pass over scans × failing rules. 300 scans with about 50
  rules each is on the order of 15,000 operations, well under a millisecond.
  Drawing the charts costs more than computing them.

The cost is that a third-party tool reading the raw JSON does not get the
dispersion numbers. It can compute them from the scans, which carry all the
input. That is acceptable: dispersion is something the app provides.

## 8. Report view

**Placement:** a new section in the Summary report, "Where the failures are",
right after the summary table. It is data about the failures, not a score, so
it shows in every presentation mode ("Findings", "Failures only" and "Findings
and analysis"), unlike the analysis metrics. "Where the issues cluster"
(`renderOccurrenceSection`, `src/js/a11y-metrics-renderer.js`) reads the same
question by page; this one reads it by scan. It is recomputed wherever `recomputeDerivedReportData`
runs, so it appears after a workflow finishes, when a report is loaded, and
after any exclude, filter or engine change.

**Only when something fails:** with no failing rule in the scans in view, the
section is left out, as there is nothing to place and the totals already say
"0 fail". Scans with only "can't tell" items count as none failing. Compare
leaves it out the same way when none of its reports fails; when one does, the
others show as "No automatic failures" (§5) beside it.

**Contents, top to bottom** (see the mockup):

1. **Pattern badge and explanation** (§5, §6).
2. **Four numbers:** scans with failures, footprint, share in the worst 10% of
   scans, and widespread · partial · local. With too few scans, only the scan
   and rule counts are shown.
3. **Concentration bars:** two bars on one track, the scans bar and the 80%
   failing-elements bar, headed by one sentence. It reads "Just X%…" below
   20%, "X%…" from 20% to 50%, and "Evenly spread: it takes X%…" from 50% up.
4. **Scan strip:** one column per scan, in the report's scan order (§8.1).
   - Column height is the number of failing rules. Widespread rules are the
     bottom segment, other rules the top segment, in two colours with a gap
     between them.
   - Clean scans show a thin baseline tick, so "clean" is readable without
     colour.
   - Scan numbers run under the strip. Hotspots are bracketed above it with
     their scan range and scan names.
   - Hovering shows the scan's rules, and clicking a column goes to its scan
     card.
   - Above it, the rule filter and the column height switch (§8.2).
   - Keyboard: the strip is one tab stop, a slider whose value text reads out
     the current scan. The arrow keys move one scan, Page Up and Page Down
     move ten, Home and End go to the ends, and Enter opens the scan.
5. **Rule map:** a scatter of failing rules.
   - Horizontal: scan reach, 0–100%. Vertical: intensity. Dot size: severity.
     Colour: widespread vs not.
   - Dashed lines at 60% and 3 elements, with the four quadrant names (§4)
     written in the corners.
   - Labels are placed next to their dots, avoiding other dots and the
     quadrant titles. At most 8 are labelled, or 3 when there are more than
     10 rules, with a note that the table has the rest.
   - Every dot has a tooltip. The table after the chart is the keyboard and
     screen-reader route (§13).

With too few scans, the pattern and the percentages are left out, but the
strip and the map are still drawn.

### 8.1 Scan order and moves

The strip reads the scans in the order of `payload.scans`. A move
(`moveScan`, `scan-reordering-design.md`) swaps entries in that array, so the
strip and the hotspots follow the user's order. This matters because users
move scans to bring related ones together: a problem split across two distant
parts of the workflow becomes one hotspot once those scans sit side by side.

Only the order-dependent parts change on a move: the strip, the hotspots, and
the hotspot sentence of the explanation. The counts, reach, footprint,
concentration, rule map and pattern do not depend on order, so the pattern
badge never changes on a move.

The move fast path currently recomputes nothing: it restamps
`data-sort-order` and swaps card elements, at about 2–9 ms per move. The
dispersion section adds a small, bounded exception:

- After a move, rerun `analyseDispersion` and replace **only** the dispersion
  section's DOM. That is well under a millisecond of analysis plus one SVG of
  N rects, so it stays in budget. Nothing else is re-rendered, and the scroll
  position is untouched.
- Debounce it (one animation frame, or about 150 ms) so a burst of moves, or a
  future group move, updates the section once.
- If focus was inside the strip, keep it there and keep the cursor on the same
  scan (by `scanId`, not by index), so keyboard users do not lose their place.

**The view sort does not affect the strip.** Sorting the scan list (by score,
by failures and so on, `src/shared/scan-sort.js`) is a temporary view lens.
Following it would turn the strip into a sorted bar chart, and every
"hotspot" would be an artefact of the sort. The strip stays in the report's
scan order, which is also what the sort control calls "Default".

**Colours:** the two data roles (widespread, other rules) use the app's
violet and an orange. Both were validated against the light and dark surfaces
for lightness, chroma, colour-blind separation and 3:1 contrast. They are not
the status colours for pass or fail. In forced-colours mode they map to
`CanvasText` and `Highlight`.

### 8.2 Strip controls: rule filter and column height

Two controls sit above every set of strips: the report's own strip, the two
strips of a pair comparison, and the stacked strips of three or more reports
(mockup: `docs/design/mockups/scan-strip-filters.html`). In Compare, one set drives
every strip, so a rule can be followed down the reports. They change only the
strips (and the report strip's "Show as table"). The explanation, the
numbers, the concentration bars and the rule map always count every rule.

- **Column height:** failing rules (the default) or failing elements. Elements
  go on a square-root scale. A scan with hundreds of elements would otherwise
  flatten every other column, and the root keeps the order. The tooltip and
  the table give exact counts. The widespread / other split is kept: by
  element, the bottom segment is the elements of the widespread rules.
- **Rule filter:** a "Filter rules" button opens a list of checkboxes, one per
  failing rule in the reports shown. They are grouped as widespread (in any
  report) and other, widest reach first, with a find box. Each picked rule
  becomes a removable chip under the controls. With nothing picked, every rule
  counts. Colours keep their meaning, so the thin baseline then reads "none
  of the selected rules fail here", and the legend says so.
- **One scale:** the strips in a set share a height scale taken from the
  tallest column under the current view. A status line names that column
  ("Tallest column: 214 failing elements (scan 51 of v22.3.0), on a
  square-root scale"). With one rule picked, "Failing rules" can only show
  where it fails, so the line suggests switching the height to elements.
- **Hotspots** are found over every rule, so their brackets hide while a filter
  is on.
- **Keyboard and screen readers:** the switch is a pair of radio buttons, the
  filter a disclosure button with `aria-expanded`. Escape closes the list and
  puts focus back on the button, and removing a chip moves focus to the next
  chip. The status line is a live region. The strip's slider value text and
  the tooltip count only what the strip counts.

The strips carry each scan's rules with their element counts and widespread
flag (`ruleElements` in `perScan`), so the view is redrawn in the browser
with no new analysis. The view is kept in the markup (`data-dsp-view` and the
controls' default state). An exported report opens on the view it was
exported with, and the controls still work there. A re-render of the report
section after a move keeps the view, and drops picked rules that no longer
fail.

## 9. Export

The exported HTML is built by cloning `#results-container`
(`getReportContent`, `src/js/export.js`), so the section is exported as it was
rendered. Nothing is recomputed in the exported file, and nothing is added to
the JSON.

- The charts are inline SVG, and the "Show as table" data is plain HTML, so
  both survive the export.
- Hover tooltips and the strip's keyboard reading need a small handler in
  `src/report/report.js`, next to the existing comparison tooltip. Without it
  the charts are still readable through their tables.
- The export ships in the "Default" order whatever sort is applied in the
  app. That order is the report's scan order, including the user's moves, and
  the strip uses the same order, so the two agree.

## 10. Comparison

Everything is compared as **shares**, so runs with different numbers of scans
compare fairly. This is the scale-free group of
`workflow-run-comparison-design.md` §6, and N-gating does not demote it.

**Per-rule change** (`compareDispersion`), from scan reach in A and B:

| Change | Rule |
|---|---|
| Contained | in both, reach went down by ≥ 20 points |
| Spread | in both, reach went up by ≥ 20 points |
| Steady | in both, otherwise |
| New / Resolved | in B only / in A only |

This is a second axis next to the existing resolved/new/persistent: a
*persistent* rule can be *contained*, which is the case the totals hide.

**Two reports** (`src/js/report-comparison-renderer.js`):

- The pattern change as two badges, e.g. Widespread → Concentrated.
- The explanation, e.g. "The number of failing rules is unchanged (3), but
  scans with failures went from 100% to 1.7%. `region`, `link-name` and
  `color-contrast` were contained…". It also notes when the runs have
  different numbers of scans, or when either has fewer than 10.
- Key numbers for A and B: scans, failing rules, scans with failures,
  footprint, worst-10% share, widespread rules.
- The rule-by-rule diff gains the change label as a column.
- Scan strips A above B. Both use the full width and the same height scale,
  with one rule filter and height switch for both (§8.2).
- The rule map A → B: arrows from each rule's A position to its B position,
  green for contained, red for spread, grey for steady. New rules have a
  dashed ring, resolved rules a cross at their A position. The arrows are
  obstacles for label placement.

**Three or more reports** (`src/js/report-multi-renderer.js`):

- The pattern per run as a row of badges.
- Scan strips stacked by run, which reads like a heatmap over time, with one
  rule filter and height switch for all of them (§8.2).
- Two separate line charts: scans with failures, and failing elements in the
  worst 10% of scans. They are kept apart on purpose, each with its own 0–100%
  scale (never two scales on one chart).
- A reach sparkline per rule in the existing rule grid, plus a trend label:
  contained when the latest reach is ≥ 20 points below the peak, spread when
  it is ≥ 20 points above the first non-zero reach.
- A series explanation, e.g. "Over 4 runs, failing rules went 3 → 8 → 3 → 1
  and scans with failures dropped from 100% to 0.7%. The pattern moved
  Widespread → Mixed → Concentrated."

Hotspot positions are not compared between reports: two runs, or one run
whose scans were moved, put the same stretch at different scan numbers. Each
report's strip uses that report's own scan order (D6), and the explanation
names what is left in the latest report by its scan range and scan names.

## 11. Rejected

- **Storing dispersion in the JSON.** It would be stale after any exclude,
  filter or merge, and the loader discards derived values anyway (§7).
- **Page- or URL-based denominator.** It hides SPA states and workflow steps
  (D1). The page-based reading already exists in the cluster section.
- **Element-level identity.** There is no stable element identity across scans
  or reports; `occ.uid` includes the markup. Rejected for comparison for the
  same reason (`workflow-run-comparison-design.md` §4.1).
- **Counting can't-tell results.** Mixing manual review into automatic
  failures would blur both (D3).
- **Gini coefficient / Lorenz curve as the headline.** Correct but needs
  explaining; `scansFor80` says the same in one sentence.
- **A language-model explanation.** Not reproducible, not available offline,
  and would differ between the app and the export.
- **One chart with two scales** for the series trends. Two small charts with
  the same scale read correctly; two scales on one chart invite false
  crossings.
- **A rule × scan heatmap as the main view.** It holds everything but is hard
  to read at 300 columns. The strip and the rule map split it into its two
  readable halves. It may come back as an optional drill-down.

## 12. Open questions

- **Thresholds.** 60% / 25% / 3 elements / 10 scans / 15% / 20% are starting
  values. They should be checked against real exported reports before they
  are final, the way the comparison was checked ("Holding up under real data"
  in `multi-report-comparison-design.md`).
- **Names for hotspots.** A hotspot is named by its scans' labels: one or two
  distinct labels are listed, more become "first … last". Whether the nearest
  preceding action's label, or a group of steps, would name a stretch better
  needs checking on real workflows.
- **Footprint in the report view.** It is the most abstract of the four
  numbers. It may belong in the comparison only.
- **Crowded rule maps.** Scattered runs put many rules in one corner. Labelling
  only the top 3 and pointing to the table may be enough; a zoom or a
  collapsed "N one-off rules" mark are alternatives.

## 13. What was built

**Modules.**
- `src/shared/issue-dispersion.js`: the analysis. Its thresholds are one
  exported object (`THRESHOLDS`), so the tests and the view read the same
  values.
- `src/shared/issue-dispersion-view.js`: the explanation, the charts and the
  interactions. The plan had the explanation in the analysis module; it moved
  here because it is HTML, and the analysis stays numbers only.
- Tests: `src/shared/issue-dispersion.test.js` for the analysis and the
  wording, `src/js/issue-dispersion-compare.test.js` for the comparison wiring.

**Report view.**
- The section follows the summary table, outside the analysis metrics, so it
  shows in every presentation mode. A first version placed it inside the
  metrics, where "Findings" and "Failures only" hid it; it moved because it
  is data about the failures rather than analysis. Like the whole Summary
  report, it needs at least two included scans. It starts collapsed
  (`reportSectionHTML(..., { open: false })`); the extension panel's copy
  starts open.
- `renderScansReport` receives the included scans from `a11y-ui.js`
  (`dispersionScans`). Those scans are already through the engine lens and
  the tag filter, so the section follows the same view as the tables.
- A move or a rename calls `scheduleDispersionRefresh`, which rebuilds only
  this section once per animation frame. It keeps the open state of the
  section and its tables, and a keyboard user's place in the strip (by scan
  id).
- The strip's axis shows scan numbers, not step names: scan labels are free
  text and rarely group into steps. Hotspots carry the names instead.

**Accessibility.**
- The strip is one tab stop with `role="slider"`. Its `aria-valuetext` reads
  out the current scan. Arrows move one scan, Page Up and Page Down move ten,
  Home and End go to the ends, and Enter opens the scan card in the report
  view.
- Rule-map dots are not tab stops: with 20 or more rules they would flood the
  tab order. The "Show as table" data after each chart is the keyboard and
  screen-reader route, and each SVG has a summary `aria-label`.
- Text in the shared scripts is written as `\u` escapes, so the files do not
  depend on the host page's character set.

**Export.**
- `report.min.js` bundles both shared modules, and `report.js` installs the
  interaction layer, so tooltips and the strip work in the downloaded file.
- The CSS lives in `src/css/compare.css`, inside the compare block so that
  `comparison.min.css` carries it, and is repeated in `report.css`. The style
  parity test covers the `dsp` classes.
- Bundling exposed a latent export bug: `export.js` inserted content with
  string replacements, where `$&` is a pattern. Minified code, or a scan
  label, containing `$&` pasted `</body>` into the inlined script. Every
  insertion now uses a function replacer.

**Comparison.**
- The Compare controller computes dispersion from the reports it holds and
  passes it to the renderers (`comparisonDiffHTML(d, { dispersion })`,
  `comparisonSeriesHTML(d, { dispersion })`). The diff engines only gained
  ordering hints (`diffReports(...).swapped`, `ordering.source` in the
  series), because the CLI writes their output to disk and has no use for
  per-scan detail.
- In the series, a rule is "new" only when the latest report is the first to
  see it. A rule that failed earlier, cleared, and came back reads as steady.
- In the Variants framing, the explanation compares the variants instead of
  describing change over time, and the trend column is left empty.

**Extension.** `build:extension-shared` copies both modules. The panel shows
the section after the global findings when a run has two or more scans.
Strip columns there read out their scan but do not link, because the panel
has no scan anchors. The panel's stylesheet maps the lab's token names onto
its own.
