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
2. **Live prototype, single scan first** (built, see "Prototype status"). One scan, the `ai` option, tier 0
   evidence only and no clicking, through the hook above; this proves the
   wiring. Then tier 1 (page-level checks), with the fingerprint and
   drift detection, the budget and the step log.
3. **Schema and UI.** The `ai` block, the four labels, the toggle in the app,
   the runner and the report.
4. **Human review loop.** Accept or override an AI answer; overrides give an
   accuracy figure per rule, which decides when a rule may count as answered.
5. **Later.** The isolated pass for tier 2, and showing the step log.

## Prototype status

Built on `design-ai-cant-tell`: `src/server-side/ai-answer/` (registry,
evidence, provider, the pass) and an `ai` option on the scan step.

- **Works:** the pass runs in `performA11yScan` after the scan's result and
  temporary style are done, for the five checks of the spike, with tier 0
  reads, the fingerprint before and after, a call and time budget shared by
  the run, and reuse of a repeated question. The tool's outcome is untouched;
  each occurrence gets `ai` with verdict, confidence, rationale, model,
  prompt version and a step log.
- **Tested:** unit tests with a fake model, a Chrome test that a pass which
  changes the page keeps no answers, and a full run of the demo shop's tour
  through the real runner with the Anthropic provider pointed at a local stub
  (4 scans, 22 "can't tell" kept, 10 answers attached, 4 reused, no drift).
  The stub is not a model: **no accuracy has been measured on the live path
  yet**.
- **Model access:** the provider reads `ANTHROPIC_API_KEY` (and
  `ANTHROPIC_BASE_URL`, `A11Y_AI_MODEL`). No key was available to code in the
  development environment, so a real model has not been called from it.
  Without a key every item stays unresolved with the reason `no-model`.
- **Not done:** the live preview's "answered" event, the provenance labels in
  the report and the app, the report schema's description of `ai`, the
  page-level checks (tier 1), and the `ai` field in the app's step editor
  (it shows as a JSON text field, like `argsJson`).

## Reviewing the AI's answers

A person, not necessarily an accessibility specialist, has to be able to judge
an AI answer quickly, so the review shows the evidence, not just the verdict.
For each "can't tell" case:

- the issue and the tool's lean, with its reason and caution;
- **what to check, read from the page** as labelled facts: for an image its
  alt text, the accessible name the browser computes, the control it sits in
  and the heading before it; for a link its text, target and the other links
  with the same text; for a field its label, placeholder and accessible name;
  for a page its title and headings (`readFacts` in `ai-answer/evidence.js`;
  the AI is given the same facts);
- proof and a way to the page: a picture of the element, the URL, the
  selector, the element's HTML and the tool's steps;
- the person's own answer first, then the AI's analysis and conclusion, with
  what the AI was given. Hiding the AI's answer until the person has decided
  keeps the check honest; a switch shows it first.

The first version is a standalone sheet built from a run (`ai-cant-tell-spike/
build-eval-set.js` and `build-review-sheet.js`), with the answers exported as
JSON or CSV to measure the AI per check: how often it agrees with a person,
how often it is unsure, and above all how often it says "pass" where a person
says "fail".

## In the app

**Steps 1, 2 and 3 are built in the lab app** (`src/js/ai-answer-view.js`, wired in
`ai-review.js`, `a11y-ui.rendering.js`, `page-events.js`, `a11y-ui.js`); step 4 is not.
The report already had the places for it:
`extension/main-issues-table.js` renders each "Needs review" row with a lean
badge and a dialog per instance, and the conformance view already stores a
reviewer's answers in the report's JSON. What it does now, and the rest of the proposal, in order:

1. **Show the AI on the row.** (Built.) A provenance badge beside the lean badge
   (AI-supported, unresolved), and in the instance dialog the "what to check"
   facts, the AI's analysis and what it was given.
2. **Take the person's answer in the same dialog.** (Built.) Pass, fail or unsure and a
   note, saved in the report as `review` beside `ai` (the format above), so
   it travels with the report and a later run can keep it. This is also what
   turns "AI-supported" into "Human-confirmed".
