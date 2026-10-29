# Comparing More Than Two Reports

> Status: **Shipped.** The Compare tab takes any number of reports: two render
> the pairwise diff that already existed, three or more render the dashboard
> described here. This document keeps the reasoning and the rejected
> alternatives so they are not re-proposed; §11 records what was built and what
> was deliberately left for later.
>
> A walkthrough with annotations is at `docs/design/mockups/multi-report-comparison.html`
> (rebuild: `node docs/design/mockups/multi-report/build-mockup.js`, or
> `--reports a.json b.json …` to render it from real exports). It imports the
> shipped renderer and extracts the shipped stylesheet rather than keeping
> copies, so it cannot drift from what the tab shows.

## 1. What "compare multiple" actually means

The Compare tab began by answering one question with two framings: *evolution*
(same subject over time) and *A/B* (two variants, no winner). Opening it to N
reports does not scale that question — it splits into three that want different
answers:

- **T — Trend.** N runs of the *same* subject, ordered in time. "Is this getting
  better, and when did it turn?" The generalization of *evolution*.
- **M — Matrix.** N variants captured at one point in time — viewport tags
  (desktop / tablet / mobile), browsers, locales, prod / staging / preview.
  "What fails everywhere, and what only fails on one?" The generalization of
  *A/B*.
- **F — Fleet.** N *different* subjects (sites, sections, brands). "Which
  property is worst, and what does our estate share?"

T is ordered with an anchor. M and F are unordered sets; they differ only in
whether the reports are meant to cover the same scope, which is the user's
claim to make, not something the tool can verify (§8 of the two-report notes
already gives scope pairing to the user). So **two engines' worth of semantics,
three products, one data structure**.

The proposals below cover T and M. F is named so it is not re-proposed as a
surprise: it needs no new diff logic beyond M, only a different verdict (a
ranking rather than a shared-backlog reading), and it should ride along once M
exists.

## 2. Requirements

- **R1** — Rule-level primary diff, as today. Occurrence detail stays
  illustrative (`workflow-run-comparison-design.md` §4.1) and must not become
  N-way identity.
- **R2** — No page/element pairing across N reports, for the same reason it was
  rejected across two.
- **R3** — N-gating generalizes: absolute counts are only comparable across
  columns that analyzed the same number of scans. With N columns the gate is
  per-column, and a single mismatched column demotes the *whole* row of absolute
  deltas to context.
- **R4** — Degrade honestly per column: a report whose score was withheld
  (`evaluationState` = `notEvaluated` / `unknown`) breaks the series line rather
  than being interpolated or read as zero.
- **R5** — N = 2 must keep behaving exactly as it does today. The two-report
  view is the drill-down of the N-report view, not a legacy path.
- **R6** — Readable at the sizes people actually have: 3–12 reports in the app,
  arbitrarily many in the CLI/store, with an explicit, stated cap rather than a
  layout that silently degrades.

## 3. Engine — three options

### Option A — chain the existing pairwise diff

Call `diffReports` on consecutive pairs (`N-1` diffs) for T, or on
baseline-vs-each (`N-1` diffs) for M, and stitch the results in the renderer.

- **For:** no new diff logic; the tested engine and its verdict/narrative are
  reused verbatim; could ship in days.
- **Against:** the categories don't compose. "Fails on A and C but not B" has no
  representation — it appears as `new` in one pair and `resolved` in another,
  and the totals across pairs do not reconcile. Flapping (the one signal that
  only exists above N=2) is exactly the case this loses. Verdict and narrative
  are per-pair, so there is no N-wide headline to write.
- **Verdict:** viable only as a throwaway. Rejected as the destination.

### Option B — an N-way rule index (**recommended**)

One new pure module, `src/shared/report-multi-diff.js`:

```js
diffReportSeries(reports, { mode: 'trend' | 'matrix', anchor })
```

It reuses `collectFailingRules` from `report-diff.js` (exported for this; it is
already the whole ingest path) once per report, then builds a single matrix:

