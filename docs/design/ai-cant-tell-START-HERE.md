# Start here: AI support for "can't tell" results

Branch: `design-ai-cant-tell` (on origin). No pull request: the work is
experimental until it is decided to merge it.

Read, in this order:
1. This page: the state and what is next.
2. `../ai-answers.md`: the user guide (how to use it, every option of the
   scan step's AI answers field, the server's settings, the demo).
3. `ai-cant-tell-eval/README.md`: how the AI is evaluated, the demo's and the
   W3C site's results, and how to repeat them.
4. `ai-cant-tell-design.md`: the design, section by section (the newest are
   near the end, before "Status when work stopped"), as needed.
5. `ai-cant-tell-data-and-agents.md`: before turning the AI pass on for a
   customer's site (what leaves the lab, agents, how to set it up well).
6. `ai-cant-tell-spike.md`: the earliest results.

## State (end of 2026-11-25)

Everything is committed and pushed (latest: 1.4.11 per element). The full
suite (4484 tests) and the browser tests (`focus-walk`, `ai-answer`,
`app-boot`: 30) pass.

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
- **The demo:** `examples/demo-site/ai/` (`reading.html`, `focus.html`),
  `examples/specs/ai-answers.spec.json`, the correct answers in
  `expected.json`, `examples/ai-demo-score.js`. 31 questions, including a Help
  link that shows focus from a script (2.4.7, 1.4.11 and 2.4.13 pass).
  Evaluated blind, a model answering the lab's exact prompts outside the lab
  (`ai-cant-tell-spike/answer-offline.js`): **31 of 31**
  (`ai-cant-tell-eval/demo/`). Clear cases by design: it shows the pipeline,
  not real-site accuracy.
- **Real site:** the W3C's Before and After Demonstration
  (`examples/specs/ai-answers-w3c-bad.spec.json`, `focusStops: 80`), **against
  labels written by the assistant, not a person** (`ai-cant-tell-eval/w3c-bad/`).
  Run 5, with the current code (images say what they show): 47 of 57 (82%),
  98% of those answered, no wrong fail (run 4's, blank spacers read as a bar
  chart, is fixed), one wrong pass (the news photo of Note 10, which moves
  between pass and open from run to run), focus order 5 of 5. Runs 3 and 4:
  48 and 47 of 57.

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

1. **A person's labels on the W3C run:** open its run in Review AI answers
   (`answered.json`, as `ai-cant-tell-eval/README.md` says), label against
   the W3C's annotations with the AI's answer hidden, run
   `npm run ai:agreement`, and replace the assistant's labels. Until then the
   84% is not a person's measure.
2. **A real model inside the lab:** the user has a Claude API key and enters
   it in Run settings on their own machine. Run the demo
   (`ai-answers.spec.json`, then `ai-demo-score.js`) and the W3C spec through
   the lab's own call; check the API usage for cached tokens.
3. **The user's claude.ai project "A11y Auditor Expert Agent":** carry its
   instructions and knowledge files into the built-in call (system prompt,
   cached knowledge, structured output, the official SDK), configured on the
   server (`A11Y_AI_INSTRUCTIONS`, `A11Y_AI_KNOWLEDGE` were proposed).
   Waiting on the user to export them.
4. Done: images say what they show (`image.look` in `evidence.js`: blank,
   colours, main colour; read from a canvas not added to the page; an image
   from another site cannot be read, and says so). Run 5 confirmed it.
   **Next for the W3C run:** more cases per check, and a person's labels
   (item 1), to tell real changes from run-to-run variation.
5. **Optional, not built:** pictures sent to the model (only after measuring
   that they help); 2.4.13's and 1.4.11's measurement is lossy on animated
   focus styles (it reads after a short wait) and covered stops measure 0
   changed (right, but worth saying in the review).
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
- In a cloud session, the user's "lab" environment allows www.w3.org (for the
  W3C run) and api.anthropic.com; other sites are blocked.

Not in the repo: the Avaloq sample report and evaluation files (a customer's
site; the author's copies are in the temp folder `spike/avaloq/` and the config
is `avaloq.com.a11y-config.json` in the author's own files), and any model key.

A prompt to paste into a new chat:

> Continue the AI support for "can't tell" results on branch
> design-ai-cant-tell (check it out from origin). Read
> docs/design/ai-cant-tell-START-HERE.md and follow it.