3. **A review mode.** (Built: the *Review AI answers* button next to *Review conformance*, a dialog with a card per question, the person's answer first, then the AI's, a filter, a running count of agreement and a CSV export. It is the standalone sheet's flow, kept inside the report, and may be temporary.)
   Original description: The sheet's flow inside the report: go through the
   cases that have an AI answer, answer first, then reveal; a summary of
   agreement. The figures per check feed back into which rules count as
   answered.
4. **The same in the conformance report,** where a confirmed answer can inform
   a criterion's remarks, never set "Supports".

## Continuing this work

For whoever (or whichever agent) picks this up. Branch: `design-ai-cant-tell`
on origin, no pull request: the work is experimental until it is decided to
merge it. Branch names, commits and authorship carry no references to Claude.

- **Read first:** this note, then [the spike](ai-cant-tell-spike.md).
- **Code:** `src/server-side/ai-answer/` (registry, evidence with
  `readFacts`, provider, the pass), the hook in `performA11yScan`
  (`src/server-side/a11y-runner.js`), the `ai` field in
  `src/workflow/action-definitions.js`. After changing a step's fields run
  `npm run build:action-docs` (it rewrites the schemas and step docs).
- **Tests:** `node --test` (the `npm test` script does not start on
  Windows) and `node --test src/server-side/ai-answer/ai-answer.browserspec.js`
  for the Chrome ones.
- **A real model:** the provider reads `ANTHROPIC_API_KEY` (and
  `ANTHROPIC_BASE_URL`, `A11Y_AI_MODEL`). Code in the development
  environment had no key, so the answers measured so far were produced by a
  model run outside the code, over the same prompts (`buildPrompt`). Next
  step: run the pass with a real key and compare.
- **Proof picture:** the pass takes a small picture of each shown element
  (`captureProof` in `evidence.js`: no scrolling, so the page is as it was left,
  and kept out of the model's prompt) and stores it in `ai.evidence.screenshot`;
  the review view and the instance dialog show it. A scan has no picture of a
  "can't tell" element otherwise. `attach-answers.js` builds a report the app
  can open from a run's payload and the answers a model gave to a sample.
- **Evaluation pipeline:** run a workflow, then
  `build-eval-set.js <payload.json> <dir>` (samples unique questions, visits the
  pages, reads the facts and takes element pictures), have a model answer
  `prompts.json`, write its answers to `<dir>/ai-answers.json`, then
  `build-review-sheet.js <dir>`. The data of real runs (payloads, pictures,
  sheets) is not committed: it is a customer's site.
- **Done (earlier):** the single-scan pass, the budget and reuse, the drift check, the
  review sheet, and the lab app's report: an `AI answered n of m` badge on a
  review row, and in each instance's dialog the AI's verdict, reasoning and
  what it was given, with the person's answer (pass, fail, unsure, a note)
  kept in the report as `aiReview`, by question, not by page. **Not done:**
  the extension's own report renderer (`extension/main-issues-table.js`), the
  conformance link (step 4 above), the live preview
  event, tier 1 (page-level checks) and screenshots saved for "can't tell"
  occurrences.
- **Findings so far:** the offline spike agreed with labels on 17 of 19 demo
  cases (labels by the author, not a professional's); on a trimmed run of a
  real site, 68 sampled cases got 41 pass, 6 fail and 21 unsure before the
  facts were added, and no person has labelled them yet.
- **Watch out for:** the tool's HTML snippet can be cut off, which made the AI
  unsure, hence `readFacts`; a replayed workflow is not a safe restore (see
  above); pictures of "can't tell" elements are not saved by the scan.

## Feedback and learning (built 2026-11-24, except where marked)

**Status.** 1 (why) and 2 (resolved result, in the lab app) are built; 3 (lessons) is built and tested but has not been tried with a real model or with real labelled data. **The conformance link is built** (2026-11-24): in the Conformance view (`src/js/conformance-review.js`), each WCAG criterion that has questions a person settled shows "AI-assisted review: n failed and m passed, confirmed by a reviewer", the proposed remarks (page, reason, check, at most five, then a count) and an "Add to the remarks" button that appends them once to the criterion's remarks (saved in the report as usual). Only answers a person gave count; an AI answer nobody confirmed is not recorded there, and the conformance level is never touched (the block says it stays the reviewer's choice). Helpers: `confirmedByCriterion`, `remarksFromConfirmed`, `confirmedBlockHtml` in `src/js/ai-answer-view.js`. Since built: the re-run of labelled cases ("Measuring agreement", `src/cli/ai-agreement.js`). The extension renderer is on hold (see "Handoff", item 4). Code: `src/js/ai-answer-view.js` (`whyHint`, `resolvedOf`, `resolvedHtml`, `syncAnswerFieldset`, `resolveSummary`, `buildLessons`), `src/js/ai-review.js` (the "In the report" count line, the CSV columns resolved and resolvedBy, the "Export lessons for the AI" button), `src/js/page-events.js` (keeps the answer block in step), `src/server-side/ai-answer/lessons.js` and its use in `index.js`.

Three additions, from the review of the Avaloq sample. The AI does not learn by
itself and we do not fine-tune; a person's corrections are fed back as text.

1. **Why you differ.** When your answer differs from the AI's, or is "unsure",
   the note is asked for as "Why?" (required in the sense that the dialog says
   what is missing and counts it, not that it blocks saving). It is kept as
   `aiReview[key].note`. For a case that ends as a fail, it is the explanation
   the report shows.
2. **Your answers in the report.** The tool's outcome is never changed. Beside
   it the report derives a *resolved result*: "Can't tell → Fail, confirmed by
   reviewer" with the reason, or "Pass". An AI answer nobody confirmed stays
   "AI-supported". `resolveCantTells(payload)` in `src/js/ai-answer-view.js`
   computes it from `aiReview` and `ai`; the instance dialog and the review
   dialog show it. Still to do: carry a confirmed fail and its reason into the
   conformance report's remarks (never setting "Supports").
3. **Lessons for the AI.** Corrections become a lessons file kept with the
   project's config, not in the report and not in the repo (it holds a customer's
   content): per check, a house rule and corrected examples (facts, the answer,
   the reason). The scan step's `ai` option names the file
   (`ai: { lessons: "ai-lessons.json" }`); the prompt gets the rules and the
   most similar examples of that check as data, `promptVersion` records that
   lessons were used, and the review dialog exports a lessons file from the
   differences that have a reason. Every labelled case is also a test: before
   lessons are accepted, re-run the labelled cases and compare agreement, so a
   lesson cannot silently make the AI worse. Lessons are data, never
   instructions to follow beyond the question, like page text.

## Plugging in another model or an agent (built 2026-11-24)

The pass does not depend on one model. Which one answers is set on the server,
never by a workflow or a report (either may come from anyone who can open the
app), in this order (`src/server-side/ai-answer/provider.js`):

1. `A11Y_AI_ENDPOINT`: a service you run, at an http or https address. Behind
   it can be any model, or an agent with its own knowledge of accessibility,
   regulations and techniques. It gets each question as data and decides how
   to use what it knows.
2. Else `ANTHROPIC_API_KEY`: the built-in model call.
3. Else none: every question stays unresolved (`no-model`), with what was read
   from the page.

**The contract.** One `POST` of JSON per question, with
`Authorization: Bearer <A11Y_AI_ENDPOINT_KEY>` when that is set:

| Field | What it is |
| --- | --- |
| `version` | `1`, the version of this contract |
| `check`, `question` | the check (`img-alt-quality`, ...) and the registry's question for it |
| `criteria` | the WCAG success criteria of the finding (`["1.1.1"]`) |
| `issue`, `howToCheck` | what the tool says, and its steps, `passWhen`, `failWhen` |
| `page`, `element` | the page's `url`; the element's `html` and `selector` |
| `evidence` | what was read from the page: `facts`, `context`, `pageTitle`, `image`; `screenshot` (a data URL) only with `A11Y_AI_ENDPOINT_PICTURE` on |
| `lessons` | `{ rules, examples }` from the project's lessons file, or `null` |
| `prompt` | the text the built-in model would get, for a service that only forwards to a model |

Everything from the page (`issue`, `element`, `evidence`) is data: the service
must never follow instructions found in it. The answer is
`{ "verdict": "pass" | "fail" | "unsure", "confidence": 0..1, "rationale": "...",
"answeredBy": { "name": "...", "version": "..." } }`, `answeredBy` optional.
The lab applies the same rules as to the built-in model: the tool's outcome is
never changed, an "unsure" or a confidence under `minConfidence` stays
unresolved, an answer it cannot read is `unreadable-answer`, a refused call is
`model-error`, and answers are dropped if the page changed. The report names
who answered (`ai.model`): `answeredBy`'s name and version, else
`A11Y_AI_ENDPOINT_NAME`, else the endpoint's host. Recording the version of an
agent's skills there is what lets a re-run of labelled cases compare a new
version with the old one.

**Start from** `docs/design/ai-cant-tell-spike/example-endpoint.js`: a service
that answers "unsure" to everything, with the place to call your model or
agent. Checked in a real run of the demo shop's tour with the scan step's `ai`
option: 10 questions on 4 pages, 7 calls (3 reused), the page unchanged, every
answer named and carrying its facts and picture. Tests:
`src/server-side/ai-answer/provider.test.js`.

**Before using it on a customer's site** read
[ai-cant-tell-data-and-agents.md](ai-cant-tell-data-and-agents.md): what
leaves the lab, what can go wrong (with agents above all), what the lab already
does, and how to set it up well. Agents are slower than one model call: raise
the step's `budget` (`{ calls, seconds }`, default 10 per run and 60 per scan)
for them.

## Focus questions (built 2026-11-24)

The first page-level questions (tier 1), and the only part of the AI pass that
acts on the page. Opt-in per scan step: `ai: { focus: true }` (with
`focusStops`, the most Tab presses, default 40). Without it nothing changes.

- **Which.** The scanner leaves keyboard, focus order and focus visible to a
  person as page-level "manual-review" questions, one per page. The registry
  (`registry.js`, `PAGE_LEVEL`) takes them by rule: focus visible (2.4.7,
  `focus-visible`), focus order (2.4.3, `focus-order`) and focus not obscured
  (2.4.11, `focus-not-obscured`), focus not obscured enhanced (2.4.12,
  `focus-not-obscured-enhanced`), focus appearance (2.4.13,
  `focus-appearance`), each when the scanner asks it, and keyboard (2.1.1,
  `keyboard`), in part.
- **Hidden while focused (2.4.11, 2.4.12).** At each stop, 25 points across
  the element (those in the window) are checked for something else on top:
  `coveredShare` (0 none, 1 entirely) and `covered`, what. Entirely hidden
  fails 2.4.11; any part hidden fails 2.4.12.
- **Focus appearance (2.4.13), measured.** Only when the scanner asks it (it
  costs two more pictures per stop): at each stop an exact (PNG) picture of
  the element and 10 px around it while focused; after focus is put back, the
  same picture unfocused, at the scroll the stop was focused at so what is
  fixed on the page lines up, then the scroll put back. The two are compared
  with `sharp`: the pixels that changed, those that changed with a contrast of
  3:1 or more between the two colours (WCAG's relative luminance), and the
  area needed, a 2 CSS px perimeter of the element (4 × (width + height) −
  16), all in CSS pixels (`appearance`: `changed`, `atContrast`, `needed`,
  `meets`). Too large (over 800 × 400) or focused before the walk: not
  measured, and said. The criterion's exception, an indicator the browser
  draws that the page did not change, cannot be measured: the question asks
  the AI to weigh `changesOnFocus`, and the review says so. On the demo shop's
  products page, 7 of 9 stops meet it; its two image links, with Chrome's own
  ring, fall short (about 530 of 864 px at 3:1).
- **Keyboard: reaching, not operating.** The walk never presses Enter, Space or
  an arrow key, so it cannot tell whether a control works with the keyboard.
  What it can tell is what a mouse user can use that Tab never reaches: after
  the walk, read only, it looks for elements with a control's role, a click
  attribute or a pointer cursor that cannot take focus, and for links, buttons
  and fields taken out of the Tab order (`tabindex="-1"`); one inside or
  holding something Tab reaches (a card whose link is reachable) is left out,
  as are hidden, disabled and inert ones (`unreachable`, at most 30 listed, all
  counted). With that and a focus trap the AI may answer "fail"; it may **not**
  answer "pass" (`passAllowed: false` in the registry): its "pass" is kept as
  reasoning, unresolved (`pass-needs-person`), and the review says what is left
  to check by hand. The picture marks each unreachable control with a dashed
  box. No false alarm on the demo shop's 14 pages; on a test page with a
  clickable menu and two clickable tiles, all three found.
- **The focus walk** (`focus-walk.js`), once per page, after the questions
  answered by reading: remembers the focused element (or none) and the scroll
  of the page and of every box that scrolls; starts from the top of the page;
  presses only Tab, up to the limit; at each stop records the element (tag,
  role, name, position), what looks different on it, its parent or its
  `::before`/`::after` while focused (only what is drawn: an outline's offset
  with no outline is no change), whether something covers its centre, its
  landmark (header, navigation, main, footer, a labelled region...) and the
  heading it comes under, and a small picture. It ends when focus leaves the page, comes back to a stop
  already visited (a possible trap) or the limit is reached. Then it puts
  focus and every scroll position back, and takes one picture of the whole
  page as it is again (at most 1600 by 8000 pixels), for the person.
- **Checked, not trusted.** The pass's fingerprint (page HTML, address,
  storage, cookies, scroll, focus) is taken just before and after the walk. If
  they differ, the focus answers are dropped (`state-drift`, what the walk saw
  kept) and the run log warns that the next steps may meet a different page.
  The answers read before the walk are kept. What cannot be put back: when
  nothing had focus, a later Tab starts from the top of the page, not from
  wherever the workflow last clicked.
- **One question per page.** A page-level answer carries `tier: 1`, its own
  `check` and its `page`, and the review keys it by check and page
  (`aiReviewKey`), so focus order on two pages are two questions.
- **What goes to the model:** the stops as text. The pictures are for the
  person, never in a prompt, and to an endpoint only with
  `A11Y_AI_ENDPOINT_PICTURE` on.
- **The order at a glance:** the review draws the stops' numbers and the path
  between them over the page's picture (an SVG over the image; nothing is ever
  drawn on the page itself), above the list.