```
ruleId -> {
  ruleId, title, severity, wcag,
  counts: [n0, n1, … nN-1],       // occurrences per report, 0 when absent
  present: [true, false, …],       // the presence signature
  pattern: 'universal' | 'shared' | 'unique' | …,   // matrix mode
  lifecycle: { firstSeen, lastSeen, transitions, flapping, streak },  // trend mode
  occ: [ … ]                       // per-report occurrence sets, paired as today
}
```

Everything else — categories, per-column stats, verdict, narrative — derives
from that matrix in one pass. `diffReports(a, b)` becomes the N=2 case: either
left untouched (safest, some duplicated logic) or reimplemented as a thin
adapter over `diffReportSeries` once the N-way output is trusted.

- **For:** expresses presence patterns natively; one ingest per report instead
  of one per pair; one renderer contract; the CLI, the app and the export all
  read the same object.
- **Against:** a new module and its tests, plus renderer work. Category
  vocabulary has to be defined (§4) rather than inherited.

### Option C — the full pairwise matrix (N² diffs)

Every report against every other, rendered as a similarity heatmap.

- **For:** answers "which two of these are nearly the same?" — real for cohort
  dedupe (are the tablet and mobile exports actually different?).
- **Against:** N² ingest cost, and it answers a question nobody has asked yet.
- **Verdict:** defer. Option B's matrix makes near-duplicate columns visible
  anyway, without N² work.

## 4. Category vocabulary above N = 2

Today's six categories (`resolved` / `new` / `persistent`, `aonly` / `bonly` /
`both`) are the N=2 collapse of these.

**Trend (ordered).** Read from the presence signature, oldest → newest. The
prototype adds `lifecycle.returns` — how many times a rule came *back* — because
that is the number a reader wants in prose ("it has returned twice"), not the
raw flip count:

| Category | Signature | Reading |
| --- | --- | --- |
| `resolved` | present early, absent in the latest, one transition | fixed and stayed fixed |
| `new` | absent early, present in the latest, one transition | regression |
| `persistent` | present in every column | never addressed |
| `flapping` | two or more transitions | intermittent — a fix that didn't hold, or a flaky detection |
| `improving` / `worsening` | present throughout, monotone count trend | the same rule, moving |

`flapping` is the argument for the whole feature: an intermittent failure is
*invisible* in a two-run compare, where it reads as either a clean fix or a
clean regression depending on which two runs you happened to load.

**Matrix (unordered).**

| Category | Condition | Reading |
| --- | --- | --- |
| `universal` | fails in every column | the shared backlog — fix once, wins everywhere |
| `shared` | fails in some (>1), not all | partial — worth knowing which |
| `unique` | fails in exactly one column | variant-specific; names the outlier |

Both vocabularies keep the existing segmented-pane pattern, so the renderer's
tab/drill-down machinery carries over unchanged.

## 5. Verdict and narrative at N

The current verdict is a single delta. At N it becomes a shape, and the honest
headline is different per mode:

- **Trend** — net movement across the window, *plus* the largest single step and
  where it happened ("the jump is between run 3 and run 4"), plus the flapping
  count. Baseline-relative and previous-relative deltas are both shown, because
  "better than last week but worse than the release" is the common truth.
- **Matrix** — the size of the universal set (the backlog that is worth a
  systemic fix), the column with the most `unique` failures (the outlier), and
  the cleanest column. Deliberately no winner, consistent with A/B.

Narrative stays deterministic prose built from those numbers — no new source of
truth. One lesson from building the mockup: the prose has to name rules the way
its reader does, and that reader differs by surface. `diffReportSeries` therefore
takes an optional `ruleLabel` function — the CLI omits it and gets the engine's
own titles, the dashboard passes the plain-language name. The engine never owns
the wording.

**Reading it without a technical background.** The mockup leads with a status
word (improving / getting worse), a sentence in plain English, and three figures;
rule ids, WCAG references and the lifecycle grid sit below that, in that order.
The plain-language layer is one sentence per success criterion about who is
affected and what happens to them — a small table beside
`src/server-side/metrics/wcag-criteria.js`, which already holds the criterion
titles.

## 6. Rendering

Both modes replace the dumbbell (a two-point mark, meaningless at N) but keep
the chips → verdict → KPIs → chart → narrative → segmented diff spine.

