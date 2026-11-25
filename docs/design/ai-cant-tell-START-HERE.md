# Start here: AI support for "can't tell" results

Branch: `design-ai-cant-tell` (on origin). No pull request: the work is
experimental until it is decided to merge it.

Read, in this order:
1. This page: the state on 2026-11-25 and what is next.
2. `../ai-answers.md`: the user guide (how to use it, every option of the
   scan step's AI answers field, the server's settings, the demo).
3. `ai-cant-tell-eval/README.md`: how the AI is evaluated, the demo's result,
   and the real-site run that is ready but not done.
4. `ai-cant-tell-design.md`: the design, section by section (the newest are
   near the end, before "Status when work stopped"), as needed.
5. `ai-cant-tell-data-and-agents.md`: before turning the AI pass on for a
   customer's site (what leaves the lab, agents, how to set it up well).
6. `ai-cant-tell-spike.md`: the earliest results.

## State on 2026-11-25

Everything below is committed and pushed, except where it says otherwise.

**Built** (code in `src/server-side/ai-answer/`, `src/js/ai-answer-view.js`,
`src/js/ai-review.js`, `src/js/ai-key-field.js`, `src/cli/ai-agreement.js`):
- The AI pass of a scan step (`ai` option), answering only what the scan
  leaves as can't tell; the tool's outcome never changes.
- Questions answered by reading: page title, alt text, decorative images,
  bold paragraph as heading, link text, field labels.
- The focus walk (`ai: { focus: true }`): Tab through the page, then put focus
  and scroll back, checked by a fingerprint. Page-level questions: focus
  visible, focus order, keyboard (fail only), focus not obscured (2.4.11,
  2.4.12), focus appearance (2.4.13, measured from pictures). Per-element
  questions the scanner asks: focus visible and appearance per link, keyboard
  per control, focus not obscured per fixed/sticky box. Landmark and heading
  per stop; a page picture with the stops numbered in the review.
- Providers: built-in Claude call (key from Run settings, kept in memory, or
  `ANTHROPIC_API_KEY`), or `A11Y_AI_ENDPOINT` (any model or agent).
- Server safeguards: allowed sites, masking, preview, log of what was sent.
- Review AI answers dialog, conformance remarks from confirmed fails, lessons
  export, `npm run ai:agreement`.
- Docs: `docs/ai-answers.md` (user guide), configuration reference, examples
  README, this folder.
- Demo: `examples/demo-site/ai/` (two pages asking every question),
  `examples/specs/ai-answers.spec.json`, `expected.json`,
  `examples/ai-demo-score.js`. Evaluated blind with a model outside the lab:
  25 of 25 agree (`ai-cant-tell-eval/demo/`).

**Last session's final change, not fully re-tested:** the log of what was sent
(`canonical.ai.outbox`, `ai-sent.json`) now names the question asked
(`focus-visible-element`) instead of the scanner's check
(`css-focus-indicator-suppressed`), in `index.js` (`outboxEntry`), with an
assertion added in `focus-walk.browserspec.js`. The unit tests for the AI
files passed before it; the full suite and the browser tests were interrupted
before finishing. **First task:** run them.

```bash
node --test
```

```bash
node --test src/server-side/ai-answer/focus-walk.browserspec.js src/server-side/ai-answer/ai-answer.browserspec.js src/js/app-boot.browserspec.js
```

(With no Chrome of Puppeteer's own, set `PUPPETEER_EXECUTABLE_PATH` to a
Chrome or Chromium.)

## Next, in order

1. Run the tests above; fix anything they show.
2. **Real websites.** `examples/specs/ai-answers-w3c-bad.spec.json` (the W3C's
   Before and After Demonstration, eight pages) is ready but has not been run:
   the last session's cloud environment could not reach www.w3.org (the user
   declined to allow it there). Run it where the network allows, then follow
   "Real websites" in `ai-cant-tell-eval/README.md`: answer with a key or
   offline (`ai-cant-tell-spike/answer-offline.js`), label in Review AI
   answers against the W3C's annotations, `npm run ai:agreement`, and record
   the result there. Check the eight URLs on the first run.
3. A real model inside the lab: the user has a Claude API key and enters it in
   Run settings on their own machine; nothing has been answered through the
   lab's own call yet (only the stand-in and the offline model).
4. The user's claude.ai project "A11y Auditor Expert Agent": its instructions
   and knowledge files are to be carried into the built-in call (system
   prompt, cached knowledge, structured output, official SDK), configured on
   the server (`A11Y_AI_INSTRUCTIONS`, `A11Y_AI_KNOWLEDGE` were proposed).
   Waiting on the user to export them.
5. Optional ideas raised and not built: a per-check count of questions the AI
   did not take, in the review or the run summary; images sent to the model
   (only after measuring that they help).
6. On hold: the browser extension (it never receives AI answers; see the
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
- The background servers of a cloud session (demo site on 8780, lab on 3000)
  may be stopped between turns: start them in the same command that uses them.

Not in the repo: the Avaloq sample report and evaluation files (a customer's
site; the author's copies are in the temp folder `spike/avaloq/` and the config
is `avaloq.com.a11y-config.json` in the author's own files), and any model key.

A prompt to paste into a new chat:

> Continue the AI support for "can't tell" results on branch
> design-ai-cant-tell (check it out from origin). Read
> docs/design/ai-cant-tell-START-HERE.md and follow it.
