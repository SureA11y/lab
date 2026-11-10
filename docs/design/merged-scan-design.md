# Merged scan — design notes

A workflow step whose scans become one scan: the same view scanned under several
conditions (light and dark theme, desktop and mobile width) reported as the one
view it is, with each finding saying in which of those conditions it occurs. And
a step to set the colour scheme a page is shown in, which is one of the
conditions this is for.

## 1. Motivation

Scanning every view of a site four times — light desktop, light mobile, dark
desktop, dark mobile — gives four scans per view today. The report counts the
same broken button four times, the dispersion analysis sees four "pages", and
nothing in a finding says which of the four it came from: identical occurrences
collapse into one row, and an element that renders differently in the dark theme
shows up as a second row with nothing to tell it apart.

What the person wants is one scan per view, where a failure carries its
condition next to the element, as it carries the page URL.

## 2. What already exists, and what does not

- A scan records its label, tags, final URL, scope and rule selection. It does
  not record its viewport, colour scheme or emulated vision deficiency, and it
  does not record which step it ran inside: the step path only reaches the run
  log.
- Findings are merged across scans in one place in the UI (the summary report,
  `getA11yGlobalFindings`), where the scan an occurrence came from is dropped
  before display (`findingToIssueRow`), and identical occurrences are joined
  with their URLs unioned (`dedupeWithUrlMerge`).
- There is no colour-scheme step. The runner emulates `prefers-reduced-motion:
  reduce` on every page and nothing else.

## 3. The model

A **Merged scan** step is a container, like Group. Every A11yScan that runs
inside it, at any depth, is one **context** of a single scan. The step's label
is the scan's name; each inner scan's label is its context's name.

```
Merged scan "Product page"
  ├─ Set viewport desktop      ├─ A11yScan "Light · desktop"
  ├─ Set color scheme dark     ├─ A11yScan "Dark · desktop"
  ├─ Set viewport mobile       ├─ A11yScan "Dark · mobile"
  └─ Set color scheme light    └─ A11yScan "Light · mobile"
```

The person names the contexts; the app does not try to describe conditions it
would have to record and guess at. An inner scan with no label is named
"Scan 2 of 4" — its position among the contexts and their number.

Inside a Repeat over a site's URLs, each iteration's Merged scan is its own
scan, so a site of 30 views gives 30 scans, not 120.

**For every purpose, a merged scan is one scan.** It is merged where the run's
scans are collected, before anything else sees them, so the report view, the
summary, issue dispersion, comparisons, metrics, the queue's counts and the
exports all receive an ordinary scan and need no knowledge of contexts beyond
showing them. A person who wants the conditions as separate scans keeps them
outside a Merged scan.

## 4. Merging

When the last scan of a Merged scan has been collected, its contexts are folded
into one scan record (`foldMergedScans` in `src/server-side/merged-scan.js`, over the
shared fold of `src/shared/scan-fold.js`, pure
and tested on its own):

- **Findings** are unioned by finding uid (engine, outcome, rule), as findings
  of several engines already are within one scan. A rule can then hold a fail
  finding from one context and a pass from another, as it can within one scan
  when some elements fail and others pass.
- **Occurrences** of fail and can't-tell findings carry `contexts`: the names of
  the contexts they occur in. The rule, for every rule and test: **an
  occurrence with the same result in several contexts is one failure in those
  contexts; an occurrence whose result differs is a separate failure per
  result**, each with its own contexts, listed apart as two failing elements
  of a rule are.

  The same result means the same element (its target, and the shadow hosts
  leading to it) and the same outcome for the same reasons: the failure
  summary, the hint, the uncertainty of a can't-tell, and the values the rule
  measured (`details`: a contrast ratio and its colours, a target's size, the
  attribute found missing). So text at 2:1 in the light theme and 1.3:1 in the
  dark one is two failures of the contrast rule, and a button 20px square on
  mobile and 32px on desktop is two results of the target size rule (one of
  them perhaps a pass). Markup alone does not separate them: an element whose
  HTML differs by context (a `dark` class) but fails identically is one
  failure, shown with the first context's markup.

  Counting follows: two different results on one element are two failing
  occurrences; the rule still counts once among the failing rules, as it does
  when two elements of one scan fail it.

  Pass and not-applicable findings are unioned without contexts.
