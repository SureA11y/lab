# Start here: AI support for "can't tell" results

Branch: `design-ai-cant-tell` (on origin). No pull request: the work is
experimental until it is decided to merge it.

Read, in this order:
1. `ai-cant-tell-design.md`: "Status when work stopped", then "Handoff: state at
   2026-11-24 and how to pick it up cold", then the rest as needed.
2. `ai-cant-tell-spike.md`: the earlier results.

Done: the conformance remark added with "Add to the remarks" saves in the
downloaded report and comes back when it is opened again (status section of the
design note; `ai-cant-tell-spike/check-remark-save.js` repeats it). Next: the
"Next, in order" list in that section.

Conventions: no references to Claude or any AI assistant in branch names,
commits, authors or co-author lines; commit under the user's own identity; no
PR unless asked; no real-site data in the repo; `node --test` (not `npm test`)
on Windows; run `npm run build:action-docs` after changing step fields.

Not in the repo: the Avaloq sample report and evaluation files (a customer's
site; the author's copies are in the temp folder `spike/avaloq/` and the config
is `avaloq.com.a11y-config.json` in the author's own files), and any model key
(`ANTHROPIC_API_KEY`).

A prompt to paste into a new chat:

> Continue the AI support for "can't tell" results on branch
> design-ai-cant-tell (check it out from origin). Read
> docs/design/ai-cant-tell-START-HERE.md and follow it.
