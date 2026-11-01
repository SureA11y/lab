# Workflow Run Comparison ("Evolution") — Design Notes

> Status: **Shipped** as the Compare tab. This records the reasoning behind the
> design and the alternatives that were rejected, so they are not re-proposed.
> Outstanding work is in §9.

## 1. Motivation

A finished workflow produces a portfolio summary: an overall score, an
automated-check rollup, WCAG coverage, and DOM/text metrics (`buildGlobalSummary`
in `src/server-side/metrics/global-summary.js`). Users want to see **how a site's
accessibility evolved** between two runs — a before/after, or a baseline vs. the
latest — so they can tell whether a release made things better or worse.

The natural instinct is to diff page by page, or element by element. Both are
rejected in §4. The comparison works at rule and portfolio granularity.

## 2. Requirements

- **R1** — Compare two workflow runs: `B` = current, `A` = a chosen baseline.
- **R2** — No page/element pairing. Runs may differ in page count and site
  architecture; the comparison must survive that.
- **R3** — Separate **verdict** metrics (scale-free, valid at any page count)
  from **workload** metrics (absolute counts that scale with page count), and
  never let workload growth read as a regression.
- **R4** — Gate absolute deltas on the number of pages analyzed; annotate them
  when it changed.
- **R5** — Degrade honestly: when a score was withheld on either side, show no
  delta rather than diffing a real number against an absent one.
- **R6** — When both runs have exactly one scan, global ≡ page, so per-page and
  per-element detail line up one-to-one and may be shown as a full diff.

## 3. Comparison unit

Each side is one report, parsed and given fresh globals. Both sides already carry
the `{ domMetrics, a11ySummary }` shape, so no new server computation is
required.

The model carries `a11ySummary.scores.evidenceByDom` / `adjustedByDom`, kept per
the code comment *"so a run can be compared against how it scored before."*
Cross-run comparison was anticipated by the scoring design.

## 4. Rejected: finer-grained comparison

### 4.1 Element / occurrence level as identity — rejected

An occurrence's identity is `uid = hash(ruleId, outcome, pageUrl, target, html)`
(`makeOccurrenceUid` in `src/shared/canonical-shared.js`). Every input
except `ruleId`/`outcome` is DOM-derived:

- A wrapper `<div>` shifts the `target` selector path → **uid changes**.
- A copy edit changes `html` → uid changes.
- A restyle that renames a class in the selector → uid changes.

So element-level diffing manufactures phantom "fixed" + "added" pairs on exactly
the cosmetic changes that carry no accessibility meaning.

By contrast the **finding** uid is `hash(engine, outcome, ruleId)` — no DOM in
it — so rule-level signals are stable across that churn.

**How the shipped design reconciles this.** Occurrence detail *is* shown, but
never as identity: the primary diff is rule-level, and occurrences are paired
best-effort by page path + selector and presented as illustrative examples
(fixed / still / new). A wrapper-div selector shift reads as fixed+new rather
than a matched pair. That is the accepted limit, surfaced as detail, never as the
headline.

### 4.2 Page-by-page level — rejected

Requires a join key to pair a page in `A` with a page in `B` (URL, path, or
URL+step). When a release changes architecture or page count, the pairing itself
becomes the dominant source of noise, and unpaired pages (added/removed) muddy
the verdict. Portfolio comparison sidesteps the join key entirely.

## 5. The governing rule: N-gating

Gate every absolute metric on `a11ySummary.scanCoverage.scansAnalyzed`.

- If `A` and `B` analyzed the **same** number of pages, absolute deltas are
  meaningful and may be shown as verdict.
- If they **differ**, absolute deltas are demoted to context and annotated
  `workload changed (N_A→N_B)`; the verdict is read only from scale-free metrics.

The scoring model was built for this: depth is per-1k and per-content-unit, peaks
use P90 — explicitly to avoid inflating just because many pages were scanned.

## 6. Metric groups

- **Verdict (scale-free)** — valid at any page count, so they carry the headline:
  overall score, evidence, WCAG coverage of scope, per-1k depths, DOM ratios,
  score distribution, systemic issue count.
- **Workload (absolute)** — pages analyzed, engine totals, occurrence totals, DOM
  size. Each one's honest delta is its normalized companion in the verdict group;
  pair them so growth never reads as regression.
- **Not comparable above N=1** — per-page cards and per-element detail. Offer as
  side-by-side lists, never as deltas, except under **R6**.

Per-metric labels, formatting and direction-of-good already live in
`src/shared/a11y-metric-defs.js` (`name`, `isPercent`, `min`/`max`, interval
bands, and `polarity`). Any future metric view reads them from there rather than
redeclaring a table.

## 7. Delta rendering rules

- **Direction-of-good is per-metric**, taken from `polarity` — not a global
  "green = up".
- **Unit follows the type**: 0–100 scores → points; ratios/rates → percentage
  points (pp), never "×"; counts → signed integer.
- **Null-guard on `scores.evaluationState`**: if either side is `notEvaluated` /
  `unknown`, scores are `null` → render "—" and suppress the delta (**R5**).
- **No colour-only deltas.** Every delta pairs colour with an arrow glyph and
  text, so direction survives greyscale and colour-blindness.

## 8. Baseline selection and run identity

**The baseline is loaded from a report file.** There is no run/report persistence:
`localStorage` holds only tab mode, grouping state, theme and a carousel index,
and reports embed screenshots as base64 data URLs, so a history picker or a pinned
baseline both need a new IndexedDB store first. File loading was already built and
tested, so v1 ships on existing infrastructure.

