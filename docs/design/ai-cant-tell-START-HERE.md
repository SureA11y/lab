# Start here: AI support for "can't tell" results

Branch: `design-ai-cant-tell` (on origin). No pull request: the work is
experimental until it is decided to merge it.

Read, in this order:
1. This page: the state and what is next.
2. `ai-cant-tell-roadmap.md`: the plan agreed with the user: first every
   "can't tell" the engine's rules produce (132 checks, listed with what
   would settle each in `ai-cant-tell-inventory.md`), then success criteria no
   rule can automate; and the decisions left for later.
3. `../ai-answers.md`: the user guide (how to use it, every option of the
   scan step's AI answers field, the server's settings, the demo).
4. `ai-cant-tell-eval/README.md`: how the AI is evaluated, the demo's and the
   real sites' results (W3C, UW, GOV.UK, WAI tutorials), and how to repeat
   them.
5. `ai-cant-tell-design.md`: the design, section by section (the newest are
   near the end, before "Status when work stopped"), as needed.
6. `ai-cant-tell-data-and-agents.md`: before turning the AI pass on for a
   customer's site (what leaves the lab, agents, how to set it up well).
7. `ai-cant-tell-spike.md`: the earliest results.

## State (end of 2026-11-27)

Everything is committed and pushed (last code change: `279df36`; after it
only evaluation runs and docs). **Phase 1 of the
roadmap is complete except for the engine's part:** the AI answers **76 of
the 132 checks** that can end in "can't tell". What is left is 23 `tree`
checks, which belong in the engine (decision 4; **ask the user for the
engine's GitHub repository** before starting), and 32 `code` checks, which a
person confirms (decision 3: nothing to build). Demo **148 of 148** (blind);
prompt version `registry-20`. The full suite (`node --test`, 4501 pass) and
the browser tests (`ai-answer.browserspec.js` 14, `focus-walk` 17,
`app-boot` 17) pass.

What 2026-11-27 added, in order (each in the eval README with how to repeat
it):

1. **The user decided the roadmap's eight open questions** (every
   recommended option; the roadmap's "Decisions").
2. **Exact contrast** (`registry-17`): the background under each glyph read
   with the text hidden for a moment; the measure lane's 144 real cases,
   144 of 144.
3. **Labels by WCAG's reading** (decision 7): 15 GOV.UK labels re-read.
4. **Trust per check** (decision 8): `ai:agreement`'s Trusted column and
   `ai-cant-tell-eval/trust.md` (`trust-table.js`): 6 of 37 checks trusted
   (30 labelled real cases, 95% when answered, no wrong pass).
5. **Pictures (decision 5, `registry-18`).** `ai: { pictures: true }` per
   step, off by default; the server's `A11Y_AI_PICTURES` (`on`, or hosts)
   must allow it; only questions marked `picture: true` in the registry send
   one; never a picture showing a value typed in a field
   (`evidence.pictureNotSent`); the built-in call sends it as an image block
   after the cached evidence (`contentFor` in `provider.js`), an endpoint in
   the question (`picture: true`). `image-of-text` answered.
   `answer-offline.js prompts` writes the pictures beside the questions.
   Measured: the demo's two picture-only buttons are settled only with
   pictures; on the W3C pages 40 of 41 with and without (the news photo
   leans fail with its picture, pass without, open both times).
6. **Forms (decision 6, `registry-19`).** `invalid-field-error-message`
   (with the field's texts, `field`) and `live-region-announcements` are
   answered by reading: the state they ask about is one the workflow's own
   steps (a submission with errors) or the engine's live-region hook give.
   `password-paste-enabled` with `ai: { forms: true }`, only on hosts in
   `A11Y_AI_FORM_HOSTS` (no "on": hosts must be named): a paste event tried
   (`probePaste`: cancelled, filled by the page's script, alerts dismissed),
   the form's fields put back, after the reading questions, never a
   submission. Without the paste the two script handlers stay open.
7. **Media and moving content (`registry-20`):** `video-caption`,
   `media-alternative-transcript-evidence`, `no-autoplay-audio`,
   `moving-content-pausable`, `deprecated-elements-not-used`, by reading
   with a `media` reader (`readMedia`: the media's facts and tracks, the
   links in its section with the text a same-page link leads to, the page's
   pause, stop and mute controls). Nothing is played.
8. **The new families on real pages** (eval README, "The new families on
   real pages"; `ai-answers-survey-pictures.spec.json`, folder
   `ai-cant-tell-eval/survey-pictures/`): the 77 GOV.UK audit pages not
   scanned before and 8 W3C pages (carousels, forms tutorials, image
   tutorials, media guide), with pictures. Only 5 new-family cases came up
   (3 media, a marquee, an image of text) and **no forms ones**. The 54
   new-family and picture questions, labelled first: 54 of 54 with
   pictures; without, 3 picture questions stay open (two photos, an
   icon-only search button), none wrong. Counted in `trust.md` (6 of 37
   checks trusted).
9. **The GOV.UK Design System's error examples (2026-11-28;**
   `ai-answers-govuk-design-system.spec.json`, folder
   `ai-cant-tell-eval/govuk-design-system/`; the user approved adding
   design-system.service.gov.uk to the environment). No forms question
   came up: GOV.UK ties and shows every error message, so the engine
   passes them. 73 other questions, all labelled pass: 72 agree, 1 open
   (the character count's live region, leaning pass), none wrong.
   `css-hidden-focus` now 29 and `p-as-heading` 26 real cases of the 30
   trust needs; `trust.md` 6 of 38 checks trusted.

**The plan** (`ai-cant-tell-roadmap.md`): phase 1, the AI for every "can't
tell" from the rules, then phase 2, criteria no rule can automate (decisions
1 and 2: AI-raised items in a section of their own, unconfirmed, counting
towards nothing until a person confirms; the AI only flags, never passes).

**Where to pick up**, in this order:

1. **Real sites for the new families, on hosts the user must allow.** The
   environment's allowed hosts (www.w3.org, projects.accesscomputing.uw.edu,
   alphagov.github.io, design-system.service.gov.uk) are used up for these
   families (items 8 and 9 above): no page there leaves an `aria-invalid`
   field without a shown, tied message, and none has autoplay or animation
   the engine sees. **Ask the user** to allow hosts with such pages (sites
   with known form-error problems, real `<video>`/`<audio>`, carousels,
   live regions); a check short of 30 cases (`css-hidden-focus` 29,
   `p-as-heading` 26) can be topped up on the allowed hosts meanwhile. Then: survey as a preview, label the
   new-family questions before reading any answer, answer blind (with and
   without the paste or pictures where they apply), score, record in the
   eval README and START-HERE, rerun `trust-table.js`. A sign-in form for
   the paste needs a test system the user names (`A11Y_AI_FORM_HOSTS`).
   **Found on the way, for the engine (decision 4's repository):** a
   carousel rotated by a script timer (the APG examples) is not seen by
   `moving-content-pausable`, which reads CSS and Web Animations only.
2. **The engine's tree lane (decision 4):** ask the user for the engine's
   GitHub repository, attach it (`add_repo`), and make the engine settle the
   23 "name present" checks from the browser's accessibility tree; then the
   lab's inventory moves them to "the engine".
3. **Polish** (the roadmap's list): a person's labels (Next, item 1), a run
   through the lab's own Claude call with a real key (item 2), more cases
   for link text, field labels and bold as heading, the open walk's open
   points (item 7).
Without the user, what can go on: polish within the allowed hosts (item 3:
more cases per check where the trust table says "N of 30 cases"), and
preparing phase 2's design (item 4) for the user to agree.

4. **Phase 2**, once the user agrees phase 1 is done: start with what is
   already read (roadmap, "Phase 2", group 1: language of parts, sensory
   characteristics, structure shown only visually, missing format
   instructions).

| Step | Checks | Demo | Real cases |
| --- | --- | --- | --- |
| 1, text alternatives | 9 | all agree | about 10, all agree |
| 1, names and labels | 8 | 14 of 14 | 23 of 24 (one reading of 2.4.9) |
| 1, structure | 13 | all agree (one ambiguous case dropped) | 37 of 37 |
| 1, "is it text" | 4 | 4 of 4 | none came up |
| 3, walk lane | 12 | 16 of 16 | 10 of 10 read only (8 unsure), 23 of 24 with the walk |
| 4, measure lane | 9 | 6 of 6 | 144 of 144 with the exact contrast measurement (137 before; labelled by a reference measurement) |
| 5, pictures (`image-of-text`, and pictures for the alt questions) | 1 | 7 of 7 (2 settled only with pictures) | W3C pages: 40 of 41 with and without; survey: 50 of 50 with, 47 of 50 without (3 open) |
| 5, forms | 3 | 8 of 8 (2 settled only with the paste) | none came up |
| 5, media and moving content | 5 | 16 of 16 | 4 of 4 (survey; no autoplay or animation came up) |
| 2, accessibility tree | 23 | | in the engine (decision 4), waiting on its repository |

**Built.** Code in `src/server-side/ai-answer/` (`index.js` the pass,
`registry.js` the questions, `focus-walk.js`, `open-walk.js`, `evidence.js`, `provider.js`,
`outgoing.js`, `runtime-key.js`, `lessons.js`), `src/js/ai-answer-view.js`,
`src/js/ai-review.js`, `src/js/ai-key-field.js`, `src/cli/ai-agreement.js`.

- **The AI pass** of a scan step (`ai` option) answers only what the scan
  leaves as can't tell; the tool's outcome never changes.
- **Questions answered by reading:** page title, bold paragraph as heading,
  link text, field labels, and every text alternative check: alt text,
  decorative images, SVGs (with what an inline SVG draws: title, desc,
  symbol, classes; its path data left out), image map areas (with the map's
  picture and the area's place on it), image buttons, objects, embeds,
  canvas, video posters (with what they embed, `image.embedded`) and alt
  text that repeats the text beside it (a best practice). An image question
  also says what the picture shows (blank, colours), read from its pixels.
  Best-practice findings (`canonical.bestPractices`, with the scan step's
  `includeBestPractice`) are asked like the others. Names and labels:
  placeholder headings, fields sharing a label, label in name, controls named
  only by a tooltip, generic link text alone (2.4.9, AAA), same-name links
  (2.4.9) and frames, unnamed landmarks; their questions get what the
  checker itself reported for the occurrence (`reported`: the fields sharing
  a label, where same-named links go...), shown in the review as "The
  checker found". Structure: ungrouped radios and checkboxes, fields with two
  labels, tables (a title row, no headers, headers with no cells, empty
  headers), heading order, bypass blocks, page zones and region,
  focusable non-controls, presentation conflicts, shared access keys; their
  questions get the table (`table`), the page's heading outline (`outline`)
  or its landmarks (`landmarks`), read from the page. "Is it text":
  low-contrast symbols (do they carry information), orientation lock (does
  it restrict use), and the text contrast checks for the reasons reading
  can settle (a symbol, logo text, a contrast switch, a placeholder; the
  reasons that need a measurement stay "unsure"). The measure lane: contrast
  over images, gradients, blends and filters measured from the page's
  pixels (`pixels`), links told by colour (with what focus changes), text
  spacing, reflow, resized text, target size and replaced viewport tags,
  from what the engine measured.
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
    and focus indicator contrast (1.4.11, `focus-contrast-element`) per link whose outline a style removes; keyboard per control
    (fail only); focus not obscured per fixed or sticky box.
  - **The open walk** (`open: true` with `focus`, `openControls` default 10,
    `open-walk.js`, the newest): presses each control Tab reaches that says it
    opens something (aria-expanded, aria-haspopup, aria-controls, a link to
    `#`, a role=button link; with `open: "buttons"` plain buttons too, unless
    the name says they act; never a submit or a form's control), with every
    navigation of the page and every request that could change something on
    a server stopped; records whether its
    key worked, what opened, where focus went, whether Tab gets in and stays,
    whether the close control can take focus and Escape closes; closes it
    again (a close control is told by a short name: "Close", "X", "×"), focus
    and scroll put back, checked by its own fingerprint: a page its script
    changed for good keeps the answers and logs a warning (`leftChanged`).
    Evidence for keyboard and focus order; the review lists each control
    pressed in a sentence. User guide: "Opening menus and dialogs"; design
    note: "Opening what the page opens".
- **Pictures, forms, media** (2026-11-27): `pictures: true` (with
  `A11Y_AI_PICTURES`), `forms: true` (with `A11Y_AI_FORM_HOSTS`), and the
  `field`, `paste` and `media` evidence; see State above and the user
  guide's "Pictures" and "Forms" sections.
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
- **The demo:** `examples/demo-site/ai/` (`reading.html`, `labels.html`,
  `structure.html`, `text.html`, `keyboard.html`, `measure.html`,
  `forms.html`, `media.html`, `focus.html`, `dialog.html` for the open walk),
  `examples/specs/ai-answers.spec.json` (run it with `A11Y_AI_PICTURES=localhost
  A11Y_AI_FORM_HOSTS=localhost`), the correct answers in
  `expected.json`, `examples/ai-demo-score.js`. 148 questions, including a Help
  link that shows focus from a script (2.4.7, 1.4.11 and 2.4.13 pass) and a
  modal dialog a keyboard user cannot close (keyboard and focus order fail,
  found by the open walk).
  Evaluated blind, a model answering the lab's exact prompts outside the lab
  (`ai-cant-tell-spike/answer-offline.js`): **148 of 148**
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
  | GOV.UK accessibility tool audit, 23 pages | `ai-answers-govuk-audit.spec.json` | 98 | 62 (63%) | 100% | 0 (the 2 "wrong passes" were WCAG's reading; relabelled, decision 7) |
  | GOV.UK audit, 42 more pages | `ai-answers-govuk-audit-more.spec.json` | 167 | 107 (66%) | 100% | 0 |
  | W3C WAI tutorials (correct markup, reading questions only) | `ai-answers-wai-tutorials.spec.json` | 63 | 58 (97%) | 100% | 0 |
  | GOV.UK keyboard pages, with the open walk | `ai-answers-govuk-open.spec.json` | 48 | 35 (73%) | 97% | 1 fail (focus order on the trap page, for the trap) |
  | W3C ARIA Authoring Practices examples (working widgets), `open: "buttons"` | `ai-answers-apg-open.spec.json` | 55 | 46 (84%) | 100% | 0 |

  Most of what is left open is by design: keyboard, which the AI may not
  pass, and focus questions on pages with nothing focusable. Files per site in
  `ai-cant-tell-eval/w3c-bad/` (runs 1 to 5), `uw-au/`, `govuk-audit/`,
  `govuk-audit-more/`, `wai-tutorials/`, `govuk-open/`, `apg-open/`; labels for all but the W3C demo from
  `label-rules.js` (`au`, `gov`, `wai`, `apg`) over `list-cases.mjs`.
  Fixes these runs led to: links that give focus up at once, whole walks
  (`focusStops`), blank images, a video's own controls, keyboard asked where
  Tab reaches nothing, focus order judged on its own; then the open walk.

**Not measured yet:** pictures beyond the W3C pages, forms and media on
any real site (item 1 of "Where to pick up"); the measure lane beyond contrast and links on real pages
(text spacing, reflow, resized text, target size and viewport tags came up
only in the demo, some not even there); the walk lane's checks beyond tab
order, hidden focus and mouse-only handlers on real pages (frames, scrolling
boxes, focus taken by a script, state mismatches, aria-hidden focus, nested
controls and server-side maps had no real case); the "is it text" checks on
any real case (none came up on 22 evaluation pages); the structure checks on
real pages beyond 37 cases in seven checks (`region`, 179 questions on the
same few blocks, was left out: it needs a way to sample or group them;
focus-order semantics, presentation conflicts, access keys and title-row
tables had no real case); the names and labels on enough real cases (24, in
four of the eight checks; headings, label in name, frames and tooltip-only
names had none); the text alternative checks on enough real cases: the
evaluation sites have about ten (5 SVGs, all correct; 1 image button; no image
map; 2 objects or videos; 1 redundant alt, 1 object with a placeholder), so
they need other sources, with failing cases among them; whether the report's
Best practices section shows the AI's badge on its rows, as the findings do
(built by the same function, not checked in the app); anything through the
lab's own Claude call with a real key (so prompt caching too: the first real
run should show cached tokens in the API's usage); agreement after the
evidence was reordered; the open walk on a real site with a dialog that truly
cannot be closed or traps focus (so far only the demo's). The runs before
2026-11-26 were made before the walks were judged by what the page shows: in
UW and the GOV.UK runs no walk was dropped for a changed page (every open case
has another reason), so their figures stand; W3C run 5 was not re-checked.

**Labels follow WCAG's reading** (decision 7, 2026-11-27): the GOV.UK labels
written by the audit's stricter reading were re-read (15, each note says
so). One case is still a judgement the AI read differently: UW's "Info" link
(2.4.9, AAA: "Details about all known issues are on the Info page"),
labelled pass as the page's name, failed by the model at 0.6. A person's
labels (item 1) remain the reference.

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

Items 1 to 3b need the user; the rest can be done without. Item 4 points to
"Where to pick up", the main line of work; 5 to 7 run beside it.

1. **A person's labels on the real-site runs** (W3C, UW, the three GOV.UK
   runs, the WAI tutorials, the APG examples). Every
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
3b. **Roadmap decisions:** made by the user on 2026-11-27 (all eight, see
   the roadmap's "Decisions"); all built except decision 4 (the engine's
   repository is still to ask) and phase 2 (decisions 1 and 2).
4. **Next without the user:** see "Where to pick up" above. The recipe for
   any new question: read the check's reasons in the engine
   (`node_modules/@surea11y/core/src/checks/manual/<id>-manual.js` or
   `automatic/<id>.js`; its `@reports` say what `reported` holds, though
   many occurrences carry fewer details, the reason being in its summary);
   its question and the evidence it needs; its facts in `keyFactRows`; a
   demo case with its correct answer (a page of its own under
   `examples/demo-site/ai/` with a step in `ai-answers.spec.json`, cases in
   `expected.json`); its lane set to `answered` and the inventory
   regenerated; a row in the user guide; bump `PROMPT_VERSION`; then
   evaluate blind (`ai-cant-tell-eval/README.md`) and record it here and in
   the eval README.
5. **More cases per check.** There are 432 labelled cases over four sites (and
   48 from the open-walk re-run of the GOV.UK keyboard pages, 55 from the APG
   examples); page title, alt quality, decorative images, focus visible, focus
   order and keyboard have more than 30 each; link text (6), field labels (3)
   and bold as heading (8) still fewer, because the scanner settles most of
   them itself (`ai:agreement` marks them), and each run's wrong answers are a
   different case (run-to-run variation): 30 to 50 per check are needed to
   trust a check. The GOV.UK audit's remaining pages are mostly about things
   the AI is not asked (contrast, language, tables, typography), so link text,
   labels and headings need content-heavy public sites (with documented
   problems, or known-good like the WAI tutorials); a new site needs its host
   allowed in the cloud environment (ask the user) and labels. Running each
   set two or three times and keeping the per-case spread would show which
   questions are unstable.
6. **Open questions the evidence might still settle:** 2.4.13's and
   1.4.11's measurement is lossy on animated focus styles (it reads after a
   short wait), and covered stops measure 0 changed (right, but worth saying
   in the review); GOV.UK's "Read more" links, a button whose focus shows
   only as an outline change, UW's divider images with alt "horizontal line
   graphic", the empty-alt BBC logo (GOV.UK, answered unsure); the W3C news
   photo, which pictures move towards fail but not past the threshold.
7. **The open walk, next steps (optional):** it gave the fail on the demo's
   dialog that cannot be closed, moved no verdict on the GOV.UK lightboxes (by
   WCAG they are keyboard-usable), and failed none of the APG's working
   widgets. Open points: a real site with a dialog that cannot be closed
   (needs its host allowed); menus that open on hover and say nothing (no
   `aria-haspopup`: GOV.UK's dropdown navigation) are not pressed; arrow keys
   are not pressed (an APG menubar's submenus, a menu's items); a page left
   changed is only logged (no undo beyond Escape, the control again and a
   close control); what a control saves in the browser (local storage) is
   detected, not undone.
8. **On hold:** the browser extension (it never receives AI answers; see the
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
  question) in `ai-answer-view.js`, a row in the user guide's tables, a case
  with its correct answer in the demo (`expected.json`), and its check's lane
  set to `answered` in `ai-cant-tell-inventory.js` (then run it: the
  inventory test checks the lane against the registry).
- A check that only runs with the AAA profile (2.4.9) or as a best practice
  is only asked when the scan step turns it on (`"profile": "wcag22-aaa"`,
  `"includeBestPractice": true`); the demo's steps do. A family's demo cases
  can get a page of their own and a step (as `labels.html`).
- Evidence kinds a question can list in `evidence` (`registry.js`), read by
  `evidence.js`: `element`, `context`, `pageTitle`, `image` (with
  `image.svg`, `image.area`, `image.embedded`), `reported` (what the checker
  reported, `occurrence.details`, bounded), `table`, `outline`, `landmarks`;
  the walk questions use `focusWalk`; a reading question can add
  `walkStop` (the element's own stop, only when the step has `focus: true`;
  without it the question is asked as before), `field` (a form field's
  label, description, error message, shown and heard, its row's text; never
  the value), `paste` (a paste tried, only with `forms` on an allowed host;
  such a question is asked after the reading ones), `media` (an audio or
  video's facts and tracks, its section's links and where same-page ones
  lead, the page's pause, stop and mute controls), or `pixels` (measured exactly, the text hidden for a moment with the page checked
  before and after, or by colour as fallback: the contrast of
  its text against what is drawn behind it, from a picture). Adding a kind to an existing question
  changes its prompt, so its blind answers must be redone; a new question
  takes what it needs. A question marked `picture: true` also sends the
  element's picture when the step has `pictures` and the server allows it;
  answering agents then open the file the question's `picture` names.
- Read the test results before committing: a chained `node --test && git
  commit` that ignores the result once pushed a syntax error (fixed at once).
- A demo case must be unambiguous under its own question's pass and fail
  wording: the first `table-th-has-data-cells` case (a header over a missing
  cell) was what the question calls "an empty column", and was dropped.
- On real pages, a check that fires on every block (`region`) can outnumber
  the rest: leave it out of the labelled set or sample it, and say so.
- Demo pages: no comment or text near a case that tells its answer. The
  evidence includes the page source around an element, so the model would
  read it; explanations go in `expected.json`, or in a comment above
  `<body>` or in `<head>`, which the evidence never includes.
- The demo workflow's call budget (`budget.calls`, per run) must cover every
  question: when cases are added, a page left open with `budget-calls` means
  the budget, not the AI (it is 200 now, for 148 questions).
- Re-scoring after a change: a prompt that comes out identical can keep its
  earlier blind answer (match the runs' `questions.jsonl` by prompt text);
  only new or changed prompts need answering again.
- New browser tests for the AI pass go in an existing spec that `test:dom`
  already lists (`ai-answer.browserspec.js`, `focus-walk.browserspec.js`), so `package.json`, which the
  user edits locally, is not touched. Unit tests (`*.test.js`) are found by
  `node --test` on their own.
- `npm run ai:agreement` writes `ai-agreement/` into the current folder: run
  `node src/cli/ai-agreement.js` from a scratch folder, not the repo root.
  `answer-offline.js apply` gives an answer also to the identical elements
  the lab asked once (`reused`).
- The background servers of a cloud session (demo site on 8780, lab on 3000)
  may be stopped between turns: start them in the same command that uses them.
- In a cloud session, the user's "lab" environment allows www.w3.org,
  projects.accesscomputing.uw.edu, alphagov.github.io and
  design-system.service.gov.uk (the evaluation sites) and
  api.anthropic.com; other sites are blocked. A new host is proposed with
  the environment tools (the user approves it) after a request to it was
  blocked; the user must also say to go ahead before fetching from it.

Not in the repo: the Avaloq sample report and evaluation files (a customer's
site; the author's copies are in the temp folder `spike/avaloq/` and the config
is `avaloq.com.a11y-config.json` in the author's own files), and any model key.

A prompt to paste into a new chat:

> Continue the AI support for "can't tell" results on branch
> design-ai-cant-tell (check it out from origin). Read
> docs/design/ai-cant-tell-START-HERE.md and follow it.
