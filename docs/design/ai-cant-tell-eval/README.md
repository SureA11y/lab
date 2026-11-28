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

[examples/demo-site/ai/](../../../examples/demo-site/ai/): three pages of the
demo shop built to make the scan ask every question the AI answers, each with
its correct answer and why in `expected.json`.

| Page | Questions |
| --- | --- |
| `reading.html` | Page title, alt text (a file name, a good one), images hidden as decorative (a "−50%" badge, a divider), a bold paragraph as heading (and the site name that is not one), "Learn more" alone, fields labelled only by `title` or `placeholder` |
| `focus.html` (WCAG 2.2 AAA) | Focus visible (page and per link), focus appearance and non-text contrast (1.4.11) per link, a link whose outline is removed but which shows focus from a script (all three pass), focus order (a `tabindex="1"` link far down comes first), keyboard (page, a clickable menu, a `role="button"` tile), focus not obscured per sticky box (the sticky header hides two links once the page has scrolled) |
| `measure.html` (AAA, added 2026-11-27) | The measure lane: contrast over gradients measured from pixels, text spacing, a replaced viewport tag |
| `keyboard.html` (best practices on, added 2026-11-27) | The walk lane answered by reading: tab order, focus taken by a script, mouse-only handlers, hidden focus, state mismatches, a skip link, nested controls, a server-side map, a scrolling box |
| `text.html` (AAA, added 2026-11-27) | "Is it text": low-contrast symbols that carry information or not, content hidden in one orientation |
| `structure.html` (best practices on, added 2026-11-27) | Structure: form groups, two labels, tables (a title row, a header with no cells, an empty corner), heading order, a header made of a div, a focusable card, a presentation conflict, shared access keys |
| `labels.html` (AAA, best practices on, added 2026-11-26) | Names and labels: a placeholder heading, two fields sharing a label, label in name, a generic link (2.4.9), same-name links and frames, a control named only by its tooltip, unnamed landmarks |
| `dialog.html` (`open: true`, added 2026-11-26) | Keyboard and focus order from the open walk: a modal "Size guide" dialog a keyboard user cannot close (its close control is a span, Escape does nothing) and that does not take focus; a working disclosure beside it; the site name and the title |

**Result:** 36 questions, 36 answered, **36 agree** (38 of 38 since the SVG cases, below); no "pass" where the answer
is "fail", none the other way (earlier runs, on 25 questions before 1.4.11 and
the Help link and on 31 before the dialog page, also agreed on all). On the
dialog page the model failed keyboard because "the dialog's only close control
is a non-focusable span and Escape does not close it", and focus order because
"focus stays on the link instead of moving into the dialog": the open walk's
evidence, read as intended. The model: Claude, run as a
separate agent that saw only the prompts file. The files:
[demo/questions.jsonl](demo/questions.jsonl) (the 36 prompts as the lab writes
them), [demo/answers.jsonl](demo/answers.jsonl)
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

**Third run, with whole walks** (`focusStops: 80` in the spec: every page has 48
to 57 stops, and the default of 40 cut each walk short). Files:
[w3c-bad/run3-full-walks/](w3c-bad/run3-full-walks/). **48 of 57 agree (84%),
96% of those answered**; focus order 4 of 5 (was 3), focus visible 7 of 7,
keyboard 4 of 8 (the rest are "after" pages, where the AI may not pass). Two
"pass" where the label says fail: the news photo (Note 10) and now one of the
generic links ("Click here"/"Read More..."), which the model failed in the
other two runs: the same questions vary from run to run. **A caveat on this
run:** its blind agent found the prompts too large to read whole and
summarised them with a script (counting lost-focus, hidden and unchanged
stops) before answering. That is a model's workaround, not the lab's
behaviour, but it shows that prompts for a page with 50 or more stops are
large. Worth measuring (tokens per question) before a customer run.

**Fourth run, with the current code** (2026-11-25, later: compact evidence
before the question, `registry-4`; whole walks). Files:
[w3c-bad/run4-current-code/](w3c-bad/run4-current-code/); same labels
(`labels.json`, still the assistant's, not a person's). All eight walks ended
by leaving the page and put the page back (46 to 57 stops). The same 77
questions (on these pages the scanner asks no per-element focus question, so
1.4.11 does not come in). The prompts, 693,000 characters (about 173,000
tokens; a walk question about 22,500 characters), were split into four
batches, each answered blind by a separate model that read every prompt
itself (no summarising script, unlike run 3).

| | Run 3 | **Run 4** |
| --- | --- | --- |
| Agree | 48 of 57 (84%) | **47 of 57 (82%)** |
| Of those answered | 96% | **98%** |
| Pass where the label says fail | 2 | **0** |
| Fail where the label says pass | 0 | 1 |
| Unresolved | 7 | 9 |
| Focus order | 4 of 5 | **5 of 5** |
| Focus visible | 7 of 7 | 7 of 7 |
| Keyboard | 4 of 8 | 4 of 8 (the 4 "after" pages: the AI may not pass) |
| Decorative images | 10 of 10 | 7 of 10 |

- **No pass where the label says fail**, the costly mistake: the news photo
  (Note 10) and the generic link are now left open rather than passed.
- **The fail where the label says pass is the model's mistake, and shows a
  gap in the evidence.** On the survey page, blank spacer images sit between
  the radio buttons and their labels, stretched to different widths (5, 10,
  17 px). Seeing the widths change row by row in 350 characters of code, the
  model took them for a results bar chart; the live page shows a question
  (radio buttons), not results. The page gives it the image's file name and
  size, not what it shows. **A next step:** say whether an image is blank or
  transparent (read in the page from a canvas), so a spacer reads as one.
- Run-to-run variation stays the main noise: the same questions move between
  agree and unresolved from run to run (the news photo, the "after" home
  thumbnail). A person's labels, and more cases per check, are what make
  these figures more than a first reading.