- **In the review:** the card lists the stops in order with their pictures,
  what showed focus at each, and marks the stops where no change was found;
  "What to check" sums up per question (stops without a visible change, the
  order with each stop's landmark, heading and position, what covered focus).
  The AI gets the landmarks and headings too, as text, never the pictures.

Pictures in a saved run are files (`images/...`, served as `/reports/...` or,
from an opened zip, `blob:`); the review now shows those as the rest of the
report does. This also fixed the single-element proof picture, which only
showed when it was inline.

Checked: a real browser walk of the demo shop's products page (9 stops in
about 1.3 s, ended by leaving the page, the page identical afterwards); real
browser tests (`focus-walk.browserspec.js`) of a link with its outline removed
(no visible change found), a link under a fixed banner (covered), a focus
trap (came back), a page that changes when focused (focus answers dropped,
the title's kept, warning logged), focus and scroll put back, and no walk
without `focus`; and in the app, a run with `{ "focus": true }` against a
stand-in model: focus visible and focus order each a card with the 9 stops
and their pictures.

**Run with an AAA profile (2026-11-24).** On the demo shop the scanner decides
2.4.11 and 2.4.12 itself (pass) and finds 2.4.13 not applicable, so the AI is
not asked them. On a test page with links whose outline is removed and a fixed
chat box, it left 2.4.12 as can't tell (asked; the walk found the last link
entirely under the chat box) but marked 2.4.11 as passed, though that link is
entirely hidden while focused: the walk saw what the scanner's own check did
not, but the AI only answers what the scanner leaves open. 2.4.13 stayed "not
applicable" there too: its measurement has run in the browser tests only.

