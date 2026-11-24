# AI support for "can't tell" results

A proposal, not yet built. Some results of a scan are `cantTell`: the engine
could not decide and gives the steps to check by hand (`howToCheck`). This
note describes how an AI could answer some of them, so that a report has fewer
open questions, while a professional can always see what the tool found, what
the AI answered and what is still open.

## Decisions

- **The AI works on the live page, right after each scan.** The page the
  engine just scanned is still open, so the AI can look at what the page
  really did (focus, hover, zoom, the accessibility tree), not only at a saved
  copy of it.
- **The scan result is saved first and never changed.** The AI's answer is
  written beside the tool's result, not over it. If the AI step fails, times
  out or runs out of budget, the scan is intact.
- **Provenance is part of every result.** A finding is one of: *Tool*,
  *AI-supported*, *Human-confirmed*, *Unresolved*. The first iterations keep
  `cantTell` visible so a professional sees what each party contributed; the
  goal of "no unlabelled unknowns" comes later and is decided per rule from
  measured accuracy.
- **The AI's steps are recorded from the start.** What it looked at and did,
  in order, with the evidence for each. Showing them in the report can be
  switched on later without changing the data.
- **Opt-in, off by default.** Page content and screenshots go to a model, and
  logged-in pages make that sensitive.
- **A person has the last word.** The conformance report keeps its rule: the
  draft never says "Supports". An AI answer is a suggestion with its
  rationale, never a verdict.

## What exists already

- Each `cantTell` occurrence carries `howToCheck`, `uncertainty` and `lean`
  from core: a ready-made question for the AI.
- Element screenshots, page screenshots and the workflow context (step, URL,
  state) are saved with the report ([report package](../report-package.md)).
- The conformance view lets a reviewer answer checks by hand, saved in the
  report's JSON ([conformance report design](conformance-report-design.md)).
- A workflow is a recorded sequence of steps. It is not safely replayable to
  restore a page's state (see "What the code showed").

## Where it runs

After the engine finishes a scan and its result is stored, an AI pass runs on
the same page, for the `cantTell` items the rule registry marks as answerable.
It is not part of the engine: core stays deterministic and the AI is the
lab's orchestration, with core free to expose a per-rule hint of what a rule's
question needs.

Alternatives considered:

- **A separate pass over the saved report, with no page.** Reproducible and
  re-runnable with another model, but blind to behaviour (focus order, hover
  content, reflow, the real accessible name). Kept as part of the plan: the
  evidence the AI sees is saved so it can be re-judged later without the page.
- **Inside the engine's run.** Mixes a non-deterministic step into the scan
  and makes its results unstable. Rejected.

## In a workflow

The scan runs in `src/server-side/engines/a11y-labs-engine.js`, which holds the
Puppeteer page and takes the element screenshots right after the scan. The AI
pass goes there, after the result is stored:

```
scan step
  1. the engine scans the page            findings, including cantTell
  2. screenshots are captured             (existing)
  3. the result is stored                 the tool's result, final
  4. AI pass, only if enabled:
       a. fingerprint the page
       b. for each answerable cantTell: collect evidence, ask the model,
          record the answer and its steps (tiers 0 and 1, within the budget)
       c. fingerprint again; if it differs, stop, drop later answers and record the drift
  5. attach `ai` beside each finding
the workflow's next step starts
```

The next step starts only after 4c, so the page is as the workflow expects, or
the drift is recorded and shown (see "What the code showed").

**Switching it on.** An `ai` option on the scan step, and the same option for
the whole run (app toggle, runner flag, Action input, HTTP API). Without it,
nothing changes:

```json
{ "type": "scan", "name": "cart", "ai": { "answer": "cantTell", "budget": { "seconds": 60, "calls": 10 } } }
```

In unattended runs a missing key or a spent budget leaves the items as "can't
tell" with the reason; the AI never fails the run.