- **A check counts once, with the worst outcome any context gave it**, as it
  does in one scan. A rule's findings are split by outcome, each holding the
  checks (rollup contributors) that came out that way; a check that passes
  on desktop and fails on mobile goes to the failing finding only, the
  elements another context left undecided move into it with their own
  outcome, and a finding left with no checks goes. A finding without
  contributors stands for its one check, unless a context listed the rule
  with more than one outcome (an engine reporting a rule's passing and
  failing elements apart), where they are only unioned. surea11y's own
  outcome counts, which are per check, are merged the same way. So rules,
  checks and criteria read as the worst context does, never milder.
- **Outcome counts, coverage and the accessibility summary** are computed again
  from the merged findings, with the same functions a single scan uses. The DOM
  metrics they divide by are the largest context's (the most elements), so a
  context that hides part of the page (a mobile menu closed) does not shrink
  the denominator. Failing instances can add up to more than any one context
  has: an element failing differently in two contexts is two failures in the
  lists and counts. The score reads each rule's failing elements once
  instead, so a view checked under more conditions does not score worse for
  that alone. With contexts that are identical, a merged scan is the single
  scan, figure for figure.
- **Identity and order**: the merged scan takes the id, order and position of
  its first context; its label is the step's label (or the first context's, or
  "Merged scan"). Its tags are the step's own: they are what the report's tag
  filter, the live totals by tag and comparisons read. The tags of the scans
  inside describe their contexts (light, mobile) rather than the scan, so they
  are kept with each context and shown on the contexts line; a step with no
  tags takes all of its scans' tags, as before it could have any.
- **Screenshots**: each context's screenshots, in context order, each labelled
  with its context and keeping its own viewport ratio, shown where a scan's
  screenshot is shown today.
- **Contexts list**: the scan keeps `contexts: [{ name, url, scanTags,
  skipped, outcomeCounts }]`, in the order they ran, for the report to list and for a
  later view that wants to tell them apart.