## Element questions, the demo and its evaluation (built 2026-11-25)

- **Per-element questions from the walk.** The scanner asks focus visible and
  focus appearance per element (`css-focus-indicator-suppressed`: a style
  removes the outline), keyboard per control (`click-handler-keyboard-operable`,
  `widget-keyboard-focusable`, for 2.1.1 and 2.1.3) and focus not obscured per
  fixed or sticky box (`focus-not-obscured-minimum`, `-enhanced`). The
  registry (`ELEMENT_WALK`) maps them, by check and rule, to
  `focus-visible-element`, `focus-appearance-element`, `keyboard-element`
  (never passed by the AI), `focus-not-obscured-box` and
  `focus-not-obscured-enhanced-box`. `walkFactsFor` (focus-walk.js) finds the
  element after the walk and gives its stop, whether Tab reached it (and why
  not) and, for a box, the stops it covered. They are keyed by their own check
  and element, so 2.4.7 and 2.4.13 about one link are two questions. The
  page-level 2.4.12 question is now `focus-not-obscured-enhanced-page`: the
  scanner names its per-box check `focus-not-obscured-enhanced`.
- **Fixed on the way.** The walk started from a `tabindex="-1"` mark, from
  which the browser skips elements with a positive tabindex: the mark is now
  `tabindex="1"`, first in the page, so the walk follows the page's own Tab
  order. Stops and elements are matched by their place in the page (`path`),
  not their position, which a sticky header changes as the page scrolls. The
  log of what was sent names the question asked, not the scanner's check.