**Loops and batches.** The pass runs per scan, so a loop multiplies the cost.
A per-scan budget and a run-level cap bound it. A question that repeats with
the same element HTML and context (the header's bold "Demo Shop" came up on
every page in the spike) is asked once and reused.

**Page-level checks** (keyboard, focus order, focus visible) are the cases no
saved report can answer. They run in this same pass as tier 1: the AI tabs
through the page, and the fingerprint check confirms it left focus and scroll
as it found them.

### What the code showed

Read in `a11y-runner.js`, `worker-pages.js` and `workflow-engine.js`:

- **The hook is `performA11yScan`** in `src/server-side/a11y-runner.js`. The
  scan step awaits it, so the next step waits for the AI pass: the shared
  page is not used by two things at once. The canonical findings are pushed
  to `workflowCtx.collectedScans` there, so an `ai` block can be attached to
  the same objects.
- **Not inside the scan's own block.** The scan runs inside
  `withTemporaryStyle(beforeScanCss, doScan)`, which injects a style and
  removes it afterwards. The AI pass goes after that block, or it would see a
  page the user never sees.
- **The live preview needs a second event.** "a11yScan ready" is sent with
  the counts as soon as the scan ends. The AI answers later, so it needs its
  own event ("answered") that updates the counts and labels.
- **Loops and crawls run scans in parallel**, each worker on its own page
  (`createCrawlWorkerTarget`). The AI pass then also runs per worker, and the
  budget has to be one shared counter on the run, not per scan.
- **The AI needs its own time limit.** Scan steps run under `ctx.race`
  timeouts; the AI pass must stop on its own budget and never be cut by, or
  fail, the step's limits.
- **There is no restore or replay mechanism.** Variables are in-memory scope
  stacks, loops keep their position and a replay would repeat real effects
  (login, add to cart, server-side state). Restore by replay is therefore
  **not** a safe fallback and is dropped. What exists, and is used instead:
  a second page in the same browser context (`createCrawlWorkerTarget`
  shares cookies and storage), loaded at the scan's URL.

## The rule registry

A per-rule entry says whether a `cantTell` rule is AI-answerable and, if so:

- the narrow question ("does this alt text describe the image?"),
- the evidence it needs (HTML, computed styles, accessibility-tree entry,
  element screenshot, the screenshot in a state such as focused or zoomed),
- the highest action tier it needs (below).

Rules that need real interaction beyond that stay `cantTell`, labelled "needs
a person".

## Protecting the steps that follow

The main risk is that the AI changes the page and a later step of the workflow
then behaves differently. Four layers:

1. **Action tiers.**
   - *Tier 0, observe:* read the DOM, styles, accessibility tree; take
     screenshots. Changes nothing.
   - *Tier 1, reversible:* focus, hover, scroll, resize or zoom the viewport,
     apply text spacing (the lab already does this one).
   - *Tier 2, mutating:* click, type, submit, navigate.
   The first version allows tiers 0 and 1 only. Most `cantTell` questions
   (focus visible, content on hover, reflow, label against name, link
   purpose) need no more.
2. **A fingerprint before and after.** Before the AI starts: URL, a DOM hash,
   storage and cookies, scroll position, the focused element. After it ends:
   compare. If they match, the workflow goes on.
3. **Prevent, then detect; do not restore.** Because replay is unsafe, the
   protection is that tier 0 and 1 leave nothing behind (each tier 1 action
   undoes itself: focus, scroll, viewport, text spacing), and the fingerprint
   catches what slipped. On drift the AI stops, the drift is recorded on its
   log and shown in the report, and the answers given after the drift are
   dropped. The workflow continues from the changed page, with a warning; it
   is not silently repaired.
4. **A page of its own for what cannot be undone.** Checks that need real
   clicks run on a second page in the same browser context, loaded at the
   scan's URL, so the main page is never touched. This works for a state
   that the URL determines. A state that it does not (an open modal, a
   half-filled form) cannot be reproduced there, so those checks stay
   tier 0 and 1 on the main page, or are left to a person. A single-page
   scan has no following steps and can use this mode directly.