**Fifth run: images say what they show** (2026-11-25, later). The cause of
run 4's wrong fail is fixed: for an image question the page now reads the
picture's pixels from a canvas it never adds to the page, and the evidence
says what it shows (`image.look`: `blank` when fully transparent, the number
of colours and the main one; "could not be read" for an image from another
site, whose pixels the browser keeps from the page). Prompt version
`registry-5`. On the W3C pages the five survey spacers now read
`"blank": true`; photos read as hundreds of colours. Files:
[w3c-bad/run5-blank-images/](w3c-bad/run5-blank-images/); answered blind by
four separate models as in run 4; same labels (the assistant's).

| | Run 4 | **Run 5** |
| --- | --- | --- |
| Agree | 47 of 57 (82%) | **47 of 57 (82%)** |
| Of those answered | 98% | 98% |
| Pass where the label says fail | 0 | 1 |
| Fail where the label says pass | 1 | **0** |
| Unresolved | 9 | 9 |
| Decorative images | 7 of 10 (1 wrong fail) | **8 of 10, none wrong** |

- **The spacers:** all five agree now, each answered "decorative" from
  `blank: true`.
- **The wrong pass is the news photo again** (Note 10: its alt carries
  information the page does not show). Run 3 passed it, run 4 left it open,
  run 5 passed it: the same hard question moving from run to run, not a
  change in what the model is given (its evidence is the alt text and the
  text around it, not the picture). Over runs 3 to 5 the wrong answers are
  each a different case: variation, which only more cases and a person's
  labels will measure.

**What a run costs in prompt size** (measured on the third run's 77 questions,
characters ÷ 4 as tokens): 964,000 characters, about 241,000 tokens. The 24
page-level focus questions (keyboard, focus order, focus visible: one each per
page) are about 8,400 tokens each and carry the same walk three times, so they
are about 200,000 of it; the others are 500 to 700 tokens. Sending the
evidence compactly and without null fields (prompt version `registry-3`; same
information) cuts it to 693,000 characters, about 173,000 tokens (-28%; a walk
question 33,500 to 22,500 characters). Then the evidence was put before the
question and marked for the Claude API's prompt cache (`registry-4`,
`A11Y_AI_PROMPT_CACHE`): the three focus questions about a page share their
start, so the second and third read the walk from the cache, at a fraction of
the price (not fewer tokens sent). Not measured with a real key yet: the cached
tokens show in the API's usage. Not done: one call for the three questions (it
would break the endpoint's one-question contract), or a shorter record per stop.

## More real sites: UW Accessible University and the GOV.UK audit (2026-11-25)