This forecloses nothing. The comparison consumes two reports and does not care
where either came from, so a run store can later be added as an *alternate
source* feeding the same diff.

**Run identity.** `buildWorkflowPayloadBase` stamps `timestamp` and a stable
`runId` (`computeRunId`, derived deterministically from `timestamp + url +
scenarioName`, falling back to the timestamp digits when no hash dep is present).
Both are declared on the report root in `schemas/report.v3.schema.json`
(`src/shared/report-schemas.js`); the app opens reports without them, which
older reports may be. `src/shared/report-identity.js`
is the read contract: `reportIdentity()` returns `{ runId, timestamp, scenarioName,
scopeUrl, label, scanTags }` with fallbacks, and `assignBaselineAndCurrent()`
orders the two sides oldest→newest. Reports without a `runId` degrade cleanly via
a `timestamp + url` key.

**No same-report detection.** One run can legitimately produce several reports
with identical metadata — export it three times filtered by tag
(desktop / tablet / mobile) and all three share `runId` / `timestamp` / `url` /
`scenarioName`, differing only in their scans. An identity-based guard flags
those as duplicates when they are exactly the reports a user wants to compare.
Comparing a report with itself simply shows all-zero deltas, which is
self-evident. `reportIdentity` instead surfaces `scanTags` and the header renders
it as a per-column qualifier, so same-metadata reports are told apart at a glance.

## 9. Current shape

A dedicated **Compare tab**, a third top-level mode beside Run and Report, with
two explicitly-loaded reports and two framings chosen in-tab:

- *Evolution* — directional (same subject over time): resolved / new / persistent.
- *A/B* — symmetric (two builds or variants, no winner): A-only / B-only / both.

Modules:

- **`report-diff.js`** (pure, tested) — `diffReports(a, b, {mode})` merges each
  report's failing canonical findings by rule id, classifies rules and paired
  occurrences per mode, rolls failures up by severity, computes headline stats
  (failures, serious+critical, rules, score, confidence), and produces a
  deterministic verdict and narrative.
- **`report-comparison-renderer.js`** — `comparisonDiffHTML(diff)` builds report
  chips, the verdict hero, KPI cards, an SVG dumbbell severity chart, the
  narrative panel, and the segmented rule diff with occurrence drill-down. Pure
  string builder, markup namespaced under `.cmp2`.
- **`report-comparison-controller.js`** — holds the two reports and the mode,
  renders via an injected `setHTML`. States: `needs-both` → `ready`.
- **`report-identity.js`** — labels, ordering and the per-column tag qualifier.
- **Wiring** (`a11y-ui.js`) — mode toggle, two file loaders, and event-delegated
  segmented panes that survive re-render. The run/report results area is hidden
  while Compare is active.

Styling lives under `.cmp2` / `.compare-panel` in `src/css/compare.css`, on the app's
theme-aware tokens. The only comparison-specific hues are the A/B side colours
(teal / violet), with explicit light and dark values; severity inks map to the
existing danger/warn/soft tokens.

## 10. Export

The Compare tab downloads the rendered diff as one self-contained HTML file.
There are no screenshots in a comparison, so there is no zip variant.

Because the export carries the rendered `.cmp2` subtree and nothing else, the
comparison's own identity is rendered inside it: a masthead (title, note, what it
covers, when it was compiled) and a provenance block listing every report it was
built from. Both are shared with the N-report view via
`src/js/comparison-document.js`, and both are described in
`multi-report-comparison-design.md`. The title and note are the only typed
fields; everything else is derived through `describeComparison` in
`report-identity.js`.

`build:report` extracts the Compare-tab block from `src/css/compare.css` — delimited
by `/* compare:start */` and `/* compare:end */` — into
`src/report/comparison.min.css`. The app's stylesheet stays the single source of
truth, which is why the comparison does not follow the report's mirror-into-
`report.css` convention. `report-style-parity.test.js` guards the markers and
fails if a `.cmp2` rule drifts outside them.

`buildComparison` (`src/js/export.js`) inlines `report.min.css` for the base
tokens, fonts and theme handling, then `comparison.min.css` for the components,
and `report.min.js` for the theme toggle and the category tabs. Only the rendered
`.cmp2` subtree travels; the tab's live chrome is left behind. The markup is
wrapped in `.compare-panel` because the A/B side hues are scoped to it.

## 11. Open

- **Multi-run trend** — **done**, and it went further: the tab now takes any
  number of reports, rendering this pairwise view at two and a dashboard at three
  or more. The reasoning, the rejected alternatives (chaining this diff over
  consecutive pairs does not compose) and what is still open are in
  `multi-report-comparison-design.md`. This view is unchanged, and is what a pair
  of columns drills down into.
- **The Compare tab is not browser-verified** — the logic layers are unit-tested
  (diff engine, renderer, controller, identity) and the exported comparison has
  been checked in a browser, but the tab's own DOM wiring (loaders, mode toggle,
  pane clicks, the download button's enabled state) still needs a smoke test.
- **Composition with filters** — the Compare tab feeds the controller the parsed
  report directly, so the scan/tag filters over the open run do not apply to
  either side. That is consistent with comparing two files, but it has never been
  stated as a decision.
- **Scope pairing is the user's responsibility** — the two reports are assumed to
  cover the same site; there is no automatic scope matching. Occurrence pairing
  falls back to rule-level when page paths don't line up.
