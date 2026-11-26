# Start here: AI support for "can't tell" results

Branch: `design-ai-cant-tell` (on origin). No pull request: the work is
experimental until it is decided to merge it.

Read, in this order:
1. This page: the state and what is next.
2. `../ai-answers.md`: the user guide (how to use it, every option of the
   scan step's AI answers field, the server's settings, the demo).
3. `ai-cant-tell-eval/README.md`: how the AI is evaluated, the demo's and the
   real sites' results (W3C, UW, GOV.UK, WAI tutorials), and how to repeat
   them.
4. `ai-cant-tell-design.md`: the design, section by section (the newest are
   near the end, before "Status when work stopped"), as needed.
5. `ai-cant-tell-data-and-agents.md`: before turning the AI pass on for a
   customer's site (what leaves the lab, agents, how to set it up well).
6. `ai-cant-tell-spike.md`: the earliest results.

## State (end of 2026-11-25)

Everything is committed and pushed (latest: the **open walk**, an opt-in
`open: true` that presses what says it opens something and records what the
keyboard can do with it, evaluated on the GOV.UK keyboard pages; before that
the WAI tutorials and 42 more GOV.UK pages; prompt version `registry-7`). The
full suite (4484 pass, 5 skipped) and the browser tests (`focus-walk`,
`ai-answer`, `app-boot`: 36) pass.

**Built.** Code in `src/server-side/ai-answer/` (`index.js` the pass,
`registry.js` the questions, `focus-walk.js`, `evidence.js`, `provider.js`,
`outgoing.js`, `runtime-key.js`, `lessons.js`), `src/js/ai-answer-view.js`,
`src/js/ai-review.js`, `src/js/ai-key-field.js`, `src/cli/ai-agreement.js`.

- **The AI pass** of a scan step (`ai` option) answers only what the scan
  leaves as can't tell; the tool's outcome never changes.
- **Questions answered by reading:** page title, alt text, decorative images,
  bold paragraph as heading, link text, field labels. An image question also
  says what the picture shows (blank, colours), read from its pixels.
- **The focus walk** (`ai: { focus: true }`, `focusStops` default 40, max
  200): Tab through the page in its own Tab order, then focus and scroll put
  back, checked by a fingerprint (answers dropped and a warning logged if the
  page changed). Links that give focus up at once (`onfocus="blur()"`) are
  recorded with `lostFocus`. Each stop: name, landmark, heading, what changed
  on focus, how much is covered (25 points), a picture; for 2.4.13 or 1.4.11
  an exact picture focused and unfocused, compared pixel by pixel. Then, read
  only, controls a mouse can use that Tab never reached, and a picture of the
  page with the stops numbered in the review.
  - Page-level questions: focus visible (2.4.7), focus order (2.4.3),
    keyboard (2.1.1, fail only), focus not obscured (2.4.11 and 2.4.12),
    focus appearance (2.4.13).
  - Per-element questions the scanner asks: focus visible, focus appearance
    and **focus indicator contrast (1.4.11, `focus-contrast-element`, the
    newest)** per link whose outline a style removes; keyboard per control
    (fail only); focus not obscured per fixed or sticky box.
  - **The open walk** (`open: true` with `focus`, `openControls` default 10,
    `open-walk.js`, the newest): presses each control Tab reaches that says it
    opens something (aria-expanded, aria-haspopup, aria-controls, a link to
    `#`, a role=button link; never a submit, a form's control or a plain
    button), with every navigation of the page stopped; records whether its
    key worked, what opened, where focus went, whether Tab gets in and stays,
    whether the close control can take focus and Escape closes; closes it
    again. Evidence for keyboard and focus order.
- **Providers:** the built-in Claude call (key from Run settings, kept in
  memory, or `ANTHROPIC_API_KEY`; the evidence is sent compact and marked for
  prompt caching, so a page's focus questions pay for the walk once;
  `A11Y_AI_PROMPT_CACHE=off`), or `A11Y_AI_ENDPOINT` (any model or agent).
- **Server safeguards:** allowed sites, masking, preview, a log of what was
  sent (named by the question asked).
- **Review AI answers:** a card per question, your answer then the AI's,
  **By check** (per check answered and left open; per rule what the AI does
  not take), CSV and lessons exports, What was sent to the AI. Conformance
  remarks from confirmed fails. `npm run ai:agreement`.
- **Docs:** `docs/ai-answers.md` (user guide), configuration reference,
  examples README, this folder.