Two more public sites built with documented accessibility problems, scanned
with the current code (`registry-6`) and answered blind as before (five
separate models; changed prompts answered again by a sixth, unchanged ones
reused). Labels: the assistant's, written as rules from each site's own
documentation and the page source before any answer
([label-rules.js](label-rules.js), with [list-cases.mjs](list-cases.mjs) to
list a run's cases); not a person's.

- **[UW Accessible University](https://projects.accesscomputing.uw.edu/au/)**
  (University of Washington; it moved from www.washington.edu): a university
  home page, inaccessible ("before") and repaired ("after"), with every
  problem listed on its [info page](https://projects.accesscomputing.uw.edu/au/info.html).
  Spec: `examples/specs/ai-answers-uw-au.spec.json`. Files: [uw-au/](uw-au/).
- **[GOV.UK accessibility tool audit](https://alphagov.github.io/accessibility-tool-audit/test-cases.html)**
  (the Government Digital Service): about 140 small test pages, each with one
  documented problem, built to test tools. 23 of them, those the AI's
  questions concern (titles, headings, images, links, labels, focus,
  keyboard); for the page-title and keyboard-trap cases, the example pages they
  link to. Spec: `examples/specs/ai-answers-govuk-audit.spec.json`. Files:
  [govuk-audit/](govuk-audit/).

| | UW AU | GOV.UK audit |
| --- | --- | --- |
| Questions sent | 45 | 79 |
| Labelled cases | 47 | 98 (1 unsure, not scored) |
| Agree | 38 (81%) | 60 (61%) |
| **Of those answered** | **38 of 38 (100%)** | **60 of 62 (97%)** |
| Pass where the label says fail | 0 | 2 |
| Fail where the label says pass | 0 | 0 |
| Left open | 9 | 36 |

- **Left open is mostly by design.** UW: 5 keyboard questions on the
  repaired page (the AI may not pass keyboard), 3 alt-text questions on the
  divider images ("horizontal line graphic"), 1 link. GOV.UK: 11 keyboard
  questions the AI may not pass, 22 focus questions on test pages with nothing
  to focus, and 3 real hesitations ("Read more", the invisible-focus button,
  one keyboard case).
- **The two wrong passes are WCAG readings the audit is stricter than.**
  "Click here" in the sentence "...for more information on the Rocky
  Mountains" (the model: it meets 2.4.4, AA, from its sentence, not 2.4.9,
  AAA); and a search field with only a placeholder before a "Search" button
  (the model: the button tells what the field is for, as WCAG's technique G167
  accepts). The labels, written from the audit's list, were kept as they were;
  both readings are recorded here.
- **What these sites found in the lab, fixed before the final scoring:**
  - The focus walk stopped at a `<video>` with its own controls (focus moves
    into the player's controls while the video stays the focused element), so
    it never reached the UW form below it. It now treats video, audio and
    embedded objects as it treats an iframe: Tab on inside them, as one stop,
    and calls it stuck after 20 presses (`stuck-inside`). The UW walk went from
    27 stops to 41.
  - Keyboard was not asked on a page where Tab reaches nothing, though what a
    mouse can use there (a fake button, concertina items) is the answer: it is
    asked now (the four concertina items and the fake button are now failed).
  - The focus order question now says to judge the order only: the model had
    failed UW's order for its unreachable controls and invisible focus, which
    other criteria cover.
  - The page-title label rule passed the GOV.UK example titled "Insert title
    here"; corrected (the model had failed it, rightly).

### Replicate

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers-uw-au.spec.json --out runs/uw-au
```

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers-govuk-audit.spec.json --out runs/govuk
```

Then for each: `answer-offline.js prompts`, a model answers, `answer-offline.js
apply`; `list-cases.mjs` and `label-rules.js` (au or gov) for the labels, put
into the answered report as its `aiReview`; and `npm run ai:agreement --
<report> --preview`. With a key, run without the preview and skip the offline
steps.


## More of the GOV.UK audit: 42 more pages (2026-11-25)

The next 40 test pages the AI's questions could concern (images, image
buttons, links, form labels, headings, keyboard, lightboxes, iframes) and the
empty- and missing-title example pages, scanned with the same code
(`registry-6`), answered blind by three separate models (one per batch), and
labelled the same way before any answer was read: new rules in
[label-rules.js](label-rules.js), checked to leave every label of the first
GOV.UK run unchanged. Spec: `examples/specs/ai-answers-govuk-audit-more.spec.json`.
Files: [govuk-audit-more/](govuk-audit-more/).

| | 42 more GOV.UK pages |
| --- | --- |
| Questions sent | 149 |
| Labelled cases | 167 (5 unsure, not scored) |
| Agree | 107 (66%) |
| **Of those answered** | **107 of 107 (100%)** |
| Pass where the label says fail | 0 |
| Fail where the label says pass | 0 |
| Left open | 55 |

Per check: page title 40 of 40, focus visible 31 of 31 answered, focus order
29 of 29 answered, the image, link and heading questions 7 of 7; keyboard 0
of 32 answered, by design (the labels are mostly passes, which the AI may not
give).

- **Left open:** 32 keyboard questions; 20 focus questions on pages with
  nothing to focus (`no-focus-stops`); 3 questions about lightboxes and 1
  role=button keyboard case (below); 1 real hesitation: the BBC logo with an
  empty alt and a title, whose rationale argues for a fail ("the title
  attribute does not count") but whose verdict is unsure.
- **What the walk cannot see:** it only presses Tab. A lightbox's problems
  (its close button cannot take focus, Esc does not close it, focus is not
  moved into it or kept there) and a link with role=button that ignores the
  space bar appear only once a control is used. The model said so and left
  them open, rightly; a walk that opens what it finds would be needed to
  answer them.
- **One label corrected after scoring:** the rule passed focus visible on the
  "blank link text" page; the link there is empty (`<a href="…"></a>`), has
  no size, and the walk recorded it hidden while focused, so focus cannot be
  seen. The model failed it, rightly; the rule now fails it, and its note
  says it was corrected.
- **Left unsure in the labels:** focus visible on the two iframe pages (the
  framed page has nothing to focus; the model failed both, as the iframe
  showed no change) and three lightbox cases whose WCAG reading depends on
  the opened lightbox.

With this run there are 369 labelled cases over the three sites (W3C 57, UW
47, GOV.UK 98 and 167); page title, focus visible, focus order and keyboard
now have more than 30 each.

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers-govuk-audit-more.spec.json --out runs/govuk-more
```

Then as above, with `label-rules.js … gov`.

## Correct markup: the W3C WAI tutorials (2026-11-26)

The sites above are built with problems; this one tests the other side,
whether the AI fails markup that is right. The W3C's
[WAI tutorials](https://www.w3.org/WAI/tutorials/) (Images: informative,
decorative, functional, text, complex, groups, image maps; Forms: labels,
instructions, grouping; Page structure: headings, content; Menus; the
Carousels working example): each example carries the alt text, empty alt or
label the tutorial recommends, so it is labelled pass from the tutorial's own
text. Reading questions only (no focus walk), the same code (`registry-6`),
answered blind by two separate models. Labels: the `wai` rules in
[label-rules.js](label-rules.js), written before any answer. Spec:
`examples/specs/ai-answers-wai-tutorials.spec.json`. Files:
[wai-tutorials/](wai-tutorials/).

| | WAI tutorials |
| --- | --- |
| Questions sent | 102 (the site's header and footer repeat on every page: 63 cases) |
| Labelled cases | 63 (3 unsure, not scored) |
| Agree | 58 of 60 (97%) |
| **Of those answered** | **58 of 58 (100%)** |
| Fail where the label says pass | 0 |
| Left open | 2 |

Per check: alt quality 25 of 26, decorative images 18 of 18, page title 13
of 14, the label and the site name (bold as heading) 1 of 1 each.

- **Left open, both reasonable:** the Headings tutorial's diagram, whose
  long alt text is cut off in the evidence ("…including the footer which –"),
  so the model could not judge the rest; and the title "Working Example" of
  the Carousels example, which the model read as generic (fail, 0.55, under
  the threshold).
- **Unsure in the labels:** the bold "Techniques:" and "Success Criteria:"
  lines over the link lists in the related-resources box: a label or a small
  section title, as people read it. The models called them labels (0.6).
- **Found in the offline tool, fixed:** when several elements ask the same
  question with the same evidence (the same icon on every page), the lab asks
  once and reuses the answer (`reused`). `answer-offline.js apply` gave the
  answer only to the one asked, so the others stayed open as `preview`; it
  now copies it to them, as the lab's own call does. Here that was 106
  entries and one case (57 of 60 before). UW and both GOV.UK runs are
  unaffected: every open case there has its own reason. W3C run 5 was not
  re-checked.

With this run: 432 labelled cases over four sites. Reading questions: alt
quality 56, decorative images 33, page title 87, bold as heading 8 (5 scored), link
text 6, field labels 3. Link text and field labels need other sources: the
scanner settles most of them itself.

```bash
node src/cli/run-workflow.js examples/specs/ai-answers-wai-tutorials.spec.json --out runs/wai
```

(With `A11Y_AI_PREVIEW=on` for the offline steps, then `label-rules.js … wai`.)

## The open walk on the GOV.UK keyboard pages (2026-11-26)

The 42-page run left the lightbox and role=button cases open because the
walk only pressed Tab. With the open walk (`open: true`, built for them; see
the user guide), the 12 keyboard and focus order pages of the audit (four
lightboxes, a role=button link, a fake button, concertina, tooltips,
dropdown navigation, a keyboard trap, wrong order, tabindex above 0) were
scanned again with the same code otherwise (`registry-7`), answered blind by
a separate model, and scored against the same `gov` labels. Spec:
`examples/specs/ai-answers-govuk-open.spec.json`. Files:
[govuk-open/](govuk-open/).

| | 12 keyboard pages, open walk |
| --- | --- |
| Questions sent | 48 |
| Agree | 35 of 48 (73%) |
| **Of those answered** | **35 of 36 (97%)** |
| Pass where the label says fail | 0 |
| Fail where the label says pass | 1 |
| Left open | 12 |

**What the open walk recorded** (pressed on 6 pages): every lightbox opened
with Enter and left focus on its link; on two the close control is a `span`
that cannot take focus, and Escape closes them; on one Escape does not close
it, and its X link can take focus and closes it; the role=button link does
nothing with Space and leaves with Enter (stopped). The "focus not moved"
lightbox moves itself to the end of the page when it opens, so the page was
left changed (logged, answers kept).

**What the model made of it:** the facts, read right, and by WCAG they settle
less than the audit's list. Escape is a keyboard way to close, and an X link
is another, so none of the lightboxes is out of keyboard reach: keyboard
stayed open on all four (the AI may not pass it), with the reason stated
("the close X cannot take focus but Escape closes it"). The role=button link
was called a 4.1.2 problem (it works with Enter), not 2.1.1. On these small
pages the lightbox is the next Tab stop after its link and is not marked as
a modal dialog, so the model did not fail the order for "focus not moved" or
"not kept" (both under the threshold). The labels for "close button" and
"role=button" keyboard are the audit's (fail), kept as written before the
run; by WCAG 2.1.1 the model's reading is the better one.

- **The one wrong answer:** focus order failed on the keyboard trap page
  for the trap itself (2.1.2, not the order). Nothing was pressed there:
  run-to-run variation, not the open walk; the first GOV.UK run did not.
- **A limit:** the dropdown navigation opens on hover and its top link says
  nothing (`aria-haspopup` missing), so the open walk does not press it;
  keyboard stays open there, rightly unsure.
- **So:** the open walk makes the evidence complete for a person (the review
  lists each pressed control in a sentence) and lets the AI fail a dialog
  that truly cannot be closed or used with the keyboard; on these test pages
  there was none, so it moved no verdict.

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers-govuk-open.spec.json --out runs/govuk-open
```

## The open walk on working widgets: the W3C ARIA Authoring Practices (2026-11-26)

The GOV.UK pages test the open walk on problems; the W3C's
[ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) examples test it
on widgets that work: their reference implementations of a modal dialog, an
alert dialog, two disclosures, two menu buttons, an accordion, a menubar and
a select-only combobox, on the W3C site. Scanned with
`open: "buttons"` (built for them: the modal dialog opens from a plain
button), answered blind by five separate models (the walks of 53 to 61 stops
make long prompts), labelled pass throughout (`apg` rules in
[label-rules.js](label-rules.js), before any answer). Spec:
`examples/specs/ai-answers-apg-open.spec.json`. Files: [apg-open/](apg-open/).

| | APG examples, open walk |
| --- | --- |
| Questions sent | 57 (55 cases) |
| Agree | 46 of 55 (84%) |
| **Of those answered** | **46 of 46 (100%)** |
| Fail where the label says pass | 0 |
| Left open | 9: keyboard on every page, which the AI may not pass |

Focus visible, focus order, page title, decorative images and site names
all agreed. On keyboard the model stayed unsure with the right reasons: "the
dialog opened with Enter, took focus, has a focusable Cancel button and
closes with Escape"; on the menubar, the three items Tab never reaches are "a
roving tabindex normally reached with arrow keys", not a fail.

**What these pages found in the lab, fixed:**

- Most dialogs open from a plain button, which the open walk never pressed:
  `open: "buttons"` now does, except a button whose name says it acts, and
  every mode now stops any request that could change something on a server.
- On every W3C page the Tab walk counted as a changed page (a skip-to-content
  element sets an attribute as focus passes), so all focus answers would have
  been dropped. The walks are now judged by what the page shows, not its
  markup; this run is the first with the fix.
- An accordion section open from the start was left closed; it is now
  pressed back. A dialog box whose text ends in "Close" was taken for its
  close control; real controls come first. "No" closes a confirmation, and a
  "Discard" button is not pressed.
- After this run: on the combobox, focusing it scrolled the page and the
  site's "Back to Top" button appeared, which was taken for what opened (the
  model rightly distrusted it). What shows is now noted after focusing and
  settling, and a control with `aria-controls` counts only what it controls.

```bash
A11Y_AI_PREVIEW=on node src/cli/run-workflow.js examples/specs/ai-answers-apg-open.spec.json --out runs/apg-open
```

## SVG text alternatives, and the combobox fix confirmed (2026-11-26)

The roadmap's first `read` check: `svg-text-alternative-quality`, the most
frequent unanswered "can't tell" in the runs (97 occurrences, from 5 distinct
SVGs: the W3C site's header and icons repeat on every page). The evidence
gives what an inline SVG draws without its path data (title, desc, the
symbol it uses, classes, text in it; `registry-8`).

- **Demo:** two cases added to `reading.html` (an icon named "Search
  products" in a link, pass; one titled "Layer 1" in a button, fail). The
  whole demo, answered blind again: **38 of 38**
  ([demo/score.txt](demo/score.txt)).
- **Real pages:** the 5 distinct SVGs of the W3C pages (the W3C and WAI
  logos linking home, the search button's magnifier "Submit Search", two
  external-link icons "External Site" and "External Link"), labelled pass
  before any answer: **5 of 5 pass**, each for the right reason ("its name
  says where the link goes"; "the link goes to GitHub, outside the site").
  Files: [svg-w3c/](svg-w3c/). Five cases only: more real SVGs, with some
  that fail, are needed before the check is trusted.
- **The combobox fix** (after the APG run): the APG combobox page scanned
  again, its keyboard and focus order questions answered blind: what opened
  is now its listbox alone (14 elements, none in the Tab order, Escape closes
  it); keyboard unsure (the only answer allowed), focus order pass. No more
  "Back to Top".

## Image map areas and image buttons (2026-11-26)

`area-alt-quality`, `input-image-alt-quality` and `input-image-alt-decorative`
(`registry-9`): the evidence now has the picture behind them (an area's map
image and its place on it, with the other areas; an image button's own
picture).

- **Demo:** six cases added to `reading.html` (a garden plan, its alt, two
  areas "Greenhouse" and "Area 2", three image buttons: "Check delivery", a
  file name, alt="" with aria-label "button"). The whole demo, answered blind:
  **44 of 44** ([demo/score.txt](demo/score.txt)). On the first run the last
  page was left open: the workflow's call budget (40 for the run) was used up
  by the new questions; the demo now allows 80.
- **Real pages:** scanned for these checks: three GOV.UK image-button test
  pages, the W3C demo's eight pages, UW's two. Only one question came up:
  GOV.UK's image button with alt "click", labelled fail: **failed**, "a
  generic word that does not say what the button does"
  ([image-buttons/](image-buttons/)). Real image maps and image buttons are
  rare on these sites; the checks need other sources of cases.

## Objects, embeds, canvas, video posters, redundant alt (2026-11-26)

The rest of the text alternatives (`registry-10`): the evidence has what an
object, embed or video embeds (`image.embedded`) and its picture when that is
an image; a canvas is read from its own pixels.

- **Best practices were never asked.** The AI pass, the review, the offline
  tool and the demo score read only `canonical.findings`; best-practice
  findings (`includeBestPractice`) live in `canonical.bestPractices`, and a
  rule with one check may leave its occurrence without an `atomicCheckId`.
  All now read both, and the rule names the check. This opens the 32
  `code`-lane and other best-practice checks to the AI when they are added.
- **Demo:** six cases added (an object with a bar chart, an embed titled by
  its file name, a canvas named "canvas", a cart icon whose alt repeats its
  link text, its alt quality, a video identified by its figcaption); the
  reading step now includes best practices. The whole demo: **50 of 50**
  (14 new or changed prompts answered blind; the 36 unchanged kept their
  answers).
- **Real pages:** four cases, labelled before any answer: GOV.UK's red panda
  image whose alt repeats its link text (fail), GOV.UK's
  `<object data="foo">` with fallback "Alternative text" (fail), UW's video
  before and after the repair, each named by the text "AU Video" just before
  it (pass, a styled div and an h2): **4 of 4**, for the right reasons
  ([media-alt/](media-alt/)). Too few to trust these checks yet.

## Names and labels (2026-11-26)

The roadmap's second family (`registry-11`): `heading-quality`,
`form-control-label-quality`, `label-in-name`, `control-name-title-only`,
`link-name-quality-link-only`, `identical-links-same-purpose`,
`identical-iframes-same-purpose`, `landmark-unique`. Their key facts are what
the checker itself reports for each occurrence (the fields sharing a label,
where same-named links go, the other landmarks), which never reached the
model: questions can now ask for it (`reported`).

- **Demo:** a page of its own, `labels.html` (AAA profile, best practices
  on), 14 cases. The whole demo: **64 of 64**.
- **Real pages:** scanned with the AAA profile and best practices: GOV.UK's
  pages for these problems, the W3C demo, UW, three W3C pages. 24 questions
  in four checks, labelled before any answer
  ([names-labels/](names-labels/), `labels.json` by question):

  | Check | Cases | Agree |
  | --- | --- | --- |
  | `form-control-label-quality` (GOV.UK: two fields "Name") | 2 | 2 |
  | `identical-links-same-purpose` (GOV.UK "lions", W3C "read more...", UW "click here") | 7 | 7 |
  | `landmark-unique` (the WAI forms tutorial: 14 unnamed asides) | 14 | 14 |
  | `link-name-quality-link-only` (UW's "Info" link) | 1 | 0 |

  The one difference is a reading: "Details about all known issues are on
  the Info page", where "Info" is the page's name in the site's navigation.
  Labelled pass (the text names the page it leads to); the model failed it
  at 0.6 ("out of context, 'Info' does not say what information"), a
  defensible reading of 2.4.9 (AAA). Kept for a person to settle. The 14
  landmark cases are one problem on one page, so they weigh less than
  their count. Headings, label in name, frames and title-only names had no
  real case here.

## Structure (2026-11-27)

The roadmap's third family (`registry-12`): form groups, multiple labels,
tables (a title row, no headers, headers with no cells, empty headers),
heading order, bypass blocks, page zones, region, focusable non-controls,
presentation conflicts, shared access keys. A person looks at more than the
element, so three evidence kinds are read from the page: `table` (caption,
first rows cell by cell), `outline` (the page's headings, the element marked)
and `landmarks` (landmarks with names and first text, skip links, what lies
outside them).

- **Demo:** a page of its own, `structure.html` (best practices on). The
  whole demo: **77 of 77**. One case was dropped: a "Notes" header over a
  missing cell, labelled fail, which the model passed as "an empty column",
  a reading the question itself allows; the case was ambiguous, not the
  answer. A table of header cells only, tried instead, is not asked about by
  the engine. `td-has-header` and `bypass-blocks-present` have no demo case
  (the engine takes a two-cell table for layout; the page has headings).
- **Real pages:** GOV.UK's pages for form groups, tables, headings, labels,
  access keys and presentation roles, the W3C demo, UW, with the AAA profile
  and best practices on. 37 questions scored in seven checks, labelled before
  any answer ([structure/](structure/)): **37 of 37**, no wrong answer
  either way.

  | Check | Cases | Agree |
  | --- | --- | --- |
  | `td-has-header` (the W3C demo's layout tables, pass; its concert table, fail; GOV.UK's table without headings, fail) | 11 | 11 |
  | `page-zones-landmark` (the W3C demo's header, nav and footer divs, UW's banner and menu, fail; an h2 classed "header", pass) | 14 | 14 |
  | `form-group-name-present` (GOV.UK's radios and checkboxes, the W3C survey) | 4 | 4 |
  | `heading-order` | 4 | 4 |
  | `empty-table-header` (corner cells over row headers, pass, though the GOV.UK audit lists one) | 2 | 2 |
  | `form-control-single-label` | 1 | 1 |
  | `bypass-blocks-present` (UW's inaccessible page) | 1 | 1 |

  Left out: `region`, 179 questions about the same few blocks outside
  landmarks on these pages, too many to label by hand and mostly one
  problem repeated; one table labelled unsure (a one-row table holding an
  empty header) not scored. Tables, `focus-order-semantics`,
  `presentation-role-conflict` and `accesskeys` had no real case here.

## "Is it text", and step 1 done (2026-11-27)

The last `read` family (`registry-13`): `contrast-minimum` and
`contrast-enhanced` for the reasons reading can settle (a symbol that may
not be text, logo text, a contrast switch, a placeholder; reasons that need
a measurement stay "unsure"), `symbol-graphic-contrast` (do low-contrast
symbols carry information) and `css-orientation-lock` (does a rotation or a
block hidden in one orientation restrict use). With it every check of the
inventory's `read` lane is answered: 46 of 132.

- **Demo:** a page of its own, `text.html` (AAA): a grey star rating with no
  text (fail), a grey arrow after "Next page" (pass), content hidden in
  portrait (fail). The whole demo: **81 of 81**, after the call budget was
  raised again (81 questions, 80 allowed: one left open; now 120). The two
  contrast checks get no demo case: the engine sends symbols to
  `symbol-graphic-contrast` and fails a light placeholder outright; their
  other reasons need engine settings (`logoText: 'ask'`,
  `contrastSwitch: 'ask'`) or a measurement.
- **Real pages:** 22 pages scanned with the AAA profile (GOV.UK's colour and
  contrast pages, the W3C demo, UW, W3C and APG pages): no question of this
  family came up. These checks have no real case yet.

## The walk lane: step 3 (2026-11-27)

Twelve checks (`tabindex`, `focus-not-removed-by-script`,
`iframe-focusable-content`, `scrollable-region-focusable`,
`mouse-only-event-handlers`, `css-hidden-focus`, the aria-expanded and
aria-checked mismatches, `skip-link`, `aria-hidden-focus`,
`nested-interactive-controls-absent`, `server-side-image-map-absent`). The
engine's own report (the handler's code, its runtime probe, the real state
against the announced one) settles most of them, so they are reading
questions (`registry-14`). Seven of them also take the element's own stop
from the focus walk when there is one (`walkStop`, `registry-15`): reached
or not, its neighbours in Tab order, hidden while focused, focus taken away.

- **Demo:** a page of its own, `keyboard.html` (best practices on), 16
  questions. The whole demo: **97 of 97**. Two corrections on the way: an
  image that is the only content of a link was labelled pass as a
  description; its alt is the link's name, and the model failed it, rightly
  (label corrected); a hover that only enlarged a picture was ambiguous (the
  model said "a visual effect": unsure); it now shows text said nowhere
  else.
- **Real pages, read only** ([walk-lane-read/](walk-lane-read/)): 18 questions
  (GOV.UK's tabindex page, the W3C demo, UW), labelled before any answer: 10
  answered, all agree; 8 unsure, for what only the walk can see: six skip
  links hidden by CSS (do they appear on focus?), what Tab passes before a
  positive tabindex, a menu's onmouseout.
- **Real pages, with the walk** ([walk-lane-walk/](walk-lane-walk/)):
  `focus: true` on the same kinds of page: **23 of 24**, none wrong; the
  skip links (12 of 12) and the tabindex link are now answered from the
  walk's facts; the one open is the menu's onmouseout, whose code is not in
  the evidence.
- **Found on the way:** the walk's `hidden` flag missed elements moved off
  the page to the left or above, clipped to nothing or fully transparent,
  which is how skip links hide; it counts them now (a skip link that comes
  into view on focus is not hidden). Skip links checked by hand in a
  browser: the W3C demo's come into view on focus.

## The measure lane: step 4 (2026-11-27)

Nine checks (`contrast-computable`, `link-in-text-block`,
`text-spacing-content-loss`, `avoid-inline-spacing`,
`reflow-horizontal-scroll`, `resize-text-content-loss`,
`target-size-minimum`, `target-size-enhanced`, `meta-viewport-zoom-enabled`;
`registry-16`). The engine measures most of these and reports what it
found, so they are reading questions on it; `link-in-text-block` also takes
what focus changes (`walkStop`). Contrast the engine cannot compute (text
over an image, a gradient, a blend, a filter) gets a measurement of its own,
`pixels`: a picture of the element as drawn, the contrast of the text colour
against the pixels unlike it, and `nearTextShare`, the share of the box drawn
almost in the text's colour (which is how a background close to the text
colour shows: the ratios cannot).

- **Demo:** a page of its own, `measure.html` (AAA): white text on a
  near-white gradient (fail) and on a dark one (pass), a teaser cut with the
  spacing applied (fail), a one-word label with forced spacing (pass), a
  zoom-blocking viewport tag replaced by one that allows it (pass). The
  whole demo: **103 of 103**. Reflow, resized text and target size raised
  nothing there.
- **Real pages** ([measure-lane/](measure-lane/)), with the focus walk:
  GOV.UK's colour, link, text size, zoom, layout and target pages, the W3C
  demo (background images behind most of its text), UW, three W3C pages.
  162 questions: 158 `contrast-computable`, 4 `link-in-text-block`; no other
  check of the lane came up. **Labels for contrast come from a reference
  measurement** ([contrast-reference.js](contrast-reference.js)), not by
  eye: in a browser of its own, the element's picture with its text and
  again with the text transparent, so the background under each glyph is
  read directly; fail when more than a tenth of it is below the ratio. 141
  pass, 1 fail, 16 not measurable (not scored). The links by reading: two
  with nothing but colour and no change on focus (fail), two whose only
  focus cue is an outline with hover unknown (unsure, not scored).
- **Result:** 144 scored, **137 agree, none wrong** (contrast 135 of 142,
  the one real failure among them, light text at 40px over an image; links
  2 of 2). The 7 left open are readable text the lab's measurement put at
  10 to 30% of the background below the ratio: telling text from background
  by colour counts antialiased edges as background, and the model rightly
  did not decide on it. The reference method (text made transparent for a
  moment) reads the background exactly; using it in the lab would settle
  these, at the cost of changing the page for a moment, which the walks'
  fingerprint check would have to cover. One answering model applied its
  readings with a script keyed on the measured values (it said so).

## Exact contrast, WCAG's reading, and trust (2026-11-27)

Three items of the work the user's decisions left (START-HERE, "Where to
pick up").

- **Exact contrast in the lab** (`registry-17`): `pixels` now reads the
  background under each glyph as `contrast-reference.js` does (a picture
  with the text, then with the text made transparent for a moment, every
  touched style attribute put back, a fingerprint before and after; the
  colour method as fallback). The measure lane's real pages again
  ([measure-lane-exact/](measure-lane-exact/)): all 158 contrast cases
  measured exactly, no page left changed; **144 of 144 agree, none open**
  (the 7 left open by the colour method are settled). The demo: 103 of 103;
  its near-white banner falls back to the colour method (the glyphs are
  invisible on it, so hiding them changes nothing), whose "nearly all the
  text colour" sign gives the fail.
- **Labels by WCAG's reading** (decision 7): 15 GOV.UK labels written by the
  audit's stricter reading were re-read (each note says so):
  "Read more" after the paragraph under its heading (2.4.4 by H80) and
  "Click here for more information on the Rocky Mountains" (G53) pass, the
  search field with a "Search" button beside it passes (G167), the
  lightboxes and the role=button link pass keyboard (Escape or an X link
  closes them, Enter works), and focus order on the non-modal lightboxes
  passes. Effect: the first GOV.UK run's two "wrong passes" were these
  readings, so its answered agreement is **62 of 62**; the other changed
  cases were left open by the AI and move nothing. `label-rules.js` writes
  them so.
- **Trust** (decision 8): `ai:agreement` has a Trusted column (30 labelled
  cases, 95% agreement when answered, no wrong pass), and
  [trust.md](trust.md) (`trust-table.js`) sums the real-site runs per check,
  one run per set of pages: **6 of 33 checks trusted**:
  `contrast-computable` (142 cases), `page-title-patterns` (96),
  `focus-visible` (81), `focus-order` (80), `keyboard` (67, but only 7
  answered: it may only fail), `img-alt-decorative` (50). `img-alt-quality`
  (56 cases, 98%) is held back by its one wrong pass (the W3C news photo).
  The rest have fewer than 30 cases. Labels are the assistant's: trust is
  provisional until a person labels the runs.

## Pictures to the model: decision 5 measured (2026-11-27)

With `ai: { pictures: true }` (and `A11Y_AI_PICTURES` allowing the site), the
image and text alternative questions and `image-of-text` also send the
element's picture. Measured, as decision 5 asks, before wider use: each set
answered blind twice, by one answerer with the pictures (opened from the
files `answer-offline.js prompts` now writes beside the questions) and by
another with the same prompts without them.

**The demo** (`examples/specs/ai-answers.spec.json`, `pictures` on its
reading step; four new `image-of-text` cases and their alt questions):
**114 of 114 agree** with pictures ([demo/score.txt](demo/score.txt),
pictures in [demo/pictures/](demo/pictures/)). Of the 26 picture questions,
without the pictures 24 agree and 2 stay open
([demo-pictures/](demo-pictures/)): the two image buttons drawn as PNGs, one
the word "Go" (fail), one a magnifier (pass). Neither the markup nor the
file name says what they show; the picture settles both at 0.9. The SVG
cases (the "Check" buttons, the logo, the text banner) are read from the
SVG's source either way.

**The W3C Before and After pages** (`examples/specs/ai-answers-w3c-pictures.spec.json`,
the eight pages, reading questions only): 200 questions, 41 with a picture
(31 `img-alt-quality`, 10 `img-alt-decorative`), all labelled by matching
the [w3c-bad](w3c-bad/) labels (by review key; 8 fail, 33 pass). In
[w3c-pictures/](w3c-pictures/):

| | Agree | Open | Wrong pass | Wrong fail |
| --- | --- | --- | --- | --- |
| With pictures | 40 | 1 | 0 | 0 |
| Without | 40 | 1 | 0 | 0 |

The one open is the **news photo** (Note 10) both times, but it moves the
right way: without the picture the answer leaned **pass** (0.55, "the alt
describes the story"), with it **fail** (0.55, "the photo shows a woman in
front of a canyon; the alt asserts an activity the image does not show").
Below the 0.6 threshold either way, so it stays a person's; the earlier runs
passed it outright twice.

**What it says.** Pictures change nothing where the text already settles the
question (alt text read against its context, SVG sources), and settle the
cases only a picture can: a raster image button's text, what a photo shows.
Few cases yet (2 picture-only on the demo, 1 hard photo on the W3C pages):
not enough to trust pictures more widely, enough to keep them opt-in as
decided. Next measurement: a site with raster image buttons or banners, and
photos whose alt claims more than they show.

This run is a re-run of the W3C pages already counted in
[trust.md](trust.md), so the trust table leaves it out.

### Replicate

```bash
node examples/serve-demo-site.js &
A11Y_AI_PREVIEW=on A11Y_AI_PICTURES=localhost node src/cli/run-workflow.js examples/specs/ai-answers.spec.json --out runs/ai-demo
A11Y_AI_PREVIEW=on A11Y_AI_PICTURES=www.w3.org node src/cli/run-workflow.js examples/specs/ai-answers-w3c-pictures.spec.json --out runs/w3c-pictures
node docs/design/ai-cant-tell-spike/answer-offline.js prompts runs/w3c-pictures/ai-sent.json runs/w3c-pictures/questions.jsonl
```

A question with a `picture` field names its file (`pictures/q7.jpg`, beside
`questions.jsonl`); the answerer looks at it with the prompt.

## Forms: decision 6 (2026-11-27)

The `interact` lane's three checks, answered (`registry-19`):

- `invalid-field-error-message` and `live-region-announcements` by
  **reading**: the page is in the state they ask about once the workflow put
  it there (a submission with errors; the live-region hook's record), so no
  option is needed. A field's texts are read for it (`field`: its labels,
  description and error message, each with whether it is shown and heard,
  the text of its row; whether it holds a value, never the value).
- `password-paste-enabled` from the paste handler, and with `ai: { forms:
  true }` on a host in `A11Y_AI_FORM_HOSTS` from a **paste tried** (`paste`:
  cancelled, filled by the page's script, an alert), every field of the form
  put back. The tries come after the reading questions; the pass never
  submits a form.

**The demo** gains a forms page (`examples/demo-site/ai/forms.html`): three
invalid fields (error text beside but not tied: pass; only a red border:
fail; a hidden message and nothing else: fail), three sign-in fields
(`return false`: fail; a handler that only notes the time: pass; a split
one-time code whose handler spreads the digits: pass), two live regions (a
basket status inside aria-hidden: fail; a decorative emoji ticker: pass),
and four incidental questions it raises. **128 of 128 agree**
([demo/score.txt](demo/score.txt)).

**What the paste adds**, the three sign-in questions answered blind again
without it ([demo-forms/](demo-forms/)): `return false` is failed either way
(0.9); the two handlers that call script are left **open** without the paste
("its code is not in the evidence") and answered **pass** at 0.85 with it.
As with pictures: the action settles only what reading cannot.

Not yet on real sites: the GOV.UK pages with errors (its design system's
error pattern) and a real sign-in form on a test system are next.

### Replicate

```bash
node examples/serve-demo-site.js &
A11Y_AI_PREVIEW=on A11Y_AI_PICTURES=localhost A11Y_AI_FORM_HOSTS=localhost node src/cli/run-workflow.js examples/specs/ai-answers.spec.json --out runs/ai-demo
```

## Media and moving content: step 5 done (2026-11-27)

The `media` lane's five checks answered by reading (`registry-20`), with a
`media` reader (`readMedia` in `evidence.js`): for an `<audio>` or `<video>`
its facts (duration when known, autoplay, muted, loop, controls, shown) and
text tracks (with the start of a track file of the same site); the links in
its own section, with the text a same-page link leads to (a transcript one
link away); and the page's controls named for pausing, stopping, hiding or
muting, with their `onclick`. Nothing is played: what only listening can
tell (do the captions match the speech) stays open or a person's.

The engine reports few details for these (its reason is in its summary), and
its transcript search missed an "Episode text" link to a transcript further
down; the section's links found it.

**The demo** gains a media page (`examples/demo-site/ai/media.html`): two
autoplaying sounds (birdsong with a stop button at the top: pass; a spoken
welcome looping with nothing: fail), a muted background video (pass), an
interview video (no captions, no transcript: fail), a podcast with its
"Episode text" (pass) and one without (fail), sliding offers with a pause
button (pass), a spinning decorative sun (fail), two marquees (a stop button:
pass; stops only on hover: fail), and the incidental questions they raise,
plus the reading page's how-to video now asked about. **148 of 148 agree**
([demo/score.txt](demo/score.txt)).

Not yet on real sites: pages with real video players (YouTube or Vimeo
frames are outside the page and not read), podcasts with transcripts, and
carousels.

## The new families on real pages: a survey, pictures sent (2026-11-27)

`examples/specs/ai-answers-survey-pictures.spec.json`: the 77 GOV.UK audit
pages not scanned before and 8 W3C pages chosen for the new families (the
APG carousels, the WAI forms tutorials on notifications and validation, the
image tutorials on text, functional and complex images, the WAI media
guide), with `pictures: true`. 326 questions; **only a few were for the new
families**, so the real pages say little about them yet:

- **Media:** 3 (GOV.UK's audio and video "missing text alternative" pages:
  2 transcripts, 1 captions) and 1 marquee. No autoplay, no moving content:
  the APG carousels rotate by a script timer, which the engine's
  `moving-content-pausable` (CSS and Web Animations) does not see.
- **Forms:** none. GOV.UK's error pages mark errors by colour or not at all,
  never with `aria-invalid`, so the engine has nothing to ask; the WAI
  tutorials' examples are static.
- **Pictures:** 1 `image-of-text` (the WAI functional-images search button)
  and 49 alt and SVG questions that send a picture.

The 54 (all the new-family questions and every question with a picture)
were labelled before any answer was read (5 fail: GOV.UK's object with
"Alternative text" as its fallback, the audio and video with no
transcript or captions, the marquee; 49 pass: W3C's own pages and the
tutorials' good examples), then answered blind twice. In
[survey-pictures/](survey-pictures/):

| | Agree | Open | Wrong |
| --- | --- | --- | --- |
| All 54, with pictures | **54** | 0 | 0 |
| The 50 picture questions, with pictures | 50 | 0 | 0 |
| The same 50, without | 47 | 3 | 0 |

The three the picture settles: the two carousel photos ("Walking Tour in
Amsterdam": without the picture "its accuracy cannot be checked"; with it
"an Amsterdam canal scene", pass at 0.6) and the search button (a
magnifier, no text: `image-of-text` pass at 0.9, unsure without). As on the
demo and the W3C pages: pictures change no answer the text settles, and
settle what only seeing can. These pages are new to the evaluation, so the
run counts in [trust.md](trust.md) (now 37 checks; `img-alt-decorative`
trusted with 82 cases).

Still needed for the new families: pages that use `aria-invalid` with their
errors (a design system's error pattern), live regions, autoplaying media
and animated content, on hosts the environment allows.

## The GOV.UK Design System's error examples (2026-11-28)

`examples/specs/ai-answers-govuk-design-system.spec.json`: the 26 example
pages of the Design System with errors (text input, date input, radios,
checkboxes, select, textarea, file upload, password input, error message,
error summary) and the character count's examples, with pictures; host
`design-system.service.gov.uk`, added to the environment for this. 118
questions.

**No `invalid-field-error-message` question:** every GOV.UK error message
is tied to its field (`aria-describedby`) and shown, so the engine passes
them itself. The forms lane still has no real case; it needs a site whose
errors are marked `aria-invalid` and not tied, or tied to a hidden message.

What it gives instead, all labelled **pass** before any answer was read
(`region`, 45 questions on the example pages' bare layout, left out as
before): 26 page titles, 19 error messages asked as "bold paragraph as
heading" (they are not headings), 17 custom checkboxes and radios whose
native input is hidden (focus shows on the drawn box), 6 one-component
pages with nothing to bypass, 1 live region (the character count's screen
reader status, `aria-hidden` until the threshold), and 4 logos and links.
In [govuk-design-system/](govuk-design-system/):

| Check | Labelled | Agree | Open |
| --- | --- | --- | --- |
| `page-title-patterns` | 26 | 26 | 0 |
| `p-as-heading` | 19 | 19 | 0 |
| `css-hidden-focus` | 17 | 17 | 0 |
| `bypass-blocks-present` | 6 | 6 | 0 |
| `live-region-announcements` | 1 | 0 | 1 (pass at 0.55: "kept aria-hidden while the count is below the threshold, so it carries no message users need until then") |
| logos, back link | 4 | 4 | 0 |
| **Total** | **73** | **72** | **1** |

None wrong. Every label here is pass, so the run says nothing about wrong
passes; it adds cases where the trust table was short: `css-hidden-focus` 29
and `p-as-heading` 26 of the 30 needed, `page-title-patterns` 122. Counted
in [trust.md](trust.md) (6 of 38 checks trusted).