- **The demo** (`examples/demo-site/ai/`, `examples/specs/ai-answers.spec.json`,
  `expected.json`, `examples/ai-demo-score.js`) makes the scan ask every
  question; a model answering the lab's exact prompts blind got 25 of 25
  (31 of 31 once 1.4.11 per element, `focus-contrast-element`, and a link
  showing focus from a script were added)
  (`ai-cant-tell-eval/`). Real sites: the W3C's Before and After Demonstration
  is ready (`examples/specs/ai-answers-w3c-bad.spec.json`) but not run: this
  session could not reach www.w3.org.

## Giving the lab a Claude API key (built 2026-11-24)

Two ways, both on the computer the lab runs on, neither saved anywhere:

- **In the app:** Run settings, "AI answers (experimental)", **Claude API key**,
  then "Use this key". The page sends it once to the lab's own server
  (`PUT /api/ai/key`, `src/server-side/ai-answer/runtime-key.js`), which keeps
  it in memory until "Forget the key" or until the lab stops. It is used
  before one in the environment. The page keeps nothing (the field is
  emptied, it has no name in the configuration, its typing does not reach the
  dialog's listeners) and is told only whether a key is set and where it came
  from. The server takes it only from the lab's own page on the same
  computer: not from the extension, another allowed origin or another
  machine. So in a container or on a shared server, where the browser is
  elsewhere, the field is refused: set `ANTHROPIC_API_KEY` in the server's
  environment there.
- **At start:** `ANTHROPIC_API_KEY` in the environment of `node server.js`
  (PowerShell: `$env:ANTHROPIC_API_KEY = "..."; node server.js`). The command
  line and `npm run ai:agreement` read it the same way.

Checked in the real app, with the lab pointed at a local stand-in for the
Claude API (`ANTHROPIC_BASE_URL`): a key typed in the field reached every
model call of a run (3 questions answered); it was not in the page, the
browser's storage, the server's log or the run's report. Tests:
`src/server-side/ai-answer/runtime-key.test.js` (the store, who may set it,
the routes) and `src/js/ai-key-field.test.js` (the field).

## Measuring agreement (built 2026-11-24)

`src/cli/ai-agreement.js` (`npm run ai:agreement -- <report> ...`) re-runs the
questions a person labelled and compares the AI's answers with theirs, per
check. It is how to decide which checks the AI may be relied on for, and
whether a lessons file is an improvement.

- **Labelled cases** come from saved reports (`.a11y-report.json`,
  `payload.json` or a report zip): each can't-tell question that has the AI
  pass's evidence and a person's answer from "Review AI answers". One case per
  question (check and element) across all the reports; two reports that label
  it differently keep the first and count a conflict. A person's "unsure" is
  counted, not scored.
- **No page is opened.** The question is rebuilt from what the report kept and
  sent through the same step as the pass (`askOne` in
  `src/server-side/ai-answer/index.js`): the same provider
  (`A11Y_AI_ENDPOINT`, else `ANTHROPIC_API_KEY`), allowed sites, masking and
  log (`ai-sent.json`). `--preview` sends nothing.
- **Scored**, per check and in total: agreement, how often the AI said "pass"
  where a person said "fail" (the costly mistake), "fail" where a person said
  "pass", and no answer that counts. Three columns: as the reports recorded
  it, asked again, and asked again with `--lessons`. A check with fewer than 30
  labelled cases is marked so.
- **Lessons are accepted** only if, in total and in every check, they lose no
  agreement and add no "pass" where a person said "fail"; otherwise the exit
  code is 1 and the reasons are listed. Each case is asked without its own
  example in the lessons, so the AI is never shown the answer it is tested
  on. Still, lessons made from the same reports they are tested on flatter
  them through their rules: test them on reports they were not made from.
- **Cost guard:** it says how many calls it will make, and stops before
  starting above `--max-calls` (default 200).
- **Output** in `--out` (default `ai-agreement/`): `agreement.md` (the
  tables), `agreement.json` (the figures and each case, to look into the
  differences) and `ai-sent.json`.

Tests: `src/cli/ai-agreement.test.js`, against a local endpoint (lessons that
help are accepted, lessons that add a missed fail are refused, a preview sends
nothing). Tried on the report zip from the remark check, as a preview and
against the example endpoint.

## What an image shows (built 2026-11-25)

For the image questions (`img-alt-quality`, `img-alt-decorative`) the page
reads the picture's pixels: drawn at up to 64 × 64 on a canvas that is never
added to the page, it gives `image.look`: `blank` (99% or more transparent),
`transparentShare`, the number of `colours` (to 4 bits a channel) and the main
one with its share. An image from another site cannot be read (the browser
keeps its pixels from the page): `readable: false` with why. The review shows
it as "What it shows". Prompt version `registry-5`. Found on the W3C site,
where blank spacers stretched to different widths read as a bar chart (run 4);
fixed in run 5 (`ai-cant-tell-eval/README.md`).

## Fixes from two more sites (2026-11-25)

From the UW Accessible University and GOV.UK audit runs
(`ai-cant-tell-eval/README.md`): the focus walk treats `<video>`, `<audio>`,
`<object>` and `<embed>` as it treats an iframe (focus moves into their own
controls while they stay the focused element: Tab on, one stop, `stuck-inside`
after 20 presses); keyboard and per-control keyboard questions are asked on a
page where Tab reaches nothing (what a mouse can use is the evidence); the
focus order question judges the order only. Prompt version `registry-6`.

## Status on 2026-11-25

The current state, what is next and the conventions are in
[ai-cant-tell-START-HERE.md](ai-cant-tell-START-HERE.md): read it first. The
sections below record each step as it was built; "Status when work stopped
(2026-11-24)" and the Handoff that follows it are the earlier state.

## Status when work stopped (2026-11-24)

Everything built is committed and pushed on `design-ai-cant-tell` (latest
code commit: the conformance link). All tests pass with `node --test`.

**Verified (2026-11-24): the conformance remark saves and comes back.** In
the lab app, with the demo shop's tour and stub AI answers: a question answered
as fail with a reason in "Review AI answers", "Add to the remarks" on 1.1.1 in
"Review conformance", "Download report", then the downloaded zip opened in a
fresh page: the remark is in `conformanceReview.criteria["1.1.1"].remarks` of
the zip's `.a11y-report.json`, shows again in the Conformance view, and
pressing "Add to the remarks" again says it is already there (the text is made
again the same from the saved `aiReview`). The person's answer
(`aiReview`) is in the zip too. Repeat it with
`docs/design/ai-cant-tell-spike/check-remark-save.js` (usage at its top); the
data-level path (compact, `prepareDataForReport`, schema check and
`upgradeReport`) is a unit test in `src/js/ai-answer-view.test.js`. What a
script driving the app has to know: a picked report loads once the "open
report" tab is shown; "Download report" asks for a name first; and where the
browser has `showSaveFilePicker` the app saves through it, which a headless
browser cannot answer, so the script removes it and the app falls back to an
ordinary download (that is why the earlier attempt could not capture it).

**Fixed (2026-11-24): a question the AI did not answer keeps its proof.** The
pass reads the facts and takes the element's picture for every question it may
ask, but used to keep them only on an answer: a question over the call or time
budget, with no key, or whose call failed showed no facts and no picture. Now
every result carries `evidence` (without the element's HTML, which is the
occurrence's own), and the app labels it "What was read from the page" where
no model answered. These pictures are the AI pass's own (`captureProof` in
`evidence.js`): one per question it may ask, cropped to 1000 x 700 px, with no
count limit. They are not the scan's element screenshots (the a11yScan step's
"Element screenshots" option, 50 per scan by default, `element-screenshots.js`),
which the pass does not use.