- **The demo:** `examples/demo-site/ai/` (`reading.html`, `focus.html`,
  `dialog.html` for the open walk),
  `examples/specs/ai-answers.spec.json`, the correct answers in
  `expected.json`, `examples/ai-demo-score.js`. 36 questions, including a Help
  link that shows focus from a script (2.4.7, 1.4.11 and 2.4.13 pass) and a
  modal dialog a keyboard user cannot close (keyboard and focus order fail,
  found by the open walk).
  Evaluated blind, a model answering the lab's exact prompts outside the lab
  (`ai-cant-tell-spike/answer-offline.js`): **36 of 36**
  (`ai-cant-tell-eval/demo/`). Clear cases by design: it shows the pipeline,
  not real-site accuracy.
- **Real sites,** built with documented accessibility problems (the WAI
  tutorials: with correct markup, to see that the AI does not fail it), scanned
  with the current code, answered blind by separate models on the lab's exact
  prompts (`answer-offline.js`), scored with `ai:agreement` **against labels
  written by the assistant, not a person** (`ai-cant-tell-eval/README.md`):

  | Site | Spec (`examples/specs/`) | Labelled | Agree | Of those answered | Wrong |
  | --- | --- | --- | --- | --- | --- |
  | W3C Before and After Demonstration, run 5 | `ai-answers-w3c-bad.spec.json` | 57 | 47 (82%) | 98% | 1 pass (news photo, Note 10; it varies run to run) |
  | UW Accessible University | `ai-answers-uw-au.spec.json` | 47 | 38 (81%) | 100% | 0 |
  | GOV.UK accessibility tool audit, 23 pages | `ai-answers-govuk-audit.spec.json` | 98 | 60 (61%) | 97% | 2 passes, WCAG readings the audit is stricter than |
  | GOV.UK audit, 42 more pages | `ai-answers-govuk-audit-more.spec.json` | 167 | 107 (66%) | 100% | 0 |
  | W3C WAI tutorials (correct markup, reading questions only) | `ai-answers-wai-tutorials.spec.json` | 63 | 58 (97%) | 100% | 0 |
  | GOV.UK keyboard pages, with the open walk | `ai-answers-govuk-open.spec.json` | 48 | 35 (73%) | 97% | 1 fail (focus order on the trap page, for the trap) |

  Most of what is left open is by design: keyboard, which the AI may not
  pass, and focus questions on pages with nothing focusable. Files per site in
  `ai-cant-tell-eval/w3c-bad/` (runs 1 to 5), `uw-au/`, `govuk-audit/`,
  `govuk-audit-more/`, `wai-tutorials/`, `govuk-open/`; labels for all but the W3C demo from
  `label-rules.js` (`au`, `gov`, `wai`) over `list-cases.mjs`.
  Fixes these runs led to: links that give focus up at once, whole walks
  (`focusStops`), blank images, a video's own controls, keyboard asked where
  Tab reaches nothing, focus order judged on its own; then the open walk.