Guardrails for any tier: the AI's tools are an allowlist (no navigation off
the page's origin, no form submission, no downloads); the page's text is data,
never instructions to the AI (prompt injection); and the AI never sees
credentials or cookies, only the evidence.

## Result format

The tool's outcome stays as it is. An optional block sits beside it:

```
outcome: cantTell                  // the tool's verdict, untouched
ai: {
  verdict: pass | fail | unsure,
  confidence,
  rationale,
  evidence: [refs to saved screenshots and probe results],
  steps: [ { action, tier, target, result } ],   // recorded always
  model, promptVersion, tokens, durationMs,
  stateDrift: none | detected   // detected: later answers dropped
}
review: { by, verdict, at }        // a person, later
```

The provenance label is derived: no `ai` and no `review` is *Tool*; `ai` with a
confident verdict is *AI-supported*; a `review` agreeing or overriding is
*Human-confirmed*; `unsure`, a rule not answerable or an exhausted budget is
*Unresolved*. A low-confidence answer counts as `unsure`.

This is an additive change to the report schemas: readers that do not know
`ai` ignore it, and the existing counts still use the tool's outcome.

## In the report and the comparisons

- Each finding shows its provenance label; the summary counts each state.
- An AI-supported criterion in the conformance report is "Not Evaluated, AI
  suggested", with the rationale. Only a person can set "Supports".
- Run-to-run comparison treats an AI-only change separately from a change in
  what the tool found, so AI noise does not look like a regression.
- The evidence the AI saw is saved in the report package, so a person can
  audit an answer.
- The step log is stored but not shown at first; it is shown later behind a
  "how the AI got here" disclosure.

## Cost and stability

Scan time and exact repeatability are given up on purpose, within limits:

- A budget per scan (time, model calls, tokens). When it runs out, the
  remaining items stay `cantTell` with the reason "AI budget used".
- Opt-in per run, in the app, the runner, the HTTP API and the GitHub Action.
- Unstable answers are measured, not hidden: each answer records model and
  prompt version, so a changed answer can be traced.

## Open questions

- **Data policy.** Is sending page content and screenshots to an external
  model acceptable, or must it be local or in-house? This decides the provider
  options and the default.
- **Place of the registry.** In the lab, or in core next to the rule
  knowledge? The lean is the lab for orchestration and a hint from core.
- **Scripted probes or an agent.** Fixed, per-rule probes are predictable and
  testable; an agent that chooses what to look at covers more and costs more.
  The first version could use probes for the common rules and an agent only
  where they fall short.
- **Tier 2.** Whether the isolated clicking pass is worth its risk, to be
  decided from what tiers 0 and 1 leave unanswered.

## Plan

1. **Spike on saved reports** (done, see [the spike](ai-cant-tell-spike.md)). Pick the `cantTell` rules that need only a
   screenshot or HTML, ask a model, and compare with human answers on the
   gallery and demo-shop reports. This shows which rules are worth
   automating.
2. **Live prototype, single scan first.** One scan, the `ai` option, tier 0
   evidence only and no clicking, through the hook above; this proves the
   wiring. Then tier 1 (page-level checks), with the fingerprint and
   drift detection, the budget and the step log.
3. **Schema and UI.** The `ai` block, the four labels, the toggle in the app,
   the runner and the report.
4. **Human review loop.** Accept or override an AI answer; overrides give an
   accuracy figure per rule, which decides when a rule may count as answered.
5. **Later.** The isolated pass for tier 2, and showing the step log.

## Left out on purpose

- Letting the AI change a tool outcome, or a conformance level to
  "Supports".
- AI inside the engine or in the CI action by default.
- Mutating actions on the live page that later steps depend on.