**Built (2026-11-24): the server's safeguards** for a customer's site: the
sites allowed (`A11Y_AI_ALLOWED_SITES`), personal data masked in what is sent
(`A11Y_AI_MASK`, on by default), a preview that sends nothing (`ai: { preview:
true }` on a step, or `A11Y_AI_PREVIEW` on the server), and a log of each
question exactly as sent (`canonical.ai.outbox`; `ai-sent.json` beside a CLI
run's payload; "What was sent to the AI" in the review). How to use them is in
[ai-cant-tell-data-and-agents.md](ai-cant-tell-data-and-agents.md).

**Next, in order:**
1. Put a model or an agent behind `A11Y_AI_ENDPOINT` (see "Plugging in
   another model or an agent"), or use a real `ANTHROPIC_API_KEY`.
2. A person labels 30 to 50 cases per check, with reasons, in "Review AI
   answers", and saves the report; "Export lessons for the AI" gives
   `ai-lessons.json`.
3. `npm run ai:agreement -- <reports> --lessons ai-lessons.json` measures
   agreement per check and tests the lessons, on reports the lessons were not
   made from (see "Measuring agreement").
4. Runs with `ai: { lessons: "..." }` once the lessons are accepted.
5. The extension: on hold (see "Handoff", item 4).

## Handoff: state at 2026-11-24 and how to pick it up cold

Read this section first if you have no other context. Everything below is on
branch `design-ai-cant-tell` (origin); no PR, on purpose.

**The goal.** Scan results the engine marks `cantTell` get an AI answer beside
them (`occurrence.ai`), never replacing the tool's outcome. A person reviews
the AI's answers inside the lab app, and the report shows what the tool found,
what the AI answered, and what remains.

**What is built and pushed**
- Server pass (opt-in `ai` option of the scan step, shared budget, drift check,
  tier 0 only): `src/server-side/ai-answer/` and the hook in `a11y-runner.js`.
- Report: row badge, per-instance AI block with the person's answer (saved as
  `payload.aiReview`, keyed by check + element so one element on many pages is
  one question): `src/js/ai-answer-view.js` and the rendering, event and
  state files listed in "In the app".
- Review dialog (the "Review AI answers (n)" button in the report toolbar):
  `src/js/ai-review.js`, styles in `src/css/conformance-review.css` (the `air-*`
  block; the last two blocks are the depth and colour pass and the type scale: 18, 16 and 14 px, one sans and one mono family, keep to it). Layout: sticky
  top bar with filters, counts and CSV export; one card per question with a
  numbered header, the issue, the tool's lean, "What to check (read from the
  page)", proof picture and links on the left, the person's answer and the
  hidden-until-answered AI box on the right.