**Not measured yet:** anything through the lab's own Claude call with a real
key (so prompt caching too: the first real run should show cached tokens in
the API's usage); agreement after the evidence was reordered.

**On the user's machine:** the branch is checked out in the main folder,
`C:\Dev\surea11y\lab` (the old worktree was removed). **Do not commit** the
user's local-development edits in its working tree: `package.json`,
`extension/engines/vendor/surea11y-how-to-check.min.js`,
`extension/engines/vendor/surea11y.browser.min.js`, and the untracked `tmp/`.

To check the state:

```bash
node --test
```

```bash
node --test src/server-side/ai-answer/focus-walk.browserspec.js src/server-side/ai-answer/ai-answer.browserspec.js src/js/app-boot.browserspec.js
```

(With no Chrome of Puppeteer's own, set `PUPPETEER_EXECUTABLE_PATH` to a
Chrome or Chromium.)

## Next, in order

The first three need the user; the rest can be done without.

1. **A person's labels on the real-site runs** (W3C, UW, both GOV.UK runs,
   the WAI tutorials). Every
   figure so far is against labels the assistant wrote (`labels.json` in each
   site's folder), not a person's. The repo keeps each run's prompts and
   answers, not a report to open, so: run a site's spec
   again (with a key in the lab, or as a preview answered offline with
   `answer-offline.js`, see `ai-cant-tell-eval/README.md`), open the run's
   folder in the app (its `payload.json` or `answered.json` with its
   `images/`), answer every question in Review AI answers with the AI's
   answer hidden, against the site's documentation (the W3C's annotations,
   the UW info page, the GOV.UK test names), **Download report**, then
   `npm run ai:agreement -- <the zip> --preview`. Save the person's labels as
   `labels.json` (the report's `aiReview`) and record the result.
2. **A real model inside the lab:** the user has a Claude API key and enters
   it in Run settings on their own machine. Run the demo
   (`ai-answers.spec.json`, then `ai-demo-score.js`) and the W3C spec through
   the lab's own call; check the API usage for cached tokens.
3. **The user's claude.ai project "A11y Auditor Expert Agent":** carry its
   instructions and knowledge files into the built-in call (system prompt,
   cached knowledge, structured output, the official SDK), configured on the
   server (`A11Y_AI_INSTRUCTIONS`, `A11Y_AI_KNOWLEDGE` were proposed).
   Waiting on the user to export them.
4. **More cases per check.** There are 432 labelled cases over four sites;
   page title, alt quality, decorative images, focus visible, focus order and
   keyboard have more than 30 each; link text (6), field labels (3) and bold
   as heading (8) still fewer, because the scanner settles most of them itself
   (`ai:agreement` marks them), and each run's wrong answers are a different
   case (run-to-run variation): 30 to 50 per check are needed to trust a
   check. The GOV.UK audit's remaining pages are mostly about things the AI is
   not asked (contrast, language, tables, typography), so link text, labels
   and headings need content-heavy public sites (with documented problems, or
   known-good like the WAI tutorials); a new site needs its host allowed in
   the cloud environment (ask the user) and labels. Running each set two or
   three times and keeping the per-case spread would show which questions are
   unstable.
5. **Optional, not built:** pictures sent to the model (only after measuring
   that they help: the news photo of the W3C's Note 10, the one question the
   model keeps getting wrong, is about what the picture shows); 2.4.13's and
   1.4.11's measurement is lossy on animated focus styles (it reads after a
   short wait) and covered stops measure 0 changed (right, but worth saying in
   the review). Questions still left open that better evidence might settle:
   GOV.UK's "Read more" links (WCAG accepts the context, the audit does not),
   a button whose focus shows only as an outline change the page-level
   question does not measure, UW's divider images with alt "horizontal line
   graphic", the empty-alt BBC logo (GOV.UK, a fail argued but answered
   unsure). The open walk does not press a menu that opens on hover and
   says nothing (no aria-haspopup), nor plain buttons; on the GOV.UK
   lightboxes it moved no verdict (by WCAG they are keyboard-usable: Escape
   or an X link closes them); on the demo's dialog that cannot be closed it
   gave the fail, so a real site with such a dialog is still to be seen.
6. **On hold:** the browser extension (it never receives AI answers; see the
   design note's Handoff, item 4).

## Conventions

- Commit as the user: `Jorge Rumoroso <rumoroso@gmail.com>`, with
  `Signed-off-by`. No references to Claude or any AI assistant in branch
  names, commits, authors, co-author lines or attribution. Claude may be
  named where it is a tool the lab uses (the Claude API option), as may other
  AI services the user proposes; ask before adding another engine.
- No PR unless asked. No customer data in the repo (the W3C demo and the
  lab's own demo are public).
- `node --test` (not `npm test`) on Windows. Run `npm run build:action-docs`
  after changing step fields (the `ai` field's description lives in
  `src/workflow/action-definitions.js`).
- A new question: an entry in `registry.js` (`ANSWERABLE`, `PAGE_LEVEL` or
  `ELEMENT_WALK`), its facts in `keyFactRows` (and `FOCUS_CHECKS` for a walk
  question) in `ai-answer-view.js`, a row in the user guide's tables, and a
  case with its correct answer in the demo (`expected.json`).
- The background servers of a cloud session (demo site on 8780, lab on 3000)
  may be stopped between turns: start them in the same command that uses them.
- In a cloud session, the user's "lab" environment allows www.w3.org,
  projects.accesscomputing.uw.edu and alphagov.github.io (the evaluation
  sites) and api.anthropic.com; other sites are blocked.

Not in the repo: the Avaloq sample report and evaluation files (a customer's
site; the author's copies are in the temp folder `spike/avaloq/` and the config
is `avaloq.com.a11y-config.json` in the author's own files), and any model key.

A prompt to paste into a new chat:

> Continue the AI support for "can't tell" results on branch
> design-ai-cant-tell (check it out from origin). Read
> docs/design/ai-cant-tell-START-HERE.md and follow it.