- **Trend** — the KPI cards gain sparklines (failures, serious+critical, score,
  confidence) drawn as small multiples on a shared x of run index; a stacked
  severity column per run replaces the dumbbell; and the finding diff becomes a
  **lifecycle strip**: one row per rule, one cell per run, cell shaded by
  occurrence count. That reads presence-over-time at a glance and stays legible
  to ~12 columns, where N columns of numbers would not.
- **Matrix** — a rule × column grid, cells carrying counts, partitioned by the
  §4 tabs. Column headers are report chips, so identity and tags stay visible.
- **Drill-down to the pair** — clicking any two cells/columns opens today's
  two-report diff for that pair. This is what keeps R5 honest and gives the
  occurrence-level detail somewhere to live without inventing N-way occurrence
  identity.
- **Scale** — verified in the mockup at 24 columns. Up to ~12 everything renders
  as designed; from there the time axis samples its labels, heat cells narrow and
  the grid scrolls sideways under a pinned first column, with numbers still
  printed in every cell. Past ~40, selection rather than rendering is the answer:
  a window control (last 10 / last 30 / all), and for a year of nightlies one
  column per week keeping that week's worst run. Both happen before the diff, so
  the engine is untouched. Cost stays linear — one ingest per report, never a
  pairwise explosion.
- **Colour** — the A/B teal/violet pair does not extend to N. Trend should use a
  single-hue sequential ramp on the existing tokens (position carries meaning,
  not hue); matrix columns should be told apart by header labels and position,
  with hue reserved for severity. No colour-only encoding, per §7 of the
  two-report notes.

## 7. Where the reports come from

The two file loaders don't generalize. Three options, not mutually exclusive:

- **S1 — multi-select loader (cheapest).** One `<input multiple>` producing an
  ordered chip list: auto-ordered by timestamp for trend, caller-ordered for
  matrix, each chip removable, one chip markable as the anchor. Reuses the
  existing validate → `computeReportGlobals` → controller path per file.
- **S2 — a run tray in the browser.** The IndexedDB store that
  `workflow-run-comparison-design.md` §8 already names as the prerequisite for a
  history picker. Runs accumulate across visits, so a trend builds itself
  instead of being re-assembled by hand every time. Much bigger lift; correct
  destination.
- **S3 — the CLI, over the run store (best value per unit of work).**
  `src/cli/run-store.js` *already* holds exactly the series this feature wants:
  `<root>/<scenario>/runs/<stamp>/payload.json`, timestamp-ordered, scenario-
  grouped, with named baselines. A `--series <n>` flag on the runner (or a
  standalone `compare` command over a scenario directory) feeds the last N
  payloads straight into `diffReportSeries` and emits `series.json` plus the
  standalone HTML. No new storage, no new UI, and it is where scheduled runs
  already live.

## 8. Regression gating

`decideExit` in `src/cli/baseline.js` currently exits `NEW_INSTANCES` on new
occurrences against one baseline. With a series available, two additions are
worth having and both are opt-in flags so existing pipelines don't change
behaviour:

- gate on **flapping** (a rule that keeps returning is a fix that isn't holding);
- gate on **regression from the best run in the window**, not only from the
  immediate predecessor, so a slow drift across several runs cannot pass by
  never regressing more than one step at a time.

## 9. Export

`comparison-template.html` and `buildComparison` need only a title and the same
`compare:start` / `compare:end` CSS block, so the standalone HTML export carries
over for free once the renderer emits `.cmp2` markup. Worth adding alongside it:
a **matrix export as JSON/CSV** (rules × columns with counts), which is what a
pipeline or a spreadsheet actually wants and which the two-report view never
had a reason to produce.

**With the reports.** "Download comparison" is a split button: its default
writes the HTML, and its menu offers *Download with the reports (zip)*
(`src/js/comparison-bundle.js`). The zip holds that HTML, each compared report
as `reports/NN <name>.a11y-report.json` in column order, and `comparison.json`
(`type: "a11y-comparison"`, `version: 1`): the context, the order choice (null
for the context's default), the comparison's name, note and date, and the
report files in column order. Each report is written as the tab holds it,
which is what *Download as JSON* writes, so any of them also loads on its own.
Loading the zip in the Compare tab replaces what is loaded (asking first when
something is) with that comparison, through the controller's `snapshot()` and
`restore()`. A downloaded comparison loads on its own, since it replaces what
is loaded.

Any other zip is read as a bag of reports (`readCompareZip`): each JSON file
in it is added like a loaded file, alongside any JSON files chosen with it.
A queue's "Download all" zip also holds `batch.json`, which is left out; when
that zip is loaded on its own, its runs keep the order they were queued in
and, if they came from batch rows, the context is Versions, as "Send to
Compare" from the queue tab does.

## 10. Identity and ordering

`report-identity.js` covers most of this already; three gaps at N:

- `assignBaselineAndCurrent` generalizes to `orderReportsByTime(reports)` —
  `compareByTime` is already a total order, so this is a sort, not new logic.
- **Duplicate columns**: the same `runId` loaded twice should be flagged in the
  UI (not blocked — §8 of the two-report notes is explicit that same-metadata
  reports are a legitimate comparison).
- **Label collisions**: N columns sharing a label need disambiguation —
  `scanTags` first, then index. The per-column tag qualifier already exists.

## 11. What was built

Option **B**, the N-way index, plus the app view on top of it.

- **`src/shared/report-multi-diff.js`** — `diffReportSeries(reports, {mode,
  ruleLabel})`. One ingest per report through `collectFailingRules` (now exported
  from `report-diff.js`), one rule-by-column matrix, and every category, stat,
  verdict and sentence derived from it. Also `orderReportsByTime` and the column
  labelling: a date when the series is a timeline, the scenario name or scan tag
  when the columns are variants.
- **`src/shared/plain-language.js`** — one sentence per WCAG criterion about who
  is affected and what happens to them, with rule-level overrides where a
  criterion covers several distinct failures. Injected into the engine's prose
  through `ruleLabel`, so the CLI keeps the engine's own titles and the app reads
  in plain language.
- **`src/js/report-multi-renderer.js`** — the dashboard: hero, headline numbers,
  the run chart with the largest regression flagged, the severity stack, the
  ranked "what to fix first" cards and the rule grid. Namespaced `.cmp2 .dash-*`.
- **`src/js/report-comparison-controller.js`** — holds a list rather than an A
  and a B. Two reports render the pairwise view unchanged (**R5**); three or more
  render the dashboard; removing one drops back. `MAX_REPORTS` is 24 and the tab
  says so rather than degrading silently.
- **The tab** — one multi-select loader, a removable chip per report, and the
  framing toggle relabelled *Over time* / *Across variants*, which maps to
  `evolution`/`ab` for a pair and `trend`/`matrix` for a series.
- **A second way in — the report already open.** A *Compare* button beside the
  download split button sends the run that just finished, or the file open in the
  Report tab, straight in as a column and switches tabs. It passes exactly what
  *Download as JSON* would write (`buildExportPayload`, included scans through the
  active engine lens, globals recomputed), so the shortcut and the file loader put
  the same object in front of the engine — the round trip through the disk was
  the only difference, and it is gone. The clone is deliberate: the column keeps
  standing after the report behind it is refiltered or cleared. The button is only
  offered for a report the tab would accept, which is `canCompareReport` — the
  same guard `addReport` applies on arrival, exported so the shortcut can ask
  before moving the reader to a tab that would refuse them.
- **The export** — the dashboard styles sit inside the `compare:start` /
  `compare:end` markers, so a downloaded comparison carries the view, and
  `report.js` carries the grid filters and chart tooltips with it.

### Column order and what the columns are

A scan timestamp records when a scan ran, not which version it covered: three
local versions installed and scanned in whatever order they were to hand produce
dates that say the opposite of the truth. So the timestamp is the default, never
the authority.

- **The tab asks one question — what are these reports of?** Three answers, each
  fixing the framing, the default order, the labels and the noun the sentences
  count in:

  | Context | Framing | Default order | Columns named by | Counted in |
  | --- | --- | --- | --- | --- |
  | Runs over time | evolution / trend | the reports' timestamps | their date | runs |
  | Versions | evolution / trend | the order you arrange | their own names | versions |
  | Variants | ab / matrix | the order you arrange | their own names | runs |

- **Arranging.** Each report carries arrows; the first move freezes the order on
  screen and switches to an explicit arrangement, so a chip moves one place
  rather than the row re-sorting underneath it. Moving inside *Runs over time*
  lands in *Versions*, because that is what arranging by hand means.
- **Naming.** Columns are labelled from the reports themselves: the report's own
  name, else its scan tag, else its date. Ties are broken by the file the report
  was loaded from, then by position, so headers are always distinct. The engine
  also accepts explicit `labels`, which nothing passes yet — that is the hook for
  a version field written at run time.
- **`diffReports` takes `order` too.** Two versions scanned out of order is the
  same problem at N=2, so an arrangement decides the baseline there as well.
- **The headline says how far back the window reaches** — "than four months ago"
  when dates ordered the series, "than two versions ago" when they did not.
  Elapsed time reads harder than a column count, and it is only claimed when the
  dates are the thing doing the ordering.

### A second pass: what the reports already knew

The first pass answered "how many rule failures, per column?". Everything below
was already sitting in the payloads and never reached the view, so this pass
reads it rather than computing anything new upstream.

- **Checks that concluded nothing** (`outcome: 'cantTell'`). `collectFailingRules`
  takes an `outcome` option, so the series ingests needs-review findings the same
  way it ingests failures, into `stats.review` / `stats.reviewOccurrences` and a
  KPI of their own. They are never added to a failure count. The reason they are
  read at all is the `review` list: a rule that stops failing and starts needing
  a human has not been fixed, and a failure-only reading reports it as a fix.
  This was the largest blind spot in the first pass.

- **Fixes and regressions per step** (`flow`). A net delta is the difference
  between two numbers people worked hard on and credits neither: a window that
  cleared 53 and introduced 17 reads as "-36". `buildFlow` walks consecutive
  columns and reports both directions, drawn as a diverging bar chart. The
  bookkeeping is per rule per step, which is a floor and is stated as one:
  occurrences are still not paired across columns, so a rule that fixes two
  instances and gains two others in one step reads as no movement.

- **How long a problem has been open** (`row.age`, `verdict.oldest`). Measured
  from the start of the current unbroken failing streak, not from first sight,
  because a rule fixed in March and back in June has been broken since June.
  Elapsed time is claimed only when the dates ordered the series; an arrangement
  gets a count of runs instead. Age is an argument no view made before, and it is
  a different one from size.

- **Whether a column can be read at all** (`column.health`, from the shared
  `run-health.js` the CLI already used). A run that skipped scans, lost
  iterations or failed an action found fewer problems because it looked at less,
  which is indistinguishable from progress in every chart on the page. The
  "can these be compared?" strip sits above every chart for that reason, and
  folds the clean columns away once there are more than six, so a 24-run window
  does not open with 24 cards saying nothing.

- **WCAG itself** (`src/shared/report-conformance.js`, `d.conformance`). Rule ids
  are the scanner's vocabulary; success criteria are the vocabulary an audit, a
  VPAT, an accessibility statement and a procurement questionnaire are written
  in. Each scan's `metrics.coverageSummary` already holds one verdict per
  criterion, so the module merges them across a report by worst verdict (a
  criterion one page fails is one the site fails) and falls back to reading
  criteria off the findings when a payload carries none. It says which of the two
  it did, because a derived reading can only speak about criteria some rule
  reached and an empty cell there means "never checked", not "passed". Criteria
  are then classified with the same four words as rules, grouped by principle
  (read off the criterion number, so there is no table to drift), and levels are
  taken from the payload or left unstated rather than assumed.

- **How far a rule reaches** (`row.pages`, `row.reach`). Twelve instances on one
  page is a component someone owns; two instances on twelve pages is the design
  system. The instance count cannot tell those apart, and the distinction decides
  who picks the work up. Pages are counted by path, the one part of an occurrence
  no markup change rewrites. This is not the page-level pairing §4.2 of the
  two-report notes rejected: nothing is joined across columns, each column just
  counts its own pages.

- **The spread behind each average** (`stats.pageScores`). A portfolio score is a
  mean, and a mean that rose while its worst page fell is exactly what one number
  hides. Each column prints its worst and best page beside its score.

- **The grid as CSV.** §9 asked for it and it was never built. Rendered as
  selectable text rather than offered as a download, so it survives into the
  exported file where a script-driven save would not run.

### A third pass: the comparison as a document

A downloaded comparison had no name, no date and no record of what it was built
from. Worse, it could not have had one: the export scrapes the rendered `.cmp2`
subtree, and the only naming the exporter attempted read a chip class
(`.compare-report-name`) that does not exist anywhere in the app, so every file
ever exported was titled *Accessibility comparison* and saved as
`accessibility-comparison.html`.

The fix follows the constraint rather than working around it. **Anything that
must survive the export has to be rendered inside `.cmp2`,** so that is where
the document's own identity now lives:

- **`describeComparison` in `report-identity.js`** derives the document from the
  reports: how many columns and of what, the date range when dates ordered them,
  the subject and the scope. Subject and scope are claimed only where every
  report agrees, because three reports of three different sites have no one
  subject and saying they do would be worse than saying nothing. The set of
  distinct scopes travels too, so a mixed set can state the fact instead of
  averaging over it. That answers §12's open question on mixed scopes: it is
  stated as a fact in the provenance block, not raised as a warning, because the
  tool cannot know whether the comparison was intended.

- **A title and a note are typed**, in the tab, and nothing else is. Only a
  person knows what a comparison is for. Both are optional: an untitled
  comparison falls back to what the reports call themselves, then to the site,
  then to the generic label.

  **The tab uses the report's own metadata line to set them**, not a form of its
  own. A comparison is a document too, and the line that describes it is
  corrected exactly the way a report's is: `data-meta-field` on each row,
  `mountReportMetaEditors` adding the `(modify)` control, the same editor with
  the same Save and Cancel, Enter and Escape, the same error region, and the
  fields themselves declared beside the report's in `report-meta-fields.js`. The
  compiled date is a `datetime-local` in the report time zone, the same control
  and the same clock as a report's timestamp, for the same reason: the line
  reads one fixed zone, so the field has to set that zone. One pattern, learned
  once, wherever a document says what it is.

  Two things differ, and both come from the subject rather than the pattern. The
  comparison line **renders every row** whether or not its value is set, so a
  cleared field is a choice rather than a way of deleting the row: the name goes
  back to the reports, and a description that could be added but never removed
  would be a trap. `CLEARABLE_META_FIELDS` names the fields that rule applies
  to. And the values are held **by the controller rather than a payload**,
  because a comparison is assembled from several reports and belongs to none of
  them.

- **`src/js/comparison-document.js`** renders the masthead and the provenance
  block, shared by both renderers so a pair and a series describe themselves
  identically. The masthead opens the document; the provenance block closes it
  with one row per report (column, name, scan date, pages, scope), which is what
  a reader needs to check a claim or rebuild the comparison months later.

- **The compiled date is stamped once per set of loaded reports**, not per
  render, so rearranging columns or editing the title does not keep moving it.
  It is passed in rather than read off the clock, which also makes the walkthrough
  page byte-stable across rebuilds.

- **One heading, not two.** The view is a component under a page that has its own
  title, so the masthead is an `h2`; an exported file is its own document and
  wants exactly one `h1`, so the export promotes that single heading on its way
  out rather than printing the title again in the template. The template's own
  `<h1>` is gone, and its header is the brand band and theme control only.

- **`<title>`, the meta description and the filename** are all read back from the
  masthead's `data-doc-*` attributes, so the browser tab, a search result and a
  folder of downloads say what the page says. Each carries what its own medium
  has room for, which is not the same amount:

  - **`<title>` is the name and nothing else**: what was typed, else what the
    reports call themselves, else the generic label. A tab strip, a bookmark and
    a window switcher truncate hard and only need to answer "which comparison is
    this?". Dates and counts appended there are the first thing cut off and the
    last thing read.
  - **The meta description carries what it covers**, which is what a description
    is for and what a link preview shows.
  - **The filename carries the name and the date**, so repeated exports do not
    overwrite each other and a folder of them sorts.

### Holding up under real data

Column names come from whatever the reports call themselves and counts from
whatever the site had. Neither is bounded, so the cases that break a layout were
worked through deliberately and are covered by tests:

- **Long names.** SVG text neither wraps nor clips, so axis labels are cut to
  what their band holds (capped at 18 characters, since a tick is a name and not
  a sentence) and the first and last are anchored inwards, because a centred
  label at either end has no neighbouring band to overhang into. Grid headers
  clip with the full name on the cell's `title`. Cards and hero figures break
  long words rather than widening past their track, and the hero's text figures
  clamp to three lines.

- **Numbers of any size.** The chart's left padding is computed from the widest
  axis label, so a six-figure count is not clipped by a pad sized for two digits.
  Stacked bands and flow bars have a 2px floor: beside a column of 120,000 a real
  column of three is a fraction of a pixel, and a band that exists has to be
  visible. Scores print to two decimals everywhere.

- **Numbers that round into a lie.** 124,893 down to 10 rounds to "100% lower",
  which says the problems are gone while ten of them are not. Rounding may
  flatter a headline; it may not change what the headline claims, so that case
  reads "over 99%".

- **Density.** Printed figures drop out of the severity and flow charts once
  their bands are too narrow to hold them, because two numbers drawn over each
  other say less than none, and every chart has its table underneath.

- **Rows that cannot orphan.** The headline row is always six tiles and the
  principle row always four, so their track counts step through their own
  divisors (6 → 3 → 2, 4 → 2) rather than being auto-fitted. `auto-fit` sizes
  tracks to the space available, which is right until the space fits five of six
  and strands the last tile on a line of its own. The variant row is the one
  case with no fixed count, so it keeps `auto-fit` and stretches its last line.

- **Absences.** A withheld score breaks the sparkline into separate strokes
  rather than sloping through a value nobody measured, and the column's card says
  why. A criterion nothing evaluated is never drawn as one that passed.

### Still open

- **The headless runner (§7, S3)** — `run-store.js` already keeps timestamped
  runs per scenario; a `--series` flag feeding the last N into the engine and
  writing the dashboard unattended is not built.
- **Run history in the app (§7, S2)** — the report on screen now goes in without
  a file (§11), but that is one column: everything older than the current session
  is still re-assembled from files each time. The IndexedDB store remains the
  eventual answer.
- **Pair drill-down from the series** — `pairFromSeries` exists in the engine but
  the dashboard does not yet offer "compare these two columns" as a click.
- **Selection above 24 reports** — a window control, or one column per week
  keeping that week's worst run. Both are selection before the diff, so the
  engine is unaffected.
- **A version field in the payload** — nothing in a report says which version it
  covers, so an arranged series is labelled by file name. A `version` (or
  `label`) field written at run time, from the workflow spec, would fix that at
  source and feed the engine's `labels` option directly. Overwriting `timestamp`
  to carry version order was rejected: it is evidence, and `--baseline auto`, run
  pruning and the report header all read it. (Correcting one report's date by
  hand - the "(modify)" control beside the timestamp in the report view - is the
  other case, and is fine: it says when that run happened, which is what the
  field means. What was rejected is the format using it to mean something else.)

## 12. Open questions

- **Anchor semantics in trend mode** — first run, a promoted baseline, or the
  best run in the window? Each gives a defensible but different headline.
- **Should the app cap be 12, or should it page?** A quarter of daily runs is
  ~90 columns; the lifecycle strip cannot show that, and downsampling ("weekly
  best") is a different feature.
- **Mixed scopes in matrix mode** — the tool cannot verify that N reports cover
  the same site. Warn on divergent `scopeUrl`, or stay silent as today?
- **Flapping threshold** — is two transitions enough to call a rule flaky, or
  should it need a minimum window length to avoid labelling a normal fix-then-
  regress pair? The shipped engine uses two, which is deliberately noisy; only
  real run history will settle it.
- **Scores across a series** — settled. The tab recomputes each loaded report's
  globals the way the open report is computed, so a report whose score was
  withheld shows no figure and no delta. The series now breaks its line at that
  column instead of joining across it, and the column's own card says the score
  was withheld and why, so the gap is legible rather than merely present.
- **Should a context be remembered?** The tab resets to *Runs over time* on
  reload. Persisting the last choice is easy; whether it should outlive a set of
  files is not obvious.
