# Evaluating the AI answers

How well the AI answers the questions a scan leaves to a person, measured
against known answers, and how to repeat it. The user guide is
[../../ai-answers.md](../../ai-answers.md); the design,
[../ai-cant-tell-design.md](../ai-cant-tell-design.md).

## The method

1. **A run as a preview** (`A11Y_AI_PREVIEW=on`): the lab asks every question
   but sends none. Its `ai-sent.json` holds each question exactly as it would
   be sent: masked, pictures left out.
2. **A model answers blind.** `answer-offline.js prompts` turns `ai-sent.json`
   into one prompt per line; a model answers each from that prompt alone (not
   the page, not the expected answers), one line per answer.
3. **The answers go back into the run** (`answer-offline.js apply`), as the lab
   would have attached them: the same confidence threshold (0.6), keyboard
   never passed by the AI.
4. **Scored** against the known answers: for the demo,
   `examples/ai-demo-score.js`; for any other site, a person's labels in
   **Review AI answers** and `npm run ai:agreement`.

With a key, steps 1 to 3 are one run without the preview: the lab asks the
model itself. The offline way is for evaluating a model before giving the lab
a key, or a model the lab has no provider for.

## The demo (2026-11-25)

[examples/demo-site/ai/](../../../examples/demo-site/ai/): two pages of the
demo shop built to make the scan ask every question the AI answers, each with
its correct answer and why in `expected.json`.

| Page | Questions |
| --- | --- |
| `reading.html` | Page title, alt text (a file name, a good one), images hidden as decorative (a "−50%" badge, a divider), a bold paragraph as heading (and the site name that is not one), "Learn more" alone, fields labelled only by `title` or `placeholder` |
| `focus.html` (WCAG 2.2 AAA) | Focus visible (page and per link), focus appearance per link, focus order (a `tabindex="1"` link far down comes first), keyboard (page, a clickable menu, a `role="button"` tile), focus not obscured per sticky box (the sticky header hides two links once the page has scrolled) |

**Result:** 25 questions, 25 answered, **25 agree**; no "pass" where the answer
is "fail", none the other way. The model: Claude, run as a separate agent that
saw only the prompts file. The files: [demo/questions.jsonl](demo/questions.jsonl)
(the 25 prompts as the lab writes them), [demo/answers.jsonl](demo/answers.jsonl)
(its answers, with confidence and reasoning) and [demo/score.txt](demo/score.txt).

**What it shows, and what not.** The demo's cases are clear on purpose: it
shows that every question is asked, that the evidence each needs reaches the
model (the walk's stops, what changed on focus, the pixels measured, what
covers what, what Tab never reaches) and that a model can settle them from it.
It does not show how accurate the AI is on real sites, where cases are less
clear: that needs real pages and a person's labels, below.

What the demo found in the lab while it was built, all fixed: the focus walk
skipped links with a positive `tabindex` (it now follows the page's own Tab
order); elements in a sticky header were not matched to their questions (now
matched by their place in the page, not their position); the log of what was
sent named the scanner's check instead of the question asked (so 2.4.7 and
2.4.13 about the same link looked alike); and a page-level 2.4.12 question had
the same name as the scanner's per-box one.

### Replicate the demo

```bash
node examples/serve-demo-site.js &
```

With a Claude API key (or `A11Y_AI_ENDPOINT`):

```bash
ANTHROPIC_API_KEY=... node src/cli/run-workflow.js examples/specs/ai-answers.spec.json --out runs/ai-demo
```

```bash
node examples/ai-demo-score.js runs/ai-demo/payload.json --why
```