- Tests: all pass with `node --test` (about 4400). The review dialog has no
  browser test of its own; it was checked by eye in the real app.

**See it running (Windows, PowerShell)**
1. `node server.js` from the repo root (port 3000; or `PORT=...`).
2. Open the app, load a report that has `ai` blocks with the report file
   picker (`#resultsFiles`), then press "Review AI answers (n)".
3. No such report is committed (real customer data). To make one: run a
   workflow with the scan step's `ai` option and a model key, or build a sample
   with `docs/design/ai-cant-tell-spike/attach-answers.js` from a run's
   `payload.json` and an eval directory (see "Evaluation pipeline" above).
   The author's local copy was built from the Avaloq config
   (`avaloq.com.a11y-config.json`, trimmed to ~30 pages) and lives outside the
   repo in the temp folder `spike/avaloq/`; it may be gone.
4. A browser pane cannot pick a file from disk; serve the file from a tiny
   local HTTP server with CORS and set it on the file input through
   `DataTransfer`, then dispatch `change`.

**Not done / next, in order**
0. Feedback and learning is built, see its section above: the dialog now asks "Why" when you differ from the AI, shows a resolved result, counts them ("In the report"), and exports a lessons file (`ai-lessons.json`) that a scan step uses with `ai: { lessons: "path/to/ai-lessons.json" }`. Try it end to end: label some cases with reasons, export lessons, re-run a scan with a real key, and compare.
1. A person labels the cases (the dialog, then "Export my answers (CSV)");
   compute agreement per check and, above all, how often the AI says pass where
   a person says fail. That decides which registry checks may count as answered.