- **Raw engine output** (core's result, used by the CLI exports and the
  baseline) is merged the same way (`mergeCoreResults`): each rule, and each
  composite rollup, by id, taking the worst outcome a context gave it, with
  its failing and can't-tell occurrences joined by the same identity rule and
  a passing context's occurrences left out. Each joined occurrence keeps
  `contexts`, and its hint ends with them ("In: Dark · desktop." or "In all 4
  contexts."), which is what SARIF and JUnit show beside the summary. A merged
  scan writes one SARIF/JUnit/EARL file and one set of baseline entries; the
  baseline matches on rule, reason and markup, which the hint does not touch.

**Contexts that differ in more than their conditions** are merged anyway and
say so in the scan's notes: a different final URL (a redirect to an `m.` site),
a different scope (context or exclusions), or a different rule selection (WCAG
version or level, standard, opt-in rules). The merged scan takes the first
context's scope and selection.

**Contexts that ran different rules** are what a Merged scan is for (the full
scan in the light theme, only the contrast rules in the dark one), so they
are not noted. The merged scan records the rules it ran together: every rule
when a context ran them all, else the rules and tags the contexts included.
Its coverage is measured against the scope of the context that ran the most.
A check one context ran wins over the same check not run in another
(`missing`), so a criterion one context checked in full is not partly checked
in the merged scan; the criteria rolled up in core's own result for the
exports are worked out again from their checks in the same way.

A **skipped** inner scan (an `if` that did not run it, a skipped iteration) is
listed as a skipped context and contributes nothing. A Merged scan whose scans
were all skipped gives a skipped scan, as a skipped A11yScan does. One with no
scans at all gives no scan: there is nothing to show, and nothing is shown.

A Merged scan inside another Merged scan, directly or through a custom
step (a multi-viewport scan reused inside a Merged scan of its own), joins
the outer one: its scans are more contexts of the outer scan, each named by
its own label, and it all reports as that one scan. The inner one's name
and tags are not a scan's, and its log line says which it is part of.
Nesting them used to be refused, as a scan would have had two names at
once; one name, the outer's, is what the scan is shown under.

## 5. The report

- Each occurrence of a fail or can't-tell finding shows its contexts beside
  its page URL: "In: Dark · desktop, Dark · mobile". An occurrence in every
  context says "In all 4 contexts".
- The scan card lists its contexts under its name.
- Its screenshots are all shown where one is shown today, each captioned with
  its context.
- The summary report and every other view treat it as the one scan it is.

## 6. Set color scheme

A step that switches the colour scheme the page is shown in, through
`prefers-color-scheme`. Its one field, the scheme to switch to (light or dark),
has no default: the person picks it. Until a step sets it, the page is shown in
the browser's default (light).

It applies until another Set color scheme step changes it, across navigations,
as Set viewport does. Puppeteer's `emulateMediaFeatures` replaces every emulated
feature at once, so the step sets the colour scheme together with the reduced
motion the runner always emulates, rather than dropping it.

It only reaches sites that follow `prefers-color-scheme`. A site with its own
theme switch needs a click on that switch instead; the step's help says so.

## 7. Workflow, editor and run

- `mergedScan` (label, actions) joins the composite steps in
  `action-definitions.js`, the engine, the step counter's container types and
  the step tree; `setColorScheme` (scheme) joins the plain steps.
- The engine keeps the Merged scan it is inside (a key unique per run and per
  loop iteration, and its label) on the context, and hands it to each A11yScan
  it runs; the runner records it on the collected scan and merges on the way
  out.
- Live progress shows each context's scan as it finishes, named with its
  context. When the step ends, the runner folds its scans into the merged
  scan there and then (the engine tells it, through the root context's
  `onMergedScanEnd`), so the live counts show one scan from that moment
  rather than when the run ends; a cancelled or failed run folds what is
  left as it stops.
- The live totals (the run tab's counter, the queue's columns) add each scan's
  findings as it finishes, and a merged scan counts a failure shared by its
  contexts once. So that the figures do not drop when the run ends, the
  runner reports the merge as a progress entry with the merged scan's counts
  and its contexts' counts, and the totals swap the one for the other.
- They count scans two ways: the scans the report will hold, where a Merged
  scan counts once from its first context (each scan's progress entry names
  the Merged scan it belongs to), and every scan that ran. The second is
  shown beside the first only when they differ: "12 scans (20 before
  merging)" in the run tab, "20 before merging" under the count in the
  queue, also once the run is saved. Neither number goes down.

## 8. Phases

1. Set color scheme.
2. Merged scan: the step, the engine and runner, `mergeScans`, and the report
   showing contexts and the screenshots.
3. Raw engine output merged for the CLI exports and the baseline.

## 9. Open

- A view of one context on its own (filtering a merged scan's findings to
  "Dark · mobile") is not part of this; the contexts list and the occurrence
  contexts are what a later filter would read.
- A Merged scan in the extension's manual runner, which has no workflows.
- **A merge function in core.** The lab merges surea11y's raw result itself
  (`mergeCoreResults`). It could instead come from core as one pure function,
  `mergeResults([{ context, result }])`, from its own entry point as
  `@surea11y/core/sarif` and `@surea11y/core/baseline` are: results in, one
  result out in the same format, with no state and no browser. Core would
  then decide what makes two occurrences the same result (which parts of
  `data.details` are measurements and which are bookkeeping, something the
  lab can only guess at from outside), and its renderers would show an
  occurrence's `contexts` where each format expects it, instead of the lab
  adding them to the end of the hint, in English. Deciding which scans
  belong together, setting their conditions and naming them stay with the
  app: core would not keep a set open or know about contexts until it is
  handed the results. Not urgent, as the lab's own merge works and is
  tested against core's renderers and baseline; a candidate for a core
  release that is being made anyway, after which the lab would use it and
  drop `mergeCoreResults` and the hint suffix.