Without one, with any model answering the prompts:

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers.spec.json --out runs/ai-demo
```

```bash
node docs/design/ai-cant-tell-spike/answer-offline.js prompts runs/ai-demo/ai-sent.json runs/ai-demo/questions.jsonl
```

Have the model answer each line of `questions.jsonl` into `answers.jsonl`
(`{"id", "verdict", "confidence", "rationale"}` a line), then:

```bash
node docs/design/ai-cant-tell-spike/answer-offline.js apply runs/ai-demo/payload.json runs/ai-demo/questions.jsonl runs/ai-demo/answers.jsonl runs/ai-demo/answered.json "the model's name"
```

```bash
node examples/ai-demo-score.js runs/ai-demo/answered.json --why
```

To see the answers in the app instead: **Open report** with `answered.json`,
then **Review AI answers**.

## Real websites: the W3C's Before and After Demonstration (not yet run)

The [Before and After Demonstration](https://www.w3.org/WAI/demos/bad/) (BAD)
of the W3C's Web Accessibility Initiative is a site made for evaluation: an
inaccessible version ("before") and a repaired one ("after") of the same four
pages (home, news, tickets, survey), with every problem of the "before"
version documented by the W3C (its pages show them with **Show annotations**).
So the AI's answers can be checked against a published answer rather than
the author's.

`examples/specs/ai-answers-w3c-bad.spec.json` scans the eight pages with
`{ "focus": true }`. **It has not been run here:** this session could not
reach www.w3.org. The URLs follow the site's layout as published; check them
on the first run.

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers-w3c-bad.spec.json --out runs/w3c-bad
```

Then, as for the demo, have a model answer `questions.jsonl` (or run it with a
key and no preview), apply the answers, and:

1. Open `answered.json` (or the run's `payload.json`) in the app's **Open
   report**, then **Review AI answers**.
2. Answer each question yourself from the page and the W3C's annotations
   (pass, fail or unsure, with why when you differ). Tick **Show the AI's
   answer before I decide** off, so it does not steer you.
3. **Download report**, then measure:

```bash
npm run ai:agreement -- "AI answers on the W3C's Before and After Demonstration.zip" --preview
```

`--preview` scores the answers the report holds without asking again; without
it (and with a key) the questions are asked again, to compare models or
lessons. What to look at first: how often the AI says pass where you said
fail, per check (`agreement.md`). The "after" pages are a check of the other
side: there the AI should find little to fail.

Record the result here as the demo's is: the run's `questions.jsonl` and
`answers.jsonl` (they hold only the W3C's public demo content), the labels
(the downloaded report's `aiReview`) and `agreement.md`.

Before running it on a customer's site, read
[../ai-cant-tell-data-and-agents.md](../ai-cant-tell-data-and-agents.md).

### Result (2026-11-25)

All eight pages loaded at the URLs in the spec. 77 questions; a model (Claude,
a separate agent that saw only the prompts) answered them blind. The labels
are **not a person's**: the same assistant wrote them from the W3C's
annotations (the Annotations page of each "before" page) and the pages' code,
with the source in each note; where neither settled it, "unsure". The
"after" pages are labelled pass, as the W3C's accessible versions. Treat the
numbers as a first reading, to be redone with a person's labels. Files:
[w3c-bad/](w3c-bad/) (`questions.jsonl`, `answers.jsonl`, `labels.json`,
`agreement.md`); the first run, before the walk was fixed, is in
[w3c-bad/first-run/](w3c-bad/first-run/).

61 cases (a question about the same logo on many pages is one case); 4 unsure
labels are not scored.

| | First run | After the walk fix |
| --- | --- | --- |
| Agree | 36 of 57 (63%) | **46 of 57 (81%)** |
| Of those answered | 88% | **98%** |
| Pass where the label says fail | 5 | **1** |
| Unresolved (low confidence, or unsure) | 16 | 10 |
| Focus visible | 3 of 7 | **7 of 7** |
| Keyboard | 0 of 8 | 4 of 8 (4 unresolved) |

- **Fixed by the walk:** every "before" page has links with
  `onfocus="blur()"` (14 on the home page; the W3C does not itemise it, the
  code does). The walk used to read "nothing has focus" as leaving the page and
  stopped at the first, so the model never saw them and passed focus visible.
  It now records an element that took focus and lost it at once as a stop with
  `lostFocus`, goes on, and lists it in `unreachable`. On the home page it
  finds 15 of them within the 40 stops.
- **The one pass where the label says fail:** the news photo whose alt carries
  information the page does not show (the W3C's Note 10).
- **Unresolved are mostly confidence:** for instance "Click here" and "Read
  More..." were answered fail at 0.55, under the 0.6 threshold (0.7 and 0.8
  in the first run). A blind model's confidence varies from run to run, so
  read small differences with care.
- **Focus order:** 3 of 5 labelled cases, the rest unresolved; only the survey
  is a labelled fail (Note 06). Keyboard: the 4 unresolved are to look at in `answers.jsonl`.

A model's run-to-run variation and my own labels are the two limits of this
reading. Next: a person's labels (Review AI answers on `answered.json`), and
a run with a key through the lab's own call.