2. Run the pass with a real `ANTHROPIC_API_KEY`; so far answers came from a
   model run outside the code over the same prompts.
3. Done: a real browser download of the report zip and reloading it keeps the
   person's answers and the conformance remark (see "Status when work
   stopped"). The exported single-file HTML still cannot save answers.
4. The extension's renderer (`extension/main-issues-table.js`): **on hold, and
   not a renderer job (checked 2026-11-24).** That file draws the extension's
   own popup and DevTools panel, from scans the extension makes of the page in
   the person's browser; it never opens a report, and the AI pass runs only on
   the lab server in a workflow run, so no `ai` block ever reaches it. The
   lab's reports are drawn by the app (`a11y-ui.rendering.js`), which has the
   AI review. Showing AI answers in the extension would mean asking the AI from
   it (its can't-tell questions sent to the lab server, which holds the model
   or endpoint), a feature of its own, with the data concerns of
   `ai-cant-tell-data-and-agents.md` stronger still: the person's browser is
   often logged in.
5. Done: a confirmed answer informs conformance remarks ("Add to the
   remarks"), never sets "Supports". Still open: live-preview event, tier 1
   page-level checks.

**Conventions to keep.** No references to Claude or any AI assistant in branch
names, commit messages, authors or co-author lines; commit under the user's own
git identity. Do not open a PR unless asked. Do not commit real-site data.
`npm test` does not start on Windows; use `node --test`. After editing step
fields run `npm run build:action-docs`.

**Gotchas met so far.** Backslashes get lost in regexes written through shell
heredocs (use the file tools); the engine's run uses the config's run spec, so
trimming a config's `state` alone does not shorten a run; `dedupeWithUrlMerge`
must ignore `ai` or merged instances split; apostrophes inside single-quoted
strings broke `report-schemas.js` once.

## What is checked in the app

Run in the lab app with a report from the demo shop's tour, answered through a
local stub of the model: the row badges show, the instance dialog shows the AI's
analysis and the answer controls, and answering shows whether it agrees with the
AI. The unit tests cover the markup, the key that makes one question one answer
across pages, the agreement, and how an answer is kept. **Saving was checked at the data level and, since 2026-11-24, through a real
browser download and reload** (`ai-cant-tell-spike/check-remark-save.js`). A
report with a person's answers is prepared for saving with them kept
(`prepareDataForReport`), the compact format and `upgradeReport` leave the
`ai` answers and `aiReview` alone, and the report schema (which now
describes `aiReview`) accepts them and refuses a verdict it does not know. A
report carrying `aiReview` loaded into the app shows the saved answer and note
in the dialog, already chosen. The downloaded zip, opened again in a fresh page, brings back the person's
answers and the conformance remark made from them. **Not checked:** the
exported single-file HTML, where the controls would not save.

## Left out on purpose

- Letting the AI change a tool outcome, or a conformance level to
  "Supports".
- AI inside the engine or in the CI action by default.
- Mutating actions on the live page that later steps depend on.
