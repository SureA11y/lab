# Workflow step counter — design notes

How a running workflow reports its progress, what those numbers are allowed to
do, and which alternatives were rejected.

**What is shown** (the app's panel and the CLI): how many steps ran, a bar over
the workflow's own top-level steps ("Workflow step 5 of 8"), and the step
running now with its loop item. **No total is shown.** The counter still
estimates `remaining` (below), but nothing displays it: a total that a loop or
a condition can change reads as a promise, and a moving promise reads as broken.

## The problem

A workflow config is a tree, evaluated lazily. `if` picks a branch at runtime,
`forEachElement` learns its item count only once the selector is queried,
`crawlQueue` grows its queue as pages are discovered, and a `repeat` driven by
`{var:...}` resolves its count by interpolation. "How many steps is this run?"
therefore has no single answer before the run, and for some workflows no single
answer until it ends.

Counting what has *already* happened is the easy half: the engine emits an
`action-start` / `action-end` pair per action through `pushLog`, and that stream
already reaches both consumers — the app polls it via `/workflow-progress`, the
CLI receives it through its own `progress` callback.

## The contract

What the UI shows is exact:

- **`done`** is exact. It counts actions the engine reported as finished, a
  failed action included: it ran, and it is not coming back.
- **`workflow`** is `{total, done, at}` over the workflow's own steps (depth 0):
  `total` is the length of the top-level list (entries with a `type`), `done`
  how many finished, failed or were skipped, and `at` the 1-based number of the
  one that started last. That list is fixed, so "step 5 of 8" never has to be
  taken back, whatever loops and branches do inside a step.
- **`current`** is the step that started last, at any depth:
  `{actionPath, type, label, loop}`, where `loop` is `{index, total}` of the
  innermost loop it is in (the longest loop path that prefixes its own), and
  `total` is null while that loop's size is unknown.

The estimate, kept in the snapshot but not displayed:

- **`remaining`** is an upper bound that **never rises on its own**. Every
  runtime fact can only take work out of it.
- **`unsized`** is a count of loop executions with no declared ceiling. These
  are never counted into `remaining` at all.

The one sanctioned rise is a loop leaving `unsized`. When a `forEachElement`
without `limit` reports that it resolved to 30 items, that work moves from the
`unsized` bucket into `remaining`, and the snapshot flags it as
`lastResolution` so a UI can announce it. This is the design's central move: a
number the user was never given cannot be broken. Showing

```
14 done · 18 remaining  (+2 loops not yet sized)
```

is truthful before the loops resolve, and truthful after — whereas a single
fabricated number has to jump upward the moment reality arrives.

Anything that would raise `remaining` outside that path is a bug. It is clamped
and counted in `ratchetHits` rather than shown; the tests assert it stays zero.

## Why `min` can be 0 for a bounded loop

`limit` and `maxPages` are ceilings, never floors — a selector can match
nothing. Budgeting a loop at its ceiling and treating any resolved count as a
reclaim is precisely what makes the live estimate fall rather than rise.

## What counts as a step

One step per action node the engine executes, **container actions included**,
because the engine emits its own `action-start`/`action-end` for `group`, `if`,
`forEachElement` and the rest. Counting them here is what keeps the plan
comparable to the live tally. A caller wanting leaves only can subtract the
container types from `byType` using `CONTAINER_TYPES`.

Disabled actions are excluded, matching the engine: it logs them as skipped and
never emits an `action-start`.

## The pieces

- `src/shared/workflow-step-plan.js` — `planWorkflowSteps(actions, {customSteps})`
  walks the tree and returns `{min, max, unsized, byType, unsizedLoops, nodes}`.
  Pure, browser-friendly, no Puppeteer. `nodes` is keyed by `actionPath` and
  carries what the live counter needs per node: both branch costs for an `if`,
  the ceiling and per-iteration cost for a loop.
- `src/shared/workflow-step-counter.js` — `createStepCounter({actions, customSteps})`
  consumes progress log entries and maintains the tally described above.
- `src/workflow/workflow-engine.js` — emits the structured markers the counter
  reads, on log entries that already existed.

## The markers

Added to `extra` on entries the engine already emitted, so nothing new appears
in the log stream and the counter never has to parse a human-facing message:

| `extra.stepEvent` | On | Carries |
| --- | --- | --- |
| `action-start` | every action | `actionType`, `actionPath`, `depth`, `label` |
| `action-end` | every completed action | `actionType`, `actionPath`, `depth` |
| `action-failed` | a failed action | `actionType`, `actionPath`, `depth`, `optional` |
| `action-skipped` | a disabled action | `actionType`, `actionPath`, `depth` |
| `loop-iteration` | `forEachElement`, `repeat` | `loopType`, `index`, `total` |
| `branch` | `if` | `taken` (`then` / `else`) |

`depth` 0 marks the workflow's own steps; the counter reads it, not the path,
because a custom step's body numbers its actions from 1 again. `label` is the
step's label after `{var:…}` interpolation (or its alias), null when it has
neither; `current` falls back to the type.

Only `index: 0` carries size information; later iterations are the loop doing
work already accounted for. A loop nested inside another re-resolves on each
entry, which is why re-entry is keyed on the index rather than on having seen
the path before.

## Path parity

Plan nodes are keyed by the same `actionPath` the engine stamps on its logs,
which means the planner has to reproduce one engine quirk exactly: some nested
lists are stripped of disabled actions *before* `applyActions` sees them
(`forEachElement`'s `actions` / `preActions` / `iterSetupActions`, and
`repeat`'s `actions`), so a disabled entry there shifts its siblings' numbering.
Everywhere else — top level, `group`, `if`, `crawlQueue`, custom step bodies —
numbering is by raw array index and a disabled action keeps its slot.

`src/workflow/workflow-step-counter.integration.test.js` runs the real engine
and feeds its real logs to the counter, so a drift in either numbering fails a
test rather than quietly producing a wrong number.

An event whose path is not in the plan is recorded in `unmatched` and otherwise
ignored — the estimate is left alone rather than guessed at.

## Two engine changes this required

1. **`forEachElement` reported the wrong denominator.** `staticTotal` is the raw
   `page.$$(sel)` match count, computed before `limit` caps the iterations that
   actually run — so a loop with `limit: 5` over 30 matches logged
   `item 3/30`. It now reports `min(staticTotal, limit)`.
2. **An `if` with an empty chosen branch logged nothing.** The `if branch:` log
   sat inside the `branchActions.length` check, so an empty `else` produced no
   record of the decision. It is the decision, not the work that follows, that
   tells the counter the other branch will never be spent, so it is now logged
   either way.

## What it looks like

`src/js/live-totals.js` — the floating counter pinned bottom-right during a run,
and the same component inline in a batch run's Watch dialog — has a progress
block above the scan tallies:

```
TOTALS: 1 SCAN                         ◌
STEPS                            128 run
████ ████ ████ ████ ░░░░ ░░░░ ░░░░ ░░░░
Workflow step 5 of 8          [by type ⌄]
Now: Click "Next page" · item 12 of 40
─────────────────────────────────────────
✕ 443 fail   ? 12 can't tell   ✓ 964 pass
DOM elements scanned: 15,234
```

- **`128 run`** counts every step at any depth, with no "of".
- **The bar** is split into one segment per workflow step, so a step that
  finishes fills exactly one. Above 30 steps the segments would be thinner than
  the gaps between them, so the track is drawn whole. It turns green when every
  workflow step is done.
- **The note** says "Workflow step 5 of 8" while one runs; once the run ends,
  "All 8 workflow steps done", or "3 of 8 workflow steps done" when it stopped
  early.
- **"Now:"** keeps a long loop from looking stuck while the bar stays on one
  step. A loop's total appears only once the engine reported it ("item 12" for
  a loop of unknown size). One line, cut with an ellipsis, its full text in
  `title`; it goes when the run ends.

The bar is a `role="progressbar"` over the workflow steps, and its
`aria-valuetext` is the note's text, so a screen reader hears the same words.

"by type" expands a table of how many steps of each type ran, busiest first. It
stays open across updates, so a live run does not slam it shut under the user.

The panel's older "by tag" ledger was rebuilt on the same pattern rather than
left as a second, differently-shaped control: it used to be a tab clipped to the
card's top-right corner that opened its ledger *above* the card. Both are now
the same disclosure button, each sitting directly under the numbers it breaks
down, each opening its table in place. The card is pinned to the bottom of the
viewport, so opening either grows it upward and the summary the reader was
looking at travels up with it. One habit covers both, and `buildDisclosure`
builds the control once so the two cannot drift apart.

The panel mounts on the first *step*, not the first scan: progress is worth
seeing from the first action, long before anything has streamed in.

Wiring: `a11y-ui.js` builds a counter per run from the same actions the payload
carries (`startStepCounter`), `progress-processor.js` feeds it only the entries
carrying an `extra.stepEvent`, and each snapshot goes to `liveTotals.setSteps`.
A counter that throws is dropped rather than costing the user their log line.

## And in the CLI

`src/cli/step-progress.js` renders the same counter for a terminal. Two
audiences want different things from it, so it gives them different things:

- **A person watching a run** gets a bar pinned below the output, redrawn as
  steps land and lifted whenever a log line needs to print:

  ```
    [████████████░░░░░░░░░░░░] Workflow step 5 of 8 · 128 steps run · now: Next page · item 12 of 40
  ```

  The bar is over the workflow's own steps, as in the panel.

- **A pipeline** gets nothing live. Redrawing a line into a CI log produces
  thousands of half-erased copies of it, so off a TTY the bar is never drawn —
  the log lines are already the record there.

Both get the counts at the end, in the console summary:

```
Steps       12 run (all 4 workflow steps done)
  by type   a11yScan 4, click 4, screenshot 2, navigate 1, forEachElement 1
```

and as a **Steps** section in `summary.md`, placed above the findings because a
partial run's findings mean something different from a whole one's. When a run
stops early the console reads `5 run (workflow step 3 of 6)`, and the markdown
says "2 of the workflow's 6 steps finished; the run stopped in step 3." Its
per-type table has the steps that ran, with no "left" column.

The bar is cut to the terminal width rather than allowed to wrap, since the
erase sequence only clears one line. Counting never redraws — every entry the
runner counts is one it is about to print, and printing puts the bar back — so
a run writes one bar per line, not two.

## Rejected alternatives

- **Showing the estimate.** The first version showed `17 of ~40`, a hatched
  tail for unsized loops, "23 steps to go" and a "left" column per type. Honest
  as far as it went: the total only fell, and the tilde marked it as an
  estimate. But a bounded loop budgeted at its ceiling makes the total far too
  high until it resolves, an `if` makes it drop suddenly, and an unbounded loop
  makes it a floor; people read "of 40" as a promise either way. The workflow's
  own step list is the only total that is known for sure, so the bar is over
  that, and the rest is counts of what happened.
- **A single "remaining" number with a guessed loop size.** Both existing
  artifact estimators guess 2 iterations for an unbounded `forEachElement`
  (`workflow-engine.js`, `a11y-ui.js`). Fine for deciding whether to stream;
  wrong for a progress counter, because the guess is almost always low and the
  number jumps upward on contact with reality.
- **Worst-casing everything so the number is monotone by construction.** A
  `crawlQueue` with `maxPages: 500` and a six-action body would declare 3000
  steps for a crawl that finds 12 pages. Monotone, and useless. Worst case is
  only a good default when the declared ceiling is tight, which is why
  `min`/`max`/`unsized` are tracked separately and the display picks.
- **Clamping the displayed number and hiding the increase.** Permanently
  under-reports, and hides exactly the disagreement worth knowing about. The
  clamp exists, but it counts what it swallowed (`ratchetHits`).
- **Parsing the loop log messages.** They exist for humans and their wording
  should stay free to change.

## Not covered yet

- **`crawlQueue` reports no items.** It emits no `loop-iteration`, so "Now:"
  shows the step inside a crawl without "item N" (and the hidden estimate keeps
  a bounded crawl at `maxPages` for the whole run). Emitting one per page, with
  `total: null`, would give it "item 12" like the other loops.
- **A loop inside a custom step does not show its item on "Now:".** A custom
  step's body numbers its actions from 1 again, so their paths do not extend
  the loop's path and `current.loop` stays null there.
- **`remaining`, `remainingByType` and `unsized` are computed but shown nowhere.**
  They are kept for the integration test and for any later use; dropping them
  would be a simplification if none comes.
